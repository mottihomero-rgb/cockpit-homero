'use strict';
/* O quadro "Limite de uso" ficava com "—" e "o Claude está limitando as consultas agora".
   Duas causas: (1) cada tela perguntava o uso ao Claude por conta propria (faixa, cartao,
   celular, fim de cada resposta), a Anthropic respondia 429 e o app APAGAVA os numeros que ja
   tinha; (2) o plano Pro do Codex hoje so tem a janela da semana, e a "Sessão" vazia parecia
   defeito. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadMain } = require('./main-harness.cjs');

const USO_BOM = { five_hour: { utilization: 29, resets_at: '2099-01-01T00:00:00Z' },
  seven_day: { utilization: 55, resets_at: '2099-01-07T00:00:00Z' } };

function comRede(h, respostas) {
  const pedidos = [];
  const g = h.evaluate('globalThis');
  g.fetch = async (url) => {
    pedidos.push(url);
    const r = respostas.length > 1 ? respostas.shift() : respostas[0];
    if (r instanceof Error) throw r;
    return { status: r.status, ok: r.status >= 200 && r.status < 300,
      headers: { get: (n) => (r.headers || {})[String(n).toLowerCase()] ?? null },
      json: async () => r.body };
  };
  h.evaluate('credGuardada = "token-de-teste"');
  return pedidos;
}

test('Claude: 429 depois de uma leitura boa mantem os numeros, marcados como antigos', async () => {
  const h = loadMain();
  const pedidos = comRede(h, [{ status: 200, body: USO_BOM }, { status: 429, headers: { 'retry-after': '120' } }]);
  const bom = await h.call('uso:ler', 'claude');
  assert.equal(bom.sessao.pct, 29); assert.equal(bom.semana.pct, 55);
  h.evaluate('usoClaude.quando = Date.now() - 300000'); // leitura de 5 min atras: vai buscar de novo
  const depois = await h.call('uso:ler', 'claude');
  assert.equal(pedidos.length, 2);
  assert.equal(depois.sessao.pct, 29, 'o 429 nao pode apagar o numero que ja tinha');
  assert.equal(depois.semana.pct, 55);
  assert.ok(depois.velho > 0, 'tem que dizer de quando e o numero');
  assert.ok(!depois.limitado);
});

test('Claude: consultas seguidas usam a mesma leitura, sem bater de novo na Anthropic', async () => {
  const h = loadMain();
  const pedidos = comRede(h, [{ status: 200, body: USO_BOM }]);
  await Promise.all([h.call('uso:ler', 'claude'), h.call('uso:ler', 'claude'), h.call('uso:ler', 'claude')]);
  await h.call('uso:ler', 'claude');
  assert.equal(pedidos.length, 1);
});

test('Claude: depois do 429 espera o prazo que ela mandou antes de perguntar de novo', async () => {
  const h = loadMain();
  const pedidos = comRede(h, [{ status: 429, headers: { 'retry-after': '120' } }, { status: 200, body: USO_BOM }]);
  const r = await h.call('uso:ler', 'claude');
  assert.equal(r.limitado, true);
  assert.ok(r.voltaEm > Date.now() + 100000, 'devolve quando tenta de novo');
  await h.call('uso:ler', 'claude');
  assert.equal(pedidos.length, 1, 'dentro da pausa nao pode perguntar');
  h.evaluate('usoClaude.pausaAte = 0');
  const ok = await h.call('uso:ler', 'claude');
  assert.equal(pedidos.length, 2); assert.equal(ok.sessao.pct, 29);
});

test('Claude: falha de rede tambem devolve o ultimo numero bom', async () => {
  const h = loadMain();
  comRede(h, [{ status: 200, body: USO_BOM }, new Error('sem internet')]);
  await h.call('uso:ler', 'claude');
  h.evaluate('usoClaude.quando = Date.now() - 300000');
  const r = await h.call('uso:ler', 'claude');
  assert.equal(r.semana.pct, 55); assert.ok(r.velho > 0);
});

test('Claude: numero antigo de janela que ja zerou nao aparece como se valesse', async () => {
  const h = loadMain();
  const passado = { ...USO_BOM, five_hour: { utilization: 97, resets_at: '2001-01-01T00:00:00Z' } };
  comRede(h, [{ status: 200, body: passado }, { status: 429 }]);
  await h.call('uso:ler', 'claude');
  h.evaluate('usoClaude.quando = Date.now() - 300000');
  const r = await h.call('uso:ler', 'claude');
  assert.equal(r.sessao, null, 'a janela de 5h ja virou: o 97% antigo nao vale mais');
  assert.equal(r.semana.pct, 55);
});

const SO_SEMANA = { rateLimits: { primary: { usedPercent: 88, windowDurationMins: 10080, resetsAt: 4102444800 }, secondary: null, planType: 'pro' } };

test('Codex: plano so com limite da semana diz que nao ha limite de sessao', async () => {
  const h = loadMain();
  h.attachCodex('local', async (m) => (m === 'account/rateLimits/read' ? SO_SEMANA : {}));
  const r = await h.call('uso:ler', 'codex');
  assert.equal(r.semana.pct, 88);
  assert.equal(r.sessao, null);
  assert.equal(r.semSessao, true);
});

test('Codex: falha depois de uma leitura boa devolve o ultimo numero bom', async () => {
  const h = loadMain();
  let falhar = false;
  h.attachCodex('local', async (m) => {
    if (m !== 'account/rateLimits/read') return {};
    if (falhar) throw new Error('backend fora');
    return SO_SEMANA;
  });
  await h.call('uso:ler', 'codex');
  falhar = true;
  // R3-019: limitesDoCodex ganhou o mesmo cache de 90s que Claude/Grok/Gemini ja tinham (o
  // teste deles logo acima usa o mesmo truque) — sem "andar" o relogio a leitura seguinte
  // vinha do cache e nem chegava a bater no backend (que agora falharia de propósito aqui)
  h.evaluate('usoCodex.quando = Date.now() - 300000');
  const r = await h.call('uso:ler', 'codex');
  assert.equal(r.semana.pct, 88); assert.ok(r.velho > 0);
});

const GROK_BILLING = {
  config: {
    currentPeriod: { type: 'USAGE_PERIOD_TYPE_WEEKLY', start: '2099-01-01T00:00:00Z', end: '2099-01-08T00:00:00Z' },
    creditUsagePercent: 15,
    productUsage: [{ product: 'GrokBuild', usagePercent: 13 }, { product: 'GrokChat', usagePercent: 2 }],
    onDemandCap: { val: 0 },
    onDemandUsed: { val: 0 },
  },
};

function comGrok(h, respostas) {
  h.put(h.HOME + '/.grok/auth.json', JSON.stringify({
    'https://auth.x.ai': {
      auth_mode: 'oidc', key: 'token-grok-secreto', email: 'homero@example.com',
      first_name: 'Homero', last_name: 'Motti', oidc_issuer: 'https://auth.x.ai',
    },
  }));
  const pedidos = [];
  const fila = [...respostas];
  const g = h.evaluate('globalThis');
  g.fetch = async (url, opts) => {
    const headers = (opts && opts.headers) || {};
    pedidos.push({ url: String(url), auth: headers.Authorization || '', tokenAuth: headers['x-xai-token-auth'] || '' });
    if (String(url).includes('/user')) {
      return { status: 200, ok: true, headers: { get: () => null }, json: async () => ({ subscriptionTier: 'SuperGrokLite', email: 'homero@example.com' }) };
    }
    const r = fila.length > 1 ? fila.shift() : fila[0];
    if (r instanceof Error) throw r;
    return { status: r.status, ok: r.status >= 200 && r.status < 300,
      headers: { get: (n) => (r.headers || {})[String(n).toLowerCase()] ?? null },
      json: async () => r.body };
  };
  return pedidos;
}

test('Grok sem login não pergunta o limite e não devolve token', async () => {
  const h = loadMain();
  assert.equal(await h.call('uso:ler', 'grok'), null);
  const c = await h.call('conta:ler', 'grok');
  assert.equal(c.entrou, false);
  assert.doesNotMatch(JSON.stringify(c), /token-grok|Bearer /);
  assert.equal(h.violations.length, 0);
});

test('Grok: plano semanal vira barra da semana, sem limite de sessão', async () => {
  const h = loadMain();
  const pedidos = comGrok(h, [{ status: 200, body: GROK_BILLING }]);
  const r = await h.call('uso:ler', 'grok');
  assert.equal(r.semana.pct, 15);
  assert.equal(r.sessao, null);
  assert.equal(r.semSessao, true);
  assert.ok(pedidos.some(p => p.url.includes('/billing?format=credits')));
  assert.equal(pedidos[0].auth, 'Bearer token-grok-secreto');
  assert.equal(pedidos[0].tokenAuth, 'xai-grok-cli');
  const c = await h.call('conta:ler', 'grok');
  assert.equal(c.entrou, true);
  assert.equal(c.plano, 'SuperGrok Lite');
  assert.equal(c.semana.pct, 15);
  assert.doesNotMatch(JSON.stringify(c), /token-grok-secreto|Bearer /);
});

const GEMINI_USO = {
  status: 'SUCCESS',
  command: {
    name: 'usage',
    data: {
      groups: [
        {
          name: 'Gemini Models',
          buckets: [
            { id: 'gemini-weekly', name: 'Weekly Limit Remaining', window: 'weekly', remaining_fraction: 0.9792, reset_time: '2099-01-08T00:00:00Z' },
            { id: 'gemini-5h', name: 'Five Hour Limit Remaining', window: '5h', remaining_fraction: 0.4, reset_time: '2099-01-01T05:00:00Z' },
          ],
        },
        {
          name: 'Claude and GPT models',
          buckets: [{ id: '3p-weekly', window: 'weekly', remaining_fraction: 1, reset_time: '2099-01-08T00:00:00Z' }],
        },
      ],
    },
  },
};

test('Gemini: usa o /usage do Antigravity e pega sessão e semana do grupo Gemini', async () => {
  const h = loadMain();
  h.onAgyUso(() => GEMINI_USO);
  const r = await h.call('uso:ler', 'gemini');
  assert.equal(r.semana.pct, 2);
  assert.equal(r.sessao.pct, 60);
  assert.equal(r.semSessao, false);
  const c = await h.call('conta:ler', 'gemini');
  assert.equal(c.entrou, true);
  assert.equal(c.semana.pct, 2);
  assert.equal(c.sessao.pct, 60);
  assert.ok(h.spawned.some(s => s.args.includes('/usage')));
  assert.ok(h.spawned.every(s => !s.args.includes('--dangerously-skip-permissions')));
  assert.doesNotMatch(JSON.stringify(c), /ya29\.|refresh_token|access_token/);
});

test('Gemini: só semana vira barra da semana, sem limite de sessão', async () => {
  const h = loadMain();
  h.onAgyUso(() => ({
    status: 'SUCCESS',
    command: { name: 'usage', data: { groups: [
      { name: 'Gemini Models', buckets: [
        { id: 'gemini-weekly', window: 'weekly', remaining_fraction: 0.5, reset_time: '2099-01-08T00:00:00Z' },
      ] },
    ] } },
  }));
  const r = await h.call('uso:ler', 'gemini');
  assert.equal(r.semana.pct, 50);
  assert.equal(r.sessao, null);
  assert.equal(r.semSessao, true);
});

test('Gemini: resposta que não é o /usage não vira limite', async () => {
  const h = loadMain();
  h.onAgyUso(() => ({ status: 'SUCCESS', response: 'quota is fine', usage: { total_tokens: 12 } }));
  assert.equal(await h.call('uso:ler', 'gemini'), null);
});

test('Grok: 429 depois de uma leitura boa mantém os números', async () => {
  const h = loadMain();
  const pedidos = comGrok(h, [{ status: 200, body: GROK_BILLING }, { status: 429, headers: { 'retry-after': '120' } }]);
  await h.call('uso:ler', 'grok');
  h.evaluate('usoGrok.quando = Date.now() - 300000');
  const depois = await h.call('uso:ler', 'grok');
  assert.equal(depois.semana.pct, 15);
  assert.ok(depois.velho > 0);
  assert.ok(!depois.limitado);
  assert.ok(pedidos.filter(p => p.url.includes('/billing')).length >= 2);
});
