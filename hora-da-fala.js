/* A data da conversa vem dos registros, nunca de datas citadas no texto.
   Leituras de cauda crescem até encontrar um registro completo. Se a última
   linha superar o teto, usamos o mtime explicitamente, sem fingir que a data
   do cabeçalho antigo é a data da última fala. */
const fs = require('fs');
const BLOCO = 64 * 1024;
const TETO_CAUDA = 16 * 1024 * 1024;
const cache = new Map();
const instante = v => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Date.parse(v) : 0;
  return Number.isFinite(n) && n > 0 ? n : 0;
};
function horaDoRegistro(registro) {
  if (!registro || typeof registro !== 'object' || Array.isArray(registro)) return 0;
  let h = Math.max(instante(registro.timestamp), instante(registro.t));
  // Gemini nativo é um objeto com messages, ou um registro $set de metadados.
  if (Array.isArray(registro.messages)) {
    for (const m of registro.messages) h = Math.max(h, horaDoRegistro(m));
  }
  if (registro.$set && typeof registro.$set === 'object') h = Math.max(h, horaDoRegistro(registro.$set));
  return h || Math.max(instante(registro.criado), instante(registro.startTime));
}
function horaNoTexto(texto) {
  const s = String(texto || '');
  try { return horaDoRegistro(JSON.parse(s)); } catch {}
  let h = 0;
  for (const linha of s.split('\n')) {
    try { h = Math.max(h, horaDoRegistro(JSON.parse(linha))); } catch {}
  }
  return h;
}
function horaDoArquivo(arquivo, stat) {
  let fd;
  try {
    fd = fs.openSync(arquivo, 'r');
    const tamanho = stat.size;
    const teto = Math.min(TETO_CAUDA, tamanho);
    if (/\.json$/i.test(arquivo)) {
      // Em JSON formatado, uma linha isolada pode ser apenas um payload interno.
      if (tamanho > TETO_CAUDA) return 0;
      const buf = Buffer.alloc(tamanho);
      const n = fs.readSync(fd, buf, 0, tamanho, 0);
      try { return horaDoRegistro(JSON.parse(buf.subarray(0, n).toString('utf8'))); } catch { return 0; }
    }
    for (let bytes = Math.min(BLOCO, teto); bytes > 0; bytes = Math.min(bytes * 2, teto)) {
      const buf = Buffer.alloc(bytes);
      const n = fs.readSync(fd, buf, 0, bytes, tamanho - bytes);
      let s = buf.subarray(0, n).toString('utf8');
      if (bytes < tamanho) {
        const inicio = s.indexOf('\n');
        s = inicio < 0 ? '' : s.slice(inicio + 1); // a primeira linha é incompleta
      }
      const h = horaNoTexto(s);
      if (h) return h;
      if (bytes === teto) break;
    }
    return 0;
  } catch { return 0; } finally { if (fd !== undefined) try { fs.closeSync(fd); } catch {} }
}
function horaDaUltimaFala(arquivo, gravado, texto) {
  let h = 0;
  try {
    const stat = fs.statSync(arquivo);
    const antiga = cache.get(arquivo);
    if (antiga && antiga.mtime === stat.mtimeMs && antiga.size === stat.size && antiga.ctime === stat.ctimeMs) h = antiga.h;
    else {
      h = horaDoArquivo(arquivo, stat);
      if (cache.size >= 2000) cache.clear();
      cache.set(arquivo, { mtime: stat.mtimeMs, size: stat.size, ctime: stat.ctimeMs, h });
    }
  } catch { h = texto != null ? horaNoTexto(texto) : 0; }
  if (!h) return gravado || 0;
  return gravado ? Math.min(h, gravado) : h;
}
module.exports = { horaDaUltimaFala, horaNoTexto, horaDoRegistro };
