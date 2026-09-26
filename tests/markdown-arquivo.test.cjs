'use strict';
/* A entrega do agente sumia da conversa: o Codex responde "[Baixar arte](/Users/.../arte.png)"
   e o markdown seguro jogava fora todo link que nao fosse http. Sobrava so o texto, sem link,
   sem imagem, sem caminho. Este teste roda o MESMO trecho do app.js com o marked de verdade. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { Marked, Renderer } = require('marked');

function markdownDoApp() {
  const src = fs.readFileSync(path.resolve(__dirname, '../renderer/app.js'), 'utf8');
  const ini = src.indexOf('const markdownSeguro = new marked.Renderer();');
  const fim = src.indexOf('marked.setOptions(', ini);
  assert.ok(ini > 0 && fim > ini, 'trecho do markdown seguro nao encontrado no app.js');
  const fimLinha = src.indexOf('\n', fim);
  const m = new Marked();
  const ctx = { marked: { Renderer, setOptions: (o) => m.setOptions(o) } };
  vm.runInNewContext(src.slice(ini, fimLinha), ctx);
  return (txt) => m.parse(txt);
}

test('link para arquivo do Mac vira link de arquivo, com o caminho guardado', () => {
  const md = markdownDoApp();
  // a fala exata do Codex no print de 15/09
  const html = md('Pronto. Separei essa arte do trio para enviar junto:\n\n[Baixar arte para o WhatsApp](/Users/homeromotti/Projetos/Excelência/API Oficial do Curso de Claude - 15-09-2026/arte-whatsapp-curso-claude-trio.png)');
  assert.match(html, /class="arquivo"/);
  assert.match(html, /data-caminho="\/Users\/homeromotti\/Desktop\/Projetos\/Excelencia\/API Oficial do Curso de Claude - 15-09-2026\/arte-whatsapp-curso-claude-trio.png"/);
  assert.match(html, />Baixar arte para o WhatsApp</);
});

test('caminho com file:// e com espacos codificados volta limpo', () => {
  const md = markdownDoApp();
  const html = md('[ver](file:///Users/h/Meu%20Arquivo.pdf)');
  assert.match(html, /data-caminho="\/Users\/h\/Meu Arquivo.pdf"/);
});

test('caminho com espaco entre <> tambem vale', () => {
  const md = markdownDoApp();
  assert.match(md('[ver](</Users/h/arte trio.png>)'), /data-caminho="\/Users\/h\/arte trio.png"/);
});

test('imagem local ganha marca de imagem para a miniatura', () => {
  const md = markdownDoApp();
  const html = md('![arte do trio](/Users/h/arte.png)');
  assert.match(html, /data-caminho="\/Users\/h\/arte.png"/);
  assert.match(html, /data-img="1"/);
});

test('link de site continua abrindo no navegador', () => {
  const md = markdownDoApp();
  const html = md('[site](https://motti.ia.br)');
  assert.match(html, /<a href="https:\/\/motti.ia.br">site<\/a>/);
});

test('esquema perigoso continua virando so texto', () => {
  const md = markdownDoApp();
  for (const ruim of ['javascript:alert(1)', 'data:text/html,oi', 'vbscript:x']) {
    const html = md('[clique](' + ruim + ')');
    assert.doesNotMatch(html, /<a /, ruim);
    assert.doesNotMatch(html, /data-caminho/, ruim);
  }
});

test('caminho com aspas nao escapa do atributo', () => {
  const md = markdownDoApp();
  const html = md('[x](</Users/h/a"onmouseover="alert(1).png>)');
  assert.doesNotMatch(html, /"onmouseover=/);
});
