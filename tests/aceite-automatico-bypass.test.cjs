'use strict';
/* 29/09: no "sem pedir permissão" os ajudantes em segundo plano do ULTRACODE ainda pediam aceite
   para apagar pasta (rm -rf com curinga). O cartão ficava a noite inteira esperando e o trabalho
   parava. Neste modo o Cockpit aprova sozinho; nos outros o cartão continua aparecendo. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadMain } = require('./main-harness.cjs');

const pedidoRm = (h, paneId, id) => h.evaluate(`claudeMessage('${paneId}',{type:'control_request',request_id:'${id}',request:{subtype:'can_use_tool',tool_name:'Bash',input:{command:'rm -rf saida/*'}}})`);
const respostas = proc => proc.writes.filter(w => w && w.type === 'control_response');

test('sem pedir permissão: pedido de ajudante é aprovado sozinho, sem cartão', async () => {
  const h = loadMain();
  await h.call('pane:start', { paneId: 'p', engine: 'claude', cwd: h.HOME, approval: 'bypass' });
  const proc = h.spawned.at(-1);
  pedidoRm(h, 'p', 'r1');
  assert.equal(h.paneEvents('approval').length, 0, 'não pode abrir cartão');
  const r = respostas(proc).at(-1);
  assert.equal(r.response.request_id, 'r1');
  assert.equal(r.response.response.behavior, 'allow');
  assert.equal(r.response.response.updatedInput.command, 'rm -rf saida/*');
});

test('Manual e Auto continuam mostrando o cartão', async () => {
  for (const approval of ['manual', 'auto', 'auto-edit']) {
    const h = loadMain();
    await h.call('pane:start', { paneId: 'p', engine: 'claude', cwd: h.HOME, approval });
    const proc = h.spawned.at(-1);
    pedidoRm(h, 'p', 'r2');
    assert.equal(h.paneEvents('approval').length, 1, approval + ' tem de perguntar');
    assert.equal(respostas(proc).length, 0, approval + ' não pode aprovar sozinho');
  }
});

test('sem pedir permissão: pergunta da IA e plano continuam indo para a tela', async () => {
  const h = loadMain();
  await h.call('pane:start', { paneId: 'p', engine: 'claude', cwd: h.HOME, approval: 'bypass' });
  h.evaluate(`claudeMessage('p',{type:'control_request',request_id:'q',request:{subtype:'can_use_tool',tool_name:'AskUserQuestion',input:{questions:[{question:'Cliente?',options:[]}]}}})`);
  assert.equal(h.paneEvents('perguntas').length, 1);
  assert.equal(respostas(h.spawned.at(-1)).length, 0);
});

test('plano aprovado voltando para "sem pedir permissão" passa a aprovar sozinho', async () => {
  const h = loadMain();
  await h.call('pane:start', { paneId: 'p', engine: 'claude', cwd: h.HOME, approval: 'plan' });
  const proc = h.spawned.at(-1);
  h.evaluate(`claudeMessage('p',{type:'control_request',request_id:'pl',request:{subtype:'can_use_tool',tool_name:'ExitPlanMode',input:{plan:'fazer'}}})`);
  const key = h.paneEvents('plano-pronto').at(-1).key;
  assert.equal(h.call('pane:plano', { key, paneId: 'p', aprovar: true, modo: 'bypass' }).ok, true);
  const n = respostas(proc).length;
  pedidoRm(h, 'p', 'r3');
  assert.equal(h.paneEvents('approval').length, 0);
  assert.equal(respostas(proc).length, n + 1);
  assert.equal(respostas(proc).at(-1).response.response.behavior, 'allow');
});
