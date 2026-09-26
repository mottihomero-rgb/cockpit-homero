'use strict';
/* Guarda dos MENUS da caixa de escrever (redesenho 26/09, consertos da conferência rodada 1).
   O que não pode voltar sem ninguém ver:
   - o botão que abriu o menu ("/", Modelo, cadeado, "+") fica marcado com --fill-1 enquanto o
     menu está aberto, e a marca sai ao fechar ou quando outro botão abre outro menu;
   - o campo "Filtrar" do menu / não ganha o anel azul de foco ao abrir (o foco vem sozinho);
   - o vão até a caixa segue a referência menu a menu: Modelo 2 (e 20 da direita), Anexar 18,
     o resto 28. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ler = (f) => fs.readFileSync(path.resolve(__dirname, '..', f), 'utf8');
const app = ler('renderer/app.js');
const css = ler('renderer/redesign/menus.css');
const semComentario = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '');

function pegar(nome) {
  const m = new RegExp('^(?:async )?function ' + nome + '\\(', 'm').exec(app);
  assert.ok(m, 'sumiu a funcao ' + nome);
  return app.slice(m.index, app.indexOf('\n}', m.index) + 2);
}

/* ---- um painel de mentira, só com o que os menus consultam ---- */
function classes(ini) {
  const s = new Set(ini);
  return { add: (...c) => c.forEach(x => s.add(x)), remove: (...c) => c.forEach(x => s.delete(x)),
    contains: (c) => s.has(c), _s: s };
}
function no(cls, rect, tag = 'div') {
  const el = {
    tag, nodeType: 1, isConnected: true, filhos: [], pai: null, dataset: {}, innerHTML: '', offsetWidth: 0,
    classList: classes(cls.split('.').filter(Boolean)),
    style: { props: {}, setProperty(k, v) { this.props[k] = v; }, removeProperty(k) { delete this.props[k]; } },
    getBoundingClientRect: () => rect,
    getClientRects: () => (rect ? [rect] : []),
    // seletores simples: ".a.b", "button", separados por vírgula
    matches(sel) {
      return sel.split(',').some(p => {
        p = p.trim();
        if (p === 'button') return el.tag === 'button';
        if (p.startsWith('[')) return false;
        return p.split('.').filter(Boolean).every(c => el.classList.contains(c));
      });
    },
    closest(sel) { for (let x = el; x; x = x.pai) if (x.matches(sel)) return x; return null; },
    contains(x) { for (; x; x = x.pai) if (x === el) return true; return false; },
    add(...fs) { for (const f of fs) { f.pai = el; el.filhos.push(f); } return el; },
  };
  Object.defineProperty(el, 'className', { get: () => [...el.classList._s].join(' '),
    set: (v) => { el.classList._s.clear(); String(v).split(/\s+/).filter(Boolean).forEach(c => el.classList._s.add(c)); } });
  return el;
}
const R = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height });

function montar() {
  // medidas da tela de 1470 da referência: painel da direita, caixa começando em 839
  const cx = no('.modal-cx');
  const modal = no('.modal.p-modal.hidden', R(1006, 40, 464, 880)).add(cx);
  const bt = {
    plus: no('.cb.p-plus', R(1012, 879, 26, 26), 'button'),
    slash: no('.cb.p-slash', R(1038, 879, 26, 26), 'button'),
    model: no('.p-model', R(1246, 879, 76, 26), 'button'),
    modo: no('.modo-btn.p-modo', R(1348, 879, 24, 26), 'button'),
  };
  const input = no('.p-input', R(1020, 845, 430, 21), 'textarea');
  const cmp = no('.pane-cmp', R(1014, 839, 448, 73)).add(input, no('.cmp-bar', R(1020, 879, 436, 28)).add(...Object.values(bt)));
  const nome = no('.pane-nome', R(1006, 48, 464, 28));
  const pane = no('.pane', R(1006, 40, 464, 880), 'section').add(no('.pane-hd'), modal, nome, cmp);
  const P = { id: 1, el: pane };
  const achar = (sel, raiz) => { for (const f of raiz.filhos) { if (f.matches(sel)) return f; const r = achar(sel, f); if (r) return r; } return null; };
  const ctx = {
    $: (sel, raiz) => (typeof sel === 'string' ? achar(sel, raiz) : sel),
    panes: new Map([[1, P]]),
    window: { event: null },
    menuSaindo: () => {}, soltarNavArquivos: () => {}, requestAnimationFrame: () => {},
  };
  vm.createContext(ctx);
  for (const f of ['soltarDonoMenu', 'lugarProprioNaCaixa', 'fecharMenus', 'novoMenu', 'ancoraDoMenu', 'posicionarMenu']) {
    vm.runInContext(pegar(f), ctx);
  }
  const clicar = (alvo, js) => { ctx.window.event = { type: 'click', target: alvo }; ctx.P = P; vm.runInContext(js, ctx); ctx.window.event = null; };
  const marcados = () => [...Object.entries(bt), ['input', input], ['nome', nome]].filter(([, b]) => b.classList.contains('menu-dono')).map(([k]) => k);
  return { P, ctx, bt, cx, modal, input, nome, clicar, marcados };
}

test('menu aberto: o botão que abriu fica marcado; fechar ou abrir outro tira a marca', () => {
  const { P, ctx, bt, clicar, marcados } = montar();
  clicar(bt.slash, "novoMenu(P, '.p-slash')");
  assert.deepEqual(marcados(), ['slash'], '"/" marcado com o menu de comandos aberto');
  // outro botão abre outro menu: a marca muda de dono, nunca fica em dois
  clicar(bt.plus, "novoMenu(P, '.p-plus')");
  assert.deepEqual(marcados(), ['plus']);
  clicar(bt.model, "novoMenu(P, '.p-model')");
  assert.deepEqual(marcados(), ['model']);
  clicar(bt.modo, "novoMenu(P, '.p-modo')");
  assert.deepEqual(marcados(), ['modo']);
  // fechou: ninguém marcado
  vm.runInContext('fecharMenus()', ctx);
  assert.deepEqual(marcados(), []);
  // sem clique (atalho, robô de prints): vale o botão padrão do menu
  ctx.P = P; vm.runInContext("novoMenu(P, '.p-model')", ctx);
  assert.deepEqual(marcados(), ['model']);
  vm.runInContext('fecharMenus()', ctx);
  assert.deepEqual(marcados(), []);
});

test('"/" → Modelo: o menu novo fica no lugar do "/" e o "/" continua marcado', () => {
  const { P, ctx, bt, cx, clicar, marcados } = montar();
  clicar(bt.slash, "novoMenu(P, '.p-slash')");
  // o item "Modelo" do menu / é clicado: ele some antes do menu novo nascer (isConnected false)
  const item = no('.mi'); item.isConnected = false;
  clicar(item, "novoMenu(P, '.p-model')");
  assert.deepEqual(marcados(), ['slash']);
  assert.equal(cx.style.props['--menu-l'], '10px', 'fica à esquerda, onde o "/" está');
  assert.equal(cx.style.props['--menu-b'], (920 - 839 + 28) + 'px', 'vão do "/", não o do Modelo');
  vm.runInContext('fecharMenus()', ctx);
  assert.deepEqual(marcados(), []);
});

test('âncora fora da caixa (nome do chat, campo do "@") ganha a marca, mas o CSS não pinta', () => {
  const { P, ctx, nome, marcados } = montar();
  ctx.P = P; ctx.nome = nome;
  vm.runInContext('novoMenu(P, nome)', ctx);
  assert.deepEqual(marcados(), ['nome']);
  vm.runInContext("novoMenu(P, '.p-input')", ctx);
  assert.deepEqual(marcados(), ['input'], 'a marca sai do nome quando o "@" abre');
  // a regra só alcança o que mora na barra da caixa (.cmp-bar): nome e campo ficam de fora
  const regra = /([^{}]*\.menu-dono)\s*\{background:var\(--fill-1\)\}/.exec(semComentario(css));
  assert.ok(regra, 'falta a regra do .menu-dono em --fill-1 no menus.css');
  assert.match(regra[1], /\.cmp-bar\s+\.menu-dono$/);
});

test('menus.css: a marca só pinta com um menu aberto de verdade, e só no desenho do Mac', () => {
  const limpo = semComentario(css);
  const regra = /([^{}]*\.menu-dono)\s*\{background:var\(--fill-1\)\}/.exec(limpo);
  assert.ok(regra);
  assert.match(regra[1], /\.pane:has\(> \.p-modal\.como-menu:not\(\.hidden\)\)/,
    'sem o :has, um caminho que tira o como-menu sem fecharMenus deixaria o botão marcado');
  // dentro do bloco do popover (o celular tem o menu do rodapé, sem botão marcado)
  const bloco = limpo.indexOf('@container style(--menus-mac: 1)');
  assert.ok(bloco >= 0 && regra.index > bloco, 'a regra fica no bloco do Mac (--menus-mac)');
});

test('campo "Filtrar" do menu /: sem anel de foco ao abrir', () => {
  const limpo = semComentario(css);
  assert.doesNotMatch(limpo, /\.menu-filtro:focus-within\s*\{[^}]*anel-foco/,
    'o foco vai sozinho para o campo quando o menu abre: o anel azul aparecia sempre');
  assert.doesNotMatch(limpo, /\.menu-search:focus[^{]*\{[^}]*anel-foco/);
  // o campo continua com o desenho da referência: fundo --fill-2, raio 6, 26 de altura
  assert.match(limpo, /\.menu-filtro\{[^}]*height:26px[^}]*border-radius:6px[^}]*background:var\(--fill-2\)/);
});

test('vão até a caixa por menu, como na referência: Modelo 2 e 20 da direita, Anexar 18, resto 28', () => {
  const casos = [
    ['slash', "'.p-slash'", { '--menu-l': '10px', '--menu-b': (920 - 839 + 28) + 'px' }],
    ['modo', "'.p-modo'", { '--menu-r': '16px', '--menu-b': (920 - 839 + 28) + 'px' }],
    ['model', "'.p-model'", { '--menu-r': '20px', '--menu-b': (920 - 839 + 2) + 'px' }],
    ['plus', "'.p-plus'", { '--menu-l': '10px', '--menu-b': (920 - 839 + 18) + 'px' }],
  ];
  for (const [b, padrao, esperado] of casos) {
    const { bt, cx, clicar } = montar();
    clicar(bt[b], 'novoMenu(P, ' + padrao + ')');
    for (const [k, v] of Object.entries(esperado)) assert.equal(cx.style.props[k], v, b + ' ' + k);
  }
  // o "@" nasce do campo de texto (também na caixa): fica no vão padrão
  const { P, ctx, cx } = montar();
  ctx.P = P; vm.runInContext("novoMenu(P, '.p-input')", ctx);
  assert.equal(cx.style.props['--menu-b'], (920 - 839 + 28) + 'px');
});
