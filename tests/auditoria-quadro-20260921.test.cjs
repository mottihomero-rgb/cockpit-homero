'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function montar() {
  const listeners = new Set(), timers = new Map(); let seq = 0;
  const drawing = new Proxy({ measureText: txt => ({ width: String(txt).length * 7 }) }, { get: (o, k) => k in o ? o[k] : () => {} });
  function el() {
    return { style: { setProperty() {} }, classList: { add() {}, remove() {}, toggle() {} },
      textContent: '', children: [], appendChild(c) { this.children.push(c); }, querySelector: () => null,
      querySelectorAll: () => [], getBoundingClientRect: () => ({ width: 800, height: 600 }),
      getContext: () => drawing, addEventListener() {}, setAttribute() {} };
  }
  const painel = el(), toast = el(), canvases = [];
  const document = { documentElement: el(), body: { contains: () => true, appendChild() {} },
    getElementById: id => id === 'qdPainel' ? painel : null, querySelectorAll: () => [],
    createElement: kind => { const e = el(); e.toDataURL = () => 'data:image/png;base64,AAA'; if (kind === 'canvas') canvases.push(e); return e; },
    addEventListener(name) { listeners.add(name); }, removeEventListener(name) { listeners.delete(name); },
  };
  const window = { api: {} };
  const ctx = vm.createContext({ window, document, navigator: {}, console, requestAnimationFrame() {},
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    setTimeout(fn) { const id = ++seq; timers.set(id, fn); return id; }, clearTimeout: id => timers.delete(id),
  });
  const src = fs.readFileSync(path.join(__dirname, '../renderer/quadro.js'), 'utf8');
  // R2-023 acrescentou donoEh na linha de baixo: o "de" (busca) tem de acompanhar, senão o
  // replace vira no-op e window.Quadro fica sem Q/recuperarRascunho (o teste quebra por tabela)
  vm.runInContext(src.replace('window.Quadro = { abrir, fechar, aberto, donoEh };',
    'window.Quadro = { abrir, fechar, aberto, donoEh, Q, recuperarRascunho, copiarTexto, gerarPNG, marcarSujo, mandarProChat };'), ctx);
  const q = window.Quadro;
  q.Q.el = { sub: el(), canvas: el(), palco: el(), toast, mandar: el(), editor: el(), props: el(), ferramentas: el(), dica: el() };
  return { q, window, ctx, listeners, toast, canvases };
}
const cena = texto => ({ v: 1, formas: [{ id: 'a', tipo: 'retangulo', x: 0, y: 0, w: 160, h: 90, texto }], setas: [] });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

test('quadro: rascunho lento não substitui desenho feito depois de abrir', async () => {
  const h = montar(), d = deferred();
  h.q.Q.aberto = true; h.window.api.quadroRascunhoLer = () => d.promise;
  const recuperando = h.q.recuperarRascunho();
  h.q.Q.cena = cena('Desenho novo'); h.q.marcarSujo();
  d.resolve({ cena: cena('Rascunho antigo') }); await recuperando;
  assert.equal(h.q.Q.cena.formas[0].texto, 'Desenho novo');
});

test('quadro: fechar durante a recuperação não recupera conteúdo nem prende atalhos', async () => {
  const h = montar(), d = deferred();
  h.window.api.quadroRascunhoLer = () => d.promise;
  const abrindo = h.q.abrir({ engine: 'claude', cwd: '/teste' });
  h.q.fechar(); d.resolve({ cena: cena('Antigo') }); await abrindo;
  assert.equal(h.q.Q.cena.formas.length, 0);
  assert.equal(h.listeners.has('keydown'), false);
});

test('quadro: copiar espera o resultado e informa quando o navegador nega', async () => {
  const h = montar(), d = deferred();
  h.q.Q.cena = cena('Fluxo');
  h.ctx.navigator.clipboard = { writeText: () => d.promise.then(() => { throw new Error('negado'); }) };
  const copiando = h.q.copiarTexto();
  assert.equal(h.toast.children.length, 0, 'não anuncia sucesso antes de copiar');
  d.resolve(); await copiando;
  assert.match(h.toast.children.at(-1).textContent, /Não deu para copiar/);
});

test('quadro: exportar desenho muito espalhado respeita teto de 2160 pixels', () => {
  const h = montar(); h.q.Q.cena = cena('Fluxo');
  h.q.Q.cena.formas.push({ ...h.q.Q.cena.formas[0], id: 'b', x: 30000 });
  h.q.gerarPNG();
  assert.ok(h.canvases.length > 0);
  for (const c of h.canvases) assert.ok(c.width <= 2160 && c.height <= 2160, `${c.width}x${c.height}`);
});

test('quadro: chat fechado enquanto PNG salva não recebe anexo nem texto', async () => {
  const h = montar(), d = deferred(); const acoes = [];
  h.q.Q.aberto = true; h.q.Q.cena = cena('Fluxo'); h.q.Q.P = { el: {}, engine: 'claude', cwd: '/teste' };
  h.window.api.quadroSalvar = () => d.promise;
  h.window.abrirQuadroAnexar = () => { acoes.push('anexo'); };
  h.window.abrirQuadroTexto = () => { acoes.push('texto'); };
  const enviando = h.q.mandarProChat();
  h.q.fechar(); d.resolve({ png: '/teste/fluxo.png' }); await enviando;
  assert.deepEqual(acoes, []);
});

test('quadro: fechar e reabrir enquanto marca o envio não apaga a marca no disco', async () => {
  const h = montar(), d = deferred(), writes = [];
  const P = { el: {}, engine: 'claude', cwd: '/teste' };
  h.q.Q.aberto = true; h.q.Q.cena = cena('Enviado'); h.q.Q.P = P;
  h.window.api.quadroSalvar = async () => ({ png: '/teste/fluxo.png' });
  h.window.abrirQuadroAnexar = async () => {};
  h.window.abrirQuadroTexto = () => {};
  h.window.api.quadroRascunhoGravar = async value => { writes.push(value); return d.promise; };
  const enviando = h.q.mandarProChat();
  await new Promise(r => setImmediate(r));
  assert.equal(writes.length, 1); assert.ok(writes[0].enviadoEm);
  h.q.fechar(); await h.q.abrir(P);
  d.resolve({ ok: true }); await enviando;
  await new Promise(r => setImmediate(r));
  assert.equal(writes.length, 1, 'fechar não regrava a cena sem carimbo');
  assert.equal(h.q.aberto(), true, 'resposta antiga não fecha o quadro reaberto');
});

test('quadro: edição durante anexação não marca desenho novo como enviado', async () => {
  const h = montar(), d = deferred(), textos = [], writes = [];
  h.q.Q.aberto = true; h.q.Q.cena = cena('A'); h.q.Q.P = { el: {}, engine: 'claude', cwd: '/teste' };
  h.window.api.quadroSalvar = async () => ({ png: '/teste/fluxo.png' });
  h.window.abrirQuadroAnexar = () => d.promise;
  h.window.abrirQuadroTexto = (_p, texto) => textos.push(texto);
  h.window.api.quadroRascunhoGravar = async value => { writes.push(value); return { ok: true }; };
  const enviando = h.q.mandarProChat();
  await new Promise(r => setImmediate(r));
  h.q.Q.cena = cena('B'); h.q.marcarSujo(); d.resolve(); await enviando;
  assert.equal(h.q.Q.enviado, false);
  assert.equal(h.q.aberto(), true);
  assert.deepEqual(textos, []); assert.deepEqual(writes, []);
});

test('quadro: erro de disco ao marcar envio não é tratado como rascunho salvo', async () => {
  const h = montar();
  h.q.Q.aberto = true; h.q.Q.cena = cena('A'); h.q.Q.P = { el: {}, engine: 'claude', cwd: '/teste' };
  h.window.api.quadroSalvar = async () => ({ png: '/teste/fluxo.png' });
  h.window.abrirQuadroAnexar = async () => {};
  h.window.abrirQuadroTexto = () => {};
  h.window.api.quadroRascunhoGravar = async () => ({ error: 'disco cheio' });
  await h.q.mandarProChat();
  assert.equal(h.q.Q.rascunho.ultimo, '');
  assert.equal(h.q.aberto(), true);
  assert.match(h.toast.children.at(-1).textContent, /não consegui salvar o rascunho/);
});
