/* 26/09 (pedido dele, igual ao app do Codex): selecionar um trecho abre 3 ações — Responder, Mais
   detalhes (janelinha que pergunta em paralelo ao chat) e Perguntar no chat lateral. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const raiz = path.join(__dirname, '..');
const md = require('../mais-detalhes');
const app = fs.readFileSync(path.join(raiz, 'renderer/app.js'), 'utf8');
const main = fs.readFileSync(path.join(raiz, 'main.js'), 'utf8');

test('o pedido leva a conversa, a resposta, o trecho e o que já foi perguntado', () => {
  const p = md.montarPedido({ conversa: [{ quem: 'Você', texto: 'faz o relatório' }], resposta: 'As correções estão em andamento na cópia isolada.',
    trecho: 'em andamento', janela: [{ de: 'eu', texto: 'onde?' }, { de: 'ia', texto: 'na cópia' }], pergunta: 'e quando termina?' });
  for (const pedaco of ['faz o relatório', 'cópia isolada', 'Trecho selecionado:\n"em andamento"', 'Ele perguntou: onde?', 'Pergunta agora: e quando termina?']) assert.ok(p.includes(pedaco), pedaco);
  assert.ok(md.montarPedido({ trecho: 'x y' }).includes(md.PRIMEIRA), 'a 1a pergunta é a explicação');
  assert.equal(md.montarPedido({ trecho: '  ' }), '');
});

test('chamada avulsa: não vira conversa na lista, sem ferramenta, sem o CLAUDE.md', () => {
  const a = md.argsDoDetalhe('oi');
  for (const f of ['--no-session-persistence', '--strict-mcp-config']) assert.ok(a.includes(f), f);
  assert.equal(a[a.indexOf('--tools') + 1], '');
  assert.equal(a[a.indexOf('--setting-sources') + 1], '');
  assert.match(main, /handle\('detalhe:perguntar'/);
  for (const f of ['preload.js', 'renderer/web.js', 'servidor-web.js']) assert.match(fs.readFileSync(path.join(raiz, f), 'utf8'), /detalhe:perguntar/, f);
  assert.match(fs.readFileSync(path.join(raiz, 'package.json'), 'utf8'), /"mais-detalhes\.js"/);
});

test('a barrinha tem as 3 ações e o chat lateral nasce ramo com o trecho escrito', () => {
  assert.match(app, /\['Responder', \(x\) => citarTrecho\(x\.P, x\.texto\)\]/);
  assert.match(app, /\['Mais detalhes', \(x\) => abrirMaisDetalhes\(x\.P, x\.texto, x\.resposta\)\]/);
  assert.match(app, /\['Perguntar no chat lateral', \(x\) => perguntarNoChatLateral\(x\.P, x\.texto\)\]/);
  const i = app.indexOf('async function perguntarNoChatLateral(');
  const f = app.slice(i, app.indexOf('\n}\n', i));
  assert.match(f, /await ramificarInteiro\(P\);/, 'lembra da conversa inteira');
  assert.match(f, /inp\.value = 'Sobre este trecho: "'/);
});
