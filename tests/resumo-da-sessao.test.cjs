/* 26/09 (ele perguntou "por que fica dessa forma?"): o resumo que o Claude Code grava quando a
   conversa enche ("This session is being continued...") aparecia como balão "Você" gigante em
   inglês e chegou a ir de novo junto com a pergunta seguinte. Agora vira a faixa "Conversa
   resumida"; colado na frente de uma fala, sobra só a fala. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const os = require('node:os');

const raiz = path.resolve(__dirname, '..');
const main = fs.readFileSync(path.join(raiz, 'main.js'), 'utf8');
const app = fs.readFileSync(path.join(raiz, 'renderer/app.js'), 'utf8');
const pegar = (fonte, nome) => {
  const i = fonte.indexOf('function ' + nome + '(');
  assert.ok(i >= 0, 'sumiu a função ' + nome);
  return fonte.slice(i, fonte.indexOf('\n}\n', i) + 2);
};
const linha = (fonte, ini) => { const i = fonte.indexOf(ini); assert.ok(i >= 0, 'sumiu: ' + ini); return fonte.slice(i, fonte.indexOf('\n', i)); };

const RESUMO = 'This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.\n\nSummary:\n1. Primary Request...\n'
  + 'Continue the conversation from where it left off without asking the user any further questions. Resume directly — do not acknowledge the summary, do not recap what was happening, do not preface with "I\'ll continue" or similar. Pick up the last task as if the break never happened.';

function ctxMain() {
  const ctx = { fs, console };
  vm.createContext(ctx);
  vm.runInContext([
    linha(main, 'const TECNICO = '), linha(main, 'const ehTecnico = '),
    main.slice(main.indexOf('const BLOCOS_TECNICOS = ['), main.indexOf('];', main.indexOf('const BLOCOS_TECNICOS = [')) + 2),
    pegar(main, 'tiraBlocos'), pegar(main, 'semContexto'),
    linha(main, 'const RESUMO_DA_SESSAO = '), linha(main, 'const FIM_DO_RESUMO = '), pegar(main, 'semResumoDaSessao'),
    'function cortarHistorico(m) { return m; }', 'function tailRead() { return ""; }', 'function claudeToolArg() { return ""; }',
    pegar(main, 'claudeHistory'), 'this.claudeHistory = claudeHistory; this.semResumoDaSessao = semResumoDaSessao;',
  ].join('\n'), ctx);
  return ctx;
}

test('o resumo do Claude vira a faixa "Conversa resumida", não balão dele', () => {
  const ctx = ctxMain();
  const arq = path.join(os.tmpdir(), 'resumo-sessao-' + process.pid + '.jsonl');
  const linhas = [
    { type: 'user', message: { role: 'user', content: 'Só testando' } },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'Oi' }] } },
    { type: 'system', subtype: 'compact_boundary' },
    { type: 'user', isCompactSummary: true, isVisibleInTranscriptOnly: true, message: { role: 'user', content: RESUMO } },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'Pronto' }] } },
    // o resumo que voltou colado na frente da pergunta dele (mandado de novo pela caixa)
    { type: 'user', message: { role: 'user', content: [{ type: 'text', text: RESUMO + '\n\nPorque que fica dessa forma?' }] } },
  ];
  fs.writeFileSync(arq, linhas.map(l => JSON.stringify(l)).join('\n'));
  const msgs = ctx.claudeHistory(arq);
  fs.unlinkSync(arq);
  assert.deepEqual(JSON.parse(JSON.stringify(msgs.map(m => m.role + ':' + (m.text || '')))),
    ['user:Só testando', 'bot:Oi', 'compactou:', 'bot:Pronto', 'user:Porque que fica dessa forma?']);
  assert.equal(ctx.semResumoDaSessao('Oi, tudo bem?'), 'Oi, tudo bem?', 'fala normal passa intacta');
  assert.equal(ctx.semResumoDaSessao(RESUMO), '', 'resumo sozinho some');
});

test('o leitor da VPS e o título da lista também ignoram o resumo', () => {
  assert.match(pegar(main, 'claudeHistoryTexto'), /if \(d\.isCompactSummary\) \{ msgs\.push\(\{ role: 'compactou' \}\); continue; \}/);
  assert.equal((main.match(/if \(d\.isMeta \|\| d\.isCompactSummary\) continue;/g) || []).length, 2, 'título da lista (Mac e VPS)');
});

test('ao vivo: o Claude resumindo e resumido viram a mesma faixa, só com o rótulo', () => {
  assert.match(main, /m\.subtype === 'compact_boundary'\) \{ emit\(paneId, 'compactou', \{\}\); return; \}/);
  assert.match(main, /m\.subtype === 'status' && m\.status === 'compacting'\) \{ emit\(paneId, 'compacting', \{\}\); return; \}/);
  assert.match(app, /case 'compactou': faixaResumo\(P\); break;/);
  assert.match(pegar(app, 'renderizarHistorico'), /\['compactou', 'compaction'\]\.includes\(role\)\) faixaResumo\(P\);/);
  assert.match(pegar(app, 'estadoCodex'), /if \(mensagem\) \{/, 'sem frase embaixo do rótulo');
});
