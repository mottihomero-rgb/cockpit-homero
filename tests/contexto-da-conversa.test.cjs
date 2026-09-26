'use strict';
/* 26/09: a bolinha do contexto (ao lado do Enviar) vivia vermelha com a conversa funcionando.
   A conta somava o cache lido de TODAS as chamadas do turno e pegava a janela do primeiro
   modelo da lista. Agora: tamanho = a última chamada do chat principal; janela = a do modelo
   principal. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadMain } = require('./main-harness.cjs');

async function turno(passos, extra) {
  const h = loadMain();
  await h.call('pane:start', { paneId: 'p1', engine: 'claude', cwd: h.HOME });
  for (let i = 0; i < passos; i++) {
    h.evaluate('claudeMessage("p1", ' + JSON.stringify({ type: 'assistant', message: { model: 'claude-opus-5-5', content: [],
      usage: { input_tokens: 3, cache_creation_input_tokens: 500, cache_read_input_tokens: 100000 + i * 1000, output_tokens: 200 } } }) + ')');
  }
  if (extra) h.evaluate('claudeMessage("p1", ' + JSON.stringify(extra) + ')');
  h.evaluate('claudeMessage("p1", ' + JSON.stringify({ type: 'result', subtype: 'success',
    usage: { input_tokens: 60, cache_creation_input_tokens: 10000, cache_read_input_tokens: 2000000, output_tokens: 4000 },
    modelUsage: { 'claude-haiku-4-5': { contextWindow: 100000 }, 'claude-opus-5-5': { contextWindow: 200000 } } }) + ')');
  return h.paneEvents('tokens');
}

test('20 passos numa conversa de ~120 mil: a bolinha mostra ~120 mil de 200 mil, não 2 milhões', async () => {
  const ev = await turno(20);
  assert.ok(ev.length >= 1, 'o evento tokens tem de sair no fim do turno');
  const d = JSON.stringify(ev.at(-1));
  assert.match(d, /"total":119703/, 'o tamanho é o da última chamada: 3 + 500 + 119000 + 200');
  assert.match(d, /"janela":200000/, 'a janela é a do modelo principal (Opus), não a do Haiku');
});

test('mensagem de agente (parent_tool_use_id) não conta como tamanho da conversa principal', async () => {
  const ev = await turno(1, { type: 'assistant', parent_tool_use_id: 'toolu_x', message: { model: 'claude-haiku-4-5', content: [],
    usage: { input_tokens: 1, cache_read_input_tokens: 5000, output_tokens: 10 } } });
  assert.match(JSON.stringify(ev.at(-1)), /"total":100703/);
});
