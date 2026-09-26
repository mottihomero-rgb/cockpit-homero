'use strict';
/* Lote C — nao perder trabalho, e nao assustar a toa.
   1. trocar de motor e trocar de modo matavam o que estava rodando sem perguntar nada;
   2. recado do proprio app (versao nova, motor que falta) caia em VERMELHO dentro da conversa,
      no mesmo lugar dos erros do agente;
   3. avisoTemp recebia "isto e erro" e jogava fora: erro saia no cinza de recado comum;
   4. ⌘K apagava a tela e nao punha nada no lugar.
   Estes testes travam os quatro. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const raiz = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(raiz, 'renderer/app.js'), 'utf8');
const css = fs.readFileSync(path.join(raiz, 'renderer/style.css'), 'utf8');

/* Recorta uma funcao inteira do app.js contando chaves — o jeito da casa
   (ver avisos-que-faltam.test.cjs): o app.js e da tela, nao da para carregar aqui. */
function pegar(nome) {
  const i = app.indexOf('function ' + nome + '(');
  assert.ok(i > 0, 'a funcao ' + nome + ' tem de existir no app.js');
  let n = 0;
  for (let k = app.indexOf('{', i); k < app.length; k++) {
    if (app[k] === '{') n++;
    else if (app[k] === '}' && --n === 0) return app.slice(i, k + 1);
  }
  throw new Error('nao achei o fim de ' + nome);
}

/* tela de mentira: so o que o avisoTemp encosta (lista de filhos do chat) */
function fazerPainel(comTelaVazia) {
  const filhos = [];
  const chat = {
    children: filhos,
    appendChild(d) { filhos.push(d); d._tirar = () => { const i = filhos.indexOf(d); if (i >= 0) filhos.splice(i, 1); }; },
  };
  if (comTelaVazia) filhos.push({ className: 'pane-empty' });
  return { chat, el: { _filhos: filhos }, engine: 'claude' };
}

function motorDeAvisoTemp() {
  const ctx = { relogio: [] };
  vm.createContext(ctx);
  vm.runInContext(
    'function $(sel, el){ return (el && el._filhos || []).find(x => "." + x.className === sel) || null; }\n'
    + 'function clearEmpty(P){ const i = P.chat.children.findIndex(x => x.className === "pane-empty"); if (i >= 0) P.chat.children.splice(i, 1); }\n'
    + 'function voltarVazio(P){ P.chat.children.length = 0; P.chat.children.push({ className: "pane-empty" }); }\n'
    + 'function scroll(){}\n'
    + 'function setTimeout(fn){ relogio.push(fn); }\n'
    + 'const document = { createElement: () => ({ className: "", textContent: "", remove(){ this._tirar && this._tirar(); } }) };\n'
    + pegar('avisoTemp') + '\nthis.avisoTemp = avisoTemp;', ctx);
  return ctx;
}

/* ---------- 1. erro tem de sair vermelho, recado comum continua cinza ---------- */
test('avisoTemp usa o terceiro valor: erro sai vermelho, recado comum sai cinza', () => {
  const ctx = motorDeAvisoTemp();

  const P1 = fazerPainel(false);
  ctx.avisoTemp(P1, 'o Gemini não está instalado neste Mac', true);
  assert.equal(P1.chat.children[0].className, 'note err', 'erro tem de ganhar a marca vermelha');

  const P2 = fazerPainel(false);
  ctx.avisoTemp(P2, 'Foto anexada.');
  assert.equal(P2.chat.children[0].className, 'note', 'recado comum continua sem marca de erro');
});

test('o vermelho de .note.err sai de variavel de cor (vale nos 3 temas)', () => {
  const regra = css.split('\n').find((l) => l.startsWith('.note.err'));
  assert.ok(regra, 'a regra .note.err tem de existir no style.css');
  assert.match(regra, /var\(--/, 'cor na mao nunca: tem de vir de variavel');
});

/* ---------- 2. recado nao pode deixar o chat em branco ---------- */
test('num chat ainda vazio, a tela de "comece aqui" volta quando o recado some', () => {
  const ctx = motorDeAvisoTemp();
  const P = fazerPainel(true);
  ctx.avisoTemp(P, 'Tela limpa. A conversa continua de onde estava.');
  assert.equal(P.chat.children.length, 1, 'enquanto o recado esta na tela, so ele aparece');
  assert.equal(P.chat.children[0].className, 'note');
  ctx.relogio.forEach((fn) => fn());        // passaram os 12 segundos
  assert.equal(P.chat.children[0].className, 'pane-empty', 'sem isto sobra um retangulo em branco');
});

test('se a conversa comecou no meio-tempo, a tela de vazio NAO volta por cima', () => {
  const ctx = motorDeAvisoTemp();
  const P = fazerPainel(true);
  ctx.avisoTemp(P, 'Foto anexada.');
  P.chat.appendChild({ className: 'msg' });   // ele mandou uma mensagem
  ctx.relogio.forEach((fn) => fn());
  assert.ok(!P.chat.children.some((x) => x.className === 'pane-empty'), 'nao pode apagar a conversa');
});

/* ---------- 3. perguntar antes de cortar, e so quando ha o que perder ---------- */
function motorDeConfirmarCorte(respostaDele) {
  const ctx = { perguntas: [] };
  vm.createContext(ctx);
  vm.runInContext(
    'function agTrabalhando(P){ return !!(P && P.agentes); }\n'
    + 'function nomeDoMotor(){ return "Claude"; }\n'
    + 'function confirm(txt){ perguntas.push(txt); return ' + (respostaDele ? 'true' : 'false') + '; }\n'
    + pegar('confirmarCorte') + '\nthis.confirmarCorte = confirmarCorte;', ctx);
  return ctx;
}

test('chat parado nao pergunta nada (pergunta a toa e pior que nao perguntar)', () => {
  const ctx = motorDeConfirmarCorte(true);
  assert.equal(ctx.confirmarCorte({ busy: false }, 'Trocar de modo'), true);
  assert.equal(ctx.perguntas.length, 0, 'chat parado nao tem o que perder');
});

test('chat trabalhando pergunta, e o "nao" segura a troca', () => {
  const ctx = motorDeConfirmarCorte(false);
  assert.equal(ctx.confirmarCorte({ busy: true, titulo: 'arrumar a pagina' }, 'Trocar para o Codex'), false);
  assert.equal(ctx.perguntas.length, 1);
  assert.match(ctx.perguntas[0], /está trabalhando/, 'tem de dizer que ele esta trabalhando');
  assert.match(ctx.perguntas[0], /Trocar para o Codex joga fora/, 'tem de dizer o que se perde');
});

test('agente rodando por tras tambem conta como trabalho em andamento', () => {
  const ctx = motorDeConfirmarCorte(true);
  ctx.confirmarCorte({ busy: false, agentes: true }, 'Trocar de modo');
  assert.equal(ctx.perguntas.length, 1, 'o painel nao esta busy, mas tem agente trabalhando');
});

/* ---------- 4. quem tem de chamar quem (lido do proprio app.js) ---------- */
test('trocar de motor pergunta ANTES de mexer em qualquer coisa', () => {
  const f = pegar('trocarMotor');
  assert.ok(f.includes('confirmarCorte(P,'), 'trocarMotor tem de perguntar antes de cortar');
  assert.ok(f.indexOf('confirmarCorte(P,') < f.indexOf('P.engine = novo'),
    'perguntar depois de trocar o motor nao adianta nada');
});

test('trocar de modo pergunta antes de desligar o motor', () => {
  /* 26/09: o menu de Modos e o botão do plano (Claude, Gemini, ACP) trocam o modo pelo MESMO
     escolherModo; a garantia continua a mesma, agora num lugar só */
  assert.match(pegar('menuModos'), /escolherModo\(P, mo\)/, 'o menu troca o modo pelo caminho único');
  const f = pegar('escolherModo');
  assert.ok(f.includes('confirmarCorte(P,'), 'o menu de modos tem de perguntar antes');
  assert.ok(f.indexOf('confirmarCorte(P,') < f.indexOf('desligarMotor(P)'),
    'a pergunta vem antes de desligar o motor');
  assert.ok(f.includes('avisoTemp(P,'), 'o recado do modo escolhido tem de aparecer na tela');
  assert.ok(!/\bnote\(P,/.test(f), 'note() so escreve quando e erro: o recado sumia');
});

/* ---------- 5. recado do app nao entra na conversa como erro do agente ---------- */
test('aviso de versao nova vai para a faixa da janela, nao para dentro do chat', () => {
  const f = pegar('checarVersoesDosMotores');
  assert.ok(f.includes('mostrarAviso('), 'tem de usar a faixa de avisos que ja existe');
  assert.ok(!/\bnote\(/.test(f), 'recado do app nao pode sair em vermelho dentro da conversa');
  assert.ok(f.includes("id: 'versao-'"), 'com id a faixa lembra o que ele ja dispensou');
});

test('motor que nao esta instalado avisa na faixa, nao em vermelho no chat', () => {
  const f = pegar('avisarInstalacaoMotor');
  assert.ok(f.includes('mostrarAviso('), 'tem de usar a faixa de avisos');
  assert.ok(!/\bnote\(/.test(f), 'nao e erro do agente: e recado do app');
});

/* ---------- 6. ⌘K nao pode deixar o painel em branco ---------- */
test('⌘K devolve a tela de chat vazio e diz o que aconteceu', () => {
  const i = app.indexOf("a === 'clearPane'");
  assert.ok(i > 0, 'o atalho de limpar a tela tem de existir');
  const bloco = app.slice(i, i + 900);
  assert.ok(bloco.includes('voltarVazio(focusPane)'), 'sem isto sobra um retangulo em branco');
  assert.ok(bloco.includes("avisoTemp(focusPane, 'Tela limpa"), 'o recado tem de aparecer de verdade');
  assert.ok(bloco.indexOf('voltarVazio(focusPane)') < bloco.indexOf('avisoTemp(focusPane'),
    'primeiro a tela de vazio, depois o recado por cima dela');
});
