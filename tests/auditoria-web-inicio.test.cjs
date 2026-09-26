'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const vm = require('node:vm');
const { criar } = require('../servidor-web');
const { loadMain } = require('./main-harness.cjs');
const opts = { pastaRenderer: path.join(__dirname, '../renderer'), handlers: {}, ouvintes: new Set(), porta: 0, senha: 'teste', somenteTailscale: true, endereco: 'https://teste' };
async function limitado(promise) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Promise de abertura ficou presa')), 1000); })]); }
  finally { clearTimeout(timer); }
}

test('servidor real fecha antes de listening e encerra a promessa de abertura', async t => {
  const s = criar({ ...opts, ouvintes: new Set() }); t.after(() => s.fechar());
  s.fechar();
  await assert.rejects(limitado(s.pronto), /cancelad|fechad/i);
  assert.equal(s.servidor.listening, false);
});

test('main liga-desliga-liga durante listen real recupera uma única instância', async t => {
  const h = loadMain(), servidores = [];
  t.after(() => servidores.forEach(s => s.fechar()));
  h.evaluate('globalThis').__criarReal = opcoes => {
    const s = criar({ ...opcoes, porta: 0 }); servidores.push(s); return s;
  };
  h.evaluate(`const requireAnterior=require;require=n=>n==='./servidor-web.js'?{criar:__criarReal}:requireAnterior(n);enderecoTailscale=async()=> 'https://teste';manterAcordado=()=>{};`);
  const primeira = h.call('web:ligar', true);
  await Promise.resolve(); // listen foi chamado, mas seu próximo tick ainda não executou.
  assert.equal(h.evaluate('!!webPendente'), true);
  await h.call('web:ligar', false);
  const segunda = h.call('web:ligar', true);
  const resultados = await limitado(Promise.all([primeira, segunda]));
  assert.ok(resultados.every(r => r.ligado));
  assert.equal(servidores.length, 2);
  assert.equal(servidores.filter(s => s.servidor.listening).length, 1);
  await h.call('web:ligar', false);
  assert.equal(servidores.filter(s => s.servidor.listening).length, 0);
  assert.equal(h.evaluate('webTransicao'), null);
});

test('abertura sem listening nem erro vence o prazo sem deixar promessa pendente', async t => {
  const timers = new Map(); let id = 0;
  const mod = { exports: {} };
  const ctx = vm.createContext({
    Buffer, URL, URLSearchParams, console,
    setInterval, clearInterval,
    setTimeout(fn) { const timer = { id: ++id, unref() {} }; timers.set(timer, fn); return timer; },
    clearTimeout(timer) { timers.delete(timer); },
    require(name) {
      if (name === 'http') return { ...http, createServer(...args) { const s = http.createServer(...args); s.listen = () => s; return s; } };
      return require(name);
    },
    module: mod, exports: mod.exports,
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../servidor-web.js'), 'utf8'), ctx);
  const s = mod.exports.criar({ ...opts, ouvintes: new Set() }); t.after(() => s.fechar());
  const resultado = limitado(s.pronto).then(() => null, e => e);
  const quantos = timers.size;
  for (const fn of [...timers.values()]) fn();
  const erro = await resultado;
  assert.equal(quantos, 1, 'a abertura precisa ter prazo próprio');
  assert.equal(erro && erro.code, 'ETIMEDOUT');
  assert.equal(timers.size, 0);
  assert.equal(s.servidor.listening, false);
});

test('falha real de abertura não vira repetição automática e novo clique pode tentar', async () => {
  const h = loadMain();
  h.evaluate(`globalThis.tentativas=0;const req=require;require=n=>n==='./servidor-web.js'?{criar:()=>{tentativas++;return {fechar(){},pronto:Promise.reject(new Error('falhou'))};}}:req(n);enderecoTailscale=async()=> 'https://teste';manterAcordado=()=>{};`);
  const primeiro = await limitado(h.call('web:ligar', true));
  assert.equal(primeiro.error, 'falhou'); assert.equal(h.evaluate('tentativas'), 1);
  const segundo = await limitado(h.call('web:ligar', true));
  assert.equal(segundo.error, 'falhou'); assert.equal(h.evaluate('tentativas'), 2);
  assert.equal(h.evaluate('webTransicao'), null);
});
