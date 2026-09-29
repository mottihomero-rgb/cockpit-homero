'use strict';
/* Toda conversa nova: Codex no Sol, Claude no Opus 5.5 sem o 1M, os dois no Alto
   (pedido do Homero em 15/09/2026). Este teste segura a regra e confere que o modelo do
   Claude existe na lista do app, senao o fillModels cairia calado em outro. */
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
vm.runInNewContext(trecho('const EF_NOVO', "PADRAO_NOVO[eng].effort) || EF_NOVO;")
  + '\n' + trecho('let MODELOS_CLAUDE = [', '\n];')
  + '\nlet MODELOS_CODEX = null;'
  + '\nthis.r = { PADRAO_NOVO, MODELOS_CLAUDE, modeloNovo, esforcoNovo };', ctx);
const { PADRAO_NOVO, MODELOS_CLAUDE, modeloNovo, esforcoNovo } = ctx.r;

test('Codex nasce no Sol 6, no Alto', () => {
  assert.equal(modeloNovo('codex'), 'gpt-6-sol');
  assert.equal(esforcoNovo('codex'), 'high');
});

test('Claude nasce no Opus 5.5 sem o 1M, no Alto, e o modelo existe na lista', () => {
  assert.equal(modeloNovo('claude'), 'claude-opus-5-5');
  assert.doesNotMatch(modeloNovo('claude'), /\[1m\]/);
  assert.equal(esforcoNovo('claude'), 'high');
  const m = MODELOS_CLAUDE.find((x) => x.id === PADRAO_NOVO.claude.model);
  assert.ok(m, 'Opus 5.5 sumiu da lista do Claude');
  assert.ok(m.efforts.includes('high'));
});

test('as novas conversas usam a regra nos 3 caminhos', () => {
  assert.match(src, /model: opts\.model \|\| modeloNovo\(motorDoPainel\)/);          // aba e chat novos
  assert.match(src, /P\.model = modeloNovo\(engine\); P\.effort = esforcoNovo\(engine\)/); // "nova conversa"
  assert.match(src, /P\.model = modeloNovo\(novo\); P\.effort = esforcoNovo\(novo\)/);     // troca de motor
});

test('a escolha guardada por pasta nao passa por cima no Claude e no Codex', () => {
  assert.match(src, /function aplicarEscolhaDaPasta\(P\) \{[\s\S]{0,400}if \(PADRAO_NOVO\[P\.engine\]\) return false;/);
});
