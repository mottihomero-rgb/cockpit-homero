'use strict';
/* Guarda do conserto da faixa "motores" (rodada 4, lote 1) em acp.js:
   R4-002 - diff/edicao legitima de arquivo grande (>24MB numa linha JSON-RPC)
   matava o processo ACP antes do corte de tamanho (LIM_DIFF) rodar. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const acp = require('../acp.js');

// mesmo harness do tests/r3-motores-1.test.cjs (nao da pra importar dali: e' um
// arquivo de teste, nao um modulo)
function montarHarness(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-acp-r4-'));
  const eventos = [];
  const procs = [];
  const instancia = acp.criarAcp({
    HOME: dir, pastaDados: () => dir, buildEnv: () => ({}),
    emit: (paneId, kind, data) => eventos.push({ paneId, kind, data }),
    matarProcesso(proc) { proc.emit('close', 0); },
    spawnBin() {
      const p = new EventEmitter();
      p.stdout = new PassThrough(); p.stderr = new PassThrough(); p.stdin = new EventEmitter();
      p.requests = [];
      p.reply = (id, result) => p.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
      p.stdin.write = (data) => {
        const m = JSON.parse(data); p.requests.push(m);
        if (m.method === 'initialize') queueMicrotask(() => p.reply(m.id, { agentCapabilities: {}, authMethods: [{ id: 'cached_token' }] }));
        if (m.method === 'authenticate') queueMicrotask(() => p.reply(m.id, {}));
        if (m.method === 'session/new') queueMicrotask(() => p.reply(m.id, { sessionId: 's' + procs.indexOf(p) }));
        return true;
      };
      procs.push(p);
      return p;
    },
  });
  t.after(() => { instancia.fechar(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { acp: instancia, procs, dir, eventos };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));

test('R4-002: diff legitimo de arquivo grande (>24MB cru, abaixo do novo teto) nao derruba o painel e chega truncado', async (t) => {
  const h = montarHarness(t);
  await h.acp.start('p', { comando: 'falso', cwd: h.dir });
  const p = h.procs[0];

  // oldText + newText somando ~50MB cru: acima do teto ANTIGO (24MB), abaixo do NOVO (80MB).
  // e' exatamente o tipo de mensagem que LIM_DIFF (100KB) foi desenhado pra truncar,
  // nao pra matar o processo.
  const oldText = 'A'.repeat(25 * 1024 * 1024);
  const newText = 'B'.repeat(25 * 1024 * 1024);
  const msg = {
    jsonrpc: '2.0', method: 'session/update',
    params: {
      sessionId: 's0',
      update: {
        sessionUpdate: 'tool_call', toolCallId: 'c1', kind: 'edit', title: 'Editar CSV grande', status: 'completed',
        content: [{ type: 'diff', path: '/tmp/grande.csv', oldText, newText }],
      },
    },
  };
  p.stdout.write(JSON.stringify(msg) + '\n');
  await settle(); await settle();

  const quedas = h.eventos.filter((e) => e.kind === 'engine-down' && e.paneId === 'p');
  assert.equal(quedas.length, 0, 'diff legitimo nao pode derrubar o painel - so' + ' texto/diff grande demais, LIM_DIFF que corta');

  const inicio = h.eventos.find((e) => e.kind === 'tool-start' && e.paneId === 'p');
  assert.ok(inicio, 'devia chegar o tool-start com a mudanca');
  assert.ok(inicio.data.mudanca, 'devia trazer o diff');
  const LIM_DIFF = 100 * 1024;
  assert.ok(inicio.data.mudanca.antes.length <= LIM_DIFF + 20, 'oldText tem que vir cortado em LIM_DIFF, nao os 25MB crus');
  assert.ok(inicio.data.mudanca.depois.length <= LIM_DIFF + 20, 'newText tem que vir cortado em LIM_DIFF, nao os 25MB crus');
  assert.match(inicio.data.mudanca.antes, /\(cortado\)$/, 'prova que passou pelo corta(), nao pelo teto de buffer bruto');
});

test('R4-002: uma linha realmente sem fim (acima do novo teto) continua matando o processo', async (t) => {
  const h = montarHarness(t);
  await h.acp.start('p', { comando: 'falso', cwd: h.dir });
  const p = h.procs[0];

  p.stdout.write(Buffer.alloc(81 * 1024 * 1024, 'a'));   // sem '\n', acima do novo teto de 80MB
  await settle(); await settle();

  const quedas = h.eventos.filter((e) => e.kind === 'engine-down' && e.paneId === 'p');
  assert.equal(quedas.length, 1, 'buffer genuinamente sem fim ainda tem que matar o processo');
  assert.match(quedas[0].data.motivo, /grande demais/);
});
