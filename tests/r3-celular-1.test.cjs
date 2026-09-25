'use strict';
/* Testes de guarda do lote "celular 1" da rodada 3 (R3-005, R3-044, R3-045, R3-050, R3-052,
   R3-053). Cada teste falha no código de ANTES do conserto e passa com o conserto aplicado. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { criar } = require('../servidor-web');

const mobileSrc = fs.readFileSync(path.join(__dirname, '../renderer/mobile.js'), 'utf8');
const webSrc = fs.readFileSync(path.join(__dirname, '../renderer/web.js'), 'utf8');
const celularCss = fs.readFileSync(path.join(__dirname, '../renderer/celular.css'), 'utf8');

function extractFn(nome, src) {
  const re = new RegExp('^\\s*(?:async )?function ' + nome + '\\(', 'm');
  const m = re.exec(src);
  assert.ok(m, nome + ' existe no arquivo');
  const start = m.index;
  const linha = src.slice(start, src.indexOf('\n', start));
  if (linha.trimEnd().endsWith('}')) return linha;
  return src.slice(start, src.indexOf('\n}', start) + 2);
}

/* ===================== R3-005: guarda de atualizar() trava com P.busy preso ===================== */

function contextoMobile(extras = {}) {
  const chamadas = { paneEstado: 0, sessionHistory: 0 };
  const recebidos = [];
  const P = { id: 'p1', engine: 'claude', cwd: '/projeto', started: true, busy: true,
    sessaoId: 'sess-1', sessaoFile: '', chat: { scrollTop: 0, scrollHeight: 0, clientHeight: 0, replaceChildren() {} },
    hist: [], blocks: new Map(), tools: new Map(),
    ...extras.P };
  const c = {
    console,
    pronto: true, atualizando: false, restaurando: false,
    document: { hidden: false, body: { classList: { contains: () => false } } },
    panes: new Map([[P.id, P]]),
    focusPane: P,
    sessao: (p) => p.sessaoId || p.resumeId || '',
    NA_VPS: () => false,
    selos: new WeakMap(),
    renderizarHistorico: () => {},
    scroll: () => {},
    recebidos,
    receberEventoPane: (ev) => recebidos.push(ev),
    window: { api: {
      paneEstado: extras.paneEstado === undefined ? async () => { chamadas.paneEstado++; return { busy: false, aprovacao: null }; }
        : async (...a) => { chamadas.paneEstado++; return extras.paneEstado(P, ...a); },
      sessionHistory: async () => { chamadas.sessionHistory++; return extras.sessionHistory ? extras.sessionHistory() : [{ id: 1 }]; },
      sessionHistoryRemoto: async () => { chamadas.sessionHistory++; return []; },
    } },
  };
  vm.createContext(c);
  const normalizado = mobileSrc.replace(/^  /gm, '');
  vm.runInContext(extractFn('atualizar', normalizado), c);
  return { c, P, chamadas, recebidos, atualizar: vm.runInContext('atualizar', c) };
}

test('R3-005 mobile.js: P.busy preso em true (turn-end perdido na queda) ainda assim pergunta ao Mac', async () => {
  // cenario do proprio R2-012: iPhone mandou msg (P.busy=true), caiu, o Mac terminou o
  // turno sem o iPhone saber. Sem o conserto, a guarda de entrada (P.busy) barra tudo e
  // nem chega a chamar pane:estado — a tela fica presa em "trabalhando…" pra sempre.
  const { atualizar, chamadas, P } = contextoMobile({
    P: { started: true, busy: true },
    paneEstado: () => ({ busy: false, aprovacao: null }),
  });
  await atualizar();
  assert.equal(chamadas.paneEstado, 1, 'nunca perguntou o estado real ao Mac — travou so no P.busy');
  assert.equal(chamadas.sessionHistory, 1, 'confirmado que o turno acabou, tinha que reler o historico e destravar a tela');
  assert.equal(P.busy, true, 'atualizar() e so leitura: nao mexe em P.busy, quem zera isso e o evento turn-end/app.js');
});

test('R3-005 mobile.js: resposta chegando AO VIVO durante o await continua protegida (nao atropela streaming)', async () => {
  // race genuina: P.busy comeca FALSE (passa a guarda de entrada normalmente), e o proprio
  // callback do paneEstado simula um evento ao vivo que LIGA P.busy DURANTE o await — igual a
  // uma mensagem nova comecando a chegar bem na hora em que o pane:estado estava voltando.
  // Isso tem que continuar bloqueando a releitura do historico por baixo do streaming.
  const { atualizar, chamadas } = contextoMobile({
    P: { started: true, busy: false },
    paneEstado: (P) => { P.busy = true; return { busy: false, aprovacao: null }; },
  });
  await atualizar();
  assert.equal(chamadas.sessionHistory, 0, 'nao pode reler o historico por cima de uma resposta ainda chegando ao vivo');
});

test('R3-005 mobile.js: painel comum parado (P.started false, P.busy true) continua barrado na entrada', async () => {
  // sem P.started nao tem pane:estado pra perguntar — aqui P.busy tem que continuar valendo,
  // senao a gente tentaria reler historico por cima de um envio comum em andamento.
  const { atualizar, chamadas } = contextoMobile({ P: { started: false, busy: true } });
  await atualizar();
  assert.equal(chamadas.paneEstado, 0);
  assert.equal(chamadas.sessionHistory, 0);
});

/* ===================== R3-044: duas abas do Safari se apagam via setConfig ===================== */

function gavetaDeMentira() {
  const dados = new Map();
  return { dados,
    getItem: (k) => (dados.has(k) ? dados.get(k) : null),
    setItem: (k, v) => { dados.set(k, String(v)); },
    removeItem: (k) => { dados.delete(k); } };
}
function telefone(gaveta, configDoMac) {
  const sockets = [], timers = new Map(), listeners = {};
  let seq = 0;
  class Socket {
    constructor() { this.readyState = 0; this.sent = []; sockets.push(this); }
    send(txt) {
      const m = JSON.parse(txt); this.sent.push(m);
      if (m.nome !== 'config:get') return;
      const resposta = JSON.parse(JSON.stringify(configDoMac));
      this.onmessage({ data: JSON.stringify({ tipo: 'resposta', id: m.id, resposta }) });
    }
    abrir() { this.readyState = 1; this.onopen(); }
  }
  const window = { localStorage: gaveta, dispatchEvent: () => {}, addEventListener: (k, f) => { listeners[k] = f; } };
  vm.runInNewContext(webSrc, {
    window, WebSocket: Socket,
    CustomEvent: class { constructor(type, x) { this.type = type; this.detail = x && x.detail; } },
    document: { body: { classList: { add() {}, remove() {} } }, addEventListener() {} },
    location: { protocol: 'http:', host: 'teste', replace() {} },
    setTimeout: (f) => { const id = ++seq; timers.set(id, f); return id; }, clearTimeout: (id) => timers.delete(id),
  });
  sockets[0].abrir();
  return { api: window.api, socket: sockets[0] };
}
const guardado = (gaveta) => JSON.parse(gaveta.dados.get('cockpit:ajustes-do-telefone') || '{}');

test('R3-044 web.js: duas abas abertas juntas, cada uma muda UMA preferencia — as DUAS sobrevivem', async () => {
  const gaveta = gavetaDeMentira();
  const noMac = { tema: 'escuro', verRobos: false, abas: [] };

  // duas abas "abertas ao mesmo tempo": as duas fazem getConfig ANTES de qualquer setConfig
  const abaA = telefone(gaveta, noMac);
  const cfgA = await abaA.api.getConfig();
  const abaB = telefone(gaveta, noMac);
  const cfgB = await abaB.api.getConfig();

  cfgA.tema = 'jornal';                 // aba A so mexe no tema
  await abaA.api.setConfig(cfgA);

  cfgB.verRobos = true;                 // aba B, sem saber da mudanca de A, so mexe em verRobos
  await abaB.api.setConfig(cfgB);

  const g = guardado(gaveta);
  assert.equal(g.tema && g.tema.meu, 'jornal',
    'com o defeito, o setConfig da aba B recalcula TODAS as chaves pelo retrato do boot dela e apaga o tema que a aba A acabou de salvar');
  assert.equal(g.verRobos && g.verRobos.meu, true, 'a propria mudanca da aba B tem que ser salva tambem');
});

test('R3-044 web.js: aba unica revertendo pro valor do Mac continua limpando a gaveta', async () => {
  const gaveta = gavetaDeMentira();
  const noMac = { tema: 'escuro', abas: [] };
  const aba = telefone(gaveta, noMac);
  const cfg = await aba.api.getConfig();
  cfg.tema = 'jornal';
  await aba.api.setConfig(cfg);
  assert.equal(guardado(gaveta).tema.meu, 'jornal');
  cfg.tema = 'escuro';                  // ele volta pro tema original, na MESMA aba
  await aba.api.setConfig(cfg);
  assert.deepEqual(guardado(gaveta), {}, 'reverter pro valor do Mac, na mesma aba, tem que continuar limpando a chave');
});

/* ===================== R3-045: erro de video culpa "Mac desatualizado" mesmo quando foi a rede ===================== */

function contextoUpload({ status, lancaExcecao } = {}) {
  const chamadasFetch = [];
  const ctx = {
    console,
    chamar: async () => ({ error: 'nao devia chegar aqui pra teste de video' }),
    fetch: async (...a) => {
      chamadasFetch.push(a);
      if (lancaExcecao) throw new Error('rede caiu');
      return { status, ok: false, json: async () => ({ error: 'sem rota' }) };
    },
    FileReader: class {},
  };
  vm.createContext(ctx);
  const bloco = webSrc.slice(webSrc.indexOf('const MB = 1024 * 1024;'), webSrc.indexOf('function escolherArquivo()'));
  vm.runInContext(bloco, ctx);
  return { ctx, chamadasFetch, mandarProMac: vm.runInContext('mandarProMac', ctx) };
}

test('R3-045 web.js: fetch(/upload) falha por REDE (video) — mensagem fala de conexao, nao de "Mac desatualizado"', async () => {
  const { mandarProMac } = contextoUpload({ lancaExcecao: true });
  const r = await mandarProMac({ name: 'clipe.mov', type: 'video/quicktime', size: 1000 });
  assert.ok(!/atualizado/.test(r.error), 'com o defeito, falha de rede tambem manda mandar atualizar/reiniciar o Mac: ' + r.error);
  assert.match(r.error, /conex(ã|a)o/i);
});

test('R3-045 web.js: /upload responde 404 (Mac SEM a rota, de verdade) — mensagem de Mac desatualizado continua', async () => {
  const { mandarProMac } = contextoUpload({ status: 404 });
  const r = await mandarProMac({ name: 'clipe.mov', type: 'video/quicktime', size: 1000 });
  assert.match(r.error, /atualizado/, 'quando o Mac realmente nao tem a rota, o aviso pra atualizar tem que continuar');
});

/* ===================== R3-052 + R3-050: alvo de toque da lista de conversas no celular ===================== */

const semComentario = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '');
const dentroDaMedia = semComentario(celularCss.slice(celularCss.indexOf('@media')));

test('R3-050 celular.css: .hi-grupo/.hi-mais ficam visiveis e com largura de verdade fora do :hover', () => {
  assert.match(dentroDaMedia, /\.hi-fav,\.hi-edit,\.hi-grupo,\.hi-mais\{opacity:1\}/,
    'hoje so .hi-fav/.hi-edit ganham opacity:1 no celular — .hi-grupo/.hi-mais dependem de :hover, que nao existe no toque');
  assert.match(dentroDaMedia, /\.hist-item:not\(\.com-trecho\) \.hi-grupo,\s*\n?\s*\.hist-item:not\(\.com-trecho\) \.hi-mais\{width:20px;margin-left:0\}/);
});

test('R3-052 celular.css: .hi-fav/.hi-edit/.hi-grupo/.hi-mais ganham anel invisivel de toque (-9px)', () => {
  assert.match(dentroDaMedia, /\.hi-fav,\.hi-edit,\.hi-grupo,\.hi-mais\{position:relative\}/,
    'sem position:relative aqui, o ::after de baixo nao ancora no botao certo');
  assert.match(dentroDaMedia,
    /\.hi-fav::after,\.hi-edit::after,\.hi-grupo::after,\.hi-mais::after\{content:"";position:absolute;inset:-9px\}/,
    'alvo real continua 20x20 — falta o anel invisivel que os outros botoes do app ja tem (ex.: .p-close)');
});

/* ===================== R3-053: POST /entrar sem checar a Origem ===================== */

function temporaria(t) {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-r3-celular-'));
  t.after(() => fs.rmSync(raiz, { recursive: true, force: true }));
  return raiz;
}
async function subirServidor(t) {
  const raiz = temporaria(t);
  const tela = path.join(raiz, 'tela'), colados = path.join(raiz, 'colados');
  fs.mkdirSync(tela); fs.mkdirSync(colados);
  fs.writeFileSync(path.join(tela, 'index-web.html'), 'tela de teste');
  const ouvintes = new Set();
  const s = criar({ pastaRenderer: tela, pastaColados: colados, senha: 'teste-r3',
    somenteTailscale: true, porta: 0, ouvintes, handlers: {} });
  await s.pronto;
  t.after(() => { for (const ws of ouvintes) ws.terminate(); s.fechar(); s.servidor.closeAllConnections?.(); });
  return { s, origem: 'http://127.0.0.1:' + s.servidor.address().port };
}

test('R3-053 servidor-web.js: POST /entrar com Origin de outro site e senha certa — bloqueado (403)', async (t) => {
  const { origem } = await subirServidor(t);
  const r = await fetch(origem + '/entrar', {
    method: 'POST', redirect: 'manual',
    headers: { Origin: 'http://pagina-maliciosa.exemplo', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 's=teste-r3',
  });
  assert.equal(r.status, 403, 'sem o conserto, origem de outro site processa o POST /entrar normalmente (302)');
});

test('R3-053 servidor-web.js: POST /entrar SEM cabecalho Origin e senha certa — continua entrando (302)', async (t) => {
  const { origem } = await subirServidor(t);
  const r = await fetch(origem + '/entrar', {
    method: 'POST', redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 's=teste-r3',
  });
  assert.equal(r.status, 302, 'cliente sem Origin (curl, Atalhos do iPhone) nao pode ser bloqueado pelo conserto');
});

test('R3-053 servidor-web.js: POST /entrar com Origin igual ao proprio endereco e senha certa — fluxo normal (302)', async (t) => {
  const { origem } = await subirServidor(t);
  const r = await fetch(origem + '/entrar', {
    method: 'POST', redirect: 'manual',
    headers: { Origin: origem, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 's=teste-r3',
  });
  assert.equal(r.status, 302, 'o navegador do proprio Homero, batendo na mesma origem, tem que continuar entrando');
});
