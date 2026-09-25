'use strict';
// Teste de guarda da faixa "app" (lote 1), rodada 3 da auditoria de 25/09.
// Cobre: R3-051 (motor padrao no 1o boot), R3-011 (fechar aba fecha o Quadro do painel dono),
// R3-027 (arrastar chat ocupado pergunta antes de trocar de pasta), R3-028 (arrastar gemini/grok
// pra aba da VPS e bloqueado) e R3-015 (aba que quebra no meio da restauracao nao duplica).
// Mesmo padrao de tests/auditoria-renderer-20260921.test.cjs e tests/r2-app-1.test.cjs: extrai a
// funcao do arquivo real por regex e roda em vm com stubs das dependencias.
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

// motorVisivel nao e "function nome(", e uma const de uma linha so
function constLine(nome, src = source) {
  const re = new RegExp('^const ' + nome + ' =.*$', 'm');
  const match = re.exec(src);
  assert.ok(match, nome + ' existe em renderer/app.js');
  return match[0];
}

function context(names, extras = {}) {
  const c = { console, Map, Set, Promise, Array, Math, String, Number, JSON, crypto: { randomUUID: () => 'uuid-teste' } };
  Object.assign(c, extras);
  vm.createContext(c);
  vm.runInContext(names.map((n) => func(n)).join('\n'), c);
  return c;
}

// ---------------------------------------------------------------------------
// R3-051 — sem motor salvo (1o boot / config resetado), o padrao tem que ser Claude
// ---------------------------------------------------------------------------
test('R3-051: motorVisivel cai em claude (nao codex) quando nao ha motor salvo', () => {
  const c = context([], { MOTORES_VISIVEIS: ['claude', 'codex', 'gemini', 'grok'] });
  // "const" no topo do vm nao vira propriedade do contexto (fica so na lexical env); "var" vira.
  vm.runInContext(constLine('motorVisivel').replace(/^const /, 'var '), c);
  assert.equal(c.motorVisivel(undefined), 'claude', '1o boot (cfg.lastEngine nunca gravado) tem que abrir no Claude');
  assert.equal(c.motorVisivel('lixo'), 'claude', 'valor invalido tambem cai em claude, nao em codex');
  assert.equal(c.motorVisivel('codex'), 'codex', 'motor ja escolhido antes continua passando direto');
  assert.equal(c.motorVisivel('gemini'), 'gemini', 'motor valido continua passando direto');
});

// ---------------------------------------------------------------------------
// R3-011 — fechar a ABA inteira tem que fechar o Quadro branco do painel dono
// ---------------------------------------------------------------------------
test('R3-011: fecharAba fecha o Quadro do painel dono antes de remover os paineis', async () => {
  const el = () => ({ remove() {} });
  const c = context(['fecharAba'], {
    panes: new Map(), abas: new Map(), abaAtiva: null, focusPane: null,
    confirm: () => true, agTrabalhando: () => false,
    vozSoltar: () => {}, guardarFechado: () => {}, marcarAbertas: () => {},
    telaNovaAba: () => {}, ativarAbaProjeto: () => {}, savePanes: () => {},
    // R3-039 (outro defeito da mesma rodada) fez fecharAba checar tambem o painel de agentes,
    // igual ja fazia com o Quadro; sem estes dois globais o teste quebrava so por faltar o stub
    agPaneAberto: null, fecharPainelAgentes: () => {},
  });
  c.window = { api: { paneStop: async () => ({}) }, Quadro: null };
  const alvo = { id: 'p1', el: el(), busy: false };
  const outro = { id: 'p2', el: el(), busy: false };
  c.panes.set(alvo.id, alvo); c.panes.set(outro.id, outro);
  const A = { id: 'a1', ordem: [alvo.id, outro.id], el: el(), corpoEl: el() };
  c.abas.set(A.id, A);
  let quadroFechado = false;
  c.window.Quadro = { aberto: () => true, donoEh: (P) => P === alvo, fechar: () => { quadroFechado = true; } };
  await c.fecharAba(A);
  assert.equal(quadroFechado, true, 'fechar a aba inteira precisa fechar o Quadro de um painel dela, senao ele fica desenhando por cima de um painel morto');
});

// ---------------------------------------------------------------------------
// R3-027 — arrastar chat OCUPADO pra outra pasta pergunta antes de matar o trabalho
// ---------------------------------------------------------------------------
test('R3-027: moverPane pergunta antes de matar chat ocupado ao mudar de pasta arrastando, e recusar mantem tudo', () => {
  const avisos = [];
  const c = context(['abaDe', 'confirmarCorte', 'agTrabalhando', 'moverPane'], {
    abas: new Map(), panes: new Map(),
    motorIndisponivelNaPasta: () => '',   // pasta liberada pro motor: so falta a pergunta de corte
    avisoTemp: (P, t) => avisos.push(t),
    nomeDoMotor: (e) => e,
    confirm: () => false,                 // ele clica em "nao"
  });
  const antiga = { id: 'a1', cwd: '/projeto-x', ordem: ['p1'], ativo: 'p1' };
  const destino = { id: 'a2', cwd: '/projeto-y', ordem: [] };
  c.abas.set(antiga.id, antiga); c.abas.set(destino.id, destino);
  let paneStopChamado = false;
  c.window = { api: { paneStop: async () => { paneStopChamado = true; return {}; } } };
  const P = { id: 'p1', aid: antiga.id, cwd: '/projeto-x', engine: 'claude', busy: true, titulo: 'Trabalho' };
  c.panes.set(P.id, P);
  c.moverPane(P, destino, null);
  assert.equal(paneStopChamado, false, 'recusou a pergunta: o motor nao pode ser derrubado');
  assert.equal(P.cwd, '/projeto-x', 'a pasta do chat nao pode mudar se ele recusou');
  assert.deepEqual(antiga.ordem, ['p1'], 'o painel tem que continuar na aba de origem');
  assert.equal(destino.ordem.length, 0, 'nao pode ter entrado na aba de destino');
});

// ---------------------------------------------------------------------------
// R3-028 — arrastar gemini/grok pra aba ja na VPS e bloqueado, igual ao trocarMotor (R2-016)
// ---------------------------------------------------------------------------
test('R3-028: moverPane bloqueia gemini indo pra aba da VPS (arrasta-e-solta)', () => {
  const avisos = [];
  const c = context(['abaDe', 'confirmarCorte', 'agTrabalhando', 'moverPane'], {
    abas: new Map(), panes: new Map(),
    motorIndisponivelNaPasta: (engine, cwd) => (engine === 'gemini' && String(cwd).startsWith('vps:')) ? 'Gemini não está disponível na VPS.' : '',
    avisoTemp: (P, t) => avisos.push(t),
    nomeDoMotor: (e) => e,
    confirm: () => true,   // nem deveria chegar a perguntar: o bloqueio vem antes
  });
  const antiga = { id: 'a1', cwd: '/projeto-x', ordem: ['p1'], ativo: 'p1' };
  const destinoVps = { id: 'a2', cwd: 'vps:/projeto-y', ordem: ['p2'] };
  c.abas.set(antiga.id, antiga); c.abas.set(destinoVps.id, destinoVps);
  let paneStopChamado = false;
  c.window = { api: { paneStop: async () => { paneStopChamado = true; return {}; } } };
  const P = { id: 'p1', aid: antiga.id, cwd: '/projeto-x', engine: 'gemini', busy: false };
  c.panes.set(P.id, P);
  c.moverPane(P, destinoVps, null);
  assert.equal(paneStopChamado, false, 'gemini nao roda na VPS: nao pode matar o motor pra mover mesmo assim');
  assert.equal(P.cwd, '/projeto-x', 'a pasta nao pode mudar');
  assert.deepEqual(antiga.ordem, ['p1'], 'o painel tem que continuar na aba de origem, nao ficar listado na errada com o cwd velho');
  assert.deepEqual(destinoVps.ordem, ['p2'], 'a aba de destino nao pode ganhar o painel bloqueado');
  assert.ok(avisos.length > 0, 'tem que avisar por que nao moveu');
});

// ---------------------------------------------------------------------------
// R3-015 — aba que quebra no meio da restauracao nao pode ficar duplicada nem viva pela metade
// ---------------------------------------------------------------------------
test('R3-015: aba que quebra no 2o chat e desfeita (nao fica duplicada nem viva pela metade)', async () => {
  const c = context(['restaurarAbasCorpo', 'removerAbaVazia'], {
    abas: new Map(), panes: new Map(), HOME: '/Users/homero',
    abasQueNaoVoltaram: [], clienteQueEstavaAberto: '', clienteDe: (cwd) => cwd, cfg: { abaAberta: 0 },
    NA_VPS: (cwd) => String(cwd || '').startsWith('vps:'),
    novaAbaProjeto: (cwd) => {
      const A = { id: 'a' + (c.abas.size + 1), cwd, ordem: [], ativo: null, el: { remove() {} }, corpoEl: { remove() {} } };
      c.abas.set(A.id, A); return A;
    },
    newPane: (opts) => {
      const P = { id: 'p' + (c.panes.size + 1), aid: opts.aba.id, engine: opts.engine, cwd: opts.cwd, revisaoConversa: 0, el: { remove() {} } };
      c.panes.set(P.id, P);   // igual ao app.js real: panes.set() acontece ANTES do resto do newPane
      if (opts.cwd === '/excelencia/quebra') throw new TypeError('dado ilegivel do 2o chat');
      opts.aba.ordem.push(P.id);
      return P;
    },
    ativarAbaProjeto: () => {}, pintarNome: () => {}, mostrarPastaNoPainel: () => {},
    note: () => {}, clearEmpty: () => {}, scroll: () => {}, ico: () => '',
    $: () => null, $$: () => [], painelAindaAtual: () => true,
  });
  c.abaAtiva = null;
  const salvas = [
    { cwd: '/excelencia', ativo: 0, chats: [
      { engine: 'claude', cwd: '/excelencia' },
      { engine: 'claude', cwd: '/excelencia/quebra' },
    ] },
    { cwd: '/rapha', ativo: 0, chats: [{ engine: 'claude', cwd: '/rapha' }] },
  ];
  const remontadas = await c.restaurarAbasCorpo(salvas);
  assert.equal(remontadas, 1, 'so a aba do Rapha remontou de verdade');
  assert.equal(c.abas.size, 1, 'a aba da Excelencia quebrada nao pode sobrar viva pela metade (ela duplicaria no proximo config.json)');
  assert.equal([...c.abas.values()][0].cwd, '/rapha');
  assert.equal(c.panes.size, 1, 'nenhum painel orfao da aba desfeita pode sobrar em panes');
});
