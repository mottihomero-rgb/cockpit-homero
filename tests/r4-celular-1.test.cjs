'use strict';
/* Testes de guarda do lote "celular 1" da rodada 4 (R4-004, R4-006).
   Cada teste falha no código de ANTES do conserto e passa com o conserto aplicado. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const mobileSrc = fs.readFileSync(path.join(__dirname, '../renderer/mobile.js'), 'utf8');
const celularCss = fs.readFileSync(path.join(__dirname, '../renderer/celular.css'), 'utf8');
const styleCss = fs.readFileSync(path.join(__dirname, '../renderer/style.css'), 'utf8');

function extractFn(nome, src) {
  const re = new RegExp('^\\s*(?:async )?function ' + nome + '\\(', 'm');
  const m = re.exec(src);
  assert.ok(m, nome + ' existe no arquivo');
  const start = m.index;
  const linha = src.slice(start, src.indexOf('\n', start));
  if (linha.trimEnd().endsWith('}')) return linha;
  return src.slice(start, src.indexOf('\n}', start) + 2);
}

/* ===================== R4-004: iPhone volta da queda mas fica preso em "trabalhando…" ===================== */

function contextoMobile(extras = {}) {
  const chamadas = { paneEstado: 0, sessionHistory: 0, setDot: [] };
  const P = { id: 'p1', engine: 'claude', cwd: '/projeto', started: true, busy: true,
    sessaoId: 'sess-1', sessaoFile: '', chat: { scrollTop: 0, scrollHeight: 0, clientHeight: 0, replaceChildren() {} },
    hist: [], blocks: new Map(), tools: new Map(),
    ...extras.P };
  const rendersRecebidos = [];
  const c = {
    console,
    pronto: true, atualizando: false, restaurando: false,
    document: { hidden: false, body: { classList: { contains: () => false } } },
    panes: new Map([[P.id, P]]),
    focusPane: P,
    sessao: (p) => p.sessaoId || p.resumeId || '',
    NA_VPS: () => false,
    selos: new WeakMap(),
    renderizarHistorico: (p, m) => rendersRecebidos.push(m),
    scroll: () => {},
    receberEventoPane: () => {},
    // setDot mora em app.js (funcao global no mesmo escopo do renderer); o mobile.js so
    // consegue destravar o ponto/botao "Parar" se chamar ela — o spy prova que foi chamada.
    setDot: (p, estado) => chamadas.setDot.push(estado),
    window: { api: {
      paneEstado: extras.paneEstado === undefined ? async () => { chamadas.paneEstado++; return { busy: false, aprovacao: null }; }
        : async (...a) => { chamadas.paneEstado++; return extras.paneEstado(P, ...a); },
      sessionHistory: async () => { chamadas.sessionHistory++; return extras.sessionHistory ? extras.sessionHistory() : [{ id: 1 }, { id: 2 }]; },
      sessionHistoryRemoto: async () => { chamadas.sessionHistory++; return []; },
    } },
  };
  vm.createContext(c);
  const normalizado = mobileSrc.replace(/^  /gm, '');
  vm.runInContext(extractFn('atualizar', normalizado), c);
  return { c, P, chamadas, rendersRecebidos, atualizar: vm.runInContext('atualizar', c) };
}

test('R4-004 mobile.js: Mac confirma que o turno acabou (paneEstado) — a tela sai de "trabalhando…"', async () => {
  // cenario: iPhone mandou msg (P.busy=true, P.started=true), a internet caiu antes do
  // turn-end chegar. Ele reabre o app, o Mac confirma via paneEstado que ja terminou
  // (estado.busy=false). Sem o conserto, P.busy nunca e zerado (o R3-005 deixou isso pro
  // evento turn-end, que e justamente o que se perdeu), entao a guarda de saida do
  // atualizar() (if (P.busy || ...) return) descarta tudo e a tela fica presa pra sempre.
  const { atualizar, chamadas, rendersRecebidos, P } = contextoMobile({
    P: { started: true, busy: true },
    paneEstado: () => ({ busy: false, aprovacao: null }),
    sessionHistory: () => [{ id: 1 }, { id: 2 }],
  });
  await atualizar();
  assert.equal(P.busy, false, 'confirmado pelo Mac, P.busy tem que ser liberado (senao a guarda de saida trava tudo de novo)');
  assert.deepEqual(chamadas.setDot, ['idle'], 'setDot so muda por chamada explicita — sem ela o ponto/botao Parar ficam presos em "ocupado"');
  assert.equal(rendersRecebidos.length, 2, 'com a tela destravada, o historico atualizado (2 msgs) tinha que ser desenhado de novo');
});

test('R4-004 mobile.js: resposta chegando AO VIVO durante o await continua protegida (nao atropela streaming)', async () => {
  // mesma race do R3-005: P.busy comeca false, mas liga DURANTE o await (evento ao vivo).
  // O conserto do R4-004 nao pode furar essa protecao.
  const { atualizar, chamadas } = contextoMobile({
    P: { started: true, busy: false },
    paneEstado: (P) => { P.busy = true; return { busy: false, aprovacao: null }; },
  });
  await atualizar();
  assert.equal(chamadas.sessionHistory, 0, 'nao pode reler o historico por cima de uma resposta ainda chegando ao vivo');
  assert.deepEqual(chamadas.setDot, [], 'sem confirmacao de turno acabado, setDot nao pode ser chamado');
});

/* ===================== R4-006: aneis de toque invisiveis se sobrepondo ===================== */

test('R4-006 celular.css + style.css: aneis de toque dos 4 botoes da lista nao podem se sobrepor', () => {
  const mInset = /\.hi-fav::after,\.hi-edit::after,\.hi-grupo::after,\.hi-mais::after\{content:"";position:absolute;inset:(-?\d+)px\}/.exec(celularCss);
  assert.ok(mInset, 'regra do anel invisivel dos botoes da lista nao foi encontrada em celular.css');
  const inset = Number(mInset[1]);

  const mGap = /\.hist-item\{[^}]*gap:(\d+)px/.exec(styleCss);
  assert.ok(mGap, 'gap do .hist-item nao foi encontrado em style.css');
  const gap = Number(mGap[1]);

  // com -9px (o valor de antes do conserto) 2*9=18 > 7: os aneis de botoes vizinhos se
  // cruzavam numa faixa de ~11px, e quem ganhava o toque era o botao seguinte no DOM.
  assert.ok(2 * Math.abs(inset) <= gap,
    `aneis de toque nao podem se sobrepor: 2*|inset|(${2 * Math.abs(inset)}) tem que caber no gap real entre os botoes (${gap})`);
});
