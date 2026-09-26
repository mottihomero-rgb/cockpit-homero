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

/* ---------------------------------------------------------------------------------------------
   Rodada 1 de conserto das sheets (26/09). O que a conferência achou no print e na medida:
   4) cabeçalho do terminal com margem de 16 embaixo (regra genérica mais pesada ganhava);
   5) "Confirmar?" do quadro: branco sobre o vermelho claro de texto, 2,8:1 no escuro;
   6) terminal igual no contraste aumentado (comando a 3,78:1);
   7) "Escolher pasta…" com a pasta aberta (o desenho usa a fechada);
   8) o ■ de parar ficava na barra depois que o comando acabava;
   9) a tela de atalhos abria sem foco na busca (e a letra solta é barrada ali: digitar não fazia nada);
   10) botões sem o estado pressionado (apertar = igual ao hover). */
const vm = require('node:vm');

// peso de um seletor: [ids, classes/atributos/pseudo-classes, tipos]. :is/:not contam o argumento
// mais pesado (é assim que o navegador conta).
function peso(sel) {
  let s = sel.replace(/::[\w-]+/g, ''), r = [0, 0, 0];
  const soma = (a, b) => a.map((x, i) => x + b[i]);
  const maior = (a, b) => (a[0] - b[0] || a[1] - b[1] || a[2] - b[2]) >= 0 ? a : b;
  for (;;) {
    const m = /:(is|not|where)\(/.exec(s);
    if (!m) break;
    let n = 1, k = m.index + m[0].length;
    for (; k < s.length && n; k++) { if (s[k] === '(') n++; else if (s[k] === ')') n--; }
    const dentro = s.slice(m.index + m[0].length, k - 1);
    if (m[1] !== 'where') r = soma(r, dentro.split(',').map(peso).reduce(maior));
    s = s.slice(0, m.index) + ' ' + s.slice(k);
  }
  r[0] += (s.match(/#[\w-]+/g) || []).length;
  r[1] += (s.match(/\.[\w-]+|\[[^\]]*\]|:[\w-]+/g) || []).length;
  r[2] += (s.replace(/\[[^\]]*\]/g, '').match(/(^|[\s>+~])[a-z][\w-]*/gi) || []).length;
  return r;
}
const regras = () => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => ({ sel: m[1].trim(), corpo: m[2] }));
const pesa = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

test('terminal: o cabeçalho de 39 fica colado no corpo (a margem genérica da janelinha não ganha)', () => {
  const todas = regras();
  const generica = todas.find(r => /\.mo-top$/.test(r.sel) && /margin:0 0 16px/.test(r.corpo));
  assert.ok(generica, 'a regra genérica do .mo-top das janelinhas');
  const term = todas.filter(r => r.sel.split(',').some(s => /cx-terminal/.test(s) && /\.mo-top$/.test(s.trim())) && /(^|;)\s*margin:0(;|$)/.test(r.corpo));
  assert.ok(term.length, 'o terminal zera a margem do cabeçalho');
  const pg = peso(generica.sel.split(',').map(s => s.trim()).find(s => /\.mo-top$/.test(s)));
  for (const r of term) {
    const pt = peso(r.sel.split(',').map(s => s.trim()).find(s => /cx-terminal/.test(s)));
    assert.ok(pesa(pt, pg) > 0, 'o margin:0 do terminal (' + pt + ') tem de pesar mais que a regra genérica (' + pg + ')');
  }
});

test('quadro: o "Confirmar?" do Limpar leva texto branco num fundo feito para isso (--erro-fundo)', () => {
  const r = regras().find(x => /\.qd-bt\.perigo\.confirmando$/.test(x.sel));
  assert.ok(r, 'a regra do Limpar confirmando');
  assert.match(r.corpo, /background:var\(--erro-fundo\)/);
  assert.equal(/background:var\(--status-error\)[^}]*color:#fff/.test(r.corpo), false,
    '--status-error no escuro é vermelho de texto: branco por cima dá 2,8:1');
});

test('terminal: o contraste aumentado sobe os rótulos da barra (o comando passa de .4)', () => {
  const hc = regras().filter(r => /data-theme\$="-hc"\][^,]*\.cx-terminal/.test(r.sel));
  const cmd = hc.find(r => /\.term-cmd/.test(r.sel));
  assert.ok(cmd, 'regra -hc para o comando do terminal');
  const a = +(/rgba\(255,255,255,\s*(\.\d+)\)/.exec(cmd.corpo) || [])[1];
  assert.ok(a >= 0.6, 'o comando no -hc com alfa de pelo menos .6 (era .4): ' + a);
  assert.ok(hc.some(r => /\.mo-x/.test(r.sel)) && hc.some(r => /\.term-ic/.test(r.sel)), 'ícone e × também sobem');
});

test('nova aba: "Escolher pasta…" com a pasta fechada, como no desenho', () => {
  assert.match(app, /\$\('\.na-pasta-ic'\)\.innerHTML = ico\('folder'\);/);
});

test('estado pressionado: os botões das sheets e os pequenos de fora mudam ao apertar', () => {
  const ativos = regras().filter(r => /:active/.test(r.sel)).map(r => r.sel).join(' , ');
  for (const cls of ['na-motor', 'na-onde', 'na-atalho', 'na-pasta', 'visor-abrir', 'visor-x', 'mo-x',
    'mo-btn.perigo', 'ct-acao', 'cf-item', 'qd-mini', 'qd-zoom-bt', 'qd-fer', 'qd-esp-bt', 'qd-bt',
    'qd-bt.perigo', 'term-cancela', 'p-stop', 'uso-x', 'pn-edit', 'info']) {
    assert.ok(new RegExp('\\.' + cls.replace('.', '\\.') + '(?![\\w-])[^,]*:active').test(ativos), cls + ' sem :active');
  }
});

// helpers de vm (mesmo molde de tests/r1-app-2.test.cjs)
function funcao(nome) {
  const m = new RegExp('^(?:async )?function ' + nome + '\\(', 'm').exec(app);
  assert.ok(m, nome + ' existe em app.js');
  return app.slice(m.index, app.indexOf('\n}', m.index) + 2);
}
function classes() {
  const set = new Set();
  return { add: (...xs) => xs.forEach(x => set.add(x)), remove: (...xs) => xs.forEach(x => set.delete(x)),
    contains: x => set.has(x), toggle: (x, sim) => sim ? set.add(x) : set.delete(x) };
}
function el(extra = {}) {
  return { style: {}, classList: classes(), dataset: {}, value: '', innerHTML: '', textContent: '', nodes: {},
    children: [], appendChild(x) { this.children.push(x); return x; }, remove() {}, focus() {},
    getBoundingClientRect() { return { width: 660, height: 340 }; }, ...extra };
}

function montarTerminal(resultadoRun) {
  class TerminalFake { open() {} onData() {} write() {} resize() {} focus() {} dispose() {} }
  class Olho { observe() {} disconnect() {} }
  const cancela = el();
  const cx = el({ nodes: { '.mo-tit': el(), '.term-tela': el(), '.mo-x': el(), '#tmCancela': cancela,
    '.term-link': el({ nodes: { '.mono': el(), button: el() } }) } });
  const modal = el({ nodes: { '.modal-cx': cx } });
  const P = { el: { nodes: { '.p-modal': modal } } };
  let aoEvento = null;
  const c = { console, Map, Promise, window: { api: {
      onTermEvent: (fn) => { aoEvento = fn; }, termInput() {}, termKill() {}, openUrl() {},
      termResize: () => Promise.resolve(), termRun: () => Promise.resolve(resultadoRun) } },
    $: (sel, e) => (e && e.nodes && sel in e.nodes) ? e.nodes[sel] : null,
    Terminal: TerminalFake, ResizeObserver: Olho, ESTA_TELA: 'mac', termSeq: 0, termsVivos: new Map(),
    REG_LINK: /https?:\/\/\S+/g, semEscapes: (t) => t, fecharMenus() {}, fecharModal() {}, ico: () => '',
    document: { createElement: () => el() }, setTimeout: () => {} };
  vm.createContext(c);
  const i = app.indexOf('window.api.onTermEvent(');
  vm.runInContext(app.slice(i, app.indexOf('\n});', i) + 4), c);
  vm.runInContext(funcao('janelaTerminal'), c);
  c.janelaTerminal(P, 'codex login', 'Terminal');
  return { cancela, id: [...c.termsVivos.keys()][0], evento: (x) => aoEvento(x) };
}

test('terminal: o ■ de parar só fica na barra enquanto o comando roda', async () => {
  const t = montarTerminal({});
  assert.ok(t.id, 'o terminal se registrou');
  assert.equal(t.cancela.classList.contains('hidden'), false, 'rodando: o ■ está na barra');
  t.evento({ id: t.id, kind: 'data', data: 'Abrindo o navegador…' });
  assert.equal(t.cancela.classList.contains('hidden'), false, 'saída no meio não esconde o ■');
  t.evento({ id: t.id, kind: 'exit', code: 0 });
  assert.equal(t.cancela.classList.contains('hidden'), true, 'terminou: sobra só o ×');
});

test('terminal: comando que nem começou (erro ao rodar) também fica só com o ×', async () => {
  const t = montarTerminal({ error: 'sem shell' });
  await new Promise((r) => setImmediate(r));
  assert.equal(t.cancela.classList.contains('hidden'), true);
});

test('atalhos: a tela abre com o cursor no "Buscar atalho" (digitar já filtra)', () => {
  const tela = el(), lista = el(), icone = el();
  tela.classList.add('hidden');
  let focou = 0;
  const busca = el({ focus() { focou++; } });
  const nos = { '#telaAtalhos': tela, '#atLista': lista, '#atBusca': busca, '.at-busca-ic': icone };
  const c = { ATALHOS: [['Janela', [['⌘/', 'Atalhos do teclado']]]], teclaDoMac: (t) => t, ico: () => '<svg></svg>',
    $: (sel) => nos[sel] || null, document: { createElement: () => el() } };
  vm.createContext(c);
  vm.runInContext(funcao('alternarTelaAtalhos'), c);
  c.alternarTelaAtalhos();
  assert.equal(tela.classList.contains('hidden'), false, 'a tela abriu');
  assert.equal(focou, 1, 'o campo de busca ganhou o foco ao abrir');
  c.alternarTelaAtalhos();
  assert.equal(tela.classList.contains('hidden'), true, 'o mesmo atalho fecha');
  assert.equal(focou, 1, 'fechar não mexe no foco da busca');
});
