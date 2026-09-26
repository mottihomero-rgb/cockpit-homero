/* A hora da ÚLTIMA fala de uma conversa, lida de dentro do arquivo (26/09, pedido dele).
   A lista de conversas usava a hora em que o ARQUIVO foi gravado pela última vez. Qualquer coisa que
   regrava o arquivo sem conversa nova (a mudança de pastas de 26/09 reescreveu os caminhos dentro de
   vários às 12:54) jogava a conversa para "Hoje", e ele via no topo conversas em que não mexeu.
   Vale para os 4 formatos: Claude e Codex ("timestamp" ISO), Grok/ACP ("t" em ms), Gemini pelo CLI
   ("timestamp") e o Gemini do Cockpit (linhas novas ganham "t"; as antigas só têm o "criado").
   Sem hora nenhuma lá dentro, fica a da gravação, como antes. Nunca passa da hora da gravação. */
const fs = require('fs');

const LER = 64 * 1024;
const HORA = /"(?:timestamp|t)":\s*(?:"(\d{4}-\d\d-\d\dT[^"]+)"|(\d{13})\b)/g;
const INICIO = /"(?:criado|startTime)":\s*(?:"(\d{4}-\d\d-\d\dT[^"]+)"|(\d{13})\b)/;

function horaNoTexto(texto) {
  let maior = 0;
  for (const m of String(texto || '').matchAll(HORA)) {
    const v = m[1] ? Date.parse(m[1]) : Number(m[2]);
    if (v > maior) maior = v;
  }
  if (maior) return maior;
  const c = INICIO.exec(String(texto || ''));
  return c ? (c[1] ? Date.parse(c[1]) : Number(c[2])) || 0 : 0;
}
function lerFim(arquivo, bytes) {
  let fd;
  try {
    fd = fs.openSync(arquivo, 'r');
    const tam = fs.fstatSync(fd).size;
    const n = Math.min(bytes, tam);
    const buf = Buffer.alloc(n);
    fs.readSync(fd, buf, 0, n, tam - n);
    let s = buf.toString('utf8');
    // arquivo pequeno: o começo (com o "criado") já veio junto; grande: lê o começo também
    if (tam > n) { const cab = Buffer.alloc(Math.min(4096, tam)); fs.readSync(fd, cab, 0, cab.length, 0); s = cab.toString('utf8') + '\n' + s; }
    return s;
  } catch { return ''; } finally { if (fd !== undefined) try { fs.closeSync(fd); } catch {} }
}
/* hora da última fala do arquivo; `gravado` = mtime (o teto e a reserva) */
function horaDaUltimaFala(arquivo, gravado, texto) {
  const h = horaNoTexto(texto != null ? texto : lerFim(arquivo, LER));
  if (!h || !Number.isFinite(h)) return gravado || 0;
  return gravado ? Math.min(h, gravado) : h;
}

module.exports = { horaDaUltimaFala, horaNoTexto };
