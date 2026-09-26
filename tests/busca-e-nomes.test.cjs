'use strict';
/* Cinco queixas do dia a dia, todas da mesma familia: a tela prometia uma coisa e fazia outra.
   1) "Buscar conversa antiga" olhava SO o motor do chat em foco e SO a pasta da aba. Quem nao
      lembrasse em qual motor e em qual cliente a conversa nasceu nao achava nada.
   2) A tela "Nova aba" so deixava escolher pasta abrindo a janela do macOS, varias vezes por dia.
   3) ⌘D estava cravado no par Claude/Codex: num painel do Gemini ele abria um chat do Codex.
   4) O mesmo menu tinha duas linhas diferentes que faziam a MESMA coisa (abrir chat novo).
   5) A tela de atalhos anunciava ⌘⇧3, ⌘⇧4 e ⌘⇧5, que sao do proprio macOS (print da tela).

   Aqui esta o que nao pode voltar a quebrar. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const raiz = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(raiz, 'renderer/app.js'), 'utf8');
const principal = fs.readFileSync(path.join(raiz, 'main.js'), 'utf8');
const html = fs.readFileSync(path.join(raiz, 'renderer/index.html'), 'utf8');
const htmlWeb = fs.readFileSync(path.join(raiz, 'renderer/index-web.html'), 'utf8');

// pega o texto de uma funcao solta do app.js, do "function nome" ate o "}" na margem
function corpoDaFuncao(nome) {
  const i = app.indexOf('function ' + nome + '(');
  assert.ok(i > 0, 'a funcao ' + nome + ' tem de existir no app.js');
  const fim = app.indexOf('\n}\n', i);
  assert.ok(fim > i, 'nao achei o fim da funcao ' + nome);
  return app.slice(i, fim + 2);
}

/* ---- 1. a busca olha os quatro motores e o Mac inteiro ---- */

test('todasAsConversas junta os motores, tira repetida e poe a mais nova na frente', () => {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(
    "var MOTORES = ['claude','codex','acp','gemini','grok'];\n"
    + "var histCache = {\n"
    + "  claude: [{engine:'claude', id:'a', when:30}, {engine:'claude', id:'a', when:30}],\n"
    + "  codex:  [{engine:'codex',  id:'a', when:50}],\n"
    + "  acp:    null,\n"
    + "  gemini: [{engine:'gemini', id:'g', when:10}],\n"
    + "  grok:   null,\n"
    + "};\n" + corpoDaFuncao('todasAsConversas') + '\nthis.todasAsConversas = todasAsConversas;', ctx);
  const r = ctx.todasAsConversas();
  assert.equal(r.map(s => s.engine + ':' + s.id).join(' '), 'codex:a claude:a gemini:g',
    'tem de vir dos quatro motores, sem repetida e da mais nova para a mais velha');
});

test('a mesma id em motores diferentes continua sendo duas conversas', () => {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext("var MOTORES=['claude','codex'];var histCache={claude:[{engine:'claude',id:'x',when:1}],"
    + "codex:[{engine:'codex',id:'x',when:2}]};\n"
    + corpoDaFuncao('todasAsConversas') + '\nthis.todasAsConversas = todasAsConversas;', ctx);
  assert.equal(ctx.todasAsConversas().length, 2, 'id igual em motores diferentes nao e a mesma conversa');
});

test('digitando, a lista vem de todasAsConversas e nao do filtro de pasta', () => {
  assert.match(app, /const list = termo \? todasAsConversas\(\) : filtrarPorPasta\(engine, listaCrua\);/,
    'a busca tem de olhar tudo; o filtro de pasta so manda na lista parada');
  assert.match(app, /if \(termo\) lerHistoricoDeTodosOsMotores\(engine\);/,
    'motor cuja coluna nunca abriu tambem tem de entrar na busca');
});

test('enquanto ele busca, o botao de pasta diz "Mac inteiro" em vez de mentir', () => {
  const ctx = { rotulo: '', aceso: null };
  vm.createContext(ctx);
  vm.runInContext(
    "var alvo = { get textContent(){ return this.rotulo; }, set textContent(v){ this.rotulo = v; } };\n"
    + "var botao = { classList: { toggle: function(c, on){ this.aceso = on; }.bind(this) } };\n"
    + "var buscaAtual = { claude: '' };\n"
    + "function $(sel, dentro){ return dentro ? alvo : botao; }\n"
    + "function pastaDoFiltro(){ return '/Users/h/Desktop/Projetos-claude/Pedro'; }\n"
    + "function nomeProjeto(p){ return p.split('/').pop(); }\n"
    + "alvo.rotulo = ''; Object.defineProperty(alvo,'rotulo',{get:()=>this.rotulo,set:(v)=>{this.rotulo=v;}});\n"
    + corpoDaFuncao('pintarBotaoFiltro') + '\nthis.pintarBotaoFiltro = pintarBotaoFiltro;\nthis.buscaAtual = buscaAtual;', ctx);

  ctx.pintarBotaoFiltro('claude');
  assert.equal(ctx.rotulo, 'Pedro', 'parado, o botao mostra a pasta filtrada');
  assert.equal(ctx.aceso, true);

  ctx.buscaAtual.claude = 'checkout';
  ctx.pintarBotaoFiltro('claude');
  assert.equal(ctx.rotulo, 'Mac inteiro', 'buscando, a lista e o Mac inteiro e o botao tem de dizer isso');
  assert.equal(ctx.aceso, false);
});

test('cada resultado de busca diz de qual motor e de qual cliente veio', () => {
  assert.match(app, /function linhaDaBusca\(s, termo, trecho\)/, 'a linha com etiqueta tem de existir');
  assert.match(app, /nomeDoMotor\(s\.engine\)[\s\S]{0,60}clienteDe\(s\.cwd\)|clienteDe\(s\.cwd\)[\s\S]{0,60}nomeDoMotor\(s\.engine\)/,
    'a etiqueta tem de trazer motor E cliente');
  assert.equal(/box\.appendChild\(linhaConversa\(s, termo/.test(app), false,
    'no ramo da busca as linhas tem de ser as com etiqueta (linhaDaBusca)');
});

/* ---- 2. a tela "Nova aba" nao depende mais da janela de pastas do Mac ---- */

test('a tela Nova aba oferece as pastas em botao, e a janela do Mac fica por ultimo', () => {
  for (const [nome, fonte] of [['index.html', html], ['index-web.html', htmlWeb]]) {
    assert.match(fonte, /id="naAtalhosMac"/, nome + ': falta a fileira de pastas do Mac');
    assert.ok(fonte.indexOf('id="naAtalhosMac"') < fonte.indexOf('id="naPasta"'),
      nome + ': a fileira tem de vir ANTES do "Escolher a pasta…", que e o ultimo recurso');
  }
  assert.match(app, /naEstado\.pasta = \(cfg\.defCwd && cfg\.defCwd !== HOME\) \? cfg\.defCwd : '';/,
    'a tela tem de nascer na pasta padrao dos Ajustes');
  assert.match(app, /naPintar\(\);\n  naPintarAtalhosMac\(\);/,
    'telaNovaAba tem de desenhar a fileira de pastas');
});

/* ---- 3. ⌘D conhece os quatro motores ---- */

test('perguntar aos outros motores nao tem mais o par Claude/Codex cravado', () => {
  assert.equal(/const outro = P\.engine === 'codex' \? 'claude' : 'codex';/.test(app), false,
    'o par cravado era o bug: num painel do Gemini abria um chat do Codex');
  assert.match(app, /async function perguntarAosOutros\(P\)/);
  assert.match(app, /MOTORES_VISIVEIS\.filter\(m => m !== P\.engine && !motorIndisponivelNaPasta\(m, P\.cwd\)\)/,
    'so pode oferecer motor que da para usar nesta pasta');
  for (const [nome, fonte] of [['app.js', app], ['main.js', principal]]) {
    assert.equal(/Perguntar aos dois motores/.test(fonte), false, nome + ': o nome antigo ainda esta na tela');
  }
  assert.equal(/a mesma pergunta no Claude e no Codex/.test(app), false,
    'o texto do menu ainda diz que sao so dois');
});

/* ---- 4. um nome so para "abrir chat novo" ---- */

test('abrir chat novo tem UM nome, igual nos quatro lugares', () => {
  const NOME = 'Inicie um novo chat';
  const linhasDoMenu = app.split('\n').filter(l => /sec: '(Chat|Contexto)'/.test(l) && /novoChatNaAba|novaConversa\(P\.engine\)/.test(l));
  assert.equal(linhasDoMenu.length, 1, 'o menu do "/" tem de ter UMA linha de chat novo, nao duas');
  assert.match(linhasDoMenu[0], new RegExp("nome: '" + NOME + "'"));
  assert.match(principal, new RegExp("label: '" + NOME + "', accelerator: 'CmdOrCtrl\\+T'"), 'menu do Mac');
  for (const [nome, fonte] of [['index.html', html], ['index-web.html', htmlWeb]]) {
    assert.equal((fonte.match(/class="new-chat"/g) || []).length,
      (fonte.match(new RegExp('</svg> ' + NOME + '</button>', 'g')) || []).length,
      nome + ': todo botao da coluna lateral tem de usar o mesmo nome');
    assert.equal(/Nova conversa<\/button>/.test(fonte), false, nome + ': sobrou o nome antigo');
  }
  assert.equal(/Começar conversa nova/.test(app), false, 'a segunda porta com outro nome tem de sumir');
});

/* ---- 5. a tela de atalhos so promete o que o app consegue pegar ---- */

test('a tela de atalhos nao promete as teclas de print do macOS', () => {
  const i = app.indexOf('const ATALHOS = [');
  const tela = app.slice(i, app.indexOf('\n];\n', i));
  assert.ok(i > 0 && tela.length > 100, 'a lista de atalhos tem de existir');
  assert.equal(/⌘⇧[1-9]/.test(tela), false,
    '⌘⇧3, ⌘⇧4 e ⌘⇧5 sao do macOS (print da tela) e nunca chegam ao app');
  assert.match(tela, /⌘⌥1 … ⌘⌥9/, 'o atalho anunciado tem de ser uma combinacao livre no Mac');
  assert.equal(/coluna dos arquivos/.test(tela), false,
    '⌘B mostra a coluna de CONVERSAS; o texto antigo mentia');
  assert.match(tela, /Mostrar\/esconder a coluna de conversas/);
});

test('o numero da tecla sai do e.code, senao Shift e Option viram "!" e "¡"', () => {
  assert.match(app, /\/\^\(\?:Digit\|Numpad\)\(\[1-9\]\)\$\/\.exec\(e\.code \|\| ''\)/,
    'com modificador junto, e.key nao entrega o numero');
  assert.match(app, /if \(e\.altKey \|\| e\.shiftKey\) \{/,
    '⌘⌥ e o ⌘⇧ de antes tem de levar ao mesmo lugar: pular de chat');
});
