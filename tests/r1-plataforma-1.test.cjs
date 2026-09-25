'use strict';
// R1-042: ResizeObserver do plano vazava um nó a cada ciclo esvaziado/repreenchido.
// desenharPlano removia .pane-plano sem dar unobserve antes (compare com limparPlano,
// que sempre fez os dois juntos). Este teste falha sem o conserto: o Set do observer
// fake cresce a cada ciclo em vez de voltar a zero.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// DOM mínimo: só o suficiente pra desenharPlano rodar de ponta a ponta sem jsdom.
function makeElement(tag) {
  const el = {
    tagName: tag, className: '', style: {}, dataset: {}, textContent: '', attrs: {},
    children: [], parentNode: null,
    setAttribute(k, v) { this.attrs[k] = v; },
    appendChild(child) { child.parentNode = this; this.children.push(child); return child; },
    append(...xs) { for (const x of xs) this.appendChild(x); },
    insertBefore(child, ref) {
      child.parentNode = this;
      const i = ref ? this.children.indexOf(ref) : -1;
      if (i === -1) this.children.push(child); else this.children.splice(i, 0, child);
      return child;
    },
    replaceChildren(...xs) { for (const x of xs) x.parentNode = this; this.children = xs; },
    remove() {
      if (!this.parentNode) return;
      const i = this.parentNode.children.indexOf(this);
      if (i !== -1) this.parentNode.children.splice(i, 1);
      this.parentNode = null;
    },
    querySelector(sel) {
      const cls = sel.replace('.', '');
      return this.children.find(c => c.className === cls) || null;
    },
  };
  // innerHTML: mini-parse só pra materializar os filhos com class="..." que o
  // template de desenharPlano usa (pl-seta, pl-tit, pl-conta, pl-barra, pl-cheio).
  Object.defineProperty(el, 'innerHTML', {
    get() { return el._html || ''; },
    set(html) {
      el._html = html; el.children = [];
      const re = /class="([^"]+)"/g; let m;
      while ((m = re.exec(html))) {
        const child = makeElement('span'); child.className = m[1].split(' ')[0]; child.parentNode = el;
        el.children.push(child);
      }
    },
  });
  return el;
}
function fakeObserver() {
  const set = new Set();
  return { observe: n => set.add(n), unobserve: n => set.delete(n), disconnect: () => set.clear(), _set: set };
}
function contexto() {
  const c = {
    console,
    document: { createElement: tag => makeElement(tag) },
    $: (sel, root) => root ? root.querySelector(sel) : null,
    ico: () => 'icone',
    savePanes: () => {},
  };
  vm.createContext(c);
  const source = fs.readFileSync(path.join(__dirname, '../renderer/layout-hugo.js'), 'utf8');
  vm.runInContext(source, c);
  return c;
}

test('desenharPlano dá unobserve no .pane-plano antigo ao esvaziar (não vaza nó)', () => {
  const c = contexto();
  const el = makeElement('div');
  el.appendChild(Object.assign(makeElement('div'), { className: 'pane-perm' }));
  const P = { el, plano: [], tamanhoObserver: fakeObserver() };

  for (let i = 0; i < 5; i++) {
    c.desenharPlano(P, [{ txt: 'tarefa ' + i }]);
    c.desenharPlano(P, []);
  }

  assert.equal(P.tamanhoObserver._set.size, 0,
    'todo .pane-plano descartado tem que sair do ResizeObserver; ' + P.tamanhoObserver._set.size + ' nó(s) ficaram presos');
});
