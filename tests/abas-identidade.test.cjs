'use strict';
/* Prova que a trava das abas reconhece a aba pelo NUMERO DA CONVERSA e nao pela pasta.
   A pasta muda sozinha (o app agrupa por cliente e encurta o caminho); o numero nao muda.
   Casar por pasta fazia a trava devolver copia de todas as abas = aba repetida na tela. */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadMain } = require(path.join(__dirname, 'main-harness.cjs'));

// aba igual as de verdade: cada chat tem o numero da conversa (sessao)
const aba = (cwd, ...sessoes) => ({
  cwd, ativo: 0,
  chats: sessoes.map(s => ({ engine: 'claude', cwd, titulo: 'chat ' + s, sessao: s })),
});
const pastas = (d) => (d.abas || []).map(a => a.cwd).join(' | ');

function comDisco(...abasDisco) {
  const h = loadMain();
  const arq = h.HOME + '/app-data/config.json';
  h.put(arq, JSON.stringify({ abas: abasDisco, abaAberta: 0 }));
  return { h, disco: () => JSON.parse(h.files.get(arq).toString()) };
}

test('agrupar por cliente encurta a pasta e a aba NAO duplica', () => {
  const R = '/Users/homeromotti/Projetos';
  const { h, disco } = comDisco(aba(R + '/Adsure/2026-09-18_x', 's1'), aba(R + '/Adsure/2026-09-17_y', 's2'), aba('/Users/homeromotti', 's3'));
  // a tela agrupou as duas do Adsure numa aba so: 3 abas viram 2, mas nenhuma conversa se perdeu
  h.call('config:set', { abas: [aba(R + '/Adsure', 's1', 's2'), aba('/Users/homeromotti', 's3')], abaAberta: 0 });
  assert.equal(disco().abas.length, 2, 'nao pode duplicar: ' + pastas(disco()));
});

test('duas abas na mesma pasta: a que some de verdade volta', () => {
  const { h, disco } = comDisco(aba('/p/x', 'a1'), aba('/p/x', 'a2'), aba('/p/y', 'a3'));
  const r = h.call('config:set', { abas: [aba('/p/x', 'a1'), aba('/p/y', 'a3')], abaAberta: 0 });
  assert.equal(disco().abas.length, 3, 'a aba a2 tinha que voltar');
  assert.equal(r.abasDevolvidas, 1);
});

test('trocar a pasta da aba nao cria aba fantasma', () => {
  const { h, disco } = comDisco(aba('/p/velha', 'v1'), aba('/p/b', 'b1'), aba('/p/c', 'c1'));
  // a aba v1 so mudou de pasta; a aba c1 sumiu de verdade
  h.call('config:set', { abas: [aba('/p/nova', 'v1'), aba('/p/b', 'b1')], abaAberta: 0 });
  const d = disco();
  assert.equal(d.abas.length, 3, 'esperado nova + b + c, deu: ' + pastas(d));
  assert.ok(!pastas(d).includes('/p/velha'), 'a pasta velha nao pode voltar: ' + pastas(d));
  assert.ok(pastas(d).includes('/p/c'), 'a aba que sumiu de verdade tinha que voltar');
});

test('nao fica preso avisando: depois de devolver, a gravacao seguinte fica quieta', () => {
  const R = '/Users/homeromotti/Projetos';
  const { h, disco } = comDisco(aba(R + '/Adsure/2026-09-18_x', 's1'), aba('/Users/homeromotti', 's3'));
  const r1 = h.call('config:set', { abas: [aba(R + '/Adsure', 's1')], abaAberta: 0 });
  assert.equal(r1.abasDevolvidas, 1, 'a aba s3 sumiu e tinha que voltar');
  const r2 = h.call('config:set', { abas: [aba(R + '/Adsure', 's1'), aba('/Users/homeromotti', 's3')], abaAberta: 0 });
  assert.equal(r2.abasDevolvidas, 0, 'com tudo de volta, nao pode avisar de novo');
  assert.equal(disco().abas.length, 2);
});

test('fechar aba de proposito continua funcionando', () => {
  const { h, disco } = comDisco(aba('/p/x', 'x1'), aba('/p/y', 'y1'));
  h.call('config:set', { abas: [aba('/p/x', 'x1')], abaAberta: 0 }, null, { fechou: true });
  assert.equal(disco().abas.length, 1, 'quando ELE fecha, a aba sai mesmo');
});
