'use strict';

// Testes de guarda do lote "main" (R1) — faixa consertador, rodada 1, lote 2.
// Cobrem: R1-008 (SSH esperava o dobro do timeout com a VPS fora do ar), R1-006 (nome fixo
// do arquivo temporario do indice de texto colidia entre duas copias do processo, e faltava
// a trava de instancia unica), R1-010 (skillCache sem prazo, skill nova so aparecia
// reabrindo o app), R1-045 (mcp:acao liberava adicionar conector LOCAL pelo celular, RCE) e
// R1-049 (credClaude nao guardava em cache o "Chaveiro falhou", repetindo trava de ate 8s).
// Padrao de arquivo: tests/main-harness.cjs + tests/auditoria-main-20260921.test.cjs.
// "Date" no harness e' o MESMO objeto do processo Node de verdade (vm.createContext recebe a
// referencia direta, nao uma copia) — por isso todo teste que mexe em Date.now guarda o
// original e restaura em finally, igual ja faz tests/auditoria-main-20260921.test.cjs.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { loadMain } = require('./main-harness.cjs');

// ---------- R1-008: 2a tentativa de SSH nao pode dobrar o timeout inteiro ----------

test('R1-008: se a 1a tentativa (com socket) ESTOUROU o tempo, nao tenta de novo — so dobraria a espera', async () => {
  const h = loadMain();
  h.evaluate(`
    muxProvado = false; muxLigado = true;
    globalThis.__chamadas = [];
    sshUmaVez = async (r, comando, ms, sock) => {
      globalThis.__chamadas.push({ ms, comSocket: !!sock });
      return { code: -1, out: '', errout: '', estourou: true };
    };
  `);
  const resultado = await h.evaluate("noServidorSsh(partesRemoto('vps:/opt/x'), 'echo hi', 20000)");
  const chamadas = h.evaluate('globalThis.__chamadas');
  // Antes do conserto: a 2a tentativa (sem socket) rodava do mesmo jeito, com o MESMO ms de
  // 20000 — ate 40s de espera antes da tela mostrar o erro, em vez dos 20s que o proprio
  // codigo ja considera o teto razoavel pra uma chamada.
  assert.equal(chamadas.length, 1, 'com a 1a tentativa ja estourada, a VPS esta inacessivel: repetir do zero nao muda o resultado');
  assert.equal(resultado.code, -1);
  assert.match(resultado.error, /demorou demais/i);
});

test('R1-008: nas outras falhas (sai 255, sem estourar) a 2a tentativa ganha um teto BEM menor que o "ms" cheio', async () => {
  const h = loadMain();
  h.evaluate(`
    muxProvado = false; muxLigado = true;
    globalThis.__chamadas = [];
    sshUmaVez = async (r, comando, ms, sock) => {
      globalThis.__chamadas.push({ ms, comSocket: !!sock });
      return sock ? { code: 255, out: '', errout: 'Permission denied' } : { code: 0, out: 'ok', errout: '' };
    };
  `);
  const resultado = await h.evaluate("noServidorSsh(partesRemoto('vps:/opt/x'), 'echo hi', 20000)");
  const chamadas = h.evaluate('globalThis.__chamadas');
  assert.equal(chamadas.length, 2, 'ainda tenta de novo sem socket quando NAO foi timeout');
  // Antes do conserto a 2a chamada recebia os mesmos 20000ms da 1a; agora tem de ser bem menor
  // (o conserto usa um teto de 8s), nunca o ms cheio.
  assert.ok(chamadas[1].ms < 20000, 'a 2a tentativa nao pode usar o "ms" inteiro de novo: ' + chamadas[1].ms);
  assert.ok(chamadas[1].ms >= 5000, 'mas precisa de um piso decente pra nao cortar uma recuperacao real: ' + chamadas[1].ms);
  assert.equal(resultado.code, 0, 'a 2a tentativa (sem socket) deu certo: o resultado tem de ser o dela');
});

// ---------- R1-006: arquivo temporario da faxina nao pode ter nome fixo ----------

// mesmos caminhos e mesmo remendo de fs que tests/f3-main-js.test.cjs usa: o harness nao sabe
// ler arquivo de pedaco em pedaco (openSync/fstatSync/readSync/closeSync), que e o que
// varrerTexto (chamada por compactarTexto) precisa pra funcionar de verdade.
const TEXTO_INDICE = '/cockpit-test/home/.cockpit/indice-texto.ndjson';
const CARIMBOS_INDICE = '/cockpit-test/home/.cockpit/indice-carimbos.json';
function prepararLeituraDeArquivoReal(h) {
  h.evaluate(`
    globalThis.setImmediate = (fn) => Promise.resolve().then(fn);
    const __abertos = new Map();
    let __fd = 10;
    const __leitura = fs.readFileSync;
    fs.openSync = (nome) => { const fd = __fd++; __abertos.set(fd, Buffer.from(__leitura(nome))); return fd; };
    fs.fstatSync = (fd) => ({ size: __abertos.get(fd).length });
    fs.readSync = (fd, buf, off, len, pos) => {
      const b = __abertos.get(fd);
      const n = Math.max(0, Math.min(len, b.length - pos));
      b.copy(buf, off, pos, pos + n);
      return n;
    };
    fs.closeSync = (fd) => { __abertos.delete(fd); };
  `);
  return h;
}

test('R1-006: a faxina do indice de texto nao usa mais o nome fixo ".faxina" (colidia entre 2 copias do processo)', async () => {
  const h = prepararLeituraDeArquivoReal(loadMain());
  const encher = 'x'.repeat(12000);
  const linhas = [];
  // 400 linhas orfas (ninguem tem carimbo delas) = uns 4,8 MB de lixo — mesmo padrao de
  // tests/f3-main-js.test.cjs, o suficiente pra faxina decidir rodar
  for (let i = 0; i < 400; i++) linhas.push(JSON.stringify({ f: '/foi/embora-' + i, m: 1, t: 2, x: encher }));
  h.put(TEXTO_INDICE, linhas.join('\n') + '\n');
  h.put(CARIMBOS_INDICE, '{}');

  // simula OUTRA copia do processo escrevendo no nome antigo, fixo, no exato momento em que
  // esta rodaria a faxina — se o codigo ainda usasse esse nome, o renameSync final pegaria
  // este lixo em vez do indice compactado de verdade.
  const tmpNomeAntigo = TEXTO_INDICE + '.faxina';
  h.files.set(tmpNomeAntigo, Buffer.from('LIXO-DE-OUTRA-INSTANCIA'));

  const faxinou = await h.evaluate('compactarTexto()');
  assert.equal(faxinou, true, 'com 4,8 MB de lixo a faxina tem de rodar');

  const finalTexto = String(h.files.get(TEXTO_INDICE) || '');
  assert.ok(!finalTexto.includes('LIXO-DE-OUTRA-INSTANCIA'),
    'o indice final nao pode ter vindo do nome fixo ".faxina" — a faxina tem de usar um tmp proprio (com PID)');
  // o lixo da "outra instancia" continua intocado: prova de que ninguem leu nem sobrescreveu
  // aquele caminho durante esta faxina
  assert.equal(String(h.files.get(tmpNomeAntigo)), 'LIXO-DE-OUTRA-INSTANCIA');
});

test('R1-006: main.js pede a trava de instancia unica (requestSingleInstanceLock) antes do app.whenReady', () => {
  // O harness (main-harness.cjs) nao simula app.requestSingleInstanceLock — de proposito,
  // pra provar que o conserto sobrevive a ausencia dela (guardado por "typeof"). Se o
  // conserto chamasse app.requestSingleInstanceLock() sem essa guarda, loadMain() já teria
  // lançado TypeError e quebrado ESTE arquivo (e todo outro teste que usa o harness).
  const h = loadMain();
  assert.equal(h.evaluate('typeof app.requestSingleInstanceLock'), 'undefined', 'pre-condicao do teste: o harness nao simula essa API');

  // Prova de verdade, isolada: extrai o trecho do texto-fonte e roda com um Electron FALSO
  // que TEM requestSingleInstanceLock devolvendo false (2a copia do processo abrindo).
  const src = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const m = src.match(/if \(typeof app\.requestSingleInstanceLock[\s\S]*?\n\}/);
  assert.ok(m, 'o trecho da trava de instancia unica tem de existir no main.js, logo no topo');
  const chamadasQuit = [];
  const ctxComTrava = vm.createContext({ app: { requestSingleInstanceLock: () => false, quit: () => chamadasQuit.push(1) } });
  vm.runInContext(m[0], ctxComTrava);
  assert.equal(chamadasQuit.length, 1, 'quando a trava falha (2a instancia), app.quit() tem de ser chamado');

  // e quando a trava passa (1a instancia), app.quit() nao pode ser chamado
  const chamadasQuit2 = [];
  const ctxSemColisao = vm.createContext({ app: { requestSingleInstanceLock: () => true, quit: () => chamadasQuit2.push(1) } });
  vm.runInContext(m[0], ctxSemColisao);
  assert.equal(chamadasQuit2.length, 0, 'com a trava OK (1a instancia), app.quit() nao pode ser chamado');
});

// ---------- R1-010: skillCache tem de expirar (skill nova aparece sem reabrir o app) ----------

test('R1-010: skillCache expira depois de 60s — antes disso era eterno e nunca relia o disco', () => {
  const h = loadMain();
  const dateNowOriginal = Date.now;
  let agora = 1000000;
  try {
    Date.now = () => agora;
    h.evaluate(`
      globalThis.__lidas = 0;
      fs.readdirSync = () => { globalThis.__lidas++; return []; };
    `);

    h.call('skills:list', 'claude');
    const lidasApos1a = h.evaluate('globalThis.__lidas');
    assert.ok(lidasApos1a > 0, 'a 1a leitura tem de varrer o disco');

    h.call('skills:list', 'claude');   // ainda dentro da janela de 60s
    assert.equal(h.evaluate('globalThis.__lidas'), lidasApos1a,
      'dentro da janela valida (60s) o cache tem de servir, sem reler o disco');

    agora += 61000;   // passa dos 60s
    h.call('skills:list', 'claude');
    assert.ok(h.evaluate('globalThis.__lidas') > lidasApos1a,
      'passados os 60s tem de reler o disco — antes do conserto o cache era eterno e uma skill nova so aparecia reabrindo o app');
  } finally { Date.now = dateNowOriginal; }
});

// ---------- R1-045: mcp:acao com comando LOCAL nao pode vir do celular ----------

test('R1-045: adicionar conector por COMANDO local via mcp:acao é recusado quando vem do celular', async () => {
  const h = loadMain();
  const r = await h.call('mcp:acao', { engine: 'claude', acao: 'add', nome: 'x', comando: 'bash -c "echo pwned"' }, { remoto: true });
  assert.ok(r && r.error, 'tem de vir com erro: comando local nao pode ser adicionado pelo celular');
  assert.equal(h.spawned.length, 0, 'nao pode ter chegado a rodar NENHUM processo — o bloqueio tem de ser antes do spawn');
});

test('R1-045: o mesmo pedido no Mac (sem remoto) continua passando pelo fluxo normal', async () => {
  const h = loadMain();
  const promessa = h.call('mcp:acao', { engine: 'claude', acao: 'add', nome: 'x', comando: 'echo oi' }, null);
  // sem "remoto: true" o bloqueio novo nao pode disparar: chega a tentar rodar o comando de
  // verdade (fakeSpawn). Destrava a promise emitindo o 'close' do processo simulado.
  assert.equal(h.spawned.length, 1, 'no Mac tem de chegar a chamar o processo, sem o bloqueio novo');
  h.spawned.at(-1).proc.emit('close', 0);
  const r = await promessa;
  assert.ok(!r || r.error !== 'Conector local só pode ser adicionado no Mac.',
    'o erro do bloqueio de celular nao pode aparecer no uso normal do Mac');
});

test('R1-045: conector por URL remota continua liberado pro celular (o achado descreve isso como intencional)', async () => {
  const h = loadMain();
  const promessa = h.call('mcp:acao', { engine: 'claude', acao: 'add', nome: 'x', url: 'https://exemplo.com/mcp' }, { remoto: true });
  assert.equal(h.spawned.length, 1, 'URL remota tem de seguir o fluxo normal (chega a chamar o processo)');
  h.spawned.at(-1).proc.emit('close', 0);
  const r = await promessa;
  assert.ok(!r || r.error !== 'Conector local só pode ser adicionado no Mac.',
    'adicionar por URL nao pode ser bloqueado — so o comando local');
});

// ---------- R1-049: credClaude tem de guardar em cache o "nao achei" tambem ----------

// tokenDoClaude e' um "const" que ja aponta pro plataforma.tokenClaude do harness (que sempre
// devolve '' — vazio, como um Chaveiro sem nada); por isso nao da pra trocar por um mock com
// contador. A prova aqui e' pelo proprio "credQuando" (variavel de controle do cache, um
// "let" no main.js): se ele mudar de valor e' porque credClaude rodou tokenDoClaude() de
// novo; se ficar igual, o cache serviu sem reler.
// R2-017 [testes ajustados]: credClaude virou "async function" (tokenDoClaude agora e'
// assincrono no plataforma.js de verdade — so o harness continua com o stub sincrono). Os dois
// testes abaixo afirmavam que credClaude(false) devolvia o valor direto, na hora; isso deixou
// de ser verdade (agora devolve sempre uma Promise, mesmo no caminho do cache). O comportamento
// que eles verificam (cache de 90s, "nao achei" x token bom) continua o mesmo — so precisou de
// "await" em cada chamada.

test('R1-049: Chaveiro falhando (token vazio) repetidas vezes so bate 1x dentro da janela de 90s', async () => {
  const h = loadMain();
  const dateNowOriginal = Date.now;
  let agora = 5000000;
  try {
    Date.now = () => agora;
    h.evaluate('credGuardada = null; credQuando = 0;');
    const r1 = await h.evaluate('credClaude(false)');
    assert.equal(!!r1, false, 'o Chaveiro do harness sempre devolve vazio');
    const quandoApos1a = h.evaluate('credQuando');
    assert.equal(quandoApos1a, agora, 'a 1a leitura tem de marcar a hora em que rodou');

    agora += 1000;   // ainda dentro da janela de 90s
    await h.evaluate('credClaude(false)');
    // Antes do conserto: credGuardada nunca virava truthy (o Chaveiro sempre falha), entao
    // "if (!credGuardada)" era verdade em TODA chamada — cada uma rodava a trava sincrona de
    // ate 8s de novo, travando a janela inteira repetidas vezes.
    assert.equal(h.evaluate('credQuando'), quandoApos1a,
      'dentro da janela de 90s nao pode ter rodado de novo — credQuando teria mudado');

    agora += 91000;   // agora sim passou dos 90s desde a 1a leitura
    await h.evaluate('credClaude(false)');
    assert.equal(h.evaluate('credQuando'), agora,
      'passados os 90s tem de tentar de novo — senao um Chaveiro que voltou a funcionar nunca seria lido');
  } finally { Date.now = dateNowOriginal; }
});

test('R1-049: token BOM continua em cache pra sessao inteira (o TTL novo e so pro "nao achei")', async () => {
  const h = loadMain();
  const dateNowOriginal = Date.now;
  let agora = 5000000;
  try {
    Date.now = () => agora;
    h.evaluate('credGuardada = "token-bom"; credQuando = 0;');
    const r1 = await h.evaluate('credClaude(false)');
    assert.equal(r1, 'token-bom');
    assert.equal(h.evaluate('credQuando'), 0, 'com o token ja bom, credClaude nem precisa marcar a hora — nao vai reler');

    agora += 500000;   // bem mais que 90s
    const r2 = await h.evaluate('credClaude(false)');
    assert.equal(r2, 'token-bom', 'token bom continua valendo mesmo muito depois — nao pode ter sido substituido pelo vazio do Chaveiro');
    assert.equal(h.evaluate('credQuando'), 0, 'nunca rodou de novo: credQuando continua 0 (nao foi setado)');
  } finally { Date.now = dateNowOriginal; }
});
