'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const { criarSomConclusao } = require('../som-conclusao');
const { loadMain } = require('./main-harness.cjs');
const settle = () => new Promise(setImmediate);

function audio(options = {}) {
  const timers = new Map(), procs = []; let seq = 0;
  const som = criarSomConclusao({ arquivo: '/som.wav', plataforma: 'darwin',
    agendar(fn, ms) { const id = ++seq; timers.set(id, { fn, ms }); return id; },
    cancelarTimer(id) { timers.delete(id); },
    spawn(bin, args, opts) { const p = new EventEmitter(); p.kill = s => { p.signal = s; }; procs.push({ p, bin, args, opts }); return p; }, ...options });
  return { som, procs, timers, tick(ms) { for (const [id, t] of [...timers]) if (t.ms === ms) { timers.delete(id); t.fn(); } } };
}
function start(h, pane = 'p', turnId = 't') { h.som.evento(pane, 'busy', { turnId }); }
function end(h, pane = 'p', turnId = 't', resultado = 'sucesso') { h.som.evento(pane, 'turn-end', { turnId, resultado }); }
const audios = h => h.spawned.filter(p => p.bin === '/usr/bin/afplay');
function tickMain(h) { for (const [id, fn] of [...h.timers]) { h.timers.delete(id); fn(); } }

test('sucesso vivo toca uma vez após silêncio, independentemente de foco/duração e sem shell', () => {
  const h = audio(); start(h); end(h); end(h); h.som.evento('p', 'turn-end', {});
  assert.equal(h.procs.length, 0); h.tick(1500); assert.equal(h.procs.length, 1);
  assert.deepEqual(h.procs[0].args, ['/som.wav']); assert.equal(h.procs[0].opts.shell, undefined);
  start(h); end(h); h.tick(1500); assert.equal(h.procs.length, 1);
  h.procs[0].p.emit('close', 0); assert.equal(h.timers.size, 0);
});
test('replay sem busy, erro, interrupção, queda e fechamento não anunciam sucesso', async () => {
  for (const modo of ['replay', 'erro', 'cancelado', 'cancelar', 'engine-down', 'shutdown']) {
    const h = audio();
    if (modo !== 'replay') start(h);
    if (['erro', 'cancelado'].includes(modo)) end(h, 'p', 't', modo);
    else { end(h); if (modo === 'cancelar') h.som.cancelar('p'); if (modo === 'engine-down') h.som.evento('p', modo); if (modo === 'shutdown') await h.som.fechar(); }
    h.tick(1500); assert.equal(h.procs.length, 0, modo);
  }
});
test('continuação Claude sem busy cancela aviso anterior e permite exatamente o último', () => {
  for (const atividade of ['turn-activity', 'text-delta', 'text-final', 'think-delta', 'tool-start']) {
    const h = audio(); start(h); end(h); h.som.evento('p', atividade, { text: 'continua' });
    h.tick(1500); assert.equal(h.procs.length, 0); end(h); h.tick(1500); assert.equal(h.procs.length, 1);
  }
});
test('fila nova e conclusão antiga não atropelam turno atual; conclusão terminal antiga não toca', () => {
  const h = audio(); start(h); end(h); start(h, 'p', 'novo'); end(h); h.tick(1500); assert.equal(h.procs.length, 0);
  end(h, 'p', 'novo'); h.tick(1500); assert.equal(h.procs.length, 1);
});
test('áudio serializado respeita continuação enquanto aguarda outro painel', () => {
  const h = audio(); start(h, 'a'); end(h, 'a'); h.tick(1500);
  start(h, 'b'); end(h, 'b'); h.tick(1500);
  h.som.evento('b', 'text-delta', { text: 'mais' }); end(h, 'b');
  h.procs[0].p.emit('close', 0); assert.equal(h.procs.length, 1, 'fila antiga não fura novo silêncio');
  h.tick(1500); assert.equal(h.procs.length, 2);
});
test('timeout mata player preso e shutdown aguarda close ou garantia, sem nova reprodução', async () => {
  const h = audio(); start(h); end(h); h.tick(1500); h.tick(4000); assert.equal(h.procs[0].p.signal, 'SIGKILL');
  h.tick(300); start(h, 'b'); end(h, 'b'); h.tick(1500); assert.equal(h.procs.length, 2);
  let fechou = false; const pronto = h.som.fechar().then(() => { fechou = true; }); await settle(); assert.equal(fechou, false);
  assert.equal(h.procs[1].p.signal, 'SIGKILL'); h.procs[1].p.emit('close', 0); await pronto;
  start(h, 'c'); end(h, 'c'); h.tick(1500); assert.equal(h.procs.length, 2); assert.equal(h.timers.size, 0);
});
test('falha do player não propaga para o motor; outra plataforma não tenta afplay', async () => {
  const h = audio({ spawn() { throw new Error('arquivo ausente'); } }); start(h); end(h); assert.doesNotThrow(() => h.tick(1500)); await h.som.fechar();
  const linux = audio({ plataforma: 'linux' }); start(linux); end(linux); linux.tick(1500); assert.equal(linux.procs.length, 0); await linux.som.fechar();
});

async function codex(destino = 'local') {
  const h = loadMain(); h.attachCodex(destino);
  await h.call('pane:start', { paneId: 'p', engine: 'codex', cwd: destino === 'local' ? h.HOME : destino + ':/projeto', resumeId: 'thread-' + destino });
  h.notify = (method, turn = {}) => h.incoming(destino, { method, params: { threadId: 'thread-' + destino, turn: { id: 'turn-' + destino, ...turn } } });
  return h;
}
test('main Codex local/remoto: completed+idle+duplicata toca uma vez; histórico não toca', async () => {
  for (const destino of ['local', 'vps']) {
    const h = await codex(destino); h.notify('turn/completed', { status: 'completed' }); tickMain(h); assert.equal(audios(h).length, 0);
    h.notify('turn/started'); h.notify('turn/completed', { status: 'completed' }); h.incoming(destino, {method:'thread/status/changed',params:{threadId:'thread-'+destino,status:{type:'idle'}}}); h.notify('turn/completed', { status: 'completed' });
    tickMain(h); assert.equal(audios(h).length, 1, destino);
  }
});
test('main Codex: falha, interrupção e cancelamento explícito nunca tocam', async () => {
  for (const status of ['failed', 'interrupted', 'cancelar']) {
    const h = await codex(); h.notify('turn/started');
    if (status === 'cancelar') await h.call('pane:interrupt', { paneId: 'p', engine: 'codex' });
    h.notify('turn/completed', { status: status === 'cancelar' ? 'completed' : status }); tickMain(h); assert.equal(audios(h).length, 0, status);
  }
});
test('main Claude: resposta curta e continuação sem busy dão um som; result de erro/parar não', async () => {
  const h = loadMain(); await h.call('pane:start', { paneId: 'p', engine: 'claude', cwd: h.HOME });
  await h.call('pane:send', { paneId: 'p', engine: 'claude', text: 'pedido' });
  h.evaluate("claudeMessage('p', {type:'result', is_error:false, subtype:'success'}); emit('p','tool-start',{id:'continua'});");
  tickMain(h); assert.equal(audios(h).length, 0);
  h.evaluate("claudeMessage('p', {type:'result', is_error:false, subtype:'success'});"); tickMain(h); assert.equal(audios(h).length, 1); audios(h)[0].proc.emit('close', 0);
  await h.call('pane:send', { paneId: 'p', engine: 'claude', text: 'outro' }); h.evaluate("claudeMessage('p', {type:'result', is_error:true});"); tickMain(h); assert.equal(audios(h).length, 1);
  await h.call('pane:send', { paneId: 'p', engine: 'claude', text: 'parar' }); await h.call('pane:interrupt', { paneId: 'p', engine: 'claude' }); h.evaluate("claudeMessage('p', {type:'result', is_error:false});"); tickMain(h); assert.equal(audios(h).length, 1);
});
test('main Gemini/Antigravity: exige resultado e saída zero, erro/cancelamento ficam silenciosos', async () => {
  for (const modo of ['success', 'agy-success', 'error', 'missing', 'cancel', 'unknown']) {
    const h = loadMain(); await h.call('pane:start', { paneId: 'p', engine: 'gemini', cwd: h.HOME });
    await h.call('pane:send', { paneId: 'p', engine: 'gemini', text: 'pedido' }); const p = h.spawned.at(-1).proc;
    if (modo === 'cancel') await h.call('pane:interrupt', { paneId: 'p', engine: 'gemini' });
    if (modo !== 'missing') p.stdout.emit('data', Buffer.from(JSON.stringify(modo === 'agy-success' ? {event:'result',result:{status:'SUCCESS'}} : { type: 'result', status: modo === 'error' ? 'error' : modo === 'unknown' ? undefined : 'success' }) + '\n'));
    p.emit('close', 0); tickMain(h); assert.equal(audios(h).length, ['success', 'agy-success'].includes(modo) ? 1 : 0, modo);
  }
});
test('main ACP/Grok: end_turn toca; erro/refusal/cancelled e resposta tardia após cancel não', async () => {
  for (const motivo of ['end_turn', 'refusal', 'cancelled', 'erro', 'cancelar']) {
    const h = loadMain(); const pronto = h.call('pane:start', { paneId: 'p', engine: 'grok', cwd: h.HOME }); await settle();
    const record = h.spawned.at(-1), p = record.proc;
    const responder = (method, result, error) => { const req = record.writes.filter(x => x.method === method).at(-1); assert.ok(req, method); p.stdout.emit('data', Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: req.id, ...(error ? {error} : {result}) }) + '\n')); };
    responder('initialize', { agentCapabilities: {}, authMethods: [{id:'cached_token'}] }); await settle(); responder('authenticate', {}); await settle(); responder('session/new', { sessionId: 's1' }); await pronto;
    await h.call('pane:send', { paneId: 'p', engine: 'grok', text: 'pedido' });
    if (motivo === 'cancelar') await h.call('pane:interrupt', { paneId: 'p', engine: 'grok' });
    responder('session/prompt', { stopReason: motivo === 'cancelar' ? 'end_turn' : motivo }, motivo === 'erro' ? {code:-1,message:'falha'} : null);
    await settle(); tickMain(h); assert.equal(audios(h).length, motivo === 'end_turn' ? 1 : 0, motivo);
  }
});
test('main shutdown impede som pendente, WAV válido empacotado fora de asar e notificação silenciosa', async () => {
  const h = await codex(); h.notify('turn/started'); h.notify('turn/completed', { status: 'completed' }); await h.evaluate('shutdown()'); tickMain(h); assert.equal(audios(h).length, 0);
  const root = path.resolve(__dirname, '..'), cfg = JSON.parse(fs.readFileSync(path.join(root, 'package.json')));
  assert.ok(cfg.build.files.includes('som-conclusao.js')); assert.ok(cfg.build.files.includes('!assets/codex-notification.wav'));
  assert.ok(cfg.build.extraResources.some(x => x.to === 'codex-notification.wav'));
  const wav = fs.readFileSync(path.join(root, 'assets/codex-notification.wav')); assert.equal(wav.toString('ascii', 0, 4), 'RIFF'); assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
  const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8'); assert.match(main.slice(main.indexOf("handle('aviso:pronto'"), main.indexOf('function zerarBadge')), /silent: process.platform === 'darwin'/);
});

test('fechar janela e reabrir limpa turnos velhos e devolve o som aos próximos', async () => {
  const h = audio(); start(h); end(h); await h.som.fechar(); h.som.reabrir();
  end(h); h.tick(1500); assert.equal(h.procs.length, 0);
  start(h, 'p', 'novo'); end(h, 'p', 'novo'); h.tick(1500); assert.equal(h.procs.length, 1);
  const main = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
  assert.match(main, /function createWindow\(\) \{\s+if \(!saindoDoApp\) somConclusao.reabrir\(\)/);
});

test('Claude message_start adia aviso; continuação após primeiro som permite aviso da próxima conclusão', async () => {
  const h = loadMain(); await h.call('pane:start', {paneId:'p', engine:'claude', cwd:h.HOME});
  await h.call('pane:send', {paneId:'p', engine:'claude', text:'pedido'});
  h.evaluate("claudeMessage('p',{type:'result',is_error:false}); claudeMessage('p',{type:'stream_event',event:{type:'message_start'}});");
  tickMain(h); assert.equal(audios(h).length,0);
  h.evaluate("claudeMessage('p',{type:'result',is_error:false});"); tickMain(h); assert.equal(audios(h).length,1); audios(h)[0].proc.emit('close',0);
  h.evaluate("claudeMessage('p',{type:'stream_event',event:{type:'message_start'}}); claudeMessage('p',{type:'assistant',message:{content:[{type:'text',text:'continuação'}]}}); claudeMessage('p',{type:'result',is_error:false});");
  tickMain(h); assert.equal(audios(h).length,2);
});
