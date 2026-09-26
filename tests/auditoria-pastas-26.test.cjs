'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const funcao = n => { const i = main.indexOf('function ' + n + '('); assert.ok(i >= 0, n); return main.slice(i, main.indexOf('\n}\n', i) + 2); };
const handler = n => { const i = main.indexOf("handle('" + n + "',"); assert.ok(i >= 0, n); return main.slice(i, main.indexOf('\n});', i) + 4); };
function ambiente(t) {
  const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-pastas-'));
  t.after(() => fs.rmSync(HOME, { recursive: true, force: true }));
  const PASTA_PROJETOS = path.join(HOME, 'Projetos'), nova = path.join(PASTA_PROJETOS, 'Adsure');
  fs.mkdirSync(nova, { recursive: true });
  const antiga = path.join(HOME, 'Desktop', 'Projetos-claude', 'Adsure');
  const chamadas = [], eventos = [], posse = [], handlers = {};
  const ctx = { fs, path, HOME, PASTA_PROJETOS, CHAVES_DO_MAIN: [], HANDLERS: handlers,
    handle: (n, fn) => { handlers[n] = fn; }, emit: (...args) => eventos.push(args),
    ehRemoto: cwd => /^vps:\//.test(String(cwd || '')), motorAcp: e => e === 'acp' || e === 'grok',
    outroDonoDoFio: () => { posse.push('consultou'); return null; }, marcarDonoDoFio: () => posse.push('marcou'),
    insistiuNoFio: new Map(), paneStarts: new Map(),
    claudeStart: (id, opts) => { chamadas.push({ id, ...opts }); return true; },
    loadConfig: () => ctx.config,
  };
  vm.createContext(ctx);
  vm.runInContext(funcao('pastaQueExiste') + '\n' + funcao('corrigirPastasSumidas') + '\n' + handler('config:get') + '\n' + handler('pane:start'), ctx);
  const start = (cwd, extra = {}) => handlers['pane:start'](null, { paneId: 'p', engine: 'claude', cwd, approval: 'bypass', ...extra });
  return { HOME, nova, antiga, PASTA_PROJETOS, ctx, chamadas, eventos, posse, handlers, start };
}

test('E01: pasta recém-criada é usada exatamente; criar após erro permite nova tentativa', async t => {
  const h = ambiente(t), pasta = path.join(h.nova, 'Trabalho com acento é');
  assert.match((await h.start(pasta)).error, /pasta/);
  assert.equal(h.chamadas.length, 0);
  fs.mkdirSync(pasta);
  assert.equal(await h.start(pasta), true);
  assert.equal(h.chamadas[0].cwd, pasta);
  assert.equal(h.eventos.length, 0);
});

test('E01: migração conhecida usa diretório exato e preserva retomada Claude', async t => {
  const h = ambiente(t);
  const sub = 'Código novo'; fs.mkdirSync(path.join(h.nova, sub));
  const data = { paneId: 'p', engine: 'claude', cwd: path.join(h.antiga, sub), resumeId: 'sessao-original', approval: 'bypass' };
  assert.equal(await h.handlers['pane:start'](null, data), true);
  assert.equal(h.chamadas[0].cwd, path.join(h.nova, sub));
  assert.equal(h.chamadas[0].resumeId, 'sessao-original');
  assert.equal(data.resumeId, 'sessao-original');
  assert.equal(h.eventos[0][1], 'pasta-movida');
  assert.equal(h.eventos[0][2].cwd, path.join(h.nova, sub));
});

test('E01: config migra somente destino conhecido existente e preserva caminhos inválidos', t => {
  const h = ambiente(t), sumida = path.join(h.nova, 'sumida', 'codigo');
  const semDestino = path.join(h.HOME, 'Desktop', 'Projetos-claude', 'Cliente ausente');
  h.ctx.config = { abas: [{ cwd: h.antiga, chats: [{ cwd: h.antiga }, { cwd: sumida }, { cwd: semDestino }, { cwd: 'vps:/srv/projeto' }] }] };
  const d = h.handlers['config:get']();
  assert.equal(d.abas[0].cwd, h.nova);
  assert.equal(d.abas[0].chats[0].cwd, h.nova);
  assert.equal(d.abas[0].chats[1].cwd, sumida);
  assert.equal(d.abas[0].chats[2].cwd, semDestino);
  assert.equal(d.abas[0].chats[3].cwd, 'vps:/srv/projeto');
  assert.equal(h.eventos.length, 0);
});

test('E01: pasta ausente não inicia nenhum motor nem altera a posse da sessão', async t => {
  const h = ambiente(t), cwd = path.join(h.nova, 'Projeto sumido', 'codigo');
  for (const engine of ['claude', 'codex', 'gemini', 'acp', 'grok']) {
    const data = { paneId: engine, engine, cwd, resumeId: 'sessao-existente' };
    const r = await h.handlers['pane:start'](null, data);
    assert.match(r.error, /Escolha a pasta/);
    assert.ok(r.error.includes(cwd));
    assert.equal(data.cwd, cwd);
    assert.equal(data.resumeId, 'sessao-existente');
  }
  assert.equal(h.chamadas.length, 0);
  assert.equal(h.posse.length, 0);
  assert.equal(h.ctx.paneStarts.size, 0);
  assert.equal(h.eventos.length, 0);
});

test('E01: arquivo comum e destino migrado que virou arquivo são recusados', async t => {
  const h = ambiente(t), file = path.join(h.nova, 'arquivo.txt');
  fs.writeFileSync(file, 'arquivo');
  assert.match((await h.start(file)).error, /não é uma pasta/);
  const velho = path.join(h.antiga, 'arquivo.txt');
  assert.equal(h.ctx.pastaQueExiste(velho), velho, 'não migra para um arquivo');
  assert.match((await h.start(velho)).error, /Escolha a pasta/);
  assert.equal(h.chamadas.length, 0);
  assert.equal(h.eventos.length, 0);
});

test('E01: pasta movida fora da migração conhecida exige seleção explícita', async t => {
  const h = ambiente(t), antes = path.join(h.nova, 'antes'), depois = path.join(h.nova, 'depois');
  fs.mkdirSync(antes); fs.renameSync(antes, depois);
  assert.match((await h.start(antes, { resumeId: 'retomar' })).error, /Escolha a pasta/);
  assert.equal(h.chamadas.length, 0);
  assert.equal(await h.start(depois, { resumeId: 'retomar' }), true);
  assert.equal(h.chamadas[0].cwd, depois);
  assert.equal(h.chamadas[0].resumeId, 'retomar');
});

test('E01: pasta VPS e retomada remota não são validadas contra disco local', async t => {
  const h = ambiente(t);
  h.ctx.fs = { existsSync() { throw new Error('não pode consultar o disco'); }, statSync() { throw new Error('não pode consultar o disco'); } };
  assert.equal(await h.start('vps:/srv/projeto', { resumeId: 'sessao-remota' }), true);
  assert.equal(h.chamadas[0].cwd, 'vps:/srv/projeto');
  assert.equal(h.chamadas[0].resumeId, 'sessao-remota');
  assert.equal(h.eventos.length, 0);
});

test('E01: cwd omitido mantém o comportamento da pasta pessoal', async t => {
  const h = ambiente(t);
  assert.equal(await h.start(undefined), true);
  assert.equal(h.chamadas[0].cwd, undefined, 'cada motor mantém seu default já existente');
  assert.equal(h.eventos.length, 0);
});

test('E01: main completo distingue pasta, arquivo e ausência sem esconder caminhos inválidos', async () => {
  const { loadMain } = require('./main-harness.cjs');
  const h = loadMain(), cwd = h.HOME + '/Projeto novo';
  assert.match((await h.call('pane:start', { paneId: 'p', engine: 'claude', cwd })).error, /Escolha a pasta/);
  assert.equal(h.spawned.length, 0);
  h.put(cwd, 'arquivo comum');
  assert.match((await h.call('pane:start', { paneId: 'p', engine: 'claude', cwd })).error, /não é uma pasta/);
  assert.equal(h.spawned.length, 0);
  h.files.delete(cwd); h.mkdir(cwd);
  assert.equal(await h.call('pane:start', { paneId: 'p', engine: 'claude', cwd }), true);
  assert.equal(h.spawned.at(-1).options.cwd, cwd);
});

test('E01: main completo preserva --resume na pasta migrada e cd seguro na VPS', async () => {
  const { loadMain } = require('./main-harness.cjs');
  const h = loadMain(), cwd = h.HOME + '/Projetos/Adsure';
  h.mkdir(cwd);
  await h.call('pane:start', { paneId: 'local', engine: 'claude', cwd: h.HOME + '/Desktop/Projetos-claude/Adsure', resumeId: 'sessao-local' });
  const local = h.spawned.at(-1);
  assert.equal(local.options.cwd, cwd);
  assert.equal(local.args[local.args.indexOf('--resume') + 1], 'sessao-local');
  await h.call('pane:start', { paneId: 'remoto', engine: 'claude', cwd: 'vps:/srv/Projeto remoto', resumeId: 'sessao-vps' });
  const remoto = h.spawned.at(-1);
  assert.equal(remoto.bin, 'ssh');
  // Desfaz apenas o escape da camada externa de bash -lc, sem executar shell.
  const comando = remoto.args.at(-1).replace(/'\\''/g, "'");
  assert.match(comando, /cd '\/srv\/Projeto remoto' && claude /);
  assert.ok(comando.includes("'--resume' 'sessao-vps'"));
});
