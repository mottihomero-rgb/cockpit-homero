/* Ponte para o telefone: o mesmo window.api, só que falando por WebSocket com o Mac. */
(function () {
  window.SEM_ELECTRON = true;   // estamos no telefone, pelo navegador
  const pend = new Map();
  const ouvintes = Object.create(null);
  let seq = 0, ws = null, fila = [], religar = null;
  let jaConectou = false;

  function encerrarPedido(id, erro, resposta) {
    const p = pend.get(id);
    if (!p) return;
    pend.delete(id); clearTimeout(p.timer);
    fila = fila.filter(x => x.id !== id);
    erro ? p.rej(new Error(erro)) : p.res(resposta);
  }

  function ligar() {
    clearTimeout(religar);
    if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;
    ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
    const conexao = ws;
    ws.onopen = () => {
      if (ws !== conexao) return;
      document.body.classList.remove('sem-mac');
      const aguardando = fila; fila = [];
      aguardando.forEach(x => {
        if (!pend.has(x.id)) return;
        try { conexao.send(x.txt); }
        catch (_) { encerrarPedido(x.id, 'A conexão com o Mac caiu. Confira a conversa antes de enviar de novo.'); }
      });
      const reconectou = jaConectou; jaConectou = true;
      window.dispatchEvent(new CustomEvent('cockpit:conectado', { detail: { reconectou } }));
    };
    ws.onclose = (ev) => {
      if (ws !== conexao) return;
      document.body.classList.add('sem-mac');
      // Nunca repetir um envio que talvez já tenha chegado ao Mac.
      for (const id of [...pend.keys()]) encerrarPedido(id, 'A conexão com o Mac caiu. Confira a conversa antes de enviar de novo.');
      if (ev.code === 1008 && /sessao/.test(ev.reason || '')) {
        window.dispatchEvent(new CustomEvent('cockpit:salvar-rascunhos'));
        location.replace('/'); return;
      }
      religar = setTimeout(ligar, 1500);
    };
    ws.onmessage = (ev) => {
      if (ws !== conexao) return;
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (!m || typeof m !== 'object' || Array.isArray(m)) return;
      if (m.tipo === 'resposta') {
        encerrarPedido(m.id, m.erro, m.resposta);
      } else if (m.tipo === 'evento') {
        (ouvintes[m.canal] || []).slice().forEach(f => {
          try { f(m.dados); } catch (e) { console.error('[cockpit] erro ao mostrar evento do Mac:', e); }
        });
      }
    };
  }
  ligar();

  const chamar = (nome, arg) => new Promise((res, rej) => {
    const id = ++seq;
    const timer = setTimeout(() => encerrarPedido(id, 'O Mac não respondeu.'), 120000);
    pend.set(id, { res, rej, timer });
    try {
      const txt = JSON.stringify({ tipo: 'chamada', id, nome, arg });
      if (ws && ws.readyState === 1) ws.send(txt); else fila.push({ id, txt });
    } catch (e) { encerrarPedido(id, (e && e.message) || 'Não consegui enviar para o Mac.'); }
  });

  window.addEventListener('online', ligar);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) ligar(); });

  /* ---- escolher foto ou video pelo telefone ----
     O <input type="file"> e a unica janela de arquivo que o Safari abre. O que ele escolher sobe
     para o Mac, que grava em colados/ e devolve o caminho de la — e e esse caminho que a tela
     espera receber.
     Tres coisas quebravam no iPhone (video do dono, 19/09, quadros q101 a q107):
      1. so aparecia foto: com accept 'image/*' a Fototeca do iPhone ESCONDE os videos;
      2. o menu "Fototeca / Tirar Foto / Escolher Arquivo" abria no canto de CIMA da tela, longe
         do "+" que ele tocou, porque o input nascia com display:none colado no <body>;
      3. a pior: o app desistia 800ms depois de a janela receber 'focus' — e o 'focus' chega
         quando o TECLADO fecha, antes de a Fototeca sequer abrir. Ele passou 3 segundos
         escolhendo a foto e nao chegou nada. */

  const MB = 1024 * 1024;
  /* O cano do WebSocket leva 8 MB por mensagem e virar texto (data URL) engorda o arquivo em
     1/3: passando disso a conexao com o Mac CAI em vez de dar erro. So vale para o cano antigo. */
  const TETO_CANO_ANTIGO = 5 * MB;
  let temUpload = null;   // o Mac ja tem a rota /upload? null = ainda nao sei

  // qual painel esta em foco agora. So leitura: quem manda nele e o app.js.
  function painelEmFoco() {
    try { return (typeof focusPane !== 'undefined' && focusPane) || null; } catch (_) { return null; }
  }

  /* Cano novo: POST /upload grava o arquivo direto em colados/, sem virar texto. E o unico que
     aguenta video. Devolve SEM_ROTA quando este Mac ainda nao tem a rota, e null quando a
     tentativa em si falhou (rede, resposta estranha) — os dois caem no cano antigo, mas so o
     primeiro vale para a sessao inteira. */
  const SEM_ROTA = { semRota: true };
  async function mandarPeloUpload(f) {
    const nome = f.name || 'anexo';
    let r;
    try {
      r = await fetch('/upload?nome=' + encodeURIComponent(nome), {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': f.type || 'application/octet-stream', 'X-Nome': encodeURIComponent(nome) },
        body: f,
      });
    } catch (_) { return null; }
    if (r.status === 404 || r.status === 405 || r.status === 501) return SEM_ROTA;
    let j = null;
    try { j = await r.json(); } catch (_) { return null; }
    const caminho = j && (j.arquivo || j.caminho || j.path);
    if (r.ok && caminho) return { arquivo: String(caminho) };
    return { error: (j && (j.error || j.erro)) || ('o Mac respondeu ' + r.status) };
  }

  /* Cano antigo: o arquivo vira texto (data URL) e sobe pelo MESMO WebSocket da camera. So serve
     para imagem pequena — o Mac recusa o que nao for png/jpg/webp — e fica de reserva enquanto
     o servidor do Mac nao tiver a rota /upload. */
  async function mandarPeloWebSocket(f) {
    if (/^video\//.test(f.type || '')) {
      return { error: 'Mandar vídeo daqui só funciona com o Cockpit do Mac atualizado. Reinicie o Cockpit no Mac e tente de novo.' };
    }
    if (f.size > TETO_CANO_ANTIGO) {
      return { error: 'Este arquivo tem ' + Math.round(f.size / MB) + ' MB e por aqui só passam 5 MB. Reinicie o Cockpit no Mac para mandar arquivo grande.' };
    }
    const dados = await new Promise((ok, nao) => {
      const fr = new FileReader();
      fr.onload = () => ok(String(fr.result || ''));
      fr.onerror = () => nao(new Error('nao consegui abrir o arquivo'));
      fr.readAsDataURL(f);
    });
    return (await chamar('imagem:salvar', { dados, prefixo: 'anexo' })) || { error: 'erro' };
  }

  async function mandarProMac(f) {
    if (temUpload !== false) {
      const r = await mandarPeloUpload(f);
      if (r === SEM_ROTA) temUpload = false;         // este Mac nao tem a rota: nao insiste mais
      else if (r) { temUpload = true; return r; }    // respondeu: a resposta dela e que vale
      // r === null: so esta tentativa falhou. O cano antigo assume desta vez, e na proxima
      // foto a gente tenta o /upload de novo.
    }
    return mandarPeloWebSocket(f);
  }

  function escolherArquivo() {
    return new Promise((res) => {
      const P = painelEmFoco();   // guardado AGORA: se a escolha demorar, ainda sei onde anexar
      const caixa = (P && P.el && P.el.querySelector('.pane-cmp'))
        || document.querySelector('.pane.focus .pane-cmp')
        || document.querySelector('.pane-cmp')
        || document.body;

      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = 'image/*,video/*';   // sem o video/* a Fototeca do iPhone esconde os videos
      /* Invisivel, de 1px, e DENTRO da caixa de escrever: assim o iPhone abre o menu junto do "+"
         que ele tocou, em vez do canto de cima. A .pane-cmp ja e position:relative (style.css),
         entao este input nao empurra nada nem faz a fileira de botoes rolar. */
      inp.style.cssText = 'position:absolute;left:10px;bottom:8px;width:1px;height:1px;'
        + 'opacity:0;border:0;padding:0;pointer-events:none';
      caixa.appendChild(inp);

      let respondeu = false, escolheu = false, desistir = null, folga = null;
      const responder = (v) => { if (!respondeu) { respondeu = true; res(v); } };
      const limpar = () => {
        clearTimeout(desistir); clearTimeout(folga);
        document.removeEventListener('visibilitychange', aoVoltar);
        try { inp.remove(); } catch (_) {}
      };
      /* Quem avisa que ele voltou da Fototeca e o visibilitychange, nao o 'focus': o 'focus'
         chega quando o teclado fecha, com a galeria ainda nem aberta. A folga de 2,5 s e porque
         no iPhone o 'change' chega logo DEPOIS de a pagina reaparecer. */
      function aoVoltar() {
        if (document.hidden) return;        // a pagina sumiu: e agora que ele esta escolhendo
        clearTimeout(folga);
        folga = setTimeout(() => { if (!escolheu) { limpar(); responder([]); } }, 2500);
      }

      inp.addEventListener('change', async () => {
        escolheu = true;
        const f = inp.files && inp.files[0];
        limpar();
        if (!f) return responder([]);
        let r;
        try { r = await mandarProMac(f); }
        catch (e) { r = { error: (e && e.message) || 'erro' }; }
        const caminho = r && r.arquivo;
        if (!caminho) { alert('Não consegui mandar para o Mac: ' + ((r && r.error) || 'erro')); return responder([]); }
        if (!respondeu) return responder([caminho]);
        /* Chegou atrasado: quem ia anexar ja desistiu. Em vez de jogar o arquivo fora (foi isso
           que aconteceu no video dele), anexa direto no painel guardado la em cima. */
        try { await window.anexar(P, [caminho]); }
        catch (_) { alert('Mandei pro Mac, mas não consegui anexar. O arquivo está em: ' + caminho); }
      });

      /* Cancelar o seletor nem sempre avisa: sem estas tres redes a promessa ficaria pendurada
         pra sempre e o menu do + nunca terminaria. So valem se ele nao escolheu nada. */
      inp.addEventListener('cancel', () => { if (!escolheu) { limpar(); responder([]); } });
      document.addEventListener('visibilitychange', aoVoltar);
      desistir = setTimeout(() => { if (!escolheu) { limpar(); responder([]); } }, 120000);
      inp.click();
    });
  }

  /* Ajustes no telefone: agora GRAVAM de verdade — so que no proprio celular.
     Quem manda no config do Mac continua sendo o Mac: o app.js e o MESMO arquivo nos dois e ele
     grava o config INTEIRO de uma vez, entao um Safari aberto desde ontem escrevia o retrato de
     ontem por cima e as abas do Mac sumiam. So que, do jeito que estava, o toque mentia: tema,
     mostrar robos, favoritar conversa, recolher grupo — tudo voltava ao recarregar. Daqui pra
     frente estas preferencias ficam guardadas no proprio celular, e o getConfig as poe por cima
     do que veio do Mac.
     As abas (abas, abaAberta, panes, grupos) ficam de fora DE PROPOSITO: essas sao so do Mac.
     Criou preferencia nova no app.js? Ponha o nome dela aqui, senao o telefone volta a esquecer. */
  const AJUSTES_DO_TELEFONE = [
    'tema', 'verRobos', 'foco', 'envioPadrao', 'defMode', 'lastEngine', 'cameraPreferida',
    'favoritos', 'gruposConversa', 'grupoSessao', 'gruposRecolhidos',
    'porPasta', 'usoSkills', 'prompts',
  ];
  const GAVETA = 'cockpit:ajustes-do-telefone';
  let comoOMacEstava = {};   // as preferencias como o Mac mandou no ultimo config:get

  const mesmoValor = (a, b) =>
    JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);
  // copia de verdade: a tela mexe nas listas por dentro (splice/push), e sem copiar o retrato
  // do Mac mudaria junto — ai nunca daria pra saber o que foi o telefone que trocou.
  const copiar = (v) => (v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v);

  function lerGaveta() {
    try {
      const valor = JSON.parse(window.localStorage.getItem(GAVETA) || '{}');
      return valor && typeof valor === 'object' && !Array.isArray(valor) ? valor : {};
    } catch (_) { return {}; }
  }
  function gravarGaveta(g) {
    try { window.localStorage.setItem(GAVETA, JSON.stringify(g)); return; } catch (_) {}
    /* celular sem espaco (ou Safari anonimo): o historico do "/" e o que mais cresce e o que
       menos faz falta. Sem ele, tema e favoritos continuam sendo guardados. */
    try { delete g.prompts; window.localStorage.setItem(GAVETA, JSON.stringify(g)); } catch (_) {}
  }

  async function lerConfig() {
    const doMac = (await chamar('config:get')) || {};
    comoOMacEstava = {};
    for (const k of AJUSTES_DO_TELEFONE) if (doMac[k] !== undefined) comoOMacEstava[k] = copiar(doMac[k]);
    const g = lerGaveta();
    let limpou = false;
    for (const k of Object.keys(g)) {
      const meuAjuste = g[k];
      const vale = AJUSTES_DO_TELEFONE.includes(k) && meuAjuste && typeof meuAjuste === 'object'
        && Object.prototype.hasOwnProperty.call(meuAjuste, 'meu')
        // o Mac mexeu nesta preferencia depois de mim: quem manda e o Mac, minha copia vai fora
        && mesmoValor(doMac[k], meuAjuste.base);
      if (!vale) { delete g[k]; limpou = true; continue; }
      doMac[k] = meuAjuste.meu;
    }
    if (limpou) gravarGaveta(g);
    return doMac;
  }

  function guardarConfig(cfg) {
    const g = lerGaveta();
    for (const k of AJUSTES_DO_TELEFONE) {
      const meu = cfg ? cfg[k] : undefined;
      // igual ao que o Mac ja tem: nao ha o que guardar aqui
      if (meu === undefined || mesmoValor(meu, comoOMacEstava[k])) delete g[k];
      else g[k] = { meu, base: comoOMacEstava[k] === undefined ? null : comoOMacEstava[k] };
    }
    gravarGaveta(g);
    return Promise.resolve(true);
  }

  window.api = {
    getConfig: () => lerConfig(),
    // Guarda so aqui no celular, nas chaves de AJUSTES_DO_TELEFONE la de cima. Nada sobe pro
    // Mac: quem manda nas abas do Mac e o Mac.
    setConfig: (cfg) => guardarConfig(cfg),
    home: () => chamar('sys:home'),
    // no telefone estas tres nao existem: quem abre janela do sistema e o Mac. Responder na
    // hora evita o toque ficar 2 minutos esperando uma resposta que nunca vem.
    pickFolder: () => { alert('No iPhone use o campo de caminho ou os atalhos: a janela de pastas só abre no Mac.'); return Promise.resolve(null); },
    listDir: (d) => chamar('fs:list', d),
    readFile: (f) => chamar('fs:read', f),
    openPath: (p) => chamar('shell:open', p),
    abrirLink: (u) => { window.open(u, '_blank'); return Promise.resolve(); },
    paneStart: (o) => chamar('pane:start', o),
    paneSend: (o) => chamar('pane:send', o),
    paneRespond: (o) => chamar('pane:respond', o),
    paneSettings: (o) => chamar('pane:settings', o),
    paneSteer: (o) => chamar('pane:steer', o),
    paneCompactar: (o) => chamar('pane:compactar', o),
    paneInterrupt: (o) => chamar('pane:interrupt', o),
    paneStop: (o) => chamar('pane:stop', o),
    approve: (o) => chamar('pane:approve', o),
    // so leitura: o celular usa isso pra saber se perdeu evento enquanto estava dormindo (R2-012)
    paneEstado: (o) => chamar('pane:estado', o),
    codexModels: () => chamar('codex:models'),
    codexApiStatus: () => chamar('codex:api-status'),
    codexApiKey: () => Promise.resolve({ error: 'Guarde a chave pelo Mac.' }),
    codexApiTest: () => Promise.resolve({ error: 'Teste a chave pelo Mac.' }),
    codexApiConfig: () => Promise.resolve({ error: 'Altere o uso por créditos pelo Mac.' }),
    sessionsClaude: (r) => chamar('sessions:claude', r),
    sessionsCodex: (r) => chamar('sessions:codex', r),
    /* R2: o app.js e o MESMO arquivo nos dois. Sem estas duas linhas, abrir a coluna do
       ACP no iPhone morria num TypeError e derrubava o boot da tela inteira. */
    sessionsCli: (engine) => chamar('sessions:cli', engine),
    sessionsAcp: () => chamar('sessions:acp'),
    acpConfig: (o) => chamar('acp:config', o),
    sessionHistory: (o) => chamar('sessions:history', o),
    sessionTitulo: (o) => chamar('sessions:titulo', o),
    buscarConversas: (o) => chamar('sessions:buscar', o),
    renomear: (o) => chamar('sessao:renomear', o),
    nomeCurto: (o) => chamar('sessao:nomeCurto', o),
    /* Apagar conversa manda arquivo do Mac para a Lixeira: o main nem expoe o canal ao Wi-Fi, e
       aqui a resposta sai na hora, com o tipo certo, para o toque nao ficar 2 minutos esperando.
       Sem esta linha o app.js (o MESMO arquivo nos dois) morreria num TypeError. */
    apagarSessao: () => Promise.resolve({ error: 'Apagar conversa só funciona no Mac.' }),
    // ramificar de verdade é só criar conversa nova: vai pelo mesmo cano
    sessaoFork: (o) => chamar('sessao:fork', o),
    skills: (e) => chamar('skills:list', e),
    /* prompts salvos e busca de arquivo do "@": os dois moram no Mac e vem pelo mesmo cano.
       Sem estas duas linhas o menu "/" do telefone morria inteiro num TypeError — o app.js e
       o MESMO arquivo nos dois, e o catch de dentro nao segura erro sincrono. */
    promptsLer: () => chamar('prompts:ler'),
    promptsSalvar: (l) => chamar('prompts:salvar', l),
    buscarArquivos: (o) => chamar('fs:buscarArquivos', o),
    /* Os tres itens do menu Anexar caiam aqui e nao faziam NADA: o menu fechava e pronto.
       Agora 'Enviar foto ou vídeo' abre a Fototeca do proprio celular de verdade. Arquivo comum
       e pasta nao tem cano ate o Mac, e nem aparecem mais no menu do telefone: se alguem cair
       aqui assim mesmo, ouve o porque em vez de o toque morrer calado. */
    pickFiles: (tipo) => {
      if (tipo === 'image') return escolherArquivo();
      alert(tipo === 'folder'
        ? 'No iPhone escreva o caminho da pasta na mensagem: a janela de pastas só abre no Mac.'
        : 'No iPhone dá para anexar foto e vídeo (use "Enviar foto ou vídeo" ou "Fotografar"). Outro tipo de arquivo, só pelo Mac.');
      return Promise.resolve([]);
    },
    pickPhoto: () => Promise.resolve(null),
    // erro interno do processo principal so chega na janela do Mac; aqui e so pra a tela
    // nao ter de checar se a funcao existe
    onErroApp: () => {},
    anexoLer: (f) => chamar('anexo:ler', f),
    colados: () => Promise.resolve({ arquivos: [] }),
    // foto tirada no telefone tambem vira arquivo: quem grava e o Mac, no mesmo colados/
    imagemSalvar: (o) => chamar('imagem:salvar', o),
    /* Recortar a tela esconde a janela do MAC e abre uma tela preta por cima de tudo la. Um
       toque aqui deixaria isso preso a quilometros de distancia: o main nem expoe o canal, e
       aqui a resposta sai na hora com o tipo certo. O item nem aparece no menu do telefone. */
    recortarTela: () => Promise.resolve({ error: 'Recortar a tela só funciona no Mac.' }),
    // este é só leitura: quem passa a Vision na imagem é o Mac, e o texto volta pelo mesmo cano
    ocrLer: (o) => chamar('ocr:ler', o),
    // o quadro branco funciona no iPhone/iPad igual ao Mac: quem grava o PNG e o JSON e o Mac
    quadroSalvar: (o) => chamar('quadro:salvar', o),
    quadroRascunhoGravar: (o) => chamar('quadro:rascunhoGravar', o),
    quadroRascunhoLer: () => chamar('quadro:rascunhoLer'),
    verArquivo: (f) => chamar('arquivo:ver', f),
    // quem fala com a VPS e sempre o Mac: aqui e so o mesmo cano de pedido
    verArquivoVps: (f) => chamar('arquivo:verVps', f),
    sessionsClaudeRemoto: (r) => chamar('sessions:claudeRemoto', r),
    sessionHistoryRemoto: (o) => chamar('sessions:historyRemoto', o),
    termLinhaShell: (cwd) => chamar('term:linhaShell', cwd),
    contaLer: (e) => chamar('conta:ler', e),
    usoLer: (e) => chamar('uso:ler', e),
    /* Trocar a conta do Mac por um toque no telefone é exatamente o que não pode acontecer: o
       main já barra os cinco, e aqui a resposta sai na hora, com o tipo certo, para o menu não
       ficar 2 minutos esperando. Sem estas linhas o app.js (o MESMO arquivo nos dois) morreria
       num TypeError e derrubaria o boot do celular. */
    contasListar: () => Promise.resolve([]),
    contasDisponivel: () => Promise.resolve({ ok: false, motivo: 'Trocar de conta só funciona no Mac.' }),
    contasSalvar: () => Promise.resolve({ error: 'Guarde a conta pelo Mac.' }),
    contasTrocar: () => Promise.resolve({ error: 'Trocar de conta só funciona no Mac.' }),
    contasEsquecer: () => Promise.resolve({ error: 'Esqueça a conta pelo Mac.' }),
    codexReiniciar: () => Promise.resolve({ error: 'Reiniciar o Codex só funciona no Mac.' }),
    // este é só leitura: o telefone pode ver os Apps da conta igual ao Mac
    codexApps: () => chamar('codex:apps'),
    /* leva 10: as tres sao leitura pura e vao pelo mesmo cano do Wi-Fi. A Torre no telefone
       mostra os mesmos chats do Mac, e o chip do git some sozinho em pasta sem repositorio. */
    agentesClaude: () => chamar('agentes:claude'),
    gitStatus: (o) => chamar('git:status', o),
    gitDiff: (o) => chamar('git:diff', o),
    motoresVersoes: () => chamar('motores:versoes'),
    motoresDisponiveis: () => chamar('motores:disponiveis'),
    /* leva 11: no telefone ele VÊ quais robôs do Mac pararam (é leitura, vai pelo mesmo cano),
       mas não dispara nenhum — o main nem expõe esse canal ao Wi-Fi (R1). A resposta sai aqui
       na hora, com o tipo certo, senão o app.js (que é o MESMO arquivo nos dois) morreria num
       TypeError e derrubaria o boot do celular. */
    rotinasListar: () => chamar('rotinas:listar'),
    rotinasDisparar: () => Promise.resolve({ error: 'Disparar uma rotina só funciona no Mac.' }),
    mcpList: (e) => chamar('mcp:list', e),
    mcpAcao: (o) => chamar('mcp:acao', o),
    auth: (o) => chamar('auth:acao', o),
    // terminal
    termRun: (o) => chamar('term:run', o),
    termInput: (o) => chamar('term:input', o),
    termResize: (o) => chamar('term:resize', o),
    termKill: (o) => chamar('term:kill', o),
    onTermEvent: (cb) => { (ouvintes['term:event'] = ouvintes['term:event'] || []).push(cb); },
    // quem mostra aviso do sistema e' o Mac. Responder aqui na hora evita o TypeError que
    // derruba o boot do telefone (o app.js e' o MESMO arquivo nos dois).
    avisarAgente: () => Promise.resolve({ ok: false }),
    // o irmao dele: o "terminou" que a tela dispara no fim de TODA resposta. Sem esta linha o
    // telefone morria num TypeError bem no fim do turno, e o que vem depois nunca rodava: o
    // "trabalhando" nao saia, a bolinha verde nao acendia e a mensagem da fila nao ia embora.
    avisarPronto: () => Promise.resolve({ ok: false }),
    // atalho global é do teclado do MAC: o telefone não liga nem desliga isso. Responder aqui
    // na hora evita o TypeError que derrubaria o boot (o app.js é o MESMO arquivo nos dois).
    atalhosEstado: () => Promise.resolve({ falhos: [] }),
    atalhosLigar: () => Promise.resolve({ falhos: [] }),
    /* Caixa de entrada: a pasta e os arquivos moram no MAC, e o main nem expõe os três canais
       ao Wi-Fi (R1). Aqui as respostas saem na hora, com o tipo certo, para o app.js — que é o
       MESMO arquivo nos dois — não morrer num TypeError e derrubar o boot do telefone.
       O onInbox existe e não faz nada: aviso de arquivo que está no Mac não serve aqui. */
    inboxConsumir: () => Promise.resolve({ error: 'A caixa de entrada é do Mac.' }),
    inboxPasta: () => Promise.resolve(null),
    inboxOuvindo: () => Promise.resolve({ ok: false }),
    onInbox: () => {},
    /* leva 12: estas oito a tela chama e aqui nao existiam. Cada uma derrubava o telefone num
       TypeError no meio da tarefa (o app.js e o MESMO arquivo nos dois). As tres de baixo sao
       trabalho de arquivo e de leitura, e o main ja as serve pelo Wi-Fi: vao pelo mesmo cano,
       quem faz e o Mac. As de baixo delas ficam so aqui mesmo. */
    desfazerEdicao: (o) => chamar('arquivo:desfazer', o),
    salvarNoVault: (o) => chamar('vault:salvar', o),
    configClaude: () => chamar('config:claude'),
    // ditar: o celular grava pelo microfone DELE e o Mac so passa o texto a limpo, igual ao ocrLer
    ditar: (o) => chamar('voz:transcrever', o),
    /* ja o ditado AO VIVO escuta o microfone DO MAC: por Wi-Fi isso abriria o microfone de casa
       a distancia. Respondendo 'ok: false' a tela cai sozinha no ditado normal, que funciona aqui. */
    vozVivo: () => Promise.resolve({ ok: false }),
    vozParar: () => Promise.resolve({ ok: true }),
    // puxar a aba aberta e ler o navegador DO MAC; do celular so daria a aba que ficou la
    abaDoNavegador: () => Promise.resolve({ error: 'Puxar a aba do navegador só funciona no Mac.' }),
    // aviso de motor atualizado o Mac manda so pra janela dele: aqui fica quieto, como o onMenu
    onMotorAtualizado: () => {},
    /* copiar: no Mac quem copia e o processo principal, porque dentro do app o clipboard do
       navegador as vezes e barrado. No telefone e o contrario — o clipboard que serve e o do
       proprio celular. Se o navegador barrar, o app.js ja tem a segunda tentativa dele. */
    copiar: (t) => (navigator.clipboard
      ? navigator.clipboard.writeText(String(t == null ? '' : t))
      : Promise.reject(new Error('o navegador nao deixa copiar aqui'))),
    // no telefone nao faz sentido mexer no servidor nem abrir janela do Mac
    webEstado: () => Promise.resolve({ ligado: true, endereco: location.origin, senha: '' }),
    webLigar: () => Promise.resolve({ ligado: true, endereco: location.origin, senha: '' }),
    openUrl: (u) => { window.open(u, '_blank'); return Promise.resolve(); },
    onPaneEvent: (cb) => { (ouvintes['pane:event'] = ouvintes['pane:event'] || []).push(cb); },
    onCodexEvent: (cb) => { (ouvintes['codex:event'] = ouvintes['codex:event'] || []).push(cb); },
    onMenu: () => {},
  };

  /* ---- rede de seguranca: nunca mais travar por falta de uma funcao ----
     O app.js e o MESMO arquivo no Mac e no telefone. Toda vez que alguem cria uma funcao nova
     la e esquece de acrescentar aqui, o telefone morre num TypeError NO MEIO de uma tarefa, e
     tudo que vinha depois naquela linha nao acontece. Foi assim que o chat ficou preso em
     "trabalhando" pra sempre. Daqui pra frente, funcao que faltar responde "nao deu" e a tela
     segue viva em vez de quebrar.
     Dois cuidados: 'then' fica de fora, senao o window.api passaria por promessa e travaria
     quem esperasse por ele; e a tela as vezes PERGUNTA se a funcao existe para decidir o que
     mostrar no telefone (if (window.api.vozVivo)) — a partir daqui a resposta e sempre sim,
     entao funcao nova que o telefone NAO deve ter e melhor declarar la em cima, respondendo
     'ok: false', do que deixar cair aqui. */
  const FORA_DA_REDE = new Set(['then', 'catch', 'finally', 'toJSON']);
  window.api = new Proxy(window.api, {
    get(alvo, nome) {
      if (typeof nome !== 'string' || nome in alvo) return alvo[nome];
      if (FORA_DA_REDE.has(nome) || !/^[a-z][A-Za-z0-9_]*$/.test(nome)) return undefined;
      console.warn('[cockpit] o web.js nao tem "' + nome + '": respondendo que so funciona no Mac.');
      return () => Promise.resolve({ ok: false, error: 'Isto só funciona no Mac.' });
    },
  });
})();
