'use strict';

// Testes de guarda do lote "main" (R2) — faixa consertador, rodada 2, lote 1.
// Cobrem: R2-031 (copia sincrona do Claude travava o processo principal), R2-005 (erro do
// Codex sem 'message' virava '[object Object]' na tela), R2-036 (claudeCwd vazava pra sempre)
// e R2-039 (indice-conversas.json nunca era podado). Padrao de arquivo: tests/main-harness.cjs
// (main.js inteiro numa VM) para os que tocam o app inteiro, e extracao de bloco (como
// tests/auto-update-motores.test.cjs ja fazia) para R2-031, que precisa de fs.promises real.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadMain: loadMainBase } = require('./main-harness.cjs');
const loadMain = () => loadMainBase({ directories: ['/projetos/cockpit'] });

const SRC = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

// ---------- R2-031: usarClaudeDeCaminhoFixo sincrono travava TODOS os paineis ----------
test('R2-031: atualizarMotoresSozinho AGUARDA a copia async do Claude antes de conferir a versao', async () => {
  const ini = SRC.indexOf('const COMO_ATUALIZA_MOTOR');
  const fimMarca = "  } finally { atualizandoMotores = false; }\n}";
  const fim = SRC.indexOf(fimMarca, ini) + fimMarca.length;
  const bloco = SRC.slice(ini, fim);
  assert.ok(ini > 0 && fim > ini, 'bloco de atualizarMotoresSozinho encontrado');

  const ordem = [];
  const ctx = {
    EH_WIN: false, HOME: '/casa', fs: { existsSync: (p) => p === '/casa/.local/bin/claude' }, path,
    NPM_DOS_MOTORES: { claude: '@anthropic-ai/claude-code', codex: '@openai/codex' },
    CLAUDE_BIN: '/casa/.cockpit/bin/claude',
    loadConfig: () => ({}),
    anota: () => {},
    // simula a copia REAL: so termina num tick futuro (setImmediate), como fs.promises.copyFile faria
    usarClaudeDeCaminhoFixoAsync: () => new Promise((resolve) => {
      ordem.push('copia-comecou');
      setImmediate(() => { ordem.push('copia-terminou'); resolve(); });
    }),
    versoesDosMotores: async () => ({ claude: { instalada: '2.1.273', ultima: '2.1.277' } }),
    rodar: async (bin, args) => {
      if (args[0] === '--version') { ordem.push('conferiu-versao'); return { out: '2.1.277 (Claude Code)', errout: '' }; }
      ordem.push('rodou-update');
      return { err: null, out: '', errout: '' };
    },
    win: null,
  };
  const nomes = Object.keys(ctx);
  const f = new Function(...nomes, bloco + '\n; return atualizarMotoresSozinho;');
  await f(...nomes.map((n) => ctx[n]))('teste');
  // Sem "await" antes da copia, o codigo seguiria direto para o "--version" (conferiu-versao)
  // ANTES de "copia-terminou" — o mesmo bug que ficava escondido com fs.copyFileSync (essa
  // sim sincrona, mas travando o processo principal inteiro em vez de so' desordenar isto).
  assert.deepEqual(ordem, ['rodou-update', 'copia-comecou', 'copia-terminou', 'conferiu-versao'],
    'a copia async tem de ser AGUARDADA antes de checar a versao, senao conferia o binario ainda nao trocado');
});

test('R2-031: usarClaudeDeCaminhoFixoAsync existe e usa fs.promises (nao trava o loop principal)', () => {
  const ini = SRC.indexOf('async function usarClaudeDeCaminhoFixoAsync');
  const fim = SRC.indexOf('\n}\n', ini) + 3;
  assert.ok(ini > 0, 'a versao async precisa existir');
  const corpo = SRC.slice(ini, fim);
  assert.match(corpo, /fs\.promises\.copyFile/, 'a copia do binario tem de usar fs.promises (assincrono)');
  assert.doesNotMatch(corpo, /fs\.copyFileSync|fs\.chmodSync|fs\.utimesSync|fs\.renameSync/,
    'a versao async nao pode ter sobrado nenhuma chamada sincrona');
  // a chamada de boot (antes da janela existir) continua com a versao sincrona, de proposito
  const chamadaBoot = SRC.slice(SRC.indexOf('app.whenReady()'), SRC.indexOf('app.whenReady()') + 200);
  assert.match(chamadaBoot, /usarClaudeDeCaminhoFixo\(\)/, 'o boot continua chamando a versao sincrona original');
  const marcaTimer = "if (eng === 'claude') await usarClaudeDeCaminhoFixoAsync();";
  assert.ok(SRC.includes(marcaTimer), 'a auto-atualizacao (dentro de atualizarMotoresSozinho) tem de chamar a versao async, com await');
});

// ---------- R2-005: erro do Codex sem 'message' virava '[object Object]' na tela ----------
test("R2-005: turn/failed sem 'message' usa shortJson(codexErrorInfo) em vez de '[object Object]'", async () => {
  const h = loadMain();
  h.attachCodex('local');
  await h.call('pane:start', { paneId: 1, engine: 'codex', cwd: '/projetos/cockpit', resumeId: 'thread-local' });
  h.clear();
  h.notify('turn/failed', {
    threadId: 'thread-local', turnId: 'turn-local',
    error: { message: '', codexErrorInfo: { tipo: 'conta revogada' } },
  }, 'local');
  const notas = h.paneEvents('note');
  assert.ok(notas.length >= 1, 'tem de emitir uma nota de erro');
  const texto = notas.at(-1).text;
  assert.doesNotMatch(texto, /\[object Object\]/, 'nao pode virar [object Object] na tela');
  assert.match(texto, /conta revogada/, 'tem de mostrar algo reconhecivel do codexErrorInfo');
});

test('R2-005: turn/failed com message de texto continua mostrando o texto normal (nao regride)', async () => {
  const h = loadMain();
  h.attachCodex('local');
  await h.call('pane:start', { paneId: 1, engine: 'codex', cwd: '/projetos/cockpit', resumeId: 'thread-local' });
  h.clear();
  h.notify('turn/failed', { threadId: 'thread-local', turnId: 'turn-local', error: { message: 'rede caiu' } }, 'local');
  const notas = h.paneEvents('note');
  assert.match(notas.at(-1).text, /rede caiu/);
});

// ---------- R2-036: claudeCwd (paneId -> cwd) nunca era limpo quando o painel fechava ----------
test('R2-036: claudeStop apaga a entrada do painel em claudeCwd (senao o Map so cresce)', async () => {
  const h = loadMain();
  const pastaGit = h.HOME + '/projeto';
  h.evaluate(`claudeStart('p1', { cwd: ${JSON.stringify(pastaGit)} })`);
  assert.equal(h.evaluate("claudeCwd.has('p1')"), true, 'claudeStart tem de gravar a pasta do painel');
  h.evaluate("claudeStop('p1')");
  // Antes do conserto, claudeCwd nunca perdia entrada nenhuma — cada "Nova conversa" ou
  // reabertura de chat antigo criava paneId novo e acumulava pra sempre enquanto o app ficasse
  // aberto (o proprio caso de uso: dias sem fechar o Cockpit).
  assert.equal(h.evaluate("claudeCwd.has('p1')"), false, 'claudeStop tem de apagar a entrada, senao o Map vaza');
});

test('R2-036: reiniciar o MESMO painel (claudeStart de novo) continua com a pasta certa', async () => {
  const h = loadMain();
  const pastaGit = h.HOME + '/projeto';
  h.evaluate(`claudeStart('p1', { cwd: ${JSON.stringify(pastaGit)} })`);
  const outraPasta = h.HOME + '/outro-projeto';
  h.evaluate(`claudeStart('p1', { cwd: ${JSON.stringify(outraPasta)} })`);
  assert.equal(h.evaluate("claudeCwd.get('p1')"), outraPasta, 'a limpeza no stop nao pode quebrar o restart do mesmo painel');
});

// ---------- R2-039: indice-conversas.json nunca era podado (so o carim de carimbos era) ----------
test('R2-039: montarIndiceDeFundo poda do indice a conversa cujo arquivo sumiu do disco', async () => {
  const h = loadMain();
  const vivo = h.HOME + '/vivo.jsonl';
  const morto = h.HOME + '/morto.jsonl';
  h.put(vivo, '{}');   // so o "vivo" existe em disco
  h.evaluate(`
    claudeSessions = () => [];
    codexSessions = () => [];
    indexarSePreciso = () => {};
    lerCarimbos = () => ({});
    gravarCarimbosDepois = () => {};
    compactarTexto = async () => {};
    indice = { ${JSON.stringify(vivo)}: { titulo: 'Vivo' }, ${JSON.stringify(morto)}: { titulo: 'Morto' } };
  `);
  h.evaluate('montarIndiceDeFundo()');
  // pega o timer de 20s agendado por montarIndiceDeFundo e roda o callback na mao
  const [id] = [...h.timers.keys()];
  await h.timers.get(id)();
  const ind = h.evaluate('indice');
  assert.deepEqual(Object.keys(ind), [vivo], 'a conversa com arquivo apagado tem de sumir do indice; a viva (existe em disco) fica');
});

test('R2-039: montarIndiceDeFundo nao mexe em indice se nenhum arquivo sumiu', async () => {
  const h = loadMain();
  const vivo = h.HOME + '/vivo.jsonl';
  h.put(vivo, '{}');
  h.evaluate(`
    claudeSessions = () => [];
    codexSessions = () => [];
    indexarSePreciso = () => {};
    lerCarimbos = () => ({});
    gravarCarimbosDepois = () => {};
    compactarTexto = async () => {};
    globalThis.__gravouIndice = 0;
    gravarIndice = () => { globalThis.__gravouIndice++; };
    indice = { ${JSON.stringify(vivo)}: { titulo: 'Vivo' } };
  `);
  h.evaluate('montarIndiceDeFundo()');
  const [id] = [...h.timers.keys()];
  await h.timers.get(id)();
  assert.equal(h.evaluate('globalThis.__gravouIndice'), 0, 'sem entrada morta, nao precisa gravar o indice de novo');
});

// ---------- R2-044: muxProvado era variavel morta (so escrita, nunca lida) ----------
test('R2-044: muxProvado foi removida do arquivo (nao era mais lida em lugar nenhum)', () => {
  assert.doesNotMatch(SRC, /muxProvado/, 'a variavel morta e as duas atribuicoes tem de sumir');
});

console.log('r2-main-1: testes carregados');
