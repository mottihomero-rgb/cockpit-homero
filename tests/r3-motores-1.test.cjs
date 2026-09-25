'use strict';
/* Guarda dos consertos da faixa "motores" (rodada 3, lote 1) em acp.js:
   R3-047 - imagem de passo grande demais some sem aviso
   R3-046 - stdout sem '\n' cresce sem teto e trava o processo principal */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const acp = require('../acp.js');

// ---------- R3-047 ----------
test('R3-047: imagem grande demais entra no texto do passo em vez de sumir calada', () => {
  const grande = 'A'.repeat(4 * 1024 * 1024);      // acima de LIM_IMG_PASSO (3MB)
  const noLimite = 'B'.repeat(3 * 1024 * 1024);     // dentro do limite
  const content = [
    { type: 'content', content: { type: 'image', mimeType: 'image/png', data: grande } },
    { type: 'content', content: { type: 'image', mimeType: 'image/png', data: noLimite } },
    { type: 'content', content: { type: 'image', mimeType: 'image/png', data: noLimite } },
    { type: 'content', content: { type: 'image', mimeType: 'image/png', data: noLimite } },
    { type: 'content', content: { type: 'image', mimeType: 'image/png', data: noLimite } },
  ];
  const st = {};
  const eventos = acp.traduzirUpdate(st, {
    sessionUpdate: 'tool_call', toolCallId: 'c1', kind: 'other', title: 'Tirar print', status: 'completed', content,
  });
  const fim = eventos.find((e) => e.kind === 'tool-end');
  assert.ok(fim, 'devia gerar um tool-end');
  assert.equal(fim.imagens.length, 4, 'so as 4 dentro do limite entram nas imagens');
  assert.match(fim.output, /1 imagem grande\(s\) demais para mostrar/, fim.output);
});

test('R3-047: sem imagem descartada, o texto do passo não ganha frase nenhuma', () => {
  const st = {};
  const eventos = acp.traduzirUpdate(st, {
    sessionUpdate: 'tool_call', toolCallId: 'c2', kind: 'execute', title: 'Bash', status: 'completed',
    content: [{ type: 'content', content: { type: 'text', text: 'ok' } }],
  });
  const fim = eventos.find((e) => e.kind === 'tool-end');
  assert.equal(fim.output, 'ok');
});

test('R3-047: conteudoDaFerramenta sempre devolve a contagem de descartadas', () => {
  const c = acp.conteudoDaFerramenta([{ type: 'content', content: { type: 'text', text: 'x' } }]);
  assert.equal(c.imagens.descartadas, 0, 'sem imagem nao descarta nada, mas o campo tem que existir');
});

// ---------- R3-046 ----------
function montarHarness(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-acp-r3-'));
  const eventos = [];
  const procs = [];
  const instancia = acp.criarAcp({
    HOME: dir, pastaDados: () => dir, buildEnv: () => ({}),
    emit: (paneId, kind, data) => eventos.push({ paneId, kind, data }),
    matarProcesso(proc) { proc.emit('close', 0); },   // mesmo fake do harness de auditoria-acp-20260921
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

test('R3-046: stdout sem quebra de linha acima do teto mata o processo em vez de crescer pra sempre', async (t) => {
  const h = montarHarness(t);
  await h.acp.start('p', { comando: 'falso', cwd: h.dir });
  const p = h.procs[0];

  const inicio = Date.now();
  // uma unica mensagem (ex.: imagem grande em base64) sem '\n', acima do teto de 24MB
  p.stdout.write(Buffer.alloc(25 * 1024 * 1024, 'a'));
  await settle(); await settle();
  const duracao = Date.now() - inicio;

  const quedas = h.eventos.filter((e) => e.kind === 'engine-down' && e.paneId === 'p');
  assert.equal(quedas.length, 1, 'devia derrubar o painel em vez de deixar o buffer crescer calado');
  assert.match(quedas[0].data.motivo, /grande demais/);
  // prova que nao ficou preso num loop sincrono gigante (sem o teto, so' o indexOf
  // já custa caro, e a app real trava; aqui teria que ser rapido)
  assert.ok(duracao < 2000, 'demorou ' + duracao + 'ms - devia ser quase instantaneo');

  // painel morreu limpo: um start novo no mesmo id funciona, sem promessa antiga pendurada
  const segundo = await h.acp.start('p', { comando: 'falso', cwd: h.dir });
  assert.equal(segundo, true);
  assert.equal(h.procs.length, 2);
});

test('R3-046: dado normal (com quebras de linha) continua fluindo sem cortar nada', async (t) => {
  const h = montarHarness(t);
  await h.acp.start('p', { comando: 'falso', cwd: h.dir });
  const p = h.procs[0];
  p.stdout.write(JSON.stringify({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 's0', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'oi' } } } }) + '\n');
  await settle(); await settle();
  const quedas = h.eventos.filter((e) => e.kind === 'engine-down');
  assert.equal(quedas.length, 0, 'linha normal nao pode derrubar o painel');
});
