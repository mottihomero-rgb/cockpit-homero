'use strict';

// Testes de guarda do lote "main" (R3), faixa consertador, rodada 3/3.
// Cobrem: R3-020 (janelaClaude virava NaN com resets_at invalido), R3-018 (troca de conta no
// meio de uma leitura de uso deixava a leitura antiga sobrescrever a nova, nos 3 motores que
// tem cache), R3-019 (limitesDoCodex sem cache/single-flight), R3-023 (voz:transcrever vazava
// o .webm quando o ffmpeg falhava) e R3-002 (atalho global travava para sempre se a janela
// nova falhasse ao abrir).
// Padrao de arquivo: tests/main-harness.cjs (main.js inteiro numa VM) para os 4 primeiros;
// R3-002 segue o padrao de extracao por regex de tests/r2-main-2.test.cjs, ja que o callback
// do atalho usa `win`/`createWindow` do escopo de fora (BrowserWindow real e proibido no
// main-harness).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { loadMain } = require('./main-harness.cjs');

function respostaFetch(status, body, headers) {
  return {
    status, ok: status >= 200 && status < 300,
    headers: { get: (n) => (headers || {})[String(n).toLowerCase()] ?? null },
    json: async () => body,
  };
}

// ===================== R3-020 =====================
// janelaClaude nao pode virar NaN quando resets_at vem malformado — igual a janelasDoGemini,
// que ja tem o '|| 0' de protecao.

test('R3-020: janelaClaude nao vira NaN com resets_at invalido (fica 0, igual ao padrao do Gemini)', () => {
  const h = loadMain();
  const invalido = h.evaluate("janelaClaude({ resets_at: 'data-invalida-xyz', utilization: 42 }, false)");
  assert.equal(Number.isNaN(invalido.reseta), false, 'reseta virou NaN com data invalida');
  assert.equal(invalido.reseta, 0);
  assert.equal(invalido.pct, 42);

  const ausente = h.evaluate("janelaClaude({ utilization: 10 }, false)");
  assert.equal(ausente.reseta, 0, 'sem resets_at tinha de continuar 0');

  const dataBoa = '2099-01-01T00:00:00Z';
  const valido = h.evaluate(`janelaClaude({ resets_at: '${dataBoa}', utilization: 5 }, false)`);
  assert.equal(valido.reseta, Date.parse(dataBoa), 'data valida tinha de continuar devolvendo o timestamp certo');
});

// ===================== R3-018 =====================
// Trocar de conta no meio de uma leitura de uso: a leitura da conta ANTERIOR, se terminar
// DEPOIS da troca, nao pode sobrescrever o cache que ja e da conta NOVA. Testado nos 3
// motores que tem esse cache (Claude, Grok, Gemini) — o risco citado no achado era consertar
// so 1 ou 2 e esquecer o 3º.

test('R3-018 Claude: leitura em voo na troca de conta nao sobrescreve o cache da conta nova', async () => {
  const h = loadMain();
  const g = h.evaluate('globalThis');
  let resolveA, resolveB, chamadas = 0;
  const esperaA = new Promise((r) => { resolveA = r; });
  const esperaB = new Promise((r) => { resolveB = r; });
  g.fetch = async () => {
    chamadas++;
    const primeira = chamadas === 1;
    await (primeira ? esperaA : esperaB);
    return respostaFetch(200, { five_hour: { utilization: primeira ? 11 : 99, resets_at: '2099-01-01T00:00:00Z' } });
  };
  h.evaluate('credGuardada = "token-conta-A"');
  const p1 = h.call('uso:ler', 'claude'); // conta A: pedido sai e fica "voando"
  for (let i = 0; i < 30 && chamadas < 1; i++) await Promise.resolve();
  assert.equal(chamadas, 1, 'a leitura da conta A nao chegou a disparar o fetch');

  h.evaluate('esquecerUso("claude")'); // Homero troca de conta com a leitura de A ainda em voo
  h.evaluate('credGuardada = "token-conta-B"');
  const p2 = h.call('uso:ler', 'claude'); // conta B: leitura nova, geracao nova
  for (let i = 0; i < 30 && chamadas < 2; i++) await Promise.resolve();
  resolveB(); // B responde primeiro (rapido)
  await p2;
  resolveA(); // A so termina DEPOIS de B — e o cenario do achado
  await p1;
  await Promise.resolve(); await Promise.resolve();

  const cache = h.evaluate('usoClaude.dados');
  assert.ok(cache, 'o cache ficou vazio depois das duas leituras');
  assert.equal(cache.five_hour.utilization, 99,
    'a leitura ANTIGA (conta A, 11%) sobrescreveu o cache depois da troca — devia ficar 99% (conta B)');
});

test('R3-018 Grok: mesma protecao contra a leitura antiga sobrescrever o cache depois da troca', async () => {
  const h = loadMain();
  h.put(h.HOME + '/.grok/auth.json', JSON.stringify({ auth_mode: 'oidc', key: 'grok-key', oidc_issuer: 'https://auth.x.ai' }));
  const g = h.evaluate('globalThis');
  let resolveA, resolveB, chamadasBilling = 0;
  const esperaA = new Promise((r) => { resolveA = r; });
  const esperaB = new Promise((r) => { resolveB = r; });
  g.fetch = async (url) => {
    if (String(url).includes('/user')) return respostaFetch(200, {});
    chamadasBilling++;
    const primeira = chamadasBilling === 1;
    await (primeira ? esperaA : esperaB);
    return respostaFetch(200, { config: { creditUsagePercent: primeira ? 11 : 99 } });
  };
  const p1 = h.call('uso:ler', 'grok');
  for (let i = 0; i < 30 && chamadasBilling < 1; i++) await Promise.resolve();
  assert.equal(chamadasBilling, 1);

  h.evaluate('esquecerUso("grok")');
  const p2 = h.call('uso:ler', 'grok');
  for (let i = 0; i < 30 && chamadasBilling < 2; i++) await Promise.resolve();
  resolveB();
  await p2;
  resolveA();
  await p1;
  await Promise.resolve(); await Promise.resolve();

  const cache = h.evaluate('usoGrok.dados');
  assert.ok(cache, 'o cache do Grok ficou vazio');
  assert.equal(cache.cfg.creditUsagePercent, 99,
    'a leitura antiga (conta anterior, 11%) sobrescreveu o cache do Grok depois da troca — devia ficar 99%');
});

test('R3-018 Gemini: mesma protecao contra a leitura antiga sobrescrever o cache depois da troca', async () => {
  const h = loadMain();
  let chamada = 0, resolveA, resolveB;
  const esperaA = new Promise((r) => { resolveA = r; });
  const esperaB = new Promise((r) => { resolveB = r; });
  h.onAgyUso(async () => {
    chamada++;
    const primeira = chamada === 1;
    await (primeira ? esperaA : esperaB);
    return JSON.stringify({ command: { name: 'usage', data: { groups: [{ name: primeira ? 'CONTA-A' : 'CONTA-B', buckets: [] }] } } });
  });
  const p1 = h.call('uso:ler', 'gemini');
  for (let i = 0; i < 30 && chamada < 1; i++) await Promise.resolve();
  assert.equal(chamada, 1);

  h.evaluate('esquecerUso("gemini")');
  const p2 = h.call('uso:ler', 'gemini');
  for (let i = 0; i < 30 && chamada < 2; i++) await Promise.resolve();
  resolveB();
  await p2;
  resolveA();
  await p1;
  await Promise.resolve(); await Promise.resolve();

  const cache = h.evaluate('usoGemini.dados');
  assert.ok(cache, 'o cache do Gemini ficou vazio');
  assert.equal(cache.groups[0].name, 'CONTA-B',
    'a leitura antiga (conta anterior) sobrescreveu o cache do Gemini depois da troca — devia ser da conta nova');
});

// ===================== R3-019 =====================
// limitesDoCodex ganha o mesmo cache de 90s + "uma leitura para todo mundo" que Claude/Grok/
// Gemini ja tinham: pedidos simultaneos viram 1 so, e dentro de 90s nao bate no app-server de novo.

test('R3-019: limitesDoCodex junta pedidos simultaneos e reaproveita leitura recente (90s)', async () => {
  const h = loadMain();
  let chamadas = 0;
  const RESPOSTA = { rateLimits: { primary: { usedPercent: 42, windowDurationMins: 10080, resetsAt: 4102444800 }, secondary: null } };
  h.attachCodex('local', async (m) => {
    if (m === 'account/rateLimits/read') { chamadas++; return RESPOSTA; }
    return {};
  });
  // duas leituras disparadas ao mesmo tempo (sem await entre elas): tem que virar 1 pedido so
  const [a, b] = await Promise.all([h.call('uso:ler', 'codex'), h.call('uso:ler', 'codex')]);
  assert.equal(chamadas, 1, 'duas leituras simultaneas de uso do Codex nao viraram 1 pedido so ao app-server');
  assert.equal(a.semana.pct, 42); assert.equal(b.semana.pct, 42);

  // dentro dos 90s, uma nova leitura tem que vir do cache, sem bater no app-server de novo
  const c = await h.call('uso:ler', 'codex');
  assert.equal(chamadas, 1, 'leitura dentro dos 90s nao aproveitou o cache (bateu no app-server de novo)');
  assert.equal(c.semana.pct, 42);

  // esquecerUso('codex') zera o cache — a proxima leitura tem que ir buscar de novo
  h.evaluate('esquecerUso("codex")');
  await h.call('uso:ler', 'codex');
  assert.equal(chamadas, 2, 'esquecerUso("codex") nao limpou o cache/voando: a leitura depois da troca nao foi buscar de novo');
});

// ===================== R3-023 =====================
// voz:transcrever escrevia o .webm e so apagava os 3 arquivos temporarios DEPOIS de confirmar
// que o ffmpeg gerou o .wav — se a conversao falhasse, o retorno antecipado pulava a limpeza
// e o .webm ficava orfao em os.tmpdir() pra sempre.

test('R3-023: quando o ffmpeg nao converte o audio, o .webm temporario e apagado mesmo assim', async () => {
  const h = loadMain();
  h.put(h.HOME + '/.cockpit/modelos/ggml-small.bin', 'modelo-fake');
  // o os fake do harness nao tem tmpdir(): o voz:transcrever usa os.tmpdir() pra montar o base
  h.evaluate(`os.tmpdir = () => ${JSON.stringify(h.HOME + '/tmp')}`);
  const audio = Buffer.from('audio-fake-de-teste').toString('base64');

  const p = h.call('voz:transcrever', { audio });
  const chamadaFfmpeg = h.spawned.find((s) => String(s.bin) === 'ffmpeg');
  assert.ok(chamadaFfmpeg, 'o handler nao chamou o ffmpeg');
  const caminhoWebm = chamadaFfmpeg.args[2]; // ['-y', '-i', <webm>, ...]
  assert.ok(caminhoWebm && caminhoWebm.endsWith('.webm'));
  assert.ok(h.files.has(caminhoWebm), 'o .webm nao foi escrito antes de tentar converter');

  // ffmpeg "roda" mas nao gera o .wav (audio truncado/corrompido) — fecha com codigo 0 mesmo
  // assim, so' pra simular a checagem `!fs.existsSync(base + '.wav')` que falha depois
  chamadaFfmpeg.proc.emit('close', 0);
  const r = await p;

  assert.ok(r && r.error, 'devia devolver erro quando o ffmpeg nao gerou o .wav');
  assert.equal(h.files.has(caminhoWebm), false,
    'o .webm ficou orfao em os.tmpdir() depois do erro de conversao (vazamento)');
});

// ===================== R3-002 =====================
// R2-026: atalho global de ditar trava para sempre (criandoJanelaPeloAtalho preso em true) se
// a janela nova falhar ao abrir — sem timeout, sem try/catch, sem tratar did-fail-load.

function extrairCallbackAtalho() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const m = src.match(/globalShortcut\.register\(TECLA_DITAR,\s*\(\)\s*=>\s*\{([\s\S]*?)\n {4}\}\);\n {4}if \(!ok\)/);
  assert.ok(m, 'nao achei o callback do atalho global em main.js (mudou de formato?)');
  return m[1];
}

function novoContextoAtalho() {
  const ctx = vm.createContext({});
  vm.runInContext(`
    var win = null;
    var criandoJanelaPeloAtalho = false;
    var createWindowCalls = 0;
    var throwOnCreate = false;
    var eventos = [];
    var timers = [];
    function setTimeout(fn) { const id = timers.length; timers.push({ fn, cancelado: false }); return id; }
    function clearTimeout(id) { if (timers[id]) timers[id].cancelado = true; }
    function createWindow() {
      createWindowCalls++;
      if (throwOnCreate) throw new Error('falha simulada ao criar a janela');
      win = {
        destroyed: false,
        isDestroyed() { return this.destroyed; },
        isMinimized() { return false; },
        restore() { eventos.push('restore'); },
        show() { eventos.push('show'); },
        focus() { eventos.push('focus'); },
        webContents: {
          _once: {},
          once(ev, fn) { this._once[ev] = fn; },
          send(canal, valor) { eventos.push(['send', canal, valor]); },
        },
      };
    }
    function callback() { ${extrairCallbackAtalho()} }
  `, ctx, { filename: 'callback-atalho.js' });
  return ctx;
}

test('R3-002: se createWindow() lanca excecao, a trava e liberada na hora (nao fica presa em true)', () => {
  const ctx = novoContextoAtalho();
  ctx.throwOnCreate = true;
  ctx.callback(); // antes do conserto isto jogava a excecao pra fora sem resetar a flag
  assert.equal(ctx.criandoJanelaPeloAtalho, false,
    'createWindow() falhou e a flag ficou travada em true — o atalho nunca mais funcionaria');
});

test('R3-002: se a janela nunca termina de carregar (did-fail-load), a trava e liberada', () => {
  const ctx = novoContextoAtalho();
  ctx.callback(); // janela fechada: recria
  assert.equal(ctx.criandoJanelaPeloAtalho, true, 'a trava tem de ficar ligada enquanto espera o carregamento');
  ctx.win.webContents._once['did-fail-load']();
  assert.equal(ctx.criandoJanelaPeloAtalho, false, 'did-fail-load nao liberou a trava');
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.eventos)), [], 'nao podia mandar "ditar" numa janela que falhou ao carregar');
});

test('R3-002: rede extra por timeout libera a trava mesmo se nenhum dos dois eventos disparar', () => {
  const ctx = novoContextoAtalho();
  ctx.callback();
  assert.equal(ctx.criandoJanelaPeloAtalho, true);
  const timer = ctx.timers[ctx.timers.length - 1];
  assert.ok(timer && !timer.cancelado, 'nao armou um timeout de rede extra');
  timer.fn(); // simula o timeout disparando (nem did-finish-load nem did-fail-load vieram)
  assert.equal(ctx.criandoJanelaPeloAtalho, false, 'o timeout de rede extra nao liberou a trava');
});

test('R3-002: caminho feliz continua igual — did-finish-load libera a trava e manda ditar', () => {
  const ctx = novoContextoAtalho();
  ctx.callback();
  ctx.win.webContents._once['did-finish-load']();
  assert.equal(ctx.criandoJanelaPeloAtalho, false);
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.eventos)), ['show', 'focus', ['send', 'menu', 'ditar']]);
});
