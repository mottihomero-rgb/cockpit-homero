'use strict';
// Nome simples dos agentes do time (26/09/2026). O Homero via no cartao de cada agente o nome
// tecnico do motor ("code-reviewer-1", "Explore codebase for auth flow") e uma linha em letra de
// maquina com comando e caminho de arquivo, e nao entendia quem fazia o que. Agora o cartao diz so
// um titulo de 2 palavras e uma linha curta, escritos pelo Haiku num lote so. Aqui ficam presos:
// a linha de comando (Haiku, sem ferramenta, sem gravar sessao), o texto do lote, a validacao do
// que a IA devolve, o canal do main, o lote do renderer (um no ar, sem tentar de novo) e o cartao
// sem a linha tecnica.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const na = require('../nomes-agentes.js');
const { loadMain } = require('./main-harness.cjs');

const raiz = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(raiz, 'renderer/app.js'), 'utf8');
const esperar = () => new Promise(r => setImmediate(r));
// o que volta de dentro da VM (ou do main carregado nela) tem outro Object/Array: compara pelo conteudo
const plano = (x) => JSON.parse(JSON.stringify(x));
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }

/* ---------- recortes do app.js real ---------- */
function pegar(nome) {
  const m = new RegExp('^(?:async )?function ' + nome + '\\(', 'm').exec(app);
  assert.ok(m, 'a funcao ' + nome + ' tem de existir no app.js');
  const abre = app.indexOf('{', m.index);
  let n = 0, i = abre;
  for (; i < app.length; i++) {
    if (app[i] === '{') n++;
    else if (app[i] === '}' && --n === 0) { i++; break; }
  }
  return app.slice(m.index, i);
}
// const/let de uma linha, ate o primeiro ";" (a linha pode ter comentario depois)
function pegarLinha(inicio) {
  const m = new RegExp('^' + inicio.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[^;]*;', 'm').exec(app);
  assert.ok(m, inicio + ' tem de existir no app.js');
  return m[0].replace(/^(const|let) /, 'var ');
}
// objeto de varias linhas (const X = { ... };), recortado por contagem de chaves
function pegarObjeto(nome) {
  const i = app.indexOf('\nconst ' + nome + ' = {');
  assert.ok(i >= 0, nome + ' tem de existir no app.js');
  const abre = app.indexOf('{', i);
  let n = 0, j = abre;
  for (; j < app.length; j++) {
    if (app[j] === '{') n++;
    else if (app[j] === '}' && --n === 0) { j++; break; }
  }
  return 'var ' + nome + ' = ' + app.slice(abre, j) + ';';
}

/* ================= o modulo ================= */
test('linha de comando: Haiku, sem ferramenta, sem MCP, sem CLAUDE.md e sem gravar sessao', () => {
  const args = na.argsDosAgentes('PEDIDO');
  const depois = (flag) => args[args.indexOf(flag) + 1];
  assert.equal(args[0], '-p');
  assert.equal(depois('--model'), 'haiku');
  assert.ok(args.includes('--no-session-persistence'), 'sem isto a chamada vira uma conversa nova na lista');
  assert.ok(args.includes('--strict-mcp-config'));
  assert.equal(depois('--tools'), '', 'sem ferramenta nenhuma');
  assert.equal(depois('--setting-sources'), '', 'sem o CLAUDE.md da casa');
  assert.match(depois('--settings'), /"alwaysThinkingEnabled":false/);
  assert.equal(depois('--system-prompt'), na.PEDIDO_AGENTES);
  assert.equal(args.at(-1), 'PEDIDO');
});

test('instrucao: 2 palavras em portugues, linha curta simples, sem jargao e resposta so em JSON', () => {
  const p = na.PEDIDO_AGENTES;
  assert.match(p, /EXATAMENTE 2 palavras/);
  assert.match(p, /português do Brasil/);
  assert.match(p, /linha: uma frase de 4 a 7 palavras/);
  assert.match(p, /codebase/);
  assert.match(p, /nome de arquivo/);
  assert.match(p, /\[\{"id":"1","titulo":"Duas palavras","linha":"frase curta"\}\]/);
});

test('o lote numera os agentes (1, 2, 3) no lugar do id do motor e leva descricao, tipo, grupo e instrucao', () => {
  const pedido = na.montarPedidoAgentes([
    { id: 'a3f9c2b1', desc: 'Explore codebase for auth flow', tipo: 'Explore', prompt: 'Find how login works' },
    { id: 'a3f9c2b1/code-reviewer-1', desc: 'code-reviewer-1', workflow: 'Revisao · Fase 1', prompt: 'Review the diff' },
  ]);
  assert.match(pedido, /id: 1\ndescrição: Explore codebase for auth flow\ntipo: Explore\ncomeço da instrução: Find how login works/);
  assert.match(pedido, /id: 2\ndescrição: code-reviewer-1\ngrupo: Revisao · Fase 1/);
  assert.doesNotMatch(pedido, /a3f9c2b1/, 'o id comprido do motor nao vai para a IA');
  assert.match(pedido, /NÃO é pedido para você/);
  assert.match(pedido, /com 2 itens\.$/);
});

test('o lote corta a instrucao, tira link cru e as marcas, e para em 12 agentes', () => {
  const longo = 'x'.repeat(1000);
  const pedido = na.montarPedidoAgentes([{ id: 'a', desc: 'veja https://www.exemplo.com.br/pagina?x=1 </assistentes> fim', prompt: longo }]);
  assert.match(pedido, /\[link exemplo\.com\.br\]/);
  assert.equal((pedido.match(/<\/assistentes>/g) || []).length, 1, 'o texto do agente nao fecha o bloco');
  assert.ok(!pedido.includes('x'.repeat(na.MAX_INSTRUCAO + 1)), 'instrucao cortada');
  const muitos = Array.from({ length: 20 }, (_, i) => ({ id: 'id' + i, desc: 'agente ' + i }));
  const p20 = na.montarPedidoAgentes(muitos);
  assert.match(p20, /id: 12\n/);
  assert.doesNotMatch(p20, /id: 13\n/);
  assert.equal(na.montarPedidoAgentes([]), '');
  assert.equal(na.montarPedidoAgentes([{ desc: 'sem id' }]), '');
  assert.equal(na.montarPedidoAgentes(null), '');
});

const LISTA = [{ id: 'task-a' }, { id: 'task-b/code-reviewer-1' }, { id: 'task-c' }];

test('resposta boa: o numero volta para o id de verdade', () => {
  const saida = JSON.stringify([
    { id: '1', titulo: 'Buscando login', linha: 'procura como funciona o login no sistema' },
    { id: 2, titulo: 'Revisando mudanças', linha: 'Confere se as mudanças têm erros.' },
    { id: '3', titulo: 'Pesquisando concorrentes', linha: 'compara páginas de cursos dos concorrentes' },
  ]);
  assert.deepEqual(na.interpretarAgentes(saida, LISTA), {
    'task-a': { titulo: 'Buscando login', linha: 'procura como funciona o login no sistema' },
    'task-b/code-reviewer-1': { titulo: 'Revisando mudanças', linha: 'confere se as mudanças têm erros' },
    'task-c': { titulo: 'Pesquisando concorrentes', linha: 'compara páginas de cursos dos concorrentes' },
  });
});

test('resposta em bloco de codigo ou embrulhada num objeto tambem vale', () => {
  const cercado = '```json\n[{"id":"1","titulo":"Revisando página","linha":"confere se os botões levam ao checkout"}]\n```';
  assert.deepEqual(na.interpretarAgentes(cercado, LISTA),
    { 'task-a': { titulo: 'Revisando página', linha: 'confere se os botões levam ao checkout' } });
  const embrulho = '{"agentes":[{"id":"2","titulo":"Buscando arquivos","linha":"procura os testes do sistema"}]}';
  assert.deepEqual(na.interpretarAgentes(embrulho, LISTA),
    { 'task-b/code-reviewer-1': { titulo: 'Buscando arquivos', linha: 'procura os testes do sistema' } });
  const porChave = '{"3":{"titulo":"Escrevendo e-mails","linha":"escreve os e-mails do lançamento"}}';
  assert.deepEqual(na.interpretarAgentes(porChave, LISTA),
    { 'task-c': { titulo: 'Escrevendo e-mails', linha: 'escreve os e-mails do lançamento' } });
  // texto antes da lista (a IA explicou) nao derruba a leitura
  assert.deepEqual(Object.keys(na.interpretarAgentes('Claro! Aqui está:\n[{"id":"1","titulo":"Lendo textos","linha":"lê os textos da página"}]', LISTA)), ['task-a']);
});

test('titulo que nao serve derruba o item (fica o nome local)', () => {
  const itens = [
    { id: '1', titulo: 'Revisando a página do checkout', linha: 'confere a página' },   // mais de 2 palavras
    { id: '2', titulo: 'Revisão', linha: 'confere a página' },                          // 1 palavra
    { id: '3', titulo: 'Reviewing code', linha: 'confere a página' },                   // ingles
  ];
  assert.deepEqual(na.interpretarAgentes(JSON.stringify(itens), LISTA), {});
  for (const ruim of ['Explorando codebase', 'Lendo app.js', 'Rodando grep', 'Refatorando sistema', 'Pesquisando concorrentesssssss',
    'Revisando diff', 'code_reviewer 1', 'Agent teste', '', null, 42]) {
    assert.equal(na.validarTitulo(ruim), '', JSON.stringify(ruim) + ' nao pode virar titulo');
  }
  assert.equal(na.validarTitulo('"revisando página."'), 'Revisando página', 'aspas e ponto saem, maiuscula na frente');
  assert.equal(na.validarTitulo('**Escrevendo copy**'), 'Escrevendo copy');
  assert.equal(na.validarTitulo('Lendo PDFs'), 'Lendo PDFs');
});

test('linha que nao serve vira vazia (o cartao usa a frase local), sem derrubar o titulo', () => {
  const saida = JSON.stringify([
    { id: '1', titulo: 'Revisando mudanças', linha: 'roda npm test e confere renderer/app.js' },
    { id: '2', titulo: 'Buscando arquivos', linha: 'procura em todos os arquivos do sistema os lugares onde o login é usado hoje' },
  ]);
  assert.deepEqual(na.interpretarAgentes(saida, LISTA), {
    'task-a': { titulo: 'Revisando mudanças', linha: '' },
    'task-b/code-reviewer-1': { titulo: 'Buscando arquivos', linha: '' },
  });
  for (const ruim of ['lê o index.html', 'roda o `grep`', 'checks the page', 'faz o commit', 'abre ~/Desktop/x', 'ok']) {
    assert.equal(na.validarLinha(ruim), '', JSON.stringify(ruim) + ' nao pode virar linha');
  }
  assert.equal(na.validarLinha('Confere se os botões levam ao checkout.'), 'confere se os botões levam ao checkout');
  assert.equal(na.validarLinha('PDF do curso com erro'), 'PDF do curso com erro', 'sigla no comeco fica como veio');
});

test('resposta que nao e JSON, id fora da lista ou repetido: nada entra', () => {
  assert.deepEqual(na.interpretarAgentes('', LISTA), {});
  assert.deepEqual(na.interpretarAgentes('Não consigo ajudar com isso.', LISTA), {});
  assert.deepEqual(na.interpretarAgentes('[{"id":"1","titulo":"Buscando', LISTA), {});
  assert.deepEqual(na.interpretarAgentes('[{"id":"9","titulo":"Buscando login","linha":"procura o login"}]', LISTA), {});
  assert.deepEqual(na.interpretarAgentes('[{"id":"__proto__","titulo":"Buscando login","linha":"procura o login"}]'), {});
  const dois = na.interpretarAgentes('[{"id":"1","titulo":"Buscando login","linha":"procura o login"},{"id":"1","titulo":"Lendo textos","linha":"lê os textos"}]', LISTA);
  assert.deepEqual(dois, { 'task-a': { titulo: 'Buscando login', linha: 'procura o login' } }, 'o primeiro fica');
  // sem a lista, vale o id que a IA devolveu
  assert.deepEqual(na.interpretarAgentes('[{"id":"x1","titulo":"Lendo textos","linha":"lê os textos"}]'),
    { x1: { titulo: 'Lendo textos', linha: 'lê os textos' } });
});

/* ================= o main ================= */
test('main: agentes:nomes chama o Haiku com a linha do modulo e devolve o nome pelo id de verdade', async () => {
  const h = loadMain();
  h.put(h.HOME + '/.local/bin/claude', '#!/bin/sh');
  const pronto = h.call('agentes:nomes', { agentes: [
    { id: 'task-a', desc: 'Explore codebase for auth flow', tipo: 'Explore', prompt: 'Find how login works' },
    { id: 'task-b/code-reviewer-1', desc: 'code-reviewer-1', workflow: 'Revisao' },
  ] });
  await esperar();
  const rec = h.spawned.at(-1);
  assert.ok(rec, 'chamou o claude');
  assert.equal(rec.bin, h.HOME + '/.local/bin/claude');
  assert.deepEqual(rec.args.slice(0, -1), na.argsDosAgentes('').slice(0, -1));
  assert.match(rec.args.at(-1), /Explore codebase for auth flow/);
  rec.proc.stdout.emit('data', Buffer.from('[{"id":"1","titulo":"Buscando login","linha":"procura como funciona o login"},'
    + '{"id":"2","titulo":"Revisando mudanças","linha":"confere se há erros nas mudanças"}]'));
  rec.proc.emit('close', 0);
  assert.deepEqual(plano(await pronto), {
    'task-a': { titulo: 'Buscando login', linha: 'procura como funciona o login' },
    'task-b/code-reviewer-1': { titulo: 'Revisando mudanças', linha: 'confere se há erros nas mudanças' },
  });
});

test('main: falha, lista vazia ou sem Claude devolvem {} (fica o nome local); mais de 12 vai cortado', async () => {
  const h = loadMain();
  assert.deepEqual(plano(await h.call('agentes:nomes', { agentes: [{ id: 'a', desc: 'x' }] })), {}, 'sem o claude instalado');
  h.put(h.HOME + '/.local/bin/claude', '#!/bin/sh');
  assert.deepEqual(plano(await h.call('agentes:nomes', { agentes: [] })), {});
  assert.deepEqual(plano(await h.call('agentes:nomes', null)), {});
  const antes = h.spawned.length;
  assert.equal(antes, 0, 'sem agente nao chama a IA');
  const pronto = h.call('agentes:nomes', { agentes: Array.from({ length: 20 }, (_, i) => ({ id: 'id' + i, desc: 'agente ' + i })) });
  await esperar();
  const rec = h.spawned.at(-1);
  assert.match(rec.args.at(-1), /com 12 itens/);
  rec.proc.stderr.emit('data', Buffer.from('erro'));
  rec.proc.emit('close', 1);
  assert.deepEqual(plano(await pronto), {});
});

test('canal ligado nas pontas: preload, ponte do celular, lista branca e empacotamento', () => {
  const ler = (f) => fs.readFileSync(path.join(raiz, f), 'utf8');
  assert.match(ler('preload.js'), /agentesNomes: \(o\) => ipcRenderer\.invoke\('agentes:nomes', o\)/);
  assert.match(ler('renderer/web.js'), /agentesNomes: \(o\) => chamar\('agentes:nomes', o\)/);
  assert.match(ler('servidor-web.js'), /'agentes:nomes'/);
  const pkg = JSON.parse(ler('package.json'));
  assert.ok(pkg.build.files.includes('nomes-agentes.js'), 'sem ele o main nao abre no app empacotado');
});

/* ================= o renderer ================= */
function novoEl() {
  return { className: '', textContent: '', title: '', children: [], appendChild(x) { this.children.push(x); return x; } };
}
function caixaRenderer(extra = {}) {
  const ctx = {
    console, Date, Math, String, Object, Array, Map, Set, Promise,
    soNome: (x) => String(x || '').split('/').pop(), TOOL_PT: {},
    document: { createElement: novoEl },
    window: { api: {} },
    ...extra,
  };
  vm.createContext(ctx);
  const funcs = ['agEl', 'agCartaoAgente', 'agNomeDoCartao', 'agTituloLocal', 'agTresPalavras', 'agLinhaLocal',
    'agFazendo', 'fraseCrua', 'toolLabel', 'agNomeFerramenta', 'agBonito', 'agNomeAgente', 'agTempo', 'tempoCurto',
    'agTokens', 'agChaveAgente', 'agLinhasDoCartao', 'agNomesColetar', 'agNomesAgendar', 'agNomesBuscar', 'agNomesRepintar'];
  vm.runInContext([
    pegarObjeto('AG_FERR_PT'), pegarObjeto('AG_MCP_PT'), pegarObjeto('AG_AGENTE_PT'),
    pegarLinha('const AG_VERBO_DO_PASSO = '), pegarLinha('const AG_NOMES = '), pegarLinha('const AG_NOMES_PEDIDOS = '),
    pegarLinha('const AG_NOMES_FILA = '), pegarLinha('const AG_NOMES_LOTE = '), pegarLinha('const AG_NOMES_ESPERA = '),
    pegarLinha('const AG_NOMES_TETO = '), pegarLinha('let agNomesTimer = '),
    ...funcs.map(pegar),
  ].join('\n'), ctx);
  return ctx;
}
// todas as classes de uma arvore de elementos falsos
function classes(el, out = []) { out.push(el.className); for (const c of el.children || []) classes(c, out); return out; }
function texto(el, classe) {
  if (String(el.className).split(' ').includes(classe)) return el.textContent;
  for (const c of el.children || []) { const t = texto(c, classe); if (t != null) return t; }
  return null;
}

test('cartao do painel: so titulo e linha simples, sem a linha tecnica, e o mouse mostra a mesma frase', () => {
  const c = caixaRenderer();
  const agente = { i: 1, rotulo: 'code-reviewer-1', estado: 'progress', ferramenta: 'Bash',
    detalhe: 'npm test -- tests/passos-redesenho.test.cjs', pedido: 'Review the diff in renderer/app.js', tokens: 1200, chamadas: 3, duracao: 62000 };
  // antes do Haiku responder: o nome local, em no maximo 3 palavras, e a frase de gente da ferramenta
  let card = c.agCartaoAgente(agente, Date.now(), 'task-b/code-reviewer-1');
  assert.ok(!classes(card).some(k => /ag-detalhe/.test(k)), 'a linha tecnica saiu do cartao');
  assert.equal(texto(card, 'ag-nome'), 'Code reviewer 1');
  assert.equal(texto(card, 'ag-fazendo'), 'Rodando um comando');
  assert.doesNotMatch(card.title, /Review the diff|renderer/, 'a instrucao em ingles nao vai para o mouse');
  assert.match(texto(card, 'ag-pe'), /1m 02s/);
  // o Haiku respondeu: titulo de 2 palavras e a linha curta
  c.AG_NOMES.set('task-b/code-reviewer-1', { titulo: 'Revisando mudanças', linha: 'confere se há erros nas mudanças' });
  card = c.agCartaoAgente(agente, Date.now(), 'task-b/code-reviewer-1');
  assert.equal(texto(card, 'ag-nome'), 'Revisando mudanças');
  assert.equal(texto(card, 'ag-fazendo'), 'confere se há erros nas mudanças');
  assert.equal(card.title, 'confere se há erros nas mudanças');
  assert.ok(!classes(card).some(k => /ag-detalhe/.test(k)));
});

test('linha local: frase de gente da ferramenta, e pronto/erro/fila como o resto do app', () => {
  const c = caixaRenderer();
  assert.equal(c.agLinhaLocal('agora', 'Read'), 'Lendo um arquivo');
  assert.equal(c.agLinhaLocal('agora', 'Grep'), 'Procurando no código');
  assert.equal(c.agLinhaLocal('agora', 'mcp__playwright__browser_navigate'), 'Abrindo uma página');
  assert.equal(c.agLinhaLocal('agora', ''), 'Pensando');
  assert.equal(c.agLinhaLocal('pronto', 'Read'), 'Pronto');
  assert.equal(c.agLinhaLocal('erro', 'Bash'), 'Deu erro');
  assert.equal(c.agLinhaLocal('espera', ''), 'Na fila');
  // titulo local do agente solto: o tipo traduzido, ou o comeco da descricao (3 palavras)
  assert.equal(c.agTituloLocal({ tipo: 'Explore', desc: 'Explore codebase for auth flow' }), 'Explorador');
  assert.equal(c.agTituloLocal({ tipo: '', desc: 'Explore codebase for auth flow' }), 'Explore codebase for');
  assert.equal(c.agTituloLocal({ tipo: '', desc: '' }), 'Agente');
});

test('cartao da conversa: cada linha e titulo + frase curta; nada de "· em que" em letra de maquina', () => {
  const c = caixaRenderer();
  const agora = Date.now();
  const wf = { id: 'W', classe: 'local_workflow', workflow: 'revisao', agentes: new Map([[1, { i: 1, rotulo: 'code-reviewer-1',
    estado: 'progress', ferramenta: 'Read', detalhe: 'renderer/app.js', pedido: 'Review', desde: agora - 5000 }]]) };
  const solto = { id: 'S', classe: 'local_agent', tipo: 'general-purpose', desc: 'Research competitor landing pages',
    estado: 'pronto', ferramenta: 'WebFetch', agentes: new Map(), inicio: agora - 9000, fim: agora };
  const P = { ag: { tarefas: new Map([['W', wf], ['S', solto]]) } };
  c.AG_NOMES.set('S', { titulo: 'Pesquisando concorrentes', linha: 'compara páginas dos concorrentes' });
  const linhas = c.agLinhasDoCartao(P, ['W', 'S'], agora);
  assert.equal(linhas.length, 2);
  assert.deepEqual({ est: linhas[0].est, nome: linhas[0].nome, linha: linhas[0].linha },
    { est: 'agora', nome: 'Code reviewer 1', linha: 'Lendo um arquivo' });
  assert.deepEqual({ est: linhas[1].est, nome: linhas[1].nome, linha: linhas[1].linha },
    { est: 'pronto', nome: 'Pesquisando concorrentes', linha: 'compara páginas dos concorrentes' });
  for (const l of linhas) assert.ok(!('em' in l) && !('dica' in l), 'nem o caminho nem a instrucao vao para a linha');
  const pintar = pegar('agPintarCartaoConversa');
  assert.doesNotMatch(pintar, /equipe-em|equipe-faz|l\.dica|l\.em\b/, 'a linha tecnica saiu do DOM (nao so escondida)');
  assert.match(pintar, /\$\('\.equipe-fase', d\)\.textContent = l\.linha/);
});

test('app.js e CSS nao desenham mais a linha tecnica do agente', () => {
  assert.doesNotMatch(app, /ag-detalhe|equipe-em/);
  const style = fs.readFileSync(path.join(raiz, 'renderer/style.css'), 'utf8');
  const passos = fs.readFileSync(path.join(raiz, 'renderer/redesign/passos.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(style, /\.ag-detalhe/);
  assert.doesNotMatch(passos, /\.ag-detalhe|\.equipe-em|\.equipe-faz/);
  // a linha do que ele faz: uma so, com reticencias
  assert.match(passos, /:where\(#agPainel\) \.ag-fazendo\{[^}]*white-space:nowrap;overflow:hidden;text-overflow:ellipsis/);
  assert.match(passos, /\.equipe-fase\{[^}]*white-space:nowrap;overflow:hidden;text-overflow:ellipsis/);
});

/* ---------- o lote do renderer ---------- */
function caixaLote() {
  const timers = [];
  const chamadas = [];
  const repintados = [];
  let agora = 1000;
  const c = caixaRenderer({
    Date: { now: () => agora },
    setTimeout: (fn, ms) => { const t = { fn, ms, vivo: true }; timers.push(t); return t; },
    clearTimeout: (t) => { if (t) t.vivo = false; },
    window: { api: { agentesNomes(o) { const d = deferred(); chamadas.push({ o, d }); return d.promise; } } },
    panes: new Map(),
    agPaneAberto: null,
    agAgendarDesenho() { repintados.push('painel'); },
    agPintarCartaoConversa(P) { repintados.push(P.id); },
  });
  const disparar = () => { const vivos = timers.filter(t => t.vivo); timers.length = 0; vivos.forEach(t => t.fn()); };
  return { c, timers, chamadas, repintados, disparar, andar: (ms) => { agora += ms; } };
}
const solto = (id, extra = {}) => ({ id, classe: 'local_agent', desc: 'Explore ' + id, tipo: 'Explore', prompt: 'find ' + id,
  agentes: new Map(), ...extra });

test('lote: agentes que nascem juntos vao numa chamada so, 700 ms depois do ultimo', async () => {
  const L = caixaLote();
  L.c.agNomesColetar(solto('a'));
  L.andar(300);
  L.c.agNomesColetar(solto('b'));
  const wf = { id: 'W', classe: 'local_workflow', workflow: 'revisao', agentes: new Map([
    [1, { i: 1, rotulo: 'code-reviewer-1', fase: 'Revisão', pedido: 'Review the diff' }],
    [2, { i: 2, rotulo: '', pedido: '' }],                        // ainda sem nada para ler: fica de fora
  ]) };
  L.c.agNomesColetar(wf);
  L.c.agNomesColetar({ id: 'srv', classe: 'local_bash', desc: 'npm run dev', agentes: new Map() });   // servidor nao e agente
  assert.equal(L.timers.filter(t => t.vivo).length, 1, 'um relogio so');
  assert.equal(L.timers.find(t => t.vivo).ms, 700);
  assert.equal(L.chamadas.length, 0, 'ainda esperando o silencio');
  L.disparar();
  assert.equal(L.chamadas.length, 1, 'uma chamada para todos');
  const ids = L.chamadas[0].o.agentes.map(a => a.id);
  assert.deepEqual(plano(ids), ['a', 'b', 'W/code-reviewer-1']);
  assert.deepEqual(plano(L.chamadas[0].o.agentes[2]), { id: 'W/code-reviewer-1', desc: 'code-reviewer-1', tipo: '',
    prompt: 'Review the diff', workflow: 'Revisao · Revisão' });
  // com um lote no ar, agente novo espera a resposta (um lote por vez)
  L.c.agNomesColetar(solto('c'));
  assert.equal(L.timers.filter(t => t.vivo).length, 0);
  L.c.panes.set('p1', { id: 'p1', agCartao: { el: { isConnected: true } } });
  L.c.panes.set('p2', { id: 'p2', agCartao: { el: { isConnected: false } } });
  L.chamadas[0].d.resolve({ a: { titulo: 'Buscando login', linha: 'procura como funciona o login' },
    'W/code-reviewer-1': { titulo: 'Revisando mudanças', linha: 'confere se há erros' }, intruso: { titulo: 'Nome Errado', linha: 'x' } });
  await esperar();
  assert.deepEqual(plano(L.c.AG_NOMES.get('a')), { titulo: 'Buscando login', linha: 'procura como funciona o login' });
  assert.equal(L.c.AG_NOMES.has('b'), false, 'sem nome na resposta: fica o local');
  assert.equal(L.c.AG_NOMES.has('intruso'), false, 'so as chaves que foram no lote');
  assert.deepEqual(L.repintados, ['p1'], 'repinta so o cartao que ainda esta na tela');
  // o que chegou enquanto o lote estava no ar sai no proximo
  assert.equal(L.timers.filter(t => t.vivo).length, 1);
  L.disparar();
  assert.equal(L.chamadas.length, 2);
  assert.deepEqual(plano(L.chamadas[1].o.agentes.map(a => a.id)), ['c']);
});

test('lote: falhou, nao tenta de novo; agente ja nomeado ou ja pedido nao volta para a fila', async () => {
  const L = caixaLote();
  L.c.agNomesColetar(solto('a'));
  L.disparar();
  L.chamadas[0].d.reject(new Error('caiu'));
  await esperar();
  assert.equal(L.c.AG_NOMES.size, 0);
  L.c.agNomesColetar(solto('a'));                // o mesmo agente manda outro aviso
  assert.equal(L.timers.filter(t => t.vivo).length, 0, 'nao pede de novo');
  L.c.AG_NOMES.set('z', { titulo: 'Lendo textos', linha: 'lê os textos' });
  L.c.agNomesColetar(solto('z'));
  assert.equal(L.timers.filter(t => t.vivo).length, 0, 'ja tem nome');
  assert.equal(L.chamadas.length, 1);
  // resposta vazia ({}) tambem nao repinta nada
  L.c.agNomesColetar(solto('b'));
  L.disparar();
  L.chamadas[1].d.resolve({});
  await esperar();
  assert.deepEqual(L.repintados, []);
});

test('lote: rajada que nao para sai de qualquer jeito 2,5 s depois do primeiro; lote de ate 12', () => {
  const L = caixaLote();
  for (let i = 0; i < 10; i++) { L.c.agNomesColetar(solto('r' + i)); L.andar(400); }
  assert.equal(L.timers.filter(t => t.vivo).length, 1);
  // do 1o ao 7o (0 a 2,4 s) cada agente novo empurra o relogio; do 8o em diante (2,8 s) nao empurra mais
  assert.equal(L.timers.length, 7);
  L.disparar();
  assert.equal(L.chamadas.length, 1);
  const L2 = caixaLote();
  for (let i = 0; i < 15; i++) L2.c.agNomesColetar(solto('m' + i));
  L2.disparar();
  assert.equal(L2.chamadas[0].o.agentes.length, 12);
});

test('sem a ponte (app antigo no iPhone), nada entra na fila e o cartao fica com o nome local', () => {
  const c = caixaRenderer({ window: { api: {} } });
  c.agNomesColetar(solto('a'));
  assert.equal(c.AG_NOMES_FILA.size, 0);
});

test('o agentesEvento manda o agente novo para a fila do nome simples', () => {
  const src = pegar('agentesEvento');
  assert.match(src, /if \(ev\.ev === 'inicio' \|\| \(ev\.ev === 'andamento' && ev\.fluxo && ev\.fluxo\.length\)\) agNomesColetar\(A\.tarefas\.get\(ev\.id\)\);/);
});
