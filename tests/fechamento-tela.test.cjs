'use strict';
/* Fechamento do dia: duas coisas que as levas de hoje deixaram passar, achadas abrindo a tela
   de verdade num navegador e MEDINDO.

   1) O resultado da busca ganhou a etiqueta "Codex · Pedro" ao lado do titulo. Numa coluna de
      230px a etiqueta levava o nome inteiro do cliente e do titulo sobrava uma letra — e o
      titulo e justamente o que ele esta procurando. Agora a etiqueta tem linha propria.
   2) A fileira de pastas da tela "Nova aba" le os clientes do disco (uma ida ao main). Clicar
      em duas pastas seguidas comecava o segundo desenho antes de o primeiro acordar, e os dois
      despejavam botao no mesmo lugar: a fileira aparecia dobrada.

   Aqui esta o que nao pode voltar a quebrar. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const raiz = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(raiz, 'renderer/app.js'), 'utf8');
const css = fs.readFileSync(path.join(raiz, 'renderer/style.css'), 'utf8');

/* ---- 1. na busca, o titulo da conversa nao pode ser esmagado pela etiqueta ---- */

test('a etiqueta "motor · cliente" fica numa linha propria, nao ao lado do titulo', () => {
  assert.match(css, /\.hi-onde\{display:block;/,
    'em bloco ela ocupa a linha inteira; como item de flex ela disputava a largura com o titulo');
  assert.equal(/\.hi-onde\{flex:/.test(css), false,
    'com flex a etiqueta levava a largura primeiro e o titulo ficava com zero');
  assert.equal(/\.hist-item\.com-trecho \.hi-onde\{float:right/.test(css), false,
    'flutuando a direita ela voltava a dividir a linha do titulo');
});

test('a linha de resultado vira bloco e ancora os quatro botoes no canto', () => {
  assert.match(css, /\.hist-item\.com-onde\{display:block;position:relative/,
    'linha propria so existe fora do flex');
  for (const bt of ['hi-fav', 'hi-edit', 'hi-grupo', 'hi-mais']) {
    assert.match(css, new RegExp('\\.hist-item\\.com-onde \\.' + bt), bt + ': sem ancora ele cai numa linha so dele');
  }
  assert.match(css, /\.hist-item\.com-onde \.hi-t\{display:block;padding-right:98px\}/,
    'a folga dos botoes vale so na linha do titulo, senao estreita a etiqueta tambem');
  assert.match(css, /\.hist-item\.com-onde \.hi-w\{position:absolute;right:6px;bottom:4px/,
    'o "ha 2 dias" desce pro canto de baixo e devolve 53px pro titulo');
});

test('linhaDaBusca marca a linha e poe a etiqueta DEPOIS do titulo', () => {
  assert.match(app, /d\.classList\.add\('com-onde'\)/,
    'sem a marca a regra de bloco nao pega');
  assert.match(app, /d\.insertBefore\(et, tit\.nextSibling\)/,
    'antes do titulo a etiqueta ficava na frente dele, na mesma linha');
  assert.equal(/d\.insertBefore\(et, \$\('\.hi-t', d\)\)/.test(app), false,
    'era assim que a etiqueta entrava na frente do titulo');
});

test('nada de cor escrita na mao nas regras novas (vale nos 3 temas)', () => {
  // indexOf sem checar >=0 deixava o teste passar sozinho se o seletor sumisse do CSS
  const iHiOnde = css.indexOf('.hi-onde{');
  const iComOnde = css.indexOf('.hist-item.com-onde{');
  assert.ok(iHiOnde >= 0 && iComOnde >= 0, 'seletor sumiu do CSS');
  const bloco = css.slice(iHiOnde, iHiOnde + 400) + css.slice(iComOnde, iComOnde + 700);
  assert.equal(/#[0-9a-fA-F]{3,8}\b|rgb\(/.test(bloco), false, 'cor tem de sair de variavel de tema');
});

/* ---- 2. a fileira de pastas nao pode dobrar ---- */

test('cada desenho da fileira de pastas tem numero, e o atrasado desiste', () => {
  const i = app.indexOf('async function naPintarAtalhosMac()');
  assert.ok(i > 0, 'a funcao tem de existir');
  const corpo = app.slice(i, app.indexOf('\n}\n', i));
  assert.match(corpo, /const minhaVez = \+\+naAtalhosVez;/, 'sem numero nao da pra saber quem ficou pra tras');
  assert.match(corpo, /if \(minhaVez !== naAtalhosVez\) return;/, 'o desenho velho tem de desistir');
  assert.ok(corpo.indexOf("cx.innerHTML = ''") > corpo.indexOf('await lerClientes()'),
    'limpar ANTES da espera deixava os dois desenhos despejarem botao na mesma fileira');
});

test('o contador da fileira nasce declarado, fora da funcao', () => {
  assert.match(app, /let naAtalhosVez = 0;/, 'dentro da funcao o numero zerava a cada chamada');
  assert.ok(app.indexOf('let naAtalhosVez = 0;') < app.indexOf('async function naPintarAtalhosMac()'),
    'tem de ser declarado antes de quem usa');
});
