/* Só o telefone: instalação, teclado, rascunhos e atualização do histórico do Mac.
   Não grava o config do desktop e não liga nenhum motor para ler uma conversa. */
(function () {
  if (!window.SEM_ELECTRON) return;
  let pronto = false, atualizando = false;
  let reabrindo = false;
  let relogio = 0;
  const selos = new WeakMap();
  const chaveRascunhos = 'cockpit:rascunhos';
  const chaveConversa = 'cockpit:ultima-conversa';
  /* Guardar em localStorage, e não em sessionStorage: o iPhone joga a gaveta de sessão fora
     quando o app fecha ou quando o iOS o descarta da memória (acontece direto com app na Tela
     de Início), e o texto que ele estava escrevendo sumia. Junto vai o carimbo da hora, pra
     rascunho de ontem não ressuscitar amanhã. */
  const VALIDADE = 24 * 60 * 60 * 1000;   // passou de um dia, não volta mais
  const TETO = 512 * 1024;                // meio mega: a gaveta do navegador é pequena
  const sessao = P => P.sessaoId || P.resumeId || '';

  const vv = window.visualViewport;
  let remedida = 0;

  /* Quanto do app o iPhone mostra de verdade AGORA. Com o teclado aberto a janela visível
     encolhe (height) e às vezes ainda desce um pouco (offsetTop): somando os dois, o fim do
     app cai exatamente em cima do teclado, nunca por baixo dele. */
  function medida() { return vv ? Math.round(vv.height + vv.offsetTop) : innerHeight; }

  function altura() {
    /* Ele deu zoom com os dedos: não mexer na tela enquanto isso. A folga de 5% existe porque
       o iOS dá um micro-zoom sozinho no campo em foco — exigir zoom exato (scale !== 1)
       congelava a altura bem na hora em que o teclado abria. */
    if (vv && vv.scale > 1.05) return;
    document.documentElement.style.setProperty('--altura-app', medida() + 'px');
    /* O iOS rola a página inteira para revelar o campo em foco. Como o app encolheu no mesmo
       instante, essa rolagem sobra e leva a barra de escrever para cima do relógio. Voltar ao
       topo devolve a barra para o rodapé, colada no teclado. */
    if (window.scrollY || window.pageYOffset) window.scrollTo(0, 0);
  }

  /* Mede agora e mede DE NOVO quando a animação do teclado termina (~350ms). Sem a segunda
     medida a altura fica gravada no meio do movimento e sobra uma faixa preta morta no
     rodapé. Serve também para girar o aparelho, que o iPhone só acerta no fim do giro. */
  function alturaDeNovo() { altura(); clearTimeout(remedida); remedida = setTimeout(altura, 350); }

  altura();
  vv?.addEventListener('resize', alturaDeNovo);
  vv?.addEventListener('scroll', altura);          // a rolagem do iOS avisa aqui, não no resize
  window.addEventListener('resize', alturaDeNovo);
  window.addEventListener('orientationchange', alturaDeNovo);
  window.addEventListener('pageshow', alturaDeNovo);
  document.addEventListener('focusin', alturaDeNovo);   // tocou no campo: o teclado vem aí
  // voltou do WhatsApp ou de outra aba: o iPhone às vezes devolve a tela com a medida velha
  document.addEventListener('visibilitychange', () => { if (!document.hidden) alturaDeNovo(); });

  function mostrarConversa() {
    requestAnimationFrame(() => {
      if (!focusPane || !matchMedia('(max-width: 820px), (pointer: coarse) and (max-width: 1100px)').matches) return;
      const corpo = abaDe(focusPane)?.corpoEl;
      if (!corpo) return;
      const deslocamento = focusPane.el.getBoundingClientRect().left - corpo.getBoundingClientRect().left;
      corpo.scrollTo({ left: corpo.scrollLeft + deslocamento, behavior: 'instant' });
      if (pronto && !reabrindo) guardarConversa();
    });
  }
  window.addEventListener('cockpit:foco', mostrarConversa);

  function guardarConversa() {
    if (!pronto || reabrindo || !focusPane) return;
    const P = focusPane;
    try {
      if (sessao(P)) localStorage.setItem(chaveConversa, JSON.stringify({
        id: sessao(P), engine: P.engine, cwd: P.cwd, file: P.sessaoFile || '', title: P.titulo || '', remoto: NA_VPS(P.cwd),
        em: Date.now(),
      }));
      else localStorage.removeItem(chaveConversa);
    } catch {}
  }

  function guardarRascunhos() {
    clearTimeout(relogio);
    if (!pronto || reabrindo) return;
    guardarConversa();
    const agora = Date.now();
    const itens = [...panes.values()].map((P, indice) => ({
      engine: P.engine, cwd: P.cwd, sessao: sessao(P), file: P.sessaoFile || '', indice,
      texto: P.el.querySelector('.p-input')?.value || '',
      // o anexo vai SEM a miniatura: ela é a imagem inteira em base64 e sozinha entope a gaveta
      anexos: (P.anexos || []).map(({ mini, ...resto }) => resto),
      em: agora,
    })).filter(x => x.texto || x.anexos.length);
    // se mesmo assim não couber, o que cai é o rascunho dos outros painéis; o do foco fica
    const noFoco = focusPane ? [...panes.values()].indexOf(focusPane) : -1;
    itens.sort((a, b) => (b.indice === noFoco) - (a.indice === noFoco));
    while (itens.length > 1 && JSON.stringify(itens).length > TETO) itens.pop();
    try {
      if (itens.length) localStorage.setItem(chaveRascunhos, JSON.stringify(itens));
      else localStorage.removeItem(chaveRascunhos);   // nada escrito: não deixa lixo guardado
    } catch {}
  }
  async function reporRascunhos() {
    let itens = [];
    try { itens = JSON.parse(localStorage.getItem(chaveRascunhos) || '[]'); } catch {}
    if (!Array.isArray(itens)) itens = [];
    // rascunho de mais de um dia não volta, e ainda sai da gaveta pra não ocupar espaço à toa
    const vivos = itens.filter(x => x && typeof x.texto === 'string' && typeof x.cwd === 'string'
      && ['claude', 'codex', 'acp', 'gemini', 'grok'].includes(x.engine)
      && Date.now() - (Number(x.em) || 0) < VALIDADE);
    if (vivos.length !== itens.length) {
      try {
        if (vivos.length) localStorage.setItem(chaveRascunhos, JSON.stringify(vivos));
        else localStorage.removeItem(chaveRascunhos);
      } catch {}
    }
    const usados = new Set();
    for (const item of vivos) {
      let P = [...panes.values()].find((p, indice) => !usados.has(p) && item.engine === p.engine && item.cwd === p.cwd
        && (item.sessao ? item.sessao === sessao(p) : !sessao(p) && item.indice === indice));
      // Painéis criados no telefone não fazem parte do config do Mac. Sem recriar
      // esses painéis, seus rascunhos ficavam salvos, mas nunca voltavam à tela.
      if (!P) {
        if (item.sessao) {
          await openSession({ id: item.sessao, engine: item.engine, cwd: item.cwd,
            file: item.file || '', remoto: NA_VPS(item.cwd) });
          P = [...panes.values()].find(p => p.engine === item.engine && p.cwd === item.cwd && sessao(p) === item.sessao);
        } else P = newPane({ engine: item.engine, cwd: item.cwd, aba: abaDoCaminho(item.cwd, true) });
      }
      if (!P) continue;
      usados.add(P);
      const campo = P.el.querySelector('.p-input');
      if (!campo || campo.value) continue;
      campo.value = item.texto;
      campo.dispatchEvent(new Event('input', { bubbles: true }));
      if (Array.isArray(item.anexos) && item.anexos.length && !P.anexos.length) await anexar(P, item.anexos).catch(() => {});
    }
  }
  // não gravar a cada tecla: espera ele parar de digitar meio segundo
  function agendarRascunhos() { clearTimeout(relogio); relogio = setTimeout(guardarRascunhos, 500); }
  document.addEventListener('input', e => { if (e.target.matches('.p-input')) agendarRascunhos(); });
  /* Mandou a mensagem: o campo esvazia e o rascunho tem que sumir junto, senão o texto que
     ele JÁ enviou voltava sozinho na próxima abertura. Aqui o campo já está vazio, então
     gravar de novo é o que apaga. */
  document.addEventListener('click', e => { if (e.target.closest?.('.p-send')) setTimeout(guardarRascunhos, 0); });
  document.addEventListener('keydown', e => {
    // o ?. porque existe tecla disparada por codigo, e ai o alvo e o proprio documento
    if (e.key === 'Enter' && !e.shiftKey && e.target.matches?.('.p-input')) setTimeout(guardarRascunhos, 0);
  });
  // ele pula pro WhatsApp e o iPhone pode matar o app sem avisar: gravar na hora que esconde
  document.addEventListener('visibilitychange', () => { if (document.hidden) guardarRascunhos(); });
  window.addEventListener('pagehide', guardarRascunhos);
  window.addEventListener('cockpit:salvar-rascunhos', guardarRascunhos);

  async function atualizar() {
    if (!pronto || document.hidden || atualizando || document.body.classList.contains('sem-mac')) return;
    const P = focusPane;
    // Um painel com motor próprio recebe os eventos em tempo real. Nunca substituir
    // sua resposta por uma leitura parcial de disco, nem reiniciar esse motor.
    if (!P || P.busy || !sessao(P) || restaurando) return;
    const id = sessao(P), engine = P.engine;
    atualizando = true;
    try {
      if (P.started) {
        // R2-012: o painel acha que ainda esta rodando, mas pode ter dormido e perdido o
        // fim do turno (ou uma aprovacao) enquanto o WebSocket estava caido. Pergunta pro
        // Mac o estado real antes de desistir; sem isso a tela fica presa em "trabalhando…"
        // pra sempre. So LEITURA: nao mexe em nada, so decide se pode seguir abaixo.
        if (!window.api.paneEstado) return;
        const estado = await window.api.paneEstado({ paneId: P.id }).catch(() => null);
        if (!estado || estado.busy || P.busy || !panes.has(P.id) || focusPane !== P || sessao(P) !== id) return;
        if (estado.aprovacao) receberEventoPane({ paneId: P.id, kind: estado.aprovacao.tipo, ...estado.aprovacao.dados });
        // segue pra releitura do historico abaixo mesmo com P.started true: o Mac confirmou que acabou
      }
      const msgs = (engine === 'claude' && NA_VPS(P.cwd))
        ? await window.api.sessionHistoryRemoto({ id })
        : await window.api.sessionHistory({ engine, file: P.sessaoFile, id, cwd: P.cwd });
      if (P.busy || !panes.has(P.id) || sessao(P) !== id || P.engine !== engine || !Array.isArray(msgs) || !msgs.length) return;
      const selo = JSON.stringify(msgs);
      if (selos.get(P) === selo) return;
      const topo = P.chat.scrollTop;
      const noFim = P.chat.scrollHeight - topo - P.chat.clientHeight < 100;
      P.hist = []; P.blocks.clear(); P.tools.clear(); P.execEl = null; P.rolagem = null;
      P.chat.replaceChildren();
      for (const m of msgs) renderizarHistorico(P, m);
      selos.set(P, selo);
      if (noFim) scroll(P, true); else P.chat.scrollTop = topo;
    } catch { /* a ponte já mostra a conexão caída; preservar o histórico atual */ }
    finally { atualizando = false; }
  }

  function voltou() {
    if (!pronto || document.hidden) return;
    atualizar();
    for (const engine of ['claude', 'codex', 'acp', 'gemini', 'grok']) {
      if (lateralAberta(engine)) loadHist(engine, true).catch(() => {});
    }
  }
  window.addEventListener('cockpit:pronto', async () => {
    pronto = true; reabrindo = true;
    try {
      try {
        const ultima = JSON.parse(localStorage.getItem(chaveConversa) || 'null');
        if (ultima?.id && ultima.cwd && Date.now() - (Number(ultima.em) || 0) < VALIDADE
          && ['claude', 'codex', 'acp', 'gemini', 'grok'].includes(ultima.engine)) await openSession(ultima);
      } catch { /* rascunhos ainda voltam se só a última conversa ficou indisponível */ }
      const focoAnterior = focusPane;
      await reporRascunhos();
      if (focoAnterior && panes.get(focoAnterior.id) === focoAnterior) setFocus(focoAnterior);
    } catch { /* o histórico completo continua disponível na gaveta */ }
    finally { reabrindo = false; }
    mostrarConversa(); voltou();
  });
  window.addEventListener('cockpit:conectado', voltou);
  window.addEventListener('pageshow', voltou);
  document.addEventListener('visibilitychange', voltou);
  // Resposta terminada em outra tela: trazer do MESMO histórico. Sem cópia separada.
  window.api.onPaneEvent(ev => {
    if (!panes.has(ev.paneId) && ev.kind === 'turn-end') setTimeout(atualizar, 500);
  });

  const gaveta = document.getElementById('btnGaveta');
  new MutationObserver(() => gaveta?.setAttribute('aria-expanded', String(document.body.classList.contains('gaveta'))))
    .observe(document.body, { attributes: true, attributeFilter: ['class'] });
  const instalar = document.getElementById('btnInstalar');
  const dialogo = document.getElementById('instalarApp');
  const standalone = matchMedia('(display-mode: standalone)');
  function modoApp() { instalar.hidden = standalone.matches || navigator.standalone === true; }
  modoApp(); standalone.addEventListener('change', modoApp);
  instalar.addEventListener('click', () => dialogo.showModal());
  document.getElementById('fecharInstalar').addEventListener('click', () => dialogo.close());
})();
