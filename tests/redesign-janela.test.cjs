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

test('os semáforos caem no meio da barra do topo de 40 (era 52: ele achou grossa)', () => {
  const m = ler('main.js').match(/trafficLightPosition:\s*\{\s*x:\s*(\d+),\s*y:\s*(\d+)\s*\}/);
  assert.ok(m, 'trafficLightPosition sumiu do main.js');
  // o Electron põe o TOPO do quadro do botão em y; no macOS 26 o quadro mede 14×14 (medido numa
  // NSWindow escondida), então o centro fica em y + 7
  assert.equal(Number(m[2]) + 7, 40 / 2, 'o centro dos semáforos saiu do meio da barra');
  assert.equal(Number(m[1]) + 1, 20, 'a bolinha de 12 (no meio do quadro de 14) sai de x=20');
  assert.match(ler('renderer/style.css'), /:root\{--topo-altura:40px;--veu-topo:40px;/);
  assert.match(css, /#titlebar\.hidden ~ #abasTopo\{[^}]*height:40px/);
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
  assert.match(css, /\.aba\.ativa\{[^}]*background:var\(--fill-1\)[^}]*font-weight:600/);
});

test('a faixa de aviso empurra os chats no Mac e no celular (não cobre o cabeçalho deles)', () => {
  assert.match(css, /body:has\(> #shell\)\{display:flex;flex-direction:column\}/);
  // ordem: barra de título (celular) → barra das abas → faixa → chats
  assert.match(css, /#titlebar\{order:-3;flex:none\}/);
  assert.match(css, /#abasTopo\{order:-2\}/);
  assert.match(css, /#faixaAvisos\{order:-1;flex:none\}/);
  assert.match(css, /#shell\{flex:1 1 auto;min-height:0;height:auto\}/);
  // no iPhone ela ficava position:fixed por cima do cabeçalho do chat (sumia o seletor e o ×)
  const faixa = (ler('renderer/style.css').match(/#faixaAvisos\{[^}]*\}/) || [''])[0];
  assert.ok(faixa, 'a regra da faixa sumiu do style.css');
  assert.doesNotMatch(faixa, /position:fixed/, 'a faixa voltou a boiar por cima dos chats');
  assert.doesNotMatch(ler('renderer/celular.css'), /#faixaAvisos\{[^}]*position:fixed/);
  // e o index.html continua escondendo a barra de título (a altura de 52 depende disso)
  assert.match(ler('renderer/index.html'), /<div id="titlebar" class="hidden">/);
  assert.match(css, /#titlebar\.hidden ~ #abasTopo\{height:40px\}/);
});

test('texto da tarja em pedaços: nome de arquivo em mono, tudo por textContent', () => {
  const app = ler('renderer/app.js');
  const corpo = app.match(/function escreverAviso\(el, texto\) \{([\s\S]*?)\n\}/);
  assert.ok(corpo, 'escreverAviso sumiu');
  const no = () => ({ filhos: [], textContent: '', appendChild(f) { this.filhos.push(f); } });
  const document = {
    createElement: () => { const e = no(); e.className = ''; return e; },
    createTextNode: (t) => ({ texto: t }),
  };
  const el = no();
  const ctx = { el, document };
  vm.runInNewContext('(function escreverAviso(el, texto) {' + corpo[1] + '\n})(el, ["Chegou ", { mono: "<b>x.pdf</b>" }, " na caixa de entrada"])', ctx);
  assert.equal(el.filhos.length, 3);
  assert.equal(el.filhos[1].className, 'fx-mono');
  assert.equal(el.filhos[1].textContent, '<b>x.pdf</b>', 'o nome entra como texto, nunca como HTML');
  assert.doesNotMatch(corpo[1], /innerHTML/);
  assert.match(css, /\.fx-mono\{font:400 12px\/16px var\(--font-mono\)\}/);
  // chegou arquivo: o nome vai no pedaço mono (tela 21)
  assert.match(app, /\['Chegou ', \{ mono: m\.nome \|\| 'imagem' \}, ' na caixa de entrada'/);
});

test('tarja de chat esperando usa o sinal de espera; rotina parada é erro', () => {
  const app = ler('renderer/app.js');
  assert.match(app, /id, tipo: 'espera', fixo: true, acao: 'ir'/);
  assert.match(app, /\{ espera: e\.txt \}/);
  // o triângulo é de alerta/erro; espera é o círculo com "!" desenhado no CSS
  assert.match(app, /function icoDoAviso\(tipo\) \{ return tipo === 'espera' \? ''/);
  assert.match(css, /\.fx-espera \.fx-ic::before\{content:"!"[^}]*background:var\(--status-wait\)/);
  assert.match(css, /\.fx-destaque\{color:var\(--status-wait-text\)\}/);
});

test('muitas abas: encolhem antes de rolar e a borda escondida se apaga', () => {
  assert.match(css, /\.aba\{[^}]*flex:0 1 auto/);
  // o piso de 104 não pode alargar aba curta (a "Zouti 1" do design tem 71)
  assert.match(css, /\.aba\{min-width:0;min-width:calc-size\(max-content, min\(size, 104px\)\)\}/);
  assert.match(css, /\.aba\.ativa\{flex-shrink:0;/);
  assert.match(css, /animation:abas-bordas linear both;animation-timeline:scroll\(self inline\)/);
  assert.match(css, /@property --abas-borda-e\{[^}]*initial-value:0px\}/);
});

test('sheet Nova aba aberta: cápsula "Nova aba" fora da lista de abas', () => {
  for (const f of HTMLS) {
    const topo = (ler(f).match(/<div id="abasTopo">([\s\S]*?)\n<\/div>/) || [])[1] || '';
    const lista = topo.indexOf('id="abasLista"'), prov = topo.indexOf('class="aba-provisoria"'), mais = topo.indexOf('id="btnNovaAba"');
    assert.ok(lista > 0 && prov > lista && mais > prov, f + ': a cápsula fica entre a lista e o "+"');
    // sem a classe .aba: o arrastar e o clique procuram '#abasTopo .aba'
    assert.doesNotMatch(topo, /class="aba aba-provisoria|class="aba-provisoria aba/);
  }
  assert.match(css, /body:has\(> #novaAba:not\(\.hidden\)\) \.aba-provisoria\{display:flex\}/);
});

test('divisor de 1pt em x=52 também com a coluna lateral aberta', () => {
  assert.match(css, /#dragbar\.hidden \+ #panes\{border-left:1px solid var\(--separator\)\}/);
  assert.match(css, /#sidebar\{border-left:1px solid var\(--separator\)\}/);
});

test('barra de ícones: Conversas, separador e as ferramentas da janela', () => {
  for (const f of HTMLS) {
    const nav = (ler(f).match(/<nav id="activitybar">([\s\S]*?)<\/nav>/) || [])[1] || '';
    // 26/09: a torre foi para dentro das Conversas; depois do separador vêm os Ajustes
    const conversas = nav.indexOf('data-view="conversas"'), sep = nav.indexOf('class="act-sep"'), aj = nav.indexOf('data-view="settings"');
    assert.ok(conversas > 0 && sep > conversas && aj > sep, f + ': o separador fica entre Conversas e os Ajustes');
  }
  assert.match(css, /\.act-sep\{flex:none;width:20px;height:1px;margin:6px 0;background:var\(--separator\)\}/);
});
