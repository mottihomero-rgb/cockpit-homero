'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { criarContasCli, ambienteSemChaves } = require('../contas-cli');
const { loadMain } = require('./main-harness.cjs');

function montar(t, agy = false) {
  const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-contas-'));
  t.after(() => fs.rmSync(HOME, { recursive: true, force: true }));
  const dados = path.join(HOME, 'dados');
  const contas = criarContasCli({ ehWindows: false, HOME, pastaDados: () => dados,
    acharBin: engine => '/Programa do usuário/' + engine, temBin: bin => bin !== 'agy' || agy,
    buildEnv: () => ({ PATH: '/bin', GEMINI_API_KEY: 'segredo-google', XAI_API_KEY: 'segredo-xai' }),
  });
  const salvar = (file, content) => { const destino = path.join(HOME, file); fs.mkdirSync(path.dirname(destino), { recursive: true }); fs.writeFileSync(destino, JSON.stringify(content)); return destino; };
  return { HOME, dados, contas, salvar };
}

test('Gemini reconhece a identidade salva sem exigir o antigo arquivo de tokens', t => {
  const m = montar(t);
  assert.equal(m.contas.ler('gemini').entrou, false);
  m.salvar('.gemini/google_accounts.json', { active: 'homero@example.com', old: [] });
  const c = m.contas.ler('gemini');
  assert.equal(c.entrou, true); assert.equal(c.email, 'homero@example.com');
  assert.equal(c.salvaLocalmente, true); assert.equal(c.plano, '');
  assert.match(c.motivo, /confere o acesso/);
});

test('Grok não apresenta chave paga como login; nunca devolve tokens', t => {
  const m = montar(t);
  m.salvar('.grok/auth.json', { 'xai::api_key': { auth_mode: 'api_key', key: 'segredo-api', email: 'pago@example.com' } });
  assert.equal(m.contas.ler('grok').entrou, false);
  assert.equal(m.contas.tokenGrok(), '');
  m.salvar('.grok/auth.json', { 'https://auth.x.ai': { auth_mode: 'oidc', key: 'segredo-oauth', refresh_token: 'segredo-refresh', email: 'homero@example.com', oidc_issuer: 'https://auth.x.ai' } });
  const c = m.contas.ler('grok');
  assert.equal(c.entrou, true); assert.equal(c.email, 'homero@example.com');
  assert.doesNotMatch(JSON.stringify(c), /segredo/);
  assert.equal(m.contas.tokenGrok(), 'segredo-oauth');
});

test('Gemini força OAuth só neste processo e preserva as políticas existentes', t => {
  const m = montar(t);
  const sistema = m.salvar('politica.json', { tools: { sandbox: true }, security: { auth: { selectedType: 'gemini-api-key' } } });
  const env = m.contas.ambiente('gemini', { GEMINI_API_KEY: 'segredo', GOOGLE_API_KEY: 'segredo', GOOGLE_GENAI_USE_VERTEXAI: 'true', GEMINI_CLI_SYSTEM_SETTINGS_PATH: sistema });
  for (const key of ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENAI_USE_VERTEXAI']) assert.equal(env[key], undefined);
  const ajuste = JSON.parse(fs.readFileSync(env.GEMINI_CLI_SYSTEM_SETTINGS_PATH, 'utf8'));
  assert.equal(ajuste.security.auth.selectedType, 'oauth-personal');
  assert.equal(ajuste.security.auth.enforcedType, 'oauth-personal');
  assert.equal(ajuste.tools.sandbox, true);
  assert.equal(JSON.parse(fs.readFileSync(sistema, 'utf8')).security.auth.selectedType, 'gemini-api-key');
});

test('Comandos de entrada são preparados sem executar login, com conta gratuita e pasta neutra', t => {
  const m = montar(t);
  const g = m.contas.acao({ engine: 'gemini', acao: 'codigo' });
  assert.match(g.terminal, /NO_BROWSER='true'/); assert.match(g.terminal, /oauth-personal/);
  assert.match(g.terminal, /contas-cli\/login/); assert.doesNotMatch(g.terminal, /segredo/);
  assert.equal(g.confereDepois, true);
  const x = m.contas.acao({ engine: 'grok', acao: 'codigo' });
  assert.match(x.terminal, /'login' '--oauth' '--device-auth'/);
  assert.match(x.terminal, /-u XAI_API_KEY/); assert.doesNotMatch(x.terminal, /segredo/);
  assert.ok(m.contas.acao({ engine: 'grok', acao: 'login', cwd: 'vps:host/pasta' }).error);
});

test('Estado via IPC não chama modelo nem trata falta de login como conta conectada', async () => {
  const h = loadMain();
  for (const engine of ['gemini', 'grok']) {
    const c = await h.call('conta:ler', engine);
    assert.equal(c.instalado, true); assert.equal(c.entrou, engine === 'gemini' ? null : false);
    const status = await h.call('auth:acao', { engine, acao: 'status' });
    assert.equal(JSON.parse(status.texto).loggedIn, engine === 'gemini' ? null : false);
  }
  assert.ok(h.spawned.every(s => s.args[0] === '--version' || s.args.includes('/usage')));
  assert.equal(h.violations.length, 0);
});

test('Antigravity ignora conta Gemini legada, confirma por resposta real e invalida no logout', t => {
  const m = montar(t, true);
  m.salvar('.gemini/google_accounts.json', { active: 'conta-legada@example.com' });
  assert.equal(m.contas.ler('gemini').entrou, null);
  assert.equal(m.contas.ler('gemini').email, '');
  const env = m.contas.ambiente('gemini', { GEMINI_API_KEY: 'segredo', GEMINI_DEFAULT_AUTH_TYPE: 'oauth-personal' });
  assert.equal(env.GEMINI_API_KEY, undefined); assert.equal(env.GEMINI_DEFAULT_AUTH_TYPE, undefined);
  assert.match(m.contas.acao({ engine: 'gemini', acao: 'login' }).terminal, /agy'/);
  m.contas.confirmar('gemini'); assert.equal(m.contas.ler('gemini').entrou, true);
  const logout = m.contas.acao({ engine: 'gemini', acao: 'logout' });
  assert.match(logout.terminal, /'\/logout'/);
  assert.equal(m.contas.ler('gemini').entrou, null);
});

test('Ambiente Grok remove caminhos de chave cobrados e não altera o ambiente original', () => {
  const original = { XAI_API_KEY: 'segredo', GROK_CODE_XAI_API_KEY: 'segredo', PATH: '/bin' };
  const env = ambienteSemChaves('grok', original);
  assert.deepEqual(env, { PATH: '/bin' }); assert.equal(original.XAI_API_KEY, 'segredo');
});
