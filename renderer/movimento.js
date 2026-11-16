/* ============ Movimento do celular (16/11/2026) ============
   O que o movimento.css nao faz sozinho, medido na gravacao do app oficial do Claude:
   1. Anexar: o "+" abre um painel que sobe de baixo (mola), com Fotos, Camera e Arquivos.
      O arquivo aparece NA HORA na caixa, com miniatura e barra de progresso. Antes: menu, a
      janela do iPhone, e depois nada por varios segundos (video de 27 MB parecia travado).
      Arraste o painel para baixo para fechar.
   2. Enviar: o teclado desce, a mensagem voa da caixa ate o topo da tela e fica la em cima,
      com a resposta nascendo embaixo dela (o espaco abaixo e reservado ate a resposta crescer).
   3. Rolagem: acompanhar a resposta desliza em vez de pular a cada pedaco.
   4. Mensagem nova que chega (resposta, passo, aviso) entra deslizando.
   So no telefone. Nada aqui fala com o Mac por conta propria: o envio continua sendo o send()
   de sempre (ou o do espelho.js), e o arquivo sobe pela mesma rota /upload do web.js. */
(function () {
  'use strict';
  if (!window.SEM_ELECTRON) return;
  const qs = (s, r) => (r || document).querySelector(s);
  const calmo = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const MOLA = 'cubic-bezier(.2,.85,.25,1)';
  let QUIQUE = 'cubic-bezier(.2,.9,.3,1.12)';
  try { if (CSS.supports('transition-timing-function', 'linear(0, 1)')) QUIQUE = 'linear(0, 0.0488, 0.1645, 0.3108, 0.4628, 0.6045, 0.7271, 0.8269, 0.9038, 0.9596, 0.9975, 1.021, 1.0335, 1.0381, 1.0376, 1.0338, 1.0285, 1.0226, 1.017, 1.012, 1.0079, 1.0046, 1.0022, 1.0005, 0.9994, 0.9988, 0.9986, 0.9985, 1)'; } catch {}

  const ico = (d) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
  const ICONES = {
    fotos: ico('<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>'),
    camera: ico('<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.5"/>'),
    arquivo: ico('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>'),
  };

  /* ======================= 1. painel de anexar ======================= */
  let folha = null;
  function fecharFolha(rapido) {
    const f = folha; if (!f) return;
    folha = null;
    f.el.classList.add('saindo'); f.el.classList.remove('aberto'); f.veu.classList.remove('aberto');
    f.el.style.transform = '';
    setTimeout(() => { f.el.remove(); f.veu.remove(); }, rapido ? 0 : 260);
  }
  function abrirFolha(P) {
    try { fecharMenus(); } catch {}
    fecharFolha(true);
    const veu = document.createElement('div'); veu.className = 'mv-veu';
    const el = document.createElement('div'); el.className = 'mv-folha';
    el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Anexar');
    el.innerHTML = '<div class="mv-alca"></div>'
      + '<div class="mv-cab"><button class="mv-x" aria-label="Fechar">×</button><h3>Adicionar</h3><span></span></div>'
      + '<div class="mv-blocos">'
      + '<button class="mv-bloco" data-t="fotos">' + ICONES.fotos + 'Fotos e vídeos</button>'
      + '<button class="mv-bloco" data-t="camera">' + ICONES.camera + 'Câmera</button>'
      + '<button class="mv-bloco" data-t="arquivo">' + ICONES.arquivo + 'Arquivos</button>'
      + '</div>' + listaDoResto(P);
    document.body.append(veu, el);
    folha = { el, veu, P };
    requestAnimationFrame(() => requestAnimationFrame(() => { el.classList.add('aberto'); veu.classList.add('aberto'); }));
    veu.addEventListener('click', () => fecharFolha());
    qs('.mv-x', el).addEventListener('click', () => fecharFolha());
    el.querySelectorAll('.mv-bloco').forEach(b => b.addEventListener('click', () => escolher(P, b.dataset.t)));
    // cada linha aperta o botao de verdade (escondido na caixa): o menu dele abre como sempre abriu
    el.querySelectorAll('.mv-linha').forEach(l => l.addEventListener('click', () => {
      const bt = qs('.cmp-bar .' + l.dataset.bt, P.el);
      fecharFolha(true);
      if (bt) setTimeout(() => bt.click(), 30);
    }));
    arrastarParaFechar(el, veu);
  }
  /* O que saiu da caixa de escrever mora aqui: o "+" passa a ter tudo, como no app do Claude.
     Nao copia o que cada botao faz: a linha so aperta o botao original, que continua no lugar
     (escondido). Botao novo que alguem puser na caixa precisa entrar nesta lista. */
  const RESTO = [
    ['p-slash', 'Comandos e ações'],
    ['p-model', 'Modelo e esforço'],
    ['p-modo', 'Permissão'],
    ['p-modoenvio', 'Se ele estiver trabalhando'],
    ['p-plano', 'Planejar antes de executar'],
    ['p-agentes', 'Time de agentes'],
    ['p-quadro', 'Quadro branco'],
    ['p-cwd', 'Pasta deste chat'],
    ['p-mais', 'Mais opções'],
  ];
  const esc = (t) => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function listaDoResto(P) {
    const linhas = [];
    for (const [cls, nome] of RESTO) {
      const bt = qs('.cmp-bar .' + cls, P.el);
      if (!bt || bt.classList.contains('hidden')) continue;
      const svg = bt.querySelector('svg');
      let valor = (bt.textContent || '').replace(/\s+/g, ' ').trim();
      if (cls === 'p-cwd') valor = (P.cwd || '').split('/').filter(Boolean).pop() || '';
      if (valor.length > 32) valor = valor.slice(0, 31) + '…';
      linhas.push('<button class="mv-linha" data-bt="' + cls + '"><span class="mv-li-ic">' + (svg ? svg.outerHTML : '') + '</span>'
        + '<span class="mv-li-n">' + esc(nome) + '</span>' + (valor ? '<span class="mv-li-v">' + esc(valor) + '</span>' : '')
        + '<span class="mv-li-seta">›</span></button>');
    }
    return linhas.length ? '<div class="mv-lista">' + linhas.join('') + '</div>' : '';
  }

  function arrastarParaFechar(el, veu) {
    let y0 = null, dy = 0, t0 = 0;
    el.addEventListener('touchstart', (e) => {
      if (e.target.closest('button')) return;
      y0 = e.touches[0].clientY; dy = 0; t0 = Date.now();
      el.style.transition = 'none';
    }, { passive: true });
    el.addEventListener('touchmove', (e) => {
      if (y0 == null) return;
      dy = e.touches[0].clientY - y0;
      // pra cima resiste (borracha), pra baixo acompanha o dedo
      const v = dy < 0 ? -Math.sqrt(-dy) * 2 : dy;
      el.style.transform = 'translateY(' + v + 'px)';
      veu.style.opacity = String(Math.max(0, .32 * (1 - Math.max(0, dy) / 300)));
    }, { passive: true });
    el.addEventListener('touchend', () => {
      if (y0 == null) return;
      const vel = dy / Math.max(1, Date.now() - t0);
      y0 = null; el.style.transition = ''; veu.style.opacity = '';
      if (dy > 90 || vel > .6) fecharFolha();
      else el.style.transform = '';
    });
  }

  function escolher(P, tipo) {
    const inp = document.createElement('input');
    inp.type = 'file';
    if (tipo === 'fotos') { inp.accept = 'image/*,video/*'; inp.multiple = true; }
    else if (tipo === 'camera') { inp.accept = 'image/*'; inp.setAttribute('capture', 'environment'); }
    else { inp.accept = '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.md,.csv,.json,.zip,image/*,video/*'; inp.multiple = true; }
    inp.style.cssText = 'position:fixed;left:-100px;top:0;width:1px;height:1px;opacity:0';
    document.body.appendChild(inp);
    inp.addEventListener('change', () => {
      const lista = [...(inp.files || [])];
      inp.remove();
      for (const f of lista) subir(P, f);
    });
    inp.addEventListener('cancel', () => inp.remove());
    inp.click();            // tem de ser dentro do toque: o iPhone so abre a galeria assim
    fecharFolha();
  }

  function caixaDeSubida(P) {
    const cmp = qs('.pane-cmp', P.el);
    let c = qs('.mv-subindo', cmp);
    if (!c) { c = document.createElement('div'); c.className = 'mv-subindo'; cmp.insertBefore(c, cmp.firstChild); }
    return c;
  }
  function subir(P, f) {
    const ficha = document.createElement('div'); ficha.className = 'mv-ficha';
    let url = '';
    if (/^image\//.test(f.type)) { url = URL.createObjectURL(f); const i = new Image(); i.src = url; i.alt = ''; ficha.appendChild(i); }
    else if (/^video\//.test(f.type)) {
      url = URL.createObjectURL(f);
      const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.preload = 'metadata'; v.src = url + '#t=0.1';
      ficha.appendChild(v);
    } else { const n = document.createElement('span'); n.className = 'mv-nome'; n.textContent = f.name || 'arquivo'; ficha.appendChild(n); }
    const pct = document.createElement('span'); pct.className = 'mv-pct'; pct.textContent = '0%';
    const barra = document.createElement('div'); barra.className = 'mv-barra'; barra.innerHTML = '<i></i>';
    ficha.append(pct, barra);
    caixaDeSubida(P).appendChild(ficha);
    const soltar = () => { try { if (url) URL.revokeObjectURL(url); } catch {} };
    const falhou = (msg) => {
      ficha.classList.add('erro'); pct.textContent = 'falhou'; barra.remove();
      ficha.title = msg;
      try { avisoTemp(P, 'Não consegui mandar ' + (f.name || 'o arquivo') + ' para o Mac: ' + msg, true); } catch {}
      ficha.addEventListener('click', () => { ficha.remove(); soltar(); }, { once: true });
    };
    const nome = f.name || 'anexo';
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/upload?nome=' + encodeURIComponent(nome));
    xhr.setRequestHeader('Content-Type', f.type || 'application/octet-stream');
    xhr.setRequestHeader('X-Nome', encodeURIComponent(nome));
    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return;
      const p = Math.min(99, Math.round(e.loaded / e.total * 100));
      pct.textContent = p + '%'; barra.firstChild.style.width = p + '%';
    };
    xhr.onerror = () => falhou('a conexão caiu no meio do envio');
    xhr.onload = async () => {
      let j = null; try { j = JSON.parse(xhr.responseText); } catch {}
      if (xhr.status !== 200 || !j || !j.arquivo) return falhou((j && (j.error || j.erro)) || ('o Mac respondeu ' + xhr.status));
      pct.textContent = '✓'; barra.firstChild.style.width = '100%'; ficha.classList.add('feito');
      try { await anexar(P, [j.arquivo]); } catch (e) { return falhou((e && e.message) || 'não anexou'); }
      // a ficha mostra o nome que ele conhece, nao o "celular-1794..." que o Mac deu ao arquivo
      const a = (P.anexos || []).find(x => x && x.path === j.arquivo);
      if (a && f.name) { a.nome = f.name; try { pintarAnexos(P); } catch {} }
      setTimeout(() => { ficha.animate([{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(.8)' }], { duration: 180, easing: 'ease-in' }).onfinish = () => { ficha.remove(); soltar(); }; }, 250);
    };
    xhr.send(f);
  }
  // o "+" de todo chat chama menuAnexo(P): no telefone ele vira o painel
  window.menuAnexo = function (P) { abrirFolha(P); };

  /* ======================= 2 a 4. conversa ======================= */
  const vistos = new WeakMap();      // chat -> WeakSet dos filhos que ja estavam la
  const mao = new WeakMap();         // chat -> ate quando ele esta mexendo na rolagem
  const alvos = new WeakMap();       // chat -> animacao de rolagem em curso

  function painelDoChat(chat) { const el = chat.closest('.pane'); return el && panes.get(el.dataset.id); }

  // rolar ate o fim deslizando (o espelho chama isto a cada pedaco da resposta)
  function seguirFim(chat) {
    if (calmo) { chat.scrollTop = chat.scrollHeight; return; }
    if ((mao.get(chat) || 0) > Date.now()) return;
    if (alvos.get(chat)) return;
    const passo = () => {
      const alvo = chat.scrollHeight - chat.clientHeight;
      const falta = alvo - chat.scrollTop;
      if (Math.abs(falta) < 1 || (mao.get(chat) || 0) > Date.now()) { alvos.delete(chat); return; }
      chat.scrollTop += Math.sign(falta) * Math.max(1, Math.abs(falta) * .22);
      alvos.set(chat, requestAnimationFrame(passo));
    };
    alvos.set(chat, requestAnimationFrame(passo));
  }

  // a mensagem que ele mandou fica no topo; o espaco embaixo e reservado para a resposta
  const BASE = 18;   // o padding-bottom do .pane-chat no celular.css
  function topoDe(chat, el) { return el.getBoundingClientRect().top - chat.getBoundingClientRect().top + chat.scrollTop; }
  function reservar(P) {
    const chat = P.chat, el = P._mvFixa;
    if (!el || !el.isConnected) { soltarTopo(P); return; }
    const extra = P._mvExtra || 0;
    const fim = chat.scrollHeight - extra;
    const precisa = Math.max(0, Math.round(topoDe(chat, el) - 8 + chat.clientHeight - fim));
    if (precisa !== extra) { P._mvExtra = precisa; chat.style.paddingBottom = (BASE + precisa) + 'px'; }
    if (!precisa) soltarTopo(P, true);
  }
  function soltarTopo(P, manterRolagem) {
    P._mvFixa = null;
    if (P._mvExtra) {
      const top = P.chat.scrollTop;
      P._mvExtra = 0; P.chat.style.paddingBottom = '';
      if (manterRolagem) P.chat.scrollTop = top;
    }
  }
  // rolagem com duracao e freio (o que o app do Claude faz quando a mensagem sobe):
  // o que estava na tela sobe junto, em vez de sumir de uma vez
  function rolarAte(chat, alvo, ms) {
    const a = alvos.get(chat); if (a) cancelAnimationFrame(a);
    const de = chat.scrollTop, t0 = performance.now(), dist = alvo - de;
    if (calmo || Math.abs(dist) < 2) { chat.scrollTop = alvo; alvos.delete(chat); return; }
    const passo = (t) => {
      const k = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - k, 3);
      chat.scrollTop = de + dist * e;
      if (k < 1 && (mao.get(chat) || 0) <= Date.now()) alvos.set(chat, requestAnimationFrame(passo));
      else alvos.delete(chat);
    };
    alvos.set(chat, requestAnimationFrame(passo));
  }
  function fixarNoTopo(P, el) {
    P._mvFixa = el;
    reservar(P);
    rolarAte(P.chat, Math.max(0, topoDe(P.chat, el) - 8), 420);
  }
  // a bolha ja sobe com a rolagem; aqui so o "nascer" dela, com o quique leve
  function voar(el) {
    if (calmo || !el.animate) return;
    el.animate([
      { transform: 'translateY(14px) scale(.96)', opacity: .4 },
      { transform: 'none', opacity: 1 },
    ], { duration: 480, easing: QUIQUE });
  }
  function entrar(el) {
    if (calmo || !el.animate) return;
    el.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 340, easing: MOLA });
  }

  function vigiarChat(P) {
    const chat = P.chat;
    if (!chat || vistos.has(chat)) return;
    const ja = new WeakSet([...chat.children]);
    vistos.set(chat, ja);
    const mexeu = () => mao.set(chat, Date.now() + 1200);
    chat.addEventListener('touchstart', () => { mao.set(chat, Date.now() + 60000); const a = alvos.get(chat); if (a) { cancelAnimationFrame(a); alvos.delete(chat); } }, { passive: true });
    chat.addEventListener('touchend', mexeu, { passive: true });
    chat.addEventListener('wheel', mexeu, { passive: true });
    new MutationObserver((lista) => {
      const novos = [];
      for (const m of lista) for (const n of m.addedNodes) if (n.nodeType === 1 && n.parentElement === chat && !ja.has(n)) { ja.add(n); novos.push(n); }
      if (P._mvFixa) reservar(P);
      if (!novos.length) return;
      const minha = novos.find(n => n.matches('.msg.user'));
      if (minha && P._mvEnviou && Date.now() - P._mvEnviou.t < 10000) {
        P._mvEnviou = null;
        fixarNoTopo(P, minha);
        voar(minha);
        return;
      }
      // chegou muita coisa de uma vez = abriu a conversa ou voltou do fundo: sem animacao
      if (novos.length > 3 || document.hidden) return;
      for (const n of novos) if (!n.matches('.trab')) entrar(n);
    }).observe(chat, { childList: true });
  }

  function iniciar() {
    // chats que ja existem e os que nascerem depois
    for (const P of panes.values()) vigiarChat(P);
    new MutationObserver(() => { for (const P of panes.values()) vigiarChat(P); })
      .observe(document.getElementById('panes') || document.body, { childList: true, subtree: true });

    // enviar: guarda de onde a mensagem saiu e baixa o teclado
    const enviarAntes = window.send;
    window.send = function (P) {
      try {
        const inp = P && qs('.p-input', P.el);
        if (P && inp && (inp.value.trim() || (P.anexos || []).length)) {
          const r = inp.getBoundingClientRect();
          P._mvEnviou = { t: Date.now(), de: { left: r.left, top: r.top } };
          soltarTopo(P);
          setTimeout(() => { try { inp.blur(); } catch {} }, 0);
        }
      } catch {}
      return enviarAntes.apply(this, arguments);
    };

    // o enviar acende quando tem o que mandar
    setInterval(() => {
      const P = focusPane; if (!P || !P.el) return;
      const inp = qs('.p-input', P.el);
      const tem = !!(inp && inp.value.trim()) || !!(P.anexos || []).length;
      if (tem === P.el.classList.contains('mv-tem-texto')) return;
      P.el.classList.toggle('mv-tem-texto', tem);
      const b = qs('.p-send', P.el);
      if (b && tem) { b.classList.remove('mv-acendeu'); void b.offsetWidth; b.classList.add('mv-acendeu'); }
    }, 120);
  }

  /* Teclado aberto: a tela visivel encolhe bem mais que a janela. Liga a classe que tira a folga
     da barrinha do iPhone e recolhe abas e cabecalho (movimento.css). */
  const vv = window.visualViewport;
  // a altura da tela SEM teclado: a maior que ja vimos com nenhum campo em foco (zera ao girar)
  let cheia = vv ? vv.height : innerHeight, largura = innerWidth;
  function conferirTeclado() {
    const a = document.activeElement;
    const campo = !!(a && a.matches && a.matches('textarea, input[type="text"], input:not([type]), [contenteditable="true"]'));
    const h = vv ? vv.height : innerHeight;
    if (innerWidth !== largura) { largura = innerWidth; cheia = h; }
    if (!campo || h > cheia) cheia = Math.max(h, campo ? cheia : h);
    document.body.classList.toggle('mv-teclado', campo && cheia - h > 150);
  }
  if (vv) { vv.addEventListener('resize', conferirTeclado); vv.addEventListener('scroll', conferirTeclado); }
  document.addEventListener('focusin', () => setTimeout(conferirTeclado, 60));
  document.addEventListener('focusout', () => setTimeout(conferirTeclado, 60));

  window.MV = { seguirFim, abrirFolha };
  if (window.__cockpitPronto) iniciar(); else window.addEventListener('cockpit:pronto', iniciar, { once: true });
})();
