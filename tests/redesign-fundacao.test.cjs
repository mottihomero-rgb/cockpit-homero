'use strict';
/* Guarda da BASE do redesenho (handoff do Claude Design, 25/09/2026): tokens, arquivos de CSS
   por área, Aparência (Automática / Clara / Escura) e os ícones novos.
   Os agentes de cada área vão mexer no visual por cima disto; o que este teste segura é o chão:
   se um deles tirar os tokens do lugar, voltar a tingir o painel com a cor do motor ou pedir um
   ícone que não existe no icones.js, a tela quebra calada — por isso o teste. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const raiz = path.resolve(__dirname, '..');
const ler = (f) => fs.readFileSync(path.join(raiz, f), 'utf8');
const AREAS = ['base', 'janela', 'painel', 'mensagens', 'passos', 'caixa', 'lateral', 'menus', 'sheets'];

function aparencia({ escuro = false, contraste = false, semVidro = false } = {}) {
  const attrs = {};
  const documentElement = { setAttribute: (k, v) => { attrs[k] = v; }, getAttribute: (k) => attrs[k] };
  const casa = { '(prefers-color-scheme: dark)': escuro, '(prefers-contrast: more)': contraste,
    '(prefers-reduced-transparency: reduce)': semVidro };
  const window = { matchMedia: (q) => ({ matches: !!casa[q], addEventListener() {} }), dispatchEvent() {} };
  vm.runInNewContext(ler('renderer/aparencia.js'), { window, document: { documentElement }, CustomEvent: class {} });
  return { A: window.Aparencia, attrs };
}

test('o que estava salvo antes do redesenho vira a Aparência mais próxima (o Jornal era claro)', () => {
  const { A } = aparencia();
  assert.equal(A.normalizar('escuro'), 'escura');
  assert.equal(A.normalizar('claro'), 'clara');
  assert.equal(A.normalizar('jornal'), 'clara');
  assert.equal(A.normalizar(undefined), 'auto');
  assert.equal(A.normalizar('escura'), 'escura');
});

test('Automática segue o sistema, e contraste/transparência reduzida viram -hc', () => {
  assert.equal(aparencia({ escuro: true }).attrs['data-theme'], 'dark', 'o palpite de partida já sai no 1o quadro');
  assert.equal(aparencia({ escuro: false }).attrs['data-theme'], 'light');
  const { A, attrs } = aparencia({ escuro: false, contraste: true });
  A.aplicar('escura');
  assert.equal(attrs['data-theme'], 'dark-hc', 'Escura forca escuro mesmo com o sistema claro');
  assert.equal(aparencia({ escuro: true, semVidro: true }).attrs['data-theme'], 'dark-hc');
});

test('as duas páginas carregam tokens antes do style.css e as áreas depois, na ordem', () => {
  for (const pagina of ['renderer/index.html', 'renderer/index-web.html']) {
    const html = ler(pagina);
    const pos = (href) => html.indexOf('href="' + href + '"');
    assert.ok(pos('cockpit-tokens.css') > 0 && pos('cockpit-tokens.css') < pos('style.css'), pagina + ': tokens antes do style.css');
    let antes = Math.max(pos('style.css'), pos('quadro.css'), pos('celular.css'));
    for (const a of AREAS) {
      const p = pos('redesign/' + a + '.css');
      assert.ok(p > antes, pagina + ': redesign/' + a + '.css fora de ordem ou faltando');
      antes = p;
      assert.ok(fs.existsSync(path.join(raiz, 'renderer/redesign', a + '.css')), 'falta o arquivo redesign/' + a + '.css');
    }
    assert.match(html, /<html lang="pt-BR" data-theme="dark">/, pagina + ': sem data-theme a janela nasce sem cor');
    assert.ok(html.indexOf('src="icones.js"') > 0 && html.indexOf('src="icones.js"') < html.indexOf('src="quadro.js"'),
      pagina + ': o icones.js tem de vir antes do quadro.js e do app.js');
    assert.doesNotMatch(html, /data-tema=|Jornal/, pagina + ': o seletor antigo de tema voltou');
  }
});

test('a cor do motor não tinge mais o painel: --accent é o azul do sistema', () => {
  const css = ler('renderer/style.css') + ler('renderer/quadro.css');
  assert.doesNotMatch(css, /--accent:\s*var\(--(claude|codex|acp|gemini|grok|qd)\)/,
    'cor do assistente so no logo (README, regra 2): quem tinge e o --motor');
  assert.doesNotMatch(css, /data-tema/, 'o tema agora e data-theme no <html>');
  assert.match(ler('renderer/cockpit-tokens.css'), /--accent: #0A84FF;/, 'os tokens do handoff sairam do lugar');
});

test('todo ícone que o app e o quadro pedem existe no icones.js', () => {
  const window = {};
  vm.runInNewContext(ler('renderer/icones.js'), { window, globalThis: window });
  const CK = window.CK_ICONES;
  const app = ler('renderer/app.js');
  const mapa = app.match(/const ICONE_NOVO = \{([\s\S]*?)\};/)[1];
  for (const [, velho, novo] of mapa.matchAll(/'([^']+)':\s*'([^']+)'/g)) assert.ok(CK[novo], 'ico(\'' + velho + '\') aponta para ' + novo + ', que nao existe');
  const qd = ler('renderer/quadro.js').match(/const ICONES_QD = \{([\s\S]*?)\};/)[1];
  for (const [, velho, novo] of qd.matchAll(/(\w+):\s*'([^']+)'/g)) assert.ok(CK[novo], 'qico(\'' + velho + '\') aponta para ' + novo + ', que nao existe');
  // os logos provisorios do handoff ficaram de fora: logo de assistente e o oficial (svgMotor)
  assert.equal(Object.keys(CK).some(k => k.startsWith('logo-')), false);
  assert.match(window.ckIcone('plus'), /^<svg viewBox="0 0 16 16" class="ic"/);
  assert.doesNotMatch(window.ckIcone('plus').match(/^<svg[^>]*>/)[0], /\s(width|height)=/, 'o tamanho do icone e do CSS');
});
