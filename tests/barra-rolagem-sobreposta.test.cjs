'use strict';
/* Guarda da barra de rolagem como a sobreposta do Mac (conserto da base, rodada 1, 26/09/2026).
   O desenho do Claude Design não mostra barra de rolagem nenhuma, nem com a conversa rolável.
   O Cockpit mostrava o polegar SEMPRE na borda direita da conversa (e em toda área que rola),
   porque o base.css pintava o ::-webkit-scrollbar-thumb parado; o comentário dizia "aparece no
   hover", mas a regra não dependia de hover. Agora: parado, invisível; acende enquanto a pessoa
   rola (classe .rolando, posta pelo app.js) ou com o mouse em cima do polegar.
   O app.js é recortado de verdade e roda numa VM com um documento de mentira: sem o conserto,
   a rolada da pessoa na conversa não acende nada (o app.js só olhava o / e o @). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const raiz = path.resolve(__dirname, '..');
const ler = (f) => fs.readFileSync(path.join(raiz, f), 'utf8');
const semComentario = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

// corpo da regra cujo seletor é EXATAMENTE o pedido (ignora espaços; olha também dentro de @media)
function regra(css, seletor) {
  const alvo = seletor.replace(/\s+/g, '');
  for (const pedaco of css.split('}')) {
    const i = pedaco.lastIndexOf('{');
    if (i < 0) continue;
    const sels = pedaco.slice(0, i).split('{').pop().split(',').map((s) => s.replace(/\s+/g, ''));
    if (sels.includes(alvo)) return pedaco.slice(i + 1);
  }
  return null;
}

test('base.css: polegar invisível parado; aparece com .rolando e com o mouse em cima', () => {
  const css = semComentario(ler('renderer/redesign/base.css'));
  const parado = regra(css, '::-webkit-scrollbar-thumb');
  assert.ok(parado !== null, 'sumiu a regra do polegar parado');
  assert.match(parado, /background:\s*transparent/, 'o polegar parado tem de ser transparente (a referência não mostra barra)');
  assert.doesNotMatch(parado, /color-mix|rgba?\(|#[0-9a-f]{3,8}\b/i, 'o polegar parado voltou a ter cor');
  const rolando = regra(css, '.rolando::-webkit-scrollbar-thumb');
  assert.ok(rolando && /color-mix\(in srgb,\s*var\(--label-1\)/.test(rolando), 'rolando, o polegar tem de aparecer no tom do texto do tema');
  const emCima = regra(css, '::-webkit-scrollbar-thumb:hover');
  assert.ok(emCima && /color-mix\(in srgb,\s*var\(--label-1\)/.test(emCima), 'com o mouse em cima, o polegar tem de aparecer');
});

test('nenhuma área do redesenho pinta o polegar da conversa parado', () => {
  for (const a of fs.readdirSync(path.join(raiz, 'renderer/redesign')).filter((f) => f.endsWith('.css'))) {
    const css = semComentario(ler('renderer/redesign/' + a));
    const re = /([^{}]*pane-chat[^{}]*::-webkit-scrollbar-thumb[^{}]*)\{([^}]*)\}/g;
    let m;
    while ((m = re.exec(css))) {
      if (/:hover|:active|\.rolando/.test(m[1])) continue;
      assert.doesNotMatch(m[2], /background:\s*(?!transparent)/, a + ': o polegar da conversa ficou sempre à vista');
    }
  }
});

// recorta o bloco da barra de rolagem do app.js (do comentário até o fim do ouvinte de scroll)
function montar() {
  const src = ler('renderer/app.js');
  const ini = src.indexOf('/* Barra de rolagem');
  assert.ok(ini > 0, 'sumiu o bloco da barra de rolagem do app.js');
  const fim = src.indexOf('}, true);', ini);
  assert.ok(fim > ini, 'sumiu o fim do ouvinte de scroll');
  const bloco = src.slice(ini, fim + '}, true);'.length);

  const ouvintes = {};
  const document = { addEventListener: (tipo, fn) => { (ouvintes[tipo] = ouvintes[tipo] || []).push(fn); } };
  let agora = 1_000_000;
  const timers = new Map();
  let prox = 1;
  const ctx = {
    document,
    Date: { now: () => agora },
    setTimeout: (fn, ms) => { const id = prox++; timers.set(id, { fn, quando: agora + ms }); return id; },
    clearTimeout: (id) => { timers.delete(id); },
  };
  vm.runInNewContext(bloco, ctx);
  const disparar = (tipo, e) => (ouvintes[tipo] || []).forEach((fn) => fn(e));
  const passar = (ms) => {
    agora += ms;
    for (const [id, t] of [...timers]) if (t.quando <= agora) { timers.delete(id); t.fn(); }
  };
  const elemento = (...classes) => {
    const s = new Set(classes);
    return { tagName: 'DIV', classList: { contains: (c) => s.has(c), add: (c) => s.add(c), remove: (c) => s.delete(c) } };
  };
  return { disparar, passar, elemento };
}

test('a rolada da pessoa acende o polegar da conversa por um instante, e ele apaga sozinho', () => {
  const { disparar, passar, elemento } = montar();
  const chat = elemento('pane-chat');
  disparar('wheel', { target: chat });
  passar(16);
  disparar('scroll', { target: chat });
  assert.ok(chat.classList.contains('rolando'), 'rolando a conversa com o trackpad, o polegar tem de aparecer');
  passar(1000);
  assert.ok(!chat.classList.contains('rolando'), 'parou de rolar, o polegar tem de sumir');
});

test('a conversa descendo sozinha (assistente escrevendo) não acende o polegar', () => {
  const { disparar, passar, elemento } = montar();
  const chat = elemento('pane-chat');
  disparar('scroll', { target: chat });
  assert.ok(!chat.classList.contains('rolando'), 'rolagem do próprio app não pode acender a barra');
  disparar('wheel', { target: chat });
  passar(2000);
  disparar('scroll', { target: chat });
  assert.ok(!chat.classList.contains('rolando'), 'gesto antigo não vale para a rolagem de agora');
});

test('tecla de rolar acende; espaço digitado na caixa de escrever não', () => {
  const { disparar, passar, elemento } = montar();
  const chat = elemento('pane-chat');
  disparar('keydown', { key: ' ', target: { tagName: 'TEXTAREA' } });
  disparar('scroll', { target: chat });
  assert.ok(!chat.classList.contains('rolando'), 'digitar na caixa não é rolar a conversa');
  passar(1000);
  disparar('keydown', { key: 'PageDown', target: { tagName: 'BODY' } });
  disparar('scroll', { target: chat });
  assert.ok(chat.classList.contains('rolando'), 'Page Down rola: o polegar tem de aparecer');
});

test('o / e o @ continuam acendendo em toda rolada (a seta é digitada na caixa)', () => {
  const { disparar, elemento } = montar();
  const menu = elemento('menu-corpo');
  disparar('scroll', { target: menu });
  assert.ok(menu.classList.contains('rolando'));
});
