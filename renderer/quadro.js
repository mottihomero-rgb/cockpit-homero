/* ============================================================================
   Quadro branco — a quarta forma de dar entrada de informacao no Cockpit.
   Falar, escrever, mandar print... e agora DESENHAR o fluxo.

   O desenho vira duas coisas ao mesmo tempo: um PNG (que o Claude abre) e uma
   leitura em texto (que o QuadroTexto monta). Imagem sozinha e chute; o texto
   e o que garante que ele leu o fluxo certo.

   Este arquivo carrega ANTES do app.js. Por isso ele nao usa nada de la:
   nem ico(), nem panes, nem focusPane. So DOM, canvas 2D e window.api.
   As duas unicas portas para o chat sao os ganchos window.abrirQuadroAnexar e
   window.abrirQuadroTexto, que o app.js publica.
   ========================================================================== */
(function () {
  'use strict';

  /* ---------------- constantes ---------------- */
  const QD_FONTE = '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';
  const ZMIN = 0.2, ZMAX = 4;
  const SNAP = 8;          // grade de encaixe, em unidades de mundo
  const GRADE = 24;        // espacamento visual dos pontinhos
  const FOLGA = 6;         // afastamento da ponta da seta em relacao a borda
  const TOL_TELA = 8;      // tolerancia de clique, em px de TELA
  const MAX_PASSOS = 61;   // 60 desfazeres
  const NOTA_FUNDO = '#f2d16b';
  const NOTA_TINTA = '#23231f';
  const LIM_PNG = 2160;    // teto do lado maior: o WebSocket do telefone corta em 8MB
  /* 'tinta' e um sentinela, nao uma cor: vira o --fg-strong do tema na hora de pintar.
     Sem isso, traco preto some no tema escuro e traco claro some no tema jornal. */
  const PALETA = ['tinta', '#d97757', '#4a90e2', '#4f9d5d', '#c9922b', '#d9534f', '#9b7bd4'];
  /* hexes que versoes antigas gravavam no lugar de 'tinta' (um por tema) */
  const TINTAS_VELHAS = ['#e8e8e8', '#1c1c20', '#073642'];
  const PADRAO = {
    retangulo: { w: 160, h: 90 }, elipse: { w: 150, h: 90 }, losango: { w: 160, h: 100 },
    nota: { w: 180, h: 180 }, texto: { w: 220, h: 34 },
  };

  /* ---------------- icones (mapa proprio, de proposito) ---------------- */
  const ICONES_QD = {
    selecionar: '<path d="M3.688 3.037a.497.497 0 0 0-.651.651l6.5 15.999a.501.501 0 0 0 .947-.062l1.569-6.083a2 2 0 0 1 1.448-1.479l6.124-1.579a.5.5 0 0 0 .063-.947z"/>',
    mao: '<path d="M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2" /> <path d="M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2" /> <path d="M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8" /> <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />',
    retangulo: '<rect width="18" height="18" x="3" y="3" rx="2"/>',
    elipse: '<circle cx="12" cy="12" r="9"/>',
    losango: '<path d="M12 2 22 12 12 22 2 12z"/>',
    nota: '<path d="M15.5 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h9l7-7V5a2 2 0 0 0-2-2z"/><path d="M15 21v-5a1 1 0 0 1 1-1h5"/>',
    seta: '<path d="M5 19 19 5"/><path d="M12 5h7v7"/>',
    linha: '<path d="M5 19 19 5"/>',
    texto: '<path d="M4 6V4h16v2"/><path d="M12 4v16"/><path d="M9 20h6"/>',
    caneta: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" /> <path d="m15 5 4 4" />',
    borracha: '<path d="M21 21H8a2 2 0 0 1-1.42-.587l-3.994-3.999a2 2 0 0 1 0-2.828l10-10a2 2 0 0 1 2.829 0l5.999 6a2 2 0 0 1 0 2.828L12.834 21" /> <path d="m5.082 11.09 8.828 8.828" />',
    desfazer: '<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>',
    refazer: '<path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7"/>',
    x: '<path d="M18 6 6 18" /> <path d="m6 6 12 12" />',
    mandar: '<path d="m5 12 7-7 7 7" /> <path d="M12 19V5" />',
    preencher: '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor" stroke="none"/>',
    frente: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M4 16V4a1 1 0 0 1 1-1h11"/>',
    tras: '<rect x="3" y="3" width="13" height="13" rx="2"/><path d="M20 8v12a1 1 0 0 1-1 1H8"/>',
    apagar: '<path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
    imagem: '<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.5-3.5a2 2 0 0 0-2.8 0L6 20"/>',
    copiar: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16V6a2 2 0 0 1 2-2h10"/>',
    ajustar: '<path d="M3 9V5a2 2 0 0 1 2-2h4"/><path d="M15 3h4a2 2 0 0 1 2 2v4"/><path d="M21 15v4a2 2 0 0 1-2 2h-4"/><path d="M9 21H5a2 2 0 0 1-2-2v-4"/>',
  };
  const qico = (n) => '<svg viewBox="0 0 24 24" class="ic" fill="none" stroke="currentColor" '
    + 'stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' + (ICONES_QD[n] || '') + '</svg>';

  const FERRAMENTAS = [
    { f: 'selecionar', ic: 'selecionar', t: 'Selecionar e mover (V)' },
    { f: 'mao', ic: 'mao', t: 'Arrastar a tela (H)' },
    { sep: true },
    { f: 'retangulo', ic: 'retangulo', t: 'Caixa (R)' },
    { f: 'elipse', ic: 'elipse', t: 'Círculo (O)' },
    { f: 'losango', ic: 'losango', t: 'Decisão, o se sim / se não (D)' },
    { f: 'nota', ic: 'nota', t: 'Post-it (N)' },
    { f: 'texto', ic: 'texto', t: 'Texto solto (T)' },
    { sep: true },
    { f: 'seta', ic: 'seta', t: 'Seta que liga duas coisas (A)' },
    { f: 'linha', ic: 'linha', t: 'Linha (L)' },
    { f: 'caneta', ic: 'caneta', t: 'Caneta livre (P)' },
    { f: 'borracha', ic: 'borracha', t: 'Borracha (E)' },
  ];
  const TECLAS_FER = { v: 'selecionar', h: 'mao', r: 'retangulo', o: 'elipse', d: 'losango',
    a: 'seta', l: 'linha', t: 'texto', p: 'caneta', n: 'nota', e: 'borracha' };

  /* ---------------- estado ---------------- */
  const Q = {
    aberto: false,
    abertura: 0,
    revisao: 0,
    P: null,
    cena: { v: 1, formas: [], setas: [] },
    cam: { x: 0, y: 0, z: 1 },
    ferramenta: 'selecionar',
    selecao: new Set(),
    gesto: null,
    estilo: { cor: 'tinta', fundo: 'transparente', esp: 2 },
    pilha: { passos: [], indice: -1 },
    alvoSeta: null,
    editando: null,
    ponteiros: new Map(),
    pinch: null,
    saiuDoPinch: false,      // solto do 2o dedo da pinca nao pode contar como toque de duplo-toque
    bloqueado: false,
    espaco: false,
    desenhoPedido: false,
    enviado: false,          // o desenho de agora ja foi mandado pro chat?
    tema: {},
    rascunho: { timer: null, ultimo: '', ultimoEnviadoEm: 0, enviadoEm: 0, gravando: false, promessa: null, sujo: false },
    /* desenho que o Claude grava pela skill planejar-sistema: 'visto' e o carimbo ja carregado,
       'cena' e a foto do jeito que chegou (se ele mexer, o Claude nao passa mais por cima) */
    claude: { visto: 0, cena: '', timer: null, semNovidade: 0 },
    setasTimer: null,        // junta uma rajada de setas do teclado num passo so
    ultimoToque: { t: 0, x: 0, y: 0 },
    limparArmado: 0,
    el: {},
    ctx: null, dpr: 1, larg: 0, alt: 0,
    seq: 0,
  };

  /* ---------------- coordenadas e camera ---------------- */
  const num = (v, padrao) => (Number.isFinite(+v) ? +v : (padrao || 0));
  const arred = (v) => Math.round(v * 100) / 100;

  function mundoParaTela(mx, my) { return { x: (mx - Q.cam.x) * Q.cam.z, y: (my - Q.cam.y) * Q.cam.z }; }
  function telaParaMundo(tx, ty) { return { x: tx / Q.cam.z + Q.cam.x, y: ty / Q.cam.z + Q.cam.y }; }

  function pontoDoEvento(e) {
    const r = Q.el.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  function pontoMundoDoEvento(e) { const t = pontoDoEvento(e); return telaParaMundo(t.x, t.y); }

  function aplicarCamera(ctx) {
    const k = Q.cam.z * Q.dpr;
    ctx.setTransform(k, 0, 0, k, -Q.cam.x * k, -Q.cam.y * k);
  }

  function redimensionar() {
    const c = Q.el.canvas, area = Q.el.palco;
    if (!c || !area) return;
    /* o iPad Pro reporta 3x: o canvas fica com 3x a area e o repaint triplica a toa */
    Q.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = area.getBoundingClientRect();
    Q.larg = Math.max(1, Math.round(r.width));
    Q.alt = Math.max(1, Math.round(r.height));
    c.width = Math.round(Q.larg * Q.dpr);
    c.height = Math.round(Q.alt * Q.dpr);
    c.style.width = Q.larg + 'px';
    c.style.height = Q.alt + 'px';
    Q.ctx = c.getContext('2d');
    if (Q.editando) posicionarEditor();
    agendar();
  }

  function zoomPara(novoZ, px, py) {
    novoZ = Math.min(ZMAX, Math.max(ZMIN, novoZ));
    const antes = telaParaMundo(px, py);
    Q.cam.z = novoZ;
    Q.cam.x = antes.x - px / novoZ;
    Q.cam.y = antes.y - py / novoZ;
    if (Q.editando) posicionarEditor();
    agendar();
  }

  function ajustarNaTela() {
    const b = caixaConteudo();
    if (!b) { Q.cam = { x: -Q.larg / 2, y: -Q.alt / 2, z: 1 }; return agendar(); }
    const m = 48;
    const z = Math.min(ZMAX, Math.max(ZMIN, Math.min((Q.larg - m * 2) / b.w, (Q.alt - m * 2) / b.h, 2)));
    Q.cam.z = z;
    Q.cam.x = b.x + b.w / 2 - Q.larg / (2 * z);
    Q.cam.y = b.y + b.h / 2 - Q.alt / (2 * z);
    agendar();
  }

  /* encaixe de 8px ligado por padrao: o Homero nao vai aprender a ligar snap.
     Segurar Alt/Option desliga so enquanto durar o gesto. */
  const enc = (v, alt) => (alt ? v : Math.round(v / SNAP) * SNAP);

  /* ---------------- cena: ids, caixas, limpeza ---------------- */
  function novoId(pfx) { return pfx + (++Q.seq) + Math.random().toString(36).slice(2, 5); }
  function formaPorId(id) { return Q.cena.formas.find(f => f.id === id) || null; }
  function setaPorId(id) { return Q.cena.setas.find(s => s.id === id) || null; }
  function itemPorId(id) { return formaPorId(id) || setaPorId(id); }
  function centro(f) { return { x: f.x + f.w / 2, y: f.y + f.h / 2 }; }
  function cenaVazia() { return !Q.cena.formas.length && !Q.cena.setas.length; }

  function bboxForma(f) {
    if (f.tipo === 'caneta' && f.pontos && f.pontos.length) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const p of f.pontos) {
        x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]);
        x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]);
      }
      const g = (f.esp || 2) / 2;
      return { x: x0 - g, y: y0 - g, w: Math.max(1, x1 - x0 + g * 2), h: Math.max(1, y1 - y0 + g * 2) };
    }
    return { x: f.x, y: f.y, w: Math.max(1, f.w), h: Math.max(1, f.h) };
  }

  function caixaConteudo() {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const comer = (x, y, w, h) => {
      x0 = Math.min(x0, x); y0 = Math.min(y0, y);
      x1 = Math.max(x1, x + w); y1 = Math.max(y1, y + h);
    };
    for (const f of Q.cena.formas) { const b = bboxForma(f); comer(b.x, b.y, b.w, b.h); }
    for (const s of Q.cena.setas) {
      const g = geoSeta(s);
      comer(Math.min(g.ax, g.bx), Math.min(g.ay, g.by), Math.abs(g.bx - g.ax), Math.abs(g.by - g.ay));
    }
    if (!isFinite(x0)) return null;
    return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
  }

  /* TODA saida do modulo passa por aqui. Os campos com _ sao cache de render:
     se forem serializados junto, o arquivo incha e o quadro-texto recebe lixo. */
  function limparCena(c) {
    const src = c || Q.cena;
    const formas = (src.formas || []).map(f => {
      const o = {
        id: f.id, tipo: f.tipo,
        x: arred(num(f.x)), y: arred(num(f.y)),
        w: arred(num(f.w)), h: arred(num(f.h)),
        texto: String(f.texto || ''),
        cor: f.cor || 'tinta',
        fundo: f.fundo || 'transparente',
        esp: num(f.esp, 2),
      };
      if (f.tipo === 'caneta') o.pontos = (f.pontos || []).map(p => [arred(num(p[0])), arred(num(p[1]))]);
      return o;
    });
    const setas = (src.setas || []).map(s => ({
      id: s.id, tipo: s.tipo,
      de: { forma: (s.de && s.de.forma) || null, x: arred(num(s.de && s.de.x)), y: arred(num(s.de && s.de.y)) },
      para: { forma: (s.para && s.para.forma) || null, x: arred(num(s.para && s.para.x)), y: arred(num(s.para && s.para.y)) },
      texto: String(s.texto || ''),
      cor: s.cor || 'tinta',
      esp: num(s.esp, 2),
    }));
    return { v: 1, formas, setas };
  }

  /* Cena que vem de fora (rascunho, JSON velho, editado a mao) nunca entra crua:
     um NaN num x contamina o bbox, o ajustar e o PNG de uma vez. */
  function normalizarCena(c) {
    const saida = { v: 1, formas: [], setas: [] };
    if (!c || typeof c !== 'object') return saida;
    const vistos = new Set();
    const idUnico = (id, pfx) => {
      let i = (typeof id === 'string' && id) ? id : novoId(pfx);
      while (vistos.has(i)) i = novoId(pfx);
      vistos.add(i);
      return i;
    };
    const corBoa = (cor) => {
      if (typeof cor !== 'string' || !cor) return 'tinta';
      if (cor === 'tinta' || TINTAS_VELHAS.includes(cor.toLowerCase())) return 'tinta';
      return /^#[0-9a-fA-F]{3,8}$/.test(cor) ? cor : 'tinta';
    };
    for (const f of (Array.isArray(c.formas) ? c.formas : [])) {
      if (!f || !PADRAO[f.tipo] && f.tipo !== 'caneta') continue;
      const o = {
        id: idUnico(f.id, 'f'), tipo: f.tipo,
        x: num(f.x), y: num(f.y), w: Math.max(0, num(f.w)), h: Math.max(0, num(f.h)),
        texto: String(f.texto || ''), cor: corBoa(f.cor),
        fundo: (typeof f.fundo === 'string' && f.fundo) ? f.fundo : 'transparente',
        esp: Math.min(20, Math.max(1, num(f.esp, 2))),
      };
      if (f.tipo === 'caneta') {
        o.pontos = (Array.isArray(f.pontos) ? f.pontos : [])
          .filter(p => Array.isArray(p) && Number.isFinite(+p[0]) && Number.isFinite(+p[1]))
          .map(p => [+p[0], +p[1]]);
        if (o.pontos.length < 2) continue;
        const b = bboxForma(o);
        o.x = b.x; o.y = b.y; o.w = b.w; o.h = b.h;
      }
      saida.formas.push(o);
    }
    const ids = new Set(saida.formas.map(f => f.id));
    for (const s of (Array.isArray(c.setas) ? c.setas : [])) {
      if (!s || (s.tipo !== 'seta' && s.tipo !== 'linha')) continue;
      const ponta = (p) => {
        const q = p && typeof p === 'object' ? p : {};
        // ancora orfa (forma apagada) vira ponta livre: senao o render inteiro morre
        return { forma: (q.forma && ids.has(q.forma)) ? q.forma : null, x: num(q.x), y: num(q.y) };
      };
      saida.setas.push({
        id: idUnico(s.id, 's'), tipo: s.tipo,
        de: ponta(s.de), para: ponta(s.para),
        texto: String(s.texto || ''), cor: corBoa(s.cor),
        esp: Math.min(20, Math.max(1, num(s.esp, 2))),
      });
    }
    return saida;
  }

  function adicionar(obj) {
    if (obj.tipo === 'seta' || obj.tipo === 'linha') Q.cena.setas.push(obj);
    else Q.cena.formas.push(obj);
  }
  function remover(id) {
    Q.cena.formas = Q.cena.formas.filter(f => f.id !== id);
    Q.cena.setas = Q.cena.setas.filter(s => s.id !== id);
    Q.selecao.delete(id);
  }

  /* ---------------- hit-testing ---------------- */
  function distanciaPontoSegmento(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const den = dx * dx + dy * dy;
    let t = den ? ((px - ax) * dx + (py - ay) * dy) / den : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = ax + t * dx, qy = ay + t * dy;
    return Math.hypot(px - qx, py - qy);
  }

  function dentroDaForma(f, mx, my, tol) {
    if (f.tipo === 'caneta') {
      const b = bboxForma(f), g = tol + (f.esp || 2);
      if (mx < b.x - g || mx > b.x + b.w + g || my < b.y - g || my > b.y + b.h + g) return false;
      const lim = Math.max(f.esp || 2, tol);
      for (let i = 1; i < f.pontos.length; i++) {
        const a = f.pontos[i - 1], c = f.pontos[i];
        if (distanciaPontoSegmento(mx, my, a[0], a[1], c[0], c[1]) <= lim) return true;
      }
      return false;
    }
    const cx = f.x + f.w / 2, cy = f.y + f.h / 2;
    if (f.tipo === 'elipse') {
      const a = Math.max(f.w / 2 + tol, 0.001), b = Math.max(f.h / 2 + tol, 0.001);
      const dx = (mx - cx) / a, dy = (my - cy) / b;
      return dx * dx + dy * dy <= 1;
    }
    if (f.tipo === 'losango') {
      const hw = Math.max(f.w / 2 + tol, 0.001), hh = Math.max(f.h / 2 + tol, 0.001);
      return Math.abs(mx - cx) / hw + Math.abs(my - cy) / hh <= 1;
    }
    /* a area INTEIRA e clicavel, mesmo com fundo transparente: clicar no meio de um
       retangulo vazio e nao acontecer nada e o defeito no 1 de quadro branco pra leigo */
    return mx >= f.x - tol && mx <= f.x + f.w + tol && my >= f.y - tol && my <= f.y + f.h + tol;
  }

  function acharForma(mx, my) {
    const tol = TOL_TELA / Q.cam.z;
    for (let i = Q.cena.formas.length - 1; i >= 0; i--) {
      if (dentroDaForma(Q.cena.formas[i], mx, my, tol)) return Q.cena.formas[i];
    }
    return null;
  }

  function acharSeta(mx, my) {
    const tol = TOL_TELA / Q.cam.z;
    for (let i = Q.cena.setas.length - 1; i >= 0; i--) {
      const s = Q.cena.setas[i], g = geoSeta(s);
      if (distanciaPontoSegmento(mx, my, g.ax, g.ay, g.bx, g.by) <= Math.max((s.esp || 2) * 1.5, tol)) return s;
      if (s.texto) {
        const cx = (g.ax + g.bx) / 2, cy = (g.ay + g.by) / 2;
        if (Math.abs(mx - cx) <= 40 + tol && Math.abs(my - cy) <= 12 + tol) return s;
      }
    }
    return null;
  }

  function achar(mx, my) {
    const s = acharSeta(mx, my);
    if (s) return { tipo: 'seta', obj: s };
    const f = acharForma(mx, my);
    if (f) return { tipo: 'forma', obj: f };
    return null;
  }

  /* ---------------- setas: ancoragem e geometria ---------------- */
  /* Guardar o ID e nao a coordenada e o ponto todo: mover a forma leva a seta junto
     sem uma linha de codigo de sincronizacao. */
  /* Para GRUDAR a seta a mira e mais generosa que para clicar: no losango, os cantos de
     "se sim / se nao" ficam fora do losango de verdade, e e exatamente de la que sai a seta.
     Errar isso custa caro: seta solta some da leitura em texto que o Claude recebe. */
  function acharFormaPerto(mx, my, tolTela) {
    const tol = tolTela / Q.cam.z;
    for (let i = Q.cena.formas.length - 1; i >= 0; i--) {
      const b = bboxForma(Q.cena.formas[i]);
      if (mx >= b.x - tol && mx <= b.x + b.w + tol && my >= b.y - tol && my <= b.y + b.h + tol) {
        return Q.cena.formas[i];
      }
    }
    return null;
  }

  function ancorar(mx, my, alt) {
    const alvo = acharForma(mx, my) || acharFormaPerto(mx, my, 14);
    return alvo ? { forma: alvo.id, x: mx, y: my }
      : { forma: null, x: enc(mx, alt), y: enc(my, alt) };
  }

  function pontoNaBorda(f, alvo) {
    const cx = f.x + f.w / 2, cy = f.y + f.h / 2;
    const dx = alvo.x - cx, dy = alvo.y - cy;
    const d = Math.hypot(dx, dy);
    if (d < 0.001) return { x: cx, y: cy };
    const hw = Math.max(f.w / 2, 0.001), hh = Math.max(f.h / 2, 0.001);
    let t;
    if (f.tipo === 'elipse') {
      t = 1 / Math.hypot(dx / hw, dy / hh);
    } else if (f.tipo === 'losango') {
      t = 1 / (Math.abs(dx) / hw + Math.abs(dy) / hh);
    } else {
      const tx = Math.abs(dx) > 1e-6 ? hw / Math.abs(dx) : Infinity;
      const ty = Math.abs(dy) > 1e-6 ? hh / Math.abs(dy) : Infinity;
      t = Math.min(tx, ty);
    }
    const ux = dx / d, uy = dy / d;
    return { x: cx + dx * t + ux * FOLGA, y: cy + dy * t + uy * FOLGA };
  }

  function caixaDaAncora(f) {
    // caneta vira o proprio bbox: ancorar em rabisco e raro, mas nao pode quebrar
    if (f.tipo === 'caneta') { const b = bboxForma(f); return { tipo: 'retangulo', x: b.x, y: b.y, w: b.w, h: b.h }; }
    return f;
  }

  function geoSeta(s) {
    const fa = s.de.forma ? formaPorId(s.de.forma) : null;
    const fb = s.para.forma ? formaPorId(s.para.forma) : null;
    const ca = fa ? centro(fa) : { x: s.de.x, y: s.de.y };
    const cb = fb ? centro(fb) : { x: s.para.x, y: s.para.y };
    const A = fa ? pontoNaBorda(caixaDaAncora(fa), cb) : ca;
    const B = fb ? pontoNaBorda(caixaDaAncora(fb), ca) : cb;
    return { ax: A.x, ay: A.y, bx: B.x, by: B.y };
  }

  /* ---------------- texto ---------------- */
  let ctxMedida = null;
  function ctxParaMedir() {
    if (Q.ctx) return Q.ctx;
    if (!ctxMedida) ctxMedida = document.createElement('canvas').getContext('2d');
    return ctxMedida;
  }
  function fonteDe(f) { return f.tipo === 'texto' ? 18 : f.tipo === 'nota' ? 15 : 16; }
  /* A largura util NAO e a caixa inteira: o ctx.clip() recorta no contorno de verdade.
     No losango a faixa do meio tem metade da largura; na elipse, uns 70%. Medindo pela
     caixa cheia, as linhas de cima e de baixo saiam com as pontas decepadas na tela e
     dentro do PNG que vai para o Claude. */
  function larguraTexto(f) {
    const base = f.tipo === 'nota' ? f.w - 24
      : f.tipo === 'losango' ? f.w / 2 - 12
      : f.tipo === 'elipse' ? f.w * 0.7 - 12
      : f.w - 16;
    return Math.max(20, base);
  }
  const alturaLinha = (tam) => Math.round(tam * 1.28);

  function quebrarTexto(ctx, txt, larguraMax, tam) {
    ctx.font = tam + 'px ' + QD_FONTE;
    const linhas = [];
    for (const paragrafo of String(txt || '').split('\n')) {
      if (!paragrafo) { linhas.push(''); continue; }
      let linha = '';
      for (const palavra of paragrafo.split(/\s+/)) {
        if (!palavra) continue;
        const teste = linha ? linha + ' ' + palavra : palavra;
        if (ctx.measureText(teste).width <= larguraMax || !linha) {
          if (!linha && ctx.measureText(palavra).width > larguraMax) {
            let pedaco = '';
            for (const ch of palavra) {
              if (ctx.measureText(pedaco + ch).width > larguraMax && pedaco) { linhas.push(pedaco); pedaco = ch; }
              else pedaco += ch;
            }
            linha = pedaco;
          } else linha = teste;
        } else { linhas.push(linha); linha = palavra; }
      }
      linhas.push(linha);
    }
    return linhas;
  }

  /* cache obrigatorio: sem ele, 300 formas x quebra por frame derruba o fps */
  function linhasDe(ctx, f) {
    const tam = fonteDe(f), larg = larguraTexto(f);
    const chave = f.texto + '|' + Math.round(larg) + '|' + tam;
    if (f._chaveLinhas !== chave) { f._linhas = quebrarTexto(ctx, f.texto, larg, tam); f._chaveLinhas = chave; }
    return f._linhas;
  }
  function alturaTexto(f) {
    const tam = fonteDe(f);
    return linhasDe(ctxParaMedir(), f).length * alturaLinha(tam) + 12;
  }
  /* altura que a FORMA precisa ter para o texto caber dentro do contorno:
     no losango o texto so ocupa a faixa central (metade da altura), na elipse ~70%. */
  function alturaNecessaria(f) {
    const fator = f.tipo === 'losango' ? 2 : f.tipo === 'elipse' ? 1.42 : 1;
    return Math.ceil(alturaTexto(f) * fator);
  }
  /* Texto que nao cabe SOME sem aviso (o clip corta) e, pior, sobra o MEIO da frase.
     A imagem passa a mentir para o Claude, que recebe a frase inteira no texto.
     Entao a forma cresce ate caber — todas, nao so o tipo 'texto'. */
  /* inverso do larguraTexto(): de quanto a forma precisa ser para sobrar 'util' por dentro */
  function larguraParaCaber(f, util) {
    if (f.tipo === 'nota') return util + 24;
    if (f.tipo === 'losango') return (util + 12) * 2;
    if (f.tipo === 'elipse') return (util + 12) / 0.7;
    return util + 16;
  }
  const LARG_MAX_TEXTO = 520;   // uma URL gigante nao pode esticar a forma pela tela toda
  /* Mesma rede da altura, agora na largura: se a MAIOR palavra nao cabe no vao util, ela
     era desenhada encostando (e passando um fio) nas duas bordas. A forma alarga ate caber. */
  function ajustarLargura(f) {
    if (!f || f.tipo === 'caneta' || f.tipo === 'seta' || f.tipo === 'linha' || f.tipo === 'texto') return false;
    const txt = String(f.texto || '');
    if (!txt.trim()) return false;
    const ctx = ctxParaMedir();
    ctx.font = fonteDe(f) + 'px ' + QD_FONTE;
    let maior = 0;
    for (const palavra of txt.split(/\s+/)) {
      if (!palavra) continue;
      const w = ctx.measureText(palavra).width;
      if (w > maior) maior = w;
    }
    if (!maior || maior <= larguraTexto(f)) return false;
    const nova = Math.min(LARG_MAX_TEXTO, Math.ceil(larguraParaCaber(f, maior)));
    if (nova > f.w + 0.5) { f.w = nova; return true; }
    return false;
  }

  function ajustarAltura(f) {
    if (!f || f.tipo === 'caneta' || f.tipo === 'seta' || f.tipo === 'linha') return false;
    if (f.tipo === 'texto') {
      const h = alturaTexto(f);
      if (Math.abs(f.h - h) > 0.5) { f.h = h; return true; }
      return false;
    }
    // a largura vem PRIMEIRO: alargar muda quantas linhas o texto ocupa
    const alargou = ajustarLargura(f);
    const nec = alturaNecessaria(f);
    if (f.h < nec) { f.h = nec; return true; }
    return alargou;
  }

  /* ULTIMA rede de seguranca do texto. A forma cresce sozinha ao ser escrita, mas ele
     ainda pode ENCOLHER a forma na mao depois (as alcas nao mexem no texto). Ai o clip
     volta a cortar. Em vez de sumir calado, o desenho passa a mostrar '…': ele ve na hora
     que ficou texto escondido, e o PNG que vai pro Claude para de mentir. */
  function alturaUtilTexto(f) {
    const fator = f.tipo === 'losango' ? 2 : f.tipo === 'elipse' ? 1.42 : 1;
    return f.h / fator - 12;
  }
  function linhasVisiveis(ctx, f, linhas, lh, tam) {
    if (f.tipo === 'texto') return linhas;                 // texto solto nao tem contorno
    const cabem = Math.floor(alturaUtilTexto(f) / lh);
    if (cabem >= linhas.length) return linhas;
    const cortadas = linhas.slice(0, Math.max(1, cabem));
    const larg = larguraTexto(f);
    ctx.font = tam + 'px ' + QD_FONTE;
    let ultima = String(cortadas[cortadas.length - 1] || '');
    while (ultima && ctx.measureText(ultima + '…').width > larg) ultima = ultima.slice(0, -1);
    cortadas[cortadas.length - 1] = ultima + '…';
    return cortadas;
  }

  /* ---------------- editor flutuante ---------------- */
  function abrirEditor(obj) {
    if (!obj) return;
    fecharEditor(true);
    const ta = Q.el.editor;
    Q.editando = { id: obj.id, obj };
    ta.value = obj.texto || '';
    ta.classList.remove('hidden');
    posicionarEditor();
    ta.focus();
    if (!obj.texto) ta.select(); else ta.setSelectionRange(ta.value.length, ta.value.length);
    agendar();
  }

  function posicionarEditor() {
    const e = Q.editando; if (!e) return;
    const ta = Q.el.editor, z = Q.cam.z, o = e.obj;
    if (o.tipo === 'seta' || o.tipo === 'linha') {
      const g = geoSeta(o);
      const t = mundoParaTela((g.ax + g.bx) / 2, (g.ay + g.by) / 2);
      ta.style.left = (t.x - 100) + 'px'; ta.style.top = (t.y - 20) + 'px';
      ta.style.width = '200px'; ta.style.height = '40px';
      ta.style.fontSize = '13px'; ta.style.lineHeight = '17px';
    } else {
      const t = mundoParaTela(o.x, o.y);
      const tam = fonteDe(o);
      ta.style.left = t.x + 'px'; ta.style.top = t.y + 'px';
      ta.style.width = Math.max(24, o.w * z) + 'px';
      ta.style.height = Math.max(20, o.h * z) + 'px';
      ta.style.fontSize = (tam * z) + 'px';
      ta.style.lineHeight = (alturaLinha(tam) * z) + 'px';
      ta.style.padding = Math.round(6 * z) + 'px ' + Math.round(8 * z) + 'px';
      /* o texto fica no meio da caixa, igual ao desenho */
      const linhas = linhasDe(ctxParaMedir(), o).length;
      const sobra = Math.max(0, (o.h * z) - linhas * alturaLinha(tam) * z - 12 * z);
      ta.style.paddingTop = Math.round(sobra / 2 + 4) + 'px';
    }
    ta.style.color = o.tipo === 'nota' ? NOTA_TINTA : resolverCor(o.cor);
  }

  function fecharEditor(confirmar) {
    const e = Q.editando; if (!e) return;
    const ta = Q.el.editor;
    Q.editando = null;
    if (confirmar) {
      e.obj.texto = ta.value;
      e.obj._chaveLinhas = null;
      if (e.obj.tipo === 'texto' && !ta.value.trim()) {
        // sem soltar as setas antes, elas ficam guardando o id de uma forma que sumiu
        soltarSetasDe(e.obj.id);
        remover(e.obj.id);
      } else ajustarAltura(e.obj);
      registrar(); marcarSujo();
    }
    ta.classList.add('hidden');
    ta.value = '';
    agendar();
  }

  /* ---------------- tema e cores ---------------- */
  function lerTema() {
    const cs = getComputedStyle(document.documentElement);
    for (const n of ['--bg', '--bg2', '--bg3', '--fg', '--fg-dim', '--fg-strong', '--line', '--line2', '--accent']) {
      Q.tema[n] = (cs.getPropertyValue(n) || '').trim();
    }
    if (!Q.tema['--bg']) Q.tema['--bg'] = '#1e1e1e';
    if (!Q.tema['--fg-strong']) Q.tema['--fg-strong'] = '#e8e8e8';
    if (!Q.tema['--accent']) Q.tema['--accent'] = '#d97757';
    if (!Q.tema['--line2']) Q.tema['--line2'] = '#3a3a3a';
  }
  function corTema(nome) { return Q.tema[nome] || '#888'; }
  function resolverCor(c) { return (!c || c === 'tinta') ? corTema('--fg-strong') : c; }

  /* ---------------- desenho ---------------- */
  function agendar() {
    if (Q.desenhoPedido) return;
    Q.desenhoPedido = true;
    requestAnimationFrame(() => { Q.desenhoPedido = false; desenhar(); });
  }

  function desenharGrade(ctx) {
    let passo = GRADE;
    while (passo * Q.cam.z < 14) passo *= 2;
    const px = passo * Q.cam.z;
    const mx0 = Math.floor(Q.cam.x / passo) * passo;
    const my0 = Math.floor(Q.cam.y / passo) * passo;
    const t0 = mundoParaTela(mx0, my0);
    ctx.fillStyle = corTema('--line2');
    ctx.globalAlpha = 0.55;
    let n = 0;
    for (let x = t0.x; x < Q.larg + px; x += px) {
      for (let y = t0.y; y < Q.alt + px; y += px) {
        ctx.fillRect(Math.round(x) - 0.5, Math.round(y) - 0.5, 1.5, 1.5);
        if (++n > 14000) { ctx.globalAlpha = 1; return; }
      }
    }
    ctx.globalAlpha = 1;
  }

  function caminhoDaForma(ctx, f) {
    ctx.beginPath();
    const { x, y, w, h } = f;
    if (f.tipo === 'elipse') {
      ctx.ellipse(x + w / 2, y + h / 2, Math.max(w / 2, 0.5), Math.max(h / 2, 0.5), 0, 0, Math.PI * 2);
    } else if (f.tipo === 'losango') {
      ctx.moveTo(x + w / 2, y);
      ctx.lineTo(x + w, y + h / 2);
      ctx.lineTo(x + w / 2, y + h);
      ctx.lineTo(x, y + h / 2);
      ctx.closePath();
    } else if (f.tipo === 'caneta') {
      const p = f.pontos || [];
      if (!p.length) return;
      ctx.moveTo(p[0][0], p[0][1]);
      for (let i = 1; i < p.length - 1; i++) {
        const mx = (p[i][0] + p[i + 1][0]) / 2, my = (p[i][1] + p[i + 1][1]) / 2;
        ctx.quadraticCurveTo(p[i][0], p[i][1], mx, my);
      }
      const u = p[p.length - 1];
      ctx.lineTo(u[0], u[1]);
    } else {
      const r = f.tipo === 'nota' ? 3 : Math.max(0, Math.min(10, w / 4, h / 4));
      if (ctx.roundRect) ctx.roundRect(x, y, Math.max(w, 0.5), Math.max(h, 0.5), r);
      else ctx.rect(x, y, Math.max(w, 0.5), Math.max(h, 0.5));
    }
  }

  function pintarForma(ctx, f, o) {
    ctx.save();
    ctx.lineWidth = Math.max(f.esp || 2, 1 / o.z);
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';

    if (f.tipo === 'nota') {
      caminhoDaForma(ctx, f);
      ctx.shadowColor = 'rgba(0,0,0,.28)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 2;
      ctx.fillStyle = NOTA_FUNDO; ctx.fill();
      ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    } else if (f.tipo !== 'texto' && f.tipo !== 'caneta' && f.fundo && f.fundo !== 'transparente') {
      /* 18% de alpha faz uma paleta so funcionar nos 3 temas, sem tabela de pasteis */
      caminhoDaForma(ctx, f);
      ctx.globalAlpha = 0.18; ctx.fillStyle = f.fundo; ctx.fill(); ctx.globalAlpha = 1;
    }
    if (f.tipo !== 'texto' && f.tipo !== 'nota') {
      caminhoDaForma(ctx, f);
      ctx.strokeStyle = resolverCor(f.cor);
      ctx.stroke();
    }

    if (f.texto && !(Q.editando && Q.editando.id === f.id && !o.exportando)) {
      const tam = fonteDe(f), lh = alturaLinha(tam);
      const linhas = linhasVisiveis(ctx, f, linhasDe(ctx, f), lh, tam);
      ctx.save();
      if (f.tipo !== 'texto') { caminhoDaForma(ctx, f); ctx.clip(); }
      ctx.font = tam + 'px ' + QD_FONTE;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = f.tipo === 'nota' ? NOTA_TINTA : resolverCor(f.cor);
      const cx = f.x + f.w / 2, cy = f.y + f.h / 2;
      let y = cy - (linhas.length * lh) / 2 + lh / 2;
      for (const l of linhas) { ctx.fillText(l, cx, y); y += lh; }
      ctx.restore();
    }
    ctx.restore();
  }

  function pintarSeta(ctx, s, o) {
    const g = geoSeta(s);
    s._geo = g;
    const len = Math.hypot(g.bx - g.ax, g.by - g.ay);
    ctx.save();
    ctx.lineWidth = Math.max(s.esp || 2, 1 / o.z);
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.strokeStyle = resolverCor(s.cor);
    if (len < 2) {
      /* formas sobrepostas: a ponta de flecha vira borrao e o atan2 gira louco */
      ctx.beginPath();
      ctx.arc((g.ax + g.bx) / 2, (g.ay + g.by) / 2, 3 / o.z, 0, Math.PI * 2);
      ctx.fillStyle = resolverCor(s.cor); ctx.fill();
      ctx.restore();
      return;
    }
    ctx.beginPath();
    ctx.moveTo(g.ax, g.ay); ctx.lineTo(g.bx, g.by);
    ctx.stroke();

    if (s.tipo === 'seta') {
      const ang = Math.atan2(g.by - g.ay, g.bx - g.ax);
      const tam = Math.min(Math.max(12, 8 / o.z), 26 / o.z);
      const ab = 0.48;
      ctx.beginPath();
      ctx.moveTo(g.bx - tam * Math.cos(ang - ab), g.by - tam * Math.sin(ang - ab));
      ctx.lineTo(g.bx, g.by);
      ctx.lineTo(g.bx - tam * Math.cos(ang + ab), g.by - tam * Math.sin(ang + ab));
      ctx.stroke();
    }

    if (s.texto && !(Q.editando && Q.editando.id === s.id && !o.exportando)) {
      const cx = (g.ax + g.bx) / 2, cy = (g.ay + g.by) / 2;
      ctx.font = '13px ' + QD_FONTE;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const l = ctx.measureText(s.texto).width;
      ctx.fillStyle = corTema('--bg');
      ctx.fillRect(cx - l / 2 - 4, cy - 9, l + 8, 18);
      ctx.fillStyle = resolverCor(s.cor);
      ctx.fillText(s.texto, cx, cy);
    }
    ctx.restore();
  }

  function pintarCena(ctx, o) {
    // formas primeiro, setas por cima: e o certo pra fluxograma
    for (const f of Q.cena.formas) pintarForma(ctx, f, o);
    for (const s of Q.cena.setas) pintarSeta(ctx, s, o);
  }

  /* alcas so com selecao de EXATAMENTE uma forma: elimina uma classe inteira de bug */
  function formaUnicaSelecionada() {
    if (Q.selecao.size !== 1) return null;
    const id = [...Q.selecao][0];
    return formaPorId(id);
  }
  function setaUnicaSelecionada() {
    if (Q.selecao.size !== 1) return null;
    return setaPorId([...Q.selecao][0]);
  }
  function alcasDe(f) {
    if (f.tipo === 'texto') return ['e', 'w'];
    if (f.tipo === 'caneta') return ['nw', 'ne', 'se', 'sw'];
    return ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  }
  function pontoDaAlca(b, a) {
    const x = { nw: b.x, n: b.x + b.w / 2, ne: b.x + b.w, e: b.x + b.w, se: b.x + b.w, s: b.x + b.w / 2, sw: b.x, w: b.x }[a];
    const y = { nw: b.y, n: b.y, ne: b.y, e: b.y + b.h / 2, se: b.y + b.h, s: b.y + b.h, sw: b.y + b.h, w: b.y + b.h / 2 }[a];
    return mundoParaTela(x, y);
  }
  function alcaEm(tx, ty) {
    const f = formaUnicaSelecionada();
    if (!f) return null;
    const b = bboxForma(f);
    for (const a of alcasDe(f)) {
      const p = pontoDaAlca(b, a);
      if (Math.abs(tx - p.x) <= 7 && Math.abs(ty - p.y) <= 7) return a;
    }
    return null;
  }
  function pontaSetaEm(tx, ty) {
    const s = setaUnicaSelecionada();
    if (!s) return null;
    const g = geoSeta(s);
    const a = mundoParaTela(g.ax, g.ay), b = mundoParaTela(g.bx, g.by);
    if (Math.hypot(tx - a.x, ty - a.y) <= 9) return 'de';
    if (Math.hypot(tx - b.x, ty - b.y) <= 9) return 'para';
    return null;
  }

  function desenharSelecao(ctx) {
    ctx.save();
    ctx.lineWidth = 1;

    // realce da forma sob o cursor enquanto a seta e puxada
    if (Q.alvoSeta) {
      const f = formaPorId(Q.alvoSeta);
      if (f) {
        const b = bboxForma(f);
        const p = mundoParaTela(b.x, b.y);
        const w = b.w * Q.cam.z, h = b.h * Q.cam.z;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(p.x - 4, p.y - 4, w + 8, h + 8, 8);
        else ctx.rect(p.x - 4, p.y - 4, w + 8, h + 8);
        ctx.globalAlpha = 0.10; ctx.fillStyle = corTema('--accent'); ctx.fill(); ctx.globalAlpha = 1;
        ctx.strokeStyle = corTema('--accent'); ctx.lineWidth = 2.5; ctx.setLineDash([]);
        ctx.stroke();
        ctx.lineWidth = 1;
      }
    }

    ctx.strokeStyle = corTema('--accent');
    ctx.setLineDash([4, 4]);
    for (const id of Q.selecao) {
      const o = itemPorId(id);
      if (!o) continue;
      let b;
      if (o.tipo === 'seta' || o.tipo === 'linha') {
        const g = geoSeta(o);
        b = { x: Math.min(g.ax, g.bx), y: Math.min(g.ay, g.by), w: Math.abs(g.bx - g.ax), h: Math.abs(g.by - g.ay) };
      } else b = bboxForma(o);
      const p = mundoParaTela(b.x, b.y);
      ctx.strokeRect(p.x - 3, p.y - 3, b.w * Q.cam.z + 6, b.h * Q.cam.z + 6);
    }
    ctx.setLineDash([]);

    const f = formaUnicaSelecionada();
    if (f) {
      const b = bboxForma(f);
      ctx.fillStyle = corTema('--bg'); ctx.strokeStyle = corTema('--accent'); ctx.lineWidth = 1.5;
      for (const a of alcasDe(f)) {
        const p = pontoDaAlca(b, a);
        ctx.fillRect(p.x - 4.5, p.y - 4.5, 9, 9);
        ctx.strokeRect(p.x - 4.5, p.y - 4.5, 9, 9);
      }
    }
    const s = setaUnicaSelecionada();
    if (s) {
      const g = geoSeta(s);
      ctx.fillStyle = corTema('--bg'); ctx.strokeStyle = corTema('--accent'); ctx.lineWidth = 1.5;
      for (const p of [mundoParaTela(g.ax, g.ay), mundoParaTela(g.bx, g.by)]) {
        ctx.beginPath(); ctx.arc(p.x, p.y, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
    }

    if (Q.gesto && Q.gesto.tipo === 'laco') {
      const a = mundoParaTela(Q.gesto.x0, Q.gesto.y0), b = mundoParaTela(Q.gesto.x1, Q.gesto.y1);
      const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
      ctx.globalAlpha = 0.08; ctx.fillStyle = corTema('--accent'); ctx.fillRect(x, y, w, h); ctx.globalAlpha = 1;
      ctx.setLineDash([4, 4]); ctx.lineWidth = 1; ctx.strokeStyle = corTema('--accent');
      ctx.strokeRect(x, y, w, h);
      ctx.setLineDash([]);
    }
    ctx.restore();
  }

  function desenhar() {
    if (!Q.aberto || !Q.ctx) return;
    const ctx = Q.ctx;
    // passe 0 — tela: fundo e grade
    ctx.setTransform(Q.dpr, 0, 0, Q.dpr, 0, 0);
    ctx.clearRect(0, 0, Q.larg, Q.alt);
    ctx.fillStyle = corTema('--bg');
    ctx.fillRect(0, 0, Q.larg, Q.alt);
    desenharGrade(ctx);
    // passe 1 — mundo: a cena
    ctx.save(); aplicarCamera(ctx);
    pintarCena(ctx, { z: Q.cam.z, exportando: false });
    ctx.restore();
    // passe 2 — tela: selecao, alcas, laco
    ctx.setTransform(Q.dpr, 0, 0, Q.dpr, 0, 0);
    desenharSelecao(ctx);
    atualizarUI();
  }

  function atualizarUI() {
    const vazio = cenaVazia();
    if (Q.el.dica) Q.el.dica.classList.toggle('hidden', !vazio);
    if (Q.el.zoomN) Q.el.zoomN.textContent = Math.round(Q.cam.z * 100) + '%';
    if (Q.el.conta) {
      const nf = Q.cena.formas.length, ns = Q.cena.setas.length;
      Q.el.conta.textContent = vazio ? 'Quadro vazio'
        : (nf + (nf === 1 ? ' peça' : ' peças') + ' · ' + ns + (ns === 1 ? ' ligação' : ' ligações'));
    }
    if (Q.el.mandar) Q.el.mandar.disabled = vazio || !Q.P;
    // 'flex', nao '': com display:'' o grupo voltava a block e o gap/centralizacao morriam
    if (Q.el.grupoSel) Q.el.grupoSel.style.display = Q.selecao.size ? 'flex' : 'none';
    if (Q.el.desfazer) Q.el.desfazer.disabled = Q.pilha.indice <= 0;
    if (Q.el.refazer) Q.el.refazer.disabled = Q.pilha.indice >= Q.pilha.passos.length - 1;
    pintarProps();
  }

  /* ---------------- ferramentas e cursor ---------------- */
  function setFerramenta(f) {
    Q.ferramenta = f;
    for (const bt of Q.el.botoesFer || []) {
      // 'ativa' (com A) e o nome unico de estado ligado do quadro: qd-fer, qd-cor,
      // qd-fundo e qd-esp-bt usam todos o mesmo. 'ativo' nao existe mais.
      bt.classList.toggle('ativa', bt.dataset.f === f);
    }
    atualizarCursor();
    agendar();
  }

  function atualizarCursor(tx, ty) {
    const c = Q.el.canvas; if (!c) return;
    if (Q.espaco || Q.ferramenta === 'mao') { c.style.cursor = Q.gesto && Q.gesto.tipo === 'pan' ? 'grabbing' : 'grab'; return; }
    if (Q.ferramenta === 'borracha') { c.style.cursor = 'cell'; return; }
    if (Q.ferramenta !== 'selecionar') { c.style.cursor = 'crosshair'; return; }
    if (Q.gesto && (Q.gesto.tipo === 'criandoSeta' || Q.gesto.tipo === 'pontaSeta')) { c.style.cursor = Q.alvoSeta ? 'copy' : 'crosshair'; return; }
    if (tx != null) {
      const a = alcaEm(tx, ty);
      if (a) {
        c.style.cursor = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize',
          n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize' }[a];
        return;
      }
      if (pontaSetaEm(tx, ty)) { c.style.cursor = 'crosshair'; return; }
      const m = telaParaMundo(tx, ty);
      const alvo = achar(m.x, m.y);
      c.style.cursor = alvo ? 'move' : 'default';
      return;
    }
    c.style.cursor = 'default';
  }

  /* ---------------- gestos ---------------- */
  function cancelarGesto() {
    const g = Q.gesto;
    if (!g) return;
    if (g.tipo === 'criando' || g.tipo === 'caneta') remover(g.f.id);
    else if (g.tipo === 'criandoSeta') remover(g.s.id);
    else if (g.tipo === 'movendo') {
      /* Esc no meio do arrasto TEM de devolver a peca pro lugar. Antes o gesto era so
         jogado fora: a peca ficava onde o mouse parou e a pilha de desfazer apontava
         para outro estado — o ⌘Z seguinte pulava um passo e apagava trabalho. */
      for (const [id, o0] of g.orig) {
        const o = itemPorId(id);
        if (!o) continue;
        if (o.tipo === 'seta' || o.tipo === 'linha') {
          o.de = JSON.parse(JSON.stringify(o0.de));
          o.para = JSON.parse(JSON.stringify(o0.para));
        } else {
          o.x = o0.x; o.y = o0.y;
          if (o0.pontos) o.pontos = o0.pontos.map(p => [p[0], p[1]]);
          o._chaveLinhas = null;
        }
      }
    } else if (g.tipo === 'redim') {
      const f = formaPorId(g.id);
      if (f) {
        f.x = g.orig.x; f.y = g.orig.y; f.w = g.orig.w; f.h = g.orig.h;
        if (g.origPontos) f.pontos = g.origPontos.map(p => [p[0], p[1]]);
        f._chaveLinhas = null;
      }
    } else if (g.tipo === 'pontaSeta') {
      if (g.s && g.origPonta) g.s[g.ponta] = JSON.parse(JSON.stringify(g.origPonta));
    }
    Q.gesto = null; Q.alvoSeta = null;
    // cinto de seguranca: a pilha de desfazer nunca pode divergir da cena
    registrar();
    agendar();
  }

  function iniciarPinch() {
    const p = [...Q.ponteiros.values()];
    if (p.length < 2) return;
    const [a, b] = p;
    Q.pinch = {
      dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
      meio: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      cam: { x: Q.cam.x, y: Q.cam.y, z: Q.cam.z },
    };
  }
  function moverPinch() {
    const p = [...Q.ponteiros.values()];
    if (p.length < 2 || !Q.pinch) return;
    const [a, b] = p;
    const dist2 = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
    const meio2 = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    let z = Q.pinch.cam.z * (dist2 / Q.pinch.dist);
    z = Math.min(ZMAX, Math.max(ZMIN, z));
    Q.cam.z = z;
    Q.cam.x = (Q.pinch.cam.x + Q.pinch.meio.x / Q.pinch.cam.z) - meio2.x / z;
    Q.cam.y = (Q.pinch.cam.y + Q.pinch.meio.y / Q.pinch.cam.z) - meio2.y / z;
    agendar();
  }

  function novaForma(tipo, x, y, w, h) {
    return {
      id: novoId('f'), tipo, x, y, w, h, texto: '',
      cor: Q.estilo.cor,
      fundo: tipo === 'nota' ? 'transparente' : Q.estilo.fundo,
      esp: Q.estilo.esp,
    };
  }

  function aoDescer(e) {
    const t = pontoDoEvento(e);
    e.preventDefault();
    Q.saiuDoPinch = false;   // flag so vale pro toque imediatamente seguinte a pinca
    try { Q.el.canvas.setPointerCapture(e.pointerId); } catch (_) {}
    Q.ponteiros.set(e.pointerId, t);

    if (Q.ponteiros.size >= 2) {
      /* no iPad o 2o dedo chega ms depois do 1o: sem cancelar, cada zoom deixa um risco */
      cancelarGesto();
      iniciarPinch();
      return;
    }
    if (Q.bloqueado) return;
    if (Q.editando) fecharEditor(true);

    const m = telaParaMundo(t.x, t.y);
    const alt = !!e.altKey;

    if (Q.espaco || Q.ferramenta === 'mao' || e.button === 1) {
      Q.gesto = { tipo: 'pan', t0: t, cam0: { x: Q.cam.x, y: Q.cam.y }, mudou: false };
      atualizarCursor(); return;
    }

    if (Q.ferramenta === 'selecionar') {
      // no toque, 1 dedo no vazio ARRASTA a tela; laco com o dedo confunde e prende
      if (e.pointerType === 'touch' && !achar(m.x, m.y) && !alcaEm(t.x, t.y) && !pontaSetaEm(t.x, t.y)) {
        Q.gesto = { tipo: 'pan', t0: t, cam0: { x: Q.cam.x, y: Q.cam.y }, mudou: false };
        return;
      }
      const alca = alcaEm(t.x, t.y);
      if (alca) {
        const f = formaUnicaSelecionada();
        Q.gesto = { tipo: 'redim', id: f.id, alca, mudou: false,
          orig: { x: f.x, y: f.y, w: f.w, h: f.h },
          origPontos: f.pontos ? f.pontos.map(p => [p[0], p[1]]) : null };
        return;
      }
      const ponta = pontaSetaEm(t.x, t.y);
      if (ponta) {
        const sel = setaUnicaSelecionada();
        // copia da ponta: sem ela o Esc no meio do arrasto nao tem para onde voltar
        Q.gesto = { tipo: 'pontaSeta', s: sel, ponta, mudou: false,
          origPonta: sel ? JSON.parse(JSON.stringify(sel[ponta])) : null };
        return;
      }
      const alvo = achar(m.x, m.y);
      if (alvo) {
        const id = alvo.obj.id;
        if (e.shiftKey) {
          if (Q.selecao.has(id)) Q.selecao.delete(id); else Q.selecao.add(id);
          agendar(); return;
        }
        if (!Q.selecao.has(id)) { Q.selecao.clear(); Q.selecao.add(id); }
        const orig = new Map();
        for (const sid of Q.selecao) {
          const o = itemPorId(sid);
          if (!o) continue;
          orig.set(sid, JSON.parse(JSON.stringify(o.tipo === 'seta' || o.tipo === 'linha'
            ? { de: o.de, para: o.para }
            : { x: o.x, y: o.y, pontos: o.pontos || null })));
        }
        /* peca de referencia do encaixe: o delta e calculado UMA vez e somado em todo
           mundo. Encaixando peca por peca, quem ja estava na grade nao anda e quem estava
           fora anda ate 8px — a cada arrasto o desenho se deformava sozinho. */
        let ref = null;
        for (const [, o0] of orig) {
          if (o0.x != null) { ref = { x: o0.x, y: o0.y }; break; }
          if (o0.de && !o0.de.forma) { ref = { x: o0.de.x, y: o0.de.y }; break; }
        }
        Q.gesto = { tipo: 'movendo', m0: m, orig, ref, mudou: false };
        agendar(); return;
      }
      if (!e.shiftKey) Q.selecao.clear();
      Q.gesto = { tipo: 'laco', x0: m.x, y0: m.y, x1: m.x, y1: m.y, mudou: false };
      agendar(); return;
    }

    if (Q.ferramenta === 'borracha') {
      Q.gesto = { tipo: 'borracha', mudou: false };
      apagarSob(m.x, m.y);
      return;
    }

    if (Q.ferramenta === 'seta' || Q.ferramenta === 'linha') {
      const s = {
        id: novoId('s'), tipo: Q.ferramenta,
        de: ancorar(m.x, m.y, alt),
        para: { forma: null, x: m.x, y: m.y },
        texto: '', cor: Q.estilo.cor, esp: Q.estilo.esp,
      };
      adicionar(s);
      Q.gesto = { tipo: 'criandoSeta', s, mudou: false };
      agendar(); return;
    }

    if (Q.ferramenta === 'caneta') {
      const f = novaForma('caneta', m.x, m.y, 1, 1);
      f.pontos = [[m.x, m.y]];
      adicionar(f);
      Q.gesto = { tipo: 'caneta', f, mudou: false };
      agendar(); return;
    }

    const x0 = enc(m.x, alt), y0 = enc(m.y, alt);
    const f = novaForma(Q.ferramenta, x0, y0, 0, 0);
    adicionar(f);
    Q.gesto = { tipo: 'criando', f, x0, y0, mudou: false };
    agendar();
  }

  function aoMover(e) {
    if (!Q.ponteiros.has(e.pointerId) && !Q.gesto) {
      if (Q.ferramenta === 'selecionar') { const t = pontoDoEvento(e); atualizarCursor(t.x, t.y); }
      return;
    }
    const t = pontoDoEvento(e);
    if (Q.ponteiros.has(e.pointerId)) Q.ponteiros.set(e.pointerId, t);
    if (Q.pinch) { moverPinch(); return; }
    const g = Q.gesto;
    if (!g) { if (Q.ferramenta === 'selecionar') atualizarCursor(t.x, t.y); return; }
    const m = telaParaMundo(t.x, t.y);
    const alt = !!e.altKey;

    if (g.tipo === 'pan') {
      Q.cam.x = g.cam0.x - (t.x - g.t0.x) / Q.cam.z;
      Q.cam.y = g.cam0.y - (t.y - g.t0.y) / Q.cam.z;
      agendar(); return;
    }
    if (g.tipo === 'criando') {
      let dx = enc(m.x, alt) - g.x0, dy = enc(m.y, alt) - g.y0;
      if (e.shiftKey) {
        const s = Math.max(Math.abs(dx), Math.abs(dy));
        dx = Math.sign(dx || 1) * s; dy = Math.sign(dy || 1) * s;
      }
      g.f.x = Math.min(g.x0, g.x0 + dx); g.f.w = Math.abs(dx);
      g.f.y = Math.min(g.y0, g.y0 + dy); g.f.h = Math.abs(dy);
      g.f._chaveLinhas = null;
      g.mudou = true; agendar(); return;
    }
    if (g.tipo === 'caneta') {
      const u = g.f.pontos[g.f.pontos.length - 1];
      if (Math.hypot(m.x - u[0], m.y - u[1]) > 2 / Q.cam.z) {
        g.f.pontos.push([m.x, m.y]);
        const b = bboxForma(g.f);
        g.f.x = b.x; g.f.y = b.y; g.f.w = b.w; g.f.h = b.h;
        g.mudou = true; agendar();
      }
      return;
    }
    if (g.tipo === 'criandoSeta' || g.tipo === 'pontaSeta') {
      const s = g.s;
      const qual = g.tipo === 'criandoSeta' ? 'para' : g.ponta;
      s[qual] = ancorar(m.x, m.y, alt);
      Q.alvoSeta = s[qual].forma;
      g.mudou = true;
      atualizarCursor(t.x, t.y);
      agendar(); return;
    }
    if (g.tipo === 'movendo') {
      /* aplicar o delta sobre a COPIA original: encaixe sobre o valor corrente
         faz a forma ir andando sozinha e desalinhando */
      const dx = m.x - g.m0.x, dy = m.y - g.m0.y;
      let ex = dx, ey = dy;
      if (g.ref) { ex = enc(g.ref.x + dx, alt) - g.ref.x; ey = enc(g.ref.y + dy, alt) - g.ref.y; }
      for (const [id, o0] of g.orig) {
        const o = itemPorId(id);
        if (!o) continue;
        if (o.tipo === 'seta' || o.tipo === 'linha') {
          if (!o0.de.forma) { o.de.x = o0.de.x + ex; o.de.y = o0.de.y + ey; }
          if (!o0.para.forma) { o.para.x = o0.para.x + ex; o.para.y = o0.para.y + ey; }
        } else if (o.tipo === 'caneta' && o0.pontos) {
          o.pontos = o0.pontos.map(p => [p[0] + ex, p[1] + ey]);
          o.x = o0.x + ex; o.y = o0.y + ey;
        } else {
          o.x = o0.x + ex; o.y = o0.y + ey;
        }
      }
      g.mudou = true; agendar(); return;
    }
    if (g.tipo === 'redim') { redimensionarForma(g, m, alt, e.shiftKey); g.mudou = true; agendar(); return; }
    if (g.tipo === 'laco') { g.x1 = m.x; g.y1 = m.y; agendar(); return; }
    if (g.tipo === 'borracha') { apagarSob(m.x, m.y); return; }
  }

  function redimensionarForma(g, m, alt, shift) {
    const f = formaPorId(g.id);
    if (!f) return;
    const o = g.orig;
    let l = o.x, t = o.y, r = o.x + o.w, b = o.y + o.h;
    const a = g.alca;
    if (a.includes('w')) l = enc(m.x, alt);
    if (a.includes('e')) r = enc(m.x, alt);
    if (a.includes('n')) t = enc(m.y, alt);
    if (a.includes('s')) b = enc(m.y, alt);
    let w = Math.abs(r - l), h = Math.abs(b - t);
    if (shift && a.length === 2 && o.h > 0) {
      const prop = o.w / o.h;
      if (w / Math.max(h, 1) > prop) h = w / prop; else w = h * prop;
      if (a.includes('w')) l = r - w; else r = l + w;
      if (a.includes('n')) t = b - h; else b = t + h;
    }
    f.x = Math.min(l, r); f.w = Math.max(SNAP, w);
    f.y = Math.min(t, b); f.h = Math.max(SNAP, h);
    f._chaveLinhas = null;
    if (f.tipo === 'caneta' && g.origPontos) {
      const sx = f.w / (o.w || 1), sy = f.h / (o.h || 1);
      f.pontos = g.origPontos.map(([px, py]) => [f.x + (px - o.x) * sx, f.y + (py - o.y) * sy]);
    }
    if (f.tipo === 'texto') f.h = alturaTexto(f);
  }

  function apagarSob(mx, my) {
    const alvo = achar(mx, my);
    if (!alvo) return;
    if (alvo.tipo === 'forma') soltarSetasDe(alvo.obj.id);
    remover(alvo.obj.id);
    if (Q.gesto) Q.gesto.mudou = true;
    agendar();
  }

  /* apagar a forma converte as setas dela em pontas livres, no lugar onde estavam.
     Apagar a seta junto destruiria trabalho que ele nao pediu. */
  function soltarSetasDe(id) {
    const f = formaPorId(id);
    const c = f ? centro(f) : null;
    for (const s of Q.cena.setas) {
      for (const p of ['de', 'para']) {
        if (s[p].forma === id) {
          if (c) { s[p].x = c.x; s[p].y = c.y; }
          s[p].forma = null;
        }
      }
    }
  }

  function aoSubir(e) {
    const t = pontoDoEvento(e);
    Q.ponteiros.delete(e.pointerId);
    if (Q.pinch) {
      if (Q.ponteiros.size < 2) { Q.pinch = null; Q.bloqueado = Q.ponteiros.size > 0; Q.saiuDoPinch = true; }
      return;
    }
    if (Q.ponteiros.size === 0) Q.bloqueado = false;

    const g = Q.gesto;
    // o solto do ultimo dedo da pinca nao e um toque: sem isso, repetir a pinca no mesmo
    // ponto em menos de 320ms abria uma caixa de texto vazia sozinha (duplo-toque falso)
    if (!g) { if (Q.saiuDoPinch) { Q.saiuDoPinch = false; Q.ultimoToque.t = 0; return; } detectarDuploToque(e, t); return; }
    Q.gesto = null;
    Q.alvoSeta = null;

    if (g.tipo === 'criando') {
      const f = g.f;
      // OU, nao E: um arrasto quase reto criava uma forma com um lado zerado — um risco
      // invisivel que ainda contava como peca e ia junto no PNG e na leitura pro Claude
      // o corte e SNAP*2 (16) porque a grade de encaixe e 8: com 4 sobrava a faixa
      // 4..8 e um arrasto quase reto ainda virava uma tira de 8px, invisivel na tela
      // mas contada como peca e mandada no PNG e na leitura pro Claude
      if (f.w < SNAP * 2 || f.h < SNAP * 2) {
        const p = PADRAO[f.tipo] || PADRAO.retangulo;
        f.x = enc(g.x0 - p.w / 2, false); f.y = enc(g.y0 - p.h / 2, false);
        f.w = p.w; f.h = p.h;
        g.mudou = true;
      }
      Q.selecao.clear(); Q.selecao.add(f.id);
      // o post-it tambem volta pra seta: armado, o clique seguinte (que era so pra
      // selecionar) carimbava mais um post-it
      setFerramenta('selecionar');
      if (f.tipo === 'texto') { registrar(); marcarSujo(); abrirEditor(f); return; }
    } else if (g.tipo === 'caneta') {
      if (!g.f.pontos || g.f.pontos.length < 2) { remover(g.f.id); g.mudou = false; }
    } else if (g.tipo === 'criandoSeta') {
      const s = g.s;
      // clique sem arrastar nao vira seta: senao cada toque na tela deixa um ponto solto
      const solto = !g.mudou || (!s.de.forma && !s.para.forma
        && Math.hypot(s.para.x - s.de.x, s.para.y - s.de.y) < 6);
      const laco = s.de.forma && s.de.forma === s.para.forma;   // auto-laco nao vale a complexidade
      if (solto || laco) { remover(s.id); g.mudou = false; }
      else { Q.selecao.clear(); Q.selecao.add(s.id); }
    } else if (g.tipo === 'laco') {
      const x0 = Math.min(g.x0, g.x1), x1 = Math.max(g.x0, g.x1);
      const y0 = Math.min(g.y0, g.y1), y1 = Math.max(g.y0, g.y1);
      for (const f of Q.cena.formas) {
        const b = bboxForma(f);
        // interseccao, nao contencao: e o que o leigo espera
        if (b.x < x1 && b.x + b.w > x0 && b.y < y1 && b.y + b.h > y0) Q.selecao.add(f.id);
      }
      for (const s of Q.cena.setas) {
        const gg = geoSeta(s);
        const dentro = (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
        if (dentro(gg.ax, gg.ay) && dentro(gg.bx, gg.by)) Q.selecao.add(s.id);
      }
    }

    if (g.mudou) { registrar(); marcarSujo(); }
    atualizarCursor(t.x, t.y);
    agendar();
    detectarDuploToque(e, t);
  }

  /* no iOS o dblclick nao chega: dois toques no mesmo lugar em menos de 320ms valem por ele */
  function detectarDuploToque(e, t) {
    if (e.pointerType !== 'touch') { Q.ultimoToque.t = 0; return; }
    const agora = Date.now();
    if (agora - Q.ultimoToque.t < 320 && Math.hypot(t.x - Q.ultimoToque.x, t.y - Q.ultimoToque.y) < 12) {
      Q.ultimoToque.t = 0;
      abrirEditorNoPonto(telaParaMundo(t.x, t.y));
      return;
    }
    Q.ultimoToque = { t: agora, x: t.x, y: t.y };
  }

  /* Rotular a seta ("sim" / "nao") e o gesto mais comum de um fluxograma de decisao, e a
     mira de clique normal (8px) e apertada demais para isso: errar por 3px cria uma caixa de
     texto solta, que na leitura enviada ao Claude vira "observacao solta" em vez de virar a
     condicao do ramo. Por isso o duplo clique procura seta com folga bem maior que o clique. */
  function acharSetaPerto(mx, my, tolTela) {
    const tol = tolTela / Q.cam.z;
    for (let i = Q.cena.setas.length - 1; i >= 0; i--) {
      const s = Q.cena.setas[i], g = geoSeta(s);
      if (distanciaPontoSegmento(mx, my, g.ax, g.ay, g.bx, g.by) <= tol) return s;
    }
    return null;
  }

  function abrirEditorNoPonto(m) {
    const alvo = achar(m.x, m.y) || (() => {
      const s = acharSetaPerto(m.x, m.y, 22);
      return s ? { tipo: 'seta', obj: s } : null;
    })();
    if (alvo) {
      Q.selecao.clear(); Q.selecao.add(alvo.obj.id);
      abrirEditor(alvo.obj);
      return;
    }
    const f = novaForma('texto', enc(m.x - PADRAO.texto.w / 2, false), enc(m.y - 17, false), PADRAO.texto.w, PADRAO.texto.h);
    adicionar(f);
    Q.selecao.clear(); Q.selecao.add(f.id);
    abrirEditor(f);
  }

  function aoDuploClique(e) {
    e.preventDefault();
    abrirEditorNoPonto(pontoMundoDoEvento(e));
  }

  function aoRoda(e) {
    e.preventDefault();
    const t = pontoDoEvento(e);
    if (e.ctrlKey || e.metaKey) {
      // a pinca do trackpad do Mac chega como wheel + ctrlKey
      zoomPara(Q.cam.z * Math.exp(-e.deltaY * 0.01), t.x, t.y);
    } else {
      Q.cam.x += e.deltaX / Q.cam.z;
      Q.cam.y += e.deltaY / Q.cam.z;
      if (Q.editando) posicionarEditor();
      agendar();
    }
  }

  /* ---------------- selecao: acoes ---------------- */
  function selecionados() {
    const formas = [], setas = [];
    for (const id of Q.selecao) {
      const f = formaPorId(id); if (f) { formas.push(f); continue; }
      const s = setaPorId(id); if (s) setas.push(s);
    }
    return { formas, setas };
  }

  function selecionarTudo() {
    Q.selecao.clear();
    for (const f of Q.cena.formas) Q.selecao.add(f.id);
    for (const s of Q.cena.setas) Q.selecao.add(s.id);
    agendar();
  }

  function apagarSelecao() {
    if (!Q.selecao.size) return;
    for (const id of [...Q.selecao]) {
      if (formaPorId(id)) soltarSetasDe(id);
      remover(id);
    }
    Q.selecao.clear();
    registrar(); marcarSujo(); agendar();
  }

  function duplicarSelecao() {
    const { formas, setas } = selecionados();
    if (!formas.length && !setas.length) return;
    const mapa = new Map();
    const novos = [];
    for (const f of formas) {
      const c = JSON.parse(JSON.stringify(limparCena({ formas: [f], setas: [] }).formas[0]));
      c.id = novoId('f'); c.x += 16; c.y += 16;
      if (c.pontos) c.pontos = c.pontos.map(p => [p[0] + 16, p[1] + 16]);
      mapa.set(f.id, c.id);
      Q.cena.formas.push(c); novos.push(c.id);
    }
    for (const s of setas) {
      const c = JSON.parse(JSON.stringify(limparCena({ formas: [], setas: [s] }).setas[0]));
      c.id = novoId('s');
      for (const p of ['de', 'para']) {
        // ponta presa numa forma que TAMBEM foi copiada segue a copia; nas de fora, fica onde estava
        if (c[p].forma && mapa.has(c[p].forma)) c[p].forma = mapa.get(c[p].forma);
        else if (!c[p].forma) { c[p].x += 16; c[p].y += 16; }
      }
      Q.cena.setas.push(c); novos.push(c.id);
    }
    Q.selecao.clear();
    for (const id of novos) Q.selecao.add(id);
    registrar(); marcarSujo(); agendar();
  }

  function reordenar(paraFim) {
    const { formas, setas } = selecionados();
    if (!formas.length && !setas.length) return;
    const mover = (lista, itens) => {
      const ids = new Set(itens.map(i => i.id));
      const fora = lista.filter(i => !ids.has(i.id));
      const dentro = lista.filter(i => ids.has(i.id));
      return paraFim ? fora.concat(dentro) : dentro.concat(fora);
    };
    if (formas.length) Q.cena.formas = mover(Q.cena.formas, formas);
    if (setas.length) Q.cena.setas = mover(Q.cena.setas, setas);
    registrar(); marcarSujo(); agendar();
  }
  const paraFrente = () => reordenar(true);
  const paraTras = () => reordenar(false);

  function aplicarEstilo(o) {
    if (o.cor != null) Q.estilo.cor = o.cor;
    if (o.fundo != null) Q.estilo.fundo = o.fundo;
    if (o.esp != null) Q.estilo.esp = o.esp;
    const { formas, setas } = selecionados();
    for (const f of formas) {
      if (o.cor != null) f.cor = o.cor;
      if (o.fundo != null && f.tipo !== 'nota') f.fundo = o.fundo;
      if (o.esp != null) f.esp = o.esp;
    }
    for (const s of setas) {
      if (o.cor != null) s.cor = o.cor;
      if (o.esp != null) s.esp = o.esp;
    }
    if (formas.length || setas.length) { registrar(); marcarSujo(); }
    agendar();
  }

  function moverSelecao(dx, dy) {
    const { formas, setas } = selecionados();
    if (!formas.length && !setas.length) return;
    for (const f of formas) {
      f.x += dx; f.y += dy;
      if (f.pontos) f.pontos = f.pontos.map(p => [p[0] + dx, p[1] + dy]);
    }
    for (const s of setas) {
      for (const p of ['de', 'para']) if (!s[p].forma) { s[p].x += dx; s[p].y += dy; }
    }
    marcarSujo();
    // uma rajada de setinhas vira UM passo de desfazer, nao um por tecla
    clearTimeout(Q.setasTimer);
    Q.setasTimer = setTimeout(() => { Q.setasTimer = null; registrar(); }, 400);
    agendar();
  }

  /* ---------------- desfazer / refazer ---------------- */
  const instantaneo = () => JSON.parse(JSON.stringify(limparCena(Q.cena)));

  function iniciarPilha() { Q.pilha.passos = [instantaneo()]; Q.pilha.indice = 0; }

  function registrar() {
    const s = instantaneo();
    const atual = Q.pilha.passos[Q.pilha.indice];
    if (atual && JSON.stringify(atual) === JSON.stringify(s)) return;
    Q.pilha.passos.length = Q.pilha.indice + 1;
    Q.pilha.passos.push(s);
    while (Q.pilha.passos.length > MAX_PASSOS) Q.pilha.passos.shift();
    Q.pilha.indice = Q.pilha.passos.length - 1;
    Q.enviado = false;
    pintarPontinho();
  }

  function irPara(i) {
    Q.pilha.indice = i;
    Q.cena = normalizarCena(JSON.parse(JSON.stringify(Q.pilha.passos[i])));
    Q.selecao.clear(); Q.gesto = null;
    if (Q.editando) { Q.editando = null; Q.el.editor.classList.add('hidden'); }
    marcarSujo(); agendar();
  }
  function desfazer() { if (Q.pilha.indice > 0) irPara(Q.pilha.indice - 1); }
  function refazer() { if (Q.pilha.indice < Q.pilha.passos.length - 1) irPara(Q.pilha.indice + 1); }

  /* ---------------- teclado ---------------- */
  function aoTeclar(e) {
    if (!Q.aberto) return;
    // a lista de atalhos (⌘/) abre POR CIMA do quadro: enquanto ela estiver la, o teclado e dela
    const at = document.getElementById('telaAtalhos');
    if (at && !at.classList.contains('hidden')) return;
    const dentroEditor = Q.editando || (e.target && e.target.classList && e.target.classList.contains('qd-editor'));
    if (dentroEditor) {
      // digitar "rota" nao pode trocar de ferramenta 4 vezes
      const c = e.metaKey || e.ctrlKey;
      if (e.key === 'Escape' || (e.key === 'Enter' && c)) {
        e.preventDefault(); e.stopPropagation();
        fecharEditor(true);
      } else if (c && (e.key === 'z' || e.key === 'Z')) {
        /* ⌘Z/⌘⇧Z/⌘Y/⌘A a mao: o menu Editar do app manda um RECADO (nao a tecla), e recado
           nao aciona o desfazer nativo do campo. Aqui a textarea desfaz de verdade. */
        e.preventDefault(); e.stopPropagation();
        try { document.execCommand(e.shiftKey ? 'redo' : 'undo'); } catch (_) {}
      } else if (c && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault(); e.stopPropagation();
        try { document.execCommand('redo'); } catch (_) {}
      } else if (c && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault(); e.stopPropagation();
        try { document.execCommand('selectAll'); } catch (_) {}
      } else {
        e.stopPropagation();
      }
      return;
    }
    const cmd = e.metaKey || e.ctrlKey;
    const parar = () => { e.preventDefault(); e.stopPropagation(); };

    // Tab morre aqui: os botoes do quadro tem tabIndex -1, entao o foco fugia para a interface
    // de tras (uma vez foi parar no X que FECHA a aba de projeto, invisivel atras do desenho)
    if (e.key === 'Tab') { parar(); return; }

    if (e.key === 'Escape') {
      parar();
      if (Q.gesto) { cancelarGesto(); return; }
      if (Q.ferramenta !== 'selecionar') { setFerramenta('selecionar'); return; }
      fechar(); return;
    }
    /* Duplicar e Alt+D, NUNCA ⌘D: no macOS o menu do app recebe a tecla antes da pagina,
       entao ⌘D disparava "Perguntar aos dois motores" (mandando a mensagem para os dois
       motores por tras do quadro) e ⌘⇧D ligava o microfone. No Mac o Alt+D chega como '∂'. */
    if (e.altKey && !cmd && (e.key === 'd' || e.key === 'D' || e.key === '∂')) { parar(); duplicarSelecao(); return; }
    if (cmd && (e.key === 'z' || e.key === 'Z')) { parar(); e.shiftKey ? refazer() : desfazer(); return; }
    if (cmd && (e.key === 'y' || e.key === 'Y')) { parar(); refazer(); return; }
    if (cmd && (e.key === 'a' || e.key === 'A')) { parar(); selecionarTudo(); return; }
    if (cmd && e.key === '0') { parar(); ajustarNaTela(); return; }
    if (cmd && (e.key === '=' || e.key === '+')) { parar(); zoomPara(Q.cam.z * 1.2, Q.larg / 2, Q.alt / 2); return; }
    if (cmd && e.key === '-') { parar(); zoomPara(Q.cam.z / 1.2, Q.larg / 2, Q.alt / 2); return; }
    if (cmd && (e.key === 'Enter')) { parar(); mandarProChat(); return; }
    if (cmd) return;   // qualquer outro atalho do sistema segue o seu caminho

    /* Zoom SEM ⌘, de proposito. O menu "Ver" do main.js ja reserva ⌘0, ⌘+ e ⌘- (roles
       resetZoom / zoomIn / zoomOut) e no macOS o menu recebe a tecla antes da pagina:
       com ⌘ quem mudava de tamanho era o APP INTEIRO, e o desenho nem se mexia.
       As versoes com ⌘ acima continuam la so para o Cockpit no navegador do telefone,
       onde nao existe menu de aplicativo e quem roubaria a tecla seria o browser. */
    if (e.key === '0') { parar(); ajustarNaTela(); return; }
    if (e.key === '=' || e.key === '+') { parar(); zoomPara(Q.cam.z * 1.2, Q.larg / 2, Q.alt / 2); return; }
    if (e.key === '-' || e.key === '_') { parar(); zoomPara(Q.cam.z / 1.2, Q.larg / 2, Q.alt / 2); return; }

    if (e.key === 'Delete' || e.key === 'Backspace') { parar(); apagarSelecao(); return; }
    if (e.key === ']') { parar(); paraFrente(); return; }
    if (e.key === '[') { parar(); paraTras(); return; }
    if (e.key === ' ') { if (!Q.espaco) { Q.espaco = true; atualizarCursor(); } parar(); return; }
    if (e.key === 'Enter') {
      const alvo = itemPorId([...Q.selecao][0] || '');
      if (alvo) { parar(); abrirEditor(alvo); }
      return;
    }
    if (e.key.startsWith('Arrow')) {
      parar();
      const d = e.shiftKey ? SNAP : 1;
      moverSelecao(e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0,
        e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0);
      return;
    }
    const f = TECLAS_FER[String(e.key).toLowerCase()];
    if (f) { parar(); setFerramenta(f); }
  }

  function aoSoltarTecla(e) {
    if (e.key === ' ') { Q.espaco = false; atualizarCursor(); }
  }

  /* ---------------- rascunho ---------------- */
  function temApi(nome) { return !!(window.api && typeof window.api[nome] === 'function'); }

  function marcarSujo() {
    Q.revisao++;
    Q.enviado = false;
    pintarPontinho();
    Q.rascunho.sujo = true;
    clearTimeout(Q.rascunho.timer);
    Q.rascunho.timer = setTimeout(gravarRascunho, 2000);
  }

  async function gravarRascunho() {
    if (!temApi('quadroRascunhoGravar')) return false;
    // Fechar o quadro e enviar ao chat usam a mesma fila de gravação. Assim
    // uma gravação automática antiga não apaga a marca de desenho já enviado.
    if (Q.rascunho.gravando) { await Q.rascunho.promessa; return gravarRascunho(); }
    const s = JSON.stringify(limparCena(Q.cena));
    const enviadoEm = Q.enviado ? Q.rascunho.enviadoEm : 0;
    if (s === Q.rascunho.ultimo && enviadoEm === Q.rascunho.ultimoEnviadoEm) { Q.rascunho.sujo = false; return true; }
    Q.rascunho.gravando = true;
    Q.rascunho.promessa = (async () => {
      try {
        const r = await window.api.quadroRascunhoGravar({ cena: JSON.parse(s), ...(enviadoEm ? { enviadoEm } : {}) });
        if (r && (r.error || r.ok === false)) return false;
        Q.rascunho.ultimo = s; Q.rascunho.ultimoEnviadoEm = enviadoEm;
        return true;
      } catch (_) { return false; }
      finally {
        Q.rascunho.gravando = false;
        if (Q.rascunho.sujo && JSON.stringify(limparCena(Q.cena)) !== Q.rascunho.ultimo) marcarSujo();
        else Q.rascunho.sujo = false;
      }
    })();
    return Q.rascunho.promessa;
  }

  function desenhoDoClaudeIntocado() {
    return !!Q.claude.visto && JSON.stringify(limparCena(Q.cena)) === Q.claude.cena;
  }

  /* enquanto o quadro esta aberto, olha o rascunho: se o Claude gravou um desenho novo e ele
     nao mexeu no anterior, o quadro se redesenha sozinho (conversa ao vivo). Sem novidade,
     o intervalo cresce (2s -> 5s -> 15s) pra nao ficar lendo disco a troco de nada com a
     tela vazia; volta pra 2s assim que reabrir ou quando algo novo realmente chegar. */
  function vigiarClaude() {
    clearTimeout(Q.claude.timer);
    const abertura = Q.abertura;
    Q.claude.semNovidade = 0;
    const proximoIntervalo = () => (Q.claude.semNovidade >= 15 ? 15000 : Q.claude.semNovidade >= 5 ? 5000 : 2000);
    const volta = async () => {
      if (!Q.aberto || Q.abertura !== abertura) return;   // fechou: o vigia morre junto
      if (!Q.gesto && !Q.editando && (cenaVazia() || desenhoDoClaudeIntocado())) {
        const trouxeNovidade = await recuperarRascunho();
        Q.claude.semNovidade = trouxeNovidade ? 0 : Q.claude.semNovidade + 1;
      } else {
        Q.claude.semNovidade++;
      }
      Q.claude.timer = setTimeout(volta, proximoIntervalo());
    };
    Q.claude.timer = setTimeout(volta, 2000);
  }

  /* volta direto, sem perguntar: um dialogo "quer recuperar?" e o tipo de parada que ele odeia */
  async function recuperarRascunho() {
    if (!temApi('quadroRascunhoLer')) return;
    const abertura = Q.abertura, revisao = Q.revisao;
    let r = null;
    try { r = await window.api.quadroRascunhoLer(); } catch (_) { return; }
    // A leitura no telefone pode demorar: ele pode ter desenhado, limpado ou
    // fechado o quadro nesse tempo. O rascunho antigo não passa por cima disso.
    if (!Q.aberto || Q.abertura !== abertura || Q.revisao !== revisao || !(cenaVazia() || desenhoDoClaudeIntocado())) return;
    if (!r || !r.cena) return;
    const doClaude = Number(r.cena.doClaude) || 0;
    // desenho do Claude ja visto nao volta sozinho, MESMO com a tela vazia: senao o
    // "Limpar" (que so grava a tela vazia no disco ~2s depois) podia ser desfeito pelo
    // proprio vigia relendo o rascunho.json antigo nesse intervalo
    if (doClaude && doClaude === Q.claude.visto) return;
    // com o desenho do Claude na tela, so troca se o arquivo tiver um desenho NOVO dele
    if (!cenaVazia() && !doClaude) return;
    /* desenho que ja foi mandado pro chat nao ressuscita: dias depois ele voltaria na tela
       e seria mandado de novo, colado no fluxo novo (o Claude receberia A+B como um so) */
    if (r.enviadoEm) return;
    const c = normalizarCena(r.cena);
    if (!c.formas.length && !c.setas.length) return;
    // desenho gravado pela versao antiga podia ter texto escondido dentro da forma;
    // ao voltar, a forma cresce ate caber (o que ele escreveu nao pode sumir)
    for (const f of c.formas) ajustarAltura(f);
    Q.cena = c;
    Q.rascunho.ultimo = JSON.stringify(limparCena(Q.cena));
    iniciarPilha();
    ajustarNaTela();
    if (doClaude) {
      Q.claude.visto = doClaude;
      Q.claude.cena = JSON.stringify(limparCena(Q.cena));
      toast('O Claude atualizou o desenho.', 'Começar do zero', () => limpar(true));
    } else toast('Voltei o seu último rascunho.', 'Começar do zero', () => limpar(true));
    return true;   // trouxe algo novo pra tela: o vigia (vigiarClaude) volta a checar rapido
  }

  /* ---------------- exportar PNG ---------------- */
  function pintarEmEscala(b, M, escala) {
    const off = document.createElement('canvas');
    off.width = Math.max(1, Math.round((b.w + M * 2) * escala));
    off.height = Math.max(1, Math.round((b.h + M * 2) * escala));
    const oc = off.getContext('2d');
    // fundo SOLIDO: PNG transparente vira quadrado preto em metade dos visualizadores
    oc.fillStyle = corTema('--bg');
    oc.fillRect(0, 0, off.width, off.height);
    oc.setTransform(escala, 0, 0, escala, -(b.x - M) * escala, -(b.y - M) * escala);
    oc.lineJoin = 'round'; oc.lineCap = 'round';
    pintarCena(oc, { z: escala, exportando: true });
    return off.toDataURL('image/png');
  }

  function gerarPNG() {
    const b = caixaConteudo();
    if (!b) return null;
    const M = 24;
    let escala = 2;
    const maior = Math.max((b.w + M * 2) * escala, (b.h + M * 2) * escala);
    // o piso de 0.4 furava o proprio LIM_PNG: cena muito larga saia com 8000px de lado
    if (maior > LIM_PNG) escala *= LIM_PNG / maior;
    let url = pintarEmEscala(b, M, escala);
    /* O WebSocket do telefone corta em 8MB, fecha a conexao calado e a promessa so morre no
       tempo limite de 2 minutos. A rede antiga so disparava com escala > 1 — mas desenho
       grande JA entra com escala < 1, entao ela nunca rodava justamente no caso dela.
       Agora encolhe ate caber. */
    let voltas = 0;
    while (url.length > 5e6 && voltas++ < 8) {
      escala *= 0.7;
      url = pintarEmEscala(b, M, escala);
    }
    return url;
  }

  /* ---------------- texto do envio ---------------- */
  function descricaoSimples(cena) {
    // rede de seguranca: se o quadro-texto.js nao carregou, o Claude ainda recebe algo util
    const linhas = [];
    for (const f of cena.formas) {
      const nome = { retangulo: 'Caixa', elipse: 'Círculo', losango: 'Decisão', nota: 'Post-it', texto: 'Texto', caneta: 'Rabisco' }[f.tipo] || f.tipo;
      linhas.push('- ' + nome + (f.texto ? ': ' + f.texto.replace(/\n/g, ' / ') : ''));
    }
    for (const s of cena.setas) {
      const nome = (id) => {
        const f = cena.formas.find(x => x.id === id);
        return f && f.texto ? '"' + f.texto.replace(/\n/g, ' ') + '"' : 'um ponto solto';
      };
      linhas.push('- ' + (s.tipo === 'seta' ? 'Seta' : 'Linha') + ' de ' + nome(s.de.forma)
        + ' para ' + nome(s.para.forma) + (s.texto ? ' (' + s.texto + ')' : ''));
    }
    return { titulo: '', texto: linhas.join('\n'), mermaid: '', resumo: '' };
  }

  function descrever(cena) {
    try {
      if (window.QuadroTexto && typeof window.QuadroTexto.descrever === 'function') {
        const d = window.QuadroTexto.descrever(cena);
        if (d && d.texto) return d;
      }
    } catch (_) {}
    return descricaoSimples(cena);
  }

  function montarTextoDoEnvio(d) {
    let t = 'Desenhei um fluxograma no quadro' + (d.titulo ? ' ("' + d.titulo + '")' : '')
      + ' para explicar o que eu quero. A imagem está anexada; abaixo vai o mesmo desenho em '
      + 'texto, para não haver dúvida (use os dois juntos):\n\n' + d.texto;
    if (d.mermaid) t += '\n\nMesmo fluxo em mermaid:\n```mermaid\n' + d.mermaid + '\n```';
    return t + '\n\n';
  }

  /* ---------------- acoes do rodape ---------------- */
  /* trocar so o rotulo: o botao tem icone do lado, e textContent apagaria o icone junto */
  function rotuloLimpar(txt) {
    const b = Q.el.limpar; if (!b) return;
    const r = b.querySelector('.qd-rot');
    if (r) r.textContent = txt; else b.textContent = txt;
  }
  function limpar(semConfirmar) {
    if (!semConfirmar && !cenaVazia()) {
      // confirmacao no proprio botao: confirm() nativo quebra o fluxo e ignora o tema
      const bt = Q.el.limpar;
      if (Date.now() - Q.limparArmado > 3000) {
        Q.limparArmado = Date.now();
        rotuloLimpar('Confirmar?');
        bt.classList.add('confirmando');   // e 'confirmando' que o quadro.css pinta de vermelho
        setTimeout(() => { rotuloLimpar('Limpar'); bt.classList.remove('confirmando'); }, 3000);
        return;
      }
    }
    Q.limparArmado = 0;
    if (Q.el.limpar) { rotuloLimpar('Limpar'); Q.el.limpar.classList.remove('confirmando'); }
    Q.cena = { v: 1, formas: [], setas: [] };
    Q.selecao.clear();
    registrar(); marcarSujo(); agendar();
  }

  async function salvarPNG() {
    const png = gerarPNG();
    if (!png) return toast('Desenhe alguma coisa primeiro.');
    if (!temApi('quadroSalvar')) return toast('Este aparelho ainda não sabe salvar o quadro.');
    try {
      const r = await window.api.quadroSalvar({ png, cena: limparCena(Q.cena) });
      if (!r || r.error) return toast('Não deu para salvar: ' + ((r && r.error) || 'erro'));
      if (window.SEM_ELECTRON) toast('Salvo no Mac: ' + r.png);
      else { toast('PNG salvo.'); if (temApi('openPath')) window.api.openPath(r.png); }
    } catch (e) { toast('Não deu para salvar: ' + (e.message || e)); }
  }

  async function copiarTexto() {
    if (cenaVazia()) return toast('Desenhe alguma coisa primeiro.');
    const d = descrever(limparCena(Q.cena));
    const txt = d.texto + (d.mermaid ? '\n\n' + d.mermaid : '');
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(txt);
      else {
        const ta = document.createElement('textarea');
        ta.value = txt; document.body.appendChild(ta); ta.select();
        let copiou;
        try { copiou = document.execCommand('copy'); } finally { ta.remove(); }
        if (!copiou) throw new Error('cópia não autorizada');
      }
      toast('Texto do fluxo copiado.');
    } catch (_) { toast('Não deu para copiar.'); }
  }

  async function mandarProChat() {
    const P = Q.P;
    if (!P || !P.el || !document.body.contains(P.el)) {
      return toast('Este chat foi fechado. Abra o quadro pelo chat que você quer usar.');
    }
    if (cenaVazia()) return toast('Desenhe alguma coisa primeiro.');
    if (!temApi('quadroSalvar')) return toast('Este aparelho ainda não sabe salvar o quadro.');
    const bt = Q.el.mandar;
    if (bt.disabled) return;
    const abertura = Q.abertura;
    const destino = JSON.stringify([P.engine, P.cwd, P.sessaoId || P.resumeId || '']);
    const destinoAtual = () => Q.aberto && Q.abertura === abertura && Q.P === P
      && document.body.contains(P.el)
      && JSON.stringify([P.engine, P.cwd, P.sessaoId || P.resumeId || '']) === destino;
    bt.classList.add('ocupado'); bt.disabled = true;
    try {
      const png = gerarPNG();
      const cena = limparCena(Q.cena);
      const r = await window.api.quadroSalvar({ png, cena });
      if (!r || r.error || !r.png) throw new Error((r && r.error) || 'não deu para salvar o desenho');
      if (!destinoAtual()) return;
      if (JSON.stringify(limparCena(Q.cena)) !== JSON.stringify(cena)) return toast('O desenho mudou enquanto eu salvava. Toque em mandar novamente.');
      const d = descrever(cena);
      let txt = montarTextoDoEnvio(d);
      if (typeof window.abrirQuadroAnexar === 'function') {
        // await obrigatorio: anexar() e async e a barra de anexos so pinta depois
        await window.abrirQuadroAnexar(P, r.png);
      } else {
        txt = 'Desenhei um fluxograma. Abra a imagem antes de responder: ' + r.png + '\n\n' + txt;
      }
      if (!destinoAtual()) return;
      if (JSON.stringify(limparCena(Q.cena)) !== JSON.stringify(cena)) return toast('O desenho mudou enquanto eu anexava. Toque em mandar novamente.');
      // o resumo vai junto para a aba nao nascer chamada "Desenhei um fluxograma no quadro…"
      if (typeof window.abrirQuadroTexto === 'function') window.abrirQuadroTexto(P, txt, d.resumo);
      Q.enviado = true;
      Q.rascunho.enviadoEm = Date.now();
      const salvo = await gravarRascunho();
      if (!destinoAtual() || JSON.stringify(limparCena(Q.cena)) !== JSON.stringify(cena)) return;
      if (!salvo) return toast('O desenho foi anexado ao chat, mas não consegui salvar o rascunho.');
      fechar();
      const inp = P.el.querySelector('.p-input');
      if (inp) { inp.focus(); try { inp.setSelectionRange(inp.value.length, inp.value.length); } catch (_) {} }
    } catch (e) {
      toast('Não deu para mandar: ' + (e.message || e));
    } finally {
      bt.classList.remove('ocupado'); bt.disabled = false;
      pintarPontinho();
    }
  }

  /* ---------------- aviso curto (toast) ---------------- */
  let toastTimer = null;
  function toast(msg, rotuloAcao, aoClicar) {
    const t = Q.el.toast;
    if (!t) return;
    t.textContent = '';
    const s = document.createElement('span');
    s.textContent = msg;
    t.appendChild(s);
    if (rotuloAcao) {
      const a = document.createElement('button');
      a.className = 'qd-toast-acao';
      a.textContent = rotuloAcao;
      // sem cssText: '.qd-toast-acao' ja pinta com a cor do motor (o inline deixava cinza)
      a.onclick = () => { t.classList.add('some'); if (aoClicar) aoClicar(); };
      t.appendChild(a);
    }
    esconderToast(false);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => esconderToast(true), 6000);
  }
  /* o estilo vai inline de proposito: se so a classe .some escondesse, o inline do proprio
     elemento venceria a folha de estilo e o aviso ficaria uma pilula vazia na tela */
  function esconderToast(sim) {
    const t = Q.el.toast; if (!t) return;
    t.classList.toggle('some', sim);
    t.style.opacity = sim ? '0' : '1';
    t.style.pointerEvents = sim ? 'none' : 'auto';
    if (sim) t.textContent = '';
  }

  /* ---------------- o pontinho no botao da barra do chat ---------------- */
  function pintarPontinho() {
    const tem = !cenaVazia() && !Q.enviado;
    for (const bt of document.querySelectorAll('.p-quadro')) bt.classList.toggle('tem-rascunho', tem);
  }

  /* ---------------- montagem da janela ---------------- */
  function bt(classe, titulo, html) {
    const b = document.createElement('button');
    b.className = classe;
    b.title = titulo;
    b.innerHTML = html;
    b.tabIndex = -1;   // o teclado e nosso; Tab passeando pelos botoes atrapalha
    return b;
  }

  /* a letra do atalho que vai no cantinho do botao (o CSS ja previa .qd-fer-tecla) */
  function teclaDe(ferr) {
    for (const k in TECLAS_FER) if (TECLAS_FER[k] === ferr) return k.toUpperCase();
    return '';
  }

  function montarFerramentas(barra) {
    Q.el.botoesFer = [];
    for (const f of FERRAMENTAS) {
      if (f.sep) {
        const s = document.createElement('span');
        s.className = 'qd-sep qd-fer-sep';
        barra.appendChild(s);
        continue;
      }
      /* SEM 'qd-bt' aqui: aquela e a pilula do rodape e, por vir depois no CSS, vencia o
         .qd-fer em display, padding e borda — os 11 botoes ganhavam moldura e o icone saia
         empurrado pra direita. */
      const b = bt('qd-fer', f.t, qico(f.ic));
      b.dataset.f = f.f;
      const tecla = teclaDe(f.f);
      if (tecla) b.insertAdjacentHTML('beforeend', '<span class="qd-fer-tecla">' + tecla + '</span>');
      b.onclick = () => setFerramenta(f.f);
      barra.appendChild(b);
      Q.el.botoesFer.push(b);
    }

    const sep1 = document.createElement('span'); sep1.className = 'qd-sep qd-fer-sep'; barra.appendChild(sep1);

    // cores em duas colunas: em coluna unica a barra passaria da altura da janela
    const cores = document.createElement('div');
    cores.className = 'qd-cores';
    cores.style.cssText = 'display:flex;flex-wrap:wrap;gap:5px;justify-content:center;width:100%';
    Q.el.botoesCor = [];
    for (const c of PALETA) {
      const b = bt('qd-cor', c === 'tinta' ? 'Cor do texto (padrão)' : 'Cor', '');
      b.dataset.cor = c;
      b.style.setProperty('--c', c === 'tinta' ? 'var(--fg-strong)' : c);
      b.style.background = c === 'tinta' ? 'var(--fg-strong)' : c;
      b.onclick = () => aplicarEstilo({ cor: c });
      cores.appendChild(b);
      Q.el.botoesCor.push(b);
    }
    barra.appendChild(cores);

    const sep2 = document.createElement('span'); sep2.className = 'qd-sep qd-fer-sep'; barra.appendChild(sep2);

    // um botao so: pintar por dentro com a cor de agora, ou deixar vazado
    /* 'qd-fer qd-fundo' e NUNCA 'qd-bt': o quadro.css so escreve o realce em .qd-fundo.ativa
       e conta com o .qd-fer para a moldura, o tamanho e o hover. Ja o botao de espessura
       vem sozinho como .qd-esp-bt, porque la a folha repete o tamanho na mao. */
    Q.el.fundo = bt('qd-fer qd-fundo', 'Pintar por dentro', qico('preencher'));
    Q.el.fundo.onclick = () => {
      const novo = Q.estilo.fundo === 'transparente' ? (Q.estilo.cor === 'tinta' ? PALETA[1] : Q.estilo.cor) : 'transparente';
      aplicarEstilo({ fundo: novo });
    };
    barra.appendChild(Q.el.fundo);

    /* espessura cicla 2 -> 4 -> 7: tres botoes so para isso deixariam a barra comprida demais.
       Classe 'qd-esp-bt' e um data-esp: quem desenha a barrinha e o ::before do quadro.css
       (.qd-esp-bt[data-esp="2"|"4"|"7"]), entao o botao nao leva icone proprio. */
    Q.el.esp = bt('qd-esp-bt', 'Espessura do traço', '');
    Q.el.esp.dataset.esp = String(Q.estilo.esp);
    Q.el.esp.onclick = () => {
      const prox = Q.estilo.esp === 2 ? 4 : Q.estilo.esp === 4 ? 7 : 2;
      aplicarEstilo({ esp: prox });
    };
    barra.appendChild(Q.el.esp);

    // so aparece quando ha algo escolhido
    const grupo = document.createElement('div');
    grupo.className = 'qd-grupo-sel';
    grupo.style.cssText = 'display:none;flex-direction:column;align-items:center;gap:6px;width:100%';
    const sep3 = document.createElement('span'); sep3.className = 'qd-sep qd-fer-sep'; grupo.appendChild(sep3);
    const bFrente = bt('qd-fer qd-prop-frente', 'Trazer pra frente (])', qico('frente'));
    bFrente.onclick = paraFrente;
    const bTras = bt('qd-fer qd-prop-tras', 'Mandar pra trás ([)', qico('tras'));
    bTras.onclick = paraTras;
    /* Duplicar tem botao porque a tecla NAO pode ser ⌘D (o menu do app fica com ela e
       mandaria a pergunta para os dois motores por tras do quadro). Aqui e Alt+D. */
    const bDuplicar = bt('qd-fer qd-prop-duplicar', 'Duplicar (Alt+D)', qico('copiar'));
    bDuplicar.onclick = duplicarSelecao;
    const bApagar = bt('qd-fer perigo qd-prop-apagar', 'Apagar (Delete)', qico('apagar'));
    bApagar.onclick = apagarSelecao;
    grupo.appendChild(bFrente); grupo.appendChild(bTras);
    grupo.appendChild(bDuplicar); grupo.appendChild(bApagar);
    barra.appendChild(grupo);
    Q.el.grupoSel = grupo;
  }

  function pintarProps() {
    if (Q.el.botoesCor) {
      // 'ativa' e o nome que o quadro.css conhece; com 'on' nenhuma bolinha ganhava o anel
      for (const b of Q.el.botoesCor) b.classList.toggle('ativa', b.dataset.cor === Q.estilo.cor);
    }
    if (Q.el.esp) {
      // o data-esp e que engorda a barrinha no CSS; 'ativa' acende quando NAO e o traco padrao
      Q.el.esp.dataset.esp = String(Q.estilo.esp);
      Q.el.esp.classList.toggle('ativa', Q.estilo.esp !== 2);
      Q.el.esp.title = 'Espessura do traço (' + Q.estilo.esp + ')';
    }
    if (Q.el.fundo) Q.el.fundo.classList.toggle('ativa', Q.estilo.fundo !== 'transparente');
  }

  function caixa() {
    let el = document.getElementById('qdPainel');
    if (el) return el;

    el = document.createElement('div');
    el.id = 'qdPainel';
    el.className = 'qd-painel hidden';

    const cx = document.createElement('div');
    cx.className = 'qd-cx';

    /* topo */
    const top = document.createElement('div');
    top.className = 'qd-top';
    const tit = document.createElement('span'); tit.className = 'qd-tit'; tit.textContent = 'Quadro';
    // 'qd-dica' e a classe que o quadro.css estiliza (e esconde em tela estreita);
    // 'qd-sub' nao existe na folha e o subtitulo saia com a fonte crua do body
    const sub = document.createElement('span'); sub.className = 'qd-dica';
    const gap = document.createElement('span'); gap.className = 'qd-gap'; gap.style.flex = '1';
    const bDesfazer = bt('qd-mini qd-desfazer', 'Desfazer (⌘Z)', qico('desfazer'));
    bDesfazer.onclick = desfazer;
    const bRefazer = bt('qd-mini qd-refazer', 'Refazer (⌘⇧Z)', qico('refazer'));
    bRefazer.onclick = refazer;
    // "0" e nao "⌘0": o menu Ver do app fica com o ⌘0 (ver o comentario em aoTeclar)
    const bAjustar = bt('qd-mini qd-ajustar', 'Ajustar à tela (0)', qico('ajustar'));
    bAjustar.onclick = ajustarNaTela;
    const bX = bt('qd-mini qd-x', 'Fechar (Esc)', qico('x'));
    bX.onclick = fechar;
    top.append(tit, sub, gap, bDesfazer, bRefazer, bAjustar, bX);

    /* miolo */
    const meio = document.createElement('div');
    meio.className = 'qd-meio qd-corpo';
    meio.style.cssText = 'flex:1;display:flex;min-height:0;min-width:0';

    const barra = document.createElement('div');
    barra.className = 'qd-ferramentas';
    montarFerramentas(barra);

    const palco = document.createElement('div');
    palco.className = 'qd-palco qd-area';
    /* estas quatro linhas nao sao enfeite: sem elas o canvas nao mede e o iPad rola a pagina */
    palco.style.cssText = 'position:relative;flex:1;min-width:0;min-height:0;overflow:hidden;touch-action:none';

    const canvas = document.createElement('canvas');
    canvas.className = 'qd-canvas';
    canvas.style.cssText = 'position:absolute;inset:0;display:block;touch-action:none;'
      + '-webkit-user-select:none;user-select:none;-webkit-touch-callout:none';

    const dica = document.createElement('div');
    // so 'qd-vazio': com 'qd-dica' junto, o bloco de tela estreita escondia a dica
    // justamente no iPad, onde ele desenha com o dedo e nao existe atalho de teclado
    dica.className = 'qd-vazio';
    dica.innerHTML = 'Desenhe o fluxo que você quer explicar.<br>'
      + '<b>Caixa (R)</b> · <b>Decisão (D)</b> · <b>Seta (A)</b> · <b>Texto (T)</b><br>'
      + 'Dois cliques dentro de uma forma para escrever nela.';
    dica.style.pointerEvents = 'none';

    const editor = document.createElement('textarea');
    editor.className = 'qd-editor hidden';
    editor.style.cssText = 'position:absolute;z-index:3;margin:0;border:0;outline:0;resize:none;'
      + 'background:transparent;text-align:center;overflow:hidden;'
      + '-webkit-user-select:text;user-select:text';
    editor.setAttribute('autocapitalize', 'sentences');
    editor.setAttribute('autocorrect', 'on');
    editor.setAttribute('spellcheck', 'false');

    const zoom = document.createElement('div');
    zoom.className = 'qd-zoom';
    const zMenos = bt('qd-zoom-bt', 'Menos zoom', '−');
    zMenos.onclick = () => zoomPara(Q.cam.z / 1.2, Q.larg / 2, Q.alt / 2);
    const zNum = document.createElement('span');
    zNum.className = 'qd-zoom-n'; zNum.textContent = '100%';
    zNum.style.cursor = 'pointer'; zNum.title = 'Voltar para 100%';
    zNum.onclick = () => zoomPara(1, Q.larg / 2, Q.alt / 2);
    const zMais = bt('qd-zoom-bt', 'Mais zoom', '+');
    zMais.onclick = () => zoomPara(Q.cam.z * 1.2, Q.larg / 2, Q.alt / 2);
    zoom.append(zMenos, zNum, zMais);

    palco.append(canvas, dica, editor, zoom);
    meio.append(barra, palco);

    /* rodape */
    const rod = document.createElement('div');
    rod.className = 'qd-rodape';
    const conta = document.createElement('span'); conta.className = 'qd-conta';
    // SEM style.flex inline: inline vence @media e o .qd-rod-gap{flex:0 0 0} da tela
    // estreita nunca pegava — sobrava um vao vazio e o botao principal encolhia
    const rgap = document.createElement('span'); rgap.className = 'qd-gap qd-rod-gap';
    /* 'qd-bt' e a UNICA classe dos botoes do rodape (o nome antigo, com 2 no fim, morreu):
       assim eles voltam a ser botao de verdade — com moldura, area de clique e o vermelho
       do Limpar. O rotulo vai num <span class="qd-rot"> porque no iPhone em pe so o icone fica. */
    const bLimpar = bt('qd-bt perigo qd-limpar', 'Apagar tudo', qico('apagar') + '<span class="qd-rot">Limpar</span>');
    bLimpar.onclick = () => limpar(false);
    const bPng = bt('qd-bt qd-png', 'Salvar o desenho como imagem', qico('imagem') + '<span class="qd-rot">Salvar PNG</span>');
    const bCopiar = bt('qd-bt qd-copiar', 'Copiar a leitura do fluxo em texto', qico('copiar') + '<span class="qd-rot">Copiar texto</span>');
    bPng.onclick = salvarPNG;
    bCopiar.onclick = copiarTexto;
    // 'qd-bt qd-mandar': a pilula grande e colorida do rodape (o estado ocupado e '.ocupado')
    const bMandar = bt('qd-bt qd-mandar', 'Mandar o desenho para o chat (⌘Enter)', qico('mandar') + '<span>Mandar pro chat</span>');
    bMandar.onclick = mandarProChat;
    rod.append(conta, rgap, bLimpar, bPng, bCopiar, bMandar);

    cx.append(top, meio, rod);

    const tst = document.createElement('div');
    tst.className = 'qd-toast some';
    /* posicao, cor e moldura ficam com o quadro.css. Antes vinham num cssText inline, e
       inline vence @media: no iPad o aviso continuava estreito e centrado no meio da tela,
       por cima do rodape, em vez de deitar embaixo como a folha manda.
       So o opacity/pointer-events segue inline — e o que o esconderToast liga e desliga. */
    tst.style.opacity = '0';
    tst.style.pointerEvents = 'none';

    // o toast mora DENTRO da caixa: pendurado no veu, em janela alta ele boiava
    // abaixo da caixa branca, fora do quadro (e com ele o botao "Comecar do zero")
    cx.appendChild(tst);
    el.appendChild(cx);
    // clique no veu fecha; clique dentro, nao
    el.addEventListener('click', (e) => { if (e.target === el) fechar(); });
    document.body.appendChild(el);

    Q.el = Object.assign(Q.el, {
      painel: el, cx, sub, palco, canvas, dica, editor, toast: tst,
      zoomN: zNum, conta, mandar: bMandar, limpar: bLimpar,
      desfazer: bDesfazer, refazer: bRefazer,
    });
    Q.ctx = canvas.getContext('2d');

    /* eventos do palco */
    canvas.addEventListener('pointerdown', aoDescer);
    canvas.addEventListener('pointermove', aoMover);
    canvas.addEventListener('pointerup', aoSubir);
    canvas.addEventListener('pointercancel', aoSubir);
    canvas.addEventListener('dblclick', aoDuploClique);
    canvas.addEventListener('wheel', aoRoda, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    editor.addEventListener('input', () => {
      const e = Q.editando; if (!e) return;
      e.obj.texto = editor.value;
      e.obj._chaveLinhas = null;
      if (ajustarAltura(e.obj)) posicionarEditor();
      agendar();
    });
    editor.addEventListener('blur', () => { if (Q.editando) fecharEditor(true); });
    // Esc aqui e SO da caixa de texto: se subir, fecha o quadro inteiro e joga o desenho fora
    editor.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
        e.preventDefault(); e.stopPropagation();
        fecharEditor(true);
      } else e.stopPropagation();
    });

    /* encolher a janela (virar telefone) deixava o desenho fora do enquadramento e
       parecia que tinha sumido. Perdeu muita largura -> reenquadra sozinho. */
    let largAnterior = 0;
    if (window.ResizeObserver) new ResizeObserver(() => {
      if (!Q.aberto) return;
      const antes = largAnterior;
      redimensionar();
      const agora = Q.larg || palco.clientWidth || 0;
      largAnterior = agora;
      if (!antes || !agora) return;
      if (agora < 600 || agora < antes * 0.7) ajustarNaTela();
    }).observe(palco);
    else window.addEventListener('resize', () => { if (Q.aberto) redimensionar(); });

    // trocar o tema com o quadro aberto repinta tudo com as cores novas
    new MutationObserver(() => { if (Q.aberto) { lerTema(); agendar(); } })
      .observe(document.documentElement, { attributes: true, attributeFilter: ['data-tema', 'class'] });

    return el;
  }

  /* ---------------- abrir / fechar ---------------- */
  async function abrir(P) {
    const el = caixa();
    const jaAberto = Q.aberto;
    Q.P = P || Q.P || null;
    lerTema();
    // a cor viva do botao principal e a do motor daquele chat: laranja no Claude, azul no Codex
    el.style.setProperty('--qd', (Q.P && Q.P.engine === 'codex') ? 'var(--codex)' : 'var(--claude)');
    if (Q.P) {
      const pasta = String(Q.P.cwd || '').split('/').filter(Boolean).pop() || '';
      Q.el.sub.textContent = [pasta, Q.P.engine === 'codex' ? 'Codex' : 'Claude'].filter(Boolean).join(' · ');
    } else Q.el.sub.textContent = '';

    if (jaAberto) { agendar(); return; }

    el.classList.remove('hidden');
    Q.aberto = true;
    const abertura = ++Q.abertura;
    document.addEventListener('keydown', aoTeclar, true);
    document.addEventListener('keyup', aoSoltarTecla, true);
    redimensionar();
    if (cenaVazia() || desenhoDoClaudeIntocado()) {
      if (cenaVazia()) Q.cam = { x: -Q.larg / 2, y: -Q.alt / 2, z: 1 };
      await recuperarRascunho();
    }
    vigiarClaude();
    if (!Q.aberto || Q.abertura !== abertura) return;
    if (!Q.pilha.passos.length) iniciarPilha();
    setFerramenta(Q.ferramenta || 'selecionar');
    agendar();
  }

  function fechar() {
    if (!Q.aberto) return;
    fecharEditor(true);
    Q.aberto = false;
    Q.abertura++;
    Q.gesto = null; Q.pinch = null; Q.ponteiros.clear(); Q.bloqueado = false; Q.espaco = false;
    const el = document.getElementById('qdPainel');
    if (el) el.classList.add('hidden');
    document.removeEventListener('keydown', aoTeclar, true);
    document.removeEventListener('keyup', aoSoltarTecla, true);
    clearTimeout(Q.claude.timer);
    clearTimeout(Q.rascunho.timer);
    /* empurrar a peca com as setinhas e fechar deixava a cena mexida e a pilha desatualizada:
       o proximo ⌘Z pulava um passo. Descarrega antes de matar o relogio. */
    if (Q.setasTimer) { clearTimeout(Q.setasTimer); Q.setasTimer = null; registrar(); }
    clearTimeout(toastTimer);
    esconderToast(true);
    gravarRascunho();
    pintarPontinho();
  }

  function aberto() { return Q.aberto; }

  window.Quadro = { abrir, fechar, aberto };
})();
