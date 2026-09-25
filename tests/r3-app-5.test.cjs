'use strict';
// Teste de guarda da faixa "app" (lote 5), rodada 3 da auditoria de 25/09.
// Cobre: R3-037 (chaveFav sem arquivo mistura conversas irmãs do Codex), R3-042 (atualizarGit
// sem trava de corrida sobrescreve o chip com resposta velha), R3-040 (abrir/sair de worktree
// corta trabalho sem perguntar) e R3-041 (boot trava mudo se o Mac não responder no iPhone).
// Mesmo padrão de tests/auditoria-renderer-20260921.test.cjs e tests/r3-app-1.test.cjs: extrai a
// função/trecho do arquivo real por regex e roda em vm com stubs das dependências.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../renderer/app.js'), 'utf8');

function func(nome, src = source) {
  const re = new RegExp('^(?:async )?function ' + nome + '\\(', 'm');
  const match = re.exec(src);
  assert.ok(match, nome + ' existe em renderer/app.js');
  const start = match.index;
  const line = src.slice(start, src.indexOf('\n', start));
  if (line.endsWith('}')) return line;
  return src.slice(start, src.indexOf('\n}', start) + 2);
}

// chaveFav nao e "function nome(", e uma const de uma linha so
function constLine(nome, src = source) {
  const re = new RegExp('^const ' + nome + ' =.*$', 'm');
  const match = re.exec(src);
  assert.ok(match, nome + ' existe em renderer/app.js');
  return match[0];
}

// trecho do boot() marcado pelo comentario do R3-041, ate o "}" do catch (antes do proximo bloco)
function trechoBootR3041(src = source) {
  const ini = src.indexOf('// R3-041: no iPhone');
  assert.ok(ini >= 0, 'comentario R3-041 existe em renderer/app.js (boot)');
  const fim = src.indexOf('\n  // no telefone: a lateral vira gaveta', ini);
  assert.ok(fim > ini, 'fim do trecho do boot encontrado');
  return src.slice(ini, fim);
}

function context(names, extras = {}) {
  const c = { console, Map, Set, Promise, Array, Math, String, Number, JSON };
  Object.assign(c, extras);
  vm.createContext(c);
  vm.runInContext(names.map((n) => func(n)).join('\n'), c);
  return c;
}

// ---------------------------------------------------------------------------
// R3-037 — chaveFav tem que incluir o arquivo, senão a irmã do Codex é atingida
// ---------------------------------------------------------------------------
test('R3-037: chaveFav distingue conversas com mesmo id e arquivo diferente (Codex)', () => {
  const c = { console };
  vm.createContext(c);
  vm.runInContext(constLine('chaveFav').replace(/^const /, 'var '), c);

  const A = { engine: 'codex', id: 'X', file: 'a.jsonl' };
  const B = { engine: 'codex', id: 'X', file: 'b.jsonl' };
  assert.notEqual(c.chaveFav(A), c.chaveFav(B), 'chaves tem que ser diferentes para conversas diferentes com o mesmo id');

  // simula o trecho de apagarConversa que usa chaveFav para tirar favorito/grupo (linhas 7849-7850)
  let cfg = { favoritos: [c.chaveFav(A), c.chaveFav(B)], grupoSessao: { [c.chaveFav(A)]: 'g1', [c.chaveFav(B)]: 'g2' } };
  // apaga A
  cfg.favoritos = cfg.favoritos.filter((k) => k !== c.chaveFav(A));
  delete cfg.grupoSessao[c.chaveFav(A)];

  assert.ok(cfg.favoritos.includes(c.chaveFav(B)), 'favorito da irmã B tem que sobreviver a apagar A');
  assert.equal(cfg.grupoSessao[c.chaveFav(B)], 'g2', 'grupo da irmã B tem que sobreviver a apagar A');
  assert.ok(!cfg.favoritos.includes(c.chaveFav(A)), 'favorito de A foi removido');
});

// ---------------------------------------------------------------------------
// R3-042 — atualizarGit precisa de trava de corrida (minhaVez / P.gitGen)
// ---------------------------------------------------------------------------
test('R3-042: atualizarGit nao deixa resposta velha sobrescrever o chip', async () => {
  let resolvePrimeira;
  let chamadas = 0;
  const chip = { classList: { add() {}, remove() {} }, textContent: '', title: '', onclick: null };
  const c = context(['atualizarGit'], {
    $: () => chip,
    NA_VPS: () => false,
    pastaDoWorktree: (P) => P.cwd,
    window: {
      api: {
        gitStatus: () => {
          chamadas++;
          if (chamadas === 1) {
            // 1a chamada (branch antiga) demora e so resolve depois da 2a
            return new Promise((res) => { resolvePrimeira = () => res({ branch: 'branch-velha', arquivos: [] }); });
          }
          return Promise.resolve({ branch: 'branch-nova', arquivos: [] });
        },
      },
    },
  });

  const P = { el: {}, cwd: '/x', worktree: '' };
  const p1 = c.atualizarGit(P);   // 1a chamada: comeca e fica esperando
  const p2 = c.atualizarGit(P);   // 2a chamada: comeca e resolve na hora
  await p2;
  resolvePrimeira();              // so agora a 1a chamada (mais velha) resolve
  await p1;

  assert.equal(chip.textContent, 'branch-nova', 'a resposta mais nova tem que ganhar, mesmo chegando primeiro');
});

// ---------------------------------------------------------------------------
// R3-040 — abrir/sair de worktree tem que perguntar antes de cortar trabalho em andamento
// ---------------------------------------------------------------------------
test('R3-040: alternarWorktree pergunta antes de cortar (mesma trava de trocarMotor)', async () => {
  const chamadasAplicar = [];
  let respostaConfirm = true;
  const c = context(['confirmarCorte', 'alternarWorktree'], {
    nomeDoMotor: () => 'Claude',
    agTrabalhando: (P) => !!P.trabalhando,
    confirm: () => respostaConfirm,
    aplicarWorktree: async (P, nome) => { chamadasAplicar.push(nome); },
    NA_VPS: () => false,
    note: () => {},
    window: { api: { gitStatus: async () => ({}) } },
  });

  // (1) P.busy = true, confirm = false -> aplicarWorktree NAO roda, trabalho preservado
  respostaConfirm = false;
  let P = { worktree: 'exp', busy: true, engine: 'claude' };
  await c.alternarWorktree(P);
  assert.equal(chamadasAplicar.length, 0, 'com trabalho em andamento e confirm=false, nao pode sair do worktree');

  // (2) P.busy = true, confirm = true -> aplicarWorktree roda
  respostaConfirm = true;
  P = { worktree: 'exp', busy: true, engine: 'claude' };
  await c.alternarWorktree(P);
  assert.deepEqual(chamadasAplicar, [''], 'confirmando, sai do worktree normalmente');

  // (3) P.busy = false (chat parado) -> nao pergunta nada (comportamento de hoje preservado)
  chamadasAplicar.length = 0;
  P = { worktree: 'exp', busy: false, engine: 'claude' };
  await c.alternarWorktree(P);
  assert.deepEqual(chamadasAplicar, [''], 'chat parado continua saindo do worktree sem perguntar');
});

// ---------------------------------------------------------------------------
// R3-041 — boot nao pode travar mudo se HOME/getConfig/webEstado falharem (iPhone)
// ---------------------------------------------------------------------------
test('R3-041: trecho do boot cobre falha do Mac com alert, sem travar (nem lancar) e sem "return" no catch', async () => {
  const trecho = trechoBootR3041();
  assert.ok(!/\}\s*catch[\s\S]*?\breturn\b/.test(trecho.slice(trecho.indexOf('catch'))), 'o catch nao pode ter "return" (senao o boot para de vez)');

  const avisos = [];
  const elMock = { checked: false, classList: { add() {}, toggle() {} }, addEventListener() {} };
  const c = { console, setTimeout, Promise };
  vm.createContext(c);
  vm.runInContext(
    'async function bootTrecho(HOME, cfg, window, $, pintarCaminho, alert) {\n' + trecho + '\n  return { HOME, cfg };\n}',
    c
  );

  const windowFalho = {
    api: {
      home: () => Promise.reject(new Error('O Mac não respondeu.')),
      getConfig: async () => ({}),
    },
  };
  const resultado = await c.bootTrecho('', {}, windowFalho, () => elMock, () => {}, (msg) => avisos.push(msg));

  // nao lancou (a promise acima ja teria rejeitado o teste se tivesse lancado)
  assert.equal(resultado.HOME, '', 'HOME fica no padrao quando window.api.home() rejeita');
  // o alert (avisado por setTimeout) so dispara depois; espera o proximo tick
  await new Promise((r) => setTimeout(r, 350));
  assert.equal(avisos.length, 1, 'tem que avisar 1 vez que nao conseguiu falar com o Mac');
  assert.match(avisos[0], /Mac|recarreg/i, 'aviso tem que falar do Mac / recarregar');
});
