'use strict';
/* Guarda dos defeitos da rodada 3, lote "app" 3 (ver contexto/CONTEXTO.md para o padrao):
   R3-035 segurar a seta do Esforço empilhava trocarEsforco()/confirm() em fila, sem trava.
   R3-006 aviso de "vai perder o trabalho" mentia ao trocar esforço/modelo do Codex no meio do
          turno (mudarEscolhasCodex nunca derruba o turno, so o Claude em curso de fato mata).
   R3-033 resposta atrasada de codexModels() reescrevia por cima da janelinha que ja tinha virado
          outra coisa (terminal, foto, conta...).
   R3-008 reabrirUltimoFechado sobrescrevia o worktree de um painel JA ABERTO e em uso.
   R3-024 itens de menu "terminal"/"terminal na VPS" apareciam no iPhone, onde sempre falham.
   Mesmo padrao de extracao por regex/brace-counting + vm que os lotes anteriores usam. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const raiz = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(raiz, 'renderer/app.js'), 'utf8');

// recorta "function nome(...) {...}" (ou "async function nome(...) {...}") contando chaves
function pegar(nome, src = source) {
  const re = new RegExp('^(?:async )?function ' + nome + '\\(', 'm');
  const m = re.exec(src);
  assert.ok(m, 'a funcao ' + nome + ' tem de existir no app.js');
  const start = m.index;
  const abre = src.indexOf('{', start);
  let n = 0, i = abre;
  for (; i < src.length; i++) {
    if (src[i] === '{') n++;
    else if (src[i] === '}' && --n === 0) { i++; break; }
  }
  return src.slice(start, i);
}
// recorta "const NOME = ...;" de uma linha so
function pegarConst(nome, src = source) {
  const re = new RegExp('^const ' + nome + ' = .*;$', 'm');
  const m = re.exec(src);
  assert.ok(m, 'o const ' + nome + ' tem de existir no app.js');
  return m[0];
}
function trecho(re, rotulo) {
  const m = re.exec(source);
  assert.ok(m, rotulo + ' existe em app.js');
  return m[0];
}
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
function classes(...initial) {
  const set = new Set(initial);
  return { add: (...xs) => xs.forEach(x => set.add(x)), remove: (...xs) => xs.forEach(x => set.delete(x)),
    contains: x => set.has(x), toggle: (x, yes) => (yes === undefined ? !set.has(x) : yes) ? set.add(x) : set.delete(x) };
}
// elemento fake com addEventListener/dispatch de verdade e $ que "nasce" sozinho, igual
// tests/r2-app-2.test.cjs (mesmo padrao usado pra testar barraEsforco).
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
async function flush(n = 3) { for (let i = 0; i < n; i++) await Promise.resolve(); }

/* ================= R3-035 — segurar a seta do Esforço não pode empilhar trocarEsforco() ================= */
test('R3-035: 3 keydown seguidos na seta do Esforço (SO em repetição) só chamam trocarEsforco() 1 vez até o 1º terminar', async () => {
  const chamadas = [];
  const ack = deferred();
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
    trocarEsforco: (P, id) => { chamadas.push(id); return ack.promise; },
  };
  vm.createContext(c);
  vm.runInContext(pegar('barraEsforco'), c);

  const P = { el: mkNode(), effort: 'medium', engine: 'claude' };
  const box = c.barraEsforco(P);
  const thumb = box.nodes['.ef-thumb'];
  assert.ok(thumb, 'o puxador nasceu');

  // o SO manda os keydown da tecla segurada em fila, ANTES do 1o confirm()/trocarEsforco resolver
  thumb.dispatch('keydown', { key: 'ArrowRight', preventDefault() {} });
  thumb.dispatch('keydown', { key: 'ArrowRight', preventDefault() {} });
  thumb.dispatch('keydown', { key: 'ArrowRight', preventDefault() {} });

  assert.equal(chamadas.length, 1,
    'sem a trava de reentrância, cada keydown chamaria trocarEsforco()/confirm() na hora, empilhando os diálogos');

  ack.resolve(true);
  await flush();

  // depois do primeiro terminar, a trava solta e o próximo keydown volta a funcionar
  thumb.dispatch('keydown', { key: 'ArrowRight', preventDefault() {} });
  assert.equal(chamadas.length, 2, 'depois de resolver, o puxador volta a responder ao teclado normalmente');
});

/* ================= R3-006 — aviso de "perder o trabalho" não pode mentir pro Codex ================= */
function trocarContext(extra = {}) {
  const names = ['trocarEsforco', 'confirmarCorte', 'agTrabalhando', 'desligarMotor', 'invalidarConversa'];
  const noop = () => {};
  const c = {
    console, Map, Set,
    window: { api: {} },
    EF_PT: { medium: 'Médio', high: 'Alto', max: 'Máximo' },
    nomeDoMotor: e => e, modeloPorCreditos: () => false,
    notices: [], avisoTemp: (P, t) => c.notices.push(t),
    lembrarEscolhaDaPasta: noop, savePanes: noop,
    pararTrabalho: noop, limparPassos: noop, limparContinuar: noop, escondePerm: noop, setDot: noop,
    devolverFilaAoCampo: noop, clearTimeout: noop,
    confirm: () => true,
    ...extra,
  };
  c.window.api.paneStop = async () => {};
  vm.createContext(c);
  vm.runInContext(names.map(n => pegar(n)).join('\n'), c);
  return c;
}
test('R3-006: Codex ocupado troca de esforço SEM perguntar (mudarEscolhasCodex nunca derruba o turno)', async () => {
  const confirmChamadas = [];
  const mudarChamadas = [];
  const c = trocarContext({
    confirm: () => { confirmChamadas.push(1); return false; }, // se chamasse e respondesse "não", cancelaria à toa
    mudarEscolhasCodex: async (P, patch) => { mudarChamadas.push(patch); },
  });
  const P = { id: 'p1', engine: 'codex', started: true, busy: true, effort: 'high', model: 'sol-6' };
  const r = await c.trocarEsforco(P, 'max');

  assert.equal(confirmChamadas.length, 0, 'Codex por mudarEscolhasCodex não perde trabalho: não pode perguntar');
  assert.notEqual(r, false, 'não pode devolver false por causa de um confirm() que nem deveria rodar');
  assert.equal(P.effort, 'max', 'a troca de fato precisa acontecer');
  assert.equal(mudarChamadas.length, 1, 'e precisa seguir por mudarEscolhasCodex');
});
test('R3-006 (regressão): Claude em curso continua perguntando antes de trocar de esforço', async () => {
  const confirmChamadas = [];
  const c = trocarContext({
    confirm: () => { confirmChamadas.push(1); return false; },
    mudarEscolhasCodex: async () => { throw new Error('não deveria chamar mudarEscolhasCodex pro Claude'); },
  });
  const P = { id: 'p1', engine: 'claude', started: true, busy: true, effort: 'high' };
  const r = await c.trocarEsforco(P, 'max');

  assert.equal(confirmChamadas.length, 1, 'Claude em curso realmente perde o trabalho: o aviso continua valendo');
  assert.equal(r, false);
  assert.equal(P.effort, 'high', 'cancelou no confirm: o esforço não pode mudar');
});

/* ================= R3-033 — resposta atrasada de codexModels() não pode repintar por cima ================= */
test('R3-033: resposta atrasada de codexModels() não repinta se a janelinha virou outra superfície (terminal etc)', async () => {
  const re = /if \(P\.engine === 'codex' && !MODELOS_CODEX\) \{[\s\S]*?\n {2}\}/;
  const snippet = trecho(re, 'bloco de repintura atrasada de MODELOS_CODEX em menuModelos');
  const ack = deferred();
  const c = {
    console,
    window: { api: { codexModels: () => ack.promise } },
    traduzCodex: (ms) => ms.map(m => ({ id: m.id, nome: m.id })),
  };
  vm.createContext(c);
  vm.runInContext(
    'var MODELOS_CODEX = null;\n'
    + 'async function testar(P, modal, geracao, pintar, fillModels) {\n  ' + snippet + '\n}',
    c
  );

  const P = { engine: 'codex' };
  const modal = { classList: classes('como-menu'), dataset: { codexSurface: 'menu', geracaoMenu: 'g1' } };
  let pintarCalls = 0, fillCalls = 0;
  const pintar = () => { pintarCalls++; };
  const fillModels = () => { fillCalls++; };

  const rodando = c.testar(P, modal, 'g1', pintar, fillModels);
  // ainda pendente: ele fechou o menu de Modelo e abriu o terminal no MESMO painel
  modal.classList.remove('como-menu');
  modal.dataset.codexSurface = 'terminal';

  ack.resolve([{ id: 'sol-6' }]);
  await rodando;

  assert.equal(pintarCalls, 0, 'sem o conserto, pintar() reescreve o menu de Modelo por cima da tela do terminal');
  assert.equal(fillCalls, 0);
});
test('R3-033 (regressão): resposta chega e o menu de Modelo ainda está aberto → repinta normalmente', async () => {
  const re = /if \(P\.engine === 'codex' && !MODELOS_CODEX\) \{[\s\S]*?\n {2}\}/;
  const snippet = trecho(re, 'bloco de repintura atrasada de MODELOS_CODEX em menuModelos');
  const ack = deferred();
  const c = {
    console,
    window: { api: { codexModels: () => ack.promise } },
    traduzCodex: (ms) => ms.map(m => ({ id: m.id, nome: m.id })),
  };
  vm.createContext(c);
  vm.runInContext(
    'var MODELOS_CODEX = null;\n'
    + 'async function testar(P, modal, geracao, pintar, fillModels) {\n  ' + snippet + '\n}',
    c
  );

  const P = { engine: 'codex' };
  const modal = { classList: classes('como-menu'), dataset: { codexSurface: 'menu', geracaoMenu: 'g1' } };
  let pintarCalls = 0, fillCalls = 0;
  const pintar = () => { pintarCalls++; };
  const fillModels = () => { fillCalls++; };

  ack.resolve([{ id: 'sol-6' }]);
  await c.testar(P, modal, 'g1', pintar, fillModels);

  assert.equal(pintarCalls, 1, 'caminho feliz: nada mudou, então repinta com a lista de modelos que chegou');
  assert.equal(fillCalls, 1);
});

/* ================= R3-008 — reabrir não pode sobrescrever painel já aberto e em uso ================= */
function contextoFechados(extra = {}) {
  const ctx = { console, fechadosRecentes: [], focusPane: null, abas: new Map(), abaAtiva: null, window: { api: {} } };
  vm.createContext(ctx);
  ctx.avisoTemp = () => {};
  ctx.newPane = () => null;
  ctx.setFocus = () => {};
  const chamadas = { openSession: null, mostrarPastaNoPainel: null };
  ctx.mostrarPastaNoPainel = (P) => { chamadas.mostrarPastaNoPainel = P; };
  // por padrão simula o ramo que CRIA um painel de verdade (o openSession real marca isso)
  ctx.openSession = async (s) => { chamadas.openSession = s; return { id: 'novoPainel', worktree: '', cwd: s.cwd, _painelNovoDeAbertura: true }; };
  Object.assign(ctx, extra);
  vm.runInContext(
    pegarConst('NA_VPS') + '\n'
    + pegarConst('fechadosRecentes') + '\n'
    + pegar('guardarFechado') + '\n'
    + pegar('reabrirUltimoFechado') + '\n'
    + 'this.fechadosRecentes = fechadosRecentes; this.guardarFechado = guardarFechado; this.reabrirUltimoFechado = reabrirUltimoFechado;',
    ctx);
  ctx._chamadas = chamadas;
  return ctx;
}
test('R3-008: painel que já estava aberto e em uso não tem o worktree sobrescrito em silêncio', async () => {
  const avisos = [];
  const ctx = contextoFechados({ avisoTemp: (P, t) => avisos.push(t) });
  // simula o ramo "já está aberta" de openSession: devolve um painel EXISTENTE, sem a marca de nascer agora
  ctx.openSession = async (s) => { ctx._chamadas.openSession = s; return { id: 'painelJaAberto', worktree: '' }; };
  ctx.fechadosRecentes.push({ resumeId: 'idX', worktree: 'branch-x', cwd: '/projeto', engine: 'codex', arquivo: 'a.jsonl', titulo: 't' });

  await ctx.reabrirUltimoFechado();

  assert.equal(ctx._chamadas.mostrarPastaNoPainel, null,
    'hoje, sem o conserto, isto chama mostrarPastaNoPainel e sobrescreve P.worktree do painel que já estava em uso');
  assert.ok(avisos.length, 'tem que avisar que o worktree salvo não foi aplicado');
});
test('R3-008 (regressão): painel recém-criado continua recebendo o worktree salvo normalmente', async () => {
  const ctx = contextoFechados();
  ctx.fechadosRecentes.push({ resumeId: 'idY', worktree: 'branch-y', cwd: '/projeto', engine: 'claude', arquivo: '', titulo: 't' });

  await ctx.reabrirUltimoFechado();

  assert.ok(ctx._chamadas.mostrarPastaNoPainel, 'painel recém-criado continua recebendo o worktree');
  assert.equal(ctx._chamadas.mostrarPastaNoPainel.worktree, 'branch-y');
});

/* ================= R3-024 — "terminal" e "terminal na VPS" não podem aparecer no iPhone =================
   (redesenho 26/09: os nomes ganharam inicial maiúscula, como os outros itens do menu /) */
test('R3-024: os itens de terminal somem do menu quando window.SEM_ELECTRON (iPhone)', () => {
  const re1 = /\.\.\.\(window\.SEM_ELECTRON \? \[\] : \[\{ sec: 'Painel', ic: 'terminal', nome: 'Terminal',[\s\S]*?\}\]\),/;
  const re2 = /\.\.\.\(window\.SEM_ELECTRON \|\| !NA_VPS\(P\.cwd\) \? \[\] : \[\{ sec: 'Painel', ic: 'terminal', nome: 'Terminal na VPS',[\s\S]*?\}\]\),/;
  const linha1 = trecho(re1, "item 'terminal' do menu do painel");
  const linha2 = trecho(re2, "item 'terminal na VPS' do menu do painel");

  const c = { window: {}, NA_VPS: () => true, janelaTerminal: () => {}, abrirTerminalVps: () => {}, nomePasta: () => 'pasta' };
  vm.createContext(c);

  // no Mac (SEM_ELECTRON=false): os dois itens aparecem, inclusive na VPS
  c.window.SEM_ELECTRON = false;
  const P1 = { cwd: 'vps:/projeto' };
  const noVps = vm.runInContext('(function(P){ const acoes = [' + linha1 + linha2 + ']; return acoes; })', c)(P1);
  assert.equal(noVps.length, 2, 'no Mac, com painel na VPS, os dois itens de terminal aparecem (hoje)');

  // no iPhone (SEM_ELECTRON=true): NENHUM dos dois pode aparecer, nem no painel da VPS
  c.window.SEM_ELECTRON = true;
  const P2 = { cwd: 'vps:/projeto' };
  const noIphone = vm.runInContext('(function(P){ const acoes = [' + linha1 + linha2 + ']; return acoes; })', c)(P2);
  assert.equal(noIphone.length, 0,
    'sem o conserto, os dois itens de terminal continuam aparecendo no iPhone e term:run falha sempre');
});
