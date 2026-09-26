'use strict';
/* 26/09: o uso das IAs saiu da coluna de Conversas e virou um anel por IA no topo da janela
   (no jeito do Codenotch). Passar o mouse abre o cartão da IA com Sessão e Semana. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const raiz = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(raiz, 'renderer/app.js'), 'utf8');
const html = fs.readFileSync(path.join(raiz, 'renderer/index.html'), 'utf8');
const css = fs.readFileSync(path.join(raiz, 'renderer/redesign/janela.css'), 'utf8');

function pegar(nome) {
  const m = new RegExp('^(?:async )?function ' + nome + '\\(', 'm').exec(app);
  assert.ok(m, nome);
  let n = 0, i = app.indexOf('{', m.index);
  for (; i < app.length; i++) { if (app[i] === '{') n++; else if (app[i] === '}' && --n === 0) { i++; break; } }
  return app.slice(m.index, i);
}
function el() {
  const e = { dataset: {}, children: [], _html: '', attrs: {}, ouvintes: {}, removido: false,
    addEventListener(k, f) { this.ouvintes[k] = f; }, setAttribute(k, v) { this.attrs[k] = v; },
    remove() { this.removido = true; }, classList: { contains: () => false } };
  Object.defineProperty(e, 'innerHTML', { get() { return this._html; }, set(v) { this._html = v; } });
  return e;
}
function contexto() {
  const topo = { itens: [], insertBefore(b, ref) { const i = ref ? this.itens.indexOf(ref) : -1; if (i < 0) this.itens.push(b); else this.itens.splice(i, 0, b); } };
  const ctx = { Math, MOTORES_VISIVEIS: ['claude', 'codex', 'gemini', 'grok'], MOTORES_OK: null,
    document: { createElement: () => el() }, svgMotor: (m) => '<svg data-m="' + m + '"></svg>',
    nomeDoMotor: (m) => m[0].toUpperCase() + m.slice(1), abrirCartaoUso() {}, fecharCartaoUso() {}, abrirContaDaLateral() {},
    $: (sel, root) => { const m = /data-motor="(\w+)"/.exec(sel); if (m && root === topo) return topo.itens.find(b => b.dataset.motor === m[1] && !b.removido) || null; return null; } };
  vm.createContext(ctx);
  vm.runInContext(app.match(/^const nivelDeUso = .*;$/m)[0] + '\n' + ['pctDeUso', 'pintarAnelTopo', 'textoRenova'].map(pegar).join('\n'), ctx);
  return { ctx, topo };
}

test('o anel mostra a sessão (sem sessão, a semana) e fica vermelho a partir de 90%', () => {
  const { ctx, topo } = contexto();
  ctx.pintarAnelTopo(topo, 'claude', { entrou: true, sessao: { pct: 22 }, semana: { pct: 64 } });
  ctx.pintarAnelTopo(topo, 'codex', { entrou: true, semana: { pct: 95.4 } });
  const [cl, cx] = topo.itens;
  assert.match(cl.innerHTML, /22%/);
  assert.equal(cl.dataset.nivel, '');
  assert.match(cx.innerHTML, /95%/);
  assert.equal(cx.dataset.nivel, 'alto');
});

test('IA sem conta ou sem número de limite não aparece no topo', () => {
  const { ctx, topo } = contexto();
  ctx.pintarAnelTopo(topo, 'grok', { entrou: true, email: 'k@x.com' });
  ctx.pintarAnelTopo(topo, 'gemini', { entrou: false });
  assert.equal(topo.itens.length, 0);
});

test('a ordem dos anéis é a dos motores, chegue quem chegar primeiro', () => {
  const { ctx, topo } = contexto();
  ctx.pintarAnelTopo(topo, 'gemini', { entrou: true, semana: { pct: 5 } });
  ctx.pintarAnelTopo(topo, 'claude', { entrou: true, sessao: { pct: 1 } });
  assert.deepEqual(topo.itens.map(b => b.dataset.motor), ['claude', 'gemini']);
});

test('"Renova" diz o dia e a hora, como no Codenotch', () => {
  const { ctx } = contexto();
  const d = new Date(); d.setHours(23, 59, 0, 0);
  if (d > Date.now()) assert.equal(ctx.textoRenova(+d), 'Renova hoje, 23:59');
  assert.equal(ctx.textoRenova(Date.now() - 1000), 'Já renovou');
  const amanha = new Date(); amanha.setDate(amanha.getDate() + 1); amanha.setHours(9, 5, 0, 0);
  assert.equal(ctx.textoRenova(+amanha), 'Renova amanhã, 09:05');
});

test('no Mac o uso mora no topo, não na coluna; e o topo não é área de arrastar', () => {
  assert.match(html, /<div id="abasTopo">\s*<!--[^>]*-->\s*<div id="usoTopo"><\/div>/);
  assert.doesNotMatch(html, /id="cvUso"/);
  assert.match(css, /#usoTopo\{[^}]*-webkit-app-region:no-drag/);
});
