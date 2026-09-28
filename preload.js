const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  // `origem` diz de onde veio a gravacao. So o fechar de aba feito por ele manda
  // { fechou: true }; sem isso o Mac nao deixa a gravacao diminuir a lista de abas.
  setConfig: (c, origem) => ipcRenderer.invoke('config:set', c, origem),
  home: () => ipcRenderer.invoke('sys:home'),
  pessoal: () => ipcRenderer.invoke('sys:pessoal'),

  pickFolder: (start) => ipcRenderer.invoke('dialog:pickFolder', start),
  listDir: (d) => ipcRenderer.invoke('fs:list', d),
  readFile: (f) => ipcRenderer.invoke('fs:read', f),
  openPath: (p) => ipcRenderer.invoke('shell:open', p),
  abrirLink: (u) => ipcRenderer.invoke('shell:link', u),
  openUrl: (u) => ipcRenderer.invoke('shell:openUrl', u),

  paneStart: (o) => ipcRenderer.invoke('pane:start', o),
  paneSend: (o) => ipcRenderer.invoke('pane:send', o),
  paneRespond: (o) => ipcRenderer.invoke('pane:respond', o),
  // 26/09: janelinha de perguntas do Claude e o plano pronto do modo Plano
  panePerguntas: (o) => ipcRenderer.invoke('pane:perguntas', o),
  panePlano: (o) => ipcRenderer.invoke('pane:plano', o),
  // 26/09: tempo total de trabalho de uma conversa (lido do arquivo dela)
  sessionTempo: (o) => ipcRenderer.invoke('sessions:tempo', o),
  paneSettings: (o) => ipcRenderer.invoke('pane:settings', o),
  paneInterrupt: (o) => ipcRenderer.invoke('pane:interrupt', o),
  paneSteer: (o) => ipcRenderer.invoke('pane:steer', o),
  paneCompactar: (o) => ipcRenderer.invoke('pane:compactar', o),
  paneStop: (o) => ipcRenderer.invoke('pane:stop', o),
  approve: (o) => ipcRenderer.invoke('pane:approve', o),
  // so leitura: o celular usa isso pra saber se perdeu evento enquanto estava dormindo (R2-012)
  paneEstado: (o) => ipcRenderer.invoke('pane:estado', o),
  codexModels: () => ipcRenderer.invoke('codex:models'),
  codexApiStatus: () => ipcRenderer.invoke('codex:api-status'),
  codexApiKey: (chave) => ipcRenderer.invoke('codex:api-key:set', chave),
  codexApiTest: () => ipcRenderer.invoke('codex:api-test'),
  codexApiConfig: (o) => ipcRenderer.invoke('codex:api-config:set', o),
  sessionsClaude: (r) => ipcRenderer.invoke('sessions:claude', r),
  sessionsCodex: (r) => ipcRenderer.invoke('sessions:codex', r),
  // leva 12: as conversas do motor ACP (o JSONL que o proprio Cockpit anota por sessao)
  sessionsCli: (engine) => ipcRenderer.invoke('sessions:cli', engine),
  sessionsAcp: () => ipcRenderer.invoke('sessions:acp'),
  acpConfig: (o) => ipcRenderer.invoke('acp:config', o),
  sessionHistory: (o) => ipcRenderer.invoke('sessions:history', o),
  sessionTitulo: (o) => ipcRenderer.invoke('sessions:titulo', o),
  // a costura das conversas quando se troca de IA no meio (ligacoes.json)
  ligacoesLer: () => ipcRenderer.invoke('ligacoes:ler'),
  ligacoesGravar: (o) => ipcRenderer.invoke('ligacoes:gravar', o),
  // uma vez so: costura as conversas antigas que ja tinham sido partidas numa troca de IA
  ligacoesAntigas: () => ipcRenderer.invoke('ligacoes:antigas'),
  skills: (e) => ipcRenderer.invoke('skills:list', e),
  // prompts salvos com nome (~/.claude/cockpit-prompts.json): reaproveitar pedidos longos
  promptsLer: () => ipcRenderer.invoke('prompts:ler'),
  promptsSalvar: (l) => ipcRenderer.invoke('prompts:salvar', l),
  // lista de arquivos da pasta do painel, para o menu do "@" no campo de escrever
  buscarArquivos: (o) => ipcRenderer.invoke('fs:buscarArquivos', o),
  pickFiles: (k) => ipcRenderer.invoke('dialog:pickFiles', k),
  pickPhoto: () => ipcRenderer.invoke('user:pickPhoto'),
  anexoLer: (f) => ipcRenderer.invoke('anexo:ler', f),
  colados: () => ipcRenderer.invoke('clipboard:anexos'),
  // imagem que a tela gerou (foto da webcam) vira arquivo em colados/
  imagemSalvar: (o) => ipcRenderer.invoke('imagem:salvar', o),
  // o texto que está DENTRO de uma imagem (OCR local, pela Vision da Apple)
  ocrLer: (o) => ipcRenderer.invoke('ocr:ler', o),
  // quadro branco: grava o PNG + o JSON da cena, e guarda/le o rascunho do desenho
  quadroSalvar: (o) => ipcRenderer.invoke('quadro:salvar', o),
  quadroRascunhoGravar: (o) => ipcRenderer.invoke('quadro:rascunhoGravar', o),
  quadroRascunhoLer: () => ipcRenderer.invoke('quadro:rascunhoLer'),
  // R2-025: confirma pro main.js se o pedido do Claude pra abrir o quadro realmente abriu na tela
  quadroAbriu: (ok) => ipcRenderer.invoke('quadro:abriuResultado', ok),
  verArquivo: (f) => ipcRenderer.invoke('arquivo:ver', f),
  // arquivo que mora NA VPS: mesmo formato do verArquivo, mas o conteudo vem por SSH
  verArquivoVps: (f) => ipcRenderer.invoke('arquivo:verVps', f),
  // conversas do Claude que rodaram dentro da VPS (o .jsonl delas nao existe no Mac)
  sessionsClaudeRemoto: (r) => ipcRenderer.invoke('sessions:claudeRemoto', r),
  sessionHistoryRemoto: (o) => ipcRenderer.invoke('sessions:historyRemoto', o),
  // linha de shell que entra na VPS (host e usuario sao montados no main, nunca na tela)
  termLinhaShell: (cwd) => ipcRenderer.invoke('term:linhaShell', cwd),
  renomear: (o) => ipcRenderer.invoke('sessao:renomear', o),
  nomeCurto: (o) => ipcRenderer.invoke('sessao:nomeCurto', o),
  donoNome: (o) => ipcRenderer.invoke('sessao:donoNome', o),
  // nome simples de cada agente do time (2 palavras + linha curta), num lote so
  agentesNomes: (o) => ipcRenderer.invoke('agentes:nomes', o),
  detalhePerguntar: (o) => ipcRenderer.invoke('detalhe:perguntar', o),
  detalheCancelar: (o) => ipcRenderer.invoke('detalhe:cancelar', o),
  // apagar conversa: manda para a Lixeira. Fora do mapa HANDLERS de proposito (R1) — o iPhone
  // nao pode apagar arquivo do Mac pelo Wi-Fi
  apagarSessao: (o) => ipcRenderer.invoke('sessao:apagar', o),
  // ramificar de verdade (Codex: thread/fork; no Claude o ramo nasce no proprio start)
  sessaoFork: (o) => ipcRenderer.invoke('sessao:fork', o),
  buscarConversas: (o) => ipcRenderer.invoke('sessions:buscar', o),
  auth: (o) => ipcRenderer.invoke('auth:acao', o),
  webEstado: () => ipcRenderer.invoke('web:estado'),
  webLigar: (v) => ipcRenderer.invoke('web:ligar', v),
  contaLer: (e) => ipcRenderer.invoke('conta:ler', e),
  usoLer: (e) => ipcRenderer.invoke('uso:ler', e),
  // contas guardadas: alternar entre contas já logadas sem refazer login
  contasListar: (e) => ipcRenderer.invoke('contas:listar', e),
  contasDisponivel: (e) => ipcRenderer.invoke('contas:disponivel', e),
  contasSalvar: (o) => ipcRenderer.invoke('contas:salvar', o),
  contasTrocar: (o) => ipcRenderer.invoke('contas:trocar', o),
  contasEsquecer: (o) => ipcRenderer.invoke('contas:esquecer', o),
  // derruba o app-server do Codex para ele reler a credencial depois da troca
  codexReiniciar: () => ipcRenderer.invoke('codex:reiniciar'),
  // Apps do ChatGPT (conectores da conta, não os MCP deste Mac)
  codexApps: () => ipcRenderer.invoke('codex:apps'),
  // leva 10: torre de controle, chip do git e radar de versao — as tres sao LEITURA
  agentesClaude: () => ipcRenderer.invoke('agentes:claude'),
  gitStatus: (o) => ipcRenderer.invoke('git:status', o),
  gitDiff: (o) => ipcRenderer.invoke('git:diff', o),
  motoresVersoes: () => ipcRenderer.invoke('motores:versoes'),
  onMotorAtualizado: (cb) => ipcRenderer.on('motores:atualizado', (_e, p) => cb(p)),
  motoresDisponiveis: () => ipcRenderer.invoke('motores:disponiveis'),
  /* leva 11: rotinas do launchd. Listar é LEITURA; disparar roda o robô de verdade e o main o
     mantém fora do mapa servido pelo Wi-Fi (R1). */
  rotinasListar: () => ipcRenderer.invoke('rotinas:listar'),
  rotinasDisparar: (o) => ipcRenderer.invoke('rotinas:disparar', o),
  mcpList: (e) => ipcRenderer.invoke('mcp:list', e),
  mcpAcao: (o) => ipcRenderer.invoke('mcp:acao', o),
  avisarPronto: (o) => ipcRenderer.invoke('aviso:pronto', o),
  // o agente te chamou no meio do trabalho (PushNotification): aviso do sistema, sem badge
  avisarAgente: (o) => ipcRenderer.invoke('aviso:agente', o),
  copiar: (t) => ipcRenderer.invoke('clipboard:copiar', t),
  desfazerEdicao: (o) => ipcRenderer.invoke('arquivo:desfazer', o),
  abaDoNavegador: () => ipcRenderer.invoke('navegador:aba'),
  configClaude: () => ipcRenderer.invoke('config:claude'),
  salvarNoVault: (o) => ipcRenderer.invoke('vault:salvar', o),
  ditar: (o) => ipcRenderer.invoke('voz:transcrever', o),
  // ditado ao vivo: o texto volta pelo mesmo cano dos outros avisos do painel (pane:event)
  vozVivo: (o) => ipcRenderer.invoke('voz:vivo', o),
  vozParar: (o) => ipcRenderer.invoke('voz:parar', o),
  // atalho global de ditar (⌃⌥Espaço): vale com o Cockpit atrás
  atalhosEstado: () => ipcRenderer.invoke('atalhos:estado'),
  atalhosLigar: (o) => ipcRenderer.invoke('atalhos:ligar', o),
  /* caixa de entrada: o que cair em userData/inbox vira tarja com "usar". Os três canais
     ficam FORA do mapa HANDLERS de propósito (R1) — ver o comentário no main.js */
  inboxConsumir: (o) => ipcRenderer.invoke('inbox:consumir', o),
  inboxPasta: () => ipcRenderer.invoke('inbox:pasta'),
  inboxOuvindo: () => ipcRenderer.invoke('inbox:ouvindo'),
  onInbox: (cb) => ipcRenderer.on('inbox', (_e, p) => cb(p)),

  termRun: (o) => ipcRenderer.invoke('term:run', o),
  termInput: (o) => ipcRenderer.invoke('term:input', o),
  termKill: (o) => ipcRenderer.invoke('term:kill', o),
  termResize: (o) => ipcRenderer.invoke('term:resize', o),
  onTermEvent: (cb) => ipcRenderer.on('term:event', (_e, p) => cb(p)),

  onPaneEvent: (cb) => ipcRenderer.on('pane:event', (_e, p) => cb(p)),
  onCodexEvent: (cb) => ipcRenderer.on('codex:event', (_e, p) => cb(p)),
  onMenu: (cb) => ipcRenderer.on('menu', (_e, action) => cb(action)),
  // erro interno do processo principal: em vez de o app sumir da tela, aparece um aviso
  onErroApp: (cb) => ipcRenderer.on('app:erro', (_e, p) => cb(p)),
});
