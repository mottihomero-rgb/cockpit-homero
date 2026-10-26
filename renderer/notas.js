/* Notas dentro do chat (22/10/2026).
   Um ícone na barra de baixo de cada chat abre um popup, CENTRADO no chat e com o fundo do chat
   embaçado (como uma janela por cima), com o visual do app Notas da Apple:
   lista com busca e seções por data, e a nota aberta com título grande, data no alto e lista de
   verificação. As cores vêm dos temas do Cockpit (notas.css só usa as variáveis deles).
   As notas moram no Mac, em notas.json (main.js); qualquer janela/chat enxerga as mesmas. */
(function () {
  'use strict';
  const api = window.api || {};
  const ORIGEM = Math.random().toString(36).slice(2);
  const LS = 'ck-notas-v1';

  let notas = [];              // TODAS as notas: { id, chat, c (criada), m (editada), linhas: [{ c, f, t }] }
  let pop = null, veu = null, botao = null;
  let chave = '';              // de qual CONVERSA são as notas que aparecem agora
  let vista = 'nota', atualId = '', busca = '';
  let salvarT = 0, sujo = false, ed = null;

  const $ = (s, r) => (r || document).querySelector(s);
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const svg = (d, w) => '<svg viewBox="0 0 20 20" width="' + (w || 20) + '" height="' + (w || 20) + '" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
  const IC = {
    nota: '<svg viewBox="0 0 16 16" class="ic" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 2.5h8A1.5 1.5 0 0 1 13.5 4v8a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 12V4A1.5 1.5 0 0 1 4 2.5z"></path><path d="M5.5 6h5M5.5 8.5h5M5.5 11h2.5"></path></svg>',
    novo: svg('<path d="M16.5 11.2v3.4a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2h3.4"/><path d="M15.3 3.2a1.6 1.6 0 0 1 2.3 2.3l-7.5 7.5-3.2.9.9-3.2z"/>'),
    volta: svg('<path d="M12 4.5L6.5 10l5.5 5.5"/>', 18),
    lixo: svg('<path d="M3.5 5.5h13"/><path d="M8 5.5V4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.5"/><path d="M5.5 5.5l.7 9.8a1.5 1.5 0 0 0 1.5 1.4h4.6a1.5 1.5 0 0 0 1.5-1.4l.7-9.8"/><path d="M8.5 9v4.5M11.5 9v4.5"/>'),
    busca: svg('<circle cx="9" cy="9" r="5"/><path d="M13 13l3.5 3.5"/>', 15),
    fechar: svg('<path d="M5.5 5.5l9 9M14.5 5.5l-9 9"/>', 16),
    lista: svg('<circle cx="4.7" cy="5.5" r="2.3"/><path d="M3.8 5.5l.7.8 1.2-1.5"/><path d="M10 5.5h7"/><circle cx="4.7" cy="14.5" r="2.3"/><path d="M10 14.5h7"/>'),
  };

  /* ---------- guardar ---------- */
  async function carregar() {
    let lista = null;
    try {
      if (api.notasLer) lista = await api.notasLer();
      else lista = JSON.parse(localStorage.getItem(LS) || 'null');
    } catch { lista = null; }
    notas = Array.isArray(lista) ? lista.filter((n) => n && n.id && Array.isArray(n.linhas)) : [];
  }
  function gravar() {
    sujo = false;
    const copia = notas.map((n) => ({ id: n.id, chat: n.chat || '', c: n.c, m: n.m, linhas: n.linhas }));
    try {
      if (api.notasSalvar) api.notasSalvar({ origem: ORIGEM, notas: copia });
      else localStorage.setItem(LS, JSON.stringify(copia));
    } catch { /* sem disco, a nota segue na tela */ }
  }
  function agendar() { sujo = true; clearTimeout(salvarT); salvarT = setTimeout(gravar, 450); }
  function salvarJa() { clearTimeout(salvarT); if (sujo) gravar(); }

  /* ---------- de qual conversa ---------- */
  const doChat = () => notas.filter((n) => n.chat === chave);
  function painelDe(b) {
    const el = b && b.closest ? b.closest('.pane') : null;
    let P = null;
    try { if (el && typeof panes !== 'undefined') P = [...panes.values()].find((q) => q.el === el) || null; } catch {}
    return { el, P };
  }
  function chaveDoBotao(b) {
    const { el, P } = painelDe(b);
    if (!P) return 'p:' + ((el && el.dataset.id) || 'solto');
    const sid = P.sessaoId || P.resumeId;
    return sid ? 's:' + sid : 'p:' + (P.notasId || P.id);
  }
  // notas de antes desta versão não tinham dono: ficam com a primeira conversa que abrir o popup
  function adotarSemDono() {
    let mexeu = false;
    for (const n of notas) if (!n.chat) { n.chat = chave; mexeu = true; }
    if (mexeu) agendar();
  }
  // a conversa ganhou o id de verdade (1ª mensagem): as notas dela mudam de chave junto
  async function sessao(P) {
    try {
      const sid = P && (P.sessaoId || P.resumeId);
      if (!P || !P.notasId || !sid) return;
      const de = 'p:' + P.notasId, para = 's:' + sid;
      if (aberta() && chave === de) { for (const n of notas) if (n.chat === de) n.chat = para; chave = para; agendar(); salvarJa(); }
      else if (api.notasMover) await api.notasMover({ origem: ORIGEM, de, para });
    } catch { /* sem isso as notas só ficam na chave antiga, nada se perde */ }
  }

  /* ---------- texto e datas ---------- */
  const textoVazio = (n) => !n.linhas.some((l) => String(l.t || '').trim());
  const titulo = (n) => { const l = n.linhas.find((x) => String(x.t || '').trim()); return l ? l.t.trim() : 'Nova nota'; };
  function previa(n) {
    let achou = false;
    for (const l of n.linhas) {
      if (!String(l.t || '').trim()) continue;
      if (!achou) { achou = true; continue; }
      return l.t.trim();
    }
    return 'Sem texto adicional';
  }
  const hhmm = (d) => d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const diaIni = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  function dataLonga(ts) {
    const d = new Date(ts);
    return d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' }) + ' às ' + hhmm(d);
  }
  function dataCurta(ts) {
    const d = new Date(ts), hoje = diaIni(new Date()), dias = Math.round((hoje - diaIni(d)) / 86400000);
    if (dias <= 0) return hhmm(d);
    if (dias === 1) return 'Ontem';
    if (dias < 7) return cap(d.toLocaleDateString('pt-BR', { weekday: 'long' }));
    return d.toLocaleDateString('pt-BR');
  }
  function secaoDe(ts) {
    const d = new Date(ts), dias = Math.round((diaIni(new Date()) - diaIni(d)) / 86400000);
    if (dias <= 0) return 'Hoje';
    if (dias === 1) return 'Ontem';
    if (dias < 7) return 'Últimos 7 dias';
    if (dias < 30) return 'Últimos 30 dias';
    const mesmoAno = d.getFullYear() === new Date().getFullYear();
    return cap(d.toLocaleDateString('pt-BR', mesmoAno ? { month: 'long' } : { month: 'long', year: 'numeric' }));
  }

  /* ---------- a janelinha ---------- */
  function montar() {
    pop = document.createElement('div');
    pop.className = 'nt-pop';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', 'Notas');
    pop.innerHTML =
      '<section class="nt-vista nt-v-lista">'
      + '<header class="nt-topo"><span class="nt-gap"></span><button type="button" class="nt-ib nt-x" title="Fechar">' + IC.fechar + '</button></header>'
      + '<h2 class="nt-grande">Notas</h2>'
      + '<label class="nt-busca">' + IC.busca + '<input type="search" placeholder="Buscar" spellcheck="false" autocomplete="off"></label>'
      + '<div class="nt-rol nt-lista-corpo"></div>'
      + '<footer class="nt-rodape"><span class="nt-cont"></span><button type="button" class="nt-ib nt-novo" title="Nova nota">' + IC.novo + '</button></footer>'
      + '</section>'
      + '<section class="nt-vista nt-v-nota">'
      + '<header class="nt-topo"><button type="button" class="nt-volta" title="Todas as notas">' + IC.volta + '<span>Notas</span></button><span class="nt-gap"></span>'
      + '<button type="button" class="nt-ib nt-lixo" title="Apagar nota">' + IC.lixo + '</button>'
      + '<button type="button" class="nt-ib nt-x" title="Fechar">' + IC.fechar + '</button></header>'
      + '<div class="nt-rol nt-nota-corpo"><div class="nt-data"></div><div class="nt-edbox"><div class="nt-ph">Título</div><div class="nt-ed" contenteditable="true" spellcheck="true" role="textbox" aria-multiline="true" aria-label="Nota"></div></div></div>'
      + '<footer class="nt-barra"><button type="button" class="nt-ib nt-ck" title="Lista de verificação">' + IC.lista + '</button><span class="nt-gap"></span><button type="button" class="nt-ib nt-novo" title="Nova nota">' + IC.novo + '</button></footer>'
      + '</section>';
    veu = document.createElement('div');
    veu.className = 'nt-veu';
    veu.appendChild(pop);
    // clicar no fundo embaçado (fora do cartão) fecha, como numa janela por cima
    veu.addEventListener('mousedown', (e) => { if (e.target === veu) { e.preventDefault(); fechar(); } });
    ed = $('.nt-ed', pop);

    // as teclas daqui não são do resto do app (Esc, Enter, atalhos)
    pop.addEventListener('keydown', teclaDaJanela);
    pop.addEventListener('mousedown', (e) => e.stopPropagation());
    for (const b of pop.querySelectorAll('.nt-x')) b.onclick = fechar;
    for (const b of pop.querySelectorAll('.nt-novo')) b.onclick = () => novaNota();
    $('.nt-volta', pop).onclick = () => irParaLista();
    $('.nt-lixo', pop).onclick = apagarAtual;
    $('.nt-ck', pop).onmousedown = (e) => e.preventDefault();   // não tira o cursor do texto
    $('.nt-ck', pop).onclick = alternarVerificacao;
    $('.nt-busca input', pop).addEventListener('input', (e) => { busca = e.target.value; pintarLista(); });

    ed.addEventListener('input', aoDigitar);
    ed.addEventListener('beforeinput', antesDeDigitar);
    ed.addEventListener('paste', colar);
    ed.addEventListener('mousedown', cliqueNaCaixa);
    ed.addEventListener('blur', () => salvarJa());
  }

  function teclaDaJanela(e) {
    e.stopPropagation();
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'n') { e.preventDefault(); novaNota(); }
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'l') { e.preventDefault(); alternarVerificacao(); }
  }

  /* ---------- abrir e fechar ---------- */
  async function abrir(b) {
    const { el } = painelDe(b || botao);
    if (!el) return;
    if (pop && aberta()) { lerDaCaixa(); largarNotaVazia(); salvarJa(); }   // saindo de outra conversa
    botao = b || botao;
    chave = chaveDoBotao(botao);
    if (!pop) montar();
    await carregar();
    adotarSemDono();
    atualId = ''; busca = '';
    // o véu mora DENTRO do chat: cobre só ele, centraliza o cartão e embaça o que está atrás
    el.appendChild(veu);
    veu.classList.add('aberto'); pop.classList.add('aberto');
    document.querySelectorAll('.p-notas.ligado').forEach((x) => x.classList.remove('ligado'));
    botao.classList.add('ligado');
    const ultima = doChat().sort((x, y) => y.m - x.m)[0];
    if (ultima && !textoVazio(ultima)) irParaNota(ultima.id); else novaNota();
  }
  function fechar() {
    if (!pop) return;
    largarNotaVazia();
    salvarJa();
    veu.classList.remove('aberto'); pop.classList.remove('aberto');
    document.querySelectorAll('.p-notas.ligado').forEach((b) => b.classList.remove('ligado'));
    const volta = botao && botao.isConnected ? botao.closest('.pane') : null;
    const inp = volta && volta.querySelector('.p-input');
    if (inp) inp.focus();
  }
  const aberta = () => !!veu && veu.isConnected && veu.classList.contains('aberto');
  // o mesmo ícone fecha; o ícone de OUTRA conversa leva o popup para lá, com as notas de lá
  function alternar(b) { if (aberta() && chaveDoBotao(b) === chave) fechar(); else abrir(b); }

  /* ---------- as duas vistas ---------- */
  function mostrar(qual) {
    vista = qual;
    pop.classList.toggle('v-lista', qual === 'lista');
    pop.classList.toggle('v-nota', qual === 'nota');
  }
  const acharNota = (id) => notas.find((n) => n.id === id);

  function largarNotaVazia() {
    const n = acharNota(atualId);
    if (n && textoVazio(n)) { notas = notas.filter((x) => x !== n); atualId = ''; agendar(); }
  }

  function irParaLista() {
    lerDaCaixa();
    largarNotaVazia();
    salvarJa();
    mostrar('lista');
    busca = ''; $('.nt-busca input', pop).value = '';
    pintarLista();
    $('.nt-v-lista .nt-rol', pop).scrollTop = 0;
  }
  function irParaNota(id) {
    const n = acharNota(id);
    if (!n) return irParaLista();
    if (atualId && atualId !== id) { lerDaCaixa(); largarNotaVazia(); }
    atualId = id;
    mostrar('nota');
    montarCaixa(n);
    $('.nt-data', pop).textContent = dataLonga(n.m);
    requestAnimationFrame(() => { ed.focus(); fimDoTexto(); });
  }
  function novaNota() {
    if (atualId) { lerDaCaixa(); largarNotaVazia(); }
    const agora = Date.now();
    const n = { id: 'n' + agora.toString(36) + Math.random().toString(36).slice(2, 6), chat: chave, c: agora, m: agora, linhas: [{ c: 0, f: 0, t: '' }] };
    notas.unshift(n);
    irParaNota(n.id);
  }
  function apagarAtual() {
    const n = acharNota(atualId);
    if (!n) return irParaLista();
    if (!textoVazio(n) && !confirm('Apagar esta nota?')) return;
    notas = notas.filter((x) => x !== n);
    atualId = '';
    agendar(); salvarJa();
    irParaLista();
  }

  /* ---------- a lista ---------- */
  function pintarLista() {
    const corpo = $('.nt-lista-corpo', pop);
    const termo = busca.trim().toLowerCase();
    const todas = doChat().filter((n) => !textoVazio(n)).sort((a, b) => b.m - a.m);
    const itens = termo ? todas.filter((n) => n.linhas.some((l) => String(l.t || '').toLowerCase().includes(termo))) : todas;
    $('.nt-cont', pop).textContent = todas.length === 1 ? '1 Nota' : todas.length + ' Notas';
    if (!itens.length) {
      corpo.innerHTML = '<div class="nt-vazio">' + (termo ? 'Nenhum resultado' : 'Nenhuma nota') + '</div>';
      return;
    }
    const grupos = [];
    for (const n of itens) {
      const s = secaoDe(n.m);
      let g = grupos[grupos.length - 1];
      if (!g || g.s !== s) { g = { s, itens: [] }; grupos.push(g); }
      g.itens.push(n);
    }
    corpo.innerHTML = grupos.map((g) => '<div class="nt-sec">' + esc(g.s) + '</div><ul class="nt-cartao">'
      + g.itens.map((n) => '<li><button type="button" class="nt-linha" data-id="' + esc(n.id) + '">'
        + '<span class="nt-l-tit">' + esc(titulo(n)) + '</span>'
        + '<span class="nt-l-sub"><span class="nt-l-data">' + esc(dataCurta(n.m)) + '</span><span class="nt-l-pre">' + esc(previa(n)) + '</span></span>'
        + '</button></li>').join('') + '</ul>').join('');
    for (const b of corpo.querySelectorAll('.nt-linha')) b.onclick = () => irParaNota(b.dataset.id);
  }

  /* ---------- a caixa de escrever ---------- */
  function linhaEl(l) {
    const d = document.createElement('div');
    if (l.c) { d.className = 'ck'; if (l.f) d.dataset.f = '1'; }
    if (l.t) d.textContent = l.t; else d.appendChild(document.createElement('br'));
    return d;
  }
  function montarCaixa(n) {
    ed.textContent = '';
    for (const l of (n.linhas.length ? n.linhas : [{ c: 0, f: 0, t: '' }])) ed.appendChild(linhaEl(l));
    ed.scrollTop = 0;
    pintarPlaca();
  }
  // "Título" cinza em cima da 1ª linha enquanto ela está vazia
  function pintarPlaca() {
    const ph = $('.nt-ph', pop), p = ed.firstElementChild;
    if (!ph) return;
    const vazia = !p || !(p.textContent || '').length;
    ph.style.display = vazia ? 'block' : 'none';
    ph.style.paddingLeft = p && p.classList.contains('ck') ? '32px' : '0';
  }
  function normalizar() {
    // o navegador às vezes deixa texto solto ou um <br> direto na caixa: tudo vira linha (div)
    if (!ed.firstChild) { ed.appendChild(linhaEl({ t: '' })); return; }
    for (const no of [...ed.childNodes]) {
      if (no.nodeType === 1 && no.tagName === 'DIV') continue;
      const d = document.createElement('div');
      ed.insertBefore(d, no);
      d.appendChild(no);
    }
  }
  function lerDaCaixa() {
    const n = acharNota(atualId);
    if (!n || !ed) return;
    normalizar();
    n.linhas = [...ed.children].map((d) => ({
      c: d.classList.contains('ck') ? 1 : 0,
      f: d.dataset.f === '1' ? 1 : 0,
      t: (d.textContent || '').replace(/ /g, ' '),
    }));
  }
  function aoDigitar() {
    const n = acharNota(atualId);
    if (!n) return;
    lerDaCaixa();
    pintarPlaca();
    n.m = Date.now();
    $('.nt-data', pop).textContent = dataLonga(n.m);
    agendar();
  }
  function fimDoTexto() {
    const sel = window.getSelection(), r = document.createRange();
    r.selectNodeContents(ed); r.collapse(false);
    sel.removeAllRanges(); sel.addRange(r);
  }
  const blocoDe = (no) => { while (no && no.parentNode !== ed) no = no.parentNode; return no && no.nodeType === 1 ? no : null; };
  function blocoAtual() {
    const s = window.getSelection();
    return s && s.rangeCount ? blocoDe(s.getRangeAt(0).startContainer) : null;
  }
  function noInicio(d) {
    const s = window.getSelection();
    if (!s.rangeCount || !s.isCollapsed) return false;
    const r = document.createRange();
    r.selectNodeContents(d); r.setEnd(s.getRangeAt(0).startContainer, s.getRangeAt(0).startOffset);
    return r.toString() === '';
  }
  function cursorNo(d, fim) {
    const s = window.getSelection(), r = document.createRange();
    r.selectNodeContents(d); r.collapse(!fim);
    s.removeAllRanges(); s.addRange(r);
  }
  function tirarVerificacao(d) { d.classList.remove('ck'); delete d.dataset.f; if (!d.className) d.removeAttribute('class'); }

  function antesDeDigitar(e) {
    const d = blocoAtual();
    if (!d) return;
    const ehCk = d.classList.contains('ck');
    if (e.inputType === 'insertParagraph' && ehCk) {
      e.preventDefault();
      if (!(d.textContent || '').trim()) { tirarVerificacao(d); }   // Enter numa vazia termina a lista
      else {
        const s = window.getSelection(), r = s.getRangeAt(0).cloneRange();
        r.setEndAfter(d.lastChild || d);
        const resto = r.extractContents().textContent || '';
        if (!d.firstChild) d.appendChild(document.createElement('br'));
        const novo = linhaEl({ c: 1, f: 0, t: resto });
        d.after(novo); cursorNo(novo, false);
      }
      aoDigitar();
    } else if (e.inputType === 'deleteContentBackward' && ehCk && noInicio(d)) {
      e.preventDefault(); tirarVerificacao(d); aoDigitar();   // Backspace no começo vira linha comum
    }
  }
  function cliqueNaCaixa(e) {
    const d = blocoDe(e.target);
    if (!d || !d.classList.contains('ck')) return;
    const r = d.getBoundingClientRect();
    if (e.clientX - r.left <= 28) {
      e.preventDefault();
      if (d.dataset.f === '1') delete d.dataset.f; else d.dataset.f = '1';
      aoDigitar();
    }
  }
  function alternarVerificacao() {
    const s = window.getSelection();
    if (!s.rangeCount || !ed.contains(s.anchorNode)) { ed.focus(); fimDoTexto(); }
    const r = window.getSelection().getRangeAt(0);
    let a = blocoDe(r.startContainer), z = blocoDe(r.endContainer);
    if (!a) return;
    const blocos = [];
    for (let x = a; x; x = x.nextElementSibling) { blocos.push(x); if (x === z) break; }
    const todos = blocos.every((b) => b.classList.contains('ck'));
    for (const b of blocos) { if (todos) tirarVerificacao(b); else b.classList.add('ck'); }
    aoDigitar();
  }
  function colar(e) {
    e.preventDefault();
    const texto = (e.clipboardData && e.clipboardData.getData('text/plain')) || '';
    const linhas = texto.replace(/\r\n?/g, '\n').split('\n');
    linhas.forEach((l, i) => {
      if (i) document.execCommand('insertParagraph');
      if (l) document.execCommand('insertText', false, l);
    });
  }

  /* ---------- ligações ---------- */
  document.addEventListener('click', (e) => {
    const b = e.target && e.target.closest && e.target.closest('.p-notas');
    if (b) { e.stopPropagation(); alternar(b); return; }
    // clicar fora NÃO fecha: dá para anotar enquanto o chat trabalha
  }, true);
  window.addEventListener('beforeunload', () => { if (pop) { lerDaCaixa(); salvarJa(); } });
  if (api.onNotas) api.onNotas((p) => {
    if (!p || p.origem === ORIGEM || !Array.isArray(p.notas)) return;
    // vindo de outra janela: junta pelo número da nota, a que está aberta aqui não é trocada
    const local = acharNota(atualId);
    notas = p.notas.filter((n) => n && n.id && Array.isArray(n.linhas) && n.id !== atualId);
    if (local) notas.unshift(local);
    if (aberta() && vista === 'lista') pintarLista();
  });

  // Esc fecha em qualquer lugar (em captura, para não chegar no Esc do app, que PARA o trabalho da IA)
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !aberta()) return;
    e.preventDefault(); e.stopPropagation(); fechar();
  }, true);

  window.Notas = { abrir, fechar, alternar, aberta, sessao };
})();
