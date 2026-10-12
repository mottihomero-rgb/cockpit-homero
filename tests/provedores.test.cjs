'use strict';
/* IAs de chave (06/10/2026): DeepSeek, MiMo e Muse Spark entram no Cockpit pelo Claude Code
   apontado para outro endereço. Este teste segura o que não pode quebrar: o ambiente que o
   Claude Code recebe, a chave guardada com permissão só do dono, a conferência da chave, o saldo,
   e que a tela (nomes, logos, cores, botões) conhece as mesmas três IAs que o main. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PROVEDORES, ehProvedor, criarProvedores, mascara } = require('../provedores.js');

const raiz = path.resolve(__dirname, '..');
const ler = (f) => fs.readFileSync(path.join(raiz, f), 'utf8');
const casa = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ck-prov-'));
const resposta = (status, corpo) => ({ status, ok: status >= 200 && status < 300, json: async () => corpo });

test('as três IAs existem, com modelo padrão e endereço https', () => {
  assert.deepEqual(Object.keys(PROVEDORES), ['deepseek', 'mimo', 'muse']);
  for (const [id, p] of Object.entries(PROVEDORES)) {
    assert.match(p.base, /^https:\/\//, id);
    assert.equal(p.modelos.filter(m => m.padrao).length, 1, id + ' precisa de 1 modelo padrão');
    assert.ok(ehProvedor(id));
  }
  assert.equal(ehProvedor('claude'), false);
  assert.equal(ehProvedor('constructor'), false);
});

test('a tela (app.js) conhece as mesmas IAs, nomes e modelos que o main', () => {
  const app = ler('renderer/app.js');
  const i = app.indexOf('const PROVEDORES_UI = {'), f = app.indexOf('const PROVEDORES_IDS');
  assert.ok(i >= 0 && f > i);
  const vm = require('node:vm');
  const c = {}; vm.runInNewContext(app.slice(i, f) + '\nthis.r = JSON.stringify(PROVEDORES_UI);', c);
  c.r = JSON.parse(c.r);   // sai do vm: arrays de outro mundo não comparam
  assert.deepEqual(Object.keys(c.r), Object.keys(PROVEDORES));
  for (const id of Object.keys(PROVEDORES)) {
    assert.equal(c.r[id].nome, PROVEDORES[id].nome, id);
    assert.deepEqual(c.r[id].modelos.map(m => m.id), PROVEDORES[id].modelos.map(m => m.id), id);
    assert.equal(c.r[id].painel, PROVEDORES[id].painel, id);
  }
});

test('chave: validar, guardar com permissão 600, mascarar e remover', () => {
  const HOME = casa();
  const p = criarProvedores({ HOME });
  assert.equal(p.ler('deepseek').entrou, false);
  assert.throws(() => p.salvar('deepseek', { chave: '' }), /Cole a chave/);
  assert.throws(() => p.salvar('deepseek', { chave: 'curta' }), /incompleta/);
  assert.throws(() => p.salvar('deepseek', { chave: 'sk-abc def ghi jkl' }), /incompleta/);
  assert.throws(() => p.salvar('deepseek', { chave: 'sk-1234567890abcd', base: 'http://inseguro.com' }), /https/);
  assert.throws(() => p.salvar('claude', { chave: 'sk-1234567890abcd' }), /desconhecida/);
  const conta = p.salvar('deepseek', { chave: '  sk-1234567890abcd  ' });
  assert.equal(conta.entrou, true);
  assert.equal(conta.email, '••••abcd');
  assert.ok(!JSON.stringify(conta).includes('sk-1234567890'), 'a chave inteira nunca sai de ler()');
  const arq = path.join(HOME, '.cockpit', 'provedores.json');
  assert.equal(fs.statSync(arq).mode & 0o777, 0o600);
  assert.equal(p.chaveDe('deepseek'), 'sk-1234567890abcd');
  assert.equal(p.remover('deepseek').entrou, false);
  assert.equal(p.chaveDe('deepseek'), '');
  assert.equal(mascara(''), '');
});

test('MiMo: chave tp- usa o endereço do Token Plan, sk- usa o normal', () => {
  const p = criarProvedores({ HOME: casa() });
  assert.equal(p.salvar('mimo', { chave: 'sk-1234567890abcd' }).base, PROVEDORES.mimo.base);
  assert.equal(p.salvar('mimo', { chave: 'tp-1234567890abcd' }).base, PROVEDORES.mimo.basePlano);
});

test('ambiente do Claude Code: endereço, chave e modelo em todos os apelidos, sem vazar a conta da Anthropic', () => {
  const p = criarProvedores({ HOME: casa() });
  assert.throws(() => p.ambiente('deepseek', 'deepseek-flash', {}), /Cole a chave/);
  p.salvar('deepseek', { chave: 'sk-1234567890abcd' });
  const env = p.ambiente('deepseek', 'deepseek-v4-pro', { PATH: '/bin', ANTHROPIC_API_KEY: 'sk-ant-vazou', CLAUDE_CODE_OAUTH_TOKEN: 'oauth-vazou', ANTHROPIC_BASE_URL: 'https://velho' });
  assert.equal(env.PATH, '/bin');
  assert.equal(env.ANTHROPIC_BASE_URL, 'https://api.deepseek.com/anthropic');
  assert.equal(env.ANTHROPIC_AUTH_TOKEN, 'sk-1234567890abcd');
  assert.equal(env.ANTHROPIC_API_KEY, '');
  assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN, undefined);
  for (const k of ['ANTHROPIC_MODEL', 'ANTHROPIC_DEFAULT_OPUS_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL', 'ANTHROPIC_DEFAULT_HAIKU_MODEL', 'ANTHROPIC_SMALL_FAST_MODEL', 'CLAUDE_CODE_SUBAGENT_MODEL']) {
    assert.equal(env[k], 'deepseek-v4-pro', k);
  }
  // com chave e o modelo direto pedido: nada de OmniRoute
  assert.equal(p.ambiente('deepseek', 'deepseek-flash', {}).ANTHROPIC_MODEL, 'deepseek-flash');
  assert.equal(p.ehGratis('deepseek', 'deepseek-flash'), false);
});

test('rota grátis: sem chave nenhuma, o modelo da NVIDIA roda pelo OmniRoute do Mac', async () => {
  const HOME = casa();
  const p = criarProvedores({ HOME, fetchFn: async () => resposta(200, {}) });
  assert.equal(p.ler('muse').entrou, false, 'sem a chave do OmniRoute não há rota grátis');
  assert.throws(() => p.ambiente('muse', 'nvidia/meta/muse-glimmer-30b', {}), /OmniRoute/);
  fs.writeFileSync(path.join(HOME, '.omniroute_api_key'), 'chave-do-omni\n');
  const c = p.ler('muse');
  assert.equal(c.entrou, true); assert.equal(c.comChave, false); assert.equal(c.gratis, true);
  assert.equal(c.email, 'Grátis · NVIDIA');
  assert.equal(p.ler('mimo').entrou, false, 'a MiMo não tem rota grátis');
  const env = p.ambiente('muse', 'nvidia/meta/muse-glimmer-30b', { ANTHROPIC_API_KEY: 'sk-ant-vazou' });
  assert.equal(env.ANTHROPIC_BASE_URL, 'http://localhost:20128');
  assert.equal(env.ANTHROPIC_AUTH_TOKEN, 'chave-do-omni');
  assert.equal(env.ANTHROPIC_API_KEY, '');
  assert.equal(env.ANTHROPIC_MODEL, 'nvidia/meta/muse-glimmer-30b');
  // o modelo com chave continua exigindo a chave
  assert.throws(() => p.ambiente('muse', 'meta/muse-spark-1.3', {}), /Cole a chave/);
  // só o Muse tem rota grátis que responde (a DeepSeek da NVIDIA ficou fora do ar em 07/10: 220 s sem resposta)
  assert.equal(PROVEDORES.muse.modelos.find(m => m.padrao).via, 'omni');
  for (const id of ['deepseek', 'mimo']) assert.equal(PROVEDORES[id].modelos.find(m => m.padrao).via, undefined, id);
  assert.equal(p.ler('deepseek').entrou, false);
  // OmniRoute já no ar: garantirOmni responde sem subir nada
  let subiu = false;
  const q = criarProvedores({ HOME, fetchFn: async () => resposta(200, {}), spawnFn: () => { subiu = true; return {}; } });
  assert.equal(await q.garantirOmni(), true); assert.equal(subiu, false);
});

test('conferir a chave: 401 recusa, 402 aceita avisando, rede caída não afirma nada', async () => {
  const chamadas = [];
  const faz = (status) => criarProvedores({ HOME: casa(), fetchFn: async (url, op) => { chamadas.push({ url, op }); return resposta(status, {}); } });
  let r = await faz(401).testar('deepseek', { chave: 'sk-1234567890abcd' });
  assert.equal(r.ok, false);
  r = await faz(402).testar('deepseek', { chave: 'sk-1234567890abcd' });
  assert.equal(r.ok, true); assert.match(r.aviso, /sem saldo/);
  r = await faz(200).testar('muse', { chave: 'sk-or-1234567890abcd' });
  assert.equal(r.ok, true);
  assert.equal(chamadas.at(-1).url, 'https://openrouter.ai/api/v1/messages');
  assert.match(chamadas.at(-1).op.headers.Authorization, /^Bearer sk-or-/);
  assert.equal(JSON.parse(chamadas.at(-1).op.body).max_tokens, 1, 'a conferência gasta 1 token');
  r = await criarProvedores({ HOME: casa(), fetchFn: async () => { throw new Error('ENOTFOUND'); } }).testar('mimo', { chave: 'sk-1234567890abcd' });
  assert.equal(r.ok, null);
});

test('saldo: DeepSeek em dinheiro sem porcentagem; OpenRouter com porcentagem do crédito', async () => {
  const HOME = casa();
  const urls = [];
  const p = criarProvedores({ HOME, fetchFn: async (url) => {
    urls.push(url);
    if (url.endsWith('/user/balance')) return resposta(200, { is_available: true, balance_infos: [{ currency: 'USD', total_balance: '4.20' }] });
    if (url.endsWith('/v1/key')) return resposta(200, { data: { limit: null, usage: 1 } });
    if (url.endsWith('/v1/credits')) return resposta(200, { data: { total_credits: 10, total_usage: 2.5 } });
    return resposta(404, {});
  } });
  assert.equal(await p.saldo('deepseek'), null, 'sem chave não consulta');
  p.salvar('deepseek', { chave: 'sk-1234567890abcd' });
  const d = await p.saldo('deepseek');
  assert.equal(d.restante, 4.2); assert.equal(d.pct, null); assert.match(d.texto, /^US\$ 4,20$/); assert.equal(d.curto, '$4,2');
  p.salvar('muse', { chave: 'sk-or-1234567890abcd' });
  const m = await p.saldo('muse');
  assert.equal(m.restante, 7.5); assert.equal(m.pct, 25);
  p.salvar('mimo', { chave: 'sk-1234567890abcd' });
  assert.equal(await p.saldo('mimo'), null, 'a Xiaomi não publica saldo');
});

test('main: o pedido vira Claude + provedor, a chave só se cola no Mac e o motor sobe com o ambiente certo', () => {
  const main = ler('main.js');
  assert.match(main, /function comProvedor\(nome, fn\)/);
  assert.match(main, /data = \{ \.\.\.data, provedor: data\.engine, engine: 'claude' \}/);
  assert.match(main, /provedores\.ambiente\(provedor, opts\.model, env\)/);
  assert.match(main, /handle\('provedor:salvar'[\s\S]{0,200}souRemoto\(_e\)/);
  assert.match(main, /handle\('provedor:remover'[\s\S]{0,200}souRemoto\(_e\)/);
  // modelo de fora não conhece esforço nem ultracode
  assert.match(main, /if \(opts\.effort && !provedor\) args\.push\('--effort'/);
  assert.match(main, /opts\.effort === 'max' && !provedor/);
  // conta, limite e login respondem aos três ids
  assert.match(main, /handle\('conta:ler', async \(_e, engine\) => \{\n  if \(ehProvedor\(engine\)\)/);
  assert.match(main, /handle\('uso:ler', async \(_e, engine\) => \{\n  if \(ehProvedor\(engine\)\)/);
  assert.match(main, /handle\('auth:acao', async \(_e, \{ engine, acao, cwd \}\) => \{\n  if \(ehProvedor\(engine\)\)/);
  // a chave só vai para o preload do Mac; o celular recebe um recado
  assert.match(ler('preload.js'), /provedorSalvar/);
  assert.match(ler('renderer/web.js'), /provedorSalvar: \(\) => Promise\.resolve\(\{ error:/);
  assert.doesNotMatch(ler('servidor-web.js'), /provedor:salvar/);
});

test('tela: logo e cor existem para cada IA; botão do chat e da nova aba só para as que estão à vista', () => {
  const app = ler('renderer/app.js');
  // 09/10: as IAs de chave saíram da vista (MOTORES_VISIVEIS). O código delas fica para as conversas
  // antigas abrirem, mas IA fora da vista não pode ter botão sobrando no HTML.
  const aVista = JSON.parse(/const MOTORES_VISIVEIS = (\[[^\]]*\]);/.exec(app)[1].replace(/'/g, '"'));
  const tokens = ler('renderer/cockpit-tokens.css'), estilo = ler('renderer/style.css');
  for (const id of Object.keys(PROVEDORES)) {
    assert.match(app, new RegExp('\\n  "' + id + '": \\{\\n    "viewBox": "0 0 24 24"'), 'logo de ' + id);
    assert.match(tokens, new RegExp('--logo-' + id + ': #'), 'cor de ' + id);
    assert.match(estilo, new RegExp('\\.na-motor\\[data-motor="' + id + '"\\]'), 'css de ' + id);
    for (const html of ['renderer/index.html', 'renderer/index-web.html']) {
      const h = ler(html);
      const cap = id[0].toUpperCase() + id.slice(1);
      const confere = aVista.includes(id) ? assert.match : assert.doesNotMatch;
      confere(h, new RegExp('class="ch-lado" data-motor="' + id + '"'), html + ' ch-lado ' + id);
      confere(h, new RegExp('class="na-motor" data-motor="' + id + '"'), html + ' na-motor ' + id);
      confere(h, new RegExp('id="naIc' + cap + '"'), html + ' naIc' + cap);
    }
  }
  // o boot preenche #naIc<Nome> para todo motor visível: CAIXA_MOTOR tem de bater com o HTML
  assert.match(app, /deepseek: 'Deepseek', mimo: 'Mimo', muse: 'Muse'/);
});

test('conversa de IA de chave volta com o logo certo: o main rotula pela lista do Claude Code', () => {
  const main = ler('main.js');
  assert.match(main, /handle\('sessions:claude', \(_e, incluirRobos\) => rotularProvedores\(claudeSessions\(5000, incluirRobos\)\)\)/);
  assert.match(main, /lembrarProvedorDaConversa\(m\.session_id, st0\.provedor\)/);
  const app = ler('renderer/app.js');
  assert.match(app, /const MOTORES_DA_LISTA = \[\.\.\.MOTORES_VISIVEIS\.filter\(m => !EH_PROVEDOR\(m\)\), 'acp'\];/);
  assert.match(app, /async function loadHist\(engine, force\) \{\n  engine = motorDaLista\(engine\);/);
});

test('rota grátis: o anel do Muse é o ritmo da NVIDIA (pedidos no último minuto / 40), lido do diário do OmniRoute', () => {
  const vm = require('node:vm');
  const main = ler('main.js');
  const i = main.indexOf('const RPM_NVIDIA = 40;'), f = main.indexOf('function janelasDoProvedor(s) {');
  assert.ok(i > 0 && f > i);
  const HOME = casa();
  const agora = Date.now();
  const dia = new Date(agora).toISOString().slice(0, 10);
  const dir = path.join(HOME, '.omniroute', 'call_logs', dia);
  fs.mkdirSync(dir, { recursive: true });
  const grava = (t, provider, status, tin, tout, n) => fs.writeFileSync(path.join(dir, new Date(t).toISOString().replace(/:/g, '-') + '_' + t + '-' + n + '.json'),
    JSON.stringify({ summary: { provider, status, tokens: { in: tin, out: tout } } }));
  for (let n = 0; n < 10; n++) grava(agora - 5000 - n, 'nvidia', 200, 1000, 50, 'a' + n);   // 10 no último minuto
  grava(agora - 30 * 60000, 'nvidia', 200, 2000, 100, 'velho');                              // 1 de meia hora atrás
  grava(agora - 2000, 'codex', 200, 99999, 9, 'outro');                                      // outro provedor não conta
  const ctx = { fs, path, HOME, Date, Number, Map, JSON };
  vm.runInNewContext(main.slice(i, f) + '\nthis.r = { usoDaRotaGratis, mil };', ctx);
  const u = JSON.parse(JSON.stringify(ctx.r.usoDaRotaGratis()));
  assert.deepEqual(u, { min: 10, hoje: 11, tokens: 10 * 1050 + 2100 });
  assert.equal(ctx.r.mil(12600), '13 mil'); assert.equal(ctx.r.mil(2500000), '2,5 mi'); assert.equal(ctx.r.mil(40), '40');
  // sem diário, zero (e sem erro)
  const vazio = { fs, path, HOME: casa(), Date, Number, Map, JSON };
  vm.runInNewContext(main.slice(i, f) + '\nthis.r = usoDaRotaGratis();', vazio);
  assert.equal(vazio.r.min, 0);
  assert.match(main, /s\.rota === 'gratis'\) return \{ sessao: \{ pct: Math\.min\(100, Math\.round\(s\.min \/ RPM_NVIDIA \* 100\)\), reseta: 0 \}/);
});

test('IA de chave sobe o Claude Code enxuto: sem MCP, sem skills, sem hooks pessoais e sem sugestões (84 mil → 17 mil tokens)', () => {
  const main = ler('main.js');
  const i = main.indexOf('  if (provedor) {\n    const i = args.indexOf(\'--prompt-suggestions\');');
  assert.ok(i > 0, 'bloco enxuto não encontrado');
  const bloco = main.slice(i, main.indexOf('let proc;', i));
  for (const f of ["'--strict-mcp-config'", '{"mcpServers":{}}', "'--disable-slash-commands'", "'--setting-sources', 'project,local'", "args.splice(i, 1)"]) assert.ok(bloco.includes(f), f);
  // o bloco vem DEPOIS de montar o argv e ANTES de subir o processo
  assert.ok(i > main.indexOf("if (opts.resumeId && opts.fork) args.push('--fork-session');"));
});
