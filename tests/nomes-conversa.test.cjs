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
    console, String, Array, Number, Set, Math, Promise,
    NOME_TODA_RESPOSTA_ATE: undefined,
    pintarNome() {}, savePanes() { c.salvou++; }, salvou: 0,
    lateral: false, recargas: [],
    lateralAberta() { return c.lateral; }, loadHist(engine, force) { c.recargas.push({ engine, force }); },
    // a lista unica (25/09) tambem e avisada do nome: aqui so importa que exista
    lembrarNomeDaParte() {},
    painelAindaAtual: () => true,
    window: { api: {
      nomeCurto(material) { const d = deferred(); chamadas.push({ material, d }); return d.promise; },
      renomear(o) { c.gravados.push(o); return Promise.resolve(true); },
    } },
    gravados: [],
  };
  vm.createContext(c);
  const constante = (nome) => {
    const i = app.indexOf('\nconst ' + nome + ' =');
    assert.ok(i >= 0, nome + ' existe');
    return app.slice(i + 1, app.indexOf(';\n', i) + 1).replace('const ', 'var ');
  };
  vm.runInContext(constante('NOME_TODA_RESPOSTA_ATE') + '\n' + constante('PALAVRA_DE_LIGACAO') + '\n' + ['mensagensDele',
    'proximoMarcoNome', 'materialDoNome', 'nomearCurto', 'trocarNome', 'palavrasDoNome', 'mesmoAssunto',
    'nomearNoFimDoTurno', 'assumirNome', 'lembrarDonoDoNome', 'salvarNomeCurto', 'buscarNome'].map(n => func(n)).join('\n'), c);
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
/* 3a versao (26/09, pedido dele): "<o que está sendo feito> <cliente ou projeto>". A conversa em que
   ele pediu se chamava "Teste de Conexão Sistema"; ele daria "Ajustes Cockpit". */
test('a instrução pede "<o que está sendo feito> <cliente ou projeto>", curto e prático', () => {
  const p = nomes.PEDIDO_NOME;
  assert.match(p, /Formato: <o que está sendo feito> <cliente ou projeto>/);
  assert.match(p, /2 a 4 palavras, no máximo 32 letras/);
  assert.match(p, /Ajustes Cockpit/, 'o exemplo dele');
  assert.match(p, /Pedro \(Pedro Quadrado\), Rapha \(Rapha Brandão\)/, 'os nomes curtos dos clientes');
  assert.match(p, /trabalho PRINCIPAL da conversa inteira, não da primeira mensagem/);
  assert.match(p, /"só testando"/);
  assert.match(p, /Duas conversas diferentes do mesmo cliente têm que ganhar nomes diferentes/);
  assert.match(p, /MANTER/);
  assert.equal(/PEDIDO_NOME/.test(main), false, 'a instrucao velha continua no main.js');
  assert.match(main, /require\('\.\/nomes-conversa'\)/);
});

// 2a versao (26/09): a 1a acabou com o generico mas descrevia o CONTEUDO ("Video de IA com Robo
// Humanoide", "Video IA com Voces Cantando"). A medida e o exemplo dele: "Criacao de Video com IA".

test('os exemplos da instrução passam na validação (agora são do mundo dele, não viram recusa)', () => {
  for (const e of nomes.EXEMPLOS) {
    assert.ok(nomes.PEDIDO_NOME.includes(e));
    assert.equal(nomes.validarNome(e), e);
  }
});

test('a pasta do chat vai como pista do cliente, só quando diz algo', () => {
  assert.equal(nomes.pistaDaPasta('/Users/homeromotti/Projetos/Pedro'), 'Pedro');
  assert.equal(nomes.pistaDaPasta('/Users/homeromotti/Projetos/Adsure/Cockpit Vincular Conta - 26-09-2026/codigo'),
    'Adsure (cockpit vincular conta)');
  assert.equal(nomes.pistaDaPasta('/Users/homeromotti/Documents/Adsure - Sistemas/Cockpit'), 'Cockpit');
  assert.equal(nomes.pistaDaPasta('/Users/homeromotti'), '', 'a pasta pessoal não diz nada (na 1a versão tudo virava Adsure)');
  assert.match(nomes.montarPedido({ mensagens: ['faz a página'], pasta: '/Users/h/Projetos/Pedro' }), /Pasta do chat: Pedro\n/);
  assert.doesNotMatch(nomes.montarPedido({ mensagens: ['faz a página'], pasta: '/Users/h' }), /Pasta do chat/);
  assert.match(func('materialDoNome'), /pasta: P\.cwd/);
  assert.match(main, /pasta: typeof d\.pasta === 'string' \? d\.pasta : ''/);
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

test('validação: recusa conversa, várias linhas, nome longo e o vago; aceita <trabalho> <cliente>', () => {
  for (const ruim of [
    '', '   ', 'Linha um\nLinha dois', 'Claro! Aqui está o título', 'Desculpe, não consigo', 'Qual o assunto?',
    'Alfa Beta Gama Delta Épsilon Zeta Eta', 'Estrutura de Pós-Graduação em Direito Previdenciário Rural',
    'Teste de Conexão Sistema', 'Teste', 'Sistema', 'Conversa', 'Conversa Geral', 'ok',
  ]) assert.equal(nomes.validarNome(ruim), '', 'devia recusar: ' + JSON.stringify(ruim));
  // 3a versao: "<trabalho> <cliente>" é o formato que ele pediu
  for (const n of ['Ajustes Cockpit', 'Alterações Adsure', 'Relatório de Vendas de Agosto', 'Teste A/B Página Pedro'])
    assert.notEqual(nomes.validarNome(n), '', n);
  for (const n of ['A', 'x'.repeat(45), 'Alfa Beta Gama Delta Épsilon Zeta']) assert.equal(nomes.validarNome(n), '');
});

/* ================= o ritmo ================= */
test('ritmo: IA na hora da 1ª mensagem, no FIM de toda resposta até a 15ª e depois a cada 5', async () => {
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
  assert.deepEqual(turnosQueChamaram, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 20],
    'a conversa que começa com pergunta lateral troca de nome assim que a demanda de verdade aparece');
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

test('ritmo: conversa aberta da lista com nome DELE nunca é renomeada no fim do turno', async () => {
  const r = renderer();
  const P = painel(['a', 'b', 'c', 'd', 'e', 'f', 'g']);
  P.titulo = 'Nome que ele deu ontem';
  r.c.window.api.donoNome = async () => 'manual';        // o nomes.json diz que foi ele
  await r.c.lembrarDonoDoNome(P, 's1', P.titulo, 0);
  assert.equal(P.nomeManual, true);
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
  // (assuntos diferentes de proposito: "Primeiro Nome Bom" → "Segundo Nome Bom" hoje e o mesmo assunto
  // com outras palavras, e a regra da estabilidade mantem o primeiro)
  r.chamadas[0].d.resolve('Roteiro do Reels'); await esperar();
  assert.equal(r.chamadas.length, 2, 'as pedidas no meio viram UMA chamada depois');
  assert.deepEqual(r.chamadas[1].material.mensagens, ['pedido 1', 'pedido 2'], 'e com o material mais novo');
  r.chamadas[1].d.resolve('Página de Captura Nova'); await esperar();
  assert.equal(P.titulo, 'Página de Captura Nova');
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

/* Revisao de 25/09 (achado 7): o teste antigo prendia a frase provisoria para sempre quando a IA
   falhava. Agora o titulo do proprio Claude e a reserva; sem ele, fica o provisorio. */
test('falha da IA: entra o título do próprio Claude como reserva (e a IA ainda ganha depois)', async () => {
  const r = renderer();
  const P = painel();
  r.c.window.api.sessionTitulo = async () => 'Vídeo de IA viral no Instagram';
  primeiraMensagem(r, P, 'Esse vídeo de IA é uma trend em alta no instagram. Como eles fizeram?');
  r.chamadas[0].d.resolve(''); await esperar(); await esperar();
  assert.equal(P.titulo, 'Vídeo de IA viral no Instagram', 'a barra ficava com a frase provisoria e a lista com o aiTitle');
  assert.equal(P.nomeCurto, false);
  assert.equal(r.c.gravados.length, 0, 'o titulo do Claude nao vai para o nomes.json como nome da IA');
  turno(r, P, undefined, 'É um vídeo feito com IA');                       // fim do 1o turno
  r.chamadas.at(-1).d.resolve('Criação de Vídeo com IA'); await esperar();
  assert.equal(P.titulo, 'Criação de Vídeo com IA');
});

test('falha da IA sem título do Claude: fica o nome que já estava', async () => {
  const r = renderer();
  const P = painel();
  r.c.window.api.sessionTitulo = async () => '';
  primeiraMensagem(r, P, 'pedido de verdade');
  const provisorio = P.titulo;
  r.chamadas[0].d.resolve(''); await esperar(); await esperar();
  assert.equal(P.titulo, provisorio);
  assert.equal(P.nomeCurto, false);
});

test('reserva: o título do Claude não passa por cima de um nome válido da IA, nem de um que chega durante a leitura', async () => {
  const r = renderer();
  const P = painel();
  let pediu = 0;
  const leitura = deferred();
  r.c.window.api.sessionTitulo = () => { pediu++; return leitura.promise; };
  primeiraMensagem(r, P, 'pedido');
  r.chamadas[0].d.resolve('Roteiro do Reels do Pedro'); await esperar();
  await r.c.buscarNome(P);
  assert.equal(pediu, 0, 'com nome valido da IA o titulo do Claude nem e lido');
  const Q = painel();
  primeiraMensagem(r, Q, 'outro pedido');
  r.chamadas[1].d.resolve(''); await esperar();            // falhou: a reserva comeca a ler
  const nomeando = r.c.nomearCurto(Q);                     // e a IA e chamada de novo enquanto le
  leitura.resolve('Titulo do Claude'); await esperar();
  assert.notEqual(Q.titulo, 'Titulo do Claude', 'a IA estava pensando: a reserva espera');
  r.chamadas[2].d.resolve('Página de Captura Nova'); await nomeando;
  assert.equal(Q.titulo, 'Página de Captura Nova');
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

/* ================= revisão de 25/09: os 11 achados dos revisores ================= */

// achados 1 e 10: conversa que já existia (lista, aba que volta) nunca ganhava nome novo
test('dono do nome: o nomes.json separa o nome dele do nome velho da IA', () => {
  const nomesJson = {
    v1: 'Criação Dupla', v2: 'Alterações Excelência Prev', v3: 'Conserto Quesitos Pro',
    m1: 'Cockipit', m2: 'Página mateus mota captura', m3: 'Alterações Adsure', a1: 'Criação de Vídeo com IA',
    _origem: { m3: 'manual', a1: 'auto' },
  };
  const d = (id, t) => nomes.donoDoNome(nomesJson, id, t);
  assert.equal(d('v1'), 'antigo', 'a conversa do exemplo dele');
  assert.equal(d('v2'), 'antigo', 'com 3 palavras tambem e o formato antigo');
  assert.equal(d('v3'), 'antigo', '"Pro" no fim e nome de produto, nao preposicao');
  assert.equal(d('m1'), 'manual', 'sem marca e sem a cara do formato antigo: na duvida e dele');
  assert.equal(d('m2'), 'manual');
  assert.equal(d('m3'), 'manual', 'marcado como dele: mesmo com a cara do formato antigo, nunca e mexido');
  assert.equal(d('a1'), 'ia');
  assert.equal(d('x', 'Alterações Adsure'), 'antigo', 'fora do nomes.json, pelo titulo que o app tem');
  assert.equal(d('x', 'Relatório de Vendas'), '', 'com preposicao ja e o formato novo');
  assert.equal(d('x', ''), '');
  assert.equal(nomes.donoDoNome(null, 'x', ''), '');
});

test('main: o nomes.json guarda quem deu o nome, e o app pergunta o dono pelo sessao:donoNome', async () => {
  const h = loadMain();
  const arq = h.HOME + '/app-data/nomes.json';
  await h.call('sessao:renomear', { engine: 'claude', id: 'a1', nome: 'Criação de Vídeo com IA', origem: 'auto' });
  await h.call('sessao:renomear', { engine: 'claude', id: 'm1', nome: 'Alterações Adsure' });     // lapis: sem origem = dele
  const gravado = JSON.parse(h.files.get(arq).toString());
  assert.equal(gravado.a1, 'Criação de Vídeo com IA');
  assert.deepEqual(gravado._origem, { a1: 'auto', m1: 'manual' });
  gravado.v1 = 'Criação Dupla';                                                     // nome de antes da marca
  h.put(arq, JSON.stringify(gravado));
  assert.equal(await h.call('sessao:donoNome', { id: 'a1', titulo: 'Criação de Vídeo com IA' }), 'ia');
  assert.equal(await h.call('sessao:donoNome', { id: 'm1', titulo: 'Alterações Adsure' }), 'manual');
  assert.equal(await h.call('sessao:donoNome', { id: 'v1', titulo: 'Criação Dupla' }), 'antigo');
  assert.equal(await h.call('sessao:donoNome', {}), '');
  await h.call('sessao:renomear', { engine: 'claude', id: 'a1', nome: '' });
  assert.equal(JSON.parse(h.files.get(arq).toString())._origem.a1, undefined, 'nome apagado leva a marca junto');
});

test('conversa com nome ANTIGO aberta da lista: a IA troca no fim do próximo turno, sem receber o nome velho', async () => {
  const r = renderer();
  const msgs = Array.from({ length: 15 }, (_, i) => 'pedido ' + (i + 1));
  const P = painel(msgs);
  P.titulo = 'Criação Dupla';
  r.c.window.api.donoNome = async ({ id, titulo }) => (id === 's1' && titulo === 'Criação Dupla' ? 'antigo' : '');
  await r.c.lembrarDonoDoNome(P, 's1', 'Criação Dupla', 0);
  turno(r, P, 'mais um pedido', 'feito');
  assert.equal(r.chamadas.length, 1, 'o nome velho ficava para sempre');
  assert.equal(r.chamadas[0].material.atual, '', 'com o nome velho como "atual" a IA o repetia');
  r.chamadas[0].d.resolve('Criação de Vídeo com IA'); await esperar();
  assert.equal(P.titulo, 'Criação de Vídeo com IA');
  assert.deepEqual(JSON.parse(JSON.stringify(r.c.gravados.at(-1))),
    { engine: 'claude', id: 's1', nome: 'Criação de Vídeo com IA', origem: 'auto' });
});

test('conversa com nome NOVO da IA aberta da lista: a IA continua acompanhando de onde a conversa está', async () => {
  const r = renderer();
  const P = painel(Array.from({ length: 5 }, (_, i) => 'pedido ' + (i + 1)));
  P.titulo = 'Mapa dos Robôs do Mac';
  r.c.window.api.donoNome = async () => 'ia';
  await r.c.lembrarDonoDoNome(P, 's1', P.titulo, 0);
  turno(r, P, 'pedido 6');
  assert.equal(r.chamadas.length, 1, '26/09: até a 15a resposta a IA revê o nome em toda resposta');
  assert.equal(r.chamadas[0].material.atual, 'Mapa dos Robôs do Mac', 'o nome da IA vai como atual, para ser mantido');
});

test('fiação: openSession e a volta das abas perguntam o dono; o lápis grava como dele', () => {
  const abrir = func('openSession');
  assert.match(abrir, /lembrarDonoDoNome\(P, s\.id, s\.title \|\| '', revisao\)/);
  assert.match(abrir, /P\.nomeManual = false; P\.hist = \[\]/, 'o painel nao herda o nome manual da conversa anterior');
  const volta = func('restaurarAbasCorpo');
  assert.match(volta, /semDono: \(!c\.nomeManual && !c\.nomeAuto && c\.titulo\) \? c\.titulo : ''/,
    'aba de antes da atualizacao (sem nomeAuto) ficava sem dono');
  assert.match(volta, /if \(semDono\) lembrarDonoDoNome\(P, id, semDono, revisao\)/);
  assert.equal((app.match(/nome: novo, origem: 'manual'/g) || []).length, 2, 'lapis da barra e lapis da lista');
  assert.match(func('salvarNomeCurto'), /origem: 'auto'/);
  const preload = fs.readFileSync(path.join(raiz, 'preload.js'), 'utf8');
  const web = fs.readFileSync(path.join(raiz, 'renderer/web.js'), 'utf8');
  const servidor = fs.readFileSync(path.join(raiz, 'servidor-web.js'), 'utf8');
  assert.match(preload, /donoNome: \(o\) => ipcRenderer\.invoke\('sessao:donoNome', o\)/);
  assert.match(web, /donoNome: \(o\) => chamar\('sessao:donoNome', o\)/);
  assert.match(servidor, /'sessao:donoNome'/, 'sem estar na lista branca o iPhone nao alcanca');
});

// achado 2: no iPhone o nome congelava na 1a vez que ele saía e voltava ao app
test('celular: o atualizar() de quando ele volta ao app não tira o dono do nome', async () => {
  const cel = fs.readFileSync(path.join(raiz, 'renderer/mobile.js'), 'utf8');
  const linha = cel.split('\n').find(l => l.includes('P.blocks.clear(); P.tools.clear(); P.execEl = null'));
  assert.ok(linha, 'a linha que limpa a conversa no atualizar() do celular');
  // roda a linha DE VERDADE do mobile.js e redesenha o historico, como o atualizar() faz
  const voltarAoApp = (P) => {
    const antes = P.hist.slice();
    vm.runInNewContext(linha.trim(), { P });
    for (const h of antes) P.hist.push(h);
  };
  const r = renderer();
  const P = Object.assign(painel(), { blocks: new Map(), tools: new Map() });
  primeiraMensagem(r, P, 'Esse vídeo de IA é trend. Como eles fizeram?');
  voltarAoApp(P);                                          // saiu e voltou com a IA pensando
  r.chamadas[0].d.resolve('Vídeo de IA do Instagram'); await esperar();
  assert.equal(P.titulo, 'Vídeo de IA do Instagram', 'a resposta que estava a caminho era jogada fora');
  const turnos = [];
  for (let t = 1; t <= 12; t++) {
    const antes = r.chamadas.length;
    turno(r, P, t === 1 ? undefined : 'pedido ' + t);
    if (r.chamadas.length > antes) { turnos.push(t); r.chamadas.at(-1).d.resolve('Vídeo de IA do Instagram'); await esperar(); }
    voltarAoApp(P);
  }
  assert.deepEqual(turnos, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 'depois da 1a volta ao app nenhum marco chamava a IA');
});

// achados 3 e 8: título legítimo recusado para sempre
test('validação: aceita título que começa com Parecer, Nome, Título, Entendimento, Sugestão ou Posso', () => {
  for (const bom of [
    'Parecer Aposentadoria Vigilante', 'Parecer do Processo do Cliente', 'Nome da Mentoria do Mota',
    'Título da Aula Semanal', 'Nome do Produto Novo', 'Entendimento do Contrato', 'Sugestão de Pauta para Reels',
    'Posso Aposentar com 60', 'I.A. no Escritório do Pedro', 'Claro Telecom Contrato', 'Oi Fibra Cancelamento',
  ]) assert.equal(nomes.validarNome(bom), bom, 'titulo de verdade recusado: ' + bom);
  for (const ruim of [
    'Parece que é sobre vídeo', 'Entendi, vou nomear', 'Eu sugiro Vídeo de IA', 'Vou chamar de Vídeo', 'Oi! Tudo bem',
    'Claro, segue o título', 'Claro aqui está o título', 'Posso sugerir Vídeo de IA', 'Nome da conversa sobre vídeo',
    'Um bom título seria Vídeo', 'O nome é Vídeo de IA', 'Sugiro Vídeo de IA', 'I think Video', 'Sim', 'MANTER',
  ]) assert.equal(nomes.validarNome(ruim), '', 'devia recusar: ' + ruim);
  assert.equal(nomes.validarNome('Nome da conversa: Roteiro do Reels'), 'Roteiro do Reels');
  assert.equal(nomes.validarNome('Ajustes Excelência Prev'), 'Ajustes Excelência Prev', '3a versao: trabalho + cliente passa');
  assert.equal(nomes.validarNome('Campanha Black Friday'), 'Campanha Black Friday', 'tipo que diz o assunto passa');
});

// achado 4: a lateral ficava com o nome da rodada anterior
test('lateral: o nome da IA gravado no nomes.json redesenha a lista aberta', async () => {
  const r = renderer();
  const P = painel(['pedido']);
  P.nomeCurto = true; P.titulo = 'Criação de Vídeo com IA';
  r.c.lateral = true;
  r.c.salvarNomeCurto(P);
  await esperar();
  assert.deepEqual(r.c.recargas, [{ engine: 'claude', force: true }]);
  r.c.lateral = false; P.titulo = 'Outro Nome de Verdade';
  r.c.salvarNomeCurto(P); await esperar();
  assert.equal(r.c.recargas.length, 1, 'lateral fechada: nada a redesenhar');
});

// achado 5: a IA lia "2 mensagens puladas" quando foram 20
test('material pelo caminho real (app → main → pedido): a numeração é a da conversa inteira', async () => {
  const r = renderer();
  const P = painel(Array.from({ length: 30 }, (_, i) => 'pedido ' + (i + 1)));
  const material = r.c.materialDoNome(P);
  assert.equal(material.total, 30);
  const h = loadMain();
  h.put(h.HOME + '/.local/bin/claude', '#!/bin/sh');
  const pronto = h.call('sessao:nomeCurto', JSON.parse(JSON.stringify(material)));
  await esperar();
  const pedido = h.spawned.at(-1).args.at(-1);
  assert.match(pedido, /\n1\. pedido 1\n\(… 22 mensagens do meio puladas …\)\n24\. pedido 24\n/);
  assert.match(pedido, /\n30\. pedido 30\n/);
  assert.doesNotMatch(pedido, /\b2 mensagens do meio|\n4\. pedido 24/);
  h.spawned.at(-1).proc.emit('close', 0);
  await pronto;
  assert.match(nomes.montarPedido({ mensagens: ['a1', 'b2', 'c3'], total: 3 }), /\n1\. a1\n2\. b2\n3\. c3\n/, 'conversa curta: sem pular');
  assert.match(nomes.montarPedido({ mensagens: ['a1', 'c3'], total: 3 }), /\(… 1 mensagem do meio pulada …\)/);
});

// achados 6 e 11: o ponto sumia do meio do nome
test('validação: o ponto do meio do nome fica (Claude.md, motti.ia.br, Node.js, R$ 1.300)', () => {
  assert.equal(nomes.validarNome('Ajustes no Claude.md e Procedimentos'), 'Ajustes no Claude.md e Procedimentos');
  assert.equal(nomes.validarNome('Site motti.ia.br Fora do Ar.'), 'Site motti.ia.br Fora do Ar');
  assert.equal(nomes.validarNome('Migração para Next.js'), 'Migração para Next.js');
  assert.equal(nomes.validarNome('Proposta de R$ 1.300,00'), 'Proposta de R$ 1.300,00');
  assert.equal(nomes.validarNome('"Checkout Errado da Oficina."'), 'Checkout Errado da Oficina', 'o ponto final ainda sai');
});

// achado 9: o nome pulava a cada marco e o pedido lateral do fim tomava o nome
test('estabilidade: o mesmo assunto com outras palavras não troca o nome', async () => {
  const r = renderer();
  const P = painel();
  primeiraMensagem(r, P, 'Esse vídeo de IA é trend. Como eles fizeram?');
  r.chamadas[0].d.resolve('Vídeo de IA do Instagram'); await esperar();
  turno(r, P, undefined, 'É um COLORS falso feito com IA');     // 1o fim de turno: 1a vez que a IA ve a resposta
  r.chamadas.at(-1).d.resolve('Trend de Vídeo Fake COLORS'); await esperar();
  assert.equal(P.titulo, 'Trend de Vídeo Fake COLORS', 'o 1o fim de turno pode trocar direto');
  const variacoes = ['Vídeo IA Estilo COLORS', 'Vídeo Fake do COLORS com IA', 'Trend do COLORS Fake', 'Vídeo Estilo COLORS com IA', 'COLORS Fake com IA'];
  let k = 0;
  for (let t = 2; t <= 24; t++) {
    const antes = r.chamadas.length;
    turno(r, P, 'pedido ' + t);
    if (r.chamadas.length > antes) { r.chamadas.at(-1).d.resolve(variacoes[k++ % variacoes.length]); await esperar(); }
  }
  assert.ok(k >= 4, 'a IA foi chamada nos marcos');
  assert.equal(P.titulo, 'Trend de Vídeo Fake COLORS', 'o nome pulava a cada marco');
  assert.equal(r.c.gravados.filter(g => g.nome !== 'Trend de Vídeo Fake COLORS' && g.nome !== 'Vídeo de IA do Instagram').length, 0,
    'cada troca regravava o nomes.json');
});

test('estabilidade: pedido lateral de uma vez não toma o nome; trabalho novo confirmado no marco seguinte toma', async () => {
  const r = renderer();
  const P = painel();
  primeiraMensagem(r, P, 'organiza o mapa dos robôs do Mac');
  r.chamadas[0].d.resolve('Mapa dos Robôs do Mac'); await esperar();
  // 26/09: revisão em toda resposta até a 15a; os laterais caem entre respostas do assunto principal
  const respostas = { 1: 'Mapa dos Robôs do Mac', 2: 'Transferência de Vídeos para SSD', 3: 'Mapa dos Robôs do Mac',
    4: 'Mapa dos Robôs do Mac', 5: 'Mapa dos Robôs do Mac', 6: 'Mapa dos Robôs do Mac', 7: 'Ativação de Esforço Máximo no Cockpit',
    8: 'Mapa dos Robôs do Mac', 9: 'Mapa dos Robôs do Mac', 10: 'Mapa dos Robôs do Mac', 11: 'Mapa dos Robôs do Mac',
    12: 'Transferência de Vídeos para SSD', 13: 'Transferência dos Vídeos pro SSD', 14: 'Transferência dos Vídeos pro SSD',
    15: 'Transferência dos Vídeos pro SSD', 20: 'Transferência dos Vídeos pro SSD' };
  const nomeDepois = {};
  for (let t = 1; t <= 20; t++) {
    const antes = r.chamadas.length;
    turno(r, P, t === 1 ? undefined : 'pedido ' + t, 'resposta ' + t);
    if (r.chamadas.length > antes) { r.chamadas.at(-1).d.resolve(respostas[t]); await esperar(); nomeDepois[t] = P.titulo; }
  }
  assert.equal(nomeDepois[2], 'Mapa dos Robôs do Mac', 'o pedido lateral do fim tomava o nome');
  assert.equal(nomeDepois[7], 'Mapa dos Robôs do Mac');
  assert.equal(nomeDepois[12], 'Mapa dos Robôs do Mac', 'um lateral sozinho nao confirma nada');
  assert.equal(nomeDepois[13], 'Transferência dos Vídeos pro SSD', 'o mesmo assunto novo em 2 revisões seguidas: o trabalho mudou');
});

test('estabilidade: a IA pode responder MANTER, e o main devolve o nome atual', async () => {
  const p = nomes.montarPedido({ mensagens: ['x y'], atual: 'Mapa dos Robôs' });
  assert.match(p, /Título atual: Mapa dos Robôs\. Se o trabalho principal continua o mesmo, responda só MANTER/);
  assert.match(nomes.PEDIDO_NOME, /responda só MANTER/);
  assert.equal(nomes.interpretarSaida('MANTER', 'Mapa dos Robôs'), 'Mapa dos Robôs');
  assert.equal(nomes.interpretarSaida('**Manter**', 'Mapa dos Robôs'), 'Mapa dos Robôs');
  assert.equal(nomes.interpretarSaida('MANTER', ''), '', 'sem nome atual, MANTER nao e nome');
  const h = loadMain();
  h.put(h.HOME + '/.local/bin/claude', '#!/bin/sh');
  const pronto = h.call('sessao:nomeCurto', { mensagens: ['organiza os robôs'], atual: 'Mapa dos Robôs' });
  await esperar();
  const rec = h.spawned.at(-1);
  rec.proc.stdout.emit('data', Buffer.from('MANTER\n'));
  rec.proc.emit('close', 0);
  assert.equal(await pronto, 'Mapa dos Robôs');
});

// 26/09: as ~600 conversas do robô de memória (claude-mem) eram metade da lista e passavam pelo filtro
test('a lista esconde as conversas do robô de memória (claude-mem), como os outros robôs', () => {
  assert.match(main, /if \(!incluirRobos && \(CONVERSA_DE_ROBO\.test\(it\.f\)/);
  const re = new RegExp(main.match(/const CONVERSA_DE_ROBO = \/(.*)\/;/)[1]);
  assert.ok(re.test('/Users/h/.claude/projects/-Users-h--claude-mem-observer-sessions/a.jsonl'));
  assert.ok(!re.test('/Users/h/.claude/projects/-Users-h-Desktop-Projetos-Pedro/a.jsonl'));
});

test('a lista esconde também conversa de teste (pasta temporária) e o robô do chat do webinário', () => {
  const [, corpo, flags] = main.match(/const PASTA_DE_ROBO = \/(.*)\/([a-z]*);/); const re = new RegExp(corpo, flags);
  for (const p of ['/private/tmp/ck-e2e', '/tmp', '/Users/h/Projetos/Pedro/Chat ao Vivo do Zoom - 12-09-2026']) assert.ok(re.test(p), p);
  for (const p of ['/Users/h/Projetos/Pedro', '/Users/h/tmpx', '/Users/homeromotti']) assert.ok(!re.test(p), p);
  assert.match(main, /PASTA_DE_ROBO\.test\(fi\.cwd \|\| ''\)\)\) continue;/, 'Claude');
  assert.match(main, /if \(!incluirRobos && PASTA_DE_ROBO\.test\(fi\.cwd \|\| ''\)\) continue;/, 'Codex');
});
