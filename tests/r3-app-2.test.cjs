'use strict';
/* Testes de guarda da rodada 3, lote 2 (app), consertador: R3-029, R3-031, R3-032, R3-030, R3-012.
   Padrão igual ao de tests/auditoria-renderer-20260921.test.cjs: extrai a função real de
   renderer/app.js por regex e roda numa VM com stubs, sem abrir o Electron. */
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
function classes(...initial) {
  const set = new Set(initial);
  return { add: (...xs) => xs.forEach(x => set.add(x)), remove: (...xs) => xs.forEach(x => set.delete(x)), contains: x => set.has(x) };
}
function element() {
  return {
    style: {}, classList: classes(), dataset: {}, value: '', innerHTML: '', textContent: '',
    parentNode: {}, children: [],
    appendChild(x) { this.children.push(x); return x; },
    insertBefore(x) { this.children.push(x); return x; },
    remove() { this.parentNode = null; },
    querySelectorAll() { return []; },
    dispatchEvent() {}, addEventListener() {}, focus() {}, setSelectionRange() {},
  };
}
function newContext(extra) {
  const c = { console, Map, Set, Event: class Event { constructor(t) { this.type = t; } } };
  Object.assign(c, extra);
  vm.createContext(c);
  return c;
}

/* ---- R3-029: "Corrigir e mandar de novo" numa mensagem 'esperando' não pode duplicar texto ---- */
test('R3-029: editar mensagem ainda esperando na fila zera P.queued e repõe o anexo (fila com 1 só)', () => {
  const chamadasSend = [];
  let cxCriada;
  const dBolha = element();
  dBolha.classList.add('esperando');
  dBolha.dataset.hist = '0';
  dBolha.nodes = { '.msg-body': element() };

  const c = newContext({
    document: {
      createElement(tag) {
        const el = element();
        if (tag === 'div') { el.nodes = { '.me-txt': element(), '.me-x': element(), '.me-ok': element() }; cxCriada = el; }
        return el;
      },
    },
    $: (sel, el) => (el && el.nodes && el.nodes[sel]) || null,
    // reporAnexos real e tirarBolha/tirarDoHist reais precisam destas pontes:
    pintarAnexos() {},
    send(P) { chamadasSend.push({ queued: P.queued, anexos: P.anexos.slice() }); },
  });
  vm.runInContext(
    [func('editarMinhaMensagem'), func('tirarBolha'), func('tirarDoHist'), func('reporAnexos')].join('\n'),
    c
  );

  const P = {
    hist: [{ quem: 'Você', texto: 'errado' }],
    chat: element(),
    el: { nodes: { '.p-input': element() } },
    anexos: [],
    filaMsgs: [{ el: dBolha, texto: 'errado', iHist: 0 }],
    queued: { text: 'errado', displayText: 'errado', attachments: [{ path: '/tmp/foto.png' }] },
  };

  c.editarMinhaMensagem(P, dBolha, 'errado');
  cxCriada.nodes['.me-txt'].value = 'corrigido';
  cxCriada.nodes['.me-ok'].onclick();

  assert.equal(chamadasSend.length, 1, 'send() foi chamado uma vez');
  // sem o conserto, P.queued continua com o texto ERRADO (não nulo) neste ponto, e o send()
  // de baixo junta ("errado\n\ncorrigido") em vez de substituir
  assert.equal(chamadasSend[0].queued, null, 'P.queued foi zerado antes do reenvio, sem grudar o texto velho');
  assert.ok(chamadasSend[0].anexos.some(a => a.path === '/tmp/foto.png'), 'o anexo da mensagem original voltou para P.anexos');
  assert.equal(P.hist.length, 0, 'a bolha antiga saiu do histórico (não fica duplicada)');
  assert.equal(dBolha.parentNode, null, 'a bolha antiga saiu da tela');
});

test('R3-029: com MAIS de uma mensagem na fila, não mexe em P.queued (não piora o caso raro)', () => {
  let cxCriada;
  const dBolha = element();
  dBolha.classList.add('esperando');
  dBolha.dataset.hist = '0';
  dBolha.nodes = { '.msg-body': element() };
  const outraBolha = element();

  const c = newContext({
    document: {
      createElement(tag) {
        const el = element();
        if (tag === 'div') { el.nodes = { '.me-txt': element(), '.me-x': element(), '.me-ok': element() }; cxCriada = el; }
        return el;
      },
    },
    $: (sel, el) => (el && el.nodes && el.nodes[sel]) || null,
    pintarAnexos() {},
    send() {},
  });
  vm.runInContext(
    [func('editarMinhaMensagem'), func('tirarBolha'), func('tirarDoHist'), func('reporAnexos')].join('\n'),
    c
  );

  const P = {
    hist: [{ quem: 'Você', texto: 'errado' }, { quem: 'Você', texto: 'outra' }],
    chat: element(),
    el: { nodes: { '.p-input': element() } },
    anexos: [],
    filaMsgs: [{ el: dBolha, texto: 'errado', iHist: 0 }, { el: outraBolha, texto: 'outra', iHist: 1 }],
    queued: { text: 'errado\n\noutra', displayText: 'errado\n\noutra', attachments: [] },
  };
  c.editarMinhaMensagem(P, dBolha, 'errado');
  cxCriada.nodes['.me-txt'].value = 'corrigido';
  cxCriada.nodes['.me-ok'].onclick();

  assert.ok(P.queued, 'P.queued não foi apagado (senão perderia o texto da outra mensagem da fila)');
  assert.equal(dBolha.parentNode, null, 'a bolha editada ainda sai da tela');
});

/* ---- R3-031: clicar no microfone de outro painel enquanto grava (whisper) deve trocar, não só parar ---- */
test('R3-031: alternarDitado troca de painel (para o antigo e liga o novo)', async () => {
  const chamadas = [];
  const c = newContext({
    VIVO: {},
    DITADO: { rec: {}, pedacos: [], P: null },
    window: { api: {} },
    pararDitado() { chamadas.push('parar'); },
    ditadoWhisper(P) { chamadas.push('whisper:' + P.id); },
  });
  vm.runInContext(func('alternarDitado'), c);
  const painelA = { id: 'A' }, painelB = { id: 'B' };
  c.DITADO.P = painelA;
  await c.alternarDitado(painelB);
  assert.deepEqual(chamadas, ['parar', 'whisper:B'], 'para o gravador de A e liga o ditado em B (antes só parava e saía)');
});
test('R3-031: alternarDitado no MESMO painel continua só parando (toggle)', async () => {
  const chamadas = [];
  const c = newContext({
    VIVO: {},
    DITADO: { rec: {}, pedacos: [], P: null },
    window: { api: {} },
    pararDitado() { chamadas.push('parar'); },
    ditadoWhisper(P) { chamadas.push('whisper:' + P.id); },
  });
  vm.runInContext(func('alternarDitado'), c);
  const painelA = { id: 'A' };
  c.DITADO.P = painelA;
  await c.alternarDitado(painelA);
  assert.deepEqual(chamadas, ['parar'], 'no mesmo painel não tenta religar');
});

/* ---- R3-032: caminho de arquivo cru com espaço na pasta vira link, sem atravessar a frase ---- */
test('R3-032: linkarArquivos reconhece caminho com espaço na pasta e não passa do 1º ".ext"', () => {
  function textNode(txt) { return { nodeType: 3, textContent: txt, replaceWith(frag) { this.repl = frag; } }; }
  const c = newContext({
    NA_VPS: cwd => String(cwd).startsWith('vps:'),
    EXT_MINIATURA: /\.(png|jpe?g|gif|webp|svg|bmp)$/i,
    caminhoDoPainel: (P, caminho) => caminho,
    miniaturaDaEntrega() {},
    verArquivo() {},
    document: {
      createElement: (tag) => ({ _tag: tag, className: '', textContent: '', href: '', title: '', onclick: null }),
      createTextNode: (txt) => ({ _tag: '#text', textContent: txt }),
      createDocumentFragment: () => ({ kids: [], appendChild(x) { this.kids.push(x); } }),
    },
  });
  vm.runInContext(func('linkarArquivos'), c);
  const P = { cwd: '/projeto' };

  const txtA = 'salvei em /Users/homeromotti/Documents/Adsure - Copy Lançamentos/2 - Clientes/Rapha/arquivo.md';
  const noA = textNode(txtA);
  const rootA = { childNodes: [noA], querySelectorAll: () => [] };
  c.linkarArquivos(P, rootA);
  const linksA = noA.repl.kids.filter(k => k._tag === 'a').map(k => k.textContent);
  assert.deepEqual(linksA, ['/Users/homeromotti/Documents/Adsure - Copy Lançamentos/2 - Clientes/Rapha/arquivo.md'],
    'caminho com espaço na pasta vira UM link inteiro, terminado em .md');

  const txtB = 'salvei em /Users/homeromotti/arquivo.md e a versão 2.5 ficou boa';
  const noB = textNode(txtB);
  const rootB = { childNodes: [noB], querySelectorAll: () => [] };
  c.linkarArquivos(P, rootB);
  const linksB = noB.repl.kids.filter(k => k._tag === 'a').map(k => k.textContent);
  assert.deepEqual(linksB, ['/Users/homeromotti/arquivo.md'],
    'não atravessa a frase até o outro ponto (2.5): para no primeiro .md');
  const restoB = noB.repl.kids.filter(k => k._tag === '#text').map(k => k.textContent).join('');
  assert.ok(restoB.includes('2.5'), 'o resto da frase ("2.5") continua como texto solto, não virou link');
});

/* ---- R3-030: texto antes de uma ferramenta não pode sumir de P.hist quando o bot fala de novo ---- */
test('R3-030: textFinal mantém os DOIS textos no histórico quando uma ferramenta roda no meio', () => {
  const c = newContext({
    marked: { parse: (t) => t },
    nomeDoMotor: (e) => e,
    legendarTrabalho() {}, linkarArquivos() {}, marcarLinksWeb() {}, botoesDeCopia() {}, marcarRecibo() {}, scroll() {},
    botBlock(P, key) { const b = { el: element(), raw: '', corte: 0, fixos: 0 }; P.blocks.set(key, b); return b; },
  });
  vm.runInContext(func('textFinal'), c);

  const P = { engine: 'claude', hist: [], blocks: new Map(), execEl: null, trabEl: null, chat: element() };

  c.textFinal(P, 'b0', 'texto1');
  assert.equal(P.hist.length, 1);
  assert.equal(P.hist[0].texto, 'texto1');

  // ferramenta rodou no meio do turno (toolStart conecta P.execEl)
  P.execEl = { isConnected: true };
  c.textFinal(P, 'b0', 'texto2');
  assert.equal(P.hist.length, 2, 'texto1 não pode sumir: vira entrada nova, não sobrescreve');
  assert.equal(P.hist[0].texto, 'texto1');
  assert.equal(P.hist[1].texto, 'texto2');

  // redesenho normal do MESMO bloco (sem ferramenta no meio, mesma key) ainda sobrescreve,
  // senão duplicaria a cada pedacinho de texto que chega
  c.textFinal(P, 'b0', 'texto2 editado');
  assert.equal(P.hist.length, 2, 'redesenho do mesmo bloco não duplica');
  assert.equal(P.hist[1].texto, 'texto2 editado');
});

/* ---- R3-012: "esta conversa caiu" não pode disparar numa 1ª tentativa que nunca começou ---- */
test('R3-012: montarContexto("primeira-tentativa") não usa o aviso de queda; outro motivo usa', () => {
  const c = newContext({ montarEnvio: (t) => t });
  vm.runInContext(func('montarContexto'), c);

  const textoA = c.montarContexto({ hist: [{ quem: 'Você', texto: 'oi' }] }, true, 'primeira-tentativa');
  assert.ok(!textoA.includes('IGNORE qualquer resumo'), '1ª tentativa sem resposta real não usa o aviso de queda');
  assert.ok(textoA.length < 200, 'aviso da 1ª tentativa é curto, sem o bloco "conversa até aqui"');

  const textoB = c.montarContexto({ hist: [{ quem: 'Você', texto: 'oi' }, { quem: 'Claude', texto: 'resposta real' }] }, true, undefined);
  assert.ok(textoB.includes('IGNORE qualquer resumo'), 'queda de verdade (motivo normal) continua com o aviso completo');
});

test('R3-012: send() só passa "primeira-tentativa" quando NENHUMA resposta real chegou antes', async () => {
  const chamadasContexto = [];
  const c = newContext({
    $: (sel, el) => (el && el.nodes && el.nodes[sel]) || null,
    window: { api: { paneStart: async () => ({}), paneSend: async () => true } }, VIVO: {}, DITADO: {},
    panes: new Map(), motoresTrocandoConta: new Set(),
    NA_VPS: () => false, modoDe: () => ({ id: 'manual' }), esforcoDe: () => 'high', nomeDoMotor: (e) => e,
    modeloSemOrigem: (x) => x, modeloPorCreditos: () => false, mensagensDele: () => [],
    nomeDaConversa: () => 'Conversa', ENTRA_MSG: 'ENTRA:',
    montarContexto: (P, retomada, motivo) => { chamadasContexto.push(motivo); return 'CONTEXTO:'; },
    note() {}, avisoEnvio: () => element(), guardarPrompt() {}, pintarNome() {}, nomearCurto() {},
    pintarAnexos() {}, limparSugestoes() {}, vozSoltar() {}, pararBuscaDeArquivos() {}, soltarNavArquivos() {},
    prepararEscolhasEnvio: () => null, concluirEscolhasEnvio() {}, recuperarEnvio() {}, setDot() {},
    comecarTurno() {}, limparContinuar() {}, trabalhando() {}, podeContinuar: () => false,
    pararTrabalho() {}, limparPassos() {}, subirNaLista() {},
    envioComAnexos: (P, text, anexos) => ({ text, displayText: text, attachments: anexos }),
    invalidarConversa() {}, painelAindaAtual: () => true, userMsg(P, text) { P.hist.push({ quem: 'Você', texto: text }); return element(); },
  });
  vm.runInContext(func('send'), c);

  // caso A: histórico só com fala do usuário (a 1ª tentativa caiu antes de qualquer resposta)
  const inputA = element(); inputA.value = 'pedido de novo';
  const PA = { id: 'a', engine: 'claude', started: false, busy: false, anexos: [], hist: [{ quem: 'Você', texto: 'oi' }],
    blocks: new Map(), el: { nodes: { '.p-input': inputA } }, trocando: false, carregandoHistorico: false };
  c.panes.set(PA.id, PA);
  await c.send(PA);
  assert.equal(chamadasContexto[0], 'primeira-tentativa', 'sem resposta real no histórico, motivo é "primeira-tentativa"');

  // caso B: histórico já tem uma resposta real do motor — é queda de verdade
  const inputB = element(); inputB.value = 'pedido de novo';
  const PB = { id: 'b', engine: 'claude', started: false, busy: false, anexos: [],
    hist: [{ quem: 'Você', texto: 'oi' }, { quem: 'Claude', texto: 'resposta real' }],
    blocks: new Map(), el: { nodes: { '.p-input': inputB } }, trocando: false, carregandoHistorico: false };
  c.panes.set(PB.id, PB);
  await c.send(PB);
  assert.equal(chamadasContexto[1], undefined, 'com resposta real no histórico, motivo NÃO é "primeira-tentativa"');
});
