/* 26/09 (pedido dele): todo ícone sem palavra mostra, depois de um instantinho com o mouse em cima,
   uma janelinha com o nome e o que ele faz. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const raiz = path.resolve(__dirname, '..');
const fonte = fs.readFileSync(path.join(raiz, 'renderer/dica-icone.js'), 'utf8');

function carregar() {
  const ouvintes = {};
  const ctx = {
    window: { addEventListener() {} },
    document: { addEventListener: (t, f) => { ouvintes[t] = f; }, createElement: () => ({}) },
    setTimeout, clearTimeout, requestAnimationFrame: (f) => f(), innerWidth: 1400, innerHeight: 900,
  };
  vm.createContext(ctx);
  vm.runInContext(fonte, ctx);
  return { api: ctx.window.dicaIcone, ouvintes };
}
// um "elemento" que responde ao matches pelos seletores simples da lista
function elemento({ classes = [], dados = {}, titulo = '', texto = '', aria = {} }) {
  return {
    classList: { contains: (c) => classes.includes(c) }, dataset: dados, innerText: texto,
    getAttribute: (k) => (k === 'title' ? titulo : aria[k] || null),
    matches(sel) {
      return sel.split(',').some((s) => {
        s = s.trim();
        const m = /^\.([\w-]+)(?:\.([\w-]+))?(?:\[data-(\w+)="(\w+)"\])?$/.exec(s);
        if (!m) return false;
        return classes.includes(m[1]) && (!m[2] || classes.includes(m[2])) && (!m[3] || dados[m[3]] === m[4]);
      });
    },
  };
}

test('cada ícone da tela tem nome e o que faz', () => {
  const { api } = carregar();
  const casos = [
    [{ classes: ['act'], dados: { view: 'conversas' } }, 'Conversas'],
    [{ classes: ['act'], dados: { view: 'settings' } }, 'Ajustes'],
    [{ classes: ['side-lupa'] }, 'Buscar'],
    [{ classes: ['ch-lado'], dados: { motor: 'gemini' }, titulo: 'Gemini' }, 'Gemini'],
    [{ classes: ['p-compactar'], titulo: 'Memória da conversa: 316k de 1000k · 32%' }, 'Memória da conversa'],
    [{ classes: ['p-close'] }, 'Fechar chat'],
    [{ classes: ['cb', 'p-plus'] }, 'Anexar'],
    [{ classes: ['cb', 'p-slash'] }, 'Ações'],
    [{ classes: ['cb', 'p-mic'] }, 'Ditar'],
    [{ classes: ['cb', 'p-modoenvio'], aria: { 'aria-label': 'Fila' } }, 'Fila'],
    [{ classes: ['cb', 'p-cwd'], titulo: 'Pasta: Pedro · clique para trocar a pasta deste chat' }, 'Pasta do chat'],
    [{ classes: ['cb', 'p-quadro'] }, 'Quadro'],
    [{ classes: ['cb', 'p-agentes'] }, 'Agentes'],
    [{ classes: ['p-send'] }, 'Enviar'],
    [{ classes: ['msg-bt'], titulo: 'Voltar no tempo até aqui' }, 'Voltar até aqui'],
    [{ classes: ['msg-bt'], titulo: 'Corrigir e mandar de novo' }, 'Corrigir'],
    [{ classes: ['hi-mais'] }, 'Mais'],
  ];
  for (const [e, nome] of casos) {
    const d = api.dicaDe(elemento(e), e.titulo || '');
    assert.ok(d, 'sem dica: ' + nome);
    assert.equal(d.nome, nome);
    assert.ok(d.desc && d.desc.length > 10, nome + ': falta o que ele faz');
  }
  assert.match(api.dicaDe(elemento({ classes: ['p-compactar'] }), 'Memória da conversa: 316k de 1000k · 32%').desc, /Agora: 32%/);
  assert.match(api.dicaDe(elemento({ classes: ['cb', 'p-cwd'] }), 'Pasta: Pedro · clique para trocar').desc, /Agora: Pedro\./);
  assert.match(api.dicaDe(elemento({ classes: ['cb', 'p-modoenvio'], aria: { 'aria-label': 'Fila' } }), '').desc, /espera ele terminar/);
  // ícone fora da lista usa a dica que já tinha
  assert.deepEqual({ ...api.dicaDe(elemento({ classes: ['outro'] }), 'Abrir no Finder') }, { nome: '', desc: 'Abrir no Finder' });
});

test('só entra botão que é só ícone; o (i) e os anéis do topo ficam de fora; espera de meio segundo', () => {
  const { api } = carregar();
  assert.equal(api.soIcone({ innerText: '' }), true);
  assert.equal(api.soIcone({ innerText: '32%' }), true);
  assert.equal(api.soIcone({ innerText: 'Liberado' }), false);
  assert.match(fonte, /const ESPERA = 450;/);
  assert.match(fonte, /const NUNCA = '\.info,\.ut-ia,#usoTopo \*';/);
  assert.match(fs.readFileSync(path.join(raiz, 'renderer/index.html'), 'utf8'), /<script src="app\.js"><\/script>\n<script src="dica-icone\.js"><\/script>/);
});
