'use strict';

// Carrega o main INTEIRO. Só troca as fronteiras externas (Electron, sistema de
// arquivos e processos). Nenhum motor, chaveiro, navegador ou rede é iniciado.
const vm = require('node:vm');
const fs = require('node:fs');
const pathNativo = require('node:path');
// O main simulado roda como se fosse no Mac (platform 'darwin'), então os caminhos DELE são
// sempre com '/', mesmo quando o teste roda no Windows. Os arquivos reais do projeto (root)
// continuam no formato da máquina.
const path = pathNativo.posix;
const { EventEmitter } = require('node:events');

function loadMain(options = {}) {
  const root = pathNativo.resolve(__dirname, '..');
  const files = new Map();
  const ipc = new Map();
  const events = [], wire = [], spawned = [], timers = new Map();
  const appEvents = new Map();
  const violations = [];
  let timerId = 0, bootExecuted = false;
  const HOME = '/cockpit-test/home';
  // Pastas existem independentemente de arquivos. Só HOME e as fixtures
  // declaradas pelo teste começam válidas; um cwd qualquer continua ausente.
  const directories = new Set();
  function mkdir(name) {
    let dir = String(name);
    while (dir && !directories.has(dir)) {
      directories.add(dir);
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  mkdir(HOME);
  for (const dir of options.directories || []) mkdir(dir);
  const missing = name => Object.assign(new Error('ENOENT: ' + name), { code: 'ENOENT' });
  const fakeFs = {
    existsSync: name => files.has(String(name)) || directories.has(String(name)),
    readFileSync(name, encoding) {
      const b = files.get(String(name));
      if (!b) throw missing(name);
      return encoding ? b.toString(typeof encoding === 'string' ? encoding : encoding.encoding) : Buffer.from(b);
    },
    statSync(name) {
      if (!files.has(String(name)) && directories.has(String(name))) {
        return { size: 0, isFile: () => false, isDirectory: () => true, mtimeMs: 1 };
      }
      if (!files.has(String(name))) throw missing(name);
      return { size: files.get(String(name)).length, isFile: () => true, isDirectory: () => false, mtimeMs: 1 };
    },
    realpathSync: name => String(name),
    readdirSync: () => [],
    mkdirSync: mkdir,
    writeFileSync(name, data) { mkdir(path.dirname(String(name))); files.set(String(name), Buffer.from(String(data))); },
    appendFileSync(name, data) { mkdir(path.dirname(String(name))); files.set(String(name), Buffer.concat([files.get(String(name)) || Buffer.alloc(0), Buffer.from(String(data))])); },
    copyFileSync(from, to) { mkdir(path.dirname(String(to))); files.set(String(to), Buffer.from(fakeFs.readFileSync(from))); },
    renameSync(from, to) { mkdir(path.dirname(String(to))); files.set(String(to), fakeFs.readFileSync(from)); files.delete(String(from)); },
    unlinkSync(name) { files.delete(String(name)); },
    chmodSync() {}, utimesSync() {},
  };
  const descritores = new Map(); let proximoFd = 10;
  fakeFs.openSync = name => { const fd = proximoFd++; descritores.set(fd, fakeFs.readFileSync(name)); return fd; };
  fakeFs.fstatSync = fd => ({ size: descritores.get(fd).length });
  fakeFs.readSync = (fd, buf, off, len, pos) => {
    const origem = descritores.get(fd), n = Math.max(0, Math.min(len, origem.length - pos));
    origem.copy(buf, off, pos, pos + n); return n;
  };
  fakeFs.closeSync = fd => descritores.delete(fd);
  function fakeSpawn(bin, args, options) {
    const proc = new EventEmitter();
    proc.stdout = new EventEmitter(); proc.stderr = new EventEmitter();
    proc.stdin = new EventEmitter();
    proc.stdin.destroyed = false; proc.stdin.writable = true;
    const record = { bin, args: [...args], options, writes: [], proc };
    proc.stdin.write = value => { record.writes.push(JSON.parse(value)); return true; };
    // R3-009/R3-010: cli-motors.js (Gemini) fecha o stdin com .end(prompt) em vez de
    // .write(); sem isto qualquer teste que mande mensagem pro Gemini quebra na hora
    proc.stdin.end = value => { if (value !== undefined) { try { record.writes.push(JSON.parse(value)); } catch { record.writes.push(value); } } proc.stdin.destroyed = true; return true; };
    proc.kill = signal => { record.signal = signal; };
    spawned.push(record);
    const agy = /(?:^|[\\/])agy$/.test(String(bin));
    if (agy && args[0] === '--version') {
      queueMicrotask(() => { proc.stdout.emit('data', Buffer.from('1.2.7\n')); proc.emit('close', 0); });
    } else if (agy && args.includes('/usage')) {
      queueMicrotask(async () => {
        try {
          const payload = ctx.__agyUso ? await ctx.__agyUso(record) : '';
          if (payload) proc.stdout.emit('data', Buffer.from(typeof payload === 'string' ? payload : JSON.stringify(payload)));
        } catch (e) { proc.stderr.emit('data', Buffer.from(String(e && e.message || e))); proc.emit('close', 1); return; }
        proc.emit('close', 0);
      });
    }
    return proc;
  }
  const forbidden = name => () => { violations.push(name); throw new Error('Efeito externo proibido no teste: ' + name); };
  const nativeTheme = { themeSource: 'system', shouldUseDarkColors: true, on() {}, removeListener() {} };
  const electron = {
    app: {
      getPath: () => HOME + '/app-data', isPackaged: false,
      whenReady: () => ({ then() { /* não roda o callback de boot */ } }),
      on: (name, fn) => appEvents.set(name, fn),
      quit: forbidden('app.quit'),
    },
    ipcMain: { handle(name, fn) { ipc.set(name, fn); } },
    BrowserWindow: forbidden('BrowserWindow'),
    dialog: {}, Menu: {}, shell: {}, clipboard: {}, powerSaveBlocker: {}, Notification: {},
    // redesenho 25/09: o main acerta a Aparencia nativa (themeSource) a cada config:set. Sem
    // isto o codigo so passava pelo `nativeTheme &&` e nenhum teste via a escolha chegar ao Mac.
    nativeTheme,
  };
  const platform = {
    EH_WIN: false, acharBin: value => value, spawnBin: fakeSpawn,
    temBin: () => true, matarProcesso: p => { try { p.kill(); } catch {} },
    abrirPty: forbidden('PTY'), buildEnv: () => ({}), tokenClaude: () => '',
  };
  const processStub = {
    platform: 'darwin', env: {}, resourcesPath: '/cockpit-test/resources',
    on() {}, versions: { electron: 'test' },
  };
  const moduleCache = new Map();
  const ctx = vm.createContext({
    Buffer, Date, Map, Set, setImmediate, URL, URLSearchParams, TextDecoder, TextEncoder,
    console: { log() {}, warn() {}, error() {} }, process: processStub,
    setTimeout(fn) { const id = ++timerId; timers.set(id, fn); return id; },
    clearTimeout(id) { timers.delete(id); },
    setInterval(fn) { const id = ++timerId; timers.set(id, fn); return id; },
    clearInterval(id) { timers.delete(id); },
    fetch: forbidden('fetch'), __dirname: root, __filename: pathNativo.join(root, 'main.js'),
  });
  function safeRequire(name) {
    if (name === 'electron') return electron;
    if (name === 'fs' || name === 'node:fs') return fakeFs;
    if (name === 'os' || name === 'node:os') return { homedir: () => HOME, userInfo: () => ({ username: 'teste' }) };
    if (name === 'child_process' || name === 'node:child_process') return { spawn: fakeSpawn, execFileSync: forbidden('execFileSync') };
    if (name === './plataforma') return platform;
    if (name === 'path' || name === 'node:path') return path;
    if (['crypto', 'node:crypto', 'string_decoder', 'node:string_decoder'].includes(name)) return require(name);
    if (name.startsWith('./') && !name.includes('servidor-web')) {
      const file = pathNativo.resolve(root, name.endsWith('.js') ? name : name + '.js');
      if (moduleCache.has(file)) return moduleCache.get(file).exports;
      const mod = { exports: {} }; moduleCache.set(file, mod);
      const compiled = vm.runInContext('(function(require,module,exports,__dirname,__filename){\n' + fs.readFileSync(file, 'utf8') + '\n})', ctx, { filename: file });
      compiled(safeRequire, mod, mod.exports, pathNativo.dirname(file), file);
      return mod.exports;
    }
    throw new Error('require não permitido no harness: ' + name);
  }
  ctx.require = safeRequire;
  const src = fs.readFileSync(pathNativo.join(root, 'main.js'), 'utf8');
  vm.runInContext(src, ctx, { filename: 'main.js', timeout: 3000 });
  ctx.__captureEvent = event => events.push(JSON.parse(JSON.stringify(event)));
  vm.runInContext("ouvintesWeb.add({send(line) { __captureEvent(JSON.parse(line)); }});", ctx);
  function evaluate(code) { return vm.runInContext(code, ctx, { timeout: 3000 }); }
  function attachCodex(destino = 'local', responder = null) {
    const transport = {
      stdin: { writable: true, destroyed: false, write(line) {
        const message = JSON.parse(line);
        wire.push({ destino, ...message });
        if (message.method && message.id !== undefined) queueMicrotask(async () => {
          try {
            const result = responder ? await responder(message.method, message.params) :
              message.method === 'thread/start' || message.method === 'thread/resume'
                ? { thread: { id: message.params.threadId || 'thread-' + destino, path: HOME + '/history.jsonl' }, model: message.params.model || 'gpt-6-astra' }
                : message.method === 'turn/start' ? { turn: { id: 'turn-' + destino, status: 'inProgress' } } : {};
            ctx.__replyTransport(destino, { id: message.id, result });
          } catch (error) { ctx.__replyTransport(destino, { id: message.id, error: { message: error.message } }); }
        });
        return true;
      } },
      kill() {},
    };
    ctx.__transport = transport; ctx.__destino = destino;
    evaluate('(() => { const c = conexaoCodex(__destino); c.proc = __transport; c.ready = Promise.resolve(true); })()');
    delete ctx.__transport; delete ctx.__destino;
  }
  ctx.__replyTransport = evaluate('codexIncoming');
  return {
    HOME, files, directories, mkdir, ipc, events, wire, spawned, timers, violations, appEvents, nativeTheme,
    attachCodex, evaluate,
    onAgyUso(fn) { ctx.__agyUso = fn; },
    // `resto` leva os argumentos extras de um handler que recebe mais de um (ex.: o
    // config:set, que alem do config recebe a ORIGEM da gravacao)
    call(name, args, event = null, ...resto) { if (!ipc.has(name)) throw new Error('Handler ausente: ' + name); return ipc.get(name)(event, args, ...resto); },
    incoming(destino, message) { return ctx.__replyTransport(destino, message); },
    notify(method, params, destino = 'local') { return ctx.__replyTransport(destino, { method, params }); },
    paneEvents(kind) { return events.filter(e => e.canal === 'pane:event').map(e => e.dados).filter(e => !kind || e.kind === kind); },
    clear() { events.length = 0; wire.length = 0; },
    put(name, value) { mkdir(path.dirname(String(name))); files.set(name, Buffer.isBuffer(value) ? value : Buffer.from(value)); },
    get bootExecuted() { return bootExecuted; },
  };
}

module.exports = { loadMain };
