'use strict';
// R2-041: no boot, main.js sobe o servidor com endereco placeholder e so troca depois
// (web.endereco = end, quando o tailscale responde). Antes do conserto essa troca nao
// chegava em mesmaOrigem()/receberUpload(), presas no PARAMETRO original: o celular ficava
// travado pra sempre em "origem invalida", mesmo com o endereco certo. Este teste reproduz
// exatamente essa sequencia (placeholder -> troca tardia -> conexao real).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const WebSocket = require('ws');
const { criar } = require('../servidor-web');

function temporaria(t) {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-r2-celular-'));
  t.after(() => fs.rmSync(raiz, { recursive: true, force: true }));
  return raiz;
}

async function servidorComPlaceholder(t) {
  const raiz = temporaria(t);
  const tela = path.join(raiz, 'tela'), colados = path.join(raiz, 'colados');
  fs.mkdirSync(tela); fs.mkdirSync(colados);
  fs.writeFileSync(path.join(tela, 'index-web.html'), 'tela de teste');
  const ouvintes = new Set();
  // igual ao boot real (main.js:6348): sobe com placeholder, sem o endereco final ainda
  const s = criar({ pastaRenderer: tela, pastaColados: colados, senha: 'teste',
    somenteTailscale: true, porta: 0, ouvintes, handlers: { 'sys:home': () => '/teste' },
    endereco: 'Endereço: carregando…' });
  await s.pronto;
  t.after(() => { for (const ws of ouvintes) ws.terminate(); s.fechar(); s.servidor.closeAllConnections?.(); });
  const origem = 'http://127.0.0.1:' + s.servidor.address().port;
  const r = await fetch(origem + '/entrar', { method: 'POST', redirect: 'manual', body: 's=teste' });
  const cookie = r.headers.get('set-cookie').split(';')[0];
  return { s, origem, cookie };
}

test('R2-041: WebSocket conecta com o endereco final depois da troca tardia (web.endereco = end)',
  { timeout: 5000 }, async t => {
  const { s, origem, cookie } = await servidorComPlaceholder(t);
  const enderecoFinal = 'https://cockpit-final.tailnet.test';

  // com o placeholder ainda no ar, o endereco final de verdade nao bate (correto recusar)
  const cedo = new WebSocket(origem.replace('http:', 'ws:') + '/ws', {
    headers: { Origin: enderecoFinal, Cookie: cookie },
  });
  t.after(() => cedo.terminate());
  assert.equal((await once(cedo, 'close'))[0], 1008);

  // simula exatamente o main.js:6349: enderecoTailscale().then((end) => { web.endereco = end; })
  s.endereco = enderecoFinal;

  // agora o iPhone conectando com o endereco real tem que ser aceito. Sem o conserto o
  // servidor nunca fecha nem abre a conexao (fica preso no placeholder pra sempre) e o
  // teste estoura o timeout acima em vez de travar o `npm test` inteiro.
  const tarde = new WebSocket(origem.replace('http:', 'ws:') + '/ws', {
    headers: { Origin: enderecoFinal, Cookie: cookie },
  });
  t.after(() => tarde.terminate());
  await once(tarde, 'open');
  const resposta = once(tarde, 'message');
  tarde.send(JSON.stringify({ tipo: 'chamada', id: 1, nome: 'sys:home' }));
  assert.equal(JSON.parse(String((await resposta)[0])).resposta, '/teste');
});

test('R2-041: upload de foto tambem passa a aceitar o endereco final depois da troca', async t => {
  const { s, origem, cookie } = await servidorComPlaceholder(t);
  const enderecoFinal = 'https://cockpit-final.tailnet.test';
  const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(20, 0x31)]);

  s.endereco = enderecoFinal;

  const r = await fetch(origem + '/upload', {
    method: 'POST', headers: { Cookie: cookie, Origin: enderecoFinal }, body: png,
  });
  assert.equal(r.status, 200);
});

test('R2-041: web.endereco lido continua sendo o valor certo depois da troca (contrato do web:estado)', async t => {
  const { s } = await servidorComPlaceholder(t);
  assert.equal(s.endereco, 'Endereço: carregando…');
  s.endereco = 'https://cockpit-final.tailnet.test';
  assert.equal(s.endereco, 'https://cockpit-final.tailnet.test');
});
