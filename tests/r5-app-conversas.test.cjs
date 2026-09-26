'use strict';
/* Guarda da conversa costurada (25/09). O pedido do Homero: "quando eu mudo pra outra IA no
   meio da conversa, o histórico se perde e eu não acho na lateral". Agora:
   - trocar de IA guarda a parte anterior e, quando o motor novo abre a conversa dele, grava a
     ligação nova → anterior (ligacoes.json);
   - a lateral é UMA lista, com as conversas de todas as IAs, e a cadeia aparece uma vez só,
     com o logo de cada IA que trabalhou nela;
   - abrir a cadeia traz o histórico de todas as partes, da mais velha para a mais nova.
   Mesmo padrão dos r*-app-*: a função é recortada do app.js real e roda numa VM com stubs. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const app = fs.readFileSync(path.join(__dirname, '../renderer/app.js'), 'utf8');
const mobile = fs.readFileSync(path.join(__dirname, '../renderer/mobile.js'), 'utf8');

// recorta "function nome(...) {...}" contando chaves
function pegar(nome, src = app) {
  const re = new RegExp('^(?:async )?function ' + nome + '\\(', 'm');
  const m = re.exec(src);
  assert.ok(m, 'a funcao ' + nome + ' tem de existir no app.js');
  const abre = src.indexOf('{', m.index);
  let n = 0, i = abre;
  for (; i < src.length; i++) {
    if (src[i] === '{') n++;
    else if (src[i] === '}' && --n === 0) { i++; break; }
  }
  return src.slice(m.index, i);
}
// recorta "const NOME = ...;" de uma linha so
function pegarConst(nome, src = app) {
  const m = new RegExp('^const ' + nome + ' = .*;$', 'm').exec(src);
  assert.ok(m, 'o const ' + nome + ' tem de existir no app.js');
  return m[0];
}

const CADEIA = ['ligacaoDe', 'partesDaCadeia', 'tituloDaCadeia', 'motoresDaCadeia', 'itemDaCadeia',
  'montarCadeias', 'mapaDasCadeias'];
function contexto(extras = {}) {
  const ctx = { console, Map, Set, Math, Object, Promise, Date, LIGACOES: {}, NOMES_LIGADOS: {}, ...extras };
  vm.createContext(ctx);
  vm.runInContext([pegarConst('chaveParte'), pegarConst('refDaParte'), pegarConst('chaveFav')].join('\n')
    + '\nthis.chaveParte = chaveParte; this.refDaParte = refDaParte; this.chaveFav = chaveFav;', ctx);
  vm.runInContext(CADEIA.map(n => pegar(n)).join('\n\n'), ctx);
  return ctx;
}
const lig = (nova, anterior) => ({ [nova.engine + ':' + nova.id]: { ...nova, anterior } });

/* ---------------- a ligação: guardar na troca, gravar quando o motor novo abrir ---------------- */

function contextoTroca() {
  const gravadas = [];
  const ctx = contexto({
    window: { api: { ligacoesGravar: async (o) => { gravadas.push(o); return { ok: true }; } } },
    lateralAberta: () => false, pintarConversas: () => {},
  });
  vm.runInContext([pegar('guardarParteAnterior'), pegar('ligarParteAnterior'), pegar('esquecerCadeiaDoPainel')].join('\n'), ctx);
  return { ctx, gravadas };
}

test('troca de IA: a parte anterior fica guardada e a ligação nova → anterior é gravada quando o motor novo abre', () => {
  const { ctx, gravadas } = contextoTroca();
  // 25/09 (consertos): a conversa de antes tem conteúdo na tela — é dele que sai o contexto
  const P = { engine: 'claude', cwd: '/p', sessaoId: 'A', resumeId: 'A', sessaoFile: '/c/A.jsonl', partesAnteriores: [],
    hist: [{ quem: 'Você', texto: 'quero o vídeo' }] };
  ctx.guardarParteAnterior(P);                                  // trocarMotor, antes de zerar o número
  P.engine = 'codex'; P.sessaoId = null; P.resumeId = null; P.sessaoFile = '';
  // o Codex abriu a conversa dele (evento 'sessao')
  P.sessaoId = 'C'; P.resumeId = 'C'; P.sessaoFile = '/x/C.jsonl';
  ctx.ligarParteAnterior(P);
  assert.equal(gravadas.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(gravadas[0])), {
    nova: { engine: 'codex', id: 'C', file: '/x/C.jsonl', cwd: '/p' },
    anterior: { engine: 'claude', id: 'A', file: '/c/A.jsonl', cwd: '/p' },
  });
  assert.equal(P.parteAnterior, null, 'depois de costurar, a pendência sai');
  assert.deepEqual([...P.partesAnteriores.map(p => p.id)], ['A'], 'o painel sabe que a conversa tem uma parte antes');
  assert.ok(ctx.LIGACOES['codex:C'], 'a tela já enxerga a costura sem esperar reler o arquivo');
});

test('trocar duas vezes sem mandar nada não cria ligação fantasma', () => {
  const { ctx, gravadas } = contextoTroca();
  const P = { engine: 'claude', cwd: '/p', sessaoId: 'A', resumeId: 'A', sessaoFile: '', partesAnteriores: [],
    hist: [{ quem: 'Você', texto: 'quero o vídeo' }] };
  ctx.guardarParteAnterior(P);                                  // Claude → Codex
  P.engine = 'codex'; P.sessaoId = null; P.resumeId = null;
  ctx.guardarParteAnterior(P);                                  // Codex → Gemini, sem ter mandado nada no Codex
  P.engine = 'gemini';
  assert.equal(P.parteAnterior.id, 'A', 'a parte pendente continua sendo a do Claude, não um Codex vazio');
  P.sessaoId = 'G';
  ctx.ligarParteAnterior(P);
  assert.equal(gravadas.length, 1, 'uma ligação só: Gemini → Claude');
  assert.equal(gravadas[0].anterior.id, 'A');
  assert.equal(gravadas[0].nova.id, 'G');
});

test('chat novo (sem conversa) trocando de IA não liga nada, e retomar a mesma conversa também não', () => {
  const { ctx, gravadas } = contextoTroca();
  const P = { engine: 'claude', cwd: '/p', sessaoId: null, resumeId: null, partesAnteriores: [] };
  ctx.guardarParteAnterior(P);
  assert.equal(P.parteAnterior, undefined);
  P.parteAnterior = { engine: 'codex', id: 'C', file: '', cwd: '/p' };
  P.engine = 'codex'; P.sessaoId = 'C';
  ctx.ligarParteAnterior(P);
  assert.equal(gravadas.length, 0, 'mesma conversa (motor e número iguais) não é costura');
});

test('ligação em círculo é recusada já na tela', () => {
  const { ctx, gravadas } = contextoTroca();
  ctx.LIGACOES = lig({ engine: 'claude', id: 'A' }, { engine: 'codex', id: 'C' });   // A continua C
  const P = { engine: 'codex', cwd: '/p', sessaoId: 'C', parteAnterior: { engine: 'claude', id: 'A' }, partesAnteriores: [] };
  ctx.ligarParteAnterior(P);                                    // C continuaria A → círculo
  assert.equal(gravadas.length, 0);
});

/* O trocarMotor DE VERDADE numa VM (antes era só regex no texto dele): a ordem "guardar a
   parte anterior ANTES de zerar o número" é conferida pelo que ele faz, não por onde está escrito. */
function contextoTrocarMotor() {
  const gravadas = [];
  const panes = new Map();
  const ctx = contexto({
    panes, cfg: {}, MOTORES_VISIVEIS: ['claude', 'codex', 'gemini', 'grok'],
    window: { api: { ligacoesGravar: async (o) => { gravadas.push(o); return { ok: true }; },
      paneStop: async () => {}, setConfig() {} } },
    lateralAberta: () => false, pintarConversas() {},
    nomeDoMotor: (m) => m, modeloNovo: (m) => m + '-modelo', esforcoNovo: () => 'medio',
    motorIndisponivelNaPasta: () => '', confirmarCorte: () => true,
    montarContexto: (P) => 'CTX:' + P.hist.map(h => h.texto).join('|'),
  });
  for (const n of ['avisoTemp', 'vozSoltar', 'invalidarConversa', 'marcaTroca', 'limparPlano', 'limparSugestoes',
    'zerarContexto', 'escondePerm', 'devolverFilaAoCampo', 'pararTrabalho', 'limparPassos', 'limparContinuar',
    'fillModels', 'paintEngine', 'pintarModo', 'setDot', 'avisarInstalacaoMotor', 'pintarUso', 'lerUso', 'savePanes',
    'pintarPasta', 'nomePasta', 'pintarNome', 'faixaDeRamo']) ctx[n] = () => {};
  ctx.novoChatNaAba = (engine) => {
    const Q = { id: 'q' + (panes.size + 1), engine, cwd: '', hist: [], partesAnteriores: [], parteAnterior: null,
      blocks: new Map(), tools: new Map() };
    panes.set(Q.id, Q);
    return Q;
  };
  vm.runInContext([pegar('guardarParteAnterior'), pegar('ligarParteAnterior'), pegar('trocarMotor'), pegar('forkClaude')].join('\n'), ctx);
  // o que o evento 'sessao' faz quando o motor novo abre a conversa dele
  const sessao = (P, id) => { P.sessaoId = id; P.resumeId = id; P.sessaoFile = '/x/' + id + '.jsonl'; if (P.parteAnterior) ctx.ligarParteAnterior(P); };
  const painel = (o) => { const P = { id: 'p' + (panes.size + 1), cwd: '/p', hist: [], partesAnteriores: [], parteAnterior: null,
    blocks: new Map(), tools: new Map(), ...o }; panes.set(P.id, P); return P; };
  return { ctx, gravadas, sessao, painel };
}

test('trocarMotor (rodando de verdade) guarda a parte anterior ANTES de zerar o número, e o evento sessao costura', async () => {
  const { ctx, gravadas, sessao, painel } = contextoTrocarMotor();
  const P = painel({ engine: 'claude', sessaoId: 'A', resumeId: 'A', sessaoFile: '/c/A.jsonl',
    hist: [{ quem: 'Você', texto: 'quero o vídeo' }, { quem: 'claude', texto: 'feito' }] });
  await ctx.trocarMotor(P, 'codex');
  assert.equal(P.engine, 'codex');
  assert.equal(P.sessaoId, null, 'o número do Claude não atravessa a troca');
  assert.deepEqual(JSON.parse(JSON.stringify(P.parteAnterior)), { engine: 'claude', id: 'A', file: '/c/A.jsonl', cwd: '/p' },
    'sem guardar antes de zerar, a conversa de antes some da costura');
  assert.equal(P.passarContexto, 'CTX:quero o vídeo|feito', 'e o Codex recebe o contexto do que já foi conversado');
  sessao(P, 'C');
  assert.equal(gravadas.length, 1);
  assert.equal(gravadas[0].nova.id, 'C'); assert.equal(gravadas[0].anterior.id, 'A');
  assert.match(pegar('receberEventoPane'), /case 'sessao': \{[\s\S]{0,400}if \(P\.parteAnterior\) ligarParteAnterior\(P\);/);
});

test('ramificar e trocar de IA antes da 1a mensagem NÃO costura o ramo na conversa de origem', async () => {
  const { ctx, gravadas, sessao, painel } = contextoTrocarMotor();
  const P = painel({ engine: 'claude', sessaoId: 'ORIG', resumeId: 'ORIG', titulo: 'Vídeo',
    hist: [{ quem: 'Você', texto: 'quero o vídeo' }] });
  ctx.forkClaude(P, 'ORIG');                                    // o ramo Q nasce com resumeId = ORIG e forkPendente
  const Q = [...ctx.panes.values()].find(x => x !== P);
  assert.equal(Q.resumeId, 'ORIG'); assert.equal(Q.forkPendente, true);
  await ctx.trocarMotor(Q, 'codex');                            // troca antes de mandar qualquer coisa
  assert.ok(!Q.parteAnterior, 'o resumeId do ramo é o da ORIGEM, que continua viva no outro chat');
  sessao(Q, 'CX');
  assert.equal(gravadas.length, 0, 'nenhuma ligação CX → ORIG: a origem não pode sumir da lista nem ir junto no Apagar');
});

test('ramo pendente trocando de cobrança ou de agente também não costura na origem', () => {
  const { ctx } = contextoTroca();
  const Q = { engine: 'codex', cwd: '/p', sessaoId: null, resumeId: 'ORIG', forkPendente: true, partesAnteriores: [],
    hist: [{ quem: 'Você', texto: 'x' }] };
  ctx.guardarParteAnterior(Q);                                  // menuModelos (troca de cobrança / agente ACP)
  assert.ok(!Q.parteAnterior);
});

test('chat cuja conversa não tem nada na tela (o motor novo não recebe contexto) não costura', () => {
  const { ctx } = contextoTroca();
  const P = { engine: 'claude', cwd: '/p', sessaoId: 'A', resumeId: 'A', partesAnteriores: [], hist: [] };
  ctx.guardarParteAnterior(P);
  assert.ok(!P.parteAnterior, 'costurar juntaria duas conversas que não se conhecem');
});

test('ramificar e conversa nova não herdam a costura', () => {
  // o ramo nasce num painel NOVO (novoChatNaAba → newPane), que nasce sem parte anterior
  assert.match(app, /parteAnterior: null, partesAnteriores: \[\],/);
  for (const nome of ['forkClaude', 'abrirRamo', 'ramificarDaqui']) {
    assert.ok(!/parteAnterior|partesAnteriores/.test(pegar(nome)), nome + ' não pode copiar a costura do chat de origem');
  }
  assert.match(pegar('novaConversa'), /esquecerCadeiaDoPainel\(P\)/);
  assert.match(pegar('conversaDaPastaNova'), /esquecerCadeiaDoPainel\(P\)/);
});

/* ---------------- a lista única: colapso da cadeia ---------------- */

const A = { engine: 'claude', id: 'A', file: '/c/A.jsonl', cwd: '/p', title: 'Quero fazer o vídeo com IA', when: 10 };
const C = { engine: 'codex', id: 'C', file: '/x/C.jsonl', cwd: '/p', title: 'abre a imagem de referência', when: 20 };
const A2 = { engine: 'claude', id: 'A2', file: '/c/A2.jsonl', cwd: '/p', title: 'agora corta', when: 30 };
const S = { engine: 'gemini', id: 'S', file: '/g/S.jsonl', cwd: '/q', title: 'Solta', when: 15 };

test('a parte anterior não aparece sozinha: o item é a mais nova, com título da 1a parte, data da mais nova e as IAs', () => {
  const ctx = contexto();
  ctx.LIGACOES = lig(C, A);
  const lista = ctx.montarCadeias([C, S, A]);
  assert.deepEqual([...lista.map(x => x.id)], ['C', 'S'], 'A some da lista solta: ela é a parte anterior de C');
  const cad = lista[0];
  assert.equal(cad.engine, 'codex', 'o item é a parte MAIS NOVA (o painel abre nela)');
  assert.equal(cad.title, 'Quero fazer o vídeo com IA', 'sem nome salvo, vale o título da primeira parte');
  assert.equal(cad.when, 20);
  assert.deepEqual([...cad.motores], ['claude', 'codex']);
  assert.deepEqual([...cad.partes.map(p => p.id)], ['A', 'C']);
  assert.equal(lista[1].partes, undefined, 'conversa de uma IA só continua sendo o item de sempre');
});

test('Claude → Codex → Claude vira UM item, com os logos em ordem e sem repetir', () => {
  const ctx = contexto();
  ctx.LIGACOES = { ...lig(C, A), ...lig(A2, C) };
  const lista = ctx.montarCadeias([A2, C, S, A]);
  assert.deepEqual([...lista.map(x => x.id)], ['A2', 'S']);
  assert.deepEqual([...lista[0].partes.map(p => p.id)], ['A', 'C', 'A2']);
  assert.deepEqual([...lista[0].motores], ['claude', 'codex'], 'ordem de entrada, sem repetir o Claude');
  assert.deepEqual([...ctx.motoresDaCadeia([A, C, A2, { engine: 'gemini' }, C])], ['claude', 'codex', 'gemini']);
});

test('o nome salvo de qualquer parte (a mais nova primeiro) vale para a cadeia', () => {
  const ctx = contexto();
  ctx.LIGACOES = { ...lig(C, A), ...lig(A2, C) };
  ctx.NOMES_LIGADOS = { A: 'Nome velho', C: 'Criação de Vídeo com IA' };
  assert.equal(ctx.montarCadeias([A2, C, A])[0].title, 'Criação de Vídeo com IA');
  ctx.NOMES_LIGADOS = { A: 'Nome velho' };
  assert.equal(ctx.montarCadeias([A2, C, A])[0].title, 'Nome velho');
});

test('parte apagada no meio da cadeia: a cadeia continua e a primeira parte não duplica', () => {
  const ctx = contexto();
  ctx.LIGACOES = { ...lig(C, A), ...lig(A2, C) };
  const lista = ctx.montarCadeias([A2, A]);                    // o arquivo do Codex sumiu por fora
  assert.deepEqual([...lista.map(x => x.id)], ['A2'], 'A continua dentro da cadeia, não aparece solta');
  assert.deepEqual([...lista[0].partes.map(p => p.id)], ['A', 'C', 'A2']);
  assert.equal(lista[0].partes[1].fantasma, true, 'a parte que sumiu vira fantasma (o histórico dela só não vem)');
});

test('ciclo de ligação (A → B → A) não trava nem some com as conversas', () => {
  const ctx = contexto();
  const B = { engine: 'codex', id: 'B', file: '/x/B.jsonl', cwd: '/p', title: 'B', when: 5 };
  ctx.LIGACOES = { ...lig(A, B), ...lig(B, A) };
  const lista = ctx.montarCadeias([A, B]);
  assert.equal(lista.length, 1, 'as duas viram uma conversa só, e nenhuma some');
  assert.deepEqual([...lista[0].partes.map(p => p.id).sort()], ['A', 'B']);
});

test('Codex com o mesmo id em dois arquivos: a parte anterior é a do ARQUIVO certo', () => {
  const ctx = contexto();
  const C1 = { ...C, file: '/x/C-1.jsonl', title: 'antiga', when: 1 };
  const C2 = { ...C, file: '/x/C-2.jsonl', title: 'outra', when: 2 };
  ctx.LIGACOES = lig(A2, { engine: 'codex', id: 'C', file: '/x/C-2.jsonl', cwd: '/p' });
  const lista = ctx.montarCadeias([A2, C2, C1]);
  assert.deepEqual([...lista.map(x => x.id + ':' + (x.file || ''))], ['A2:/c/A2.jsonl', 'C:/x/C-1.jsonl'],
    'só o arquivo que a ligação aponta entra na cadeia; o irmão continua solto');
  assert.equal(lista[0].partes[0], C2);
});

test('busca: o achado numa parte velha leva ao item da cadeia inteira', () => {
  const ctx = contexto();
  ctx.LIGACOES = lig(C, A);
  const lista = ctx.montarCadeias([C, S, A]);
  const mapa = ctx.mapaDasCadeias(lista);
  assert.equal(mapa.get(A), lista[0], 'achou em A: mostra a cadeia (cabeça C)');
  assert.equal(mapa.get(C), lista[0]);
  assert.equal(mapa.get(S), S);
  assert.match(pegar('paintHist'), /const c = daCadeia\.get\(s\) \|\| s;/);
});

test('logos da conversa: um por IA, na ordem, com o logo oficial (svgMotor)', () => {
  const criados = [];
  const el = () => { const e = { children: [], dataset: {}, appendChild(x) { this.children.push(x); return x; } }; criados.push(e); return e; };
  const ctx = { document: { createElement: el }, svgMotor: (m) => '<svg data-m="' + m + '"></svg>', nomeDoMotor: (m) => m.toUpperCase() };
  vm.createContext(ctx);
  vm.runInContext(pegar('logosDaConversa'), ctx);
  const cx = ctx.logosDaConversa({ engine: 'claude', motores: ['claude', 'codex', 'gemini'] });
  assert.equal(cx.className, 'hi-motores');
  assert.deepEqual(cx.children.map(x => x.dataset.motor), ['claude', 'codex', 'gemini']);
  assert.ok(cx.children.every(x => x.className === 'hi-motor' && /<svg data-m=/.test(x.innerHTML)));
  const so = ctx.logosDaConversa({ engine: 'grok' });
  assert.deepEqual(so.children.map(x => x.dataset.motor), ['grok'], 'conversa de uma IA só mostra 1 logo');
});

test('estrela e grupo ficam no item da cadeia, e a estrela antiga da parte velha continua valendo', () => {
  const ctx = contexto({ cfg: { favoritos: ['claude:A:/c/A.jsonl'], grupoSessao: { 'claude:A:/c/A.jsonl': 'g1' } },
    window: { api: { setConfig() {} } }, repintarGrupos() {} });
  vm.runInContext([pegarConst('chavesDaConversa'), pegarConst('ehFavorita')].join('\n')
    + '\nthis.ehFavorita = ehFavorita;\n' + pegar('trocarFavorita') + '\n' + pegar('grupoDaSessao') + '\n' + pegar('moverParaGrupo'), ctx);
  ctx.LIGACOES = lig(C, A);
  const cad = ctx.montarCadeias([C, A])[0];
  assert.equal(ctx.ehFavorita(cad), true, 'favoritada antes da troca: continua no topo');
  assert.equal(ctx.grupoDaSessao(cad), 'g1');
  ctx.moverParaGrupo(cad, 'g2');
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.cfg.grupoSessao)), { 'codex:C:/x/C.jsonl': 'g2' }, 'o grupo vai para a parte mais nova');
  ctx.trocarFavorita(cad);
  assert.deepEqual([...ctx.cfg.favoritos], [], 'tirar a estrela tira de todas as partes');
  ctx.trocarFavorita(cad);
  assert.deepEqual([...ctx.cfg.favoritos], ['codex:C:/x/C.jsonl']);
});

/* ---------------- abrir a cadeia: ordem do histórico ---------------- */

function contextoDesenho() {
  const ctx = { console, Promise, feito: [], NA_VPS: (c) => String(c).startsWith('vps:') };
  vm.createContext(ctx);
  ctx.nomeDoMotor = (m) => ({ claude: 'Claude', codex: 'Codex' }[m] || m);
  ctx.marcaTroca = (P, de, para) => ctx.feito.push('troca:' + de + '>' + para);
  ctx.renderizarHistorico = (P, m) => {
    ctx.feito.push(P.engine + ':' + m.text);
    P.hist.push({ quem: m.role === 'user' ? 'Você' : ctx.nomeDoMotor(P.engine), texto: m.text });
  };
  vm.runInContext([pegar('lerHistoricoDaParte'), pegar('lerPartes'), pegar('desenharPartes')].join('\n'), ctx);
  return ctx;
}

test('ordem de carregar: da parte mais velha para a mais nova, com a faixa de troca entre IAs diferentes', async () => {
  const ctx = contextoDesenho();
  const pedidos = [];
  ctx.window = { api: {
    sessionHistory: async (o) => { pedidos.push(o.engine + ':' + o.id);
      return { A: [{ role: 'user', text: 'pedido 1' }, { role: 'bot', text: 'resp claude' }],
        C: [{ role: 'user', text: 'pedido 2' }, { role: 'bot', text: 'resp codex' }],
        A2: [{ role: 'user', text: 'pedido 3' }] }[o.id]; },
    sessionHistoryRemoto: async () => [],
  } };
  const P = { engine: 'claude', hist: [] };
  const lidas = await ctx.lerPartes([A, C, A2]);
  assert.equal(ctx.desenharPartes(P, lidas), 5);
  assert.deepEqual([...ctx.feito], ['claude:pedido 1', 'claude:resp claude', 'troca:Claude>Codex',
    'codex:pedido 2', 'codex:resp codex', 'troca:Codex>Claude', 'claude:pedido 3']);
  assert.deepEqual(P.hist.map(h => h.quem), ['Você', 'Claude', 'Você', 'Codex', 'Você'],
    'o P.hist recebe TODAS as mensagens, cada resposta com o nome da IA que respondeu');
  assert.equal(P.engine, 'claude', 'o painel volta para o motor dele depois de desenhar');
});

test('uma parte que falha (ou sumiu) não derruba as outras', async () => {
  const ctx = contextoDesenho();
  ctx.window = { api: { sessionHistory: async (o) => { if (o.id === 'C') throw new Error('ilegível'); return [{ role: 'bot', text: o.id }]; } } };
  const P = { engine: 'claude', hist: [] };
  const lidas = await ctx.lerPartes([A, C, A2]);
  assert.ok(lidas[1].erro);
  ctx.desenharPartes(P, lidas);
  assert.deepEqual([...ctx.feito], ['claude:A', 'claude:A2'], 'sem faixa de troca à toa quando a parte do meio não veio');
});

test('parte do Claude que rodou na VPS continua vindo da VPS', async () => {
  const ctx = contextoDesenho();
  const chamou = [];
  ctx.window = { api: { sessionHistory: async (o) => { chamou.push('mac:' + o.id); return []; },
    sessionHistoryRemoto: async (o) => { chamou.push('vps:' + o.id); return []; } } };
  await ctx.lerPartes([{ engine: 'claude', id: 'R', cwd: 'vps:/opt' }, { engine: 'codex', id: 'X', cwd: 'vps:/opt' }]);
  assert.deepEqual(chamou.sort(), ['mac:X', 'vps:R']);
});

function contextoAbrir() {
  const panes = new Map();
  const el = () => ({ style: {}, classList: { add() {}, remove() {} }, dataset: {}, nodes: {}, focus() {}, querySelectorAll: () => [] });
  const ctx = { console, Promise, panes, focusPane: null, window: { api: {} }, feito: [] };
  vm.createContext(ctx);
  Object.assign(ctx, {
    document: { querySelectorAll: () => [], body: { classList: { remove() {} } } },
    NA_VPS: () => false, abaDoCaminho: () => ({}), nomePasta: x => x,
    newPane: (o) => { const P = { id: 'p' + (panes.size + 1), busy: false, hist: [], blocks: new Map(), tools: new Map(),
      el: el(), chat: el(), ...o }; panes.set(P.id, P); return P; },
    invalidarConversa() {}, painelAindaAtual: () => true, escondePerm() {}, fillModels() {}, paintEngine() {},
    setDot() {}, pintarPasta() {}, mostrarPastaNoPainel() {}, atualizarGit() {}, pintarModo() {}, pintarNome() {},
    setFocus: (P) => { ctx.focusPane = P; }, savePanes() {}, marcarAbertas() {}, note() {}, scroll() {},
    limparPlano() {}, limparSugestoes() {}, piscar() {}, ico: () => '', $: () => el(), $$: () => [],
    renderizarHistorico: (P, m) => ctx.feito.push(P.engine + ':' + m.text),
    marcaTroca: () => ctx.feito.push('troca'), nomeDoMotor: m => m,
  });
  vm.runInContext([pegarConst('refDaParte'), pegar('lerHistoricoDaParte'), pegar('lerPartes'), pegar('desenharPartes'),
    pegar('openSession')].join('\n') + '\nthis.openSession = openSession;', ctx);
  ctx.partesDaCadeia = (s) => [s];
  ctx.window.api.sessionHistory = async (o) => [{ role: 'bot', text: o.id }];
  return ctx;
}

test('abrir o item da cadeia: histórico de todas as partes num painel só, parado na parte MAIS NOVA', async () => {
  const ctx = contextoAbrir();
  const item = { ...C, title: 'Vídeo com IA', partes: [A, C], motores: ['claude', 'codex'] };
  const P = await ctx.openSession(item, null);
  assert.equal(ctx.panes.size, 1);
  assert.deepEqual([...ctx.feito], ['claude:A', 'troca', 'codex:C']);
  assert.equal(P.engine, 'codex'); assert.equal(P.resumeId, 'C'); assert.equal(P.sessaoFile, '/x/C.jsonl');
  assert.equal(P.titulo, 'Vídeo com IA');
  assert.deepEqual([...P.partesAnteriores.map(p => p.id)], ['A'], 'trocar de novo continua a MESMA cadeia');
  assert.equal(P.carregandoHistorico, false);
});

test('número solto (reabrir fechado, celular) acha a cadeia pelas ligações', async () => {
  const ctx = contextoAbrir();
  ctx.partesDaCadeia = (s) => [A, s];
  await ctx.openSession({ engine: 'codex', id: 'C', file: '/x/C.jsonl', cwd: '/p', title: 't' }, null);
  assert.deepEqual([...ctx.feito], ['claude:A', 'troca', 'codex:C']);
});

/* O restaurarAbasCorpo DE VERDADE numa VM, com partesDaCadeia, lerPartes e desenharPartes reais
   (antes era só regex no texto dele: uma troca de nome ou de ordem passava calada). */
function contextoReabrir(chats, ligacoes, historicos) {
  const panes = new Map(), abas = new Map();
  const ctx = contexto({ panes, abas, cfg: { abaAberta: 0 }, HOME: '/h', clienteQueEstavaAberto: '', abasQueNaoVoltaram: [],
    feito: [], window: { api: {} } });
  ctx.LIGACOES = ligacoes;
  Object.assign(ctx, {
    NA_VPS: () => false, clienteDe: () => '', mostrarPastaNoPainel() {}, pintarNome() {}, ativarAbaProjeto() {},
    removerAbaVazia() {}, painelAindaAtual: () => true, clearEmpty() {}, scroll() {}, ico: () => '',
    $: () => null, $$: () => [], nomeDoMotor: (m) => m,
    note: (P, t) => P.notas.push(t),
    marcaTroca: (P, de, para) => ctx.feito.push('troca:' + de + '>' + para),
    montarContexto: (P) => 'CTX:' + P.hist.map(h => h.texto).join('|'),
    renderizarHistorico: (P, m) => { ctx.feito.push(P.engine + ':' + m.text); P.hist.push({ quem: m.role === 'user' ? 'Você' : P.engine, texto: m.text }); },
    novaAbaProjeto: (cwd) => { const A = { id: 'a' + (abas.size + 1), cwd, ordem: [] }; abas.set(A.id, A); return A; },
    newPane: (o) => { const P = { id: 'p' + (panes.size + 1), engine: o.engine, cwd: o.cwd, titulo: o.titulo || '', hist: [],
      partesAnteriores: [], parteAnterior: null, passarContexto: null, notas: [], chat: {}, el: {} };
      panes.set(P.id, P); o.aba.ordem.push(P.id); return P; },
  });
  ctx.window.api.sessionHistory = async (o) => historicos[o.id] || [];
  vm.runInContext([pegar('lerHistoricoDaParte'), pegar('lerPartes'), pegar('desenharPartes'), pegar('restaurarAbasCorpo')].join('\n')
    + '\nthis.restaurarAbasCorpo = restaurarAbasCorpo;', ctx);
  return ctx;
}
const HIST = { A: [{ role: 'user', text: 'pedido 1' }, { role: 'bot', text: 'resp claude' }],
  C: [{ role: 'user', text: 'pedido 2' }, { role: 'bot', text: 'resp codex' }],
  ORIG: [{ role: 'user', text: 'origem' }], X: [{ role: 'user', text: 'antes da origem' }] };

test('reabrir o app: chat com conversa costurada volta com TODAS as partes, parado na mais nova', async () => {
  const ctx = contextoReabrir(null, lig(C, A), HIST);
  await ctx.restaurarAbasCorpo([{ cwd: '/p', chats: [{ engine: 'codex', cwd: '/p', sessao: 'C', arquivo: '/x/C.jsonl' }] }]);
  const P = [...ctx.panes.values()][0];
  assert.deepEqual([...ctx.feito], ['claude:pedido 1', 'claude:resp claude', 'troca:claude>codex', 'codex:pedido 2', 'codex:resp codex']);
  assert.equal(P.engine, 'codex'); assert.equal(P.resumeId, 'C');
  assert.deepEqual([...P.partesAnteriores.map(p => p.id)], ['A']);
  assert.ok(!P.parteAnterior);
  assert.equal(P.passarContexto, null, 'o Codex já tem a conversa dele: nada de contexto colado de novo');
  assert.equal(P.carregandoHistorico, false);
});

test('reabrir o app: trocou de IA e fechou ANTES de mandar — volta a cadeia, a faixa da troca e o contexto', async () => {
  const ctx = contextoReabrir(null, lig(C, A), HIST);
  // o chat estava no Gemini, esperando a 1a mensagem; a parte de antes era a C (que continua A)
  await ctx.restaurarAbasCorpo([{ cwd: '/p', chats: [{ engine: 'gemini', cwd: '/p', sessao: '',
    parteAnterior: { engine: 'codex', id: 'C', file: '/x/C.jsonl', cwd: '/p' } }] }]);
  const P = [...ctx.panes.values()][0];
  assert.deepEqual([...ctx.feito], ['claude:pedido 1', 'claude:resp claude', 'troca:claude>codex', 'codex:pedido 2',
    'codex:resp codex', 'troca:codex>gemini']);
  assert.equal(P.parteAnterior.id, 'C', 'a costura pendente volta: a próxima mensagem grava Gemini → C');
  assert.deepEqual([...P.partesAnteriores.map(p => p.id)], ['A']);
  assert.equal(P.passarContexto, 'CTX:pedido 1|resp claude|pedido 2|resp codex', 'o Gemini recebe o que já foi conversado');
  assert.ok(P.notas.includes('— daqui pra baixo é a conversa de agora —'));
});

test('reabrir o app: ramo pendente volta como ramo, sem herdar a cadeia da origem', async () => {
  const ctx = contextoReabrir(null, lig({ engine: 'claude', id: 'ORIG' }, { engine: 'codex', id: 'X' }), HIST);
  await ctx.restaurarAbasCorpo([{ cwd: '/p', chats: [{ engine: 'claude', cwd: '/p', sessao: 'ORIG', arquivo: '/c/ORIG.jsonl', fork: true }] }]);
  const P = [...ctx.panes.values()][0];
  assert.equal(P.forkPendente, true);
  assert.deepEqual([...P.partesAnteriores], [], 'o número guardado é o da ORIGEM: o ramo não herda a costura dela');
  assert.deepEqual([...ctx.feito], ['claude:origem']);
});

test('o celular, ao voltar, relê a cadeia inteira (senão apagava da tela as outras IAs)', () => {
  assert.match(mobile, /lerPartes\(\[\.\.\.antes, \{ engine, id/);
});

/* ---------------- apagar a cadeia ---------------- */

test('apagar o item da cadeia manda TODAS as partes para a Lixeira e limpa estrela e grupo de cada uma', async () => {
  const apagadas = [];
  const ctx = {
    console, panes: new Map(), window: { api: {} },
    cfg: { abas: [{ chats: [{ sessao: 'C', arquivo: '/x/C.jsonl' }] }], favoritos: ['claude:A:/c/A.jsonl'], grupoSessao: { 'codex:C:/x/C.jsonl': 'g' } },
    histCache: { claude: [A, S], codex: [C] }, LIGACOES: lig(C, A), NOMES_LIGADOS: { A: 'x' },
  };
  vm.createContext(ctx);
  ctx.confirm = () => true;
  ctx.window.api.apagarSessao = async (o) => { apagadas.push(o.engine + ':' + o.id); return { ok: true }; };
  ctx.window.api.paneStop = async () => {}; ctx.window.api.setConfig = () => {};
  for (const n of ['note', 'pararTrabalho', 'limparPassos', 'limparContinuar', 'escondePerm', 'setDot', 'savePanes',
    'repintarGrupos', 'marcarAbertas', 'esquecerCadeiaDoPainel']) ctx[n] = () => {};
  vm.runInContext([pegarConst('chaveFav'), pegar('apagarConversa'), pegar('esquecerParteApagada'), pegar('esquecerLigacoesLocais')].join('\n')
    + '\nthis.apagarConversa = apagarConversa;', ctx);
  await ctx.apagarConversa({ ...C, title: 'Vídeo', partes: [A, C] }, null);
  assert.deepEqual(apagadas, ['claude:A', 'codex:C']);
  assert.deepEqual(ctx.histCache.claude.map(x => x.id), ['S'], 'a parte velha não reaparece solta');
  assert.deepEqual(ctx.histCache.codex, []);
  assert.deepEqual([...ctx.cfg.favoritos], []);
  assert.deepEqual(Object.keys(ctx.cfg.grupoSessao), []);
  assert.deepEqual(Object.keys(ctx.LIGACOES), [], 'a costura sai junto');
  assert.equal(ctx.cfg.abas[0].chats[0].sessao, '', 'a aba gravada não tenta retomar a conversa apagada');
});

/* ---------------- a lateral é uma vista só ---------------- */

test('a barra de ícones tem UM botão de conversas no lugar dos 4 logos, no Mac e no celular', () => {
  for (const arq of ['index.html', 'index-web.html']) {
    const html = fs.readFileSync(path.join(__dirname, '../renderer', arq), 'utf8');
    assert.equal((html.match(/data-view="conversas"/g) || []).length, 2, arq + ': o botão e a vista');
    assert.ok(!/data-view="h(claude|codex|acp|gemini|grok)"/.test(html), arq + ': nada das vistas por motor');
    for (const v of ['torre', 'rotinas', 'settings']) assert.ok(html.includes('data-view="' + v + '"'), arq + ': ' + v + ' continua');
    assert.match(html, /id="histTodas"/);
    assert.match(html, /id="cvUso"/);
  }
  // atalhos e celular abrem a vista única
  assert.match(pegar('abrirBuscaDeConversa'), /x\.dataset\.view !== 'conversas'/);
  assert.match(app, /const alvo = vistaTelefone \|\| 'conversas';/);
});
