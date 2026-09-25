'use strict';

// Teste de guarda do lote "main" (R1) — faixa consertador, rodada 1, lote 4.
// Cobre: R1-014 (a caixa de entrada zerava inboxVistos por INTEIRO ao passar de 500 itens;
// um arquivo ainda pendente na pasta, cujo registro sumia na limpeza, voltava a ser
// anunciado como mensagem nova na proxima varredura).
// Padrao de arquivo: tests/main-harness.cjs + tests/r1-main-3.test.cjs.

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadMain } = require('./main-harness.cjs');

test('R1-014: estourar o cache de vistos nao reanuncia arquivo ainda pendente na pasta', () => {
  const h = loadMain();
  const MTIME = Date.now() - 100000; // bem antigo: fora da janela de "recem-escrito" (700ms)

  h.evaluate(`
    globalThis.__avisos = [];
    win = { isDestroyed: () => false, webContents: {
      isLoading: () => false,
      send: (canal, dados) => { globalThis.__avisos.push(dados); },
    } };
    inboxOuvinte = true;
    // so existe UM arquivo de verdade na pasta: "pendente.txt", que o Homero nunca "usou"
    fs.readdirSync = () => ['pendente.txt'];
    fs.statSync = () => ({ isFile: () => true, mtimeMs: ${MTIME} });
    // simula meses de uso: 501 registros de arquivos JA apagados (consumidos ha muito tempo)
    for (let i = 0; i < 501; i++) inboxVistos.add('lixo' + i + ':1');
  `);
  assert.equal(h.evaluate('inboxVistos.size'), 501, 'preparo: cache comecou cheio de lixo');

  h.evaluate('varrerInbox()'); // 1a varredura: anuncia pendente.txt (e' novo) e estoura os 500

  assert.equal(h.evaluate('globalThis.__avisos.length'), 1, '1a varredura tem de anunciar pendente.txt uma vez');
  assert.equal(h.evaluate('inboxVistos.size'), 1, 'poda tem de sobrar so o arquivo ainda pendente');
  assert.equal(
    h.evaluate("[...inboxVistos].every(k => k.startsWith('pendente.txt:'))"),
    true,
    'poda nao pode deixar sobrar registro de arquivo que ja sumiu da pasta',
  );

  h.evaluate('varrerInbox()'); // 2a varredura: pendente.txt continua exatamente igual na pasta

  assert.equal(
    h.evaluate('globalThis.__avisos.length'),
    1,
    'arquivo que so estava pendente (nunca usado) NAO pode ser reanunciado como novo',
  );
});
