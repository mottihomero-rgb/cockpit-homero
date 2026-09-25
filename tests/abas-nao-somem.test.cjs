'use strict';
/* O LOG DO APP tinha 108 linhas "abas caindo de 4 para 3: guardei config.json.anterior" —
   e em 17/09, tres seguidas em cinco segundos: 4 abas viraram 1. O codigo so PERCEBIA a
   perda e guardava uma copia de consolo; nao impedia nada.

   A causa: o `config:set` do main gravava CEGO o retrato que a tela mandasse, e o savePanes()
   da tela remonta a lista de abas do zero, so com as abas que estao montadas NAQUELE instante.
   Qualquer gravacao feita com a tela pela metade — boot, restauracao que falhou no meio,
   retrato velho — apagava do arquivo as abas que ainda nao tinham voltado.

   O conserto: a gravacao diz de onde veio. So a que veio de ele FECHAR a aba pode diminuir a
   lista. As outras nao: as abas que faltam voltam para o que vai ao disco, a copia de socorro
   continua sendo guardada, e a tela recebe o numero pra avisar ("Guardei suas 4 abas").

   Aqui esta o que nao pode voltar a quebrar. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadMain } = require('./main-harness.cjs');

const aba = (cwd) => ({ cwd, ativo: 0, chats: [{ engine: 'claude', cwd, titulo: 'conversa de ' + cwd }] });
const pastas = (d) => (d.abas || []).map(a => a.cwd).join(',');

// um Cockpit de teste com N abas ja no disco
function comAbasNoDisco(...cwds) {
  const h = loadMain();
  const arquivo = h.HOME + '/app-data/config.json';
  h.put(arquivo, JSON.stringify({ abas: cwds.map(aba), abaAberta: 0, tema: 'escuro' }));
  return { h, arquivo, disco: () => JSON.parse(h.files.get(arquivo).toString()) };
}

test('gravacao SEM a marca de que ele fechou nao pode comer aba', () => {
  const { h, arquivo, disco } = comAbasNoDisco('/p/a', '/p/b', '/p/c');

  // a tela manda um retrato pela metade: so uma das tres abas
  const r = h.call('config:set', { abas: [aba('/p/a')], abaAberta: 0, tema: 'escuro' });

  assert.equal(pastas(disco()), '/p/a,/p/b,/p/c', 'as duas abas que faltavam tem de voltar');
  assert.equal(r.abasDevolvidas, 2, 'o retorno diz quantas foram guardadas, pro recado na tela');
  assert.ok(h.files.has(arquivo + '.anterior'), 'a copia de socorro continua sendo guardada');
});

test('o RESTO do config da gravacao barrada entra assim mesmo', () => {
  const { h, disco } = comAbasNoDisco('/p/a', '/p/b');

  h.call('config:set', { abas: [aba('/p/a')], abaAberta: 0, tema: 'jornal', prompts: ['oi'] });

  const d = disco();
  assert.equal(d.tema, 'jornal', 'so as abas sao devolvidas: o resto da gravacao vale');
  assert.deepEqual(d.prompts, ['oi']);
  assert.equal(pastas(d), '/p/a,/p/b');
});

test('fechar aba de proposito continua funcionando', () => {
  const { h, disco } = comAbasNoDisco('/p/a', '/p/b', '/p/c');

  const r = h.call('config:set', { abas: [aba('/p/a'), aba('/p/c')], abaAberta: 0 }, null, { fechou: true });

  assert.equal(pastas(disco()), '/p/a,/p/c', 'a aba que ele fechou tem de sumir mesmo');
  assert.equal(r.abasDevolvidas, 0, 'nada foi devolvido');
});

test('fechar a ULTIMA aba tambem passa (fica sem aba nenhuma)', () => {
  const { h, disco } = comAbasNoDisco('/p/a');

  h.call('config:set', { abas: [], abaAberta: 0 }, null, { fechou: true });

  assert.deepEqual(disco().abas, [], 'fechar a unica aba deixa a tela de "Nova aba"');
});

test('abrir aba nova (a lista CRESCE) nunca e barrado', () => {
  const { h, disco } = comAbasNoDisco('/p/a');

  h.call('config:set', { abas: [aba('/p/a'), aba('/p/b')], abaAberta: 1 });

  assert.equal(pastas(disco()), '/p/a,/p/b', 'a aba nova entra sem marca nenhuma');
});

test('a aba que ja esta no retrato nao volta duplicada', () => {
  const { h, disco } = comAbasNoDisco('/p/a', '/p/b', '/p/c');

  const r = h.call('config:set', { abas: [aba('/p/a'), aba('/p/b')], abaAberta: 0 });

  assert.equal(pastas(disco()), '/p/a,/p/b,/p/c');
  assert.equal(r.abasDevolvidas, 1, 'so a que faltava (/p/c) volta');
});

test('o celular continua sem poder gravar config', () => {
  const { h, disco } = comAbasNoDisco('/p/a', '/p/b');

  const r = h.call('config:set', { abas: [aba('/p/a')], abaAberta: 0 }, { remoto: true }, { fechou: true });

  assert.equal(r, true, 'responde ok e nao grava nada');
  assert.equal(pastas(disco()), '/p/a,/p/b', 'nem com a marca de "fechou" o telefone grava');
});

/* A outra metade do conserto mora na tela. Sem isto a trava do Mac nao serve de nada:
   bastaria a tela marcar TODA gravacao como "ele fechou" e a perda voltava.
   R1-050 (25/09): a restauracao passou a distinguir dois motivos de encolher — 'fechou'
   (clique dele) e 'agrupou' (fusao automatica de abas do mesmo cliente no boot, sem clique
   nenhum). Os dois SO diminuem a lista quando TODAS as abas gravadas voltaram; o argumento
   deste teste foi atualizado pra letra nova, nao pra abrir excecao nova. */
test('so o fechar de aba e a restauracao completa marcam a gravacao', () => {
  const fonte = fs.readFileSync(path.join(__dirname, '../renderer/app.js'), 'utf8');
  const argumentos = new Set([...fonte.matchAll(/savePanes\(([^)]*)\)/g)].map(m => m[1].trim()));

  assert.deepEqual([...argumentos].sort(), ['', "abasQueNaoVoltaram.length ? false : 'agrupou'", 'fechou', 'true'],
    'apareceu um savePanes com argumento novo: confira se aquela gravacao PODE mesmo perder aba');

  const bloco = (nome) => {
    const i = fonte.indexOf(nome);
    assert.notEqual(i, -1, 'sumiu a funcao ' + nome);
    return fonte.slice(i, fonte.indexOf('\n}', i));
  };
  assert.match(bloco('async function fecharAba(A) {'), /savePanes\(true\)/,
    'fechar a aba no X (e o ⌘W no ultimo chat dela) tem de marcar a gravacao');
  assert.match(bloco('function moverPane(P, A, indice) {'), /savePanes\(true\)/,
    'arrastar o ultimo chat pra outra aba esvazia a de origem: tambem e ele pedindo');
  assert.match(bloco('async function restaurarAbas() {'), /savePanes\(abasQueNaoVoltaram\.length \? false : 'agrupou'\)/,
    'a restauracao so pode encolher a lista quando TODAS as abas gravadas voltaram (por fechar ou por agrupar)');
});
