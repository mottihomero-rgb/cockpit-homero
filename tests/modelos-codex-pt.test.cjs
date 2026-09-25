'use strict';
/* Os modelos do Codex chegam em ingles ("GPT-6-Astra", "Frontier intelligence...").
   O app traduz nome e descricao. Este teste segura duas coisas: a geracao nova (Astra 6,
   Sol 6, Luna 6) tem nome em portugues, e modelo desconhecido NAO some da lista. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const src = fs.readFileSync(path.resolve(__dirname, '../renderer/app.js'), 'utf8');
function trecho(inicio, fim) {
  const i = src.indexOf(inicio), f = src.indexOf(fim, i);
  assert.ok(i >= 0 && f > i, 'trecho não encontrado: ' + inicio);
  return src.slice(i, f + fim.length);
}
const ctx = {};
vm.runInNewContext(trecho('const CODEX_PT = {', '});')
  + '\nthis.r = { CODEX_PT, traduzCodex };', ctx);
const { CODEX_PT, traduzCodex } = ctx.r;

test('Astra 6, Sol 6 e Luna 6 aparecem em português', () => {
  const vindo = [
    { id: 'gpt-6-astra', nome: 'GPT-6-Astra', desc: 'Frontier intelligence for the most demanding work.' },
    { id: 'gpt-6-sol', nome: 'GPT-6-Sol', desc: 'Workhorse model for coding and everyday work.' },
    { id: 'gpt-6-luna', nome: 'GPT-6-Luna', desc: 'Fast and affordable model for easier tasks.' },
  ];
  const pt = traduzCodex(vindo);
  assert.deepEqual(pt.map(m => m.nome), ['Astra 6', 'Sol 6', 'Luna 6']);
  for (const m of pt) assert.doesNotMatch(m.desc, /model|work|task/i);
});

test('modelo que o mapa não conhece continua na lista, com o nome do Codex', () => {
  const pt = traduzCodex([{ id: 'gpt-7-novo', nome: 'GPT-7-Novo', desc: 'x' }]);
  assert.equal(pt.length, 1);
  assert.equal(pt[0].nome, 'GPT-7-Novo');
});

test('o padrão do Codex (gpt-5.6-sol) tem tradução', () => {
  assert.ok(CODEX_PT['gpt-5.6-sol']);
});

test('lista vazia ou nula não quebra', () => {
  assert.equal(traduzCodex(null).length, 0);
  assert.equal(traduzCodex([]).length, 0);
});
