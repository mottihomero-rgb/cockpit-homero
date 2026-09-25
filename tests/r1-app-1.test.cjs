'use strict';
// Testes de guarda para o lote "app" (renderer) da rodada 1 da auditoria do Cockpit.
// Padrao: extrair a funcao real de renderer/app.js por regex e rodar em vm com stubs,
// igual tests/auditoria-renderer-20260921.test.cjs.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const APP_PATH = path.join(__dirname, '../renderer/app.js');
const source = fs.readFileSync(APP_PATH, 'utf8');

function func(nome, src = source) {
  const re = new RegExp('^(?:async )?function ' + nome + '\\(', 'm');
  const match = re.exec(src);
  assert.ok(match, nome + ' existe em app.js');
  const start = match.index;
  const line = src.slice(start, src.indexOf('\n', start));
  if (line.endsWith('}')) return line;
  return src.slice(start, src.indexOf('\n}', start) + 2);
}

function classes(...initial) {
  const set = new Set(initial);
  return { add: (...xs) => xs.forEach(x => set.add(x)), remove: (...xs) => xs.forEach(x => set.delete(x)),
    contains: x => set.has(x), toggle: (x, yes) => yes ? set.add(x) : set.delete(x) };
}
function element() {
  return { style: {}, classList: classes(), dataset: {}, value: '', innerHTML: '', textContent: '', children: [],
    appendChild(x) { this.children.push(x); return x; }, remove() {}, focus() {}, select() {} };
}

function baseContext(extras = {}) {
  const c = {
    console, Map, Set, Date,
    window: { api: {} },
  };
  Object.assign(c, extras);
  vm.createContext(c);
  return c;
}

// ---------------------------------------------------------------------------
// R1-015 — melhorAgenteAcp() morta: tem de ter sumido do arquivo inteiro
// ---------------------------------------------------------------------------
test('R1-015: melhorAgenteAcp foi removida de app.js (codigo morto)', () => {
  const ocorrencias = (source.match(/melhorAgenteAcp/g) || []).length;
  assert.equal(ocorrencias, 0, 'melhorAgenteAcp nao pode mais aparecer em app.js');
});

// ---------------------------------------------------------------------------
// R1-016 — "Pasta na VPS" nao pode duplicar o prefixo vps:
// ---------------------------------------------------------------------------
test('R1-016: campo Pasta na VPS nao duplica o prefixo vps:', () => {
  // extrai a funcao semPrefixo (usada tambem pela linha corrigida)
  const semPrefixoMatch = /const semPrefixo = \(p\) => [^\n]+;/.exec(source);
  assert.ok(semPrefixoMatch, 'semPrefixo existe em app.js');
  // extrai o fecho ir() de dentro de pedirCaminhoVps
  const irMatch = /const ir = \(\) => \{[\s\S]*?\n {2}\};/.exec(source);
  assert.ok(irMatch, 'a funcao ir() de pedirCaminhoVps existe');

  const chamadas = [];
  const c = baseContext({
    fecharModal: () => {},
    levarChatPara: (P, caminho) => chamadas.push(caminho),
    inp: { value: '' },
    P: {},
  });
  vm.runInContext(semPrefixoMatch[0] + '\n' + irMatch[0].replace('const ir', 'var ir') + '\nthis.ir = ir;', c);

  const casos = [
    ['vps:/opt/adsure', 'vps:/opt/adsure'],   // ja tinha vps: -> nao pode duplicar
    ['VPS:/opt/adsure', 'vps:/opt/adsure'],   // maiusculo tambem conta
    ['/opt/adsure', 'vps:/opt/adsure'],       // caminho normal, sem prefixo
    ['opt/adsure', 'vps:/opt/adsure'],        // sem barra na frente
  ];
  for (const [entrada, esperado] of casos) {
    chamadas.length = 0;
    c.inp.value = entrada;
    c.ir();
    assert.equal(chamadas[0], esperado, 'entrada "' + entrada + '"');
  }
});

// ---------------------------------------------------------------------------
// R1-017 — legenda da fala nao pode virar linha de codigo crua em bloco longo
// ---------------------------------------------------------------------------
test('R1-017: legenda nao troca por linha de codigo quando a cerca esta aberta ha >600 chars', () => {
  const dentroSrc = func('dentroDeCerca');
  const legendaSrc = func('legendaDaFala');
  const legendarSrc = func('legendarTrabalho');
  const c = baseContext({ pintaTrab: () => {} });
  vm.runInContext(dentroSrc + '\n' + legendaSrc + '\n' + legendarSrc, c);

  // frase real + cerca de codigo aberta com bem mais de 600 caracteres, sem linha em branco
  const linhaCodigo = 'const linhaDeCodigoBemComprida = "' + 'x'.repeat(40) + '";\n';
  const bloco = '```js\n' + linhaCodigo.repeat(30); // > 600 chars, cerca ainda aberta
  const texto = 'Vou gerar o arquivo agora.\n\n' + bloco;

  const P = { busy: true, trabEl: {}, trabOque: 'legenda anterior' };
  c.legendarTrabalho(P, texto);
  assert.equal(P.trabOque, 'legenda anterior', 'com a cerca aberta, a legenda antiga tem de ser mantida');

  // caso 2 (independente): cerca ja fechada + paragrafo curto depois -> legenda normal
  const textoFechado = 'Vou gerar o arquivo agora.\n\n```js\nconst x = 1;\n```\n\nProntinho, terminei o arquivo.';
  const P2 = { busy: true, trabEl: {}, trabOque: '' };
  c.legendarTrabalho(P2, textoFechado);
  assert.equal(P2.trabOque, 'Prontinho, terminei o arquivo.');
});

// ---------------------------------------------------------------------------
// R1-018 — ramificarDaqui() tem de salvar (savePanes) igual forkClaude/abrirRamo
// ---------------------------------------------------------------------------
test('R1-018: ramificarDaqui chama savePanes com o cwd do chat de origem', () => {
  const src = func('ramificarDaqui');
  let savou = 0;
  const Q = { el: { focus() {} }, cwd: null };
  const c = baseContext({
    novoChatNaAba: () => Q,
    pintarPasta: () => {}, pintarNome: () => {}, avisoTemp: () => {}, nomePasta: () => '',
    $: () => ({ focus() {} }),
    savePanes: () => { savou++; },
  });
  vm.runInContext(src, c);

  const P = { hist: [{ quem: 'eu', texto: 'oi' }], cwd: 'projetoX/demandaY', titulo: 'conversa' };
  const d = { dataset: { hist: '0' } };
  c.ramificarDaqui(P, d);

  assert.equal(Q.cwd, 'projetoX/demandaY', 'o chat novo tem de herdar o cwd de origem, nao o da aba');
  assert.equal(savou, 1, 'savePanes tem de ser chamado ao ramificar "a partir daqui"');
});

// ---------------------------------------------------------------------------
// R1-025 — fecharAba() tem de alimentar fechadosRecentes via guardarFechado
// ---------------------------------------------------------------------------
test('R1-025: fechar a aba inteira guarda cada painel em fechadosRecentes', async () => {
  const src = func('fecharAba');
  const guardados = [];
  const painelEl = () => ({ remove() {} });

  const P1 = { id: 'p1', engine: 'claude', busy: false, hist: [{ texto: 'a' }], el: painelEl() };
  const P2 = { id: 'p2', engine: 'claude', busy: false, hist: [{ texto: 'b' }], el: painelEl() };
  const panesMap = new Map([['p1', P1], ['p2', P2]]);
  const A = { id: 'a1', ordem: ['p1', 'p2'], el: painelEl(), corpoEl: painelEl() };
  const outraAba = { id: 'a2', ordem: [] };
  const abasMap = new Map([['a1', A], ['a2', outraAba]]);

  const c = baseContext({
    panes: panesMap, abas: abasMap,
    agTrabalhando: () => false,
    confirm: () => true,
    vozSoltar: () => {},
    marcarAbertas: () => {},
    guardarFechado: (P) => guardados.push(P.id),
    focusPane: null,
    abaAtiva: A,
    telaNovaAba: () => {},
    ativarAbaProjeto: () => {},
    savePanes: () => {},
  });
  c.window.api.paneStop = async () => ({});
  vm.runInContext(src, c);

  await c.fecharAba(A);

  assert.deepEqual(guardados.sort(), ['p1', 'p2'], 'os dois paineis fechados com a aba tem de virar entrada em fechadosRecentes');
});
