/* 26/09 (pedido dele): o "Continuar" aparecia no meio da conversa — o Claude fechava um turno e abria
   outro sozinho, e a resposta nova descia embaixo do botão. Agora ele só nasce depois de 1,5 s sem
   nada novo, sai com qualquer coisa nova do motor e sai antes da fala dele entrar. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const app = fs.readFileSync(path.join(__dirname, '..', 'renderer/app.js'), 'utf8');
const pegar = (nome) => { const i = app.indexOf('function ' + nome + '('); assert.ok(i >= 0); return app.slice(i, app.indexOf('\n}\n', i) + 2); };

test('fim de turno: o Continuar espera 1,5 s de silêncio', () => {
  const r = pegar('receberEventoPane');
  const fim = r.slice(r.indexOf("case 'turn-end':"), r.indexOf("case 'engine-down':"));
  assert.doesNotMatch(fim, /^\s*mostrarContinuar\(P\);/m, 'não pode mais nascer na hora');
  assert.match(fim, /P\.contTimer = setTimeout\(\(\) => \{ P\.contTimer = 0; if \(panes\.get\(P\.id\) === P && !P\.busy && !P\.queued\) mostrarContinuar\(P\); \}, 1500\);/);
});

test('qualquer coisa nova do motor tira o Continuar; no Claude o chat volta a trabalhando', () => {
  const r = pegar('receberEventoPane');
  const topo = r.slice(0, r.indexOf('switch (ev.kind)'));
  for (const k of ['text-delta', 'tool-start', 'think-delta', 'busy']) assert.ok(topo.includes("'" + k + "'"), k);
  assert.match(topo, /limparContinuar\(P\);/);
  assert.match(topo, /if \(!P\.busy && P\.engine === 'claude'/);
});

test('a fala dele sai: o Continuar some antes da bolha dela', () => {
  assert.match(pegar('send'), /if \(P\.contTimer\) \{ clearTimeout\(P\.contTimer\); P\.contTimer = 0; \}\n\s*if \(!P\.busy\) limparContinuar\(P\);/);
});
