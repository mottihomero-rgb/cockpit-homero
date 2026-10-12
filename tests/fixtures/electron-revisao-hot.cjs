'use strict';
// Fronteiras externas isoladas. Main, preload, IPC, disco temporário e janela são reais.
const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const root = process.env.COCKPIT_QA_SOURCE;
const home = process.env.COCKPIT_QA_HOME;
if (!root || !home || !home.includes('cockpit-native-qa-')) throw new Error('QA precisa de pasta temporária própria');
os.homedir = () => home;
process.env.HOME = home;
app.setName('Cockpit QA');
fs.mkdirSync(path.join(home, 'dados'), { recursive: true });
fs.writeFileSync(path.join(home, 'dados/config.json'), JSON.stringify({ autoAtualizarMotores: false, webLigado: false, defCwd: home }));
app.setPath('userData', path.join(home, 'dados'));
let turn = 0;
function fakeSpawn(bin, args) {
  const p = new EventEmitter();
  p.stdout = new PassThrough(); p.stderr = new PassThrough(); p.stdin = new EventEmitter();
  p.exitCode = null; p.signalCode = null; p.stdin.writable = true; p.stdin.destroyed = false;
  p.kill = () => { if (p.exitCode !== null) return; p.exitCode = 0; setImmediate(() => p.emit('close', 0)); };
  const push = value => p.stdout.write(JSON.stringify(value) + '\n');
  if (!String(bin).includes('codex')) {
    p.stdin.write = () => true;
    setImmediate(() => { p.stderr.write('Subprocesso externo simulado no QA\n'); p.exitCode = 1; p.emit('close', 1); });
    return p;
  }
  p.stdin.write = data => {
    const m = JSON.parse(data);
    if (!m.method || m.id == null) return true;
    let result = {};
    if (m.method === 'model/list') result = { data: [{ id: 'gpt-6-astra', model: 'gpt-6-astra', displayName: 'Astra QA', isDefault: true, supportedReasoningEfforts: [{ reasoningEffort: 'high', description: 'alto' }], defaultReasoningEffort: 'high' }] };
    else if (m.method === 'thread/list') result = { data: [], nextCursor: null };
    else if (m.method === 'thread/start' || m.method === 'thread/resume') result = { thread: { id: m.params.threadId || 'qa-thread', path: path.join(home, 'conversa.jsonl') }, model: m.params.model };
    else if (m.method === 'account/read') result = { account: { type: 'chatgpt', email: 'teste@example.invalid', planType: 'plus' }, requiresOpenaiAuth: false };
    else if (m.method === 'skills/list') result = { data: [] };
    else if (m.method === 'turn/start') result = { turn: { id: 'qa-turn-' + (++turn), status: 'inProgress' } };
    setImmediate(() => {
      push({ id: m.id, result });
      if (m.method === 'turn/start') setTimeout(() => {
        const threadId = m.params.threadId, turnId = result.turn.id;
        push({ method: 'item/agentMessage/delta', params: { threadId, turnId, itemId: 'qa-msg-' + turn, delta: 'Resposta nativa de teste: ação e integração conferidas.' } });
        push({ method: 'item/completed', params: { threadId, turnId, item: { id: 'qa-msg-' + turn, type: 'agentMessage', text: 'Resposta nativa de teste: ação e integração conferidas.' } } });
        push({ method: 'turn/completed', params: { threadId, turn: { id: turnId, status: 'completed' } } });
      }, 80);
    });
    return true;
  };
  return p;
}
const cp = require('node:child_process');
cp.spawn = fakeSpawn;
cp.execFileSync = () => '';
const plataforma = require(path.join(root, 'plataforma.js'));
plataforma.spawnBin = fakeSpawn;
plataforma.acharBin = value => value;
plataforma.temBin = value => value === 'codex';
plataforma.buildEnv = () => ({ HOME: home });
plataforma.tokenClaude = () => '';
require(path.join(root, 'main.js'));

const {ipcMain}=require("electron");
const review=require(path.join(process.env.COCKPIT_QA_NEW_SOURCE,"revisao-arquivos.js")).criar();
const original=ipcMain._invokeHandlers.get("arquivo:ver");ipcMain.removeHandler("arquivo:ver");ipcMain.handle("arquivo:ver",(e,f)=>/\.(pdf|docx?|html?)$/i.test(f)?review.abrir(f):original(e,f));
