'use strict';
/* Guarda dos 3 defeitos da rodada 2, lote "app" 4 (ver contexto/CONTEXTO.md para o padrao):
   R2-008 apagar UMA conversa do Codex derrubava e fazia SUMIR a IRMA (mesmo id, arquivo
          diferente) que continua viva no disco.
   R2-007 abrir a versao ANTIGA de uma conversa do Codex so focava a versao ATUAL ja aberta,
          sem trocar o historico mostrado.
   R2-033 "reabrir o ultimo chat fechado" tirava o chat do worktree isolado, sem avisar.
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
function classes() {
  const set = new Set();
  return { add: (...xs) => xs.forEach(x => set.add(x)), remove: (...xs) => xs.forEach(x => set.delete(x)),
    toggle: () => {}, contains: x => set.has(x) };
}
function elemento() {
  return { style: {}, classList: classes(), dataset: {}, nodes: {}, focus() { this.focused = true; },
    querySelectorAll: () => [] };
}

/* ========== R2-008: apagar a conversa A nao pode derrubar a conversa IRMA B ========== */
test('R2-008: apagarConversa nao mexe no painel/lista/aba da conversa irma (mesmo id, arquivo diferente)', async () => {
  const ctx = {
    console, panes: new Map(),
    cfg: { abas: [{ chats: [{ sessao: 'id1', arquivo: 'B.jsonl' }] }] },
    histCache: { codex: [{ id: 'id1', file: 'A.jsonl', title: 'antiga' }, { id: 'id1', file: 'B.jsonl', title: 'viva' }] },
    window: { api: {} },
  };
  vm.createContext(ctx);
  ctx.confirm = () => true;
  ctx.window.api.apagarSessao = async () => ({});
  ctx.window.api.paneStop = async () => {};
  ctx.window.api.setConfig = () => {};
  const notas = [];
  ctx.note = (P, t) => notas.push(t);
  ctx.pararTrabalho = () => {}; ctx.limparPassos = () => {}; ctx.limparContinuar = () => {};
  ctx.escondePerm = () => {}; ctx.setDot = () => {}; ctx.savePanes = () => {};
  ctx.repintarGrupos = () => {}; ctx.marcarAbertas = () => {};
  // 25/09: apagar passa por esquecerParteApagada (uma vez por parte da conversa costurada)
  ctx.esquecerCadeiaDoPainel = () => {}; ctx.esquecerLigacoesLocais = () => {};
  vm.runInContext(pegar('apagarConversa') + '\n' + pegar('esquecerParteApagada') + '\nthis.apagarConversa = apagarConversa;', ctx);

  // painel aberto com a conversa B (viva), que compartilha o id com a conversa A que vai pra Lixeira
  const Q = { id: 'painelB', engine: 'codex', resumeId: null, sessaoId: 'id1', sessaoFile: 'B.jsonl', busy: false };
  ctx.panes.set(Q.id, Q);

  await ctx.apagarConversa({ id: 'id1', file: 'A.jsonl', engine: 'codex', title: 'antiga' }, null);

  assert.equal(Q.sessaoId, 'id1', 'o painel que roda B nao pode ser desligado so por apagar a A');
  assert.equal(Q.sessaoFile, 'B.jsonl');
  assert.equal(notas.length, 0, 'nenhum "conversa foi apagada" pode chegar no painel de B, que continua viva');
  assert.equal(ctx.histCache.codex.length, 1, 'so a linha do arquivo A some da lista lateral, B continua');
  assert.equal(ctx.histCache.codex[0].file, 'B.jsonl');
  assert.equal(ctx.cfg.abas[0].chats[0].sessao, 'id1', 'a aba que aponta pro arquivo B nao pode ser zerada');
  assert.equal(ctx.cfg.abas[0].chats[0].arquivo, 'B.jsonl');
});

/* ========== R2-007: abrir a versao ANTIGA (arquivo diferente) tem de trocar o historico,
   nao so focar a versao ATUAL que ja esta aberta ========== */
function contextoOpenSession() {
  const ctx = { console, panes: new Map(), focusPane: null, window: { api: {} } };
  vm.createContext(ctx);
  ctx.document = { querySelectorAll: () => [], body: { classList: classes() } };
  ctx.NA_VPS = cwd => /^vps:/i.test(String(cwd || ''));
  ctx.abaDoCaminho = () => ({});
  ctx.nomePasta = x => x;
  ctx.newPane = (opts) => {
    const el = elemento(); el.nodes = { '.p-input': elemento() };
    const P = { id: 'p' + (ctx.panes.size + 1), busy: false, hist: [], blocks: new Map(), tools: new Map(),
      el, chat: elemento(), ...opts };
    ctx.panes.set(P.id, P); return P;
  };
  ctx.invalidarConversa = () => {};
  ctx.painelAindaAtual = () => true;
  ctx.escondePerm = () => {}; ctx.fillModels = () => {}; ctx.paintEngine = () => {}; ctx.setDot = () => {};
  ctx.pintarPasta = () => {}; ctx.mostrarPastaNoPainel = () => {}; ctx.atualizarGit = () => {};
  ctx.pintarModo = () => {}; ctx.pintarNome = () => {}; ctx.setFocus = P => { ctx.focusPane = P; };
  ctx.savePanes = () => {}; ctx.marcarAbertas = () => {}; ctx.note = () => {};
  ctx.renderizarHistorico = () => {}; ctx.scroll = () => {};
  ctx.limparPlano = () => {}; ctx.limparSugestoes = () => {}; ctx.piscar = () => {};
  ctx.$ = (sel, e) => (e && e.nodes && e.nodes[sel]) || elemento();
  ctx.$$ = () => [];
  ctx.window.api.sessionHistory = async () => [];
  ctx.window.api.sessionHistoryRemoto = async () => [];
  // 25/09: sem ligacao nenhuma, a cadeia de uma conversa e ela mesma
  ctx.partesDaCadeia = s => [s]; ctx.refDaParte = p => p;
  vm.runInContext(pegar('openSession') + '\nthis.openSession = openSession;', ctx);
  return ctx;
}

test('R2-007: abrir versao antiga (arquivo A) de uma conversa que tem versao atual aberta (arquivo B) traz o historico da antiga', async () => {
  const ctx = contextoOpenSession();
  const Q = { id: 'existente', engine: 'codex', cwd: '/projeto', resumeId: null, sessaoId: 'id1',
    sessaoFile: 'B.jsonl', el: elemento(), hist: [] };
  ctx.panes.set(Q.id, Q);

  let paramsChamados = null;
  ctx.window.api.sessionHistory = async (p) => { paramsChamados = p; return []; };

  const P = await ctx.openSession({ id: 'id1', engine: 'codex', cwd: '/projeto', title: 'Antiga', file: 'A.jsonl' }, null);

  assert.notEqual(P, Q, 'nao pode so focar a conversa ja aberta (arquivo B) quando o usuario pediu a versao antiga (arquivo A)');
  assert.equal(ctx.panes.size, 2, 'tem que abrir um painel novo pra versao antiga, nao reaproveitar o existente');
  assert.ok(paramsChamados, 'tem que ter chamado sessionHistory pra trazer o historico pedido (a versao A)');
  assert.equal(paramsChamados.file, 'A.jsonl');
});

test('R2-007 (regressao): abrir a MESMA versao ja aberta continua so focando e devolvendo o painel existente', async () => {
  const ctx = contextoOpenSession();
  const Q = { id: 'existente', engine: 'codex', cwd: '/projeto', resumeId: null, sessaoId: 'id1',
    sessaoFile: 'B.jsonl', el: elemento(), hist: [] };
  ctx.panes.set(Q.id, Q);
  let chamouHistorico = false;
  ctx.window.api.sessionHistory = async () => { chamouHistorico = true; return []; };

  const P = await ctx.openSession({ id: 'id1', engine: 'codex', cwd: '/projeto', title: 'Atual', file: 'B.jsonl' }, null);

  assert.equal(P, Q, 'mesma conversa ja aberta: so foca, e devolve o painel existente (usado pelo reabrir-fechado)');
  assert.equal(ctx.panes.size, 1, 'nao pode abrir painel duplicado da mesma conversa');
  assert.equal(chamouHistorico, false);
});

/* ========== R2-033: reabrir o ultimo chat fechado tem de devolver o worktree isolado ========== */
function contextoFechados() {
  const ctx = { console, fechadosRecentes: [], focusPane: null, abas: new Map(), abaAtiva: null, window: { api: {} } };
  vm.createContext(ctx);
  ctx.avisoTemp = () => {};
  ctx.newPane = () => null;
  ctx.setFocus = () => {};
  const chamadas = { openSession: null, mostrarPastaNoPainel: null };
  ctx.mostrarPastaNoPainel = (P) => { chamadas.mostrarPastaNoPainel = P; };
  // R3-008: o openSession de verdade marca `_painelNovoDeAbertura` no ramo que CRIA um painel
  // (nunca no ramo "ja aberta"); este mock representa esse ramo, entao carrega a marca tambem.
  ctx.openSession = async (s) => { chamadas.openSession = s; return { id: 'novoPainel', worktree: '', cwd: s.cwd, _painelNovoDeAbertura: true }; };
  vm.runInContext(
    pegarConst('NA_VPS') + '\n'
    + pegarConst('fechadosRecentes') + '\n'
    + pegar('guardarFechado') + '\n'
    + pegar('reabrirUltimoFechado') + '\n'
    + 'this.fechadosRecentes = fechadosRecentes; this.guardarFechado = guardarFechado; this.reabrirUltimoFechado = reabrirUltimoFechado;',
    ctx);
  ctx._chamadas = chamadas;
  return ctx;
}

test('R2-033: fechar um chat em worktree e reabrir devolve ele na branch isolada, nao na pasta principal', async () => {
  const ctx = contextoFechados();
  const P = { resumeId: null, sessaoId: 'idX', hist: [{ texto: 'oi' }], engine: 'codex', cwd: '/projeto',
    titulo: 'chat no worktree', sessaoFile: 'arq.jsonl', aid: 'aba1', worktree: 'minha-branch' };

  ctx.guardarFechado(P);
  assert.equal(ctx.fechadosRecentes.length, 1);
  assert.equal(ctx.fechadosRecentes[0].worktree, 'minha-branch', 'guardarFechado precisa lembrar o worktree do chat');

  await ctx.reabrirUltimoFechado();

  assert.equal(ctx._chamadas.openSession.id, 'idX');
  assert.ok(ctx._chamadas.mostrarPastaNoPainel, 'tem que repor o worktree depois do openSession zerar');
  assert.equal(ctx._chamadas.mostrarPastaNoPainel.worktree, 'minha-branch',
    'o painel reaberto tem que voltar com o worktree, nao com a pasta principal');
});

test('R2-033 (regressao): chat que rodava na pasta principal continua reabrindo sem worktree', async () => {
  const ctx = contextoFechados();
  const P = { resumeId: 'idY', sessaoId: null, hist: [{ texto: 'oi' }], engine: 'claude', cwd: '/projeto',
    titulo: 'chat normal', sessaoFile: '', aid: 'aba1', worktree: '' };

  ctx.guardarFechado(P);
  assert.equal(ctx.fechadosRecentes[0].worktree, '');

  await ctx.reabrirUltimoFechado();
  assert.equal(ctx._chamadas.mostrarPastaNoPainel, null, 'sem worktree salvo, nao chama mostrarPastaNoPainel a toa');
});

test('R2-033 (regressao): chat que roda na VPS nao guarda worktree (worktree e conceito local)', () => {
  const ctx = contextoFechados();
  const P = { resumeId: 'idZ', sessaoId: null, hist: [{ texto: 'oi' }], engine: 'codex', cwd: 'vps:/projeto',
    titulo: 'chat remoto', sessaoFile: '', aid: 'aba1', worktree: 'branch-remota' };

  ctx.guardarFechado(P);
  assert.equal(ctx.fechadosRecentes[0].worktree, '', 'worktree local nao faz sentido salvar pra um chat da VPS');
});
