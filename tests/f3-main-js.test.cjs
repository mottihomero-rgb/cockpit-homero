'use strict';
/* O indice da busca por dentro das conversas.

   Ele era UM arquivo JSON so. Toda busca lia, montava e (4 segundos depois) regravava os
   168 MB inteiros dentro do processo que desenha a janela: o app parava e a memoria subia
   1 GB. Agora sao dois arquivos — carimbos (miudo, fica na memoria) e texto (uma conversa
   por linha, lido de pedaco em pedaco e jogado fora).

   Aqui esta o que nao pode voltar a quebrar. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadMain } = require('./main-harness.cjs');

const CARIMBOS = '/cockpit-test/home/.cockpit/indice-carimbos.json';
const TEXTO = '/cockpit-test/home/.cockpit/indice-texto.ndjson';
const VELHO = '/cockpit-test/home/.cockpit/indice-busca.json';

/* O harness troca o sistema de arquivos por um de mentira, que nao sabe ler pedaco de arquivo
   nem tem setImmediate. Estas duas pecas sao so isso: o basico para o codigo de verdade rodar. */
function prepararFalso(h) {
  h.evaluate(`
    globalThis.setImmediate = (fn) => Promise.resolve().then(fn);
    globalThis.__lidos = [];
    const __abertos = new Map();
    let __fd = 10;
    const __leitura = fs.readFileSync;
    fs.readFileSync = (nome, enc) => { __lidos.push(String(nome)); return __leitura(nome, enc); };
    fs.openSync = (nome) => { const fd = __fd++; __abertos.set(fd, Buffer.from(__leitura(nome))); return fd; };
    fs.fstatSync = (fd) => ({ size: __abertos.get(fd).length });
    fs.readSync = (fd, buf, off, len, pos) => {
      const b = __abertos.get(fd);
      const n = Math.max(0, Math.min(len, b.length - pos));
      b.copy(buf, off, pos, pos + n);
      return n;
    };
    fs.closeSync = (fd) => { __abertos.delete(fd); };
  `);
  return h;
}

// uma conversa de mentira no formato .jsonl que o Claude grava
function porConversa(h, nome, ...falas) {
  const texto = falas.map((t) => JSON.stringify({ type: 'user', message: { role: 'user', content: t } })).join('\n') + '\n';
  h.put(nome, texto);
  return nome;
}
function tamanho(h, nome) { return h.files.get(nome).length; }
function linhasDoTexto(h) {
  const b = h.files.get(TEXTO);
  return b ? String(b).split('\n').filter(Boolean) : [];
}
function buscar(h, termo, itens) {
  return h.call('sessions:buscar', { engine: 'claude', termo, itens });
}

/* ---- 1. o indice velho vira o novo sem perder nada ---- */

test('o JSON unico antigo e convertido para uma conversa por linha e depois apagado', async () => {
  const h = prepararFalso(loadMain());
  const f = porConversa(h, h.HOME + '/bolo.jsonl', 'receita de bolo de cenoura');
  // o carimbo antigo tem de bater com o arquivo, senao a conversa seria reindexada
  h.put(VELHO, JSON.stringify({ [f]: { m: 1, t: tamanho(h, f), x: 'receita de bolo de cenoura' } }));

  const r = await buscar(h, 'cenoura', [{ id: 'c1', file: f }]);

  assert.equal(r.achados.length, 1, 'a conversa convertida tem de continuar sendo achada');
  assert.match(r.achados[0].trecho, /cenoura/);
  assert.equal(h.files.has(VELHO), false, 'o arquivo velho tem de sumir depois de convertido');
  assert.equal(linhasDoTexto(h).length, 2, 'a linha legada é preservada até a faxina, e a conversa é reindexada pelo parser novo');
  assert.equal(linhasDoTexto(h).map(JSON.parse).filter(x => x.v === 2).length, 1, 'só uma linha atual vale para a conversa');
});

/* ---- 2. a busca NUNCA le o arquivo de texto inteiro ---- */

test('a busca passa pelo arquivo de texto em pedacos, nunca de uma vez so', async () => {
  const h = prepararFalso(loadMain());
  const a = porConversa(h, h.HOME + '/a.jsonl', 'tratamento de queda de cabelo');
  const b = porConversa(h, h.HOME + '/b.jsonl', 'planilha de custo do lancamento');
  await buscar(h, 'queda', [{ id: 'a', file: a }, { id: 'b', file: b }]);

  h.evaluate('__lidos.length = 0');
  const r = await buscar(h, 'queda', [{ id: 'a', file: a }, { id: 'b', file: b }]);

  assert.equal(r.achados.length, 1);
  assert.equal(r.achados[0].id, 'a');
  const lidos = h.evaluate('__lidos.slice()');
  assert.equal(lidos.includes(TEXTO), false, 'o arquivo de texto nao pode ser lido inteiro na busca');
});

/* ---- 3. conversa nova e ACRESCENTADA, o resto do arquivo nao e reescrito ---- */

test('indexar a segunda conversa nao mexe no pedaco ja gravado da primeira', async () => {
  const h = prepararFalso(loadMain());
  const a = porConversa(h, h.HOME + '/a.jsonl', 'primeira conversa');
  await buscar(h, 'primeira', [{ id: 'a', file: a }]);
  const antes = String(h.files.get(TEXTO));

  const b = porConversa(h, h.HOME + '/b.jsonl', 'segunda conversa');
  await buscar(h, 'segunda', [{ id: 'a', file: a }, { id: 'b', file: b }]);
  const depois = String(h.files.get(TEXTO));

  assert.equal(depois.startsWith(antes), true, 'o que ja estava gravado tem de ficar onde estava');
  assert.equal(linhasDoTexto(h).length, 2);
});

/* ---- 4. a ordem na tela e a da lista que chegou (mais nova primeiro) ---- */

test('os achados saem na ordem da lista, nao na ordem do arquivo', async () => {
  const h = prepararFalso(loadMain());
  const velha = porConversa(h, h.HOME + '/velha.jsonl', 'orcamento aprovado');
  const nova = porConversa(h, h.HOME + '/nova.jsonl', 'orcamento revisado');
  // indexa a velha PRIMEIRO: ela fica na frente dentro do arquivo
  await buscar(h, 'orcamento', [{ id: 'v', file: velha }]);

  const r = await buscar(h, 'orcamento', [{ id: 'n', file: nova }, { id: 'v', file: velha }]);

  // o join e de proposito: a lista nasce dentro do harness, entao nao e o mesmo tipo Array daqui
  assert.equal(Array.from(r.achados).map((x) => x.id).join(','), 'n,v');
});

/* ---- 5. conversa que mudou: vale a linha nova, nao a velha ---- */

test('conversa editada e achada pelo texto novo e nao pelo que saiu dela', async () => {
  const h = prepararFalso(loadMain());
  const f = porConversa(h, h.HOME + '/chat.jsonl', 'combinamos o almoco de terca');
  await buscar(h, 'almoco', [{ id: 'c', file: f }]);

  porConversa(h, f, 'combinamos o jantar de quinta-feira, sem pressa nenhuma');
  const sumiu = await buscar(h, 'almoco', [{ id: 'c', file: f }]);
  const achou = await buscar(h, 'jantar', [{ id: 'c', file: f }]);

  assert.equal(sumiu.achados.length, 0, 'a linha velha nao pode mais valer');
  assert.equal(achou.achados.length, 1, 'o texto novo tem de ser achado');
  assert.equal(linhasDoTexto(h).length, 2, 'a linha velha continua no arquivo ate a faxina');
});

/* ---- 6. conversa apagada some da busca na hora ---- */

test('sem carimbo a conversa nao aparece mais, mesmo com a linha ainda no arquivo', async () => {
  const h = prepararFalso(loadMain());
  const f = porConversa(h, h.HOME + '/chat.jsonl', 'contrato assinado ontem');
  await buscar(h, 'contrato', [{ id: 'c', file: f }]);
  h.evaluate(`delete lerCarimbos()[${JSON.stringify(f)}]`);
  h.files.delete(f);   // o arquivo foi para a Lixeira

  const r = await buscar(h, 'contrato', [{ id: 'c', file: f }]);

  assert.equal(r.achados.length, 0);
  assert.equal(linhasDoTexto(h).length, 1, 'a linha orfa so sai na faxina');
});

/* ---- 7. termo com aspas: o atalho da linha crua nao pode esconder o resultado ---- */

test('procurar com aspas continua achando', async () => {
  const h = prepararFalso(loadMain());
  const f = porConversa(h, h.HOME + '/chat.jsonl', 'ele disse "pode subir" na reuniao');
  const r = await buscar(h, '"pode subir"', [{ id: 'c', file: f }]);
  assert.equal(r.achados.length, 1, 'aspas viram escape dentro do JSON: o atalho tem de se desligar');
});

/* ---- 8. a faxina joga fora a linha velha e a orfa, e guarda a que vale ---- */

test('a faxina so roda com o arquivo grande e deixa so as linhas que valem', async () => {
  const h = prepararFalso(loadMain());
  const encher = 'x'.repeat(12000);
  const linhas = [];
  // 400 linhas orfas (ninguem tem carimbo delas) = uns 4,8 MB de lixo
  for (let i = 0; i < 400; i++) linhas.push(JSON.stringify({ f: '/foi/embora-' + i, m: 1, t: 2, x: encher }));
  const vivo = JSON.stringify({ f: h.HOME + '/vivo.jsonl', v: 2, m: 1, t: 7, x: 'contrato do pedro' });
  linhas.push(vivo);
  h.put(TEXTO, linhas.join('\n') + '\n');
  h.put(CARIMBOS, JSON.stringify({ [h.HOME + '/vivo.jsonl']: { v: 2, m: 1, t: 7, b: vivo.length + 1 } }));

  const faxinou = await h.evaluate('compactarTexto()');

  assert.equal(faxinou, true, 'com 4,8 MB de lixo a faxina tem de rodar');
  assert.deepEqual(linhasDoTexto(h), [vivo], 'so a linha com carimbo pode sobrar');
});

test('com o arquivo pequeno a faxina nem comeca', async () => {
  const h = prepararFalso(loadMain());
  const f = porConversa(h, h.HOME + '/chat.jsonl', 'nada de mais aqui');
  await buscar(h, 'nada', [{ id: 'c', file: f }]);
  const antes = String(h.files.get(TEXTO));

  assert.equal(await h.evaluate('compactarTexto()'), false, 'reescrever arquivo pequeno e desperdicio');
  assert.equal(String(h.files.get(TEXTO)), antes);
});

/* ---- 9. a faxina e a busca correm juntas: nada pode se perder na troca ---- */

test('conversa indexada NO MEIO da faxina nao se perde', async () => {
  const h = prepararFalso(loadMain());
  const encher = 'x'.repeat(12000);
  const linhas = [];
  for (let i = 0; i < 400; i++) linhas.push(JSON.stringify({ f: '/foi/embora-' + i, m: 1, t: 2, x: encher }));
  h.put(TEXTO, linhas.join('\n') + '\n');
  h.put(CARIMBOS, '{}');

  const faxina = h.evaluate('compactarTexto()');
  await null;   // a faxina ja comecou a ler o arquivo
  h.evaluate(`guardarTexto(${JSON.stringify(h.HOME + '/nova.jsonl')}, 9, 9, 'chegou no meio da faxina')`);
  await faxina;

  const sobrou = linhasDoTexto(h).map((l) => JSON.parse(l));
  assert.equal(sobrou.length, 1, 'so a conversa nova pode sobrar');
  assert.equal(sobrou[0].f, h.HOME + '/nova.jsonl');
  const carim = h.evaluate('JSON.stringify(indCarimbos)');
  // carimbo sem linha no arquivo = conversa que some da busca calada: nao pode existir
  for (const f of Object.keys(JSON.parse(carim))) {
    assert.ok(sobrou.some((d) => d.f === f), 'todo carimbo tem de ter a linha dele: ' + f);
  }
});
