'use strict';
/* Guarda da área MENSAGENS do redesenho (handoff do Claude Design, 25/09/2026).
   O que segura: as ações da minha mensagem na linha do "Você" (e não no pé da bolha), o ícone
   certo do "voltar no tempo", a barra do bloco de código com a linguagem, a miniatura da entrega
   fora do parágrafo, o "Levou …" do fim do turno e a regra do README "nada de CAIXA ALTA com
   letra espaçada". Revisão de 26/09: um rótulo por resposta, o copiar na linha do rótulo (nunca
   no pé, onde encavalava no "Levou"), tabela sem palavra partida, pergunta com a própria
   pergunta de título e "Pular", cursor no fim da lista e recados curtos com a dica no title.
   Mesmo jeito dos outros testes: extrai a função real do app.js e roda numa VM com stubs, sem
   abrir o Electron. */
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
  vm.runInContext(func('linguagemProvavel'), c);
  vm.runInContext(func('temRotuloAcima'), c);
  c.botaoCopiar = () => ({ classList: { add() {} } });
  c.barraDeAcoes = () => ({ appendChild() {} });
  const mkPre = (classe) => {
    const code = { className: classe, textContent: 'ls -la' };
    return { classList: { add() {} }, dataset: {}, appendChild() {}, querySelector: (s) => (s === 'code' ? code : null), q: () => null };
  };
  const js = mkPre('language-js'), cru = mkPre(''), cpp = mkPre('hljs language-c++');
  const msg = { q: () => null };
  const b = { raw: '', el: { closest: () => msg, querySelectorAll: () => [js, cru, cpp] } };
  c.botoesDeCopia(b);
  assert.equal(js.dataset.lang, 'js');
  assert.equal(cru.dataset.lang, 'bash', 'sem linguagem na cerca, vale o palpite (a barra nunca fica vazia)');
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

test('bloco sem linguagem: o palpite dá bash, json, html ou "texto" (nunca barra vazia)', () => {
  const c = {};
  vm.createContext(c);
  vm.runInContext(func('linguagemProvavel'), c);
  assert.equal(c.linguagemProvavel('npm run relatorio -- --mes 09'), 'bash');
  assert.equal(c.linguagemProvavel('$ git status\nOn branch main'), 'bash');
  assert.equal(c.linguagemProvavel('{"formato": "csv"}'), 'json');
  assert.equal(c.linguagemProvavel('<a class="btn">Comprar</a>'), 'html');
  assert.equal(c.linguagemProvavel('pasta/\n  arquivo.txt'), 'texto');
  assert.equal(c.linguagemProvavel(''), 'texto');
});

/* elementos de mentira com o mínimo que as funções usam: classList, dataset e irmãos */
function fala(classes, motor) {
  const set = new Set(classes.split(' '));
  return { classList: { contains: (x) => set.has(x) }, dataset: { motor }, previousElementSibling: null, nextElementSibling: null };
}
function emFila(...els) {
  els.forEach((e, i) => { e.previousElementSibling = els[i - 1] || null; e.nextElementSibling = els[i + 1] || null; });
  return els;
}

test('um rótulo por resposta: a 1ª fala depois da minha mensagem tem, as seguintes da mesma IA não', () => {
  const c = {};
  vm.createContext(c);
  vm.runInContext(func('falaContinua'), c);
  const P = (falas) => ({ engine: 'claude', chat: { querySelectorAll: () => falas } });
  assert.equal(c.falaContinua(P([])), false, 'conversa vazia: rótulo');
  assert.equal(c.falaContinua(P([fala('msg user')])), false, 'depois da minha mensagem (mesmo com passo no meio): rótulo');
  assert.equal(c.falaContinua(P([fala('msg user'), fala('msg bot', 'claude')])), true, 'continuação da mesma resposta: sem rótulo');
  assert.equal(c.falaContinua(P([fala('msg bot', 'codex')])), false, 'outra IA respondendo: rótulo de novo');
  assert.equal(c.falaContinua({ engine: 'claude', chat: {} }), false, 'sem DOM de verdade não quebra');
  // o botBlock usa a regra (e não mais o "veio depois de comando", que tirava o rótulo depois do passo)
  assert.match(func('botBlock'), /const semNome = falaContinua\(P\);/);
  assert.doesNotMatch(source, /botBlock\(P, 'resp', depoisDeComando\)/);
});

test('copiar da resposta: mora na linha do rótulo e leva a resposta inteira (falas sem rótulo juntas)', () => {
  // a barra entra no .msg-role quando ele existe; senão, ANTES do texto (nunca no pé da resposta)
  const barra = func('barraDeAcoes');
  assert.match(barra, /if \(rotulo\) rotulo\.appendChild\(barra\); else msg\.insertBefore\(barra, msg\.firstChild\);/);
  assert.doesNotMatch(barra, /msg\.appendChild\(barra\)/);
  const c = {};
  vm.createContext(c);
  vm.runInContext(func('textoDaResposta'), c);
  vm.runInContext(func('temRotuloAcima'), c);
  const [eu, r1, passo, r2, r3, eu2, r4] = emFila(fala('msg user'), fala('msg bot'), fala('exec'), fala('msg bot emenda'),
    fala('msg bot emenda'), fala('msg user'), fala('msg bot'));
  r1._texto = () => 'Primeira parte.'; r2._texto = () => 'Segunda.'; r3._texto = () => 'Terceira.'; r4._texto = () => 'Outra resposta.';
  assert.equal(c.textoDaResposta(r1), 'Primeira parte.\n\nSegunda.\n\nTerceira.', 'para na minha próxima mensagem');
  assert.equal(c.temRotuloAcima(r3), true, 'a continuação acha a fala do rótulo acima (passo no meio não conta)');
  assert.equal(c.temRotuloAcima(r4), false);
  assert.ok(eu && passo && eu2);
  // CSS: na linha do rótulo; o absoluto só vale para a barra solta (filha direta), e acima do texto
  assert.match(css, /\.msg\.bot \.msg-role \.msg-acoes\{/);
  assert.match(css, /\.msg\.bot > \.msg-acoes\{position:absolute;left:-5px;top:-22px/);
  assert.doesNotMatch(css, /top:calc\(100% - 4px\)/, 'nada pendurado no pé da resposta (encavalava no "Levou")');
});

test('tabela: palavra inteira na célula, colunas 1,2 / 1 / 1 e código sem pílula', () => {
  assert.match(css, /\.msg-body :is\(th,td\)\{overflow-wrap:break-word\}/, 'a coluna nunca fica mais fina que a maior palavra');
  assert.match(css, /\.msg-body thead th:first-child\{width:calc\(120% \/ \(var\(--cols\) \+ \.2\)\)\}/);
  assert.match(css, /\.msg-body :is\(th,td\) code\{padding:0;border-radius:0;background:none;font-size:12px/);
});

test('pergunta do assistente: a pergunta única é o título, o botão é "Pular" e o campo livre tem 1 linha', () => {
  const corpo = func('perguntaCodex');
  assert.match(corpo, /soUma \? \(perguntas\[0\]\.question \|\| perguntas\[0\]\.header\)/);
  assert.match(corpo, /if \(soUma\) legend\.className = 'cxq-oculto';/, 'o legend fica para o leitor de tela');
  assert.match(corpo, /'Cancelar' : 'Pular'/);
  assert.match(corpo, /outro\.rows = 1/);
  assert.match(css, /textarea\.cxq-input\{min-height:26px;[^}]*field-sizing:content\}/);
});

test('cursor da fala chegando: também no último item de lista, não só em parágrafo', () => {
  assert.match(css, /\.msg-body\.chegando > :is\(ul,ol\):last-child > li:last-child:not\(:has\(> :is\(ul,ol,p\)\)\)::after/);
});

test('recados de envio: poucas palavras na tela, a explicação no title', () => {
  assert.match(func('avisoEnvio'), /if \(dica\) d\.title = dica;/);
  assert.match(source, /avisoEnvio\(P, 'Esforço máximo', 'Liberei os workflows/);
  assert.doesNotMatch(source, /avisoEnvio\(P, 'Esforço máximo: liberei/);
});
