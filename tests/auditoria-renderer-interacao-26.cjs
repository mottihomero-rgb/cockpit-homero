'use strict';
// Chromium isolado com HTML/API falsos. Nenhuma mensagem externa ou escrita no produto.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const source = fs.readFileSync(path.resolve(__dirname, '../renderer/app.js'), 'utf8');
function func(nome) {
  const m = new RegExp('^(?:async )?function ' + nome + '\\(', 'm').exec(source);
  assert.ok(m, nome);
  const next = /^(?:async )?function [\w$]+\(/mg;
  next.lastIndex = m.index + m[0].length;
  const n = next.exec(source);
  const text = source.slice(m.index, n ? n.index : undefined);
  const ends = [...text.matchAll(/^}$/mg)];
  return text.slice(0, ends.at(-1).index + 1);
}
const prelude = `
var $ = (s, r = document) => r.querySelector(s);
var $$ = (s, r = document) => [...r.querySelectorAll(s)];
var ico = () => '', svgMotor = () => '', marcarEspera = () => {}, avisoTemp = () => {};
var focusPane = null, torreResposta = null;
var panes = new Map();
var torreVisivel = () => false, pintarTorre = () => {};
var abaDe = () => null, irAoChat = () => {}, chegadaDoPedido = () => {};
var pintarModo = () => {}, savePanes = () => {};
var pintarPedido = (P, bar, ev) => { $('.pp-txt', bar).textContent = ev.detail; };
var nomeDoMotor = e => e, clearEmpty = () => {}, scroll = () => {};
var MODOS = {}, cfg = {};
window.api = {};
`;

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<div class="pane"><div class="pane-cmp"><textarea class="p-input"></textarea></div></div>');
    const erros = [];
    page.on('pageerror', e => erros.push(e.message));
    await page.addScriptTag({ content: prelude + ['respostaDaPergunta', 'abrirPerguntas', 'fecharPerguntas', 'resumoDasRespostas'].map(func).join('\n') });
    await page.evaluate(() => {
      window.P = { id: 'p1', engine: 'claude', el: document.querySelector('.pane') };
      abrirPerguntas(P, { key: 'fake', questions: [
        { question: 'Primeira?', options: [{ label: 'A' }, { label: 'B' }] },
        { question: 'Segunda?', options: [{ label: 'C' }, { label: 'D' }] },
      ] });
      document.querySelector('.pq-op').click();
      document.querySelector('.pq-op').click();
    });
    await page.waitForTimeout(240);
    const estado = await page.evaluate(() => ({ indice: P.perguntasAtual.i, total: P.perguntasAtual.qs.length }));
    assert.equal(estado.indice, 1);
    assert.equal(estado.total, 2);
    assert.deepEqual(erros, []);
    console.log('R-F06 OK: clique duplo avança só uma pergunta, sem erro.');

    const tower = await browser.newPage();
    await tower.setContent('<div class="pane"><div class="pane-perm hidden"><span class="pp-txt"></span><button class="pp-yes">Permitir</button><button class="pp-no">Negar</button><button class="pp-sempre">Sempre</button></div></div>');
    await tower.addScriptTag({ content: prelude + ['showApproval', 'estadoDoPainel', 'responderPelaTorre', 'fecharRespostaDaTorre'].map(func).join('\n') });
    await tower.evaluate(() => {
      window.P = { id: 'p1', engine: 'claude', el: document.querySelector('.pane'), titulo: 'Teste', hist: [] };
      panes.set(P.id, P);
      window.aprovados = [];
      window.api.approve = async ({ key }) => { aprovados.push(key); return { ok: true }; };
      showApproval(P, { key: 'A', detail: 'Ler arquivo de teste A' });
      showApproval(P, { key: 'B', detail: 'Alterar arquivo de teste B' });
      responderPelaTorre(P);
    });
    await tower.locator('#torreResposta .pp-yes').click();
    await tower.waitForTimeout(300);
    const first = await tower.evaluate(() => ({
      aprovados, atual: P.aprovacaoAtual.key,
      copia: document.querySelector('#torreResposta .pp-txt')?.textContent,
      original: document.querySelector('.pane .pp-txt').textContent,
    }));
    assert.deepEqual(first.aprovados, ['A']);
    assert.equal(first.atual, 'B');
    assert.equal(first.copia, undefined);
    assert.equal(first.original, 'Alterar arquivo de teste B');
    await tower.evaluate(() => responderPelaTorre(P));
    assert.equal(await tower.locator('#torreResposta .pp-txt').textContent(), 'Alterar arquivo de teste B');
    await tower.locator('#torreResposta .pp-yes').click();
    const second = await tower.evaluate(() => aprovados);
    assert.deepEqual(second, ['A', 'B']);
    console.log('R-F07 OK: cada cópia autoriza só seu pedido, e fecha antes do próximo.');

    // Uma falha mantém o MESMO pedido respondível; um callback antigo não fecha outra Torre.
    await tower.evaluate(() => {
      showApproval(P, { key: 'C', detail: 'Pedido C' });
      window.tentativas = 0;
      window.api.approve = async ({ key }) => ++tentativas === 1 ? { error: 'offline' } : { ok: true };
      responderPelaTorre(P);
    });
    await tower.locator('#torreResposta .pp-yes').click();
    assert.equal(await tower.locator('#torreResposta .pp-yes').isEnabled(), true);
    assert.equal(await tower.evaluate(() => P.aprovacaoAtual.key), 'C');
    await tower.locator('#torreResposta .pp-yes').click();
    await tower.waitForFunction(() => !document.querySelector('#torreResposta'));
    assert.equal(await tower.evaluate(() => tentativas), 2);
    console.log('R-F07 OK: falha não perde pedido e permite repetir com a mesma chave.');

    await page.evaluate(() => {
      abrirPerguntas(P, { key: 'navegar', questions: [
        { question: 'Primeira?', options: [{ label: 'A' }] },
        { question: 'Segunda?', options: [{ label: 'B' }] },
        { question: 'Terceira?', options: [{ label: 'C' }] },
      ] });
      document.querySelector('.pq-op').click();
      document.querySelector('.pq-seguir').click();
    });
    await page.waitForTimeout(220);
    assert.equal(await page.evaluate(() => P.perguntasAtual.i), 1);
    assert.deepEqual(erros, []);
    console.log('R-F06 OK: avançar manualmente cancela o timer da escolha anterior.');

    const draft = await browser.newPage();
    await draft.setContent('<div class="pane"><textarea class="p-input">Ajuste importante que ainda não enviei.</textarea></div>');
    await draft.addScriptTag({ content: prelude + 'var send = (P, texto) => { window.enviado = texto; };\n' + func('enviarComoEle') });
    const result = await draft.evaluate(() => {
      const P = { el: document.querySelector('.pane') };
      enviarComoEle(P, 'Plano aprovado. Pode executar.');
      return { texto: document.querySelector('.p-input').value, enviado };
    });
    assert.equal(result.texto, 'Ajuste importante que ainda não enviei.');
    assert.equal(result.enviado, 'Plano aprovado. Pode executar.');
    console.log('R-F08 OK: aprovação passa texto separado ao send, sem tocar no rascunho.');
    const login = await browser.newPage();
    await login.setContent('<div class="pane"><div class="p-modal hidden" data-codex-surface="account"><div class="modal-cx"></div></div></div>');
    await login.addScriptTag({ content: prelude + `
      var fecharMenus = () => {}, ESTA_TELA = 'teste', termSeq = 0, termsVivos = new Map();
      var Terminal = class { open() {} onData() {} resize() {} write() {} focus() {} dispose() {} };
      var codexGlobais = { contaTimer: null, conectoresTimer: null, lendoConta: false, lendoConectores: false, vistos: new Map() };
      var contaCache = {}, USO = {}, USO_QUANDO = {}, NA_VPS = () => false;
      var pintarContaLateral = async () => {}, pintarUso = () => {};
      var semEscapes = s => s, REG_LINK = /https/g;
      window.api = { termRun: async () => ({}), termResize: async () => ({}), termInput: () => {}, termKill: () => {} };
      var substituiu = 0;
      var janelaConta = async P => { substituiu++; $('.modal-cx', P.el).innerHTML = '<p>Conta do Codex</p>'; };
    ` + ['janelaTerminal', 'fecharModal', 'receberEventoGlobalCodex'].map(func).join('\n') });
    const marcador = await login.evaluate(() => {
      const P = { id: 'p1', engine: 'codex', cwd: '/projeto', el: document.querySelector('.pane') };
      panes.set(P.id, P); focusPane = P;
      janelaTerminal(P, 'comando-falso', 'Vincular conta', null, { vincular: 'codex' });
      receberEventoGlobalCodex({ kind: 'account', destino: 'local' });
      return document.querySelector('.p-modal').dataset.codexSurface;
    });
    assert.equal(marcador, 'vincular');
    await login.waitForTimeout(250);
    const contaResultado = await login.evaluate(() => {
      const reg = [...termsVivos.values()][0];
      let erro = '';
      try { reg.estadoVinc('ok', 'conta fictícia'); } catch (e) { erro = e.message; }
      return { substituiu, terminalVivo: termsVivos.size, erro };
    });
    assert.equal(contaResultado.substituiu, 0);
    assert.equal(contaResultado.terminalVivo, 1);
    assert.equal(contaResultado.erro, '');
    await login.evaluate(() => {
      const reg = [...termsVivos.values()][0];
      fecharModal(focusPane);
      reg.estadoVinc('ok', 'callback atrasado');
    });
    assert.equal(await login.evaluate(() => termsVivos.size), 0);
    assert.equal(await login.locator('.p-modal').getAttribute('data-codex-surface'), '');
    console.log('R-F10 OK: evento de conta não substitui login; callbacks atrasados não tocam outra janela.');
    const nomes = await browser.newPage();
    await nomes.setContent('<div class="pane"><div class="pane-nome"><span class="pn-txt">Antigo</span><button class="pn-edit">Editar</button></div></div>');
    await nomes.addScriptTag({ content: prelude + `
      var painelAindaAtual = () => true, lateralAberta = () => false;
      var lembrarNomeDaParte = () => {}, pintarNome = P => { $('.pn-txt', P.el).textContent = P.titulo; };
      window.P = { id: 'p1', engine: 'claude', sessaoId: 'S', titulo: 'Antigo', el: document.querySelector('.pane') };
      window.api.renomear = async () => ({ error: 'Disco indisponível' });
    ` + func('renomearAqui') });
    await nomes.evaluate(() => renomearAqui(P));
    await nomes.locator('.pn-input').fill('Novo');
    await nomes.locator('.pn-input').press('Enter');
    assert.equal(await nomes.evaluate(() => P.titulo), 'Antigo');
    assert.equal(await nomes.locator('.pn-txt').textContent(), 'Antigo');
    await nomes.evaluate(() => { window.api.renomear = async () => true; renomearAqui(P); });
    await nomes.locator('.pn-input').fill('Novo');
    await nomes.locator('.pn-input').press('Enter');
    assert.equal(await nomes.evaluate(() => P.titulo), 'Novo');
    assert.equal(await nomes.locator('.pn-txt').textContent(), 'Novo');
    console.log('B04 OK: título manual só muda depois de confirmação da gravação.');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
