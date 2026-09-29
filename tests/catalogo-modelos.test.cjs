'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { modelosClaudeDoMarkdown, ultimosModelosCodex, novidades } = require('../catalogo-modelos');

const tabela = (opus = 'claude-opus-5-5', haiku = 'claude-haiku-4-5-20251001') => `
| Feature | Claude Opus | Claude Fable | Claude Sonnet | Claude Haiku |
| --- | --- | --- | --- | --- |
| Claude API ID | \`${opus}\` | \`claude-fable-5-1\` | \`claude-sonnet-5-5\` | \`${haiku}\` |
| [Context window](https://example.com) | 1M tokens | 1M tokens | 1M tokens | 200K tokens |
`;

test('Claude mostra só as famílias atuais e a opção Opus de 1M', () => {
  const lista = modelosClaudeDoMarkdown(tabela());
  assert.deepEqual(lista.map(m => m.nome), ['Opus 5.5', 'Opus 5.5 (1M)', 'Fable 5.1', 'Sonnet 5.5', 'Haiku 4.5']);
  assert.equal(lista[0].id, 'claude-opus-5-5');
  assert.equal(lista[1].id, 'claude-opus-5-5[1m]');
});

test('Claude detecta novas versões sem ficar preso a números fixos', () => {
  const lista = modelosClaudeDoMarkdown(tabela('claude-opus-6', 'claude-haiku-5'));
  assert.deepEqual(lista.filter(m => /Opus|Haiku/.test(m.nome)).map(m => m.nome), ['Opus 6', 'Opus 6 (1M)', 'Haiku 5']);
});

test('tabela incompleta não apaga os modelos que já funcionam', () => {
  assert.throws(() => modelosClaudeDoMarkdown('| Feature | Claude Opus |\n| Claude API ID | `claude-opus-6` |'));
});

test('Codex mantém a versão mais nova de cada família e oculta modelos internos', () => {
  const entrada = ['gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.5']
    .map(id => ({ id }));
  entrada.push({ id: 'gpt-reserve', hidden: true });
  assert.deepEqual(ultimosModelosCodex(entrada).map(m => m.id),
    ['gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna', 'gpt-5.6-terra', 'gpt-5.5']);
});

test('uma nova versão vira aviso apenas uma vez', () => {
  assert.deepEqual(novidades(['gpt-6-sol'], [{ id: 'gpt-6-sol' }, { id: 'gpt-7-sol' }]).map(m => m.id), ['gpt-7-sol']);
});
