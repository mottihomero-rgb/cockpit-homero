'use strict';
// Teste de guarda da faixa "app" (lote 1), rodada 2 da auditoria de 25/09.
// Cobre: R2-016 (grok na VPS), R2-002 (restaurarAbas devolve false quando nada remonta),
// R2-001 (historico das abas busca em paralelo), R2-015 (duplo clique na aba da VPS nao abre
// o Finder do Mac) e R2-004 (trocar de motor so troca de verdade depois do motor velho parar).
// Mesmo padrao de tests/auditoria-renderer-20260921.test.cjs: extrai a funcao do arquivo real
// por regex e roda em vm com stubs das dependencias.
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

function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }

function context(names, extras = {}) {
  const c = { console, Map, Set, Promise, Array, Math, String, Number, JSON };
  Object.assign(c, extras);
  vm.createContext(c);
  vm.runInContext(names.map(n => func(n)).join('\n'), c);
  return c;
}

// ---------------------------------------------------------------------------
// R2-016 — Grok na VPS precisa do mesmo aviso que o Gemini ja tinha
// ---------------------------------------------------------------------------
test('R2-016: motorIndisponivelNaPasta bloqueia grok na VPS igual ao gemini', () => {
  const c = context(['motorIndisponivelNaPasta'], { nomeDoMotor: (e) => e, MOTORES_OK: {}, NA_VPS: (cwd) => String(cwd || '').startsWith('vps:') });
  assert.notEqual(c.motorIndisponivelNaPasta('grok', 'vps:/opt/x'), '', 'grok numa pasta da VPS precisa vir com aviso, igual ao gemini');
  assert.notEqual(c.motorIndisponivelNaPasta('gemini', 'vps:/opt/x'), '', 'nao pode ter quebrado o aviso do gemini que ja existia');
  assert.equal(c.motorIndisponivelNaPasta('grok', '/Users/homero/projeto'), '', 'fora da VPS o grok continua liberado (quando MOTORES_OK nao diz que falta)');
});

// ---------------------------------------------------------------------------
// R2-002 — restaurarAbas() precisa devolver false quando NENHUMA aba remontou
// ---------------------------------------------------------------------------
test('R2-002: restaurarAbas devolve false quando toda aba salva falha ao remontar', async () => {
  const c = context(['restaurarAbas', 'restaurarAbasCorpo'], {
    abas: new Map(), panes: new Map(), HOME: '/Users/homero',
    abasQueNaoVoltaram: [],
    NA_VPS: (cwd) => String(cwd || '').startsWith('vps:'),
    clienteDe: (cwd) => cwd,
    agruparPorCliente: (gravadas) => gravadas.map((a) => ({ cwd: a.cwd, ativo: a.ativo || 0, chats: a.chats })),
    // as duas funcoes que remontam uma aba: estourando SEMPRE, nenhuma aba salva volta
    novaAbaProjeto: () => { throw new Error('pasta nao existe mais'); },
    newPane: () => { throw new Error('nao deveria chegar aqui'); },
    ativarAbaProjeto: () => {},
    pintarNome: () => {}, mostrarPastaNoPainel: () => {},
    note: () => {}, clearEmpty: () => {}, scroll: () => {}, ico: () => '',
    $: () => null, $$: () => [],
    painelAindaAtual: () => true,
    savePanes: () => { throw new Error('nao pode gravar quando tudo falhou'); },
  });
  c.cfg = { abas: [{ cwd: '/projeto-a', chats: [{ engine: 'claude', cwd: '/projeto-a' }] }], abaAberta: 0 };
  const voltou = await c.restaurarAbas();
  assert.equal(voltou, false, 'com 0 abas remontadas o boot precisa mostrar a tela de nova aba');
});

test('R2-002 (regressao): quando pelo menos uma aba remonta, continua devolvendo true', async () => {
  const c = context(['restaurarAbas', 'restaurarAbasCorpo'], {
    abas: new Map(), panes: new Map(), HOME: '/Users/homero',
    abasQueNaoVoltaram: [],
    NA_VPS: (cwd) => String(cwd || '').startsWith('vps:'),
    clienteDe: (cwd) => cwd,
    agruparPorCliente: (gravadas) => gravadas.map((a) => ({ cwd: a.cwd, ativo: a.ativo || 0, chats: a.chats })),
    novaAbaProjeto: (cwd) => { const A = { id: 'a' + (c.abas.size + 1), cwd, ordem: [], ativo: null }; c.abas.set(A.id, A); return A; },
    newPane: (opts) => { const P = { id: 'p' + (c.panes.size + 1), engine: opts.engine, cwd: opts.cwd, revisaoConversa: 0 }; c.panes.set(P.id, P); opts.aba.ordem.push(P.id); return P; },
    ativarAbaProjeto: () => {},
    pintarNome: () => {}, mostrarPastaNoPainel: () => {},
    note: () => {}, clearEmpty: () => {}, scroll: () => {}, ico: () => '',
    $: () => null, $$: () => [],
    painelAindaAtual: () => true,
    savePanes: () => {},
  });
  c.cfg = { abas: [{ cwd: '/projeto-a', chats: [{ engine: 'claude', cwd: '/projeto-a' }] }], abaAberta: 0 };
  const voltou = await c.restaurarAbas();
  assert.equal(voltou, true);
});

// ---------------------------------------------------------------------------
// R2-001 — o historico de todas as abas busca em PARALELO, uma VPS lenta nao trava as locais
// ---------------------------------------------------------------------------
test('R2-001: restaurarAbasCorpo nao espera a VPS travada pra carregar a aba local', async () => {
  const chamadas = [];
  const vps = deferred();
  const c = context(['restaurarAbasCorpo'], {
    abas: new Map(), panes: new Map(), HOME: '/Users/homero',
    abasQueNaoVoltaram: [], clienteQueEstavaAberto: '', clienteDe: (cwd) => cwd, cfg: { abaAberta: 0 },
    NA_VPS: (cwd) => String(cwd || '').startsWith('vps:'),
    novaAbaProjeto: (cwd) => { const A = { id: 'a' + (c.abas.size + 1), cwd, ordem: [], ativo: null }; c.abas.set(A.id, A); return A; },
    newPane: (opts) => { const P = { id: 'p' + (c.panes.size + 1), engine: opts.engine, cwd: opts.cwd, revisaoConversa: 0 }; c.panes.set(P.id, P); opts.aba.ordem.push(P.id); return P; },
    ativarAbaProjeto: () => {}, pintarNome: () => {}, mostrarPastaNoPainel: () => {},
    note: () => {}, clearEmpty: () => {}, scroll: () => {}, ico: () => '',
    $: () => null, $$: () => [],
    painelAindaAtual: (P, revisao) => c.panes.get(P.id) === P && (P.revisaoConversa || 0) === revisao,
    renderizarHistorico: (P) => chamadas.push('render:' + P.id),
  });
  c.window = {
    api: {
      // a VPS so responde quando o teste mandar (vps.resolve), simulando ela fora do ar
      sessionHistoryRemoto: async () => { chamadas.push('vps-pedido'); return vps.promise; },
      // a local responde na hora
      sessionHistory: async () => { chamadas.push('local-pedido'); return [{ quem: 'Você', texto: 'oi' }]; },
    },
  };
  // ordem de propósito: a aba da VPS vem ANTES da aba local na lista salva
  const salvas = [
    { cwd: 'vps:/opt/adsure', ativo: 0, chats: [{ engine: 'claude', cwd: 'vps:/opt/adsure', sessao: 's-vps', arquivo: 'a.jsonl' }] },
    { cwd: '/Users/homero/projeto', ativo: 0, chats: [{ engine: 'claude', cwd: '/Users/homero/projeto', sessao: 's-local', arquivo: 'b.jsonl' }] },
  ];
  const promessa = c.restaurarAbasCorpo(salvas);
  // deixa a fila de microtasks esvaziar de vez: o suficiente pra promessa da LOCAL (que ja
  // resolveu) terminar de renderizar, sem depender de contar quantos "await" tem no meio
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(chamadas.includes('render:p2'), 'a aba local (p2) devia ter renderizado sem esperar a VPS responder');
  assert.ok(!chamadas.some((x) => x === 'render:p1'), 'a aba da VPS (p1) ainda nao pode ter renderizado: a promessa dela nem resolveu');
  vps.resolve([{ quem: 'Você', texto: 'vps' }]);
  await promessa;
  assert.ok(chamadas.includes('render:p1'), 'depois que a VPS responde, a aba dela tambem renderiza');
});

// ---------------------------------------------------------------------------
// R2-015 — duplo clique na aba da VPS nao pode abrir o seletor de pasta do Mac
// ---------------------------------------------------------------------------
test('R2-015: aba da VPS pede o caminho de la, nao abre o Finder do Mac', async () => {
  let vpsChamada = null;
  const c = context(['trocarPastaDaAba'], {
    NA_VPS: (cwd) => String(cwd || '').startsWith('vps:'),
    pedirCaminhoVpsDaAba: (A) => { vpsChamada = A; },
  });
  let pickChamado = false;
  c.window = { api: { pickFolder: async () => { pickChamado = true; return '/Users/homero/pasta-qualquer'; } } };
  const A = { id: 'a1', cwd: 'vps:/opt/adsure', ordem: ['p1'] };
  await c.trocarPastaDaAba(A);
  assert.equal(pickChamado, false, 'o dialog nativo do Mac nao pode abrir numa aba da VPS');
  assert.equal(vpsChamada, A, 'tinha que pedir o caminho da VPS em vez disso');
  assert.equal(A.cwd, 'vps:/opt/adsure', 'a pasta da aba nao pode mudar sozinha so por causa do duplo clique');
});

test('R2-015 (regressao): aba local continua abrindo o Finder normalmente', async () => {
  let vpsChamada = false;
  const c = context(['trocarPastaDaAba', 'aplicarPastaNaAba'], {
    NA_VPS: (cwd) => String(cwd || '').startsWith('vps:'),
    pedirCaminhoVpsDaAba: () => { vpsChamada = true; },
  });
  let pickChamado = false;
  const A = { id: 'a1', cwd: '/Users/homero/projeto', ordem: [] };
  // devolve a MESMA pasta: aplicarPastaNaAba entra e sai sem precisar de mais stubs (pintarAba etc)
  c.window = { api: { pickFolder: async (cwd) => { pickChamado = true; return cwd; } } };
  await c.trocarPastaDaAba(A);
  assert.equal(pickChamado, true, 'aba local continua usando o seletor de pasta do Mac');
  assert.equal(vpsChamada, false);
});

// ---------------------------------------------------------------------------
// R2-004 — trocar de motor no meio do turno: so troca de verdade depois do motor velho parar
// ---------------------------------------------------------------------------
test('R2-004: P.engine so muda depois que o paneStop confirma, e blocks/tools zeram', async () => {
  const c = context(['trocarMotor'], {
    MOTORES_VISIVEIS: ['claude', 'codex'],
    motorIndisponivelNaPasta: () => '', avisoTemp: () => {},
    confirmarCorte: () => true, vozSoltar: () => {}, nomeDoMotor: (e) => e,
    invalidarConversa: () => {}, marcaTroca: () => {},
    limparPlano: () => {}, limparSugestoes: () => {},
    modeloNovo: () => 'modelo-x', esforcoNovo: () => 'high',
    zerarContexto: () => {}, escondePerm: () => {}, devolverFilaAoCampo: () => {},
    pararTrabalho: () => {}, limparPassos: () => {}, limparContinuar: () => {},
    fillModels: () => {}, paintEngine: () => {}, pintarModo: () => {}, setDot: () => {},
    montarContexto: () => 'CTX', avisarInstalacaoMotor: () => {},
    pintarUso: () => {}, lerUso: () => {}, savePanes: () => {},
    cfg: {}, panes: new Map(),
  });
  const parada = deferred();
  c.window = { api: { paneStop: async () => parada.promise, setConfig: () => {} } };
  const P = {
    id: 'p1', engine: 'codex', cwd: '/Users/homero/projeto', trocando: false,
    mode: 'manual', collaborationMode: 'default', busy: true, hist: [],
    blocks: new Map([['b1', {}]]), tools: new Map([['t1', {}]]),
  };
  c.panes.set(P.id, P);

  const promessa = c.trocarMotor(P, 'claude');
  // ainda esperando o motor velho (Codex) confirmar a parada: nada pode ter trocado ainda
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  assert.equal(P.engine, 'codex', 'enquanto o paneStop nao responde, P.engine continua o de antes — senao um evento atrasado do motor velho e tratado como se fosse do novo');
  assert.equal(P.blocks.size, 1, 'a troca ainda nao terminou: nao pode ter limpado nada');

  parada.resolve();
  await promessa;
  assert.equal(P.engine, 'claude', 'depois que o motor velho confirma que parou, ai sim troca');
  assert.equal(P.blocks.size, 0, 'R2-004: blocks precisa zerar na troca de motor, igual as outras 6 funcoes que resetam a conversa');
  assert.equal(P.tools.size, 0, 'R2-004: tools precisa zerar na troca de motor');
});
