'use strict';
/* Celular e Mac na MESMA conversa subiam dois agentes ao mesmo tempo.
   Cada tela batiza os paineis de um jeito ("p1" no Mac, "w7k3p1" no telefone) para uma nao
   desligar o chat da outra, mas o NUMERO da conversa e o mesmo nos dois — e nada conferia se
   aquela conversa ja tinha dono. Resultado: dois agentes escrevendo no mesmo historico e
   editando a mesma pasta, cada tela vendo so metade. Aqui a segunda subida e recusada. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadMain } = require('./main-harness.cjs');

// o painel do Mac abre a conversa e o processo do claude fica de pe
async function abrirNoMac(h, paneId, fio) {
  const r = await h.call('pane:start', { paneId, engine: 'claude', cwd: h.HOME, resumeId: fio });
  assert.notEqual(r && r.jaAberta, true, 'a primeira subida tem de passar');
  return r;
}

test('a mesma conversa aberta no Mac recusa a segunda subida pelo celular', async () => {
  const h = loadMain();
  await abrirNoMac(h, 'p1', 'S-1');
  const antes = h.spawned.length;

  const r = await h.call('pane:start', { paneId: 'w7k3p1', engine: 'claude', cwd: h.HOME, resumeId: 'S-1' });

  assert.equal(r.jaAberta, true, 'tem de recusar');
  assert.equal(r.onde, 'no Mac', 'o recado tem de dizer ONDE ela esta aberta');
  assert.match(String(r.error), /j\u00e1 est\u00e1 aberta/i);
  assert.equal(h.spawned.length, antes, 'nenhum segundo processo pode subir na mesma conversa');
});

test('o recado muda quando quem esta com a conversa e o celular', async () => {
  const h = loadMain();
  await h.call('pane:start', { paneId: 'w7k3p1', engine: 'claude', cwd: h.HOME, resumeId: 'S-2' });
  const r = await h.call('pane:start', { paneId: 'p1', engine: 'claude', cwd: h.HOME, resumeId: 'S-2' });
  assert.equal(r.onde, 'no celular');
});

test('dois chats da MESMA tela na mesma conversa tambem sao recusados', async () => {
  const h = loadMain();
  await abrirNoMac(h, 'p1', 'S-3');
  const r = await h.call('pane:start', { paneId: 'p2', engine: 'claude', cwd: h.HOME, resumeId: 'S-3' });
  assert.equal(r.jaAberta, true);
  assert.equal(r.onde, 'em outro chat desta tela');
});

test('o mesmo painel pode religar a propria conversa', async () => {
  const h = loadMain();
  await abrirNoMac(h, 'p1', 'S-4');
  const r = await h.call('pane:start', { paneId: 'p1', engine: 'claude', cwd: h.HOME, resumeId: 'S-4' });
  assert.notEqual(r && r.jaAberta, true, 'religar o proprio chat nao pode ser barrado');
});

test('ramificar continua passando: o fork abre conversa nova, nao escreve na de origem', async () => {
  const h = loadMain();
  await abrirNoMac(h, 'p1', 'S-5');
  const r = await h.call('pane:start', { paneId: 'p2', engine: 'claude', cwd: h.HOME, resumeId: 'S-5', fork: true });
  assert.notEqual(r && r.jaAberta, true, 'o ramo tem de poder nascer da conversa aberta');
});

test('o ramo nao rouba o dono da conversa de origem', async () => {
  const h = loadMain();
  await abrirNoMac(h, 'p1', 'S-R');
  await h.call('pane:start', { paneId: 'p2', engine: 'claude', cwd: h.HOME, resumeId: 'S-R', fork: true });
  // a de origem continua sendo do p1: o celular tem de ouvir que ela esta aberta
  const r = await h.call('pane:start', { paneId: 'w7k3p1', engine: 'claude', cwd: h.HOME, resumeId: 'S-R' });
  assert.equal(r.jaAberta, true);
  assert.equal(r.onde, 'no Mac');
});

test('fechado o chat, a conversa fica livre para a outra tela', async () => {
  const h = loadMain();
  await abrirNoMac(h, 'p1', 'S-6');
  await h.call('pane:stop', { paneId: 'p1', engine: 'claude' });
  const r = await h.call('pane:start', { paneId: 'w7k3p1', engine: 'claude', cwd: h.HOME, resumeId: 'S-6' });
  assert.notEqual(r && r.jaAberta, true, 'depois de parar, a outra tela pode abrir');
});

test('mandar de NOVO assume a conversa e desliga o agente do outro lado', async () => {
  const h = loadMain();
  await abrirNoMac(h, 'p1', 'S-8');
  const primeira = await h.call('pane:start', { paneId: 'w7k3p1', engine: 'claude', cwd: h.HOME, resumeId: 'S-8' });
  assert.equal(primeira.jaAberta, true, 'a primeira vez avisa');
  // R2-046: claudePanes.delete(paneId) roda ANTES de matarGrupoExtra(st.proc) dentro de
  // claudeStop (main.js) — entao so' conferir "claudePanes.has('p1') === false" prova que o
  // REGISTRO sumiu, nao que o PROCESSO foi morto de verdade. Espiao no mesmo padrao de
  // tests/r1-main-1.test.cjs (R1-048), ligado so' antes desta segunda tentativa pra nao pegar
  // chamada de outro ponto do fluxo (nenhum claudeStop roda antes disso neste teste).
  h.evaluate("globalThis.__chamadasGrupo = []; matarGrupoExtra = (p) => { globalThis.__chamadasGrupo.push(p); };");
  const segunda = await h.call('pane:start', { paneId: 'w7k3p1', engine: 'claude', cwd: h.HOME, resumeId: 'S-8' });
  assert.notEqual(segunda && segunda.jaAberta, true, 'insistindo, a conversa vem para ca');
  assert.equal(h.evaluate("globalThis.__chamadasGrupo.length"), 1, 'claudeStop tem de matar o GRUPO do processo antigo (matarGrupoExtra), nao so apagar o registro');
  // prova complementar: o registro tambem sumiu (mas sozinha nao bastava, ver acima)
  assert.equal(h.evaluate("claudePanes.has('p1')"), false, 'o agente que estava na conversa tem de ser desligado de verdade');
  // e o chat de la fica sabendo, em vez de emudecer sem explicacao
  const recado = h.paneEvents('note').find(e => /passou para l/i.test(e.text || ''));
  assert.ok(recado, 'o chat antigo tem de receber o recado');
});

test('avisar uma vez nao pode virar cadeado: o painel nunca fica sem poder escrever', async () => {
  const h = loadMain();
  await abrirNoMac(h, 'p1', 'S-9');
  // o dono e um processo esquecido de uma janela recarregada: ninguem ve, mas esta vivo
  await h.call('pane:start', { paneId: 'p2', engine: 'claude', cwd: h.HOME, resumeId: 'S-9' });
  const r = await h.call('pane:start', { paneId: 'p2', engine: 'claude', cwd: h.HOME, resumeId: 'S-9' });
  assert.notEqual(r && r.jaAberta, true, 'na segunda tentativa ele tem de conseguir escrever');
});

test('dono que morreu nao vira cadeado: a trava se solta sozinha', async () => {
  const h = loadMain();
  await abrirNoMac(h, 'p1', 'S-7');
  h.evaluate('claudePanes.delete("p1")');   // a janela do Mac fechou e o processo se foi
  const r = await h.call('pane:start', { paneId: 'w7k3p1', engine: 'claude', cwd: h.HOME, resumeId: 'S-7' });
  assert.notEqual(r && r.jaAberta, true, 'sem motor de pe, a conversa tem de liberar');
});

test('o numero REAL da conversa (o que o motor devolve) tambem passa a ter dono', async () => {
  const h = loadMain();
  // conversa nova: sobe sem resumeId nenhum e o claude anuncia o numero dela no init
  await h.call('pane:start', { paneId: 'p1', engine: 'claude', cwd: h.HOME });
  h.evaluate('claudeMessage("p1", { type: "system", subtype: "init", session_id: "S-NOVA" })');
  const r = await h.call('pane:start', { paneId: 'w7k3p1', engine: 'claude', cwd: h.HOME, resumeId: 'S-NOVA' });
  assert.equal(r.jaAberta, true, 'o celular nao pode entrar na conversa que nasceu no Mac');
});
