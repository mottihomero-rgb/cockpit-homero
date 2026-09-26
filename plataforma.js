/* Camada de plataforma do Cockpit.
 *
 * O Cockpit nasceu só para o Mac: chamava /bin/sh, /usr/bin/python3 e um PATH
 * do Homebrew direto no código. Este arquivo isola tudo que muda entre Mac e
 * Windows, para o resto do main.js não precisar saber onde está rodando.
 *
 * Três coisas mudam de verdade:
 *   1. PATH e onde moram os executáveis do Claude e do Codex;
 *   2. como se chama um executável (no Windows, .cmd não pode ser chamado direto);
 *   3. como se abre um terminal de verdade (pty): no Mac é o ptybridge.py,
 *      no Windows é o ConPTY, via node-pty (binário pronto, não compila nada).
 */
const { spawn, execFileSync, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { StringDecoder } = require('string_decoder');

const EH_WIN = process.platform === 'win32';
const HOME = os.homedir();
const SEP = EH_WIN ? ';' : ':';

/* ---------- PATH ----------
   App de janela não herda o PATH do terminal (vale nos dois sistemas), então
   montamos um PATH completo na mão com os lugares onde as ferramentas moram. */
function pastasExtras() {
  const dadosCockpit = EH_WIN ? path.join(process.env.APPDATA || path.join(HOME, 'AppData', 'Roaming'), 'cockpit')
    : process.platform === 'darwin' ? path.join(HOME, 'Library', 'Application Support', 'cockpit')
    : path.join(process.env.XDG_CONFIG_HOME || path.join(HOME, '.config'), 'cockpit');
  const ferramentasLocais = path.join(dadosCockpit, 'ferramentas', 'node_modules', '.bin');
  const ferramentasNativas = path.join(dadosCockpit, 'ferramentas', 'bin');
  if (EH_WIN) {
    const appdata = process.env.APPDATA || path.join(HOME, 'AppData', 'Roaming');
    const local = process.env.LOCALAPPDATA || path.join(HOME, 'AppData', 'Local');
    const pf = process.env.ProgramFiles || 'C:\\Program Files';
    return [
      ferramentasNativas,
      ferramentasLocais,
      path.join(HOME, '.local', 'bin'),        // instalador nativo do Claude Code
      path.join(HOME, '.codex', 'bin'),
      path.join(appdata, 'npm'),               // npm install -g
      path.join(local, 'Programs', 'nodejs'),
      path.join(local, 'nvs', 'default'),
      path.join(pf, 'nodejs'),
      path.join(HOME, 'scoop', 'shims'),
      'C:\\Windows\\System32', 'C:\\Windows',
    ];
  }
  return [
    ferramentasNativas,
    ferramentasLocais,
    path.join(HOME, '.local/bin'),
    path.join(HOME, '.nvm/versions/node/v22.23.1/bin'),
    path.join(HOME, '.codex/bin'),
    '/opt/homebrew/bin', '/opt/homebrew/sbin',
    '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin',
  ];
}

function buildEnv() {
  // no Windows a variável pode vir escrita "Path"; achamos a chave real
  const chavePath = Object.keys(process.env).find((k) => k.toLowerCase() === 'path') || 'PATH';
  const cur = (process.env[chavePath] || '').split(SEP);
  const env = { ...process.env, CLAUDE_CODE_ENTRYPOINT: 'cockpit' };
  env[chavePath] = [...new Set([...cur, ...pastasExtras()])].filter(Boolean).join(SEP);
  if (EH_WIN && chavePath !== 'PATH') env.PATH = env[chavePath];
  // variaveis do VSCode quebram processos filhos
  delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS;
  delete env.VSCODE_PID; delete env.VSCODE_IPC_HOOK_CLI; delete env.VSCODE_CWD;
  return env;
}

/* ---------- achar executável ----------
   No Mac o caminho do Claude era fixo (~/.local/bin/claude). No Windows ele pode
   estar em quatro lugares e com três extensões, então procuramos de fato. */
const cacheBin = new Map();
function executavel(p) {
  try {
    if (!fs.statSync(p).isFile()) return false;
    if (!EH_WIN) fs.accessSync(p, fs.constants.X_OK);
    return true;
  } catch { return false; }
}

function acharBin(nome) {
  // Uma instalação local feita com o app aberto deve aparecer sem reiniciar.
  if (cacheBin.has(nome) && cacheBin.get(nome) !== nome && executavel(cacheBin.get(nome))) return cacheBin.get(nome);
  if (path.isAbsolute(nome)) return nome;
  const exts = EH_WIN ? ['.exe', '.cmd', '.bat', ''] : [''];
  const pastas = [...pastasExtras(), ...((process.env.PATH || '').split(SEP))];
  let achado = null;
  for (const dir of pastas) {
    if (!dir) continue;
    for (const ext of exts) {
      const p = path.join(dir, nome + ext);
      if (executavel(p)) { achado = p; break; }
    }
    if (achado) break;
  }
  const r = achado || nome;   // não achou: deixa o sistema procurar sozinho
  cacheBin.set(nome, r);
  return r;
}

/* ---------- chamar executável ----------
   No Windows, desde o Node 20 é proibido chamar um .cmd direto por spawn (foi
   uma correção de segurança). O jeito certo é passar pelo cmd.exe com a linha
   inteira montada e escapada por nós. */
function aspas(s) { return '"' + String(s).replace(/"/g, '""') + '"'; }

function linhaWindows(bin, args) {
  return '"' + [bin, ...args].map(aspas).join(' ') + '"';
}

function spawnBin(bin, args, opts = {}) {
  const alvo = path.isAbsolute(bin) ? bin : acharBin(bin);
  if (EH_WIN && /\.(cmd|bat)$/i.test(alvo)) {
    const comspec = process.env.ComSpec || 'cmd.exe';
    return spawn(comspec, ['/d', '/s', '/c', linhaWindows(alvo, args)],
      { ...opts, windowsVerbatimArguments: true });
  }
  return spawn(alvo, args, opts);
}

/* Encerra um processo filho. No Windows, taskkill alcança a árvore enquanto
   o cmd.exe pai ainda existe. Processos POSIX com grupo próprio são encerrados
   pelo matarGrupoExtra do chamador. */
function matarProcesso(p) {
  if (!p || p.exitCode !== null || p.signalCode !== null) return;
  /* No Windows um bin instalado pelo npm e' um .cmd: o que seguramos e' o
     cmd.exe, e o programa de verdade e' neto. Com o Codex isso nao aparecia --
     e' um servidor so' e vive o app inteiro. Com Gemini/Grok e' UM PROCESSO POR
     MENSAGEM, entao cada "parar" deixaria um node vivo queimando cota.
     O taskkill precisa rodar com o pai AINDA VIVO: e' assim que ele enxerga a
     arvore. Por isso vem antes do kill, e nao depois. */
  if (EH_WIN && p.pid) {
    /* SINCRONO de proposito. Disparado por "spawn", o taskkill so' rodava uns
       50ms depois -- com o cmd.exe ja morto pelo kill de baixo, e ai o "/T" nao
       encontra mais os filhos ("processo nao encontrado"). Medido: assincrono o
       neto sobrevive; sincrono ele morre. */
    try { execFileSync('taskkill', ['/pid', String(p.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); }
    catch {}
  }
  try { p.kill(); } catch {}
}

/* "acharBin" devolve o nome cru quando nao encontra (pra deixar o sistema
   tentar pelo PATH). Isso faz o try/catch em volta dele nunca disparar -- e era
   por isso que o app dizia que um motor estava instalado quando nao estava.
   Aqui a pergunta e' outra: EXISTE mesmo? */
function temBin(nome) {
  try {
    const p = acharBin(nome);
    if (p !== nome || path.isAbsolute(p)) return executavel(p);
    // nome cru: procura no PATH do jeito do sistema
    const exts = EH_WIN ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';') : [''];
    for (const dir of String(process.env.PATH || '').split(path.delimiter)) {
      if (!dir) continue;
      for (const e of exts) {
        if (executavel(path.join(dir, nome + e))) return true;
      }
    }
    return false;
  } catch { return false; }
}

/* ---------- terminal de verdade (pty) ----------
   Interface única. Quem chama não sabe (nem precisa saber) qual dos dois motores
   está por baixo: os dois entregam dados, aceitam digitação e redimensionam. */
function abrirPty({ linha, cols, rows, cwd, env, ptyBridge }) {
  if (EH_WIN) return ptyWindows({ linha, cols, rows, cwd, env });
  return ptyMac({ linha, cols, rows, cwd, env, ptyBridge });
}

/* Onde procurar o Python no Mac, nesta ordem.
   O /usr/bin/python3 fica por último de propósito: num Mac sem as Ferramentas de
   Linha de Comando da Apple esse arquivo existe, mas é só uma casca — ao ser
   chamado ele abre um alerta pedindo instalação e sai com erro. Por isso
   preferimos sempre um Python instalado de verdade. */
function acharPython() {
  const doPath = acharBin('python3');   // o python3 que o próprio app acha pelo PATH
  const lugares = [doPath, '/opt/homebrew/bin/python3', '/usr/local/bin/python3', '/usr/bin/python3'];
  for (const c of lugares) {
    if (!c || !path.isAbsolute(c)) continue;   // acharBin devolve o nome cru quando não acha
    try { if (fs.statSync(c).isFile()) return c; } catch {}
  }
  return null;
}

// Mac: continua exatamente como sempre foi — python3 + ptybridge.py, fd 3 resize.
function ptyMac({ linha, cols, rows, cwd, env, ptyBridge }) {
  const python = acharPython();
  // Sem Python não há terminal. Melhor dizer o que falta do que quebrar calado.
  if (!python) throw new Error('não achei o Python neste Mac. Abra o Terminal e rode: xcode-select --install');
  const p = spawn(python, [ptyBridge, String(cols), String(rows), '/bin/sh', '-c', linha], {
    cwd, env, stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
  });
  /* Um pedaço que chega do terminal pode cortar uma letra acentuada no meio (o "ç"
     ocupa 2 bytes). O StringDecoder guarda esse resto e junta com o pedaço seguinte,
     em vez de mostrar "�". Um por canal: saída e erro são fluxos separados. */
  const deSaida = new StringDecoder('utf8');
  const deErro = new StringDecoder('utf8');
  const avisosErro = [];
  // Fechar o terminal enquanto uma tecla/resize está no cano produz EPIPE
  // no stream, não no ChildProcess. Sem ouvir esse erro o app inteiro cai.
  const avisarErro = e => { for (const fn of avisosErro) fn(e); };
  p.on('error', avisarErro);
  for (const fluxo of [p.stdin, p.stdout, p.stderr, p.stdio[3]]) fluxo.on('error', avisarErro);
  return {
    onData(fn) {
      p.stdout.on('data', (d) => { const t = deSaida.write(d); if (t) fn(t); });
      p.stderr.on('data', (d) => { const t = deErro.write(d); if (t) fn(t); });
    },
    onErro(fn) { avisosErro.push(fn); },
    onFim(fn) { p.on('close', (code) => fn(code)); },
    escrever(d) { if (!p.stdin.destroyed && !p.stdin.writableEnded) p.stdin.write(d); },
    redimensionar(c, r) { try { p.stdio[3].write(`resize ${c} ${r}\n`); } catch {} },
    matar() {
      // SIGTERM direto matava o ptybridge.py sem rodar a limpeza dele (nao
      // tem handler pra SIGTERM): o comando em 2o plano que ignora SIGHUP
      // ficava orfao pra sempre. Fechar a entrada faz o proprio laco do
      // Python perceber o EOF e chamar encerrar_filho (SIGHUP no grupo,
      // depois SIGKILL) -- caminho que ja existe e ja funciona.
      if (p.exitCode !== null || p.signalCode !== null) return Promise.resolve();
      try { p.stdin.end(); } catch {}
      // R3-009: devolve Promise que so' resolve no 'close' de verdade (ou no teto de 2s),
      // igual ao matarGrupoExtra do main.js — sem isto shutdown() nao espera o terminal morrer.
      return new Promise((resolve) => {
        let feito = false, t;
        const acabar = () => { if (feito) return; feito = true; if (t) clearTimeout(t); resolve(); };
        try { p.once('close', acabar); } catch {}
        t = setTimeout(() => { try { p.kill('SIGKILL'); } catch {} acabar(); }, 2000);
        if (t.unref) t.unref();
      });
    },
  };
}

// Windows: ConPTY pelo node-pty. O shell é o cmd.exe, que roda a linha e sai.
// Os argumentos vão como TEXTO, não como lista: em lista o node-pty escaparia
// do jeito do C, que não é o jeito do cmd.exe, e um caminho com espaço quebraria.
// Com `/s`, o cmd tira a primeira e a última aspas e roda o miolo como está.
function ptyWindows({ linha, cols, rows, cwd, env }) {
  const pty = require('@lydell/node-pty');
  const comspec = process.env.ComSpec || 'cmd.exe';
  const p = pty.spawn(comspec, '/d /s /c "' + linha + '"', {
    name: 'xterm-256color', cols, rows, cwd, env, useConpty: true,
  });
  let fimJaAvisado = false;
  return {
    onData(fn) { p.onData((d) => fn(d)); },
    onErro(fn) { /* node-pty avisa falha pelo onExit */ void fn; },
    onFim(fn) { p.onExit(({ exitCode }) => { if (!fimJaAvisado) { fimJaAvisado = true; fn(exitCode); } }); },
    escrever(d) { try { p.write(d); } catch {} },
    redimensionar(c, r) { try { p.resize(c, r); } catch {} },
    matar() { try { p.kill(); } catch {} },
  };
}

/* ---------- onde ficam as credenciais do Claude ----------
   No Mac ficam no Chaveiro (comando `security`). No Windows ficam num arquivo. */
// R2-017: execFileSync travava a JANELA INTEIRA por ate 16s (dois tiros de 8s) enquanto o
// Chaveiro nao respondia (negado/trancado). Isso roda no processo principal do Electron, entao
// mouse e teclado travavam junto. execFile (assincrono) devolve o mesmo resultado sem bloquear
// o laco de eventos — igual ja foi feito pro Tailscale (ver enderecoTailscale em main.js).
async function tokenClaude() {
  if (!EH_WIN) {
    for (const conta of [process.env.USER, 'unknown']) {
      try {
        const raw = await new Promise((resolve, reject) => {
          execFile('security', ['find-generic-password', '-s', 'Claude Code-credentials', '-a', conta, '-w'],
            { encoding: 'utf8', timeout: 8000 }, (err, stdout) => err ? reject(err) : resolve(stdout));
        });
        const o = (JSON.parse(raw).claudeAiOauth) || {};
        if (o.accessToken) return o.accessToken;
      } catch {}
    }
    return null;
  }
  for (const f of [path.join(HOME, '.claude', '.credentials.json'),
                   path.join(HOME, '.config', 'claude', '.credentials.json')]) {
    try {
      const o = (JSON.parse(fs.readFileSync(f, 'utf8')).claudeAiOauth) || {};
      if (o.accessToken) return o.accessToken;
    } catch {}
  }
  return null;
}

module.exports = { EH_WIN, HOME, buildEnv, acharBin, spawnBin, abrirPty, tokenClaude, temBin, matarProcesso };
