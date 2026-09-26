'use strict';
/* Ajustes feitos no telefone tem de CONTINUAR la depois de recarregar — sem nunca escrever
   por cima das abas do Mac. Ver renderer/web.js (AJUSTES_DO_TELEFONE). */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');

const CODIGO = fs.readFileSync(path.resolve(__dirname, '../renderer/web.js'), 'utf8');

// a "gaveta" do celular: sobrevive de um boot pro outro, como o localStorage do Safari
function gavetaDeMentira() {
  const dados = new Map();
  return { dados,
    getItem: (k) => (dados.has(k) ? dados.get(k) : null),
    setItem: (k, v) => { dados.set(k, String(v)); },
    removeItem: (k) => { dados.delete(k); } };
}

/* Um "boot" do telefone: carrega o web.js num mundo de mentira, abre a conexao e responde
   config:get com o retrato que o Mac teria naquele momento. */
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
  vm.runInNewContext(CODIGO, {
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
// o web.js roda num mundo separado: lista de la nao casa com lista daqui sem esta passada
const daqui = (v) => JSON.parse(JSON.stringify(v));

test('Ajuste feito no telefone continua la depois de recarregar', async () => {
  const gaveta = gavetaDeMentira();
  const noMac = { tema: 'escura', verRobos: false, favoritos: ['conversa-x'], abas: [{ cwd: '/pasta/a' }], abaAberta: 0 };

  const t1 = telefone(gaveta, noMac);
  const cfg = await t1.api.getConfig();
  assert.equal(cfg.tema, 'escura');
  cfg.tema = 'clara';                 // ele toca no tema
  cfg.verRobos = true;                 // e liga "mostrar robos"
  cfg.favoritos.unshift('conversa-y'); // e favorita uma conversa
  assert.equal(await t1.api.setConfig(cfg), true);
  assert.deepEqual(t1.socket.sent.map(m => m.nome), ['config:get'], 'nada de ajuste sobe pro Mac');
  assert.deepEqual(Object.keys(guardado(gaveta)).sort(), ['favoritos', 'tema', 'verRobos']);

  // recarregou o Safari: o Mac mexeu nas abas nesse meio tempo, e elas sao dele
  const depois = { tema: 'escura', verRobos: false, favoritos: ['conversa-x'], abas: [{ cwd: '/pasta/b' }, { cwd: '/pasta/c' }], abaAberta: 1 };
  const t2 = telefone(gaveta, depois);
  const cfg2 = await t2.api.getConfig();
  assert.equal(cfg2.tema, 'clara');
  assert.equal(cfg2.verRobos, true);
  assert.deepEqual(daqui(cfg2.favoritos), ['conversa-y', 'conversa-x']);
  assert.deepEqual(daqui(cfg2.abas), depois.abas, 'as abas continuam sendo as do Mac');
  assert.equal(cfg2.abaAberta, 1);
});

test('Se o Mac trocou a mesma preferencia depois, quem manda e o Mac', async () => {
  const gaveta = gavetaDeMentira();
  const noMac = { tema: 'escura', abas: [] };

  const cfg = await telefone(gaveta, noMac).api.getConfig();
  cfg.tema = 'clara';
  await telefone(gaveta, noMac).api.setConfig(cfg);   // guarda "clara" com base "escura"

  const t = telefone(gaveta, { tema: 'auto', abas: [] });
  assert.equal((await t.api.getConfig()).tema, 'auto');
  assert.deepEqual(guardado(gaveta), {}, 'a copia velha do telefone e jogada fora');
});

test('Gaveta trancada (Safari anonimo) nao quebra a tela', async () => {
  const trancada = { dados: new Map(),
    getItem: () => { throw new Error('sem espaco'); },
    setItem: () => { throw new Error('sem espaco'); } };
  const t = telefone(trancada, { tema: 'escura', abas: [{ cwd: '/pasta/a' }] });
  const cfg = await t.api.getConfig();
  assert.equal(cfg.tema, 'escura');
  cfg.tema = 'auto';
  assert.equal(await t.api.setConfig(cfg), true);
});

test('Abas do Mac nunca entram na gaveta do telefone', async () => {
  const gaveta = gavetaDeMentira();
  const t = telefone(gaveta, { abas: [{ cwd: '/pasta/a' }], abaAberta: 0, panes: [1], grupos: [2], atalhosGlobais: true });
  const cfg = await t.api.getConfig();
  cfg.abas.push({ cwd: '/inventada' }); cfg.abaAberta = 9; cfg.atalhosGlobais = false;
  await t.api.setConfig(cfg);
  assert.deepEqual(guardado(gaveta), {});
});
