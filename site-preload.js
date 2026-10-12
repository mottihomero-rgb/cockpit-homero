'use strict';
/* Roda DENTRO de cada pagina aberta no navegador interno do Cockpit (webview).
   Faz tres coisas, e so conversa com o Cockpit pelo sendToHost:
   1. avisa quando ele seleciona um texto da pagina;
   2. no modo "Marcar area", deixa ele arrastar um retangulo e avisa qual elemento ficou embaixo;
   3. mede onde estao os elementos dos ajustes ja marcados (para os pinos acompanharem a rolagem).
   A pagina de fora nunca enxerga nada daqui: o preload roda em mundo isolado. */
const { ipcRenderer } = require('electron');

let modoArea = false, camada = null, quadro = null;
const curto = (s, max = 240) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, max);

function caminho(n) {
  if (n && n.nodeType !== 1) n = n.parentElement;
  const partes = [];
  for (let i = 0; n && n.tagName && i < 7; i++, n = n.parentElement) {
    if (n.id && !/\d{4,}/.test(n.id)) { partes.unshift('#' + CSS.escape(n.id)); break; }
    const tag = n.tagName.toLowerCase();
    const iguais = n.parentElement ? [...n.parentElement.children].filter(x => x.tagName === n.tagName) : [];
    partes.unshift(tag + (iguais.length > 1 ? ':nth-of-type(' + (iguais.indexOf(n) + 1) + ')' : ''));
    if (tag === 'body') break;
  }
  return partes.join(' > ');
}
const caixa = (r) => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height });
function normalizar(box, alvo) {
  const lim = (n) => Math.min(1, Math.max(0, n));
  const w = alvo.width || 1, h = alvo.height || 1;
  return { x: +lim((box.left - alvo.left) / w).toFixed(5), y: +lim((box.top - alvo.top) / h).toFixed(5),
    largura: +lim(box.width / w).toFixed(5), altura: +lim(box.height / h).toFixed(5) };
}
const blocoDe = (n) => (n && n.closest && n.closest('p,h1,h2,h3,h4,h5,h6,li,td,th,blockquote,figcaption,section,article,div')) || n;
const dono = (n) => (n && n.nodeType === 1 ? n : n && n.parentElement);

/* ---- 1. texto selecionado ---- */
let tSel = 0;
function lerSelecao() {
  if (modoArea) return;
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount || !String(sel).trim()) { ipcRenderer.sendToHost('site:selecao', null); return; }
  const r = sel.getRangeAt(0), box = r.getBoundingClientRect();
  if (!box.width && !box.height) return;
  const ini = dono(r.startContainer), bloco = blocoDe(ini);
  const ancora = bloco ? { seletor: caminho(bloco), ...normalizar(box, bloco.getBoundingClientRect()) } : undefined;
  ipcRenderer.sendToHost('site:selecao', {
    tipo: 'texto', url: location.href, titulo: document.title,
    trecho: String(sel).trim().slice(0, 16000), contexto: curto(bloco && bloco.textContent, 1800),
    seletor: caminho(ini), ancora, box: caixa(box),
  });
}
document.addEventListener('selectionchange', () => { clearTimeout(tSel); tSel = setTimeout(lerSelecao, 180); });
document.addEventListener('mouseup', () => setTimeout(lerSelecao, 0));

/* ---- 2. marcar area ---- */
function ligarArea() {
  if (camada) return;
  camada = document.createElement('div');
  camada.style.cssText = 'position:fixed;inset:0;z-index:2147483647;cursor:crosshair;background:transparent;touch-action:none;';
  quadro = document.createElement('div');
  quadro.style.cssText = 'position:fixed;display:none;border:2px solid #3178da;background:#3178da22;pointer-events:none;z-index:2147483647;';
  let ini = null;
  camada.addEventListener('wheel', (e) => { window.scrollBy(e.deltaX, e.deltaY); e.preventDefault(); }, { passive: false });
  camada.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault(); ini = { x: e.clientX, y: e.clientY };
    try { camada.setPointerCapture(e.pointerId); } catch {}
    quadro.style.display = 'block';
  });
  camada.addEventListener('pointermove', (e) => {
    if (!ini) return;
    Object.assign(quadro.style, { left: Math.min(ini.x, e.clientX) + 'px', top: Math.min(ini.y, e.clientY) + 'px',
      width: Math.abs(e.clientX - ini.x) + 'px', height: Math.abs(e.clientY - ini.y) + 'px' });
  });
  const fim = (e) => {
    if (!ini) return;
    const i = ini; ini = null; quadro.style.display = 'none';
    const x1 = Math.min(i.x, e.clientX), y1 = Math.min(i.y, e.clientY), x2 = Math.max(i.x, e.clientX), y2 = Math.max(i.y, e.clientY);
    if (e.type === 'pointercancel' || x2 - x1 < 8 || y2 - y1 < 8) return;
    camada.style.pointerEvents = 'none';
    const alvo = document.elementFromPoint((x1 + x2) / 2, (y1 + y2) / 2);
    camada.style.pointerEvents = '';
    const bloco = blocoDe(alvo) || document.body;
    const box = { left: x1, top: y1, right: x2, bottom: y2, width: x2 - x1, height: y2 - y1 };
    let html = ''; try { html = (alvo || bloco).outerHTML.replace(/\s+/g, ' ').slice(0, 1400); } catch {}
    ipcRenderer.sendToHost('site:selecao', {
      tipo: 'area', url: location.href, titulo: document.title, seletor: caminho(alvo || bloco),
      contexto: curto(bloco.textContent, 1600), html,
      ancora: { seletor: caminho(bloco), ...normalizar(box, bloco.getBoundingClientRect()) }, box,
    });
  };
  camada.addEventListener('pointerup', fim); camada.addEventListener('pointercancel', fim);
  (document.documentElement || document.body).append(camada, quadro);
}
function desligarArea() { camada?.remove(); quadro?.remove(); camada = quadro = null; }
ipcRenderer.on('site:modo', (_e, ativar) => {
  modoArea = !!ativar;
  if (modoArea) { window.getSelection()?.removeAllRanges(); ligarArea(); } else desligarArea();
});

/* ---- 3. onde estao os ajustes ja marcados ---- */
function achar(sel) { try { return sel ? document.querySelector(sel) : null; } catch { return null; } }
ipcRenderer.on('site:medir', (_e, itens) => {
  const saida = [];
  for (const it of itens || []) {
    const n = achar(it.ancora && it.ancora.seletor) || achar(it.seletor);
    if (!n) { saida.push({ id: it.id, achou: false }); continue; }
    const r = n.getBoundingClientRect(), a = it.ancora;
    const left = r.left + (a ? a.x * r.width : 0), top = r.top + (a ? a.y * r.height : 0);
    saida.push({ id: it.id, achou: true, left, top,
      right: left + (a ? a.largura * r.width : r.width), bottom: top + (a ? a.altura * r.height : Math.min(30, r.height)) });
  }
  ipcRenderer.sendToHost('site:medidas', { itens: saida, url: location.href, rolagem: window.scrollY, altura: document.documentElement.scrollHeight });
});
ipcRenderer.on('site:rolar', (_e, seletor) => { achar(seletor)?.scrollIntoView({ block: 'center', behavior: 'smooth' }); });
