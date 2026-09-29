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
  const chamadas = { cartao: [], conta: [] };
  const ctx = { Math, MOTORES_VISIVEIS: ['claude', 'codex', 'gemini', 'grok'], MOTORES_OK: null,
    document: { createElement: () => el() }, svgMotor: (m) => '<svg data-m="' + m + '"></svg>',
    nomeDoMotor: (m) => m[0].toUpperCase() + m.slice(1), abrirCartaoUso: (_, m) => chamadas.cartao.push(m),
    fecharCartaoUso() {}, abrirContaDaLateral: (m) => chamadas.conta.push(m),
    $: (sel, root) => { const m = /data-motor="(\w+)"/.exec(sel); if (m && root === topo) return topo.itens.find(b => b.dataset.motor === m[1] && !b.removido) || null; return null; } };
  vm.createContext(ctx);
  vm.runInContext(app.match(/^const nivelDeUso = .*;$/m)[0] + '\n' + ['pctDeUso', 'pintarAnelTopo', 'textoRenova'].map(pegar).join('\n'), ctx);
  return { ctx, topo, chamadas };
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

test('as quatro IAs ficam no topo; sem conta não abrem cartão nem conta', () => {
  const { ctx, topo, chamadas } = contexto();
  ctx.pintarAnelTopo(topo, 'grok', { entrou: true, email: 'k@x.com' });
  ctx.pintarAnelTopo(topo, 'gemini', { entrou: false });
  ctx.pintarAnelTopo(topo, 'codex', null);
  ctx.pintarAnelTopo(topo, 'claude', { entrou: false });
  assert.deepEqual(topo.itens.map(b => b.dataset.motor), ['claude', 'codex', 'gemini', 'grok']);
  for (const b of topo.itens.slice(0, 3)) {
    assert.equal(b.disabled, true);
    assert.match(b.innerHTML, /ut-pct">—/);
    b.ouvintes.mouseenter(); b.ouvintes.focus(); b.ouvintes.click();
  }
  assert.deepEqual(chamadas, { cartao: [], conta: [] });
  assert.equal(topo.itens[3].disabled, false, 'conta sem número continua ativa');
  topo.itens[3].ouvintes.mouseenter();
  assert.deepEqual(chamadas.cartao, ['grok']);
});

test('o mesmo ícone ativa após login e congela após sair', () => {
  const { ctx, topo, chamadas } = contexto();
  ctx.pintarAnelTopo(topo, 'claude', { entrou: false });
  const b = topo.itens[0];
  ctx.pintarAnelTopo(topo, 'claude', { entrou: true, sessao: { pct: 42 } });
  assert.equal(topo.itens[0], b);
  assert.equal(b.disabled, false);
  assert.match(b.innerHTML, /42%/);
  b.ouvintes.click();
  assert.deepEqual(chamadas.conta, ['claude']);
  ctx.pintarAnelTopo(topo, 'claude', { entrou: false });
  assert.equal(b.disabled, true);
  assert.match(b.innerHTML, /ut-pct">—/);
  b.ouvintes.click();
  assert.deepEqual(chamadas.conta, ['claude']);
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

test('Grok com a semana aberta e nada gasto (sem creditUsagePercent) vira 0%, como no Codenotch', () => {
  const main = fs.readFileSync(path.join(raiz, 'main.js'), 'utf8');
  const pegarM = (nome) => { const i = main.indexOf('function ' + nome + '('); let k = main.indexOf('{', i), d = 0;
    for (; k < main.length; k++) { if (main[k] === '{') d++; else if (main[k] === '}' && --d === 0) break; } return main.slice(i, k + 1); };
  const ctx = {}; vm.createContext(ctx);
  vm.runInContext(pegarM('pctDoGrok') + pegarM('janelasDoGrok') + ';this.j = janelasDoGrok;', ctx);
  // a resposta real do billing?format=credits no primeiro dia da semana
  const cfg = { currentPeriod: { type: 'USAGE_PERIOD_TYPE_WEEKLY', start: '2026-09-26T02:15:49Z', end: '2099-10-03T02:15:49Z' },
    onDemandCap: { val: 0 }, onDemandUsed: { val: 0 } };
  const r = ctx.j(cfg, 0);
  assert.equal(r.semana.pct, 0);
  assert.equal(r.sessao, null);
  assert.equal(ctx.j({ onDemandCap: { val: 0 } }, 0).semana, null, 'sem período nenhum continua sem número');
});

test('Grok com login vencido (401) renova pelo próprio CLI e lê o uso de novo, em vez de sumir do topo', async () => {
  const main = fs.readFileSync(path.join(raiz, 'main.js'), 'utf8');
  const pegarM = (nome) => { const i = main.indexOf('function ' + nome + '('); const a = main.lastIndexOf('\n', i) + 1; let k = main.indexOf('{', i), d = 0;
    for (; k < main.length; k++) { if (main[k] === '{') d++; else if (main[k] === '}' && --d === 0) break; } return main.slice(a, k + 1); };
  let token = 'velho', renovou = 0;
  const ctx = { Date, Promise, JSON, USO_VALE_MS: 60000, usoGrok: { geracao: 0 }, ultimoBomGrok: () => null, nomePlanoGrok: (t) => t || '',
    grokVenceu: () => false,
    renovarLoginDoGrok: async () => { renovou++; token = 'novo'; return true; },
    contasCli: { tokenGrok: () => token },
    fetch: async (url, { headers }) => {
      const ok = headers.Authorization === 'Bearer novo';
      return { ok, status: ok ? 200 : 401, headers: { get: () => null }, json: async () => ({ config: { currentPeriod: { end: '2099-01-01' } } }) };
    } };
  vm.createContext(ctx);
  vm.runInContext(pegarM('buscarUsoDoGrok') + ';this.b = buscarUsoDoGrok;', ctx);
  const r = await ctx.b();
  assert.equal(renovou, 1);
  assert.ok(r && r.cfg && r.cfg.currentPeriod, 'voltou com o uso depois de renovar');
  // renovou e ainda deu 401: não entra em laço
  token = 'velho'; ctx.renovarLoginDoGrok = async () => { renovou++; return true; };
  assert.equal(await ctx.b(), null);
  assert.equal(renovou, 2);
});
