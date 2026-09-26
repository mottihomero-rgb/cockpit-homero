'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');

function montar(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-acp-audit-'));
  const timers = new Map();
  let seq = 0;
  const mod = { exports: {} };
  const ctx = vm.createContext({ require: require('node:module').createRequire(path.join(__dirname, '../acp.js')), module: mod, Buffer, console,
    setTimeout(fn, ms) { const id = ++seq; timers.set(id, { fn, ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../acp.js'), 'utf8'), ctx);
  const procs = [];
  const acp = mod.exports.criarAcp({
    HOME: dir, pastaDados: () => dir, buildEnv: () => ({}), emit() {},
    matarProcesso(proc) { proc.emit('close', 0); },
    spawnBin() {
      const p = new EventEmitter();
      p.stdout = new PassThrough(); p.stderr = new PassThrough(); p.stdin = new EventEmitter();
      p.requests = [];
      p.reply = (id, result) => p.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
      p.stdin.write = data => {
        const m = JSON.parse(data); p.requests.push(m);
        if (m.method === 'initialize') queueMicrotask(() => p.reply(m.id, { agentCapabilities: {}, authMethods: [{ id: 'cached_token' }] }));
        if (m.method === 'authenticate') queueMicrotask(() => p.reply(m.id, {}));
        if (m.method === 'session/new') queueMicrotask(() => p.reply(m.id, { sessionId: 's' + procs.indexOf(p) }));
        return true;
      };
      procs.push(p); return p;
    },
  });
  t.after(() => { acp.fechar(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { acp, procs, dir,
    tick(ms) { for (const [id, timer] of [...timers]) if (timer.ms === ms) { timers.delete(id); timer.fn(); } },
  };
}
const settle = () => new Promise(resolve => setImmediate(resolve));
const prompts = p => p.requests.filter(m => m.method === 'session/prompt');
const texto = m => m.params.prompt.find(b => b.type === 'text').text;

test('ACP: mensagem nova entre turnos não ultrapassa nem apaga a mensagem na fila', async t => {
  const h = montar(t);
  await h.acp.start('p', { comando: 'falso', cwd: h.dir });
  const p = h.procs[0];
  h.acp.enviar('p', 'primeira', []);
  h.acp.enviar('p', 'segunda', []);
  p.reply(prompts(p)[0].id, { stopReason: 'end_turn' });
  await settle();
  h.acp.enviar('p', 'terceira', []);
  h.tick(50);
  assert.deepEqual(prompts(p).map(texto), ['primeira', 'segunda']);
  p.reply(prompts(p)[1].id, { stopReason: 'end_turn' });
  await settle(); h.tick(50);
  assert.deepEqual(prompts(p).map(texto), ['primeira', 'segunda', 'terceira']);
});

test('ACP: parar antes de consumir a fila não envia para o processo substituto', async t => {
  const h = montar(t);
  await h.acp.start('p', { comando: 'falso', cwd: h.dir });
  const p = h.procs[0];
  h.acp.enviar('p', 'primeira', []); h.acp.enviar('p', 'segunda', []);
  p.reply(prompts(p)[0].id, { stopReason: 'end_turn' });
  await settle();
  await h.acp.start('p', { comando: 'outro', cwd: h.dir });
  h.tick(50);
  assert.equal(prompts(h.procs[1]).length, 0);
});

test('ACP: cancelar e religar imediatamente não reaproveita um início já cancelado', async t => {
  const h = montar(t);
  const opts = { comando: 'falso', cwd: h.dir };
  const primeiro = h.acp.start('p', opts);
  const rejeicao = assert.rejects(primeiro, /painel parado/);
  h.acp.parar('p');
  const segundo = h.acp.start('p', opts);
  assert.notEqual(primeiro, segundo);
  await rejeicao;
  assert.equal(await segundo, true);
  assert.equal(h.procs.length, 2);
});
