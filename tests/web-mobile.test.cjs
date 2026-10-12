'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
const { once } = require('node:events');
const WebSocket = require('ws');
const { criar } = require('../servidor-web');

async function servidor(t, extras = {}) {
  const calls = [], term = [], ouvintes = new Set();
  const s = criar({ pastaRenderer: path.resolve(__dirname, '../renderer'), porta: 0,
    senha: 'senha-apenas-de-teste', somenteTailscale: true, ouvintes,
    handlers: {
      'sessions:history': (e, arg) => { calls.push({ e, arg }); return 'mesmo histórico'; },
      'term:run': (e, arg) => { term.push({ e, arg }); return { ok: true }; },
    }, ...extras });
  await s.pronto; t.after(() => s.fechar());
  const origin = 'http://127.0.0.1:' + s.servidor.address().port;
  // a senha vai no CORPO do POST: dentro do endereço ela ficaria no histórico do Safari
  const tentar = (senha, cookie) => fetch(origin + '/entrar', { method: 'POST', redirect: 'manual',
    headers: cookie ? { Cookie: cookie } : {}, body: new URLSearchParams({ s: senha }) });
  const login = async () => {
    const r = await tentar('senha-apenas-de-teste');
    assert.equal(r.status, 302); return r.headers.get('set-cookie').split(';')[0];
  };
  return { s, origin, login, tentar, calls, term, ouvintes };
}

test('Tailscale userspace chega ao login por loopback, sem abrir uma porta na LAN', async t => {
  const { s, origin } = await servidor(t);
  assert.equal(s.servidor.address().address, '127.0.0.1');
  const r = await fetch(origin);
  assert.equal(r.status, 200); assert.match(await r.text(), /Senha do Cockpit/);
  assert.equal(s.endereco, '', 'não inventar endereço da LAN quando o Tailscale estiver desligado');
  const manifest = await (await fetch(origin + '/manifest.json')).json();
  assert.equal(manifest.display, 'standalone'); assert.equal(manifest.start_url, '/');
  const protegido = await (await fetch(origin + '/app.js', { headers: { 'X-Forwarded-For': '100.64.0.1', 'Tailscale-User-Login': 'falso' } })).text();
  assert.match(protegido, /Senha do Cockpit/);
});

test('WebSocket exige sessão e mesma origem; desligar remove todos os telefones', async t => {
  const { s, origin, login, calls, ouvintes } = await servidor(t);
  const cookie = await login(), url = origin.replace('http:', 'ws:') + '/ws';
  for (const headers of [{ Origin: origin }, { Origin: 'http://site-estranho.test', Cookie: cookie }]) {
    const ws = new WebSocket(url, { headers });
    const [code] = await once(ws, 'close'); assert.equal(code, 1008);
  }
  assert.equal(calls.length, 0);
  const ws = new WebSocket(url, { headers: { Origin: origin, Cookie: cookie } });
  await once(ws, 'open');
  const resposta = once(ws, 'message');
  ws.send(JSON.stringify({ tipo: 'chamada', id: 7, nome: 'sessions:history', arg: 'conversa' }));
  assert.equal(JSON.parse(String((await resposta)[0])).resposta, 'mesmo histórico');
  assert.equal(calls[0].e.remoto, true); assert.equal(ouvintes.size, 1);
  const fim = once(ws, 'close'); s.fechar();
  assert.equal((await fim)[0], 1001); assert.equal(ouvintes.size, 0);
});

test('Senha certa nunca fica trancada, senha no endereço não entra e login continua após 8 horas', async t => {
  const { origin, login, tentar, calls } = await servidor(t);
  const cookie = await login();
  for (let i = 0; i < 5; i++) assert.equal((await tentar('errada')).status, 401);
  assert.equal((await tentar('errada')).status, 429, 'insistir no erro continua trancando');
  assert.equal((await tentar('senha-apenas-de-teste')).status, 302, 'o dono entra mesmo depois dos erros');
  const velho = await fetch(origin + '/entrar?s=senha-apenas-de-teste', { redirect: 'manual' });
  assert.equal(velho.status, 302); assert.equal(velho.headers.get('set-cookie'), null, 'senha no endereço não vale');
  const ws = new WebSocket(origin.replace('http:', 'ws:') + '/ws', { headers: { Origin: origin, Cookie: cookie } });
  await once(ws, 'open');
  const agora = Date.now(); t.mock.method(Date, 'now', () => agora + 9 * 60 * 60 * 1000);
  const resposta = once(ws, 'message'); ws.send(JSON.stringify({ tipo: 'chamada', id: 1, nome: 'sessions:history' }));
  assert.equal(JSON.parse(String((await resposta)[0])).resposta, 'mesmo histórico');
  assert.equal(calls.length, 1); ws.close();
});

test('Login salvo sobrevive ao reinicio e ao tempo; disco nao guarda senha nem cookie utilizavel', async t => {
  const dir = pastaTemp(t, 'ck-login-');
  const arquivoSessoes = path.join(dir, 'sessoes.json');
  const a = await servidor(t, { arquivoSessoes });
  const entrada = await a.tentar('senha-apenas-de-teste');
  const cookie = entrada.headers.get('set-cookie').split(';')[0];
  assert.match(entrada.headers.get('set-cookie'), /Max-Age=34560000; HttpOnly; SameSite=Strict/);
  const gravado = fs.readFileSync(arquivoSessoes, 'utf8');
  assert.ok(!gravado.includes(cookie.slice(3)) && !gravado.includes('senha-apenas-de-teste'));
  assert.equal(fs.statSync(arquivoSessoes).mode & 0o777, 0o600);
  a.s.fechar(); await once(a.s.servidor, 'close');
  const b = await servidor(t, { arquivoSessoes });
  t.mock.method(Date, 'now', () => 20000000000000);
  const r = await fetch(b.origin, { headers: { Cookie: cookie } });
  assert.doesNotMatch(await r.text(), /Senha do Cockpit/);
  assert.match(r.headers.get('set-cookie'), /Max-Age=34560000/);
  const roubado = 'ck=' + JSON.parse(gravado).sessoes[0];
  assert.match(await (await fetch(b.origin, { headers: { Cookie: roubado } })).text(), /Senha do Cockpit/);
});

test('Sair revoga so este aparelho, fecha seu WebSocket e nao volta depois de reiniciar', async t => {
  const arquivoSessoes = path.join(pastaTemp(t, 'ck-sair-'), 'sessoes.json');
  const a = await servidor(t, { arquivoSessoes });
  const cookie = await a.login(), outro = await a.login();
  const ws = new WebSocket(a.origin.replace('http:', 'ws:') + '/ws', { headers: { Origin: a.origin, Cookie: cookie } });
  await once(ws, 'open');
  assert.equal((await fetch(a.origin + '/sair', { headers: { Cookie: cookie } })).status, 405);
  assert.equal((await fetch(a.origin + '/sair', { method: 'POST', headers: { Cookie: cookie, Origin: 'https://estranho.test' } })).status, 403);
  assert.doesNotMatch(await (await fetch(a.origin, { headers: { Cookie: cookie } })).text(), /Senha do Cockpit/);
  const fechou = once(ws, 'close');
  const r = await fetch(a.origin + '/sair', { method: 'POST', redirect: 'manual', headers: { Cookie: cookie, Origin: a.origin } });
  assert.equal(r.status, 303); assert.match(r.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal((await fechou)[0], 1008);
  a.s.fechar(); await once(a.s.servidor, 'close');
  const b = await servidor(t, { arquivoSessoes });
  assert.match(await (await fetch(b.origin, { headers: { Cookie: cookie } })).text(), /Senha do Cockpit/);
  assert.doesNotMatch(await (await fetch(b.origin, { headers: { Cookie: outro } })).text(), /Senha do Cockpit/);
});

test('Trocar senha invalida login salvo e falha ao gravar nunca informa login concluido', async t => {
  const dir = pastaTemp(t, 'ck-senha-'), arquivoSessoes = path.join(dir, 'sessoes.json');
  const a = await servidor(t, { arquivoSessoes }); const cookie = await a.login();
  a.s.fechar(); await once(a.s.servidor, 'close');
  const b = await servidor(t, { arquivoSessoes, senha: 'nova-senha-de-teste' });
  assert.match(await (await fetch(b.origin, { headers: { Cookie: cookie } })).text(), /Senha do Cockpit/);
  const c = await servidor(t, { arquivoSessoes: dir }); // alvo e um diretorio: rename deve falhar
  const falhou = await c.tentar('senha-apenas-de-teste');
  assert.equal(falhou.status, 503); assert.equal(falhou.headers.get('set-cookie'), null);
});

test('Telefone só alcança os comandos da tela dele, e cookie de outro site não derruba a sessão', async t => {
  const { origin, login, term } = await servidor(t);
  // 'track=abc123' tem 'ck=' dentro: a busca solta lia esse valor e pedia senha de novo
  const cookie = 'track=abc123; ' + await login();
  assert.doesNotMatch(await (await fetch(origin, { headers: { Cookie: cookie } })).text(), /Senha do Cockpit/);
  const ws = new WebSocket(origin.replace('http:', 'ws:') + '/ws', { headers: { Origin: origin, Cookie: cookie } });
  await once(ws, 'open');
  const pedir = async (nome, arg) => {
    const r = once(ws, 'message'); ws.send(JSON.stringify({ tipo: 'chamada', id: 1, nome, arg }));
    return JSON.parse(String((await r)[0]));
  };
  assert.equal((await pedir('sessions:history', 'conversa')).resposta, 'mesmo histórico');
  assert.match((await pedir('term:run', { linha: 'rm -rf ~' })).resposta.error, /só funciona no Mac/);
  assert.equal(term.length, 0, 'abrir terminal no Mac não passa pelo celular');
  ws.close();
});

function ponte() {
  const sockets = [], timers = new Map(), events = [], listeners = {}, urls = [];
  let seq = 0;
  class Socket {
    constructor() { this.readyState = 0; this.sent = []; sockets.push(this); }
    send(txt) { this.sent.push(JSON.parse(txt)); }
    abrir() { this.readyState = 1; this.onopen(); }
    fechar(code = 1006, reason = '') { this.readyState = 3; this.onclose({ code, reason }); }
  }
  const window = { dispatchEvent: e => events.push(e), addEventListener: (k, f) => { listeners[k] = f; } };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../renderer/web.js'), 'utf8'), {
    window, WebSocket: Socket, CustomEvent: class { constructor(type, x) { this.type = type; this.detail = x?.detail; } },
    document: { body: { classList: { add() {}, remove() {} } }, addEventListener() {} },
    location: { protocol: 'http:', host: 'teste', replace: u => urls.push(u) },
    setTimeout: f => { const id = ++seq; timers.set(id, f); return id; }, clearTimeout: id => timers.delete(id),
  });
  return { api: window.api, sockets, timers, events, urls, listeners };
}

test('Pedido vencido enquanto estava offline nunca é enviado ao reconectar', async () => {
  const b = ponte(); const p = b.api.paneSend({ text: 'não enviar atrasado' });
  const erro = assert.rejects(p, /não respondeu/);
  [...b.timers.values()][0](); await erro;
  b.sockets[0].abrir(); assert.equal(b.sockets[0].sent.length, 0);
});

test('Queda não repete envio e sessão expirada volta ao login preservando rascunhos', async () => {
  const b = ponte(); b.sockets[0].abrir();
  const p = b.api.paneSend({ text: 'uma vez' }); const erro = assert.rejects(p, /conexão/);
  b.sockets[0].fechar(); await erro;
  b.listeners.online(); b.sockets[1].abrir(); assert.equal(b.sockets[1].sent.length, 0);
  b.sockets[1].fechar(1008, 'sessao expirou');
  assert.equal(b.events.at(-1).type, 'cockpit:salvar-rascunhos'); assert.deepEqual(b.urls, ['/']);
});

/* ===================== foto e video do celular (rota /upload) ===================== */

const os = require('node:os');
const http = require('node:http');

const pastaTemp = (t, nome) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), nome));
  t.after(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });
  return dir;
};
// bytes que PARECEM mesmo o que dizem ser: e assim que o servidor descobre o tipo
const fotoPng = (n = 64) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(n, 7)]);
const videoMov = (n = 64) => Buffer.concat([Buffer.from([0, 0, 0, 0x14]), Buffer.from('ftypqt  '), Buffer.alloc(n, 3)]);
// pedido cru, para poder mentir no tamanho e para poder cortar a conexao no meio
const cru = (origin, caminho, { metodo = 'POST', cabecalhos = {}, corpo = null, cortarEm = 0 } = {}) =>
  new Promise((ok, falhou) => {
    const u = new URL(origin + caminho);
    const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname, method: metodo, headers: cabecalhos },
      (res) => { let txt = ''; res.on('data', p => { txt += p; }); res.on('end', () => ok({ status: res.statusCode, txt, req })); });
    req.on('error', () => ok({ status: 0, txt: '', req }));
    if (cortarEm) { req.write(corpo.subarray(0, cortarEm)); return ok({ status: 0, txt: '', req, aberto: true }); }
    req.end(corpo);
  });
const ate = async (cond, quanto = 4000) => {
  const fim = Date.now() + quanto;
  while (Date.now() < fim) { if (cond()) return true; await new Promise(r => setTimeout(r, 25)); }
  return cond();
};

test('Vídeo e foto entram por /upload sem base64, com nome nosso e só dentro de colados/', async t => {
  const colados = pastaTemp(t, 'cockpit-colados-');
  const { origin, login } = await servidor(t, { pastaColados: colados });
  const cookie = await login();
  const raiz = fs.realpathSync(colados);
  const mandar = (corpo, extra = {}) => fetch(origin + '/upload',
    { method: 'POST', headers: { Cookie: cookie, Origin: origin, ...extra }, body: corpo });

  // sem sessao nao passa nada, e o erro vem em JSON (a tela de login em HTML viraria "anexo")
  const semSessao = await fetch(origin + '/upload', { method: 'POST', body: fotoPng() });
  assert.equal(semSessao.status, 401);
  assert.match((await semSessao.json()).error, /sessão/);
  assert.equal((await fetch(origin + '/upload', { headers: { Cookie: cookie } })).status, 405, 'so POST');
  // pagina de outro site nao manda arquivo para o Mac
  assert.equal((await mandar(fotoPng(), { Origin: 'http://site-estranho.test' })).status, 403);

  // o caminho normal: um video de 3 MB atravessa em varios pedacos e chega inteiro
  const video = videoMov(3 * 1024 * 1024);
  const r = await mandar(video);
  assert.equal(r.status, 200);
  const { arquivo, bytes } = await r.json();
  assert.equal(bytes, video.length);
  assert.equal(path.dirname(arquivo), raiz, 'gravou dentro de colados/, e so la');
  assert.match(path.basename(arquivo), /^celular-\d+-[a-f0-9]{8}\.mov$/, 'o nome nasce no Mac');
  assert.deepEqual(fs.readFileSync(arquivo), video, 'chegou byte a byte, sem base64');

  // formulario (multipart) tambem serve, e o nome que vem do telefone e jogado fora:
  // se ele valesse, este aqui escapava da pasta
  const f = new FormData();
  f.append('arquivo', new Blob([fotoPng(300)]), '../../fora-da-pasta.png');
  const rf = await fetch(origin + '/upload', { method: 'POST', headers: { Cookie: cookie, Origin: origin }, body: f });
  assert.equal(rf.status, 200);
  const doForm = (await rf.json()).arquivo;
  assert.equal(path.dirname(doForm), raiz);
  assert.match(path.basename(doForm), /^celular-\d+-[a-f0-9]{8}\.png$/);
  assert.equal(fs.readFileSync(doForm).length, 308);
  assert.equal(fs.existsSync(path.join(raiz, '..', '..', 'fora-da-pasta.png')), false);

  // o que nao e foto nem video e recusado pelo CONTEUDO, nao pela extensao, e nao sobra lixo
  const antes = fs.readdirSync(raiz).length;
  const texto = await mandar(Buffer.from('#!/bin/sh\nrm -rf ~\n'), { 'Content-Type': 'image/png' });
  assert.equal(texto.status, 415);
  assert.match((await texto.json()).error, /foto ou vídeo/);
  assert.equal(fs.readdirSync(raiz).length, antes, 'recusado não deixa arquivo para tras');

  // teto existe: um corpo maior que 500 MB e recusado antes de gastar disco
  const enorme = await cru(origin, '/upload', { cabecalhos: { Cookie: cookie, 'Content-Length': String(600 * 1024 * 1024) }, corpo: fotoPng(), cortarEm: 8 });
  assert.equal(await ate(() => fs.readdirSync(raiz).length === antes), true);
  try { enorme.req.destroy(); } catch {}
});

test('Conexão cortada no meio do vídeo não deixa arquivo pela metade em colados/', async t => {
  const colados = pastaTemp(t, 'cockpit-corte-');
  const { origin, login } = await servidor(t, { pastaColados: colados });
  const cookie = await login();
  const raiz = fs.realpathSync(colados);
  // diz que vem 40 MB, manda 1 MB e some (foi o que aconteceu com ele: saiu do app no meio)
  const meio = videoMov(1024 * 1024);
  const p = await cru(origin, '/upload', { cabecalhos: { Cookie: cookie, 'Content-Length': String(40 * 1024 * 1024) }, corpo: meio, cortarEm: meio.length });
  assert.equal(await ate(() => fs.readdirSync(raiz).length === 1), true, 'o servidor começou a gravar');
  p.req.destroy();
  assert.equal(await ate(() => fs.readdirSync(raiz).length === 0), true, 'e apagou o pedaço quando a conexão caiu');
});

test('O celular só rebaixa o que mudou: 304 com etiqueta, e arquivo novo volta a baixar', async t => {
  const pasta = pastaTemp(t, 'cockpit-tela-');
  const tela = path.join(pasta, 'index-web.html');
  fs.writeFileSync(tela, '<h1>versao um</h1>');
  const { origin, login } = await servidor(t, { pastaRenderer: pasta });
  const cookie = await login();
  const pegar = (etiqueta) => fetch(origin + '/', { headers: etiqueta ? { Cookie: cookie, 'If-None-Match': etiqueta } : { Cookie: cookie } });

  const primeira = await pegar();
  assert.equal(primeira.status, 200);
  const etiqueta = primeira.headers.get('etag');
  assert.ok(etiqueta, 'todo arquivo sai com etiqueta');
  // 'no-store' proibia guardar: era por isso que ele rebaixava ~900 KB toda abertura
  assert.equal(primeira.headers.get('cache-control'), 'no-cache');
  assert.match(await primeira.text(), /versao um/);

  const denovo = await pegar(etiqueta);
  assert.equal(denovo.status, 304, 'nao mudou: volta vazio, sem os ~900 KB');
  assert.equal((await denovo.text()).length, 0);

  // e o perigo do 304: ficar com a versao velha para sempre. Mexeu no arquivo, muda a etiqueta.
  fs.writeFileSync(tela, '<h1>versao dois, bem maior que a primeira</h1>');
  const depois = await pegar(etiqueta);
  assert.equal(depois.status, 200, 'arquivo novo NUNCA volta como 304');
  assert.notEqual(depois.headers.get('etag'), etiqueta);
  assert.match(await depois.text(), /versao dois/);
  assert.equal((await pegar(depois.headers.get('etag'))).status, 304);
});
