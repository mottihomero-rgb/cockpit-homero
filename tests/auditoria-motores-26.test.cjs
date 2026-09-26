'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { spawn } = require('node:child_process');
const { createRequire } = require('node:module');
const { criarCli } = require('../cli-motors');
const { horaDaUltimaFala, horaNoTexto } = require('../hora-da-fala');
const { abrirPty } = require('../plataforma');
const root = path.resolve(__dirname, '..');
const settle = () => new Promise(r => setImmediate(r));
const sleep = ms => new Promise(r => setTimeout(r, ms));
function pasta(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-auditoria-26-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function acpFake(t, options = {}) {
  const dir = pasta(t), timers = new Map(), events = [], procs = [];
  let seq = 0, kills = 0;
  const mod = { exports: {} }, requireSource = createRequire(path.join(root, 'acp.js'));
  vm.runInNewContext(fs.readFileSync(path.join(root, 'acp.js'), 'utf8'), {
    require: n => n === 'fs' && options.fs ? options.fs : requireSource(n), module: mod, Buffer,
    setTimeout(fn, ms) { const id = ++seq; timers.set(id, { fn, ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
  });
  const acp = mod.exports.criarAcp({ HOME: dir, pastaDados: () => dir, buildEnv: () => ({}),
    emit: (paneId, kind, data) => events.push({ paneId, kind, ...data }),
    aoPedirPermissao() {},
    matarProcesso(p) { kills++; p.emit('close', 0); return options.kill ? options.kill(p) : Promise.resolve(); },
    spawnBin(bin, args, opts) {
      const p = new EventEmitter(); p.opts = opts; p.requests = [];
      p.stdout = new PassThrough(); p.stderr = new PassThrough(); p.stdin = new EventEmitter();
      p.receive = m => p.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n');
      p.stdin.write = raw => {
        const m = JSON.parse(raw); p.requests.push(m);
        if (m.method === 'initialize') queueMicrotask(() => p.receive({ id: m.id, result: { agentCapabilities: { promptCapabilities: { image: true } } } }));
        if (m.method === 'session/new') queueMicrotask(() => p.receive({ id: m.id, result: { sessionId: 's' + procs.indexOf(p) } }));
        return true;
      };
      procs.push(p); return p;
    },
  });
  t.after(() => acp.fechar());
  return { dir, acp, procs, events, kills: () => kills,
    tick(ms) { for (const [id, timer] of [...timers]) if (timer.ms === ms) { timers.delete(id); timer.fn(); } },
  };
}

test('M1: cancelamento sem resposta mata o grupo, bloqueia ações tardias e só religa depois da limpeza', async t => {
  let soltar;
  const limpeza = new Promise(r => { soltar = r; });
  const h = acpFake(t, { kill: () => limpeza });
  await h.acp.start('p', { comando: 'falso', approval: 'bypass' });
  const velho = h.procs[0];
  assert.equal(velho.opts.detached, process.platform !== 'win32');
  h.acp.enviar('p', 'pedido'); h.acp.interromper('p'); h.tick(7500);
  await settle();
  assert.equal(h.kills(), 1);
  const alvo = path.join(h.dir, 'nao-pode-existir.txt');
  velho.receive({ id: 701, method: 'session/request_permission', params: { options: [{ optionId: 'sim', kind: 'allow_once' }] } });
  velho.receive({ id: 702, method: 'fs/write_text_file', params: { path: alvo, content: 'tardio' } });
  assert.equal(h.acp.enviar('p', 'novo'), false);
  const novo = h.acp.start('p', { comando: 'falso' });
  await settle();
  assert.equal(h.procs.length, 1, 'não religa enquanto o grupo antigo ainda está sendo encerrado');
  assert.equal(velho.requests.some(m => m.id === 701 && m.result?.outcome?.outcome === 'selected'), false);
  assert.equal(fs.existsSync(alvo), false);
  soltar(); await novo;
  assert.equal(h.procs.length, 2);
  assert.equal(h.acp.enviar('p', 'novo'), true);
  assert.equal(velho.requests.filter(m => m.method === 'session/prompt').length, 1);
});

test('M1: operação de arquivo aguardando mkdir não escreve depois de cancelar o turno', async t => {
  let soltar;
  const pendente = new Promise(r => { soltar = r; });
  const fsFake = Object.create(fs);
  Object.defineProperty(fsFake, 'promises', { value: { ...fs.promises, mkdir: () => pendente } });
  const h = acpFake(t, { fs: fsFake });
  await h.acp.start('p', { comando: 'falso' }); h.acp.enviar('p', 'pedido');
  const alvo = path.join(h.dir, 'tardia.txt');
  h.procs[0].receive({ id: 55, method: 'fs/write_text_file', params: { path: alvo, content: 'proibido' } });
  h.acp.interromper('p'); soltar(); await settle(); await settle();
  assert.equal(fs.existsSync(alvo), false);
});

test('M1: parar durante a espera de limpeza cancela também o próximo início', async t => {
  let soltar;
  const limpeza = new Promise(r => { soltar = r; });
  const h = acpFake(t, { kill: () => limpeza });
  await h.acp.start('p', { comando: 'falso' });
  const novo = h.acp.start('p', { comando: 'outro' });
  const rejeitado = assert.rejects(novo, /cancelado/);
  h.acp.parar('p'); soltar(); await rejeitado;
  assert.equal(h.procs.length, 1);
});

test('M1: fechar durante a espera de limpeza cancela o restart e permite novo início explícito', async t => {
  let soltar;
  const limpeza = new Promise(r => { soltar = r; });
  const h = acpFake(t, { kill: () => limpeza });
  await h.acp.start('p', { comando: 'falso' });
  const novo = h.acp.start('p', { comando: 'outro' });
  const rejeitado = assert.rejects(novo, /cancelado/);
  let fechou = false;
  const fechamento = h.acp.fechar().then(() => { fechou = true; });
  await settle();
  assert.equal(fechou, false, 'fechar espera a limpeza que já estava em andamento');
  soltar(); await fechamento; await rejeitado; await settle();
  assert.equal(h.procs.length, 1, 'o restart pendente não cria outro processo no shutdown');
  assert.equal(h.acp.vivo('p'), false);
  assert.equal(h.kills(), 1);
  await h.acp.start('p', { comando: 'novo início explícito' });
  assert.equal(h.procs.length, 2, 'um início pedido depois de fechar continua válido');
  assert.equal(h.acp.vivo('p'), true);
});

test('M3: registro final longo preserva a data e datas no payload não alteram a conversa', t => {
  const dir = pasta(t), file = path.join(dir, 'longa.jsonl');
  const velha = Date.parse('2026-09-25T12:00:00Z'), nova = Date.parse('2026-09-26T17:00:00Z'), gravado = nova + 3600000;
  fs.writeFileSync(file, [
    { t: velha, cabecalho: 1 }, { t: velha, role: 'user', text: 'x'.repeat(10000) },
    { t: nova, role: 'bot', text: 'resposta'.repeat(60000), payload: { timestamp: '2036-01-01T00:00:00Z' } },
  ].map(JSON.stringify).join('\n') + '\n');
  assert.equal(horaDaUltimaFala(file, gravado), nova);
  assert.equal(horaNoTexto(JSON.stringify({ timestamp: new Date(nova).toISOString(), payload: { t: 9999999999999 } })), nova);
  assert.equal(horaNoTexto(JSON.stringify({ role: 'bot', payload: { timestamp: '2036-01-01T00:00:00Z' } })), 0);
  assert.equal(horaNoTexto(JSON.stringify({ sessionId: 'g', messages: [{ timestamp: new Date(nova).toISOString(), content: [{ timestamp: '2036-01-01T00:00:00Z' }] }] })), nova);
});

test('M3: registro maior que teto usa mtime explícito, não a data velha do cabeçalho', t => {
  const dir = pasta(t), file = path.join(dir, 'acima-do-teto.jsonl');
  const velha = 1789825331615, gravado = 1790425331615;
  fs.writeFileSync(file, JSON.stringify({ t: velha, cabecalho: 1 }) + '\n' + JSON.stringify({ t: velha + 1000, role: 'bot', text: 'x'.repeat(17 * 1024 * 1024) }) + '\n');
  assert.equal(horaDaUltimaFala(file, gravado), gravado);
});

function cliFake(dir) {
  return criarCli({ HOME: dir, pastaDados: () => path.join(dir, 'app'), emit() {}, temBin: () => true,
    acharBin: n => n, buildEnv: () => ({}), matarGrupo: () => Promise.resolve() });
}
function medirLeitura(files, fn) {
  const tracked = new Set(files), fdFiles = new Map(); let bytes = 0;
  const orig = { openSync: fs.openSync, readSync: fs.readSync, closeSync: fs.closeSync };
  fs.openSync = (...args) => { const fd = orig.openSync(...args); if (tracked.has(String(args[0]))) fdFiles.set(fd, args[0]); return fd; };
  fs.readSync = (...args) => { const n = orig.readSync(...args); if (fdFiles.has(args[0])) bytes += n; return n; };
  fs.closeSync = fd => { fdFiles.delete(fd); return orig.closeSync(fd); };
  try { return { value: fn(), get bytes() { return bytes; } }; }
  finally { Object.assign(fs, orig); }
}

test('M4: lateral Gemini usa cache e append incremental; histórico longo continua completo', t => {
  const dir = pasta(t), pastaGemini = path.join(dir, 'app', 'gemini'); fs.mkdirSync(pastaGemini, { recursive: true });
  const file = path.join(pastaGemini, 'g.jsonl'), agora = Date.now() - 1000;
  fs.writeFileSync(file, [
    JSON.stringify({ cockpit: 1, id: 'g', criado: agora, cwd: dir }),
    JSON.stringify({ role: 'user', text: 'Título preservado', t: agora }),
    ...Array.from({ length: 24 }, (_, i) => JSON.stringify({ role: 'bot', text: 'x'.repeat(1024 * 1024) + ' FIM-' + i, t: agora })),
  ].join('\n') + '\n');
  const cli = cliFake(dir);
  const primeira = medirLeitura([file], () => cli.sessoes());
  assert.equal(primeira.value[0].title, 'Título preservado');
  assert.ok(primeira.bytes >= fs.statSync(file).size);
  const segunda = medirLeitura([file], () => cli.sessoes());
  assert.equal(segunda.bytes, 0, 'arquivo sem alteração não relê nenhum corpo');
  fs.appendFileSync(file, JSON.stringify({ t: Date.now(), role: 'bot', text: 'NOVA FALA' }) + '\n');
  const terceira = medirLeitura([file], () => cli.sessoes());
  assert.ok(terceira.bytes < 100000, 'append pequeno não repassa os 24 MB anteriores');
  assert.equal(terceira.value[0].title, 'Título preservado');
  const historico = cli.historico(file);
  assert.equal(historico.length, 26);
  assert.ok(historico[24].text.endsWith('FIM-23'));
  assert.equal(historico[25].text, 'NOVA FALA');
});

test('M4: primeira listagem de linha única 24/48 MB é linear e a segunda não lê o corpo', t => {
  const dir = pasta(t), pastaGemini = path.join(dir, 'app', 'gemini'); fs.mkdirSync(pastaGemini, { recursive: true });
  const cli = cliFake(dir);
  for (const mb of [24, 48]) {
    const file = path.join(pastaGemini, 'grande-' + mb + '.jsonl');
    fs.writeFileSync(file, JSON.stringify({ cockpit: 1, id: 'grande-' + mb, criado: Date.now(), cwd: dir }) + '\n'
      + JSON.stringify({ role: 'user', text: 'Conversa ' + mb, t: Date.now() }) + '\n'
      + JSON.stringify({ role: 'bot', text: 'x'.repeat(mb * 1024 * 1024), t: Date.now() }) + '\n');
    const inicio = performance.now();
    const primeira = medirLeitura([file], () => cli.sessoes());
    t.diagnostic(mb + ' MB: primeira leitura ' + Math.round(performance.now() - inicio) + ' ms, ' + primeira.bytes + ' bytes; segunda = 0 bytes');
    assert.ok(primeira.value.some(s => s.title === 'Conversa ' + mb));
    assert.equal(medirLeitura([file], () => cli.sessoes()).bytes, 0);
  }
});

test('M4: título nativo depois de contexto grande não some; JSON e JSONL em cache', t => {
  const dir = pasta(t), pastaGemini = path.join(dir, '.gemini', 'tmp', 'projeto', 'chats'); fs.mkdirSync(pastaGemini, { recursive: true });
  const json = path.join(pastaGemini, 'session.json'), jsonl = path.join(pastaGemini, 'session.jsonl');
  const timestamp = new Date(Date.now() - 1000).toISOString();
  fs.writeFileSync(json, JSON.stringify({ sessionId: 'nativo-json', messages: [{ type: 'user', content: '<session_context>' + 'x'.repeat(1024 * 1024), timestamp }, { type: 'user', content: 'Título do JSON', timestamp }] }));
  fs.writeFileSync(jsonl, [{ sessionId: 'nativo-jsonl' }, { id: 'a', type: 'user', content: '<session_context>' + 'x'.repeat(1024 * 1024), timestamp }, { id: 'b', type: 'user', content: 'Título do JSONL', timestamp }].map(JSON.stringify).join('\n') + '\n');
  const cli = cliFake(dir);
  const sessoes = cli.sessoes();
  assert.deepEqual(sessoes.map(s => s.title).sort(), ['Título do JSON', 'Título do JSONL']);
  assert.equal(medirLeitura([json, jsonl], () => cli.sessoes()).bytes, 0);
  fs.appendFileSync(jsonl, [{ $rewindTo: 'b' }, { id: 'c', type: 'user', content: 'Título refeito', timestamp }].map(JSON.stringify).join('\n') + '\n');
  assert.equal(cli.sessoes().find(s => s.id === 'nativo-jsonl').title, 'Título refeito');
});

test('M5: anexo reaparece com ficha e miniatura; registro antigo recupera caminho do texto', async t => {
  const h = acpFake(t), file = path.join(h.dir, 'imagem.png');
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lFoAAAAASUVORK5CYII=', 'base64');
  fs.writeFileSync(file, bytes);
  await h.acp.start('p', { comando: 'falso' });
  h.acp.enviar('p', 'Veja a imagem', [{ path: file, nome: 'Imagem', ext: 'png', bytes: bytes.length }]);
  const history = h.acp.historico('s0');
  assert.equal(history[0].attachments[0].path, file);
  assert.equal(history[0].attachments[0].ext, 'png');
  assert.equal(history[0].attachments[0].mini, 'data:image/png;base64,' + bytes.toString('base64'));
  const gravado = JSON.parse(fs.readFileSync(h.acp.arquivoDe('s0'), 'utf8').trim().split('\n').at(-1));
  assert.equal(gravado.attachments[0].path, file);
  assert.equal(gravado.attachments[0].mini, undefined, 'não duplica os bytes da imagem no histórico');
  fs.appendFileSync(h.acp.arquivoDe('s0'), JSON.stringify({ role: 'user', text: 'Antiga\n\nArquivos que anexei (abra cada um antes de responder):\n- ' + file }) + '\n');
  assert.equal(h.acp.historico('s0').at(-1).attachments[0].path, file);
});

test('M2: shell sai com código 7, saída é preservada e job que ignora HUP morre', { skip: process.platform === 'win32', timeout: 10000 }, async t => {
  const dir = pasta(t), pidFile = path.join(dir, 'filho.pid');
  let pid = 0, out = '';
  const term = abrirPty({ linha: `set -m; (trap '' HUP; exec sleep 60) & printf '%s' "$!" > '${pidFile}'; sleep 0.15; printf 'SAIDA FINAL\\n'; exit 7`, cols: 80, rows: 24, cwd: dir, env: { ...process.env, TERM: 'xterm-256color' }, ptyBridge: path.join(root, 'ptybridge.py') });
  t.after(async () => { if (pid) try { process.kill(pid, 'SIGKILL'); } catch {} await term.matar(); });
  term.onData(s => { out += s; });
  const terminou = new Promise(resolve => term.onFim(resolve));
  const timer = setTimeout(() => {
    try { pid = Number(fs.readFileSync(pidFile, 'utf8')); process.kill(pid, 'SIGKILL'); } catch {}
    term.matar();
  }, 5000);
  let code;
  try { code = await terminou; } finally { clearTimeout(timer); }
  pid = Number(fs.readFileSync(pidFile, 'utf8'));
  assert.equal(code, 7);
  assert.match(out, /SAIDA FINAL/);
  await sleep(150);
  let vivo = true; try { process.kill(pid, 0); } catch { vivo = false; }
  assert.equal(vivo, false, 'processo de fundo não pode sobreviver ao shell');
});
