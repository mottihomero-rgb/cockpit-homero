'use strict';
// Testes de guarda do lote 1 / rodada 2 (faixa "quadro"): R2-022, R2-024.
// Mesmo padrao de tests/r1-quadro-1.test.cjs (roda o quadro.js de verdade numa vm
// com DOM/API falsos).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function montar() {
  let seq = 0;
  const timerLog = [];
  const drawing = new Proxy({ measureText: txt => ({ width: String(txt).length * 7 }) }, { get: (o, k) => k in o ? o[k] : () => {} });
  function el() {
    return { style: { setProperty() {} }, classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      textContent: '', value: '', children: [], appendChild(c) { this.children.push(c); }, querySelector: () => null,
      querySelectorAll: () => [], getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
      getContext: () => drawing, addEventListener() {}, setAttribute() {}, setPointerCapture() {},
      focus() {}, select() {}, setSelectionRange() {} };
  }
  const painel = el(), toast = el();
  const document = { documentElement: el(), body: { contains: () => true, appendChild() {} },
    getElementById: id => id === 'qdPainel' ? painel : null, querySelectorAll: () => [],
    createElement: kind => { const e = el(); e.toDataURL = () => 'data:image/png;base64,AAA'; return e; },
    addEventListener() {}, removeEventListener() {},
  };
  const window = { api: {} };
  const ctx = vm.createContext({ window, document, navigator: {}, console, requestAnimationFrame() {},
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    setTimeout(fn, ms) { const rec = { fn, ms, id: ++seq }; timerLog.push(rec); return rec.id; },
    clearTimeout() {},
  });
  const src = fs.readFileSync(path.join(__dirname, '../renderer/quadro.js'), 'utf8');
  // R2-023 acrescentou donoEh na linha de baixo: o "de" (busca) tem de acompanhar, senão o
  // replace vira no-op e window.Quadro fica sem Q/recuperarRascunho (o teste quebra por tabela)
  vm.runInContext(src.replace('window.Quadro = { abrir, fechar, aberto, donoEh };',
    'window.Quadro = { abrir, fechar, aberto, donoEh, Q, recuperarRascunho };'), ctx);
  const q = window.Quadro;
  q.Q.el = { sub: el(), canvas: el(), palco: el(), toast, mandar: el(), editor: el(), props: el(), ferramentas: el(), dica: el() };
  return { q, window, ctx, timerLog, toast };
}

const cena = texto => ({ v: 1, formas: [{ id: 'a', tipo: 'retangulo', x: 0, y: 0, w: 160, h: 90, texto }], setas: [] });

// R2-022: Limpar (Q.cena esvaziado na hora, mas so gravado no disco 2s depois) nao pode
// ser desfeito pelo vigia relendo o rascunho.json antigo enquanto a gravacao esta pendente.
test('quadro: rascunho proprio nao volta enquanto a gravacao do Limpar ainda nao confirmou', async () => {
  const h = montar();
  h.q.Q.aberto = true;
  h.q.Q.cena = { v: 1, formas: [], setas: [] };   // Homero clicou em Limpar: tela vazia na hora
  h.q.Q.rascunho.sujo = true;                       // gravarRascunho() ainda nao confirmou o disco
  h.window.api.quadroRascunhoLer = async () => ({ cena: cena('Antigo'), doClaude: 0 });
  await h.q.recuperarRascunho();
  assert.equal(h.q.Q.cena.formas.length, 0, 'o Limpar nao pode ser desfeito sozinho enquanto a gravacao esta pendente');
});

// Guarda de regressao: com o disco ja confirmado (sujo=false), a leitura normal do
// rascunho proprio continua trazendo o desenho de volta com a tela vazia.
test('quadro: rascunho proprio ainda volta quando a gravacao ja confirmou (sujo=false)', async () => {
  const h = montar();
  h.q.Q.aberto = true;
  h.q.Q.cena = { v: 1, formas: [], setas: [] };
  h.q.Q.rascunho.sujo = false;
  h.window.api.quadroRascunhoLer = async () => ({ cena: cena('Meu rascunho'), doClaude: 0 });
  await h.q.recuperarRascunho();
  assert.equal(h.q.Q.cena.formas.length, 1, 'rascunho proprio ainda tem que voltar quando o disco ja esta confirmado');
});

// R2-024: reabrir o quadro ja aberto apontando pra outro painel, com desenho ainda
// nao mandado, nao pode trocar o dono (Q.P) escondido.
test('quadro: reabrir com desenho nao mandado nao troca o dono silenciosamente', async () => {
  const h = montar();
  const painelA = { engine: 'claude', cwd: '/projeto-a' };
  const painelB = { engine: 'codex', cwd: '/projeto-b' };
  await h.q.abrir(painelA);
  h.q.Q.cena = cena('Fluxo pensado pro A');   // desenho ainda nao mandado
  await h.q.abrir(painelB);
  assert.equal(h.q.Q.P, painelA, 'o dono nao pode trocar com desenho pendente na tela');
  assert.ok(h.toast.children.length > 0, 'tem que avisar com um toast');
  assert.match(h.toast.children.at(-1).textContent, /não foi mandado/);
});

// Guarda de regressao: sem nada a perder (tela vazia), reabrir noutro painel continua
// trocando o dono normalmente, como sempre funcionou.
test('quadro: reabrir com a tela vazia continua trocando o dono normalmente', async () => {
  const h = montar();
  const painelA = { engine: 'claude', cwd: '/projeto-a' };
  const painelB = { engine: 'codex', cwd: '/projeto-b' };
  await h.q.abrir(painelA);
  await h.q.abrir(painelB);   // Q.cena continua vazio
  assert.equal(h.q.Q.P, painelB, 'com a tela vazia o dono tem que trocar como antes');
});
