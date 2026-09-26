'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(process.env.COCKPIT_RENDERER_SOURCE || path.join(__dirname, '../renderer/app.js'), 'utf8');
const mobile = fs.readFileSync(path.join(__dirname, '../renderer/mobile.js'), 'utf8');
function func(nome, src = source) {
  const re = new RegExp('^(?:async )?function ' + nome + '\\(', 'm');
  const match = re.exec(src);
  assert.ok(match, nome + ' existe');
  const start = match.index;
  const line = src.slice(start, src.indexOf('\n', start));
  if (line.endsWith('}')) return line;
  return src.slice(start, src.indexOf('\n}', start) + 2);
}
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
function classes(...initial) { const set = new Set(initial); return { add: (...xs) => xs.forEach(x => set.add(x)), remove: (...xs) => xs.forEach(x => set.delete(x)), contains: x => set.has(x), toggle: (x, yes) => yes ? set.add(x) : set.delete(x) }; }
function element() { return { style: {}, classList: classes(), dataset: {}, value: '', innerHTML: '', textContent: '', children: [],
  appendChild(x) { this.children.push(x); return x; }, replaceChildren(...xs) { this.children = xs; },
  dispatchEvent() {}, focus() { this.focused = true; }, querySelectorAll() { return []; } }; }
function context(names, extras = {}) {
  const noop = () => {};
  const c = { console, Map, Set, Date, Event, queueMicrotask, timers: [], sent: [], notices: [], panes: new Map(),
    cfg: {}, VIVO: {}, DITADO: {}, motoresTrocandoConta: new Set(), ENTRA_MSG: 'ENTRA:', ULTRACODE_MSG: 'ULTRA:',
    $: (s, e) => e && e.nodes && e.nodes[s] || null,
    $$: (s, e) => e && e.groups && e.groups[s] || [],
    setTimeout(fn, ms) { const t = { fn, ms }; c.timers.push(t); return t; },
    clearTimeout(t) { c.timers = c.timers.filter(x => x !== t); },
    window: { dispatchEvent: noop, api: {} },
    ico: () => 'icone', nomeDoMotor: e => e, modoDe: () => ({ id: 'manual' }), esforcoDe: () => 'high',
    NA_VPS: cwd => String(cwd).startsWith('vps:'),
    modeloSemOrigem: x => x, modeloPorCreditos: () => false, mensagensDele: () => [],
    nomeDaConversa: () => 'Conversa', montarContexto: () => 'CONTEXTO:',
    note: (P, t) => c.notices.push(t), avisoTemp: (P, t) => c.notices.push(t), avisoEnvio: () => element(),
    document: { createElement: element, querySelectorAll: () => [], body: { classList: classes() } },
    // 25/09 (conversa costurada): sem ligacao nenhuma, a cadeia de uma conversa e ela mesma
    MOTORES: ['claude', 'codex', 'acp', 'gemini', 'grok'], partesDaCadeia: s => [s], refDaParte: p => p,
  };
  for (const name of ['pintarAnexos', 'limparSugestoes', 'vozSoltar', 'pararBuscaDeArquivos', 'soltarNavArquivos',
    'guardarPrompt', 'prepararEscolhasEnvio', 'concluirEscolhasEnvio', 'setDot', 'pintarNome', 'nomearCurto',
    'pararTrabalho', 'limparPassos', 'limparContinuar', 'trabalhando', 'subirNaLista', 'comecarTurno',
    'marcarEspera', 'escondePerm', 'limparPlano', 'fillModels', 'paintEngine', 'pintarPasta',
    'mostrarPastaNoPainel', 'atualizarGit', 'pintarModo', 'savePanes', 'scroll', 'piscar',
    'marcarAbertas', 'esquecerCadeiaDoPainel', 'guardarParteAnterior', 'pintarConversas', 'lembrarDonoDoNome']) c[name] = noop;
  c.envioComAnexos = (P, text, attachments) => ({ text, displayText: text, attachments });
  c.userMsg = (P, text, attachments) => { const b = element(); b.dataset.hist = String(P.hist.length); b.parentNode = P.chat; b.remove = () => { b.parentNode = null; }; P.hist.push({ texto: text, attachments }); return b; };
  c.window.api.paneSend = async p => { c.sent.push(p); return true; };
  c.window.api.paneStart = async () => ({});
  c.window.api.paneSteer = async () => ({ ok: false });
  Object.assign(c, extras);
  vm.createContext(c);
  vm.runInContext(names.map(n => func(n)).join('\n'), c);
  return c;
}
function pane(c, props = {}) {
  const input = element(), el = element(), chat = element(); el.nodes = { '.p-input': input };
  const P = { id: 'p' + (c.panes.size + 1), engine: 'claude', cwd: '/projeto', started: true, busy: false,
    titulo: 'Teste', anexos: [], hist: [], filaMsgs: [], blocks: new Map(), tools: new Map(), el, chat, ...props };
  c.panes.set(P.id, P); return P;
}
const queueFns = ['painelAindaAtual', 'invalidarConversa', 'juntarNaFila', 'agendarFila'];
const sendFns = [...queueFns, 'send'];
test('fila permanece no painel até a entrega e não dispara depois de fechar', async () => {
  const c = context(queueFns), P = pane(c, { queued: { text: 'antiga' } });
  c.agendarFila(P);
  assert.equal(P.queued.text, 'antiga');
  c.panes.delete(P.id);
  await c.timers[0].fn();
  assert.equal(c.sent.length, 0);
});
test('trocar conversa cancela o timer da fila antiga', () => {
  const c = context(queueFns), P = pane(c, { queued: { text: 'antiga' } });
  c.agendarFila(P); c.invalidarConversa(P);
  assert.equal(c.timers.length, 0); assert.equal(P.filaTimer, null);
});
test('entrega da primeira fila preserva a marca das mensagens que chegaram durante o envio', async () => {
  const c = context(queueFns), ack = deferred(), anterior = element(), nova = element();
  anterior.classList.add('esperando'); nova.classList.add('esperando');
  c.window.api.paneSend = () => ack.promise;
  const P = pane(c, { queued: { text: 'primeira' }, filaMsgs: [{ el: anterior }] });
  c.agendarFila(P); const running = c.timers[0].fn();
  c.juntarNaFila(P, { text: 'segunda' }); P.filaMsgs.push({ el: nova });
  ack.resolve(true); await running;
  assert.equal(anterior.classList.contains('esperando'), false);
  assert.equal(nova.classList.contains('esperando'), true);
  assert.equal(P.queued.text, 'segunda'); assert.equal(P.filaMsgs.length, 1);
});
test('fila não disputa um motor que ficou ocupado antes do timer', async () => {
  const c = context(queueFns), P = pane(c, { queued: { text: 'primeira' } });
  c.agendarFila(P); P.busy = true; await c.timers[0].fn();
  assert.equal(c.sent.length, 0); assert.equal(P.queued.text, 'primeira');
});
test('erro na entrega devolve as duas filas em ordem sem perder texto', async () => {
  const c = context(queueFns), ack = deferred(); let returned;
  c.devolverFilaAoCampo = (P, q) => { returned = q; };
  c.window.api.paneSend = () => ack.promise;
  const P = pane(c, { queued: { text: 'primeira', displayText: 'primeira' } });
  c.agendarFila(P); const running = c.timers[0].fn();
  c.juntarNaFila(P, { text: 'segunda', displayText: 'segunda' });
  ack.resolve({ ok: false, error: 'caiu' }); await running;
  assert.equal(returned.text, 'primeira\n\nsegunda'); assert.equal(P.busy, false); assert.equal(P.started, false);
});
test('envio durante troca de motor ou leitura de histórico preserva o rascunho', async () => {
  for (const state of ['trocando', 'carregandoHistorico']) {
    const c = context(sendFns), P = pane(c, { [state]: true });
    P.el.nodes['.p-input'].value = 'não perder'; await c.send(P);
    assert.equal(P.el.nodes['.p-input'].value, 'não perder'); assert.equal(c.sent.length, 0);
  }
});
test('resposta atrasada de iniciar motor não envia texto na conversa que o substituiu', async () => {
  const c = context(sendFns), ack = deferred(), P = pane(c, { started: false });
  P.el.nodes['.p-input'].value = 'antiga'; c.window.api.paneStart = () => ack.promise;
  const running = c.send(P); c.invalidarConversa(P); P.engine = 'codex';
  ack.resolve({}); await running; assert.equal(c.sent.length, 0); assert.equal(P.started, false);
});
test('falha de envio mantém contexto transferido para a próxima tentativa', async () => {
  const c = context(sendFns), P = pane(c, { passarContexto: 'CONTEXTO:' });
  c.recuperarEnvio = (P, b, t) => { P.el.nodes['.p-input'].value = t; };
  c.window.api.paneSend = async () => ({ ok: false, error: 'offline' });
  P.el.nodes['.p-input'].value = 'pedido'; await c.send(P);
  assert.equal(P.passarContexto, 'CONTEXTO:'); assert.equal(P.el.nodes['.p-input'].value, 'pedido'); assert.equal(P.busy, false);
});
test('mensagem digitada na pausa de 150 ms respeita a ordem da fila', async () => {
  const c = context([...sendFns, 'marcarNaFila']), P = pane(c, { queued: { text: 'primeira', displayText: 'primeira' } });
  P.el.nodes['.p-input'].value = 'segunda'; await c.send(P);
  assert.equal(c.sent.length, 0); assert.equal(P.queued.text, 'primeira\n\nsegunda');
  await c.timers[0].fn(); assert.equal(c.sent[0].text, 'primeira\n\nsegunda');
});
test('steer recusado depois que o turno acabou agenda a mensagem em vez de prendê-la', async () => {
  const c = context([...sendFns, 'marcarNaFila']), ack = deferred(), P = pane(c, { busy: true, envio: 'entra' });
  c.window.api.paneSteer = () => ack.promise;
  P.el.nodes['.p-input'].value = 'urgente'; const running = c.send(P);
  P.busy = false; ack.resolve({ ok: false }); await running;
  assert.equal(c.timers.length, 1); await c.timers[0].fn(); assert.equal(c.sent[0].text, 'urgente');
});
function historyContext() {
  const c = context(['painelAindaAtual', 'invalidarConversa', 'openSession']);
  c.NA_VPS = cwd => String(cwd).startsWith('vps:'); c.abaDoCaminho = () => ({}); c.nomePasta = x => x;
  c.newPane = opts => pane(c, opts); c.setFocus = P => { c.focusPane = P; };
  c.rendered = []; c.renderizarHistorico = (P, m) => c.rendered.push([P, m]);
  c.window.api.paneStop = async () => {}; c.window.api.sessionHistory = async () => [];
  return c;
}
const session = { id: 's1', engine: 'claude', cwd: '/projeto', title: 'salva' };
test('clique duplo no histórico cria um único painel durante a leitura', async () => {
  const c = historyContext(), ack = deferred(); c.window.api.sessionHistory = () => ack.promise;
  const a = c.openSession(session); const b = c.openSession(session);
  assert.equal(c.panes.size, 1); ack.resolve([]); await Promise.all([a, b]);
});
test('histórico de um painel não marca ferramentas de outros painéis como prontas', async () => {
  const c = historyContext(), outside = element(); outside.classList.add('run'); outside.className = 'tool-st run';
  c.document.querySelectorAll = s => s === '.tool-st' ? [outside] : [];
  await c.openSession(session); assert.equal(outside.className, 'tool-st run');
});
test('histórico usa número e pasta quando o caminho do arquivo não foi salvo', async () => {
  const c = historyContext(); let params;
  c.window.api.sessionHistory = async p => { params = p; return []; };
  await c.openSession(session); assert.equal(params.id, 's1'); assert.equal(params.cwd, '/projeto');
});
test('leitura atrasada de histórico não desenha sobre conversa substituída nem rouba foco', async () => {
  const c = historyContext(), ack = deferred(); c.window.api.sessionHistory = () => ack.promise;
  const run = c.openSession(session), P = [...c.panes.values()][0];
  c.invalidarConversa(P); c.focusPane = pane(c); P.el.nodes['.p-input'].focused = false;
  ack.resolve([{ text: 'antiga' }]); await run;
  assert.equal(c.rendered.length, 0); assert.equal(P.el.nodes['.p-input'].focused, false);
});
test('erro do histórico destrava o campo e informa a falha', async () => {
  const c = historyContext(); c.window.api.sessionHistory = async () => { throw new Error('arquivo ilegível'); };
  await c.openSession(session); const P = [...c.panes.values()][0];
  assert.equal(P.carregandoHistorico, false); assert.match(c.notices.at(-1), /ilegível/);
});
test('sessões de motores diferentes com mesmo número continuam separadas', async () => {
  const c = historyContext(); pane(c, { engine: 'codex', resumeId: 's1' });
  await c.openSession(session); assert.equal(c.panes.size, 2);
});
test('visor conserva o arquivo mais recente quando a leitura anterior chega depois', async () => {
  const c = context(['verArquivo', 'posicionarVisor', 'cabecaVisor']), P = pane(c), v = element(), body = element(), pre = element();
  v.nodes = Object.fromEntries(['.visor-corpo', '.visor-nome', '.visor-x', '.visor-abrir'].map(s => [s, s === '.visor-corpo' ? body : element()]));
  body.nodes = { pre }; P.el.nodes['.p-visor'] = v;
  c.fecharVisor = () => {}; c.NA_VPS = () => false; c.tamanhoBonito = () => '1 B';
  const a = deferred(), b = deferred(); c.lerParaVisor = p => p === '/a' ? a.promise : b.promise;
  const first = c.verArquivo(P, '/a'), second = c.verArquivo(P, '/b');
  b.resolve({ nome: 'b', tipo: 'texto', dados: 'novo' }); await second;
  a.resolve({ nome: 'a', tipo: 'texto', dados: 'velho' }); await first;
  assert.equal(pre.textContent, 'novo'); assert.match(v.nodes['.visor-nome'].textContent, /^b/);
});
function approvalContext() {
  const c = context(['showApproval']), P = pane(c), bar = element();
  bar.nodes = Object.fromEntries(['.pp-txt', '.pp-yes', '.pp-no'].map(s => [s, element()]));
  P.el.nodes['.pane-perm'] = bar; return { c, P, bar };
}
test('aprovação que falha continua visível e permite tentar novamente', async () => {
  const { c, P, bar } = approvalContext(); c.window.api.approve = async () => { throw new Error('sem rede'); };
  c.showApproval(P, { key: 'a', title: 'Pode?' }); await bar.nodes['.pp-yes'].onclick();
  assert.equal(bar.classList.contains('hidden'), false); assert.equal(bar.nodes['.pp-yes'].disabled, false);
  assert.match(c.notices[0], /sem rede/);
});
test('confirmação atrasada não fecha um novo pedido de aprovação', async () => {
  const { c, P, bar } = approvalContext(), ack = deferred(); c.window.api.approve = () => ack.promise;
  c.showApproval(P, { key: 'a', title: 'Primeiro' }); const run = bar.nodes['.pp-yes'].onclick();
  c.showApproval(P, { key: 'b', title: 'Segundo' }); ack.resolve(true); await run;
  assert.equal(bar.classList.contains('hidden'), false); assert.equal(bar.nodes['.pp-yes'].disabled, false);
});
test('dois pedidos de aprovação simultâneos são respondidos na ordem sem esconder o primeiro', async () => {
  const { c, P, bar } = approvalContext(), keys = [];
  c.window.api.approve = async p => { keys.push(p.key); return true; };
  c.showApproval(P, { key: 'a', title: 'Primeiro' }); c.showApproval(P, { key: 'b', title: 'Segundo' });
  assert.match(bar.nodes['.pp-txt'].textContent, /Primeiro/);
  await bar.nodes['.pp-yes'].onclick(); assert.match(bar.nodes['.pp-txt'].textContent, /Segundo/);
  await bar.nodes['.pp-no'].onclick(); assert.deepEqual(keys, ['a', 'b']); assert.equal(bar.classList.contains('hidden'), true);
});
test('reposição do anexo guardado usa caminho, não o objeto de metadados', async () => {
  const c = context(['painelAindaAtual', 'anexar']), P = pane(c); let input;
  c.window.api.anexoLer = async p => { input = p; return { path: p }; };
  await c.anexar(P, [{ path: '/foto.png', nome: 'foto.png' }]);
  assert.equal(input, '/foto.png'); assert.equal(P.anexos.length, 1);
});
test('duas leituras simultâneas do mesmo anexo não duplicam a ficha', async () => {
  const c = context(['painelAindaAtual', 'anexar']), P = pane(c), ack = deferred();
  c.window.api.anexoLer = () => ack.promise;
  const a = c.anexar(P, ['/foto.png']), b = c.anexar(P, ['/foto.png']);
  ack.resolve({ path: '/foto.png' }); await Promise.all([a, b]); assert.equal(P.anexos.length, 1);
});
test('anexo ilegível não ganha ficha de sucesso e leitura antiga não entra na conversa nova', async () => {
  const c = context(['painelAindaAtual', 'invalidarConversa', 'anexar']), P = pane(c);
  c.window.api.anexoLer = async () => ({ erro: 'arquivo sumiu' }); await c.anexar(P, ['/foto.png']);
  assert.equal(P.anexos.length, 0); assert.match(c.notices[0], /sumiu/);
  const ack = deferred(); c.window.api.anexoLer = () => ack.promise;
  const run = c.anexar(P, ['/foto.png']); c.invalidarConversa(P); ack.resolve({ path: '/foto.png' }); await run;
  assert.equal(P.anexos.length, 0);
});
test('rascunho só do telefone recria seu painel e restaura texto e anexo', async () => {
  const item = { engine: 'claude', cwd: '/cliente', texto: 'rascunho', sessao: '', indice: 9, em: Date.now(), anexos: [{ path: '/foto.png' }] };
  const c = context([]); c.chaveRascunhos = 'drafts'; c.VALIDADE = 86400000;
  c.localStorage = { getItem: () => JSON.stringify([item]) }; c.sessao = P => P.resumeId || '';
  c.newPane = opts => { const p = pane(c, opts); p.el.querySelector = s => p.el.nodes[s]; return p; };
  c.abaDoCaminho = () => ({}); c.anexar = async (P, a) => { P.anexos = a; };
  const normalized = mobile.replace(/^  /gm, '');
  vm.runInContext(func('reporRascunhos', normalized), c);
  await c.reporRascunhos(); const P = [...c.panes.values()][0];
  assert.equal(c.panes.size, 1); assert.equal(P.el.nodes['.p-input'].value, 'rascunho'); assert.equal(P.anexos[0].path, '/foto.png');
});
test('devolver fila combina mensagem e rascunho atual em vez de perder um deles', () => {
  const c = context(['devolverFilaAoCampo']), P = pane(c);
  c.reporAnexos = (P, a) => P.anexos.push(...a); let removed = false;
  c.tirarBolhasDaFila = () => { removed = true; };
  P.el.nodes['.p-input'].value = 'rascunho novo';
  c.devolverFilaAoCampo(P, { displayText: 'fila antiga', attachments: [{ path: '/foto.png' }] });
  assert.equal(P.el.nodes['.p-input'].value, 'fila antiga\n\nrascunho novo');
  assert.equal(removed, true); assert.equal(P.anexos[0].path, '/foto.png');
});
test('troca de pasta elimina contexto pendente do cliente anterior', () => {
  const c = context(['invalidarConversa', 'conversaDaPastaNova']), P = pane(c, { passarContexto: 'Dados do outro cliente', edicoes: [1] });
  c.zerarContexto = c.voltarVazio = () => {};
  c.conversaDaPastaNova(P, '/novo'); assert.equal(P.passarContexto, null); assert.equal(P.edicoes.length, 0);
});
test('troca de conta bloqueia envio inclusive em outro painel do mesmo motor', async () => {
  const c = context(sendFns), P = pane(c); P.el.nodes['.p-input'].value = 'esperar a conta';
  c.motoresTrocandoConta.add('claude'); await c.send(P);
  assert.equal(c.sent.length, 0); assert.equal(P.el.nodes['.p-input'].value, 'esperar a conta');
});
test('salvar abas informa falha de disco retornada pela ponte', async () => {
  const c = context(['savePanes'], { abas: new Map(), restaurando: false, abasQueNaoVoltaram: [], abaAtiva: null });
  c.marcarAbertas = () => {}; c.mostrarAviso = p => c.notices.push(p);
  c.window.api.setConfig = async () => ({ ok: false, error: 'Disco cheio' });
  c.savePanes(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(c.notices.length, 1); assert.match(c.notices[0].texto, /Disco cheio/);
});
function listContext() {
  const c = context(['loadHist']), box = element();
  c.histCache = {}; c.leituraHistorico = {}; c.caixaHist = () => box;
  c.paintHist = () => {}; c.buscarConversasVps = () => {}; c.juntarComVps = (e, list) => list;
  // 25/09: a falha de UMA IA vira linha curta no topo da lista única (pintarErrosDaLista)
  c.erroDaLista = {}; c.pintarErrosDaLista = () => {};
  return { c, box };
}
test('lista de histórico mais nova prevalece quando a leitura anterior atrasa', async () => {
  const { c } = listContext(), a = deferred(), b = deferred(); let calls = 0;
  c.window.api.sessionsClaude = () => ++calls === 1 ? a.promise : b.promise;
  const old = c.loadHist('claude'), latest = c.loadHist('claude');
  b.resolve([{ id: 'nova' }]); await latest; a.resolve([{ id: 'antiga' }]); await old;
  assert.equal(c.histCache.claude[0].id, 'nova');
});
test('erro de histórico trata HTML como texto e não como elementos da tela', async () => {
  const { c, box } = listContext();
  c.window.api.sessionsClaude = async () => ({ error: '<img src=x onerror=alert(1)>' });
  await c.loadHist('claude'); assert.equal(box.children.length, 1);
  assert.match(box.children[0].textContent, /<img/); assert.equal(box.children[0].innerHTML, '');
});
test('primeira mensagem de conversa nova não se transforma em falsa retomada', async () => {
  const c = context(sendFns), P = pane(c, { started: false });
  P.el.nodes['.p-input'].value = 'pedido novo'; await c.send(P);
  assert.equal(c.sent[0].text, 'pedido novo');
});
test('retomada por contexto usa só o histórico anterior sem duplicar o pedido atual', async () => {
  const c = context(sendFns), P = pane(c, { started: false, hist: [{ texto: 'conversa antiga' }] });
  c.montarContexto = P => P.hist.map(h => h.texto).join('|') + '\n';
  P.el.nodes['.p-input'].value = 'pedido atual'; await c.send(P);
  assert.equal(c.sent[0].text, 'conversa antiga\npedido atual');
});
