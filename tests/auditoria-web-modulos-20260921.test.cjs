'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { once } = require('node:events');
const { spawnSync } = require('node:child_process');
const WebSocket = require('ws');
const { criar } = require('../servidor-web');

function temporaria(t) {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-auditoria-web-'));
  t.after(() => fs.rmSync(raiz, { recursive: true, force: true }));
  return raiz;
}
async function servidor(t, extras = {}) {
  const raiz = temporaria(t);
  const tela = path.join(raiz, 'tela'), colados = path.join(raiz, 'colados');
  fs.mkdirSync(tela); fs.mkdirSync(colados);
  fs.writeFileSync(path.join(tela, 'index-web.html'), 'tela de teste');
  const ouvintes = new Set();
  const s = criar({ pastaRenderer: tela, pastaColados: colados, senha: 'teste',
    somenteTailscale: true, porta: 0, ouvintes, handlers: { 'sys:home': () => '/teste' }, ...extras });
  await s.pronto;
  t.after(() => { for (const ws of ouvintes) ws.terminate(); s.fechar(); s.servidor.closeAllConnections?.(); });
  const origem = 'http://127.0.0.1:' + s.servidor.address().port;
  const r = await fetch(origem + '/entrar', { method: 'POST', redirect: 'manual', body: 's=teste' });
  const cookie = r.headers.get('set-cookie').split(';')[0];
  return { s, raiz, tela, colados, origem, cookie };
}
async function conectar(t, s, origin = s.origem) {
  const ws = new WebSocket(s.origem.replace('http:', 'ws:') + '/ws', {
    headers: { Origin: origin, Cookie: s.cookie },
  });
  t.after(() => ws.terminate());
  await once(ws, 'open');
  return ws;
}
const png = () => Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(80, 0x31)]);
function multipart(fronteira, dados, fechar = true) {
  return Buffer.concat([
    Buffer.from('--' + fronteira + '\r\nContent-Disposition: form-data; name="arquivo"; filename="foto.png"\r\nContent-Type: image/png\r\n\r\n'),
    dados, fechar ? Buffer.from('\r\n--' + fronteira + '--\r\n') : Buffer.alloc(0),
  ]);
}

test('WebSocket aceita HTTPS do Tailscale, inclusive proxy com Host interno', async t => {
  const s = await servidor(t, { endereco: 'https://cockpit-teste.tailnet.test' });
  const ws = await conectar(t, s, 'https://cockpit-teste.tailnet.test');
  const resposta = once(ws, 'message');
  ws.send(JSON.stringify({ tipo: 'chamada', id: 1, nome: 'sys:home' }));
  assert.equal(JSON.parse(String((await resposta)[0])).resposta, '/teste');
  const malicioso = await conectar(t, s, 'https://outro-site.test');
  assert.equal((await once(malicioso, 'close'))[0], 1008);
});

test('Upload aceita origem pública HTTPS preservando recusa de outro site', async t => {
  const s = await servidor(t, { endereco: 'https://cockpit-teste.tailnet.test' });
  const enviar = Origin => fetch(s.origem + '/upload', {
    method: 'POST', headers: { Cookie: s.cookie, Origin }, body: png(),
  });
  const r = await enviar('https://cockpit-teste.tailnet.test');
  assert.equal(r.status, 200);
  assert.deepEqual(fs.readFileSync((await r.json()).arquivo), png());
  assert.equal((await enviar('https://outro-site.test')).status, 403);
});

test('Arquivo com espaço e acento é servido; symlink externo nunca vaza na rota estática', async t => {
  const s = await servidor(t);
  fs.writeFileSync(path.join(s.tela, 'ação teste.txt'), 'conteúdo público');
  const segredo = path.join(s.raiz, 'fora.txt'); fs.writeFileSync(segredo, 'fora do renderer');
  fs.symlinkSync(segredo, path.join(s.tela, 'externo.txt'));
  fs.symlinkSync(segredo, path.join(s.tela, 'manifest.json'));
  const correto = await fetch(s.origem + '/' + encodeURIComponent('ação teste.txt'), { headers: { Cookie: s.cookie } });
  assert.equal(correto.status, 200); assert.equal(await correto.text(), 'conteúdo público');
  assert.equal((await fetch(s.origem + '/externo.txt', { headers: { Cookie: s.cookie } })).status, 404);
  assert.equal((await fetch(s.origem + '/manifest.json')).status, 204);
});

test('Multipart incompleto é recusado e não deixa arquivo truncado', async t => {
  const s = await servidor(t);
  const r = await fetch(s.origem + '/upload', { method: 'POST',
    headers: { Cookie: s.cookie, 'Content-Type': 'multipart/form-data; boundary=fronteira' },
    body: multipart('fronteira', png(), false),
  });
  assert.equal(r.status, 400); assert.match((await r.json()).error, /incompleto/);
  assert.deepEqual(fs.readdirSync(s.colados), []);
});

test('Sequência parecida com fronteira dentro do arquivo não corta seus bytes', async t => {
  const s = await servidor(t);
  const dados = Buffer.concat([png(), Buffer.from('\r\n--fronteiraNAO-E-SEPARADOR'), png()]);
  const r = await fetch(s.origem + '/upload', { method: 'POST',
    headers: { Cookie: s.cookie, 'Content-Type': 'multipart/form-data; boundary=fronteira' },
    body: multipart('fronteira', dados),
  });
  assert.equal(r.status, 200);
  assert.deepEqual(fs.readFileSync((await r.json()).arquivo), dados);
});

test('Multipart continua íntegro quando cada byte chega em um pedaço separado', async t => {
  const s = await servidor(t), corpo = multipart('abc', png());
  const req = require('node:http').request(s.origem + '/upload', { method: 'POST',
    headers: { Cookie: s.cookie, 'Content-Type': 'multipart/form-data; boundary=abc' },
  });
  const resposta = new Promise((resolve, reject) => {
    req.on('error', reject); req.on('response', res => {
      let texto = ''; res.on('data', d => { texto += d; }); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(texto) }));
    });
  });
  for (const byte of corpo) { req.write(Buffer.from([byte])); await new Promise(r => setImmediate(r)); }
  req.end(); const r = await resposta;
  assert.equal(r.status, 200); assert.deepEqual(fs.readFileSync(r.body.arquivo), png());
});

test('Desligar duas vezes um servidor antigo preserva a conexão de outro servidor', async t => {
  const ouvintes = new Set();
  const antigo = await servidor(t, { ouvintes }), atual = await servidor(t, { ouvintes });
  const ws = await conectar(t, atual);
  antigo.s.fechar(); antigo.s.fechar();
  assert.equal(ouvintes.size, 1);
  const resposta = once(ws, 'message'); ws.send(JSON.stringify({ tipo: 'chamada', id: 1, nome: 'sys:home' }));
  assert.equal(JSON.parse(String((await resposta)[0])).resposta, '/teste');
});

test('JSON null e quadro acima do limite não derrubam o processo do servidor', () => {
  // Isola a falha no processo de teste. Antes da correção ambos encerravam
  // o Node com exceção não tratada, em vez de fechar só aquele telefone.
  for (const carga of ['null', 'grande']) {
    const codigo = `
      const { criar } = require('./servidor-web');
      const WebSocket = require('ws');
      const { once } = require('events');
      (async () => {
        const s = criar({ pastaRenderer: './renderer', senha: 'teste', porta: 0,
          somenteTailscale: true, ouvintes: new Set(), handlers: { 'sys:home': () => '/teste' } });
        await s.pronto;
        const origem = 'http://127.0.0.1:' + s.servidor.address().port;
        const r = await fetch(origem + '/entrar', { method: 'POST', redirect: 'manual', body: 's=teste' });
        const cookie = r.headers.get('set-cookie').split(';')[0];
        const ws = new WebSocket(origem.replace('http:', 'ws:') + '/ws', { headers: { Cookie: cookie, Origin: origem } });
        await once(ws, 'open');
        if (${JSON.stringify(carga)} === 'grande') {
          const fim = once(ws, 'close'); ws.send(Buffer.alloc(13 * 1024 * 1024)); await fim;
        } else {
          ws.send('null'); ws.send('[]');
          const resposta = once(ws, 'message');
          ws.send(JSON.stringify({ tipo: 'chamada', id: 1, nome: 'sys:home' }));
          if (JSON.parse(String((await resposta)[0])).resposta !== '/teste') throw Error('resposta errada');
        }
        ws.terminate(); s.fechar(); s.servidor.closeAllConnections();
        console.log('sobreviveu');
      })().catch(e => { console.error(e); process.exit(1); });
    `;
    const r = spawnSync(process.execPath, ['-e', codigo], { cwd: path.resolve(__dirname, '..'), encoding: 'utf8', timeout: 8000 });
    assert.equal(r.status, 0, carga + ': ' + r.stderr); assert.match(r.stdout, /sobreviveu/);
  }
});

function ponte() {
  const sockets = [], timers = new Map(), listeners = {}, erros = [];
  let seq = 0;
  class Socket {
    constructor() { this.readyState = 0; this.sent = []; sockets.push(this); }
    send(txt) { if (this.falhar) throw new Error('falhou ao enviar'); this.sent.push(JSON.parse(txt)); }
    abrir() { this.readyState = 1; this.onopen(); }
    mensagem(data) { this.onmessage({ data: typeof data === 'string' ? data : JSON.stringify(data) }); }
  }
  const window = { dispatchEvent() {}, addEventListener: (k, f) => { listeners[k] = f; } };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../renderer/web.js'), 'utf8'), {
    window, WebSocket: Socket, console: { warn() {}, error: (...a) => erros.push(a) },
    CustomEvent: class { constructor(type, x) { this.type = type; this.detail = x?.detail; } },
    document: { body: { classList: { add() {}, remove() {} } }, addEventListener() {} },
    location: { protocol: 'https:', host: 'teste', replace() {} },
    setTimeout: f => { const id = ++seq; timers.set(id, f); return id; }, clearTimeout: id => timers.delete(id),
  });
  return { api: window.api, sockets, timers, listeners, erros };
}

test('Fechamento atrasado do socket antigo não cancela pedido da conexão nova', async () => {
  const b = ponte(), antigo = b.sockets[0]; antigo.abrir(); antigo.readyState = 3;
  b.listeners.online(); const atual = b.sockets[1]; atual.abrir();
  const pedido = b.api.home();
  antigo.onclose({ code: 1006, reason: '' });
  atual.mensagem({ tipo: 'resposta', id: atual.sent[0].id, resposta: '/nova' });
  assert.equal(await pedido, '/nova'); assert.equal(b.timers.size, 0);
});

test('Falha de envio limpa pedido e temporizador, sem repetição posterior', async () => {
  const b = ponte(); b.sockets[0].abrir(); b.sockets[0].falhar = true;
  await assert.rejects(b.api.home(), /falhou ao enviar/);
  assert.equal(b.timers.size, 0);
  const circular = {}; circular.self = circular;
  await assert.rejects(b.api.paneSend(circular), /circular/i);
  assert.equal(b.timers.size, 0);
});

test('Um ouvinte quebrado não impede os demais de receber evento e null é ignorado', () => {
  const b = ponte(); let chegou = false;
  b.api.onPaneEvent(() => { throw new Error('falha de uma tela'); });
  b.api.onPaneEvent(() => { chegou = true; });
  assert.doesNotThrow(() => b.sockets[0].mensagem('null'));
  assert.doesNotThrow(() => b.sockets[0].mensagem({ tipo: 'evento', canal: '__proto__' }));
  b.sockets[0].mensagem({ tipo: 'evento', canal: 'pane:event', dados: {} });
  assert.equal(chegou, true); assert.equal(b.erros.length, 1);
});

test('Motor desinstalado ou sem permissão deixa de aparecer instalado, sem reiniciar app', { skip: process.platform === 'win32' && 'permissão de execução (chmod) só existe no Mac' }, t => {
  const plataforma = require('../plataforma');
  const raiz = temporaria(t), nome = 'cockpit-bin-auditoria-' + Date.now();
  const bin = path.join(raiz, nome), antigo = process.env.PATH;
  process.env.PATH = raiz; t.after(() => { process.env.PATH = antigo; });
  fs.writeFileSync(bin, '#!/bin/sh\n'); fs.chmodSync(bin, 0o700);
  assert.equal(plataforma.temBin(nome), true);
  fs.chmodSync(bin, 0o600); assert.equal(plataforma.temBin(nome), false);
  fs.chmodSync(bin, 0o700); assert.equal(plataforma.temBin(nome), true);
  fs.unlinkSync(bin); assert.equal(plataforma.temBin(nome), false);
  fs.mkdirSync(bin); assert.equal(plataforma.temBin(nome), false);
});

test('Erro de pipe ao fechar terminal é entregue ao tratador sem derrubar app', () => {
  const { EventEmitter } = require('node:events');
  const proc = new EventEmitter();
  proc.stdin = new EventEmitter(); proc.stdout = new EventEmitter(); proc.stderr = new EventEmitter();
  proc.stdio = [proc.stdin, proc.stdout, proc.stderr, new EventEmitter()];
  const modulo = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../plataforma.js'), 'utf8'), {
    module: modulo, process: { platform: 'darwin', env: {} }, setTimeout, Buffer,
    require: nome => nome === 'child_process' ? { spawn: () => proc } : nome === 'fs'
      ? { statSync: () => ({ isFile: () => true }), accessSync() {}, constants: fs.constants } : require(nome),
  });
  const pty = modulo.exports.abrirPty({ linha: 'teste', cols: 80, rows: 24, cwd: '/teste', env: {}, ptyBridge: '/teste.py' });
  const erros = []; pty.onErro(e => erros.push(e.message));
  assert.doesNotThrow(() => proc.stdin.emit('error', new Error('EPIPE teclado')));
  assert.doesNotThrow(() => proc.stdio[3].emit('error', new Error('EPIPE resize')));
  assert.deepEqual(erros, ['EPIPE teclado', 'EPIPE resize']);
});

test('Configuração com modo nulo mantém modo padrão e resultados MCP preservam texto com imagem', () => {
  const { normalizeSettings, historyItem } = require('../codex-protocol');
  assert.equal(normalizeSettings({ collaborationMode: null }).collaborationMode, 'default');
  const item = historyItem({ type: 'mcpToolCall', server: 'teste', tool: 'print', result: { content: [
    { type: 'text', text: 'Arquivo salvo na pasta da entrega.' },
    { type: 'image', mimeType: 'image/png', data: 'AAAA' },
  ] } });
  assert.equal(item.output, 'Arquivo salvo na pasta da entrega.'); assert.equal(item.imagens.length, 1);
  assert.match(historyItem({ type: 'dynamicToolCall', contentItems: [{ type: 'text', text: 'resultado recuperado' }] }).output, /resultado recuperado/);
});

function cliFalso(t) {
  const { EventEmitter } = require('node:events');
  const { PassThrough } = require('node:stream');
  const { criarCli } = require('../cli-motors');
  const HOME = temporaria(t), dados = path.join(HOME, 'dados'), filhos = [], eventos = [], mortos = [];
  const cli = criarCli({ HOME, pastaDados: () => dados, temBin: () => true,
    acharBin: nome => nome, buildEnv: () => ({}), emit: (...e) => eventos.push(e),
    matarGrupo: proc => mortos.push(proc), spawnBin: () => {
      const proc = new EventEmitter();
      proc.stdin = new PassThrough(); proc.stdout = new PassThrough(); proc.stderr = new PassThrough();
      filhos.push(proc); return proc;
    },
  });
  t.after(() => cli.fechar());
  return { cli, HOME, dados, filhos, eventos, mortos };
}

test('Gemini conta painéis vivos e processos trabalhando durante todo o ciclo', t => {
  const m = cliFalso(t);
  assert.equal(m.cli.vivo('p'), false); assert.equal(m.cli.trabalhando(), 0);
  m.cli.start('p', {}); assert.equal(m.cli.vivo('p'), true); assert.equal(m.cli.trabalhando(), 0);
  assert.equal(m.cli.enviar('p', 'mensagem de teste'), true); assert.equal(m.cli.trabalhando(), 1);
  m.filhos[0].emit('close', 0); assert.equal(m.cli.trabalhando(), 0); assert.equal(m.cli.vivo('p'), true);
  m.cli.enviar('p', 'outra mensagem'); m.cli.parar('p', true);
  assert.equal(m.cli.trabalhando(), 0); assert.equal(m.cli.vivo('p'), true);
  m.cli.fechar(); assert.equal(m.cli.vivo('p'), false); assert.equal(m.cli.trabalhando(), 0);
});

test('Uma sessão Gemini corrompida não esconde as demais nem quebra histórico', t => {
  const m = cliFalso(t), dir = path.join(m.dados, 'gemini'); fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, 'a-quebrado.jsonl'));
  const arquivo = path.join(dir, 'b-valido.jsonl');
  fs.writeFileSync(arquivo, [JSON.stringify({ cockpit: 1, id: 'valido', cwd: m.HOME }), 'null', '7',
    JSON.stringify({ role: 'user', text: 'Conversa preservada' }), JSON.stringify({ role: 'bot', text: 'Resposta preservada' })].join('\n'));
  assert.equal(m.cli.sessoes().length, 1); assert.equal(m.cli.sessoes()[0].title, 'Conversa preservada');
  assert.equal(m.cli.historico(arquivo).length, 2);
  const nativo = path.posix.join(m.HOME, 'nativo.json');
  fs.writeFileSync(nativo, JSON.stringify({ sessionId: 'nativa', messages: [null, { type: 'user', content: 'Pedido nativo' },
    { type: 'gemini', content: 'Resposta nativa', toolCalls: [null, { name: 'teste' }] }] }));
  assert.equal(m.cli.historico(nativo).length, 3);
});

test('Falha ao salvar mensagem Gemini encerra o processo que acabou de abrir', t => {
  const m = cliFalso(t); m.cli.start('p', {});
  const dir = path.join(m.dados, 'gemini'); fs.renameSync(dir, dir + '-antes'); fs.writeFileSync(dir, 'pasta indisponível');
  assert.equal(m.cli.enviar('p', 'mensagem'), false);
  assert.equal(m.mortos.length, 1); assert.equal(m.cli.trabalhando(), 0);
  assert.ok(m.eventos.some(e => e[1] === 'note' && /salvar/.test(e[2].text)));
  assert.ok(!m.eventos.some(e => e[1] === 'busy'));
});

test('Falha no disco ao concluir Gemini preserva resposta na tela e libera o painel', t => {
  const m = cliFalso(t); m.cli.start('p', {}); m.cli.enviar('p', 'mensagem');
  const proc = m.filhos[0];
  proc.stdout.emit('data', Buffer.from(JSON.stringify({ event: 'step_update', step_update: { step_type: 'agent_response', text_delta: 'Resposta pronta' } }) + '\n'));
  const dir = path.join(m.dados, 'gemini'); fs.renameSync(dir, dir + '-antes'); fs.writeFileSync(dir, 'pasta indisponível');
  assert.doesNotThrow(() => proc.emit('close', 0));
  assert.equal(m.cli.trabalhando(), 0);
  assert.ok(m.eventos.some(e => e[1] === 'text-final' && e[2].text === 'Resposta pronta'));
  assert.ok(m.eventos.some(e => e[1] === 'note' && /salvá-la/.test(e[2].text)));
  assert.ok(m.eventos.some(e => e[1] === 'turn-end'));
});
