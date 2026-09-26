const { app, BrowserWindow, ipcMain, dialog, Menu, shell, clipboard, powerSaveBlocker, Notification, nativeTheme } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { StringDecoder } = require('string_decoder');
const codexProtocol = require('./codex-protocol');

const plataforma = require('./plataforma');
const nomesConversa = require('./nomes-conversa');   // nome das conversas: instrucao e validacao
const { EH_WIN, acharBin, spawnBin, abrirPty, temBin, matarProcesso } = plataforma;

/* R1-006: 2a copia do processo (app instalado + uma dev rodando por cima, por exemplo)
   escreveria no MESMO arquivo temporario fixo do indice de busca (compactarTexto, mais
   abaixo) e corromperia o indice-texto.ndjson. So uma instancia segura essa trava; a 2a se
   fecha sozinha antes de abrir janela. O "typeof" e' de proposito: o harness de teste (VM,
   sem Electron de verdade) nao simula essa API — sem a checagem QUALQUER teste que carrega
   este arquivo quebraria na hora. */
if (typeof app.requestSingleInstanceLock === 'function' && !app.requestSingleInstanceLock()) {
  app.quit();
}

const HOME = os.homedir();
const contasCli = require('./contas-cli').criarContasCli({ HOME, pastaDados: () => app.getPath('userData'), acharBin, temBin,
  buildEnv: () => plataforma.buildEnv(), ehWindows: EH_WIN });
// no Mac o Claude mora sempre no mesmo lugar; no Windows a gente procura
let CLAUDE_BIN = EH_WIN ? acharBin('claude') : path.join(HOME, '.local/bin/claude');

/* ---------- por que existe uma copia do Claude aqui dentro ----------
   O macOS guarda a permissao (Acesso Total ao Disco, Documentos, Mesa) pelo CAMINHO do
   programa. O Claude Code se atualiza sozinho e cada versao mora num caminho novo
   (~/.local/share/claude/versions/2.1.226, depois 2.1.227...). Resultado: a cada atualizacao
   o Mac pedia tudo de novo, e a tela de Ajustes mostrava "claude" JA LIGADO — que era a versao
   velha. Dava para liberar a vida inteira sem nunca ficar liberado.

   A permissao que o Mac grava nao esta presa a versao, e sim a assinatura da Anthropic
   (identifier "com.anthropic.claude-code", equipe Q6L2SF6YDW) — conferido no banco do TCC.
   Entao basta o CAMINHO parar de mudar: mantemos uma copia em ~/.cockpit/bin/claude, sempre
   igual a versao atual. Ele libera uma vez e acabou. A copia preserva a assinatura original. */
const CLAUDE_FIXO = path.join(HOME, '.cockpit', 'bin', 'claude');
function usarClaudeDeCaminhoFixo() {
  if (EH_WIN) return;
  try {
    const real = fs.realpathSync(path.join(HOME, '.local/bin/claude'));
    const nova = fs.statSync(real);
    let atual = null;
    try { atual = fs.statSync(CLAUDE_FIXO); } catch {}
    if (!atual || atual.size !== nova.size || Math.round(atual.mtimeMs) !== Math.round(nova.mtimeMs)) {
      fs.mkdirSync(path.dirname(CLAUDE_FIXO), { recursive: true });
      const meio = CLAUDE_FIXO + '.novo';
      fs.copyFileSync(real, meio);
      fs.chmodSync(meio, 0o755);
      fs.utimesSync(meio, nova.atime, nova.mtime);   // a data igual e o que diz "ja copiei esta"
      fs.renameSync(meio, CLAUDE_FIXO);              // troca atomica: quem esta rodando nao cai
      anota('copiei o Claude para o caminho fixo', real);
    }
    CLAUDE_BIN = CLAUDE_FIXO;
  } catch (e) {
    anota('nao consegui usar o caminho fixo do Claude', e.message);   // segue com o original
  }
}
/* R2-031: mesma coisa, mas assincrona (fs.promises), pra nao travar o loop principal do
   Electron (todos os paineis, nao so o Claude) durante a copia do binario. So usada na
   auto-atualizacao (roda em background, 6/6h); o boot continua com a versao sincrona acima,
   de proposito, porque roda antes da janela existir. */
async function usarClaudeDeCaminhoFixoAsync() {
  if (EH_WIN) return;
  try {
    const real = await fs.promises.realpath(path.join(HOME, '.local/bin/claude'));
    const nova = await fs.promises.stat(real);
    let atual = null;
    try { atual = await fs.promises.stat(CLAUDE_FIXO); } catch {}
    if (!atual || atual.size !== nova.size || Math.round(atual.mtimeMs) !== Math.round(nova.mtimeMs)) {
      await fs.promises.mkdir(path.dirname(CLAUDE_FIXO), { recursive: true });
      const meio = CLAUDE_FIXO + '.novo';
      await fs.promises.copyFile(real, meio);
      await fs.promises.chmod(meio, 0o755);
      await fs.promises.utimes(meio, nova.atime, nova.mtime);   // a data igual e o que diz "ja copiei esta"
      await fs.promises.rename(meio, CLAUDE_FIXO);              // troca atomica: quem esta rodando nao cai
      anota('copiei o Claude para o caminho fixo', real);
    }
    CLAUDE_BIN = CLAUDE_FIXO;
  } catch (e) {
    anota('nao consegui usar o caminho fixo do Claude', e.message);   // segue com o original
  }
}
const CONFIG_PATH = () => path.join(app.getPath('userData'), 'config.json');
const LOG = () => path.join(app.getPath('userData'), 'cockpit.log');
function anota(...partes) {
  const linha = new Date().toISOString() + '  ' + partes.map(x => (x && x.stack) || (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(' ') + '\n';
  try { fs.appendFileSync(LOG(), linha); } catch {}
  try { console.log(linha.trim()); } catch {}
}

/* Rede de seguranca do processo principal. Sem isto, qualquer erro nao tratado em qualquer
   canto do main mata o Electron na hora: a janela some da tela, todas as abas e todos os
   chats morrem juntos, e o log nao registra nada. Aqui o erro vira uma linha no cockpit.log
   e um aviso na tela, e o app continua de pe. */
process.on('uncaughtException', (e) => {
  try { anota('ERRO NAO TRATADO no main:', e); } catch {}
  try {
    if (win && !win.isDestroyed()) {
      win.webContents.send('app:erro', { texto: 'Um erro interno aconteceu, mas o Cockpit continua aberto: ' + (e && e.message || e) });
    }
  } catch {}
});
process.on('unhandledRejection', (e) => {
  try { anota('PROMESSA REJEITADA sem tratamento no main:', e); } catch {}
});

let win = null;
const HANDLERS = {};                    // os mesmos comandos, tambem servidos pelo Wi-Fi
function handle(nome, fn) { HANDLERS[nome] = fn; ipcMain.handle(nome, fn); }

/* ======================= util ======================= */
/* Gravar direto no arquivo final e perigoso: o config tem 2,3 MB (a foto em base64 sozinha
   ocupa quase tudo) e e reescrito dezenas de vezes por dia. Se o app morrer no meio de uma
   dessas gravacoes, o arquivo fica pela metade, o JSON.parse falha e TODAS as abas e chats
   somem de uma vez. Gravando num temporario e trocando o nome, o rename e atomico: ou entra
   o arquivo novo inteiro, ou fica o antigo inteiro. Nunca um pedaco. */
function gravarSeguro(alvo, texto) {
  const tmp = alvo + '.tmp';
  try {
    fs.writeFileSync(tmp, texto);
    fs.renameSync(tmp, alvo);
    return true;
  } catch (e) {
    anota('nao consegui gravar', alvo, e);
    try { fs.unlinkSync(tmp); } catch {}
    return false;
  }
}

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH(), 'utf8')); }
  catch (e) {
    // se o arquivo estiver corrompido, guarda uma copia antes de comecar do zero:
    // assim da pra resgatar as abas na mao em vez de perder tudo calado
    try {
      if (fs.existsSync(CONFIG_PATH())) {
        fs.copyFileSync(CONFIG_PATH(), CONFIG_PATH() + '.quebrado');
        anota('config ilegivel, copia salva em config.json.quebrado:', e && e.message);
      }
    } catch {}
    return {};
  }
}
/* Rede contra perder aba sem perceber: quando a gravacao nova traz MENOS abas do que a
   anterior, guarda o retrato de antes como config.json.anterior. Se uma restauracao falhar no
   meio (ou qualquer outra coisa comer abas), da pra voltar.
   So guardar a copia nao adiantava: o log tinha 108 perdas em poucos dias e ele perdia as abas
   do mesmo jeito. Agora a perda e BARRADA. Quem grava diz de onde a gravacao veio: a tela so
   marca `origem.fechou` quando o dono fechou a aba com as proprias maos (o X da aba, o ⌘W no
   ultimo chat dela, ou arrastar o ultimo chat pra outra aba). Gravacao sem essa marca —
   boot, restauracao que falhou no meio, retrato velho da tela — nao pode mais comer aba:
   as que faltam voltam pro que vai ao disco e a tela recebe o recado.
   COMO A ABA E RECONHECIDA: pelo numero das conversas que estao dentro dela (`sessao`), nunca
   pela pasta. A pasta muda sozinha — quando o app agrupa por cliente, `Projetos-claude/X/demanda`
   vira `Projetos-claude/X` — e casar por pasta fazia a trava nao reconhecer as abas e devolver
   copia de todas, virando aba repetida. Numero de conversa nao muda. Aba nova, ainda sem
   conversa nenhuma, cai no criterio antigo da pasta.
   A contagem fica na MEMORIA de proposito: reler e reinterpretar o arquivo de 2,2 MB a cada
   gravacao — e o savePanes grava a cada chat aberto, fechado ou redimensionado — custaria
   mais caro do que o problema que estamos evitando. So o caminho da perda (raro) le o disco. */
let abasNoDisco = -1;
/* R3-003: saveConfig roda em ~37 pontos do app.js (trocar de aba, redimensionar coluna, mudar
   modelo...) e antes chamava podarPorPasta(cfg) TODA VEZ — uma rodada de fs.existsSync sincrono
   por chave de cfg.porPasta, no processo principal que atende todos os paineis. Com centenas de
   chaves acumuladas em meses de uso, isso travava a interface inteira a cada clique. Agora a
   poda so roda a cada PODA_A_CADA gravacoes; a limpeza em si (podarPorPasta) continua igual, so
   fica mais rara — efeito cosmetico, ja que so remove entrada ausente ha 3 dias seguidos. */
const PODA_A_CADA = 20;
let saveConfigCount = 0;
const listaDeAbas = (d) => (Array.isArray(d && d.abas) ? d.abas : []);
/* R2-040: cfg.porPasta guarda modelo/esforco por PASTA COMPLETA e ninguem nunca podava — o
   proprio jeito dele trabalhar (CLAUDE.md: "demanda nova = subpasta do cliente") cria uma
   pasta local nova quase todo dia, e cada escolha de modelo vira uma chave permanente em
   config.json, o arquivo mais gravado do app. So' poda quando a pasta ja sumiu do disco HA'
   DIAS seguidos: no primeiro boot sem ela (HD externo desligado, pasta do Drive ainda nao
   montada) so' anota a ausencia, nao apaga a preferencia. Pasta da VPS (ehRemoto) nunca conta
   como ausente: fs.existsSync não enxerga o disco remoto. */
const PODA_PASTA_APOS_MS = 3 * 24 * 60 * 60 * 1000;   // 3 dias seguidos sumida
function podarPorPasta(cfg) {
  if (!cfg || !cfg.porPasta || typeof cfg.porPasta !== 'object') return;
  const agora = Date.now();
  const antes = (cfg.porPastaAusenteDesde && typeof cfg.porPastaAusenteDesde === 'object') ? cfg.porPastaAusenteDesde : {};
  const depois = {};
  for (const chave of Object.keys(cfg.porPasta)) {
    const pasta = chave.split('|')[0];
    if (!pasta || ehRemoto(pasta) || fs.existsSync(pasta)) continue;   // existe (ou e' da VPS): nada a podar
    const desde = antes[chave] || agora;
    if (agora - desde >= PODA_PASTA_APOS_MS) delete cfg.porPasta[chave];
    else depois[chave] = desde;
  }
  cfg.porPastaAusenteDesde = depois;
}
function saveConfig(cfg, origem) {
  saveConfigCount++;
  if (saveConfigCount % PODA_A_CADA === 0) podarPorPasta(cfg);   // R3-003: so de vez em quando, nao a cada save
  const nAgora = listaDeAbas(cfg).length;
  if (abasNoDisco < 0) abasNoDisco = listaDeAbas(loadConfig()).length;
  let aGravar = cfg, devolvidas = 0;
  if (abasNoDisco > 0 && nAgora < abasNoDisco) {
    // a rede de seguranca continua: o retrato de antes fica guardado nos dois casos
    try { fs.copyFileSync(CONFIG_PATH(), CONFIG_PATH() + '.anterior'); } catch {}
    if (origem && origem.fechou) {
      anota('abas caindo de ' + abasNoDisco + ' para ' + nAgora + ' (ele fechou): guardei config.json.anterior');
    } else if (origem && origem.agrupou) {
      // nao foi clique dele: no boot, duas abas do mesmo cliente se fundiram numa so (agruparPorCliente)
      anota('abas caindo de ' + abasNoDisco + ' para ' + nAgora + ' (agrupou no boot): guardei config.json.anterior');
    } else {
      // numeros de conversa que o retrato novo trouxe, de todas as abas juntas
      const idsDaAba = (a) => (Array.isArray(a && a.chats) ? a.chats : [])
        .map(c => String((c && (c.sessao || c.arquivo)) || '')).filter(Boolean);
      const tenhoIds = new Set(listaDeAbas(cfg).flatMap(idsDaAba));
      const tenhoPastas = new Set(listaDeAbas(cfg).map(a => String((a && a.cwd) || '')));
      const sumiu = (a) => {
        const ids = idsDaAba(a);
        // aba com conversa: so sumiu se NENHUMA das conversas dela aparece no retrato novo
        if (ids.length) return !ids.some(id => tenhoIds.has(id));
        // aba vazia (sem conversa ainda): so resta comparar a pasta
        return !tenhoPastas.has(String((a && a.cwd) || ''));
      };
      const faltando = listaDeAbas(loadConfig()).filter(sumiu);
      if (faltando.length) {
        // as abas que sumiram do retrato voltam no fim da fila: assim o numero de cada aba
        // que VEIO no retrato nao muda e o cfg.abaAberta continua apontando pra aba certa
        aGravar = { ...cfg, abas: listaDeAbas(cfg).concat(faltando) };
        devolvidas = faltando.length;
        anota('barrei perda de aba: o retrato trazia ' + nAgora + ', devolvi ' + devolvidas + ' do disco');
      }
    }
  }
  if (!gravarSeguro(CONFIG_PATH(), JSON.stringify(aGravar, null, 2))) return -1;
  abasNoDisco = listaDeAbas(aGravar).length;
  return devolvidas;
}

// app GUI nao herda o PATH do shell: monta um PATH completo (ver plataforma.js)
const buildEnv = plataforma.buildEnv;

const ouvintesWeb = new Set();
function emit(paneId, kind, data) {
  // qualquer evento que nao seja pedaco de texto tem de sair DEPOIS do texto que ja estava
  // acumulado, senao o "texto final" chega antes do fim do rascunho e a resposta duplica
  if (kind !== 'text-delta') despejarDelta(paneId);
  // Pedido de permissao de um turno que acabou nao pode continuar respondivel: alem de sobrar
  // chave velha guardada a sessao inteira, responder "sim" ali escrevia num processo morto e
  // fazia aparecer "a conexao caiu" num chat que estava vivo.
  if (kind === 'turn-end' || kind === 'engine-down') {
    for (const [k, a] of pendingApprovals) {
      const continua = a && (a.kind === 'async' || a.kind === 'elicitation' || a.kind === 'input' && a.isBlocking === false);
      if (a && a.paneId === paneId && (kind === 'engine-down' || !continua)) pendingApprovals.delete(k);
    }
  }
  const msg = { paneId, kind, ...data };
  if (win && !win.isDestroyed()) win.webContents.send('pane:event', msg);
  /* PRINT NAO TRAFEGA PELO WI-FI. O send acima ja serializou a mensagem inteira (com as
     imagens) para a janela do Mac; daqui pra baixo elas saem do objeto. Sem isto, cada print
     que o agente tira (ate 3 MB de base64, ate 4 por passo) seria empurrado para o iPhone a
     cada turno, so' para caber numa tela de 6 polegadas.
     A ORDEM DESTA LINHA IMPORTA: ela tem de ficar DEPOIS do send do Mac e ANTES do laco do
     Wi-Fi. Quem mexer aqui, nao mova. */
  if (msg.imagens) { msg.prints = msg.imagens.length; delete msg.imagens; }
  for (const ws of ouvintesWeb) { try { ws.send(JSON.stringify({ tipo: 'evento', canal: 'pane:event', dados: msg })); } catch {} }
}

/* O claude roda com --include-partial-messages: chega um pedacinho de texto a cada poucos
   caracteres. Cada um virava um envio para a tela, e a tela reprocessava o markdown da
   resposta INTEIRA a cada pedacinho — o custo cresce ao quadrado, e por isso resposta longa
   ia deixando o Cockpit pesado (rolar travava, digitar no outro chat engasgava).
   Aqui os pedacinhos sao juntados e mandados no maximo 20 vezes por segundo. Nada se perde:
   o texto final reescreve o bloco completo no fim do turno. */
const filaDelta = new Map();   // paneId -> { id, texto, timer }
function despejarDelta(paneId) {
  const f = filaDelta.get(paneId);
  if (!f) return;
  clearTimeout(f.timer);
  filaDelta.delete(paneId);
  if (f.texto) emit(paneId, 'text-delta', { id: f.id, text: f.texto });
}
function emitDelta(paneId, id, texto) {
  let f = filaDelta.get(paneId);
  if (f && f.id !== id) { despejarDelta(paneId); f = null; }
  if (!f) { f = { id, texto: '', timer: null }; filaDelta.set(paneId, f); }
  f.texto += texto;
  if (!f.timer) f.timer = setTimeout(() => despejarDelta(paneId), 50);
}
function avisarWeb(canal, dados) {
  for (const ws of ouvintesWeb) { try { ws.send(JSON.stringify({ tipo: 'evento', canal, dados })); } catch {} }
}

/* ======================= motor CODEX =======================
   Um `codex app-server` por DESTINO: um no Mac e um dentro da VPS (por SSH).
   Cada painel e uma thread, e o painel lembra em qual destino ele vive. */
const codexConns = new Map();     // destino ('local' | 'vps') -> conexao
const codexPaneDest = new Map();  // paneId -> destino
const codexPaneBilling = new Map(); // paneId -> 'plan' | 'api'
const codexPaneSettings = new Map(); // escolhas efetivas por conversa, nunca configuração global
const codexPaneIdentity = new Map(); // distingue duas aberturas da mesma thread no mesmo painel
const codexPaneAgents = new Map();
const codexAgentOwners = new Map(); // thread de agente -> painel pai, sem misturar turnos
const codexSettingsRevision = new Map();
const codexSettingsQueue = new Map(); // aplica escolhas na ordem; resposta lenta não vence escolha nova
const codexPendingSettings = new Map(); // escolhas que só serão efetivas no próximo turn/start
const codexTurnRevision = new Map();
const codexProcessPanes = new Map();
const codexPlanText = new Map();
const codexApiCortado = new Set();  // evita mandar varios pedidos de parada pelo mesmo teto
const codex = {
  threadToPane: new Map(),   // threadId -> paneId
  paneToThread: new Map(),   // paneId -> threadId
  paneTurn: new Map(),       // paneId -> turnId em andamento
};

/* O Astra por creditos usa a API sem trocar o login normal do Codex. A chave fica no
   Chaveiro do Mac e o app-server pede ao proprio macOS quando realmente precisar dela. */
const ASTRA_API_MODEL = 'gpt-6-astra';
const ASTRA_PROVIDER = 'cockpit_api';
const ASTRA_KEYCHAIN_SERVICE = 'com.adsure.cockpit.openai-api';
const ASTRA_KEYCHAIN_ACCOUNT = os.userInfo().username;
function codexProviderAstra() {
  const q = (v) => JSON.stringify(String(v));
  return 'model_providers.' + ASTRA_PROVIDER + '={'
    + 'name="OpenAI API por creditos",'
    + 'base_url="https://api.openai.com/v1",'
    + 'wire_api="responses",'
    + 'auth={command="/usr/bin/security",args=['
    + ['find-generic-password', '-a', ASTRA_KEYCHAIN_ACCOUNT, '-s', ASTRA_KEYCHAIN_SERVICE, '-w'].map(q).join(',')
    + '],refresh_interval_ms=0,timeout_ms=5000}}';
}

const destinoDoCwd = (cwd) => (ehRemoto(cwd) ? String(cwd).split(':')[0] : 'local');
const destinoDoPane = (paneId) => codexPaneDest.get(paneId) || 'local';

function conexaoCodex(destino) {
  let c = codexConns.get(destino);
  if (!c) { c = { destino, proc: null, buf: '', id: 0, pend: new Map(), ready: null }; codexConns.set(destino, c); }
  return c;
}

function limparPaineisCodex(destino, avisar = true) {
  for (const [paneId, d] of codexPaneDest) {
    if (d !== destino) continue;
    if (avisar) emit(paneId, 'engine-down', {});
    const tid = codex.paneToThread.get(paneId);
    if (tid) codex.threadToPane.delete(tid);
    codex.paneToThread.delete(paneId);
    codexPaneIdentity.delete(paneId);
    codex.paneTurn.delete(paneId);
    codexApiCortado.delete(paneId);
    codexPendingSettings.delete(paneId);
    codexPaneAgents.delete(paneId);
    paneStarts.delete(paneId);
    soltarFio(paneId);
    const delta = filaDelta.get(paneId);
    if (delta) { clearTimeout(delta.timer); filaDelta.delete(paneId); }
    for (const [key, approval] of pendingApprovals) if (approval.paneId === paneId) pendingApprovals.delete(key);
    for (const [thread, owner] of codexAgentOwners) if (owner === paneId) codexAgentOwners.delete(thread);
    for (const [key, owner] of codexProcessPanes) if (owner === paneId) codexProcessPanes.delete(key);
    codexPaneDest.delete(paneId);
    codexPaneBilling.delete(paneId);
  }
}

function codexStart(destino = 'local') {
  const c = conexaoCodex(destino);
  if (c.ready) return c.ready;
  let processoDaTentativa;
  const tentativa = new Promise((resolve, reject) => {
    let p;
    try {
      // detached: o Codex roda com sandbox de acesso total e pode disparar comando de sistema
      // como filho DELE; sem isto o kill so' atinge o "codex app-server" e o filho fica orfao
      if (destino === 'local') {
        p = spawnBin('codex', ['-c', codexProviderAstra(), 'app-server'], { cwd: HOME, env: buildEnv(), stdio: ['pipe', 'pipe', 'pipe'], detached: !EH_WIN });
      } else {
        const r = partesRemoto(destino + ':/');
        if (!r) return reject(new Error('servidor desconhecido: ' + destino));
        p = spawn('ssh', argsSsh(r, 'codex app-server'), { env: buildEnv(), stdio: ['pipe', 'pipe', 'pipe'], detached: !EH_WIN });
      }
    } catch (e) { return reject(e); }
    c.proc = p; processoDaTentativa = p; c.buf = '';
    const decoder = new StringDecoder('utf8');

    p.stdout.on('data', (chunk) => {
      if (c.proc !== p) return;
      c.buf += decoder.write(chunk);
      let i;
      while ((i = c.buf.indexOf('\n')) >= 0) {
        const line = c.buf.slice(0, i).trim();
        c.buf = c.buf.slice(i + 1);
        if (!line) continue;
        let m; try { m = JSON.parse(line); } catch { continue; }
        codexIncoming(destino, m);
      }
    });
    p.stderr.on('data', () => {});   // logs do rust, ruido
    // escrever no stdin de um codex ja morto emite 'error' no stream; sem ouvinte isso
    // derruba o Electron inteiro
    p.stdin.on('error', (e) => { anota('stdin do codex caiu:', e && e.message); });
    p.on('close', () => {
      if (c.proc !== p) return;
      c.proc = null; c.ready = null;
      // quem estava esperando resposta precisa saber que caiu. Sem isto a promessa nunca
      // resolve e o chat fica em "Ligando o Codex..." para sempre, sem erro nenhum.
      for (const [, pend] of c.pend) { try { pend.reject(new Error('o Codex caiu no meio')); } catch {} }
      c.pend.clear();
      limparPaineisCodex(destino);
    });
    p.on('error', (e) => { if (c.proc === p) reject(e); });

    codexReq(destino, 'initialize', { clientInfo: { name: 'cockpit', version: '1.0.0', title: 'Cockpit' }, capabilities: { experimentalApi: true } })
      .then(() => { codexNote(destino, 'initialized', {}); resolve(true); })
      .catch(reject);
  });
  c.ready = tentativa;
  // Se ligar o Codex falhar, esquecer a tentativa. Antes o erro ficava guardado em c.ready e
  // TODA chamada seguinte recebia o mesmo erro velho: o Codex ficava morto ate reiniciar o app.
  tentativa.catch(() => {
    if (c.ready !== tentativa) return;
    c.ready = null;
    if (processoDaTentativa && c.proc === processoDaTentativa) {
      c.proc = null; c.buf = '';
      for (const [, pend] of c.pend) pend.reject(new Error('Não consegui iniciar o Codex.'));
      c.pend.clear();
      limparPaineisCodex(destino);
      try { processoDaTentativa.kill('SIGTERM'); } catch {}
    }
  });
  return c.ready;
}

// escrita protegida: o processo pode ter morrido entre o "if (c.proc)" e o write
function escreverCodex(c, obj) {
  if (!c.proc || !c.proc.stdin || c.proc.stdin.destroyed || !c.proc.stdin.writable) return false;
  try { c.proc.stdin.write(JSON.stringify(obj) + '\n'); return true; }
  catch (e) { anota('nao consegui falar com o codex:', e && e.message); return false; }
}

function codexReq(destino, method, params, timeoutMs = 45000) {
  return new Promise((resolve, reject) => {
    const c = conexaoCodex(destino);
    if (!c.proc) return reject(new Error('codex fora do ar' + (destino !== 'local' ? ' na ' + destino : '')));
    const id = ++c.id;
    const timer = setTimeout(() => { c.pend.delete(id); reject(new Error('O Codex não respondeu a ' + method + ' a tempo.')); }, timeoutMs);
    c.pend.set(id, { resolve: v => { clearTimeout(timer); resolve(v); }, reject: e => { clearTimeout(timer); reject(e); } });
    if (!escreverCodex(c, { jsonrpc: '2.0', id, method, params })) {
      c.pend.delete(id); clearTimeout(timer);
      reject(new Error('o Codex caiu antes de receber o pedido'));
    }
  });
}
function codexNote(destino, method, params) {
  escreverCodex(conexaoCodex(destino), { jsonrpc: '2.0', method, params });
}
function codexReply(destino, id, result) {
  return escreverCodex(conexaoCodex(destino), { jsonrpc: '2.0', id, result });
}

const pendingApprovals = new Map();  // approvalKey -> {rpcId, type}

function codexIncoming(destino, m) {
  const c = conexaoCodex(destino);
  // resposta a uma chamada nossa
  if (m.id !== undefined && m.method === undefined) {
    const p = c.pend.get(m.id);
    if (p) { c.pend.delete(m.id); m.error ? p.reject(new Error(m.error.message || 'erro')) : p.resolve(m.result); }
    return;
  }
  // servidor pedindo algo (aprovacao)
  if (m.id !== undefined && m.method) { codexServerRequest(destino, m); return; }
  // notificacao
  if (m.method) codexNotification(m.method, m.params || {}, destino);
}

function paneOf(params) {
  const tid = params.threadId || params.thread_id || params.conversationId || (params.thread && params.thread.id);
  return tid ? (codex.threadToPane.get(tid) ?? codexAgentOwners.get(tid)) : undefined;
}

function codexServerRequest(destino, m) {
  const params = m.params || {};
  const pane = paneOf(params);
  const meth = m.method;
  const key = 'ap_' + destino + '_' + m.id;
  if (meth === 'currentTime/read') { codexReply(destino, m.id, { currentTimeAt: new Date().toISOString() }); return; }
  if (pane === undefined && ['item/commandExecution/requestApproval', 'execCommandApproval', 'item/fileChange/requestApproval', 'applyPatchApproval', 'item/permissions/requestApproval', 'item/tool/requestUserInput', 'mcpServer/elicitation/request'].includes(meth)) {
    escreverCodex(conexaoCodex(destino), { jsonrpc: '2.0', id: m.id, error: { code: -32602, message: 'Não foi possível relacionar este pedido a um chat aberto.' } });
    codexGlobal(destino, 'note', { text: 'Um pedido do Codex não encontrou o chat de origem. Nenhum acesso foi concedido.', error: true });
    return;
  }
  const base = { rpcId: m.id, destino, paneId: pane, threadId: params.threadId, turnId: params.turnId };
  if (meth === 'item/commandExecution/requestApproval' || meth === 'execCommandApproval') {
    // guarda o MESMO payload que vai no emit: e o que o celular pede de volta no reconnect (pane:estado)
    const dadosEvento = { key,
      title: destino === 'local' ? 'Rodar comando no seu Mac' : 'Rodar comando na ' + destino.toUpperCase(),
      detail: (Array.isArray(params.command) ? params.command.join(' ') : params.command || '') + (params.cwd ? '\nem ' + params.cwd : ''),
      reason: params.reason || '',
      // o Codex aceita "acceptForSession" (legado: approved_for_session): o mesmo comando não
      // pergunta de novo nesta conversa. É o "Sempre permitir" do cartão.
      allowAlways: true,
    };
    pendingApprovals.set(key, { ...base, kind: 'cmd', legacy: meth === 'execCommandApproval', evento: { tipo: 'approval', dados: dadosEvento } });
    emit(pane, 'approval', dadosEvento);
    return;
  }
  if (meth === 'item/fileChange/requestApproval' || meth === 'applyPatchApproval') {
    const dadosEvento = { key, title: 'Alterar arquivos', detail: params.grantRoot ? 'em ' + params.grantRoot : '', reason: params.reason || '', allowAlways: true };
    pendingApprovals.set(key, { ...base, kind: 'file', legacy: meth === 'applyPatchApproval', evento: { tipo: 'approval', dados: dadosEvento } });
    emit(pane, 'approval', dadosEvento);
    return;
  }
  if (meth === 'item/permissions/requestApproval') {
    const dadosEvento = { key, title: 'Permitir acesso adicional neste trabalho',
      detail: JSON.stringify(params.permissions || {}, null, 2), reason: params.reason || '',
      allowAlways: true };   // "sempre" = scope "session" em vez de "turn" (codex-protocol.js)
    pendingApprovals.set(key, { ...base, kind: 'perm', permissions: params.permissions || {}, evento: { tipo: 'approval', dados: dadosEvento } });
    emit(pane, 'approval', dadosEvento);
    return;
  }
  if (meth === 'item/tool/requestUserInput') {
    const dadosEvento = { key, questionKind: 'requestUserInput', questions: params.questions || [], isBlocking: params.isBlocking !== false };
    pendingApprovals.set(key, { ...base, kind: 'input', questions: params.questions || [], isBlocking: params.isBlocking !== false, evento: { tipo: 'question', dados: dadosEvento } });
    emit(pane, 'question', dadosEvento);
    return;
  }
  if (meth === 'mcpServer/elicitation/request') {
    const dadosEvento = { key, questionKind: 'elicitation', message: params.message || '', serverName: params.serverName,
      schema: params.requestedSchema || null, mode: params.mode, url: params.url || '', isBlocking: true };
    pendingApprovals.set(key, { ...base, kind: 'elicitation', mode: params.mode, schema: params.requestedSchema, evento: { tipo: 'question', dados: dadosEvento } });
    emit(pane, 'question', dadosEvento);
    return;
  }
  // Não responder {}: isso parecia aprovação e descartava perguntas. Ferramentas
  // não implementadas recebem erro explícito, sem executar nem conceder acesso.
  escreverCodex(conexaoCodex(destino), { jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'O Cockpit não implementa este pedido: ' + meth } });
  const text = meth === 'account/chatgptAuthTokens/refresh' ? 'O Codex precisa renovar o login. Abra Conta para entrar novamente.' : 'O motor pediu um recurso ainda indisponível: ' + meth;
  if (pane !== undefined) emit(pane, 'note', { text, error: true });
  else codexGlobal(destino, 'note', { text, error: true });
}

function codexGlobal(destino, kind, data) {
  // Eventos de conta/conectores não carregam threadId. Distribuir só ao destino
  // correto e também pelo canal global para quando nenhum chat estiver aberto.
  const payload = { destino, kind, ...data };
  if (win && !win.isDestroyed()) win.webContents.send('codex:event', payload);
  avisarWeb('codex:event', payload);
  for (const [paneId, d] of codexPaneDest) if (d === destino) emit(paneId, kind, { ...data, globalEvent: true });
}

function codexEffectiveSettings(pane, server = {}) {
  const previous = codexPaneSettings.get(pane) || {};
  const settings = codexProtocol.normalizeSettings(previous, {
    ...server,
    effort: server.effort !== undefined ? server.effort : server.reasoningEffort,
    serviceTier: Object.prototype.hasOwnProperty.call(server, 'serviceTier') && server.serviceTier === null ? 'default' : server.serviceTier,
  });
  codexPaneSettings.set(pane, settings);
  codexSettingsRevision.set(pane, (codexSettingsRevision.get(pane) || 0) + 1);
  const requested = codexPendingSettings.get(pane);
  const pending = requested && ['model', 'effort', 'serviceTier', 'collaborationMode'].some(key => requested[key] && requested[key] !== settings[key]);
  if (requested && !pending) codexPendingSettings.delete(pane);
  emit(pane, 'settings', { ...settings, effective: true, pending: !!pending,
    ...(pending ? { requestedSettings: requested } : {}),
    approvalPolicy: server.approvalPolicy, sandboxPolicy: server.sandboxPolicy || server.sandbox });
  return settings;
}

function codexAgentItem(pane, item) {
  let agents = codexPaneAgents.get(pane);
  if (!agents) { agents = new Map(); codexPaneAgents.set(pane, agents); }
  const ids = item.type === 'subAgentActivity' ? [item.agentThreadId] : [...new Set([...(item.receiverThreadIds || []), ...Object.keys(item.agentsStates || {})])];
  for (const id of ids) {
    codexAgentOwners.set(id, pane);
    const state = (item.agentsStates || {})[id] || {};
    const status = state.status || (item.kind === 'completed' ? 'completed' : item.kind === 'interrupted' ? 'interrupted' : 'running');
    if (!agents.has(id)) {
      emit(pane, 'agentes', { ev: 'inicio', id, toolId: item.id, desc: item.agentPath || item.prompt || 'Agente Codex',
        tipo: item.model || 'Codex', classe: 'local_agent', prompt: item.prompt || '', em: Date.now() });
    }
    if (['completed', 'errored', 'shutdown', 'notFound', 'interrupted'].includes(status)) {
      emit(pane, 'agentes', { ev: 'fim', id, estado: status === 'errored' || status === 'notFound' ? 'failed' : status,
        resumo: state.message || '', em: Date.now() });
    } else emit(pane, 'agentes', { ev: 'andamento', id, desc: item.prompt || item.agentPath || '', resumo: state.message || '', ferramenta: item.tool || '', em: Date.now() });
    agents.set(id, status);
  }
}

function codexRichItem(pane, item, complete) {
  if (item.type === 'collabAgentToolCall' || item.type === 'subAgentActivity') { codexAgentItem(pane, item); return true; }
  if (item.type === 'plan') {
    if (complete) { codexPlanText.delete(item.id); emit(pane, 'plan', { id: item.id, text: item.text || '', complete: true }); }
    return true;
  }
  if (item.type === 'sleep') {
    emit(pane, 'waiting', { id: item.id, status: complete ? 'completed' : 'waiting', duration: item.durationMs, until: complete ? null : Date.now() + item.durationMs, message: complete ? 'Espera encerrada' : 'Aguardando para continuar' });
    return true;
  }
  if (item.type === 'imageGeneration') {
    if (complete) emit(pane, 'generated-image', codexProtocol.imageData(item));
    else emit(pane, 'tool-start', { id: item.id, name: 'Criando imagem', arg: item.revisedPrompt || '' });
    if (complete) emit(pane, 'tool-end', { id: item.id, output: item.savedPath || (item.failure ? shortJson(item.failure) : 'Imagem criada'), error: !!item.failure });
    return true;
  }
  if (item.type === 'contextCompaction') {
    emit(pane, complete ? 'compactou' : 'waiting', complete ? {} : { status: 'compacting', message: 'Organizando o contexto da conversa' });
    return true;
  }
  return false;
}

function codexNotification(method, params, destino = 'local') {
  if (['account/updated', 'account/rateLimits/updated', 'account/login/completed', 'mcpServer/startupStatus/updated', 'mcpServer/oauthLogin/completed', 'app/list/updated'].includes(method)) {
    codexGlobal(destino, method.startsWith('account/') ? 'account' : 'connectors', { method, ...params });
    return;
  }
  if (method === 'command/exec/outputDelta' || method === 'process/outputDelta') {
    const pane = codexProcessPanes.get(destino + ':' + params.processId) ?? paneOf(params);
    const data = { id: params.itemId || params.processId || params.callId, text: codexProtocol.decodeOutput(params.deltaBase64 ?? params.chunk ?? params.delta, params.deltaBase64 !== undefined || params.chunk !== undefined), stream: params.stream };
    if (pane !== undefined) emit(pane, 'tool-output', data);
    else codexGlobalProcess(destino, data);
    return;
  }
  if (['warning', 'configWarning', 'guardianWarning', 'deprecationNotice'].includes(method)) {
    const data = { text: params.message || params.summary || params.details || 'Aviso do Codex' };
    const target = paneOf(params);
    if (target !== undefined) emit(target, 'note', data); else codexGlobal(destino, 'note', data);
    return;
  }
  if (method === 'serverRequest/resolved') {
    const key = 'ap_' + destino + '_' + params.requestId;
    const pending = pendingApprovals.get(key); pendingApprovals.delete(key);
    if (pending) emit(pending.paneId, 'question-resolved', { key });
    return;
  }
  if (method === 'thread/started') {
    return; // o paneamento e feito no thread/start
  }
  const pane = paneOf(params);
  if (pane === undefined) return;
  const sourceThread = params.threadId || params.thread && params.thread.id;
  if (codexAgentOwners.has(sourceThread) && !codex.threadToPane.has(sourceThread)) {
    // O turno do filho não é o turno do pai. Mostrar progresso no time sem
    // encerrar o chat pai nem trocar seu identificador de interrupção.
    const item = params.item || {};
    if (method === 'turn/completed' || method === 'error') {
      emit(pane, 'agentes', { ev: 'fim', id: sourceThread, estado: method === 'error' ? 'failed' : 'completed', resumo: params.error && params.error.message || '', em: Date.now() });
    } else if (method === 'item/completed' && item.type === 'agentMessage') {
      emit(pane, 'agentes', { ev: 'andamento', id: sourceThread, resumo: (item.text || '').slice(0, 600), em: Date.now() });
    } else if (method === 'item/started') {
      if (item.type === 'collabAgentToolCall' || item.type === 'subAgentActivity') codexAgentItem(pane, item);
      else emit(pane, 'agentes', { ev: 'andamento', id: sourceThread, ferramenta: item.tool || item.type || '', em: Date.now() });
    }
    return;
  }

  switch (method) {
    case 'turn/started':
      codexTurnRevision.set(pane, (codexTurnRevision.get(pane) || 0) + 1);
      codexApiCortado.delete(pane);
      codex.paneTurn.set(pane, params.turnId || (params.turn && params.turn.id));
      emit(pane, 'busy', {});
      break;

    case 'item/agentMessage/delta':
      emitDelta(pane, params.itemId || 'msg', params.delta || '');
      break;

    case 'item/reasoning/summaryTextDelta':
    case 'item/reasoning/textDelta':
      emit(pane, 'think-delta', { text: params.delta || '' });
      break;

    case 'item/started': {
      const it = params.item || {};
      if (codexRichItem(pane, it, false)) break;
      if (it.processId) codexProcessPanes.set(destino + ':' + it.processId, pane);
      if (it.type === 'commandExecution') emit(pane, 'tool-start', { id: it.id, name: 'Terminal', arg: it.command || '' });
      else if (it.type === 'fileChange') emit(pane, 'tool-start', { id: it.id, name: 'Editando arquivo', arg: fileChangeArg(it), edicao: edicaoDoCodex(it) });
      else if (it.type === 'mcpToolCall') emit(pane, 'tool-start', { id: it.id, name: mcpName(it), arg: shortJson(it.arguments) });
      else if (it.type === 'dynamicToolCall') emit(pane, 'tool-start', { id: it.id, name: it.tool || 'Ferramenta', arg: shortJson(it.arguments) });
      else if (it.type === 'webSearch') emit(pane, 'tool-start', { id: it.id, name: 'Pesquisando na web', arg: it.query || '' });
      break;
    }

    case 'item/commandExecution/outputDelta': {
      const txt = codexProtocol.decodeOutput(params.delta ?? params.chunk ?? params.data, params.delta === undefined && params.chunk !== undefined);
      if (txt) emit(pane, 'tool-output', { id: params.itemId || params.callId, text: txt });
      break;
    }

    case 'item/completed': {
      const it = params.item || {};
      if (codexRichItem(pane, it, true)) break;
      if (it.type === 'agentMessage') {
        emit(pane, 'text-final', { id: it.id, text: it.text || '', phase: it.phase || '' });
        if (it.delivery === 'async' && it.questions && it.questions.length) {
          const key = 'async_' + destino + '_' + it.id;
          const questions = it.questions.map((q, i) => ({ id: q.id || 'q' + i, header: 'Pergunta ' + (i + 1), question: q.title || q.question || '', options: (q.options || []).map(o => typeof o === 'string' ? { label: o, description: '' } : o) }));
          // guarda o MESMO payload do emit: e o que 'pane:estado' devolve pro celular reconectar sem perder a pergunta
          const dadosEvento = { key, questionKind: 'async', questions, isBlocking: false };
          pendingApprovals.set(key, { kind: 'async', paneId: pane, destino, questions, threadId: params.threadId, itemId: it.id, evento: { tipo: 'question', dados: dadosEvento } });
          emit(pane, 'question', dadosEvento);
        }
      } else if (it.type === 'commandExecution') {
        emit(pane, 'tool-end', {
          id: it.id,
          output: it.aggregatedOutput || it.output || '',
          error: (it.exitCode != null && it.exitCode !== 0) || it.status === 'failed',
        });
        // comando acabou: solta o registro. Sem isto o mapa cresce pra sempre (app fica dias
        // no ar) e, se o processId for reaproveitado, a saida de um comando novo iria pro
        // painel velho por engano.
        if (it.processId) codexProcessPanes.delete(destino + ':' + it.processId);
      } else if (it.type === 'fileChange') {
        emit(pane, 'tool-end', { id: it.id, output: fileChangeSummary(it), error: it.status === 'failed' });
      /* O resultado do MCP trouxe imagem (print). Ate aqui o shortJson transformava o base64
         em texto: um paredao de megabytes dentro do passo, e a imagem ninguem via. Agora sai
         como imagem, e o texto vira a contagem. Os dois ramos originais seguem intocados
         logo abaixo, para todo resultado que NAO tem imagem. */
      } else if (it.type === 'mcpToolCall' || it.type === 'dynamicToolCall') {
        const imagens = imagensDoResultado(it.type === 'mcpToolCall' ? (it.result ?? it.output) : it.contentItems);
        if (imagens.length || imagens.descartadas) {
          // antes, imagem grande demais (>3MB base64) sumia calada; agora entra no texto
          const partes = [];
          if (imagens.length) partes.push(imagens.length === 1 ? '1 imagem' : imagens.length + ' imagens');
          if (imagens.descartadas) partes.push((imagens.descartadas === 1 ? '1 imagem' : imagens.descartadas + ' imagens') + ' grande(s) demais para mostrar');
          emit(pane, 'tool-end', {
            id: it.id,
            output: '(' + partes.join(', ') + ')',
            error: it.status === 'failed' || it.success === false,
            ...(imagens.length ? { imagens } : {}),
          });
        } else if (it.type === 'mcpToolCall') {
          emit(pane, 'tool-end', { id: it.id, output: shortJson(it.result ?? it.output), error: it.status === 'failed' });
        } else {
          emit(pane, 'tool-end', { id: it.id, output: shortJson(it.contentItems), error: it.success === false || it.status === 'failed' });
        }
      } else if (it.type === 'webSearch') {
        emit(pane, 'tool-end', { id: it.id, output: it.query || '', error: false });
      } else if (it.type === 'error') {
        emit(pane, 'note', { text: it.message || 'erro', error: true });
      }
      break;
    }

    case 'turn/completed': {
      codexTurnRevision.set(pane, (codexTurnRevision.get(pane) || 0) + 1);
      codex.paneTurn.delete(pane);
      emit(pane, 'waiting', { status: 'completed', message: '' });
      if (params.turn && params.turn.error) emit(pane, 'note', { text: params.turn.error.message || shortJson(params.turn.error), error: true });
      emit(pane, 'turn-end', {});
      break;
    }

    case 'turn/failed':
    case 'error': {
      codexTurnRevision.set(pane, (codexTurnRevision.get(pane) || 0) + 1);
      codex.paneTurn.delete(pane);
      // o erro pode vir como texto ou como objeto {message, codexErrorInfo}
      const e = params.error;
      // R2-005: codexErrorInfo e objeto estruturado, nao texto — sem shortJson virava '[object Object]' na tela
      const texto = params.message
        || (typeof e === 'string' ? e : (e && (e.message || shortJson(e.codexErrorInfo))))
        || 'erro no Codex';
      const remoto = destinoDoPane(pane) !== 'local';
      const precisaEntrar = /revoked|unauthorized|log out and sign in|not logged in/i.test(texto);
      emit(pane, 'note', {
        text: texto + (precisaEntrar && remoto ? ' — use o menu / → Conta → trocar conta para entrar de novo na VPS.' : ''),
        error: true,
      });
      emit(pane, 'turn-end', {});
      break;
    }

    case 'thread/tokenUsage/updated': {
      const tu = params.tokenUsage || {};
      // "last" e o tamanho da conversa agora; "total" seria o gasto acumulado
      const atual = (tu.last && tu.last.totalTokens) || (tu.total && tu.total.totalTokens) || 0;
      emit(pane, 'tokens', { total: atual, janela: tu.modelContextWindow || undefined });
      if (codexPaneBilling.get(pane) === 'api' && tu.total) {
        const tid = params.threadId || codex.paneToThread.get(pane);
        const uso = registrarUsoAstra(tid, tu.total);
        emit(pane, 'api-usage', uso);
        const turno = codex.paneTurn.get(pane);
        if (uso.remainingUsd <= 0 && tid && turno && !codexApiCortado.has(pane)) {
          codexApiCortado.add(pane);
          emit(pane, 'note', { text: 'O limite mensal dos créditos foi atingido. Parei este trabalho.', error: true });
          codexReq(destinoDoPane(pane), 'turn/interrupt', { threadId: tid, turnId: turno }).catch(() => {});
        }
      }
      break;
    }

    /* diff agregado do turno, pronto do lado do motor: alimenta o "ver mudanças" do carimbo
       de fim de turno. O Codex manda isto de verdade (esta na lista de notificacoes do CLI). */
    case 'turn/diff/updated':
      emit(pane, 'diff-turno', { diff: String(params.diff || '').slice(0, 300000) });
      break;

    /* consumo DESTE turno, separado do total da conversa (que continua saindo pelo
       'thread/tokenUsage/updated', intocado logo acima).
       ATENCAO: o codex-cli 0.153.4 ainda NAO emite este aviso — conferi a lista de
       notificacoes dentro do binario. Fica pronto para quando ele passar a emitir; ate la o
       carimbo do Codex mostra o tempo e as mudancas, sem a conta de tokens. */
    case 'turn/tokenUsage/updated': {
      const tuTurno = (params.tokenUsage && (params.tokenUsage.last || params.tokenUsage.total)) || params.tokenUsage || {};
      const entradaDoTurno = tuTurno.inputTokens || tuTurno.input_tokens || 0;
      const saidaDoTurno = tuTurno.outputTokens || tuTurno.output_tokens || 0;
      if (entradaDoTurno || saidaDoTurno) emit(pane, 'turno-uso', { entrada: entradaDoTurno, saida: saidaDoTurno });
      break;
    }

    case 'turn/plan/updated':
      emit(pane, 'plan', { steps: params.plan || [], plan: params.plan || [], explanation: params.explanation || '' });
      break;
    case 'item/plan/delta': {
      const text = (codexPlanText.get(params.itemId) || '') + (params.delta || '');
      codexPlanText.set(params.itemId, text); emit(pane, 'plan', { id: params.itemId, text, complete: false });
      break;
    }
    case 'thread/goal/updated':
      emit(pane, 'goal', { ...(params.goal || {}), goal: params.goal });
      break;
    case 'thread/goal/cleared':
      emit(pane, 'goal', { status: 'cleared', objective: '', goal: null });
      break;
    case 'thread/settings/updated':
      codexEffectiveSettings(pane, params.threadSettings || {});
      break;
    case 'model/rerouted':
      codexEffectiveSettings(pane, { model: params.toModel });
      emit(pane, 'note', { text: 'O motor mudou de ' + (params.fromModel || 'modelo') + ' para ' + (params.toModel || 'outro modelo') + (params.reason ? ': ' + params.reason : '.') });
      break;
    case 'thread/compacted':
      emit(pane, 'compactou', {});
      break;

    case 'thread/status/changed':
      if (params.status && params.status.type === 'idle') {
        codexTurnRevision.set(pane, (codexTurnRevision.get(pane) || 0) + 1);
        codex.paneTurn.delete(pane);
        emit(pane, 'turn-end', {});
      }
      break;
  }
}

function codexGlobalProcess(destino, data) {
  const payload = { destino, kind: 'process-output', ...data };
  if (win && !win.isDestroyed()) win.webContents.send('codex:event', payload);
  avisarWeb('codex:event', payload);
}
function decodeChunk(c, encoded = false) { return codexProtocol.decodeOutput(c, encoded); }
function mcpName(it) { return (it.server ? it.server + ' · ' : '') + (it.tool || 'MCP'); }
function shortJson(v) { if (v == null) return ''; try { return typeof v === 'string' ? v : JSON.stringify(v); } catch { return String(v); } }
function fileChangeArg(it) {
  const ch = it.changes || it.fileChanges || [];
  if (Array.isArray(ch) && ch.length) return ch.map(c => c.path || c.file || '').filter(Boolean).join(', ');
  return it.path || '';
}
/* O Codex manda a mudanca ja mastigada, e o formato varia conforme a versao: as vezes vem um
   patch unificado pronto, as vezes o par antes/depois. Pega o que houver. */
function edicaoDoCodex(it) {
  const ch = it.changes || it.fileChanges || [];
  const lista = Array.isArray(ch) ? ch : [];
  if (!lista.length) return null;
  const c = lista[0];
  const arquivo = c.path || c.file || it.path || '';
  if (!arquivo) return null;
  const pronto = c.unified_diff || c.unifiedDiff || c.diff || c.patch;
  if (typeof pronto === 'string' && pronto) return { arquivo, patch: pronto.slice(0, 40000) };
  const antes = c.old_content ?? c.oldContent ?? c.before ?? c.old_string;
  const depois = c.new_content ?? c.newContent ?? c.after ?? c.new_string;
  if (typeof depois === 'string') return { arquivo, partes: [{ antes: String(antes || ''), depois: String(depois) }] };
  return null;
}

function fileChangeSummary(it) {
  const ch = it.changes || it.fileChanges || [];
  if (Array.isArray(ch) && ch.length) return ch.map(c => (c.kind || c.type || 'alterado') + '  ' + (c.path || c.file || '')).join('\n');
  return shortJson(it);
}

/* O app-server nao aplica sozinho o ~/.codex/AGENTS.md, entao mandamos as regras da casa
   junto com cada conversa nova. Se o arquivo existir, ele manda; senao, vai o basico. */
function instrucoesCasa() {
  const base = 'Responda SEMPRE em português do Brasil, nunca em inglês.\n'
    + 'O Homero é leigo em código: fale em palavras simples, com exemplos do contexto dele.\n'
    + 'Resposta curta: ele tem TDAH e não lê texto longo. Comece pelo resultado.\n'
    + 'Não use travessão no texto para ele.';
  try {
    const f = path.join(HOME, '.codex/AGENTS.md');
    const txt = fs.readFileSync(f, 'utf8');
    if (txt.trim()) return base + '\n\n--- regras da casa (~/.codex/AGENTS.md) ---\n' + txt.slice(0, 12000);
  } catch {}
  return base;
}

const CODEX_MODE = {
  plan:        { policy: 'on-request', sandbox: 'read-only' },
  manual:      { policy: 'untrusted',  sandbox: 'workspace-write' },
  'auto-edit': { policy: 'on-request', sandbox: 'workspace-write' },
  auto:        { policy: 'on-request', sandbox: 'workspace-write' },
  /* "revisado" manda o pedido de permissao pra um revisor AUTOMATICO do proprio Codex
     (approvalsReviewer: auto_review), ainda dentro do sandbox de escrita na pasta:
     degrau entre Auto e "sem pedir permissao" — nao interrompe, mas nao e' cego. */
  revisado:    { policy: 'on-request', sandbox: 'workspace-write', reviewer: 'auto_review' },
  bypass:      { policy: 'never',      sandbox: 'danger-full-access' },
};
const CLAUDE_MODE = { manual: 'manual', 'auto-edit': 'acceptEdits', plan: 'plan', auto: 'auto', bypass: 'bypassPermissions' };

/* O settings.json do usuario tem defaultMode: bypassPermissions, que atropela qualquer
   --permission-mode. Para Manual e Auto funcionarem, escrevemos uma copia sem essa linha
   e carregamos ela por --settings, tirando o global do --setting-sources.            */
function claudeSettingsSemBypass() {
  try {
    const src = path.join(HOME, '.claude/settings.json');
    const d = JSON.parse(fs.readFileSync(src, 'utf8'));
    delete d.defaultMode;                       // existe tambem na raiz
    if (d.permissions) {
      delete d.permissions.defaultMode;
      delete d.permissions.additionalDirectories;  // isso liberava a home inteira sem perguntar
    }
    const out = path.join(app.getPath('userData'), 'claude-settings-sem-bypass.json');
    fs.writeFileSync(out, JSON.stringify(d));
    return out;
  } catch { return null; }
}

/* ---------- uma conversa, um dono so ----------
   O Mac e o iPhone falam com ESTE mesmo processo, e cada tela batiza os paineis de um jeito
   ("p1" no Mac, "w7k3p1" no telefone) para uma nao desligar o chat da outra. So que o NUMERO
   da conversa e o mesmo nos dois. Sem esta trava, escrever pelo celular numa conversa ja
   aberta no Mac subia um SEGUNDO agente no mesmo historico e na mesma pasta: os dois editando
   arquivo ao mesmo tempo, cada tela vendo so metade. Agora quem chega depois ouve que a
   conversa ja esta aberta, em vez de subir por cima. */
const donoDoFio = new Map();   // numero da conversa -> { paneId, engine } que esta com ela
const insistiuNoFio = new Map();  // painel -> conversa que ele ja tentou abrir uma vez
const paneStarts = new Map();    // reserva durante a abertura assíncrona; fechar invalida a resposta

// painel com motor de pe. E o que separa "aberta agora" de "sobrou de uma janela que fechou".
const paneVivo = (paneId) => paneStarts.has(paneId) || claudePanes.has(paneId) || codex.paneToThread.has(paneId)
  || cli.vivo(paneId) || acp.vivo(paneId);

// de que tela e o painel: o telefone poe um "w" na frente dos ids (renderer/app.js:11)
const telaDoPane = (paneId) => (/^w/.test(String(paneId || '')) ? 'celular' : 'Mac');

/* Quem esta com esta conversa, se nao for o proprio painel que pergunta. Dono que ja morreu
   (janela fechada, motor derrubado) sai do mapa na hora: trava nao pode virar cadeado. */
function outroDonoDoFio(fio, paneId) {
  const chave = String(fio || '');
  const dono = chave ? donoDoFio.get(chave) : null;
  if (!dono || dono.paneId === paneId) return null;
  if (!paneVivo(dono.paneId)) { donoDoFio.delete(chave); return null; }
  return dono;
}

// o painel larga a conversa que era dele (fechou o chat, trocou de pasta, abriu outra)
function soltarFio(paneId) {
  for (const [fio, dono] of donoDoFio) if (dono.paneId === paneId) donoDoFio.delete(fio);
  insistiuNoFio.delete(paneId);
}

// guarda quem esta com a conversa; um painel so pode estar em uma por vez
function marcarDonoDoFio(paneId, fio, engine) {
  if (!fio) return;
  const antes = donoDoFio.get(String(fio));
  soltarFio(paneId);
  donoDoFio.set(String(fio), { paneId, engine: engine || (antes && antes.engine) || 'claude' });
}

/* ======================= motor CLAUDE ======================= */
/* um processo `claude` por painel, protocolo stream-json */
const claudePanes = new Map();  // paneId -> {proc, buf, blocks}
const avisoSinteticoAnterior = new Map();  // R3-013: paneId -> ultimo texto de erro sintetico avisado, evita nota repetida

const claudeCwd = new Map();
/* O Claude Code nomeia a pasta da sessao trocando TODO caractere que nao e letra nem numero
   por traco. Aqui so trocava "/" e ".", entao pasta com espaco ou acento gerava um caminho
   que nao existe no disco e a conversa nunca voltava. Conferido: a pasta real do cliente
   "Matheus Mota" e "-Users-...-Projetos-claude-Matheus-Mota", e a de "Adsure - Copy Lancamentos"
   e "-Users-...-Adsure---Copy-Lan-amentos" (o "c cedilha" tambem vira traco). */
function caminhoReal(dir) {
  // O Claude Code resolve o atalho (realpath) ANTES de montar o nome da pasta da conversa.
  // A home do Homero tem varios atalhos (~/cockpit, ~/maquina-sites, ~/mcp-servers...)
  // apontando para ~/Documents/Adsure - Sistemas/. Sem resolver aqui, o nome que montamos
  // aponta para uma pasta que nao existe no disco e a conversa volta vazia.
  try { return fs.realpathSync(String(dir)); } catch { return String(dir); }
}
function encodeCwd(dir) { return caminhoReal(dir).replace(/[^a-zA-Z0-9]/g, '-'); }

// texto oficial do modo ultracode do proprio Claude Code (o mesmo que a versao de terminal injeta)
const ULTRACODE_SP = 'Ultracode is on: optimize for the most exhaustive, correct answer — not the fastest or cheapest. Use the Workflow tool on every substantive task; token cost is not a constraint. See the Workflow tool\'s **Ultracode** section and quality patterns. Solo only on conversational/trivial turns.';

/* ---------- leva 10.5: worktree (branch isolada dentro da pasta do painel) ----------
   O CLI so aceita -w dentro de repositorio git: fora dele morre na hora, a cada mensagem, com
   erro em ingles. Por isso a conferencia acontece ANTES de subir o processo.
   R7 (a VPS, que o fork de origem nao tem): "vps:/opt/x" passaria por path.resolve virando
   "<pasta do app>/vps:/opt/x", o laco subiria ate a raiz do MAC e acharia um .git por engano.
   Entao pasta remota sai FALSO na primeira linha — a decisao de recusar o worktree remoto e
   de quem chama, nao deste laco. */
function dentroDeGit(dir) {
  if (!dir || ehRemoto(dir)) return false;
  let d = path.resolve(dir);
  for (let i = 0; i < 40; i++) {
    try { if (fs.existsSync(path.join(d, '.git'))) return true; } catch {}
    const acima = path.dirname(d);
    if (acima === d) return false;
    d = acima;
  }
  return false;
}
// nome que o git aceita como branch: sem "..", sem ".lock" no fim, sem ponto no fim
const nomeDeWorktree = (n) => {
  const t = String(n || '');
  return (/^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/.test(t) && !/\.\.|\.lock$|\.$/.test(t)) ? t : '';
};

function claudeStart(paneId, opts) {
  /* worktree invalido tem de ser recusado ANTES de matar o motor que ja estava rodando: o
     claudeStop() abaixo apaga o registro do painel, e se a validacao falhasse depois disso o
     motor antigo morria e nenhum novo subia, sem nenhum 'engine-down' pra destravar a tela
     (o guard do 'close' ve que o registro ja trocou e sai calado). */
  const nomeWtPedido = (!ehRemoto(opts.cwd) && opts.worktree) ? String(opts.worktree) : '';
  if (nomeWtPedido && !dentroDeGit(opts.cwd || HOME)) {
    emit(paneId, 'note', { text: 'A pasta deste chat não é um repositório git, e o worktree "' + nomeWtPedido + '" só funciona dentro de um. Use "Sair do worktree" no menu / do chat, ou troque a pasta.', error: true });
    return false;
  }
  if (nomeWtPedido && !nomeDeWorktree(nomeWtPedido)) {
    emit(paneId, 'note', { text: 'O nome de worktree "' + nomeWtPedido + '" não é aceito pelo git (não pode terminar em ponto nem em ".lock", nem ter ".." no meio). Use "Sair do worktree" no menu / do chat e entre de novo com outro nome.', error: true });
    return false;
  }
  claudeStop(paneId);
  claudeCwd.set(paneId, opts.cwd || HOME);
  const args = [
    '--print', '--input-format', 'stream-json', '--output-format', 'stream-json',
    '--verbose', '--include-partial-messages',
    '--permission-mode', CLAUDE_MODE[opts.approval] || 'bypassPermissions',
  ];
  if (opts.sugestoes !== false && !ehRemoto(opts.cwd)) args.push('--prompt-suggestions');
  const modo = opts.approval || 'bypass';
  if (modo === 'bypass') {
    args.push('--dangerously-skip-permissions');
  } else {
    // canal para ele perguntar antes de agir
    args.push('--permission-prompt-tool', 'stdio');
    const sf = claudeSettingsSemBypass();
    if (sf) { args.push('--setting-sources', 'project,local'); args.push('--settings', sf); }
  }
  if (opts.effort) args.push('--effort', opts.effort);
  // no esforco Maximo o painel vira "ultracode": ele passa a usar workflows (varios agentes
  // em paralelo) por conta propria. Em --print o CLI nasce com a regra contraria, entao alem
  // deste texto o renderer ainda manda a autorizacao junto da primeira mensagem.
  if (opts.effort === 'max') args.push('--append-system-prompt', ULTRACODE_SP);
  if (opts.model) args.push('--model', opts.model);
  if (opts.resumeId) args.push('--resume', opts.resumeId);
  /* RAMIFICAR de verdade: --resume + --fork-session abre uma conversa NOVA levando o historico
     INTEIRO da antiga, e a de origem fica intacta. Linha nova, logo depois do --resume, para o
     argv sair na mesma ordem do fork de origem. Sem opts.fork nada muda: e o caminho de sempre. */
  if (opts.resumeId && opts.fork) args.push('--fork-session');
  // acesso amplo de saida so no modo que nao pergunta; nos outros ele pede na hora
  if (modo === 'bypass' && opts.cwd && opts.cwd !== HOME && !ehRemoto(opts.cwd)) args.push('--add-dir', HOME);

  /* leva 10.5 — worktree: branch isolada em .claude/worktrees/<nome>, que o proprio CLI cria
     (ou reaproveita) e onde ele trabalha. Fork de CODIGO, completando o de conversa.
     TODAS as linhas conferem ehRemoto: no painel da VPS o -w nem e cogitado. Sem opts.worktree
     nada aqui roda e o argv sai exatamente igual ao de sempre. */
  // validado no topo da funcao, antes do claudeStop; aqui so' usa o resultado
  const nomeWt = nomeWtPedido;
  if (nomeWt) args.push('-w', nomeDeWorktree(nomeWt));
  /* com -w o CLI entra em .claude/worktrees/<nome> ANTES de resolver a sessao: o .jsonl nasce
     na pasta do worktree, e o caminho que emitimos tem de ser esse (senao a conversa nao volta).
     A trava do args.includes e obrigatoria: nome recusado pelo git nao vira pasta nenhuma. */
  if (nomeWt && args.includes('-w')) claudeCwd.set(paneId, path.join(opts.cwd || HOME, '.claude', 'worktrees', nomeDeWorktree(nomeWt)));

  let proc;
  if (ehRemoto(opts.cwd)) {
    // roda o Claude DENTRO da VPS: o mesmo fluxo de stream-json vem pelo SSH
    const r = partesRemoto(opts.cwd);
    const semLocal = args.filter((a, i) => {
      if (a === '--settings' || a === '--setting-sources') return false;
      const antes = args[i - 1];
      return antes !== '--settings' && antes !== '--setting-sources';
    });
    const comando = 'cd ' + aspaSh(r.caminho) + ' && claude ' + semLocal.map(aspaSh).join(' ');
    // detached: o Claude pode ter filho seu (MCP server); sem isto o filho fica orfao vivo
    // quando o painel fecha, porque o kill so' atinge o processo principal (ver matarGrupoExtra)
    proc = spawn('ssh', argsSsh(r, comando), { env: buildEnv(), stdio: ['pipe', 'pipe', 'pipe'], detached: !EH_WIN });
  } else {
    proc = spawnBin(CLAUDE_BIN, args, { cwd: opts.cwd || HOME, env: buildEnv(), stdio: ['pipe', 'pipe', 'pipe'], detached: !EH_WIN });
  }
  const st = { proc, buf: '' };
  const decoder = new StringDecoder('utf8');
  claudePanes.set(paneId, st);

  proc.stdout.on('data', (chunk) => {
    if (claudePanes.get(paneId) !== st || st.parandoDeProposito) return;
    st.buf += decoder.write(chunk);
    let i;
    while ((i = st.buf.indexOf('\n')) >= 0) {
      const line = st.buf.slice(0, i).trim(); st.buf = st.buf.slice(i + 1);
      if (!line) continue;
      let m; try { m = JSON.parse(line); } catch { continue; }
      claudeMessage(paneId, m);
    }
  });
  proc.stderr.on('data', (c) => {
    if (claudePanes.get(paneId) !== st || st.parandoDeProposito) return;
    const t = String(c).trim();
    // ruido normal do ssh nao vira aviso; erro de verdade sim
    if (!t || /Warning: Permanently added|Pseudo-terminal/i.test(t)) return;
    // Antes, tudo que o Claude local escrevia aqui era jogado fora, e o chat so dizia
    // "A conexao caiu" — sem nunca mostrar a frase em que o proprio CLI explica o problema
    // (conta vencida, conversa que nao existe mais, modelo invalido). Agora fica guardado.
    st.erro = ((st.erro || '') + t + '\n').slice(-1000);
    if (ehRemoto(opts.cwd)) emit(paneId, 'note', { text: 'VPS: ' + t.slice(0, 300), error: true });
  });
  // Se o processo do claude ja morreu e alguem escreve no stdin dele, o Node emite 'error'
  // no stream. Evento 'error' sem ouvinte = excecao nao tratada = o Electron inteiro fecha,
  // levando junto todas as abas e todos os chats. Este ouvinte e o que impede isso.
  proc.stdin.on('error', (e) => {
    anota('stdin do claude caiu:', e && e.message);
    if (claudePanes.get(paneId) !== st) return;
    claudePanes.delete(paneId);
    if (!st.parandoDeProposito) emit(paneId, 'engine-down', {});
  });
  // handshake que liga o canal de permissao (e devolve a lista de skills)
  try { proc.stdin.write(JSON.stringify({ type: 'control_request', request_id: 'init-' + paneId, request: { subtype: 'initialize', hooks: {} } }) + '\n'); } catch {}
  proc.on('close', (code) => {
    // so apaga se o registro ainda for DESTE processo. Se o painel ja subiu um claude novo
    // (troca de modelo, de modo, de esforco), apagar aqui mataria o registro do novo: o chat
    // ficaria com "a conexao caiu" mentindo e sobraria um processo orfao rodando escondido.
    if (claudePanes.get(paneId) !== st) return;
    claudePanes.delete(paneId);
    if (st.parandoDeProposito) return;
    // diz o MOTIVO, em vez de so "a conexao caiu"
    if (st.erro) emit(paneId, 'note', { text: st.erro.trim().slice(-400), error: true });
    else if (code) emit(paneId, 'note', { text: 'O Claude saiu com erro (código ' + code + ').', error: true });
    // UNICO caso em que o fio da conversa deve ser solto: o proprio Claude avisa que aquela
    // conversa nao existe mais. Em toda outra queda (limite de uso, internet, ssh) o id
    // continua valendo e a proxima mensagem TEM de voltar para ela.
    if (st.erro && /No conversation found with session ID/i.test(st.erro)) emit(paneId, 'sessao-sumiu', {});
    emit(paneId, 'engine-down', {});
  });
  proc.on('error', (e) => {
    const meu = claudePanes.get(paneId) === st;
    if (!meu || st.parandoDeProposito) return;
    if (meu) claudePanes.delete(paneId);
    emit(paneId, 'note', { text: 'Erro: ' + e.message, error: true });
    // o 'close' que vem em seguida sai calado (a guarda ve que o registro ja nao e deste
    // processo), entao o aviso que DESTRAVA a tela precisa sair daqui: sem ele o chat fica
    // girando "trabalhando..." para sempre quando o claude nem consegue abrir
    if (meu && !st.parandoDeProposito) emit(paneId, 'engine-down', {});
  });
  return true;
}

function claudeStop(paneId) {
  const st = claudePanes.get(paneId);
  let matando = Promise.resolve();
  if (st) {
    st.parandoDeProposito = true;
    claudePanes.delete(paneId);
    // mata o GRUPO, nao so' o processo: filho que o Claude tenha disparado (MCP server) senao
    // fica orfao rodando escondido (precisa do spawn com detached: !EH_WIN acima)
    matando = matarGrupoExtra(st.proc);
  }
  const delta = filaDelta.get(paneId);
  if (delta) { clearTimeout(delta.timer); filaDelta.delete(paneId); }
  for (const [key, pending] of pendingApprovals) if (pending.paneId === paneId && pending.kind === 'claude') pendingApprovals.delete(key);
  claudeCwd.delete(paneId);   // R2-036: senao fica crescendo pra sempre, um chat fechado atras do outro
  avisoSinteticoAnterior.delete(paneId);   // R3-013: mesma razao, senao cresce pra sempre
  return matando;   // R2-034: shutdown() espera este SIGKILL de garantia antes de fechar o app
}

/* Unico lugar que fala com o claude. Antes cada comando escrevia direto no stdin, e escrever
   num processo que acabou de morrer derrubava o app inteiro. Aqui a escrita e sempre
   protegida, e quando falha o painel recebe "engine-down" em vez de ficar pendurado. */
function escreverClaude(paneId, obj) {
  const st = claudePanes.get(paneId);
  if (!st || !st.proc || !st.proc.stdin || st.proc.stdin.destroyed || !st.proc.stdin.writable) {
    // Nao basta devolver false: sem o 'engine-down' a tela mantem "ja esta ligado" e o envio
    // seguinte pula o religar. O chat repetia "manda de novo que ele religa" para sempre.
    if (st && claudePanes.get(paneId) === st) claudePanes.delete(paneId);
    if (!st || !st.parandoDeProposito) emit(paneId, 'engine-down', {});
    return false;
  }
  try {
    st.proc.stdin.write(JSON.stringify(obj) + '\n');
    return true;
  } catch (e) {
    anota('nao consegui falar com o claude:', e && e.message);
    if (claudePanes.get(paneId) === st) claudePanes.delete(paneId);
    emit(paneId, 'engine-down', {});
    return false;
  }
}

/* ---------- print que o agente tirou ----------
   Imagem dentro do RESULTADO de uma ferramenta. Ate aqui era jogada fora (no Claude) ou virava
   um paredao de base64 no texto do passo (no Codex). Dois formatos:
     Claude    -> { type:'image', source:{ type:'base64', media_type, data } }
     MCP/Codex -> { type:'image', mimeType, data }
   Teto por imagem e por resultado: e' pra ver o print, nao pra guardar um filme na tela. */
const LIM_IMG_PASSO = 3 * 1024 * 1024;   // em base64 (~2,2 MB de png)
const MAX_IMG_PASSO = 4;
function imagensDoResultado(content) {
  const lista = Array.isArray(content) ? content
    : (content && Array.isArray(content.content) ? content.content : []);
  const out = [];
  // conta quantas sumiram por tamanho, pra quem chama poder avisar em vez de sumir calado
  out.descartadas = 0;
  for (const x of lista) {
    if (!x || x.type !== 'image') continue;
    const dados = (x.source && x.source.type === 'base64' && x.source.data) || x.data || '';
    if (!dados || typeof dados !== 'string') continue;
    if (dados.length > LIM_IMG_PASSO) { out.descartadas++; continue; }
    out.push({ mime: (x.source && x.source.media_type) || x.mimeType || 'image/png', dados });
    if (out.length >= MAX_IMG_PASSO) break;
  }
  return out;
}

function claudeMessage(paneId, m) {
  if (m.type === 'prompt_suggestion') {
    const raw = m.suggestion ?? m.prompt ?? m.text ?? m.value;
    const itens = [...new Set((Array.isArray(raw) ? raw : [raw]).map(x =>
      typeof x === 'string' ? x : x && typeof x === 'object' ? (x.text || x.prompt || x.suggestion || '') : '')
      .filter(x => typeof x === 'string' && x.trim()).map(x => x.trim().slice(0, 4000)))].slice(0, 2);
    if (itens.length) emit(paneId, 'sugestao', { itens });
    return;
  }

  if (m.type === 'control_response') return;
  if (m.type === 'control_request' && m.request && m.request.subtype === 'can_use_tool') {
    const key = 'cl_' + paneId + '_' + m.request_id;
    /* tool + mudanca: o cartão de autorização do redesenho mostra o antes/depois do que ele vai
       permitir (README, "Pedido de autorização"). O ACP já mandava; o Claude saía sem diff. É o
       MESMO dado que o passo de edição usa (dadosDaEdicao), só que antes de ele permitir. */
    const dadosEvento = {
      key, title: 'Claude quer usar: ' + (m.request.tool_name || 'ferramenta'),
      detail: claudeToolArg(m.request.tool_name, m.request.input), reason: '',
      tool: m.request.tool_name || '', mudanca: dadosDaEdicao(m.request.tool_name, m.request.input),
    };
    // o antes/depois do cartão ganha o número da linha quando dá para saber (arquivo no Mac)
    if (dadosEvento.mudanca && !ehRemoto(claudeCwd.get(paneId))) numerarPedidoDeEdicao(m.request.tool_name, m.request.input, dadosEvento.mudanca);
    /* "Sempre permitir" (README, "Pedido de autorização"): o botão só aparece quando o PRÓPRIO
       Claude oferece a regra (permission_suggestions) e não pediu para esconder
       (suppress_always_allow_rule). A resposta "sempre" devolve essas mesmas sugestões em
       updatedPermissions: quem decide o alcance da regra é o Claude, igual ao terminal dele. */
    const sugestoes = Array.isArray(m.request.permission_suggestions) ? m.request.permission_suggestions.filter(s => s && typeof s === 'object') : [];
    const podeSempre = sugestoes.length > 0 && m.request.suppress_always_allow_rule !== true;
    dadosEvento.allowAlways = podeSempre;
    // "não aprovável por uma tecla perdida": o Enter não permite este pedido, só o clique
    if (m.request.default_to_no === true) dadosEvento.semEnter = true;
    /* a sugestão de "editar sem perguntar nesta sessão" é uma troca de modo: a tela precisa
       saber, senão o botão de permissão continuava dizendo "Manual" com o Claude editando sozinho */
    const trocaModo = podeSempre && sugestoes.find(s => s.type === 'setMode' && typeof s.mode === 'string');
    const modoDaTela = trocaModo && Object.keys(CLAUDE_MODE).find(k => CLAUDE_MODE[k] === trocaModo.mode);
    if (modoDaTela) dadosEvento.sempreModo = modoDaTela;
    // evento guardado igual ao emit: e o que 'pane:estado' devolve pro celular reconectar sem perder a tarja
    pendingApprovals.set(key, { kind: 'claude', paneId, reqId: m.request_id, input: m.request.input, sugestoes: podeSempre ? sugestoes : null, evento: { tipo: 'approval', dados: dadosEvento } });
    emit(paneId, 'approval', dadosEvento);
    return;
  }
  if (m.type === 'stream_event' && m.event) {
    const ev = m.event;
    if (ev.type === 'content_block_delta') {
      const d = ev.delta || {};
      if (d.type === 'text_delta') emitDelta(paneId, 'b' + ev.index, d.text || '');
      else if (d.type === 'thinking_delta') emit(paneId, 'think-delta', { text: d.thinking || '' });
    }
    return;
  }
  if (m.type === 'assistant' && m.message) {
    (m.message.content || []).forEach((c, i) => {
      if (c.type === 'text') {
        emit(paneId, 'text-final', { id: 'b' + i, text: c.text || '' });
        /* R3-013: quando a API recusa por limite de sessao (ou outro erro sintetico: 529,
           sem internet, deslogado), o CLI nao cai — devolve isso como texto de assistente
           comum (m.message.model === '<synthetic>'). Sem checagem nenhuma, o Cockpit tratava
           igual resposta de verdade: nao avisava nada, e cada 'Continue' so duplicava a mesma
           instrucao no historico, sem nenhum trabalho acontecendo. Reaproveita o canal 'note'
           (generico, ja chega no Mac e no iPhone) com o texto ORIGINAL do CLI — nao inventa
           frase fixa de 'limite de sessao' porque o mesmo caminho cobre outros erros sinteticos
           tambem. Dedupe: so avisa de novo se o texto mudar, senao cada retentativa ('Continue')
           enche a tela com o mesmo aviso repetido. */
        if (m.message.model === '<synthetic>') {
          if (c.text && avisoSinteticoAnterior.get(paneId) !== c.text) {
            avisoSinteticoAnterior.set(paneId, c.text);
            emit(paneId, 'note', { text: c.text, error: true });
          }
        }
        // R4-003: texto de modelo DE VERDADE no meio da conversa prova que o episodio de erro
        // sintetico passou. Limpa o dedupe aqui, senao o MESMO aviso (ex.: limite semanal fixo)
        // que bater de novo mais tarde na mesma conversa fica engolido pra sempre.
        else if (c.text) avisoSinteticoAnterior.delete(paneId);
      }
      /* O agente te chamou (PushNotification). Sem terminal, o CLI descarta a notificacao e
         responde "not sent": a chamada passa por aqui ANTES disso e o Cockpit entrega ele
         mesmo — tambem quando vem de um sub-agente, porque quem chamou foi ele do mesmo jeito.
         O ramo generico de tool_use logo abaixo segue intocado. */
      else if (c.type === 'tool_use' && c.name === 'PushNotification') {
        const texto = [c.input && c.input.title, c.input && c.input.message]
          .filter(Boolean).join(': ').replace(/\s+/g, ' ').trim().slice(0, 300);
        if (texto) emit(paneId, 'aviso-agente', { texto });
        emit(paneId, 'tool-start', { id: c.id, name: c.name, arg: texto, edicao: null, tarefas: null });
      }
      else if (c.type === 'tool_use') emit(paneId, 'tool-start', {
        id: c.id, name: c.name, arg: claudeToolArg(c.name, c.input),
        edicao: dadosDaEdicao(c.name, c.input),
        tarefas: c.name === 'TodoWrite' && c.input ? c.input.todos : null,
      });
    });
    return;
  }
  if (m.type === 'user' && m.message && Array.isArray(m.message.content)) {
    for (const c of m.message.content) {
      if (c.type === 'tool_result') {
        let txt = '';
        if (typeof c.content === 'string') txt = c.content;
        else if (Array.isArray(c.content)) txt = c.content.map(x => x && x.type === 'text' ? x.text : '').join('\n');
        const imagens = imagensDoResultado(c.content);
        // imagem grande demais (>3MB base64) sumia sem nenhum aviso; agora entra no texto
        if (imagens.descartadas) txt = (txt ? txt + '\n' : '') + '(' + (imagens.descartadas === 1 ? '1 imagem' : imagens.descartadas + ' imagens') + ' grande(s) demais para mostrar)';
        emit(paneId, 'tool-end', { id: c.tool_use_id, output: txt, error: !!c.is_error, ...(imagens.length ? { imagens } : {}) });
      }
    }
    return;
  }
  if (m.type === 'system' && m.subtype === 'init' && m.session_id) {
    // o numero REAL da conversa so aparece aqui (ao ramificar ele nasce diferente do pedido)
    marcarDonoDoFio(paneId, m.session_id, 'claude');
    emit(paneId, 'sessao', { id: m.session_id, file: path.join(CLAUDE_PROJ, encodeCwd(claudeCwd.get(paneId) || HOME), m.session_id + '.jsonl') });
    return;
  }
  /* ---------- o time de agentes ----------
     Quando ele lanca subagente (ferramenta Agent) ou um workflow, o CLI ja conta TUDO por aqui:
     quem comecou, em que fase esta, que ferramenta cada um esta usando agora e quando terminou.
     Nada disso ia para a tela — o app so via o "tool_use" da chamada, uma linha igual a de um
     Read. Estes quatro avisos sao o que alimenta o painel de agentes; nao precisa de flag nova
     no CLI nem de ler arquivo no disco. */
  if (m.type === 'system' && m.subtype === 'task_started') {
    emit(paneId, 'agentes', { ev: 'inicio', id: m.task_id, toolId: m.tool_use_id,
      desc: m.description || '', tipo: m.subagent_type || '', classe: m.task_type || '',
      workflow: m.workflow_name || '', fundo: !!m.is_backgrounded, nivel: m.spawn_depth || 1,
      prompt: String(m.prompt || '').slice(0, 400), em: Date.now() });
    return;
  }
  if (m.type === 'system' && m.subtype === 'task_progress') {
    emit(paneId, 'agentes', { ev: 'andamento', id: m.task_id, desc: m.description || '',
      ferramenta: m.last_tool_name || '', resumo: String(m.summary || '').slice(0, 200),
      uso: m.usage || null, fluxo: Array.isArray(m.workflow_progress) ? m.workflow_progress : null,
      em: Date.now() });
    return;
  }
  if (m.type === 'system' && m.subtype === 'task_updated') {
    emit(paneId, 'agentes', { ev: 'mudou', id: m.task_id, patch: m.patch || {}, em: Date.now() });
    return;
  }
  if (m.type === 'system' && m.subtype === 'task_notification') {
    emit(paneId, 'agentes', { ev: 'fim', id: m.task_id, estado: m.status || 'completed',
      resumo: String(m.summary || '').slice(0, 300), uso: m.usage || null, em: Date.now() });
    return;
  }
  if (m.type === 'system' && m.subtype === 'background_tasks_changed') {
    emit(paneId, 'agentes', { ev: 'lista', tarefas: Array.isArray(m.tasks) ? m.tasks : [], em: Date.now() });
    return;
  }
  if (m.type === 'result') {
    const u = m.usage || {};
    let janela = 0;
    try { const mu = m.modelUsage || {}; const k = Object.keys(mu)[0]; if (k) janela = mu[k].contextWindow || 0; } catch {}
    emit(paneId, 'tokens', {
      total: (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_read_input_tokens || 0),
      janela: janela || undefined,
    });
    if (m.is_error) emit(paneId, 'note', { text: String(m.result || m.subtype), error: true });
    /* quanto o TURNO consumiu (nao o tamanho da conversa, que ja saiu no 'tokens' acima): vai
       pro carimbo de fim de turno. cache_read fica de fora — e' releitura, nao consumo novo.
       Nomes proprios porque o 'u' deste escopo ja e' o m.usage. */
    const entradaDoTurno = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0);
    const saidaDoTurno = u.output_tokens || 0;
    if (entradaDoTurno || saidaDoTurno) emit(paneId, 'turno-uso', { entrada: entradaDoTurno, saida: saidaDoTurno });
    { const st = claudePanes.get(paneId); if (st) st.rodando = false; }   // acabou: some do aviso de fechar
    emit(paneId, 'turn-end', {});
  }
}

function claudeToolArg(name, inp) {
  if (!inp) return '';
  const v = inp.command || inp.file_path || inp.pattern || inp.query || inp.url || inp.description || inp.skill || inp.notebook_path;
  if (v) return String(v);
  try { return JSON.stringify(inp).slice(0, 160); } catch { return ''; }
}

/* ---------- o antes e o depois de cada edicao ----------
   A tela mostrava so "Editando arquivo.js" e o texto cru do resultado. Quem e visual nao le
   patch em texto. Aqui sai o par (antes, depois) de cada pedaco mexido, para o outro lado
   pintar de verde e vermelho — e para dar de desfazer depois. */
const PEDACO_MAX = 40000;               // nao adianta mandar arquivo gigante pelo cano do IPC
const CORTADO_MARCA = '\n… (cortado)';  // sufixo de corte: usado tambem no desfazer pra saber que o texto nao e' literal
const corta = (s) => { s = String(s == null ? '' : s); return s.length > PEDACO_MAX ? s.slice(0, PEDACO_MAX) + CORTADO_MARCA : s; };

function dadosDaEdicao(name, inp) {
  if (!inp) return null;
  const arquivo = inp.file_path || inp.notebook_path || '';
  if (!arquivo) return null;
  if ((name === 'Edit' || name === 'NotebookEdit') && typeof inp.old_string === 'string') {
    return { arquivo, partes: [{ antes: corta(inp.old_string), depois: corta(inp.new_string) }] };
  }
  if (name === 'MultiEdit' && Array.isArray(inp.edits)) {
    return { arquivo, partes: inp.edits.slice(0, 30).map(e => ({ antes: corta(e.old_string), depois: corta(e.new_string) })) };
  }
  if (name === 'Write' && typeof inp.content === 'string') {
    // le o arquivo ANTES de o motor gravar por cima: e o unico momento em que o "antes" existe
    let antes = '';
    let existia = false;
    try { antes = fs.readFileSync(arquivo, 'utf8'); existia = true; } catch {}
    return { arquivo, novo: !existia, partes: [{ antes: corta(antes), depois: corta(inp.content) }] };
  }
  return null;
}

/* Número da linha no antes/depois do PEDIDO de autorização (o diff do desenho tem a coluna do
   número). O Claude não manda a linha; mas no pedido o arquivo ainda está como era, então dá
   para achar o trecho nele. Só numera quando a conta é certa: o Write mostra o arquivo inteiro
   (começa na 1) e o Edit acha o trecho UMA vez só. Trecho repetido, arquivo grande, texto
   cortado ou MultiEdit (cada troca mexe no arquivo da seguinte): fica sem número, que é melhor
   do que um número que não é o do arquivo. Mexe só no objeto do cartão, nunca no passo. */
const NUMERAR_ATE = 2 * 1024 * 1024;
function numerarPedidoDeEdicao(name, inp, mudanca) {
  try {
    const p = mudanca && mudanca.partes && mudanca.partes.length === 1 ? mudanca.partes[0] : null;
    if (!p) return;
    if (name === 'Write') { p.linha = 1; return; }
    if (name !== 'Edit' || typeof inp.old_string !== 'string' || !inp.old_string || p.antes.endsWith(CORTADO_MARCA)) return;
    const st = fs.statSync(mudanca.arquivo);
    if (!st.isFile() || st.size > NUMERAR_ATE) return;
    const texto = fs.readFileSync(mudanca.arquivo, 'utf8');
    const i = texto.indexOf(inp.old_string);
    if (i < 0 || texto.indexOf(inp.old_string, i + 1) >= 0) return;
    p.linha = texto.slice(0, i).split('\n').length;
  } catch {}
}

/* desfazer uma edicao: troca de volta o pedaco novo pelo antigo, no arquivo de verdade */
handle('arquivo:desfazer', (_e, { arquivo, antes, depois }) => {
  try {
    if (!arquivo) return { error: 'sem arquivo' };
    const antesStr = String(antes == null ? '' : antes);
    const novo = String(depois == null ? '' : depois);
    // texto cortado (edicao grande) nunca existe literal no arquivo: desfazer aqui so recusaria com
    // mensagem falsa ("arquivo mudou") ou, pior, cortaria o arquivo de verdade - bloqueia direto e honesto
    if (novo.endsWith(CORTADO_MARCA) || antesStr.endsWith(CORTADO_MARCA)) {
      return { error: 'edição grande demais para desfazer automaticamente' };
    }
    const atual = fs.readFileSync(arquivo, 'utf8');
    if (!novo) return { error: 'não sei o que tirar' };
    const onde = atual.indexOf(novo);
    if (onde < 0) return { error: 'o arquivo mudou depois dessa edição — desfazer aqui ia estragar' };
    if (atual.indexOf(novo, onde + 1) >= 0) return { error: 'esse trecho aparece mais de uma vez no arquivo' };
    fs.writeFileSync(arquivo, atual.slice(0, onde) + antesStr + atual.slice(onde + novo.length), 'utf8');
    return { ok: true };
  } catch (e) { return { error: e.message }; }
});

/* ======================= arvore de arquivos ======================= */
const IGNORE = new Set(['node_modules', '.git', '.DS_Store', 'dist', 'build', '__pycache__', '.venv', 'venv', '.next', '.cache', 'Library']);
function listDir(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return { error: e.message }; }
  const out = [];
  for (const e of entries) {
    if (e.name.startsWith('.') && !['.claude', '.codex', '.env.example'].includes(e.name)) continue;
    if (IGNORE.has(e.name)) continue;
    let isDir = e.isDirectory();
    if (e.isSymbolicLink()) { try { isDir = fs.statSync(path.join(dir, e.name)).isDirectory(); } catch { continue; } }
    out.push({ name: e.name, dir: isDir, path: path.join(dir, e.name) });
  }
  out.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1));
  return { entries: out.slice(0, 800) };
}


/* ======================= trabalhar direto na VPS =======================
   Uma pasta remota vem escrita como "vps:/caminho/na/vps". Tudo que fala com
   pasta (motor, arvore de arquivos, visor) passa por aqui e vira comando por SSH.
   O Claude/Codex rodam LA, entao e a conta e o disco da VPS que valem. */
const SERVIDORES = {
  vps: { host: 'vps', usuario: 'homero', nome: 'VPS' },
};
const ehRemoto = (cwd) => /^[a-z0-9_-]+:\//i.test(String(cwd || '')) && !!SERVIDORES[String(cwd).split(':')[0]];
function partesRemoto(cwd) {
  const txt = String(cwd || '');
  const chave = txt.slice(0, txt.indexOf(':'));
  const srv = SERVIDORES[chave];
  if (!srv) return null;
  return { chave, ...srv, caminho: txt.slice(chave.length + 1) || '/' };
}
// aspas de shell: o unico jeito seguro de mandar texto com espaco, acento e quebra de linha
const aspaSh = (t) => "'" + String(t).replace(/'/g, "'\\''") + "'";

function linhaNoServidor(r, comando) {
  const dentro = 'bash -lc ' + aspaSh(comando);
  return r.usuario ? 'sudo -u ' + r.usuario + ' -H ' + dentro : dentro;
}
/* O ServerAliveInterval sozinho pergunta de 20 em 20 segundos, mas o ssh desiste na 3a
   pergunta sem resposta: 60s de silencio e a conversa da VPS caia no meio do trabalho.
   Com CountMax=6 a espera vai pra 120s (o dobro), e o TCPKeepAlive faz o proprio sistema
   segurar a tomada quando o roteador de casa tenta fechar a porta por inatividade. */
function argsSsh(r, comando) {
  return ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=12', '-o', 'ServerAliveInterval=20',
    '-o', 'ServerAliveCountMax=6', '-o', 'TCPKeepAlive=yes', r.host, linhaNoServidor(r, comando)];
}
// roda um comando na VPS e devolve a saida (para listar pasta, ler arquivo, etc.)
function noServidor(r, comando, ms = 20000) {
  return new Promise((res) => {
    const p = spawn('ssh', argsSsh(r, comando), { env: buildEnv() });
    let out = '', erro = '';
    const t = setTimeout(() => { try { p.kill(); } catch {} res({ error: 'a VPS demorou demais para responder' }); }, ms);
    p.stdout.on('data', (c) => { out += c.toString('utf8'); });
    p.stderr.on('data', (c) => { erro += c.toString('utf8'); });
    p.on('error', (e) => { clearTimeout(t); res({ error: e.message }); });
    p.on('close', (code) => {
      clearTimeout(t);
      if (code !== 0) return res({ error: (erro || out || 'a VPS respondeu com erro ' + code).trim().slice(0, 300) });
      // varias ferramentas (o codex, por exemplo) escrevem o status no stderr mesmo dando certo
      res({ out: out || erro });
    });
  });
}

async function listDirRemoto(cwd) {
  const r = partesRemoto(cwd);
  if (!r) return { error: 'servidor desconhecido' };
  // "-p" poe barra no fim das pastas: e assim que sei quem e pasta sem outra chamada
  const rr = await noServidor(r, 'ls -1Ap -- ' + aspaSh(r.caminho));
  if (rr.error) return { error: rr.error };
  const out = [];
  for (const linha of rr.out.split('\n')) {
    const nome0 = linha.replace(/\r$/, '');
    if (!nome0) continue;
    const dir = nome0.endsWith('/');
    const nome = dir ? nome0.slice(0, -1) : nome0;
    if (nome.startsWith('.') && !['.claude', '.codex', '.env.example'].includes(nome)) continue;
    if (IGNORE.has(nome)) continue;
    const base = r.caminho.endsWith('/') ? r.caminho : r.caminho + '/';
    out.push({ name: nome, dir, path: r.chave + ':' + base + nome });
  }
  out.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1));
  return { entries: out.slice(0, 800) };
}

async function lerArquivoRemoto(f) {
  const r = partesRemoto(f);
  if (!r) return { error: 'servidor desconhecido' };
  const rr = await noServidor(r, 'if [ $(stat -c%s -- ' + aspaSh(r.caminho) + ') -gt 512000 ]; then echo GRANDE_DEMAIS >&2; exit 1; fi; cat -- ' + aspaSh(r.caminho));
  if (rr.error) return { error: /GRANDE_DEMAIS/.test(rr.error) ? 'Arquivo grande demais para ver aqui.' : rr.error };
  return { content: rr.out };
}

/* ============ SSH: por que falhou, e conexao reaproveitada (bloco NOVO) ============
   Nada aqui encosta no noServidor nem no argsSsh de cima: aqueles servem o visor, o seletor
   de pasta e — o argsSsh — os spawns LONGOS do Claude e do Codex rodando na VPS. Funcionam
   hoje e ficam como estao. O que entra por aqui e o caminho NOVO (arvore de arquivos, visor
   remoto, lista de conversas da VPS), que e justamente o que dispara muitas idas seguidas
   ao servidor e paga caro por isso.                                                       */

/* O ssh explica a falha no stderr, em ingles e no jargao dele. Aqui isso vira uma frase que
   diz o que houve e o que fazer — antes tudo virava lista vazia, que na tela e indistinguivel
   de "essa pasta nao tem nada".
   No fork de origem as frases mandavam "conferir em Editar aba"; aqui nao existe essa tela:
   o endereco da VPS mora no SERVIDORES e no ~/.ssh/config do Mac. */
function motivoDoSsh(txt, r) {
  const s = String(txt || '');
  const host = (r && r.host) || 'vps';
  const onde = ' (' + host + ')';
  const noConfig = ' Confira o host "' + host + '" no seu ~/.ssh/config.';
  if (/Permission denied|denied \(publickey/i.test(s))
    return 'O servidor' + onde + ' recusou a chave.' + noConfig;
  if (/no such identity|could not open user config|Load key.*No such file/i.test(s))
    return 'Não achei o arquivo da chave aqui no Mac.' + noConfig;
  if (/REMOTE HOST IDENTIFICATION HAS CHANGED|Host key verification failed/i.test(s))
    return 'A identidade do servidor' + onde + ' mudou (foi reinstalado?). Por segurança o ssh recusou — limpe a linha dele no ~/.ssh/known_hosts.';
  if (/Connection refused/i.test(s))
    return 'O servidor' + onde + ' recusou a conexão. O SSH está no ar? A porta é a 22?';
  if (/Connection timed out|Operation timed out|No route to host/i.test(s))
    return 'Não alcancei o servidor' + onde + '. Ele está no ar e liberado para o seu IP?';
  if (/Could not resolve hostname|Name or service not known/i.test(s))
    return 'Não achei o endereço' + onde + '.' + noConfig;
  if (/ssh_exchange_identification/i.test(s))
    return 'O servidor' + onde + ' está recusando conexões novas agora (muitas de uma vez). Tente de novo em instantes.';
  const linha = s.split('\n').map(x => x.trim()).filter(x => x && !/^Warning: Permanently added/i.test(x))[0];
  return linha ? ('O servidor' + onde + ' respondeu: ' + linha.slice(0, 160)) : '';
}

/* ---------- conexao reaproveitada (ControlMaster) ----------
   Abrir a arvore de uma pasta na VPS custa uma conexao SSH NOVA por pasta expandida: medido
   ~0,47s cada. Pior: o sshd padrao (MaxStartups 10:30:100) comeca a RECUSAR quando sao muitas
   de uma vez, e a frase de "muitas conexoes de uma vez" viraria rotina.
   Com ControlMaster a primeira conexao fica guardada num socket e as seguintes entram por
   dentro dela: 0,47s -> 0,09s.
   O OpenSSH do macOS multiplexa de verdade (o do Windows nao — por isso o fork de origem tem
   uma sonda inteira que aqui nao faz falta). Mesmo assim nada e prometido: se a ida COM socket
   falhar, o noServidorSsh tenta UMA vez sem ele; se ai der certo, o multiplexing sai de cena
   pelo resto da sessao e tudo segue funcionando do jeito de sempre. */
let muxLigado = true;      // fica sempre ligado; socket preso se descarta sozinho, nao se desiste dele
const sockUsados = new Set();   // sockets que ESTE app abriu — so nesses o "-O exit" pode mandar

function pastaSsh() {
  const dir = path.join(app.getPath('userData'), 'ssh');
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
  return dir;
}
/* Socket de dominio Unix tem teto de ~104 caracteres no caminho INTEIRO. Por isso o nome e
   curto e so [a-z0-9-]: "cm-" + 16 do sha1. Da 78 caracteres aqui, com folga.
   Sha1 do HOST (nao de usuario@host): quem conecta e sempre o mesmo usuario do ~/.ssh/config;
   o "usuario" do SERVIDORES e para quem o sudo troca DEPOIS, ja dentro da maquina. */
function caminhoDoSocket(r) {
  const nome = 'cm-' + crypto.createHash('sha1').update(String((r && r.host) || '')).digest('hex').slice(0, 16);
  const p = path.join(pastaSsh(), nome);
  /* Aspa dupla ou quebra de linha no caminho quebrariam o proprio -o do ssh (ver opSock).
     Se a pasta do usuario tiver alguma delas, o multiplexing simplesmente nao entra. */
  if (/["\r\n]/.test(p)) return '';
  /* Socket de dominio Unix tem teto DURO de 104 bytes no caminho inteiro; o proprio ssh
     recusa com "ControlPath too long" e sai 255. Na maquina dele da 78 e passa folgado, mas
     numa userData mais funda (ja aconteceu num teste, com 151) e melhor nem tentar do que
     gastar uma chamada perdida antes de cair no modo simples. */
  return Buffer.byteLength(p) >= 104 ? '' : p;
}
/* MEDIDO NA MAQUINA DELE (08/09/2026, e o teste pegou isto): o caminho do socket TEM espaco
   — a userData no Mac e ".../Library/Application Support/Cockpit". Sem aspas, o proprio ssh
   recusa a opcao com "keyword controlpath extra arguments at end of line", devolve 255 em
   ~10ms e TODA chamada da arvore falharia. As aspas duplas sao lidas pelo parser de opcoes
   do ssh e nao entram no nome do arquivo. */
const opSock = (sock) => 'ControlPath="' + sock + '"';
/* Os MESMOS argumentos do argsSsh (que nao se toca) mais as tres opcoes do multiplexing.
   Usado so nas idas CURTAS: a conversa do motor nunca troca de linha de comando. */
function argsSshMux(r, comando, sock) {
  const a = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=12', '-o', 'ServerAliveInterval=20',
    '-o', 'ServerAliveCountMax=6', '-o', 'TCPKeepAlive=yes'];
  if (sock) a.push('-o', 'ControlMaster=auto', '-o', opSock(sock), '-o', 'ControlPersist=120');
  a.push(r.host, linhaNoServidor(r, comando));
  return a;
}
/* O mestre do ControlPersist segue vivo em segundo plano depois da ultima chamada (ate 120s),
   segurando uma conexao aberta. Fechar o Cockpit pede pra ele sair AGORA, em vez de deixar
   processo e conexao pendurados. Se o pedido nao chegar, ele morre sozinho no tempo dele.
   So manda o "-O exit" em socket DESTA pasta: existe outro ControlMaster nesta casa (o robo
   espelho-vps), e derrubar o mestre dele quebraria um robo que nao e nosso. */
function fecharMestresSsh() {
  const nossa = pastaSsh();
  for (const sock of [...sockUsados]) {
    if (path.dirname(sock) !== nossa) continue;   // nao nasceu aqui: nao encosta
    try {
      // com o ControlPath explicito o nome do host nao serve pra nada, mas o ssh exige um
      const p = spawn('ssh', ['-O', 'exit', '-o', opSock(sock), 'cockpit'],
        { env: buildEnv(), stdio: 'ignore' });
      p.on('error', () => {});
      p.unref();
    } catch {}
  }
  sockUsados.clear();
}

/* Uma ida ao servidor. NUNCA rejeita: devolve {code,out,errout}, mais {falhou} quando nem
   chegou a chamar o ssh e {estourou} quando passou do tempo. */
function sshUmaVez(r, comando, ms, sock) {
  return new Promise((res) => {
    let p;
    try { p = spawn('ssh', argsSshMux(r, comando, sock), { env: buildEnv(), stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (e) { return res({ code: -1, out: '', errout: String((e && e.message) || e), falhou: true }); }
    if (sock) sockUsados.add(sock);
    let out = '', errout = '', acabou = false;
    const fim = (x) => { if (acabou) return; acabou = true; clearTimeout(t); res(x); };
    const t = setTimeout(() => { try { p.kill(); } catch {} fim({ code: -1, out, errout, estourou: true }); }, ms || 20000);
    // 48 MB de folga: o teto de imagem do visor (25 MB) vira ~34 MB depois do base64
    p.stdout.on('data', (d) => { if (out.length < 48 * 1024 * 1024) out += d.toString('utf8'); });
    p.stderr.on('data', (d) => { if (errout.length < 8000) errout += d.toString('utf8'); });
    p.on('error', (e) => fim({ code: -1, out, errout: String((e && e.message) || e), falhou: true }));
    /* o normal e o 'close' chegar logo depois do 'exit'. Mas o ssh que fica de MESTRE
       (ControlPersist) segue vivo em segundo plano, e se ele segurar o cano de saida o
       'close' nunca vem — por isso o 'exit' tambem fecha, com um respiro para terminar de
       ler o que ja chegou. */
    p.on('exit', (code) => { setTimeout(() => fim({ code, out, errout }), 250); });
    p.on('close', (code) => fim({ code, out, errout }));
  });
}

/* Uma ida ao servidor para as chamadas CURTAS (arvore, visor, conversas da VPS).
   Diferente do noServidor, devolve o CODIGO DE SAIDA: comando remoto que sai 1 — um find que
   nao achou nada, por exemplo — e RESPOSTA, nao falha de conexao. So o 255 e do proprio ssh,
   e so nele entra a frase do motivoDoSsh. Nunca rejeita. */
async function noServidorSsh(r, comando, ms) {
  if (!r || !r.host) return { code: -1, error: 'servidor desconhecido' };
  const sock = muxLigado ? caminhoDoSocket(r) : '';
  let x = await sshUmaVez(r, comando, ms, sock);
  // R2-044: aqui marcava numa variavel de controle que so era ESCRITA, nunca lida — tirada
  if (sock && (x.falhou || x.estourou || x.code === 255)) {
    /* R1-008: a 1a tentativa (com socket) ja gastou ate' 'ms' inteiro. Repetir do zero com o
       MESMO teto dobrava a espera de cada clique quando a VPS esta fora do ar (o log real ja
       mostra ETIMEDOUT). Se ela ESTOUROU o tempo, o host esta inacessivel: tentar de novo nao
       muda o resultado, entao pula a 2a rodada. Nas outras falhas (recusa do socket, sai 255)
       da' um teto curto (8s) pra 2a tentativa em vez do 'ms' inteiro — piso decente pra' nao
       cortar uma recuperacao real que so' precisava de mais um instante. */
    if (x.estourou) return { code: -1, out: x.out, errout: x.errout, error: 'a VPS demorou demais para responder' };
    const y = await sshUmaVez(r, comando, Math.min(ms || 20000, 8000), '');
    if (!y.falhou && !y.estourou && y.code === 0) {
      fecharMestresSsh();
      try { fs.unlinkSync(sock); } catch {}
      return { code: 0, out: y.out, errout: y.errout };
    }
    x = y;
  }
  if (x.estourou) return { code: -1, out: x.out, errout: x.errout, error: 'a VPS demorou demais para responder' };
  if (x.falhou) return { code: -1, out: '', errout: x.errout, error: 'não consegui chamar o ssh: ' + String(x.errout).slice(0, 200) };
  const res = { code: x.code, out: x.out, errout: x.errout };
  if (x.code === 255) res.error = motivoDoSsh(x.errout, r) || ('Não consegui falar com o servidor (' + r.host + ').');
  return res;
}

/* ---------- listagem remota robusta ----------
   "find -printf" e "base64 -w0" sao do GNU. Num BusyBox/Alpine ou num BSD o find nem entende a
   opcao: ele falha, o 2>/dev/null engole o motivo, e o codigo de saida do cano e o do ULTIMO
   comando (o base64, que sai 0 com entrada vazia). Sem a sonda abaixo isso chegaria aqui como
   lista vazia e a tela diria "pasta vazia" — erro virando resultado.
   A sonda custa nada e vai no MESMO comando (nenhuma ida a mais ao servidor). A VPS dele e
   Ubuntu, entao hoje ela nunca dispara — fica pro dia em que ele abrir uma aba num Alpine. */
const SONDA_GNU = "find . -maxdepth 0 -printf '' >/dev/null 2>&1 || { echo COCKPIT_FIND_SEM_PRINTF; exit 0; }; "
  + "printf '' | base64 -w0 >/dev/null 2>&1 || { echo COCKPIT_SEM_BASE64; exit 0; }; ";
const AVISO_SEM_GNU = 'Este servidor não tem o find e o base64 do GNU (é Alpine/BusyBox ou BSD?). '
  + 'O Cockpit ainda não sabe listar arquivos aí — não é que a pasta esteja vazia.';
const erroDaSondaGnu = (bruto) => (/^COCKPIT_(FIND_SEM_PRINTF|SEM_BASE64)/.test(String(bruto || '')) ? AVISO_SEM_GNU : '');

/* desempacota a resposta em base64 de um "-printf ... \0". O ultimo pedaco tem que ser vazio
   (todo registro termina em NUL); quando nao e, o "head -c" cortou no meio de um nome e
   aquele pedaco vai fora em vez de virar um item torto na tela. */
function registrosNul(b64) {
  if (!b64) return { itens: [] };
  /* Buffer.from(...,'base64') NAO reclama de lixo: ele descarta o que nao for base64 e devolve
     bytes sem sentido, que viram lista vazia — erro do servidor virando "pasta vazia" de novo,
     agora calado. O "base64 -w0" nunca quebra linha, entao resposta com qualquer outro
     caractere e RECADO do servidor (banner, aviso de perfil), nao dado. */
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) {
    return { error: 'A resposta do servidor veio embaralhada: ' + b64.slice(0, 120) };
  }
  let texto = '';
  try { texto = Buffer.from(b64, 'base64').toString('utf8'); }
  catch { return { error: 'A resposta do servidor veio corrompida.' }; }
  const partes = texto.split('\0');
  if (partes.length && partes[partes.length - 1] !== '') partes.pop();
  return { itens: partes.filter(Boolean) };
}

/* A mesma pasta da arvore, dentro do servidor — versao NOVA, AO LADO da antiga (que continua
   servindo o seletor de pasta da VPS, intocada). Conserta tres buracos reais do "ls -1Ap":
   - nome com quebra de linha virava DOIS itens: aqui os campos vao separados por NUL e o
     pacote inteiro volta em base64, entao espaco, acento e quebra de linha chegam inteiros;
   - "%Y" (maiusculo) e o tipo DEPOIS de seguir o atalho, entao link-para-pasta aparece como
     pasta, igual ao ramo local ja faz com o statSync — com o "ls -p" os dois discordavam;
   - "head -c" poe teto na tragada: pasta com 200 mil arquivos nao vira resposta gigante.
   A peneira e a ordem sao feitas AQUI, com o mesmo IGNORE e a mesma comparacao do ramo local. */
async function listDirRemotoV2(cwd) {
  const r = partesRemoto(cwd);
  if (!r) return { error: 'servidor desconhecido' };
  const alvo = r.caminho;
  const script = 'cd -- ' + aspaSh(alvo) + ' 2>/dev/null || { echo COCKPIT_SEM_PASTA; exit 0; }; '
    + SONDA_GNU
    + "find . -mindepth 1 -maxdepth 1 -printf '%Y\\t%f\\0' 2>/dev/null | head -c 400000 | base64 -w0";
  const rr = await noServidorSsh(r, script, 20000);
  if (rr.error) return { error: rr.error };
  /* Comando remoto que morreu SEM dizer nada nao pode virar "pasta vazia" na tela. O
     noServidorSsh so preenche `error` no 255 (que e do proprio ssh); saida != 0 com stdout
     vazio — "set -o pipefail" no perfil do servidor, disco cheio, sudo negado, bash ausente —
     chegava aqui como lista vazia e a arvore desenhava a pasta VAZIA, calada. O noServidor
     antigo transformava qualquer codigo != 0 em recado, e esta linha devolve esse aviso.
     Exige stdout vazio de proposito: com pipefail, uma pasta enorme cortada pelo "head" sai
     141 COM lista boa, e isso e resultado, nao falha. */
  if (rr.code !== 0 && !String(rr.out || '').trim()) {
    return { error: String(rr.errout || '').trim().slice(0, 300)
      || ('A VPS respondeu com erro (código ' + rr.code + ') e não mandou a lista desta pasta.') };
  }
  const bruto = String(rr.out || '').trim();
  if (bruto.startsWith('COCKPIT_SEM_PASTA')) {
    return { error: 'Não consegui abrir a pasta ' + alvo + ' no servidor. Ela existe e você tem acesso a ela?' };
  }
  const semGnu = erroDaSondaGnu(bruto);
  if (semGnu) return { error: semGnu };
  const regs = registrosNul(bruto);
  if (regs.error) return regs;
  const base = alvo.endsWith('/') ? alvo : alvo + '/';
  const out = [];
  for (const rec of regs.itens) {
    const t = rec.indexOf('\t');
    if (t < 0) continue;                     // pedaco cortado pelo head: descarta
    const nome = rec.slice(t + 1);
    if (!nome) continue;
    if (nome.startsWith('.') && !['.claude', '.codex', '.env.example'].includes(nome)) continue;
    if (IGNORE.has(nome)) continue;
    out.push({ name: nome, dir: rec.slice(0, t) === 'd', path: r.chave + ':' + base + nome });
  }
  out.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1));
  return { entries: out.slice(0, 800) };
}

/* ============== completar caminho de arquivo com "@" no campo ==============
   Lista os arquivos da pasta do painel para o menu do "@". Guarda em memoria por 30s: sem
   isso cada tecla digitada varreria o disco de novo (e, na VPS, abriria uma conexao por
   letra). Os arquivos escondidos seguem a MESMA peneira da arvore (listDir): so passam os
   tres de sempre. */
const PONTO_OK = ['.claude', '.codex', '.env.example'];
const BUSCA_TETO = 20000;        // quantos caminhos ficam guardados por pasta
const BUSCA_PROF = 8;            // o mesmo teto do -maxdepth do ramo remoto
/* A pasta do painel PODE ser a home inteira, e ali sao milhares de pastas: varrer fundo
   travaria o processo principal e guardaria dezenas de MB de texto por 30s. Na home a
   varredura e rasa de proposito — quem trabalha na home nao esta procurando arquivo em
   nivel 8, esta so' anexando algo que ve na frente. */
const BUSCA_PROF_HOME = 2;
const BUSCA_TETO_HOME = 3000;
const cacheArquivos = new Map();   // "vps|/caminho" (ou "local|/caminho") -> { quando, lista }

function varrerArquivos(raiz, limite) {
  // R7: pasta remota nao se le com readdirSync. Sem esta linha o erro seria calado e a lista
  // vazia entraria no cache, envenenando o "@" daquele painel por 30 segundos.
  if (!raiz || ehRemoto(raiz)) return [];
  let naHome = false;
  try { naHome = path.resolve(raiz) === path.resolve(HOME); } catch {}
  const fundo = naHome ? BUSCA_PROF_HOME : BUSCA_PROF;
  const tetoVisitas = naHome ? 400 : 4000;
  const teto = Math.min(limite || BUSCA_TETO, naHome ? BUSCA_TETO_HOME : BUSCA_TETO);
  const achados = [];
  const fila = [{ dir: raiz, prof: 0 }];
  let visitadas = 0;
  while (fila.length && achados.length < teto && visitadas < tetoVisitas) {
    const { dir, prof } = fila.shift();
    visitadas++;
    let itens = [];
    try { itens = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of itens) {
      if (e.name.startsWith('.') && !PONTO_OK.includes(e.name)) continue;
      if (IGNORE.has(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (prof + 1 < fundo && fila.length < 2000) fila.push({ dir: p, prof: prof + 1 }); }
      else { achados.push(p); if (achados.length >= teto) break; }
    }
  }
  return achados;
}

/* A mesma varredura, dentro do servidor, num comando so'. As podas do find saem do MESMO
   IGNORE e do MESMO PONTO_OK do ramo local — e a mesma peneira, escrita em shell. O
   -maxdepth segura o custo, o "head -c" segura a tragada, e o base64 traz nome com espaco,
   acento e ate quebra de linha inteiro. Roda UMA vez a cada 30s (o cache la' de cima).
   O caminho volta COM o prefixo do servidor ("vps:/opt/..."): sem ele o "@" colaria
   "/opt/x.js" e o motor, o visor e o link do chat iriam procurar isso aqui no Mac. */
async function varrerArquivosRemoto(cwd, limite) {
  const r = partesRemoto(cwd);
  if (!r) return { error: 'servidor desconhecido' };
  const alvo = r.caminho || '/';
  const podas = [...IGNORE].filter((n) => !n.startsWith('.')).map((n) => '-name ' + aspaSh(n)).join(' -o ');
  const semPonto = "-name '.*' " + PONTO_OK.map((n) => '! -name ' + aspaSh(n)).join(' ');
  /* termina em "; exit 0": um servidor sem o CLI (ou um find que nao achou nada) sairia com
     codigo 1 e a tela mostraria isso como erro vermelho, quando e resposta. */
  const script = 'cd -- ' + aspaSh(alvo) + ' 2>/dev/null || { echo COCKPIT_SEM_PASTA; exit 0; }; '
    + SONDA_GNU
    + 'find . -mindepth 1 -maxdepth ' + BUSCA_PROF + ' \\( \\( ' + semPonto + ' \\)'
    + (podas ? ' -o ' + podas : '') + ' \\) -prune -o '
    + "-type f -printf '%p\\0' 2>/dev/null | head -c 2000000 | base64 -w0; exit 0";
  const rr = await noServidorSsh(r, script, 30000);
  if (rr.error) return { error: rr.error };
  // erro do servidor NAO pode virar "essa pasta nao tem arquivo nenhum" (a licao da leva 7)
  if (rr.code !== 0 && !String(rr.out || '').trim()) {
    return { error: String(rr.errout || '').trim().slice(0, 300)
      || ('A VPS respondeu com erro (código ' + rr.code + ') e não mandou a lista de arquivos.') };
  }
  const bruto = String(rr.out || '').trim();
  if (bruto.startsWith('COCKPIT_SEM_PASTA')) {
    return { error: 'Não consegui abrir a pasta ' + alvo + ' no servidor. Ela existe e você tem acesso a ela?' };
  }
  const semGnu = erroDaSondaGnu(bruto);
  if (semGnu) return { error: semGnu };
  const regs = registrosNul(bruto);
  if (regs.error) return regs;
  const lista = [];
  for (const p of regs.itens) {
    if (!p.startsWith('./')) continue;                                  // pedaco cortado pelo head
    lista.push(r.chave + ':' + path.posix.join(alvo, p.slice(2)));      // POSIX: la e Linux
    if (lista.length >= (limite || BUSCA_TETO)) break;
  }
  return { lista };
}

/* pontuacao do "@": nome igual > comeca com > contem > o caminho contem.
   O basename muda de dialeto conforme o alvo: caminho da VPS e sempre POSIX. */
function pontuarArquivos(lista, termo, remoto) {
  const pb = remoto ? path.posix : path;
  const base = (p) => pb.basename(String(p).replace(/^[a-z0-9_-]+:/i, ''));
  const alvo = String(termo || '').toLowerCase();
  if (!alvo) return lista.slice(0, 40).map((p) => ({ path: p, nome: base(p) }));
  const pontua = (p) => {
    const nome = base(p).toLowerCase();
    if (nome === alvo) return 0;
    if (nome.startsWith(alvo)) return 1;
    if (nome.includes(alvo)) return 2;
    if (String(p).toLowerCase().includes(alvo)) return 3;
    return 99;
  };
  return lista.map((p) => ({ p, s: pontua(p) })).filter((x) => x.s < 99)
    .sort((a, b) => a.s - b.s || a.p.length - b.p.length).slice(0, 40)
    .map((x) => ({ path: x.p, nome: base(x.p) }));
}

/* RESPOSTA de duas formas, de proposito: pasta do Mac devolve a LISTA crua; pasta da VPS
   devolve { itens, error } — falha de rede nao pode virar "essa pasta nao tem arquivo". */
handle('fs:buscarArquivos', async (_e, d) => {
  const o = (d && typeof d === 'object') ? d : {};
  const raiz = o.cwd || HOME;
  const rem = ehRemoto(raiz) ? partesRemoto(raiz) : null;
  const agora = Date.now();
  const chave = (rem ? rem.chave : 'local') + '|' + raiz;
  let c = cacheArquivos.get(chave);
  if (!c || (agora - c.quando) > 30000) {
    let lista;
    if (rem) {
      const r = await varrerArquivosRemoto(raiz, BUSCA_TETO);
      if (r.error) return { itens: [], error: r.error };   // falha NAO entra no cache
      lista = r.lista;
    } else {
      lista = varrerArquivos(raiz, BUSCA_TETO);
    }
    c = { quando: agora, lista };
    cacheArquivos.set(chave, c);
    if (cacheArquivos.size > 8) cacheArquivos.delete(cacheArquivos.keys().next().value);
  }
  const achados = pontuarArquivos(c.lista, o.termo, !!rem);
  return rem ? { itens: achados } : achados;
});

/* ======================= conversas recentes ======================= */
const CLAUDE_PROJ = path.join(HOME, '.claude/projects');
const NOMES_PATH = () => path.join(app.getPath('userData'), 'nomes.json');
function lerNomes() { try { return JSON.parse(fs.readFileSync(NOMES_PATH(), 'utf8')); } catch { return {}; } }
function salvarNomes(o) { gravarSeguro(NOMES_PATH(), JSON.stringify(o)); }

/* ======================= ligacoes entre conversas (troca de IA) =======================
   Trocar de IA no meio de um chat faz o motor novo abrir OUTRA conversa, no armazenamento
   DELE (o Claude em ~/.claude/projects, o Codex em ~/.codex/sessions...). Sem nada ligando os
   dois pedacos, a conversa virava duas metades em listas diferentes e reabrir uma mostrava so
   aquela metade. Este arquivo guarda, para cada conversa que nasceu de uma troca, qual era a
   parte anterior. Formato:
     { "v": 1, "ligacoes": { "<motor>:<id da nova>": { engine, id, file, cwd, quando,
                                                        anterior: { engine, id, file, cwd } } } }
   A chave e so motor+id (sem o arquivo): a parte nova e uma conversa so, e o Codex pode gravar
   o mesmo id em mais de uma .jsonl. Quem ve a lista monta a cadeia andando de anterior em
   anterior. Gravacao atomica pelo gravarSeguro, igual ao nomes.json. */
const LIGACOES_PATH = () => path.join(app.getPath('userData'), 'ligacoes.json');
function parteDaLigacao(p) {
  if (!p || typeof p !== 'object') return null;
  const engine = String(p.engine || ''), id = String(p.id || '');
  // motor e sempre uma palavra curta; id vazio ou gigante e lixo (arquivo editado na mao)
  if (!/^[a-z]{2,12}$/.test(engine) || !id || id.length > 200) return null;
  return {
    engine, id,
    file: typeof p.file === 'string' ? p.file.slice(0, 2000) : '',
    cwd: typeof p.cwd === 'string' ? p.cwd.slice(0, 2000) : '',
  };
}
function lerLigacoes() {
  let bruto = null;
  try { bruto = JSON.parse(fs.readFileSync(LIGACOES_PATH(), 'utf8')); }
  catch (e) {
    /* arquivo corrompido: guarda uma copia antes de a proxima gravacao escrever por cima, o
       mesmo cuidado do config.json. As conversas em si nao correm risco — so a costura. */
    try {
      if (fs.existsSync(LIGACOES_PATH())) {
        fs.copyFileSync(LIGACOES_PATH(), LIGACOES_PATH() + '.quebrado');
        anota('ligacoes.json ilegivel, copia em ligacoes.json.quebrado:', e && e.message);
      }
    } catch {}
    return {};
  }
  const lig = bruto && typeof bruto === 'object' ? bruto.ligacoes : null;
  if (!lig || typeof lig !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(lig)) {
    const nova = parteDaLigacao(v), anterior = parteDaLigacao(v && v.anterior);
    if (!nova || !anterior) continue;
    if (k !== nova.engine + ':' + nova.id) continue;                        // chave que nao bate: lixo
    if (anterior.engine === nova.engine && anterior.id === nova.id) continue;   // conversa ligada nela mesma
    out[k] = { ...nova, anterior, quando: Number(v.quando) || 0 };
  }
  return out;
}
function salvarLigacoes(o) { return gravarSeguro(LIGACOES_PATH(), JSON.stringify({ v: 1, ligacoes: o })); }
// tira tudo que aponta para esta conversa: a ligacao em que ela e a nova e as em que e a anterior
function esquecerLigacoesDe(engine, id) {
  if (!engine || !id) return;
  const todas = lerLigacoes();
  let mudou = false;
  for (const [k, v] of Object.entries(todas)) {
    if ((v.engine === engine && v.id === id) || (v.anterior.engine === engine && v.anterior.id === id)) {
      delete todas[k]; mudou = true;
    }
  }
  if (mudou) salvarLigacoes(todas);
}
/* A lista lateral le as ligacoes junto com os nomes que ele deu as partes: o titulo da cadeia
   e o nome salvo de qualquer parte (da mais nova para a mais velha). Os nomes do Gemini e do
   Grok nao passam pelo nomes.json na lista deles, entao a tela nao teria como saber. */
handle('ligacoes:ler', () => {
  const ligacoes = lerLigacoes();
  const nomes = lerNomes(), deles = {};
  for (const l of Object.values(ligacoes)) {
    for (const p of [l, l.anterior]) if (nomes[p.id]) deles[p.id] = nomes[p.id];
  }
  return { ligacoes, nomes: deles };
});
/* Poe a ligacao nova -> anterior em `todas` (sem gravar), ou diz por que nao pode. Separado do
   handler porque a costura das conversas antigas (aqui embaixo) passa pelas MESMAS recusas. */
function juntarLigacao(todas, nova, anterior) {
  if (!nova || !anterior) return 'ligação incompleta';
  if (nova.engine === anterior.engine && nova.id === anterior.id) return 'uma conversa não continua ela mesma';
  /* Ciclo (A continua B que continua A) faria a cadeia andar em roda. Se a anterior ja
     descende da nova, a ligacao e recusada: a tela so perde a costura, nunca trava. */
  let k = anterior.engine + ':' + anterior.id;
  for (let passos = 0; todas[k] && passos < 200; passos++) {
    const a = todas[k].anterior;
    if (a.engine === nova.engine && a.id === nova.id) return 'ligação em círculo';
    k = a.engine + ':' + a.id;
  }
  todas[nova.engine + ':' + nova.id] = { ...nova, anterior, quando: Date.now() };
  return '';
}
// Vai pelo handle(): trocar de IA no iPhone tambem costura a conversa, e nao apaga nada.
handle('ligacoes:gravar', (_e, dados) => {
  const nova = parteDaLigacao(dados && dados.nova), anterior = parteDaLigacao(dados && dados.anterior);
  const todas = lerLigacoes();
  const erro = juntarLigacao(todas, nova, anterior);
  if (erro) return { error: erro };
  return salvarLigacoes(todas) ? { ok: true } : { error: 'Não consegui gravar a ligação.' };
});

/* ======================= costura das conversas ANTIGAS (25/09) =======================
   A costura so nasce nas trocas de IA feitas depois que ela existe: as conversas partidas antes
   continuavam em dois pedacos soltos na lista. So que cada pedaco novo guarda a prova da troca:
   a 1a fala dele e o contexto que o app colou ("Estou continuando uma conversa que vinha sendo
   tocada por outro assistente…", montarContexto no app.js), com o nome da IA que respondia antes
   e as ultimas falas. UMA vez so (marcada em costura-antiga.json), le o comeco de cada conversa,
   acha as que nasceram assim e liga cada uma na conversa daquela IA, na mesma pasta, terminada
   antes dela E que tem dentro a mesma ultima fala. Sem essa prova nao liga nada: dois pedacos
   soltos sao melhores que uma conversa costurada na errada. So le; nenhuma conversa e mexida. */
const MARCA_DA_TROCA = 'Estou continuando uma conversa que vinha sendo tocada por outro assistente';
const MOTOR_PELO_NOME = { Claude: 'claude', Codex: 'codex', ACP: 'acp', Gemini: 'gemini', Grok: 'grok' };
const COSTURA_ANTIGA_PATH = () => path.join(app.getPath('userData'), 'costura-antiga.json');

/* O texto colado, tirado do comeco CRU do arquivo (o JSONL de qualquer motor). A fala tem de
   COMECAR pela marca — a string JSON abre logo antes dela, ou vem logo depois do "---" que
   separa o recado do esforço máximo (ULTRACODE_MSG, que o app cola na frente de tudo). Uma
   conversa que so fala da frase (codigo do Cockpit, um print colado) tem a marca no meio de
   outra string, e fica de fora. */
function contextoColadoNoInicio(bruto) {
  bruto = String(bruto || '');
  const abre = (i) => (bruto[i - 1] === '"' && bruto[i - 2] !== '\\') || bruto.slice(Math.max(0, i - 7), i) === '---\\n\\n';
  let i = bruto.indexOf(MARCA_DA_TROCA);
  while (i > 0 && !abre(i)) i = bruto.indexOf(MARCA_DA_TROCA, i + 1);
  if (i <= 0) return '';
  let j = i;
  for (; j < bruto.length; j++) {
    if (bruto[j] === '\\') { j++; continue; }
    if (bruto[j] === '"') break;
  }
  if (j >= bruto.length) return '';          // a fala nao coube no pedaco lido: melhor nao adivinhar
  try { return JSON.parse('"' + bruto.slice(i, j) + '"'); } catch { return ''; }
}
/* Do contexto colado: a IA que respondia por ultimo (o "### Claude:" mais de baixo) e as
   ultimas falas, que sao a prova para achar a conversa de antes. So nomes de IA conhecidos
   contam como cabecalho: um "### Titulo:" dentro de uma fala nao engana. */
function lerContextoColado(texto) {
  texto = String(texto || '');
  const ABRE = '--- conversa até aqui ---', FECHA = '--- fim da conversa anterior ---';
  const ini = texto.indexOf(ABRE), fim = texto.lastIndexOf(FECHA);
  if (!texto.startsWith(MARCA_DA_TROCA) || ini < 0 || fim <= ini) return null;
  const corpo = texto.slice(ini + ABRE.length, fim);
  const cab = /^### (Você|Claude|Codex|ACP|Gemini|Grok):$/gm;
  const blocos = [];
  for (let m; (m = cab.exec(corpo));) {
    if (blocos.length) blocos[blocos.length - 1].fim = m.index;
    blocos.push({ quem: m[1], ini: m.index + m[0].length, fim: corpo.length });
  }
  for (const b of blocos) b.texto = corpo.slice(b.ini, b.fim).trim();
  const daIa = blocos.filter(b => b.quem !== 'Você');
  const suas = blocos.filter(b => b.quem === 'Você' && b.texto);
  if (!daIa.length) return null;
  return { motor: MOTOR_PELO_NOME[daIa[daIa.length - 1].quem],
    fala: suas.length ? suas[suas.length - 1].texto : '', resposta: daIa[daIa.length - 1].texto };
}
/* A prova: a 1a linha com corpo da ultima fala dele (e da ultima resposta), do jeito que ela
   aparece escrita no arquivo (escapada como JSON). Corta por letra, nao por byte, para um
   emoji partido nao virar um \ud83d que nunca bate. */
function provasDaTroca(ctx) {
  const linha = (t) => Array.from(String(t || '').split('\n').map(x => x.trim()).find(x => x.length >= 12) || '').slice(0, 80).join('');
  return [linha(ctx.fala), linha(ctx.resposta)].filter(Boolean).map(t => JSON.stringify(t).slice(1, -1));
}
/* A conversa de antes: da IA que o contexto diz, na mesma pasta, que parou antes de a nova
   nascer (2 min de folga: o motor velho ainda grava ao ser desligado), da mais recente para a
   mais velha — e so a que tem a prova dentro. */
function acharParteAntiga(nova, ctx, lista, lerTexto) {
  const provas = provasDaTroca(ctx);
  if (!ctx.motor || !provas.length) return null;
  const pasta = (c) => String(c || '').replace(/\/+$/, '');
  const limite = (nova.nasceu || nova.when || 0) + 120000;
  const candidatas = lista.filter(s => s && s.file && s.engine === ctx.motor && !(s.engine === nova.engine && s.id === nova.id)
      && (!nova.cwd || !s.cwd || pasta(s.cwd) === pasta(nova.cwd)) && (s.when || 0) <= limite)
    .sort((a, b) => (b.when || 0) - (a.when || 0)).slice(0, 6);
  for (const s of candidatas) {
    const texto = lerTexto(s);
    if (texto && provas.some(p => texto.includes(p))) return s;
  }
  return null;
}
async function costurarConversasAntigas() {
  if (fs.existsSync(COSTURA_ANTIGA_PATH())) return { feito: true, novas: 0 };
  const lista = [];
  try { lista.push(...claudeSessions(5000, false)); } catch {}
  try { lista.push(...codexSessions(false, {})); } catch {}
  try { lista.push(...cli.sessoes()); } catch {}
  try { for (const s of (acp.sessoes() || [])) lista.push(ehSessaoGrok(s) ? { ...s, engine: 'grok' } : s); } catch {}
  const jaLigadas = lerLigacoes();
  const achadas = new Map();
  let vistas = 0;
  for (let n = 0; n < lista.length; n++) {
    // de 40 em 40 arquivos devolve a vez: o app continua respondendo enquanto isto roda
    if (n % 40 === 39) await new Promise(r => setImmediate(r));
    const x = lista[n];
    if (!x || !x.file || jaLigadas[x.engine + ':' + x.id]) continue;
    // o Codex abre o arquivo com as instrucoes da sessao (AGENTS.md…) antes da 1a fala
    const colado = contextoColadoNoInicio(headRead(x.file, (x.engine === 'codex' ? 192 : 64) * 1024));
    const ctx = lerContextoColado(colado);
    if (!ctx) continue;
    vistas++;
    let nasceu = 0;
    try { nasceu = fs.statSync(x.file).birthtimeMs || 0; } catch {}
    const anterior = acharParteAntiga({ ...x, nasceu }, ctx, lista, (s) => tailRead(s.file, 8 * 1024 * 1024));
    if (!anterior) continue;
    /* O ramo (fork) de uma conversa que nasceu da troca copia a 1a fala dela, com o MESMO
       contexto colado: medido no Mac dele, ate 5 conversas do Codex comecando igual. So a que
       nasceu primeiro e a continuacao; os ramos nao herdam a costura (a mesma regra da troca
       ao vivo), senao a lista ganhava 5 itens com o nome da conversa de antes. */
    const chave = anterior.engine + ':' + anterior.id + '\n' + colado;
    const ja = achadas.get(chave), idade = nasceu || x.when || 0;
    if (!ja || idade < ja.idade) achadas.set(chave, { nova: parteDaLigacao(x), anterior: parteDaLigacao(anterior), idade });
  }
  /* rele na hora de gravar: uma troca de IA feita enquanto isto rodava gravou o arquivo, e
     gravar a copia do comeco apagaria a costura dela */
  const todas = lerLigacoes();
  let novas = 0;
  for (const { nova, anterior } of achadas.values()) {
    if (nova && !todas[nova.engine + ':' + nova.id] && !juntarLigacao(todas, nova, anterior)) novas++;
  }
  if (novas && !salvarLigacoes(todas)) return { error: 'Não consegui gravar a costura das conversas antigas.' };
  gravarSeguro(COSTURA_ANTIGA_PATH(), JSON.stringify({ feito: Date.now(), vistas, novas }));
  return { feito: true, novas };
}
let costurandoAntigas = null;
handle('ligacoes:antigas', () => costurandoAntigas || (costurandoAntigas = costurarConversasAntigas()
  .catch((e) => ({ error: String((e && e.message) || e) }))
  .finally(() => { costurandoAntigas = null; })));

/* Junto com o nome fica QUEM deu (_origem[id]: 'manual' ou 'auto'). Sem a marca, o app nao sabia
   separar o nome que ele deu do nome velho da IA ("Criacao Dupla"): na duvida nao mexia em nenhum,
   e toda conversa que ja existia ficava para sempre com o nome antigo. Sem origem = 'manual' (quem
   chamava antes de existir a marca eram so os lapis dele). */
handle('sessao:renomear', async (_e, { engine, id, nome, origem }) => {
  const todos = lerNomes();
  const marcas = (todos._origem && typeof todos._origem === 'object') ? todos._origem : {};
  if (nome && nome.trim()) { todos[id] = nome.trim(); marcas[id] = origem === 'auto' ? 'auto' : 'manual'; }
  else { delete todos[id]; delete marcas[id]; }
  todos._origem = marcas;
  salvarNomes(todos);
  if (engine === 'codex' && id) {
    try { await codexStart(); await codexReq('local', 'thread/name/set', { threadId: id, name: nome || null }); } catch {}
  }
  return true;
});

/* Nome da conversa: a DEMANDA REAL, como uma pessoa daria titulo ao trabalho ("Checkout Errado
   da Oficina"), e nao mais "<tipo> <projeto>" — esse formato encheu a lista dele de "Alteracoes
   Adsure" e "Criacao Dupla", nomes que nao acham conversa nenhuma. Instrucao, material, linha de
   comando e validacao ficam no nomes-conversa.js: o script que renomeia as conversas antigas usa
   exatamente os mesmos. Aqui so entra a limpeza que ja existe para o historico (tiraBlocos e
   semContexto), para lembrete de sistema e contexto colado nao virarem "pedido" dele.
   Haiku pelo login do proprio Claude (sem custo por uso), sem gravar sessao, sem ferramenta. */
handle('sessao:nomeCurto', async (_e, o) => {
  const d = (o && typeof o === 'object') ? o : {};
  const limpa = (t) => { const x = tiraBlocos(String(t || '')); return x && !ehTecnico(x) ? (semContexto(x) || x) : ''; };
  let brutas = Array.isArray(d.mensagens) && d.mensagens.length ? d.mensagens : [d.texto];
  // teto de seguranca sem perder a 1a (o pedido que abriu a conversa)
  if (brutas.length > 12) brutas = [brutas[0], ...brutas.slice(-11)];
  // a mensagem limpa que ficou vazia (so lembrete do sistema) continua na lista: a numeracao que a
  // IA ve e a da conversa, e o montarPedido tira as vazias depois de numerar
  const mensagens = brutas.map(limpa);
  const respostas = (Array.isArray(d.respostas) ? d.respostas : []).slice(-2).map(t => tiraBlocos(String(t || '')));
  const atual = typeof d.atual === 'string' ? d.atual : '';
  // total: quantas mensagens ele mandou na conversa inteira (o app ja manda so a 1a + as recentes)
  const pedido = nomesConversa.montarPedido({ mensagens, respostas, atual, total: Number(d.total) || 0 });
  if (!pedido || !fs.existsSync(CLAUDE_BIN)) return '';
  const r = await rodar(CLAUDE_BIN, nomesConversa.argsDoNome(pedido), 60000);
  if (r.err) return '';
  // MANTER devolve o nome atual; saida que nao parece nome (mais de uma linha, conversa, generico)
  // vira '': fica o nome que estava
  return nomesConversa.interpretarSaida(r.out, atual);
});

/* De quem e o nome da conversa (ver donoDoNome no nomes-conversa.js): o app pergunta ao abrir uma
   conversa da lista e ao reabrir as abas, para a IA voltar a acompanhar o nome que e dela. */
handle('sessao:donoNome', (_e, o) => {
  const d = (o && typeof o === 'object') ? o : {};
  if (!d.id) return '';
  return nomesConversa.donoDoNome(lerNomes(), String(d.id), typeof d.titulo === 'string' ? d.titulo : '');
});

/* ---------- indice de busca ----------
   Buscar abria conversa por conversa (mais de 600 arquivos, varios GB) e desistia em 4
   segundos dizendo "olhei so as mais recentes". Agora cada conversa e lida UMA vez e o texto
   limpo fica guardado no disco, em DOIS arquivos — e essa separacao e o coracao da coisa:

   - indice-carimbos.json: so a data e o tamanho de cada conversa, uns 100 bytes por conversa.
     E o que responde "ja indexei essa e ela nao mudou?". Cabe folgado na memoria.
   - indice-texto.ndjson: o texto, UMA CONVERSA POR LINHA. Nunca entra inteiro na memoria: a
     busca passa por ele em pedacos de 256 KB, olha e joga fora, e devolve o controle para o
     app entre um pedaco e outro. Conversa nova e ACRESCENTADA no fim, sem reescrever o resto.

   Antes era um JSON unico: cada busca lia, montava e (4 s depois) regravava os 168 MB inteiros
   dentro do processo que desenha a janela — o app parava e a memoria subia 1 GB. Agora o custo
   nao depende mais do tamanho do indice, entao ele pode crescer a vontade. */
const IND_CARIMBOS = path.join(HOME, '.cockpit', 'indice-carimbos.json');
const IND_TEXTO = path.join(HOME, '.cockpit', 'indice-texto.ndjson');
const IND_VELHO = path.join(HOME, '.cockpit', 'indice-busca.json');   // formato antigo, so para converter
/* Teto de texto guardado por conversa. Era 40 mil e, com 2769 conversas, isso dava 110 MB de
   indice. Continua valendo: guardar a conversa inteira nao paga, o comeco dela ja acha. */
const IND_MAX = 12000;              // caracteres de texto guardados por conversa
const IND_PEDACO = 256 * 1024;      // quanto do arquivo de texto e lido por vez
let indCarimbos = null, carimbosSujos = false, carimbosTimer = null;

/* Os carimbos sao miudos, entao ficam na memoria o tempo todo: e o que deixa a pergunta
   "essa conversa mudou?" ser instantanea sem precisar abrir o arquivo de texto. */
function lerCarimbos() {
  if (indCarimbos) return indCarimbos;
  try { indCarimbos = JSON.parse(fs.readFileSync(IND_CARIMBOS, 'utf8')); } catch { indCarimbos = null; }
  if (!indCarimbos) { indCarimbos = {}; converterIndiceVelho(); }
  return indCarimbos;
}
function gravarCarimbosDepois() {
  carimbosSujos = true;
  clearTimeout(carimbosTimer);
  carimbosTimer = setTimeout(() => {
    if (!carimbosSujos) return;
    try {
      fs.mkdirSync(path.dirname(IND_CARIMBOS), { recursive: true });
      // R3-021: gravarSeguro devolve false quando a gravacao falha (disco cheio, sem
      // permissao) em vez de lancar excecao — so zera a flag quando gravou de verdade,
      // senao o app achava que estava salvo e o indice ficava desatualizado em disco
      if (gravarSeguro(IND_CARIMBOS, JSON.stringify(indCarimbos))) carimbosSujos = false;
    } catch {}
  }, 4000);
}
/* uma conversa por linha; o texto ja entra cortado no teto */
function montarLinha(f, m, t, x) {
  const texto = typeof x === 'string' ? (x.length > IND_MAX ? x.slice(0, IND_MAX) : x) : '';
  return JSON.stringify({ f, m, t, x: texto }) + '\n';
}

/* Mudanca de casa, uma vez na vida: pega o indice antigo (aquele JSON unico) e espalha cada
   conversa numa linha do arquivo novo. Sem isto o indice teria de ser remontado do zero,
   relendo as 2750 conversas. Convertido, o arquivo velho e apagado e nunca mais e lido. */
function converterIndiceVelho() {
  let velho;
  try { velho = JSON.parse(fs.readFileSync(IND_VELHO, 'utf8')); } catch { return; }
  const linhas = [];
  for (const f of Object.keys(velho)) {
    const e = velho[f];
    if (!e || typeof e.x !== 'string') continue;
    const linha = montarLinha(f, e.m, e.t, e.x);
    indCarimbos[f] = { m: e.m, t: e.t, b: Buffer.byteLength(linha) };
    linhas.push(linha);
  }
  try {
    fs.mkdirSync(path.dirname(IND_TEXTO), { recursive: true });
    /* carimbo sem linha e pior que nao ter carimbo: ele diria "essa ja esta indexada" e a
       conversa sumiria da busca para sempre. Nao gravou o texto, joga os carimbos fora. */
    if (!gravarSeguro(IND_TEXTO, linhas.join(''))) { indCarimbos = {}; return; }
    try { fs.unlinkSync(IND_VELHO); } catch {}
  } catch { indCarimbos = {}; return; }
  gravarCarimbosDepois();
}

/* Conversa nova ou que mudou entra ACRESCENTANDO uma linha no fim. A linha velha dela fica
   para tras virando lixo, e o lixo some na faxina (compactarTexto). Antes, qualquer
   mudancinha mandava regravar o arquivo inteiro. */
function guardarTexto(file, m, t, texto) {
  /* de proposito ANTES de escrever: se o indice velho ainda nao tiver sido convertido, a
     conversao regrava o arquivo de texto inteiro e levaria junto a linha recem-acrescentada */
  const carim = lerCarimbos();
  const linha = montarLinha(file, m, t, texto);
  try {
    fs.mkdirSync(path.dirname(IND_TEXTO), { recursive: true });
    fs.appendFileSync(IND_TEXTO, linha);
  } catch { return null; }
  const c = { m, t, b: Buffer.byteLength(linha) };
  carim[file] = c;
  gravarCarimbosDepois();
  return c;
}
/* Garante que a conversa esta no indice e devolve o carimbo dela (null se o arquivo sumiu).
   O texto NAO volta junto de proposito: quem precisa dele le do disco, de passagem. */
function indexarSePreciso(file) {
  const carim = lerCarimbos();
  let st;
  try { st = fs.statSync(file); } catch { return null; }
  const e = carim[file];
  if (e && e.m === st.mtimeMs && e.t === st.size) return e;
  return guardarTexto(file, st.mtimeMs, st.size, textoLegivel(file));
}

/* Passa pelo arquivo de texto de pedaco em pedaco e entrega uma LINHA por vez. So o pedaco
   atual fica na memoria, e entre um pedaco e outro o app respira — e por isso que a janela
   nao trava mais, nem se o indice virar centenas de MB. Devolver false para parar na hora. */
async function varrerTexto(aCadaLinha) {
  let fd = null;
  try { fd = fs.openSync(IND_TEXTO, 'r'); } catch { return; }
  try {
    const tam = fs.fstatSync(fd).size;
    let sobra = null, pos = 0;
    while (pos < tam) {
      const buf = Buffer.alloc(Math.min(IND_PEDACO, tam - pos));
      const n = fs.readSync(fd, buf, 0, buf.length, pos);
      if (n <= 0) break;
      pos += n;
      const dados = sobra ? Buffer.concat([sobra, buf.subarray(0, n)]) : buf.subarray(0, n);
      let ini = 0, q;
      while ((q = dados.indexOf(10, ini)) >= 0) {
        if (q > ini && aCadaLinha(dados.toString('utf8', ini, q)) === false) return;
        ini = q + 1;
      }
      sobra = ini < dados.length ? Buffer.from(dados.subarray(ini)) : null;
      await new Promise(r => setImmediate(r));
    }
    if (sobra && sobra.length) aCadaLinha(sobra.toString('utf8'));
  } catch {} finally { try { fs.closeSync(fd); } catch {} }
}

/* Faxina do arquivo de texto. Tira duas sujeiras: a linha da conversa que foi apagada e a
   linha velha daquela que mudou. Roda no fundo e so quando o lixo ja passou da metade — nao
   adianta reescrever 30 MB a toa. */
async function compactarTexto() {
  let tam = 0;
  try { tam = fs.statSync(IND_TEXTO).size; } catch { return false; }
  const carim = lerCarimbos();
  let vivos = 0;
  for (const k of Object.keys(carim)) vivos += (carim[k] && carim[k].b) || 0;
  if (tam < 4 * 1024 * 1024 || tam < vivos * 1.5) return false;
  // R1-006: nome fixo colidia com uma 2a copia do processo rodando por cima (reforco: a
  // trava acima ja evita isso na maioria dos casos, mas o PID nao custa nada)
  const tmp = IND_TEXTO + '.faxina.' + process.pid;
  try { fs.writeFileSync(tmp, ''); } catch { return false; }
  const feitos = new Set();
  let balde = [], baldeTam = 0, deuRuim = false;
  const despejar = () => {
    if (!balde.length) return true;
    try { fs.appendFileSync(tmp, balde.join('')); } catch { deuRuim = true; return false; }
    balde = []; baldeTam = 0;
    return true;
  };
  await varrerTexto((linha) => {
    let d;
    try { d = JSON.parse(linha); } catch { return; }
    const c = d && d.f ? carim[d.f] : null;
    if (!c || c.m !== d.m || c.t !== d.t || feitos.has(d.f)) return;   // apagada, velha ou repetida
    feitos.add(d.f);
    balde.push(linha + '\n'); baldeTam += linha.length + 1;
    if (baldeTam >= IND_PEDACO && !despejar()) return false;
  });
  if (!despejar() || deuRuim) { try { fs.unlinkSync(tmp); } catch {} return false; }
  /* enquanto a faxina rodava, uma busca pode ter acrescentado conversa no fim do arquivo
     velho. Esse pedacinho vai junto para o novo, senao ele se perderia na troca. */
  try {
    const agora = fs.statSync(IND_TEXTO).size;
    if (agora > tam) fs.appendFileSync(tmp, tailRead(IND_TEXTO, agora - tam));
  } catch { try { fs.unlinkSync(tmp); } catch {} return false; }
  try { fs.renameSync(tmp, IND_TEXTO); } catch { try { fs.unlinkSync(tmp); } catch {} return false; }
  return true;
}
/* tira do .jsonl so o que e texto de gente ou do motor: o resto e encanamento */
function textoLegivel(file) {
  let dados;
  try {
    const st = fs.statSync(file);
    dados = st.size > 8 * 1024 * 1024 ? tailRead(file, 8 * 1024 * 1024) : fs.readFileSync(file, 'utf8');
  } catch { return ''; }
  const pega = (c) => typeof c === 'string' ? c
    : Array.isArray(c) ? c.map(x => x && (x.text || x.thinking || '')).filter(Boolean).join(' ') : '';
  const partes = [];
  let tam = 0;
  for (const linha of dados.split('\n')) {
    if (!linha || linha[0] !== '{') continue;
    let t = '';
    try {
      const d = JSON.parse(linha);
      /* 3a alternativa (leva 12.5): a transcrição do ACP é {role, text} solto. Sem esta linha
         a conversa do ACP indexava VAZIA — e o índice guarda o vazio em cache, então ela nunca
         mais seria achada pela busca, mesmo depois de arrumar. */
      t = pega(d.message && d.message.content) || pega(d.payload && d.payload.content)
        || (d.role && typeof d.text === 'string' ? d.text : '') || '';
    } catch { continue; }
    t = String(t).replace(/\s+/g, ' ').trim();
    if (!t) continue;
    /* CORTA o pedaco antes de guardar. Antes ele entrava inteiro e so depois o codigo via se
       tinha passado do teto: uma unica mensagem gigante (um arquivo colado no chat, um log)
       entrava toda. Era por isso que o indice tinha entrada de 476 KB num teto de 40 mil. */
    const cabe = IND_MAX - tam - 1;
    if (cabe <= 0) break;
    if (t.length > cabe) t = t.slice(0, cabe);
    partes.push(t); tam += t.length + 1;
    if (tam >= IND_MAX) break;
  }
  return partes.join('\n');
}
// R2-011: tira acento pra comparar — sem isso 'codigo' não achava 'código' e vice-versa
function semAcento(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function trechoDoIndice(texto, alvo) {
  const j = semAcento(texto.toLowerCase()).indexOf(alvo);
  if (j < 0) return null;
  const de = Math.max(0, j - 45);
  return (de > 0 ? '…' : '') + texto.slice(de, de + 150).replace(/\s+/g, ' ').trim() + '…';
}

handle('sessions:buscar', async (_e, { engine, termo, itens }) => {
  const alvo = semAcento(String(termo || '').toLowerCase().trim());
  if (!alvo) return [];
  const lista = itens || [];
  // teto largo: so entra em acao na primeira busca, quando o indice ainda esta sendo montado
  const ateQuando = Date.now() + 20000;
  const querido = new Map();          // caminho da conversa -> id dela na tela
  let vistos = 0, cortou = false;
  for (const it of lista) {
    vistos++;
    if (!it.file) continue;
    if (indexarSePreciso(it.file)) querido.set(it.file, it.id);
    if (Date.now() > ateQuando) { cortou = true; break; }
    if (vistos % 25 === 0) await new Promise(r => setImmediate(r));
  }
  /* O termo e procurado na linha CRUA antes de desmontar o JSON: assim so o punhado de linhas
     que realmente casa paga o desmonte. Aspas e barra invertida viram escape dentro do JSON,
     entao com elas o atalho e desligado — melhor gastar um pouco mais do que deixar de achar. */
  const atalho = !/["\\]/.test(alvo);
  const carim = lerCarimbos();
  const achou = new Map();            // id da conversa -> trecho para mostrar
  await varrerTexto((linha) => {
    if (atalho && !semAcento(linha.toLowerCase()).includes(alvo)) return;
    let d;
    try { d = JSON.parse(linha); } catch { return; }
    const id = d && d.f ? querido.get(d.f) : undefined;
    if (id === undefined || achou.has(id)) return;
    const c = carim[d.f];
    if (!c || c.m !== d.m || c.t !== d.t) return;   // linha velha da mesma conversa nao vale
    const t = trechoDoIndice(d.x || '', alvo);
    if (t) achou.set(id, t);
  });
  // a ordem da tela e a da lista que chegou (mais nova primeiro), nao a ordem do arquivo
  const achados = [];
  for (const it of lista) {
    const t = achou.get(it.id);
    if (t) achados.push({ id: it.id, trecho: t });
    if (achados.length >= 40) break;
  }
  // o corte por tempo nao pode ser silencioso: se sobrou conversa sem olhar, a tela avisa
  return { achados, parcial: cortou ? { vistos, total: lista.length } : null };
});

/* Montar o indice ANTES de ele precisar: passados 20s de app aberto, indexa devagarinho,
   um arquivo por vez, deixando o processador respirar entre eles. */
function montarIndiceDeFundo() {
  setTimeout(async () => {
    try {
      const listas = [claudeSessions(5000, true) || [], codexSessions(true, {}) || []];
      const arquivos = listas.flat().map(s => s && s.file).filter(Boolean);
      for (const f of arquivos) {
        indexarSePreciso(f);
        await new Promise(r => setTimeout(r, 12));   // devagar de proposito: nada de travar a tela
      }
      // conversa apagada nao pode ficar ocupando o indice para sempre
      const carim = lerCarimbos();
      const vivos = new Set(arquivos);
      let tirou = 0;
      for (const f of Object.keys(carim)) if (!vivos.has(f) && !fs.existsSync(f)) { delete carim[f]; tirou++; }
      if (tirou) gravarCarimbosDepois();
      // R2-039: indice-conversas.json (titulo/pasta/entrypoint) e irmao do carim, mas so era
      // podado pelo botao "Apagar conversa". Arquivo que some sem passar por ali (Finder,
      // terminal, pasta do projeto apagada depois do Drive) ficava com ficha presa pra sempre.
      const ind = lerIndice();
      let tirouInd = 0;
      for (const f of Object.keys(ind)) if (!vivos.has(f) && !fs.existsSync(f)) { delete ind[f]; tirouInd++; }
      if (tirouInd) gravarIndice();
      await compactarTexto();   // e, ja que estamos no fundo, tira o lixo do arquivo de texto
    } catch {}
  }, 20000);
}

function tailRead(file, bytes) {
  try {
    const fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const len = Math.min(bytes, size);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    fs.closeSync(fd);
    return buf.toString('utf8');
  } catch { return ''; }
}
function headRead(file, bytes) {
  try {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(bytes);
    const n = fs.readSync(fd, buf, 0, bytes, 0);
    fs.closeSync(fd);
    return buf.toString('utf8', 0, n);
  } catch { return ''; }
}

const ENTRADAS_DE_GENTE = ['claude-vscode', 'cockpit', 'cli', 'claude-code'];

const INDICE_PATH = () => path.join(app.getPath('userData'), 'indice-conversas.json');
let indice = null;
function lerIndice() { if (indice) return indice; try { indice = JSON.parse(fs.readFileSync(INDICE_PATH(), 'utf8')); } catch { indice = {}; } return indice; }
function gravarIndice() { gravarSeguro(INDICE_PATH(), JSON.stringify(indice || {})); }

const PULAR_PASTA = new Set(['subagents', 'workflows']);

function varrerConversas(dir, achados, nivel) {
  let itens = [];
  try { itens = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of itens) {
    const p2 = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (PULAR_PASTA.has(e.name) || nivel > 4) continue;   // agentes internos nao sao conversa sua
      varrerConversas(p2, achados, nivel + 1);
    } else if (e.name.endsWith('.jsonl')) {
      try { const st = fs.statSync(p2); if (st.size > 300) achados.push({ f: p2, mtime: st.mtimeMs, size: st.size, id: e.name.replace('.jsonl', '') }); } catch {}
    }
  }
}

/* le titulo/pasta/entrada de um arquivo, guardando em indice para nao reler toda vez */
function fichaConversa(it) {
  const ind = lerIndice();
  const salvo = ind[it.f];
  if (salvo && salvo.mtime === it.mtime && salvo.size === it.size) return salvo;

  const head = headRead(it.f, 64 * 1024);
  const em = head.match(/"entrypoint":"([^"]*)"/);
  const entrada = em ? em[1] : '';

  const tail = tailRead(it.f, 96 * 1024);
  let title = '';
  const tm = [...tail.matchAll(/"aiTitle":"((?:[^"\\]|\\.)*)"/g)];
  if (tm.length) { try { title = JSON.parse('"' + tm[tm.length - 1][1] + '"'); } catch { title = tm[tm.length - 1][1]; } }

  let cwd = '';
  const cm = head.match(/"cwd":"((?:[^"\\]|\\.)*)"/);
  if (cm) { try { cwd = JSON.parse('"' + cm[1] + '"'); } catch { cwd = cm[1]; } }

  if (!title) {
    for (const linha of head.split('\n')) {
      if (!linha.includes('"type":"user"')) continue;
      try {
        const d = JSON.parse(linha);
        if (d.isMeta) continue;
        const c = d.message && d.message.content;
        const bruto = typeof c === 'string' ? c : Array.isArray(c) ? c.map(x => x && x.text || '').join(' ') : '';
        const t = tiraBlocos(bruto);
        if (t && !ehTecnico(t)) { title = limparTitulo(t).slice(0, 90); break; }
      } catch {}
    }
  }
  const ficha = { mtime: it.mtime, size: it.size, title, cwd, entrada };
  ind[it.f] = ficha;
  return ficha;
}

function claudeSessions(limit, incluirRobos) {
  const achados = [];
  varrerConversas(CLAUDE_PROJ, achados, 0);
  achados.sort((a, b) => b.mtime - a.mtime);

  const nomesMeus = lerNomes();
  const alvo = limit || 5000;
  const out = [];
  let lidos = 0;
  for (const it of achados) {
    if (out.length >= alvo) break;
    const fi = fichaConversa(it);
    lidos++;
    if (!incluirRobos && fi.entrada && !ENTRADAS_DE_GENTE.includes(fi.entrada)) continue;
    let title = nomesMeus[it.id] || fi.title;
    if (!title) continue;
    out.push({ engine: 'claude', id: it.id, title, cwd: fi.cwd || HOME, when: it.mtime, file: it.f, entrada: fi.entrada });
  }
  if (lidos) gravarIndice();
  return out;
}

/* ---- quanto da conversa volta para a tela ----
   Antes era um `slice(-60)` cru sobre TUDO, e cada Edit, Bash ou Read conta como item. Numa
   conversa de trabalho as ferramentas comem as 60 vagas sozinhas: medido em 03/09/2026, uma
   conversa de 10 falas do Homero + 59 respostas + 363 ferramentas voltava com 4 falas e 11
   respostas. Ou seja, o que sumia era justamente a CONVERSA — e ela ainda alimenta o P.hist,
   de onde sai o contexto quando o chat volta sem o fio. Agora quem manda no corte e a fala:
   elas voltam todas (ate maxFalas) e so as ferramentas mais ANTIGAS sao podadas, ate maxTools. */
function cortarHistorico(msgs, maxFalas, maxTools) {
  let falas = 0, ini = 0;
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === 'tool') continue;
    if (++falas > maxFalas) { ini = i + 1; break; }
  }
  const trecho = msgs.slice(ini);
  let sobra = trecho.filter(m => m.role === 'tool').length - (maxTools || 250);
  if (sobra <= 0) return trecho;
  return trecho.filter(m => !(m.role === 'tool' && sobra-- > 0));
}

function claudeHistory(file, maxFalas, maxTools) {
  const msgs = [];
  let data = '';
  try {
    const st = fs.statSync(file);
    // arquivos gigantes: le so o final
    data = st.size > 6 * 1024 * 1024 ? tailRead(file, 6 * 1024 * 1024) : fs.readFileSync(file, 'utf8');
  } catch { return msgs; }
  for (const line of data.split('\n')) {
    if (!line.startsWith('{')) continue;
    let d; try { d = JSON.parse(line); } catch { continue; }
    // isMeta marca o que o proprio Claude Code escreveu se passando por usuario: prompt de
    // subagente, texto de skill, aviso de imagem colada. Nada disso e conversa.
    if (d.isMeta) continue;
    if (d.type === 'user' && d.message) {
      const c = d.message.content;
      let t = typeof c === 'string' ? c : Array.isArray(c) ? c.filter(x => x && x.type === 'text').map(x => x.text).join('\n') : '';
      t = tiraBlocos(t);
      if (t && !ehTecnico(t)) msgs.push({ role: 'user', text: semContexto(t) || t });
    } else if (d.type === 'assistant' && d.message) {
      const c = d.message.content || [];
      for (const x of c) {
        if (x.type === 'text' && x.text && x.text.trim()) msgs.push({ role: 'bot', text: x.text });
        else if (x.type === 'tool_use') msgs.push({ role: 'tool', name: x.name, arg: claudeToolArg(x.name, x.input) });
      }
    }
  }
  return cortarHistorico(msgs, maxFalas || 600, maxTools);
}

function codexHistory(file, maxFalas, maxTools) {
  const msgs = [];
  const calls = new Map();
  let data = '';
  try {
    const st = fs.statSync(file);
    // R2-035: mesmo teto do claudeHistory. Sem isso, arquivo .jsonl grande do Codex
    // trava o processo principal (e todos os paineis) numa leitura sincrona.
    data = st.size > 6 * 1024 * 1024 ? tailRead(file, 6 * 1024 * 1024) : fs.readFileSync(file, 'utf8');
  } catch { return msgs; }
  for (const line of data.split('\n')) {
    if (!line.startsWith('{')) continue;
    let d; try { d = JSON.parse(line); } catch { continue; }
    if (d.type !== 'response_item') continue;
    const p = d.payload || {};
    if (p.type === 'message') {
      if (p.role === 'developer' || p.role === 'system') continue;
      const t = tiraBlocos((p.content || []).map(c => c.text || '').join('\n'));
      const attachments = (p.content || []).filter(c => ['input_image', 'image'].includes(c.type)).map(c => ({ url: c.image_url || c.url || '', nome: 'Imagem anexada' }));
      if (!t && !attachments.length) continue;
      if (t && (ehTecnico(t) || t.includes('<workspace_roots>'))) continue;
      msgs.push({ role: p.role === 'user' ? 'user' : 'bot', text: p.role === 'user' ? (semContexto(t) || t) : t, attachments, anexos: attachments });
    } else if (['function_call', 'local_shell_call', 'custom_tool_call'].includes(p.type)) {
      let arg = '';
      const raw = p.input !== undefined ? p.input : p.arguments;
      try {
        const a = typeof raw === 'string' ? JSON.parse(raw) : (p.action || raw || {});
        arg = a.command ? (Array.isArray(a.command) ? a.command.join(' ') : a.command) : a.cmd || (typeof raw === 'string' ? raw : JSON.stringify(a));
      } catch { arg = String(raw || ''); }
      const msg = { role: 'tool', name: p.name === 'shell' || p.type === 'local_shell_call' ? 'Terminal' : (p.name || 'Ferramenta'), arg, id: p.call_id || p.id };
      msgs.push(msg); if (msg.id) calls.set(msg.id, msg);
    } else if (['function_call_output', 'custom_tool_call_output', 'local_shell_call_output'].includes(p.type)) {
      const call = calls.get(p.call_id || p.id);
      const output = typeof p.output === 'string' ? p.output : shortJson(p.output);
      if (call) call.output = output;
      else msgs.push({ role: 'tool', name: p.name || 'Resultado de ferramenta', arg: '', output });
    } else if (p.type === 'image_generation_call') {
      msgs.push({ role: 'image', kind: 'generated-image', ...codexProtocol.imageData({ ...p, savedPath: p.saved_path || p.savedPath }) });
    } else {
      const msg = codexProtocol.historyItem(p);
      if (msg) msgs.push(msg);
    }
  }
  return cortarHistorico(msgs, maxFalas || 600, maxTools);
}

function codexHistoryMessages(items) {
  const messages = items.map(item => codexProtocol.historyItem(item)).filter(Boolean);
  return messages.filter(message => {
    if (message.role !== 'user') return true;
    if (!message.text) return !!(message.attachments && message.attachments.length);
    message.text = tiraBlocos(message.text);
    if (ehTecnico(message.text) || message.text.includes('<workspace_roots>')) return false;
    message.text = semContexto(message.text) || message.text;
    return true;
  });
}
async function codexOfficialHistory(id, destino) {
  await codexStart(destino);
  let readError;
  try {
    const result = await codexReq(destino, 'thread/read', { threadId: id, includeTurns: true }, 12000);
    const thread = result && result.thread;
    if (thread && Array.isArray(thread.turns) && thread.turns.length && thread.turns.every(turn => !turn.itemsView || turn.itemsView === 'full')) {
      return codexHistoryMessages(thread.turns.flatMap(turn => turn.items || []));
    }
  } catch (e) { readError = e; }
  // Conversas novas podem usar histórico paginado. O servidor é a fonte de
  // verdade, inclusive quando o arquivo não existe no disco do Mac (VPS).
  const items = [];
  let cursor = null;
  const seen = new Set();
  for (let page = 0; page < 100; page++) {
    let response;
    try { response = await codexReq(destino, 'thread/items/list', { threadId: id, limit: 100, sortDirection: 'desc', ...(cursor ? { cursor } : {}) }, 12000); }
    catch (error) { if (!items.length) throw readError || error; break; }
    const data = response && response.data || [];
    items.push(...data.map(entry => entry.item || entry));
    if (!response.nextCursor || seen.has(response.nextCursor)) break;
    cursor = response.nextCursor; seen.add(cursor);
  }
  return codexHistoryMessages(items.reverse());
}

handle('sessions:claude', (_e, incluirRobos) => claudeSessions(5000, incluirRobos));
const CODEX_SESS = path.join(HOME, '.codex/sessions');
const ORIGENS_DE_GENTE = ['cockpit', 'codex-tui', 'codex_tui', 'codex_vscode', 'codex-vscode', 'codex_app', 'codex-app', 'vscode'];

const TECNICO = /<recommended_plugins>|<environment_context>|<user_instructions>|<system-reminder>|<available_tools>|<plugins>|<task-notification>|<command-name>|<local-command-stdout>|<bash-input>|<function_results>|^Caveat:|^\[Request interrupted|^\[Image: original|^<[a-z_-]+>/i;
const ehTecnico = (t) => !t || TECNICO.test(t.trim().slice(0, 400));

/* O que o Claude Code injeta na conversa NAO e fala do Homero, mas fica gravado no mesmo lugar
   e com o mesmo "role: user". Antes so era barrado o que comecava com a tag — o que vinha
   colado DEPOIS da fala dele (lembrete de sistema, contexto de hook, aviso de tarefa que
   terminou) passava batido e reaparecia na tela ao reabrir o app, misturado com a conversa.
   Aqui esses pedacos saem do texto onde quer que estejam; se nao sobrar nada, a mensagem some. */
const BLOCOS_TECNICOS = [
  'system-reminder', 'task-notification', 'command-name', 'command-message', 'command-args',
  'local-command-stdout', 'local-command-stderr', 'bash-input', 'bash-stdout', 'bash-stderr',
  'user-prompt-submit-hook', 'function_results', 'recommended_plugins', 'environment_context',
  'user_instructions', 'available_tools', 'plugins', 'workspace_roots', 'EXTREMELY_IMPORTANT',
  'ide_selection', 'ide_opened_file', 'ide_diagnostics',
];
function tiraBlocos(t) {
  let s = String(t || '');
  for (const tag of BLOCOS_TECNICOS) {
    s = s.replace(new RegExp('<' + tag + '>[\\s\\S]*?<\\/' + tag + '>', 'gi'), '');
    // bloco aberto e nunca fechado (arquivo cortado no meio): corta dali ate o fim
    s = s.replace(new RegExp('<' + tag + '>[\\s\\S]*$', 'i'), '');
  }
  // contexto que o harness cola sem tag nenhuma, sempre no fim da mensagem
  s = s.replace(/(^|\n)[^\n]{0,80}hook additional context:[\s\S]*$/i, '');
  s = s.replace(/^\[Image: original[^\]]*\]$/gim, '');
  s = s.replace(/^\[Request interrupted[^\]]*\]$/gim, '');
  return s.replace(/\n{3,}/g, '\n\n').trim();
}

function semContexto(t) {
  if (!t) return t;
  const i = t.indexOf('Agora, o novo pedido:');
  if (i >= 0) return t.slice(i + 'Agora, o novo pedido:'.length).trim();
  const j = t.indexOf('Arquivos que anexei');
  if (j > 0) return t.slice(0, j).trim();
  return t;
}
const limparTitulo = (t) => (semContexto(t) || '').slice(0, 90);

function fichaCodex(it) {
  const ind = lerIndice();
  const salvo = ind[it.f];
  if (salvo && salvo.mtime === it.mtime && salvo.size === it.size) return salvo;

  let head = headRead(it.f, 96 * 1024);
  let id = '', cwd = '', origem = '', title = '', doAssistente = '';
  const varrer = (texto) => {
  for (const linha of texto.split('\n')) {
    if (!linha.startsWith('{')) continue;
    let d; try { d = JSON.parse(linha); } catch { continue; }
    if (d.type === 'session_meta') {
      const p2 = d.payload || {};
      id = p2.id || p2.session_id || '';
      cwd = p2.cwd || '';
      origem = p2.originator || p2.source || '';
      continue;
    }
    if (!title && d.type === 'response_item') {
      const p2 = d.payload || {};
      if (p2.type === 'message') {
        const t = (p2.content || []).map(c => c.text || '').join(' ').trim();
        if (p2.role === 'user' && t && !ehTecnico(t)) title = limparTitulo(t).slice(0, 90);
        else if (p2.role === 'assistant' && t && !doAssistente) doAssistente = t.slice(0, 90);
      }
    }
    if (title && id) return true;
  }
  return false;
  };
  if (!varrer(head) && it.size > 96 * 1024) varrer(fs.readFileSync(it.f, 'utf8'));   // arquivo grande: le tudo
  if (!title) title = doAssistente;                       // ao menos a primeira resposta
  if (!title) title = 'Conversa de ' + new Date(it.mtime).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const ficha = { mtime: it.mtime, size: it.size, title, cwd, entrada: origem, sid: id };
  ind[it.f] = ficha;
  return ficha;
}

function codexSessions(incluirRobos, nomesDoApp) {
  const achados = [];
  varrerConversas(CODEX_SESS, achados, 0);
  achados.sort((a, b) => b.mtime - a.mtime);
  const meus = lerNomes();
  const out = [];
  let lidos = 0;
  for (const it of achados) {
    const fi = fichaCodex(it);
    lidos++;
    if (!incluirRobos && fi.entrada && !ORIGENS_DE_GENTE.includes(fi.entrada)) continue;
    const id = fi.sid || it.id;
    const title = meus[id] || (nomesDoApp && nomesDoApp[id]) || fi.title;
    if (!title) continue;
    out.push({ engine: 'codex', id, title: title.slice(0, 120), cwd: fi.cwd || HOME, when: it.mtime, file: it.f, entrada: fi.entrada });
  }
  if (lidos) gravarIndice();
  return out;
}

handle('sessions:codex', async (_e, incluirRobos) => {
  // nomes que o proprio Codex guarda (renomeadas por lá)
  const nomesDoApp = {};
  try {
    await codexStart();
    const r = await codexReq('local', 'thread/list', { pageSize: 500 });
    for (const t of ((r && (r.data || r.threads)) || [])) if (t.name) nomesDoApp[t.id] = t.name;
  } catch {}
  try { return codexSessions(incluirRobos, nomesDoApp); }
  catch (e) { return { error: e.message }; }
});

handle('sessions:titulo', (_e, { engine, file, id }) => {
  try {
    if (engine !== 'claude') return '';
    // nome dado por ele ou pelo nome curto ganha do titulo que o Claude inventa
    const meu = id && lerNomes()[id]; if (meu) return meu;
    let f = file;
    if ((!f || !fs.existsSync(f)) && id) {
      const achados = [];
      varrerConversas(CLAUDE_PROJ, achados, 0);
      const it = achados.find(a => a.id === id);
      if (it) f = it.f;
    }
    if (!f || !fs.existsSync(f)) return '';
    const tail = tailRead(f, 96 * 1024);
    const m = [...tail.matchAll(/"aiTitle":"((?:[^"\\]|\\.)*)"/g)];
    if (!m.length) return '';
    try { return JSON.parse('"' + m[m.length - 1][1] + '"'); } catch { return m[m.length - 1][1]; }
  } catch { return ''; }
});

/* Acha o arquivo de uma conversa do Claude pelo id.
   Primeiro tenta a pasta da aba, que e o caso normal. Se nao achar, varre TODAS as pastas de
   projeto: a conversa pode ter comecado com o chat apontando para outra pasta (a home, por
   exemplo) e so depois a aba ter mudado de pasta. Sem esta segunda tentativa, a conversa
   existia inteira no disco e o chat voltava vazio. Medido: varrer as 162 pastas leva 0,3 ms. */
function acharConversaClaude(id, cwd) {
  if (!id) return '';
  try {
    const perto = path.join(CLAUDE_PROJ, encodeCwd(cwd || HOME), id + '.jsonl');
    if (fs.existsSync(perto)) return perto;
  } catch {}
  try {
    for (const pasta of fs.readdirSync(CLAUDE_PROJ)) {
      const f = path.join(CLAUDE_PROJ, pasta, id + '.jsonl');
      if (fs.existsSync(f)) return f;
    }
  } catch {}
  return '';
}

handle('sessions:history', async (_e, { engine, file, id, cwd }) => {
  let alvo = file && fs.existsSync(file) ? file : '';
  /* a 1a fala depois de uma troca de IA leva o contexto colado pelo app ("Estou continuando uma
     conversa... Agora, o novo pedido:"). O Claude, o Codex e o ACP ja tiravam; o Gemini
     mostrava a meia pagina de contexto na bolha dele ao reabrir a conversa. */
  if (engine === 'gemini') {
    return cortarHistorico(cli.historico(alvo)
      .map((m) => (m.role === 'user' && m.text ? { ...m, text: semContexto(m.text) || m.text } : m)), 600, 250);
  }
  /* leva 12.5 — o ACP: o corte é o mesmo dos outros dois motores (600 falas / 250 passos),
     e NÃO o corte de 60 do acp.js, que é o default de quem chama sem dizer nada. Com 60 a
     conversa voltava só com o fim, que é exatamente o bug que a leva do histórico consertou.
     Se o arquivo veio de outra máquina (caminho de lá), o id acha o arquivo daqui. */
  if (motorAcp(engine)) {
    try {
      const f = alvo || acp.arquivoDe(id);
      if (!f || !fs.existsSync(f)) return [];
      // mesma limpeza que o Claude faz: o balão da sua fala não repete o aviso de contexto
      const msgs = acp.historico(id, f, 5000)
        .map((m) => (m.role === 'user' ? { ...m, text: semContexto(m.text) || m.text } : m));
      return cortarHistorico(msgs, 600, 250);
    } catch { return []; }
  }
  if (engine === 'claude') {
    if (!alvo) alvo = acharConversaClaude(id, cwd);
    return alvo ? claudeHistory(alvo, 600, 250) : [];
  }
  // R2-009: se ja sabemos o ARQUIVO clicado (alvo), ele manda — o app-server responde pelo
  // id da thread, que pode ser o mesmo em mais de uma conversa (arquivos diferentes). Buscar
  // pelo id primeiro trazia o estado errado quando duas linhas da lista compartilham id.
  if (alvo) return codexHistory(alvo, 600, 250);
  if (id) {
    try {
      const messages = await codexOfficialHistory(id, destinoDoCwd(cwd));
      if (messages.length) return cortarHistorico(messages, 600, 250);
    } catch (e) { anota('histórico oficial indisponível, usando arquivo local:', e.message); }
    try { const session = codexSessions(true, {}).find(x => x.id === id); if (session) alvo = session.file; } catch {}
  }
  return alvo ? codexHistory(alvo, 600, 250) : [];
});

/* ============ conversas do Claude que rodaram DENTRO da VPS ============
   Elas gravam o .jsonl LA, nao aqui: nao adianta olhar o disco do Mac. Um comando so traz
   tudo (caminho + data + tamanho + a cabeca e a cauda de cada conversa recente, em base64),
   pra nao abrir uma conexao SSH por arquivo. */

/* o mesmo que a fichaConversa le do arquivo, mas a partir do texto que veio do servidor */
function fichaDoTexto(head, tail) {
  const em = head.match(/"entrypoint":"([^"]*)"/);
  const entrada = em ? em[1] : '';
  let title = '';
  const tm = [...tail.matchAll(/"aiTitle":"((?:[^"\\]|\\.)*)"/g)];
  if (tm.length) { try { title = JSON.parse('"' + tm[tm.length - 1][1] + '"'); } catch { title = tm[tm.length - 1][1]; } }
  let cwd = '';
  const cm = head.match(/"cwd":"((?:[^"\\]|\\.)*)"/);
  if (cm) { try { cwd = JSON.parse('"' + cm[1] + '"'); } catch { cwd = cm[1]; } }
  if (!title) {
    for (const linha of head.split('\n')) {
      if (!linha.includes('"type":"user"')) continue;
      try {
        const d = JSON.parse(linha);
        if (d.isMeta) continue;
        const c = d.message && d.message.content;
        const bruto = typeof c === 'string' ? c : Array.isArray(c) ? c.map(x => (x && x.text) || '').join(' ') : '';
        const t = tiraBlocos(bruto);
        if (t && !ehTecnico(t)) { title = limparTitulo(t).slice(0, 90); break; }
      } catch {}
    }
  }
  return { title, cwd, entrada };
}

async function claudeSessionsRemoto(incluirRobos) {
  const r = partesRemoto('vps:/');
  if (!r) return { error: 'servidor desconhecido' };
  const script = "cd ~/.claude/projects 2>/dev/null || exit 0; "
    + "find . -name '*.jsonl' -not -path '*/subagents/*' -not -path '*/workflows/*' "
    + "-printf '%T@ %s %p\\n' 2>/dev/null | sort -rn | head -80 "
    + "| while IFS=' ' read -r mtime tam arq; do "
    + "tb=$(tail -c 65536 \"$arq\" 2>/dev/null | base64 -w0); "
    + "hb=$(head -c 65536 \"$arq\" 2>/dev/null | base64 -w0); "
    + "printf '%s|~|%s|~|%s|~|%s|~|%s\\n' \"$arq\" \"$mtime\" \"$tam\" \"$tb\" \"$hb\"; done; exit 0";
  const rr = await noServidorSsh(r, script, 30000);
  if (rr.error) return { error: rr.error };
  // mesmo cuidado da arvore: erro sem uma palavra viraria "nenhuma conversa na VPS"
  if (rr.code !== 0 && !String(rr.out || '').trim()) {
    return { error: String(rr.errout || '').trim().slice(0, 300)
      || ('A VPS respondeu com erro (código ' + rr.code + ') ao procurar as conversas.') };
  }
  const nomesMeus = lerNomes();
  const out = [];
  for (const linha of String(rr.out || '').split('\n')) {
    if (!linha) continue;
    const partes = linha.split('|~|');
    if (partes.length < 5) continue;
    const [rel, mtimeStr, tamStr, tailB64, headB64] = partes;
    if ((Number(tamStr) || 0) < 300) continue;
    let tail = '', head = '';
    try { tail = Buffer.from(tailB64, 'base64').toString('utf8'); } catch {}
    try { head = Buffer.from(headB64, 'base64').toString('utf8'); } catch {}
    const fi = fichaDoTexto(head, tail);
    if (!incluirRobos && fi.entrada && !ENTRADAS_DE_GENTE.includes(fi.entrada)) continue;
    const id = (rel.split('/').pop() || rel).replace(/\.jsonl$/, '');
    const title = nomesMeus[id] || fi.title;
    if (!title) continue;
    /* O prefixo "vps:" e OBRIGATORIO. Sem ele o filtro de pasta da coluna lateral esvazia a
       lista (a pasta da VPS nao existe no Mac) E o clique abre uma aba LOCAL apontando para
       um caminho que nao existe aqui. */
    out.push({
      engine: 'claude', id, title, cwd: 'vps:' + (fi.cwd || '/'),
      when: Math.round((parseFloat(mtimeStr) || 0) * 1000), file: '', entrada: fi.entrada, remoto: true,
    });
  }
  out.sort((a, b) => b.when - a.when);
  return out;
}

/* O mesmo leitor do claudeHistory, mas a partir do TEXTO que veio do servidor (la o arquivo
   nao existe no disco daqui). Se um dia o claudeHistory mudar, este tem de mudar junto. */
function claudeHistoryTexto(data, maxFalas, maxTools) {
  const msgs = [];
  for (const line of String(data || '').split('\n')) {
    if (!line.startsWith('{')) continue;
    let d; try { d = JSON.parse(line); } catch { continue; }
    if (d.isMeta) continue;
    if (d.type === 'user' && d.message) {
      const c = d.message.content;
      let t = typeof c === 'string' ? c : Array.isArray(c) ? c.filter(x => x && x.type === 'text').map(x => x.text).join('\n') : '';
      t = tiraBlocos(t);
      if (t && !ehTecnico(t)) msgs.push({ role: 'user', text: semContexto(t) || t });
    } else if (d.type === 'assistant' && d.message) {
      const c = d.message.content || [];
      for (const x of c) {
        if (x.type === 'text' && x.text && x.text.trim()) msgs.push({ role: 'bot', text: x.text });
        else if (x.type === 'tool_use') msgs.push({ role: 'tool', name: x.name, arg: claudeToolArg(x.name, x.input) });
      }
    }
  }
  return cortarHistorico(msgs, maxFalas || 600, maxTools);
}

/* A tela percorre a resposta com `for (const m of msgs)`: devolver {error} ali estoura um
   TypeError e o painel fica MUDO, sem nem dizer o que houve. Como item de lista com role
   'note', a frase aparece na conversa em vermelho (renderizarHistorico entende 'note'). */
const notaDeErro = (texto) => [{ role: 'note', text: texto, error: true }];

/* le o .jsonl de uma conversa que rodou na VPS: procura pelo id em ~/.claude/projects e traz o
   conteudo em base64, numa conexao so. Sem isto, clicar na conversa abria um chat vazio. */
async function claudeHistoryRemoto(id) {
  const r = partesRemoto('vps:/');
  if (!r) return notaDeErro('Não consegui trazer esta conversa: servidor desconhecido.');
  const seguro = String(id || '').replace(/[^\w-]/g, '');
  if (!seguro) return [];
  const script = 'f=$(find ~/.claude/projects -name ' + aspaSh(seguro + '.jsonl') + ' -print -quit 2>/dev/null); '
    + '[ -n "$f" ] && tail -c 6000000 "$f" | base64 -w0; exit 0';
  const rr = await noServidorSsh(r, script, 30000);
  if (rr.error) return notaDeErro('Não consegui trazer esta conversa da VPS: ' + rr.error);
  const b64 = String(rr.out || '').trim();
  // erro sem uma palavra viraria conversa vazia, como se ela nunca tivesse existido
  if (rr.code !== 0 && !b64) {
    return notaDeErro('A VPS respondeu com erro (código ' + rr.code + ') ao ler esta conversa. '
      + String(rr.errout || '').trim().slice(0, 200));
  }
  if (!b64) return [];   // nao esta mais la: isso e resposta, nao falha de conexao
  let texto = '';
  try { texto = Buffer.from(b64, 'base64').toString('utf8'); }
  catch { return notaDeErro('A resposta do servidor veio corrompida.'); }
  // o corte e o DAQUI (600 falas / 250 ferramentas), nao os 60 itens do fork de origem
  return claudeHistoryTexto(texto, 600, 250);
}

handle('sessions:claudeRemoto', (_e, incluirRobos) => claudeSessionsRemoto(incluirRobos));
handle('sessions:historyRemoto', (_e, o) => claudeHistoryRemoto(o && o.id));

/* ============ apagar conversa e ramificar de verdade (leva 8) ============ */

/* Trava obrigatoria: so e "arquivo de conversa" o .jsonl que mora DENTRO das pastas de sessao
   do Claude ou do Codex. Sem ela, um caminho qualquer guardado na ficha do painel iria para a
   Lixeira ao clicar em "Apagar conversa". */
function ehArquivoDeConversa(f) {
  try {
    const p = path.resolve(String(f || ''));
    const extras = [path.join(app.getPath('userData'), 'acp'), path.join(app.getPath('userData'), 'gemini'), path.join(HOME, '.gemini', 'tmp')];
    if (/\.jsonl?$/i.test(p) && extras.some(r => p.startsWith(path.resolve(r) + path.sep))) return true;
    if (!/\.jsonl$/i.test(p)) return false;
    const raizes = [CLAUDE_PROJ, CODEX_SESS].filter(Boolean).map((r) => path.resolve(r));
    return raizes.some((r) => p === r || p.startsWith(r + path.sep));
  } catch { return false; }
}

/* ipcMain.handle DIRETO, fora do mapa HANDLERS (R1): apagar e destrutivo, e o iPhone nao pode
   mandar arquivo do Mac para a Lixeira pelo Wi-Fi. Vai para a Lixeira, nunca unlink: da para
   voltar atras se ele mudar de ideia. */
ipcMain.handle('sessao:apagar', async (_e, dados) => {
  const { id, file, engine } = dados || {};
  try {
    let f = ehArquivoDeConversa(file) ? path.resolve(String(file)) : null;
    /* rede de seguranca so para o Claude: la o nome do arquivo E o numero da conversa. No Codex
       o id vem de dentro do arquivo (fi.sid), entao procurar pelo nome pegaria o arquivo errado
       — ali vale so o caminho que a lista mandou. */
    if ((!f || !fs.existsSync(f)) && id && engine === 'claude') {
      const achados = [];
      varrerConversas(CLAUDE_PROJ, achados, 0);
      const it = achados.find((a) => a.id === id);
      if (it && ehArquivoDeConversa(it.f)) f = it.f;
    }
    if (!f || !fs.existsSync(f)) return { error: 'Não achei o arquivo desta conversa.' };
    try { await shell.trashItem(f); }
    catch (e) { return { error: 'Não consegui mandar para a Lixeira: ' + String(e && e.message || e) }; }
    /* o indice de busca do local guarda o TEXTO de cada conversa. Sem tirar o carimbo daqui,
       a conversa apagada continuaria aparecendo na busca da coluna lateral. */
    try { const c = lerCarimbos(); if (c && c[f]) { delete c[f]; gravarCarimbosDepois(); } } catch {}
    // e o apelido que ele deu para ela
    try {
      const nomes = lerNomes();
      if (id && nomes[id]) { delete nomes[id]; if (nomes._origem) delete nomes._origem[id]; salvarNomes(nomes); }
    } catch {}
    // e a costura com as outras partes: ligacao apontando para arquivo na Lixeira so faria a
    // lista procurar uma parte que nao existe mais
    try { esquecerLigacoesDe(engine, id); } catch {}
    // o indice de titulos tambem aponta para o arquivo que acabou de sumir
    try { const ind2 = lerIndice(); if (ind2 && ind2[f]) { delete ind2[f]; gravarIndice(); } } catch {}
    return { ok: true };
  } catch (e) { return { error: String(e && e.message || e) }; }
});

/* Ramificar de verdade. O Claude ramifica no PROPRIO start (--resume + --fork-session), entao
   nem passa por aqui; o Codex tem thread/fork nativo (conferido no binario 0.153.4). Entra por
   handle() de proposito: nao apaga nada, so CRIA uma conversa nova — e assim o iPhone, que roda
   o mesmo app.js, ramifica igual ao Mac. */
handle('sessao:fork', async (_e, dados) => {
  const { engine, id } = dados || {};
  try {
    if (!id) return { error: 'esta conversa ainda não tem número' };
    if (engine !== 'codex') return { error: 'Este motor não ramifica por aqui.' };
    await codexStart('local');
    const f = await codexReq('local', 'thread/fork', { threadId: id });
    const nid = f && (f.threadId || (f.thread && f.thread.id));
    return nid ? { id: nid } : { error: 'O Codex não devolveu a conversa nova.' };
  } catch (e) { return { error: String(e && e.message || e) }; }
});

/* ======================= comandos e skills ======================= */
function readSkillDirs(dirs) {
  const out = [];
  for (const d of dirs) {
    let names = [];
    try { names = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of names) {
      if (e.isDirectory()) {
        const f = path.join(d, e.name, 'SKILL.md');
        if (fs.existsSync(f)) out.push({ name: e.name, desc: skillDesc(f) });
      } else if (e.name.endsWith('.md')) {
        out.push({ name: e.name.replace(/\.md$/, ''), desc: skillDesc(path.join(d, e.name)) });
      }
    }
  }
  return out;
}
function skillDesc(file) {
  const head = headRead(file, 1600);
  const m = head.match(/^description:\s*(.+)$/m);
  if (m) return m[1].replace(/^["']|["']$/g, '').slice(0, 140);
  const t = head.split('\n').find(l => l.trim() && !l.startsWith('---') && !l.startsWith('name:'));
  return (t || '').replace(/^#+\s*/, '').slice(0, 140);
}

/* ---------- skills nativas do Codex (skills/list do app-server) ----------
   Quem sabe as skills de verdade no Codex e' o proprio app-server: ele resolve escopo
   (pessoal, projeto, plugin), respeita o que esta desligado e enxerga a PASTA do painel. A
   varredura de disco continua sendo a base — e' ela quem acha ~/.codex/prompts — e tambem a
   rede de seguranca quando a chamada nativa falha.

   Cache PROPRIO, por pasta e com validade: o skillCache de baixo e' eterno e por MOTOR. Isso
   serve para o Claude (as skills dele nao mudam com a pasta), mas aqui daria dois defeitos —
   a pasta do painel B veria a lista do painel A, e skill nova so' apareceria reabrindo o app. */
const skillsCodexCache = new Map();     // cwd -> { quando, lista }
const SKILL_CODEX_VALE = 60 * 1000;     // um minuto: skill nova aparece sem reabrir o app
const SKILL_CODEX_MAX = 12;             // uma chave por pasta aberta; a mais velha sai

// mesma leitura do protocolo, com os campos que o menu "/" usa
function normalizarSkillsNativas(resposta, cwd) {
  const entradas = resposta && Array.isArray(resposta.data) ? resposta.data : [];
  const querido = String(cwd || '').toLowerCase();
  const entrada = entradas.find((x) => String((x && x.cwd) || '').toLowerCase() === querido) || entradas[0];
  if (!entrada || !Array.isArray(entrada.skills)) return [];
  return entrada.skills.filter((s) => s && s.enabled !== false).map((s) => ({
    name: String(s.name || ''),
    desc: String((s.interface && s.interface.shortDescription) || s.shortDescription || s.description || '').slice(0, 240),
    displayName: String((s.interface && s.interface.displayName) || s.name || ''),
    path: String(s.path || ''),
    scope: String(s.scope || ''),
    source: 'native',
  })).filter((s) => s.name);
}

async function skillsNativasDoCodex(cwd) {
  // R7: painel da VPS roda o app-server DE LA. Perguntar as skills de "vps:/opt/..." ao Codex
  // do Mac devolveria a lista da pasta errada; melhor devolver nada e deixar so' o disco.
  if (!cwd || ehRemoto(cwd)) return null;
  const c = skillsCodexCache.get(cwd);
  if (c && Date.now() - c.quando < SKILL_CODEX_VALE) return c.lista;
  /* so' pergunta se o app-server JA esta de pe. Esperar o codexStart aqui segurava o menu "/"
     por ate' 45s na primeira abertura (30s do initialize + 15s da chamada) — o menu tem de
     abrir na hora, com o que houver, e as nativas entram na proxima abertura. */
  if (!conexaoCodex('local').proc) { codexStart('local').catch(() => {}); return null; }
  try {
    const r = await codexReq('local', 'skills/list', { cwds: [cwd] }, 6000);
    const lista = normalizarSkillsNativas(r, cwd);
    skillsCodexCache.delete(cwd);        // reinsere no fim: a mais velha a sair e' a menos usada
    skillsCodexCache.set(cwd, { quando: Date.now(), lista });
    if (skillsCodexCache.size > SKILL_CODEX_MAX) skillsCodexCache.delete(skillsCodexCache.keys().next().value);
    return lista;
  } catch { return null; }   // nao virou cache: na proxima abertura pergunta de novo
}

// a nativa vale mais que a do disco quando as duas tem o mesmo nome
function juntarSkills(nativas, disco) {
  const vistas = new Set(); const out = [];
  for (const lista of [nativas || [], disco || []]) {
    for (const s of lista) { if (!s || !s.name || vistas.has(s.name)) continue; vistas.add(s.name); out.push(s); }
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

// a varredura de disco de sempre, chamada pelo nome: assim a parte nova reaproveita o codigo
// antigo sem copiar nem mexer nele
const skillsDoDisco = (engine) => HANDLERS['skills:list'](null, engine);

// R1-010: guarda {quando, lista} em vez da lista crua, com a mesma validade (SKILL_CODEX_VALE)
// do cache de skills nativas do Codex — sem prazo, skill nova so aparecia reabrindo o app
let skillCache = { claude: null, codex: null };
handle('skills:list', (_e, engine) => {
  /* NOVO: o painel passou a mandar { engine, cwd }. A forma antiga — so' a string do motor —
     continua valendo, e e' a que o iPhone manda e a que a varredura de disco usa aqui embaixo. */
  if (engine && typeof engine === 'object') {
    const ped = engine;
    engine = ped.engine;
    // painel ACP: os comandos "/" são os que o agente DAQUELE painel anunciou, não skills de disco
    if (motorAcp(engine)) return acp.comandos(ped.paneId) || [];
    if (engine === 'codex') return skillsNativasDoCodex(ped.cwd).then((n) => juntarSkills(n, skillsDoDisco('codex')));
  }
  /* forma antiga (só a string do motor, que é a que o iPhone manda): sem o painel não dá para
     saber de qual agente são os comandos. Sem esta linha o ACP caía no "senão" lá embaixo e
     listava as skills do Codex, que ele não tem como usar. */
  if (motorAcp(engine)) return [];
  if (engine === 'gemini') return cli.comandos();
  const cacheAtual = skillCache[engine];
  if (cacheAtual && Date.now() - cacheAtual.quando < SKILL_CODEX_VALE) return cacheAtual.lista;
  let dirs;
  if (engine === 'claude') {
    dirs = [path.join(HOME, '.claude/skills'), path.join(HOME, '.claude/commands')];
    // skills que vem de plugins
    const pc = path.join(HOME, '.claude/plugins/cache');
    try {
      for (const owner of fs.readdirSync(pc)) {
        const od = path.join(pc, owner);
        for (const plug of fs.readdirSync(od)) {
          const pd = path.join(od, plug);
          for (const ver of fs.readdirSync(pd)) {
            const sd = path.join(pd, ver, 'skills');
            if (fs.existsSync(sd)) dirs.push(sd);
          }
        }
      }
    } catch {}
  } else {
    dirs = [path.join(HOME, '.codex/skills'), path.join(HOME, '.codex/prompts'), path.join(HOME, '.agents/skills')];
  }
  const seen = new Set(); const out = [];
  for (const s of readSkillDirs(dirs)) { if (seen.has(s.name)) continue; seen.add(s.name); out.push(s); }
  out.sort((a, b) => a.name.localeCompare(b.name));
  skillCache[engine] = { quando: Date.now(), lista: out };
  return out;
});

/* ---------- conectores (MCP) ---------- */
function rodar(bin, args, timeout) {
  // spawnBin em vez de execFile porque no Windows o binario pode ser um .cmd,
  // que o Node se recusa a chamar direto desde a correcao de seguranca do Node 20
  return new Promise((res) => {
    let out = '', errout = '', acabou = false;
    const p = spawnBin(bin, args, { env: buildEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    const t = setTimeout(() => { try { p.kill(); } catch {} }, timeout || 60000);
    const fim = (err) => { if (acabou) return; acabou = true; clearTimeout(t); res({ err, out, errout }); };
    p.stdout.on('data', (d) => { if (out.length < 4 * 1024 * 1024) out += d.toString('utf8'); });
    p.stderr.on('data', (d) => { if (errout.length < 4 * 1024 * 1024) errout += d.toString('utf8'); });
    p.on('error', (e) => fim(e));
    p.on('close', (code) => fim(code === 0 ? null : new Error('saiu com código ' + code)));
  });
}

/* ---------- GPT-6 Astra pela API, com trava de gasto ---------- */
const USO_ASTRA_PATH = () => path.join(app.getPath('userData'), 'openai-api-uso.json');
let usoAstraCache = null;
let chaveAstraCache = null;
let testeAstra = { estado: 'nao-testado', mensagem: 'Chave ainda não testada.', quando: 0 };

function mesAstra() { return new Date().toISOString().slice(0, 7); }
function lerUsoAstra() {
  if (usoAstraCache) return usoAstraCache;
  try { usoAstraCache = JSON.parse(fs.readFileSync(USO_ASTRA_PATH(), 'utf8')); } catch { usoAstraCache = {}; }
  usoAstraCache.version = 1;
  usoAstraCache.months = usoAstraCache.months || {};
  usoAstraCache.threads = usoAstraCache.threads || {};
  return usoAstraCache;
}
function gastoAstraMicros() {
  const d = lerUsoAstra();
  return Number((d.months[mesAstra()] || {}).usdMicros || 0);
}
function configAstra() {
  const c = loadConfig();
  const cap = Number(c.codexApiCapUsd);
  return {
    enabled: !!c.codexApiEnabled,
    capUsd: Number.isFinite(cap) && cap > 0 ? Math.min(10000, cap) : 10,
  };
}
async function lerChaveAstra() {
  if (process.platform !== 'darwin') return '';
  const r = await rodar('/usr/bin/security', ['find-generic-password', '-a', ASTRA_KEYCHAIN_ACCOUNT,
    '-s', ASTRA_KEYCHAIN_SERVICE, '-w'], 8000);
  return r.err ? '' : String(r.out || '').trim();
}
async function temChaveAstra(denovo) {
  if (denovo || chaveAstraCache === null) chaveAstraCache = !!(await lerChaveAstra());
  return chaveAstraCache;
}
async function guardarChaveAstra(chave) {
  if (process.platform !== 'darwin') return { error: 'A chave segura está disponível somente no Mac.' };
  const limpa = String(chave || '').trim();
  if (!/^sk-[A-Za-z0-9_-]{20,}$/.test(limpa)) return { error: 'Essa chave não parece uma chave da OpenAI.' };
  const r = await rodar('/usr/bin/security', ['add-generic-password', '-U', '-a', ASTRA_KEYCHAIN_ACCOUNT,
    '-s', ASTRA_KEYCHAIN_SERVICE, '-w', limpa], 10000);
  if (r.err) return { error: 'Não consegui guardar a chave no Chaveiro do Mac.' };
  chaveAstraCache = true;
  testeAstra = { estado: 'nao-testado', mensagem: 'Chave guardada. Falta testar o acesso ao Astra.', quando: 0 };
  return { ok: true };
}
async function testarAstra() {
  const chave = await lerChaveAstra();
  if (!chave) {
    chaveAstraCache = false;
    testeAstra = { estado: 'sem-chave', mensagem: 'Nenhuma chave da OpenAI foi guardada.', quando: Date.now() };
    return testeAstra;
  }
  chaveAstraCache = true;
  try {
    // Consultar os dados do modelo não gera texto e não consome tokens pagos.
    const r = await fetch('https://api.openai.com/v1/models/' + ASTRA_API_MODEL, {
      headers: { Authorization: 'Bearer ' + chave },
    });
    if (r.ok) testeAstra = { estado: 'pronto', mensagem: 'A API desta chave já tem acesso ao Astra.', quando: Date.now() };
    else if (r.status === 401) testeAstra = { estado: 'erro', mensagem: 'A chave é inválida ou foi cancelada.', quando: Date.now() };
    else if (r.status === 403 || r.status === 404) testeAstra = { estado: 'aguardando', mensagem: 'A chave funciona, mas este projeto ainda não recebeu o Astra.', quando: Date.now() };
    else testeAstra = { estado: 'erro', mensagem: 'A OpenAI respondeu com erro ' + r.status + '.', quando: Date.now() };
  } catch {
    testeAstra = { estado: 'erro', mensagem: 'Não consegui falar com a OpenAI. Confira a internet.', quando: Date.now() };
  }
  return testeAstra;
}
async function estadoAstra() {
  const c = configAstra();
  const gasto = gastoAstraMicros() / 1000000;
  return {
    configured: await temChaveAstra(false), enabled: c.enabled, capUsd: c.capUsd,
    spentUsd: gasto, remainingUsd: Math.max(0, c.capUsd - gasto),
    testStatus: testeAstra.estado, testMessage: testeAstra.mensagem, testedAt: testeAstra.quando,
  };
}
async function validarUsoAstra() {
  if (process.platform !== 'darwin') throw new Error('O Astra por créditos está preparado somente no Mac.');
  const c = configAstra();
  if (!c.enabled) throw new Error('O uso por créditos está desligado nos Ajustes.');
  if (!(await temChaveAstra(false))) throw new Error('Guarde uma chave da OpenAI nos Ajustes antes de usar créditos.');
  if (gastoAstraMicros() >= Math.round(c.capUsd * 1000000)) {
    throw new Error('O limite mensal do Astra por créditos foi atingido. Aumente o teto nos Ajustes para continuar.');
  }
}
function custoAstraMicros(tokens) {
  const entrada = Math.max(0, Number(tokens.inputTokens || 0));
  const cache = Math.max(0, Number(tokens.cachedInputTokens || 0));
  const cacheGravado = Math.max(0, Number(tokens.cacheWriteInputTokens || 0));
  const normal = Math.max(0, entrada - cache - cacheGravado);
  const saida = Math.max(0, Number(tokens.outputTokens || 0));
  // Preços oficiais em dólares por milhão. O resultado abaixo já fica em milionésimos de dólar.
  return Math.max(0, Math.round(normal * 10 + cache * 1 + cacheGravado * 12.5 + saida * 50));
}
function registrarUsoAstra(threadId, tokens) {
  const d = lerUsoAstra();
  const id = String(threadId || 'sem-id');
  const total = custoAstraMicros(tokens);
  const anterior = Number((d.threads[id] || {}).usdMicros || 0);
  const delta = Math.max(0, total - anterior);
  d.threads[id] = { usdMicros: Math.max(anterior, total), updatedAt: Date.now() };
  const mes = mesAstra();
  const m = d.months[mes] || { usdMicros: 0 };
  m.usdMicros = Number(m.usdMicros || 0) + delta;
  d.months[mes] = m;
  if (delta) gravarSeguro(USO_ASTRA_PATH(), JSON.stringify(d, null, 2));
  const c = configAstra();
  const gasto = m.usdMicros / 1000000;
  return { spentUsd: gasto, capUsd: c.capUsd, remainingUsd: Math.max(0, c.capUsd - gasto) };
}
/* ---------- terminal embutido: roda no app, sem abrir o Terminal do sistema ----------
   Dá um terminal de verdade (pty) ao comando, assim as telinhas interativas
   (login, colar codigo) funcionam dentro do Cockpit. No Mac quem faz isso é o
   ptybridge.py; no Windows é o ConPTY. Quem escolhe é o plataforma.js.        */
const terms = new Map();
const PTY_BRIDGE = app.isPackaged
  ? path.join(process.resourcesPath, 'ptybridge.py')
  : path.join(__dirname, 'ptybridge.py');

function termEnviar(id, kind, data) {
  if (win && !win.isDestroyed()) win.webContents.send('term:event', { id, kind, ...data }); avisarWeb('term:event', { id, kind, ...data });
}

function termRodar({ id, linha, cols, rows }) {
  if (!id || !linha) return { error: 'faltou o comando' };
  termMatar(id);
  const c = Math.max(40, Math.min(400, Number(cols) || 100));
  const r = Math.max(10, Math.min(200, Number(rows) || 30));
  let p;
  try {
    p = abrirPty({
      linha, cols: c, rows: r, cwd: HOME, ptyBridge: PTY_BRIDGE,
      env: { ...buildEnv(), TERM: 'xterm-256color', COLUMNS: String(c), LINES: String(r) },
    });
  } catch (e) { return { error: e.message }; }
  terms.set(id, p);
  p.onData((d) => { if (terms.get(id) === p) termEnviar(id, 'data', { data: d }); });
  p.onErro((e) => { if (terms.get(id) === p) termEnviar(id, 'data', { data: '\r\n[erro: ' + e.message + ']\r\n' }); });
  p.onFim((code) => { if (terms.get(id) !== p) return; terms.delete(id); termEnviar(id, 'exit', { code }); });
  return { ok: true };
}

function termMatar(id) {
  const p = terms.get(id);
  if (!p) return { ok: true };
  terms.delete(id);
  p.matar();
  return { ok: true };
}

handle('term:run', (_e, o) => termRodar(o || {}));
handle('term:input', (_e, { id, data }) => {
  const p = terms.get(id);
  if (!p) return { error: 'esse terminal já fechou' };
  try { p.escrever(data); } catch (e) { return { error: e.message }; }
  return { ok: true };
});
handle('term:resize', (_e, { id, cols, rows }) => {
  const p = terms.get(id);
  if (!p) return { ok: true };
  p.redimensionar(Math.round(cols), Math.round(rows));
  return { ok: true };
});
handle('term:kill', (_e, { id }) => termMatar(id));

// R3-009: este before-quit rodava ANTES do de shutdown() (registrado mais abaixo) e ja
// esvaziava `terms` sem esperar nada — o laco de terminais dentro de shutdown() achava o
// mapa vazio e o Promise.all nunca chegava a esperar o pty morrer de verdade. Removido:
// shutdown() agora mata e espera os terminais sozinho (ver mais abaixo).

function alvoDoTransporte(t) {
  if (!t) return '';
  if (t.url) return t.url;
  const c = t.command;
  if (Array.isArray(c)) return c.join(' ');
  if (typeof c === 'string') return c + (Array.isArray(t.args) ? ' ' + t.args.join(' ') : '');
  return t.type || '';
}

handle('mcp:list', async (_e, engine) => {
  // resposta honesta: o Cockpit não configura os conectores de um agente que ele só conversa
  if (motorAcp(engine) || engine === 'gemini') return { error: 'Os conectores do agente ACP se configuram no próprio agente, pelo terminal dele (ex.: "gemini mcp").' };
  if (engine === 'codex') {
    const r = await rodar('codex', ['mcp', 'list', '--json'], 45000);
    try {
      const arr = JSON.parse(r.out);
      return arr.map(m => ({
        nome: m.name,
        alvo: alvoDoTransporte(m.transport),
        ligado: m.enabled !== false,
        precisaEntrar: m.auth_status === 'not_logged_in' && (m.transport || {}).type !== 'stdio',
        status: m.auth_status === 'logged_in' ? 'conectado'
          : m.auth_status === 'not_logged_in' ? 'precisa entrar' : (m.disabled_reason || 'ok'),
      }));
    } catch (e) { return { error: 'não consegui ler a lista do Codex: ' + String(e.message).slice(0, 160) }; }
  }
  const r = await rodar(CLAUDE_BIN, ['mcp', 'list'], 90000);
  const linhas = (r.out + '\n' + r.errout).split('\n').map(l => l.trim()).filter(Boolean);
  const out = [];
  for (const l of linhas) {
    const m = l.match(/^(.+?):\s+(\S+)\s+-\s+(.+)$/);
    if (!m) continue;
    const st = m[3];
    out.push({
      nome: m[1], alvo: m[2],
      ligado: true,
      precisaEntrar: /authentication|auth/i.test(st),
      status: /Connected/i.test(st) ? 'conectado' : /authentication/i.test(st) ? 'precisa entrar' : st.replace(/[✔✗!⏸]/g, '').trim(),
    });
  }
  return out;
});

handle('mcp:acao', async (_e, { engine, acao, nome, url, comando }) => {
  // R1-045: diferente dos outros canais sensiveis deste arquivo, faltava a trava de origem.
  // Adicionar conector por COMANDO local roda um executavel qualquer no Mac com acesso total
  // (RCE) — o celular so pode adicionar conector por URL remota, nunca por comando local.
  if (souRemoto(_e) && acao === 'add' && comando) return { error: 'Conector local só pode ser adicionado no Mac.' };
  if (motorAcp(engine) || engine === 'gemini') return { error: 'Adicione pelo terminal do próprio agente ACP.' };
  const bin = engine === 'claude' ? CLAUDE_BIN : 'codex';
  const cru = engine === 'claude' ? CLAUDE_BIN : acharBin('codex');
  // Esta linha vai para o /bin/sh. O JSON.stringify() de antes so poe aspas DUPLAS, e dentro
  // delas o sh ainda expande $(...) e crase: um nome de conector com isso dentro (vem do
  // formulario e do ~/.claude.json, que qualquer programa escreve) rodava comando escondido.
  // Aspas SIMPLES nao expandem nada.
  const aspas = (s) => "'" + String(s).replace(/'/g, "'\\''") + "'";
  const nomeBin = aspas(cru);
  if (acao === 'login' || acao === 'logout') {
    // roda no terminal embutido do Cockpit, sem abrir o Terminal do Mac
    return { terminal: nomeBin + ' mcp ' + acao + ' ' + aspas(nome),
             titulo: (acao === 'login' ? 'Entrar no conector ' : 'Sair do conector ') + nome };
  }
  if (acao === 'remove') {
    const r = await rodar(bin, ['mcp', 'remove', nome], 30000);
    return r.err ? { error: (r.errout || r.err.message).slice(0, 300) } : { ok: true };
  }
  if (acao === 'add') {
    if (!nome) return { error: 'falta o nome' };
    let args;
    if (url) {
      args = engine === 'claude' ? ['mcp', 'add', '--transport', 'http', nome, url] : ['mcp', 'add', nome, '--url', url];
    } else if (comando) {
      const partes = comando.split(/\s+/).filter(Boolean);
      args = engine === 'claude' ? ['mcp', 'add', nome, '--', ...partes] : ['mcp', 'add', nome, '--', ...partes];
    } else return { error: 'informe o endereço ou o comando' };
    const r = await rodar(bin, args, 45000);
    return r.err ? { error: (r.errout || r.out || r.err.message).slice(0, 300) } : { ok: true };
  }
  return { error: 'ação desconhecida' };
});

/* ---------- conta e limite de uso ---------- */
// Mac: Chaveiro. Windows: arquivo de credenciais. Detalhe em plataforma.js
const tokenDoClaude = plataforma.tokenClaude;

// fica guardado na memoria: assim o Chaveiro so e consultado uma vez por sessao do app,
// em vez de a cada leitura da faixa de uso
let credGuardada = null, credQuando = 0;
// R2-017: tokenDoClaude agora e assincrono (plataforma.js), entao credClaude precisa esperar
// por ele — sem o await, a Promise (sempre "verdadeira") vira o token, e a leitura de uso
// quebra em silencio.
async function credClaude(denovo) {
  if (denovo) { credGuardada = null; credQuando = 0; }
  // R1-049: token BOM continua em cache pra sessao inteira, como antes (um so achado no
  // Chaveiro). So o "nao achei" ganha prazo de 90s — sem isso, Chaveiro bloqueado/trancado
  // repetia a chamada de leitura a cada leitura de uso.
  if (!credGuardada && Date.now() - credQuando > 90000) {
    credGuardada = await tokenDoClaude();
    credQuando = Date.now();
  }
  return credGuardada;
}

/* UMA leitura do limite do Claude para todo mundo: faixa, cartao da conta, janela da conta e
   celular. Antes cada um perguntava por conta propria (a coluna aberta de 2 em 2 min, o fim de
   cada resposta de cada chat, o celular...). Com varios chats trabalhando, a Anthropic
   respondia 429 e a tela APAGAVA os numeros que ja tinha, ficando so com "—".
   Agora: a leitura vale 90s, pedidos ao mesmo tempo viram um so, no 429 espera o prazo que
   ela manda (retry-after) e, enquanto isso, devolve o ultimo numero bom com a hora dele. */
const USO_VALE_MS = 90 * 1000;
// R3-018: geracao sobe a cada troca de conta (esquecerUso); uma leitura que comecou ANTES da
// troca so grava no cache se a geracao ainda for a mesma — senao e numero da conta que saiu.
const usoClaude = { dados: null, quando: 0, pausaAte: 0, pausa: 0, voando: null, geracao: 0 };
const ultimoBomClaude = () => (usoClaude.dados ? { ...usoClaude.dados, velho: usoClaude.quando } : null);

async function usoDoClaude() {
  const agora = Date.now();
  if (usoClaude.dados && agora - usoClaude.quando < USO_VALE_MS) return usoClaude.dados;
  if (agora < usoClaude.pausaAte) return ultimoBomClaude() || { limitado: true, voltaEm: usoClaude.pausaAte };
  if (!usoClaude.voando) usoClaude.voando = buscarUsoDoClaude().finally(() => { usoClaude.voando = null; });
  return usoClaude.voando;
}

async function buscarUsoDoClaude(segundaTentativa) {
  // R3-018: guarda a geracao de ANTES do fetch. Se a conta trocar enquanto isso viaja, essa
  // leitura e da conta velha e nao pode sujar o cache (que ja e da conta nova).
  const minhaGeracao = usoClaude.geracao;
  const t = await credClaude(false);
  if (!t) return null;
  try {
    const r = await fetch('https://api.anthropic.com/api/oauth/usage', {
      headers: { Authorization: 'Bearer ' + t, 'anthropic-beta': 'oauth-2025-04-20' },
    });
    // vencida: descarta a guardada e tenta mais uma vez com a atual
    if ((r.status === 401 || r.status === 403) && !segundaTentativa) { await credClaude(true); return buscarUsoDoClaude(true); }
    // 429 e "muita consulta em pouco tempo", nao e conta com problema. Espera o que ela
    // mandar; sem prazo, dobra a espera a cada 429 seguido (2, 4, 8... ate 15 min)
    if (r.status === 429) {
      const pediu = Number(r.headers.get('retry-after')) * 1000;
      usoClaude.pausa = Math.min(15 * 60000, Math.max(60000, pediu > 0 ? pediu : (usoClaude.pausa * 2 || 120000)));
      usoClaude.pausaAte = Date.now() + usoClaude.pausa;
      return ultimoBomClaude() || { limitado: true, voltaEm: usoClaude.pausaAte };
    }
    if (!r.ok) return ultimoBomClaude();
    const j = await r.json();
    if (usoClaude.geracao === minhaGeracao) Object.assign(usoClaude, { dados: j, quando: Date.now(), pausa: 0, pausaAte: 0 });
    return j;
  } catch { return ultimoBomClaude(); }
}

/* Janela do Claude na forma que a tela usa. Numero ANTIGO de uma janela que ja virou nao vale
   mais (o 97% da sessao de ontem nao e o de agora): vira "sem dado". */
function janelaClaude(x, velho) {
  if (!x) return null;
  // R3-020: data que o Date.parse nao entende vira NaN sem o '|| 0' — igual ao janelasDoGemini
  const reseta = (x.resets_at && Date.parse(x.resets_at)) || 0;
  if (velho && reseta && reseta < Date.now()) return null;
  return { pct: Math.round(x.utilization || 0), reseta };
}

/* Limite do Codex, com o mesmo ultimo-numero-bom do Claude. O plano Pro de hoje so tem a
   janela da SEMANA (primary de 10080 min, secondary vazio): a "Sessão" vazia e verdade, nao
   defeito, e a tela precisa saber disso (semSessao) para nao mostrar "—" como se tivesse falhado. */
// R3-019: mesmo padrao de cache/single-flight dos outros 3 motores (ver comentario da UMA
// leitura, acima) — antes cada painel do Codex pedia account/rateLimits/read direto, sem
// aproveitar leitura recente nem juntar pedidos simultaneos num so.
const usoCodex = { dados: null, quando: 0, voando: null, geracao: 0 };
// trocou de conta: o ultimo numero bom era da conta ANTERIOR e nao pode aparecer como desta.
// R3-018: sobe a geracao e zera 'voando' — sem isso uma leitura ja em voo da conta antiga
// podia terminar DEPOIS da troca e gravar o numero errado por cima do cache da conta nova.
// R4-001: R3-018 tinha ficado incompleto no Codex (so' os outros 3 motores subiam geracao).
function esquecerUso(engine) {
  if (engine === 'claude') { credGuardada = null; credQuando = 0; usoClaude.geracao++; Object.assign(usoClaude, { dados: null, quando: 0, pausaAte: 0, pausa: 0, voando: null }); }
  if (engine === 'codex') { usoCodex.geracao++; Object.assign(usoCodex, { dados: null, quando: 0, voando: null }); }
  if (engine === 'grok') { usoGrok.geracao++; Object.assign(usoGrok, { dados: null, quando: 0, pausaAte: 0, pausa: 0, voando: null }); }
  if (engine === 'gemini') { usoGemini.geracao++; Object.assign(usoGemini, { dados: null, quando: 0, pausaAte: 0, pausa: 0, voando: null }); }
}
async function limitesDoCodex() {
  const agora = Date.now();
  if (usoCodex.dados && agora - usoCodex.quando < USO_VALE_MS) return { rl: usoCodex.dados, velho: 0 };
  // R4-001: guarda a geracao de ANTES do fetch, mesmo padrao do buscarUsoDoClaude — se a conta
  // trocar enquanto isso viaja, essa leitura e da conta velha e nao pode sujar o cache da nova.
  const minhaGeracao = usoCodex.geracao;
  if (!usoCodex.voando) usoCodex.voando = (async () => {
    try {
      await codexStart();
      const lim = await codexReq('local', 'account/rateLimits/read', {});
      const rl = (lim && lim.rateLimits) || null;
      if (!rl) throw new Error('sem rateLimits');
      if (usoCodex.geracao === minhaGeracao) Object.assign(usoCodex, { dados: rl, quando: Date.now() });
      return { rl, velho: 0 };
    } catch {
      return usoCodex.dados ? { rl: usoCodex.dados, velho: usoCodex.quando } : { rl: null, velho: 0 };
    }
  })().finally(() => { usoCodex.voando = null; });
  return usoCodex.voando;
}
function janelasDoCodex(rl, velho) {
  const jan = (x) => {
    if (!x) return null;
    const reseta = (x.resetsAt || 0) * 1000;
    if (velho && reseta && reseta < Date.now()) return null;
    return { pct: Math.round(x.usedPercent || 0), reseta, mins: x.windowDurationMins || 0 };
  };
  const cru = [rl && rl.primary, rl && rl.secondary].filter(Boolean);
  const curta = (x) => x.windowDurationMins && x.windowDurationMins <= 1440;
  const a = jan(rl && rl.primary), b = jan(rl && rl.secondary);
  return {
    sessao: [a, b].find(x => x && x.mins && x.mins <= 1440) || null,
    semana: [a, b].find(x => x && x.mins && x.mins > 1440) || null,
    // pela resposta CRUA: so veio a janela da semana, entao o plano nao tem limite de sessao
    semSessao: cru.length > 0 && !cru.some(curta),
  };
}

/* Limite do Grok: o mesmo backend do `/usage` no terminal. Semana no SuperGrok;
   a "Sessão" vazia é o plano, não falha. Token só neste processo. */
const usoGrok = { dados: null, quando: 0, pausaAte: 0, pausa: 0, voando: null, geracao: 0 };
const ultimoBomGrok = () => (usoGrok.dados ? { ...usoGrok.dados, velho: usoGrok.quando } : null);
function nomePlanoGrok(tier) {
  if (!tier) return '';
  return ({ SuperGrokLite: 'SuperGrok Lite', SuperGrokPlus: 'SuperGrok Plus', SuperGrokHeavy: 'SuperGrok Heavy', SuperGrok: 'SuperGrok' })[tier]
    || String(tier).replace(/([a-z])([A-Z])/g, '$1 $2');
}
function pctDoGrok(cfg) {
  if (!cfg || typeof cfg !== 'object') return null;
  if (Number.isFinite(cfg.creditUsagePercent)) return cfg.creditUsagePercent;
  const produtos = Array.isArray(cfg.productUsage) ? cfg.productUsage : [];
  const build = produtos.find(p => p && p.product === 'GrokBuild' && Number.isFinite(p.usagePercent));
  if (build) return build.usagePercent;
  const cap = cfg.onDemandCap && Number(cfg.onDemandCap.val);
  const used = cfg.onDemandUsed && Number(cfg.onDemandUsed.val);
  if (cap > 0 && Number.isFinite(used)) return used / cap * 100;
  /* 26/09: com a semana aberta e nada gasto ainda, o Grok manda o período e nenhum número de
     uso (sem creditUsagePercent). O anel sumia do topo; o Codenotch lê o mesmo endereço e mostra
     0%. Período de uso aberto sem número = nada usado nele. */
  if (cfg.currentPeriod && cfg.currentPeriod.end) return 0;
  return null;
}
function janelasDoGrok(cfg, velho) {
  if (!cfg) return { sessao: null, semana: null, semSessao: false };
  const fim = Date.parse((cfg.currentPeriod && cfg.currentPeriod.end) || cfg.billingPeriodEnd || '') || 0;
  const ini = Date.parse((cfg.currentPeriod && cfg.currentPeriod.start) || cfg.billingPeriodStart || '') || 0;
  if (velho && fim && fim < Date.now()) return { sessao: null, semana: null, semSessao: false };
  const pct = pctDoGrok(cfg);
  if (pct == null) return { sessao: null, semana: null, semSessao: false };
  const jan = { pct: Math.round(Math.min(100, Math.max(0, pct))), reseta: fim || 0 };
  const tipo = String((cfg.currentPeriod && cfg.currentPeriod.type) || '');
  const mins = ini && fim && fim > ini ? Math.round((fim - ini) / 60000) : 0;
  const daSemana = /WEEKLY|MONTHLY/i.test(tipo) || mins > 1440 || (!tipo && !mins);
  if (daSemana) return { sessao: null, semana: jan, semSessao: true };
  return { sessao: jan, semana: null, semSessao: false };
}
async function usoDoGrok() {
  const agora = Date.now();
  if (usoGrok.dados && agora - usoGrok.quando < USO_VALE_MS) return usoGrok.dados;
  if (agora < usoGrok.pausaAte) return ultimoBomGrok() || { limitado: true, voltaEm: usoGrok.pausaAte };
  if (!usoGrok.voando) usoGrok.voando = buscarUsoDoGrok().finally(() => { usoGrok.voando = null; });
  return usoGrok.voando;
}
async function buscarUsoDoGrok() {
  // R3-018: mesma guarda de geracao do Claude, ver comentario em buscarUsoDoClaude
  const minhaGeracao = usoGrok.geracao;
  const t = contasCli.tokenGrok ? contasCli.tokenGrok() : '';
  if (!t) return null;
  const headers = { Authorization: 'Bearer ' + t, Accept: 'application/json', 'x-xai-token-auth': 'xai-grok-cli' };
  try {
    const r = await fetch('https://cli-chat-proxy.grok.com/v1/billing?format=credits', { headers });
    if (r.status === 429) {
      const pediu = Number(r.headers.get('retry-after')) * 1000;
      usoGrok.pausa = Math.min(15 * 60000, Math.max(60000, pediu > 0 ? pediu : (usoGrok.pausa * 2 || 120000)));
      usoGrok.pausaAte = Date.now() + usoGrok.pausa;
      return ultimoBomGrok() || { limitado: true, voltaEm: usoGrok.pausaAte };
    }
    if (!r.ok) return ultimoBomGrok();
    const j = await r.json();
    const cfg = (j && j.config) || j || {};
    let plano = nomePlanoGrok(cfg.subscriptionTier || j.subscriptionTier);
    try {
      const u = await fetch('https://cli-chat-proxy.grok.com/v1/user?include=subscription', { headers });
      if (u.ok) {
        const user = await u.json();
        if (user && user.subscriptionTier) plano = nomePlanoGrok(user.subscriptionTier);
      }
    } catch {}
    const dados = { cfg, plano };
    if (usoGrok.geracao === minhaGeracao) Object.assign(usoGrok, { dados, quando: Date.now(), pausa: 0, pausaAte: 0 });
    return dados;
  } catch { return ultimoBomGrok(); }
}

/* Limite do Gemini: o mesmo `/usage` do Antigravity (agy -p /usage --output-format json).
   Só aceita resposta com command.name === "usage" — senão seria um prompt cobrado. */
const usoGemini = { dados: null, quando: 0, pausaAte: 0, pausa: 0, voando: null, versao: null, geracao: 0 };
const ultimoBomGemini = () => (usoGemini.dados ? { ...usoGemini.dados, velho: usoGemini.quando } : null);
function fracRestanteGemini(b) {
  if (!b || typeof b !== 'object') return null;
  const n = b.remaining_fraction != null ? b.remaining_fraction : b.remainingFraction;
  return Number.isFinite(n) ? n : null;
}
function janelasDoGemini(dados, velho) {
  const grupos = dados && Array.isArray(dados.groups) ? dados.groups : [];
  const gemini = grupos.find(g => g && /gemini/i.test(String(g.name || ''))) || grupos[0];
  const buckets = gemini && Array.isArray(gemini.buckets) ? gemini.buckets : [];
  const jan = (b) => {
    const rest = fracRestanteGemini(b);
    if (rest == null) return null;
    const reseta = Date.parse(b.reset_time || b.resetTime || '') || 0;
    if (velho && reseta && reseta < Date.now()) return null;
    return { pct: Math.round(Math.min(100, Math.max(0, (1 - rest) * 100))), reseta };
  };
  const chave = (b) => String((b && (b.window || '')) + ' ' + (b && (b.id || '')) + ' ' + (b && (b.name || ''))).toLowerCase();
  const sessao = jan(buckets.find(b => /5h|five.?hour|session/.test(chave(b))));
  const semana = jan(buckets.find(b => /week/.test(chave(b))));
  return { sessao, semana, semSessao: !sessao && !!semana };
}
async function usoDoGemini() {
  const agora = Date.now();
  if (usoGemini.dados && agora - usoGemini.quando < USO_VALE_MS) return usoGemini.dados;
  if (agora < usoGemini.pausaAte) return ultimoBomGemini() || { limitado: true, voltaEm: usoGemini.pausaAte };
  if (!usoGemini.voando) usoGemini.voando = buscarUsoDoGemini().finally(() => { usoGemini.voando = null; });
  return usoGemini.voando;
}
async function versaoDoAgy() {
  if (usoGemini.versao != null) return usoGemini.versao;
  if (!temBin('agy')) { usoGemini.versao = 0; return 0; }
  const r = await rodar(acharBin('agy'), ['--version'], 8000);
  const m = String((r && r.out) || '').trim().match(/(\d+)\.(\d+)\.(\d+)/);
  usoGemini.versao = m ? (+m[1] * 10000 + +m[2] * 100 + +m[3]) : 0;
  return usoGemini.versao;
}
function pastaUsoAgy() {
  const dir = path.join(app.getPath('userData'), 'contas-cli', 'agy-uso');
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
  return dir;
}
function rodarUsoAgy() {
  return new Promise((res) => {
    let out = '', errout = '', acabou = false;
    const p = spawnBin(acharBin('agy'), ['-p', '/usage', '--output-format', 'json', '--print-timeout', '90s'], {
      cwd: pastaUsoAgy(), env: contasCli.ambiente('gemini'), stdio: ['ignore', 'pipe', 'pipe'],
    });
    const t = setTimeout(() => { try { p.kill(); } catch {} }, 95000);
    const fim = (err) => { if (acabou) return; acabou = true; clearTimeout(t); res({ err, out, errout }); };
    p.stdout.on('data', (d) => { if (out.length < 1024 * 1024) out += d.toString('utf8'); });
    p.stderr.on('data', (d) => { if (errout.length < 8000) errout += d.toString('utf8'); });
    p.on('error', (e) => fim(e));
    p.on('close', (code) => fim(code === 0 ? null : new Error('saiu com código ' + code)));
  });
}
async function buscarUsoDoGemini() {
  if (!temBin('agy')) return null;
  // R3-018: mesma guarda de geracao do Claude, ver comentario em buscarUsoDoClaude
  const minhaGeracao = usoGemini.geracao;
  try {
    // 1.1.11 passou a devolver /usage em JSON; antes o agy mandava o texto pro modelo e cobrava
    if (await versaoDoAgy() < 10111) return ultimoBomGemini();
    const r = await rodarUsoAgy();
    if (!r || r.err || !r.out) return ultimoBomGemini();
    let j;
    try { j = JSON.parse(r.out); } catch { return ultimoBomGemini(); }
    const cmd = j && j.command;
    if (!cmd || cmd.name !== 'usage' || !cmd.data) return ultimoBomGemini();
    const groups = cmd.data.groups;
    if (!Array.isArray(groups) || !groups.length) return ultimoBomGemini();
    const dados = { groups };
    if (usoGemini.geracao === minhaGeracao) Object.assign(usoGemini, { dados, quando: Date.now(), pausa: 0, pausaAte: 0 });
    return dados;
  } catch { return ultimoBomGemini(); }
}

handle('conta:ler', async (_e, engine) => {
  if (engine === 'gemini') {
    const conta = contasCli.ler('gemini');
    const u = await usoDoGemini();
    const velho = (u && u.velho) || 0;
    const j = (u && !u.limitado) ? janelasDoGemini(u, velho) : { sessao: null, semana: null, semSessao: false };
    const tem = !!(j.sessao || j.semana);
    return {
      ...conta,
      entrou: tem ? true : conta.entrou,
      limitado: !!(u && u.limitado),
      voltaEm: (u && u.voltaEm) || 0,
      velho,
      sessao: j.sessao, semana: j.semana, semSessao: !!j.semSessao,
    };
  }
  if (engine === 'grok') {
    const conta = contasCli.ler('grok');
    if (!conta.entrou) return conta;
    const u = await usoDoGrok();
    const velho = (u && u.velho) || 0;
    const j = (u && !u.limitado) ? janelasDoGrok(u.cfg, velho) : { sessao: null, semana: null, semSessao: false };
    const cap = u && u.cfg && u.cfg.onDemandCap && Number(u.cfg.onDemandCap.val);
    const usado = u && u.cfg && u.cfg.onDemandUsed && Number(u.cfg.onDemandUsed.val);
    return {
      ...conta,
      plano: (u && u.plano) || conta.plano || '',
      limitado: !!(u && u.limitado),
      voltaEm: (u && u.voltaEm) || 0,
      velho,
      sessao: j.sessao, semana: j.semana, semSessao: !!j.semSessao,
      extra: cap > 0 ? { ligado: true, usado: Number.isFinite(usado) ? usado : 0, teto: cap, moeda: 'créditos' } : null,
    };
  }
  /* resposta HONESTA em vez de "não consegui ler": a conta é a do próprio agente, configurada
     no terminal dele. O Cockpit não tem como conferir daqui — se ele pedir login, aparece no
     painel, com o recado que o acp.js monta a partir dos authMethods anunciados. */
  if (motorAcp(engine)) {
    return { entrou: null, email: '', nome: 'Agente ACP', plano: '', via: '', sessao: null, semana: null, extra: null,
      motivo: 'A conta é a do próprio agente ACP, configurada no terminal dele; o Cockpit não confere daqui. Se ele pedir login, aparece no painel.' };
  }
  if (engine === 'claude') {
    let conta = {};
    try { conta = JSON.parse((await rodar(CLAUDE_BIN, ['auth', 'status'], 25000)).out || '{}'); } catch {}
    const u = await usoDoClaude();
    const velho = (u && u.velho) || 0;
    return {
      entrou: !!conta.loggedIn,
      email: conta.email || '',
      nome: (conta.orgName || '').replace(/'s Organization$/, '') || conta.email || '',
      plano: conta.subscriptionType || '',
      via: conta.authMethod || '',
      // 429 do endpoint de uso = muita consulta em pouco tempo. Nao e conta com problema,
      // entao a tela diz isso em vez de "nao consegui ler"
      limitado: !!(u && u.limitado),
      voltaEm: (u && u.voltaEm) || 0,
      velho,
      sessao: (u && !u.limitado) ? janelaClaude(u.five_hour, velho) : null,
      semana: (u && !u.limitado) ? janelaClaude(u.seven_day, velho) : null,
      extra: u && u.extra_usage ? {
        ligado: !!u.extra_usage.is_enabled,
        usado: u.extra_usage.used_credits || 0,
        teto: u.extra_usage.monthly_limit || 0,
        moeda: u.extra_usage.currency || '',
      } : null,
    };
  }

  // sem este try, quando o Codex nao sobe a promessa rejeita, o renderer morre na linha do
  // await e o painel fica girando em "Vendo a conta..." para sempre, sem erro nenhum
  try { await codexStart(); }
  catch (e) {
    return {
      entrou: false, email: '', nome: '', plano: '', via: '',
      sessao: null, semana: null, extra: null,
      erro: 'não consegui falar com o Codex: ' + String((e && e.message) || e),
    };
  }
  let conta = {};
  try { conta = await codexReq('local', 'account/read', {}); } catch {}
  const { rl: rlLido, velho } = await limitesDoCodex();
  const rl = rlLido || {};
  const { sessao, semana, semSessao } = janelasDoCodex(rlLido, velho);
  const c = (conta && conta.account) || {};
  return {
    entrou: !!c.email,
    email: c.email || '',
    nome: c.email || '',
    plano: c.planType || rl.planType || '',
    via: c.type || '',
    sessao, semana, semSessao, velho,
    extra: rl.credits ? {
      ligado: !!rl.credits.hasCredits,
      usado: 0,
      teto: rl.credits.unlimited ? -1 : Number(rl.credits.balance || 0),
      moeda: 'créditos',
    } : null,
  };
});

/* so os percentuais do plano, para a faixa em cima da caixa de texto.
   Diferente do conta:ler, nao chama o CLI: e leve o bastante para repetir de minuto em minuto. */
handle('uso:ler', async (_e, engine) => {
  if (engine === 'gemini') {
    const u = await usoDoGemini();
    if (!u) return null;
    if (u.limitado) return { limitado: true, voltaEm: u.voltaEm || 0, sessao: null, semana: null };
    const velho = u.velho || 0;
    const j = janelasDoGemini(u, velho);
    if (!j.sessao && !j.semana) return velho ? { ...j, velho } : null;
    return { ...j, velho };
  }
  // grok ANTES do motorAcp: o Grok usa ACP no chat, mas o limite é da conta, não do Codex
  if (engine === 'grok') {
    const u = await usoDoGrok();
    if (!u) return null;
    if (u.limitado) return { limitado: true, voltaEm: u.voltaEm || 0, sessao: null, semana: null };
    const velho = u.velho || 0;
    return { ...janelasDoGrok(u.cfg, velho), velho };
  }
  // o ACP não tem cota que o Cockpit possa ler: sem esta linha ele subia o Codex à toa
  if (motorAcp(engine)) return null;
  if (engine === 'claude') {
    const u = await usoDoClaude();
    if (!u) return null;
    if (u.limitado) return { limitado: true, voltaEm: u.voltaEm || 0, sessao: null, semana: null };
    const velho = u.velho || 0;
    return { sessao: janelaClaude(u.five_hour, velho), semana: janelaClaude(u.seven_day, velho), velho };
  }
  const { rl, velho } = await limitesDoCodex();
  if (!rl) return null;
  return { ...janelasDoCodex(rl, velho), velho };
});

handle('auth:acao', async (_e, { engine, acao, cwd }) => {
  if (engine === 'gemini' || engine === 'grok') {
    esquecerUso(engine);
    return contasCli.acao({ engine, acao, cwd });
  }
  if (motorAcp(engine)) return { error: 'A conta do agente ACP se resolve no terminal: rode o comando dele e entre por lá.' };
  const ehClaude = engine === 'claude';
  const naVps = ehRemoto(cwd);
  const alvo = naVps ? (ehClaude ? 'claude' : 'codex') : (ehClaude ? CLAUDE_BIN : acharBin('codex'));
  const bin = (/[ ()]/.test(alvo) ? '"' + alvo + '"' : alvo);
  // na VPS tudo roda por SSH, dentro do usuario que tem a conta
  const naMaquina = (comando) => {
    if (!naVps) return null;
    const r = partesRemoto(cwd);
    return 'ssh -o BatchMode=yes -o ConnectTimeout=12 ' + r.host + ' ' + JSON.stringify(linhaNoServidor(r, comando));
  };
  const CMD = ehClaude
    ? { login: 'auth login', logout: 'auth logout', status: 'auth status', codigo: 'auth login' }
    : { login: 'login', logout: 'logout', status: 'login status', codigo: 'login --device-auth' };

  if (acao === 'status') {
    // o app confere a conta logo depois de entrar ou trocar: a leitura de uso guardada era da outra
    if (!naVps) esquecerUso(engine);
    if (naVps) {
      const r2 = await noServidor(partesRemoto(cwd), bin + ' ' + CMD.status, 25000);
      return { texto: String(r2.out || r2.error || '').trim().slice(0, 800) };
    }
    const r = await rodar(alvo, CMD.status.split(' '), 25000);
    return { texto: String(r.out || r.errout || (r.err && r.err.message) || '').trim().slice(0, 800) };
  }

  // TROCAR de conta: sai da atual e entra na nova numa tacada so.
  // Sem o logout antes, o CLI ve que ja tem sessao e nao troca nada — era o que quebrava.
  const ondeDiz = naVps ? ' na VPS' : '';
  if (acao === 'trocar' || acao === 'trocarCodigo') {
    // na VPS o navegador nao existe: o caminho que funciona e o codigo (device auth)
    const entrar = (acao === 'trocarCodigo' || naVps) ? CMD.codigo : CMD.login;
    const linha = bin + ' ' + CMD.logout + ' ; ' + bin + ' ' + entrar;
    return {
      terminal: naMaquina(linha) || linha,
      titulo: 'Trocar a conta do ' + (ehClaude ? 'Claude' : 'Codex') + ondeDiz,
      esperaLink: true, confereDepois: true, naVps,
    };
  }

  const cmd = CMD[acao];
  if (!cmd) return { error: 'ação desconhecida' };
  const linha = bin + ' ' + cmd;
  return { terminal: naMaquina(linha) || linha,
           titulo: (acao === 'logout' ? 'Sair da conta do ' : 'Entrar na conta do ') + (ehClaude ? 'Claude' : 'Codex') + ondeDiz,
           esperaLink: acao !== 'logout', confereDepois: acao !== 'logout', naVps };
});

/* Um toque no iPhone NUNCA pode abrir janela do sistema no Mac: no macOS ela nasce presa a
   janela (modal) e trava o Cockpit inteiro para quem esta na frente do computador. O servidor
   do telefone ja marca a chamada com { remoto: true }; faltava alguem olhar. */
const souRemoto = (e) => !!(e && e.remoto);

handle('codex:api-status', async () => estadoAstra());
handle('codex:api-key:set', async (_e, chave) => {
  if (souRemoto(_e)) return { error: 'A chave só pode ser guardada no Mac.' };
  const r = await guardarChaveAstra(chave);
  return r.error ? r : { ...(await estadoAstra()), ok: true };
});
handle('codex:api-test', async (_e) => {
  if (souRemoto(_e)) return { error: 'O teste da chave só pode ser feito no Mac.' };
  await testarAstra();
  return estadoAstra();
});
handle('codex:api-config:set', async (_e, dados) => {
  if (souRemoto(_e)) return { error: 'O uso por créditos só pode ser alterado no Mac.' };
  const c = loadConfig();
  const cap = Number(dados && dados.capUsd);
  c.codexApiCapUsd = Number.isFinite(cap) && cap > 0 ? Math.min(10000, cap) : 10;
  if (dados && Object.prototype.hasOwnProperty.call(dados, 'enabled')) {
    if (dados.enabled && !(await temChaveAstra(false))) return { error: 'Guarde a chave da OpenAI antes de ligar os créditos.' };
    c.codexApiEnabled = !!dados.enabled;
  }
  anotarChaveDoMain('codexApiCapUsd', c.codexApiCapUsd);
  anotarChaveDoMain('codexApiEnabled', !!c.codexApiEnabled);
  saveConfig(c);
  // Desligar significa parar também um trabalho pago que já esteja rodando, não só o próximo.
  if (!c.codexApiEnabled) {
    for (const [paneId, origem] of codexPaneBilling) {
      if (origem !== 'api') continue;
      const threadId = codex.paneToThread.get(paneId), turnId = codex.paneTurn.get(paneId);
      if (threadId && turnId) codexReq(destinoDoPane(paneId), 'turn/interrupt', { threadId, turnId }).catch(() => {});
    }
  }
  return estadoAstra();
});

handle('user:pickPhoto', async (_e) => {
  if (souRemoto(_e)) return { error: 'Trocar a foto só funciona no Mac.' };
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], defaultPath: HOME,
    filters: [{ name: 'Imagens', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }] });
  if (r.canceled || !r.filePaths[0]) return null;
  try {
    const f = r.filePaths[0];
    const ext = path.extname(f).slice(1).toLowerCase();
    const mime = ext === 'jpg' ? 'jpeg' : ext;
    const b = fs.readFileSync(f);
    if (b.length > 3 * 1024 * 1024) return { error: 'Imagem muito pesada. Use uma menor que 3 MB.' };
    return { dataUrl: 'data:image/' + mime + ';base64,' + b.toString('base64') };
  } catch (e) { return { error: e.message }; }
});

/* ================= contas guardadas: trocar sem refazer login =================
   Cada motor guarda a credencial num arquivo. Guardando uma copia por apelido, da' pra
   alternar entre duas contas ja' logadas so' trocando o arquivo de volta.

   No MAC a credencial do Claude NAO e' arquivo: mora no Chaveiro. Por isso a lista dele fica
   vazia — e a chave continua aqui, vazia, de proposito: quem ler sabe que a ausencia foi
   decidida e nao esquecida. Gravar um ~/.claude/.credentials.json que nunca existiu faria o
   CLI passar a acreditar num token que o Chaveiro nao conhece. */
const CAMINHOS_CRED = {
  claude: [],
  codex: [path.join(HOME, '.codex', 'auth.json')],
};
function arqCred(engine) {
  const lista = CAMINHOS_CRED[engine] || [];
  for (const p of lista) { try { if (fs.existsSync(p)) return p; } catch {} }
  return lista[0];
}
/* Por que este motor NAO troca de conta por arquivo, em portugues. Vale para os quatro
   (listar, salvar, trocar, esquecer): sem barrar tambem o "trocar", um clique solto criaria o
   arquivo do Claude com o token de outra conta. */
function contaSemArquivo(engine) {
  if (motorAcp(engine)) return 'Este painel usa a conta do próprio agente ACP.';
  const caminhos = CAMINHOS_CRED[engine];
  if (!caminhos) return 'Não conheço as contas deste motor.';
  if (!EH_WIN && engine === 'claude') return 'No Mac a conta do Claude fica no Chaveiro, não num arquivo. Use “Trocar de conta” na janela da Conta.';
  // lista de caminhos vazia = de proposito, este motor nao guarda a conta em arquivo. Sem esta
  // linha o motor passava pela peneira e so' era barrado la na frente, com um recado seco.
  if (!caminhos.length) return 'Este motor não guarda a conta num arquivo que eu possa copiar.';
  return '';
}
function trocaDeContaDisponivel(engine) {
  if (contaSemArquivo(engine)) return false;
  const p = arqCred(engine);
  if (!p) return false;
  try { return fs.existsSync(p); } catch { return false; }
}
const PASTA_CONTAS = () => path.join(app.getPath('userData'), 'contas');
function lerCredencial(engine) {
  const p = arqCred(engine);
  if (!p) return null;
  try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
}
function credencialValida(texto) {
  try { const o = JSON.parse(texto); return !!o && typeof o === 'object' && Object.keys(o).length > 0; }
  catch { return false; }
}
/* R1: estes cinco entram por handle(), entao o iPhone tambem os alcanca pelo Wi-Fi. Trocar a
   conta do Mac por um toque no telefone e' exatamente o que nao pode acontecer. */
const SO_NO_MAC = { error: 'Trocar de conta só funciona no Mac.' };

handle('contas:disponivel', (_e, engine) => {
  if (souRemoto(_e)) return { ok: false, motivo: SO_NO_MAC.error };
  const motivo = contaSemArquivo(engine);
  if (motivo) return { ok: false, motivo };
  return trocaDeContaDisponivel(engine)
    ? { ok: true }
    : { ok: false, motivo: 'Não achei uma conta do ' + (engine === 'codex' ? 'Codex' : engine) + ' logada agora para guardar.' };
});

handle('contas:listar', (_e, engine) => {
  if (souRemoto(_e)) return [];
  if (contaSemArquivo(engine)) return [];
  const dir = PASTA_CONTAS();
  const out = [];
  const atualTxt = lerCredencial(engine);
  try {
    fs.mkdirSync(dir, { recursive: true });
    for (const f of fs.readdirSync(dir)) {
      if (!f.startsWith(engine + '__') || !f.endsWith('.json')) continue;
      let apelido; try { apelido = decodeURIComponent(f.slice((engine + '__').length, -5)); } catch { continue; }
      let igualAtual = false;
      try { igualAtual = atualTxt !== null && fs.readFileSync(path.join(dir, f), 'utf8') === atualTxt; } catch {}
      out.push({ apelido, atual: igualAtual });
    }
  } catch {}
  out.sort((a, b) => a.apelido.localeCompare(b.apelido));
  return out;
});

handle('contas:salvar', (_e, { engine, apelido } = {}) => {
  if (souRemoto(_e)) return SO_NO_MAC;
  const motivo = contaSemArquivo(engine);
  if (motivo) return { error: motivo };
  const txt = lerCredencial(engine);
  if (!txt || !credencialValida(txt)) return { error: 'Não achei uma conta logada para guardar.' };
  const nome = String(apelido || '').trim().slice(0, 40);
  if (!nome) return { error: 'Dê um apelido para esta conta.' };
  try {
    const dir = PASTA_CONTAS();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, engine + '__' + encodeURIComponent(nome) + '.json'), txt, { mode: 0o600 });
    return { ok: true };
  } catch (e) { return { error: String(e && e.message || e) }; }
});

handle('contas:trocar', (_e, { engine, apelido } = {}) => {
  if (souRemoto(_e)) return SO_NO_MAC;
  const motivo = contaSemArquivo(engine);
  if (motivo) return { error: motivo };
  const alvo = path.join(PASTA_CONTAS(), engine + '__' + encodeURIComponent(String(apelido || '')) + '.json');
  const destino = arqCred(engine);
  if (!destino) return { error: 'Não sei onde fica a credencial deste motor.' };
  try {
    if (!fs.existsSync(alvo)) return { error: 'Essa conta não está mais guardada.' };
    const txt = fs.readFileSync(alvo, 'utf8');
    if (!credencialValida(txt)) return { error: 'O arquivo desta conta está corrompido — não vou trocar.' };
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    /* grava em temporario e troca de uma vez: escrever direto podia pegar o CLI no meio de uma
       renovacao de token e deixar o arquivo pela metade. O backup de verdade e' a copia que
       continua guardada em PASTA_CONTAS — nao fica token solto no disco. */
    const tmp = destino + '.tmp';
    fs.writeFileSync(tmp, txt, { mode: 0o600 });
    try { fs.renameSync(tmp, destino); }
    catch (e) {
      try { fs.unlinkSync(tmp); } catch {}
      const cod = String(e && (e.code || e.message) || e);
      const porque = (cod === 'EBUSY' || cod === 'EPERM' || cod === 'EACCES') ? 'o arquivo está em uso' : cod;
      return { error: 'Não consegui trocar a credencial agora (' + porque + '). Tente de novo.' };
    }
    esquecerUso(engine);
    return { ok: true };
  } catch (e) { return { error: String(e && e.message || e) }; }
});

handle('contas:esquecer', (_e, { engine, apelido } = {}) => {
  if (souRemoto(_e)) return SO_NO_MAC;
  const motivo = contaSemArquivo(engine);
  if (motivo) return { error: motivo };
  try {
    fs.unlinkSync(path.join(PASTA_CONTAS(), engine + '__' + encodeURIComponent(String(apelido || '')) + '.json'));
    return { ok: true };
  } catch (e) { return { error: String(e && e.message || e) }; }
});

/* Trocar o arquivo da credencial nao adianta NADA com o app-server velho de pe: ele leu a
   conta quando subiu e segue respondendo por ela. Aqui o processo do destino LOCAL cai, para
   o proximo pedido subir outro ja com a conta nova. A VPS nao entra: la a conta e' do
   servidor, e derrubar o app-server de la nao troca conta nenhuma aqui. */
handle('codex:reiniciar', async (_e) => {
  if (souRemoto(_e)) return SO_NO_MAC;
  const c = conexaoCodex('local');
  const p = c.proc;
  /* limpa o estado do destino ANTES de matar, para o processo NOVO nascer limpo:
     - buf: meia linha de JSON do processo velho grudaria na primeira linha do novo;
     - pend: quem esperava resposta precisa saber que ela nunca vem. */
  c.proc = null; c.ready = null; c.buf = '';
  for (const [, pend] of c.pend) { try { pend.reject(new Error('o Codex foi reiniciado para trocar de conta')); } catch {} }
  c.pend.clear();
  /* pedido de permissao do processo VELHO: o rpcId dele nao existe no novo, e responder depois
     so' devolveria erro. Some junto com o processo. */
  for (const [k, a] of pendingApprovals) if (a && a.destino === 'local') pendingApprovals.delete(k);
  // painel que vivia no processo velho perde a thread: a proxima mensagem abre outra
  limparPaineisCodex('local', false);
  if (!p) return { ok: true };
  /* O 'close' registrado no codexStart nao confere se quem caiu ainda e' o processo atual: se
     ele disparasse depois de o Codex NOVO ja estar de pe, apagaria o processo novo e o chat
     ficaria em "Ligando o Codex..." para sempre. Por isso o ouvinte sai ANTES de matar.
     Nao emito 'engine-down' de proposito: la a tela diz "a conexao caiu", e aqui a queda foi
     de proposito — quem chama ja desligou os paineis antes. */
  try { p.removeAllListeners('close'); } catch {}
  await new Promise((r) => {
    let feito = false;
    const fim = () => { if (feito) return; feito = true; clearTimeout(prazo); r(); };
    const prazo = setTimeout(fim, 4000);   // nao trava a tela se ele emperrar
    p.once('close', fim);
    matarGrupoExtra(p);   // mata o grupo: filho de comando/sandbox nao pode sobrar orfao
  });
  // pelo prazo pode ter escapado sem passar pelo 'close': solta o ouvinte do processo velho
  // pra ele nao continuar despejando resposta na fila do novo, e insiste na morte dele
  try { p.stdout.removeAllListeners('data'); } catch {}
  if (p.exitCode === null && p.signalCode === null) { try { p.kill('SIGKILL'); } catch {} }
  return { ok: true };
});

const EXT_IMG = ['png','jpg','jpeg','gif','webp','bmp','heic','svg'];
/* o que estiver na area de transferencia: arquivos copiados no Finder ou imagem/print */
function arquivosColados() {
  const achados = [];
  try {
    const buf = clipboard.readBuffer('NSFilenamesPboardType');
    if (buf && buf.length) {
      const txt = buf.toString('utf8');
      for (const m of txt.matchAll(/<string>([^<]+)<\/string>/g)) achados.push(m[1]);
    }
  } catch {}
  if (!achados.length) {
    for (const fmt of ['public.file-url', 'text/uri-list']) {
      try {
        const u = clipboard.read(fmt);
        if (u) for (const linha of String(u).split(/\r?\n/)) {
          const l = linha.trim();
          if (l.startsWith('file://')) achados.push(decodeURIComponent(l.replace(/^file:\/\//, '')));
        }
      } catch {}
    }
  }
  return [...new Set(achados)].filter(f => { try { return fs.existsSync(f); } catch { return false; } });
}

const EXT_VIS_IMG = ['png','jpg','jpeg','gif','webp','bmp','svg'];
handle('arquivo:ver', (_e, file) => {
  try {
    const st = fs.statSync(file);
    const ext = path.extname(file).slice(1).toLowerCase();
    const base = { path: file, nome: path.basename(file), ext, bytes: st.size };
    if (EXT_VIS_IMG.includes(ext) && st.size <= 25 * 1024 * 1024) {
      const mime = ext === 'jpg' ? 'jpeg' : ext === 'svg' ? 'svg+xml' : ext;
      base.tipo = 'imagem';
      base.dados = 'data:image/' + mime + ';base64,' + fs.readFileSync(file).toString('base64');
    } else if (st.size <= 600 * 1024 && /^(txt|md|json|js|ts|py|html|css|csv|log|sh|yml|yaml|toml|xml)$/.test(ext)) {
      base.tipo = 'texto';
      base.dados = fs.readFileSync(file, 'utf8');
    } else {
      base.tipo = 'outro';
    }
    return base;
  } catch (e) { return { erro: e.message, path: file, nome: path.basename(file) }; }
});

/* ---------- o mesmo visor, mas para arquivo que mora NA VPS ----------
   Um comando so: confere que existe, diz o tamanho e — so se couber no MESMO teto do ramo
   local — manda o conteudo em base64 (que serve pra imagem e pra texto, sem se preocupar com
   codificacao). Quem nao cabe, ou nao e de um tipo que a tela sabe abrir, volta como 'outro'
   sem gastar rede. O "exit 0" no fim e o que impede um "nao cabe" de virar codigo de erro e
   ser lido como falha de conexao.
   Handler NOVO de proposito: o lerArquivoRemoto devolve {content} e o visor espera
   {nome,bytes,tipo,dados} — plugado direto, o titulo sairia "undefined ·". */
async function verArquivoRemoto(f) {
  const r = partesRemoto(f);
  const nome = path.posix.basename(String(f || ''));
  if (!r) return { erro: 'servidor desconhecido', path: f, nome };
  const alvo = r.caminho;
  const ext = path.posix.extname(alvo).slice(1).toLowerCase();
  const ehImg = EXT_VIS_IMG.includes(ext);
  const teto = ehImg ? 25 * 1024 * 1024 : /^(txt|md|json|js|ts|py|html|css|csv|log|sh|yml|yaml|toml|xml)$/.test(ext) ? 600 * 1024 : 0;
  const q = aspaSh(alvo);
  const script = '[ -e ' + q + ' ] || { echo COCKPIT_SEM_ARQUIVO; exit 0; }; '
    + 't=$(stat -c %s -- ' + q + ' 2>/dev/null || echo -1); '
    + "printf 'COCKPIT_TAM %s\\n' \"$t\"; "
    + (teto > 0 ? '[ -f ' + q + ' ] && [ "$t" -ge 0 ] && [ "$t" -le ' + teto + ' ] && base64 -w0 -- ' + q + '; ' : '')
    + 'exit 0';
  // 60s, nao os 20s das outras: imagem de 25 MB vira ~34 MB em base64 e nao cabe no tempo curto
  const rr = await noServidorSsh(r, script, 60000);
  if (rr.error) return { erro: rr.error, path: f, nome };
  const bruto = String(rr.out || '');
  if (bruto.startsWith('COCKPIT_SEM_ARQUIVO')) return { erro: 'Não achei este arquivo no servidor.', path: f, nome };
  const quebra = bruto.indexOf('\n');
  const bytes = Number(((quebra >= 0 ? bruto.slice(0, quebra) : bruto).match(/^COCKPIT_TAM\s+(-?\d+)/) || [])[1]);
  if (!Number.isFinite(bytes) || bytes < 0) return { erro: 'Não consegui ler este arquivo no servidor.', path: f, nome };
  const b64 = quebra >= 0 ? bruto.slice(quebra + 1).trim() : '';
  const base = { path: f, nome, ext, bytes, remoto: true };
  if (!b64) { base.tipo = 'outro'; return base; }
  if (ehImg) {
    const mime = ext === 'jpg' ? 'jpeg' : ext === 'svg' ? 'svg+xml' : ext;
    base.tipo = 'imagem';
    base.dados = 'data:image/' + mime + ';base64,' + b64;
    return base;
  }
  base.tipo = 'texto';
  try { base.dados = Buffer.from(b64, 'base64').toString('utf8'); }
  catch { return { erro: 'A resposta do servidor veio corrompida.', path: f, nome }; }
  return base;
}
handle('arquivo:verVps', (_e, f) => (ehRemoto(f) ? verArquivoRemoto(f) : { erro: 'esse caminho não é da VPS', path: f, nome: String(f || '') }));

/* ---------- terminal embutido entrando na VPS ----------
   Host e usuario NAO saem do renderer: eles moram no SERVIDORES aqui do main, e e daqui que a
   linha e montada. O embrulho vai com aspas SIMPLES (aspaSh) e nao com JSON.stringify: com
   aspas duplas o $SHELL seria expandido AQUI no Mac e o comando mandaria "exec /bin/zsh" para
   um servidor cujo shell e o bash. */
handle('term:linhaShell', (_e, cwd) => {
  if (!ehRemoto(cwd)) return { error: 'essa pasta não é da VPS' };
  const r = partesRemoto(cwd);
  if (!r) return { error: 'servidor desconhecido' };
  const dir = aspaSh(r.caminho);
  /* Duas camadas, e a segunda foi MEDIDA na VPS dele em 08/09/2026: o ~/.bashrc de la tem um
     `cd /opt/adsure/trabalho` FIXO (linha 119), que roda depois do nosso cd e o desfazia — o
     terminal abria sempre na mesma pasta, fosse qual fosse o painel. O PROMPT_COMMAND roda
     DEPOIS do rc, pouco antes do primeiro prompt, e se apaga na mesma linha para nao repetir a
     cada comando. O `cd` de antes fica porque vale para shell que nao usa PROMPT_COMMAND.
     Pasta que sumiu nao pode deixar o terminal sem abrir: cai na home e avisa na propria tela. */
  const dentro = 'cd -- ' + dir + ' 2>/dev/null || echo "[essa pasta não existe aí — abrindo na home]"; '
    + 'exec env PROMPT_COMMAND=' + aspaSh('cd -- ' + dir + ' 2>/dev/null; unset PROMPT_COMMAND') + ' "$SHELL" -l';
  const linha = 'ssh -t -o BatchMode=yes -o ConnectTimeout=12 ' + r.host + ' ' + aspaSh(linhaNoServidor(r, dentro));
  return { linha, titulo: (r.nome || 'VPS') + ' — ' + (r.caminho.split('/').filter(Boolean).pop() || '/') };
});

handle('clipboard:anexos', () => {
  const arquivos = arquivosColados();
  if (arquivos.length) return { arquivos };
  try {
    const img = clipboard.readImage();
    if (img && !img.isEmpty()) {
      const dir = path.join(app.getPath('userData'), 'colados');
      fs.mkdirSync(dir, { recursive: true });
      const nome = 'colado-' + Date.now() + '.png';
      const destino = path.join(dir, nome);
      fs.writeFileSync(destino, img.toPNG());
      return { arquivos: [destino] };
    }
  } catch (e) {
    // R2-037: disco cheio ou pasta sem permissão não pode virar "nada pra colar" em silêncio
    return { arquivos: [], error: e.message };
  }
  return { arquivos: [] };
});

/* ---------- quadro branco: o desenho vira PNG + JSON aqui no Mac ----------
   O telefone TAMBEM salva: nao ha janela do sistema envolvida, so escrita numa pasta nossa.
   Em troca, nada do que chega vira caminho: o nome do arquivo e montado aqui dentro, e o
   conteudo e conferido byte a byte antes de virar arquivo. */
const PASTA_QUADROS = () => path.join(app.getPath('userData'), 'quadros');
const QUADRO_MAX_PNG = 12 * 1024 * 1024;   // ja decodificado
const QUADRO_MAX_CENA = 2 * 1024 * 1024;   // o JSON da cena, em texto
const SELO_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
function carimboQuadro() {
  const d = new Date(), z = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate())
    + '_' + z(d.getHours()) + z(d.getMinutes()) + z(d.getSeconds());
}
function cenaEmTexto(cena) {
  const t = JSON.stringify(cena && typeof cena === 'object' && !Array.isArray(cena)
    ? cena : { v: 1, formas: [], setas: [] });
  return t.length > QUADRO_MAX_CENA ? null : t;
}

handle('quadro:salvar', (_e, { png, cena } = {}) => {
  try {
    const m = /^data:image\/png;base64,([A-Za-z0-9+/=\s]+)$/.exec(String(png || ''));
    if (!m) return { error: 'o desenho não veio como PNG' };
    const cru = Buffer.from(m[1].replace(/\s+/g, ''), 'base64');
    // a assinatura do PNG. Sem isto, qualquer base64 viraria um arquivo .png mentiroso
    if (cru.length < 8 || !cru.subarray(0, 8).equals(SELO_PNG)) return { error: 'o desenho não é um PNG' };
    if (cru.length > QUADRO_MAX_PNG) return { error: 'o desenho ficou grande demais' };
    const texto = cenaEmTexto(cena);
    if (texto == null) return { error: 'o desenho tem peças demais' };
    const dir = PASTA_QUADROS();
    fs.mkdirSync(dir, { recursive: true });
    let base = 'quadro-' + carimboQuadro(), n = 2;
    while (fs.existsSync(path.join(dir, base + '.png'))) base = 'quadro-' + carimboQuadro() + '-' + (n++);
    const alvoPng = path.join(dir, base + '.png');
    const alvoJson = path.join(dir, base + '.json');
    fs.writeFileSync(alvoPng, cru);
    fs.writeFileSync(alvoJson, texto, 'utf8');
    anota('quadro salvo', alvoPng);
    return { png: alvoPng, json: alvoJson };
  } catch (e) { return { error: e.message }; }
});

handle('quadro:rascunhoGravar', (_e, { cena, enviadoEm } = {}) => {
  try {
    /* o carimbo "este desenho JA foi mandado pro chat" viaja junto com a cena.
       Sem ele o rascunho de ontem ressuscitava amanha e ia colado no fluxo novo. */
    const marca = Number(enviadoEm) || 0;
    const texto = cenaEmTexto(marca && cena && typeof cena === 'object' && !Array.isArray(cena)
      ? { ...cena, enviadoEm: marca } : cena);
    if (texto == null) return { error: 'o desenho tem peças demais' };
    const dir = PASTA_QUADROS();
    fs.mkdirSync(dir, { recursive: true });
    // gravarSeguro grava num .tmp e troca o nome: nunca fica meio arquivo
    return gravarSeguro(path.join(dir, 'rascunho.json'), texto) ? { ok: true } : { error: 'não consegui gravar o rascunho' };
  } catch (e) { return { error: e.message }; }
});

/* pedido do Claude pra abrir o quadro: a skill planejar-sistema grava o desenho no rascunho e
   cria o arquivo "pedido-abrir". Aqui o app manda o menu 'quadro' pro renderer e SO apaga o
   pedido quando o renderer confirma que abriu de verdade (handshake em quadro:abriuResultado,
   logo abaixo). Sem confirmacao — por exemplo sem nenhum painel em foco, focusPane null — o
   pedido fica vivo e tenta de novo no proximo ciclo. R2-025: antes apagava e logava sucesso
   mesmo quando nada abria na tela. */
const PEDIDO_QUADRO_TETO_MS = 5 * 60 * 1000;   // 5 min tentando: depois disso desiste e avisa no log
function vigiarPedidoDoQuadro() {
  setInterval(() => {
  try {
    const pedido = path.join(PASTA_QUADROS(), 'pedido-abrir');
    if (!fs.existsSync(pedido) || !win || win.isDestroyed()) return;
    const idade = Date.now() - fs.statSync(pedido).mtimeMs;
    if (idade > PEDIDO_QUADRO_TETO_MS) {
      // ninguem confirmou por 5 min (provavel nenhum painel em foco): desiste, nao fica tentando pra sempre
      fs.unlinkSync(pedido);
      anota('quadro NAO abriu a pedido do Claude (sem painel em foco por 5 min) — pedido descartado', pedido);
      return;
    }
    win.webContents.send('menu', 'quadro');
  } catch {}
  }, 1500);
}

handle('quadro:abriuResultado', (_e, ok) => {
  if (!ok) return { ok: false };
  try {
    const pedido = path.join(PASTA_QUADROS(), 'pedido-abrir');
    if (fs.existsSync(pedido)) { fs.unlinkSync(pedido); anota('quadro aberto a pedido do Claude', pedido); }
  } catch {}
  return { ok: true };
});

handle('quadro:rascunhoLer', () => {
  try {
    const arq = path.join(PASTA_QUADROS(), 'rascunho.json');
    if (!fs.existsSync(arq)) return { cena: null };
    const c = JSON.parse(fs.readFileSync(arq, 'utf8'));
    const ok = c && typeof c === 'object' && !Array.isArray(c);
    // enviadoEm sai NO MESMO NIVEL de cena: e assim que o quadro.js le (r.enviadoEm)
    return { cena: ok ? c : null, enviadoEm: (ok && Number(c.enviadoEm)) || 0 };
  } catch { return { cena: null, enviadoEm: 0 }; }   // rascunho quebrado nunca derruba a abertura do quadro
});

/* ---------- imagem (ou video curto) que a TELA gerou vira arquivo em colados/ ----------
   Foto da webcam e recorte da tela nascem como base64 dentro da janela; aqui viram arquivo
   de verdade, no mesmo lugar do print colado (e com a mesma faxina de 7 dias).
   O telefone tambem pode gravar: nao ha janela do sistema envolvida, so escrita numa pasta
   nossa. Em troca, NADA do que chega vira caminho — o nome e montado aqui dentro — e o
   conteudo e conferido byte a byte, igual ao quadro:salvar. Sem essa conferencia qualquer
   base64 viraria um ".png" mentiroso.
   Os dois tetos saem do MESMO lugar: o quadro de 8 MB do WebSocket do telefone (o maxPayload
   em servidor-web.js). Tudo que o celular manda viaja dentro de UMA mensagem desse tamanho;
   passou disso, o ws corta a conexao ANTES de chegar aqui — ele ve o app reconectando e o
   anexo sumir, sem erro nenhum. Por isso o teto do texto e' o quadro menos uma folga para o
   resto do JSON (nome do comando, id, prefixo), e o teto dos bytes e' esse mesmo numero
   desfeito do base64 (que engorda um terco). Antes o teto do texto era 9 MB, MAIOR que o
   quadro: o arquivo entre 8 e 9 MB derrubava a conexao em vez de voltar com um erro legivel.
   Video grande nao passa por aqui: vai pela rota POST /upload do servidor-web.js, que grava
   em pedacos, sem base64. Este caminho continua sendo o da imagem colada e do arquivo pequeno. */
const WS_QUADRO = 8 * 1024 * 1024;                 // tem de bater com o maxPayload do servidor-web.js
const IMG_MAX_TXT = WS_QUADRO - 64 * 1024;         // o que sobra do quadro para o texto em base64
const IMG_MAX = Math.floor(IMG_MAX_TXT / 4) * 3;   // o mesmo teto, ja desfeito do base64 (~6 MB)
const ERRO_GRANDE = 'arquivo grande demais para mandar por aqui (o limite é ~6 MB)';
const SELO_JPG = Buffer.from([0xff, 0xd8, 0xff]);
const SELO_EBML = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);   // inicio do webm (e do mkv)
/* Que tipo os BYTES dizem ser — nunca o que o texto promete. Imagem e video moram na mesma
   funcao porque o mp4, o mov do iPhone e a foto HEIC usam a MESMA caixa ("ftyp"): separar
   daria duas funcoes lendo os mesmos 12 primeiros bytes. */
function tipoDoAnexo(buf) {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(SELO_PNG)) return 'png';
  if (buf.length >= 3 && buf.subarray(0, 3).equals(SELO_JPG)) return 'jpg';
  if (buf.length >= 6 && ['GIF87a', 'GIF89a'].includes(buf.subarray(0, 6).toString('latin1'))) return 'gif';
  // WEBP: "RIFF" ....(4 bytes de tamanho).... "WEBP"
  if (buf.length >= 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF'
    && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  if (buf.length >= 4 && buf.subarray(0, 4).equals(SELO_EBML)) return 'webm';
  /* Caixa ISO: os bytes 4 a 8 sao "ftyp" e a marca logo depois diz qual e. "qt" e o video do
     iPhone (mov), heic/heix/mif1/msf1 e a foto do iPhone, o resto dessa caixa e mp4. */
  if (buf.length >= 12 && buf.subarray(4, 8).toString('latin1') === 'ftyp') {
    const marca = buf.subarray(8, 12).toString('latin1');
    if (marca.startsWith('qt')) return 'mov';
    if (['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'].includes(marca)) return 'heic';
    return 'mp4';
  }
  return '';
}
const TIPO_VIDEO = ['mp4', 'mov', 'webm'];
handle('imagem:salvar', (_e, { dados, prefixo } = {}) => {
  try {
    const cru = String(dados || '');
    if (cru.length > IMG_MAX_TXT) return { error: ERRO_GRANDE };
    const m = /^data:(image|video)\/[\w.+-]+;base64,([A-Za-z0-9+/=\s]+)$/.exec(cru);
    if (!m) return { error: 'isso não chegou como imagem nem como vídeo' };
    const bytes = Buffer.from(m[2].replace(/\s+/g, ''), 'base64');
    if (bytes.length > IMG_MAX) return { error: ERRO_GRANDE };
    const tipo = tipoDoAnexo(bytes);
    /* O que o texto DIZ ser tem de bater com o que os bytes SAO — mas quem manda na extensao
       do arquivo e a leitura dos bytes, nunca o rotulo que veio de fora: o iPhone chama o
       mesmo .mov ora de video/quicktime, ora de video/mp4, e a foto ora de jpeg, ora de jpg. */
    const familia = tipo ? (TIPO_VIDEO.includes(tipo) ? 'video' : 'image') : '';
    if (familia !== m[1]) {
      return { error: m[1] === 'video' ? 'isso não é um vídeo de verdade' : 'isso não é uma imagem de verdade' };
    }
    const dir = path.join(app.getPath('userData'), 'colados');
    fs.mkdirSync(dir, { recursive: true });
    const base = String(prefixo || 'imagem').replace(/[^\w-]/g, '').slice(0, 24) || 'imagem';
    let carimbo = Date.now();
    let destino = path.join(dir, base + '-' + carimbo + '.' + tipo);
    while (fs.existsSync(destino)) destino = path.join(dir, base + '-' + (++carimbo) + '.' + tipo);
    fs.writeFileSync(destino, bytes, { flag: 'wx' });
    return { arquivo: destino };
  } catch (e) { return { error: String(e && e.message || e) }; }
});

handle('anexo:ler', (_e, file) => {
  try {
    const st = fs.statSync(file);
    const ext = path.extname(file).slice(1).toLowerCase();
    const base = { path: file, nome: path.basename(file), ext, bytes: st.size };
    if (EXT_IMG.includes(ext) && st.size <= 8 * 1024 * 1024) {
      const mime = ext === 'jpg' ? 'jpeg' : ext === 'svg' ? 'svg+xml' : ext;
      base.mini = 'data:image/' + mime + ';base64,' + fs.readFileSync(file).toString('base64');
    }
    return base;
  } catch (e) { return { path: file, nome: path.basename(file), erro: e.message }; }
});

handle('dialog:pickFiles', async (_e, kind) => {
  if (souRemoto(_e)) return [];
  const opt = { properties: ['multiSelections'], defaultPath: HOME };
  if (kind === 'folder') opt.properties = ['openDirectory'];
  else opt.properties.push('openFile');
  if (kind === 'image') opt.filters = [{ name: 'Imagens', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic'] }];
  const r = await dialog.showOpenDialog(win, opt);
  return r.canceled ? [] : r.filePaths;
});

/* ===================== recortar a tela =====================
   Esconde o Cockpit, fotografa a tela onde esta' o mouse (desktopCapturer), abre uma janela
   sem moldura por cima com essa foto, voce arrasta o retangulo, o pedaco vira PNG em colados/
   e entra como anexo no painel que pediu. (⇧⌘4 + ⌘V ja funcionava; isto poupa a ida ao
   clipboard e nao encosta na area de transferencia dele.)

   R1: os quatro canais entram por ipcMain.handle DIRETO, fora do mapa HANDLERS. Se entrassem
   por handle(), um toque no iPhone esconderia a janela do Mac e deixaria uma tela preta presa
   por cima de tudo, a quilometros de distancia. */
const { desktopCapturer, screen, systemPreferences } = require('electron');
let recorte = null;      // { janela, imagem, paneId, estavaVisivel, boundsW, boundsH, pediuDados }
let recortando = false;  // entre o pedido e a janela existir (o guarda de cima nao cobre o await)
/* Este recado precisa dizer as tres coisas: onde liberar, que tem de reabrir o app depois, e
   que isso volta a acontecer a cada reinstalacao — o Cockpit e assinado na hora do build, e o
   Mac trata cada assinatura nova como um programa diferente. Sem a ultima frase, ele acha que
   quebrou. */
const RECADO_TELA = 'O Mac ainda não deixou o Cockpit fotografar a tela. Libere em Ajustes do Sistema › Privacidade e Segurança › Gravação de Tela (marque o Cockpit), feche e abra o app. Isso é pedido de novo a cada vez que o app é reinstalado.';
ipcMain.handle('tela:recortar', async (_e, { paneId } = {}) => {
  if (recorte || recortando) return { error: 'já tem um recorte aberto' };
  /* No Mac, sem a permissao de Gravacao de Tela o getSources devolve o PAPEL DE PAREDE em
     silencio — ninguem dá erro, e o recorte sai de uma tela que nao e a dele. A conferencia
     vem ANTES de esconder a janela; se escondesse primeiro, o app sumiria para dar um recado. */
  if (process.platform === 'darwin') {
    let estado = 'granted';
    try { estado = systemPreferences.getMediaAccessStatus('screen'); } catch {}
    if (estado !== 'granted') {
      // o macOS so pergunta quando alguem TENTA capturar: este pedido minusculo faz a caixa aparecer
      try { desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } }).catch(() => {}); } catch {}
      return { error: RECADO_TELA };
    }
  }
  recortando = true;
  const estavaVisivel = !!(win && !win.isDestroyed() && win.isVisible());
  let janela = null;
  try {
    const ponto = screen.getCursorScreenPoint();
    const tela = screen.getDisplayNearestPoint(ponto);
    const escala = tela.scaleFactor || 1;
    if (estavaVisivel) win.hide();
    await new Promise((r) => setTimeout(r, 350));   // a janela precisa sumir de verdade antes da foto
    const fontes = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: Math.round(tela.size.width * escala), height: Math.round(tela.size.height * escala) },
    });
    // so' a tela onde esta' o mouse: cair na primaria em silencio recortava a foto de OUTRO
    // monitor por cima deste
    const fonte = fontes.find((f) => String(f.display_id) === String(tela.id));
    if (!fonte || fonte.thumbnail.isEmpty()) {
      if (estavaVisivel) win.show();
      return { error: fontes.length ? 'não achei a tela onde está o mouse (' + fontes.length + (fontes.length === 1 ? ' tela' : ' telas') + ')' : RECADO_TELA };
    }
    janela = new BrowserWindow({
      x: tela.bounds.x, y: tela.bounds.y, width: tela.bounds.width, height: tela.bounds.height,
      frame: false, alwaysOnTop: true, skipTaskbar: true, resizable: false, movable: false,
      hasShadow: false, backgroundColor: '#000000', show: false,
      webPreferences: { preload: path.join(__dirname, 'preload-recorte.js'), contextIsolation: true, nodeIntegration: false },
    });
    recorte = { janela, imagem: fonte.thumbnail, paneId, estavaVisivel, boundsW: tela.bounds.width, boundsH: tela.bounds.height, pediuDados: false };
    janela.setAlwaysOnTop(true, 'screen-saver');
    // no Mac o recorte tem de valer no Space em que ele estiver, inclusive em cima de um app
    // em tela cheia — senao a janela nasce num Space vazio e a tela dele nem pisca
    try { janela.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch {}
    /* Vigia de 15 s. Cobre os dois jeitos de a janela ficar PRESA: nunca pintar (renderer
       morreu antes do primeiro quadro) ou pintar preta sem a ponte (preload que nao entrou no
       pacote). Nos dois casos o Cockpit ficaria escondido atras de uma tela preta sem tecla
       que responda. Quem desarma e' o pedido da foto, que chega em milissegundos. */
    const vigia = setTimeout(() => {
      if (recorte && recorte.janela === janela && !janela.isDestroyed() && !recorte.pediuDados) {
        anota('recorte preso: fechando pelo vigia de 15 s');
        try { janela.close(); } catch {}
      }
    }, 15000);
    janela.once('closed', () => clearTimeout(vigia));
    janela.once('ready-to-show', () => { try { janela.show(); janela.focus(); app.focus({ steal: true }); } catch {} });   // sem flash preto
    janela.webContents.on('did-fail-load', () => { try { janela.close(); } catch {} });        // sem tela preta presa
    janela.webContents.on('render-process-gone', () => { try { janela.close(); } catch {} });
    janela.loadFile(path.join(__dirname, 'renderer', 'recorte.html'));
    janela.on('closed', () => {
      const r = recorte; recorte = null;
      if (r && r.estavaVisivel && win && !win.isDestroyed()) { win.show(); win.focus(); }
    });
    return { ok: true };
  } catch (e) {
    recorte = null;
    if (janela) { try { janela.close(); } catch {} }
    if (estavaVisivel && win && !win.isDestroyed()) win.show();
    return { error: String(e && e.message || e) };
  } finally { recortando = false; }
});
// so' a janela do recorte fala nestes canais (o preload principal nem os expoe; e' defesa barata)
const daJanelaDeRecorte = (e) => !!(recorte && recorte.janela && !recorte.janela.isDestroyed() && e.sender === recorte.janela.webContents);
ipcMain.handle('recorte:dados', (e) => {
  if (!daJanelaDeRecorte(e)) return null;
  recorte.pediuDados = true;   // desarma o vigia de 15 s: a janela esta viva e com ponte
  const tam = recorte.imagem.getSize();
  return { png: recorte.imagem.toDataURL(), escala: tam.width / (recorte.boundsW || tam.width) };
});
ipcMain.handle('recorte:pronto', (e, { x, y, w, h } = {}) => {
  const r = recorte;
  if (!r || !daJanelaDeRecorte(e)) return { error: 'sem recorte aberto' };
  try {
    // escala REAL da foto (pixels por px de CSS), por eixo, medida na propria imagem — nao no
    // scaleFactor, que pode divergir entre monitores
    const tam = r.imagem.getSize();
    const kx = tam.width / (r.boundsW || tam.width), ky = tam.height / (r.boundsH || tam.height);
    const rect = {
      x: Math.max(0, Math.min(tam.width - 1, Math.round(x * kx))), y: Math.max(0, Math.min(tam.height - 1, Math.round(y * ky))),
      width: Math.max(1, Math.round(w * kx)), height: Math.max(1, Math.round(h * ky)),
    };
    rect.width = Math.min(rect.width, tam.width - rect.x); rect.height = Math.min(rect.height, tam.height - rect.y);
    const png = r.imagem.crop(rect).toPNG();
    const dir = path.join(app.getPath('userData'), 'colados');
    fs.mkdirSync(dir, { recursive: true });
    const destino = path.join(dir, 'recorte-' + Date.now() + '.png');
    fs.writeFileSync(destino, png);
    emit(r.paneId, 'anexo-pronto', { arquivo: destino, origem: 'recorte' });
    try { r.janela.close(); } catch {}
    return { ok: true, arquivo: destino };
  } catch (e2) { try { r.janela.close(); } catch {} return { error: String(e2 && e2.message || e2) }; }
});
ipcMain.handle('recorte:cancelar', (e) => { const r = recorte; if (r && daJanelaDeRecorte(e)) { try { r.janela.close(); } catch {} } return { ok: true }; });

/* ===================== texto que está DENTRO da imagem (OCR local) =====================
   Print de erro, foto de um papel, tabela num screenshot: em vez de ele redigitar, o texto
   sai da imagem e cai no campo, para editar antes de mandar.

   Reescrita, nao port: no fork de origem isto e' PowerShell chamando o Windows.Media.Ocr, que
   nao existe aqui. No Mac quem le e' a Vision da Apple, num binario Swift proprio
   (voz/ocr-vision.swift), compilado UMA vez e comitado — mesmo trato do ditado-vivo. Roda
   AQUI DENTRO: sem rede, sem conta, sem pacote de idioma para instalar, ~1 s.
   Tambem sai a reducao para 2600 px que o fork fazia: a Vision nao tem esse teto.

   Entra por handle(): e' leitura, e o telefone ja le arquivo deste Mac pelos canais que
   existem. R7: pasta/arquivo da VPS nao passa por aqui — quem le disco e' este Mac. */
const OCR_BIN = app.isPackaged
  ? path.join(process.resourcesPath, 'ocr-vision')
  : path.join(__dirname, 'voz', 'ocr-vision');
const OCR_MAX = 40 * 1024 * 1024;
handle('ocr:ler', async (_e, { arquivo } = {}) => {
  if (process.platform !== 'darwin') return { error: 'o OCR local só existe no Mac' };
  const f = String(arquivo || '');
  if (!f) return { error: 'sem arquivo' };
  if (ehRemoto(f)) return { error: 'esse arquivo está na VPS; o OCR lê imagem que está aqui no Mac' };
  const ext = path.extname(f).slice(1).toLowerCase();
  if (!EXT_IMG.includes(ext) || ext === 'svg') return { error: 'isso não é uma imagem que eu consiga ler' };
  if (!fs.existsSync(OCR_BIN)) return { error: 'falta o programa de OCR no app' };
  try {
    const st = fs.statSync(f);
    if (!st.isFile()) return { error: 'arquivo não encontrado' };
    if (st.size > OCR_MAX) return { error: 'imagem grande demais para o OCR' };
  } catch { return { error: 'arquivo não encontrado' }; }
  const r = await rodar(OCR_BIN, [f], 45000);
  const texto = String(r.out || '').replace(/\r/g, '').trim();
  if (texto) return { texto };
  const erro = String(r.errout || '').trim();
  // saiu 0 e sem uma palavra: a imagem simplesmente nao tem texto
  if (!r.err && !erro) return { error: 'não achei texto nessa imagem' };
  const motivo = /nao consegui abrir/i.test(erro) ? 'não consegui abrir essa imagem'
    : /a leitura falhou/i.test(erro) ? 'a leitura da imagem falhou'
    : erro ? 'o OCR falhou (' + erro.replace(/\s+/g, ' ').slice(0, 120) + ')'
    : 'o OCR não respondeu em 45 s';
  return { error: motivo };
});

/* ======================= aparência =======================
   Redesenho de 25/09: os temas Escuro/Claro/Jornal viraram Aparência: Automática / Clara /
   Escura (cfg.tema = 'auto' | 'clara' | 'escura'; o que estava salvo com o nome antigo vale
   pelo mais proximo, e o Jornal, que era claro, vira Clara). Quem pinta a tela e o renderer
   (aparencia.js). Aqui o que muda e o nativeTheme do Electron: com ele a barra de rolagem
   nativa, os semaforos, os menus do sistema e o prefers-color-scheme da pagina acompanham a
   escolha — Escura forca escuro mesmo com o Mac claro, Automatica devolve para o Mac. */
function aparenciaDe(t) {
  if (t === 'escura' || t === 'escuro') return 'escura';
  if (t === 'clara' || t === 'claro' || t === 'jornal') return 'clara';
  return 'auto';
}
const FONTE_DO_TEMA = { auto: 'system', clara: 'light', escura: 'dark' };
function aplicarAparenciaNativa(t) {
  try {
    const fonte = FONTE_DO_TEMA[aparenciaDe(t)];
    if (nativeTheme && nativeTheme.themeSource !== fonte) nativeTheme.themeSource = fonte;
  } catch (e) { anota('nao consegui acertar a aparencia do Mac:', e && e.message); }
}
/* O fundo que a janela mostra ANTES da pagina pintar (e nas bordas ao redimensionar): o mesmo
   --bg-content dos tokens do tema que vai abrir. Com o #1e1e1e fixo de antes, quem usa claro via
   um clarao escuro a cada abertura. */
function fundoDaJanela() {
  try { return nativeTheme && !nativeTheme.shouldUseDarkColors ? '#FFFFFF' : '#161617'; } catch { return '#161617'; }
}

/* ======================= janela ======================= */
function createWindow() {
  // antes da janela nascer: assim o prefers-color-scheme da pagina ja chega certo no 1o quadro
  try { aplicarAparenciaNativa(loadConfig().tema); } catch {}
  win = new BrowserWindow({
    width: 1500, height: 900, minWidth: 900, minHeight: 560,
    backgroundColor: fundoDaJanela(),
    titleBarStyle: 'hiddenInset',
    /* Os semaforos moram na barra do topo desde que a barra de titulo saiu (10/09). Redesenho
       (25/09): barra de 52pt, bolinhas de 12 a x=20, centradas na barra. O Electron posiciona o
       QUADRO do botao do Mac, nao a bolinha, e poe o topo dele em y. No macOS 26 o quadro mede
       14x14 (medido numa NSWindow escondida em 26/09: 9,9 / 32,9 / 55,9, todos 14x14), com a
       bolinha de 12 no meio: x=19 poe a bolinha em 20, e y=19 poe o centro em 19+7 = 26, o meio
       dos 52. O passo entre os tres (23) e do sistema: o trafficLightPosition so move o primeiro. */
    trafficLightPosition: { x: 19, y: 19 },
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, spellcheck: false },
  });
  win.loadFile(path.join(__dirname, 'renderer/index.html'));
  // Automatica e o Mac trocou de claro para escuro (ou ele trocou nos Ajustes): o fundo de
  // reserva da janela acompanha. Um ouvinte por janela, solto quando ela fecha.
  if (nativeTheme && nativeTheme.on) {
    const fundoAcompanha = () => { try { if (win && !win.isDestroyed()) win.setBackgroundColor(fundoDaJanela()); } catch {} };
    nativeTheme.on('updated', fundoAcompanha);
    win.on('closed', () => { try { nativeTheme.removeListener('updated', fundoAcompanha); } catch {} });
  }
  win.on('focus', zerarBadge);   // voltou para a janela: o numero no Dock nao serve mais
  // o ditado precisa do microfone; a pagina e o proprio app, entao o pedido e liberado
  win.webContents.session.setPermissionRequestHandler((_wc, _perm, cb) => cb(true));

  /* leva 6 — caixa de entrada. Estes dois ficam AQUI, e nao dentro do ligarInbox(): no Mac o
     app.on('activate') recria a janela quando ele clica no Dock com tudo fechado, e a janela
     nova nasceria sem eles. A cada carga da tela (abertura e ⌘R) tudo que sobrou na caixa e
     anunciado de novo. */
  // ⌘R: a tela nova ainda nao ouve, e nao tem como fechar terminal que ja ficou pra tras (pty orfao)
  win.webContents.on('did-start-loading', () => { inboxOuvinte = false; for (const id of [...terms.keys()]) termMatar(id); });
  win.webContents.on('did-finish-load', () => { inboxVistos.clear(); });      // e o que sobrou volta a ser anunciado quando ela avisar

  // menu do botao direito: copiar, colar, procurar, etc. — o do sistema mesmo
  win.webContents.on('context-menu', (_ev, props) => {
    const itens = [];
    const temSelecao = !!(props.selectionText && props.selectionText.trim());
    const podeEditar = props.isEditable;

    if (props.linkURL) {
      itens.push({ label: 'Abrir link no navegador', click: () => shell.openExternal(props.linkURL) });
      itens.push({ label: 'Copiar o endereço do link', click: () => clipboard.writeText(props.linkURL) });
      itens.push({ type: 'separator' });
    }
    if (podeEditar) {
      itens.push({ role: 'undo', label: 'Desfazer' });
      itens.push({ role: 'redo', label: 'Refazer' });
      itens.push({ type: 'separator' });
      itens.push({ role: 'cut', label: 'Recortar' });
    }
    itens.push({ role: 'copy', label: 'Copiar', enabled: temSelecao });
    if (podeEditar) itens.push({ role: 'paste', label: 'Colar' });
    if (podeEditar) itens.push({ role: 'selectAll', label: 'Selecionar tudo' });
    else if (temSelecao) itens.push({ role: 'selectAll', label: 'Selecionar tudo' });

    if (temSelecao) {
      const t = props.selectionText.trim().slice(0, 120);
      itens.push({ type: 'separator' });
      itens.push({ label: 'Procurar no Google', click: () => shell.openExternal('https://www.google.com/search?q=' + encodeURIComponent(t)) });
      // se o que ele marcou parece um caminho de arquivo, deixo abrir no Finder
      if (/^[~/][^\n]{2,}$/.test(t)) {
        itens.push({ label: 'Mostrar no Finder', click: () => shell.showItemInFolder(t.replace(/^~/, HOME)) });
      }
    }
    itens.push({ type: 'separator' });
    itens.push({ label: 'Recarregar a tela', click: () => win.webContents.reload() });
    itens.push({ label: 'Ferramentas de desenvolvedor', click: () => win.webContents.toggleDevTools() });

    Menu.buildFromTemplate(itens).popup({ window: win });
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  // clicar num link nunca troca a tela do app: abre no navegador.
  // O file:// ficava LIBERADO aqui, e era por isso que arrastar um arquivo e soltar fora da
  // caixa de texto fazia o Cockpit "sumir": a janela navegava para o arquivo e a interface
  // inteira era trocada pelo conteudo dele. Agora nada navega; arquivo abre no Finder.
  win.webContents.on('will-navigate', (e, url) => {
    e.preventDefault();
    if (/^https?:/i.test(url)) { shell.openExternal(url); return; }
    if (url.startsWith('file://')) {
      try { shell.showItemInFolder(decodeURIComponent(url.replace('file://', ''))); } catch {}
    }
  });
  /* Fechar a janela mata na hora TODOS os agentes, sem perguntar: quem estava no meio de uma
     tarefa morre ali. E no Mac o app continua no Dock, entao reabrir traz a tela de volta com
     as conversas paradas e o trabalho perdido. Por isso o aviso: o 'close' ainda da para
     cancelar; o 'closed' logo abaixo ja e depois do estrago. Cmd+Q nao pergunta nada, que ai
     a ordem de sair e clara. Se qualquer coisa der errado aqui, a janela fecha normal: nunca
     prender o Homero dentro do app. */
  win.on('close', (e) => {
    if (saindoDoApp) return;
    let quantos = 0;
    try { quantos = agentesTrabalhando(); } catch { return; }
    if (!quantos) return;
    try {
      const r = dialog.showMessageBoxSync(win, {
        type: 'warning',
        buttons: ['Não fechar', 'Fechar mesmo assim'],
        defaultId: 0, cancelId: 0,
        message: quantos === 1 ? '1 agente está trabalhando agora' : quantos + ' agentes estão trabalhando agora',
        detail: 'Fechar agora interrompe o trabalho no meio, e o que estava rodando não volta.',
      });
      if (r !== 1) e.preventDefault();
    } catch {}
  });
  win.on('closed', () => { win = null; shutdown(); });
}

/* quem esta no meio de uma tarefa AGORA: turno do Codex em andamento e painel do Claude que
   recebeu uma mensagem e ainda nao devolveu o fim do turno. Painel aberto e parado nao conta,
   senao o aviso apareceria toda vez que a janela fecha. */
function agentesTrabalhando() {
  let n = 0;
  try { n += codex.paneTurn.size; } catch {}
  try { for (const st of claudePanes.values()) if (st && st.rodando) n++; } catch {}
  try { n += cli.trabalhando(); } catch {}
  try { n += acp.trabalhando(); } catch {}
  return n;
}
let saindoDoApp = false;

async function shutdown() {
  paneStarts.clear();
  const espera = [];   // R2-034: promessas do SIGKILL de garantia de cada processo filho
  espera.push(cli.fechar());   // R3-009: antes rodava solto (fire-and-forget), sem esperar Gemini morrer
  espera.push(acp.fechar());   // R3-009: idem para ACP/Grok
  fecharMestresSsh();   // o mestre do ControlPersist nao fica pendurado depois do app
  for (const id of [...claudePanes.keys()]) espera.push(claudeStop(id));
  for (const id of [...vozAtiva.keys()]) vozMatar(id);
  // R3-009: nao reusa termMatar aqui (so' devolve {ok:true} sincrono) — pega o pty direto
  // e empurra a Promise de matar() pra `espera`, senao o terminal nunca era aguardado
  for (const id of [...terms.keys()]) {
    const p = terms.get(id);
    terms.delete(id);
    if (p) espera.push(Promise.resolve(p.matar()));
  }
  for (const c of codexConns.values()) {
    const proc = c.proc;
    c.proc = null; c.ready = null; c.buf = '';
    for (const [, pending] of c.pend) pending.reject(new Error('A janela do Cockpit foi fechada.'));
    c.pend.clear();
    limparPaineisCodex(c.destino);
    if (proc) espera.push(matarGrupoExtra(proc));   // mata o grupo, nao so' o codex (filho de sandbox pode sobrar)
  }
  // so' agora, com tudo desligado: espera o SIGTERM/SIGKILL de cada processo terminar (ou o
  // teto de 1,5s de cada um) antes do 'before-quit' deixar o Electron fechar o app de vez.
  await Promise.all(espera);
}

/* ======================= IPC ======================= */
/* A senha fixa do iPhone (senhaWeb) NAO vai junto. Este mesmo comando e servido pelo Wi-Fi
   e o app do celular chama ele assim que abre: quem entrou com a sessao de 8 horas lia ali a
   senha permanente e podia voltar para sempre, mesmo depois de trocar a sessao. A tela do Mac
   nao usa nenhuma destas chaves (quem mostra a senha e o web:estado), entao nada quebra.
   O disco continua com tudo; o que sai daqui e uma copia sem elas. */
handle('config:get', () => {
  const d = { ...loadConfig() };
  for (const k of CHAVES_DO_MAIN) delete d[k];
  return d;
});
/* Estas tres chaves quem manda e o main (senha do iPhone e o liga/desliga do Wi-Fi). A tela
   trabalha com uma copia do config lida uma unica vez no boot, entao qualquer gravacao dela
   — e o savePanes() grava a cada chat aberto, fechado ou redimensionado — mandava de volta o
   valor VELHO e apagava a senha e o "ligado". Era por isso que o acesso pelo iPhone se
   desligava sozinho e a senha mudava. Agora estas tres vem sempre do disco. */
const CHAVES_DO_MAIN = ['senhaWeb', 'webLigado', 'webSeguroConfirmado', 'codexApiEnabled', 'codexApiCapUsd'];
/* Estas tres ficam na memoria do main. Antes eu relia o arquivo de 2,2 MB a cada gravacao so
   para busca-las — e o savePanes grava a cada chat aberto ou fechado. Quem escreve nelas e
   sempre o main (senhaDoTelefone e web:ligar), entao a copia na memoria esta sempre certa. */
let chavesDoMain = null;
function lerChavesDoMain() {
  if (chavesDoMain) return chavesDoMain;
  const d = loadConfig();
  chavesDoMain = {};
  for (const k of CHAVES_DO_MAIN) {
    if (Object.prototype.hasOwnProperty.call(d, k)) chavesDoMain[k] = d[k];
  }
  return chavesDoMain;
}
function anotarChaveDoMain(k, v) { lerChavesDoMain(); chavesDoMain[k] = v; }

handle('config:set', (_e, c, origem) => {
  /* o celular nao grava config. Ele trabalha com um retrato antigo da tela, e gravar por
     cima ja apagou as abas do Mac uma vez. O lado do celular ja nao pede mais, mas a trava
     tem de estar AQUI: uma aba velha do Safari em cache continuava conseguindo gravar.
     Responde "ok" e nao grava nada. */
  if (souRemoto(_e)) return true;
  const novo = (c && typeof c === 'object') ? { ...c } : {};
  const donas = lerChavesDoMain();
  for (const k of CHAVES_DO_MAIN) {
    if (Object.prototype.hasOwnProperty.call(donas, k)) novo[k] = donas[k];
    else delete novo[k];
  }
  /* `origem` so vem de dentro do Mac (o preload passa). Sem ela, uma gravacao que perde aba
     e barrada. O numero de abas devolvidas volta pra tela poder dar o recado. */
  const devolvidas = saveConfig(novo, origem);
  if (devolvidas < 0) return { ok: false, error: 'Não consegui salvar as abas e preferências no disco. O arquivo anterior foi preservado.' };
  // a Aparencia escolhida nos Ajustes vale tambem para o que e nativo (so troca se mudou)
  aplicarAparenciaNativa(novo.tema);
  return { ok: true, abasDevolvidas: devolvidas };
});
handle('sys:home', () => HOME);

/* Escolher pasta sem um ponto de partida cai na home, e de la sao 3 cliques ate os projetos.
   O padrao passa a ser a pasta dos projetos do Claude, que e de onde quase toda aba nasce. */
const PASTA_PROJETOS = path.join(HOME, 'Desktop', 'Projetos-claude');
function pastaInicial(start) {
  if (start) return start;
  try { if (fs.statSync(PASTA_PROJETOS).isDirectory()) return PASTA_PROJETOS; } catch {}
  return HOME;
}
handle('dialog:pickFolder', async (_e, start) => {
  if (souRemoto(_e)) return null;
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'], defaultPath: pastaInicial(start), title: 'Pasta de trabalho deste painel' });
  return r.canceled ? null : r.filePaths[0];
});
// so este desvio mudou: a arvore passou a usar a listagem NOVA (NUL + base64 + teto + sonda)
handle('fs:list', (_e, d) => (ehRemoto(d) ? listDirRemotoV2(d) : listDir(d)));
handle('fs:read', (_e, f) => {
  if (ehRemoto(f)) return lerArquivoRemoto(f);
  try {
    if (fs.statSync(f).size > 500 * 1024) return { error: 'Arquivo grande demais para ver aqui.' };
    return { content: fs.readFileSync(f, 'utf8') };
  } catch (e) { return { error: e.message }; }
});
// listar pastas da VPS para o seletor de pasta remoto
handle('vps:pastas', async (_e, cwd) => {
  const alvo = ehRemoto(cwd) ? cwd : 'vps:/';
  return listDirRemoto(alvo);
});
handle('vps:testar', async () => {
  const r = partesRemoto('vps:/');
  const rr = await noServidor(r, 'echo ok; claude --version 2>/dev/null | head -1', 15000);
  if (rr.error) return { error: rr.error };
  return { ok: true, versao: (rr.out || '').split('\n')[1] || '' };
});

/* ---------- prompts salvos com nome ----------
   Um json SEU, fora do app: ~/.claude/cockpit-prompts.json. Fica fora do config do Cockpit
   de proposito — assim reinstalar o app nao leva junto os pedidos longos que ele guardou,
   e da' para abrir o arquivo e editar na mao. */
const PROMPTS_PATH = () => path.join(HOME, '.claude', 'cockpit-prompts.json');
handle('prompts:ler', () => {
  try {
    const j = JSON.parse(fs.readFileSync(PROMPTS_PATH(), 'utf8'));
    return Array.isArray(j) ? j.filter((p) => p && p.nome && p.texto).slice(0, 200) : [];
  } catch { return []; }
});
handle('prompts:salvar', (_e, lista) => {
  try {
    const limpa = (Array.isArray(lista) ? lista : [])
      .filter((p) => p && String(p.nome || '').trim() && String(p.texto || '').trim())
      .map((p) => ({ nome: String(p.nome).trim().slice(0, 80), texto: String(p.texto).slice(0, 50000), quando: Number(p.quando) || Date.now() }))
      .slice(0, 200);
    // a pasta ~/.claude existe em toda maquina com o Claude instalado, mas nao custa garantir:
    // sem ela o gravarSeguro falharia calado e o prompt se perderia sem recado
    try { fs.mkdirSync(path.dirname(PROMPTS_PATH()), { recursive: true }); } catch {}
    if (!gravarSeguro(PROMPTS_PATH(), JSON.stringify(limpa, null, 2))) return { error: 'não consegui gravar o arquivo dos prompts' };
    return { ok: true };
  } catch (e) { return { error: String((e && e.message) || e) }; }
});

/* ---------- guardar a conversa no Obsidian ----------
   Regra da casa: texto mora no vault. Conversa de cliente vai para a pasta dele; o resto cai
   em "3 - Operação". O nome do cliente sai da pasta do chat (…/Projetos-claude/<Cliente>/…). */
const VAULT = path.join(HOME, 'Documents', 'Adsure - Copy Lançamentos');
function pastaNoVault(cwd) {
  const m = String(cwd || '').match(/Projetos-claude\/([^/]+)/);
  const cliente = m && m[1];
  const genericos = ['Homero', 'Adsure'];
  if (cliente && !genericos.includes(cliente)) {
    const dele = path.join(VAULT, '2 - Clientes', cliente, '_Fontes');
    if (fs.existsSync(path.join(VAULT, '2 - Clientes', cliente))) return dele;
  }
  return path.join(VAULT, '3 - Operação', 'Conversas do Cockpit');
}
handle('vault:salvar', (_e, { titulo, cwd, motor, texto }) => {
  try {
    if (!fs.existsSync(VAULT)) return { error: 'não achei o vault do Obsidian' };
    const pasta = pastaNoVault(cwd);
    fs.mkdirSync(pasta, { recursive: true });
    const d = new Date();
    const dia = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    const limpo = String(titulo || 'Conversa').replace(/[\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 70);
    let arq = path.join(pasta, dia + ' - ' + limpo + '.md');
    let n = 2;
    while (fs.existsSync(arq)) arq = path.join(pasta, dia + ' - ' + limpo + ' (' + (n++) + ').md');
    const cab = '---\nfonte: Cockpit\nmotor: ' + (motor || '') + '\npasta: ' + (cwd || '') + '\ndata: ' + dia + '\n---\n\n# ' + limpo + '\n\n';
    fs.writeFileSync(arq, cab + (texto || ''), 'utf8');
    return { ok: true, caminho: arq, pasta, curto: arq.replace(VAULT + '/', '') };
  } catch (e) { return { error: e.message }; }
});

/* ---------- ditar: o audio vira texto aqui no Mac ----------
   whisper.cpp com o modelo small. Sem internet, sem conta, sem custo por minuto. */
const VOZ_MODELO = path.join(HOME, '.cockpit', 'modelos', 'ggml-small.bin');
handle('voz:transcrever', async (_e, { audio }) => {
  try {
    // o audio do celular viaja no MESMO quadro de 8 MB do ws: mesmo teto do anexo
    if (String(audio || '').length > IMG_MAX_TXT) return { error: 'gravação longa demais (o limite é ~6 MB)' };
    if (!fs.existsSync(VOZ_MODELO)) return { error: 'falta o modelo de voz em ~/.cockpit/modelos' };
    const whisper = acharBin('whisper-cli');
    const ff = acharBin('ffmpeg');
    if (!whisper || !ff) return { error: 'falta o whisper-cli ou o ffmpeg' };
    // R1-011: so' o pid repetia por toda a vida do app; duas ditacoes ao mesmo tempo (dois
    // paineis, ou Mac + celular) escreviam/apagavam o MESMO arquivo temporario uma por cima
    // da outra e um chat recebia o texto ditado no outro. Um id por chamada resolve.
    const base = path.join(os.tmpdir(), 'ck-voz-' + process.pid + '-' + crypto.randomUUID());
    const saida = base + '.txt';
    // R3-023: limpeza em finally — antes, se o ffmpeg falhasse na conversao, o retorno antecipado
    // pulava o unlinkSync e o .webm ficava pra sempre em os.tmpdir() (ditado com audio ruim acumula lixo)
    const arquivos = [base + '.webm', base + '.wav', saida];
    try {
      fs.writeFileSync(base + '.webm', Buffer.from(audio, 'base64'));
      // o whisper so aceita wav de 16 kHz mono: o navegador grava em webm/opus
      const conv = await rodar(ff, ['-y', '-i', base + '.webm', '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', base + '.wav'], 60000);
      if (!fs.existsSync(base + '.wav')) return { error: 'não converti o áudio' + (conv.errout ? ': ' + String(conv.errout).slice(-120) : '') };
      await rodar(whisper, ['-m', VOZ_MODELO, '-l', 'pt', '-nt', '-otxt', '-of', base, base + '.wav'], 180000);
      const texto = fs.existsSync(saida) ? fs.readFileSync(saida, 'utf8').trim() : '';
      if (!texto) return { error: 'não saiu texto nenhum' };
      return { texto };
    } finally {
      for (const f of arquivos) { try { fs.unlinkSync(f); } catch {} }
    }
  } catch (e) { return { error: e.message }; }
});

/* ---------- avisar que a resposta ficou pronta ----------
   Ele sai da frente do Mac enquanto o motor trabalha e voltava so para descobrir se ja tinha
   acabado. Agora chega recado do sistema e o icone no Dock ganha o numero de chats prontos.
   Clicar no recado traz a janela para a frente E abre o chat certo. */
/* ---------- ditado AO VIVO (motor de fala do proprio macOS) ----------
   O ditado antigo grava tudo, para, converte e so entao transcreve: ele fala 40 segundos
   olhando para uma tela muda. Aqui quem ouve e o motor nativo do Mac (SpeechAnalyzer, o mesmo
   do Eco), num programinha Swift que cospe uma linha JSON por evento — parcial enquanto fala,
   final quando fecha a frase, e para sozinho quando o silencio passa de N segundos.
   Nada de ffmpeg, nada de arquivo temporario, nada de modelo de 465 MB na memoria. */
const VOZ_BIN = app.isPackaged
  ? path.join(process.resourcesPath, 'ditado-vivo')
  : path.join(__dirname, 'voz', 'ditado-vivo');
const vozAtiva = new Map();     // paneId -> processo do ditado
function vozMatar(paneId) {
  const p = vozAtiva.get(paneId);
  if (!p) return;
  vozAtiva.delete(paneId);
  try { p.kill('SIGTERM'); } catch {}
}
handle('voz:vivo', (_e, { paneId, silencio, teto }) => {
  if (process.platform !== 'darwin') return { error: 'o ditado ao vivo só existe no Mac' };
  if (!fs.existsSync(VOZ_BIN)) return { error: 'falta o programa de ditado' };
  vozMatar(paneId);
  let proc;
  try {
    proc = spawn(VOZ_BIN, ['pt-BR', String(silencio || 1.8), String(teto || 180), '15'],
      { stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (e) { return { error: String(e && e.message || e) }; }
  vozAtiva.set(paneId, proc);
  let buf = '';
  const decoder = new StringDecoder('utf8');
  proc.stdout.on('data', (d) => {
    if (vozAtiva.get(paneId) !== proc) return;
    buf += decoder.write(d);
    const linhas = buf.split('\n');
    buf = linhas.pop();
    for (const l of linhas) {
      const t = l.trim(); if (!t) continue;
      let m; try { m = JSON.parse(t); } catch { continue; }
      emit(paneId, 'voz', m);
    }
  });
  // stderr do Swift so interessa quando o programa morre sem dizer nada
  let erro = '';
  proc.stderr.on('data', (d) => { erro = (erro + d.toString()).slice(-500); });
  proc.on('close', () => {
    if (vozAtiva.get(paneId) !== proc) return;
    vozAtiva.delete(paneId);
    emit(paneId, 'voz', { type: 'status', msg: 'fim', erro: erro || undefined });
  });
  const falhou = (e) => {
    if (vozAtiva.get(paneId) !== proc) return;
    vozMatar(paneId);
    emit(paneId, 'voz', { type: 'error', msg: String(e && e.message || e) });
  };
  proc.on('error', falhou);
  proc.stdin.on('error', falhou);
  return { ok: true };
});
handle('voz:parar', (_e, { paneId, cancelar }) => {
  const p = vozAtiva.get(paneId);
  if (!p) return { ok: false };
  // "stop" fecha bonito e ainda devolve o texto final; cancelar mata na hora e joga fora
  if (cancelar) vozMatar(paneId);
  else { try { p.stdin.write('stop\n'); } catch { vozMatar(paneId); } }
  return { ok: true };
});
/* Fechar o app no meio do ditado deixava o programinha do microfone vivo — e a luz laranja
   acesa no Mac, sem nada na tela para desligar. Ouvinte proprio, alem dos que ja existem. */
app.on('before-quit', () => { for (const id of [...vozAtiva.keys()]) vozMatar(id); });

/* ---------- atalho global de voz ----------
   Ditar sem ir ate o Cockpit: aperta a tecla de onde estiver, a janela vem para a frente e o
   microfone liga no chat em foco. DESLIGADO por padrao: um atalho global ganha de TODO
   programa enquanto o Cockpit estiver aberto, e isso tem de ser escolha dele.
   So o atalho de DITAR: o par de recorte de tela do outro fork nao existe aqui.
   ⌃⌥Espaco esta livre neste Mac (conferido nos atalhos do sistema).
   R1: registrado com ipcMain.handle DIRETO, nunca com handle() — senao o iPhone ligaria e
   desligaria pelo Wi-Fi um atalho do teclado do Mac. */
const { globalShortcut } = require('electron');
const TECLA_DITAR = 'Control+Alt+Space';
const atalhosFalhos = [];
let criandoJanelaPeloAtalho = false;   // R2-026: trava contra aperto repetido antes da janela existir
function ligarAtalhosGlobais(ligado) {
  try { globalShortcut.unregisterAll(); } catch {}
  atalhosFalhos.length = 0;
  if (!ligado) return;
  // se outro programa ja tem a tecla, o register devolve false: fica so o caminho pelo menu
  try {
    const ok = globalShortcut.register(TECLA_DITAR, () => {
      // R2-026: janela fechada (botao vermelho) nao morre no Mac, so some — mas o atalho
      // fazia nada nesse caso. Recria pelo mesmo caminho do clique no Dock (activate).
      if (!win || win.isDestroyed()) {
        if (criandoJanelaPeloAtalho) return;
        criandoJanelaPeloAtalho = true;
        // R3-002: se a janela nunca terminar de carregar (erro ao criar, did-fail-load), a
        // flag ficava travada em true pra sempre e o atalho morria ate reiniciar o app.
        // Reseta nos dois eventos possiveis, no catch e num timeout de rede extra.
        const destravar = () => { criandoJanelaPeloAtalho = false; };
        const tempoExtra = setTimeout(destravar, 10000);
        try {
          createWindow();
          win.webContents.once('did-finish-load', () => {
            clearTimeout(tempoExtra);
            destravar();
            win.show(); win.focus();
            win.webContents.send('menu', 'ditar');
          });
          win.webContents.once('did-fail-load', () => { clearTimeout(tempoExtra); destravar(); });
        } catch {
          clearTimeout(tempoExtra);
          destravar();
        }
        return;
      }
      if (win.isMinimized()) win.restore();
      win.show(); win.focus();
      win.webContents.send('menu', 'ditar');
    });
    if (!ok) atalhosFalhos.push(TECLA_DITAR);
  } catch { atalhosFalhos.push(TECLA_DITAR); }
}
ipcMain.handle('atalhos:estado', () => ({ falhos: atalhosFalhos.slice() }));
ipcMain.handle('atalhos:ligar', (_e, o) => { ligarAtalhosGlobais(!!(o && o.ligado)); return { falhos: atalhosFalhos.slice() }; });
app.on('will-quit', () => { try { globalShortcut.unregisterAll(); } catch {} });

let prontosParados = 0;
handle('aviso:pronto', (_e, { paneId, titulo, texto }) => {
  if (!win || win.isFocused()) return { ok: false };
  prontosParados++;
  if (app.dock) app.dock.setBadge(String(prontosParados));
  if (Notification.isSupported()) {
    const n = new Notification({
      title: titulo || 'Terminou',
      body: (texto || '').slice(0, 220),
      silent: false,
    });
    n.on('click', () => {
      if (!win) return;
      if (win.isMinimized()) win.restore();
      win.show(); win.focus();
      win.webContents.send('menu', 'ir:' + paneId);
    });
    n.show();
  }
  return { ok: true };
});
function zerarBadge() {
  prontosParados = 0;
  if (app.dock) app.dock.setBadge('');
}

/* O AGENTE TE CHAMOU no meio do trabalho (PushNotification interceptada em claudeMessage).
   NAO reusa o 'aviso:pronto' de proposito: aquele conta "chats prontos" no badge do Dock, e
   aqui o chat NAO terminou — o numero do Dock passaria a mentir. Aqui e' so o aviso do
   sistema; o cartao na conversa e o piscar do painel sao da tela. */
handle('aviso:agente', (_e, { paneId, titulo, texto }) => {
  if (!Notification.isSupported()) return { ok: false };
  const n = new Notification({
    title: String(titulo || 'O agente te chamou').slice(0, 120),
    body: String(texto || '').slice(0, 220),
    silent: false,
  });
  n.on('click', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show(); win.focus();
    win.webContents.send('menu', 'ir:' + paneId);
  });
  n.show();
  return { ok: true };
});

handle('clipboard:copiar', (_e, txt) => { clipboard.writeText(String(txt || '')); return { ok: true }; });

/* ---------- puxar a aba que ele está olhando no navegador ----------
   Ele manda link o dia todo copiando e colando. Isto pergunta ao navegador qual e a aba da
   frente. Se o Mac ainda nao deu permissao de automacao, o proprio erro explica o caminho. */
handle('navegador:aba', async () => {
  const roteiros = [
    ['Google Chrome', 'tell application "Google Chrome" to return (URL of active tab of front window) & "\\n" & (title of active tab of front window)'],
    ['Safari', 'tell application "Safari" to return (URL of front document) & "\\n" & (name of front document)'],
  ];
  let algumAberto = false;
  for (const [nome, script] of roteiros) {
    // R1-012: "tell application" ABRE o app sozinho se ele nao estiver rodando; checar se o
    // processo ja existe antes evita abrir Chrome/Safari escondido so pra nao achar aba nenhuma.
    // R2-042: pgrep em vez de "System Events" — System Events pede permissao de Automacao
    // PROPRIA e separada; sem ela a checagem falhava calada e dizia "abra o navegador" com
    // o navegador aberto. pgrep e utilitario do macOS, nao pede permissao nenhuma.
    const check = await rodar('/usr/bin/pgrep', ['-x', nome], 3000);
    if (check.err) continue;
    algumAberto = true;
    const r = await rodar('/usr/bin/osascript', ['-e', script], 8000);
    const saida = String(r.out || '').trim();
    if (saida && /^https?:/i.test(saida)) {
      const [url, ...resto] = saida.split('\n');
      return { url, titulo: resto.join(' ').trim(), navegador: nome };
    }
    if (/not allowed|permitido|-1743/i.test(String(r.errout || ''))) {
      return { error: 'o Mac ainda não deixou o Cockpit falar com o ' + nome + '. Ajustes do Sistema › Privacidade › Automação › Cockpit' };
    }
  }
  if (!algumAberto) return { error: 'abra o Chrome ou o Safari primeiro' };
  return { error: 'não achei nenhuma aba aberta no Chrome nem no Safari' };
});

/* ---------- o que manda no comportamento do Claude ----------
   Só lê e mostra: memória (CLAUDE.md), agentes, hooks e permissões. Mexer nesses arquivos
   muda o comportamento de TODOS os projetos, então isso continua sendo decisão dele. */
handle('config:claude', () => {
  const casa = path.join(HOME, '.claude');
  const ler = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };
  const lista = (d) => { try { return fs.readdirSync(d).filter(x => !x.startsWith('.')); } catch { return []; } };
  let ajustes = {};
  try { ajustes = JSON.parse(ler(path.join(casa, 'settings.json')) || '{}'); } catch {}
  const perm = ajustes.permissions || {};
  return {
    memoria: {
      global: { caminho: path.join(casa, 'CLAUDE.md'), tamanho: (ler(path.join(casa, 'CLAUDE.md')) || '').length },
      casa: { caminho: path.join(HOME, 'CLAUDE.md'), tamanho: (ler(path.join(HOME, 'CLAUDE.md')) || '').length },
    },
    agentes: lista(path.join(casa, 'agents')).map(x => x.replace(/\.md$/, '')),
    skills: lista(path.join(casa, 'skills')).length,
    hooks: Object.keys(ajustes.hooks || {}),
    permissoes: {
      liberado: (perm.allow || []).length,
      negado: (perm.deny || []).length,
      pergunta: (perm.ask || []).length,
      modo: ajustes.defaultMode || perm.defaultMode || 'padrão',
    },
    arquivoAjustes: path.join(casa, 'settings.json'),
  };
});
/* R1-046: "Abrir no Mac" chamava shell.openPath sem checar nada. O caminho que chega aqui
   pode vir de QUALQUER texto do agente (linkarArquivos autolinka caminho solto na fala, sem
   precisar de sintaxe de link) — inclusive um .command criado por conteudo externo malicioso.
   Tipo que roda codigo (extensao conhecida OU bit de execucao ligado) pergunta antes de abrir;
   o resto (imagem, pdf, pasta, doc) continua abrindo direto, sem fricção nova. */
const EXTENSOES_EXECUTAVEIS = new Set(['.command', '.app', '.pkg', '.scpt', '.workflow', '.applescript']);
async function abrirComCuidado(p) {
  let roda = false;
  try {
    const ext = path.extname(String(p || '')).toLowerCase();
    roda = EXTENSOES_EXECUTAVEIS.has(ext);
    if (!roda) { try { roda = !!(fs.statSync(p).mode & 0o111); } catch {} }
  } catch {}
  if (roda) {
    // R2-043: dialogo em try PROPRIO — antes, se ele falhasse (janela fechando no meio),
    // caia no catch de fora e abria o arquivo perigoso direto, sem aviso nenhum.
    try {
      const r = await dialog.showMessageBox(win, {
        type: 'warning',
        buttons: ['Cancelar', 'Abrir mesmo assim'],
        defaultId: 0, cancelId: 0,
        message: 'Este arquivo roda código quando aberto.',
        detail: p,
      });
      if (r.response !== 1) return '';
    } catch { return ''; }
  }
  return shell.openPath(p);
}
handle('shell:open', (_e, p) => abrirComCuidado(p));
handle('shell:link', (_e, url) => {
  if (/^https?:\/\//i.test(url)) return shell.openExternal(url);
  return abrirComCuidado(url);
});
handle('shell:openUrl', (_e, u) => {
  if (!/^https?:\/\//i.test(String(u || ''))) return { error: 'link inválido' };
  shell.openExternal(u); return { ok: true };
});

function codexSettingsFor(paneId, changes = {}) {
  const base = codexProtocol.normalizeSettings(codexPaneSettings.get(paneId) || {}, codexPendingSettings.get(paneId) || {});
  const settings = codexProtocol.normalizeSettings(base, changes);
  if (settings.cwd && ehRemoto(settings.cwd)) settings.cwd = partesRemoto(settings.cwd).caminho;
  return settings;
}
/* R2-013: no painel remoto (VPS) quem responde e' um Claude por SSH DENTRO da VPS — ele nao
   enxerga o disco do Mac. Antes, o anexo virava so' o caminho LOCAL escrito no texto, e o
   agente remoto nunca via a foto, sem nenhum erro explicando o motivo. Mesmo tratamento que
   codexProtocol.userInput ja da' pro Codex: imagem que a API do Claude aceita (formato em
   main.js:1156) vai embutida em base64; qualquer outro anexo remoto (heic da camera do
   iPhone, pdf etc.) vira erro claro no texto, nao o caminho cru que o processo remoto nao
   consegue abrir. */
const CLAUDE_IMG_MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
function claudeAttachmentContent(text, attachments, remoto) {
  const content = typeof text === 'string' ? text : '';
  const novos = (attachments || []).filter(file => file && typeof file.path === 'string' && !content.includes(file.path));
  if (!remoto) {
    const paths = novos.map(file => '- ' + file.path);
    const texto = paths.length ? content + (content ? '\n\n' : '') + 'Arquivos anexados pelo usuário:\n' + paths.join('\n') : content;
    return [{ type: 'text', text: texto }];
  }
  const blocks = [];
  const avisos = [];
  for (const file of novos) {
    const ext = path.extname(file.path).slice(1).toLowerCase();
    const mime = CLAUDE_IMG_MIME[ext];
    if (!mime) { avisos.push('- ' + path.basename(file.path) + ': este tipo de arquivo não pode ser enviado a um chat na VPS (o arquivo ficou só no Mac).'); continue; }
    try { blocks.push({ type: 'image', source: { type: 'base64', media_type: mime, data: fs.readFileSync(file.path).toString('base64') } }); }
    catch { avisos.push('- ' + path.basename(file.path) + ': não encontrei este arquivo no Mac.'); }
  }
  let texto = content;
  if (avisos.length) texto += (texto ? '\n\n' : '') + 'Anexo não pôde ser enviado à VPS:\n' + avisos.join('\n');
  if (texto) blocks.unshift({ type: 'text', text: texto });
  return blocks.length ? blocks : [{ type: 'text', text: '' }];
}
function codexThreadParams(settings, billing) {
  const policy = CODEX_MODE[settings.approval] || CODEX_MODE.bypass;
  return { cwd: settings.cwd || HOME, sandbox: policy.sandbox, approvalPolicy: policy.policy,
    // null explicito, e nao "some do objeto": o mesmo thread troca de modo por thread/resume,
    // e um campo ausente deixaria o revisor do modo anterior ligado
    approvalsReviewer: policy.reviewer || null,
    developerInstructions: instrucoesCasa(), ...(settings.model ? { model: settings.model } : {}),
    ...(billing === 'api' ? { serviceTier: 'default' } : settings.serviceTier ? { serviceTier: settings.serviceTier } : {}),
    modelProvider: billing === 'api' ? ASTRA_PROVIDER : 'openai',
    config: codexProtocol.threadConfig(settings),
  };
}
function attachCodexThread(paneId, threadId, response, settings) {
  const previous = codex.paneToThread.get(paneId);
  if (previous && previous !== threadId) codex.threadToPane.delete(previous);
  codex.threadToPane.set(threadId, paneId);
  codex.paneToThread.set(paneId, threadId);
  codexPaneIdentity.set(paneId, {});
  // Uma retomada substitui a ligação anterior, inclusive se o id da conversa for igual.
  codex.paneTurn.delete(paneId);
  codexApiCortado.delete(paneId);
  const previousMode = (codexPaneSettings.get(paneId) || {}).collaborationMode || 'default';
  codexPaneSettings.set(paneId, { ...settings, collaborationMode: previousMode });
  codexPendingSettings.set(paneId, settings);
  codexEffectiveSettings(paneId, response);
  marcarDonoDoFio(paneId, threadId, 'codex');   // esta conversa passa a ser deste painel
  emit(paneId, 'sessao', { id: threadId, file: response.thread && response.thread.path || '' });
}

/* ===================== LEVA 12 — MOTOR ACP (o terceiro motor) =====================
   ACP = Agent Client Protocol: um JSON-RPC por stdio que vários agentes de código já falam
   (Gemini CLI com "--acp", OpenCode, Qwen Code, e os adaptadores do Zed para Claude e Codex).
   Em vez de uma leva de adaptação por agente, o Cockpit fala o protocolo UMA vez e qualquer
   agente ACP entra pelo mesmo cano: basta o comando que sobe o processo.

   O protocolo e as traduções moram em acp.js (copiado sem alterar, e coberto pelos testes
   `npm run test:acp`). Aqui só o encaixe com esta tela: as aprovações e a COLA que converte
   os eventos do ACP nos eventos que o renderer já desenha — nada de cartão novo.

   AVISO HONESTO: nesta máquina não há nenhum agente ACP instalado hoje (nem gemini, nem qwen,
   nem opencode). O motor entra pronto; quando um deles for instalado, ele roda sem mais nada. */
const acpMod = require('./acp.js');
function motorAcp(engine) { return engine === 'acp' || engine === 'grok'; }
function matarGrupoExtra(proc) {
  if (!proc) return Promise.resolve();
  if (!EH_WIN && Number.isInteger(proc.pid) && proc.pid > 1) {
    try { process.kill(-proc.pid, 'SIGTERM'); } catch { try { proc.kill('SIGTERM'); } catch {} }
    /* R2-034: o timer nasce unref'd de proposito (nao pode travar o fechar de UM painel), mas
       isso deixava o SIGKILL de garantia correndo o risco de nunca disparar no fechamento
       TOTAL do app — o Electron podia sumir com o processo antes dos 1500ms. Agora devolve
       uma Promise que resolve no 'exit' (caminho feliz, rapido) OU no proprio SIGKILL (o que
       vier primeiro); shutdown() espera essa promessa antes do app.exit(). */
    return new Promise((resolve) => {
      let feito = false;
      const acabar = () => { if (feito) return; feito = true; resolve(); };
      try { proc.once('exit', acabar); } catch {}
      const timer = setTimeout(() => { try { process.kill(-proc.pid, 'SIGKILL'); } catch {} acabar(); }, 1500);
      if (timer.unref) timer.unref();
    });
  }
  matarProcesso(proc);
  return Promise.resolve();
}
const cli = require('./cli-motors').criarCli({ HOME, emit: (paneId, kind, data) => {
  if (kind === 'sessao' && data && data.id) marcarDonoDoFio(paneId, data.id, 'gemini');
  emit(paneId, kind, data);
}, spawnBin, acharBin, temBin, buildEnv: () => contasCli.ambiente('gemini'),
  pastaDados: () => app.getPath('userData'), matarGrupo: matarGrupoExtra,
  aoConfirmarConta: () => contasCli.confirmar('gemini'), aoFalharConta: () => contasCli.invalidar('gemini') });
// o titulo do Gemini sai da 1a fala, como no ACP: depois de uma troca de IA ela comeca com o
// contexto colado, e o tituloAcp rele o arquivo so nesse caso para mostrar o pedido de verdade
/* a sessao do Grok roda pelo ACP (mesmo JSONL do Cockpit): quem diz que e dele e o comando */
const ehSessaoGrok = (s) => /(?:^|[\\/])grok(?:\s|$)/.test(String((s && s.comando) || ''));
handle('sessions:cli', (_e, engine) => engine === 'gemini' ? cli.sessoes().map(s => ({ ...s, title: tituloAcp(s) }))
  : engine === 'grok' ? acp.sessoes().filter(ehSessaoGrok).map(s => ({ ...s, engine: 'grok', title: tituloAcp(s) })) : []);


/* Pedido de permissão do ACP que não vale mais: responde ao agente (senão ele fica esperando
   para sempre) e some da lista. Filtra por kind==='acp' DE PROPÓSITO — uma varredura cega
   mataria as perguntas async/elicitation que o Codex mantém vivas de propósito. */
function descartarPermissoesAcp(paneId) {
  for (const [k, a] of [...pendingApprovals]) {
    if (!a || a.paneId !== paneId || a.kind !== 'acp') continue;
    pendingApprovals.delete(k);
    try { acp.responderPermissao(a.paneId, a.rpcId, null); } catch {}
  }
}

/* o diff do ACP ({path, antes, depois}) no formato que esta tela já pinta: cartão de diff,
   botão "Desfazer esta mudança" e "voltar no tempo", tudo de graça. Teto de 40 KB, o mesmo
   do PEDACO_MAX que o Claude usa — não adianta empurrar arquivo gigante pelo cano do IPC. */
function edicaoDoAcp(m) {
  if (!m || !m.path) return null;
  return {
    arquivo: String(m.path),
    novo: m.tipo === 'write-novo',
    partes: [{ antes: corta(m.antes || ''), depois: corta(m.depois || '') }],
  };
}

/* A COLA. O acp.js fala a língua dele; esta função traduz para os eventos que o renderer já
   entende, sem inventar cartão novo nem mexer na assinatura de nada que o Claude e o Codex
   usam. Só três eventos precisam de tradução; o resto passa direto. */
function emitAcp(paneId, kind, data) {
  const d = data || {};
  if (kind === 'sessao' && d.id) marcarDonoDoFio(paneId, d.id, (paneStarts.get(paneId) || {}).engine || 'acp');
  if (kind === 'plano') {
    // o plano vivo do ACP entra no MESMO cartão do planoCodex, sem cartão novo
    const steps = (d.itens || []).map((i) => ({
      step: i.txt,
      status: i.estado === 'feito' ? 'completed' : i.estado === 'fazendo' ? 'in_progress' : 'pending',
    }));
    return emit(paneId, 'plan', { id: 'acp', steps, plan: steps });
  }
  if (kind === 'tool-start') {
    return emit(paneId, 'tool-start', { id: d.id, name: d.name, arg: d.arg, edicao: edicaoDoAcp(d.mudanca), tarefas: null });
  }
  if (kind === 'tool-mudanca') {
    // diff que só chegou DEPOIS do passo terminar: nasce como um passo próprio, senão o
    // toolStart de mesmo id trocaria o cartão que já está na tela por outro
    const ed = edicaoDoAcp(d.mudanca);
    if (!ed) return;
    return emit(paneId, 'tool-start', { id: String(d.id) + ':dif', name: 'Edit', arg: ed.arquivo, edicao: ed, tarefas: null });
  }
  return emit(paneId, kind, d);
}

const acp = acpMod.criarAcp({
  emit: emitAcp, spawnBin: (bin, args, opts) => spawnBin(acharBin(bin), args, { ...opts, detached: !EH_WIN }), buildEnv, matarProcesso: matarGrupoExtra, HOME,
  pastaDados: () => app.getPath('userData'),
  // autoLiberada de propósito omitida: o default é ()=>false, e o "sempre permitir" desta
  // tela é do Claude/Codex. Sem isto seria um segundo sistema de liberação, invisível.
  // pedido de permissão do agente vira o MESMO cartão Permitir/Negar que já existe
  aoPedirPermissao: (paneId, rpcId, info) => {
    const key = 'acp_' + paneId + '_' + rpcId;
    // guarda o MESMO payload do emit: e o que 'pane:estado' devolve pro celular reconectar sem perder o cartão
    const dadosEvento = {
      key, title: info.title || 'O agente quer usar uma ferramenta', detail: info.detail || '', reason: '',
      tool: info.tool || '', rotulo: info.rotulo || '', mudanca: edicaoDoAcp(info.mudanca),
      // o agente oferece allow_always entre as opções: é o "Sempre permitir" dele, não um segundo
      // sistema de liberação do Cockpit (a lembrança fica no agente, como no terminal dele)
      allowAlways: !!info.sempre,
    };
    pendingApprovals.set(key, { kind: 'acp', paneId, rpcId, evento: { tipo: 'approval', dados: dadosEvento } });
    emit(paneId, 'approval', dadosEvento);
  },
  aoCair: (paneId) => descartarPermissoesAcp(paneId),
  // turno acabou com pedido pendurado: mesmo caminho do 'result' do Claude
  aoFimDoTurno: (paneId) => descartarPermissoesAcp(paneId),
});

/* R1: leitura/ajuste do painel, sem nada destrutivo — vai pelo handle(), então o iPhone
   ganha de graça (o processo do agente roda sempre no Mac, seja quem for que peça). */
handle('acp:config', async (_e, { paneId, modelo } = {}) => {
  if (modelo) return acp.setModelo(paneId, modelo);
  return { error: 'nada a fazer' };
});

/* as conversas do ACP são as que o próprio Cockpit anotou (acp.js), num JSONL por sessão */
/* O título de uma conversa do ACP sai da 1a fala sua. Quando esta tela manda o contexto grudado
   na mensagem (chat sem fio, troca de motor), essa fala começa com um aviso de meia página — e o
   título virava "ATENÇÃO: esta conversa caiu…", igual em todas. O acp.js corta em 120 caracteres
   ANTES de qualquer limpeza, então o marcador "Agora, o novo pedido:" já não está no título: a
   1a fala é relida do arquivo e passada pelo MESMO semContexto que o Claude e o Codex usam.
   Só nesse caso, para não custar leitura à toa — e sem tocar uma linha do acp.js. */
const TITULO_COM_CONTEXTO = /^(ATENÇÃO: esta conversa|Estou continuando uma conversa)/;
function tituloAcp(s) {
  const bruto = String((s && s.title) || '');
  if (!s || !s.file || !TITULO_COM_CONTEXTO.test(bruto)) return bruto;
  let fd = null;
  try {
    fd = fs.openSync(s.file, 'r');
    const buf = Buffer.alloc(64 * 1024);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    for (const linha of buf.slice(0, n).toString('utf8').split('\n')) {
      if (linha[0] !== '{') continue;
      let d; try { d = JSON.parse(linha); } catch { continue; }
      if (d.role !== 'user' || !String(d.text || '').trim()) continue;
      return limparTitulo(String(d.text).replace(/\s+/g, ' ').trim()) || bruto;
    }
  } catch {} finally { if (fd != null) { try { fs.closeSync(fd); } catch {} } }
  return bruto;
}

handle('sessions:acp', () => {
  /* 25/09: a lista lateral virou uma so, e le o ACP junto com o Grok. As sessoes do Grok ja
     entram pela lista dele (engine 'grok'): aqui repetidas como 'acp', a mesma conversa
     aparecia duas vezes, uma com o logo errado. */
  try { return (acp.sessoes() || []).filter((s) => !ehSessaoGrok(s)).map((s) => ({ ...s, title: tituloAcp(s) })); }
  catch (e) { return { error: String(e && e.message || e) }; }
});

handle('pane:start', async (_e, data) => {
  const { paneId, engine, cwd, model, approval, resumeId, effort, billing } = data;
  /* Esta conversa ja esta aberta em outra tela (ou em outro chat)? Entao NAO sobe um segundo
     agente nela de cara: seriam dois mexendo no mesmo historico e na mesma pasta ao mesmo
     tempo, os dois sem pedir permissao.
     A primeira tentativa e recusada com o recado. Se ele MANDAR DE NOVO, e porque quer mesmo:
     o agente do outro lado e desligado de verdade e a conversa passa para ca. Avisar uma vez e
     obedecer na segunda evita o outro extremo — ficar preso sem conseguir escrever, que e o que
     aconteceria quando o dono fosse um processo esquecido de uma janela recarregada.
     Ramificar e a excecao, de proposito: o --fork-session abre uma conversa NOVA levando o
     historico junto, sem escrever dentro da de origem. */
  const donoAtual = data.fork ? null : outroDonoDoFio(resumeId, paneId);
  if (donoAtual && insistiuNoFio.get(paneId) !== String(resumeId)) {
    insistiuNoFio.set(paneId, String(resumeId));
    const onde = telaDoPane(donoAtual.paneId) === telaDoPane(paneId)
      ? 'em outro chat desta tela'
      : 'no ' + telaDoPane(donoAtual.paneId);
    return { jaAberta: true, onde, error: 'Esta conversa já está aberta ' + onde + '.' };
  }
  const abertura = { engine };
  paneStarts.set(paneId, abertura);
  const aberturaAtual = () => paneStarts.get(paneId) === abertura;
  try {
  if (donoAtual) {
    // ele mandou de novo: a conversa muda de dono e o agente que estava nela para de verdade
    try { await HANDLERS['pane:stop'](null, { paneId: donoAtual.paneId, engine: donoAtual.engine }); }
    catch (e) { anota('nao consegui desligar o dono anterior da conversa:', e && e.message); }
    if (!aberturaAtual()) return false;
    emit(donoAtual.paneId, 'note', { text: 'Esta conversa foi aberta ' + (telaDoPane(paneId) === 'Mac' ? 'no Mac' : 'no celular') + ' e passou para lá. Este chat parou.', error: true });
  }
  insistiuNoFio.delete(paneId);
  /* Daqui pra frente a conversa e deste painel. Se o motor nao subir, o paneVivo solta sozinho.
     No RAMO nao: la o resumeId e a conversa de ORIGEM, que continua sendo de quem a abriu —
     marcar aqui roubaria o dono dela e deixaria a de origem sem protecao nenhuma. O numero do
     ramo, que nasce novo, ganha dono quando o motor o anuncia. */
  if (!data.fork) marcarDonoDoFio(paneId, resumeId, engine);
  if (engine === 'gemini') {
    try { return cli.start(paneId, { cwd, model, approval, resumeId }); }
    catch (e) { emit(paneId, 'note', { text: e.message, error: true }); return false; }
  }
  /* leva 12.3 — painel ACP. Ramo NOVO na frente de tudo: sem engine==='acp' nada muda.
     Aqui o "model" é o COMANDO do agente (gemini --acp, npx …claude-code-acp…). */
  if (motorAcp(engine)) {
    if (ehRemoto(cwd)) { emit(paneId, 'note', { text: 'O agente ACP roda no Mac, não na VPS. Escolha uma pasta local neste chat.', error: true }); return false; }
    // cartão pendurado é do agente ANTERIOR deste painel
    descartarPermissoesAcp(paneId);
    /* quem limpa um start que falhou é o próprio acp.js, por identidade: um acp.parar(paneId)
       aqui derrubaria o SEGUNDO start (dois Enter durante o "Ligando…"). */
    try { return await acp.start(paneId, { comando: engine === 'grok' ? 'grok --no-auto-update agent stdio' : model, cwd, approval, resumeId, authMethod: engine === 'grok' ? 'cached_token' : undefined }); }
    catch (e) {
      emit(paneId, 'note', { text: 'Não consegui ligar o agente ACP: ' + String(e && e.message || e).slice(0, 300), error: true });
      return false;
    }
  }
  /* leva 10.5 — chat em worktree. Linha NOVA na FRENTE das duas de baixo, que ficaram intactas:
     sem data.worktree nada muda e o caminho continua sendo exatamente o de sempre. O fork vai
     junto porque um chat pode ser ramo E estar em worktree ao mesmo tempo. */
  if (engine === 'claude' && data.worktree) return claudeStart(paneId, { cwd, model, approval, resumeId, effort, fork: data.fork || undefined, worktree: data.worktree });
  /* ramo do Claude: mesma chamada de sempre, so com o aviso de fork junto. Linha NOVA antes da
     de baixo (que ficou intacta) — sem data.fork o caminho continua sendo exatamente o antigo. */
  if (engine === 'claude' && data.fork) return claudeStart(paneId, { cwd, model, approval, resumeId, effort, fork: true });
  if (engine === 'claude') return claudeStart(paneId, { cwd, model, approval, resumeId, effort });
  const dest = destinoDoCwd(cwd);
  const porCreditos = billing === 'api';
  if (porCreditos) {
    if (dest !== 'local') throw new Error('O Astra por créditos funciona no Mac, não na VPS.');
    await validarUsoAstra();
    if (!aberturaAtual()) return false;
    if (data.experimentalContext) throw new Error('O contexto experimental exige login ChatGPT. Use a assinatura neste chat.');
  }
  const settings = codexSettingsFor(paneId, { ...data, cwd: cwd || HOME, ...(porCreditos ? { serviceTier: 'default' } : {}) });
  codexPaneDest.set(paneId, dest);
  codexPaneBilling.set(paneId, porCreditos ? 'api' : 'plan');
  await codexStart(dest);
  if (!aberturaAtual()) return false;
  const params = codexThreadParams(settings, porCreditos ? 'api' : 'plan');
  let fioInvalido = false;
  if (resumeId) {
    try {
      const r = await codexReq(dest, 'thread/resume', { threadId: resumeId, ...params });
      if (!aberturaAtual()) return false;
      const rid = r && (r.threadId || r.thread && r.thread.id) || resumeId;
      attachCodexThread(paneId, rid, r || {}, settings);
      return true;
    } catch (e) {
      if (!aberturaAtual()) return false;
      if (!/no rollout found for thread id/i.test(String(e && e.message || e))) throw e;
      fioInvalido = true;
    }
  }
  const res = await codexReq(dest, 'thread/start', params);
  if (!aberturaAtual()) return false;
  const tid = res && (res.threadId || res.thread && res.thread.id);
  if (!tid) throw new Error('Codex não devolveu a conversa');
  attachCodexThread(paneId, tid, res, settings);
  if (fioInvalido) emit(paneId, 'note', { text: 'O número antigo era de outro motor. Abri uma conversa nova no Codex e mantive o contexto desta tela.' });
  return fioInvalido ? { ok: true, nova: true } : true;
  } finally {
    if (aberturaAtual()) paneStarts.delete(paneId);
  }
});

function codexApplySettings(paneId, changes) {
  const identidade = codexPaneIdentity.get(paneId);
  const anterior = codexSettingsQueue.get(paneId);
  const fila = { identidade, promessa: null };
  const aplicar = () => {
    if (codexPaneIdentity.get(paneId) !== identidade) throw new Error('Esta conversa foi fechada enquanto as escolhas aguardavam.');
    return codexApplySettingsAgora(paneId, changes);
  };
  fila.promessa = anterior && anterior.identidade === identidade
    ? anterior.promessa.catch(() => {}).then(aplicar) : Promise.resolve().then(aplicar);
  codexSettingsQueue.set(paneId, fila);
  const limpar = () => { if (codexSettingsQueue.get(paneId) === fila) codexSettingsQueue.delete(paneId); };
  fila.promessa.then(limpar, limpar);
  return fila.promessa;
}

async function codexApplySettingsAgora(paneId, changes) {
  const tid = codex.paneToThread.get(paneId);
  if (!tid) throw new Error('Abra uma conversa primeiro.');
  const identidade = codexPaneIdentity.get(paneId);
  const settings = codexSettingsFor(paneId, changes);
  if (changes.cwd && destinoDoCwd(changes.cwd) !== destinoDoPane(paneId)) throw new Error('Troque a pasta pelo menu para mudar entre Mac e VPS.');
  if (codexPaneBilling.get(paneId) === 'api') {
    if (settings.experimentalContext) throw new Error('O contexto experimental exige login ChatGPT. Use a assinatura neste chat.');
    settings.serviceTier = 'default';
  }
  if (codex.paneTurn.has(paneId)) {
    codexPendingSettings.set(paneId, settings);
    return { ok: true, pending: true, settings: codexPaneSettings.get(paneId) || {}, requestedSettings: settings, message: 'As escolhas entram no próximo envio.' };
  }
  // Config não é campo de turn/start: reaplicar somente a esta conversa via resume.
  const response = await codexReq(destinoDoPane(paneId), 'thread/resume', { threadId: tid, ...codexThreadParams(settings, codexPaneBilling.get(paneId)) });
  if (codex.paneToThread.get(paneId) !== tid || codexPaneIdentity.get(paneId) !== identidade) throw new Error('Esta conversa foi fechada enquanto as escolhas eram aplicadas.');
  const previousMode = (codexPaneSettings.get(paneId) || {}).collaborationMode || 'default';
  codexPaneSettings.set(paneId, { ...settings, collaborationMode: previousMode });
  codexPendingSettings.set(paneId, settings);
  const effective = codexEffectiveSettings(paneId, response || {});
  const pending = codexPendingSettings.has(paneId);
  return { ok: true, settings: effective, pending,
    ...(pending ? { requestedSettings: settings, message: 'A escolha será aplicada no próximo envio.' } : {}) };
}
handle('pane:settings', async (_e, data) => {
  if (motorAcp(data.engine) || data.engine === 'gemini') return { ok: false, error: 'Estes ajustes pertencem ao Codex.' };
  if (data.engine === 'claude') return { ok: false, error: 'Estes ajustes pertencem ao Codex.' };
  try { return await codexApplySettings(data.paneId, data); }
  catch (e) { return { ok: false, error: String(e && e.message || e) }; }
});

handle('pane:send', async (_e, data) => {
  const { paneId, engine, text, attachments = data.anexos || [] } = data;
  if (engine === 'gemini') return cli.enviar(paneId, text, attachments);
  /* leva 12.3 — o acp.enviar espera uma lista de CAMINHOS (string); aqui o anexo é objeto.
     A imagem vai como bloco do protocolo quando o agente anuncia que aceita; o resto vira
     lista de caminhos no fim do texto, feito pelo próprio acp.js. */
  if (motorAcp(engine)) return acp.enviar(paneId, text, (attachments || []).map(a => a && a.path).filter(Boolean));
  if (engine === 'claude') {
    // No Mac a interface continua usando o texto com a lista de caminhos; na VPS a foto vai
    // embutida em base64 (R2-013), porque o processo remoto nao enxerga o disco do Mac.
    const content = claudeAttachmentContent(text, attachments, ehRemoto(claudeCwd.get(paneId)));
    const foi = escreverClaude(paneId, { type: 'user', message: { role: 'user', content } });
    // marca que este painel esta no meio de um turno: e isso que o aviso de fechar a janela le
    if (foi) { const st = claudePanes.get(paneId); if (st) st.rodando = true; }
    return foi;
  }
  const tid = codex.paneToThread.get(paneId);
  if (!tid) return false;
  const identidade = codexPaneIdentity.get(paneId);
  const dest = destinoDoPane(paneId);
  const mesmoChat = () => codex.paneToThread.get(paneId) === tid && codexPaneIdentity.get(paneId) === identidade;
  if (codexPaneBilling.get(paneId) === 'api') await validarUsoAstra();
  if (!mesmoChat()) return false;
  const previous = codexPaneSettings.get(paneId) || {};
  let settings = codexSettingsFor(paneId, data);
  if (settings.experimentalContext !== previous.experimentalContext) {
    if (codex.paneTurn.has(paneId)) throw new Error('Espere o trabalho terminar para mudar o contexto.');
    const updated = await codexApplySettings(paneId, data);
    if (!mesmoChat()) return false;
    // resume pode devolver o esforço do turno anterior. O envio deve manter o
    // snapshot escolhido pelo usuário, sem confundir intenção com valor efetivo.
    settings = codexProtocol.normalizeSettings(updated.settings, settings);
  }
  if (data.cwd && destinoDoCwd(data.cwd) !== destinoDoPane(paneId)) throw new Error('Troque a pasta pelo menu para mudar entre Mac e VPS.');
  if (codexPaneBilling.get(paneId) === 'api') settings.serviceTier = 'default';
  const input = codexProtocol.userInput(text, attachments, { fs, destination: destinoDoPane(paneId) });
  const policy = CODEX_MODE[settings.approval] || CODEX_MODE.bypass;
  const revision = codexSettingsRevision.get(paneId) || 0;
  const turnRevision = codexTurnRevision.get(paneId) || 0;
  codexPendingSettings.set(paneId, settings);
  const response = await codexReq(dest, 'turn/start', { threadId: tid, input, ...codexProtocol.turnSettings(settings, policy) });
  if (!mesmoChat()) {
    // O servidor pode aceitar o envio depois do fechamento. Interromper ESTE turno,
    // sem escrever estado nem eventos no painel que já foi reutilizado.
    if (response && response.turn && response.turn.id && !['completed', 'failed', 'interrupted'].includes(response.turn.status)) {
      codexReq(dest, 'turn/interrupt', { threadId: tid, turnId: response.turn.id }).catch(() => {});
    }
    return false;
  }
  if ((codexSettingsRevision.get(paneId) || 0) === revision) {
    codexPaneSettings.set(paneId, settings);
    codexPendingSettings.delete(paneId);
    emit(paneId, 'settings', { ...settings, effective: true, pending: false });
  } else if (codexPendingSettings.has(paneId)) {
    // O servidor informou valores diferentes depois de aceitar o turno. Eles
    // vencem: não reanunciar o esforço escolhido como se tivesse sido aplicado.
    codexPendingSettings.delete(paneId);
    emit(paneId, 'settings', { ...(codexPaneSettings.get(paneId) || {}), effective: true, pending: false });
  }
  if (response && response.turn && response.turn.id && !['completed', 'failed', 'interrupted'].includes(response.turn.status) && (codexTurnRevision.get(paneId) || 0) === turnRevision) codex.paneTurn.set(paneId, response.turn.id);
  // Notificações thread/settings/updated são autoritativas; esta emissão confirma
  // que o servidor aceitou o pedido com as escolhas transmitidas.
  return true;
});

handle('pane:compactar', async (_e, { paneId, engine }) => {
  if (engine === 'gemini') return { error: 'Comece uma conversa nova no Gemini quando ela ficar longa.' };
  if (motorAcp(engine)) return { error: 'O agente ACP não tem "compactar" por aqui. Comece uma conversa nova quando ela ficar longa.' };
  if (engine === 'claude') {
    if (!escreverClaude(paneId, { type: 'user', message: { role: 'user', content: [{ type: 'text', text: '/compact' }] } })) return { error: 'sessão fora do ar' };
    return { ok: true };
  }
  const tid = codex.paneToThread.get(paneId);
  if (!tid) return { error: 'nenhuma conversa aberta' };
  try { await codexReq(destinoDoPane(paneId), 'thread/compact/start', { threadId: tid }); return { ok: true }; }
  catch (e) { return { error: String(e && e.message || e) }; }
});

handle('pane:steer', async (_e, data) => {
  const { paneId, engine, text, attachments = data.anexos || [] } = data;
  if (engine === 'gemini') return { error: 'Espere o Gemini terminar ou clique em parar.' };
  if (motorAcp(engine)) return { error: 'Neste motor não dá para falar no meio do trabalho. Espere terminar ou clique em parar.' };
  if (engine === 'claude') {
    // Mesmo tratamento remoto do pane:send (R2-013): sem isso, steerar com foto na VPS
    // mandava o caminho local do Mac, que o Claude remoto nao consegue abrir.
    const content = claudeAttachmentContent(text, attachments, ehRemoto(claudeCwd.get(paneId)));
    if (!escreverClaude(paneId, { type: 'user', message: { role: 'user', content } })) return { error: 'sessão fora do ar' };
    return { ok: true };
  }
  const tid = codex.paneToThread.get(paneId);
  const turno = codex.paneTurn.get(paneId);
  if (!tid || !turno) return { error: 'nenhum trabalho em andamento' };
  try {
    const input = codexProtocol.userInput(text, attachments, { fs, destination: destinoDoPane(paneId) });
    await codexReq(destinoDoPane(paneId), 'turn/steer', { threadId: tid, expectedTurnId: turno, input });
    return { ok: true };
  } catch (e) { return { error: String(e && e.message || e) }; }
});

handle('pane:interrupt', async (_e, { paneId, engine }) => {
  if (engine === 'gemini') { cli.parar(paneId, true); return true; }
  // o ACP tem cancelamento de verdade (session/cancel): o turno termina com stopReason
  if (motorAcp(engine)) { acp.interromper(paneId); return true; }
  if (engine === 'claude') {
    escreverClaude(paneId, { type: 'control_request', request_id: 'i' + Date.now(), request: { subtype: 'interrupt' } });
    return true;
  }
  const tid = codex.paneToThread.get(paneId);
  const turn = codex.paneTurn.get(paneId);
  if (tid && turn) { try { await codexReq(destinoDoPane(paneId), 'turn/interrupt', { threadId: tid, turnId: turn }); } catch {} }
  return true;
});

handle('pane:stop', async (_e, { paneId, engine }) => {
  paneStarts.delete(paneId);
  const delta = filaDelta.get(paneId);
  if (delta) { clearTimeout(delta.timer); filaDelta.delete(paneId); }
  soltarFio(paneId);   // parou: a conversa fica livre para a outra tela abrir
  if (engine === 'gemini') { cli.parar(paneId); return true; }
  // ramo NOVO na frente: mata o processo do agente e devolve o "cancelled" a quem esperava
  if (motorAcp(engine)) { descartarPermissoesAcp(paneId); acp.parar(paneId); return true; }
  if (engine === 'claude') claudeStop(paneId);
  else {
    const tid = codex.paneToThread.get(paneId);
    const identidade = codexPaneIdentity.get(paneId);
    const turno = codex.paneTurn.get(paneId);
    // O codex app-server e um processo so, compartilhado por todos os chats. Fechar o chat
    // apenas esquecia o apontamento: o turno continuava vivo la dentro, rodando comando e
    // editando arquivo no Mac, sem aparecer em lugar nenhum e sem jeito de parar. Aqui a
    // gente manda parar de verdade — com limite de 1,5s pra nao travar quem fechou a aba.
    if (tid && turno) {
      try {
        await Promise.race([
          codexReq(destinoDoPane(paneId), 'turn/interrupt', { threadId: tid, turnId: turno }),
          new Promise(r => setTimeout(r, 1500)),
        ]);
      } catch {}
    }
    // Outro chat pode ter ocupado o mesmo painel enquanto a interrupção aguardava.
    // Nesse caso, a limpeza antiga não pode apagar destino, escolhas ou turno novos.
    if (paneStarts.has(paneId) || codex.paneToThread.get(paneId) !== tid || codexPaneIdentity.get(paneId) !== identidade) {
      if (tid && codex.paneToThread.get(paneId) !== tid && codex.threadToPane.get(tid) === paneId) codex.threadToPane.delete(tid);
      return true;
    }
    codex.paneTurn.delete(paneId);
    codexApiCortado.delete(paneId);
    if (tid) {
      codex.threadToPane.delete(tid);
      // So apaga o apontamento se ele ainda for para ESTA conversa. Durante a espera de 1,5s
      // do turn/interrupt o painel pode ter comecado uma conversa nova (arrastar o chat, trocar
      // a pasta) — apagar aqui mataria a nova. E a mesma guarda que o Claude ja tem no close.
      if (codex.paneToThread.get(paneId) === tid) codex.paneToThread.delete(paneId);
    }
    codexPaneDest.delete(paneId);
    codexPaneIdentity.delete(paneId);
    codexPaneBilling.delete(paneId);
    codexPaneSettings.delete(paneId);
    codexPaneAgents.delete(paneId);
    codexSettingsRevision.delete(paneId);
    codexPendingSettings.delete(paneId);
    codexTurnRevision.delete(paneId);
    for (const [thread, owner] of codexAgentOwners) if (owner === paneId) codexAgentOwners.delete(thread);
    for (const [key, pending] of pendingApprovals) if (pending.paneId === paneId) pendingApprovals.delete(key);
    for (const [key, owner] of codexProcessPanes) if (owner === paneId) codexProcessPanes.delete(key);
  }
  return true;
});

handle('pane:approve', (_e, { key, allow, paneId, sempre }) => {
  const a = pendingApprovals.get(key);
  if (!a || (paneId !== undefined && a.paneId !== paneId) || typeof allow !== 'boolean') return false;
  if (sempre !== undefined && typeof sempre !== 'boolean') return false;
  /* "Sempre permitir" só vale se ESTE pedido ofereceu (allowAlways no evento que foi para a
     tela): um "sempre" que chegasse para um pedido sem essa opção vira o permitir de uma vez. */
  const ehSempre = allow && sempre === true && !!(a.evento && a.evento.dados && a.evento.dados.allowAlways);
  /* leva 12.2 — OBRIGATÓRIO: sem este ramo o clique caía no caminho do Codex, o cartão sumia
     da tela e o agente ACP ficava pendurado esperando a resposta para sempre. */
  if (a.kind === 'acp') {
    const ok = acp.responderPermissao(a.paneId, a.rpcId, allow, ehSempre) !== false;
    if (ok) pendingApprovals.delete(key);
    return ok;
  }
  if (a.kind === 'claude') {
    // "sempre": devolve as regras que o próprio Claude sugeriu (é assim que o terminal dele faz)
    const permitir = { behavior: 'allow', updatedInput: a.input };
    if (ehSempre && Array.isArray(a.sugestoes) && a.sugestoes.length) permitir.updatedPermissions = a.sugestoes;
    const sent = escreverClaude(a.paneId, {
      type: 'control_response', response: { request_id: a.reqId, subtype: 'success',
        response: allow ? permitir : { behavior: 'deny', message: 'Negado por você' } },
    });
    if (sent) pendingApprovals.delete(key);
    return sent;
  }
  try {
    const result = codexProtocol.requestResponse(a, { allow, sempre: ehSempre });
    if (!codexReply(a.destino, a.rpcId, result)) return false;
    pendingApprovals.delete(key);
    return true;
  } catch { return false; }
});

/* R2-012: o celular reconecta depois de dormir e nao repunha nem o turno que terminou
   escondido nem a aprovacao pendente. So LEITURA do estado real do Mac (nada aqui muda nada),
   pra mobile.js decidir se pode reler o historico ou reexibir a tarja sem esperar recarregar
   a pagina inteira. */
function estadoPane(paneId) {
  const st = claudePanes.get(paneId);
  // R3-010: faltava Gemini (cli) e ACP/Grok (acp) — so' Claude e Codex eram vistos,
  // e o celular reconectava achando que o turno tinha acabado
  const busy = !!(st && st.rodando) || codex.paneTurn.has(paneId) || cli.ocupado(paneId) || acp.ocupado(paneId);
  let aprovacao = null;
  for (const a of pendingApprovals.values()) {
    if (a.paneId === paneId && a.evento) { aprovacao = a.evento; break; }
  }
  return { busy, aprovacao };
}
handle('pane:estado', (_e, { paneId }) => estadoPane(paneId));

handle('pane:respond', async (_e, data) => {
  const a = pendingApprovals.get(data.key);
  if (!a || a.paneId !== data.paneId) return { error: 'Esta pergunta já foi encerrada.' };
  // guarda da leva 12.2: pedido do ACP só sai pelo Permitir/Negar; aqui embaixo é o Codex
  if (a.kind === 'acp') return { error: 'Este pedido é do agente ACP: responda em Permitir ou Negar.' };
  try {
    if (a.kind === 'async') {
      if (data.action === 'cancel') { pendingApprovals.delete(data.key); return { ok: true }; }
      const answers = codexProtocol.answersFor(a.questions, data.answers);
      const text = 'Respostas às perguntas anteriores:\n' + a.questions.map(q => q.question + '\n' + answers[q.id].answers.join(', ')).join('\n\n');
      const turnId = codex.paneTurn.get(a.paneId);
      if (turnId) await codexReq(a.destino, 'turn/steer', { threadId: a.threadId, expectedTurnId: turnId, input: [{ type: 'text', text }] });
      else {
        // Resposta humana recebida depois do turno: mensagem nova na mesma conversa.
        // Reusa o envio normal para respeitar escolhas pendentes e limite de créditos.
        const sent = await HANDLERS['pane:send'](_e, { paneId: a.paneId, engine: 'codex', text });
        if (sent === false) throw new Error('A conversa precisa ser reaberta antes de responder.');
      }
    } else {
      const response = codexProtocol.requestResponse(a, data);
      if (!codexReply(a.destino, a.rpcId, response)) throw new Error('O motor caiu. A resposta continua aqui para tentar novamente.');
    }
    pendingApprovals.delete(data.key);
    emit(a.paneId, 'question-resolved', { key: data.key });
    return { ok: true };
  } catch (e) { return { error: String(e && e.message || e) }; }
});

handle('codex:models', async () => {
  try {
    await codexStart();
    const r = await codexReq('local', 'model/list', {});
    const arr = (r && (r.data || r.models || r)) || [];
    return arr.filter(m => !m.hidden).map(m => ({
      id: m.id || m.model,
      nome: m.displayName || m.id,
      desc: m.description || '',
      efforts: (m.supportedReasoningEfforts || []).map(e => ({ id: e.reasoningEffort, desc: e.description || '' })),
      padraoEffort: m.defaultReasoningEffort || 'medium',
      padrao: !!m.isDefault,
      serviceTiers: m.serviceTiers || (m.additionalSpeedTiers || []).map(id => ({ id: id === 'fast' ? 'priority' : id, name: id, description: '' })),
      defaultServiceTier: m.defaultServiceTier || 'default',
      inputModalities: m.inputModalities || ['text', 'image'],
      multiAgentVersion: m.multiAgentVersion || null,
    }));
  } catch { return []; }
});

/* Apps do ChatGPT (os conectores da CONTA, nao os MCP daqui do Mac).
   Duas chamadas: app/list diz o que existe na conta e app/installed diz o que ja esta ligado
   nesta maquina. A conta pode nao ter direito a isso — o app-server responde 403 — e nesse
   caso a tela mostra o recado em vez de ficar vazia. So o destino local: a conta da VPS e
   outra, e o "ligado nesta maquina" de la nao diz nada sobre este Mac. */
handle('codex:apps', async () => {
  try { await codexStart('local'); }
  catch (e) { return { error: 'O Codex não está no ar: ' + String((e && e.message) || e).slice(0, 160) }; }
  const [lista, instalados] = await Promise.all([
    codexReq('local', 'app/list', {}, 20000).catch((e) => ({ __erro: String((e && e.message) || e) })),
    codexReq('local', 'app/installed', {}, 20000).catch((e) => ({ __erro: String((e && e.message) || e) })),
  ]);
  /* o 403 do catalogo vem com uma pagina HTML inteira do Cloudflare junto: jogar isso na tela
     nao ajuda ninguem. Corta na primeira tag — mas se a mensagem COMECAR com "<" nao sobraria
     texto nenhum, e ai o recado sumia e a tela dizia "nenhum App", que e' mentira. */
  const limpa = (t) => {
    const cru = String(t || '').trim();
    const semTag = cru.split('<')[0].trim();
    return (semTag || cru.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() || 'o Codex recusou o pedido').slice(0, 160);
  };
  /* o "sem acesso" tem de ser procurado no texto INTEIRO: cortado em 160 caracteres, o "403"
     da pagina do Cloudflare fica de fora e o recado amigavel virava sopa de HTML picotado */
  const semAcesso = (t) => /\b403\b|forbidden|not permitted|unauthorized/i.test(String(t || ''));
  const falhouLista = !!(lista && lista.__erro);
  const falhouInst = !!(instalados && instalados.__erro);
  const erroLista = falhouLista ? limpa(lista.__erro) : '';
  const erroInst = falhouInst ? limpa(instalados.__erro) : '';
  const apps = codexProtocol.mergeApps(falhouLista ? null : lista, falhouInst ? null : instalados);
  /* so' e' ERRO quando as DUAS falharam. Catalogo vazio com o installed fora do ar nao e'
     "nao consegui ler": e' que nao ha App nenhum mesmo. */
  if (!apps.length && falhouLista && falhouInst) {
    return { error: (semAcesso(lista.__erro) || semAcesso(instalados.__erro))
      ? 'Sua conta do ChatGPT ainda não libera a lista de Apps por aqui.'
      : ('Não consegui ler os Apps: ' + (erroLista || erroInst)) };
  }
  /* deu pra listar mesmo com uma das duas fora do ar. Mostra o que da' e diz qual metade esta
     faltando — senao a tela mente sem avisar. */
  const aviso = erroLista ? 'Só consegui ver o que já está instalado neste Mac.'
    : erroInst ? 'Não consegui ver quais já estão ligados aqui: o estado pode estar desatualizado.'
    : '';
  return { apps, aviso };
});

/* ===================== LEVA 10 — TORRE, GIT E RADAR DE VERSAO =====================
   Tres leituras, nenhuma delas destrutiva: quem esta trabalhando agora nesta maquina, o que
   mudou na pasta do chat, e se algum motor ficou para tras. Todas entram por handle() de
   proposito — sao LEITURA, e o iPhone roda o mesmo app.js, entao ele ganha as tres de graca
   sem nenhum poder novo (o telefone ja alcanca fs:read, arquivo:ver e term:run). */

/* ---- 10.1: sessoes do Claude vivas nesta maquina, dentro OU fora do Cockpit ----
   (VS Code, Terminal, robo agendado). SEMPRE pelo CLAUDE_BIN: no shell do dono a palavra
   "claude" e um APELIDO de ssh para a VPS, entao chamar pelo nome abriria uma conexao remota
   em vez de listar coisa nenhuma. Cache curto porque a Torre repinta de 4 em 4 segundos e o
   comando leva quase 1s. */
let cacheAgentes = { quando: 0, itens: [] };
handle('agentes:claude', async () => {
  if (Date.now() - cacheAgentes.quando < 15000) return { itens: cacheAgentes.itens };
  try {
    const r = await rodar(CLAUDE_BIN, ['agents', '--json'], 20000);
    /* rodar() nunca rejeita: falha e estouro de tempo chegam como {err} com saida vazia. Isso
       NAO pode virar "nenhuma sessao" nem apagar a lista boa de antes — a tela mentiria dizendo
       que nada esta rodando bem na hora em que o comando falhou. */
    if (r.err && !String(r.out || '').trim()) throw (r.err instanceof Error ? r.err : new Error(String(r.err)));
    const arr = JSON.parse(String(r.out || '').trim() || '[]');
    const itens = (Array.isArray(arr) ? arr : []).map((a) => ({
      pid: a.pid, cwd: String((a && a.cwd) || ''), kind: String((a && a.kind) || ''),
      startedAt: Number(a && a.startedAt) || 0,
      sessionId: String((a && a.sessionId) || ''), name: String((a && a.name) || ''),
    }));
    cacheAgentes = { quando: Date.now(), itens };
    return { itens };
  } catch (e) {
    return { itens: cacheAgentes.itens, velho: cacheAgentes.itens.length > 0, error: String((e && e.message) || e).slice(0, 200) };
  }
});

/* ---- 10.3: branch e arquivos mexidos da pasta do chat ----
   R7: pasta na VPS sai NULO. O git roda no Mac; apontar o -C para "vps:/opt/..." abriria um
   caminho que nao existe aqui e o chip mostraria a branch errada (ou nenhuma) sem avisar. */
/* O git CITA o caminho (formato do C, igual ao do JSON) sempre que ele tem espaco, aspas ou
   barra invertida — e o core.quotePath=false so resolve ACENTO, nao espaco. Sem desfazer as
   aspas aqui o nome sai com aspas na lista e o "git diff -- '\"a b.txt\"'" devolve VAZIO: o
   arquivo nunca abriria. Devolve '' quando NAO e um caminho citado inteiro, para o chamador
   conseguir distinguir "R antigo -> novo" de um nome que por acaso tem " -> " dentro. */
const gitCitado = (s) => {
  const t = String(s || '');
  if (t.length < 2 || t[0] !== '"' || t[t.length - 1] !== '"') return '';
  try { const v = JSON.parse(t); return typeof v === 'string' ? v : ''; } catch { return ''; }
};
handle('git:status', async (_e, o) => {
  const cwd = o && o.cwd;
  if (!cwd || ehRemoto(cwd)) return null;
  try { if (!fs.statSync(cwd).isDirectory()) return null; } catch { return null; }
  // -C sobe sozinho ate a raiz do repositorio: subpasta de projeto tambem mostra a branch
  const r = await rodar('git', ['-C', cwd, '-c', 'core.quotePath=false', 'status', '--porcelain=v1', '-b'], 8000);
  if (r.err) return null;                       // pasta fora de repositorio: sem chip, sem recado
  const linhas = String(r.out || '').split('\n').filter(Boolean);
  let branch = '';
  const arquivos = [];
  for (const l of linhas) {
    // repositorio recem-criado responde "## No commits yet on main": sem esta linha o chip
    // do cabecalho escreveria "No" no lugar do nome da branch
    if (l.startsWith('## No commits yet on ')) { branch = l.slice(21).split('...')[0].split(' ')[0]; continue; }
    if (l.startsWith('## ')) { branch = l.slice(3).split('...')[0].split(' ')[0]; continue; }
    const estado = l.slice(0, 2).trim();
    let nome = l.slice(3).trim();
    // caminho unico entre aspas (inclusive um chamado literalmente "a -> b.txt")
    const inteiro = gitCitado(nome);
    // nome ANTIGO citado (porque tem espaco) pode ter ' -> ' DENTRO das aspas: procurar a
    // seta na string inteira acha essa primeiro e corta o nome no meio (bug real, git 2.54).
    // Por isso: se comeca com aspas, pula o nome citado inteiro antes de procurar a seta.
    const citado = nome[0] === '"' ? nome.match(/^"(?:[^"\\]|\\.)*"/) : null;
    const restoBusca = citado ? nome.slice(citado[0].length) : nome;
    // arquivo renomeado vem como "antigo -> novo": quem interessa e o novo
    const seta = restoBusca.indexOf(' -> ');
    if (seta >= 0) nome = restoBusca.slice(seta + 4);
    // tira as aspas do git: o nome inteiro citado ganha da seta; senao, tira do lado que sobrou
    nome = inteiro || gitCitado(nome) || nome;
    if (nome) arquivos.push({ estado, nome });
  }
  return { branch, arquivos };
});

/* O diff de UM arquivo. Tenta primeiro o que ainda nao entrou no commit; se nao houver nada
   ali (arquivo ja adicionado com "git add"), tenta o que esta em espera. Teto de 120 mil
   letras para um arquivo gigante nao travar a tela. */
handle('git:diff', async (_e, o) => {
  const cwd = o && o.cwd, arquivo = o && o.arquivo;
  if (!cwd || !arquivo || ehRemoto(cwd)) return '';
  const r = await rodar('git', ['-C', cwd, 'diff', '--no-color', '--', arquivo], 10000);
  const texto = String((r && r.out) || '');
  if (r.err || !texto.trim()) {
    const r2 = await rodar('git', ['-C', cwd, 'diff', '--no-color', '--cached', '--', arquivo], 10000);
    return r2.err ? (r.err ? '' : texto.slice(0, 120000)) : String(r2.out || '').slice(0, 120000);
  }
  return texto.slice(0, 120000);
});

/* ---- 12.5: quais motores existem NESTA maquina ----
   A tela usa isto pra nao oferecer um motor que nao esta instalado — e pra explicar como
   instalar, em vez de deixar o painel falhar depois que ele ja mandou a mensagem.
   R6: acharBin devolve o nome quando nao acha; quem responde "existe?" e o temBin. */
handle('motores:disponiveis', () => ({
  claude: fs.existsSync(CLAUDE_BIN) || temBin('claude'),
  codex: temBin('codex'),
  gemini: temBin('agy') || temBin('gemini'), grok: temBin('grok'),
  // o comando do agente ACP e configuravel: "disponivel" = ha com que rodar o preset padrao
  // (gemini) ou com que baixar um adaptador (npx)
  acp: ['gemini', 'npx', 'opencode', 'qwen'].some((b) => temBin(b)),
  // e QUAL deles existe: sem isto a tela ofereceria o Gemini numa maquina que so tem o npx,
  // e o painel so falharia depois que ele ja tivesse escrito a mensagem
  acpBins: { gemini: temBin('gemini'), npx: temBin('npx'), opencode: temBin('opencode'), qwen: temBin('qwen') },
}));

/* ---- 10.6: versao instalada x ultima publicada de cada motor ----
   Este radar existe porque o Claude ficou 13 versoes para tras sem ninguem perceber.
   O que fica em cache e SO a pergunta ao npm (ela custa rede e a resposta muda pouco). A
   versao INSTALADA e lida na hora, toda vez: guardada, o aviso continuaria aparecendo 20h
   depois de ele ja ter atualizado. */
const VERSOES_PATH = () => path.join(app.getPath('userData'), 'versoes-motores.json');
const NPM_DOS_MOTORES = {
  claude: '@anthropic-ai/claude-code',
  codex: '@openai/codex',
};
async function versoesDosMotores(forcarNpm) {
  const soVersao = (s) => { const m = String(s || '').match(/(\d+\.\d+\.\d+)/); return m ? m[1] : ''; };
  let npmCache = {};
  let fresco = false;
  let quandoAntigo = 0;
  /* forcarNpm: o robo de atualizacao pergunta ao npm de novo a cada volta. Sem isso ele
     herdaria o cache de 20 horas e uma versao lancada de manha so seria instalada a noite. */
  if (!forcarNpm) try {
    const c = JSON.parse(fs.readFileSync(VERSOES_PATH(), 'utf8'));
    if (c && c.quando && (Date.now() - c.quando) < 20 * 60 * 60 * 1000) { npmCache = c.npm || {}; fresco = true; quandoAntigo = c.quando; }
  } catch {}
  const dados = {};
  const npmNovo = { ...npmCache };
  for (const eng of Object.keys(NPM_DOS_MOTORES)) {
    // o Claude tem caminho proprio (a copia congelada); o Codex e procurado no PATH.
    // R6: acharBin devolve o nome quando nao acha, entao quem responde "existe?" e o temBin.
    const bin = eng === 'claude' ? CLAUDE_BIN : eng;
    if (eng === 'claude') { if (!fs.existsSync(CLAUDE_BIN) && !temBin('claude')) continue; }
    else if (!temBin(bin)) continue;             // motor que nao esta na maquina nao entra
    const instalada = soVersao(await rodar(bin, ['--version'], 15000).then((r) => r.out + ' ' + r.errout).catch(() => ''));
    if (!instalada) continue;
    if (!fresco || !npmNovo[eng]) {
      npmNovo[eng] = soVersao(await rodar('npm', ['view', NPM_DOS_MOTORES[eng], 'version'], 20000).then((r) => r.out).catch(() => '')) || npmNovo[eng] || '';
    }
    dados[eng] = { instalada, ultima: npmNovo[eng] || '' };
  }
  /* So grava quando conseguiu falar com o npm: guardar vazio calaria o radar por 20 horas.
     Com o cache ainda valido a DATA nao se renova — senao, abrir o app de hora em hora
     empurraria a validade para sempre e o npm nunca mais seria consultado. */
  if (Object.values(npmNovo).some(Boolean)) {
    try { gravarSeguro(VERSOES_PATH(), JSON.stringify({ quando: (fresco && quandoAntigo) || Date.now(), npm: npmNovo })); } catch {}
  }
  return dados;
}
handle('motores:versoes', versoesDosMotores);

/* ---- 12.9: o Cockpit atualiza os motores SOZINHO ----
   O radar de cima so avisava, e o aviso morria na tela: o Claude ficou 13 versoes para tras
   justamente porque ninguem larga o trabalho para ir ao Terminal. Agora o proprio Cockpit
   roda a atualizacao e refaz a copia congelada na hora.

   Por que nenhum chat aberto cai: usarClaudeDeCaminhoFixo troca o arquivo por rename, que no
   Unix e atomico — quem ja esta rodando continua no arquivo antigo ate terminar, e o proximo
   chat ja nasce na versao nova. Fechar e abrir o Cockpit deixou de ser necessario. */
const COMO_ATUALIZA_MOTOR = {
  claude: () => {
    const bin = path.join(HOME, '.local/bin/claude');
    // o instalador nativo se atualiza com "claude update"; quem instalou pelo npm nao tem esse caminho
    return fs.existsSync(bin) ? { bin, args: ['update'] } : { bin: 'npm', args: ['i', '-g', NPM_DOS_MOTORES.claude] };
  },
  codex: () => ({ bin: 'npm', args: ['i', '-g', NPM_DOS_MOTORES.codex] }),
};
const versaoAtras = (instalada, ultima) => {
  const a = String(instalada || '').split('.').map(Number), b = String(ultima || '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((b[i] || 0) > (a[i] || 0)) return true;
    if ((b[i] || 0) < (a[i] || 0)) return false;
  }
  return false;
};
let atualizandoMotores = false;
async function atualizarMotoresSozinho(motivo) {
  if (EH_WIN || atualizandoMotores) return;
  // desligavel: basta gravar "autoAtualizarMotores": false no config.json
  try { if (loadConfig().autoAtualizarMotores === false) return; } catch {}
  atualizandoMotores = true;
  try {
    let vs = null;
    try { vs = await versoesDosMotores(true); } catch { return; }
    if (!vs) return;
    for (const eng of Object.keys(vs)) {
      const v = vs[eng] || {};
      if (!v.instalada || !v.ultima || !versaoAtras(v.instalada, v.ultima)) continue;
      const rec = COMO_ATUALIZA_MOTOR[eng]; if (!rec) continue;
      const { bin, args } = rec();
      anota('atualizando ' + eng + ' sozinho (' + (motivo || '') + '):', v.instalada, '->', v.ultima);
      const r = await rodar(bin, args, 15 * 60 * 1000);   // npm em rede ruim passa fácil de 1 minuto
      if (r && r.err) { anota('falhou ao atualizar ' + eng, r.err.message, String(r.errout || '').slice(-400)); continue; }
      /* Confere na fonte em vez de acreditar no comando: "update" as vezes sai com codigo 0
         sem ter trocado nada (sem rede, sem permissao de escrita na pasta da versao). */
      if (eng === 'claude') await usarClaudeDeCaminhoFixoAsync();   // R2-031: async aqui, nao trava os paineis
      const binLer = eng === 'claude' ? CLAUDE_BIN : eng;
      const lida = await rodar(binLer, ['--version'], 15000).then((x) => String(x.out + ' ' + x.errout).match(/(\d+\.\d+\.\d+)/)).catch(() => null);
      const agora = lida ? lida[1] : '';
      if (!agora || agora === v.instalada) { anota('rodei a atualizacao de ' + eng + ' mas a versao nao mudou', v.instalada, agora); continue; }
      anota('atualizei ' + eng, v.instalada, '->', agora);
      try {
        if (win && !win.isDestroyed()) win.webContents.send('motores:atualizado', { engine: eng, de: v.instalada, para: agora });
      } catch {}
    }
  } finally { atualizandoMotores = false; }
}


/* ===================== LEVA 11 — ROTINAS: os robôs agendados deste Mac =====================
   As automações que rodam sozinhas nesta máquina (espelho da VPS, radar do painel, coletor do
   WhatsApp, vigia financeiro...). O buraco que isto tapa é o SILÊNCIO: quando uma para, ninguém
   fica sabendo. Por isso o que vale aqui é a FALHA, traduzida em português.

   NÃO é o port do fork do Hugo: lá isto é PowerShell + Agendador do Windows, e no Mac quem
   manda é o launchd. Backend escrito do zero, com as regras que os dados reais desta máquina
   exigiram (551 jobs carregados, 37 plists dele, 190 "falhas" aparentes que na verdade eram 2).

   Fontes, e por que cada uma:
   - UM `launchctl list`: dá PID e Status (o código de saída da ÚLTIMA execução) de tudo.
   - `~/Library/LaunchAgents/*.plist`: o que a lista não tem — horário, KeepAlive, log. Filtra
     SÓ `.plist`: a pasta tem dezenas de arquivos renomeados de propósito (`.disabled`,
     `.parado-17ago`, `.foi-pra-vps`) que NÃO devem virar rotina na tela.
   - `launchctl print-disabled`: a única fonte de "desativada". Ele lista os `enabled` junto, por
     isso o que importa é o VALOR depois do `=>`, não o nome estar na lista.
   - `launchctl print` de cada rotina DELE: o `runs` (quantas vezes já rodou). É o relógio que o
     launchd não tem — ver esse número mudar é como sabemos QUANDO ela rodou.

   As duas regras que separam vermelho de verde (sem elas 188 jobs da Apple ficam vermelhos):
   - Status POSITIVO (1..255) é código de erro. Status NEGATIVO é SINAL: -9 e -15 são parada
     normal (o Mac desligou o serviço), e só -4/-6/-8/-11 são quebra de verdade.
   - RESIDENTE (KeepAlive) x AGENDADA. Para a residente, "sem PID" É a falha — ela devia estar
     de pé agora. Para a agendada, estar sem PID é o normal, e PID presente manda no código
     velho: quem está trabalhando neste instante não pode sair como quebrada. */
const ROTINAS_RUNS_PATH = () => path.join(app.getPath('userData'), 'rotinas-runs.json');
const ROT_UID = () => String(typeof process.getuid === 'function' ? process.getuid() : 501);
// R1 do disparo e do print: label vem da tela, e vira caminho de domínio do launchctl
const ROT_LABEL_OK = /^[A-Za-z0-9._-]{1,200}$/;
const ROT_PREFIXOS = ['com.homero.', 'com.homeromotti.', 'com.adsure.'];
const ROT_SINAL_QUEBRA = new Set([-4, -6, -8, -11]);   // ILL, ABRT, FPE, SEGV
const ROT_CODIGOS = {
  1: 'o programa terminou com erro',
  2: 'erro de uso do comando',
  64: 'argumentos errados',
  65: 'os dados de entrada estavam errados',
  66: 'não achou um arquivo de que precisava',
  69: 'um serviço de que ela depende não respondeu',
  70: 'erro dentro do próprio programa',
  71: 'erro do sistema',
  72: 'faltou um arquivo do sistema',
  73: 'não conseguiu criar um arquivo',
  74: 'erro de leitura ou gravação',
  75: 'falhou por enquanto (pode voltar sozinha)',
  77: 'sem permissão',
  78: 'erro de configuração',
  126: 'o arquivo existe mas não é executável',
  127: 'não achou o programa (caminho errado ou PATH)',
  137: 'foi morta à força (falta de memória, normalmente)',
};
/* Lista-negra do disparo. Não é conservadorismo: cada uma destas derruba algo que está sendo
   usado NESTE instante.
   - com.adsure.cockpit é `open -a Cockpit.app`: dispará-la relança o próprio app por cima e
     mata a sessão de quem clicou. A segunda linha pega qualquer outra rotina que aponte para o
     Cockpit.app, venha ela com o nome que vier.
   - wa-ponte é o motor de WhatsApp de TODOS os robôs; executor-mac executa tarefa remota;
     tailscaled é a rede que segura o acesso à VPS.
   - com.adsure.cockpit SEM âncora de propósito: o macOS registra o app ABERTO como um job do
     runningboard chamado `application.com.adsure.cockpit.<números>`, que a versão ancorada
     deixava passar (e para esse label não existe plist nenhum, então a segunda trava também
     não pegava). Sem âncora ele cobre os três: o job do launchd, o app rodando agora e o
     com.adsure.cockpit-push, o robô que commita e dá push sozinho.
   - `application.*` é todo programa que o dono está com ABERTO agora (Chrome, Notes, Obsidian,
     WhatsApp, Terminal). Não é rotina: é app em uso. rotEhDele já trata esse prefixo como
     "não é dele". */
const ROT_NAO_DISPARAR = [/com\.adsure\.cockpit/, /^application\./, /wa-ponte/, /executor-mac/, /tailscaled/];

const ROT_SEP_DES = '===COCKPIT-ROT-DESLIGADOS===';
const ROT_SEP_PL = '===COCKPIT-ROT-PLISTS===';
const ROT_SEP_PS = '===COCKPIT-ROT-PS===';
const ROT_SEP_JOBS = '===COCKPIT-ROT-JOBS===';
const ROT_SEP_ITEM = '===COCKPIT-ROT-ITEM===';

/* Tudo o que não depende de nome nenhum sai num spawn só: num Mac de 16 GB, um processo por
   rotina (são centenas) seria o próprio app virando o problema que veio medir. */
const ROT_SH_LISTA = [
  '/bin/launchctl list 2>/dev/null',
  'echo "' + ROT_SEP_DES + '"',
  '/bin/launchctl print-disabled "gui/$(id -u)" 2>/dev/null',
  'echo "' + ROT_SEP_PL + '"',
  'for f in "$HOME"/Library/LaunchAgents/*.plist; do',
  '  [ -f "$f" ] || continue',
  '  echo "' + ROT_SEP_ITEM + ' $f"',
  '  /usr/bin/plutil -convert json -o - -- "$f" 2>/dev/null',
  '  echo',
  'done',
  'exit 0',
].join('\n');
/* Segundo spawn: os labels entram por ARGUMENTO ("$@"), nunca colados dentro do texto do
   script — é o que impede um nome de rotina de virar outro comando. */
const ROT_SH_DETALHE = [
  'u="$1"; pids="$2"; shift 2',
  'if [ -n "$pids" ]; then echo "' + ROT_SEP_PS + '"; /bin/ps -o pid=,etime= -p "$pids" 2>/dev/null; fi',
  'echo "' + ROT_SEP_JOBS + '"',
  'for l in "$@"; do',
  '  echo "' + ROT_SEP_ITEM + ' $l"',
  '  /bin/launchctl print "gui/$u/$l" 2>/dev/null',
  'done',
  'exit 0',
].join('\n');

const rotPartir = (txt, sep) => { const i = txt.indexOf(sep); return i < 0 ? [txt, ''] : [txt.slice(0, i), txt.slice(i + sep.length)]; };
const rotNum = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/* De quem é a rotina: dele ou do computador?
   Prefixo do label resolve as dele. As outras só entram se o programa morar numa pasta DELE —
   e ~/Library é a pasta que os PROGRAMAS instalados usam (Google, Zoom), não ele. Medido: sem
   este corte, GoogleUpdater e syncthing apareciam como rotina dele. */
function rotEhDele(label, p) {
  if (/^com\.apple\./.test(label) || /^application\./.test(label)) return false;
  if (ROT_PREFIXOS.some((x) => label.startsWith(x))) return true;
  if (!p) return false;
  const caminhos = [].concat(p.Program || [], Array.isArray(p.ProgramArguments) ? p.ProgramArguments : []);
  return caminhos.some((c) => typeof c === 'string' && c.startsWith(HOME + '/') && !c.startsWith(HOME + '/Library/'));
}

/* A próxima hora marcada, calculada do StartCalendarInterval — o launchd não conta pra ninguém
   quando vai rodar de novo. O dicionário pode vir SOZINHO ou dentro de uma LISTA (várias horas
   no dia), chave que falta é curinga ("todo dia", "toda hora"), e Weekday 0 e 7 são o MESMO
   domingo. Varre dia a dia porque o mês e o dia da semana podem não casar por semanas. */
function rotProximaDe(d, agora) {
  if (!d || typeof d !== 'object') return null;
  const mi = rotNum(d.Minute), ho = rotNum(d.Hour), di = rotNum(d.Day), se = rotNum(d.Weekday), me = rotNum(d.Month);
  const horas = ho === null ? Array.from({ length: 24 }, (_, k) => k) : [ho];
  const minutos = mi === null ? Array.from({ length: 60 }, (_, k) => k) : [mi];
  for (let i = 0; i <= 400; i++) {
    const base = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() + i);
    if (me !== null && base.getMonth() + 1 !== me) continue;
    if (di !== null && base.getDate() !== di) continue;
    if (se !== null && (((se % 7) + 7) % 7) !== base.getDay()) continue;
    for (const h of horas) for (const m of minutos) {
      const t = new Date(base.getFullYear(), base.getMonth(), base.getDate(), h, m, 0, 0);
      if (t.getTime() > agora.getTime()) return t;
    }
  }
  return null;
}
function rotProxima(p) {
  const cal = p && p.StartCalendarInterval;
  if (!cal) return '';
  const agora = new Date();
  const lista = Array.isArray(cal) ? cal : [cal];
  let melhor = null;
  for (const d of lista) { const t = rotProximaDe(d, agora); if (t && (!melhor || t < melhor)) melhor = t; }
  return melhor ? melhor.toISOString() : '';
}
/* Rotina de intervalo (StartInterval) não tem "hora marcada", tem ritmo. E a que só reage a
   arquivo (WatchPaths) não tem nem ritmo: dizer "sem próxima marcada" nas duas seria contar
   como defeito o jeito normal delas funcionarem. */
function rotCadencia(p) {
  const s = rotNum(p && p.StartInterval);
  if (s !== null && s > 0) {
    if (s < 60) return 'a cada ' + s + 's';
    if (s < 3600) return 'a cada ' + Math.round(s / 60) + ' min';
    if (s < 86400) return 'a cada ' + String(Math.round(s / 360) / 10).replace('.', ',') + 'h';
    return 'a cada ' + String(Math.round(s / 8640) / 10).replace('.', ',') + ' dias';
  }
  if (Array.isArray(p && p.WatchPaths) && p.WatchPaths.length) return 'quando um arquivo mudar';
  if (Array.isArray(p && p.QueueDirectories) && p.QueueDirectories.length) return 'quando chegar arquivo na pasta';
  if (p && p.KeepAlive) return 'fica ligada o tempo todo';
  if (p && p.RunAtLoad) return 'quando o Mac liga';
  return '';
}
// o log só serve de relógio quando tem CONTEÚDO: arquivo de 0 byte guarda a data em que foi
// criado, e isso mentiria sobre robô que roda de minuto em minuto sem nunca escrever nada
function rotDataDoLog(p) {
  let melhor = 0;
  for (const k of ['StandardOutPath', 'StandardErrorPath']) {
    const f = p && p[k];
    if (!f || typeof f !== 'string') continue;
    try { const st = fs.statSync(f); if (st.size > 0 && st.mtimeMs > melhor) melhor = st.mtimeMs; } catch {}
  }
  return melhor ? new Date(melhor).toISOString() : '';
}
// "02-03:24:37" (2 dias) ou "07:42:32" ou "12:03": há quanto tempo o processo está de pé
function rotInicioPeloEtime(etime) {
  const m = /^\s*(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)\s*$/.exec(String(etime || ''));
  if (!m) return '';
  const seg = Number(m[1] || 0) * 86400 + Number(m[2] || 0) * 3600 + Number(m[3]) * 60 + Number(m[4]);
  return new Date(Date.now() - seg * 1000).toISOString();
}
function rotMotivo(status, residente) {
  if (Number.isFinite(status) && status > 0) return (ROT_CODIGOS[status] || 'saiu com o código ' + status) + ' (' + status + ')';
  if (Number.isFinite(status) && ROT_SINAL_QUEBRA.has(status)) return 'o programa quebrou no meio (sinal ' + (-status) + ')';
  if (residente) return 'devia ficar sempre ligada, e não está';
  return 'motivo desconhecido';
}

let cacheRotinas = { quando: 0, itens: [] };
handle('rotinas:listar', async () => {
  if (process.platform !== 'darwin') return { itens: [], error: 'As rotinas agendadas deste Cockpit são as do launchd, que só existe no Mac.' };
  if (Date.now() - cacheRotinas.quando < 15000) return { itens: cacheRotinas.itens };
  try {
    const r1 = await rodar('/bin/sh', ['-c', ROT_SH_LISTA], 30000);
    const bruto = String(r1.out || '');
    if (!bruto.trim()) throw new Error('o launchctl não respondeu');
    const [txtLista, resto] = rotPartir(bruto, ROT_SEP_DES);
    const [txtDes, txtPl] = rotPartir(resto, ROT_SEP_PL);

    // 1) o que está CARREGADO: "PID<tab>Status<tab>Label" (o "-" quer dizer "não tem")
    const carregados = new Map();
    for (const ln of txtLista.split('\n')) {
      const m = /^(\S+)\t(\S+)\t(.+)$/.exec(ln);
      if (!m || m[3] === 'Label') continue;
      carregados.set(m[3], {
        pid: /^\d+$/.test(m[1]) ? Number(m[1]) : null,
        status: /^-?\d+$/.test(m[2]) ? Number(m[2]) : null,
      });
    }
    // 2) desativadas: o comando devolve os ligados JUNTO, então o que decide é o valor do "=>"
    const desligados = new Set();
    for (const m of txtDes.matchAll(/"([^"]+)"\s*=>\s*(\w+)/g)) if (m[2] === 'disabled') desligados.add(m[1]);
    // 3) os plists da pasta dele (só os .plist: os renomeados ficam de fora de propósito)
    const plists = new Map();
    for (const bloco of txtPl.split(ROT_SEP_ITEM)) {
      const nl = bloco.indexOf('\n');
      if (nl < 0) continue;
      const arq = bloco.slice(0, nl).trim(), json = bloco.slice(nl + 1).trim();
      if (!arq || !json) continue;
      let p = null;
      try { p = JSON.parse(json); } catch { continue; }
      if (!p || typeof p !== 'object') continue;
      const label = String(p.Label || path.basename(arq).replace(/\.plist$/, ''));
      if (label) plists.set(label, { arq, p });
    }

    // 4) monta a lista crua e separa o que é dele — só as dele merecem o segundo spawn
    const labels = new Set([...carregados.keys(), ...plists.keys()]);
    const crus = [];
    for (const label of labels) {
      if (!label || !ROT_LABEL_OK.test(label)) continue;
      const pl = plists.get(label) || null;
      const p = (pl && pl.p) || {};
      crus.push({ label, arq: (pl && pl.arq) || '', p, car: carregados.get(label) || null, dele: rotEhDele(label, pl ? p : null) });
    }
    const meus = crus.filter((c) => c.dele);
    const pids = meus.map((c) => c.car && c.car.pid).filter(Boolean);

    // 5) segundo spawn: `runs` (o relógio das rotinas dele) e há quanto tempo as vivas estão de pé
    const runsAgora = new Map(), inicios = new Map();
    if (meus.length) {
      const r2 = await rodar('/bin/sh', ['-c', ROT_SH_DETALHE, 'sh', ROT_UID(), pids.join(','), ...meus.map((c) => c.label)], 30000);
      const t2 = String(r2.out || '');
      const [, depoisPs] = rotPartir(t2, ROT_SEP_PS);
      const [txtPs, txtJobs] = rotPartir(depoisPs || t2, ROT_SEP_JOBS);
      for (const ln of String(txtPs || '').split('\n')) {
        const m = /^\s*(\d+)\s+(\S+)\s*$/.exec(ln);
        if (m) inicios.set(Number(m[1]), rotInicioPeloEtime(m[2]));
      }
      for (const bloco of String(txtJobs || '').split(ROT_SEP_ITEM)) {
        const nl = bloco.indexOf('\n');
        if (nl < 0) continue;
        const label = bloco.slice(0, nl).trim();
        const m = /^\s*runs\s*=\s*(\d+)\s*$/m.exec(bloco.slice(nl + 1));
        if (label && m) runsAgora.set(label, Number(m[1]));
      }
    }

    /* 6) a data da última execução. O launchd NÃO guarda isso. O que guardamos é o `runs`: no
       dia em que ele muda, a rotina rodou AGORA. Enquanto o app nunca viu o número mudar, a
       data do log serve de aproximação — e só quando o log tem conteúdo. mtime como fonte
       principal mentiria: o espelho-vps tem 2 871 execuções e um log de 0 byte de 14/08, e
       apareceria "morto há três semanas". */
    const memoria = (() => { try { const o = JSON.parse(fs.readFileSync(ROTINAS_RUNS_PATH(), 'utf8')); return (o && typeof o === 'object') ? o : {}; } catch { return {}; } })();
    let mudouMemoria = false;
    const agoraIso = new Date().toISOString();
    for (const [label, runs] of runsAgora) {
      const antes = memoria[label];
      if (!antes || !Number.isFinite(Number(antes.runs))) { memoria[label] = { runs, quando: '' }; mudouMemoria = true; }
      else if (Number(antes.runs) !== runs) { memoria[label] = { runs, quando: agoraIso }; mudouMemoria = true; }
    }
    if (mudouMemoria) { try { gravarSeguro(ROTINAS_RUNS_PATH(), JSON.stringify(memoria)); } catch {} }

    const itens = crus.map((c) => {
      const p = c.p, car = c.car;
      /* KeepAlive pode ser `true`, `false` OU um dicionário ({"SuccessfulExit":false}) — e o
         dicionário também é residente. `!!` acerta os três; `=== true` deixaria de fora metade
         dos serviços desta máquina. */
      const residente = !!(p && p.KeepAlive);
      // plist na pasta e ausente do launchctl list = descarregada; e o print-disabled é a fonte
      const desativada = desligados.has(c.label) || (!car && !!c.arq);
      const pid = car ? car.pid : null;
      const status = car ? car.status : null;
      const rodando = !!pid;
      let falhou = false;
      if (desativada || rodando) falhou = false;
      else if (Number.isFinite(status) && status > 0 && status <= 255) falhou = true;
      else if (Number.isFinite(status) && ROT_SINAL_QUEBRA.has(status)) falhou = true;
      else if (residente) falhou = true;
      const memo = memoria[c.label] || {};
      const ultima = rodando ? (inicios.get(pid) || memo.quando || '') : (memo.quando || rotDataDoLog(p));
      return {
        nome: c.label,
        caminho: c.arq,
        estado: rodando ? 'rodando' : desativada ? 'desativada' : 'parada',
        residente,
        ultima,
        proxima: desativada ? '' : rotProxima(p),
        cadencia: rotCadencia(p),
        motivo: falhou ? rotMotivo(status, residente) : '',
        falhou,
        dele: c.dele,
        podeDisparar: !ROT_NAO_DISPARAR.some((re) => re.test(c.label)),
      };
    }).filter((t) => t.nome);
    cacheRotinas = { quando: Date.now(), itens };
    return { itens };
  } catch (e) {
    // lista velha vale mais que tela vazia: `velho` avisa a tela que aquilo não é de agora
    return { itens: cacheRotinas.itens, velho: cacheRotinas.itens.length > 0, error: String((e && e.message) || e).slice(0, 200) };
  }
});

/* R1: ipcMain.handle DIRETO, fora do mapa HANDLERS. Disparar roda o robô DE VERDADE (manda
   e-mail, mexe em anúncio, escreve na VPS); um toque sem querer no iPhone não pode fazer isso.
   `kickstart` SEM `-k` de propósito: o `-k` mata a execução que estiver em andamento — clicar
   em "disparar" numa rotina que está no meio do trabalho a derrubaria em vez de rodá-la. */
ipcMain.handle('rotinas:disparar', async (_e, { nome } = {}) => {
  if (process.platform !== 'darwin') return { error: 'As rotinas do launchd só existem no Mac.' };
  const label = String(nome || '');
  if (!ROT_LABEL_OK.test(label)) return { error: 'nome de rotina inválido' };
  if (ROT_NAO_DISPARAR.some((re) => re.test(label))) return { error: 'esta rotina não pode ser disparada daqui: ela derrubaria algo que está em uso agora' };
  try {
    // a rotina que aponta para o próprio Cockpit fica de fora venha com o nome que vier
    const plist = path.join(HOME, 'Library/LaunchAgents', label + '.plist');
    const cru = fs.existsSync(plist) ? fs.readFileSync(plist, 'utf8') : '';
    if (/Cockpit\.app/i.test(cru)) return { error: 'esta rotina reabre o próprio Cockpit: disparar aqui mataria esta janela' };
  } catch {}
  try {
    const r = await rodar('/bin/launchctl', ['kickstart', 'gui/' + ROT_UID() + '/' + label], 30000);
    const saida = (String(r.out || '') + ' ' + String(r.errout || '')).trim();
    if (!r.err) { cacheRotinas.quando = 0; return { ok: true }; }
    const motivo = /No such process|not find|Could not find/i.test(saida) ? 'o launchd não achou essa rotina (ela pode estar desativada)'
      : /Operation not permitted|denied/i.test(saida) ? 'o Mac negou a permissão'
      : /Service is disabled/i.test(saida) ? 'a rotina está desativada: ligue-a antes'
      : saida ? saida.slice(0, 160)
      : 'o launchd não confirmou o disparo';
    return { error: motivo };
  } catch (e) { return { error: String((e && e.message) || e).slice(0, 200) }; }
});

/* ======================= menu ======================= */
function menu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' },
    { label: 'Painel', submenu: [
      { label: 'Novo chat nesta aba', accelerator: 'CmdOrCtrl+T', click: () => win && win.webContents.send('menu', 'newPane') },
      { label: 'Nova aba de projeto…', accelerator: 'CmdOrCtrl+Shift+T', click: () => win && win.webContents.send('menu', 'newTab') },
      { label: 'Fechar chat', accelerator: 'CmdOrCtrl+W', click: () => win && win.webContents.send('menu', 'closePane') },
      { label: 'Reabrir o último chat fechado', accelerator: 'CmdOrCtrl+Shift+W', click: () => win && win.webContents.send('menu', 'reabrirFechado') },
      { type: 'separator' },
      { label: 'Trocar a pasta deste chat…', accelerator: 'CmdOrCtrl+O', click: () => win && win.webContents.send('menu', 'pickFolder') },
      { label: 'Limpar a tela (a conversa continua)', accelerator: 'CmdOrCtrl+K', click: () => win && win.webContents.send('menu', 'clearPane') },
      { type: 'separator' },
      { label: 'Buscar nesta conversa', accelerator: 'CmdOrCtrl+F', click: () => win && win.webContents.send('menu', 'buscarNaConversa') },
      { label: 'Buscar conversa…', accelerator: 'CmdOrCtrl+P', click: () => win && win.webContents.send('menu', 'buscarConversa') },
      { label: 'Perguntar aos outros motores', accelerator: 'CmdOrCtrl+D', click: () => win && win.webContents.send('menu', 'perguntarAosDois') },
      { label: 'Ditar (segure para falar)', accelerator: 'CmdOrCtrl+Shift+D', click: () => win && win.webContents.send('menu', 'ditar') },
      { label: 'Desenhar um fluxo (quadro branco)', accelerator: 'CmdOrCtrl+Shift+E', click: () => win && win.webContents.send('menu', 'quadro') },
      { type: 'separator' },
      { label: 'Salvar conversa no Obsidian', accelerator: 'CmdOrCtrl+S', click: () => win && win.webContents.send('menu', 'salvarVault') },
    ]},
    /* Menu Editar proprio, em portugues. Nao pode ser { role: 'editMenu' }: no macOS o menu do
       aplicativo fica com ⌘Z, ⌘⇧Z e ⌘A antes da pagina, e os papeis prontos so sabem desfazer
       dentro de um campo de texto — o quadro branco ficaria sem desfazer, que e o atalho mais
       usado de quem desenha. Aqui os tres avisam a tela, e o renderer decide o destino
       (quadro aberto -> pilha do quadro; senao -> o campo de texto em foco, como antes). */
    { label: 'Editar', submenu: [
      { label: 'Desfazer', accelerator: 'CmdOrCtrl+Z', click: () => win && win.webContents.send('menu', 'desfazer') },
      { label: 'Refazer', accelerator: 'Shift+CmdOrCtrl+Z', click: () => win && win.webContents.send('menu', 'refazer') },
      { type: 'separator' },
      { role: 'cut', label: 'Recortar' },
      { role: 'copy', label: 'Copiar' },
      { role: 'paste', label: 'Colar' },
      { role: 'pasteAndMatchStyle', label: 'Colar sem formatacao' },
      { role: 'delete', label: 'Apagar' },
      { type: 'separator' },
      { label: 'Selecionar tudo', accelerator: 'CmdOrCtrl+A', click: () => win && win.webContents.send('menu', 'selecionarTudo') },
      // o papel pronto trazia o "Falar" do macOS junto; sem isto ele sumiria da barra
      { type: 'separator' },
      { label: 'Falar', submenu: [
        { role: 'startSpeaking', label: 'Começar a falar' },
        { role: 'stopSpeaking', label: 'Parar de falar' },
      ]},
    ]},
    { label: 'Ver', submenu: [
      { label: 'Mostrar/ocultar a coluna de conversas', accelerator: 'CmdOrCtrl+B', click: () => win && win.webContents.send('menu', 'toggleSidebar') },
      { label: 'Modo foco (só pergunta e resposta)', accelerator: 'CmdOrCtrl+Shift+F', click: () => win && win.webContents.send('menu', 'foco') },
      { type: 'separator' },
      // ele nao lembra atalho de cor: sem esta lista, metade do "o app travou" e atalho que
      // existe e ele nao sabe. Fica no menu tambem, para achar sem saber a tecla.
      { label: 'Atalhos do teclado', accelerator: 'CmdOrCtrl+/', click: () => win && win.webContents.send('menu', 'atalhos') },
      { type: 'separator' },
      { role: 'resetZoom', label: 'Zoom normal' }, { role: 'zoomIn', label: 'Aumentar' }, { role: 'zoomOut', label: 'Diminuir' },
      { type: 'separator' },
      { role: 'toggleDevTools', label: 'Ferramentas de desenvolvedor' },
      /* Recarregar saiu do ⌘R: apertar sem querer apagava o rascunho que ainda nao foi enviado
         (as abas e os chats voltam do config; o texto do campo, nao). Ferramenta de programador
         fica em ⌘⌥R, que ninguem aperta por engano. */
      { role: 'reload', label: 'Recarregar', accelerator: 'CmdOrCtrl+Alt+R' },
    ]},
    { role: 'windowMenu', label: 'Janela' },
  ]));
}

/* ---------- Cockpit no telefone ---------- */
let web = null;
/* o macOS coloca o app para dormir quando fica sem foco, e ai o telefone
   conecta mas nunca recebe resposta. Enquanto o servidor estiver ligado,
   seguramos o app acordado. */
let travaSono = null, batimento = null;
function manterAcordado(ligar) {
  try {
    if (ligar) {
      if (travaSono === null || !powerSaveBlocker.isStarted(travaSono)) {
        travaSono = powerSaveBlocker.start('prevent-app-suspension');
      }
      // um tique de nada, so para o app nunca ficar totalmente parado:
      // parado, ele demora a perceber que o telefone chamou.
      if (!batimento) batimento = setInterval(() => {}, 1000);
    } else {
      if (travaSono !== null && powerSaveBlocker.isStarted(travaSono)) {
        powerSaveBlocker.stop(travaSono);
      }
      travaSono = null;
      if (batimento) { clearInterval(batimento); batimento = null; }
    }
  } catch (e) { anota('sono:', e); }
}
function senhaDoTelefone() {
  const cfg = loadConfig();
  if (!cfg.senhaWeb || !/^([a-f0-9]{4}-){3}[a-f0-9]{4}$/i.test(cfg.senhaWeb)) {
    cfg.senhaWeb = crypto.randomBytes(8).toString('hex').match(/.{1,4}/g).join('-');
    anotarChaveDoMain('senhaWeb', cfg.senhaWeb);
    saveConfig(cfg);
  }
  return cfg.senhaWeb;
}
/* Quem atende o telefone é o Tailscale, não o Cockpit: o servidor só escuta dentro do próprio
   Mac (127.0.0.1), de propósito, e quem leva a conexão de fora até ele é o "tailscale serve".
   Esta função montava "http://IP:7788" na mão, e ninguém atende nessa porta pelo Tailscale: o
   endereço escrito nos Ajustes só girava no Safari do iPhone até dar tempo esgotado. Agora
   perguntamos ao próprio Tailscale qual endereço ele está entregando para a porta 7788. */
// R1-013/R1-047: execFileSync trava o processo principal INTEIRO ate' o tailscale responder
// (ja' registrou ETIMEDOUT de verdade no log) — nenhum IPC, nenhuma janela pinta nesse tempo.
// rodar() e' o mesmo helper assincrono usado no resto do arquivo: nao bloqueia o event loop.
async function enderecoTailscale() {
  try {
    const bin = acharBin('tailscale');
    const socket = path.join(HOME, '.tailscale', 'tailscaled.sock');
    const pre = fs.existsSync(socket) ? ['--socket=' + socket] : [];
    const r = await rodar(bin, [...pre, 'serve', 'status', '--json'], 5000);
    if (r.err) throw r.err;
    const sv = JSON.parse(r.out);
    const web = (sv && sv.Web) || {};
    for (const alvo of Object.keys(web)) {
      const hs = (web[alvo] && web[alvo].Handlers) || {};
      // só vale o destino que aponta para a NOSSA porta
      if (!Object.keys(hs).some(k => String((hs[k] && hs[k].Proxy) || '').includes(':7788'))) continue;
      const m = String(alvo).match(/^(.*):(\d+)$/);
      const host = m ? m[1] : String(alvo);
      const porta = m ? m[2] : '443';
      if (porta === '443') return 'https://' + host;
      if (porta === '80') return 'http://' + host;
      return 'http://' + host + ':' + porta;
    }
    anota('tailscale serve: nada apontando para a porta 7788');
  } catch (e) { anota('tailscale:', e.message); }
  // nada de endereço inventado: se o Tailscale não está entregando, a tela diz isso
  return 'Sem endereço: o Tailscale não está servindo a porta 7788';
}
handle('web:estado', () => ({
  ligado: !!web,
  endereco: web ? web.endereco : '',
  senha: senhaDoTelefone(),
}));
handle('web:ligar', async (_e, ligar) => {
  const cfg = loadConfig();
  if (ligar && !web) {
    try {
      const sw = require('./servidor-web.js');
      web = sw.criar({
        pastaRenderer: path.join(__dirname, 'renderer'),
        handlers: HANDLERS, ouvintes: ouvintesWeb,
        porta: 7788, senha: senhaDoTelefone(), somenteTailscale: true, endereco: await enderecoTailscale(),
      });
      // espera o servidor ESCUTAR de verdade antes de dizer que ligou: com a porta ocupada
      // a tela mostrava endereco e senha e o telefone nunca conectava
      if (web && web.pronto) await web.pronto;
      manterAcordado(true);
      /* R2-038: 'cfg' foi lido ANTES dos dois awaits acima (endereco do Tailscale, ate 5s; e o
         servidor subir). Nesse meio-tempo o renderer pode gravar config novo (painel aberto,
         aba criada) — gravar por cima de 'cfg' aqui apagaria essa gravacao concorrente e o
         numero de abas nao mudou, entao a rede de seguranca do saveConfig nao pega isso.
         Reler o disco na hora e mexer so' nos dois campos deste handler evita a corrida. */
      const fresco = loadConfig();
      fresco.webLigado = true; fresco.webSeguroConfirmado = true;
      anotarChaveDoMain('webLigado', true); anotarChaveDoMain('webSeguroConfirmado', true);
      saveConfig(fresco);
    } catch (e) {
      try { if (web) web.fechar(); } catch {}
      web = null; manterAcordado(false);
      anota('web:', e); return { error: e.message };
    }
  } else if (!ligar && web) {
    // fechar() derruba tambem os telefones ja conectados; o close() sozinho so impedia
    // conexao nova e quem estava dentro seguia com poder total sobre o Mac
    try { (web.fechar || web.servidor.close.bind(web.servidor))(); } catch {}
    web = null; manterAcordado(false); cfg.webLigado = false;
    anotarChaveDoMain('webLigado', false);
    saveConfig(cfg);
  }
  return { ligado: !!web, endereco: web ? web.endereco : '', senha: senhaDoTelefone() };
});

/* Todo print colado no chat vira arquivo em userData/colados e ficava la para sempre: 107
   arquivos e 30 MB em 20 dias, sem ninguem olhar. Depois de mandado, o print ja foi lido —
   o que passou de 7 dias sai na abertura do app. SO esta pasta: userData/quadros guarda
   desenho salvo e o rascunho.json, e nao pode ser varrida. */
function limparColadosAntigos() {
  try {
    const dir = path.join(app.getPath('userData'), 'colados');
    const limite = Date.now() - 7 * 24 * 60 * 60 * 1000;
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      try { if (fs.statSync(p).mtimeMs < limite) fs.unlinkSync(p); } catch {}
    }
  } catch {}
}

/* ===================== CAIXA DE ENTRADA (leva 6) =====================
   Tudo que cair em userData/inbox vira uma tarja no topo da tela com o botao "usar":
   .txt/.md viram texto no campo de escrever, imagem vira anexo. E o contrato para o bot
   do celular (audio ja transcrito em .txt, foto em .png/.jpg) e para qualquer script:
   escrever o arquivo la basta, nao ha API para aprender.

   A pasta MUDA de nome conforme o app: rodando por `npm start` o Electron usa o campo
   "name" do package.json (~/Library/Application Support/cockpit/inbox, minusculo) e no app
   instalado usa o productName (.../Cockpit/inbox). Por isso nenhum script pode cravar o
   caminho: quem quiser escrever aqui pergunta em `inbox:pasta`, ou olha o caminho que os
   Ajustes mostram.

   R1: os TRES handlers entram por ipcMain.handle DIRETO, fora do mapa HANDLERS. Se o
   telefone pudesse chamar `inbox:ouvindo`, a bandeira ligaria antes de a janela do Mac ter
   registrado o `onInbox`, o `varrerInbox` mandaria o aviso para o vazio e o arquivo ficaria
   marcado como visto — a mensagem se perderia para sempre. */
const PASTA_INBOX = () => path.join(app.getPath('userData'), 'inbox');
const inboxVistos = new Set();
// R3-025: bases de .txt anunciado SOZINHO (a foto ainda nao tinha chegado). Quando a
// imagem chegar depois, usa isto pra avisar o renderer a trocar a tarja em vez de duplicar.
const inboxTextoSoltoBase = new Set();
let inboxOuvinte = false;   // a tela DESTA carga ja registrou o onInbox (senao o aviso vai pro vazio)
ipcMain.handle('inbox:ouvindo', () => { inboxOuvinte = true; setTimeout(varrerInbox, 100); return { ok: true }; });
function varrerInbox() {
  // a tela ainda carregando nao ouve: anunciar agora perderia o aviso pra sempre
  if (!inboxOuvinte || !win || win.isDestroyed() || win.webContents.isLoading()) return;
  let nomes = [];
  try { nomes = fs.readdirSync(PASTA_INBOX()); } catch { return; }
  const conjunto = new Set(nomes);
  for (const n of nomes) {
    const ext = path.extname(n).toLowerCase();
    if (!['.txt', '.md', '.png', '.jpg', '.jpeg', '.webp'].includes(ext)) continue;
    const f = path.join(PASTA_INBOX(), n);
    let st; try { st = fs.statSync(f); } catch { continue; }
    const idade = Date.now() - st.mtimeMs;
    // recem-escrito (ate 700 ms, inclusive uns ms "no futuro" por relogio do disco): espera
    // assentar; mtime muito no futuro (arquivo vindo de maquina com relogio errado) nao fica
    // preso para sempre
    if (!st.isFile() || (idade > -5000 && idade < 700)) continue;
    // visto = nome + hora de escrita: um "voz.txt" regravado e mensagem NOVA
    if (inboxVistos.has(n + ':' + Math.round(st.mtimeMs))) continue;
    const base = n.slice(0, -ext.length);
    const ehImagem = ext !== '.txt' && ext !== '.md';
    // texto que e LEGENDA de uma imagem (mesmo nome-base) vai junto com ela, num aviso so
    if (!ehImagem) {
      const img = ['.png', '.jpg', '.jpeg', '.webp'].find((e) => conjunto.has(base + e));
      if (img) {
        // a legenda pode chegar DEPOIS da imagem (carteiro que baixa a foto e so entao escreve
        // o texto). Ai a imagem JA foi anunciada, sem legenda, e o texto ficaria preso neste
        // continue para sempre, calado. Tirar a imagem dos vistos faz a volta seguinte anuncia-la
        // de novo, agora COM a legenda: mesmo id, a tarja e trocada no lugar. Anunciar o texto
        // solto nao serviria — o "usar" da imagem apaga base+.txt junto, e a tarja do texto
        // apontaria para arquivo que nao existe mais.
        for (const k of [...inboxVistos]) if (k.startsWith(base + img + ':')) inboxVistos.delete(k);
        continue;
      }
      // R3-025: legenda chegou ANTES da foto (ordem inversa do comentario acima). Vai ser
      // anunciada sozinha agora; guarda a marca pra, quando a imagem chegar, trocar a
      // tarja em vez de duplicar o mesmo texto na tela.
      inboxTextoSoltoBase.add(base);
    }
    inboxVistos.add(n + ':' + Math.round(st.mtimeMs));
    let texto = '';
    if (!ehImagem) { try { texto = fs.readFileSync(f, 'utf8').trim().slice(0, 20000); } catch {} }
    let legenda = '';
    let substituiuNome = '';
    if (ehImagem) {
      for (const e of ['.txt', '.md']) {
        if (!conjunto.has(base + e)) continue;
        try { legenda = fs.readFileSync(path.join(PASTA_INBOX(), base + e), 'utf8').trim().slice(0, 4000); } catch {}
        try { inboxVistos.add(base + e + ':' + Math.round(fs.statSync(path.join(PASTA_INBOX(), base + e)).mtimeMs)); } catch {}
        // R3-025: esse .txt ja tinha sido anunciado sozinho antes da foto chegar — avisa o
        // renderer a apagar aquela tarja (senao a mesma legenda fica duas vezes na tela)
        if (inboxTextoSoltoBase.has(base)) { substituiuNome = base + e; inboxTextoSoltoBase.delete(base); }
      }
    }
    win.webContents.send('inbox', { arquivo: f, nome: n, tipo: ehImagem ? 'imagem' : 'texto', texto, legenda, quando: st.mtimeMs, ...(substituiuNome ? { substituiuNome } : {}) });
  }
  // R1-014: limpar tudo de uma vez reabria como "novo" um arquivo que ainda esta pendente
  // na pasta (o Homero nao clicou "usar"). Poda so o que ja sumiu da pasta (`conjunto`).
  if (inboxVistos.size > 500) {
    for (const k of [...inboxVistos]) if (!conjunto.has(k.slice(0, k.lastIndexOf(':')))) inboxVistos.delete(k);
    // R3-025: mesma poda pro Set irmao, senao uma base que nunca ganha imagem fica presa pra sempre
    for (const base of [...inboxTextoSoltoBase]) if (!['.txt', '.md'].some((e) => conjunto.has(base + e))) inboxTextoSoltoBase.delete(base);
  }
}
function ligarInbox() {
  try { fs.mkdirSync(PASTA_INBOX(), { recursive: true }); } catch {}
  // pasta renomeada ou apagada nao pode derrubar o main: o watch so acelera, quem garante e o relogio
  try { fs.watch(PASTA_INBOX(), () => setTimeout(varrerInbox, 800)).on('error', () => {}); } catch {}
  setInterval(varrerInbox, 3000);
  limparInboxAntiga();
  anota('caixa de entrada em', PASTA_INBOX());
}
// o que ficou 7 dias na caixa sem ninguem usar nem descartar vai embora (igual a colados/)
function limparInboxAntiga() {
  try {
    const limite = Date.now() - 7 * 24 * 60 * 60 * 1000;
    for (const n of fs.readdirSync(PASTA_INBOX())) {
      const f = path.join(PASTA_INBOX(), n);
      try { if (fs.statSync(f).mtimeMs < limite) fs.unlinkSync(f); } catch {}
    }
  } catch {}
}
// "usar": texto e consumido (some da caixa); imagem vai para colados/ e vira anexo
ipcMain.handle('inbox:consumir', (_e, { arquivo, apagar } = {}) => {
  try {
    const f = path.resolve(String(arquivo || ''));
    // tem de estar DENTRO da caixa (pasta IGUAL, nao "comeca com"): o startsWith em texto
    // deixava passar "inbox2/x" e "inbox-velha.txt"
    const raiz = path.resolve(PASTA_INBOX());
    const mesma = (a, b) => (EH_WIN ? a.toLowerCase() === b.toLowerCase() : a === b);
    if (!mesma(path.dirname(f), raiz)) return { error: 'fora da caixa de entrada' };
    const ext = path.extname(f).toLowerCase();
    // arquivo SEM extensao (README, .gitignore) tem ext = '' e f.slice(0, -0) devolve STRING
    // VAZIA: o laco de baixo apagaria './.txt' e './.md' relativos ao process.cwd(), FORA da
    // caixa. Nenhum arquivo assim e anunciado (a lista branca do varrerInbox tem 6 extensoes),
    // mas este e o unico ponto da leva que da unlink e ele e um handler IPC cru.
    if (!ext) return { error: 'arquivo sem extensão' };
    const base = f.slice(0, -ext.length);
    // legenda que veio junto da imagem some com ela
    for (const e of ['.txt', '.md']) { if (ext !== e && fs.existsSync(base + e)) { try { fs.unlinkSync(base + e); } catch {} } }
    if (apagar || ext === '.txt' || ext === '.md') { fs.unlinkSync(f); return { ok: true }; }
    const dir = path.join(app.getPath('userData'), 'colados');
    fs.mkdirSync(dir, { recursive: true });
    const destino = path.join(dir, 'celular-' + Date.now() + ext);
    fs.renameSync(f, destino);
    return { ok: true, arquivo: destino };
  } catch (e) { return { error: String((e && e.message) || e) }; }
});
ipcMain.handle('inbox:pasta', () => PASTA_INBOX());

app.whenReady().then(() => { anota('app iniciou'); usarClaudeDeCaminhoFixo(); menu(); createWindow(); vigiarPedidoDoQuadro(); montarIndiceDeFundo();
  limparColadosAntigos();
  /* Atualiza os motores sozinho: 60s depois de abrir (para nao brigar com o arranque) e de
     6 em 6 horas, para quem deixa o Cockpit aberto a semana inteira. */
  setTimeout(() => atualizarMotoresSozinho('abriu o app'), 60000);
  setInterval(() => atualizarMotoresSozinho('a cada 6h'), 6 * 60 * 60 * 1000);
  ligarInbox();   // leva 6: a caixa de entrada passa a ser varrida (a pasta nasce aqui)
  // atalho global de ditar, se ele tiver ligado nos Ajustes (desligado por padrao)
  try { ligarAtalhosGlobais(!!loadConfig().atalhosGlobais); } catch { ligarAtalhosGlobais(false); }
  try {
    const cfgInicial = loadConfig();
    // Quem já usava o iPhone não precisa caçar um novo botão após atualizar.
    // A migração só liga o servidor porque esta versão já obriga Tailscale.
    if (cfgInicial.webLigado && !Object.prototype.hasOwnProperty.call(cfgInicial, 'webSeguroConfirmado')) {
      cfgInicial.webSeguroConfirmado = true;
      saveConfig(cfgInicial);
    }
    if (cfgInicial.webLigado && cfgInicial.webSeguroConfirmado) {
      const sw = require('./servidor-web.js');
      // R1-013/R1-047: o boot nao pode virar `await` (atrasaria janela/menu/tudo que vem
      // depois neste mesmo bloco), entao sobe com um endereco provisorio e troca sozinho
      // quando o tailscale responder; a tela de Ajustes busca o estado de novo toda vez
      // que abre (web:estado), entao o valor certo aparece assim que ele olhar.
      web = sw.criar({ pastaRenderer: path.join(__dirname, 'renderer'), handlers: HANDLERS,
        ouvintes: ouvintesWeb, porta: 7788, senha: senhaDoTelefone(), somenteTailscale: true, endereco: 'Endereço: carregando…' });
      enderecoTailscale().then((end) => { if (web) web.endereco = end; }).catch((e) => anota('tailscale:', (e && e.message) || e));
      manterAcordado(true);
      // no boot nao da pra esperar; mas o erro tem de aparecer no log e o estado tem de ficar
      // honesto, senao o app acha que o telefone esta ligado e ele nunca conecta
      if (web && web.pronto) web.pronto
        .then(() => anota('telefone ligado em', web.endereco))
        .catch((e) => { anota('NAO consegui abrir para o telefone:', (e && e.message) || e); web = null; manterAcordado(false); });
      else anota('telefone ligado em', web.endereco);
    }
  } catch (e) { anota('NAO ABRIU para o telefone:', e); } setTimeout(() => codexStart().catch(() => {}), 1500); app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); }); });
app.on('window-all-closed', () => { shutdown(); if (process.platform !== 'darwin') app.quit(); });
/* R2-034: antes, shutdown() rodava sem esperar nada e o Electron seguia fechando o processo
   logo depois — o SIGKILL de garantia de matarGrupoExtra (1,5s, timer unref'd de proposito)
   podia nunca chegar a disparar, e um processo filho preso (MCP server que ignora SIGTERM)
   sobrava rodando escondido mesmo com o Cockpit fechado. Agora segura o fechamento
   (preventDefault) ate' shutdown() terminar, e so' entao sai — com app.exit(), nao
   app.quit(), que reemitiria 'before-quit' e entraria em loop. */
app.on('before-quit', (event) => {
  if (saindoDoApp) return;   // ja' estamos no meio da saida (app.exit chamando de novo)
  saindoDoApp = true;
  event.preventDefault();
  shutdown().finally(() => {
    if (web) { try { (web.fechar || web.servidor.close.bind(web.servidor))(); } catch {} }
    app.exit();
  });
});
