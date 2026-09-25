'use strict';
// Testes de guarda do lote 1 / rodada 1 (faixa "quadro"): R1-035, R1-036, R1-034.
// Segue o mesmo padrão de tests/auditoria-quadro-20260921.test.cjs (roda o quadro.js
// de verdade dentro de uma vm com DOM/API falsos).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function montar() {
  let seq = 0;
  const timerLog = []; // {fn, ms} na ordem em que foram agendados, pra medir o backoff
  const vivos = new Set();
  const drawing = new Proxy({ measureText: txt => ({ width: String(txt).length * 7 }) }, { get: (o, k) => k in o ? o[k] : () => {} });
  function el() {
    return { style: { setProperty() {} }, classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      textContent: '', value: '', children: [], appendChild(c) { this.children.push(c); }, querySelector: () => null,
      querySelectorAll: () => [], getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
      getContext: () => drawing, addEventListener() {}, setAttribute() {}, setPointerCapture() {},
      focus() {}, select() {}, setSelectionRange() {} };
  }
  const painel = el(), toast = el(), canvases = [];
  const document = { documentElement: el(), body: { contains: () => true, appendChild() {} },
    getElementById: id => id === 'qdPainel' ? painel : null, querySelectorAll: () => [],
    createElement: kind => { const e = el(); e.toDataURL = () => 'data:image/png;base64,AAA'; if (kind === 'canvas') canvases.push(e); return e; },
    addEventListener() {}, removeEventListener() {},
  };
  const window = { api: {} };
  const ctx = vm.createContext({ window, document, navigator: {}, console, requestAnimationFrame() {},
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    setTimeout(fn, ms) { const rec = { fn, ms, id: ++seq }; timerLog.push(rec); vivos.add(rec.id); return rec.id; },
    clearTimeout(id) { vivos.delete(id); },
  });
  const src = fs.readFileSync(path.join(__dirname, '../renderer/quadro.js'), 'utf8');
  vm.runInContext(src.replace('window.Quadro = { abrir, fechar, aberto };',
    'window.Quadro = { abrir, fechar, aberto, Q, recuperarRascunho, vigiarClaude, aoDescer, aoSubir, detectarDuploToque };'), ctx);
  const q = window.Quadro;
  q.Q.el = { sub: el(), canvas: el(), palco: el(), toast, mandar: el(), editor: el(), props: el(), ferramentas: el(), dica: el() };
  return { q, window, ctx, timerLog, canvases };
}

const cena = texto => ({ v: 1, formas: [{ id: 'a', tipo: 'retangulo', x: 0, y: 0, w: 160, h: 90, texto }], setas: [] });
const toque = (id, x, y) => ({ pointerId: id, pointerType: 'touch', clientX: x, clientY: y, preventDefault() {}, altKey: false, shiftKey: false, button: 0 });

// R1-035: soltar o ultimo dedo de uma pinca nao pode contar como toque de duplo-toque.
test('quadro: pinca repetida no mesmo ponto nao abre caixa de texto sozinha', () => {
  const h = montar();
  const pinca = (baseId, x, y) => {
    h.q.aoDescer(toque(baseId, x, y));
    h.q.aoDescer(toque(baseId + 1, x + 10, y));
    h.q.aoSubir(toque(baseId, x, y));
    h.q.aoSubir(toque(baseId + 1, x + 10, y));
  };
  pinca(1, 100, 100);      // 1a pinca: solta os 2 dedos
  pinca(3, 100, 100);      // 2a pinca, logo em seguida, no mesmo ponto (ajuste fino de zoom)
  assert.equal(h.q.Q.cena.formas.length, 0, 'soltar a pinca duas vezes seguidas nao pode criar forma nenhuma');
  assert.equal(h.q.Q.editando, null, 'o editor de texto nao pode abrir sozinho');
});

// R1-036: sem novidade no rascunho, o intervalo do vigia tem que crescer (2s -> 5s -> ...).
test('quadro: vigia do Claude aumenta o intervalo quando nao ha novidade', async () => {
  const h = montar();
  h.q.Q.aberto = true;
  h.window.api.quadroRascunhoLer = async () => ({ cena: { v: 1, formas: [], setas: [] } }); // sempre vazio: nunca ha novidade
  h.q.vigiarClaude();
  assert.equal(h.timerLog[0].ms, 2000, 'o primeiro tick continua em 2s');
  let atual = h.timerLog[0];
  for (let i = 0; i < 5; i++) {
    await atual.fn();
    atual = h.timerLog[h.timerLog.length - 1];
  }
  assert.ok(atual.ms > 2000, `depois de 5 ticks sem novidade o intervalo devia ter crescido (veio ${atual.ms})`);
});

// R1-034: Limpar (ou "Começar do zero") nao pode ser desfeito pelo vigia relendo um
// desenho do Claude que ja foi visto, mesmo com a tela vazia.
test('quadro: Limpar nao e desfeito pelo vigia relendo o desenho ja visto do Claude', async () => {
  const h = montar();
  h.q.Q.aberto = true;
  h.q.Q.claude.visto = 7;                         // esse desenho do Claude ja apareceu na tela
  h.q.Q.cena = { v: 1, formas: [], setas: [] };    // Homero clicou em Limpar: tela vazia
  h.window.api.quadroRascunhoLer = async () => ({
    cena: { v: 1, formas: [{ id: 'a', tipo: 'retangulo', x: 0, y: 0, w: 160, h: 90, texto: 'Antigo' }], setas: [], doClaude: 7 },
  });
  await h.q.recuperarRascunho();
  assert.equal(h.q.Q.cena.formas.length, 0, 'o Limpar nao pode ser desfeito sozinho pelo vigia');
});

// Guarda de regressao: rascunho PROPRIO (sem Claude) ainda tem que voltar com a tela vazia
// (o risco do conserto, apontado no achado, e quebrar essa recuperacao).
test('quadro: rascunho proprio ainda volta quando a tela esta vazia', async () => {
  const h = montar();
  h.q.Q.aberto = true;
  h.q.Q.claude.visto = 0;
  h.q.Q.cena = { v: 1, formas: [], setas: [] };
  h.window.api.quadroRascunhoLer = async () => ({ cena: cena('Meu rascunho') });
  await h.q.recuperarRascunho();
  assert.equal(h.q.Q.cena.formas.length, 1, 'rascunho proprio (doClaude=0) tem que voltar com a tela vazia');
});
