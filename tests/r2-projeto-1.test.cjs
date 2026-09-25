'use strict';
/* Teste de guarda do lote "projeto" (R2), rodada 2. Cobre dois defeitos de TESTE fraco (a
   checagem antiga passava mesmo com o defeito de verdade presente):
   - R2-046: dono-da-conversa.test.cjs so olhava se o Map perdeu o registro (claudePanes.has),
     mas claudeStop apaga o registro ANTES de chamar matarGrupoExtra — entao aquela checagem
     fica cega pra um kill quebrado.
   - R2-047: r1-cruzado-2.test.cjs procurava "touch-action:none" no style.css INTEIRO, e
     .pane-split-h ja tem essa propriedade em outro ponto — entao a busca batia mesmo que a
     regra .ef-shell nunca tivesse ganhado touch-action:none.
   Aqui cada defeito ganha duas provas: (1) simula o bug de verdade e mostra que a checagem
   ANTIGA nao pega, so a NOVA pega; (2) roda a checagem NOVA contra o estado real (main.js /
   style.css) pra travar regressao futura. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadMain } = require('./main-harness.cjs');

// ---------- R2-046 ----------

test('R2-046: checagem ANTIGA (so o Map) fica cega se matarGrupoExtra parar de ser chamado', async () => {
  const h = loadMain();
  await h.call('pane:start', { paneId: 'p1', engine: 'claude', cwd: h.HOME, resumeId: 'G-1' });
  await h.call('pane:start', { paneId: 'w7k3p1', engine: 'claude', cwd: h.HOME, resumeId: 'G-1' }); // so avisa
  // Simula o bug que R1-048 corrigiu voltando: apaga o registro, mas NAO mata o grupo.
  h.evaluate(`
    globalThis.__chamadasGrupo = [];
    claudeStop = function (paneId) {
      const st = claudePanes.get(paneId);
      if (st) { st.parandoDeProposito = true; claudePanes.delete(paneId); }
    };
  `);
  await h.call('pane:start', { paneId: 'w7k3p1', engine: 'claude', cwd: h.HOME, resumeId: 'G-1' }); // assume de novo

  // a checagem ANTIGA (so' olhar se sumiu do Map) passaria mesmo com o kill quebrado — e' o
  // buraco que R2-046 achou: registro some de qualquer jeito, kill ou nao.
  assert.equal(h.evaluate("claudePanes.has('p1')"), false, '(mostra o buraco) o registro some mesmo sem matar o processo');
  // a checagem NOVA (a que entrou em dono-da-conversa.test.cjs) pega o buraco: matarGrupoExtra
  // nunca foi chamado.
  assert.equal(h.evaluate('globalThis.__chamadasGrupo.length'), 0, 'com o kill quebrado, matarGrupoExtra nao e chamado — a checagem nova enxerga isso, a antiga nao');
});

test('R2-046: com o claudeStop real, matarGrupoExtra E chamado — trava regressao futura', async () => {
  const h = loadMain();
  await h.call('pane:start', { paneId: 'p1', engine: 'claude', cwd: h.HOME, resumeId: 'G-2' });
  await h.call('pane:start', { paneId: 'w7k3p1', engine: 'claude', cwd: h.HOME, resumeId: 'G-2' });
  h.evaluate("globalThis.__chamadasGrupo = []; matarGrupoExtra = (p) => { globalThis.__chamadasGrupo.push(p); };");
  await h.call('pane:start', { paneId: 'w7k3p1', engine: 'claude', cwd: h.HOME, resumeId: 'G-2' }); // assume de novo, mata o p1

  assert.equal(h.evaluate('globalThis.__chamadasGrupo.length'), 1, 'claudeStop real tem de chamar matarGrupoExtra exatamente uma vez pra matar o agente antigo');
});

// ---------- R2-047 ----------

test('R2-047: checagem ANTIGA (CSS inteiro) fica cega se so .ef-shell perder touch-action:none', () => {
  // .pane-split-h ja tem touch-action:none (sem relacao com a regua de esforco); .ef-shell
  // aqui NAO tem — simula exatamente o defeito original (R1-021) voltando.
  const cssQuebrado = '.pane-split-h{cursor:col-resize;touch-action:none}\n.ef-shell{position:relative;display:flex}';
  const buscaAntiga = cssQuebrado.includes('touch-action:none') || /touch-action\s*:\s*none/.test(cssQuebrado);
  assert.equal(buscaAntiga, true, '(mostra o buraco) a busca no arquivo inteiro bate por causa de .pane-split-h, mesmo sem a regra em .ef-shell');

  const bloco = /\.ef-shell\{[^}]*\}/.exec(cssQuebrado);
  assert.ok(bloco, 'achou a regra .ef-shell no CSS de teste');
  assert.equal(/touch-action\s*:\s*none/.test(bloco[0]), false, 'a checagem nova (so dentro do bloco .ef-shell) pega o buraco, a antiga nao');
});

test('R2-047: style.css real tem touch-action:none DENTRO da regra .ef-shell (trava regressao futura)', () => {
  const cssSource = fs.readFileSync(path.join(__dirname, '../renderer/style.css'), 'utf8');
  const bloco = /\.ef-shell\{[^}]*\}/.exec(cssSource);
  assert.ok(bloco, 'achou a regra .ef-shell no style.css');
  assert.match(bloco[0], /touch-action\s*:\s*none/, 'a regra .ef-shell precisa manter touch-action:none pra regua nao virar scroll no celular');
});
