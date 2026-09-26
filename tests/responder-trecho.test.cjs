'use strict';
/* 26/09: selecionar um trecho da resposta, "Responder", e a próxima mensagem sai presa a ele. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const app = fs.readFileSync(path.join(__dirname, '..', 'renderer/app.js'), 'utf8');
const nomes = require('../nomes-conversa.js');
function pegar(nome) {
  const m = new RegExp('^function ' + nome + '\\(', 'm').exec(app);
  let n = 0, i = app.indexOf('{', m.index);
  for (; i < app.length; i++) { if (app[i] === '{') n++; else if (app[i] === '}' && --n === 0) { i++; break; } }
  return app.slice(m.index, i);
}
const ctx = {}; vm.createContext(ctx);
vm.runInContext(app.match(/^const CITACAO_ABRE = .*;$/m)[0] + pegar('comCitacao') + pegar('separarCitacao') + ';this.c = comCitacao; this.s = separarCitacao;', ctx);

test('o trecho vai na frente da mensagem e o balão separa de volta', () => {
  const t = ctx.c('2. Banana\n3. Uva', 'por que essa?');
  assert.equal(t, 'Sobre este trecho da sua resposta:\n> 2. Banana\n> 3. Uva\n\npor que essa?');
  const s = ctx.s(t);
  assert.equal(s.trecho, '2. Banana\n3. Uva');
  assert.equal(s.fala, 'por que essa?');
  assert.equal(ctx.s('mensagem comum'), null);
});

test('o envio usa o trecho e limpa depois; o balão mostra a citação', () => {
  assert.match(app, /if \(P\.citacao && text\) \{ text = comCitacao\(P\.citacao, text\); limparCitacao\(P\); \}/);
  assert.match(pegar('userMsg'), /separarCitacao\(text\)/);
});

test('o nome da conversa não confunde o trecho citado com o pedido dele', () => {
  assert.equal(nomes.semColagem('Sobre este trecho da sua resposta:\n> 2. Banana\n\nfaz a página do Pedro'), 'faz a página do Pedro');
});
