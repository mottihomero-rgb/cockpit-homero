'use strict';
// Testes de guarda da rodada 2 (lote "app", faixa renderer/app.js).
// Mesmo padrão de tests/auditoria-renderer-20260921.test.cjs: extrai a função de verdade do
// arquivo fonte por regex e roda dentro de uma VM com stubs de DOM/janela.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(process.env.COCKPIT_RENDERER_SOURCE || path.join(__dirname, '../renderer/app.js'), 'utf8');

function func(nome, src = source) {
  const re = new RegExp('^(?:async )?function ' + nome + '\\(', 'm');
  const match = re.exec(src);
  assert.ok(match, nome + ' existe');
  const start = match.index;
  const line = src.slice(start, src.indexOf('\n', start));
  if (line.endsWith('}')) return line;
  return src.slice(start, src.indexOf('\n}', start) + 2);
}
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
function classes(...initial) {
  const set = new Set(initial);
  return { add: (...xs) => xs.forEach(x => set.add(x)), remove: (...xs) => xs.forEach(x => set.delete(x)),
    contains: x => set.has(x), toggle: (x, yes) => (yes === undefined ? !set.has(x) : yes) ? set.add(x) : set.delete(x) };
}
// elemento fake com addEventListener de verdade (guarda os handlers) e $ que "nasce" sozinho:
// qualquer seletor nunca visto antes vira um novo nó filho consistente, sem precisar montar DOM.
function mkNode() {
  const listeners = {};
  const node = {
    style: { setProperty() {}, removeProperty() {} }, classList: classes(), nodes: {}, attrs: {},
    className: '', innerHTML: '', textContent: '', value: '', disabled: false, isConnected: true, title: '',
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    removeEventListener(type, fn) { listeners[type] = (listeners[type] || []).filter(f => f !== fn); },
    dispatch(type, ev) { (listeners[type] || []).slice().forEach(fn => fn(ev)); },
    listenerCount(type) { return (listeners[type] || []).length; },
    appendChild(x) { return x; }, replaceChildren() {}, querySelectorAll() { return []; },
    setAttribute(k, v) { this.attrs[k] = v; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 200, height: 30 }; },
    setPointerCapture() {}, releasePointerCapture() {},
    focus() { this.focused = true; }, setSelectionRange() {}, dispatchEvent() {},
  };
  return node;
}
function $sel(sel, el) {
  if (!el) return null;
  if (!el.nodes) el.nodes = {};
  if (!el.nodes[sel]) el.nodes[sel] = mkNode();
  return el.nodes[sel];
}

/* ================= R2-027 — "manda" não pode sobrescrever texto digitado à mão ================= */
test('R2-027: comando falado "manda" usa o texto que ele acabou de corrigir à mão, não o VIVO.base velho', async () => {
  const names = ['vozEvento', 'vozPintar', 'vozFantasma', 'vozComando', 'vozSoltar', 'vozEncerrarTela',
    'vozZerar', 'vozTirarNivel', 'normalizarFala'];
  const c = {
    console, Map, Set, RegExp, String, Math, Event,
    $: $sel,
    document: { createElement: () => mkNode() },
    window: { api: { vozParar() {} } },
    sentTexts: [], timers: [],
    setTimeout(fn) { const t = { fn }; c.timers.push(t); return t; },
    panes: new Map(),
    vozVazio: (t) => !String(t || '').replace(/[\s.,;:!?…]/g, ''),
    vozTextoAgora: () => (((c.VIVO.base ? c.VIVO.base.replace(/\s*$/, ' ') : '') + c.VIVO.firme)
      + (c.VIVO.parcial ? ' ' + c.VIVO.parcial : '')).trim(),
    vozTextoFirme: () => (((c.VIVO.base ? c.VIVO.base.replace(/\s*$/, ' ') : '') + c.VIVO.firme)).trim(),
    vozNivel: () => {},
    send: async (P) => { c.sentTexts.push($sel('.p-input', P.el).value); },
  };
  c.VIVO = { P: null, base: '', firme: '', parcial: '' };
  c.DITADO = { P: null };
  vm.createContext(c);
  vm.runInContext(names.map(n => func(n)).join('\n'), c);

  const el = mkNode();
  const P = { id: 'p1', el };
  c.panes.set(P.id, P);
  c.VIVO.P = P;
  // ditou um parágrafo antes; ele CLICOU no campo e corrigiu uma palavra à mão. VIVO.ultimoEscrito
  // continua apontando pro texto antigo (é essa desatualização que causa o defeito).
  c.VIVO.base = 'texto antigo ditado'; c.VIVO.firme = ''; c.VIVO.parcial = '';
  c.VIVO.ultimoEscrito = 'texto antigo ditado';
  $sel('.p-input', el).value = 'texto corrigido pela mão';

  // "manda" chega como FINAL curto, sem nenhum 'partial' antes
  c.vozEvento(P, { type: 'final', text: 'manda' });
  assert.equal(c.timers.length, 1, 'o envio fica agendado 60ms depois');
  await c.timers[0].fn();

  assert.equal(c.sentTexts[0], 'texto corrigido pela mão');
});

/* ================= R2-003 — erro no envio direto tem de soltar P.started ================= */
test('R2-003: paneSend rejeitando (não só ok:false) solta P.started para o próximo Enviar religar', async () => {
  const names = ['send', 'painelAindaAtual', 'invalidarConversa', 'juntarNaFila', 'agendarFila'];
  const noop = () => {};
  const c = {
    console, Map, Set, Date, Event, queueMicrotask, timers: [], panes: new Map(),
    cfg: {}, VIVO: {}, DITADO: {}, motoresTrocandoConta: new Set(), ENTRA_MSG: 'ENTRA:', ULTRACODE_MSG: 'ULTRA:',
    $: $sel, $$: () => [],
    setTimeout(fn, ms) { const t = { fn, ms }; c.timers.push(t); return t; },
    clearTimeout(t) { c.timers = c.timers.filter(x => x !== t); },
    window: { dispatchEvent: noop, api: {} },
    ico: () => 'icone', nomeDoMotor: e => e, modoDe: () => ({ id: 'manual' }), esforcoDe: () => 'high',
    NA_VPS: cwd => String(cwd).startsWith('vps:'),
    modeloSemOrigem: x => x, modeloPorCreditos: () => false, mensagensDele: () => [],
    nomeDaConversa: () => 'Conversa', montarContexto: () => 'CONTEXTO:',
    note: (P, t) => {}, avisoTemp: () => {}, avisoEnvio: () => mkNode(),
    document: { createElement: () => mkNode(), querySelectorAll: () => [], body: { classList: classes() } },
  };
  for (const name of ['pintarAnexos', 'limparSugestoes', 'vozSoltar', 'pararBuscaDeArquivos', 'soltarNavArquivos',
    'guardarPrompt', 'prepararEscolhasEnvio', 'concluirEscolhasEnvio', 'setDot', 'pintarNome', 'nomearCurto',
    'pararTrabalho', 'limparPassos', 'limparContinuar', 'trabalhando', 'subirNaLista', 'comecarTurno',
    'devolverFilaAoCampo']) c[name] = noop;
  c.envioComAnexos = (P, text, attachments) => ({ text, displayText: text, attachments });
  c.userMsg = (P, text, attachments) => { const b = mkNode(); P.hist.push({ texto: text, attachments }); return b; };
  c.recuperarEnvio = (P, b, t) => { $sel('.p-input', P.el).value = t; };
  vm.createContext(c);
  vm.runInContext(names.map(n => func(n)).join('\n'), c);

  const el = mkNode();
  const P = { id: 'p1', engine: 'claude', cwd: '/projeto', started: true, busy: false, titulo: 'Teste',
    anexos: [], hist: [], filaMsgs: [], blocks: new Map(), tools: new Map(), el, chat: mkNode() };
  c.panes.set(P.id, P);
  c.window.api.paneSend = async () => { throw new Error('O Codex não respondeu a turn/start a tempo.'); };
  $sel('.p-input', el).value = 'mensagem que vai falhar';

  await c.send(P);

  assert.equal(P.started, false, 'sem isto o próximo "Enviar" pula o religar e repete a mesma falha para sempre');
  assert.equal(P.busy, false);
  assert.equal($sel('.p-input', el).value, 'mensagem que vai falhar', 'o texto volta pro campo');
});

/* ================= R2-045 — dois dedos na barra de esforço não podem disputar o mesmo arrasto ================= */
test('R2-045: um segundo pointerdown durante o arrasto é ignorado (não reseta o arrasto do primeiro dedo)', () => {
  const c = {
    console, Math, Date, performance: { now: () => Date.now() },
    document: { createElement: () => mkNode() },
    $: $sel, $$: () => [],
    window: { devicePixelRatio: 1 },
    ico: () => 'icone', clamp01: (v, a, b) => Math.min(b, Math.max(a, v)), suave: (a, b, v) => v,
    esforcosDe: () => [{ id: 'medium', desc: '' }, { id: 'high', desc: '' }, { id: 'max', desc: '' }],
    EF_PT: { medium: 'Médio', high: 'Alto', max: 'Máximo' },
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    requestAnimationFrame: () => 0, cancelAnimationFrame: () => {},
    setTimeout: () => 0,
    trocarEsforco: async () => true,
  };
  vm.createContext(c);
  vm.runInContext(func('barraEsforco'), c);

  const P = { el: mkNode(), effort: 'high', engine: 'claude' };
  const box = c.barraEsforco(P);
  const shell = box.nodes['.ef-shell'];
  assert.ok(shell, 'a régua nasceu');

  shell.dispatch('pointerdown', { pointerId: 1, clientX: 40, preventDefault() {}, stopPropagation() {} });
  assert.equal(shell.listenerCount('pointermove'), 1, 'primeiro dedo registrou o arrasto');

  // segundo dedo toca a régua SEM o primeiro ter soltado
  shell.dispatch('pointerdown', { pointerId: 2, clientX: 160, preventDefault() {}, stopPropagation() {} });
  assert.equal(shell.listenerCount('pointermove'), 1,
    'sem o conserto, o segundo pointerdown reseta "amostras" e registra um segundo par de listeners');
});

/* ================= R2-029 — trocar esforço/modelo no meio da resposta não pode matar sem perguntar ================= */
function trocarContext() {
  const names = ['trocarEsforco', 'confirmarCorte', 'agTrabalhando', 'desligarMotor', 'invalidarConversa'];
  const noop = () => {};
  const c = {
    console, Map, Set,
    window: { api: {} },
    EF_PT: { medium: 'Médio', high: 'Alto', max: 'Máximo' },
    nomeDoMotor: e => e, modeloPorCreditos: () => false,
    notices: [], avisoTemp: (P, t) => c.notices.push(t),
    lembrarEscolhaDaPasta: noop, savePanes: noop, mudarEscolhasCodex: async () => {},
    pararTrabalho: noop, limparPassos: noop, limparContinuar: noop, escondePerm: noop, setDot: noop,
    devolverFilaAoCampo: noop, clearTimeout: noop,
    confirm: () => true,
  };
  c.window.api.paneStop = async () => {};
  vm.createContext(c);
  vm.runInContext(names.map(n => func(n)).join('\n'), c);
  return c;
}
test('R2-029: trocar de esforço com o Claude ocupado e ele CANCELANDO não desliga nem muda o esforço', async () => {
  const c = trocarContext();
  const paneStopCalls = [];
  c.window.api.paneStop = async (a) => { paneStopCalls.push(a); };
  c.confirm = () => false; // "Continuar mesmo assim?" -> não
  const P = { id: 'p1', engine: 'claude', started: true, busy: true, effort: 'high' };
  const r = await c.trocarEsforco(P, 'max');
  assert.equal(r, false);
  assert.equal(P.effort, 'high', 'esforço não pode mudar se ele cancelou');
  assert.equal(paneStopCalls.length, 0, 'o trabalho em andamento não pode ser morto');
});
test('R2-029: confirmando a troca, desliga o motor e avisa que o trabalho parou', async () => {
  const c = trocarContext();
  const paneStopCalls = [];
  c.window.api.paneStop = async (a) => { paneStopCalls.push(a); };
  c.confirm = () => true;
  const P = { id: 'p1', engine: 'claude', started: true, busy: true, effort: 'high' };
  const r = await c.trocarEsforco(P, 'max');
  assert.equal(r, true);
  assert.equal(P.effort, 'max');
  assert.equal(paneStopCalls.length, 1);
  assert.ok(c.notices.some(n => /parou aqui/.test(n)), 'avisa que o trabalho em andamento parou');
});
test('R2-029: trocar de esforço sem nada rodando não pergunta nada', async () => {
  const c = trocarContext();
  let perguntou = false;
  c.confirm = () => { perguntou = true; return true; };
  const P = { id: 'p1', engine: 'claude', started: true, busy: false, effort: 'high' };
  await c.trocarEsforco(P, 'max');
  assert.equal(perguntou, false);
  assert.equal(P.effort, 'max');
});

/* ================= R2-028 — OCR não pode inserir texto de anexo já removido ================= */
test('R2-028: remover o anexo antes do OCR terminar não insere o texto extraído no campo', async () => {
  const names = ['extrairTexto'];
  const c = {
    console, String,
    notices: [], avisos: [],
    note: (P, t) => c.notices.push(t), avisoTemp: (P, t) => c.avisos.push(t),
    inserirNoInput: (P, t) => { c.inserido = t; },
    pintarAnexos: () => {},
    window: { api: {} },
  };
  vm.createContext(c);
  vm.runInContext(names.map(n => func(n)).join('\n'), c);

  const ack = deferred();
  c.window.api.ocrLer = () => ack.promise;
  const a = { path: '/tmp/img.png' };
  const P = { anexos: [a] };
  const bt = mkNode(); bt.isConnected = false;   // a barra de anexos já foi repintada (ficha some)

  const rodando = c.extrairTexto(P, a, bt);
  P.anexos = [];                                  // ele removeu o anexo ANTES do OCR terminar
  ack.resolve({ texto: 'texto que veio da imagem' });
  await rodando;

  assert.equal(c.inserido, undefined, 'o texto da imagem descartada não pode ir pro campo');
  assert.ok(c.avisos.some(t => /removida/.test(t)), 'avisa que a imagem sumiu antes de terminar de ler');
});
test('R2-028: caminho feliz (anexo ainda presente) continua inserindo o texto', async () => {
  const names = ['extrairTexto'];
  const c = {
    console, String,
    notices: [], avisos: [],
    note: (P, t) => c.notices.push(t), avisoTemp: (P, t) => c.avisos.push(t),
    inserirNoInput: (P, t) => { c.inserido = t; },
    pintarAnexos: () => {},
    window: { api: {} },
  };
  vm.createContext(c);
  vm.runInContext(names.map(n => func(n)).join('\n'), c);

  const a = { path: '/tmp/img.png' };
  const P = { anexos: [a] };
  const bt = mkNode(); bt.isConnected = true;
  c.window.api.ocrLer = async () => ({ texto: 'abc' });

  await c.extrairTexto(P, a, bt);
  assert.equal(c.inserido, 'abc');
});
