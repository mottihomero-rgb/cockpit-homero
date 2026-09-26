'use strict';
/* Guarda da JANELA do redesenho (handoff do Claude Design, 25/09/2026): barra do topo de 52 com
   os semáforos no meio dela, aba em cápsula com UM sinal só (esperando > trabalhando > nova),
   contador só com o número, faixa de aviso empurrando os chats no Mac e o separador da barra de
   ícones. São coisas que quebram caladas: a janela abre, mas com o semáforo torto, dois sinais
   na mesma aba ou a faixa cobrindo o cabeçalho dos chats. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const raiz = path.resolve(__dirname, '..');
const ler = (f) => fs.readFileSync(path.join(raiz, f), 'utf8');
const css = ler('renderer/redesign/janela.css');
const HTMLS = ['renderer/index.html', 'renderer/index-web.html'];

test('os semáforos caem no meio da barra do topo de 52', () => {
  const m = ler('main.js').match(/trafficLightPosition:\s*\{\s*x:\s*(\d+),\s*y:\s*(\d+)\s*\}/);
  assert.ok(m, 'trafficLightPosition sumiu do main.js');
  // o Electron posiciona o quadro do botão (16 de altura): o centro fica em y + 8
  assert.equal(Number(m[2]) + 8, 52 / 2, 'o centro dos semáforos saiu do meio da barra');
  assert.match(ler('renderer/style.css'), /:root\{--topo-altura:52px;--veu-topo:52px;/);
  assert.match(css, /#titlebar\.hidden ~ #abasTopo\{[^}]*height:52px/);
});

test('a aba é cápsula: sinal, nome, contador e ×, sem o cartão de duas linhas', () => {
  for (const f of HTMLS) {
    const tpl = (ler(f).match(/<template id="tplAba">([\s\S]*?)<\/template>/) || [])[1] || '';
    assert.ok(tpl, f + ': sem o molde da aba');
    assert.doesNotMatch(tpl, /aba-topo/, f + ': a linha de cima do cartão velho voltou');
    const ordem = ['aba-dot', 'aba-proj', 'aba-tit', 'aba-x'].map((c) => tpl.indexOf('class="' + c));
    assert.ok(ordem.every((i) => i > 0), f + ': falta peça da aba: ' + ordem);
    assert.deepEqual([...ordem].sort((a, b) => a - b), ordem, f + ': a ordem é sinal, nome, contador, ×');
  }
});

test('o contador da aba é só o número (e some com zero chat)', () => {
  const app = ler('renderer/app.js');
  const corpo = app.match(/function pintarAba\(A\) \{([\s\S]*?)\n\}/);
  assert.ok(corpo, 'pintarAba mudou de forma: ajuste este teste');
  const el = () => ({ textContent: '', className: '' });
  const pecas = { '.aba-proj': el(), '.aba-tit': el(), '.aba-dot': el() };
  const A = { cwd: '/x/Pedro', ordem: ['p1', 'p2', 'p3'], el: { classList: { toggle() {} }, title: '' } };
  const ctx = {
    A, $: (s) => pecas[s], NA_VPS: () => false, nomeProjeto: () => 'Pedro', shortPath: (p) => p,
    panes: new Map(), estadoDoPainel: () => ({ cls: '' }), agTrabalhando: () => false,
  };
  vm.runInNewContext('(function pintarAba(A) {' + corpo[1] + '\n})(A)', ctx);
  assert.equal(pecas['.aba-tit'].textContent, '3');
  A.ordem = [];
  vm.runInNewContext('(function pintarAba(A) {' + corpo[1] + '\n})(A)', ctx);
  assert.equal(pecas['.aba-tit'].textContent, '', 'aba sem chat não mostra "0"');
});

test('um sinal por aba: esperando ganha de trabalhando, que ganha de nova', () => {
  // nova só aparece quando a aba está parada (off/idle): trabalhando e esperando mandam
  assert.match(css, /\.aba\.nova \.aba-dot\.off,\.aba\.nova \.aba-dot\.idle\{display:inline-block/);
  assert.match(css, /\.aba \.aba-dot\{display:none/);
  assert.match(css, /\.aba \.aba-dot\.espera\{display:inline-grid[^}]*background:var\(--status-wait\)/);
  assert.match(css, /\.aba \.aba-dot\.busy\{display:inline-block[^}]*animation:ck-spin 1s linear infinite/);
  // a aba não volta a ser contornada com a cor da IA em foco (os comentários podem citar o nome)
  assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//g, ''), /--cor-foco|--aba-cor|--motor/);
  assert.match(css, /\.aba\{[^}]*border:0[^}]*background:transparent/);
  assert.match(css, /\.aba\.ativa\{background:var\(--fill-1\)[^}]*font-weight:600/);
});

test('no Mac a faixa de aviso empurra os chats (não cobre o cabeçalho deles)', () => {
  assert.match(css, /body:has\(> #titlebar\.hidden\)\{display:flex;flex-direction:column\}/);
  assert.match(css, /#titlebar\.hidden ~ #faixaAvisos\{[^}]*position:relative/);
  assert.match(css, /#titlebar\.hidden ~ #shell\{flex:1 1 auto;min-height:0;height:auto\}/);
  // e o index.html continua escondendo a barra de título (é o que liga tudo isso)
  assert.match(ler('renderer/index.html'), /<div id="titlebar" class="hidden">/);
});

test('barra de ícones: Conversas, separador e as ferramentas da janela', () => {
  for (const f of HTMLS) {
    const nav = (ler(f).match(/<nav id="activitybar">([\s\S]*?)<\/nav>/) || [])[1] || '';
    const conversas = nav.indexOf('data-view="conversas"'), sep = nav.indexOf('class="act-sep"'), torre = nav.indexOf('data-view="torre"');
    assert.ok(conversas > 0 && sep > conversas && torre > sep, f + ': o separador fica entre Conversas e a Torre');
  }
  assert.match(css, /\.act-sep\{flex:none;width:20px;height:1px;margin:6px 0;background:var\(--separator\)\}/);
});
