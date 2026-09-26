'use strict';
/* A tela do celular ficava cinza e vazia por quase um segundo toda vez que o app abria: o
   Safari so desenhava a pagina depois de baixar os ~900 KB de .js e .css. Agora o
   index-web.html tem uma capa (so a marca do app e um risco que anda) que aparece de cara e
   sai sozinha quando o app avisa que terminou de montar (evento cockpit:pronto).

   O pedaco de JS que tira a capa mora dentro do proprio HTML, e o Content-Security-Policy
   da pagina so deixa rodar JS que bata com o selo sha256 anotado nele. Quem mexer no script
   e esquecer de refazer o selo quebra a capa CALADO — a tela ficaria presa na marca ate o
   prazo de seguranca. Este teste existe para nao deixar isso passar. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const raiz = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(raiz, 'renderer/index-web.html'), 'utf8');

test('a capa de abertura aparece antes de tudo e some no fim do boot', () => {
  const capa = html.indexOf('<div id="abrindo"');
  assert.ok(capa > 0, 'falta a capa de abertura');
  assert.ok(capa < html.indexOf('<div id="titlebar">'),
    'a capa tem de ser a primeira coisa do <body>, senao ela nao aparece primeiro');
  assert.match(html, /cockpit:pronto['"], tirarCapa/, 'a capa sai no aviso de que o app montou');
  assert.match(html, /setTimeout\(tirarCapa, \d+\)/, 'falta o prazo de seguranca se o boot travar');
});

test('nada de frase na capa: so a marca e o indicador de que esta carregando', () => {
  const bloco = (html.match(/<div id="abrindo"[\s\S]*?<\/div>/) || [''])[0];
  const semTag = bloco.replace(/<[^>]*>/g, '').trim();
  assert.equal(semTag, '', 'a capa nao pode ter texto escrito na tela: ' + JSON.stringify(semTag));
  assert.match(bloco, /src="icone-180\.png"/, 'a capa mostra a marca do app');
  assert.match(bloco, /class="ab-risco"/, 'a capa mostra que esta carregando');
});

test('o selo sha256 do script da capa bate com o Content-Security-Policy', () => {
  const inline = html.match(/<script>([\s\S]*?)<\/script>/g) || [];
  assert.equal(inline.length, 1, 'o HTML do celular so pode ter UM script escrito por dentro');
  const corpo = inline[0].replace(/^<script>/, '').replace(/<\/script>$/, '');
  const selo = 'sha256-' + crypto.createHash('sha256').update(corpo, 'utf8').digest('base64');
  const csp = html.match(/Content-Security-Policy" content="([^"]+)"/);
  assert.ok(csp, 'falta o Content-Security-Policy');
  assert.ok(csp[1].includes("'" + selo + "'"),
    'o selo mudou. Ponha este no script-src do index-web.html: ' + selo);
  assert.ok(csp[1].includes("script-src 'self'"), 'os arquivos .js continuam vindo so daqui');
  assert.equal(/script-src[^;]*unsafe-inline/.test(csp[1]), false,
    'o selo existe justamente para NAO precisar liberar todo script escrito por dentro');
});

test('os arquivos do app carregam com defer: e o que deixa a capa aparecer de cara', () => {
  const tags = html.match(/<script [^>]*src="[^"]+"[^>]*>/g) || [];
  assert.ok(tags.length >= 8, 'sumiram arquivos .js da pagina do celular');
  for (const t of tags) assert.match(t, /\bdefer\b/, 'sem defer o Safari trava a pintura: ' + t);
});

test('o basico do iPhone esta no lugar: recorte da tela, icone e cor da barra', () => {
  assert.match(html, /name="viewport" content="[^"]*viewport-fit=cover/,
    'sem viewport-fit=cover o app nao usa a tela inteira do iPhone');
  assert.match(html, /name="apple-mobile-web-app-capable" content="yes"/);
  assert.match(html, /rel="apple-touch-icon" href="icone-180\.png"/);
  assert.match(html, /name="theme-color"/);
  // a cor da barra segue o tema escolhido (automatica, clara ou escura), nao fica cravada
  assert.match(html, /meta\[name="theme-color"\]/, 'falta acertar a cor da barra pelo tema');
  assert.match(html, /getPropertyValue\('--bg'\)/, 'a cor tem de sair da variavel do tema');

  const png = fs.readFileSync(path.join(raiz, 'renderer/icone-180.png'));
  assert.equal(png.readUInt32BE(16), 180, 'o icone da tela de inicio tem de ter 180 de largura');
  assert.equal(png.readUInt32BE(20), 180, 'o icone da tela de inicio tem de ter 180 de altura');
});
