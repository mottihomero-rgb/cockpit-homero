'use strict';
/* Guarda dos 5 defeitos CONFIRMADOS da rodada 3 da auditoria, lote "app" 4 (ver contexto/CONTEXTO.md
   para o padrao): R3-034 (botao "Adicionar no <motor>" sem trava de clique duplo), R3-039 (painel
   "Time de agentes" nao fecha quando o painel dono fecha), R3-038 (tarja de limite trava em 999%
   quando fecha com uma metrica sem dado), R3-004 (contaAcao nao ignora painel da VPS, igual
   trocarParaConta ja ignora) e R3-036 (busca do "@" usava timer/contador GLOBAIS do modulo em vez
   de por painel). Cada funcao e recortada do app.js real (contando chaves) e roda numa VM com so
   os stubs que ela precisa — mesmo padrao de tests/r2-app-3.test.cjs e tests/r1-app-3.test.cjs. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const raiz = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(raiz, 'renderer/app.js'), 'utf8');

// recorta "function nome(...) {...}" (ou "async function nome(...) {...}") contando chaves
function pegar(nome, src = source) {
  const re = new RegExp('^(?:async )?function ' + nome + '\\(', 'm');
  const m = re.exec(src);
  assert.ok(m, 'a funcao ' + nome + ' tem de existir no app.js');
  const start = m.index;
  const abre = src.indexOf('{', start);
  let n = 0, i = abre;
  for (; i < src.length; i++) {
    if (src[i] === '{') n++;
    else if (src[i] === '}' && --n === 0) { i++; break; }
  }
  return src.slice(start, i);
}
function func(nome, extras) { return pegar(nome) + '\nthis.' + nome + ' = ' + nome + (extras || '') + ';'; }

/* ============================================================================================
   R3-034 — "Adicionar no <motor>" (formConector) nao trava contra clique duplo
   ============================================================================================ */

// DOM minimo (sem jsdom): innerHTML materializa os filhos por id="..."/class="...", flat,
// e querySelector procura por "#id" ou ".classe" — suficiente pro formConector real rodar.
function makeElement(tag) {
  const el = {
    tagName: tag, className: '', style: {}, dataset: {}, textContent: '', value: '',
    disabled: false, attrs: {}, children: [],
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
    focus() {}, remove() {},
    querySelector(sel) {
      const bate = (n) => (sel[0] === '#' ? n.attrs.id === sel.slice(1)
        : (n.className || '').split(' ').includes(sel.slice(1)));
      const achar = (n) => { for (const c of n.children) { if (bate(c)) return c; const r = achar(c); if (r) return r; } return null; };
      return achar(this);
    },
  };
  Object.defineProperty(el, 'innerHTML', {
    get() { return el._html || ''; },
    set(html) {
      el._html = html; el.children = [];
      const re = /<(\w+)([^>]*)>/g; let m;
      while ((m = re.exec(html))) {
        const filho = makeElement(m[1]);
        const idM = /\bid="([^"]+)"/.exec(m[2]); if (idM) filho.attrs.id = idM[1];
        const clsM = /\bclass="([^"]+)"/.exec(m[2]); if (clsM) filho.className = clsM[1];
        el.appendChild(filho);
      }
    },
  });
  return el;
}
function contextoFormConector() {
  const ctx = {
    console, setTimeout, ico: () => 'ICON', nomeDoMotor: () => 'Claude',
    $: (s, e) => (e && e.querySelector ? e.querySelector(s) : null),
    fecharModal: () => {}, janelaConectores: () => {},
    confirmarCorte: () => false, agTrabalhando: () => false,
    avisoTemp: () => {}, desligarMotor: async () => {},
    window: { api: {} },
  };
  vm.createContext(ctx);
  vm.runInContext(func('formConector'), ctx);
  return ctx;
}

test('R3-034: "Adicionar no <motor>" trava contra clique duplo, igual o botao "Entrar/Reconectar" da mesma janela', async () => {
  const ctx = contextoFormConector();
  const cx = makeElement('div');
  const P = { id: 'p1', engine: 'claude', busy: false, el: { querySelector: (sel) => (sel === '.p-modal .modal-cx' ? cx : null) } };
  ctx.formConector(P);

  cx.querySelector('#cnNome').value = 'notion';
  cx.querySelector('#cnUrl').value = 'https://mcp.notion.com/mcp';
  const bt = cx.querySelector('#cnOk');
  assert.ok(bt, 'nao achei o botao #cnOk no HTML que formConector monta — mudou de id?');
  assert.ok(bt.onclick, 'o botao #cnOk tem de ter onclick ligado');

  let resolveChamada;
  const chamadas = [];
  ctx.window.api.mcpAcao = (args) => new Promise((res) => { chamadas.push(args); resolveChamada = res; });

  const p1 = bt.onclick();   // 1o clique: comeca a chamada e fica pendurado esperando a resposta
  const p2 = bt.onclick();   // 2o clique, ANTES da resposta voltar — o clique duplo do defeito
  await p2;

  assert.equal(chamadas.length, 1, 'clique duplo mandou mais de um mcpAcao junto — o botao nao travou');
  assert.equal(bt.disabled, true, 'o botao tem de ficar desabilitado enquanto a chamada esta em voo');

  resolveChamada({ error: 'já existe um conector com esse nome' });
  await p1;
  assert.equal(bt.disabled, false, 'depois de um erro o botao tem de destravar, senao ele nunca mais deixa tentar de novo');
  assert.equal(bt.textContent, 'Tentar de novo');
});

/* ============================================================================================
   R3-039 — painel "Time de agentes" tem de fechar junto quando o painel dono fecha
   (closePane: mesma regra que o Quadro branco ja tem; fecharAba: idem pra aba inteira)
   ============================================================================================ */

test('R3-039: closePane fecha o painel de agentes quando o painel fechado e o dono dele, e so nesse caso', () => {
  const start = source.indexOf('async function closePane(id, semPerguntar) {');
  const corte = source.indexOf('// fechar o chat tem de apagar a luz do microfone', start);
  assert.ok(start >= 0 && corte > start, 'nao achei mais a guarda de closePane — mudou de lugar?');
  const guardaSrc = source.slice(start, corte) + '\n  return "seguiu";\n}';

  function rodar({ painelFechado, agAtual }) {
    const chamadas = [];
    const ctx = vm.createContext({
      panes: new Map([[painelFechado.id, painelFechado]]),
      window: { Quadro: null },
      agPaneAberto: agAtual,
      fecharPainelAgentes: () => chamadas.push(true),
      agTrabalhando: () => false,
      nomeDoMotor: () => 'Claude',
      confirm: () => true,
    });
    vm.runInContext(guardaSrc, ctx);
    vm.runInContext('closePane', ctx)(painelFechado.id, true);
    return chamadas.length;
  }

  const painelA = { id: 'A', busy: false, engine: 'claude', titulo: 'A' };
  const painelB = { id: 'B', busy: false, engine: 'claude', titulo: 'B' };

  assert.equal(rodar({ painelFechado: painelA, agAtual: painelA }), 1,
    'fechar o painel DONO do painel de agentes tem de fecha-lo junto, senao ele fica mostrando um chat que ja nao existe');
  assert.equal(rodar({ painelFechado: painelB, agAtual: painelA }), 0,
    'fechar um painel que NAO e o dono nao pode mexer no painel de agentes de outro chat');
});

test('R3-039: fecharAba fecha o painel de agentes de um chat dela antes de remover os paineis', async () => {
  const el = () => ({ remove() {} });
  const ctx = {
    console, panes: new Map(), abas: new Map(), abaAtiva: null, focusPane: null,
    confirm: () => true, agTrabalhando: () => false,
    vozSoltar: () => {}, guardarFechado: () => {}, marcarAbertas: () => {},
    telaNovaAba: () => {}, ativarAbaProjeto: () => {}, savePanes: () => {},
    window: { api: { paneStop: async () => ({}) }, Quadro: null },
  };
  vm.createContext(ctx);
  vm.runInContext(func('fecharAba'), ctx);

  const alvo = { id: 'p1', el: el(), busy: false };
  const outro = { id: 'p2', el: el(), busy: false };
  ctx.panes.set(alvo.id, alvo); ctx.panes.set(outro.id, outro);
  const A = { id: 'a1', ordem: [alvo.id, outro.id], el: el(), corpoEl: el() };
  ctx.abas.set(A.id, A);
  ctx.agPaneAberto = alvo;
  let fechado = 0;
  ctx.fecharPainelAgentes = () => { fechado++; ctx.agPaneAberto = null; };

  await ctx.fecharAba(A);

  assert.equal(fechado, 1,
    'a aba tinha um painel dono do "Time de agentes" — fechar a aba inteira tem de fechar esse painel junto');
});

/* ============================================================================================
   R3-038 — tarja de limite: fechar com uma metrica ainda sem dado nao pode travar a baseline
   em 999% pra sempre (senao aquela metrica nunca mais avisa quando cruzar o limite de verdade)
   ============================================================================================ */

function novoElemento() {
  const el = { className: '', textContent: '', innerHTML: '', style: {}, dataset: {}, title: '', children: [] };
  const set = new Set();
  el.classList = { add: (...xs) => xs.forEach(x => set.add(x)), remove: (...xs) => xs.forEach(x => set.delete(x)), contains: x => set.has(x) };
  el.appendChild = function (x) { this.children.push(x); return x; };
  return el;
}
function contextoUso() {
  const faixa = novoElemento(), campo = novoElemento();
  const ctx = {
    console, USO: { claude: null }, USO_FECHADO: { claude: null }, panes: new Map(),
    USO_AVISO_SESSAO: 90, USO_AVISO_SEMANA: 50, USO_DENOVO: 5,
    $: (sel) => (sel === '.p-uso' ? faixa : (sel === '.p-limite' ? campo : novoElemento())),
    nomeDoMotor: () => 'Claude', quandoFuturo: () => 'amanha', haQuanto: () => '3h',
  };
  vm.createContext(ctx);
  const usoPctSrc = source.split('\n').find((l) => l.startsWith('const usoPct = '));
  assert.ok(usoPctSrc, 'usoPct existe');
  vm.runInContext(
    usoPctSrc + '\n' + pegar('esconderUso') + '\n' + pegar('pintarLimiteMini') + '\n'
    + pegar('pintarUso') + '\n' + pegar('fecharUso')
    + '\nthis.pintarUso = pintarUso; this.fecharUso = fecharUso;',
    ctx);
  return { ctx, faixa };
}
const aberta = (faixa) => /(^| )aviso( |$)/.test(faixa.className);

test('R3-038: fechou com a SEMANA sem dado (baseline null) — semana cruzar o limite de verdade depois tem de reabrir a tarja', () => {
  const { ctx, faixa } = contextoUso();
  const P = { id: 'p1', engine: 'claude', el: {} };
  ctx.panes.set(P.id, P);

  ctx.USO.claude = { sessao: { pct: 92 }, semana: null };   // abriu pela sessao; semana ainda sem leitura
  ctx.pintarUso(P);
  assert.ok(aberta(faixa), 'tinha de abrir: sessao 92% >= 90%');
  ctx.fecharUso(P);
  assert.equal(ctx.USO_FECHADO.claude.semana, null, 'baseline da semana tem de ficar null, nao 999 — 999 trava pra sempre');
  assert.ok(!aberta(faixa), 'fechou: tem de sumir');

  // sessao esfria (nao dispara mais); semana chega de verdade e cruza o limite (50%) — aviso NOVO e legitimo
  ctx.USO.claude = { sessao: { pct: 10 }, semana: { pct: 55 } };
  ctx.pintarUso(P);
  assert.ok(aberta(faixa), 'a semana passou de 50% de verdade depois de fechado: a tarja tinha de reaparecer, e com o defeito ela ficava escondida pra sempre');
});

test('R3-038: fechou com a SESSAO sem dado (baseline null) — sessao cruzar o limite de verdade depois tem de reabrir a tarja', () => {
  const { ctx, faixa } = contextoUso();
  const P = { id: 'p1', engine: 'claude', el: {} };
  ctx.panes.set(P.id, P);

  ctx.USO.claude = { sessao: null, semana: { pct: 55 } };   // abriu pela semana; sessao ainda sem leitura
  ctx.pintarUso(P);
  assert.ok(aberta(faixa));
  ctx.fecharUso(P);
  assert.equal(ctx.USO_FECHADO.claude.sessao, null);
  assert.ok(!aberta(faixa));

  ctx.USO.claude = { sessao: { pct: 95 }, semana: { pct: 20 } };
  ctx.pintarUso(P);
  assert.ok(aberta(faixa), 'a sessao passou de 90% de verdade depois de fechado: tinha de reaparecer');
});

test('R3-038: baseline com numero de verdade continua exigindo crescer USO_DENOVO pontos (nao fica chato reabrindo a toa)', () => {
  const { ctx, faixa } = contextoUso();
  const P = { id: 'p1', engine: 'claude', el: {} };
  ctx.panes.set(P.id, P);

  ctx.USO.claude = { sessao: { pct: 92 }, semana: { pct: 10 } };
  ctx.pintarUso(P);
  ctx.fecharUso(P);
  // objeto veio de dentro da vm (outro realm): JSON tira a diferenca de prototipo antes de comparar
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.USO_FECHADO.claude)), { sessao: 92, semana: 10 });

  ctx.USO.claude = { sessao: { pct: 93 }, semana: { pct: 10 } };   // cresceu so 1 ponto, abaixo do USO_DENOVO=5
  ctx.pintarUso(P);
  assert.ok(!aberta(faixa), 'cresceu so 1 ponto (< USO_DENOVO): nao pode reaparecer, senao vira chato');
});

/* ============================================================================================
   R3-004 — contaAcao (login normal) tem de ignorar painel da VPS, igual trocarParaConta ja faz
   ============================================================================================ */

function contextoContaAcao() {
  const ctx = {
    console, panes: new Map(), window: { api: {} },
    agTrabalhando: () => false, nomeDoMotor: () => 'Codex',
    NA_VPS: (cwd) => /^vps:/i.test(String(cwd || '')),
    document: { body: { classList: { remove: () => {} } } },
  };
  vm.createContext(ctx);
  ctx.window.api.auth = async ({ acao }) => (acao === 'status'
    ? { texto: 'dentro: contab@exemplo.com' }
    : { terminal: 'codex login', titulo: 'Conta', confereDepois: true });
  ctx.lerStatusConta = () => ({ dentro: true, quem: 'contab@exemplo.com' });
  // contaAcao nao da await em janelaTerminal (so devolve quando o terminal fecha de verdade):
  // guarda a promise do callback pra o teste esperar por fora
  ctx.janelaTerminal = (P, term, titulo, cb) => { ctx._cbDone = cb(); };
  ctx.note = () => {};
  const avisos = [];
  ctx.avisoTemp = (P, t) => avisos.push(t);
  ctx.contaCache = { codex: {} }; ctx.USO_FECHADO = { codex: null };
  ctx.pintarContaLateral = () => {}; ctx.lerUso = () => {};
  vm.runInContext(func('contaAcao'), ctx);
  return { ctx, avisos };
}

test('R3-004: contaAcao (login normal / "Entrar") nao conta nem desliga painel da VPS ao trocar a conta local', async () => {
  const { ctx } = contextoContaAcao();
  let confirmMsg = '';
  ctx.confirm = (msg) => { confirmMsg = msg; return true; };
  const desligados = [];
  ctx.desligarMotor = async (q) => { desligados.push(q.id); };
  ctx.window.api.codexReiniciar = async () => {};
  const local = { id: 'local', engine: 'codex', cwd: '/projeto', busy: true, titulo: 'tarefa local' };
  const naVps = { id: 'vps', engine: 'codex', cwd: 'vps:/opt/adsure', busy: true, titulo: 'agente remoto na vps' };
  ctx.panes.set(local.id, local); ctx.panes.set(naVps.id, naVps);

  await ctx.contaAcao(local, 'entrar', 'codex');
  await ctx._cbDone;

  assert.match(confirmMsg, /tarefa local/, 'o aviso de "chat trabalhando" tem de falar so do chat local');
  assert.doesNotMatch(confirmMsg, /2 chats/, 'nao pode contar o painel da VPS junto — a conta de la e outra, controlada pelo servidor de la');
  assert.ok(desligados.includes('local'), 'o painel local ocupado tem de ser desligado (login normal, troca de verdade)');
  assert.ok(!desligados.includes('vps'), 'o painel da VPS NUNCA pode ser desligado por uma troca de conta local');
});

test('R3-004: contaAcao com SO painel da VPS ocupado nao pergunta nada (nao ha chat local pra cortar)', async () => {
  const { ctx } = contextoContaAcao();
  ctx.confirm = () => { throw new Error('nao devia perguntar — so tem painel da VPS ocupado'); };
  const desligados = [];
  ctx.desligarMotor = async (q) => { desligados.push(q.id); };
  ctx.window.api.codexReiniciar = async () => {};
  const naVps = { id: 'vps', engine: 'codex', cwd: 'vps:/opt/adsure', busy: true, titulo: 'agente remoto na vps' };
  ctx.panes.set(naVps.id, naVps);

  await ctx.contaAcao(naVps, 'entrar', 'codex');
  await ctx._cbDone;

  assert.equal(desligados.length, 0, 'nada local pra desligar');
});

/* ============================================================================================
   R3-036 — busca do "@" e por PAINEL: timer/contador nao podem ser globais do modulo
   ============================================================================================ */

function contextoBusca() {
  const chamadas = [];
  const ctx = {
    console, NA_VPS: () => false,
    pastaDoWorktree: (P) => P.cwd,
    janelinhaOcupada: () => false,
    menuDeArquivosNaTela: () => false,
    arrobaAindaNoCampo: () => true,
    recadoDeArquivos: () => {},
    fecharMenus: () => {},
    window: { api: { buscarArquivos: async (args) => { chamadas.push(args); return []; } } },
  };
  const timers = [];
  ctx.setTimeout = (fn) => { const t = { fn }; timers.push(t); return t; };
  ctx.clearTimeout = (t) => { const i = timers.indexOf(t); if (i !== -1) timers.splice(i, 1); };
  vm.createContext(ctx);
  vm.runInContext(
    func('pararBuscaEmVoo') + '\n' + func('pararBuscaDeArquivos') + '\n' + func('menuArquivos'),
    ctx);
  return { ctx, chamadas, timers };
}

test('R3-036: fechar/mandar mensagem em OUTRO painel nao pode cancelar a busca de arquivo em andamento deste painel', async () => {
  const { ctx, chamadas, timers } = contextoBusca();
  const A = { id: 'A', cwd: '/projeto-a', el: { isConnected: true } };
  const B = { id: 'B', cwd: '/projeto-b', el: { isConnected: true } };

  ctx.menuArquivos(A, 'relat');           // digitou "@relat" no painel A
  assert.equal(timers.length, 1, 'tinha de nascer um timer pra busca do painel A');

  ctx.pararBuscaDeArquivos(B);            // fechou (ou mandou mensagem n)o painel B — OUTRO painel

  assert.equal(timers.length, 1,
    'o timer da busca de A nao podia ter sido cancelado so porque B fechou/mandou mensagem — com o defeito, timer e contador eram globais do modulo');

  await timers[0].fn();                   // o relogio da busca de A acorda

  assert.equal(chamadas.length, 1, 'a busca do painel A tinha de rodar ate pedir os arquivos de verdade');
  assert.equal(chamadas[0].cwd, '/projeto-a', 'a busca tem de pedir os arquivos da pasta do painel A, nao do B');
});

test('R3-036: o proprio painel cancelando a busca (apagou o "@") continua funcionando normalmente', async () => {
  const { ctx, chamadas, timers } = contextoBusca();
  const A = { id: 'A', cwd: '/projeto-a', el: { isConnected: true } };

  ctx.menuArquivos(A, 'relat');
  assert.equal(timers.length, 1);
  ctx.pararBuscaDeArquivos(A);            // o MESMO painel cancelou (apagou o "@")
  assert.equal(timers.length, 0, 'cancelar a busca do proprio painel tem de derrubar o timer dele');
});
