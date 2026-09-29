'use strict';

// O menu do Cockpit usa o catálogo do motor conectado. A Anthropic publica a
// lista atual em Markdown; o Codex entrega a lista da conta pelo app-server.
const FAMILIAS_CLAUDE = ['opus', 'fable', 'sonnet', 'haiku'];
const VERSOES_ANTIGAS_CLAUDE = [
  'claude-opus-5-5[1m]', 'claude-opus-5-5', 'claude-opus-5[1m]',
  'claude-fable-5-1[1m]', 'claude-fable-5', 'claude-opus-5',
  'claude-sonnet-5', 'claude-haiku-4-5-20251001',
];
const VERSOES_ANTIGAS_CODEX = [
  'gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna', 'gpt-5.6-sol',
  'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5',
];

function versao(id) {
  const m = String(id).match(/(?:^|[-.])(\d+)(?:[-.](\d+))?(?=-|\[|$)/);
  return m ? [Number(m[1]), Number(m[2] || 0)] : [0, 0];
}
function maisNovo(a, b) {
  const x = versao(a), y = versao(b);
  return x[0] !== y[0] ? x[0] > y[0] : x[1] > y[1];
}
function celulas(linha) {
  return String(linha || '').split('|').slice(1, -1).map(x => x.trim());
}
function modelosClaudeDoMarkdown(markdown) {
  const linhas = String(markdown || '').split(/\r?\n/);
  const cab = linhas.find(l => /^\|\s*Feature\s*\|/.test(l));
  const ids = linhas.find(l => /^\|\s*Claude API ID\s*\|/.test(l));
  const contexto = linhas.find(l => /^\|\s*\[Context window\]/.test(l));
  if (!cab || !ids || !contexto) throw new Error('Tabela de modelos do Claude mudou de formato');
  const nomes = celulas(cab).slice(1), codigos = celulas(ids).slice(1), janelas = celulas(contexto).slice(1);
  const ultimos = new Map();
  for (let i = 0; i < codigos.length; i++) {
    const id = (codigos[i].match(/`(claude-(?:opus|fable|sonnet|haiku)-[\w-]+)`/) || [])[1];
    if (!id) continue;
    const familia = (id.match(/^claude-(opus|fable|sonnet|haiku)-/) || [])[1];
    if (!familia) continue;
    const atual = ultimos.get(familia);
    if (!atual || maisNovo(id, atual.id)) ultimos.set(familia, { id, contexto: janelas[i] || '', nomeFonte: nomes[i] || '' });
  }
  if (FAMILIAS_CLAUDE.some(f => !ultimos.has(f))) throw new Error('Catálogo do Claude incompleto');
  const saida = [];
  for (const familia of FAMILIAS_CLAUDE) {
    const m = ultimos.get(familia);
    const v = versao(m.id);
    const nome = familia[0].toUpperCase() + familia.slice(1) + ' ' + v[0] + (v[1] ? '.' + v[1] : '');
    const efforts = familia === 'haiku' ? ['low', 'medium', 'high'] : ['low', 'medium', 'high', 'xhigh', 'max'];
    const comum = { nome, desc: familia === 'haiku' ? 'Rápido e econômico' : 'Versão atual do Claude', efforts,
      padraoEffort: familia === 'haiku' ? 'high' : 'xhigh' };
    saida.push({ ...comum, id: m.id, ...(familia === 'opus' ? { padrao: true } : {}) });
    if (familia === 'opus' && /\b1M\b/i.test(m.contexto)) {
      saida.push({ ...comum, id: m.id + '[1m]', nome: nome + ' (1M)', desc: 'Memória de até 1 milhão de tokens' });
    }
  }
  return saida;
}

function familiaCodex(id) {
  const m = String(id || '').match(/^gpt-\d+(?:[.-]\d+)?(?:-([a-z][\w-]*))?$/i);
  return m ? (m[1] || 'gpt') : String(id || '');
}
function ultimosModelosCodex(modelos) {
  const escolhidos = new Map();
  for (const m of Array.isArray(modelos) ? modelos : []) {
    if (!m || m.hidden || !m.id) continue;
    const familia = familiaCodex(m.id);
    const anterior = escolhidos.get(familia);
    if (!anterior || maisNovo(m.id, anterior.id)) escolhidos.set(familia, m);
  }
  // Mantém a prioridade da lista da própria conta, trocando só gerações antigas.
  return [...escolhidos.values()].sort((a, b) => modelos.indexOf(a) - modelos.indexOf(b));
}

function novidades(antes, depois) {
  const antigos = new Set((antes || []).map(x => typeof x === 'string' ? x : x.id));
  return (depois || []).filter(m => !antigos.has(m.id));
}

module.exports = { modelosClaudeDoMarkdown, ultimosModelosCodex, novidades,
  VERSOES_ANTIGAS_CLAUDE, VERSOES_ANTIGAS_CODEX };
