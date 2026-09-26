/* ================= janelinha de dica dos ícones (26/09, pedido dele) =================
   "Todos os ícones que não têm uma palavra junto: mouse em cima, sem clicar, depois de um
   instantinho aparece uma janelinha com uma pequena descrição do que é aquilo, pra que serve."
   Vale para qualquer botão que na tela é SÓ ícone (sem letra visível). O que ele é e para que serve
   vem da lista DICAS_ICONE (o primeiro seletor que bate); botão que não está na lista usa a dica que
   já tinha (title). O balão nativo do Mac some enquanto a janelinha está aberta, para não aparecerem
   os dois. Não entram: o (i) dos Ajustes (tem o balão dele) e os anéis de uso do topo (têm o cartão). */
(function () {
  const ESPERA = 450;   // o "instantinho": curto para ajudar, longo para não piscar passando o mouse
  const nomeIA = (el) => ({ claude: 'Claude', codex: 'Codex', gemini: 'Gemini', grok: 'Grok' }[el.dataset.motor] || 'IA');
  const depoisDe = (t, marca) => { const i = String(t || '').indexOf(marca); return i >= 0 ? String(t).slice(i + marca.length).trim() : ''; };

  /* [seletor, nome, o que faz]. O "o que faz" pode ser função (el, tituloGuardado) quando depende do
     estado na hora (Entra/Fila, porcentagem, pasta atual). */
  const DICAS_ICONE = [
    ['.act[data-view="conversas"]', 'Conversas', 'Lista das conversas e, no topo, a Torre com o que espera por você.'],
    ['.act[data-view="settings"]', 'Ajustes', 'Contas das IAs, aparência e preferências do Cockpit.'],
    ['#btnNovaAba', 'Nova aba', 'Abre uma aba para outra pasta ou projeto. ⌘⇧T'],
    ['.side-head .mini[data-reload]', 'Atualizar', 'Relê a lista de conversas agora.'],
    ['.side-lupa', 'Buscar', 'Procura em todas as conversas, de todas as IAs.'],
    ['.side-filtro', 'Pasta', (el) => {
      const atual = (el.querySelector('.sf-txt') || {}).textContent || '';
      return 'Mostra só as conversas de uma pasta.' + (atual ? ' Agora: ' + atual.trim() + '.' : '');
    }],
    ['.ch-lado', (el) => nomeIA(el), (el, t) => el.classList.contains('apagado') && t
      ? t : 'Passa a conversa para o ' + nomeIA(el) + '. Ele continua de onde parou.'],
    ['.p-compactar', 'Memória da conversa', (el, t) => {
      const pct = (/(\d+)%/.exec(t || '') || [])[1];
      return 'Quanto da conversa a IA ainda lembra.' + (pct ? ' Agora: ' + pct + '%.' : '') + ' Clique para ver e resumir.';
    }],
    ['.p-close', 'Fechar chat', 'Fecha este chat. A conversa fica salva na lista. ⌘W'],
    ['.aba-x', 'Fechar aba', 'Fecha a aba e os chats dela. As conversas ficam salvas.'],
    ['.pn-edit', 'Renomear', 'Muda o nome desta conversa.'],
    ['.p-plus', 'Anexar', 'Arquivo, pasta, imagem ou foto da câmera.'],
    ['.p-slash', 'Ações', 'Comandos, skills e prompts salvos. Também abre digitando /'],
    ['.p-mic', 'Ditar', 'Fale e o texto aparece na caixa. ⌘⇧D'],
    ['.p-modoenvio', (el) => el.getAttribute('aria-label') || 'Entra ou Fila', (el) =>
      (el.getAttribute('aria-label') === 'Fila'
        ? 'Mandou com ele trabalhando: a mensagem espera ele terminar.'
        : 'Mandou com ele trabalhando: a mensagem entra na hora e ele decide.') + ' Clique para trocar.'],
    ['.p-plano', 'Plano', 'Ele planeja e mostra o plano antes de executar.'],
    ['.p-cwd', 'Pasta do chat', (el, t) => {
      const atual = (/^Pasta: ([^·]+)/.exec(t || '') || [])[1];
      return 'Onde este chat trabalha.' + (atual ? ' Agora: ' + atual.trim() + '.' : '') + ' Clique para trocar.';
    }],
    ['.p-quadro', 'Quadro', 'Desenhe um fluxo para explicar o que você quer. ⌘⇧E'],
    ['.p-agentes', 'Agentes', (el) => {
      const n = ((el.querySelector('.pa-n') || {}).textContent || '').trim();
      const vivo = el.classList.contains('vivo');
      return (n ? (vivo ? n + (n === '1' ? ' trabalhando agora. ' : ' trabalhando agora. ') : n + ' neste chat. ') : '')
        + 'O time de agentes, quando vários trabalham juntos.';
    }],
    ['.p-mais', 'Mais', 'Entra ou Fila, plano, quadro e time de agentes.'],
    ['.p-modo', 'Permissão', 'O que ele pode fazer sem perguntar.'],
    ['.p-model', 'Modelo', (el) => {
      const atual = ((el.querySelector('span') || {}).textContent || '').trim();
      return (atual ? 'Agora: ' + atual + '. ' : '') + 'Clique para trocar o modelo e o esforço.';
    }],
    ['.p-send', 'Enviar', 'Manda a mensagem. Enter'],
    ['.p-stop', 'Parar', 'Interrompe o que ele está fazendo agora.'],
    ['.bt-copiar.da-msg', 'Copiar', 'Copia esta resposta.'],
    ['.bt-copiar', 'Copiar', 'Copia o texto desta mensagem.'],
    ['.msg-bt', (el, t) => /Voltar/i.test(t || '') ? 'Voltar até aqui' : 'Corrigir',
      (el, t) => /Voltar/i.test(t || '') ? 'Desfaz o que foi feito depois daqui ou abre um ramo da conversa.'
        : 'Edita esta mensagem e manda de novo.'],
    ['.hi-fav', 'Fixar', 'Deixa esta conversa no topo da lista.'],
    ['.hi-edit', 'Renomear', 'Muda o nome desta conversa.'],
    ['.hi-grupo', 'Grupo', (el, t) => depoisDe(t, 'No grupo') ? 'Está no grupo ' + depoisDe(t, 'No grupo').replace(/ — .*$/, '') + '. Clique para mover.' : 'Guarda esta conversa num grupo.'],
    ['.hi-mais', 'Mais', 'Outras ações desta conversa, como apagar.'],
    ['.anx-x', 'Tirar', 'Tira este anexo da mensagem.'],
    ['.pc-x', 'Tirar', 'Tira o trecho citado da mensagem.'],
    ['.mc-fechar,.tr-x', 'Fechar', ''],
  ];
  const NUNCA = '.info,.ut-ia,#usoTopo *';
  const ALVO = 'button,.act,[role="button"]';

  let el = null, timer = 0, caixa = null;
  const soIcone = (e) => !/[A-Za-zÀ-ÿ]/.test((e.innerText || '').trim());

  function dicaDe(e, titulo) {
    for (const [sel, nome, desc] of DICAS_ICONE) {
      if (!e.matches(sel)) continue;
      return { nome: typeof nome === 'function' ? nome(e, titulo) : nome,
        desc: typeof desc === 'function' ? desc(e, titulo) : desc };
    }
    const t = (titulo || e.getAttribute('aria-label') || '').trim();
    return t ? { nome: '', desc: t } : null;
  }
  function guardarTitulo(e) {
    if (e.hasAttribute('title')) { e.dataset.tituloIcone = e.getAttribute('title'); e.setAttribute('title', ''); }
  }
  function devolverTitulo(e) {
    if (e.dataset.tituloIcone === undefined) return;
    // o app pode ter trocado a dica enquanto o mouse estava em cima: a nova ganha da guardada
    if (!e.getAttribute('title')) e.setAttribute('title', e.dataset.tituloIcone);
    delete e.dataset.tituloIcone;
  }
  function mostrar(e) {
    const d = dicaDe(e, e.dataset.tituloIcone !== undefined ? e.dataset.tituloIcone : e.getAttribute('title'));
    if (!d || (!d.nome && !d.desc)) return;
    if (!caixa) {
      caixa = document.createElement('div');
      caixa.id = 'dicaIcone'; caixa.className = 'dica dica-icone'; caixa.setAttribute('role', 'tooltip');
      caixa.innerHTML = '<b></b><span></span>';
      document.body.appendChild(caixa);
    }
    caixa.firstChild.textContent = d.nome || '';
    caixa.lastChild.textContent = d.desc || '';
    caixa.classList.toggle('so-nome', !d.desc);
    caixa.classList.toggle('so-desc', !d.nome);
    caixa.classList.remove('on');
    caixa.style.left = '0px'; caixa.style.top = '0px';
    // mede no tamanho final: centrada embaixo do ícone; sem espaço embaixo, em cima
    const r = e.getBoundingClientRect(), b = caixa.getBoundingClientRect(), m = 8;
    const x = Math.max(m, Math.min(r.left + r.width / 2 - b.width / 2, innerWidth - b.width - m));
    let y = r.bottom + 6;
    if (y + b.height > innerHeight - m) y = Math.max(m, r.top - b.height - 6);
    caixa.style.left = Math.round(x) + 'px'; caixa.style.top = Math.round(y) + 'px';
    e.setAttribute('aria-describedby', 'dicaIcone');
    requestAnimationFrame(() => caixa && el === e && caixa.classList.add('on'));
  }
  function soltar() {
    clearTimeout(timer); timer = 0;
    if (caixa) caixa.classList.remove('on');
    if (el) { devolverTitulo(el); el.removeAttribute('aria-describedby'); }
    el = null;
  }
  document.addEventListener('mouseover', (ev) => {
    const alvo = ev.target.closest && ev.target.closest(ALVO);
    if (alvo === el) return;
    soltar();
    if (!alvo || alvo.matches(NUNCA) || alvo.disabled || !soIcone(alvo)) return;
    el = alvo;
    guardarTitulo(alvo);   // já agora: senão o balão nativo do Mac aparece antes da janelinha
    timer = setTimeout(() => { timer = 0; if (el === alvo && alvo.isConnected) mostrar(alvo); }, ESPERA);
  });
  document.addEventListener('mouseout', (ev) => {
    if (el && !(ev.relatedTarget && el.contains(ev.relatedTarget))) soltar();
  });
  // clicou, rolou, digitou ou saiu da janela: a dica some na hora
  for (const tipo of ['mousedown', 'wheel', 'keydown']) document.addEventListener(tipo, soltar, true);
  window.addEventListener('blur', soltar);
  window.dicaIcone = { DICAS_ICONE, dicaDe, soIcone };
})();
