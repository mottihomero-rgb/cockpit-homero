'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadMain } = require('./main-harness.cjs');

const tick = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}
function json(proc, value) { proc.stdout.emit('data', Buffer.from(JSON.stringify(value) + '\n')); }
async function claude(h, paneId = 'p1') {
  await h.call('pane:start', { paneId, engine: 'claude', cwd: h.HOME });
  return h.spawned.at(-1).proc;
}

test('Claude substituído não troca a sessão, não despeja resposta e não pede permissão no novo chat', async () => {
  const h = loadMain();
  const antigo = await claude(h);
  await claude(h);
  h.clear();
  json(antigo, { type: 'system', subtype: 'init', session_id: 'sessao-antiga' });
  json(antigo, { type: 'assistant', message: { content: [{ type: 'text', text: 'texto antigo' }] } });
  json(antigo, { type: 'control_request', request_id: 'velho', request: { subtype: 'can_use_tool', tool_name: 'Bash', input: { command: 'antigo' } } });
  antigo.emit('error', new Error('falha antiga'));
  antigo.emit('close', 1);
  assert.equal(h.paneEvents().length, 0);
  assert.equal(h.evaluate('pendingApprovals.size'), 0);
  assert.equal(h.evaluate('claudePanes.size'), 1);
});

test('parar Claude descarta texto atrasado e permissão pendente', async () => {
  const h = loadMain();
  const proc = await claude(h);
  json(proc, { type: 'control_request', request_id: 'pedido', request: { subtype: 'can_use_tool', tool_name: 'Bash', input: {} } });
  h.evaluate('emitDelta("p1", "b0", "rascunho antigo")');
  await h.call('pane:stop', { paneId: 'p1', engine: 'claude' });
  h.clear();
  json(proc, { type: 'assistant', message: { content: [{ type: 'text', text: 'atrasado' }] } });
  assert.equal(h.paneEvents().length, 0);
  assert.equal(h.evaluate('pendingApprovals.size'), 0);
  assert.equal(h.evaluate('filaDelta.size'), 0);
  assert.equal(h.evaluate('claudePanes.size'), 0);
});

test('acentos e emoji do Claude sobrevivem a bytes separados entre pacotes', async () => {
  const h = loadMain();
  const proc = await claude(h);
  const text = 'Revisão: ação concluída 🧠';
  const line = Buffer.from(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text }] } }) + '\n');
  for (const byte of line) proc.stdout.emit('data', Buffer.from([byte]));
  assert.equal(h.paneEvents('text-final').at(-1).text, text);
});

test('Codex fechado durante abertura não reaparece quando a resposta atrasada chega', async () => {
  const h = loadMain(), response = deferred();
  h.attachCodex('local', method => method === 'thread/start' ? response.promise : {});
  const opening = h.call('pane:start', { paneId: 'p1', engine: 'codex', cwd: h.HOME });
  await tick();
  assert.equal(h.wire.filter(m => m.method === 'thread/start').length, 1);
  await h.call('pane:stop', { paneId: 'p1', engine: 'codex' });
  h.clear();
  response.resolve({ thread: { id: 'fechada' } });
  assert.equal(await opening, false);
  assert.equal(h.evaluate('codex.paneToThread.size'), 0);
  assert.equal(h.paneEvents('sessao').length, 0);
});

test('duas aberturas Codex no mesmo painel ficam com a mais recente', async () => {
  const h = loadMain(), antiga = deferred();
  let n = 0;
  h.attachCodex('local', method => method === 'thread/start' ? (++n === 1 ? antiga.promise : { thread: { id: 'nova' } }) : {});
  const first = h.call('pane:start', { paneId: 'p1', engine: 'codex', cwd: h.HOME });
  await tick();
  await h.call('pane:start', { paneId: 'p1', engine: 'codex', cwd: h.HOME });
  antiga.resolve({ thread: { id: 'antiga' } });
  assert.equal(await first, false);
  assert.equal(h.evaluate('codex.paneToThread.get("p1")'), 'nova');
  assert.equal(h.evaluate('codex.threadToPane.has("antiga")'), false);
});

test('a reserva de uma conversa Codex vale enquanto o motor ainda está ligando', async () => {
  const h = loadMain(), response = deferred();
  h.attachCodex('local', method => method === 'thread/resume' ? response.promise : {});
  const opening = h.call('pane:start', { paneId: 'p1', engine: 'codex', cwd: h.HOME, resumeId: 'conversa' });
  await tick();
  const rival = h.call('pane:start', { paneId: 'wp1', engine: 'codex', cwd: h.HOME, resumeId: 'conversa' });
  await tick();
  response.resolve({ thread: { id: 'conversa' } });
  const result = await rival;
  await opening;
  assert.equal(result.jaAberta, true);
  assert.equal(h.wire.filter(m => m.method === 'thread/resume').length, 1);
});

test('confirmação atrasada de envio Codex não devolve turno e escolhas ao painel fechado', async () => {
  const h = loadMain(), response = deferred();
  h.attachCodex('local', method => method === 'turn/start' ? response.promise : { thread: { id: 'conversa' } });
  await h.call('pane:start', { paneId: 'p1', engine: 'codex', cwd: h.HOME });
  const sending = h.call('pane:send', { paneId: 'p1', engine: 'codex', text: 'Olá' });
  await tick();
  await h.call('pane:stop', { paneId: 'p1', engine: 'codex' });
  h.clear();
  response.resolve({ turn: { id: 'turno', status: 'inProgress' } });
  await sending;
  assert.equal(h.evaluate('codex.paneTurn.size'), 0);
  assert.equal(h.evaluate('codexPaneSettings.size'), 0);
  assert.equal(h.paneEvents('settings').length, 0);
  assert.ok(h.wire.some(m => m.method === 'turn/interrupt' && m.params.threadId === 'conversa'), 'o turno aceito depois do fechamento precisa ser interrompido');
});

test('o Codex que falhou ao ligar não derruba seu substituto com saída tardia', async () => {
  const h = loadMain();
  const first = h.evaluate('codexStart()');
  const old = h.spawned[0];
  json(old.proc, { id: old.writes[0].id, error: { message: 'initialize falhou' } });
  await assert.rejects(first, /falhou/);
  const second = h.evaluate('codexStart()');
  const current = h.spawned[1];
  old.proc.emit('close', 1);
  json(current.proc, { id: current.writes[0].id, result: {} });
  assert.equal(await second, true);
  assert.equal(h.evaluate('!!conexaoCodex("local").proc'), true);
  assert.ok(old.signal, 'a tentativa mal sucedida não pode ficar como processo órfão');
});

test('Codex preserva UTF-8 do protocolo quando os bytes chegam separados', async () => {
  const h = loadMain();
  const starting = h.evaluate('codexStart()');
  const { proc, writes } = h.spawned[0];
  json(proc, { id: writes[0].id, result: {} });
  await starting;
  h.evaluate('codex.threadToPane.set("fio", "p1")');
  const text = 'Conclusão 🧠';
  const line = Buffer.from(JSON.stringify({ method: 'item/completed', params: { threadId: 'fio', item: { id: 'resposta', type: 'agentMessage', text } } }) + '\n');
  for (const byte of line) proc.stdout.emit('data', Buffer.from([byte]));
  assert.equal(h.paneEvents('text-final').at(-1).text, text);
});

test('queda Codex limpa o turno que sustentava o aviso de agente trabalhando', async () => {
  const h = loadMain();
  const starting = h.evaluate('codexStart()');
  const { proc, writes } = h.spawned[0];
  json(proc, { id: writes[0].id, result: {} });
  await starting;
  h.evaluate('codexPaneDest.set("p1", "local"); codex.paneToThread.set("p1", "fio"); codex.threadToPane.set("fio", "p1"); codex.paneTurn.set("p1", "turno")');
  proc.emit('close', 1);
  assert.equal(h.evaluate('agentesTrabalhando()'), 0);
  assert.equal(h.evaluate('codex.paneToThread.size'), 0);
});

function voz(h) {
  h.put(h.evaluate('VOZ_BIN'), 'programa fictício');
  assert.equal(h.call('voz:vivo', { paneId: 'p1' }).ok, true);
  return h.spawned.at(-1).proc;
}
test('ditado substituído não entrega texto nem fecha o microfone novo', () => {
  const h = loadMain();
  const old = voz(h);
  voz(h);
  h.clear();
  json(old, { type: 'final', text: 'texto antigo' });
  old.emit('close', 0);
  old.emit('error', new Error('falha antiga'));
  assert.equal(h.paneEvents('voz').length, 0);
  assert.equal(h.evaluate('vozAtiva.size'), 1);
});

test('ditado preserva acentos e trata falha de stdin sem exceção não capturada', () => {
  const h = loadMain(), proc = voz(h);
  const text = 'Ação da Márcia';
  const bytes = Buffer.from(JSON.stringify({ type: 'final', text }) + '\n');
  for (const byte of bytes) proc.stdout.emit('data', Buffer.from([byte]));
  assert.equal(h.paneEvents('voz').at(-1).text, text);
  assert.doesNotThrow(() => proc.stdin.emit('error', new Error('EPIPE')));
  assert.equal(h.evaluate('vozAtiva.size'), 0);
});

test('terminal substituído ignora dados e fechamento do processo antigo', () => {
  const h = loadMain();
  const source = fs.readFileSync(path.resolve(__dirname, '../main.js'), 'utf8');
  const start = source.indexOf('function termRodar(');
  const end = source.indexOf('\nfunction termMatar(', start);
  h.evaluate(`globalThis.__ptys = []; globalThis.__term = (() => {
    const abrirPty = () => { const p = { onData(fn) { this.data = fn; }, onErro(fn) { this.error = fn; }, onFim(fn) { this.end = fn; }, matar() {} }; __ptys.push(p); return p; };
    return ${source.slice(start, end)};
  })()`);
  h.evaluate('__term({id:"t1",linha:"fake"}); __term({id:"t1",linha:"fake"})');
  h.clear();
  h.evaluate('__ptys[0].data("velho"); __ptys[0].error(new Error("velho")); __ptys[0].end(1)');
  assert.equal(h.events.filter(e => e.canal === 'term:event').length, 0);
  assert.equal(h.evaluate('terms.get("t1") === __ptys[1]'), true);
});

test('salvar configuração informa falha e preserva o arquivo anterior', () => {
  const h = loadMain();
  const config = h.HOME + '/app-data/config.json';
  h.put(config, JSON.stringify({ tema: 'escura', abas: [] }));
  h.evaluate('fs.renameSync = () => { throw new Error("disco cheio"); }');
  const result = h.call('config:set', { tema: 'clara', abas: [] });
  assert.equal(result.ok, false);
  assert.match(result.error, /salvar/i);
  assert.equal(JSON.parse(h.files.get(config)).tema, 'escura');
});

test('duas imagens salvas no mesmo milissegundo conservam ambos os anexos', () => {
  const h = loadMain();
  const dateNow = Date.now;
  try {
    Date.now = () => 123456;
    const dados = 'data:image/png;base64,' + Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString('base64');
    const a = h.call('imagem:salvar', { dados });
    const b = h.call('imagem:salvar', { dados });
    assert.notEqual(a.arquivo, b.arquivo);
    assert.equal(h.files.has(a.arquivo), true);
    assert.equal(h.files.has(b.arquivo), true);
  } finally { Date.now = dateNow; }
});

test('ajuste Codex que termina depois de fechar não ressuscita configurações do chat', async () => {
  const h = loadMain(), response = deferred();
  h.attachCodex('local', method => method === 'thread/resume' ? response.promise : { thread: { id: 'fio' } });
  await h.call('pane:start', { paneId: 'p1', engine: 'codex', cwd: h.HOME });
  const settings = h.call('pane:settings', { paneId: 'p1', engine: 'codex', effort: 'high' });
  await tick();
  await h.call('pane:stop', { paneId: 'p1', engine: 'codex' });
  h.clear();
  response.resolve({ thread: { id: 'fio' }, reasoningEffort: 'high' });
  assert.equal((await settings).ok, false);
  assert.equal(h.evaluate('codexPaneSettings.size'), 0);
  assert.equal(h.paneEvents('settings').length, 0);
});

test('stop Codex antigo não apaga uma reabertura da MESMA thread no mesmo painel', async () => {
  const h = loadMain(), response = deferred();
  h.attachCodex('local', method => method === 'turn/interrupt' ? response.promise : { thread: { id: 'fio' } });
  await h.call('pane:start', { paneId: 'p1', engine: 'codex', cwd: h.HOME });
  h.evaluate('codex.paneTurn.set("p1", "turno-antigo")');
  const stopping = h.call('pane:stop', { paneId: 'p1', engine: 'codex' });
  await tick();
  await h.call('pane:start', { paneId: 'p1', engine: 'codex', cwd: h.HOME, resumeId: 'fio' });
  response.resolve({});
  await stopping;
  assert.equal(h.evaluate('codex.paneToThread.get("p1")'), 'fio');
  assert.equal(h.evaluate('codex.threadToPane.get("fio")'), 'p1');
  assert.equal(h.evaluate('codexPaneDest.get("p1")'), 'local');
});

test('fechar painel Codex descarta o rascunho de texto ainda não enviado à tela', async () => {
  const h = loadMain();
  h.attachCodex();
  await h.call('pane:start', { paneId: 'p1', engine: 'codex', cwd: h.HOME });
  h.evaluate('emitDelta("p1", "msg", "texto da conversa antiga")');
  await h.call('pane:stop', { paneId: 'p1', engine: 'codex' });
  assert.equal(h.evaluate('filaDelta.size'), 0);
});

test('shutdown invalida aberturas pendentes e limpa conexões antes de reabrir a janela', async () => {
  const h = loadMain(), response = deferred();
  h.attachCodex('local', method => method === 'thread/start' ? response.promise : {});
  const opening = h.call('pane:start', { paneId: 'p1', engine: 'codex', cwd: h.HOME });
  opening.catch(() => {});
  await tick();
  const mic = voz(h);
  h.evaluate('shutdown()');
  response.resolve({ thread: { id: 'atrasada' } });
  await opening.catch(() => false);
  assert.equal(h.evaluate('paneStarts.size'), 0);
  assert.equal(h.evaluate('codex.paneToThread.size'), 0);
  assert.equal(h.evaluate('codexPaneDest.size'), 0);
  assert.equal(h.evaluate('vozAtiva.size'), 0);
  assert.ok(h.spawned.find(item => item.proc === mic).signal);
});

test('aviso de fechamento também conta Gemini e agentes ACP ocupados', () => {
  const h = loadMain();
  h.evaluate('cli.trabalhando = () => 2; acp.trabalhando = () => 1');
  assert.equal(h.evaluate('agentesTrabalhando()'), 3);
});

test('conversa Gemini nova já tem dono e não é duplicada pelo celular', async () => {
  const h = loadMain();
  assert.equal(await h.call('pane:start', { paneId: 'p1', engine: 'gemini', cwd: h.HOME }), true);
  const session = h.paneEvents('sessao').at(-1).id;
  const result = await h.call('pane:start', { paneId: 'wp1', engine: 'gemini', cwd: h.HOME, resumeId: session });
  assert.equal(result.jaAberta, true);
});

test('conversa ACP nova também conserva a trava contra dois donos', async () => {
  const h = loadMain();
  h.evaluate('acp.vivo = pane => pane === "p1"; emitAcp("p1", "sessao", {id:"acp-sessao"})');
  const result = await h.call('pane:start', { paneId: 'wp1', engine: 'acp', cwd: h.HOME, model: 'fake', resumeId: 'acp-sessao' });
  assert.equal(result.jaAberta, true);
});

test('stop antigo não apaga destino VPS de uma retomada ainda pendente no mesmo painel', async () => {
  const h = loadMain(), interruption = deferred(), resume = deferred();
  h.attachCodex('vps', method => method === 'turn/interrupt' ? interruption.promise
    : method === 'thread/resume' ? resume.promise
    : method === 'turn/start' ? { turn: { id: 'novo-turno', status: 'inProgress' } }
    : { thread: { id: 'fio-vps' } });
  await h.call('pane:start', { paneId: 'p1', engine: 'codex', cwd: 'vps:/opt/teste' });
  h.evaluate('codex.paneTurn.set("p1", "turno-antigo")');
  const stop = h.call('pane:stop', { paneId: 'p1', engine: 'codex' });
  await tick();
  const opening = h.call('pane:start', { paneId: 'p1', engine: 'codex', cwd: 'vps:/opt/teste', resumeId: 'fio-vps' });
  await tick();
  interruption.resolve({});
  await stop;
  assert.equal(h.evaluate('destinoDoPane("p1")'), 'vps');
  resume.resolve({ thread: { id: 'fio-vps' } });
  assert.equal(await opening, true);
  assert.equal(h.evaluate('codex.paneTurn.has("p1")'), false, 'o turno interrompido não reaparece na conversa reaberta');
  assert.equal(await h.call('pane:send', { paneId: 'p1', engine: 'codex', text: 'Continuar' }), true);
  assert.equal(h.wire.filter(m => m.method === 'turn/start').at(-1).destino, 'vps');
});

test('escolhas Codex simultâneas são aplicadas na ordem, preservando a última decisão', async () => {
  const h = loadMain(), high = deferred();
  h.attachCodex('local', (method, params) => method === 'thread/resume'
    ? params.config.model_reasoning_effort === 'high' ? high.promise : { thread: { id: 'fio' }, reasoningEffort: 'low' }
    : { thread: { id: 'fio' } });
  await h.call('pane:start', { paneId: 'p1', engine: 'codex', cwd: h.HOME });
  const first = h.call('pane:settings', { paneId: 'p1', engine: 'codex', effort: 'high' });
  const second = h.call('pane:settings', { paneId: 'p1', engine: 'codex', effort: 'low' });
  await tick();
  assert.equal(h.wire.filter(m => m.method === 'thread/resume').length, 1, 'o segundo ajuste aguarda o primeiro terminar no motor');
  high.resolve({ thread: { id: 'fio' }, reasoningEffort: 'high' });
  assert.equal((await first).ok, true);
  assert.equal((await second).ok, true);
  assert.equal(h.evaluate('codexPaneSettings.get("p1").effort'), 'low');
  assert.equal(h.paneEvents('settings').at(-1).effort, 'low');
});

test('escolha Codex na fila não migra para uma conversa reaberta', async () => {
  const h = loadMain(), first = deferred();
  h.attachCodex('local', method => method === 'thread/resume' ? first.promise : { thread: { id: 'fio' } });
  await h.call('pane:start', { paneId: 'p1', engine: 'codex', cwd: h.HOME });
  const a = h.call('pane:settings', { paneId: 'p1', engine: 'codex', effort: 'high' });
  const b = h.call('pane:settings', { paneId: 'p1', engine: 'codex', effort: 'low' });
  await tick();
  await h.call('pane:stop', { paneId: 'p1', engine: 'codex' });
  await h.call('pane:start', { paneId: 'p1', engine: 'codex', cwd: h.HOME, effort: 'medium' });
  first.resolve({ thread: { id: 'fio' }, reasoningEffort: 'high' });
  assert.equal((await a).ok, false);
  assert.equal((await b).ok, false);
  assert.equal(h.wire.filter(m => m.method === 'thread/resume').length, 1);
  assert.equal(h.evaluate('codexPendingSettings.get("p1")?.effort || codexPaneSettings.get("p1").effort'), 'medium');
});
