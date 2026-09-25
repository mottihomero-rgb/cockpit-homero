'use strict';
// Guarda do R1-021: a barra de esforço tinha que responder a toque no iPhone,
// não só a mouse. Segue o padrão de tests/auditoria-renderer-20260921.test.cjs
// (extrai o trecho por regex, roda em vm com stubs de DOM).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const appSource = fs.readFileSync(path.join(__dirname, '../renderer/app.js'), 'utf8');
const cssSource = fs.readFileSync(path.join(__dirname, '../renderer/style.css'), 'utf8');

// Extrai só o pedaço que registra os listeners de arrasto da régua (comecar/mover/soltar),
// de "const valorDoX" até a linha que liga o pointerdown no shell.
function trechoArrasto() {
  const ini = appSource.indexOf('const valorDoX = (clientX) => {');
  assert.ok(ini >= 0, 'achou o início do trecho de arrasto da régua de esforço');
  const marcaFim = "shell.addEventListener('pointerdown', comecar);";
  const posFim = appSource.indexOf(marcaFim, ini);
  assert.ok(posFim >= 0, 'achou o fim do trecho (registro do pointerdown no shell)');
  return appSource.slice(ini, posFim + marcaFim.length);
}

function rodarTrecho() {
  const tipos = [];
  const shell = {
    _handlers: {},
    getBoundingClientRect() { return { left: 0, width: 100 }; },
    addEventListener(tipo, fn) { tipos.push(tipo); shell._handlers[tipo] = fn; },
    removeEventListener() {},
    setPointerCapture() {},
    releasePointerCapture() {},
  };
  const box = { classList: { add() {}, remove() {} } };
  const c = {
    console,
    shell, box,
    thumb: { setAttribute() {} },
    ULT: 4,
    valor: 0,
    amostras: [],
    arrastando: false,
    frameMola: 0,
    clamp01: (v, min, max) => Math.min(max, Math.max(min, v)),
    ima: (v) => v,
    pintar: () => {},
    encaixar: () => {},
    cancelAnimationFrame: () => {},
    performance: { now: () => 0 },
  };
  vm.createContext(c);
  vm.runInContext(trechoArrasto(), c);
  return { c, tipos, shell };
}

test('régua de esforço escuta pointerdown (funciona com dedo no iPhone), não só mousedown', () => {
  const { tipos } = rodarTrecho();
  assert.ok(tipos.includes('pointerdown'), 'shell.addEventListener deveria registrar pointerdown');
  assert.ok(!tipos.includes('mousedown'), 'mousedown sozinho não cobre toque; devia ter virado pointerdown');
});

test('pointerdown na régua liga pointermove/pointerup (o arrasto continua com o dedo)', () => {
  const { shell } = rodarTrecho();
  const fakeEvent = { clientX: 10, pointerId: 1, preventDefault() {}, stopPropagation() {} };
  shell._handlers['pointerdown'](fakeEvent);
  assert.ok(shell._handlers['pointermove'], 'comecar() devia ligar pointermove pra seguir o dedo/mouse');
  assert.ok(shell._handlers['pointerup'], 'comecar() devia ligar pointerup pra soltar o arrasto');
});

test('CSS da régua de esforço trava o gesto de rolagem da tela (touch-action:none)', () => {
  const bloco = /\.ef-shell\{[^}]*\}/.exec(cssSource);
  assert.ok(bloco, 'achou a regra .ef-shell no style.css');
  assert.ok(
    cssSource.includes('touch-action:none') || /touch-action\s*:\s*none/.test(cssSource),
    'style.css precisa de touch-action:none pra régua não virar scroll no celular'
  );
});
