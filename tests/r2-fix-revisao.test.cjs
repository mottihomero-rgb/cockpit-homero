'use strict';
// Revisão final antes de instalar (26/09, rd/fix2): furos que os consertos da rodada 1 criaram
// um no outro. Cada teste falha sem o conserto.
//   1. fix1-caixa (↩ permite o pedido com o campo vazio) × fix1-celular (a dica esc / ↩ sai do
//      telefone porque "lá não há teclado"): no iPhone o "return" do teclado da tela, com o campo
//      vazio, permitia o pedido sem ninguém tocar no Permitir. Medido no servidor-web + Chromium
//      de iPhone 15: um Enter no campo vazio mandou pane:approve { allow: true } para "rm -rf build".
//   2. fix1-caixa (o anel da caixa some com camada por cima; o ↩ fora do campo não vale com
//      camada por cima) × fix1-painel (ir até um chat não pisca mais: quem mostra o chat em foco é
//      o anel): o visor ou a janelinha esquecido aberto numa aba de FUNDO (display:none, ninguém
//      vê) contava como camada por cima na aba da frente. Medido no Cockpit escondido: aba da
//      frente sem nada aberto, chat em foco com pedido, caixa sem o --anel-foco e o ↩ na conversa
//      sem permitir. O visor e a janelinha cobrem a janela inteira de propósito (sheets.css), então
//      na MESMA aba eles continuam tirando o anel de todo chat.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ler = (f) => fs.readFileSync(path.resolve(__dirname, '..', f), 'utf8');
const app = ler('renderer/app.js');
const semComentario = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '');
const caixa = semComentario(ler('renderer/redesign/caixa.css'));

function pegar(nome) {
  const m = new RegExp('^(?:async )?function ' + nome + '\\(', 'm').exec(app);
  assert.ok(m, nome + ' existe');
  return app.slice(m.index, app.indexOf('\n}', m.index) + 2);
}
const MQ_CELULAR = (/^const MQ_CELULAR = '([^']+)';/m.exec(app) || [])[1];

/* ---------------- 1. teclas do pedido: não no telefone ---------------- */
function botao(cls) {
  const c = new Set(cls.split(' '));
  return { cliques: 0, disabled: false, classList: { contains: (x) => c.has(x) }, click() { this.cliques++; } };
}
function montar(celular) {
  const bar = botao('pane-perm');
  const nos = { '.pane-perm': bar, '.pp-yes': botao('pp-yes'), '.pp-no': botao('pp-no'), '.pp-sempre': botao('pp-sempre') };
  const ctx = { $: (s) => nos[s] || null, MQ_CELULAR,
    window: { matchMedia: (q) => ({ matches: celular && q === MQ_CELULAR }) } };
  vm.createContext(ctx);
  vm.runInContext(pegar('teclaDoPedido') + '\nthis.tecla = teclaDoPedido;', ctx);
  const P = { aprovacaoAtual: { key: 'k' }, el: {} };
  return { tecla: ctx.tecla, P, nos };
}
const tecla = (key, extra = {}) => ({ key, altKey: false, metaKey: false, ctrlKey: false, shiftKey: false, isComposing: false,
  defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...extra });

test('no telefone o "return" do teclado da tela não permite o pedido (nem ⌥↩ nem esc)', () => {
  assert.ok(MQ_CELULAR, 'MQ_CELULAR existe no app.js');
  const { tecla: t, P, nos } = montar(true);
  const e = tecla('Enter');
  assert.equal(t(P, e), false, 'o Enter volta para o campo (vazio: não manda nada)');
  assert.equal(e.defaultPrevented, false);
  assert.equal(t(P, tecla('Enter', { altKey: true })), false);
  assert.equal(t(P, tecla('Escape')), false);
  assert.equal(nos['.pp-yes'].cliques + nos['.pp-sempre'].cliques + nos['.pp-no'].cliques, 0, 'nenhum botão foi clicado');
});

test('no Mac as teclas do pedido continuam valendo', () => {
  const { tecla: t, P, nos } = montar(false);
  assert.equal(t(P, tecla('Enter')), true); assert.equal(nos['.pp-yes'].cliques, 1);
  assert.equal(t(P, tecla('Escape')), true); assert.equal(nos['.pp-no'].cliques, 1);
});

test('tecla e dica valem nos mesmos lugares: a dica sai no mesmo @media da consulta da tecla', () => {
  // a regra solta (não a do .pp-sem-enter, que também termina em ".pp-tecla{display:none}")
  const m = /\n\s*\.pp-tecla\{display:none\}/.exec(caixa);
  assert.ok(m, 'a dica sai no telefone');
  const i = m.index;
  const abre = caixa.lastIndexOf('@media', i);
  const cab = caixa.slice(abre + '@media'.length, caixa.indexOf('{', abre)).trim();
  assert.equal(cab, MQ_CELULAR, 'a dica e a tecla usam a mesma consulta');
});

/* ---------------- 2. camada de uma aba de fundo não conta ---------------- */
// cada camada que mora num painel (menu, visor, janelinha) tem de vir presa à aba da frente
function camadasDePainel(lista) {
  return lista.split(',').map(s => s.trim()).filter(s => /p-modal|p-visor/.test(s));
}
test('visor ou janelinha esquecido numa aba de fundo não apaga o anel do chat em foco', () => {
  const m = /body:has\(([^{]+?)\) \.pane\.focus \.pane-cmp\{box-shadow:var\(--shadow-float\)\}/.exec(caixa);
  assert.ok(m, 'regra que tira o anel');
  const camadas = camadasDePainel(m[1]);
  assert.equal(camadas.length, 2, 'menu/janelinha e visor');
  for (const c of camadas) assert.match(c, /^\.espaco:not\(\.oculta\) \.pane \.p-(modal|visor):not\(\.hidden\)$/, 'só a aba da frente: ' + c);
});

test('e não trava o ↩ do pedido na aba da frente (mesma conta no app.js)', () => {
  const i = app.indexOf('const CAMADA_POR_CIMA =');
  assert.ok(i > 0);
  const js = app.slice(i, app.indexOf(';', i));
  const lista = [...js.matchAll(/'([^']*)'/g)].map(x => x[1]).join('');
  const camadas = camadasDePainel(lista);
  assert.equal(camadas.length, 2);
  for (const c of camadas) assert.match(c, /^\.espaco:not\(\.oculta\) \.pane \.p-(modal|visor):not\(\.hidden\)$/, 'só a aba da frente: ' + c);
  // a aba de fundo é a .espaco com .oculta (ativarAbaProjeto): se o nome mudar, o teste avisa
  assert.match(app, /B\.corpoEl\.classList\.toggle\('oculta', !on\)/);
  assert.match(ler('renderer/index.html'), /<template id="tplEspaco">\s*<div class="espaco"><\/div>/);
});
