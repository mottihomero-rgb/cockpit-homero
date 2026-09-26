'use strict';
/* Guarda dos 5 defeitos da rodada 1, lote "app" 3 (ver contexto/CONTEXTO.md para o padrao):
   R1-026 painel de agentes nunca limpava tarefa antiga (Map/array so crescia)
   R1-023 trocar de conta matava painel ocupado de OUTRA aba sem perguntar
   R1-029 tarja de limite mostrava numero velho sem dizer que era velho
   R1-028 fechar o visor de um painel fechava o de TODOS os paineis
   R1-027 grupo de conversa sumia (ou mudava) conforme a aba/pasta ativa
   Cada funcao e recortada do app.js real por contagem de chaves (o app.js e da tela, nao
   carrega aqui), e roda numa VM com so os stubs que ela precisa. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const raiz = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(raiz, 'renderer/app.js'), 'utf8');

// recorta "function nome(...) {...}" (ou "async function nome(...) {...}") contando chaves
function pegar(nome, src = app) {
  const re = new RegExp('^(?:async )?function ' + nome + '\\(', 'm');
  const m = re.exec(src);
  assert.ok(m, 'a funcao ' + nome + ' tem de existir no app.js');
  const start = m.index;
  const abre = src.indexOf('{', start);
  let n = 0, i = abre;
  for (; i < src.length; i++) {
    if (src[i] === '{') n++;
    else if (src[i] === '}' && --n === 0) { i++; break; }
  }
  return src.slice(start, i);
}
// recorta "const NOME = ...;" de uma linha so
function pegarConst(nome, src = app) {
  const re = new RegExp('^const ' + nome + ' = .*;$', 'm');
  const m = re.exec(src);
  assert.ok(m, 'o const ' + nome + ' tem de existir no app.js');
  return m[0];
}
function novoElemento() {
  const el = { className: '', textContent: '', innerHTML: '', style: {}, dataset: {}, title: '', children: [] };
  const set = new Set();
  el.classList = {
    add: (...xs) => xs.forEach(x => set.add(x)),
    remove: (...xs) => xs.forEach(x => set.delete(x)),
    contains: (x) => set.has(x),
    toggle: (x, yes) => { if (yes === undefined) yes = !set.has(x); if (yes) set.add(x); else set.delete(x); return yes; },
  };
  el.appendChild = function (x) { this.children.push(x); return x; };
  return el;
}

/* ---------- R1-026: painel de agentes tem de podar tarefa velha e terminada ---------- */
test('painel de agentes limita a lista ao teto, sem nunca apagar tarefa ainda rodando', () => {
  const ctx = { console };
  vm.createContext(ctx);
  vm.runInContext(
    pegarConst('AG_TIPO_TRABALHO') + '\n'
    + pegarConst('AG_FINAL') + '\n'
    + pegar('agEstado') + '\n'
    + pegarConst('AG_TETO_TAREFAS') + '\n'
    + pegar('agPodarTarefas') + '\n'
    // 26/09: o agentesEvento tambem repinta o cartao "Time de agentes" da conversa; aqui so
    // importa a poda da lista, entao o cartao entra como os outros desenhos: vazio
    + 'function pintarBotaoAgentes(){} function agRepintarAba(){} function agAgendarDesenho(){} function agCartaoNaConversa(){}\n'
    + 'let agPaneAberto = null;\n'
    + pegar('agentesEvento') + '\n'
    + 'this.agEstado = agEstado; this.agentesEvento = agentesEvento; this.AG_TETO_TAREFAS = AG_TETO_TAREFAS;',
    ctx);

  const P = {};
  const N = ctx.AG_TETO_TAREFAS + 80;
  // uma tarefa fica rodando pra sempre (sem 'fim'), no MEIO da sequencia
  const idDaQueFica = 'roda-' + Math.floor(N / 2);
  for (let i = 0; i < N; i++) {
    const id = i === Math.floor(N / 2) ? idDaQueFica : 'id' + i;
    ctx.agentesEvento(P, { ev: 'inicio', id, classe: 'agent', desc: 'x' });
    if (id !== idDaQueFica) ctx.agentesEvento(P, { ev: 'fim', id, estado: 'completed' });
  }
  const A = ctx.agEstado(P);
  assert.ok(A.ordem.length <= ctx.AG_TETO_TAREFAS, 'a lista nao pode crescer para sempre: ficou em ' + A.ordem.length);
  assert.equal(A.tarefas.size, A.ordem.length, 'Map e array tem de continuar do mesmo tamanho');
  assert.ok(A.tarefas.has(idDaQueFica), 'tarefa ainda rodando nunca pode ser podada, mesmo com o teto estourado');
});

/* ---------- R1-023: trocar de conta pergunta antes de derrubar painel ocupado ---------- */
test('trocar de conta com painel ocupado em outra aba pergunta antes, e cancela sem desligar nada', async () => {
  const ctx = {
    console, panes: new Map(), motoresTrocandoConta: new Set(),
    nomeDoMotor: () => 'Codex', agTrabalhando: () => false,
    // R2-020 passou a checar painel da VPS dentro de trocarParaConta; sem este stub o teste
    // antigo quebrava so' por faltar o global, nao porque o comportamento afirmado ficou errado
    NA_VPS: (cwd) => /^vps:/i.test(String(cwd || '')),
    window: { api: {} },
  };
  vm.createContext(ctx);
  let confirmChamado = 0, confirmMsg = '';
  ctx.confirm = (msg) => { confirmChamado++; confirmMsg = msg; return false; };
  let desligou = 0;
  ctx.desligarMotor = async () => { desligou++; };
  ctx.savePanes = () => {};
  ctx.window.api.codexReiniciar = async () => {};
  ctx.window.api.contasTrocar = async () => ({});
  ctx.note = () => {}; ctx.avisoTemp = () => {};
  ctx.contaCache = { codex: {} }; ctx.USO_FECHADO = { codex: null };
  ctx.pintarContaLateral = () => {}; ctx.lerUso = () => {};
  vm.runInContext(pegar('trocarParaConta') + '\nthis.trocarParaConta = trocarParaConta;', ctx);

  const focada = { id: 'p1', engine: 'codex', busy: false, titulo: 'aba de agora' };
  const outraAba = { id: 'p2', engine: 'codex', busy: true, titulo: 'importando planilha' };
  ctx.panes.set(focada.id, focada); ctx.panes.set(outraAba.id, outraAba);

  await ctx.trocarParaConta(focada, 'codex', 'conta-nova');

  assert.equal(confirmChamado, 1, 'tem de perguntar antes de mexer, mesmo o painel ocupado sendo de outra aba');
  assert.match(confirmMsg, /trabalhando/);
  assert.equal(desligou, 0, 'cancelou: nenhum painel pode ter sido desligado');
  assert.equal(ctx.motoresTrocandoConta.has('codex'), false, 'cancelou: nao pode travar o motor pra troca nenhuma');
});

test('trocar de conta sem painel ocupado nao interrompe pra perguntar nada', async () => {
  const ctx = {
    console, panes: new Map(), motoresTrocandoConta: new Set(),
    nomeDoMotor: () => 'Codex', agTrabalhando: () => false,
    // R2-020 passou a checar painel da VPS dentro de trocarParaConta; sem este stub o teste
    // antigo quebrava so' por faltar o global, nao porque o comportamento afirmado ficou errado
    NA_VPS: (cwd) => /^vps:/i.test(String(cwd || '')),
    window: { api: {} },
  };
  vm.createContext(ctx);
  ctx.confirm = () => { throw new Error('nao devia perguntar aqui'); };
  let desligou = 0;
  ctx.desligarMotor = async () => { desligou++; };
  ctx.savePanes = () => {};
  ctx.window.api.codexReiniciar = async () => {};
  ctx.window.api.contasTrocar = async () => ({});
  ctx.note = () => {}; ctx.avisoTemp = () => {};
  ctx.contaCache = { codex: {} }; ctx.USO_FECHADO = { codex: null };
  ctx.pintarContaLateral = () => {}; ctx.lerUso = () => {};
  vm.runInContext(pegar('trocarParaConta') + '\nthis.trocarParaConta = trocarParaConta;', ctx);

  const P = { id: 'p1', engine: 'codex', busy: false, titulo: 'parado' };
  ctx.panes.set(P.id, P);
  await ctx.trocarParaConta(P, 'codex', 'conta-nova');
  assert.equal(desligou, 1, 'sem ninguem ocupado, troca segue direto');
});

/* ---------- R1-029: tarja de limite tem de avisar quando o numero e velho ---------- */
test('tarja de aviso de limite mostra que o dado e velho quando a leitura falhou e reaproveitou o ultimo bom', () => {
  const ctx = {
    console, USO: { claude: null }, USO_FECHADO: { claude: null },
    USO_AVISO_SESSAO: 90, USO_AVISO_SEMANA: 50, USO_DENOVO: 5,
  };
  vm.createContext(ctx);
  const campo = novoElemento();
  const faixa = novoElemento();
  ctx.$ = (sel) => sel === '.p-uso' ? faixa : (sel === '.p-limite' ? campo : novoElemento());
  ctx.nomeDoMotor = () => 'Claude';
  ctx.quandoFuturo = () => 'amanha';
  // usoPct e const de 1 linha com "=>": pega a linha direto, sem precisar de outro extrator
  const usoPctSrc = app.split('\n').find(l => l.startsWith('const usoPct = '));
  assert.ok(usoPctSrc, 'usoPct existe');
  vm.runInContext(
    usoPctSrc + '\n'
    + pegar('esconderUso') + '\n'
    + pegar('pintarLimiteMini') + '\n'
    + 'function haQuanto(ms){ return "3h"; }\n'
    + pegar('pintarUso') + '\n'
    + 'this.pintarUso = pintarUso;',
    ctx);

  const P = { engine: 'claude', el: {} };
  // sessao alta (acima do limiar) e MARCADA como velha: veio de 3h atras, nao de agora
  ctx.USO.claude = { sessao: { pct: 95 }, semana: { pct: 10 }, velho: Date.now() - 3 * 3600 * 1000 };
  ctx.pintarUso(P);

  assert.match(faixa.innerHTML, /atrás/, 'a tarja tem de avisar que o numero e velho');
  assert.match(faixa.innerHTML, /3h/, 'tem de dizer de quando e o numero velho');
});

test('tarja de limite nao fala em "velho" quando o numero e fresco', () => {
  const ctx = {
    console, USO: { claude: null }, USO_FECHADO: { claude: null },
    USO_AVISO_SESSAO: 90, USO_AVISO_SEMANA: 50, USO_DENOVO: 5,
  };
  vm.createContext(ctx);
  const campo = novoElemento();
  const faixa = novoElemento();
  ctx.$ = (sel) => sel === '.p-uso' ? faixa : (sel === '.p-limite' ? campo : novoElemento());
  ctx.nomeDoMotor = () => 'Claude';
  ctx.quandoFuturo = () => 'amanha';
  const usoPctSrc = app.split('\n').find(l => l.startsWith('const usoPct = '));
  vm.runInContext(
    usoPctSrc + '\n'
    + pegar('esconderUso') + '\n'
    + pegar('pintarLimiteMini') + '\n'
    + 'function haQuanto(){ throw new Error("nao devia chamar sem velho"); }\n'
    + pegar('pintarUso') + '\n'
    + 'this.pintarUso = pintarUso;',
    ctx);
  const P = { engine: 'claude', el: {} };
  ctx.USO.claude = { sessao: { pct: 95 }, semana: { pct: 10 }, velho: 0 };
  ctx.pintarUso(P);
  assert.doesNotMatch(faixa.innerHTML, /atrás/);
});

/* ---------- R1-028: fechar o visor de um painel nao pode fechar o de outro ---------- */
test('fechar o visor de UM painel deixa o visor do outro painel aberto', () => {
  const ctx = { console };
  vm.createContext(ctx);
  const visorA = novoElemento(), corpoA = novoElemento();
  const visorB = novoElemento(), corpoB = novoElemento();
  corpoA.innerHTML = 'conteudo de A'; corpoB.innerHTML = 'conteudo de B';
  ctx.$ = (sel, el) => {
    if (sel === '.p-visor') return el._visor;
    if (sel === '.visor-corpo') return el._corpo;
    return null;
  };
  vm.runInContext(pegar('fecharVisor') + '\nthis.fecharVisor = fecharVisor;', ctx);

  const painelA = { el: { _visor: visorA } }; visorA._corpo = corpoA;
  const painelB = { el: { _visor: visorB } }; visorB._corpo = corpoB;

  ctx.fecharVisor(painelA);

  assert.equal(visorA.classList.contains('hidden'), true, 'o visor do painel A tinha de fechar');
  assert.equal(corpoA.innerHTML, '', 'o conteudo do visor de A tinha de ser limpo');
  assert.equal(visorB.classList.contains('hidden'), false, 'o visor do painel B NAO podia fechar');
  assert.equal(corpoB.innerHTML, 'conteudo de B', 'o conteudo do visor de B tinha de continuar intacto');
});

/* ---------- R1-027: grupo cruza pasta de proposito, nao pode sumir com a aba ---------- */
function contextoPaintHist() {
  const ctx = { console };
  vm.createContext(ctx);
  const box = novoElemento();
  ctx.pintaVez = { claude: 0 };
  ctx.buscaAtual = { claude: '' };
  ctx.filtroGrupo = { claude: null };
  ctx.caixaHist = () => box;
  ctx.pintarBotaoFiltro = () => {};
  ctx.pintarAbasGrupo = () => {};
  ctx.lerHistoricoDeTodosOsMotores = () => {};
  ctx.todasAsConversas = () => [];
  // pasta "ativa" e a unica marcada: exatamente o corte que 'ABA' faz de verdade no app real
  ctx.filtrarPorPasta = (engine, lista) => lista.filter(s => s.pasta === 'ativa');
  ctx.ehFavorita = () => false;
  ctx.grupoDaSessao = (s) => s.grupo || null;
  ctx.grupoPorId = (id) => ({ id, nome: 'Financeiro' });
  ctx.linhaConversa = (s) => { const e = novoElemento(); e.dataset.sid = s.id; return e; };
  ctx.document = { createElement: () => novoElemento() };
  return { ctx, box };
}
test('aba de grupo mostra conversa do grupo mesmo morando em pasta/cliente diferente da aba ativa', async () => {
  const { ctx, box } = contextoPaintHist();
  vm.runInContext(pegar('paintHist') + '\nthis.paintHist = paintHist;', ctx);
  ctx.filtroGrupo.claude = 'g1';
  const listaCrua = [
    { id: 's-pedro', pasta: 'ativa', grupo: 'g1' },
    { id: 's-rapha', pasta: 'outra', grupo: 'g1' },
  ];
  await ctx.paintHist('claude', listaCrua);
  const ids = box.children.map(c => c.dataset.sid).filter(Boolean);
  assert.ok(ids.includes('s-pedro'), 'a conversa da pasta ativa tem de continuar aparecendo');
  assert.ok(ids.includes('s-rapha'), 'a conversa do MESMO grupo, de outra pasta, nao pode sumir');
});
test('cabecalho do grupo (sem filtro de grupo escolhido) conta as sessoes de TODAS as pastas', async () => {
  const { ctx } = contextoPaintHist();
  const chamadas = [];
  ctx.listaGrupos = () => [{ id: 'g1', nome: 'Financeiro' }];
  ctx.linhaGrupo = (g, sessoes) => { chamadas.push({ g, sessoes }); return novoElemento(); };
  ctx.grupoDoTempo = () => 'Hoje';
  vm.runInContext(pegar('paintHist') + '\nthis.paintHist = paintHist;', ctx);
  const listaCrua = [
    { id: 's-pedro', pasta: 'ativa', grupo: 'g1' },
    { id: 's-rapha', pasta: 'outra', grupo: 'g1' },
  ];
  await ctx.paintHist('claude', listaCrua);
  assert.equal(chamadas.length, 1);
  assert.equal(chamadas[0].sessoes.length, 2, 'o numero no cabecalho do grupo nao pode mudar so porque a aba ativa mudou');
});
