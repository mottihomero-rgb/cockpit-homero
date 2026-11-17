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
    const antes = document.body.classList.contains('mv-teclado');
    document.body.classList.toggle('mv-teclado', campo && cheia - h > 150);
    if (antes !== document.body.classList.contains('mv-teclado')) { requestAnimationFrame(alinharFoco); setTimeout(alinharFoco, 420); }
  }
  if (vv) { vv.addEventListener('resize', conferirTeclado); vv.addEventListener('scroll', conferirTeclado); }
  document.addEventListener('focusin', (e) => {
    setTimeout(conferirTeclado, 60);
    if (e.target && e.target.closest && e.target.closest('.pane-cmp')) { setTimeout(alinharFoco, 80); setTimeout(alinharFoco, 450); }
  });
  document.addEventListener('focusout', () => setTimeout(conferirTeclado, 60));

  /* ======================= 5. deslizar entre pastas ======================= */
  // o chat fica no meio da tela: sobra o mesmo pedacinho dos dois lados
  function centralizar(corpo, el) {
    if (!corpo || !el) return;
    const c = corpo.getBoundingClientRect(), r = el.getBoundingClientRect();
    corpo.scrollLeft += (r.left - c.left) - (c.width - r.width) / 2;
  }
  // o teclado abrindo (ou o iPhone puxando o campo para a vista) escorregava a fila de lado e o
  // chat ficava torto, com faixa preta: volta ele pro meio
  function alinharFoco() {
    const P = focusPane; if (!P || !P.el.isConnected) return;
    const A = abaDe(P); if (!A || A !== abaAtiva) return;
    centralizar(A.corpoEl, P.el);
  }
  const ordemDasAbas = () => [...document.querySelectorAll('#abasLista > [data-aid]')].map(e => abas.get(e.dataset.aid)).filter(A => A && A.ordem.length);
  function vizinha(A, passo) { const l = ordemDasAbas(); const i = l.indexOf(A); return i < 0 ? null : l[i + passo] || null; }
  function ponte(A, lado) {
    const B = vizinha(A, lado === 'depois' ? 1 : -1);
    let el = A.corpoEl.querySelector(':scope > .mv-ponte.' + lado);
    if (!B) { if (el) el.remove(); return null; }
    if (!el) { el = document.createElement('div'); el.className = 'mv-ponte ' + lado; el.setAttribute('aria-hidden', 'true'); }
    /* 16/11 (pedido dele: "nao quero essa tela de transicao"): a ponte nao e mais um cartao com o
       nome da pasta. E uma COPIA parada do chat que vem (o 1o da proxima pasta, ou o ultimo da
       anterior). Deslizou ate ela, a pasta troca por baixo e o chat de verdade ja esta ali. */
    const fonte = panes.get(lado === 'depois' ? B.ordem[0] : B.ordem[B.ordem.length - 1]);
    if (fonte && (el.__fonte !== fonte.id || Date.now() - (el.__t || 0) > 2500)) copiarChat(el, fonte);
    el.__aba = B;
    if (lado === 'depois' ? A.corpoEl.lastElementChild !== el : A.corpoEl.firstElementChild !== el) {
      if (lado === 'depois') A.corpoEl.appendChild(el); else A.corpoEl.prepend(el);
    }
    return el;
  }
  function copiarChat(el, P) {
    const c = P.el.cloneNode(true);
    c.removeAttribute('data-id');
    c.classList.remove('foco', 'espelho');
    c.querySelectorAll('.p-modal, .p-visor, .mv-subindo').forEach(x => x.remove());
    c.querySelectorAll('[id]').forEach(x => x.removeAttribute('id'));
    const chat = c.querySelector('.pane-chat');
    if (chat) { const filhos = [...chat.children]; filhos.slice(0, Math.max(0, filhos.length - 14)).forEach(x => x.remove()); }
    // o texto que ele escreveu no campo de verdade (value nao vem na copia)
    const inpV = P.el.querySelector('.p-input'), inpC = c.querySelector('.p-input');
    if (inpV && inpC) inpC.value = inpV.value;
    el.replaceChildren(c);
    el.__fonte = P.id; el.__t = Date.now();
    requestAnimationFrame(() => { const ch = el.querySelector('.pane-chat'); if (ch) ch.scrollTop = ch.scrollHeight; });
  }
  function pontes(A) {
    if (!A || !A.corpoEl) return;
    const tinhaAntes = !!A.corpoEl.querySelector(':scope > .mv-ponte.antes');
    const depois = ponte(A, 'depois'), antes = ponte(A, 'antes');
    A.corpoEl.classList.toggle('mv-tem-proxima', !!depois);
    // a ponte de tras acabou de nascer na frente: o chat que estava na tela nao pode ser empurrado
    if (antes && !tinhaAntes && A === abaAtiva && focusPane && abaDe(focusPane) === A) {
      requestAnimationFrame(() => centralizar(A.corpoEl, focusPane.el));
    }
  }
  function todasAsPontes() { for (const A of abas.values()) pontes(A); }

  let dedo = false, conferir = 0, trocando = false, ultimoToque = 0;
  function irPara(B, frente) {
    if (!B || trocando) return;
    trocando = true;
    const alvo = panes.get(frente ? B.ordem[0] : B.ordem[B.ordem.length - 1]);
    if (alvo) B.ativo = alvo.id;
    try { ativarAbaProjeto(B); } catch {}
    if (alvo) { try { setFocus(alvo); } catch {} }
    // sem animacao: a copia ja mostrava este chat no mesmo lugar, a troca nao aparece
    if (alvo) centralizar(B.corpoEl, alvo.el);
    requestAnimationFrame(() => { if (alvo) centralizar(B.corpoEl, alvo.el); setTimeout(() => { trocando = false; }, 250); });
  }
  function conferirPonte(corpo) {
    if (dedo || trocando) return;
    // so troca de pasta quando foi o DEDO dele que deslizou. Abrir uma pasta pela aba deixa a
    // fila no comeco por um instante (a ponte de tras fica a vista) e isso pulava de pasta sozinho.
    if (Date.now() - ultimoToque > 2000 && !window.__mvGestoDeTeste) return;
    const A = [...abas.values()].find(x => x.corpoEl === corpo);
    if (!A || A !== abaAtiva) return;
    const c = corpo.getBoundingClientRect();
    for (const el of corpo.querySelectorAll(':scope > .mv-ponte')) {
      const r = el.getBoundingClientRect();
      const visivel = Math.max(0, Math.min(r.right, c.right) - Math.max(r.left, c.left)) / c.width;
      if (visivel > .55) { irPara(el.__aba, el.classList.contains('depois')); return; }
    }
  }
  function vigiarCorpo(A) {
    const corpo = A.corpoEl;
    if (!corpo || corpo.__mvPonte) return;
    corpo.__mvPonte = true;
    corpo.addEventListener('touchstart', () => { dedo = true; pontes(A); }, { passive: true });
    const soltou = () => { dedo = false; ultimoToque = Date.now(); clearTimeout(conferir); conferir = setTimeout(() => conferirPonte(corpo), 140); };
    corpo.addEventListener('touchend', soltou, { passive: true });
    corpo.addEventListener('touchcancel', soltou, { passive: true });
    corpo.addEventListener('scroll', () => { clearTimeout(conferir); conferir = setTimeout(() => conferirPonte(corpo), 140); }, { passive: true });
    corpo.addEventListener('scrollend', () => conferirPonte(corpo));
    // remontar as colunas apaga as pontes (replaceChildren): voltam na hora
    new MutationObserver(() => { if (!corpo.querySelector(':scope > .mv-ponte') || corpo.lastElementChild.classList.contains('mv-ponte') === false) pontes(A); })
      .observe(corpo, { childList: true });
  }
  function ligarPontes() {
    for (const A of abas.values()) vigiarCorpo(A);
    todasAsPontes();
  }
  if (window.__cockpitPronto) setTimeout(ligarPontes, 300); else window.addEventListener('cockpit:pronto', () => setTimeout(ligarPontes, 300), { once: true });
  // aba nova, aba fechada, ordem trocada, chat que entrou ou saiu: refaz as pontes
  setTimeout(() => {
    const lista = document.getElementById('abasLista');
    if (lista) new MutationObserver(() => { ligarPontes(); }).observe(lista, { childList: true, subtree: true, characterData: true });
  }, 400);

  /* ======================= 6. bolinhas de pagina (HIG: page control) =======================
     Uma bolinha por chat da pasta aberta, centralizadas logo acima da caixa de escrever; a cheia
     e a que esta na tela. Atualiza enquanto ele desliza. Com 1 chat so, nao aparece. */
  const pontos = document.createElement('div');
  pontos.className = 'mv-pontos escondido';
  document.body.appendChild(pontos);
  let pintarPend = 0;
  function pintarPontos() {
    pintarPend = 0;
    const A = abaAtiva;
    const lista = A ? A.ordem.map(id => panes.get(id)).filter(Boolean) : [];
    if (lista.length < 2 || lista.length > 12) { pontos.classList.add('escondido'); return; }
    const c = A.corpoEl.getBoundingClientRect();
    const meio = c.left + c.width / 2;
    let atual = 0, melhor = Infinity;
    lista.forEach((P, i) => { const r = P.el.getBoundingClientRect(); const d = Math.abs(r.left + r.width / 2 - meio); if (d < melhor) { melhor = d; atual = i; } });
    if (pontos.children.length !== lista.length) pontos.replaceChildren(...lista.map(() => document.createElement('i')));
    [...pontos.children].forEach((b, i) => b.classList.toggle('atual', i === atual));
    const cmp = lista[atual].el.querySelector('.pane-cmp');
    const topo = cmp ? cmp.getBoundingClientRect().top : innerHeight - 90;
    pontos.style.bottom = Math.max(0, Math.round(innerHeight - topo + 6)) + 'px';
    pontos.classList.remove('escondido');
  }
  const agendarPontos = () => { if (!pintarPend) pintarPend = requestAnimationFrame(pintarPontos); };
  document.addEventListener('scroll', agendarPontos, true);
  window.addEventListener('resize', agendarPontos);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', agendarPontos);
  setInterval(agendarPontos, 700);   // aba trocada, chat aberto/fechado, caixa que cresceu

  window.MV = { seguirFim, abrirFolha, irPara, centralizar };
  if (window.__cockpitPronto) iniciar(); else window.addEventListener('cockpit:pronto', iniciar, { once: true });
})();
