'use strict';
// R2-021: fechar o terminal embutido mandava SIGTERM direto no processo do
// ptybridge.py. O Python nao tem handler pra SIGTERM (handler padrao mata na
// hora, sem rodar nenhuma linha), entao encerrar_filho() -- a rede de
// seguranca que manda SIGHUP e depois SIGKILL pro comando -- nunca chegava a
// rodar. Um `comando &` deixado pra tras (job em 2o plano, com trap ou nao,
// e com GRUPO PROPRIO por causa do controle de job do shell -- e' assim que
// o terminal real do Cockpit abre, com `exec $SHELL -l`) sobrevivia
// escondido, reparentado no launchd.
//
// Este teste abre um pty de verdade com ptybridge.py, poe pra rodar um job
// em 2o plano com pgid PROPRIO (`set -m`, igual a um shell interativo faria)
// que ignora SIGHUP, chama matar() e confere que ninguem sobrou rodando.
//
// SEM o conserto (SIGTERM direto no ptybridge.py): o job sobrevive os ~2,7s
// do teste inteiro -- o teste falha.
// COM o conserto (plataforma.js fecha a entrada do processo + ptybridge.py
// mata a SESSAO inteira, nao so o grupo de 'pid'): o job morre em menos de
// 1s -- o teste passa.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execSync } = require('node:child_process');

const { abrirPty } = require('../plataforma');

const EH_MAC = process.platform === 'darwin';

function vivo(padrao) {
  try {
    execSync(`pgrep -f "${padrao}"`, { stdio: ['ignore', 'pipe', 'ignore'] });
    return true;
  } catch {
    return false; // pgrep sem achar nada sai com status != 0
  }
}

test('fechar o terminal mata job em 2o plano com grupo proprio que ignora SIGHUP (nao fica orfao)', {
  skip: !EH_MAC && 'este caminho (ptyMac) so existe no Mac',
}, async () => {
  const ptyBridge = path.join(__dirname, '..', 'ptybridge.py');
  // duracao unica por rodada: evita colidir com um "sleep" de outro teste rodando junto
  const dur = (6 + Math.random()).toFixed(4);
  const padrao = `^sleep ${dur}$`;
  // `set -m` liga o controle de job igual a um shell interativo: o job em 2o
  // plano ganha um GRUPO PROPRIO, diferente do grupo do shell -- exatamente
  // o caso real do terminal embutido (`exec $SHELL -l`).
  const linha = `set -m; (trap '' HUP; exec sleep ${dur}) & disown; sleep 30`;
  const term = abrirPty({
    linha, cols: 80, rows: 24, cwd: process.cwd(),
    env: { ...process.env, TERM: 'xterm-256color' },
    ptyBridge,
  });
  term.onData(() => {});
  term.onErro(() => {});

  try {
    await new Promise((r) => setTimeout(r, 500));
    assert.equal(vivo(padrao), true, 'o job precisa estar rodando antes de fechar o terminal (setup do teste)');

    // fecha o terminal, igual ao Homero clicando em Fechar/X/Esc
    term.matar();

    // encerrar_filho() do ptybridge pode levar ate ~1,5s pra escalar pra
    // SIGKILL; dar folga.
    await new Promise((r) => setTimeout(r, 2200));

    assert.equal(vivo(padrao), false,
      'job em 2o plano continuou vivo (orfao) depois de fechar o terminal embutido');
  } finally {
    try { execSync(`pkill -f "${padrao}"`, { stdio: 'ignore' }); } catch {}
  }
});
