'use strict';
// Guarda da rodada 1, faixa cruzada (lote 3).
// R1-029-css: a tarja de uso (.p-uso) tem span .uso-velho ("dado de Xh atrás") sem estilo
//   próprio; falta a regra de opacidade discreta, no mesmo padrão de .uso-zera.
// R1-030: o mock de renderer (auditoria-renderer-20260921.test.cjs) precisa de
//   'marcarAbertas' como noop, senão openSession() quebra com ReferenceError porque
//   chama marcarAbertas() de verdade (conserto de outro lote) e o nome não existe na VM.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const cssSource = fs.readFileSync(path.join(__dirname, '../renderer/style.css'), 'utf8');
const testeRendererSource = fs.readFileSync(
  path.join(__dirname, '../tests/auditoria-renderer-20260921.test.cjs'), 'utf8');
const appSource = fs.readFileSync(path.join(__dirname, '../renderer/app.js'), 'utf8');

test('R1-029-css: .p-uso .uso-velho tem regra de opacidade, igual ao .uso-zera', () => {
  // a regra do "zera" é a referência do padrão pedido
  assert.match(cssSource, /\.p-uso \.uso-zera\{opacity:\.75\}/, 'referência .uso-zera ainda existe com esse padrão');
  assert.match(cssSource, /\.p-uso \.uso-velho\{opacity:[^}]+\}/,
    'falta regra CSS pra .p-uso .uso-velho (aviso "dado de Xh atrás" sem estilo discreto)');
});

test('R1-030: openSession() de fato chama marcarAbertas() (conserto de outro lote ainda no ar)', () => {
  // confirma a causa raiz que o teste de mock precisa cobrir: se isso um dia sumir,
  // o teste abaixo perde o sentido (mas não quebra por engano).
  assert.match(appSource, /marcarAbertas\(\);\s*\/\/ repinta a borda de "aberta"/);
});

test('R1-030: o mock de context() em auditoria-renderer-20260921.test.cjs cobre marcarAbertas como noop', () => {
  // sem isso, todo teste que chama openSession() (historyContext) quebra com
  // "ReferenceError: marcarAbertas is not defined" dentro da VM do teste.
  const noopListMatch = testeRendererSource.match(
    /for \(const name of \[([\s\S]*?)\]\) c\[name\] = noop;/);
  assert.ok(noopListMatch, 'achei o for-loop que registra os noops do mock');
  assert.match(noopListMatch[1], /'marcarAbertas'/,
    "'marcarAbertas' precisa estar na lista de noop do mock (context()), senão openSession() quebra");
});
