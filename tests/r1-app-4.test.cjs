'use strict';
// Testes de guarda dos 4 defeitos do lote "app" (renderer/app.js), rodada 1.
// Padrao de extracao de funcao por regex + vm, igual a tests/auditoria-renderer-20260921.test.cjs.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../renderer/app.js'), 'utf8');

function func(nome, src = source) {
  const re = new RegExp('^(?:async )?function ' + nome + '\\(', 'm');
  const match = re.exec(src);
  assert.ok(match, nome + ' existe');
  const start = match.index;
  const line = src.slice(start, src.indexOf('\n', start));
  if (line.endsWith('}')) return line;
  return src.slice(start, src.indexOf('\n}', start) + 2);
}

// ---------- R1-030: openSession precisa repintar a borda de "aberta" ao abrir pela lista ----------
test('R1-030: openSession chama marcarAbertas() para a borda aparecer na hora', () => {
  const corpo = func('openSession');
  assert.ok(
    /marcarAbertas\(\)/.test(corpo),
    'openSession deve chamar marcarAbertas() apos abrir o painel, senao a borda de "aberta" so aparece depois de outro redesenho'
  );
});

// ---------- R1-032: bloco morto de reordenar por indice em soltarPane ----------
test('R1-032: soltarPane nao guarda mais o bloco morto que lia alvo.indice', () => {
  const corpo = func('soltarPane');
  assert.ok(
    !/alvo\.indice/.test(corpo),
    'alvoDoPane nunca devolve .indice (so outraAba/pilha/coluna): o bloco que lia alvo.indice era inalcancavel e devia ter sido removido'
  );
});

// ---------- R1-033: botao btnPickFolder que nao existe em html nenhum ----------
test('R1-033: nao sobra referencia a btnPickFolder (id inexistente nos dois HTML)', () => {
  assert.ok(!/btnPickFolder/.test(source), 'renderer/app.js nao deve mais referenciar #btnPickFolder');
  const indexHtml = fs.readFileSync(path.join(__dirname, '../renderer/index.html'), 'utf8');
  const indexWebHtml = fs.readFileSync(path.join(__dirname, '../renderer/index-web.html'), 'utf8');
  assert.ok(!/btnPickFolder/.test(indexHtml), 'index.html nunca teve #btnPickFolder');
  assert.ok(!/btnPickFolder/.test(indexWebHtml), 'index-web.html nunca teve #btnPickFolder');
});

// ---------- R1-031: arrastar aba de projeto para a direita erra o lugar ----------
// harness minimo: simula #abasLista com abas lado a lado e dispara mousemove/mouseup
// exatamente como o browser faria, pra flagrar a compensacao de indice errada.
function classes(...initial) {
  const set = new Set(initial);
  return { add: (...xs) => xs.forEach(x => set.add(x)), remove: (...xs) => xs.forEach(x => set.delete(x)),
    contains: x => set.has(x), toggle: (x, yes) => yes ? set.add(x) : set.delete(x) };
}
function elFake(aid, left, width) {
  return { dataset: { aid }, classList: classes(),
    getBoundingClientRect: () => ({ left, right: left + width, width, top: 0, height: 30, bottom: 30 }) };
}
function listaFake(items) {
  const children = items.slice();
  return {
    get children() { return children; },
    getBoundingClientRect: () => ({ left: 0, top: 0, height: 30 }),
    insertBefore(node, ref) {
      const i = children.indexOf(node);
      if (i !== -1) children.splice(i, 1);
      if (ref == null) { children.push(node); return; }
      const j = children.indexOf(ref);
      children.splice(j === -1 ? children.length : j, 0, node);
    },
  };
}
function fakeWindow() {
  const handlers = {};
  return { addEventListener: (ev, fn) => { handlers[ev] = fn; }, removeEventListener: (ev, fn) => { if (handlers[ev] === fn) delete handlers[ev]; },
    dispatchEvent() {}, api: {}, _h: handlers };
}
function montarDrag(ordemIds, larguras) {
  // ordemIds: ex ['a','b','c'] na ordem atual da tela; larguras: largura de cada aba (px)
  const abas = new Map();
  let x = 0; const els = [];
  for (const id of ordemIds) {
    const w = larguras[id] || 100;
    const el = elFake(id, x, w);
    els.push(el);
    abas.set(id, { id, cwd: '/' + id, el });
    x += w;
  }
  const lista = listaFake(els);
  const win = fakeWindow();
  const c = { console, Map, Set,
    $: (sel) => (sel === '#abasLista' ? lista : { style: {}, textContent: '', classList: classes() }),
    ico: () => 'icone', nomeProjeto: () => 'Projeto',
    document: { createElement: () => ({ style: {}, classList: classes(), appendChild() {}, remove() {} }),
      body: { classList: classes(), appendChild() {} } },
    window: win, abas, savePanes() {},
  };
  vm.createContext(c);
  vm.runInContext(func('comecarArrasteAba'), c);
  return { c, lista, abas, win };
}
function arrastar(h, A, clientXFinal) {
  h.c.comecarArrasteAba(h.abas.get(A), { clientX: 0 });
  h.win._h.mousemove({ clientX: 10 });          // so pra passar o limiar de 5px e ativar o arraste
  h.win._h.mousemove({ clientX: clientXFinal }); // posicao real de soltar
  h.win._h.mouseup({});
}
function ordemFinal(h) { return h.lista.children.map(el => el.dataset.aid); }

test('R1-031: arrastar a 1a aba pro fim (2 abas) vira [B,A], nao fica igual', () => {
  const h = montarDrag(['a', 'b'], { a: 100, b: 100 });
  arrastar(h, 'a', 250); // solta depois do fim de B (a marca prometeu [B,A])
  assert.deepEqual(ordemFinal(h), ['b', 'a']);
});

test('R1-031: 5 abas, arrastar a 1a pra depois da penultima vira [B,C,D,A,E]', () => {
  const h = montarDrag(['a', 'b', 'c', 'd', 'e'], { a: 100, b: 100, c: 100, d: 100, e: 100 });
  arrastar(h, 'a', 420); // entre D (300-400) e E (400-500): solta antes de E
  assert.deepEqual(ordemFinal(h), ['b', 'c', 'd', 'a', 'e']);
});

test('R1-031: 5 abas, arrastar a 4a pra antes da 2a vira [A,D,B,C,E]', () => {
  const h = montarDrag(['a', 'b', 'c', 'd', 'e'], { a: 100, b: 100, c: 100, d: 100, e: 100 });
  arrastar(h, 'd', 120); // antes do centro de B (100-200): solta antes de B
  assert.deepEqual(ordemFinal(h), ['a', 'd', 'b', 'c', 'e']);
});

test('R1-031: soltar na propria posicao nao muda a lista', () => {
  const h = montarDrag(['a', 'b', 'c'], { a: 100, b: 100, c: 100 });
  arrastar(h, 'a', 10); // mal saiu do lugar: ainda cai na posicao 0, a propria
  assert.deepEqual(ordemFinal(h), ['a', 'b', 'c']);
});
