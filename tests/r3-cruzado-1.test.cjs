'use strict';

// Testes de guarda do lote "cruzado" (R3), faixa consertador, rodada 3/3.
// Cobrem: R3-048 (imagem grande de ferramenta MCP some calada ao reabrir conversa do
// Codex), R3-009 (shutdown() nao esperava o kill de Gemini, ACP/Grok nem terminal), R3-010
// (pane:estado so enxergava Claude/Codex — celular achava que Gemini/ACP tinham terminado)
// e R3-025 (legenda que chega antes da foto duplica aviso na caixa de entrada).
// Padrao de arquivo: tests/main-harness.cjs + tests/r1-main-4.test.cjs, tests/r2-main-3.test.cjs
// e tests/auditoria-web-modulos-20260921.test.cjs (isolado, sem VM, pra cli-motors.js/acp.js/plataforma.js).

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { loadMain } = require('./main-harness.cjs');

// ===================== R3-048 =====================
// codex-protocol.js: historyItem() nao pode virar '(0 imagens)' mudo quando a UNICA imagem
// de um mcpToolCall/dynamicToolCall foi cortada por tamanho ao reconstruir o historico.

test('R3-048: imagem grande sozinha vira aviso "grande demais", nao "(0 imagens)" mudo', () => {
  const { historyItem } = require('../codex-protocol');
  const grande = 'A'.repeat(3 * 1024 * 1024 + 1);   // acima do LIM_IMG_HIST (3 MB)
  const item = historyItem({
    type: 'mcpToolCall', server: 'x', tool: 'print',
    result: { content: [{ type: 'image', mimeType: 'image/png', data: grande }] },
  });
  assert.notEqual(item.output, '(0 imagens)', 'sem o conserto, a unica imagem descartada vira esta frase confusa');
  assert.match(item.output, /grande.*demais/i);
  assert.equal(item.imagens, undefined, 'nao sobrou imagem valida nenhuma pra mandar pro renderer');
});

test('R3-048: caso misto (1 imagem valida + 1 grande, sem texto) cita as duas contagens', () => {
  const { historyItem } = require('../codex-protocol');
  const grande = 'A'.repeat(3 * 1024 * 1024 + 1);
  const item = historyItem({
    type: 'dynamicToolCall',
    contentItems: [
      { type: 'image', mimeType: 'image/png', data: 'AAAA' },
      { type: 'image', mimeType: 'image/png', data: grande },
    ],
  });
  assert.match(item.output, /1 imagem/);
  assert.match(item.output, /grande.*demais/i);
  assert.equal(item.imagens.length, 1);
});

test('R3-048: regressão — texto com 1 imagem válida (sem descarte) continua igual', () => {
  const { historyItem } = require('../codex-protocol');
  const item = historyItem({ type: 'mcpToolCall', server: 'teste', tool: 'print', result: { content: [
    { type: 'text', text: 'Arquivo salvo na pasta da entrega.' },
    { type: 'image', mimeType: 'image/png', data: 'AAAA' },
  ] } });
  assert.equal(item.output, 'Arquivo salvo na pasta da entrega.');
  assert.equal(item.imagens.length, 1);
});

// ===================== R3-009 =====================
// shutdown() tem de esperar o kill de Gemini (cli), ACP/Grok (acp) e do terminal embutido,
// nao so' disparar e seguir (senao o processo filho sobra orfao quando o app fecha rapido).

test('R3-009: cli.parar() (Gemini) devolve a Promise de matarGrupo em vez de disparar e esquecer', async () => {
  const { criarCli } = require('../cli-motors');
  let resolver;
  const cli = criarCli({
    HOME: '/tmp', pastaDados: () => '/tmp/cockpit-r3009-dados', temBin: () => true,
    acharBin: nome => nome, buildEnv: () => ({}), emit: () => {},
    matarGrupo: () => new Promise((r) => { resolver = r; }),   // simula matarGrupoExtra: so' resolve quando o processo morre
    spawnBin: () => {
      const proc = new EventEmitter();
      proc.stdin = new EventEmitter(); proc.stdin.end = () => {};
      proc.stdout = new EventEmitter(); proc.stderr = new EventEmitter();
      return proc;
    },
  });
  cli.start('p1', {});
  cli.enviar('p1', 'oi');   // so' agora nasce o proc de verdade (start() nao spawna sozinho)

  const p = cli.parar('p1');
  assert.equal(typeof p.then, 'function', 'parar() tem de devolver uma Promise, senao fechar() nao tem o que esperar');
  let terminou = false;
  p.then(() => { terminou = true; });
  await new Promise((r) => setImmediate(r));
  assert.equal(terminou, false, 'sem o conserto, parar() nao devolvia nada e o chamador nunca esperava o processo morrer de verdade');
  resolver();
  await p;
  assert.equal(terminou, true);
});

test('R3-009: acp.parar() (ACP/Grok) devolve a Promise de matarProcesso em vez de disparar e esquecer', async () => {
  const { criarAcp } = require('../acp');
  let resolver;
  const acp = criarAcp({
    emit: () => {},
    // handshake fica pendente pra sempre de proposito (stdin "aceita" escrita mas ninguem
    // responde) — assim st.proc fica de pe' quando chamamos parar(), igual um agente real
    // travado no meio de um turno
    spawnBin: () => { const p = new EventEmitter(); p.stdin = new EventEmitter(); p.stdin.write = () => true; p.stdout = new EventEmitter(); p.stderr = new EventEmitter(); return p; },
    buildEnv: () => ({}), matarProcesso: () => new Promise((r) => { resolver = r; }),
    HOME: '/tmp', pastaDados: () => '/tmp/cockpit-r3009-acp',
  });
  acp.start('p1', { comando: 'echo teste' }).catch(() => {});
  const p = acp.parar('p1');
  assert.equal(typeof p.then, 'function', 'parar() tem de devolver uma Promise, senao fechar() nao tem o que esperar');
  assert.ok(resolver, 'matarProcesso() tem de rodar na hora, com o processo ainda de pe');
  let terminou = false;
  p.then(() => { terminou = true; });
  await new Promise((r) => setImmediate(r));
  assert.equal(terminou, false, 'sem o conserto, parar() nao devolvia nada e o chamador nunca esperava o processo morrer de verdade');
  resolver();
  await p;
  assert.equal(terminou, true);
});

test('R3-009: ptyMac.matar() (terminal embutido) so resolve quando o processo fecha de verdade', () => {
  const proc = new EventEmitter();
  proc.stdin = new EventEmitter(); proc.stdin.end = () => {};
  proc.stdout = new EventEmitter(); proc.stderr = new EventEmitter();
  proc.stdio = [proc.stdin, proc.stdout, proc.stderr, new EventEmitter()];
  proc.kill = () => {};
  const modulo = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../plataforma.js'), 'utf8'), {
    module: modulo, process: { platform: 'darwin', env: {} }, setTimeout, clearTimeout, Buffer,
    require: nome => nome === 'child_process' ? { spawn: () => proc } : nome === 'fs'
      ? { statSync: () => ({ isFile: () => true }), accessSync() {}, constants: fs.constants } : require(nome),
  });
  const pty = modulo.exports.abrirPty({ linha: 'teste', cols: 80, rows: 24, cwd: '/teste', env: {}, ptyBridge: '/teste.py' });
  const resultado = pty.matar();
  assert.equal(typeof resultado?.then, 'function', 'matar() tem de devolver uma Promise, senao shutdown() nao espera o pty morrer');
  let terminou = false;
  resultado.then(() => { terminou = true; });
  assert.equal(terminou, false, 'nao pode ja ter resolvido antes do processo realmente fechar');
  proc.emit('close', 0);
  return resultado.then(() => assert.equal(terminou, true));
});

test('R3-009: shutdown() so termina DEPOIS que cli.fechar(), acp.fechar() e o terminal terminarem', async () => {
  const h = loadMain();
  h.evaluate(`
    globalThis.__ordem = [];
    cli.fechar = () => new Promise((r) => { globalThis.__resolverCli = () => { globalThis.__ordem.push('cli'); r(); }; });
    acp.fechar = () => new Promise((r) => { globalThis.__resolverAcp = () => { globalThis.__ordem.push('acp'); r(); }; });
    terms.set('t1', { matar: () => new Promise((r) => { globalThis.__resolverTerm = () => { globalThis.__ordem.push('term'); r(); }; }) });
  `);
  const p = h.evaluate('shutdown()');
  let terminou = false;
  p.then(() => { terminou = true; });
  await new Promise((r) => setImmediate(r));
  assert.equal(terminou, false, 'sem esperar cli/acp/terminal, shutdown() terminava antes deles morrerem de verdade');
  assert.equal(h.evaluate('terms.size'), 0, 'o terminal tem de sair do mapa na hora, antes do kill terminar');
  h.evaluate('globalThis.__resolverCli()');
  await new Promise((r) => setImmediate(r));
  assert.equal(terminou, false, 'ainda falta acp e terminal');
  h.evaluate('globalThis.__resolverAcp()');
  await new Promise((r) => setImmediate(r));
  assert.equal(terminou, false, 'ainda falta o terminal');
  h.evaluate('globalThis.__resolverTerm()');
  await p;
  assert.equal(terminou, true);
  assert.deepEqual(Array.from(h.evaluate('globalThis.__ordem')), ['cli', 'acp', 'term']);
});

// ===================== R3-010 =====================
// pane:estado (reconexao do celular) so' enxergava Claude e Codex — um turno real de Gemini
// ou ACP/Grok em andamento era relido como "terminou", e o celular limpava a tela no meio
// de uma resposta que ainda estava chegando.

test('R3-010: estadoPane() enxerga um painel Gemini ocupado de verdade (fluxo real, sem mock)', async () => {
  const h = loadMain();
  await h.call('pane:start', { paneId: 'p1', engine: 'gemini', cwd: h.HOME });
  assert.equal(h.evaluate("estadoPane('p1').busy"), false, 'painel recem-aberto, sem mensagem, nao esta ocupado');
  await h.call('pane:send', { paneId: 'p1', engine: 'gemini', text: 'oi' });
  assert.equal(h.evaluate("estadoPane('p1').busy"), true,
    'sem o conserto, estadoPane() nao olhava o Gemini e o celular achava que o turno tinha acabado');
  h.evaluate("cli.parar('p1', true)");
  assert.equal(h.evaluate("estadoPane('p1').busy"), false, 'turno concluido: nao pode continuar ocupado');
});

test('R3-010: estadoPane() enxerga um painel ACP/Grok ocupado (wiring de main.js)', () => {
  const h = loadMain();
  // acp.ocupado() de verdade exige um turno de agente completo (RPC); aqui testamos o
  // FIO que liga estadoPane() a ele, no mesmo padrao ja usado no codigo pra cli/acp.trabalhando().
  h.evaluate("acp.ocupado = paneId => paneId === 'p1';");
  assert.equal(h.evaluate("estadoPane('p1').busy"), true,
    'sem o conserto, estadoPane() nao chamava acp.ocupado() e o celular achava que o ACP/Grok tinha terminado');
  assert.equal(h.evaluate("estadoPane('outro').busy"), false);
});

test('R3-025: legenda chegando ANTES da foto nao duplica aviso quando a foto chega depois', () => {
  const h = loadMain();
  const MTIME_TXT = Date.now() - 100000;   // fora da janela de "recem-escrito" (700ms)
  const MTIME_JPG = Date.now() - 90000;

  h.evaluate(`
    globalThis.__avisos = [];
    win = { isDestroyed: () => false, webContents: {
      isLoading: () => false,
      send: (canal, dados) => { globalThis.__avisos.push(dados); },
    } };
    inboxOuvinte = true;
    // 1a varredura: so a legenda chegou, a foto ainda esta sendo baixada por um robo
    fs.readdirSync = () => ['foto.txt'];
    fs.statSync = () => ({ isFile: () => true, mtimeMs: ${MTIME_TXT} });
    fs.readFileSync = () => 'Foto da conta de luz';
  `);
  h.evaluate('varrerInbox()');

  assert.equal(h.evaluate('globalThis.__avisos.length'), 1, '1a varredura tem de anunciar so a legenda solta');
  assert.equal(h.evaluate('globalThis.__avisos[0].tipo'), 'texto');
  assert.equal(h.evaluate('globalThis.__avisos[0].texto'), 'Foto da conta de luz');

  // 2a varredura: a foto terminou de gravar, o .txt continua exatamente igual na pasta
  h.evaluate(`
    fs.readdirSync = () => ['foto.txt', 'foto.jpg'];
    fs.statSync = (caminho) => ({
      isFile: () => true,
      mtimeMs: String(caminho).endsWith('.jpg') ? ${MTIME_JPG} : ${MTIME_TXT},
    });
  `);
  h.evaluate('varrerInbox()');

  assert.equal(h.evaluate('globalThis.__avisos.length'), 2, '2a varredura: so um evento novo, o da imagem');
  assert.equal(h.evaluate('globalThis.__avisos[1].tipo'), 'imagem');
  assert.equal(h.evaluate('globalThis.__avisos[1].legenda'), 'Foto da conta de luz');
  // Sem o conserto, substituiuNome nao existe e a tela fica com as DUAS tarjas (a mesma
  // frase duas vezes): esta e a linha que falha sem o R3-025.
  assert.equal(
    h.evaluate('globalThis.__avisos[1].substituiuNome'),
    'foto.txt',
    'sem isto a tarja de texto solta nunca e apagada quando a imagem chega: fica duplicado',
  );
});
