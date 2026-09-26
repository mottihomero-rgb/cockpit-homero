'use strict';
// Regressões do renderer usando funções reais. Sem motor, conta, rede ou gravação de produto.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const test = require('node:test');
const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'renderer/app.js'), 'utf8');
function func(nome) {
  const m = new RegExp('^(?:async )?function ' + nome + '\\(', 'm').exec(app);
  assert.ok(m, nome);
  const line = app.slice(m.index, app.indexOf('\n', m.index));
  if (line.endsWith('}')) return line;
  const next = /^(?:async )?function [\w$]+\(/mg;
  next.lastIndex = m.index + m[0].length;
  const n = next.exec(app);
  let text = app.slice(m.index, n ? n.index : undefined);
  // Extrair só o corpo, sem comentários/consts entre duas funções.
  const ends = [...text.matchAll(/^}$/mg)];
  return text.slice(0, ends[0].index + 1);
}
const noop = () => {};
function element() {
  return { innerHTML: '', classList: { add: noop, remove: noop }, appendChild: noop };
}
function streamContext() {
  const visible = [];
  const c = vm.createContext({
    marked: { parse: t => t }, nomeDoMotor: e => e,
    legendarTrabalho: noop, linkarArquivos: noop, marcarLinksWeb: noop, botoesDeCopia: noop,
    marcarRecibo: noop, scroll: noop,
    pintarPonta: b => { b.el.innerHTML = b.raw; },
    botBlock(P, key) {
      const b = { el: element(), raw: '', corte: 0, fixos: 0 };
      P.blocks.set(key, b); visible.push(b); return b;
    },
  });
  vm.runInContext(func('textDelta') + '\n' + func('textFinal'), c);
  const P = { engine: 'codex', hist: [], blocks: new Map(), execEl: null, chat: element() };
  return { c, P, visible };
}

test('R-F01: delta + final após ferramenta preserva as duas falas', () => {
  const { c, P, visible } = streamContext();
  c.textDelta(P, 'msg-a', 'Diagnóstico inicial.');
  c.textFinal(P, 'msg-a', 'Diagnóstico inicial.');
  P.execEl = { isConnected: true };
  c.textDelta(P, 'msg-b', 'Conclusão após a ferramenta.');
  c.textFinal(P, 'msg-b', 'Conclusão após a ferramenta.');
  assert.equal(visible.length, 2, 'a tela preserva duas falas neste caso');
  assert.equal(P.hist.length, 2);
  assert.equal(P.hist[0].texto, 'Diagnóstico inicial.');
  assert.equal(P.hist[1].texto, 'Conclusão após a ferramenta.');
});

test('R-F01b: itens consecutivos mantêm blocos e itens de histórico próprios', () => {
  const { c, P, visible } = streamContext();
  c.textDelta(P, 'msg-a', 'Resultado 1.');
  c.textFinal(P, 'msg-a', 'Resultado 1.');
  c.textDelta(P, 'msg-b', 'Resultado 2.');
  c.textFinal(P, 'msg-b', 'Resultado 2.');
  assert.equal(visible.length, 2);
  assert.equal(visible[0].el.innerHTML, 'Resultado 1.');
  assert.equal(visible[1].el.innerHTML, 'Resultado 2.');
  assert.equal(P.hist.length, 2);
  c.textFinal(P, 'msg-b', 'Resultado 2 editado.');
  assert.equal(P.hist.length, 2);
  assert.equal(P.hist[1].texto, 'Resultado 2 editado.');
});

for (const tamanho of [13000, 14000, 15000, 100000]) test('R-F02: contexto preserva pedido/anexos e resposta de ' + tamanho + ' caracteres', () => {
  const c = vm.createContext({ montarEnvio: (t, a) => t + (a ? '\nAnexo: ' + a[0].path : '') });
  vm.runInContext(func('montarContexto'), c);
  const result = c.montarContexto({ hist: [
    { quem: 'Você', texto: 'PEDIDO_ORIGINAL_PROJETO', attachments: [{ path: '/briefing.pdf' }] },
    { quem: 'Claude', texto: 'RESPOSTA_LONGA_' + 'x'.repeat(tamanho) + '_CONCLUSAO' },
  ] });
  assert.ok(result.includes('PEDIDO_ORIGINAL_PROJETO'));
  assert.ok(result.includes('/briefing.pdf'));
  assert.ok(result.includes('RESPOSTA_LONGA_'));
  assert.ok(result.includes('_CONCLUSAO'));
  assert.ok(result.length < 15000);
});

function quadroContext() {
  const draw = new Proxy({ measureText: t => ({ width: String(t).length * 7 }) }, { get: (o, k) => k in o ? o[k] : noop });
  function el() {
    return { style: { setProperty: noop }, classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
      textContent: '', value: '', children: [], appendChild(c) { this.children.push(c); }, querySelector: () => null,
      querySelectorAll: () => [], getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
      getContext: () => draw, addEventListener: noop, setAttribute: noop, setPointerCapture: noop,
      focus: noop, select: noop, setSelectionRange: noop };
  }
  const painel = el(), toast = el();
  const document = { documentElement: el(), body: { contains: () => true, appendChild: noop },
    getElementById: id => id === 'qdPainel' ? painel : null, querySelectorAll: () => [],
    createElement: () => el(), addEventListener: noop, removeEventListener: noop };
  const window = { api: {} };
  const ctx = vm.createContext({ window, document, navigator: {}, console,
    requestAnimationFrame: noop, getComputedStyle: () => ({ getPropertyValue: () => '' }),
    setTimeout: () => 1, clearTimeout: noop });
  const src = fs.readFileSync(path.join(root, 'renderer/quadro.js'), 'utf8');
  vm.runInContext(src.replace('window.Quadro = { abrir, fechar, aberto, donoEh };',
    'window.Quadro = { abrir, fechar, aberto, donoEh, Q, recuperarRascunho, limparCena, limpar };'), ctx);
  const q = window.Quadro;
  q.Q.el = { sub: el(), canvas: el(), palco: el(), toast, mandar: el(), editor: el(), props: el(), ferramentas: el(), dica: el() };
  return { q, window, toast };
}

test('R-F03: reler quadro humano idêntico preserva desfazer e câmera', async () => {
  const { q, window, toast } = quadroContext();
  q.Q.aberto = true; q.Q.larg = 800; q.Q.alt = 600;
  const cena = { v: 1, formas: [{ id: 'a', tipo: 'retangulo', x: 0, y: 0, w: 160, h: 90, texto: 'Meu fluxo' }], setas: [] };
  window.api.quadroRascunhoLer = async () => ({ cena });
  await q.recuperarRascunho();
  q.Q.cam = { x: 333, y: 444, z: 2.5 };
  q.Q.pilha = { passos: ['antes', 'depois'], indice: 1 };
  const mudou = await q.recuperarRascunho();
  assert.equal(mudou, false);
  assert.equal(q.Q.pilha.passos.length, 2);
  assert.equal(q.Q.cam.z, 2.5);
  assert.ok(!toast.children.some(x => /outro aparelho/.test(x.textContent)));
  cena.formas[0].texto = 'Mudança externa';
  assert.equal(await q.recuperarRascunho(), true);
  assert.equal(q.Q.cena.formas[0].texto, 'Mudança externa');
});

for (const tipo of ['rejeicao', 'erro']) test('R-F04: falha ' + tipo + ' preserva pendência e a nova tentativa confirma uma única ligação', async () => {
  let gravacoes = 0, falhar = true, salvo = null;
  const timers = new Map(); let seq = 0;
  const P = { id: 'p', engine: 'codex', sessaoId: 'B', sessaoFile: '/B.jsonl', cwd: '/projeto',
    parteAnterior: { engine: 'claude', id: 'A', file: '/A.jsonl', cwd: '/projeto' }, partesAnteriores: [] };
  const c = vm.createContext({
    window: { api: { ligacoesGravar: async () => { gravacoes++; if (!falhar) return { ok: true };
      if (tipo === 'rejeicao') throw new Error('sem conexão'); return { error: 'disco indisponível' }; } } },
    LIGACOES: {}, chaveParte: p => p.engine + ':' + p.id,
    partesDaCadeia: p => p.id === 'B' ? [P.parteAnterior || { engine: 'claude', id: 'A' }, p] : [p],
    lateralAberta: () => false, panes: new Map([[P.id, P]]),
    savePanes: () => { salvo = JSON.stringify(P.ligacoesPendentes); }, note: noop,
    setTimeout: fn => { timers.set(++seq, fn); return seq; }, clearTimeout: id => timers.delete(id),
  });
  vm.runInContext(func('ligarParteAnterior'), c);
  await c.ligarParteAnterior(P);
  assert.ok(P.parteAnterior);
  assert.equal(P.ligacoesPendentes.length, 1);
  assert.ok(salvo.includes('A') && salvo.includes('B'));
  assert.equal(c.LIGACOES['codex:B'], undefined);
  assert.equal(timers.size, 1);
  falhar = false;
  await c.ligarParteAnterior(P);
  assert.equal(gravacoes, 2);
  assert.equal(P.parteAnterior, null);
  assert.equal(P.ligacoesPendentes.length, 0);
  assert.ok(c.LIGACOES['codex:B']);
  await c.ligarParteAnterior(P);
  assert.equal(gravacoes, 2);
});

test('R-F05: erro parcial deixa aviso persistente com releitura e identifica contexto incompleto', () => {
  const elementos = [];
  const el = () => ({ textContent: '', appendChild(x) { elementos.push(x); }, isConnected: true });
  const c = vm.createContext({ nomeDoMotor: e => e, marcaTroca: noop,
    document: { createElement: el }, relerPartesDoPainel: noop,
    renderizarHistorico: (P, m) => P.hist.push(m) });
  vm.runInContext(func('avisarPartesIndisponiveis') + '\n' + func('desenharPartes'), c);
  const P = { engine: 'codex', hist: [], chat: el() };
  const lidas = [
    { parte: { engine: 'claude' }, msgs: [], erro: new Error('SSH offline') },
    { parte: { engine: 'codex' }, msgs: [{ role: 'bot', text: 'Parte nova.' }] },
  ];
  assert.equal(c.desenharPartes(P, lidas), 1);
  assert.equal(P.historicoIncompleto.partes.length, 2);
  assert.ok(elementos.some(x => /incompleta/.test(x.textContent)));
  assert.ok(elementos.some(x => x.textContent === 'Tentar de novo' && x.onclick));
});

test('R-F09: conta local usa destino local mesmo hospedando diálogo em painel VPS', async () => {
  const remoto = { id: 'p-vps', engine: 'claude', cwd: 'vps:/projeto' };
  const local = { id: 'p-local', engine: 'codex', cwd: '/projeto' };
  const chamadas = [];
  const c = vm.createContext({ focusPane: local, panes: new Map([[local.id, local], [remoto.id, remoto]]),
    NA_VPS: p => /^vps:/i.test(String(p || '')), setFocus: noop, novoChatNaAba: () => { throw new Error('não deveria criar'); },
    window: { api: { auth: async args => { chamadas.push(args); return {}; } } },
  });
  vm.runInContext(func('entrarNaConta') + '\n' + func('contaAcao'), c);
  c.entrarNaConta('claude', true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(chamadas.length, 1);
  assert.equal(chamadas[0].engine, 'claude');
  assert.equal(chamadas[0].acao, 'trocar');
  assert.equal(chamadas[0].cwd, '');
  await c.contaAcao(remoto, 'login', 'claude', { cwd: remoto.cwd });
  assert.equal(chamadas[1].cwd, 'vps:/projeto');
});

test('R-F11: retorno mobile restaura aprovação durante turno ocupado', async () => {
  const mobile = fs.readFileSync(path.join(root, 'renderer/mobile.js'), 'utf8');
  const start = mobile.indexOf('  async function atualizar()');
  const end = mobile.indexOf('\n  function voltou()', start);
  const recebidos = [];
  const P = { id: 'p1', engine: 'codex', cwd: '/projeto', started: true, busy: true, sessaoId: 's1' };
  const c = vm.createContext({ pronto: true, atualizando: false, restaurando: false,
    focusPane: P, panes: new Map([[P.id, P]]), sessao: p => p.sessaoId,
    document: { hidden: false, body: { classList: { contains: () => false } } },
    receberEventoPane: ev => recebidos.push(ev),
    window: { api: { paneEstado: async () => ({ busy: true, aprovacao: { tipo: 'approval', dados: { key: 'A' } } }) } },
  });
  vm.runInContext(mobile.slice(start, end), c);
  await c.atualizar();
  assert.equal(recebidos.length, 1);
  assert.equal(recebidos[0].key, 'A');
  assert.equal(P.busy, true);
});

for (const ocupado of [false, true]) test('R-F08: send real preserva rascunho, citação e anexos; ocupado=' + ocupado, async () => {
  const input = { value: 'Restrição ainda não enviada', style: { height: '88px' } }, enviados = [];
  const anx = [{ path: '/rascunho.png' }], quadro = { path: '/quadro.png' };
  const P = { id: 'p', engine: 'codex', started: true, busy: ocupado, anexos: anx, quadroColado: quadro,
    citacao: 'Seleção ainda não enviada', hist: [], blocks: new Map(), el: {}, titulo: 'Conversa' };
  const c = vm.createContext({
    $: sel => sel === '.p-input' ? input : null,
    window: { api: { paneSend: async args => { enviados.push(args); return true; } } }, VIVO: {}, DITADO: {},
    panes: new Map([[P.id, P]]), motoresTrocandoConta: new Set(),
    NA_VPS: () => false, modoDe: () => ({ id: 'manual' }), esforcoDe: () => 'high', nomeDoMotor: e => e,
    modeloSemOrigem: x => x, modeloPorCreditos: () => false,
    note: noop, avisoEnvio: () => ({}), guardarPrompt: noop, pintarNome: noop, nomearCurto: noop,
    pintarAnexos: () => { throw new Error('não deve mexer nos anexos do rascunho'); }, limparSugestoes: noop,
    vozSoltar: () => { throw new Error('não deve mexer no ditado do rascunho'); }, pararBuscaDeArquivos: noop, soltarNavArquivos: noop,
    prepararEscolhasEnvio: () => null, concluirEscolhasEnvio: noop, recuperarEnvio: noop, setDot: noop,
    comecarTurno: noop, limparContinuar: noop, trabalhando: noop, podeContinuar: () => false,
    pararTrabalho: noop, limparPassos: noop, subirNaLista: noop, marcarNaFila: noop,
    envioComAnexos: (P, text, attachments) => ({ text, displayText: text, attachments }),
    painelAindaAtual: () => true, userMsg(P, text, anexos) { P.hist.push({ texto: text, anexos }); return {}; },
  });
  vm.runInContext(['send', 'enviarComoEle', 'juntarNaFila'].map(func).join('\n'), c);
  await c.enviarComoEle(P, 'Plano aprovado. Pode executar.');
  assert.equal(input.value, 'Restrição ainda não enviada');
  assert.equal(input.style.height, '88px');
  assert.equal(P.anexos, anx); assert.equal(P.quadroColado, quadro);
  assert.equal(P.citacao, 'Seleção ainda não enviada');
  const pacote = ocupado ? P.queued : enviados[0];
  assert.equal(pacote.text, 'Plano aprovado. Pode executar.');
  assert.equal(pacote.attachments.length, 0);
});

test('B04: título automático só confirma gravação após sucesso e repete depois de erro', async () => {
  let n = 0; const lembrados = [];
  const P = { id: 'p', sessaoId: 'S', engine: 'claude', titulo: 'Título novo', nomeCurto: true };
  const c = vm.createContext({
    window: { api: { renomear: async () => ++n === 1 ? { error: 'sem espaço' } : true } },
    painelAindaAtual: () => true, lateralAberta: () => false, lembrarNomeDaParte: (p, nome) => lembrados.push(nome),
  });
  vm.runInContext(func('salvarNomeCurto'), c);
  await c.salvarNomeCurto(P);
  assert.equal(P.nomeCurtoSalvo, undefined); assert.equal(lembrados.length, 0);
  await c.salvarNomeCurto(P);
  assert.equal(P.nomeCurtoSalvo, 'S|Título novo'); assert.equal(lembrados.length, 1);
  await c.salvarNomeCurto(P); assert.equal(n, 2);
});

test('R-F05: tentativa de releitura parcial preserva histórico já aberto; completa troca de uma vez', async () => {
  const hist = [{ texto: 'Histórico atual preservado' }], chat = { replaceChildren() { this.limpo = true; } };
  const P = { id: 'p', hist, chat, blocks: new Map(), tools: new Map(), sessaoId: 'B',
    historicoIncompleto: { partes: [{ engine: 'claude', id: 'A' }, { engine: 'codex', id: 'B' }] } };
  let falha = true;
  const c = vm.createContext({
    avisoTemp: noop, painelAindaAtual: () => true, scroll: noop,
    lerPartes: async () => [{ msgs: [], ...(falha ? { erro: new Error('offline') } : {}) }, { msgs: ['novo'] }],
    desenharPartes: (P, lidas) => { P.historicoIncompleto = null; P.hist.push(lidas[1].msgs[0]); },
  });
  vm.runInContext(func('relerPartesDoPainel'), c);
  await c.relerPartesDoPainel(P);
  assert.equal(P.hist[0].texto, 'Histórico atual preservado'); assert.equal(chat.limpo, undefined);
  falha = false; await c.relerPartesDoPainel(P);
  assert.equal(P.hist, hist); assert.equal(P.hist[0], 'novo'); assert.equal(chat.limpo, true);
});

test('R-F11: estado atrasado de outro motor não injeta aprovação no painel atual', async () => {
  const mobile = fs.readFileSync(path.join(root, 'renderer/mobile.js'), 'utf8');
  const start = mobile.indexOf('  async function atualizar()'), end = mobile.indexOf('\n  function voltou()', start);
  const P = { id: 'p', engine: 'codex', started: true, busy: true, sessaoId: 'S' }, recebidos = [];
  const c = vm.createContext({ pronto: true, atualizando: false, restaurando: false,
    focusPane: P, panes: new Map([[P.id, P]]), sessao: p => p.sessaoId,
    document: { hidden: false, body: { classList: { contains: () => false } } },
    receberEventoPane: ev => recebidos.push(ev),
    window: { api: { paneEstado: async () => { P.engine = 'claude'; return { busy: true, aprovacao: { tipo: 'approval', dados: { key: 'A' } } }; } } },
  });
  vm.runInContext(mobile.slice(start, end), c); await c.atualizar();
  assert.equal(recebidos.length, 0);
});

for (const abriuUltima of [true, false]) test('R-F04: restaura cadeia com costuras pendentes antes e depois do ACK; sessão final=' + abriuUltima, async () => {
  const A = { engine: 'claude', id: 'A', file: '/A.jsonl', cwd: '/p' };
  const B = { engine: 'codex', id: 'B', file: '/B.jsonl', cwd: '/p' };
  const C = { engine: 'gemini', id: 'C', file: '/C.jsonl', cwd: '/p' };
  const historicos = { A: [{ role: 'user', text: 'PEDIDO_ORIGINAL' }], B: [{ role: 'bot', text: 'PARTE_B' }], C: [{ role: 'bot', text: 'PARTE_C' }] };
  const panes = new Map(), abas = new Map(), lidos = [];
  const c = vm.createContext({ console, panes, abas, cfg: { abaAberta: 0 }, HOME: '/h', clienteQueEstavaAberto: '', abasQueNaoVoltaram: [],
    LIGACOES: {}, chaveParte: p => p.engine + ':' + p.id,
    NA_VPS: () => false, clienteDe: () => '', mostrarPastaNoPainel: noop, pintarNome: noop, ativarAbaProjeto: noop,
    removerAbaVazia: noop, painelAindaAtual: () => true, clearEmpty: noop, scroll: noop, ico: () => '',
    $: () => null, $$: () => [], nomeDoMotor: m => m, note: noop, marcaTroca: noop, somarTempoDoHistorico: noop,
    montarEnvio: text => text, savePanes: noop, lateralAberta: () => false, clearTimeout: noop,
    renderizarHistorico: (P, m) => P.hist.push({ quem: m.role === 'user' ? 'Você' : P.engine, texto: m.text }),
    novaAbaProjeto: cwd => { const a = { id: 'aba', cwd, ordem: [] }; abas.set(a.id, a); return a; },
    newPane: o => { const P = { id: 'p', engine: o.engine, cwd: o.cwd, hist: [], partesAnteriores: [], chat: {}, el: {} };
      panes.set(P.id, P); o.aba.ordem.push(P.id); return P; },
    window: { api: { sessionHistory: async o => { lidos.push(o.id); return historicos[o.id]; }, ligacoesGravar: async () => ({ ok: true }) } },
  });
  vm.runInContext(['ligacaoDe', 'partesDaCadeia', 'lerHistoricoDaParte', 'lerPartes', 'avisarPartesIndisponiveis',
    'desenharPartes', 'montarContexto', 'restaurarAbasCorpo', 'ligarParteAnterior'].map(func).join('\n'), c);
  const pendentes = abriuUltima ? [{ nova: B, anterior: A }, { nova: C, anterior: B }] : [{ nova: B, anterior: A }];
  await c.restaurarAbasCorpo([{ cwd: '/p', chats: [{ engine: C.engine, cwd: '/p', sessao: abriuUltima ? 'C' : '',
    arquivo: abriuUltima ? '/C.jsonl' : '', parteAnterior: B, ligacoesPendentes: pendentes }] }]);
  const P = panes.get('p'), esperado = abriuUltima ? ['PEDIDO_ORIGINAL', 'PARTE_B', 'PARTE_C'] : ['PEDIDO_ORIGINAL', 'PARTE_B'];
  assert.deepEqual(Array.from(P.hist, h => h.texto), esperado);
  assert.equal(Object.keys(c.LIGACOES).length, 0, 'ler a pendência não finge confirmação de gravação');
  if (!abriuUltima) assert.match(P.passarContexto, /PEDIDO_ORIGINAL/);
  await c.ligarParteAnterior(P);
  assert.equal(P.ligacoesPendentes.length, 0);
  assert.deepEqual(Array.from(P.hist, h => h.texto), esperado);
  assert.equal(lidos.filter(id => id === 'A').length, 1, 'ACK não precisa apagar/recarregar a tela');
  assert.equal(Object.keys(c.LIGACOES).length, abriuUltima ? 2 : 1);
});

test('R-F03: cena igual do Claude é reconhecida sem zerar undo e não ressuscita depois de Limpar', async () => {
  const { q, window } = quadroContext();
  q.Q.aberto = true; q.Q.larg = 800; q.Q.alt = 600;
  const cena = { v: 1, formas: [{ id: 'a', tipo: 'retangulo', x: 0, y: 0, w: 160, h: 90, texto: 'Meu fluxo' }], setas: [] };
  window.api.quadroRascunhoLer = async () => ({ cena });
  await q.recuperarRascunho();
  q.Q.cam = { x: 333, y: 444, z: 2.5 };
  q.Q.pilha = { passos: ['antes', 'depois'], indice: 1 };
  cena.doClaude = 123;
  assert.equal(await q.recuperarRascunho(), false);
  assert.equal(q.Q.claude.visto, 123);
  assert.equal(q.Q.claude.cena, JSON.stringify(q.limparCena(q.Q.cena)));
  assert.equal(q.Q.cam.z, 2.5); assert.equal(q.Q.pilha.passos.length, 2);
  q.limpar(true);
  assert.equal(q.Q.cena.formas.length, 0);
  await q.recuperarRascunho();
  assert.equal(q.Q.cena.formas.length, 0, 'carimbo já reconhecido não desfaz Limpar durante o debounce do salvamento');
});
