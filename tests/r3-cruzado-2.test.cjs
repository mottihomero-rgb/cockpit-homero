'use strict';
/* Testes de guarda do lote "cruzado 2" da rodada 3 (R3-007, R3-043).
   Cada teste falha no código de ANTES do conserto e passa com o conserto aplicado. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const appSrc = fs.readFileSync(path.join(__dirname, '../renderer/app.js'), 'utf8');

function extractFn(nome, src) {
  const re = new RegExp('^\\s*(?:async )?function ' + nome + '\\(', 'm');
  const m = re.exec(src);
  assert.ok(m, nome + ' existe no arquivo');
  const start = m.index;
  const linha = src.slice(start, src.indexOf('\n', start));
  if (linha.trimEnd().endsWith('}')) return linha;
  return src.slice(start, src.indexOf('\n}', start) + 2);
}

/* ===================== R3-007: window.Quadro.abrir é assíncrona; !!Promise é sempre true ===================== */

// Monta o mesmo harness de tests/r2-quadro-1.test.cjs (quadro.js de verdade numa vm com
// DOM/API falsos), expondo cenaIntocada junto pra testar o gate novo do R3-043.
function montarQuadro() {
  let seq = 0;
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
    setTimeout(fn, ms) { return ++seq; },
    clearTimeout() {},
  });
  const src = fs.readFileSync(path.join(__dirname, '../renderer/quadro.js'), 'utf8');
  vm.runInContext(src.replace('window.Quadro = { abrir, fechar, aberto, donoEh };',
    'window.Quadro = { abrir, fechar, aberto, donoEh, Q, recuperarRascunho, cenaIntocada };'), ctx);
  const q = window.Quadro;
  q.Q.el = { sub: el(), canvas: el(), palco: el(), toast, mandar: el(), editor: el(), props: el(), ferramentas: el(), dica: el() };
  return { q, window, toast };
}

const cena = texto => ({ v: 1, formas: [{ id: 'a', tipo: 'retangulo', x: 0, y: 0, w: 160, h: 90, texto }], setas: [] });

test('R3-007 quadro.js: abrir() recusado (desenho pendente noutro chat) resolve false, não uma Promise "truthy"', async () => {
  const h = montarQuadro();
  const painelA = { engine: 'claude', cwd: '/a' };
  const painelB = { engine: 'codex', cwd: '/b' };
  await h.q.abrir(painelA);
  h.q.Q.cena = cena('Fluxo pendente');   // ainda nao mandado pro chat
  const resultado = await h.q.abrir(painelB);   // recusado: toast, dono nao troca
  assert.equal(resultado, false, 'abrir() recusado tem que devolver false, não um valor truthy');
});

test('R3-007 quadro.js: abrir() de verdade (primeira abertura, tela vazia) resolve true', async () => {
  const h = montarQuadro();
  const painelA = { engine: 'claude', cwd: '/a' };
  const resultado = await h.q.abrir(painelA);
  assert.equal(resultado, true, 'abrir() que realmente abriu tem que devolver true');
});

test('R3-007 renderer/app.js: acaoDeMenu("quadro") só avisa main.js DEPOIS que a Promise resolve, com o valor real', async () => {
  const src = extractFn('acaoDeMenu', appSrc);
  const chamadas = [];
  let focusPane = { id: 'painel-1' };
  const window = {
    Quadro: { abrir: () => Promise.resolve(false) },   // simula o quadro recusando (bug do R2-025 reproduzido)
    api: { quadroAbriu: (ok) => chamadas.push(ok) },
  };
  const ctx = vm.createContext({ window, focusPane, console });
  vm.runInContext(src, ctx);
  const acaoDeMenu = vm.runInContext('acaoDeMenu', ctx);

  const retornoSincrono = acaoDeMenu('quadro');
  // antes do conserto, quadroAbriu(true) já tinha sido chamado aqui mesmo com abrir()==false
  assert.deepEqual(chamadas, [], 'não pode avisar main.js antes da Promise resolver');
  await new Promise((r) => setTimeout(r, 0));   // flush dos microtasks do .then() encadeado
  assert.deepEqual(chamadas, [false], 'com abrir() recusando (false), quadroAbriu tem que receber false — não true');
});

/* ===================== R3-043: quadro no iPhone perde sincronia depois da 1ª leitura ===================== */

test('R3-043 quadro.js: desenho humano intocado no iPhone continua trazendo atualização nova do Mac', async () => {
  const h = montarQuadro();
  h.q.Q.aberto = true;
  // 1) iPhone abriu e já trouxe um desenho humano do Mac (doClaude:0) — como no cenário do achado
  h.window.api.quadroRascunhoLer = async () => ({ cena: cena('Mac v1'), doClaude: 0 });
  await h.q.recuperarRascunho();
  assert.equal(h.q.Q.cena.formas[0].texto, 'Mac v1', 'primeira leitura tem que trazer o desenho do Mac');
  assert.equal(h.q.cenaIntocada(), true, 'sem mexer em nada, a cena tem que estar "intocada"');

  // 2) sem o Homero tocar em nada no iPhone, o Mac desenha mais (rascunho.json muda de novo)
  h.window.api.quadroRascunhoLer = async () => ({ cena: cena('Mac v2'), doClaude: 0 });
  const trouxeNovidade = await h.q.recuperarRascunho();

  assert.equal(trouxeNovidade, true, 'com a cena intocada, o vigia tem que voltar a reler o disco');
  assert.equal(h.q.Q.cena.formas[0].texto, 'Mac v2', 'o iPhone tem que acompanhar o que o Mac desenhou depois');
});

test('R3-043 quadro.js: desenho NÃO salvo do próprio iPhone continua protegido (guarda que já existia)', async () => {
  const h = montarQuadro();
  h.q.Q.aberto = true;
  h.window.api.quadroRascunhoLer = async () => ({ cena: cena('Mac v1'), doClaude: 0 });
  await h.q.recuperarRascunho();

  // Homero mexeu no desenho no iPhone e ainda não foi gravado (Q.rascunho.ultimo ficou pra trás)
  h.q.Q.cena = cena('Mexi no iPhone, não salvei ainda');
  assert.equal(h.q.cenaIntocada(), false, 'cena mexida não pode contar como intocada');

  h.window.api.quadroRascunhoLer = async () => ({ cena: cena('Mac v2'), doClaude: 0 });
  await h.q.recuperarRascunho();

  assert.equal(h.q.Q.cena.formas[0].texto, 'Mexi no iPhone, não salvei ainda',
    'desenho local não salvo não pode ser sobrescrito pela leitura do disco');
});
