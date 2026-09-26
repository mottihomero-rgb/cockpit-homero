'use strict';
/* 26/09 — como no VS Code: a pergunta da IA (AskUserQuestion) vira a janelinha de opções e o
   plano pronto do modo Plano (ExitPlanMode) vira o cartão "Executar". Testado contra o Claude
   de verdade antes: as respostas vão em updatedInput.answers ({ pergunta: resposta }) e o
   aprovar leva updatedPermissions setMode para o modo de antes. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadMain } = require('./main-harness.cjs');

const app = fs.readFileSync(path.join(__dirname, '..', 'renderer/app.js'), 'utf8');
const Q = [{ question: 'Qual cor?', header: 'Cor', multiSelect: false, options: [{ label: 'Azul' }, { label: 'Verde' }] },
  { question: 'Qual animal?', header: 'Animal', multiSelect: true, options: [{ label: 'Gato' }, { label: 'Cão' }] }];

async function subir(modo) {
  const h = loadMain();
  await h.call('pane:start', { paneId: 'p1', engine: 'claude', cwd: h.HOME, approval: modo });
  const proc = h.spawned.find(p => /claude/.test(p.cmd || p.bin || '') || (p.args || []).includes('--print')) || h.spawned.at(-1);
  return { h, proc };
}
const pedir = (h, tool, input) => h.evaluate('claudeMessage("p1", ' + JSON.stringify({ type: 'control_request', request_id: 'r1',
  request: { subtype: 'can_use_tool', tool_name: tool, input, requires_user_interaction: true } }) + ')');
const resposta = (proc) => proc.writes.filter(w => w.type === 'control_response').at(-1).response.response;

test('o canal de pergunta vai em todo modo; fora do "sem permissão" ele fica disponível para depois do plano', async () => {
  const a = await subir('bypass');
  assert.ok(a.proc.args.includes('--permission-prompt-tool'), 'no bypass também (senão a pergunta da IA não chega)');
  assert.ok(a.proc.args.includes('--dangerously-skip-permissions'));
  const b = await subir('plan');
  assert.ok(b.proc.args.includes('--permission-prompt-tool'));
  assert.ok(b.proc.args.includes('--allow-dangerously-skip-permissions'), 'aprovar o plano precisa poder voltar ao sem-permissão');
});

test('AskUserQuestion vira o evento perguntas e a resposta volta em answers', async () => {
  const { h, proc } = await subir('bypass');
  pedir(h, 'AskUserQuestion', { questions: Q });
  const ev = h.paneEvents('perguntas').at(-1);
  assert.ok(ev, 'a tela recebe as perguntas');
  assert.equal(h.paneEvents('approval').length, 0, 'não é pedido de permissão');
  const r = await h.call('pane:perguntas', { key: ev.key, paneId: 'p1', answers: { 'Qual cor?': 'Verde', 'Qual animal?': 'Gato, Cão' } });
  assert.equal(r.ok, true);
  const res = resposta(proc);
  assert.equal(res.behavior, 'allow');
  assert.deepEqual(res.updatedInput.answers, { 'Qual cor?': 'Verde', 'Qual animal?': 'Gato, Cão' });
  assert.equal(res.updatedInput.questions.length, 2, 'as perguntas voltam junto');
  const de2 = await h.call('pane:perguntas', { key: ev.key, paneId: 'p1', answers: { 'Qual cor?': 'Azul' } });
  assert.ok(de2.error, 'responder duas vezes não vale');
});

test('fechar sem responder (pular) nega com um recado, e o Claude segue', async () => {
  const { h, proc } = await subir('bypass');
  pedir(h, 'AskUserQuestion', { questions: Q });
  const ev = h.paneEvents('perguntas').at(-1);
  await h.call('pane:perguntas', { key: ev.key, paneId: 'p1', pular: true });
  assert.equal(resposta(proc).behavior, 'deny');
});

test('plano aprovado volta para o modo de antes; ajuste vai como recado', async () => {
  const { h, proc } = await subir('plan');
  pedir(h, 'ExitPlanMode', { plan: '# Plano\n1. fazer', planFilePath: '/x.md' });
  const ev = h.paneEvents('plano-pronto').at(-1);
  assert.equal(ev.plano, '# Plano\n1. fazer');
  await h.call('pane:plano', { key: ev.key, paneId: 'p1', aprovar: true, modo: 'bypass' });
  const ok = resposta(proc);
  assert.equal(ok.behavior, 'allow');
  assert.deepEqual(ok.updatedPermissions, [{ type: 'setMode', mode: 'bypassPermissions', destination: 'session' }]);

  pedir(h, 'ExitPlanMode', { plan: 'outro' });
  const ev2 = h.paneEvents('plano-pronto').at(-1);
  await h.call('pane:plano', { key: ev2.key, paneId: 'p1', aprovar: false, texto: 'troca o passo 2' });
  const no = resposta(proc);
  assert.equal(no.behavior, 'deny');
  assert.match(no.message, /troca o passo 2/);
});

test('"ok", "pode", "liberado" liberam o plano; frase de ajuste não', () => {
  const re = new RegExp(app.match(/const PALAVRAS_DE_LIBERAR = \/(.*)\/i;/)[1], 'i');
  for (const t of ['ok', 'Ok!', 'pode', 'liberado', 'pode executar', 'sim', 'manda ver', 'bora']) assert.ok(re.test(t), t);
  for (const t of ['ok mas troca o passo 2', 'não', 'muda a cor', 'pode tirar o passo 3']) assert.ok(!re.test(t), t);
});

test('as perguntas e o plano não viram passo de ferramenta, e fazem o chat esperar você', () => {
  assert.match(app, /if \(name === 'AskUserQuestion' \|\| name === 'ExitPlanMode'\) return;/);
  assert.match(app, /if \(P\.perguntasAtual\) return \{ txt: 'esperando sua resposta', cls: 'espera' \};/);
  assert.match(app, /case 'perguntas': abrirPerguntas\(P, ev\); break;/);
});

/* ---- "tem que servir para as 4 IAs" ---- */
const vm = require('node:vm');
function pegar(nome) {
  const m = new RegExp('^(?:async )?function ' + nome + '\\(', 'm').exec(app);
  assert.ok(m, nome);
  let n = 0, i = app.indexOf('{', m.index);
  for (; i < app.length; i++) { if (app[i] === '{') n++; else if (app[i] === '}' && --n === 0) { i++; break; } }
  return app.slice(m.index, i);
}

test('Codex no modo Plano: o plano proposto vira o cartão, e Executar sai do Plano e manda executar', async () => {
  const chamadas = [];
  const ctx = { Date, String, mostrarPlano: (P, ev, opts) => { chamadas.push(['cartao', ev.plano]); ctx.opts = opts; },
    mudarEscolhasCodex: async (P, patch) => chamadas.push(['modo', patch.collaborationMode]),
    enviarComoEle: (P, t) => chamadas.push(['envia', t]) };
  vm.createContext(ctx);
  vm.runInContext(pegar('planoDoCodex') + ';this.f = planoDoCodex;', ctx);
  const P = { engine: 'codex', collaborationMode: 'plan' };
  ctx.f(P, { id: 'i1', text: '1. fazer', complete: false });
  assert.equal(chamadas.length, 0, 'plano ainda chegando não vira cartão');
  ctx.f(P, { id: 'i1', text: '1. fazer', complete: true });
  assert.deepEqual(chamadas[0], ['cartao', '1. fazer']);
  assert.equal(ctx.opts.persiste, true, 'o cartão do Codex sobrevive ao fim do turno');
  await ctx.opts.responder(true, '');
  assert.deepEqual(chamadas.slice(1), [['modo', 'default'], ['envia', 'Plano aprovado. Pode executar.']]);
  ctx.f({ engine: 'codex', collaborationMode: 'default' }, { id: 'i2', text: 'x', complete: true });
  assert.equal(chamadas.filter(c => c[0] === 'cartao').length, 1, 'fora do Plano o Codex não ganha cartão');
});

test('Gemini no modo Plano: Executar no fim da resposta; fora do Plano, nada', () => {
  let cartoes = 0;
  const ctx = { Date, MODOS: { gemini: [{ id: 'manual' }, { id: 'plan' }] }, cfg: {}, mostrarPlano: () => { cartoes++; } };
  vm.createContext(ctx);
  vm.runInContext(pegar('planoAoFimDoTurno') + ';this.f = planoAoFimDoTurno;', ctx);
  const chat = { querySelectorAll: () => [{}] };
  ctx.f({ engine: 'gemini', mode: 'plan', chat });
  assert.equal(cartoes, 1);
  ctx.f({ engine: 'gemini', mode: 'manual', chat });
  ctx.f({ engine: 'claude', mode: 'plan', chat });
  assert.equal(cartoes, 1, 'o Claude tem o plano pronto dele; fora do Plano não aparece');
});

test('pergunta simples do Codex abre a mesma janelinha; formulário e senha ficam no cartão antigo', () => {
  const f = pegar('perguntaCodex');
  assert.match(f, /tipo === 'requestUserInput' && !schema/);
  assert.match(f, /abrirPerguntas\(P, \{ key: ev\.key \?\? ev\.id, questions: qs \}/);
  assert.match(f, /!q\.isSecret/);
  assert.match(app, /case 'question-resolved': encerrarPerguntaCodex\(P, ev\.key\);\s*\n\s*if \(P\.perguntasAtual/);
});

/* 26/09 (Hugo, por áudio): a torre é a central de avisos — Esperando você (responde numa janelinha
   sem ir ao chat), Prontas para ler (sai ao clicar) e Trabalhando; sem separar por pasta/VPS. */
test('torre: três grupos, janelinha de responder e o número no ícone de Conversas', () => {
  assert.match(pegar('pintarSeloTorre'), /\$\('\.act\[data-view="conversas"\]'\)/);
  const t = pegar('pintarTorre');
  assert.match(t, /const TITULOS = \{ espera: 'Esperando você', pronta: 'Prontas para ler', ocupado: 'Trabalhando' \};/);
  assert.match(t, /aoClicar: g === 'espera' \? \(\) => responderPelaTorre\(P\) : \(\) => \{ irAoChat\(P\); pintarTorre\(false\); \}/);
  assert.match(t, /else if \(P\.nova\) grupos\.pronta\.push/, 'pronta = resposta nova que ele ainda não viu');
  const r = pegar('responderPelaTorre');
  assert.match(r, /P\.perguntasAtual/); assert.match(r, /P\.planoPendente/); assert.match(r, /\.pane-perm/);
  assert.match(r, /await orig\.onclick\(\)/, 'a cópia aguarda o mesmo handler de autorização');
  assert.match(r, /P\.aprovacaoAtual !== pedido/, 'pedido trocado não pode autorizar outra operação');
  assert.match(pegar('pintarPonto'), /pintarSeloTorre\(\);/);
});
