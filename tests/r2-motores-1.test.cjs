'use strict';
// Testes de guarda da faixa "motores", rodada 2, lote 1 (25/09/2026).
// R2-006 (acp.js)        -> Parar num agente ACP que ignora session/cancel nao pode
//                            travar o turno pra sempre (session/prompt e' msTimeout=0
//                            de proposito; o prazo tem que ser SO' no cancelamento).
// R2-030 (cli-motors.js) -> reabrir conversa GIGANTE do Gemini migrando de runtime
//                            (ex.: instalou o Antigravity) nao pode ler o arquivo
//                            inteiro pra montar o contexto legado (trava o processo
//                            principal do Electron, mesmo bug que o R1-040 corrigiu
//                            por outro caminho).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { criarCli } = require('../cli-motors.js');

/* =============================================================== R2-006 */

function montarAcp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-acp-r2-006-'));
  const timers = new Map();
  let seq = 0;
  const mod = { exports: {} };
  const eventos = [];
  const ctx = vm.createContext({ require: require('node:module').createRequire(path.join(__dirname, '../acp.js')), module: mod, Buffer, console,
    setTimeout(fn, ms) { const id = ++seq; timers.set(id, { fn, ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../acp.js'), 'utf8'), ctx);
  const procs = [];
  const acp = mod.exports.criarAcp({
    HOME: dir, pastaDados: () => dir, buildEnv: () => ({}),
    emit: (paneId, kind, data) => eventos.push({ paneId, kind, ...data }),
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
  return { acp, procs, dir, eventos,
    tick(ms) { for (const [id, timer] of [...timers]) if (timer.ms === ms) { timers.delete(id); timer.fn(); } },
  };
}
const settle = () => new Promise(resolve => setImmediate(resolve));
const prompts = p => p.requests.filter(m => m.method === 'session/prompt');

test('R2-006: agente ACP que ignora session/cancel nao trava o turno pra sempre (watchdog do Parar fecha o turno)', async t => {
  const h = montarAcp(t);
  await h.acp.start('p', { comando: 'falso', cwd: h.dir });
  const p = h.procs[0];
  h.acp.enviar('p', 'oi', []);
  assert.equal(prompts(p).length, 1);

  const ok = h.acp.interromper('p');
  assert.equal(ok, true);
  // o agente falso NAO responde nem ao session/cancel nem ao session/prompt --
  // sem conserto, mandar(session/prompt, msTimeout=0) nunca arma timer nenhum
  h.tick(7500);
  await settle();

  assert.ok(h.eventos.some(e => e.paneId === 'p' && e.kind === 'turn-end'),
    'sem o conserto o turno fica preso pra sempre: turn-end nunca sai depois do Parar');

  // turno fechado = P.busy liberou; um pedido novo tem que sair na hora, nao
  // ficar preso atras do turno que travou
  const antes = prompts(p).length;
  h.acp.enviar('p', 'proxima', []);
  assert.equal(prompts(p).length, antes + 1,
    'depois do watchdog fechar o turno, o proximo pedido precisa poder sair (nao fica na fila pra sempre)');
});

test('R2-006: agente que responde ao cancelamento antes do prazo fecha normal (sem duplicar turn-end nem mostrar erro)', async t => {
  const h = montarAcp(t);
  await h.acp.start('p', { comando: 'falso', cwd: h.dir });
  const p = h.procs[0];
  h.acp.enviar('p', 'oi', []);
  const idDoPrompt = prompts(p)[0].id;

  h.acp.interromper('p');
  // agente honrou o cancel e devolveu o session/prompt ANTES do prazo de 7.5s
  p.reply(idDoPrompt, { stopReason: 'cancelled' });
  await settle();

  // o watchdog do cancelamento foi limpo em fimDoTurno(): disparar o tick nao
  // pode gerar um segundo fecho de turno nem um erro fantasma
  h.tick(7500);
  await settle();

  const turnEnds = h.eventos.filter(e => e.paneId === 'p' && e.kind === 'turn-end');
  assert.equal(turnEnds.length, 1,
    'turn-end nao pode disparar 2x (uma vez pelo prompt resolvido, outra pelo watchdog atrasado)');
  assert.ok(!h.eventos.some(e => e.paneId === 'p' && e.kind === 'note' && e.error),
    'resposta normal ao cancelamento nao pode virar mensagem de erro na tela');
});

/* =============================================================== R2-030 */

function montarCliR2030() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-r2-030-'));
  const eventos = [];
  const ultimoProc = { atual: null };
  const cli = criarCli({
    HOME: home,
    pastaDados: () => path.join(home, 'app'),
    temBin: (bin) => bin === 'agy',   // Mac ja tem o Antigravity instalado
    acharBin: (bin) => '/fake/bin/' + bin,
    buildEnv: () => ({}),
    emit: (paneId, kind, data) => eventos.push({ paneId, kind, ...data }),
    matarGrupo: () => {},
    spawnBin: () => {
      const p = new EventEmitter();
      p.stdout = new PassThrough(); p.stderr = new PassThrough();
      // stdin de mentira: so' precisa gravar o que enviar() escreveu, sem
      // depender de timing assincrono de stream pra o teste ler de volta
      p.stdin = { on: () => {}, end: (chunk) => { p.stdinEscrito = chunk; } };
      ultimoProc.atual = p;
      return p;
    },
  });
  return { cli, home, eventos, ultimoProc };
}

test('R2-030: reabrir conversa GIGANTE do Gemini migrando de runtime (Antigravity instalado) nao le o arquivo inteiro', () => {
  const { cli, home, ultimoProc } = montarCliR2030();
  const id = 'sessao-legado-gigante';
  const file = path.join(home, 'app', 'gemini', id + '.jsonl');
  fs.mkdirSync(path.dirname(file), { recursive: true });

  // arquivo do proprio Cockpit (cockpit:1) pra esta conversa, ja gravado com
  // runtime 'gemini': muito acima do teto (4 MB) e, dentro da cauda de 1 MB
  // que fica perto do fim, mensagens legadas + o marcador de runtime antigo
  const linhaGrande = JSON.stringify({ role: 'bot', text: 'x'.repeat(2000) }) + '\n';
  const fd = fs.openSync(file, 'w');
  fs.writeSync(fd, JSON.stringify({ cockpit: 1, id, runtime: 'gemini', cwd: home, model: '', criado: Date.now() }) + '\n');
  const bloco = Buffer.from(linhaGrande.repeat(2000)); // ~4 MB por bloco
  for (let i = 0; i < 3; i++) fs.writeSync(fd, bloco); // ~12 MB de massa
  fs.writeSync(fd, JSON.stringify({ role: 'user', text: 'MENSAGEM-LEGADO-MARCADOR pergunta' }) + '\n');
  fs.writeSync(fd, JSON.stringify({ role: 'bot', text: 'MENSAGEM-LEGADO-MARCADOR resposta' }) + '\n');
  fs.writeSync(fd, JSON.stringify({ retomada: 'nativo-anterior', runtime: 'gemini' }) + '\n');
  fs.closeSync(fd);
  assert.ok(fs.statSync(file).size > 4 * 1024 * 1024, 'arquivo de teste precisa ficar acima do teto');

  const original = fs.readFileSync;
  let leuOArquivoInteiro = false;
  fs.readFileSync = (...args) => {
    if (String(args[0]) === file) leuOArquivoInteiro = true;
    return original.apply(fs, args);
  };
  let ok;
  try {
    ok = cli.start('p', { cwd: home, resumeId: id });
  } finally {
    fs.readFileSync = original;
  }

  assert.equal(ok, true);
  assert.equal(leuOArquivoInteiro, false,
    'sem o conserto, historico(fonte) chama fs.readFileSync no arquivo inteiro so pra montar o contexto legado (trava o processo principal do Electron)');

  // o contexto legado precisa ter pego pelo menos 1 mensagem da cauda -- senao
  // a migracao de runtime perde toda a memoria da conversa antiga em silencio
  cli.enviar('p', 'pedido novo depois de migrar', []);
  const proc = ultimoProc.atual;
  assert.ok(proc && proc.stdinEscrito, 'enviar() precisa ter escrito no stdin do processo');
  assert.match(String(proc.stdinEscrito), /MENSAGEM-LEGADO-MARCADOR/,
    'o contexto legado lido da cauda do arquivo deveria ter ido junto no pedido pro Antigravity');
});

test('R2-030: migracao de runtime com arquivo PEQUENO continua funcionando (comportamento de hoje preservado)', () => {
  const { cli, home, ultimoProc } = montarCliR2030();
  const id = 'sessao-legado-pequena';
  const file = path.join(home, 'app', 'gemini', id + '.jsonl');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, [
    JSON.stringify({ cockpit: 1, id, runtime: 'gemini', cwd: home, model: '', criado: Date.now() }),
    JSON.stringify({ role: 'user', text: 'MENSAGEM-LEGADO-PEQUENA pergunta' }),
    JSON.stringify({ role: 'bot', text: 'MENSAGEM-LEGADO-PEQUENA resposta' }),
    JSON.stringify({ retomada: 'nativo-anterior', runtime: 'gemini' }),
  ].join('\n') + '\n');

  const ok = cli.start('p', { cwd: home, resumeId: id });
  assert.equal(ok, true);

  cli.enviar('p', 'pedido novo depois de migrar', []);
  const proc = ultimoProc.atual;
  assert.match(String(proc.stdinEscrito), /MENSAGEM-LEGADO-PEQUENA/,
    'arquivo pequeno continua indo pelo caminho antigo (historico) e tem que manter o contexto legado');
});
