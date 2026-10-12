'use strict';
// Leitura de documentos. Nenhuma anotacao altera o original: so o chat recebe os pedidos.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const { execFile } = require('child_process');
const TIPOS = { '.pdf': 'application/pdf', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.avif': 'image/avif', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.otf': 'font/otf' };
const MAX_DOCUMENTO = 200 * 1024 * 1024;
const MAX_HTML = 8 * 1024 * 1024;
const hashArquivo = async (file) => {
  const h = crypto.createHash('sha256');
  for await (const pedaco of fs.createReadStream(file)) h.update(pedaco);
  return h.digest('hex');
};
function converterDoc(file) {
  if (process.platform !== 'darwin') return Promise.reject(new Error('Para revisar este Word antigo aqui, salve uma cópia em DOCX.'));
  return new Promise((resolve, reject) => execFile('/usr/bin/textutil', ['-convert', 'html', '-stdout', file],
    { timeout: 30000, maxBuffer: MAX_HTML }, (erro, html) => erro ? reject(new Error('Não consegui abrir este Word antigo. Salve uma cópia em DOCX.')) : resolve(html)));
}
function criar({ converterWord = converterDoc, agora = Date.now } = {}) {
  const tickets = new Map();
  const vida = 24 * 60 * 60 * 1000;
  async function abrir(file) {
    try {
      if (typeof file !== 'string' || !path.isAbsolute(file)) throw new Error('Escolha um arquivo deste computador.');
      const real = fs.realpathSync(file), st = fs.statSync(real), ext = path.extname(real).slice(1).toLowerCase();
      if (!st.isFile() || !/^(pdf|docx|doc|html|htm)$/.test(ext)) throw new Error('A revisão abre PDF, Word e HTML.');
      if (st.size > MAX_DOCUMENTO) throw new Error('Este arquivo passa de 200 MB. Abra uma versão menor para revisar.');
      if (/^(html|htm|doc)$/.test(ext) && st.size > MAX_HTML) throw new Error('Este documento está grande demais para a prévia.');
      const hash = await hashArquivo(real), ticket = crypto.randomBytes(24).toString('hex');
      let html;
      if (/^html?$/.test(ext)) html = await fs.promises.readFile(real, 'utf8');
      if (ext === 'doc') html = await converterWord(real);
      for (const [id, item] of tickets) if (item.ate <= agora()) tickets.delete(id);
      if (tickets.size >= 128) tickets.delete(tickets.keys().next().value);
      tickets.set(ticket, { file: real, raiz: path.dirname(real), ate: agora() + vida, hash });
      return { path: file, nome: path.basename(file), ext, bytes: st.size, hash, ticket,
        tipo: ext === 'pdf' ? 'pdf' : ext === 'docx' ? 'docx' : 'html', html,
        url: pathToFileURL(real).href, baseUrl: pathToFileURL(path.dirname(real) + path.sep).href };
    } catch (e) { return { erro: e.message }; }
  }
  function conteudo({ ticket, recurso = 'arquivo' } = {}) {
    try {
      const item = tickets.get(ticket);
      if (!item || item.ate <= agora()) throw new Error('Reabra a prévia para continuar.');
      item.ate = agora() + vida;
      let file = item.file;
      if (recurso !== 'arquivo') {
        if (!recurso.startsWith('assets/')) throw new Error('Recurso não encontrado.');
        const rel = recurso.slice(7);
        if (!rel || rel.includes('\0') || rel.includes('\\') || path.isAbsolute(rel)) throw new Error('Recurso não permitido.');
        file = fs.realpathSync(path.join(item.raiz, rel));
        const fora = path.relative(item.raiz, file);
        if (fora === '..' || fora.startsWith('..' + path.sep) || path.isAbsolute(fora)) throw new Error('Recurso não permitido.');
        // A pagina so pode buscar seus estilos, imagens e fontes, nunca senhas ou codigo.
        if (!TIPOS[path.extname(file).toLowerCase()] || /\.(pdf|docx|html?)$/i.test(file)) throw new Error('Recurso não permitido.');
      }
      const st = fs.statSync(file);
      if (!st.isFile()) throw new Error('Recurso não encontrado.');
      return { arquivo: file, mime: TIPOS[path.extname(file).toLowerCase()] || 'application/octet-stream', bytes: st.size };
    } catch (e) { return { erro: e.message }; }
  }
  async function conferir({ caminho, hash } = {}) {
    try { return { ok: typeof hash === 'string' && hash.length === 64 && await hashArquivo(caminho) === hash }; }
    catch { return { ok: false }; }
  }
  return { abrir, conteudo, conferir };
}
function responderArquivo(req, res, item) {
  if (!item || item.erro) { res.writeHead(404, { 'Cache-Control': 'no-store' }); return res.end('Reabra a prévia para continuar.'); }
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { Allow: 'GET, HEAD' }); return res.end(); }
  let inicio = 0, fim = item.bytes - 1, status = 200;
  const cab = { 'Content-Type': item.mime, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
  if (req.headers.range) {
    const m = String(req.headers.range).match(/^bytes=(\d*)-(\d*)$/);
    if (m && (m[1] || m[2])) {
      if (m[1]) { inicio = Number(m[1]); if (m[2]) fim = Math.min(fim, Number(m[2])); }
      else inicio = Math.max(0, item.bytes - Number(m[2]));
      if (!Number.isSafeInteger(inicio) || !Number.isSafeInteger(fim) || inicio > fim || inicio >= item.bytes) status = 416;
      else { status = 206; cab['Content-Range'] = `bytes ${inicio}-${fim}/${item.bytes}`; }
    } else status = 416;
  }
  if (status === 416) { res.writeHead(416, { ...cab, 'Content-Range': 'bytes */' + item.bytes }); return res.end(); }
  cab['Content-Length'] = Math.max(0, fim - inicio + 1);
  res.writeHead(status, cab);
  if (req.method === 'HEAD' || !item.bytes) return res.end();
  const stream = fs.createReadStream(item.arquivo, { start: inicio, end: fim });
  stream.on('error', () => res.destroy());
  res.on('close', () => stream.destroy());
  stream.pipe(res);
}
module.exports = { criar, responderArquivo, hashArquivo };
