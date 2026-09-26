'use strict';
/* Guarda dos consertos da lista única de conversas (25/09, depois da revisão cética):
   - o nome da conversa costurada acompanha o nome automático novo na hora;
   - a lateral volta a ter a conta de cada IA (Entrar sem login, nome e plano com login);
   - o "forçar" da conta relê de verdade (o limite de 1 minuto é só do abrir a vista);
   - a IA cuja lista falhou aparece como uma linha curta, sem apagar as outras;
   - apagar a conversa de antes solta a costura pendente de quem trocou de IA;
   - as conversas do ACP voltam para a lista (sem repetir as do Grok);
   - a estrela e o lápis invisíveis param de comer a largura do título.
   Mesmo padrão dos r*-app-*: a função é recortada do app.js real e roda numa VM com stubs. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { loadMain } = require(path.join(__dirname, 'main-harness.cjs'));

const raiz = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(raiz, 'renderer/app.js'), 'utf8');
const css = fs.readFileSync(path.join(raiz, 'renderer/style.css'), 'utf8');
const celularCss = fs.readFileSync(path.join(raiz, 'renderer/celular.css'), 'utf8');

function pegar(nome, src = app) {
  const re = new RegExp('^(?:async )?function ' + nome + '\\(', 'm');
  const m = re.exec(src);
  assert.ok(m, 'a funcao ' + nome + ' tem de existir no app.js');
  const abre = src.indexOf('{', m.index);
  let n = 0, i = abre;
  for (; i < src.length; i++) {
    if (src[i] === '{') n++;
    else if (src[i] === '}' && --n === 0) { i++; break; }
  }
  return src.slice(m.index, i);
}
function pegarConst(nome, src = app) {
  const m = new RegExp('^const ' + nome + ' = .*;$', 'm').exec(src);
  assert.ok(m, 'o const ' + nome + ' tem de existir no app.js');
  return m[0];
}
const plano = (x) => JSON.parse(JSON.stringify(x));
const lig = (nova, anterior) => ({ [nova.engine + ':' + nova.id]: { ...nova, anterior } });

const A = { engine: 'claude', id: 'A', file: '/c/A.jsonl', cwd: '/p', title: 'Vídeo IA', when: 10 };
const C = { engine: 'codex', id: 'C', file: '/x/C.jsonl', cwd: '/p', title: 'Criação de Vídeo com IA', when: 20 };

/* ---------------- 1. o nome da cadeia acompanha o nome automático ---------------- */

function contextoNome() {
  const renomeados = [];
  let pinturas = 0;
  const ctx = { console, Map, Set, Math, Object, Promise, Date, LIGACOES: {}, NOMES_LIGADOS: {},
    histCache: { claude: [{ ...A }], codex: [{ ...C }] },
    window: { api: { renomear: async (o) => { renomeados.push(o); return true; } } },
    pintarNome() {}, savePanes() {}, painelAindaAtual: () => true, loadHist() {}, lateralAberta: () => true, pintarConversas: () => { pinturas++; } };
  vm.createContext(ctx);
  vm.runInContext([pegarConst('chaveParte'), pegarConst('refDaParte')].join('\n'), ctx);
  vm.runInContext(['ligacaoDe', 'partesDaCadeia', 'tituloDaCadeia', 'motoresDaCadeia', 'itemDaCadeia', 'montarCadeias',
    'lembrarNomeDaParte', 'mensagensDele', 'conversaDoNomeAtual', 'salvarNomeCurto'].map(n => pegar(n)).join('\n\n'), ctx);
  return { ctx, renomeados, pinturas: () => pinturas };
}

test('nome curto novo na parte de agora vale na hora para o título da cadeia na lista', async () => {
  const { ctx, renomeados, pinturas } = contextoNome();
  ctx.LIGACOES = lig(C, A);
  ctx.NOMES_LIGADOS = { A: 'Vídeo IA' };                         // o nome que a parte do Claude ganhou
  // 4a mensagem no Codex: o nomearCurto trocou o nome e chama o salvarNomeCurto
  const P = { engine: 'codex', sessaoId: 'C', resumeId: 'C', sessaoFile: '/x/C.jsonl', titulo: 'Criação de Vídeo com IA', nomeCurto: true };
  await ctx.salvarNomeCurto(P);
  assert.equal(renomeados.length, 1, 'o nomes.json continua sendo gravado');
  const item = ctx.montarCadeias(ctx.histCache.codex.concat(ctx.histCache.claude))[0];
  assert.equal(item.title, 'Criação de Vídeo com IA', 'a lista mostrava "Vídeo IA" até fechar e abrir a lateral');
  assert.ok(pinturas() >= 1, 'com a lateral aberta a lista se redesenha');
});

test('com a lateral fechada o nome novo não redesenha a lista à toa', async () => {
  const { ctx, pinturas } = contextoNome();
  ctx.lateralAberta = () => false;
  ctx.LIGACOES = lig(C, A);
  await ctx.salvarNomeCurto({ engine: 'codex', sessaoId: 'C', sessaoFile: '/x/C.jsonl', titulo: 'Novo', nomeCurto: true });
  assert.equal(ctx.NOMES_LIGADOS.C, 'Novo', 'a memória da cadeia acompanha mesmo fechada');
  assert.equal(pinturas(), 0);
});

test('fim do turno e volta para a janela releem a costura antes da lista (troca gravada no celular)', () => {
  assert.match(app, /if \(lateralAberta\(\)\) lerLigacoes\(\)\.then\(\(\) => loadHist\(P\.engine, true\)\);/,
    'o fim do turno relia só a lista; a costura gravada por outro chat ou pelo celular ficava partida');
  assert.match(app, /window\.addEventListener\('focus', \(\) => \{\s*if \(lateralAberta\(\)\) lerLigacoes\(\)\.then\(\(\) => pintarConversas\(\)\);/);
});

/* ---------------- 2. a conta de cada IA no topo da lista ---------------- */

function fakeEl() {
  const cls = new Set();
  const e = {
    dataset: {}, title: '', parts: {}, _html: '', listeners: {},
    classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c), contains: (c) => cls.has(c) },
    addEventListener(t, f) { this.listeners[t] = f; },
    remove() { if (this.pai) this.pai.children.splice(this.pai.children.indexOf(this), 1); },
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = v; this.parts = {}; },
  };
  return e;
}
function contextoConta(extras = {}) {
  const cx = { children: [], insertBefore(b, ref) { b.pai = this; const i = ref ? this.children.indexOf(ref) : -1;
    if (i < 0) this.children.push(b); else this.children.splice(i, 0, b); } };
  const acoes = [];
  const ctx = {
    console, Date, Math, MOTORES_VISIVEIS: ['claude', 'codex', 'gemini', 'grok'], MOTORES_OK: null,
    panes: new Map(), focusPane: null, abaAtiva: null, contaCache: {}, contaLidaEm: { claude: 0, codex: 0, gemini: 0, grok: 0 },
    document: { createElement: () => fakeEl() },
    svgMotor: (m) => '<svg data-m="' + m + '"></svg>', nomeDoMotor: (m) => m[0].toUpperCase() + m.slice(1),
    escaparAtributo: (v) => String(v), quandoFuturo: () => 'em 2 h', haQuanto: () => '5 min',
    setFocus() {}, note() {}, novoChatNaAba: () => null,
    contaAcao: (P, acao, eng) => acoes.push(acao + ':' + eng + ':' + P.engine),
    janelaConta: (P, eng) => acoes.push('janela:' + eng),
    $: (sel, root) => {
      if (sel === '#cvUso') return cx;
      const m = /^\.cv-uso-motor\[data-motor="(\w+)"\]$/.exec(sel);
      if (m) return root.children.find(b => b.dataset.motor === m[1]) || null;
      if (sel.startsWith('.cv-uso-')) {
        if (!root.innerHTML.includes('class="' + sel.slice(1) + '"')) return null;
        return (root.parts[sel] = root.parts[sel] || { textContent: '', onclick: null });
      }
      return null;
    },
    ...extras,
  };
  vm.createContext(ctx);
  vm.runInContext(['entrarNaConta', 'pintarContaLateral', 'pintarUsoLateral', 'pintarBlocoDeUso', 'abrirContaDaLateral', 'textoDoZera']
    .map(n => pegar(n)).join('\n\n'), ctx);
  return { ctx, cx, acoes, bloco: (m) => cx.children.find(b => b.dataset.motor === m) };
}

test('IA sem login neste Mac: logo + "Vincular conta do Claude", e o botão roda o login do motor CERTO', () => {
  const { ctx, cx, acoes, bloco } = contextoConta();
  const P = { engine: 'claude' };
  ctx.panes.set('p1', P);
  ctx.focusPane = { engine: 'codex' };                           // chat do Codex em foco: não pode rodar codex login
  ctx.pintarBlocoDeUso(cx, 'claude', { entrou: false });
  const b = bloco('claude');
  assert.ok(b, 'sem login a coluna não pode ficar sem nenhum caminho para entrar');
  assert.ok(b.classList.contains('sem-conta'));
  assert.match(b.innerHTML, /<button class="cv-uso-entrar">Vincular conta do Claude<\/button>/);
  assert.match(b.title, /Sem conta do Claude neste Mac/, 'a explicação fica no title, não na tela');
  b.parts['.cv-uso-entrar'].onclick({ stopPropagation() {} });
  assert.deepEqual(acoes, ['login:claude:claude']);
  b.listeners.click();                                           // clicar fora do botão não abre a janela da conta
  assert.deepEqual(acoes, ['login:claude:claude']);
});

/* 26/09 (desenho novo, área lateral): a linha diz QUAL IA é ("Codex"), como o título da coluna do
   desenho; a conta (nome/e-mail) foi para a dica. Antes a linha mostrava o e-mail. */
test('com login: logo + nome da IA + plano (a conta na dica), com as barras quando houver número', () => {
  const { ctx, cx, acoes, bloco } = contextoConta();
  ctx.panes.set('p1', { engine: 'codex' });
  ctx.pintarBlocoDeUso(cx, 'codex', { entrou: true, email: 'h@x.com', plano: 'Pro', sessao: { pct: 12 }, semana: { pct: 40, reseta: 1 } });
  const b = bloco('codex');
  assert.equal(b.parts['.cv-uso-nome'].textContent, 'Codex');
  assert.match(b.title, /h@x\.com/, 'a conta continua a um passar de mouse');
  assert.equal(b.parts['.cv-uso-plano'].textContent, 'Pro');
  assert.match(b.innerHTML, /Sessão[\s\S]*12%[\s\S]*Semana[\s\S]*40%/);
  b.listeners.click();
  assert.deepEqual(acoes, ['janela:codex'], 'clicar no bloco abre a conta daquela IA');
});

/* 26/09 (revisão da área lateral, depois do desenho novo): IA com login mas SEM número de uso
   não ocupa linha. Antes ela ficava como logo + nome solto entre as barras e a pasta (o Grok
   nunca tem número; o Claude antes da primeira leitura ou com a consulta segurada), e os quatro
   blocos empurravam a lista para baixo. A conta dela continua no menu do chat (Conta), e sem
   login o bloco com o "Entrar" fica (teste acima). */
test('IA logada sem número de uso não ocupa linha; com número ela aparece, na ordem dos motores', () => {
  const { ctx, cx, bloco } = contextoConta();
  ctx.pintarBlocoDeUso(cx, 'grok', { entrou: true, email: 'k@x.com' });
  assert.equal(bloco('grok'), undefined, 'logo + nome solto, sem barra nenhuma, não entra');
  ctx.pintarBlocoDeUso(cx, 'gemini', { entrou: true, email: 'g@x.com', semana: { pct: 100, reseta: Date.now() + 3600e3 } });
  assert.ok(bloco('gemini'));
  assert.equal(bloco('gemini').parts['.cv-uso-nome'].textContent, 'Gemini');
  assert.match(bloco('gemini').title, /g@x\.com/);
  // o reset sai na hora em que zera; quanto falta fica na dica
  assert.match(bloco('gemini').innerHTML, /<span class="cv-uso-zera" title="zera em 2 h">zera (\S+ )?\d\d:\d\d<\/span>/);
  ctx.pintarBlocoDeUso(cx, 'claude', { entrou: true, nome: 'Homero', plano: 'Max', limitado: true, voltaEm: 1 });
  assert.equal(bloco('claude'), undefined, 'consulta segurada sem número guardado: nada no topo');
  ctx.pintarBlocoDeUso(cx, 'claude', { entrou: true, nome: 'Homero', plano: 'Max', sessao: { pct: 24 }, velho: 1 });
  assert.match(bloco('claude').title, /Última leitura 5 min/, 'número guardado: o quando vai no title');
  // a ordem dos blocos é a dos motores, chegue quem chegar primeiro
  assert.deepEqual(cx.children.map(b => b.dataset.motor), ['claude', 'gemini']);
  // o número sumiu numa leitura nova: o bloco sai, em vez de virar a linha solta
  ctx.pintarBlocoDeUso(cx, 'gemini', { entrou: true, email: 'g@x.com' });
  assert.deepEqual(cx.children.map(b => b.dataset.motor), ['claude']);
});

test('IA que não está instalada neste Mac não aparece', () => {
  const { ctx, cx, bloco } = contextoConta({ MOTORES_OK: { grok: false } });
  ctx.pintarBlocoDeUso(cx, 'grok', { entrou: false });
  assert.equal(bloco('grok'), undefined);
});

test('forçar a leitura da conta relê SEMPRE; a trava de 1 minuto é só do abrir a vista', async () => {
  let leituras = 0;
  const { ctx } = contextoConta();
  ctx.window = { api: { contaLer: async () => { leituras++; return { entrou: true, email: 'novo@x.com' }; } } };
  ctx.contaCache.codex = { entrou: false };
  ctx.contaLidaEm.codex = Date.now() - 5000;                     // a vista acabou de abrir e leu
  await ctx.pintarContaLateral('codex', true);                   // evento 'account' do Codex (login novo)
  assert.equal(leituras, 1, 'o login do Codex ficava velho até fechar e abrir a lateral depois de 60 s');
  assert.equal(ctx.contaCache.codex.email, 'novo@x.com');
  // abrir a vista de novo logo em seguida não relê (a Anthropic responde 429)
  for (const m of ['claude', 'gemini', 'grok']) { ctx.contaCache[m] = { entrou: false }; ctx.contaLidaEm[m] = Date.now(); }
  ctx.pintarUsoLateral(true);
  await new Promise(r => setImmediate(r));
  assert.equal(leituras, 1);
  ctx.contaLidaEm.claude = Date.now() - 61000;
  ctx.pintarUsoLateral(true);
  await new Promise(r => setImmediate(r));
  assert.equal(leituras, 2, 'passado 1 minuto, abrir a vista relê');
});

test('o ↻ da lista relê as conversas e a conta', () => {
  assert.match(app, /b\.addEventListener\('click', \(\) => \{ recarregarConversas\(true\); pintarUsoLateral\(true\); \}\)/);
});

/* ---------------- 3. a lista de uma IA que falha ---------------- */

function contextoLista() {
  const box = { children: [], innerHTML: '', replaceChildren(...k) { this.children = k; } };
  const erros = { children: [], replaceChildren(...k) { this.children = k; }, appendChild(x) { this.children.push(x); } };
  const ctx = {
    console, Promise, Object, String, MOTORES: ['claude', 'codex', 'acp', 'gemini', 'grok'], MOTORES_OK: null,
    histCache: { claude: [{ id: 'x' }] }, leituraHistorico: {}, cfg: {},
    caixaHist: () => box, pintarConversas() {}, juntarComVps: (e, l) => l, buscarConversasVps() {},
    svgMotor: (m) => '<svg data-m="' + m + '"></svg>', nomeDoMotor: (m) => m,
    $: (sel) => sel === '#cvErros' ? erros : null,
    document: { createElement: () => ({ dataset: {}, addEventListener(t, f) { this.clique = f; } }) },
    window: { api: {} },
  };
  vm.createContext(ctx);
  vm.runInContext([pegarConst('erroDaLista'), pegar('pintarErrosDaLista'), pegar('loadHist')].join('\n')
    + '\nthis.erroDaLista = erroDaLista;', ctx);
  return { ctx, box, erros };
}

test('lista do Codex que falha com a do Claude na tela: linha curta no topo, sem trocar a lista pelo erro', async () => {
  const { ctx, box, erros } = contextoLista();
  ctx.window.api.sessionsCodex = async () => { throw new Error('app-server fora do ar'); };
  await ctx.loadHist('codex');
  assert.equal(box.children.length, 0, 'as conversas do Claude continuam na caixa');
  assert.equal(erros.children.length, 1, 'antes as do Codex sumiam da lista e nada era dito');
  const e = erros.children[0];
  assert.equal(e.dataset.motor, 'codex');
  assert.match(e.innerHTML, /<span>indisponível<\/span>/, 'só rótulo na tela');
  assert.match(e.title, /app-server fora do ar/, 'o motivo vai no title');
  // voltou a ler: a linha sai sozinha
  ctx.window.api.sessionsCodex = async () => [{ id: 'c1' }];
  await ctx.loadHist('codex');
  assert.equal(erros.children.length, 0);
  assert.deepEqual(plano(ctx.histCache.codex), [{ id: 'c1' }]);
});

test('a linha de erro existe no Mac e no celular', () => {
  for (const arq of ['index.html', 'index-web.html']) {
    const html = fs.readFileSync(path.join(raiz, 'renderer', arq), 'utf8');
    assert.match(html, /<div class="cv-erros" id="cvErros"><\/div>\s*<div class="hist" id="histTodas">/, arq);
  }
});

/* ---------------- 4. apagar a conversa de antes de uma troca pendente ---------------- */

test('apagar a conversa de antes enquanto um chat troca de IA solta a costura pendente', async () => {
  const pendente = { id: 'q1', engine: 'codex', resumeId: null, sessaoId: null, parteAnterior: { engine: 'claude', id: 'A', file: '/c/A.jsonl', cwd: '/p' }, partesAnteriores: [] };
  const velho = { id: 'q2', engine: 'gemini', resumeId: 'G', sessaoId: 'G', parteAnterior: null,
    partesAnteriores: [{ engine: 'claude', id: 'A', file: '/c/A.jsonl' }, { engine: 'codex', id: 'Z' }] };
  const ctx = {
    console, panes: new Map([['q1', pendente], ['q2', velho]]), window: { api: { paneStop: async () => {} } },
    cfg: { abas: [{ chats: [{ sessao: '', parteAnterior: { engine: 'claude', id: 'A' } }] }] },
    histCache: { claude: [A] }, LIGACOES: {}, NOMES_LIGADOS: {},
  };
  vm.createContext(ctx);
  for (const n of ['note', 'pararTrabalho', 'limparPassos', 'limparContinuar', 'escondePerm', 'setDot', 'savePanes', 'esquecerCadeiaDoPainel']) ctx[n] = () => {};
  vm.runInContext([pegarConst('chaveFav'), pegar('esquecerParteApagada'), pegar('esquecerLigacoesLocais')].join('\n'), ctx);
  await ctx.esquecerParteApagada(A);
  assert.equal(pendente.parteAnterior, null, 'a próxima mensagem gravaria C → A com A na Lixeira (parte fantasma)');
  assert.deepEqual(velho.partesAnteriores.map(p => p.id), ['Z'], 'quem tinha A na cadeia larga ela');
  assert.equal(ctx.cfg.abas[0].chats[0].parteAnterior, undefined, 'e a aba gravada que ainda não voltou também');
});

/* ---------------- 5. as conversas do ACP ---------------- */

function contextoRecarregar(api = {}) {
  const lidas = [];
  let releu = 0, pinturas = 0;
  const ctx = { console, Promise, MOTORES_VISIVEIS: ['claude', 'codex', 'gemini', 'grok'], histCache: {},
    window: { api }, lateralAberta: () => true,
    lerLigacoes: async () => { releu++; }, loadHist: async (m) => { lidas.push(m); }, pintarConversas() { pinturas++; } };
  vm.createContext(ctx);
  vm.runInContext([pegarConst('MOTORES_DA_LISTA'), 'let lendoTodoHistorico = false;', pegarConst('historicoJaPedido'),
    'let costuraAntigaPedida = false;', pegar('recarregarConversas'), pegar('lerHistoricoDeTodosOsMotores')].join('\n'), ctx);
  return { ctx, lidas, releu: () => releu, pinturas: () => pinturas };
}

test('a lista única e a busca leem também o ACP (Qwen, OpenCode…)', async () => {
  const { ctx, lidas } = contextoRecarregar();
  await ctx.recarregarConversas(true);
  assert.ok(lidas.includes('acp'), 'sem ler o ACP as conversas dele sumiam da lista e a parte ACP da cadeia virava fantasma');
  lidas.length = 0;
  await ctx.lerHistoricoDeTodosOsMotores();
  assert.ok(lidas.includes('acp'), 'a busca também procura nelas');
});

test('a lista do ACP não repete as conversas do Grok (que já vêm pela lista dele)', () => {
  const h = loadMain();
  h.evaluate(`acp.sessoes = () => [
    { engine: 'acp', id: 'q', file: '/a/q.jsonl', comando: 'qwen --acp', title: 'pedido do qwen', when: 2 },
    { engine: 'acp', id: 'g', file: '/a/g.jsonl', comando: '/opt/bin/grok agent stdio', title: 'pedido do grok', when: 1 },
  ];`);
  assert.deepEqual(plano(h.call('sessions:acp')).map(s => s.engine + ':' + s.id), ['acp:q']);
  assert.deepEqual(plano(h.call('sessions:cli', 'grok')).map(s => s.engine + ':' + s.id), ['grok:g']);
});

/* ---------------- 6. a largura do título na linha ---------------- */

test('fora do :hover a estrela e o lápis não ocupam a largura do título (só com mouse)', () => {
  const i = css.indexOf('@media (hover:hover){');
  assert.ok(i >= 0);
  const bloco = css.slice(i, css.indexOf('\n}', i));
  assert.match(bloco, /\.hist-item:not\(\.com-trecho\):not\(\.com-onde\) \.hi-fav:not\(\.on\),\s*\.hist-item:not\(\.com-trecho\):not\(\.com-onde\) \.hi-edit\{width:0;margin-left:-7px;overflow:hidden/,
    'com opacity:0 eles continuavam com 20px cada: o título caía para ~10 letras');
  assert.match(bloco, /:hover \.hi-fav,\s*\.hist-item:not\(\.com-trecho\):not\(\.com-onde\):hover \.hi-edit\{width:20px;margin-left:0\}/);
  // no celular (toque, sem :hover) os quatro continuam sempre visíveis e com largura
  assert.match(celularCss, /\.hi-fav,\.hi-edit,\.hi-grupo,\.hi-mais\{opacity:1\}/);
});

/* ---------------- 7. as conversas antigas, partidas antes da costura existir ---------------- */

// o contexto é montado pelo montarContexto DE VERDADE do app.js: se o formato mudar lá, a
// costura das antigas deixa de achar a prova e este teste avisa
function contextoColado(hist) {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(pegar('montarEnvio') + '\n' + pegar('montarContexto'), ctx);
  return ctx.montarContexto({ hist });
}
const linha = (o) => JSON.stringify(o) + '\n';
function mainComConversas(conversas, arquivos) {
  const h = loadMain();
  for (const [f, texto] of Object.entries(arquivos)) h.put(f, texto);
  h.evaluate('__lista = ' + JSON.stringify(conversas));
  h.evaluate(`claudeSessions = () => __lista.filter(s => s.engine === 'claude');
    codexSessions = () => __lista.filter(s => s.engine === 'codex');
    cli.sessoes = () => __lista.filter(s => s.engine === 'gemini');
    acp.sessoes = () => [];
    headRead = (f, n) => { try { return fs.readFileSync(f, 'utf8').slice(0, n); } catch { return ''; } };
    tailRead = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };`);
  return h;
}
const PEDIDO = 'quero um vídeo com IA para o Instagram do Pedro';
const HIST_ANTES = [{ quem: 'Você', texto: PEDIDO }, { quem: 'Claude', texto: 'Montei o roteiro em 3 cenas.' }];

test('conversa antiga partida numa troca de IA é costurada na conversa CERTA de antes, uma vez só', async () => {
  const colado = contextoColado(HIST_ANTES) + 'agora gera as imagens';
  const conversas = [
    { engine: 'codex', id: 'CX', file: '/x/CX.jsonl', cwd: '/p', when: 5000, title: 'agora gera as imagens' },
    { engine: 'claude', id: 'A1', file: '/c/A1.jsonl', cwd: '/p', when: 4000, title: 'Vídeo com IA' },
    { engine: 'claude', id: 'A0', file: '/c/A0.jsonl', cwd: '/p', when: 3000, title: 'Outra coisa' },
    { engine: 'claude', id: 'AP', file: '/c/AP.jsonl', cwd: '/outra', when: 4500, title: 'Mesmo pedido em outra pasta' },
    { engine: 'claude', id: 'DEPOIS', file: '/c/D.jsonl', cwd: '/p', when: 900000, title: 'Começou depois' },
  ];
  const h = mainComConversas(conversas, {
    '/x/CX.jsonl': linha({ type: 'session_meta', payload: { id: 'CX', cwd: '/p' } })
      + linha({ type: 'response_item', payload: { role: 'user', content: [{ type: 'input_text', text: colado }] } }),
    '/c/A1.jsonl': linha({ type: 'user', message: { content: PEDIDO } }) + linha({ type: 'assistant', message: { content: 'ok' } }),
    '/c/A0.jsonl': linha({ type: 'user', message: { content: 'nada a ver' } }),
    '/c/AP.jsonl': linha({ type: 'user', message: { content: PEDIDO } }),
    '/c/D.jsonl': linha({ type: 'user', message: { content: PEDIDO } }),
  });
  assert.deepEqual(plano(await h.call('ligacoes:antigas')), { feito: true, novas: 1 });
  const r = plano(h.call('ligacoes:ler'));
  assert.deepEqual(Object.keys(r.ligacoes), ['codex:CX']);
  assert.equal(r.ligacoes['codex:CX'].anterior.id, 'A1',
    'a do Claude, na mesma pasta, parada antes da nova e com a mesma fala dele dentro');
  // uma vez só: a segunda chamada nem lê as conversas de novo
  h.evaluate('claudeSessions = () => { throw new Error("não devia reler"); }');
  assert.deepEqual(plano(await h.call('ligacoes:antigas')), { feito: true, novas: 0 });
});

test('com o esforço máximo ligado (recado colado na frente do contexto) a troca antiga também é achada', async () => {
  const ultra = vm.runInNewContext(pegarConst('ULTRACODE_MSG') + '; ULTRACODE_MSG');
  const colado = ultra + contextoColado(HIST_ANTES) + 'agora gera as imagens';
  const h = mainComConversas([
    { engine: 'claude', id: 'N', file: '/c/N.jsonl', cwd: '/p', when: 5000 },
    { engine: 'codex', id: 'C1', file: '/x/C1.jsonl', cwd: '/p', when: 4000 },
  ], {
    // a resposta de antes era do Codex: o contexto diz "### Codex:" por último
    '/c/N.jsonl': linha({ type: 'user', message: { content: [{ type: 'text', text: colado.replace('### Claude:', '### Codex:') }] } }),
    '/x/C1.jsonl': linha({ type: 'response_item', payload: { role: 'user', content: [{ type: 'input_text', text: PEDIDO }] } }),
  });
  assert.deepEqual(plano(await h.call('ligacoes:antigas')), { feito: true, novas: 1 });
  assert.equal(plano(h.call('ligacoes:ler')).ligacoes['claude:N'].anterior.id, 'C1');
});

test('ramos da continuação (mesma 1a fala copiada) não herdam a costura: só a que nasceu primeiro', async () => {
  const colado = contextoColado(HIST_ANTES) + 'agora gera as imagens';
  const fala = linha({ type: 'response_item', payload: { role: 'user', content: [{ type: 'input_text', text: colado }] } });
  const h = mainComConversas([
    { engine: 'codex', id: 'RAMO2', file: '/x/R2.jsonl', cwd: '/p', when: 7000 },
    { engine: 'codex', id: 'CX', file: '/x/CX.jsonl', cwd: '/p', when: 5000 },
    { engine: 'codex', id: 'RAMO1', file: '/x/R1.jsonl', cwd: '/p', when: 6000 },
    { engine: 'claude', id: 'A1', file: '/c/A1.jsonl', cwd: '/p', when: 4000 },
  ], { '/x/CX.jsonl': fala, '/x/R1.jsonl': fala, '/x/R2.jsonl': fala,
    '/c/A1.jsonl': linha({ type: 'user', message: { content: PEDIDO } }) });
  assert.deepEqual(plano(await h.call('ligacoes:antigas')), { feito: true, novas: 1 });
  assert.deepEqual(Object.keys(plano(h.call('ligacoes:ler')).ligacoes), ['codex:CX'],
    'medido no Mac dele: até 5 conversas do Codex começando igual — a lista ganhava 5 itens com o mesmo nome');
});

test('sem a prova (a fala dele) dentro de nenhuma candidata, não costura nada', async () => {
  const colado = contextoColado(HIST_ANTES) + 'agora gera as imagens';
  const h = mainComConversas([
    { engine: 'codex', id: 'CX', file: '/x/CX.jsonl', cwd: '/p', when: 5000 },
    { engine: 'claude', id: 'A0', file: '/c/A0.jsonl', cwd: '/p', when: 3000 },
  ], {
    '/x/CX.jsonl': linha({ role: 'user', text: colado }),
    '/c/A0.jsonl': linha({ type: 'user', message: { content: 'nada a ver' } }),
  });
  assert.deepEqual(plano(await h.call('ligacoes:antigas')), { feito: true, novas: 0 });
  assert.deepEqual(plano(h.call('ligacoes:ler')).ligacoes, {});
});

test('conversa que só FALA da frase (código, print colado) não é tomada por troca de IA', async () => {
  const codigo = "return 'Estou continuando uma conversa que vinha sendo tocada por outro assistente, no mesmo computador ' + x;";
  const h = mainComConversas([
    { engine: 'claude', id: 'DEV', file: '/c/DEV.jsonl', cwd: '/p', when: 5000 },
    { engine: 'codex', id: 'C0', file: '/x/C0.jsonl', cwd: '/p', when: 3000 },
  ], {
    '/c/DEV.jsonl': linha({ type: 'user', message: { content: 'olha este trecho: ' + codigo } }),
    '/x/C0.jsonl': linha({ role: 'user', text: codigo }),
  });
  assert.deepEqual(plano(await h.call('ligacoes:antigas')), { feito: true, novas: 0 });
});

test('a costura antiga não apaga uma ligação feita ao vivo, nem liga em círculo', async () => {
  const colado = contextoColado(HIST_ANTES) + 'segue';
  const h = mainComConversas([
    { engine: 'codex', id: 'CX', file: '/x/CX.jsonl', cwd: '/p', when: 5000 },
    { engine: 'claude', id: 'A1', file: '/c/A1.jsonl', cwd: '/p', when: 4000 },
  ], {
    '/x/CX.jsonl': linha({ role: 'user', text: colado }),
    '/c/A1.jsonl': linha({ type: 'user', message: { content: PEDIDO } }),
  });
  // A1 já continua CX (ligação ao vivo): ligar CX → A1 fecharia um círculo
  h.call('ligacoes:gravar', { nova: { engine: 'claude', id: 'A1', file: '/c/A1.jsonl', cwd: '/p' },
    anterior: { engine: 'codex', id: 'CX', file: '/x/CX.jsonl', cwd: '/p' } });
  assert.deepEqual(plano(await h.call('ligacoes:antigas')), { feito: true, novas: 0 });
  assert.deepEqual(Object.keys(plano(h.call('ligacoes:ler')).ligacoes), ['claude:A1'], 'a ligação ao vivo continua');
});

test('o app pede a costura das antigas uma vez por abertura e junta os pedaços se achou alguma', async () => {
  let pedidos = 0;
  const { ctx, releu, pinturas } = contextoRecarregar({ ligacoesAntigas: async () => { pedidos++; return { feito: true, novas: 2 }; } });
  await ctx.recarregarConversas();
  await new Promise(r => setImmediate(r));
  assert.equal(pedidos, 1);
  assert.equal(releu(), 2, 'achou: relê a costura');
  assert.ok(pinturas() >= 1, 'e redesenha a lista com os pedaços juntos');
  await ctx.recarregarConversas();
  assert.equal(pedidos, 1, 'uma vez por abertura do app');
});
