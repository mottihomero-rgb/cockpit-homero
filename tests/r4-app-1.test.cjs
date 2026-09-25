'use strict';
// Testes de guarda da rodada 4, lote "app" 1 (renderer/app.js).
// Segue o padrao de tests/auditoria-renderer-20260921.test.cjs: extrai a funcao do
// arquivo real por regex e roda isolada numa VM com as dependencias stubadas.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../renderer/app.js'), 'utf8');

function func(nome, src = source) {
  const re = new RegExp('^(?:async )?function ' + nome + '\\(', 'm');
  const match = re.exec(src);
  assert.ok(match, nome + ' existe');
  const start = match.index;
  const line = src.slice(start, src.indexOf('\n', start));
  if (line.endsWith('}')) return line;
  return src.slice(start, src.indexOf('\n}', start) + 2);
}

function run(names, extras = {}) {
  const c = { console, Map, Set, ...extras };
  vm.createContext(c);
  vm.runInContext(names.map(n => func(n)).join('\n\n'), c);
  return c;
}

// ---- R4-007: closePane nao pode fechar Quadro/painel de agentes ANTES do confirm ----
test('R4-007: cancelar o confirm de "esta trabalhando" nao fecha o Quadro nem o painel de agentes', async () => {
  const chamadas = [];
  const P = { id: 'p1', busy: true, titulo: 'chat ocupado' };
  const c = run(['closePane'], {
    panes: new Map([['p1', P]]),
    agTrabalhando: () => false,
    nomeDoMotor: () => 'Codex',
    confirm: () => { chamadas.push('confirm'); return false; },   // ele clicou "Cancelar"
    window: {
      Quadro: {
        aberto: () => true,
        donoEh: (p) => p === P,
        fechar: () => chamadas.push('quadro-fechou'),
      },
    },
    agPaneAberto: P,
    fecharPainelAgentes: () => chamadas.push('agentes-fechou'),
  });

  await c.closePane('p1');

  // cancelou: nada pode ter sido fechado, nem o confirm pode ter sido pulado
  assert.deepEqual(chamadas, ['confirm']);
});

// ---- R4-005: contexto da 1a tentativa nao pode jogar fora o conteudo real ----
test('R4-005: primeira-tentativa com conteudo real leva o conteudo junto, nao so o aviso', () => {
  const c = run(['montarContexto', 'montarEnvio'], {});
  const P = { hist: [{ quem: 'Você', texto: 'Aqui está o código inteiro do projeto X que preciso que você conserte: xyz' }] };
  const resultado = c.montarContexto(P, true, 'primeira-tentativa');
  assert.ok(resultado.includes('conserte'), 'o texto da 1a mensagem tem que estar no contexto enviado');
  assert.ok(resultado.startsWith('A primeira tentativa não chegou a começar.'));
});

test('R4-005: primeira-tentativa sem historico nenhum continua so o aviso curto (sem marcador vazio)', () => {
  const c = run(['montarContexto', 'montarEnvio'], {});
  const P = { hist: [] };
  const resultado = c.montarContexto(P, true, 'primeira-tentativa');
  assert.equal(resultado, 'A primeira tentativa não chegou a começar. Mandando de novo.\n\n');
  assert.ok(!resultado.includes('---'));
});

// ---- R4-008: reabrir o ultimo fechado depois de aba sumir nao pode pousar em aba de outro projeto ----
test('R4-008: aba fechada nao existe mais -> reabre numa aba do PROJETO certo, nao na aba ativa de outro', async () => {
  const chamadas = [];
  const abas = new Map();   // a aba antiga (f.aid) ja nao existe mais aqui
  const abaDeOutroProjeto = { id: 'outra', cwd: '/outro-projeto' };
  const abaCerta = { id: 'nova-do-projeto', cwd: '/projeto-certo' };
  let paneCriado = null;

  // clienteDe/abaDoCaminho de verdade (reabrir usa a mesma regra do openSession)
  const c = run(['guardarFechado', 'reabrirUltimoFechado', 'clienteDe', 'abaDoCaminho'], {
    PROJETOS: () => '/proj',
    dentroDe: (cwd, raiz) => cwd === raiz || String(cwd).startsWith(raiz + '/'),
    fechadosRecentes: [],
    abas,
    abaAtiva: abaDeOutroProjeto,   // o que estiver na tela agora e' de OUTRO projeto
    NA_VPS: () => false,
    avisoTemp: () => {},
    focusPane: null,
    novaAbaProjeto: (cwd) => { chamadas.push('novaAbaProjeto:' + cwd); return abaCerta; },
    ativarAbaProjeto: (A) => chamadas.push('ativarAbaProjeto:' + A.id),
    newPane: (opts) => { paneCriado = opts; chamadas.push('newPane'); return { id: 'pNovo' }; },
    setFocus: () => chamadas.push('setFocus'),
    openSession: async () => null,
  });

  // painel com historico real, sem resumeId (trocou de motor no meio, como no achado)
  const P = { engine: 'codex', cwd: '/projeto-certo', titulo: 'Chat trocado de motor',
    aid: 'aba-que-vai-fechar', sessaoId: null, resumeId: null, hist: [{ quem: 'Você', texto: 'oi' }] };
  c.guardarFechado(P);
  assert.equal(c.fechadosRecentes.length, 1, 'guardarFechado precisa guardar mesmo sem resumeId, pois hist tem conteudo');

  // a aba "aba-que-vai-fechar" foi removida do Map (fecharAba/closePane ja rodou)
  await c.reabrirUltimoFechado();

  assert.ok(chamadas.includes('novaAbaProjeto:/projeto-certo'), 'tem que criar aba no cwd do chat fechado, nao usar a aba ativa');
  assert.ok(chamadas.indexOf('ativarAbaProjeto:nova-do-projeto') < chamadas.indexOf('newPane'), 'tem que ativar a aba ANTES de criar o painel nela');
  assert.equal(paneCriado.cwd, '/projeto-certo');
});

// ---- ajuste do orquestrador (25/09): reabrir reaproveita a aba do CLIENTE que ja esta aberta ----
test('reabrir o ultimo fechado entra na aba do cliente que ja existe, em vez de abrir uma segunda aba da mesma pasta', async () => {
  const chamadas = [];
  const abaDoCliente = { id: 'aba-pedro', cwd: '/proj/Pedro' };
  const abas = new Map([['aba-pedro', abaDoCliente]]);
  let paneCriado = null;
  const c = run(['guardarFechado', 'reabrirUltimoFechado', 'clienteDe', 'abaDoCaminho'], {
    PROJETOS: () => '/proj',
    dentroDe: (cwd, raiz) => cwd === raiz || String(cwd).startsWith(raiz + '/'),
    fechadosRecentes: [], abas, abaAtiva: { id: 'outra', cwd: '/proj/Adsure' },
    NA_VPS: () => false, avisoTemp: () => {}, focusPane: null,
    novaAbaProjeto: (cwd) => { chamadas.push('novaAbaProjeto:' + cwd); return { id: 'duplicada', cwd }; },
    ativarAbaProjeto: (A) => chamadas.push('ativarAbaProjeto:' + A.id),
    newPane: (opts) => { paneCriado = opts; chamadas.push('newPane'); return { id: 'pNovo' }; },
    setFocus: () => {}, openSession: async () => null,
  });
  // o chat fechado morava numa subpasta do cliente e a aba original dele ja foi fechada
  c.guardarFechado({ engine: 'claude', cwd: '/proj/Pedro/2026-09-25_demanda', titulo: 'Demanda',
    aid: 'aba-fechada', sessaoId: null, resumeId: null, hist: [{ quem: 'Você', texto: 'oi' }] });
  await c.reabrirUltimoFechado();
  assert.ok(!chamadas.some(x => x.startsWith('novaAbaProjeto')), 'nao pode criar segunda aba do mesmo cliente');
  assert.ok(chamadas.indexOf('ativarAbaProjeto:aba-pedro') >= 0 && chamadas.indexOf('ativarAbaProjeto:aba-pedro') < chamadas.indexOf('newPane'));
  assert.equal(paneCriado.aba, abaDoCliente);
  assert.equal(paneCriado.cwd, '/proj/Pedro/2026-09-25_demanda');
});

// ---- ajuste do orquestrador (25/09): tela "Nova aba" sem frase explicativa ----
test('Nova aba: sem motivo de bloqueio, a linha de dica fica vazia e a explicacao vira dica do botao', () => {
  const html = fs.readFileSync(path.join(__dirname, '../renderer/index.html'), 'utf8');
  const htmlWeb = fs.readFileSync(path.join(__dirname, '../renderer/index-web.html'), 'utf8');
  assert.match(html, /<p class="na-dica" id="naDica"><\/p>/, 'Mac: nasce vazia');
  assert.match(htmlWeb, /<p class="na-dica" id="naDica"><\/p>/, 'iPhone: nasce vazia');
  const corpo = func('naPintar');
  assert.match(corpo, /\$\('#naDica'\)\.textContent = motivo \|\| '';/, 'na tela so o motivo');
  assert.match(corpo, /\$\('#naOk'\)\.title = /, 'a explicacao vai para o title do Começar');
  const css = fs.readFileSync(path.join(__dirname, '../renderer/style.css'), 'utf8');
  assert.match(css, /\.na-dica:empty\{display:none\}/);
});
