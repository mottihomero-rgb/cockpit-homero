'use strict';

// Testes de guarda do lote "main" (R1) — faixa consertador, rodada 1.
// Cobrem: R1-002 (vazamento do mapa codexProcessPanes), R1-004 (worktree invalido matava o
// motor que ja estava rodando), R1-048 (kill direto deixava filho orfao), R1-005 (print grande
// demais sumia calado) e R1-007 (SSH desistia do socket pra sempre na primeira falha depois
// de provado). Padrao de arquivo: tests/main-harness.cjs + tests/auditoria-main-20260921.test.cjs.

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadMain } = require('./main-harness.cjs');

function json(proc, value) { proc.stdout.emit('data', Buffer.from(JSON.stringify(value) + '\n')); }

// ---------- R1-002: codexProcessPanes nunca era limpo por comando concluido ----------
test('R1-002: comando do Codex concluido solta o registro do painel (sem isso, vaza pra sempre)', async () => {
  const h = loadMain();
  h.evaluate(`
    codex.threadToPane.set('thread-1', 'p1');
    codex.paneToThread.set('p1', 'thread-1');
  `);
  h.notify('item/started', { threadId: 'thread-1', item: { id: 'a', type: 'commandExecution', processId: 'X', command: 'ls' } }, 'local');
  assert.equal(h.evaluate("codexProcessPanes.get('local:X')"), 'p1', 'o comando que comecou tem de registrar o painel');
  h.notify('item/completed', { threadId: 'thread-1', item: { id: 'a', type: 'commandExecution', processId: 'X', status: 'completed', exitCode: 0 } }, 'local');
  // Sem o conserto este registro fica pra sempre (so cai quando o PAINEL inteiro fecha ou o
  // Codex cai) — um app que fica dias no ar acumula um por comando de terminal ja rodado.
  assert.equal(h.evaluate("codexProcessPanes.has('local:X')"), false, 'terminou o comando: o registro tem de sumir, senao vaza');
});

// ---------- R1-004: worktree invalido matava o motor que ja estava rodando ----------
test('R1-004: worktree invalido (pasta sem git) nao mata o Claude que ja estava rodando', async () => {
  const h = loadMain();
  const pastaGit = h.HOME + '/projeto';
  h.put(pastaGit + '/.git', 'marca de repo git');
  const subiu = h.evaluate(`claudeStart('p1', { cwd: ${JSON.stringify(pastaGit)} })`);
  assert.equal(subiu, true);
  const antigo = h.spawned.at(-1);
  let chamadasKill = 0;
  antigo.proc.kill = () => { chamadasKill++; };

  const pastaSemGit = h.HOME + '/nao-e-git';
  const ok = h.evaluate(`claudeStart('p1', { cwd: ${JSON.stringify(pastaSemGit)}, worktree: 'x' })`);
  assert.equal(ok, false, 'pasta sem git: a troca tem de ser recusada');
  // Antes do conserto, claudeStop() ja tinha rodado (e matado o motor antigo) ANTES desta
  // validacao existir — o painel ficava sem NENHUM motor, sem 'engine-down'.
  assert.equal(chamadasKill, 0, 'o motor que ja estava rodando nao pode ser morto por uma troca invalida');
  assert.equal(h.evaluate("claudePanes.get('p1').proc") === antigo.proc, true, 'o painel continua com o MESMO processo de antes');

  const okNome = h.evaluate(`claudeStart('p1', { cwd: ${JSON.stringify(pastaGit)}, worktree: 'nome.' })`);
  assert.equal(okNome, false, 'nome de worktree que o git recusa (ponto no fim) tambem tem de ser recusado');
  assert.equal(chamadasKill, 0, 'nome de worktree invalido tambem nao pode matar o motor atual');
});

// ---------- R1-048: kill direto deixava filho orfao (sandbox/MCP) ----------
test('R1-048: parar o Claude mata o GRUPO do processo (nao so o PID), e ele sobe destacado', async () => {
  const h = loadMain();
  const pastaGit = h.HOME + '/projeto';
  h.put(pastaGit + '/.git', 'marca de repo git');
  h.evaluate(`claudeStart('p1', { cwd: ${JSON.stringify(pastaGit)} })`);
  const rec = h.spawned.at(-1);
  // EH_WIN e false no harness (darwin): o processo tem de nascer com detached, senao
  // matar so o grupo (-pid) mais tarde nao alcanca o filho que ele tiver disparado.
  assert.equal(rec.options.detached, true, 'o spawn do Claude precisa subir com detached: !EH_WIN');

  h.evaluate(`
    globalThis.__chamadasGrupo = [];
    matarGrupoExtra = (p) => { globalThis.__chamadasGrupo.push(p); };
  `);
  h.evaluate("claudeStop('p1')");
  // Antes do conserto, claudeStop chamava st.proc.kill('SIGTERM') DIRETO — matarGrupoExtra
  // nunca era chamado, e um filho que o Claude tivesse disparado (MCP server) ficava orfao.
  assert.equal(h.evaluate("globalThis.__chamadasGrupo.length"), 1, 'claudeStop tem de matar pelo GRUPO (matarGrupoExtra), nao so o processo');
});

test('R1-048: o Codex tambem sobe destacado (sandbox de acesso total pode ter filho seu)', async () => {
  const h = loadMain();
  h.evaluate("codexStart('local').catch(() => {});");
  const rec = h.spawned.at(-1);
  assert.equal(rec.bin, 'codex');
  assert.equal(rec.options.detached, true, 'o spawn do Codex local precisa subir com detached: !EH_WIN');
});

// ---------- R1-005: print grande demais sumia sem nenhum aviso na tela ----------
test('R1-005: imagem grande demais (>3MB base64) entra na contagem de descartadas, nao so some', () => {
  const h = loadMain();
  const grande = 'A'.repeat(3 * 1024 * 1024 + 1);
  const pequena = 'B'.repeat(10);
  const r = h.evaluate(`
    (() => {
      const so_grande = imagensDoResultado([{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: '${grande}' } }]);
      const mista = imagensDoResultado([
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: '${pequena}' } },
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: '${grande}' } },
      ]);
      return { soGrandeLen: so_grande.length, soGrandeDescartadas: so_grande.descartadas,
               mistaLen: mista.length, mistaDescartadas: mista.descartadas };
    })()
  `);
  assert.equal(r.soGrandeLen, 0);
  assert.equal(r.soGrandeDescartadas, 1, 'antes do conserto isso sumia num "continue" mudo');
  assert.equal(r.mistaLen, 1, 'a imagem pequena continua passando normal');
  assert.equal(r.mistaDescartadas, 1);
});

test('R1-005: resultado do Claude com SO imagem grande avisa no tool-end, nao vira nada em silencio', async () => {
  const h = loadMain();
  await h.call('pane:start', { paneId: 'p1', engine: 'claude', cwd: h.HOME });
  const proc = h.spawned.at(-1).proc;
  h.clear();
  const grande = 'A'.repeat(3 * 1024 * 1024 + 1);
  json(proc, { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'x1', is_error: false,
    content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: grande } }] }] } });
  const eventos = h.paneEvents('tool-end');
  assert.equal(eventos.length, 1);
  // Antes do conserto: output ficava '' (string vazia) e nada na tela dizia que uma imagem
  // grande demais foi cortada.
  assert.match(eventos[0].output, /grande.*demais/i, 'tem de avisar que uma imagem foi descartada por tamanho');
  assert.equal(eventos[0].prints, undefined, 'nenhuma imagem coube: nao manda o campo de print');
});

// ---------- R1-007: SSH desistia do socket pra sempre na primeira falha depois de provado ----------
test('R1-007: socket velho falhando DEPOIS de ja ter sido provado ainda assim tenta sem ele', async () => {
  const h = loadMain();
  h.evaluate(`
    muxProvado = true;   // ja funcionou antes nesta sessao (cenario do defeito)
    muxLigado = true;
    globalThis.__socks = [];
    globalThis.__fechouMestres = 0;
    sshUmaVez = async (r, comando, ms, sock) => {
      globalThis.__socks.push(sock);
      if (sock) return { code: 255, out: '', errout: 'Permission denied (publickey)' };
      return { code: 0, out: 'ok', errout: '' };
    };
    fecharMestresSsh = () => { globalThis.__fechouMestres++; };
  `);
  const resultado = await h.evaluate("noServidorSsh(partesRemoto('vps:/opt/x'), 'echo hi', 5000)");
  // Antes do conserto, a condicao era "sock && !muxProvado && (...)" — com muxProvado ja true
  // (socket provado antes) a funcao NUNCA tentava de novo sem socket: devolvia o erro 255 como
  // se a VPS estivesse fora do ar, mesmo com ela 100% no ar.
  const socks = h.evaluate("globalThis.__socks");
  assert.equal(socks.length, 2, 'tem de tentar com socket, falhar, e tentar de novo sem socket');
  assert.equal(!!socks[0], true, 'a 1a tentativa tem de ser com socket');
  assert.equal(!!socks[1], false, 'a 2a tentativa tem de ser sem socket');
  assert.equal(resultado.code, 0, 'a segunda tentativa (sem socket) deu certo: o resultado tem de ser o dela, nao o erro 255');
  assert.equal(resultado.out, 'ok');
  assert.equal(h.evaluate("globalThis.__fechouMestres"), 1, 'o socket velho tem de ser descartado (fecharMestresSsh), pra nascer um novo depois');
});

test('R1-007: depois de reaproveitar sem socket, o multiplexing nao fica desligado pra sempre', async () => {
  const h = loadMain();
  h.evaluate(`
    muxProvado = false; muxLigado = true;
    sshUmaVez = async (r, comando, ms, sock) => sock ? { code: 255, out: '', errout: 'x' } : { code: 0, out: 'ok', errout: '' };
    fecharMestresSsh = () => {};
  `);
  const resultado = await h.evaluate("noServidorSsh(partesRemoto('vps:/opt/x'), 'echo hi', 5000)");
  assert.equal(resultado.code, 0);
  // Antes do conserto, a recuperacao bem sucedida fazia "muxLigado = false" — desligava o
  // ControlMaster PRA SEMPRE pelo resto da sessao (so um reinicio do app religava).
  assert.equal(h.evaluate("muxLigado"), true, 'o multiplexing nao pode ficar desligado pra sempre depois de uma recuperacao');
  assert.equal(h.evaluate("muxProvado"), false, 'volta ao estado "nao provado": a proxima chamada tenta de novo com socket novo');
});
