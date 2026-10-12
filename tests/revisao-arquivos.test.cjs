'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { criar, responderArquivo } = require('../revisao-arquivos');
const { criar: criarWeb } = require('../servidor-web');
function pasta(t) { const p = fs.mkdtempSync(path.join(os.tmpdir(), 'ck-revisao-')); t.after(() => fs.rmSync(p, { force: true, recursive: true })); return p; }
test('Revisao preserva original, detecta versao alterada e abre Word antigo pelo conversor', async t => {
  const p = pasta(t), file = path.join(p, 'Contrato com acento á.html'), original = '<h1>Contrato</h1><p>Texto original</p>';
  fs.writeFileSync(file, original); const s = criar({ converterWord: async () => '<p>Word convertido</p>' });
  const a = await s.abrir(file); assert.equal(a.tipo, 'html'); assert.equal(a.html, original); assert.equal(a.hash.length, 64);
  assert.equal((await s.conferir({ caminho: file, hash: a.hash })).ok, true);
  assert.equal(fs.readFileSync(file, 'utf8'), original);
  fs.writeFileSync(file, '<p>Versao nova</p>'); assert.equal((await s.conferir({ caminho: file, hash: a.hash })).ok, false);
  const doc = path.join(p, 'Antigo.doc'); fs.writeFileSync(doc, 'binario ficticio');
  assert.equal((await s.abrir(doc)).html, '<p>Word convertido</p>');
  assert.ok((await s.abrir('../arquivo')).erro); assert.ok((await s.abrir(p)).erro);
});
test('Ticket de revisao so le o documento e seus assets; nao vaza segredo, traversal ou symlink', async t => {
  const p = pasta(t), raiz = path.join(p, 'Pagina'); fs.mkdirSync(raiz); fs.mkdirSync(path.join(raiz, 'Imagens'));
  const file = path.join(raiz, 'index.html'), imagem = path.join(raiz, 'Imagens', 'icone.svg');
  fs.writeFileSync(file, '<img src="Imagens/icone.svg">'); fs.writeFileSync(imagem, '<svg/>');
  fs.writeFileSync(path.join(raiz, 'senha.json'), 'segredo'); fs.writeFileSync(path.join(p, 'fora.css'), 'segredo');
  fs.symlinkSync(path.join(p, 'fora.css'), path.join(raiz, 'atalho.css'));
  let agora = 1; const s = criar({ agora: () => agora }), a = await s.abrir(file);
  assert.equal(s.conteudo({ ticket: a.ticket }).arquivo, fs.realpathSync(file));
  assert.equal(s.conteudo({ ticket: a.ticket, recurso: 'assets/Imagens/icone.svg' }).arquivo, fs.realpathSync(imagem));
  for (const recurso of ['assets/senha.json', 'assets/../fora.css', 'assets/atalho.css', 'assets/index.html', 'assets/\\fora.css']) assert.ok(s.conteudo({ ticket: a.ticket, recurso }).erro, recurso);
  assert.ok(s.conteudo({ ticket: '0'.repeat(48) }).erro);
  agora += 25 * 60 * 60 * 1000; assert.ok(s.conteudo({ ticket: a.ticket }).erro);
});
test('Arquivo grande e enviado por HTTP, com ranges, autenticacao e bytes intactos', async t => {
  const p = pasta(t), file = path.join(p, 'Grande.pdf'); const b = Buffer.alloc(13 * 1024 * 1024, 91); b.write('%PDF-1.7'); fs.writeFileSync(file, b);
  const docs = criar(), a = await docs.abrir(file);
  const web = criarWeb({ pastaRenderer: path.resolve(__dirname, '../renderer'), senha: 'teste', porta: 0, somenteTailscale: true, ouvintes: new Set(),
    handlers: { 'arquivo:revisaoConteudo': (_e, o) => docs.conteudo(o) } });
  t.after(() => web.fechar()); await web.pronto;
  const base = 'http://127.0.0.1:' + web.servidor.address().port;
  const login = await fetch(base + '/entrar', { method: 'POST', redirect: 'manual', body: new URLSearchParams({ s: 'teste' }) });
  const cookie = login.headers.get('set-cookie').split(';')[0], url = base + '/revisao/' + a.ticket + '/arquivo';
  assert.match(await (await fetch(url)).text(), /Senha do Cockpit/);
  const r = await fetch(url, { headers: { Cookie: cookie, Range: 'bytes=0-7' } });
  assert.equal(r.status, 206); assert.equal(r.headers.get('content-range'), 'bytes 0-7/' + b.length); assert.equal(await r.text(), '%PDF-1.7');
  const inteiro = await fetch(url, { headers: { Cookie: cookie } }); assert.deepEqual(Buffer.from(await inteiro.arrayBuffer()), b);
  assert.equal((await fetch(url, { headers: { Cookie: cookie, Range: 'bytes=999999999-' } })).status, 416);
  assert.equal((await fetch(url, { method: 'HEAD', headers: { Cookie: cookie } })).headers.get('content-length'), String(b.length));
  const modulo = await fetch(base + '/vendor/pdfjs/build/pdf.min.mjs', { headers: { Cookie: cookie } }); assert.match(modulo.headers.get('content-type'), /javascript/);
});
test('Leitura HTTP termina limpa se o arquivo desapareceu depois da verificacao', t => {
  const p = pasta(t), file = path.join(p, 'sumiu.pdf'); fs.writeFileSync(file, 'teste'); fs.unlinkSync(file);
  const res = { writeHead() {}, destroy() {}, on() {}, end() {} };
  assert.doesNotThrow(() => responderArquivo({ method: 'HEAD', headers: {} }, res, { arquivo: file, bytes: 5, mime: 'application/pdf' }));
});
