'use strict';
/* Guarda dos consertos da rodada 1 no PAINEL DE CHAT (conferência do redesenho, 26/09):
   1. resposta nova: o chat que terminou sem estar em foco ganha o ponto azul de 7 antes do nome,
      e ele some quando o chat recebe foco (README, "Estados"). Antes o redesenho só tinha feito a
      metade do "parado = nada": o ponto azul nunca aparecia;
   2. ir até um chat (torre, faixa "esperando você", lista, recado do Mac) não pisca mais o painel
      (README, "Movimento": trocar de chat é instantâneo), e a piscada que sobrou (aviso do agente)
      para com Reduzir movimento;
   3. o chat vazio mostra "0k / 1000k" quando a janela do modelo é conhecida (tela E6);
   4. a busca ⌘F aberta não cobre mais a 1ª mensagem (os botões dela ficavam sem clique).
   Cada função é recortada do app.js real (contando chaves) e roda numa VM com os stubs que ela
   precisa — o mesmo padrão de tests/r3-app-4.test.cjs. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const raiz = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(raiz, 'renderer/app.js'), 'utf8');
const css = fs.readFileSync(path.join(raiz, 'renderer/redesign/painel.css'), 'utf8');

function pegar(nome) {
  const m = new RegExp('^(?:async )?function ' + nome + '\\(', 'm').exec(app);
  assert.ok(m, 'a função ' + nome + ' tem de existir no app.js');
  const abre = app.indexOf('{', m.index);
  let n = 0, i = abre;
  for (; i < app.length; i++) {
    if (app[i] === '{') n++;
    else if (app[i] === '}' && --n === 0) { i++; break; }
  }
  return app.slice(m.index, i);
}
const linhaConst = (nome) => {
  const l = app.split('\n').find((x) => x.startsWith('const ' + nome + ' = '));
  assert.ok(l, 'sumiu a const ' + nome);
  return l;
};
const blocoCelular = () => { const i = css.indexOf('@media (max-width: 820px)'); return css.slice(i, css.indexOf('\n}\n', i)); };
const classes = () => {
  const s = new Set();
  return { add: (c) => s.add(c), remove: (c) => s.delete(c), contains: (c) => s.has(c),
    toggle: (c, on) => { if (on === undefined) on = !s.has(c); if (on) s.add(c); else s.delete(c); return on; } };
};

/* ---------- 1. resposta nova ---------- */
function montarFoco() {
  const ctx = { window: {}, CustomEvent: function () {} };
  vm.createContext(ctx);
  vm.runInContext(`
    var focusPane = null, abaAtiva = null, panes = new Map();
    var globais = { '#tbTitle': { textContent: '' }, '#projName': null };
    function $(sel, el) { return el ? (el.achados[sel] || null) : globais[sel]; }
    function estadoDoPainel(P) { return { cls: P.finge || 'parado' }; }
    function abaDe() { return null; }
    function ativarAbaProjeto() {}
    function avisarQuemEspera() {}
    function loadTree() {}
    function atualizarGit() {}
    function shortPath(c) { return c || ''; }
    function nomeDoMotor(e) { return e; }
    function nomePasta(c) { return c || ''; }
    function pintarCorFoco() {}
    function marcarAbertas() {}
    function pintarSeloTorre() {}
    ${pegar('pintarPonto')}
    ${pegar('marcarRespostaNova')}
    ${pegar('setFocus')}
    this.pintarPonto = pintarPonto; this.marcarRespostaNova = marcarRespostaNova; this.setFocus = setFocus;
    this.panes = panes; this.foco = () => focusPane;`, ctx);
  const mk = (id) => {
    const P = { id, engine: 'claude', cwd: '/x', dotEstado: 'idle', el: { classList: classes(), achados: { '.p-dot': { className: '' } } } };
    ctx.panes.set(id, P);
    return P;
  };
  return { ctx, mk, ponto: (P) => P.el.achados['.p-dot'].className };
}

test('resposta nova: o chat que terminou fora do foco ganha o ponto azul, e ele some ao receber foco', () => {
  const { ctx, mk, ponto } = montarFoco();
  const gemini = mk('g'), claude = mk('c');
  ctx.setFocus(claude);

  ctx.marcarRespostaNova(gemini);
  ctx.pintarPonto(gemini);
  assert.equal(ponto(gemini), 'p-dot dot idle nova', 'o chat que respondeu fora do foco tem de ficar com "nova"');

  ctx.marcarRespostaNova(claude);
  ctx.pintarPonto(claude);
  assert.equal(ponto(claude), 'p-dot dot idle', 'no chat em foco a resposta já está na frente dele: sem ponto');

  ctx.setFocus(gemini);
  assert.equal(gemini.nova, false, 'recebeu foco: a novidade foi vista');
  assert.equal(ponto(gemini), 'p-dot dot idle', 'o ponto azul tem de sumir na hora em que o chat recebe foco');
  ctx.setFocus(claude);
  assert.equal(ponto(gemini), 'p-dot dot idle', 'voltar para outro chat não traz o ponto de volta');
});

test('resposta nova perde para trabalhando e para esperando (um sinal por chat)', () => {
  const { ctx, mk, ponto } = montarFoco();
  const P = mk('p'), outro = mk('o');
  ctx.setFocus(outro);
  ctx.marcarRespostaNova(P);
  P.dotEstado = 'busy';
  ctx.pintarPonto(P);
  assert.equal(ponto(P), 'p-dot dot busy', 'trabalhando ganha da resposta nova');
  P.dotEstado = 'idle'; P.finge = 'espera';
  ctx.pintarPonto(P);
  assert.equal(ponto(P), 'p-dot dot espera', 'esperando ganha de tudo');
  P.finge = 'parado';
  ctx.pintarPonto(P);
  assert.equal(ponto(P), 'p-dot dot idle nova', 'parou de trabalhar e ninguém olhou: a novidade continua lá');
});

test('o fim do turno marca a resposta nova ANTES de repintar o ponto, e o CSS desenha o ponto de 7 em --accent', () => {
  const i = app.indexOf("case 'turn-end':");
  const caso = app.slice(i, app.indexOf('break;', i));
  const marca = caso.indexOf('marcarRespostaNova(P)'), dot = caso.indexOf("setDot(P, 'idle')");
  assert.ok(marca > 0, 'o fim do turno parou de marcar a resposta nova');
  assert.ok(marca < dot, 'marcar depois do setDot deixa o ponto sem o "nova" até a próxima repintura');

  const r = css.match(/\.pane:has\(> \.pane-hd \.p-dot\.nova\) > \.pane-nome::before\{([^}]*)\}/);
  assert.ok(r, 'sumiu o ponto azul antes do nome (tela 04)');
  assert.match(r[1], /width:7px;height:7px/);
  assert.match(r[1], /border-radius:50%/);
  assert.match(r[1], /background:var\(--accent\)/);
  const erro = css.match(/\.note\.err\):not\(:has\(> \.pane-chat > \.note\.err ~ \.msg\)\) > \.pane-nome::before\{([^}]*)\}/);
  assert.ok(erro && /border-radius:0/.test(erro[1]), 'sem o raio 0 o erro herda o círculo da "nova" e o triângulo sai recortado');
  assert.match(blocoCelular(), /\.pane-hd \.p-dot\.nova\{display:block;width:7px;height:7px;border-radius:50%;\s*background:var\(--accent\)\}/,
    'o telefone mostra o mesmo sinal do Mac, inclusive o da resposta nova');
});

/* ---------- 2. ir até um chat não pisca ---------- */
test('ir até um chat é instantâneo: nenhum caminho de troca de chat chama piscar()', () => {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(`
    var piscou = 0, focou = null, panes = new Map();
    function piscar() { piscou++; }
    function setFocus(P) { focou = P; }
    function $() { return { focus() {} }; }
    ${pegar('irAoChat')}
    this.irAoChat = irAoChat; this.panes = panes; this.quantasPiscadas = () => piscou; this.quemFocou = () => focou;`, ctx);
  const P = { id: 'x', el: {} };
  ctx.panes.set('x', P);
  ctx.irAoChat(P);
  assert.equal(ctx.quemFocou(), P, 'ir até o chat continua pondo o foco nele');
  assert.equal(ctx.quantasPiscadas(), 0, 'a torre e o "Ir" da faixa voltaram a piscar o painel');

  // a lista de conversas (conversa já aberta) e o recado do sistema ("ir:")
  const lista = pegar('openSession');
  const ramo = lista.slice(lista.indexOf('if (trocando) {'), lista.indexOf('return trocando;'));
  assert.doesNotMatch(ramo, /piscar\(/, 'abrir da lista uma conversa já aberta voltou a piscar o painel');
  const ir = app.slice(app.indexOf("if (a.startsWith('ir:')) {"), app.indexOf('return;', app.indexOf("if (a.startsWith('ir:')) {")));
  assert.doesNotMatch(ir, /piscar\(/, 'o recado do sistema voltou a piscar o painel');
});

test('a piscada que sobrou (aviso do agente) para com Reduzir movimento', () => {
  const i = css.indexOf('@media (prefers-reduced-motion: reduce)');
  assert.ok(i > 0, 'sumiu o bloco de Reduzir movimento do painel');
  const bloco = css.slice(i, css.indexOf('\n}\n', i));
  assert.match(bloco, /\.pane\.piscando\{animation:none\}/, 'com Reduzir movimento o contorno azul continuava piscando 0,9 s');
});

/* ---------- 3. o tamanho da conversa no chat vazio ---------- */
function montarTokens(cfg) {
  const ctx = { gravou: 0 };
  vm.createContext(ctx);
  vm.runInContext(`
    var cfg = ${JSON.stringify(cfg || {})};
    var window = { api: { setConfig: (c) => { this.gravou++; return Promise.resolve({ ok: true }); } } };
    function $(sel, el) { return el.achados[sel] || null; }
    function pintarAnel() {}
    ${linhaConst('chaveJanela')}
    ${pegar('lembrarJanela')}
    ${pegar('janelaConhecida')}
    ${pegar('pintarTokens')}
    this.pintarTokens = pintarTokens; this.lembrarJanela = lembrarJanela; this.cfg = () => cfg;`, ctx);
  const mk = (model, extra) => {
    const el = { textContent: '', title: '', innerHTML: '', classList: classes() };
    return Object.assign({ engine: 'claude', model, tokens: 0, janela: 0, el: { achados: { '.p-tokens': el } } }, extra || {}, { meter: el });
  };
  return { ctx, mk };
}

test('chat vazio mostra "0k / 1000k" quando a janela do modelo é conhecida, e nada quando não é', () => {
  const { ctx, mk } = montarTokens();
  const um = mk('claude-opus-5-5[1m]');
  ctx.pintarTokens(um);
  assert.equal(um.meter.textContent, '0k / 1000k', 'modelo "[1m]" é 1 milhão pelo nome (tela E6)');
  assert.ok(um.meter.classList.contains('vazio'), 'o zero leva a classe "vazio": só aparece com o chat vazio');

  const semNada = mk('claude-opus-5-5');
  ctx.pintarTokens(semNada);
  assert.equal(semNada.meter.textContent, '', 'janela desconhecida: nada, nunca um tamanho chutado');

  // o motor contou a janela deste modelo uma vez: o próximo chat vazio já nasce sabendo
  ctx.lembrarJanela(semNada, 200000);
  ctx.lembrarJanela(semNada, 200000);
  assert.equal(ctx.cfg().janelas['claude|claude-opus-5-5'], 200000);
  assert.equal(ctx.gravou, 1, 'só grava o config quando a janela muda (o Codex avisa a cada passo)');
  const novo = mk('claude-opus-5-5');
  ctx.pintarTokens(novo);
  assert.equal(novo.meter.textContent, '0k / 200k');

  const cheio = mk('claude-opus-5-5[1m]', { tokens: 312000, janela: 1000000 });
  ctx.pintarTokens(cheio);
  assert.equal(cheio.meter.textContent, '312k / 1000k', 'com tokens o número continua o de sempre');
  assert.ok(!cheio.meter.classList.contains('vazio'));
});

test('quem recebe a janela do motor guarda ela, e o zero só aparece com o chat vazio de verdade', () => {
  const i = app.indexOf("case 'tokens':");
  assert.match(app.slice(i, app.indexOf('break;', i)), /lembrarJanela\(P, ev\.janela\)/, 'o aviso de tokens parou de guardar a janela do modelo');
  assert.match(app, /case 'janela': P\.janela = ev\.total; lembrarJanela\(P, ev\.total\)/);
  assert.match(pegar('fillModels'), /if \(!P\.tokens\) pintarTokens\(P\)/, 'trocar de modelo no chat vazio tem de trocar o "/ 1000k" junto');
  assert.match(css, /\.pane:not\(:has\(> \.pane-chat > \.pane-empty\)\) \.p-tokens\.vazio\{display:none\}/,
    'sem esta regra uma conversa restaurada (ainda sem o aviso de tokens) diria "0k"');
});

/* ---------- 4. a busca ⌘F não cobre a 1ª mensagem ---------- */
test('busca aberta: folga no topo da conversa, e a rolagem anda junto no meio da conversa', () => {
  assert.match(css, /\n\.pane:has\(> \.p-busca:not\(\.hidden\)\) > \.pane-chat\{padding-top:42px\}/,
    'sem a folga a barra cobre a linha "Você" da 1ª mensagem e os botões dela ficam sem clique');
  assert.match(blocoCelular(), /\.pane:has\(> \.p-busca:not\(\.hidden\)\) > \.pane-chat\{padding-top:10px\}/,
    'no telefone a busca fica no fluxo: a folga do Mac sobraria');

  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(`
    var aberta = false;
    function getComputedStyle() { return { paddingTop: aberta ? '42px' : '10px' }; }
    ${pegar('mostrarBarraBusca')}
    this.mostrarBarraBusca = mostrarBarraBusca; this.abrir = (v) => { aberta = v; };`, ctx);
  const barra = { classList: { toggle: (c, on) => ctx.abrir(!on) } };
  const P = { chat: { scrollTop: 300 } };
  ctx.mostrarBarraBusca(P, barra, true);
  assert.equal(P.chat.scrollTop, 332, 'no meio da conversa o texto não pode pular ao abrir a busca');
  ctx.mostrarBarraBusca(P, barra, false);
  assert.equal(P.chat.scrollTop, 300, 'nem ao fechar');
  const topo = { chat: { scrollTop: 0 } };
  ctx.mostrarBarraBusca(topo, barra, true);
  assert.equal(topo.chat.scrollTop, 0, 'no topo a folga tem de aparecer: é ela que tira a 1ª mensagem de baixo da barra');

  assert.match(pegar('abrirBuscaConversa'), /barra\.className = 'p-busca hidden'/,
    'a barra tem de nascer escondida: nascendo à vista, a 1ª abertura mede a folga já aplicada e não compensa a rolagem');
  assert.match(pegar('abrirBuscaConversa'), /mostrarBarraBusca\(P, barra, true\)/);
  assert.match(pegar('fecharBuscaConversa'), /mostrarBarraBusca\(P, barra, false\)/);
});
