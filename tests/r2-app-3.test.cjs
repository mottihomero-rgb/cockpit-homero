'use strict';
/* Guarda dos 5 defeitos da rodada 2, lote "app" 3 (ver contexto/CONTEXTO.md para o padrao):
   R2-020 trocar de conta local derrubava TAMBEM painel rodando na VPS, que nao tem nada a ver
   R2-018 login normal (Trocar de conta / Entrar) nao reiniciava o app-server do Codex
   R2-019 login normal matava painel ocupado sem perguntar e zerava o resumeId
   R2-032 "@" buscava arquivo na pasta principal, nao na pasta do worktree ativo
   R2-010 busca global perdia conversa do Codex que repete o mesmo id em arquivo diferente
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
// recorta "const NOME = ..." ate o PRIMEIRO ";" depois dele (a arrow function do pastaDoWorktree
// quebra em duas linhas, entao o pegarConst de uma linha so nao serve pra ela)
function pegarConstAte(nome, src = app) {
  const re = new RegExp('^const ' + nome + ' =', 'm');
  const m = re.exec(src);
  assert.ok(m, 'o const ' + nome + ' tem de existir no app.js');
  const fim = src.indexOf(';', m.index);
  assert.ok(fim > m.index, 'nao achei o ; que fecha ' + nome);
  return src.slice(m.index, fim + 1);
}

/* ---------- R2-020: trocar de conta local nao pode mexer em painel da VPS ---------- */
test('trocar de conta pula painel da VPS tanto no aviso de ocupado quanto no desligar', async () => {
  const ctx = {
    console, panes: new Map(), motoresTrocandoConta: new Set(),
    agTrabalhando: () => false, window: { api: {} },
  };
  vm.createContext(ctx);
  ctx.confirm = () => true; // se perguntar (nao devia, painel VPS nao conta como ocupado), aceita
  const desligados = [];
  ctx.desligarMotor = async (Q) => { desligados.push(Q.id); };
  ctx.savePanes = () => {};
  ctx.window.api.codexReiniciar = async () => {};
  ctx.window.api.contasTrocar = async () => ({});
  ctx.note = () => {}; ctx.avisoTemp = () => {};
  ctx.contaCache = { codex: {} }; ctx.USO_FECHADO = { codex: null };
  ctx.pintarContaLateral = () => {}; ctx.lerUso = () => {};
  vm.runInContext(
    pegarConst('NA_VPS') + '\n'
    + pegar('trocarParaConta') + '\nthis.trocarParaConta = trocarParaConta;',
    ctx);

  const local = { id: 'local', engine: 'codex', cwd: '/projeto', busy: true, titulo: 'tarefa local' };
  const naVps = { id: 'vps', engine: 'codex', cwd: 'vps:/projeto', busy: true, titulo: 'tarefa longa na vps' };
  ctx.panes.set(local.id, local); ctx.panes.set(naVps.id, naVps);

  await ctx.trocarParaConta(local, 'codex', 'conta-b');

  assert.ok(desligados.includes('local'), 'o painel LOCAL ocupado tem de ser desligado (troca normal)');
  assert.ok(!desligados.includes('vps'), 'o painel da VPS NUNCA pode ser desligado: a conta de la nao muda aqui');
});

/* ---------- R2-018 + R2-019: login normal (Trocar de conta / Entrar) ---------- */
function contextoContaAcao() {
  const ctx = {
    console, panes: new Map(), window: { api: {} },
    agTrabalhando: () => false, nomeDoMotor: () => 'Codex',
    // R3-004 fez contaAcao ignorar painel da VPS ao contar ocupados/desligar, igual
    // trocarParaConta ja fazia (ver R2-020 acima); sem este global o teste quebrava so por
    // faltar o stub, nao porque o comportamento afirmado ficou errado
    NA_VPS: (cwd) => /^vps:/i.test(String(cwd || '')),
    document: { body: { classList: { remove: () => {} } } },
  };
  vm.createContext(ctx);
  ctx.window.api.auth = async ({ acao }) => acao === 'status'
    ? { texto: 'dentro: contab@exemplo.com' }
    : { terminal: 'codex login', titulo: 'Conta', confereDepois: true };
  ctx.lerStatusConta = (txt) => ({ dentro: /dentro/.test(txt), quem: 'contab@exemplo.com' });
  // contaAcao NAO da await em janelaTerminal (ela so' devolve quando o terminal fecha, de
  // verdade): guarda a promise do callback pra o teste esperar por fora, senao mede antes da hora
  ctx.janelaTerminal = (P, term, titulo, cb) => { ctx._cbDone = cb(); };
  ctx.note = () => {};
  const avisos = [];
  ctx.avisoTemp = (P, t) => avisos.push(t);
  ctx.contaCache = { codex: {} }; ctx.USO_FECHADO = { codex: null };
  ctx.pintarContaLateral = () => {}; ctx.lerUso = () => {};
  vm.runInContext(pegar('contaAcao') + '\nthis.contaAcao = contaAcao;', ctx);
  return { ctx, avisos };
}

test('login normal do Codex reinicia o app-server, senao ele segue respondendo pela conta antiga', async () => {
  const { ctx, avisos } = contextoContaAcao();
  ctx.confirm = () => true;
  ctx.desligarMotor = async () => {};
  let reiniciou = 0;
  ctx.window.api.codexReiniciar = async () => { reiniciou++; };
  const P = { id: 'p1', engine: 'codex', cwd: '/projeto', busy: false, titulo: 'chat' };
  ctx.panes.set(P.id, P);

  await ctx.contaAcao(P, 'entrar', 'codex');
  await ctx._cbDone;

  assert.equal(reiniciou, 1, 'sem reiniciar o app-server, a troca de conta pelo login normal nao pega');
  assert.ok(avisos.some(t => /Conta trocada/.test(t)), 'tem de avisar que a conta trocou');
});

test('login normal pergunta antes de cortar chat ocupado, e preserva o resumeId pra religar', async () => {
  const { ctx } = contextoContaAcao();
  let confirmChamado = 0;
  ctx.confirm = (msg) => { confirmChamado++; assert.match(msg, /trabalhando/); return true; };
  const desligados = [];
  ctx.desligarMotor = async (q) => { desligados.push(q.id); };
  ctx.window.api.codexReiniciar = async () => {};
  const ocupado = { id: 'p1', engine: 'codex', cwd: '/projeto', busy: true, titulo: 'tarefa longa', sessaoId: 'sess1' };
  ctx.panes.set(ocupado.id, ocupado);

  await ctx.contaAcao(ocupado, 'entrar', 'codex');
  await ctx._cbDone;

  assert.equal(confirmChamado, 1, 'chat ocupado tem de perguntar antes, igual trocarParaConta');
  assert.equal(desligados.length, 1, 'confirmou: o chat ocupado pode ser desligado');
  assert.equal(ocupado.resumeId, 'sess1', 'tinha de guardar o resumeId pra religar na MESMA conversa, nao zerar');
});

test('login normal cancelado no aviso nao desliga nada', async () => {
  const { ctx, avisos } = contextoContaAcao();
  ctx.confirm = () => false;
  const desligados = [];
  ctx.desligarMotor = async (q) => { desligados.push(q.id); };
  ctx.window.api.codexReiniciar = async () => { throw new Error('nao devia reiniciar: cancelou'); };
  const ocupado = { id: 'p1', engine: 'codex', cwd: '/projeto', busy: true, titulo: 'tarefa longa', sessaoId: 'sess1', resumeId: 'sess-de-antes' };
  ctx.panes.set(ocupado.id, ocupado);

  await ctx.contaAcao(ocupado, 'entrar', 'codex');
  await ctx._cbDone;

  assert.equal(desligados.length, 0, 'cancelou: nenhum chat pode ser desligado');
  assert.equal(ocupado.resumeId, 'sess-de-antes', 'cancelou: resumeId continua intacto, ninguem mexeu nele');
  assert.ok(avisos.length, 'tem de avisar que nada foi cortado');
});

/* ---------- R2-032: "@" tem de buscar na pasta do worktree, nao na principal ---------- */
test('menuArquivos busca dentro do worktree ativo, nao na pasta principal do chat', async () => {
  const ctx = { console, window: { api: {} } };
  vm.createContext(ctx);
  let cwdRecebido = null;
  ctx.window.api.buscarArquivos = async (o) => { cwdRecebido = o.cwd; return []; };
  ctx.arrobaAindaNoCampo = () => true;
  ctx.janelinhaOcupada = () => false;
  ctx.menuDeArquivosNaTela = () => false;
  ctx.recadoDeArquivos = () => {};
  ctx.fecharMenus = () => {};
  let timerFn = null;
  ctx.setTimeout = (fn) => { timerFn = fn; return 1; };
  ctx.clearTimeout = () => {};
  vm.runInContext(
    pegarConst('NA_VPS') + '\n'
    + pegarConstAte('pastaDoWorktree') + '\n'
    + 'let buscaArqTimer = 0; let buscaArqGen = 0;\n'
    + pegar('menuArquivos') + '\nthis.menuArquivos = menuArquivos;',
    ctx);

  const P = { cwd: '/projeto', worktree: 'exp-1', el: { isConnected: true } };
  await ctx.menuArquivos(P, 'termo');
  assert.ok(timerFn, 'o menuArquivos tem de agendar a busca');
  await timerFn();

  assert.equal(cwdRecebido, '/projeto/.claude/worktrees/exp-1',
    'com worktree ativo, o @ tem de procurar la dentro, nao na pasta principal');
});

test('menuArquivos sem worktree continua buscando na pasta principal (nada muda pro caso comum)', async () => {
  const ctx = { console, window: { api: {} } };
  vm.createContext(ctx);
  let cwdRecebido = null;
  ctx.window.api.buscarArquivos = async (o) => { cwdRecebido = o.cwd; return []; };
  ctx.arrobaAindaNoCampo = () => true;
  ctx.janelinhaOcupada = () => false;
  ctx.menuDeArquivosNaTela = () => false;
  ctx.recadoDeArquivos = () => {};
  ctx.fecharMenus = () => {};
  let timerFn = null;
  ctx.setTimeout = (fn) => { timerFn = fn; return 1; };
  ctx.clearTimeout = () => {};
  vm.runInContext(
    pegarConst('NA_VPS') + '\n'
    + pegarConstAte('pastaDoWorktree') + '\n'
    + 'let buscaArqTimer = 0; let buscaArqGen = 0;\n'
    + pegar('menuArquivos') + '\nthis.menuArquivos = menuArquivos;',
    ctx);

  const P = { cwd: '/projeto', worktree: null, el: { isConnected: true } };
  await ctx.menuArquivos(P, 'termo');
  await timerFn();

  assert.equal(cwdRecebido, '/projeto');
});

/* ---------- R2-010: busca global nao pode perder conversa repetida por ID mas de ARQUIVO diferente ---------- */
test('todasAsConversas mantem as duas conversas do Codex que repetem o mesmo id em arquivos diferentes', () => {
  const ctx = { console };
  vm.createContext(ctx);
  vm.runInContext(
    pegarConst('MOTORES') + '\n'
    + pegar('todasAsConversas') + '\nthis.todasAsConversas = todasAsConversas;',
    ctx);

  ctx.histCache = {
    codex: [
      { engine: 'codex', id: 'abc', file: '/hist/a.jsonl', when: 100 },
      { engine: 'codex', id: 'abc', file: '/hist/b.jsonl', when: 200 },
    ],
  };
  const lista = ctx.todasAsConversas();
  assert.equal(lista.length, 2, 'as duas conversas com o mesmo id mas arquivo diferente tem de sobreviver');
  // arrays saem da VM (outro "realm"): comparar so pelos valores, deepEqual falha por identidade
  const arquivos = [...lista].map(s => String(s.file)).sort();
  assert.equal(arquivos.length, 2);
  assert.ok(arquivos.includes('/hist/a.jsonl'));
  assert.ok(arquivos.includes('/hist/b.jsonl'));
});

test('todasAsConversas continua tirando repetida de verdade (mesmo id e mesmo arquivo)', () => {
  const ctx = { console };
  vm.createContext(ctx);
  vm.runInContext(
    pegarConst('MOTORES') + '\n'
    + pegar('todasAsConversas') + '\nthis.todasAsConversas = todasAsConversas;',
    ctx);

  ctx.histCache = {
    codex: [{ engine: 'codex', id: 'abc', file: '/hist/a.jsonl', when: 100 }],
    claude: [{ engine: 'codex', id: 'abc', file: '/hist/a.jsonl', when: 100 }],
  };
  const lista = ctx.todasAsConversas();
  assert.equal(lista.length, 1, 'mesmo id e mesmo arquivo continua sendo uma repetida so');
});
