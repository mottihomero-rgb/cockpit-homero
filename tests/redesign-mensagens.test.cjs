'use strict';
/* Guarda da área MENSAGENS do redesenho (handoff do Claude Design, 25/09/2026).
   O que segura: as ações da minha mensagem na linha do "Você" (e não no pé da bolha), o ícone
   certo do "voltar no tempo", a barra do bloco de código com a linguagem, a miniatura da entrega
   fora do parágrafo, o "Levou …" do fim do turno e a regra do README "nada de CAIXA ALTA com
   letra espaçada". Mesmo jeito dos outros testes: extrai a função real do app.js e roda numa
   VM com stubs, sem abrir o Electron. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const raiz = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(raiz, 'renderer/app.js'), 'utf8');
const css = fs.readFileSync(path.join(raiz, 'renderer/redesign/mensagens.css'), 'utf8');

function func(nome, src = source) {
  const re = new RegExp('^(?:async )?function ' + nome + '\\(', 'm');
  const match = re.exec(src);
  assert.ok(match, nome + ' existe em renderer/app.js');
  const start = match.index;
  return src.slice(start, src.indexOf('\n}', start) + 2);
}

test('minha mensagem: copiar/editar/voltar nascem na linha do "Você", e o voltar usa o ícone rewind', () => {
  const corpo = func('userMsg');
  assert.match(corpo, /<div class="msg-role"><div class="msg-acoes"><\/div>/,
    'a barra de ações tem de nascer DENTRO do .msg-role (o barraDeAcoes acha ela ali)');
  const botoes = func('botoesDaMinhaMensagem');
  assert.match(botoes, /bVolta\.innerHTML = ico\('rewind'\)/);
  // o barraDeAcoes procura a barra com querySelector: achando a de dentro do rótulo, não cria outra no pé
  assert.match(func('barraDeAcoes'), /\$\('\.msg-acoes', msg\)/);
});

test('bloco de código: a linguagem do marked vai para o data-lang do <pre> (a barra de 28 lê dali)', () => {
  const c = { $: (sel, el) => el.q(sel), console };
  vm.createContext(c);
  vm.runInContext(func('botoesDeCopia'), c);
  c.botaoCopiar = () => ({ classList: { add() {} } });
  c.barraDeAcoes = () => ({ appendChild() {} });
  const mkPre = (classe) => {
    const code = { className: classe };
    return { classList: { add() {} }, dataset: {}, appendChild() {}, querySelector: (s) => (s === 'code' ? code : null), q: () => null };
  };
  const js = mkPre('language-js'), cru = mkPre(''), cpp = mkPre('hljs language-c++');
  const msg = { q: () => null };
  const b = { raw: '', el: { closest: () => msg, querySelectorAll: () => [js, cru, cpp] } };
  c.botoesDeCopia(b);
  assert.equal(js.dataset.lang, 'js');
  assert.equal(cru.dataset.lang, '', 'sem linguagem a barra fica só com o copiar');
  assert.equal(cpp.dataset.lang, 'c++');
  assert.match(css, /pre::before\{content:attr\(data-lang\)/, 'o CSS da barra lê o data-lang');
});

test('miniatura da entrega entra DEPOIS do parágrafo do link (o "." não cai embaixo da imagem)', () => {
  const inseridos = [];
  const mk = (nome) => ({ nome, classList: { contains: (x) => nome.startsWith('mini') && x === 'entrega-img' },
    nextElementSibling: null, after(x) { inseridos.push([this.nome, x]); this.nextElementSibling = x; } });
  const par = mk('par'); par.parentNode = {};
  const a = { textContent: 'Downloads/x.png', closest: (s) => (s === 'p' ? par : null), after(x) { inseridos.push(['link', x]); } };
  let n = 0;
  const c = { miniaturas: new Map(), lerParaVisor: () => new Promise(() => {}), verArquivo() {}, Promise, console,
    document: { createElement: () => { const el = mk('mini' + (++n)); el.className = ''; return el; } } };
  vm.createContext(c);
  vm.runInContext(func('miniaturaDaEntrega'), c);
  c.miniaturaDaEntrega({}, a, '/tmp/x.png');
  c.miniaturaDaEntrega({}, a, '/tmp/y.png');
  assert.equal(inseridos[0][0], 'par', 'a 1ª miniatura vai logo depois do parágrafo');
  assert.equal(inseridos[1][0], 'mini1', 'a 2ª vai depois da 1ª, na ordem dos links');
  assert.ok(!inseridos.some(([onde]) => onde === 'link'), 'nada é colado no meio da frase');
  // link fora de parágrafo (item de lista, tabela): continua colado no link
  const solto = { closest: () => null, after(x) { inseridos.push(['solto', x]); } };
  c.miniaturaDaEntrega({}, solto, '/tmp/z.png');
  assert.equal(inseridos[2][0], 'solto');
});

test('fim do turno: "Levou 2m" e "Ver mudanças · 1 arquivo"; consumo e contexto só no title', () => {
  const corpo = func('marcarFimDoTurno');
  assert.match(corpo, /'Levou ' \+ duracaoCurta\(levou\)/);
  assert.match(corpo, /'Ver mudanças · ' \+ n/);
  assert.match(corpo, /txt\.title = detalhe/, 'o consumo e o contexto continuam a um passar de mouse');
  const formata = (s) => s.replace(/m(\d\d)s$/, (_, seg) => (seg === '00' ? 'm' : 'm ' + Number(seg) + 's'));
  // o mesmo replace do app, aplicado ao formato do duracaoCurta: "2m00s" → "2m", "3m40s" → "3m 40s"
  assert.ok(corpo.includes(".replace(/m(\\d\\d)s$/, (_, seg) => (seg === '00' ? 'm' : 'm ' + Number(seg) + 's'))"));
  assert.equal(formata('2m00s'), '2m');
  assert.equal(formata('3m40s'), '3m 40s');
  assert.equal(formata('45s'), '45s');
});

test('mensagens.css: nada de CAIXA ALTA com letra espaçada, e o rótulo "VOCÊ"/"CLAUDE" desfeito', () => {
  assert.doesNotMatch(css, /text-transform\s*:\s*uppercase/i);
  assert.doesNotMatch(css, /letter-spacing\s*:\s*(?!0\b)[\d.]+/i, 'letter-spacing só pode ser 0 aqui');
  const role = /\.msg-role\{([^}]*)\}/.exec(css);
  assert.ok(role, 'a regra do .msg-role sumiu: ajuste este teste');
  assert.match(role[1], /text-transform:none/);
  assert.match(role[1], /letter-spacing:0/);
  // cor do assistente SÓ no logo: nada aqui tinge com --motor ou --logo-*
  assert.doesNotMatch(css, /var\(--(motor|logo-(claude|codex|gemini|grok))\)/);
});
