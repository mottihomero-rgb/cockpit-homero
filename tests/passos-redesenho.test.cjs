'use strict';
/* Redesenho de 26/09, area "o que a IA fez" (renderer/redesign/passos.css + app.js):
   - o tempo no jeito do design ("38s", "1m 02s", "2m") no grupo, no "Pensou por" e no trabalhando;
   - o cabecalho do grupo: "Executou 5 comandos", e "1 passo com erro" quando tudo deu errado;
   - o diff do Codex numera as linhas pelo "@@ -211,4 +211,4 @@" (o do Claude nao tem numero);
   - a linha do trabalhando diz o passo que roda agora, e nao "trabalhando";
   - o CSS da area so usa as cores do tema e nada de CAIXA ALTA espacada.
   Cada funcao e recortada do app.js real por contagem de chaves e roda numa VM. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const raiz = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(raiz, 'renderer/app.js'), 'utf8');
const css = fs.readFileSync(path.join(raiz, 'renderer/redesign/passos.css'), 'utf8');

function pegar(nome) {
  const m = new RegExp('^(?:async )?function ' + nome + '\\(', 'm').exec(app);
  assert.ok(m, 'a funcao ' + nome + ' tem de existir no app.js');
  const abre = app.indexOf('{', m.index);
  let n = 0, i = abre;
  for (; i < app.length; i++) {
    if (app[i] === '{') n++;
    else if (app[i] === '}' && --n === 0) { i++; break; }
  }
  return app.slice(m.index, i);
}
function rodar(nomes, extra = {}) {
  const ctx = { ...extra };
  vm.createContext(ctx);
  vm.runInContext(nomes.map(pegar).join('\n') + '\n' + nomes.map(n => 'this.' + n + ' = ' + n + ';').join('\n'), ctx);
  return ctx;
}

test('tempo no jeito do design: 38s, 1m 02s, 2m', () => {
  const { tempoCurto } = rodar(['tempoCurto']);
  assert.equal(tempoCurto(400), '0s');
  assert.equal(tempoCurto(38000), '38s');
  assert.equal(tempoCurto(62000), '1m 02s');
  assert.equal(tempoCurto(70000), '1m 10s');
  assert.equal(tempoCurto(120000), '2m');
});

/* grupo de mentira: so o que o tituloGrupo encosta */
function grupo(passos, t0) {
  const nm2 = { textContent: '' }, tempo = { textContent: '' };
  const card = { children: passos, querySelectorAll: () => passos.filter(p => p.erro) };
  const classes = new Set();
  const g = { dataset: { t0: String(t0) }, classList: { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)) } };
  const $ = (sel) => ({ '.exec-card': card, '.exec-nm2': nm2, '.exec-tempo': tempo })[sel];
  return { g, nm2, tempo, $ };
}
test('cabecalho do grupo: "Executou N comandos" + tempo, e o erro dito com todas as letras', () => {
  const agora = Date.now();
  let x = grupo([{}, {}, {}, {}, {}], agora - 38000);
  let c = rodar(['tempoCurto', 'tituloGrupo'], { $: x.$ });
  c.tituloGrupo(x.g);
  assert.equal(x.nm2.textContent, 'Executou 5 comandos');
  assert.equal(x.tempo.textContent, '38s');

  x = grupo([{ erro: true }], agora - 9000);
  c = rodar(['tempoCurto', 'tituloGrupo'], { $: x.$ });
  c.tituloGrupo(x.g);
  assert.equal(x.nm2.textContent, '1 passo com erro', 'grupo que so deu erro diz isso, como no design');

  x = grupo([{}, { erro: true }, {}], agora - 5000);
  c = rodar(['tempoCurto', 'tituloGrupo'], { $: x.$ });
  c.tituloGrupo(x.g);
  assert.equal(x.nm2.textContent, 'Executou 3 comandos · 1 com erro');

  // conversa reaberta: os passos voltam todos de uma vez e o tempo nao pode virar "0s"
  x = grupo([{}], agora);
  c = rodar(['tempoCurto', 'tituloGrupo'], { $: x.$ });
  c.tituloGrupo(x.g);
  assert.equal(x.nm2.textContent, 'Executou 1 comando');
  assert.equal(x.tempo.textContent, '');
});

test('diff do Codex numera as linhas pelo @@ (menos e mais na mesma linha do arquivo)', () => {
  const c = rodar(['linhasDoPatch', 'numerarPatch']);
  const cru = c.linhasDoPatch('@@ -211,4 +211,4 @@\n <div class="oferta">\n-  <a href="old">\n+  <a href="new">\n     Comprar agora');
  assert.equal(c.numerarPatch(cru), true);
  // o array nasce na VM (outro "Array"): compara pelo texto
  const numeros = cru.filter(l => l.t !== '@').map(l => l.t + l.n);
  assert.equal(JSON.stringify(numeros), JSON.stringify([' 211', '-212', '+212', ' 213']));
  // sem @@ (o antes/depois do Claude) nao inventa numero
  const semHunk = c.linhasDoPatch('-a\n+b');
  assert.equal(c.numerarPatch(semHunk), false);
  assert.ok(semHunk.every(l => l.n == null));
});

test('a linha do trabalhando diz o passo que roda agora, e cai em "Pensando" no silencio', () => {
  const { verboDoTrabalho } = rodar(['verboDoTrabalho']);
  assert.deepEqual({ ...verboDoTrabalho({ trabPassos: [{ id: 'a', verbo: 'Lendo', obj: 'checkout.js' }] }) }, { verbo: 'Lendo', obj: 'checkout.js' });
  assert.deepEqual({ ...verboDoTrabalho({ trabPassos: [], trabFazendo: 'Escrevendo' }) }, { verbo: 'Escrevendo', obj: '' });
  assert.deepEqual({ ...verboDoTrabalho({}) }, { verbo: 'Pensando', obj: '' });
  assert.doesNotMatch(pegar('pintaTrab'), /'trabalhando'/, 'a palavra "trabalhando" nao volta para a linha');
});

test('passos.css: so cor de tema e nada de caixa alta espacada', () => {
  const semDados = css.replace(/url\("data:[^"]*"\)/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(semDados, /#[0-9a-fA-F]{3,8}\b(?![-\w])/, 'cor cravada no CSS: tem de vir de variavel do tema');
  assert.doesNotMatch(semDados, /text-transform:\s*uppercase/);
  assert.doesNotMatch(semDados, /letter-spacing:\s*[.1-9]/);
  assert.match(semDados, /\.exec-card[^{]*\{[^}]*transition:[^}]*var\(--ease-in-out\)/, 'abrir e fechar tem de usar a curva do design');
});
