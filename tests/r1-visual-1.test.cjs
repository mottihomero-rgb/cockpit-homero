'use strict';
/* Guarda dos achados R1-044 (index.html da raiz, cópia morta) e R1-043 (regras mortas/duplicadas
   em renderer/style.css: largura antiga de 5 painéis, #panes duplicado, .pane-split duplicado).
   Não dá pra medir width computado sem jsdom (não está no projeto), então a checagem é textual:
   confirma que o texto/arquivo morto sumiu e não volta sem querer. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const raiz = path.resolve(__dirname, '..');
const mainJs = fs.readFileSync(path.join(raiz, 'main.js'), 'utf8');
const css = fs.readFileSync(path.join(raiz, 'renderer/style.css'), 'utf8');

test('R1-044: index.html da raiz nao existe mais (cópia morta que ninguem carrega)', () => {
  const existe = fs.existsSync(path.join(raiz, 'index.html'));
  assert.equal(existe, false, 'index.html da raiz voltou a existir — ninguem o carrega (main.js so da loadFile em renderer/index.html) e confunde quem for editar a tela');
});

test('R1-044: a janela principal so carrega renderer/index.html', () => {
  const m = mainJs.match(/win\.loadFile\(path\.join\(__dirname,\s*'([^']+)'\)\)/);
  assert.ok(m, 'nao achei o loadFile da janela principal em main.js');
  assert.equal(m[1], 'renderer/index.html', 'a janela principal deveria carregar sempre renderer/index.html');
});

test('R1-043: formula antiga de largura (5 paineis lado a lado) nao esta mais em .pane', () => {
  assert.ok(!css.includes('(100% - 26px) / 5'),
    'a formula de largura do layout antigo de 5 paineis voltou ao .pane — ela e codigo morto, quem manda e .espaco > .coluna > .pane');
});

test('R1-043: #panes so tem UMA regra de overflow (a duplicada sobrescrevia a de cima)', () => {
  const ocorrencias = (css.match(/^#panes\{[^}]*\}/gm) || []).length;
  assert.equal(ocorrencias, 1, '#panes esta declarado mais de uma vez com overflow diferente — a de baixo sempre apagava a de cima');
});

test('R1-043: .pane-split so tem UMA declaracao (estava copiada palavra por palavra duas vezes)', () => {
  const ocorrencias = (css.match(/^\.pane-split\{/gm) || []).length;
  assert.equal(ocorrencias, 1, '.pane-split esta duplicado em renderer/style.css');
});
