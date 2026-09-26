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
