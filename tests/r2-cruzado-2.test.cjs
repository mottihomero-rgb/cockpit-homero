'use strict';
/* Testes de guarda do lote "cruzado 2" da rodada 2 (R2-023, R2-012).
   Cada teste falha no código de ANTES do conserto e passa com o conserto aplicado.
   R2-014 (endereço do Tailscale) já estava corrigido por outra faixa (comentário "R2-041"
   em servidor-web.js) quando este lote começou — nada a consertar, ver tests/r2-celular-1.test.cjs. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const appSrc = fs.readFileSync(path.join(__dirname, '../renderer/app.js'), 'utf8');
const quadroSrc = fs.readFileSync(path.join(__dirname, '../renderer/quadro.js'), 'utf8');
const mobileSrc = fs.readFileSync(path.join(__dirname, '../renderer/mobile.js'), 'utf8');

function extractFn(nome, src) {
  // \s* no começo porque quadro.js indenta as funções dentro de um IIFE (não fica na coluna 0)
  const re = new RegExp('^\\s*(?:async )?function ' + nome + '\\(', 'm');
  const m = re.exec(src);
  assert.ok(m, nome + ' existe no arquivo');
  const start = m.index;
  // função de uma linha só (ex.: "function donoEh(P) { return ...; }") já fecha antes do \n
  const linha = src.slice(start, src.indexOf('\n', start));
  if (linha.trimEnd().endsWith('}')) return linha;
  return src.slice(start, src.indexOf('\n}', start) + 2);
}

/* ===================== R2-023: fechar um painel derruba o quadro de outro ===================== */

test('R2-023 quadro.js: window.Quadro agora exporta donoEh', () => {
  assert.match(quadroSrc, /window\.Quadro = \{ abrir, fechar, aberto, donoEh \};/,
    'donoEh não está sendo exportado — closePane não tem como checar o dono');
});

test('R2-023 quadro.js: donoEh(P) — Q.P null continua "dono" (comportamento de segurança de hoje)', () => {
  const src = extractFn('donoEh', quadroSrc);
  const ctx = vm.createContext({ Q: { P: null } });
  vm.runInContext(src, ctx);
  const donoEh = vm.runInContext('donoEh', ctx);
  assert.equal(donoEh({ id: 'qualquer' }), true);
});

test('R2-023 quadro.js: donoEh(P) — compara Q.P com o painel: só o dono bate true', () => {
  const src = extractFn('donoEh', quadroSrc);
  const painelA = { id: 'A' }, painelB = { id: 'B' };
  const ctx = vm.createContext({ Q: { P: painelA } });
  vm.runInContext(src, ctx);
  const donoEh = vm.runInContext('donoEh', ctx);
  assert.equal(donoEh(painelA), true, 'o dono de verdade devia bater');
  assert.equal(donoEh(painelB), false, 'painel B não é dono do quadro do painel A');
});

test('R2-023 app.js: closePane só fecha o quadro quando o painel fechado é o DONO dele', () => {
  // extrai só o topo de closePane (a guarda do quadro), fecha a função ali mesmo pra
  // não precisar simular guardarAntesDeMexer/guardarFechado/terminal/etc.
  const start = appSrc.indexOf('async function closePane(id, semPerguntar) {');
  const corte = appSrc.indexOf('// fechar o chat tem de apagar a luz do microfone', start);
  assert.ok(start >= 0 && corte > start, 'não achei mais a guarda do quadro em closePane — mudou de lugar?');
  const guardaSrc = appSrc.slice(start, corte) + '\n  return "seguiu";\n}';

  function rodar({ painelFechado, donoAtual, confirmaSim = true }) {
    const chamadasFechar = [];
    const ctx = vm.createContext({
      panes: new Map([[painelFechado.id, painelFechado]]),
      window: { Quadro: {
        aberto: () => true,
        donoEh: (P) => P === donoAtual,
        fechar: () => chamadasFechar.push(true),
      } },
      agTrabalhando: () => false,
      nomeDoMotor: () => 'Claude',
      confirm: () => confirmaSim,
      // R3-039 (outro defeito, rodada 3) fez closePane checar tambem o painel de agentes, igual
      // ja fazia com o Quadro; sem estes dois globais o teste quebrava so por faltar o stub
      agPaneAberto: null,
      fecharPainelAgentes: () => {},
    });
    vm.runInContext(guardaSrc, ctx);
    const closePane = vm.runInContext('closePane', ctx);
    closePane(painelFechado.id, true);
    return chamadasFechar.length;
  }

  const painelA = { id: 'A', busy: false, engine: 'claude', titulo: 'A' };
  const painelB = { id: 'B', busy: false, engine: 'claude', titulo: 'B' };

  // cenário do defeito: fecha o painel B (chat qualquer) enquanto o quadro é do painel A
  assert.equal(rodar({ painelFechado: painelB, donoAtual: painelA }), 0,
    'fechar um painel que NÃO é dono do quadro não pode chamar Quadro.fechar()');

  // fechar o próprio dono continua fechando o quadro junto (comportamento certo, preservado)
  assert.equal(rodar({ painelFechado: painelA, donoAtual: painelA }), 1,
    'fechar o painel DONO do quadro devia fechar o quadro junto');
});

/* ===================== R2-012: reconexão do iPhone não repõe turno/aprovação perdidos ===================== */

function contextoMobile(extras = {}) {
  const chamadas = { paneEstado: 0, sessionHistory: 0 };
  const recebidos = [];
  const P = { id: 'p1', engine: 'claude', cwd: '/projeto', started: true, busy: false,
    sessaoId: 'sess-1', sessaoFile: '', chat: { scrollTop: 0, scrollHeight: 0, clientHeight: 0, replaceChildren() {} },
    hist: [], blocks: new Map(), tools: new Map(),
    ...extras.P };
  const c = {
    console,
    pronto: true, atualizando: false, restaurando: false,
    document: { hidden: false, body: { classList: { contains: () => false } } },
    panes: new Map([[P.id, P]]),
    focusPane: P,
    sessao: (p) => p.sessaoId || p.resumeId || '',
    NA_VPS: () => false,
    selos: new WeakMap(),
    renderizarHistorico: () => {},
    scroll: () => {},
    recebidos,
    receberEventoPane: (ev) => recebidos.push(ev),
    window: { api: {
      paneEstado: extras.paneEstado === undefined ? async () => { chamadas.paneEstado++; return { busy: false, aprovacao: null }; }
        : async (...a) => { chamadas.paneEstado++; return extras.paneEstado(...a); },
      sessionHistory: async () => { chamadas.sessionHistory++; return extras.sessionHistory ? extras.sessionHistory() : []; },
      sessionHistoryRemoto: async () => { chamadas.sessionHistory++; return []; },
    } },
  };
  vm.createContext(c);
  const normalizado = mobileSrc.replace(/^  /gm, '');
  vm.runInContext(extractFn('atualizar', normalizado), c);
  return { c, P, chamadas, recebidos, atualizar: vm.runInContext('atualizar', c) };
}

test('R2-012 mobile.js: reconectou e o turno JÁ acabou (Mac diz busy:false) — relê o histórico mesmo com P.started', async () => {
  const { atualizar, chamadas } = contextoMobile({ paneEstado: () => ({ busy: false, aprovacao: null }) });
  await atualizar();
  assert.equal(chamadas.paneEstado, 1, 'não consultou o estado real do Mac no reconnect');
  assert.equal(chamadas.sessionHistory, 1,
    'com o defeito, P.started sozinho faz a função desistir e a tela fica presa em "trabalhando…" pra sempre');
});

test('R2-012 mobile.js: aprovação perdida durante o sono é reencaminhada pro mesmo tratamento (receberEventoPane)', async () => {
  const dados = { key: 'ap_1', title: 'Rodar comando no seu Mac', detail: 'ls -la', reason: '' };
  const { atualizar, recebidos } = contextoMobile({
    paneEstado: () => ({ busy: false, aprovacao: { tipo: 'approval', dados } }),
  });
  await atualizar();
  assert.equal(recebidos.length, 1, 'a aprovação pendente que nasceu enquanto o iPhone dormia nunca chegou na tela');
  // objeto veio de dentro da vm (outro "realm"): JSON tira a diferença de protótipo antes de comparar
  assert.deepEqual(JSON.parse(JSON.stringify(recebidos[0])), { paneId: 'p1', kind: 'approval', ...dados });
});

test('R2-012 mobile.js: turno REALMENTE ainda rodando (Mac diz busy:true) — não atropela o streaming ao vivo', async () => {
  const { atualizar, chamadas } = contextoMobile({ paneEstado: () => ({ busy: true, aprovacao: null }) });
  await atualizar();
  assert.equal(chamadas.sessionHistory, 0, 'não pode reler o histórico por cima de uma resposta que ainda está chegando ao vivo');
});

test('R2-012 mobile.js: sem a ponte paneEstado (Mac antigo), desiste sem travar — não tenta ler histórico por baixo', async () => {
  const { c, atualizar, chamadas } = contextoMobile();
  delete c.window.api.paneEstado;
  await atualizar();
  assert.equal(chamadas.sessionHistory, 0);
});

test('R2-012 mobile.js: painel comum (P.started false) continua direto pro histórico, sem IPC extra', async () => {
  const { atualizar, chamadas } = contextoMobile({ P: { started: false } });
  await atualizar();
  assert.equal(chamadas.paneEstado, 0, 'painel que não está streaming não precisa perguntar estado ao Mac');
  assert.equal(chamadas.sessionHistory, 1);
});

test('R2-012 main.js: pane:estado existe e está na lista branca do celular (servidor-web.js)', () => {
  const mainSrc = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
  const servidorSrc = fs.readFileSync(path.join(__dirname, '../servidor-web.js'), 'utf8');
  const preloadSrc = fs.readFileSync(path.join(__dirname, '../preload.js'), 'utf8');
  const webSrc = fs.readFileSync(path.join(__dirname, '../renderer/web.js'), 'utf8');
  assert.match(mainSrc, /handle\('pane:estado'/, 'handler pane:estado não existe em main.js');
  assert.match(servidorSrc, /'pane:estado'/, 'pane:estado não está na lista PERMITIDOS do servidor-web.js');
  assert.match(preloadSrc, /paneEstado:.*ipcRenderer\.invoke\('pane:estado'/, 'falta a ponte no preload.js (Mac)');
  assert.match(webSrc, /paneEstado:.*chamar\('pane:estado'/, 'falta a ponte no renderer/web.js (iPhone)');
});

test('R2-012 main.js: pane:estado devolve busy=true quando o painel está rodando de verdade (Claude ou Codex)', () => {
  const { loadMain } = require('./main-harness.cjs');
  const h = loadMain();
  assert.deepEqual(JSON.parse(JSON.stringify(h.call('pane:estado', { paneId: 'p1' }))), { busy: false, aprovacao: null });

  h.evaluate("claudePanes.set('p1', { rodando: true })");
  assert.equal(h.call('pane:estado', { paneId: 'p1' }).busy, true, 'claudePanes rodando:true devia contar como busy');
  h.evaluate("claudePanes.delete('p1')");

  h.evaluate("codex.paneTurn.set('p1', 'turno-1')");
  assert.equal(h.call('pane:estado', { paneId: 'p1' }).busy, true, 'codex.paneTurn com turno devia contar como busy');
  h.evaluate("codex.paneTurn.delete('p1')");
});

test('R2-012 main.js: pane:estado devolve a aprovação pendente guardada (mesmo payload que o emit ao vivo manda)', () => {
  const { loadMain } = require('./main-harness.cjs');
  const h = loadMain();
  h.evaluate(`pendingApprovals.set('k1', { paneId: 'p1', kind: 'cmd',
    evento: { tipo: 'approval', dados: { key: 'k1', title: 'Rodar comando no seu Mac', detail: 'ls', reason: '' } } })`);
  const r = h.call('pane:estado', { paneId: 'p1' });
  assert.equal(r.aprovacao.tipo, 'approval');
  assert.equal(r.aprovacao.dados.key, 'k1');
  assert.equal(r.aprovacao.dados.title, 'Rodar comando no seu Mac');
});
