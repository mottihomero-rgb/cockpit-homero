'use strict';
/* Guarda do lado do Mac da conversa costurada (25/09): o ligacoes.json.
   Trocar de IA no meio do chat faz o motor novo abrir outra conversa no armazenamento dele; o
   main guarda, para cada conversa nova, qual era a parte anterior. Carrega o main INTEIRO pelo
   harness (fs de mentira, nenhum motor sobe). */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadMain } = require(path.join(__dirname, 'main-harness.cjs'));

const nova = { engine: 'codex', id: 'C', file: '/x/C.jsonl', cwd: '/p' };
const anterior = { engine: 'claude', id: 'A', file: '/c/A.jsonl', cwd: '/p' };
const arquivo = (h) => h.HOME + '/app-data/ligacoes.json';
const plano = (x) => JSON.parse(JSON.stringify(x));

test('ligação gravada é lida de volta, com o formato combinado', () => {
  const h = loadMain();
  assert.deepEqual(plano(h.call('ligacoes:gravar', { nova, anterior })), { ok: true });
  const disco = JSON.parse(h.files.get(arquivo(h)).toString());
  assert.equal(disco.v, 1);
  assert.deepEqual(Object.keys(disco.ligacoes), ['codex:C']);
  const r = plano(h.call('ligacoes:ler'));
  assert.deepEqual({ ...r.ligacoes['codex:C'], quando: 0 }, { ...nova, anterior, quando: 0 });
  assert.ok(r.ligacoes['codex:C'].quando > 0);
  // a gravação é atômica (temporário + troca de nome): não sobra o .tmp
  assert.equal(h.files.has(arquivo(h) + '.tmp'), false);
});

test('três trocas (Claude → Codex → Claude) viram duas ligações encadeadas', () => {
  const h = loadMain();
  const a2 = { engine: 'claude', id: 'A2', file: '/c/A2.jsonl', cwd: '/p' };
  h.call('ligacoes:gravar', { nova, anterior });
  h.call('ligacoes:gravar', { nova: a2, anterior: nova });
  const r = plano(h.call('ligacoes:ler'));
  assert.equal(r.ligacoes['claude:A2'].anterior.id, 'C');
  assert.equal(r.ligacoes['codex:C'].anterior.id, 'A');
});

test('ligação dela mesma e ligação em círculo são recusadas', () => {
  const h = loadMain();
  assert.ok(h.call('ligacoes:gravar', { nova, anterior: { ...nova } }).error);
  h.call('ligacoes:gravar', { nova, anterior });                                  // C continua A
  assert.ok(h.call('ligacoes:gravar', { nova: anterior, anterior: nova }).error, 'A continuar C fecharia o círculo');
  assert.ok(h.call('ligacoes:gravar', { nova: { engine: 'codex' }, anterior }).error, 'sem número não grava');
  assert.deepEqual(Object.keys(plano(h.call('ligacoes:ler')).ligacoes), ['codex:C']);
});

test('arquivo corrompido: a leitura volta vazia e guarda uma cópia antes de escrever por cima', () => {
  const h = loadMain();
  h.put(arquivo(h), '{"v":1,"ligacoes":{"codex:C":');   // gravado pela metade
  assert.deepEqual(plano(h.call('ligacoes:ler')).ligacoes, {});
  assert.ok(h.files.has(arquivo(h) + '.quebrado'), 'o que estava lá fica guardado para resgatar');
  // e a próxima troca de IA continua gravando
  assert.deepEqual(plano(h.call('ligacoes:gravar', { nova, anterior })), { ok: true });
});

test('ligação torta no arquivo (chave errada, parte sem número, ligada nela mesma) é ignorada', () => {
  const h = loadMain();
  h.put(arquivo(h), JSON.stringify({ v: 1, ligacoes: {
    'codex:C': { ...nova, anterior },
    'codex:ERRADA': { ...nova, anterior },
    'claude:X': { engine: 'claude', id: 'X', anterior: { engine: 'claude' } },
    'claude:Y': { engine: 'claude', id: 'Y', anterior: { engine: 'claude', id: 'Y' } },
  } }));
  assert.deepEqual(Object.keys(plano(h.call('ligacoes:ler')).ligacoes), ['codex:C']);
});

test('a leitura traz o nome salvo das partes ligadas (o título da cadeia)', () => {
  const h = loadMain();
  h.put(h.HOME + '/app-data/nomes.json', JSON.stringify({ A: 'Criação de Vídeo com IA', Z: 'outra conversa' }));
  h.call('ligacoes:gravar', { nova, anterior });
  assert.deepEqual(plano(h.call('ligacoes:ler')).nomes, { A: 'Criação de Vídeo com IA' }, 'só os nomes das partes ligadas');
});

test('o celular alcança ler e gravar a ligação (trocar de IA no iPhone também costura)', () => {
  const fs = require('node:fs');
  const servidor = fs.readFileSync(path.join(__dirname, '../servidor-web.js'), 'utf8');
  const web = fs.readFileSync(path.join(__dirname, '../renderer/web.js'), 'utf8');
  const preload = fs.readFileSync(path.join(__dirname, '../preload.js'), 'utf8');
  for (const canal of ['ligacoes:ler', 'ligacoes:gravar']) {
    assert.ok(servidor.includes("'" + canal + "'"), canal + ' na lista PERMITIDOS');
    assert.ok(web.includes("'" + canal + "'"), canal + ' no web.js');
    assert.ok(preload.includes("'" + canal + "'"), canal + ' no preload');
  }
});

test('histórico do Gemini mostra só o pedido, sem o contexto colado pelo app na troca de IA', async () => {
  const h = loadMain();
  const f = h.HOME + '/app-data/gemini/g1.jsonl';
  h.put(f, [
    JSON.stringify({ cockpit: true, id: 'g1', cwd: '/p' }),
    JSON.stringify({ role: 'user', text: 'Estou continuando uma conversa que vinha sendo tocada por outro assistente...\n\n'
      + '--- conversa até aqui ---\n### Você:\nfaz o vídeo\n--- fim da conversa anterior ---\n\nAgora, o novo pedido:\ncorta em 30 segundos' }),
    JSON.stringify({ role: 'bot', text: 'Cortei.' }),
  ].join('\n'));
  const msgs = plano(await h.call('sessions:history', { engine: 'gemini', file: f, id: 'g1', cwd: '/p' }));
  assert.equal(msgs[0].text, 'corta em 30 segundos');
  assert.equal(msgs[1].text, 'Cortei.');
  // Claude e Codex já limpavam: continua igual
  assert.equal(h.evaluate("semContexto('ATENÇÃO: esta conversa caiu... Agora, o novo pedido:\\n oi')"), 'oi');
});

test('apagar uma conversa tira a costura dela do ligacoes.json', () => {
  const h = loadMain();
  h.call('ligacoes:gravar', { nova, anterior });
  h.evaluate("esquecerLigacoesDe('claude', 'A')");
  assert.deepEqual(plano(h.call('ligacoes:ler')).ligacoes, {});
  // e o apagar de verdade chama isso (junto com o apelido)
  const fs = require('node:fs');
  const main = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
  assert.match(main, /ipcMain\.handle\('sessao:apagar'[\s\S]{0,2400}esquecerLigacoesDe\(engine, id\)/);
});
