'use strict';
/* 26/09: tempo total de trabalho do chat, no meio do rodapé da caixa. Soma só o tempo em que a
   IA trabalhou (da fala dele ao último registro antes da próxima; pausa > 10 min não conta). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const raiz = path.join(__dirname, '..');
const main = fs.readFileSync(path.join(raiz, 'main.js'), 'utf8');
const app = fs.readFileSync(path.join(raiz, 'renderer/app.js'), 'utf8');
const pega = (src, n) => { const i = src.indexOf('function ' + n + '('); let k = src.indexOf('{', i), d = 0;
  for (; k < src.length; k++) { if (src[k] === '{') d++; else if (src[k] === '}' && --d === 0) break; } return src.slice(i, k + 1); };
const ctx = { fs, Date, JSON, Map }; vm.createContext(ctx);
vm.runInContext('const TEMPO_PAUSA_MAX = 10 * 60 * 1000; const tempoCache = new Map();' + pega(main, 'falaDeGenteClaude') + pega(main, 'tempoDeTrabalho') + ';this.t = tempoDeTrabalho;', ctx);
const arq = (linhas) => { const f = path.join(os.tmpdir(), 'tempo-' + Math.random().toString(36).slice(2) + '.jsonl'); fs.writeFileSync(f, linhas.map(l => JSON.stringify(l)).join('\n')); return f; };
const T = (s) => new Date(Date.UTC(2026, 8, 26, 10, 0, s)).toISOString();

test('Claude: soma cada resposta; o tempo parado entre uma resposta e a próxima pergunta não conta', () => {
  const f = arq([
    { type: 'user', timestamp: T(0), message: { content: 'faz a página' } },
    { type: 'assistant', timestamp: T(30), message: { content: [] } },
    { type: 'user', timestamp: T(40), message: { content: [{ type: 'tool_result' }] } },   // ferramenta: é trabalho
    { type: 'assistant', timestamp: T(60), message: { content: [] } },
    { type: 'user', timestamp: T(3000), message: { content: 'agora troca a cor' } },         // ele voltou 49 min depois
    { type: 'assistant', timestamp: T(3020), message: { content: [] } },
  ]);
  assert.equal(ctx.t('claude', f), 80000, '60 s da 1a + 20 s da 2a');
});

test('pausa longa no meio (esperando aprovar) não conta', () => {
  const f = arq([
    { type: 'user', timestamp: T(0), message: { content: 'roda' } },
    { type: 'assistant', timestamp: T(10), message: { content: [] } },
    { type: 'assistant', timestamp: T(10 + 1200), message: { content: [] } },   // 20 min parado
    { type: 'assistant', timestamp: T(10 + 1200 + 5), message: { content: [] } },
  ]);
  assert.equal(ctx.t('claude', f), 15000);
});

test('Codex: cada resposta vem marcada do começo ao fim', () => {
  const f = arq([
    { type: 'event_msg', timestamp: T(0), payload: { type: 'task_started' } },
    { type: 'response_item', timestamp: T(20), payload: { type: 'message' } },
    { type: 'event_msg', timestamp: T(45), payload: { type: 'task_complete' } },
    { type: 'event_msg', timestamp: T(900), payload: { type: 'token_count' } },   // depois do fim: não conta
  ]);
  assert.equal(ctx.t('codex', f), 45000);
});

test('rodapé: soma do arquivo + turnos de agora + o turno rodando; some com zero', () => {
  assert.match(pega(app, 'tempoTotalMs'), /t\.base \+ t\.vivo \+ \(P\.busy && P\.t0/);
  assert.match(pega(app, 'marcarFimDoTurno'), /tempoDoChat\(P\)\.vivo \+= levou/);
  const c = {}; vm.createContext(c); vm.runInContext(pega(app, 'fmtTempoTotal') + ';this.f = fmtTempoTotal;', c);
  assert.equal(c.f(42000), '42s'); assert.equal(c.f(12 * 60000), '12min'); assert.equal(c.f(83 * 60000), '1h 23min'); assert.equal(c.f(120 * 60000), '2h');
  const html = fs.readFileSync(path.join(raiz, 'renderer/index.html'), 'utf8');
  assert.match(html, /<span class="cmp-gap"><span class="p-tempo hidden"/, 'no meio do rodapé, entre a pasta e o quadro');
});
