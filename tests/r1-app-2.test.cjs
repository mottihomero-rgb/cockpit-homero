'use strict';
// Testes de guarda para o lote "app" (renderer) da rodada 1 da auditoria do Cockpit — faixa 2.
// Padrao: extrair a funcao (ou o trecho) real de renderer/app.js por regex e rodar em vm com
// stubs, igual tests/auditoria-renderer-20260921.test.cjs e tests/r1-app-1.test.cjs.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const APP_PATH = path.join(__dirname, '../renderer/app.js');
const source = fs.readFileSync(APP_PATH, 'utf8');

function func(nome, src = source) {
  const re = new RegExp('^(?:async )?function ' + nome + '\\(', 'm');
  const match = re.exec(src);
  assert.ok(match, nome + ' existe em app.js');
  const start = match.index;
  const line = src.slice(start, src.indexOf('\n', start));
  if (line.endsWith('}')) return line;
  return src.slice(start, src.indexOf('\n}', start) + 2);
}
function trecho(re, rotulo) {
  const m = re.exec(source);
  assert.ok(m, rotulo + ' existe em app.js');
  return m[0];
}

function classes(...initial) {
  const set = new Set(initial);
  return { add: (...xs) => xs.forEach(x => set.add(x)), remove: (...xs) => xs.forEach(x => set.delete(x)),
    contains: x => set.has(x), toggle: (x, yes) => yes ? set.add(x) : set.delete(x) };
}
function element(extra = {}) {
  return { style: {}, classList: classes(), dataset: {}, value: '', innerHTML: '', textContent: '', nodes: {}, groups: {},
    children: [], appendChild(x) { this.children.push(x); return x; }, remove() {}, focus() {}, select() {},
    getBoundingClientRect() { return { width: 660, height: 340 }; }, ...extra };
}

function baseContext(extras = {}) {
  const c = { console, Map, Set, Date, Event, window: { api: {}, dispatchEvent: () => {} },
    setTimeout: () => {}, clearTimeout: () => {}, queueMicrotask: (fn) => fn() };
  Object.assign(c, extras);
  vm.createContext(c);
  return c;
}

// ===========================================================================
// R1-019 — anexo do quadro removido nao pode deixar P.quadroColado preso
// ===========================================================================
test('R1-019: remover a ultima fichinha de anexo zera P.quadroColado', () => {
  const src = func('pintarAnexos');
  let capturado = null;
  const barra = element();
  const c = baseContext({
    $: (sel, el) => (sel === '.p-anexos' ? barra : null),
    fichaAnexo: (a, comX, aoTirar) => { capturado = aoTirar; return element(); },
  });
  vm.runInContext(src, c);

  const anexoQuadro = { path: 'quadro.png' };
  const P = { el: {}, anexos: [anexoQuadro], quadroColado: { texto: 'Desenhei um fluxograma' } };
  c.pintarAnexos(P);
  assert.ok(capturado, 'o callback de tirar a fichinha tem de existir');

  // clique no "x" da fichinha do quadro: era o UNICO anexo
  capturado(anexoQuadro);
  assert.equal(P.anexos.length, 0);
  assert.equal(P.quadroColado, null, 'quadroColado nao pode sobreviver a remocao do ultimo anexo');
});

test('R1-019: remover um anexo que NAO e o do quadro, com outros restando, preserva quadroColado', () => {
  const src = func('pintarAnexos');
  const capturados = [];
  const barra = element();
  const c = baseContext({
    $: () => barra,
    fichaAnexo: (a, comX, aoTirar) => { capturados.push(aoTirar); return element(); },
  });
  vm.runInContext(src, c);

  const a1 = { path: 'foto.png' }, a2 = { path: 'quadro.png' };
  const P = { el: {}, anexos: [a1, a2], quadroColado: { texto: 'x' } };
  c.pintarAnexos(P);
  capturados[0](a1);   // tira so o primeiro; o do quadro continua na lista
  assert.equal(P.anexos.length, 1);
  assert.equal(P.quadroColado.texto, 'x', 'ainda ha anexo na lista: nao pode zerar cedo demais');
});

test('R1-019: apagar o campo na mao (sem anexo) zera P.quadroColado pelo listener de input', () => {
  const re = /inp\.addEventListener\('input', \(\) => \{\n {4}if \(!inp\.value\.trim\(\) && !\(P\.anexos \|\| \[\]\)\.length\) P\.quadroColado = null;\n {2}\}\);/;
  const snippet = trecho(re, 'listener de input que zera quadroColado');

  const listeners = [];
  const inp = element();
  inp.addEventListener = (evt, fn) => { if (evt === 'input') listeners.push(fn); };
  const P = { anexos: [], quadroColado: { texto: 'Desenhei um fluxograma' } };
  const c = baseContext({ inp, P });
  vm.runInContext(snippet, c);
  assert.equal(listeners.length, 1);

  inp.value = '   ';   // so espaco: trim() fica vazio
  listeners[0]();
  assert.equal(P.quadroColado, null, 'campo vazio (sem anexo) tem de soltar o metadado do quadro');
});

test('R1-019: com texto ainda no campo, o listener NAO mexe em quadroColado', () => {
  const re = /inp\.addEventListener\('input', \(\) => \{\n {4}if \(!inp\.value\.trim\(\) && !\(P\.anexos \|\| \[\]\)\.length\) P\.quadroColado = null;\n {2}\}\);/;
  const snippet = trecho(re, 'listener de input que zera quadroColado');
  const listeners = [];
  const inp = element();
  inp.addEventListener = (evt, fn) => { if (evt === 'input') listeners.push(fn); };
  const P = { anexos: [], quadroColado: { texto: 'x' } };
  const c = baseContext({ inp, P });
  vm.runInContext(snippet, c);
  inp.value = 'ainda escrevendo';
  listeners[0]();
  assert.equal(P.quadroColado.texto, 'x', 'com texto no campo o metadado do quadro e' + ' legitimo');
});

test('R1-019: send() nao manda nada quando fica so texto vazio + sem anexo + quadroColado ja zerado', async () => {
  // stubs minimos: so o suficiente para chegar no guard "nada pra enviar". Se o guard nao
  // retornar (regressao), o codigo real segue para vozSoltar/userMsg, que aqui NAO existem
  // no contexto — e o teste falha por ReferenceError, denunciando a regressao.
  const src = func('send');
  const inp = element(); inp.value = '';
  const elP = element(); elP.nodes = { '.p-input': inp, '.p-cont': null };
  const P = { id: 'p1', trocando: false, carregandoHistorico: false, engine: 'claude',
    anexos: [], quadroColado: null, el: elP };
  const c = baseContext({
    panes: new Map([[P.id, P]]),
    motoresTrocandoConta: new Set(),
    $: (sel, el) => (el && el.nodes && sel in el.nodes) ? el.nodes[sel] : null,
    podeContinuar: () => false,
    VIVO: {}, DITADO: {},
  });
  vm.runInContext(src, c);
  await c.send(P);   // nao deve lancar: o guard tem de sair ANTES de tocar em vozSoltar etc
});

// ===========================================================================
// R1-051 — pontinho "pendente" do Codex nao pode travar ligado
// ===========================================================================
test('R1-051: invalidarConversa desliga settingsPending na hora, sem depender de concluirEscolhasEnvio', () => {
  const src = func('invalidarConversa');
  const c = baseContext({});
  vm.runInContext(src, c);

  const P = { settingsSend: {}, settingsPending: true, filaTimer: null };
  c.invalidarConversa(P);
  assert.equal(P.settingsPending, false, 'o pontinho pendente nao pode sobreviver a troca de conversa');
  assert.equal(P.settingsSend, null);
});

// ===========================================================================
// R1-020 — lista de modelos do Codex nao pode travar vazia pra sempre
// ===========================================================================
test('R1-020: MODELOS_CODEX vazio ([]) nao trava a proxima tentativa de buscar de novo', async () => {
  const re = /if \(P\.engine === 'codex' && !MODELOS_CODEX\) \{[\s\S]*?\n {2}\}/;
  const snippet = trecho(re, 'bloco de busca de MODELOS_CODEX em menuModelos');

  let fillCalls = 0, pintarCalls = 0;
  const c = baseContext({
    traduzCodex: (ms) => ms.map(m => ({ id: m.id, nome: m.id })),
    fillModels: () => { fillCalls++; },
    pintar: () => { pintarCalls++; },
  });
  c.window.api.codexModels = async () => [];   // Codex fora do ar na 1a tentativa
  // MODELOS_CODEX precisa existir como variavel do escopo do contexto, igual ao module-level
  // `let MODELOS_CODEX = null;` de app.js (linha 173)
  vm.runInContext('var MODELOS_CODEX = null;\nasync function testar(P) {\n  ' + snippet + '\n}', c);

  const P = { engine: 'codex' };
  await c.testar(P);
  assert.equal(fillCalls, 0, '1a tentativa (lista vazia) nao pinta nada');
  assert.ok(!c.MODELOS_CODEX, 'MODELOS_CODEX tem de continuar falsy (null), NUNCA [] — [] e verdadeiro em JS');

  // Codex volta ao ar
  c.window.api.codexModels = async () => [{ id: 'sol-6' }, { id: 'astra' }];
  await c.testar(P);
  assert.ok(Array.isArray(c.MODELOS_CODEX) && c.MODELOS_CODEX.length === 2,
    'com MODELOS_CODEX ainda falsy, a 2a tentativa tem de buscar de novo e preencher a lista real');
  assert.equal(fillCalls, 1);
  assert.equal(pintarCalls, 1);
});

// ===========================================================================
// R1-024 — adicionar conector nao pode matar o chat em andamento sem perguntar
// ===========================================================================
function montarHandlerConector(P, confirmaCorte) {
  const confirmarCorteSrc = func('confirmarCorte');
  const onclickRe = /\$\('#cnOk', cx\)\.onclick = async \(\) => \{[\s\S]*?\n {2}\};/;
  const onclickSnippet = trecho(onclickRe, 'handler do botao #cnOk em formConector');

  const nodes = {
    '#cnNome': element({ value: 'notion' }),
    '#cnUrl': element({ value: 'https://mcp.notion.com/mcp' }),
    '#cnCmd': element({ value: '' }),
    '#cnErro': element(),
    '#cnOk': element(),
  };
  const cx = element({ nodes });
  let desligou = 0;
  const avisos = [];
  const c = baseContext({
    cx, P,
    $: (sel, el) => (el && el.nodes && sel in el.nodes) ? el.nodes[sel] : null,
    nomeDoMotor: () => 'Claude',
    agTrabalhando: () => false,
    confirm: () => confirmaCorte,
    fecharModal: () => {},
    avisoTemp: (_P, t) => avisos.push(t),
    desligarMotor: async () => { desligou++; },
  });
  c.window.api.mcpAcao = async () => ({ ok: true });
  vm.runInContext(confirmarCorteSrc + '\n' + onclickSnippet, c);
  return { cx, avisos, desligada: () => desligou };
}

test('R1-024: chat ocupado + ele CANCELA a pergunta -> conector salvo, motor NAO desliga', async () => {
  const P = { engine: 'claude', busy: true, titulo: 'trabalho em andamento' };
  const { cx, avisos, desligada } = montarHandlerConector(P, false);
  await cx.nodes['#cnOk'].onclick();
  assert.equal(desligada(), 0, 'ele cancelou: o processo em andamento nao pode ser cortado');
  assert.ok(avisos.some(t => /reiniciar/.test(t)), 'a mensagem tem de avisar que so vale quando reiniciar');
});

test('R1-024: chat ocupado + ele CONFIRMA a pergunta -> motor desliga e avisa que parou algo', async () => {
  const P = { engine: 'claude', busy: true, titulo: 'trabalho em andamento' };
  const { cx, avisos, desligada } = montarHandlerConector(P, true);
  await cx.nodes['#cnOk'].onclick();
  assert.equal(desligada(), 1);
  assert.ok(avisos.some(t => /parou aqui/.test(t)), 'confirmando, o aviso tem de dizer que algo em andamento parou');
});

test('R1-024: chat PARADO -> nem pergunta, desliga direto (comportamento de sempre)', async () => {
  const P = { engine: 'claude', busy: false, titulo: 'chat parado' };
  const { cx, desligada } = montarHandlerConector(P, false);   // confirm() nem seria chamado
  await cx.nodes['#cnOk'].onclick();
  assert.equal(desligada(), 1, 'sem trabalho rodando, nao ha o que perder: aplica direto, sem perguntar');
});

// ===========================================================================
// R1-022 — segundo terminal no mesmo painel abandona o processo do primeiro
// ===========================================================================
test('R1-022: duplo clique em "Entrar" nos conectores trava o botao (so 1 chamada de mcpAcao)', async () => {
  const re = /\$\$\('\.co-bt', el\)\.forEach\(bt => bt\.onclick = async \(\) => \{[\s\S]*?\n {6}\}\);/;
  const snippet = trecho(re, 'handler dos botoes .co-bt em janelaConectores');

  const chamadas = [];
  let resolveMcp;
  const bt = element({ dataset: { ac: 'login' }, disabled: false });
  const el = element({ groups: { '.co-bt': [bt] } });
  const c = baseContext({
    el, c: { nome: 'notion' }, P: { engine: 'codex' }, motor: 'Codex',
    $$: (sel, e) => (e && e.groups && e.groups[sel]) || [],
    confirm: () => true,
    janelaTerminal: () => {},
    janelaConectores: () => {},
    nomeLimpo: (n) => n,
    alert: () => {},
  });
  c.window.api.mcpAcao = (args) => { chamadas.push(args); return new Promise((res) => { resolveMcp = res; }); };
  vm.runInContext(snippet, c);

  bt.onclick();   // 1o clique: fica pendurado no await
  bt.onclick();   // 2o clique (duplo clique sem querer)
  assert.equal(chamadas.length, 1, 'o segundo clique tem de ser barrado por bt.disabled — so 1 login em voo');
  resolveMcp({ ok: true });
});

test('R1-022: abrir um segundo terminal no mesmo painel mata o processo do primeiro (nao so a tela)', () => {
  const janelaTerminalSrc = func('janelaTerminal');

  class TerminalFake {
    constructor() { this.disposed = false; }
    open() {} onData() {} write() {} resize() {} focus() {}
    dispose() { this.disposed = true; }
  }
  class ResizeObserverFake {
    constructor(fn) { this.fn = fn; this.disconnected = false; }
    observe() {} disconnect() { this.disconnected = true; }
  }
  const kills = [];
  const aoFechar1Chamadas = [];
  const modal = element();
  const cx = element();
  modal.nodes = { '.modal-cx': cx };
  cx.nodes = {
    '.mo-tit': element(), '.mo-sub': element(), '.term-tela': element(),
    '.term-link': element({ nodes: { '.mono': element(), button: element() } }),
    '#tmCancela': element(), '#tmFecha': element(), '.mo-x': element(),
  };
  const P = { el: { nodes: { '.p-modal': modal } } };

  const c = baseContext({
    $: (sel, el) => (el && el.nodes && sel in el.nodes) ? el.nodes[sel] : null,
    Terminal: TerminalFake, ResizeObserver: ResizeObserverFake,
    ESTA_TELA: 'mac', termSeq: 0, termsVivos: new Map(),
    REG_LINK: /https?:\/\/[^\s"'<>)\]]+/g,
    semEscapes: (t) => t,
    fecharMenus: () => {}, fecharModal: () => {},
    ico: () => 'x',
    document: { createElement: () => element() },
    queueMicrotask: (fn) => fn(),
    setTimeout: () => {},
  });
  c.window.api.termInput = () => {};
  c.window.api.termResize = () => Promise.resolve();
  c.window.api.termRun = () => Promise.resolve({});
  c.window.api.termKill = ({ id }) => { kills.push(id); };
  c.window.api.openUrl = () => {};
  vm.runInContext(janelaTerminalSrc, c);

  c.janelaTerminal(P, 'echo 1', 'Terminal 1', () => aoFechar1Chamadas.push(1));
  const term1 = P.fecharTerminal;
  assert.ok(term1, 'primeiro terminal tem de instalar P.fecharTerminal');

  // "duplo clique": abre um SEGUNDO terminal no MESMO painel antes de fechar o primeiro
  c.janelaTerminal(P, 'echo 2', 'Terminal 2', () => {});

  assert.equal(kills.length, 1, 'o processo do primeiro terminal tem de ser morto ao abrir o segundo');
  assert.equal(aoFechar1Chamadas.length, 0,
    'o aoFechar do terminal ANTIGO nao pode disparar — ele reabriria por cima do terminal novo');
  assert.notEqual(P.fecharTerminal, term1, 'P.fecharTerminal tem de apontar so para o terminal mais recente');
});
