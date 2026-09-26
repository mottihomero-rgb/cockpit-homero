'use strict';

// Testes de guarda do lote "main" (R2), faixa consertador, rodada 2/3.
// Cobrem: R2-013 (foto do iPhone num chat remoto (VPS) virava caminho cru do Mac, nunca
// chegava ao Claude), R2-034 (SIGKILL de garantia do R1-048 podia nunca rodar no fechamento
// TOTAL do app), R2-038 (web:ligar gravava config velho por cima de painel aberto durante a
// espera do Tailscale) e R2-040 (cfg.porPasta nunca era podado, uma chave nova por demanda
// pra sempre). Padrao de arquivo: tests/main-harness.cjs (main.js inteiro numa VM).

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadMain } = require('./main-harness.cjs');

// ===================== R2-013 =====================
// claudeAttachmentContent() direto: prova o formato do bloco sem depender de spawn nenhum.

test('R2-013: painel local (Mac) continua escrevendo so o caminho no texto — regressão', () => {
  const h = loadMain();
  const blocos = h.evaluate("claudeAttachmentContent('olha isso', [{ path: '/Users/homero/foto.jpg' }], false)");
  assert.equal(blocos.length, 1);
  assert.equal(blocos[0].type, 'text');
  assert.match(blocos[0].text, /- \/Users\/homero\/foto\.jpg/);
});

test('R2-013: painel remoto (VPS) embute a foto em base64, nao manda o caminho do Mac', () => {
  const h = loadMain();
  const imgPath = '/Users/homero/colados/celular-1.jpg';
  h.put(imgPath, 'bytes-fake-da-foto');
  const blocos = h.evaluate(`claudeAttachmentContent('olha essa foto', [{ path: ${JSON.stringify(imgPath)} }], true)`);
  const imagem = blocos.find((b) => b.type === 'image');
  assert.ok(imagem, 'sem o conserto, o anexo remoto vira so texto com o caminho do Mac — o Claude na VPS nunca ve a imagem');
  assert.equal(imagem.source.type, 'base64');
  assert.equal(imagem.source.media_type, 'image/jpeg');
  assert.equal(imagem.source.data, Buffer.from('bytes-fake-da-foto').toString('base64'));
  const texto = blocos.filter((b) => b.type === 'text').map((b) => b.text).join(' ');
  assert.ok(!texto.includes(imgPath), 'o caminho LOCAL do Mac nao pode sobrar no texto mandado a VPS');
});

test('R2-013: anexo remoto que a API do Claude nao aceita (heic da câmera do iPhone) vira erro claro, nao o caminho cru', () => {
  const h = loadMain();
  const blocos = h.evaluate("claudeAttachmentContent('', [{ path: '/Users/homero/colados/celular-2.heic' }], true)");
  assert.equal(blocos.some((b) => b.type === 'image'), false, 'heic nao vira imagem embutida (o servidor-web grava sem converter)');
  const texto = blocos.map((b) => b.text).join(' ');
  assert.ok(!texto.includes('/Users/homero/colados/celular-2.heic'), 'nao pode sobrar o caminho cru do Mac');
  assert.match(texto, /não p(o|ô)de ser enviad/i, 'tem de avisar com clareza que o anexo nao foi');
});

test('R2-013: pane:send embute a foto em base64 quando o painel é da VPS', async () => {
  const h = loadMain();
  const imgPath = '/Users/homero/colados/celular-3.jpg';
  h.put(imgPath, 'outra-foto-fake');
  h.evaluate(`
    claudeCwd.set('p1', 'vps:/home/homero/projeto');
    globalThis.__capturado = null;
    escreverClaude = (paneId, obj) => { globalThis.__capturado = obj; return true; };
  `);
  await h.call('pane:send', { paneId: 'p1', engine: 'claude', text: 'olha essa foto', attachments: [{ path: imgPath }] });
  const obj = h.evaluate('globalThis.__capturado');
  assert.ok(obj, 'pane:send tem de escrever no Claude mesmo no painel remoto');
  assert.ok(obj.message.content.some((b) => b.type === 'image'),
    'painel da VPS: o anexo tem de virar bloco de imagem, nao texto com o caminho do Mac');
});

test('R2-013: pane:send no Mac continua mandando texto com o caminho (regressão)', async () => {
  const h = loadMain();
  h.evaluate(`
    claudeCwd.set('p1', ${JSON.stringify(path.join('/Users', 'homero', 'projeto'))});
    globalThis.__capturado = null;
    escreverClaude = (paneId, obj) => { globalThis.__capturado = obj; return true; };
  `);
  await h.call('pane:send', { paneId: 'p1', engine: 'claude', text: 'oi', attachments: [{ path: '/Users/homero/foto.png' }] });
  const obj = h.evaluate('globalThis.__capturado');
  assert.equal(obj.message.content.length, 1);
  assert.equal(obj.message.content[0].type, 'text');
  assert.match(obj.message.content[0].text, /\/Users\/homero\/foto\.png/);
});

test('R2-013: pane:steer (falar no meio do trabalho) tem o mesmo tratamento remoto', async () => {
  const h = loadMain();
  const imgPath = '/Users/homero/colados/celular-4.jpg';
  h.put(imgPath, 'foto-do-steer');
  h.evaluate(`
    claudeCwd.set('p1', 'vps:/home/homero/projeto');
    globalThis.__capturado = null;
    escreverClaude = (paneId, obj) => { globalThis.__capturado = obj; return true; };
  `);
  const r = await h.call('pane:steer', { paneId: 'p1', engine: 'claude', text: '', attachments: [{ path: imgPath }] });
  assert.equal(r.ok, true);
  const obj = h.evaluate('globalThis.__capturado');
  assert.ok(obj.message.content.some((b) => b.type === 'image'),
    'pane:steer usa a mesma claudeAttachmentContent — mesmo bug do R2-013, mesmo conserto');
});

// ===================== R2-034 =====================
// O timer de garantia (matarGrupoExtra) tem de virar Promise, e shutdown() tem de esperar.

test('R2-034: processo que morre logo com SIGTERM — shutdown() não espera os 1500ms fixos (regressão)', async () => {
  const h = loadMain();
  await h.call('pane:start', { paneId: 'p1', engine: 'claude', cwd: h.HOME });
  const proc = h.spawned.at(-1).proc;
  proc.pid = 4321;   // fakeSpawn nao da' pid nenhum; sem isso o codigo nem entra no ramo do timer
  h.evaluate(`
    globalThis.__kills = [];
    process.kill = (pid, sinal) => { if (sinal === 0) throw Object.assign(new Error('grupo encerrado'), { code: 'ESRCH' }); globalThis.__kills.push(sinal); };
  `);
  const p = h.evaluate('shutdown()');
  assert.equal(typeof p.then, 'function', 'shutdown() tem de virar async (devolver Promise) para o R2-034 funcionar');
  proc.emit('exit', 0, null);   // o processo respondeu ao SIGTERM na hora
  await p;
  assert.deepEqual(Array.from(h.evaluate('globalThis.__kills')), ['SIGTERM'],
    'processo que morreu com SIGTERM nao pode levar SIGKILL nenhum, e o caminho feliz nao pode esperar o teto de 1500ms');
});

test('R2-034: processo que ignora o SIGTERM — o SIGKILL de garantia dispara e shutdown() espera por ele', async () => {
  const h = loadMain();
  await h.call('pane:start', { paneId: 'p1', engine: 'claude', cwd: h.HOME });
  const proc = h.spawned.at(-1).proc;
  proc.pid = 4321;
  h.evaluate(`
    globalThis.__kills = [];
    process.kill = (pid, sinal) => { globalThis.__kills.push(sinal); };
  `);
  const antes = new Set(h.timers.keys());
  const p = h.evaluate('shutdown()');
  let resolveu = false;
  p.then(() => { resolveu = true; });
  await new Promise((r) => setImmediate(r));
  assert.equal(resolveu, false, 'com o processo travado, shutdown() nao pode terminar antes do teto de garantia');
  const novos = [...h.timers.keys()].filter((id) => !antes.has(id));
  assert.equal(novos.length, 1, 'matarGrupoExtra tem de armar exatamente 1 timer de garantia para o painel');
  h.timers.get(novos[0])();   // simula os 1500ms passando: o processo nunca respondeu
  await p;
  assert.deepEqual(Array.from(h.evaluate('globalThis.__kills')), ['SIGTERM', 'SIGKILL'],
    'sem o conserto, este e o proprio SIGKILL de garantia do R2-034: o timer nasce unref e o app podia sumir antes dele disparar');
});

test('R2-034: before-quit segura o quit ate o SIGKILL de garantia, e so entao chama app.exit() (nunca antes, nunca em loop)', async () => {
  const h = loadMain();
  await h.call('pane:start', { paneId: 'p1', engine: 'claude', cwd: h.HOME });
  const proc = h.spawned.at(-1).proc;
  proc.pid = 4321;
  h.evaluate(`
    globalThis.__ordem = [];
    process.kill = (pid, sinal) => { globalThis.__ordem.push('kill:' + sinal); };
    app.exit = () => { globalThis.__ordem.push('exit'); };
  `);
  const handler = h.appEvents.get('before-quit');
  assert.ok(handler, 'handler de before-quit sumiu do app.on');
  const antes = new Set(h.timers.keys());
  const evento1 = { prevented: false, preventDefault() { this.prevented = true; } };
  handler(evento1);
  assert.equal(evento1.prevented, true, 'o quit tem de ficar preso ate o shutdown terminar, senao o Electron sai antes do SIGKILL');
  assert.deepEqual(Array.from(h.evaluate('globalThis.__ordem')), ['kill:SIGTERM'], 'so o SIGTERM sai na hora; o processo ainda nao respondeu');
  // um segundo before-quit no meio do caminho (ex.: app.exit() reemitindo) nao pode reentrar
  const evento2 = { prevented: false, preventDefault() { this.prevented = true; } };
  handler(evento2);
  assert.equal(evento2.prevented, false, 'a guarda saindoDoApp tem de barrar reentrada, senao vira loop');
  const novos = [...h.timers.keys()].filter((id) => !antes.has(id));
  assert.equal(novos.length, 1);
  h.timers.get(novos[0])();   // simula os 1500ms: o processo nunca respondeu ao SIGTERM
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(Array.from(h.evaluate('globalThis.__ordem')), ['kill:SIGTERM', 'kill:SIGKILL', 'exit'],
    'app.exit() so pode rodar DEPOIS do SIGKILL de garantia, nunca antes (a ordem prova a espera, nao so a corrida)');
});

// ===================== R2-038 =====================
// web:ligar nao pode gravar por cima de um config que mudou DURANTE os awaits do handler.

test('R2-038: web:ligar não apaga config gravado durante a espera do Tailscale/servidor', async () => {
  const h = loadMain();
  const cfgPath = path.join(h.HOME, 'app-data', 'config.json');
  const abasIniciais = [
    { cwd: '/a', chats: [{ sessao: 's1' }] },
    { cwd: '/b', chats: [] },
    { cwd: '/c', chats: [] },
  ];
  h.put(cfgPath, JSON.stringify({ abas: abasIniciais, webLigado: false }));

  // controla os dois pontos assincronos do handler (endereco do Tailscale e a subida do
  // servidor) e substitui o require do servidor-web.js, que o harness bloqueia de proposito
  // por nao simular o modulo de verdade.
  h.evaluate(`
    enderecoTailscale = () => new Promise((resolve) => { globalThis.__resolverEndereco = resolve; });
    const __requireOriginal = require;
    require = function (nome) {
      if (nome === './servidor-web.js') {
        return { criar: () => ({ pronto: Promise.resolve(true), endereco: 'http://mock:7788', fechar() {} }) };
      }
      return __requireOriginal(nome);
    };
  `);

  const chamada = h.call('web:ligar', true);
  await new Promise((r) => setImmediate(r));   // deixa o handler rodar ate travar no await do endereco

  // ENQUANTO o handler espera: o renderer abre um painel novo na aba 'a' e grava o config.
  // O NUMERO de abas nao muda (continua 3) — a rede de seguranca do saveConfig so olha aba,
  // nao painel dentro dela, entao ela nao pega esta gravacao.
  const abasComPainelNovo = [
    { cwd: '/a', chats: [{ sessao: 's1' }, { sessao: 's2-painel-novo' }] },
    { cwd: '/b', chats: [] },
    { cwd: '/c', chats: [] },
  ];
  h.call('config:set', { abas: abasComPainelNovo });

  h.evaluate('globalThis.__resolverEndereco();');   // Tailscale "responde"
  await chamada;

  const final = JSON.parse(h.files.get(cfgPath).toString());
  assert.equal(final.abas[0].chats.length, 2,
    'sem o conserto, web:ligar grava por cima o "cfg" lido ANTES da espera e apaga o painel aberto durante ela');
  assert.equal(final.webLigado, true, 'web:ligar tem de marcar webLigado mesmo lendo o disco de novo antes de gravar');
});

// ===================== R2-040 =====================
// cfg.porPasta so' pode ser podado quando a pasta ja sumiu do disco HA' DIAS — nunca no
// primeiro boot sem ela (HD externo desligado, pasta do Drive ainda nao montada).
// R3-003 (25/09): saveConfig passou a so' chamar podarPorPasta a cada PODA_A_CADA gravacoes
// (senao vira fs.existsSync sincrono a cada clique). Estes 3 testes chamavam saveConfig UMA
// vez so' e esperavam a poda na hora — errado agora por desenho: ajustado para repetir a
// gravacao PODA_A_CADA vezes (como aconteceria de verdade, ao longo do uso), sem mudar o que
// cada teste prova.

test('R2-040: pasta sumida do disco HÁ DIAS é podada de cfg.porPasta; pasta que existe fica', () => {
  const h = loadMain();
  const cfgPath = path.join(h.HOME, 'app-data', 'config.json');
  const pastaViva = path.join(h.HOME, 'projeto-vivo');
  const pastaSumida = path.join(h.HOME, 'projeto-sumido');
  const quatroDiasAtras = Date.now() - 4 * 24 * 60 * 60 * 1000;
  h.put(pastaViva, 'marca de pasta existente');   // fs.existsSync(pastaViva) -> true no harness
  const cfgInicial = {
    abas: [],
    porPasta: {
      [pastaViva + '|claude']: { model: 'opus', effort: 'alto' },
      [pastaSumida + '|claude']: { model: 'sonnet', effort: 'alto' },
    },
    porPastaAusenteDesde: { [pastaSumida + '|claude']: quatroDiasAtras },
  };
  h.put(cfgPath, JSON.stringify(cfgInicial));
  const N = h.evaluate('PODA_A_CADA');
  for (let i = 0; i < N; i++) h.evaluate(`saveConfig(${JSON.stringify(cfgInicial)})`);

  const final = JSON.parse(h.files.get(cfgPath).toString());
  assert.ok(final.porPasta[pastaViva + '|claude'], 'pasta que ainda existe no disco nao pode perder a preferencia de modelo');
  assert.ok(!final.porPasta[pastaSumida + '|claude'], 'pasta sumida ha 4 dias seguidos tem de ser podada');
});

test('R2-040: pasta sumida pela PRIMEIRA vez não é podada na hora (HD externo, Drive ainda não montado)', () => {
  const h = loadMain();
  const cfgPath = path.join(h.HOME, 'app-data', 'config.json');
  const pastaSumida = path.join(h.HOME, 'projeto-novo-sumido');
  const cfgInicial = { abas: [], porPasta: { [pastaSumida + '|claude']: { model: 'opus', effort: 'alto' } } };
  h.put(cfgPath, JSON.stringify(cfgInicial));
  const N = h.evaluate('PODA_A_CADA');
  for (let i = 0; i < N; i++) h.evaluate(`saveConfig(${JSON.stringify(cfgInicial)})`);

  const final = JSON.parse(h.files.get(cfgPath).toString());
  assert.ok(final.porPasta[pastaSumida + '|claude'],
    'sem o conserto (poda logo na primeira ausencia) isto apagaria a preferencia so por causa de um HD desligado');
  assert.ok(final.porPastaAusenteDesde && final.porPastaAusenteDesde[pastaSumida + '|claude'],
    'a ausencia tem de ficar anotada para contar os dias na proxima gravacao');
});

test('R2-040: pasta remota (vps:/...) nunca conta como "sumida" — fs.existsSync não enxerga a VPS', () => {
  const h = loadMain();
  const cfgPath = path.join(h.HOME, 'app-data', 'config.json');
  const cfgInicial = { abas: [], porPasta: { 'vps:/home/homero/projeto|codex': { model: 'gpt-6', effort: 'alto' } } };
  h.put(cfgPath, JSON.stringify(cfgInicial));
  const N = h.evaluate('PODA_A_CADA');
  for (let i = 0; i < N; i++) h.evaluate(`saveConfig(${JSON.stringify(cfgInicial)})`);

  const final = JSON.parse(h.files.get(cfgPath).toString());
  assert.ok(final.porPasta['vps:/home/homero/projeto|codex'],
    'pasta da VPS nao pode ser podada so porque o disco do Mac nao a enxerga');
});
