'use strict';
// Guarda do nome das conversas (25/09/2026). O Homero reclamou que o nome "nunca é fiel à demanda
// real": o formato obrigatório "<tipo> <projeto>" encheu a lista de "Alterações Adsure" e chamou de
// "Criação Dupla" uma conversa sobre como fazer um vídeo de IA. Aqui ficam presos: a instrução nova,
// a validação da saída, o ritmo (fim dos turnos 1, 2, 4, 7, 12), o nome manual intocado e a corrida
// de duas chamadas no mesmo chat.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const nomes = require('../nomes-conversa.js');
const { loadMain } = require('./main-harness.cjs');

const raiz = path.join(__dirname, '..');
const app = fs.readFileSync(process.env.COCKPIT_RENDERER_SOURCE || path.join(raiz, 'renderer/app.js'), 'utf8');
const main = fs.readFileSync(path.join(raiz, 'main.js'), 'utf8');

function func(nome, src = app) {
  const m = new RegExp('^(?:async )?function ' + nome + '\\(', 'm').exec(src);
  assert.ok(m, nome + ' existe');
  const linha = src.slice(m.index, src.indexOf('\n', m.index));
  if (linha.endsWith('}')) return linha;
  return src.slice(m.index, src.indexOf('\n}', m.index) + 2);
}
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
const esperar = () => new Promise(r => setImmediate(r));

/* As funções de verdade do renderer, numa caixa com a api do nome trocada por um dublê. */
function renderer() {
  const chamadas = [];
  const c = {
    console, String, Array, Number,
    MARCOS_NOME: undefined,
    pintarNome() {}, savePanes() { c.salvou++; }, salvou: 0,
    window: { api: {
      nomeCurto(material) { const d = deferred(); chamadas.push({ material, d }); return d.promise; },
      renomear(o) { c.gravados.push(o); return Promise.resolve(true); },
    } },
    gravados: [],
  };
  vm.createContext(c);
  const linhaMarcos = app.split('\n').find(l => l.startsWith('const MARCOS_NOME ='));
  assert.ok(linhaMarcos, 'MARCOS_NOME existe');
  vm.runInContext(linhaMarcos.replace('const ', 'var ') + '\n' + ['mensagensDele', 'proximoMarcoNome', 'materialDoNome',
    'nomearCurto', 'nomearNoFimDoTurno', 'salvarNomeCurto', 'buscarNome'].map(n => func(n)).join('\n'), c);
  return { c, chamadas };
}
function painel(msgs = []) {
  return { engine: 'claude', titulo: '', hist: msgs.map(t => ({ quem: 'Você', texto: t })), sessaoId: 's1' };
}
/* o que o send() faz na 1ª mensagem: nome provisório e a IA na hora */
function primeiraMensagem(r, P, texto) {
  P.hist.push({ quem: 'Você', texto });
  P.titulo = texto.slice(0, 30);
  r.c.nomearCurto(P, 'comeco');
}
function turno(r, P, texto, resposta) {
  if (texto !== undefined) P.hist.push({ quem: 'Você', texto });
  P.hist.push({ quem: 'Claude', texto: resposta || 'feito' });
  r.c.nomearNoFimDoTurno(P);
}

/* ================= a instrução ================= */
test('a instrução não obriga mais "<tipo> <projeto>" e pede a demanda real', () => {
  const p = nomes.PEDIDO_NOME;
  assert.doesNotMatch(p, /<tipo de trabalho> <projeto>/, 'o formato antigo que gerou "Alterações Adsure" voltou');
  assert.doesNotMatch(p, /NUNCA use o detalhe/i, 'proibir o detalhe do pedido e o que deixava o nome generico');
  assert.match(p, /DEMANDA REAL/);
  assert.match(p, /2 a 5 palavras/);
  assert.match(p, /preposição/);
  assert.match(p, /Proibido título genérico/);
  assert.match(p, /trabalho PRINCIPAL/);
  assert.match(p, /trabalho novo que tomou o lugar do anterior/, 'conversa que muda de rumo: o nome acompanha');
  assert.equal(/PEDIDO_NOME/.test(main), false, 'a instrucao velha continua no main.js');
  assert.match(main, /require\('\.\/nomes-conversa'\)/);
});

test('os exemplos da instrução são de assunto inventado e, se a IA copiar, a validação recusa', () => {
  for (const e of nomes.EXEMPLOS) {
    assert.ok(nomes.PEDIDO_NOME.includes(e));
    assert.equal(nomes.validarNome(e), '', 'copiou o exemplo: ' + e);
  }
  assert.doesNotMatch(nomes.PEDIDO_NOME, /Adsure|Cockpit|Pedro|Excelência|Criação de Vídeo com IA/,
    'exemplo com o assunto dele vicia: sai o mesmo nome para tudo');
});

test('a pasta não vai mais para a IA: com ela, tudo virava "Adsure"', () => {
  const pedido = nomes.montarPedido({ mensagens: ['faz o roteiro do reels'], pasta: 'Adsure' });
  assert.doesNotMatch(pedido, /Pasta|Adsure/);
  assert.doesNotMatch(func('materialDoNome'), /nomePasta|cwd/);
  assert.doesNotMatch(func('nomearCurto'), /nomePasta/);
});

test('linha de comando: haiku pelo login, sem sessão gravada, sem ferramenta, MCP, CLAUDE.md nem raciocínio', () => {
  const a = nomes.argsDoNome('PEDIDO');
  const depois = (flag) => a[a.indexOf(flag) + 1];
  assert.equal(a[0], '-p');
  assert.equal(depois('--model'), 'haiku');
  assert.ok(a.includes('--no-session-persistence'), 'sem isto a propria chamada vira conversa na lista');
  assert.ok(a.includes('--strict-mcp-config'));
  assert.equal(depois('--tools'), '');
  assert.equal(depois('--setting-sources'), '', 'com "project" o CLAUDE.md da casa entrava junto');
  assert.deepEqual(JSON.parse(depois('--settings')), { alwaysThinkingEnabled: false },
    'com raciocinio o Haiku levava de 38 a 86 s e estourava o prazo de 60 s');
  assert.equal(depois('--system-prompt'), nomes.PEDIDO_NOME);
  assert.equal(a[a.length - 1], 'PEDIDO');
});

/* ================= o material ================= */
test('material: a 1ª mensagem sempre entra, as do meio saem com aviso, as recentes entram', () => {
  const msgs = Array.from({ length: 20 }, (_, i) => 'pedido ' + (i + 1));
  const p = nomes.montarPedido({ mensagens: msgs });
  assert.match(p, /\n1\. pedido 1\n/);
  assert.match(p, /mensagens do meio puladas/);
  assert.match(p, /20\. pedido 20/);
  assert.doesNotMatch(p, /pedido 5\n/);
});

test('material: o que o app cola na mensagem (ultracode, fila, contexto) não conta como pedido dele', () => {
  const ultra = 'MODO ULTRACODE LIGADO PELO USUÁRIO: eu autorizo explicitamente o Workflow.\n\nMODELO POR TAREFA: Haiku.\n\n---\n\n';
  const entra = 'ATENÇÃO: esta mensagem chegou enquanto você já estava trabalhando em outra coisa.\n\n--- o que eu pedi ---\n';
  const p = nomes.montarPedido({ mensagens: [ultra + 'monta a página do congresso', entra + 'troca a cor do botão', ultra] });
  assert.doesNotMatch(p, /ULTRACODE|Workflow|ATENÇÃO/);
  assert.match(p, /monta a página do congresso/);
  assert.match(p, /troca a cor do botão/);
});

test('material: link vira o nome do site e a resposta do assistente entra limpa e curta', () => {
  const p = nomes.montarPedido({
    mensagens: ['Como eles fizeram? https://www.instagram.com/reel/DOabc123/?igsh=xyz'],
    respostas: ['## Resposta\n**É um COLORS falso** feito com IA.\n```bash\nyt-dlp url\n```\n' + 'x'.repeat(600)],
  });
  assert.match(p, /\[link instagram\]/);
  assert.doesNotMatch(p, /igsh|DOabc123/);
  assert.match(p, /É um COLORS falso feito com IA/);
  assert.doesNotMatch(p, /```|yt-dlp|\*\*|##/);
  const resp = p.split('assistente:\n- ')[1].split('\n')[0];
  assert.ok(resp.length <= nomes.MAX_RESPOSTA, 'a resposta passou de ' + nomes.MAX_RESPOSTA + ' caracteres');
});

test('material: entram a PRIMEIRA e a ÚLTIMA resposta; o nome atual vai junto para ser mantido se ainda vale', () => {
  assert.deepEqual(nomes.escolherRespostas(['a', 'b', 'c', 'd']), ['a', 'd']);
  assert.deepEqual(nomes.escolherRespostas(['a']), ['a']);
  const p = nomes.montarPedido({ mensagens: ['x y'], respostas: ['primeira coisa', 'meio', 'última coisa'], atual: 'Mapa dos Robôs' });
  assert.match(p, /primeira coisa/);
  assert.match(p, /última coisa/);
  assert.match(p, /Título atual: Mapa dos Robôs/);
  assert.equal(nomes.montarPedido({ mensagens: [] }), '', 'sem pedido dele nao ha o que nomear');
});

/* ================= a validação ================= */
test('validação: aceita título de demanda e arruma aspas, ponto e a 1ª letra', () => {
  assert.equal(nomes.validarNome('Criação de Vídeo com IA'), 'Criação de Vídeo com IA');
  assert.equal(nomes.validarNome('"Checkout Errado da Oficina."\n'), 'Checkout Errado da Oficina');
  assert.equal(nomes.validarNome('Título: Roteiro do Reels do Pedro'), 'Roteiro do Reels do Pedro');
  assert.equal(nomes.validarNome('roteiro do reels'), 'Roteiro do reels');
  assert.equal(nomes.validarNome('Desinstalar VS Code para Aula ao Vivo'), 'Desinstalar VS Code para Aula ao Vivo',
    'preposicao e artigo nao contam nas 6 palavras');
});

test('validação: recusa conversa, várias linhas, nome longo e o genérico do formato antigo', () => {
  for (const ruim of [
    '', '   ', 'Linha um\nLinha dois', 'Claro! Aqui está o título', 'Desculpe, não consigo', 'Qual o assunto?',
    'Alfa Beta Gama Delta Épsilon Zeta Eta', 'Estrutura de Pós-Graduação em Direito Previdenciário Rural',
    'Alterações Adsure', 'Conserto Cockpit', 'Criação Dupla', 'Conversa', 'ok',
  ]) assert.equal(nomes.validarNome(ruim), '', 'devia recusar: ' + JSON.stringify(ruim));
  for (const n of ['Alfa Beta Gama Delta Épsilon Zeta', 'Relatório de Vendas de Agosto']) assert.notEqual(nomes.validarNome(n), '');
  for (const n of ['A', 'x'.repeat(49)]) assert.equal(nomes.validarNome(n), '');
});

/* ================= o ritmo ================= */
test('ritmo: IA na hora da 1ª mensagem e depois no FIM dos turnos 1, 2, 4, 7 e 12 (e a cada 10)', async () => {
  const r = renderer();
  const P = painel();
  primeiraMensagem(r, P, 'Esse vídeo de IA é trend. Como eles fizeram?');
  assert.equal(r.chamadas.length, 1, 'o provisorio da IA sai na hora');
  assert.equal(r.chamadas[0].material.respostas.length, 0);
  r.chamadas[0].d.resolve('Vídeo de IA em Trend'); await esperar();
  const turnosQueChamaram = [];
  for (let t = 1; t <= 24; t++) {
    const antes = r.chamadas.length;
    turno(r, P, t === 1 ? undefined : 'pedido ' + t, 'resposta ' + t);
    if (r.chamadas.length > antes) { turnosQueChamaram.push(t); r.chamadas.at(-1).d.resolve('Nome ' + t); await esperar(); }
  }
  assert.deepEqual(turnosQueChamaram, [1, 2, 4, 7, 12, 22]);
  const fim1 = r.chamadas[1].material;
  assert.deepEqual(fim1.respostas, ['resposta 1'], 'no fim do 1o turno a IA ja ve a resposta do assistente');
  assert.equal(fim1.atual, 'Vídeo de IA em Trend', 'o nome atual vai junto para ser mantido se ainda vale');
});

test('ritmo: mensagem da fila que junta pedidos ainda cruza o marco (3 → 5 passa pelo 4)', async () => {
  const r = renderer();
  const P = painel();
  primeiraMensagem(r, P, 'primeiro pedido'); r.chamadas[0].d.resolve('Primeiro Pedido Feito'); await esperar();
  turno(r, P, undefined); r.chamadas.at(-1).d.resolve('A B'); await esperar();          // marco 1
  turno(r, P, 'segundo'); r.chamadas.at(-1).d.resolve('A C'); await esperar();          // marco 2
  const antes = r.chamadas.length;
  P.hist.push({ quem: 'Você', texto: 'terceiro' });
  turno(r, P, 'quarto e quinto juntos');                                                  // 3 → 4 mensagens de uma vez
  P.hist.push({ quem: 'Você', texto: 'sexto' });
  assert.equal(r.chamadas.length, antes + 1, 'cruzou o 4');
});

test('ritmo: conversa aberta da lista (sem dono) nunca é renomeada no fim do turno', () => {
  const r = renderer();
  const P = painel(['a', 'b', 'c', 'd', 'e', 'f', 'g']);
  P.titulo = 'Nome que ele deu ontem';
  for (let t = 0; t < 30; t++) turno(r, P, 'mais um');
  assert.equal(r.chamadas.length, 0);
});

/* ================= nome manual ================= */
test('nome manual: com nomeManual a IA não é nem chamada', () => {
  const r = renderer();
  const P = painel();
  primeiraMensagem(r, P, 'pedido');
  r.chamadas[0].d.resolve('Nome da IA');
  P.nomeManual = true; P.titulo = 'Meu Nome';
  for (let t = 0; t < 15; t++) turno(r, P, 'mais');
  assert.equal(r.chamadas.length, 1);
  assert.equal(P.titulo, 'Meu Nome');
});

test('nome manual: ele renomeia enquanto a IA pensa, e a resposta dela é jogada fora', async () => {
  const r = renderer();
  const P = painel();
  primeiraMensagem(r, P, 'pedido');
  P.titulo = 'Meu Nome'; P.nomeManual = true;          // o que renomearAqui faz
  r.chamadas[0].d.resolve('Nome da IA'); await esperar();
  assert.equal(P.titulo, 'Meu Nome');
  assert.equal(r.c.gravados.length, 0, 'o nome da IA nao pode ir para o nomes.json por cima do dele');
});

test('nome manual: conversa nova no mesmo painel volta a ganhar nome da IA', async () => {
  const r = renderer();
  const P = painel();
  P.nomeManual = true; P.titulo = '';                  // novaConversa nao zerava o nomeManual
  primeiraMensagem(r, P, 'outro assunto');
  assert.equal(r.chamadas.length, 1);
  r.chamadas[0].d.resolve('Outro Assunto Novo'); await esperar();
  assert.equal(P.titulo, 'Outro Assunto Novo');
});

/* ================= corrida ================= */
test('corrida: nunca duas chamadas ao mesmo tempo no mesmo chat; a pedida no meio sai uma vez depois', async () => {
  const r = renderer();
  const P = painel();
  primeiraMensagem(r, P, 'pedido 1');
  turno(r, P, undefined);                              // fim do 1o turno com a 1a chamada no ar
  turno(r, P, 'pedido 2');                             // fim do 2o, ainda no ar
  assert.equal(r.chamadas.length, 1, 'duas no ar ao mesmo tempo');
  r.chamadas[0].d.resolve('Primeiro Nome Bom'); await esperar();
  assert.equal(r.chamadas.length, 2, 'as pedidas no meio viram UMA chamada depois');
  assert.deepEqual(r.chamadas[1].material.mensagens, ['pedido 1', 'pedido 2'], 'e com o material mais novo');
  r.chamadas[1].d.resolve('Segundo Nome Bom'); await esperar();
  assert.equal(P.titulo, 'Segundo Nome Bom');
  assert.equal(r.chamadas.length, 2);
});

test('corrida: resposta atrasada da conversa anterior não cai na conversa nova do mesmo painel', async () => {
  const r = renderer();
  const P = painel();
  primeiraMensagem(r, P, 'conversa A');
  P.hist = []; P.titulo = ''; P.nomeCurto = false;     // o painel trocou de conversa (novaConversa)
  primeiraMensagem(r, P, 'conversa B');
  r.chamadas[0].d.resolve('Nome da Conversa A'); await esperar();
  assert.notEqual(P.titulo, 'Nome da Conversa A');
  assert.equal(r.chamadas.length, 2, 'a conversa B ganha a chamada dela quando a da A volta');
  assert.deepEqual(r.chamadas[1].material.mensagens, ['conversa B']);
  r.chamadas[1].d.resolve('Nome da Conversa B'); await esperar();
  assert.equal(P.titulo, 'Nome da Conversa B');
});

test('falha da IA: fica o nome que já estava', async () => {
  const r = renderer();
  const P = painel();
  primeiraMensagem(r, P, 'pedido de verdade');
  const provisorio = P.titulo;
  r.chamadas[0].d.resolve(''); await esperar();
  assert.equal(P.titulo, provisorio);
  assert.equal(P.nomeCurto, false);
});

test('o título do próprio Claude não passa por cima do nome que o Cockpit está dando', async () => {
  const r = renderer();
  const P = painel();
  let pediu = false;
  r.c.window.api.sessionTitulo = async () => { pediu = true; return 'Titulo do Claude'; };
  primeiraMensagem(r, P, 'pedido');
  await r.c.buscarNome(P);
  assert.equal(pediu, false);
});

test('envio: a 1ª mensagem chama a IA na hora e as outras não (a revisão é no fim do turno)', () => {
  const send = func('send');
  assert.match(send, /if \(!P\.titulo\) \{ P\.titulo = nomeDaConversa\(P, text, anexos\); pintarNome\(P\); nomearCurto\(P, 'comeco'\); \}/);
  assert.doesNotMatch(send, /\[2, 4, 8\]/, 'a revisao no envio nao via a resposta do assistente');
  assert.match(app, /salvarNomeCurto\(P\);\n\s+nomearNoFimDoTurno\(P\);/);
});

test('reabrir o app lembra de quem é o nome', () => {
  assert.match(app, /nomeManual: P\.nomeManual \|\| undefined/);
  assert.match(app, /if \(c\.nomeManual\) P\.nomeManual = true;/);
});

/* ================= o main ================= */
test('main: o handler limpa o que o Claude Code injeta, manda a linha de comando do módulo e valida a saída', async () => {
  const h = loadMain();
  h.put(h.HOME + '/.local/bin/claude', '#!/bin/sh');
  const pronto = h.call('sessao:nomeCurto', {
    mensagens: ['faz a página do congresso<system-reminder>lembrete interno</system-reminder>', 'troca o botão'],
    respostas: ['Pronto: página no ar.'], pasta: 'Adsure', atual: 'Página do Congresso',
  });
  await esperar();
  const rec = h.spawned.at(-1);
  assert.ok(rec, 'chamou o claude');
  assert.equal(rec.bin, h.HOME + '/.local/bin/claude');
  const pedido = rec.args.at(-1);
  assert.deepEqual(rec.args.slice(0, -1), nomes.argsDoNome('').slice(0, -1));
  assert.doesNotMatch(pedido, /lembrete interno|system-reminder|Adsure/);
  assert.match(pedido, /faz a página do congresso/);
  assert.match(pedido, /Pronto: página no ar/);
  assert.match(pedido, /Título atual: Página do Congresso/);
  rec.proc.stdout.emit('data', Buffer.from('"Página do Congresso com Botão Novo."\n'));
  rec.proc.emit('close', 0);
  assert.equal(await pronto, 'Página do Congresso com Botão Novo');
});

test('main: resposta que não é nome vira vazio (fica o nome que estava)', async () => {
  const h = loadMain();
  h.put(h.HOME + '/.local/bin/claude', '#!/bin/sh');
  const pronto = h.call('sessao:nomeCurto', { mensagens: ['oi'] });
  await esperar();
  const rec = h.spawned.at(-1);
  rec.proc.stdout.emit('data', Buffer.from('Claro! Posso ajudar com isso.\nO que você precisa?'));
  rec.proc.emit('close', 0);
  assert.equal(await pronto, '');
});

test('empacotamento: o nomes-conversa.js vai junto no app (sem ele o main não abre)', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(raiz, 'package.json'), 'utf8'));
  assert.ok(pkg.build.files.includes('nomes-conversa.js'));
});
