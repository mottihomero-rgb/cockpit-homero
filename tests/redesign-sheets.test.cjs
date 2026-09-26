'use strict';
/* Guarda das SHEETS do redesenho (Nova aba, Atalhos, janelinhas, terminal, quadro).
   O que ja escapou uma vez e os testes do celular nao pegaram:
   1) largura fixa (560, 928, 460…) fora do bloco "so no Mac" do sheets.css: no iPhone o veu e
      grade, a coluna cresce ate a caixa e a Nova aba saia com 560 numa tela de 393 — o Começar
      ficava fora da tela e nao dava para abrir aba nova;
   2) o veu do terminal com pointer-events:none: escurecia a janela, mas o clique passava para
      os chats de tras (parecia trancado sem estar), e o clique fora deixou de fechar;
   3) rotulo de atalho cortado com "…" no meio da palavra, e explicacao entre parenteses na tela. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const raiz = path.resolve(__dirname, '..');
const ler = (f) => fs.readFileSync(path.join(raiz, f), 'utf8');
const css = ler('renderer/redesign/sheets.css').replace(/\/\*[\s\S]*?\*\//g, '');
const app = ler('renderer/app.js');

// separa o bloco "so no Mac" (o @media que nega a condicao do celular) do resto do arquivo
function blocoDoMac() {
  const i = css.indexOf('@media (min-width:821px)');
  assert.ok(i > 0, 'o sheets.css tem de ter o bloco so no Mac');
  let n = 0, j = css.indexOf('{', i);
  for (let k = j; k < css.length; k++) {
    if (css[k] === '{') n++;
    else if (css[k] === '}' && --n === 0) return { dentro: css.slice(j, k), fora: css.slice(0, i) + css.slice(k + 1) };
  }
  throw new Error('bloco do Mac sem fim');
}

test('sheets: largura fixa de caixa so no bloco do Mac (no iPhone a caixa cabe na tela)', () => {
  const { dentro, fora } = blocoDoMac();
  const caixas = /(\.na-cx|\.at-cx|\.modal-cx)[^{]*\{[^}]*\bwidth:\s*\d{3,}px/g;
  const achou = fora.match(caixas) || [];
  assert.deepEqual(achou, [], 'largura fixa fora do bloco do Mac estoura a tela do telefone: ' + achou.join(' | '));
  for (const [sel, w] of [['.na-cx', 560], ['.at-cx', 928]]) {
    assert.match(dentro, new RegExp(sel.replace('.', '\\.') + '\\{width:' + w + 'px\\}'), sel + ' com a largura do desenho no Mac');
  }
});

test('sheets: o veu do terminal tranca a janela e o clique fora fecha, como antes', () => {
  assert.equal(/cx-terminal[^{]*\{[^}]*pointer-events:\s*none/.test(css), false,
    'veu que escurece mas deixa o clique passar parece trancado sem estar');
  assert.equal(/:has\(>\s*\.modal-cx\.cx-terminal\)[^{]*\{[^}]*pointer-events/.test(css), false);
  assert.match(app, /modal\.onclick = \(e\) => \{ if \(e\.target === modal\) fechar\(\); \};/,
    'clicar no veu do terminal fecha (e encerra o processo) pelo mesmo fechar() do ×');
});

test('atalhos: rotulo curto na tela, sem explicacao entre parenteses e sem grupo com frase', () => {
  const i = app.indexOf('const ATALHOS = [');
  const lista = app.slice(i, app.indexOf('\n];\n', i));
  const grupos = [...lista.matchAll(/^ {2}\['([^']+)', \[/gm)].map(m => m[1]);
  assert.ok(grupos.length >= 4, 'os grupos da lista de atalhos');
  for (const g of grupos) assert.equal(/[()]/.test(g), false, 'grupo so com o rotulo: ' + g);
  // o que vai para a tela: o 3o item (rotulo curto) ou o texto por extenso sem a explicacao
  const linhas = [...lista.matchAll(/^ {4}\['([^']*)', '([^']*)'(?:, '([^']*)')?\],$/gm)];
  assert.ok(linhas.length > 20, 'as linhas da lista de atalhos');
  for (const [, tecla, oque, rotulo] of linhas) {
    const tela = rotulo || oque.split(/ \(| — |; /)[0];
    assert.ok(tela.length <= 30, 'rotulo comprido demais para a coluna de 272 (sai cortado com …): ' + tela);
    assert.equal(/[()]/.test(tela), false, 'explicacao entre parenteses na tela: ' + tela);
    assert.ok(tecla.length > 0);
  }
});

test('atalhos: a tecla aparece no desenho do Mac (⌥ ⌃ ⌫, modificadores na ordem ⌃⌥⇧⌘)', () => {
  const i = app.indexOf('const ORDEM_MODIF'), j = app.indexOf('function alternarTelaAtalhos');
  assert.ok(i > 0 && j > i, 'a funcao teclaDoMac tem de existir antes da tela');
  const teclaDoMac = new Function(app.slice(i, j) + '\nreturn teclaDoMac;')();
  const casos = { 'Alt+D': '⌥D', 'Ctrl+C': '⌃C', 'Delete': '⌫', '⌘⇧T': '⇧⌘T', '⌘1 … ⌘9': '⌘1–9',
    '⌘⌥1 … ⌘⌥9': '⌥⌘1–9', 'Enter': '↩', '⌘Enter': '⌘↩', 'Esc': 'esc', 'setas (⇧ anda mais)': '← ↑ → ↓' };
  for (const [de, para] of Object.entries(casos)) assert.equal(teclaDoMac(de), para, de);
});
