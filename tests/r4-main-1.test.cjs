'use strict';

// Testes de guarda do lote "main" (R4), faixa consertador, lote 1.
// Cobrem: R4-003 (dedupe de aviso de limite sintetico nunca resetava entre episodios diferentes
// na mesma conversa aberta) e R4-001 (R3-018 tinha ficado incompleto: so' Claude/Grok/Gemini
// subiam 'geracao' em esquecerUso, o Codex nao — trocar de conta com uma leitura de uso ainda
// em voo podia gravar por cima o numero da conta ANTIGA).
// Padrao de arquivo: tests/main-harness.cjs (main.js inteiro numa VM), igual a
// tests/auditoria-main-20260921.test.cjs e tests/r3-main-2.test.cjs.

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadMain } = require('./main-harness.cjs');

function json(proc, value) { proc.stdout.emit('data', Buffer.from(JSON.stringify(value) + '\n')); }
async function claude(h, paneId = 'p1') {
  await h.call('pane:start', { paneId, engine: 'claude', cwd: h.HOME });
  return h.spawned.at(-1).proc;
}

// ===================== R4-003 =====================
// Dedupe de nota de erro sintetico so podia suprimir retentativas SEGUIDAS do MESMO episodio.
// Sem reset, o MESMO texto (ex.: limite semanal fixo, sem hora dinamica) batendo de novo mais
// tarde na mesma conversa aberta ficava engolido pra sempre, mesmo com trabalho normal no meio.

test('R4-003: aviso de limite sintetico reseta quando entra texto real, e avisa de novo se o MESMO limite bater outra vez', async () => {
  const h = loadMain();
  const proc = await claude(h);
  h.clear();

  // episodio 1: erro sintetico (ex.: limite semanal)
  json(proc, { type: 'assistant', message: { model: '<synthetic>', content: [{ type: 'text', text: 'Limite semanal atingido' }] } });
  assert.equal(h.paneEvents('note').length, 1, 'o primeiro aviso sintetico nao apareceu');

  // trabalho normal no meio (texto de MODELO REAL, nao sintetico)
  json(proc, { type: 'assistant', message: { model: 'claude-opus-5-5', content: [{ type: 'text', text: 'Trabalho normal concluido' }] } });
  assert.equal(h.paneEvents('note').length, 1, 'texto de modelo real nao pode gerar nota nova');

  // episodio 2: o MESMO limite bate de novo (texto identico ao do episodio 1)
  json(proc, { type: 'assistant', message: { model: '<synthetic>', content: [{ type: 'text', text: 'Limite semanal atingido' }] } });
  assert.equal(h.paneEvents('note').length, 2,
    'o MESMO aviso sintetico bateu de novo num episodio novo e foi engolido pelo dedupe (faltou resetar no meio)');
});

test('R4-003: retentativas SEGUIDAS do mesmo episodio continuam sendo engolidas (nao virou over-notificar)', async () => {
  const h = loadMain();
  const proc = await claude(h);
  h.clear();

  json(proc, { type: 'assistant', message: { model: '<synthetic>', content: [{ type: 'text', text: 'Sem internet' }] } });
  json(proc, { type: 'assistant', message: { model: '<synthetic>', content: [{ type: 'text', text: 'Sem internet' }] } });
  json(proc, { type: 'assistant', message: { model: '<synthetic>', content: [{ type: 'text', text: 'Sem internet' }] } });
  assert.equal(h.paneEvents('note').length, 1, 'retentativas seguidas do mesmo texto sintetico nao podiam gerar mais de 1 nota');
});

// ===================== R4-001 =====================
// Mesma corrida do R3-018 (Claude/Grok/Gemini), so que faltando no Codex: uma leitura de uso
// iniciada ANTES da troca de conta, que so termina DEPOIS que a leitura da conta NOVA ja
// respondeu, nao pode sobrescrever o cache com o numero da conta ANTIGA.

test('R4-001: leitura em voo do Codex na troca de conta nao sobrescreve o cache da conta nova', async () => {
  const h = loadMain();
  let resolveA, resolveB, chamadas = 0;
  const esperaA = new Promise((r) => { resolveA = r; });
  const esperaB = new Promise((r) => { resolveB = r; });
  h.attachCodex('local', async (m) => {
    if (m !== 'account/rateLimits/read') return {};
    chamadas++;
    const primeira = chamadas === 1;
    await (primeira ? esperaA : esperaB);
    return { rateLimits: { primary: { usedPercent: primeira ? 11 : 99, windowDurationMins: 10080, resetsAt: 4102444800 }, secondary: null } };
  });

  const p1 = h.call('uso:ler', 'codex'); // conta A: pedido sai e fica "voando"
  for (let i = 0; i < 30 && chamadas < 1; i++) await Promise.resolve();
  assert.equal(chamadas, 1, 'a leitura da conta A nao chegou a disparar o pedido ao app-server');

  h.evaluate('esquecerUso("codex")'); // Homero troca de conta com a leitura de A ainda em voo
  const p2 = h.call('uso:ler', 'codex'); // conta B: leitura nova, geracao nova
  for (let i = 0; i < 30 && chamadas < 2; i++) await Promise.resolve();
  resolveB(); // B responde primeiro (rapido)
  await p2;
  resolveA(); // A so termina DEPOIS de B — e o cenario do achado
  await p1;
  await Promise.resolve(); await Promise.resolve();

  const cache = h.evaluate('usoCodex.dados');
  assert.ok(cache, 'o cache do Codex ficou vazio depois das duas leituras');
  assert.equal(cache.primary.usedPercent, 99,
    'a leitura ANTIGA (conta A, 11%) sobrescreveu o cache do Codex depois da troca — devia ficar 99% (conta B)');
});
