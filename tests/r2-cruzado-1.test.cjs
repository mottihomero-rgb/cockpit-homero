'use strict';
/* Testes de guarda do lote "cruzado 1" da rodada 2 (R2-011, R2-037, R2-025, R2-017).
   Cada teste falha no código de ANTES do conserto e passa com o conserto aplicado. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { loadMain } = require('./main-harness.cjs');

const mainSrc = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
const appSrc = fs.readFileSync(path.join(__dirname, '../renderer/app.js'), 'utf8');

/* extrai "function nome(...) {...}" (ou "async function") pelo mesmo jeito que
   tests/auditoria-renderer-20260921.test.cjs já usa pro renderer */
function extractFn(nome, src) {
  const re = new RegExp('^(?:async )?function ' + nome + '\\(', 'm');
  const m = re.exec(src);
  assert.ok(m, nome + ' existe no arquivo');
  const start = m.index;
  return src.slice(start, src.indexOf('\n}', start) + 2);
}

/* ===================== R2-011: busca não ignora acento ===================== */

test('R2-011 main.js: semAcento tira acento e trechoDoIndice acha "codigo" dentro de "código"', () => {
  const ctx = vm.createContext({});
  vm.runInContext(extractFn('semAcento', mainSrc) + '\n' + extractFn('trechoDoIndice', mainSrc), ctx);
  const semAcento = vm.runInContext('semAcento', ctx);
  const trechoDoIndice = vm.runInContext('trechoDoIndice', ctx);

  assert.equal(semAcento('código'), 'codigo');
  // o mesmo tratamento que o handler aplica no termo antes de comparar (alvo já sai sem acento)
  const alvo = semAcento('codigo'.toLowerCase());
  const trecho = trechoDoIndice('o projeto do código está pronto', alvo);
  assert.ok(trecho, 'não achou "codigo" digitado sem acento dentro de um texto com "código"');
  assert.match(trecho, /código/);
});

test('R2-011 main.js: o atalho da busca crua (linha do índice) também ignora acento', () => {
  // mesma expressão usada dentro de handle('sessions:buscar', ...): semAcento(linha.toLowerCase()).includes(alvo)
  const ctx = vm.createContext({});
  vm.runInContext(extractFn('semAcento', mainSrc), ctx);
  const semAcento = vm.runInContext('semAcento', ctx);
  const alvo = semAcento('implementacao');
  const linhaDoIndice = '{"f":"a.jsonl","x":"fala da Implementação do projeto"}';
  assert.ok(semAcento(linhaDoIndice.toLowerCase()).includes(alvo),
    'termo sem acento não achou a linha crua que tem a palavra acentuada');
});

test('R2-011 app.js: filtro "no nome" (porNome) acha título acentuado com termo sem acento e vice-versa', () => {
  const semAcentoSrc = extractFn('semAcento', appSrc);
  const m = appSrc.match(
    /const porNome = list\.filter\(s => semAcento\(String\(s\.title \|\| ''\)\.toLowerCase\(\)\)\.includes\(termoSemAcento\)\);/
  );
  assert.ok(m, 'a linha do filtro por nome em app.js mudou de formato — atualizar este teste');

  const ctx = vm.createContext({});
  vm.runInContext(semAcentoSrc, ctx);
  const semAcento = vm.runInContext('semAcento', ctx);

  const listaAcentuada = [{ title: 'Implementação do checkout' }, { title: 'Outra coisa' }];
  const termoSemAcentoDigitado = 'implementacao';
  const termoSemAcento1 = semAcento(termoSemAcentoDigitado);
  const porNome1 = listaAcentuada.filter(s => semAcento(String(s.title || '').toLowerCase()).includes(termoSemAcento1));
  assert.equal(porNome1.length, 1, 'título com acento não foi achado por termo digitado sem acento');

  const listaSemAcento = [{ title: 'implementacao do checkout' }];
  const termoAcentuadoDigitado = 'implementação';
  const termoSemAcento2 = semAcento(termoAcentuadoDigitado.toLowerCase());
  const porNome2 = listaSemAcento.filter(s => semAcento(String(s.title || '').toLowerCase()).includes(termoSemAcento2));
  assert.equal(porNome2.length, 1, 'título sem acento não foi achado por termo digitado com acento');
});

/* ===================== R2-037: colar imagem falhando em silêncio ===================== */

test('R2-037 main.js: clipboard:anexos devolve error quando a gravação falha (disco cheio/permissão)', async () => {
  const h = loadMain();
  const clipboardRef = h.evaluate('clipboard');
  clipboardRef.readImage = () => ({ isEmpty: () => false, toPNG: () => Buffer.from('fake-png') });
  const fsRef = h.evaluate('fs');
  const writeOriginal = fsRef.writeFileSync;
  fsRef.writeFileSync = () => { throw new Error('ENOSPC: no space left on device'); };
  try {
    const r = await h.call('clipboard:anexos');
    // r vem de dentro da vm (outro "realm"): comparar arrays por deepEqual direto falha por
    // identidade de protótipo mesmo com o mesmo conteúdo — compara por tamanho/valor
    assert.equal(r.arquivos.length, 0);
    assert.ok(r.error && /ENOSPC/.test(r.error),
      'falha ao gravar o PNG colado devolveu o mesmo resultado de "nada pra colar" (sem error)');
  } finally {
    fsRef.writeFileSync = writeOriginal;
  }
});

test('R2-037 main.js: clipboard:anexos continua funcionando quando a gravação dá certo', async () => {
  const h = loadMain();
  const clipboardRef = h.evaluate('clipboard');
  clipboardRef.readImage = () => ({ isEmpty: () => false, toPNG: () => Buffer.from('fake-png') });
  const r = await h.call('clipboard:anexos');
  assert.equal(r.error, undefined);
  assert.equal(r.arquivos.length, 1);
});

test('R2-037 renderer/app.js: colar() avisa na tela quando window.api.colados() devolve error', async () => {
  const start = appSrc.indexOf("const colar = async (e) => {");
  const end = appSrc.indexOf("el.addEventListener('paste', colar);");
  assert.ok(start >= 0 && end > start, 'não achei a função colar() em app.js — mudou de lugar?');
  const colarSrc = appSrc.slice(start, end);

  const avisos = [];
  const anexarChamadas = [];
  const ctx = vm.createContext({
    console,
    window: { api: { colados: async () => ({ arquivos: [], error: 'disco cheio' }) } },
    P: { id: 'p1' },
    setFocus: () => {},
    anexar: async (P, arquivos) => { anexarChamadas.push(arquivos); },
    avisoTemp: (P, texto, ehErro) => avisos.push({ texto, ehErro }),
  });
  vm.runInContext(colarSrc, ctx);
  const colar = vm.runInContext('colar', ctx);

  const evento = { clipboardData: { items: [], files: [] }, preventDefault: () => {} };
  await colar(evento);

  assert.equal(anexarChamadas.length, 0, 'não devia ter tentado anexar nada, já que colados() falhou');
  assert.equal(avisos.length, 1, 'colar() não avisou na tela que a colagem falhou (ficou mudo)');
  assert.equal(avisos[0].ehErro, true);
  assert.match(avisos[0].texto, /disco cheio/);
});

/* ===================== R2-025: pedido do quadro apagado sem confirmar ===================== */

test('R2-025 main.js: sem confirmação do renderer, o pedido continua vivo (não apaga, não loga sucesso)', () => {
  const h = loadMain();
  const sends = h.evaluate("(function(){ globalThis.__sends = []; return globalThis.__sends; })()");
  const pedidoPath = h.HOME + '/app-data/quadros/pedido-abrir';
  h.put(pedidoPath, '');

  // o fakeFs do harness devolve sempre mtimeMs:1 (não serve pro teto de 5 min) — só pra este
  // teste, o statSync do arquivo do pedido responde com um mtime de agora mesmo
  const fsRef = h.evaluate('fs');
  const statOriginal = fsRef.statSync;
  fsRef.statSync = (p) => (String(p) === pedidoPath ? { mtimeMs: Date.now() } : statOriginal(p));

  h.evaluate(`
    win = { isDestroyed: () => false, webContents: { send: (...a) => { __sends.push(a); } } };
  `);
  h.evaluate('vigiarPedidoDoQuadro()');
  assert.equal(h.timers.size, 1, 'vigiarPedidoDoQuadro não registrou o setInterval de 1.5s');
  const tick = [...h.timers.values()][0];

  tick();   // um ciclo, focusPane null no renderer -> nunca confirma

  assert.ok(h.files.has(pedidoPath), 'apagou o pedido mesmo sem confirmação de que o quadro abriu');
  // sends[0] é um array criado dentro da vm (outro "realm"): [...] copia pro realm deste teste
  assert.deepEqual([...sends[0]], ['menu', 'quadro']);
  const log = (h.files.get(h.HOME + '/app-data/cockpit.log') || Buffer.alloc(0)).toString('utf8');
  assert.ok(!/quadro aberto a pedido do Claude/.test(log),
    'logou "quadro aberto" sem ninguém ter confirmado que abriu de verdade');
});

test('R2-025 main.js: confirmação positiva do renderer apaga o pedido e loga sucesso', async () => {
  const h = loadMain();
  const pedidoPath = h.HOME + '/app-data/quadros/pedido-abrir';
  h.put(pedidoPath, '');

  await h.call('quadro:abriuResultado', true);

  assert.ok(!h.files.has(pedidoPath), 'não apagou o pedido depois da confirmação positiva');
  const log = (h.files.get(h.HOME + '/app-data/cockpit.log') || Buffer.alloc(0)).toString('utf8');
  assert.match(log, /quadro aberto a pedido do Claude/);
});

test('R2-025 renderer/app.js: acaoDeMenu("quadro") avisa main.js se abriu (focusPane) ou não (null)', () => {
  const m = appSrc.match(/if \(a === 'quadro'\) \{\s*\n\s*\/\/ R2-025[^\n]*\n\s*const abriu = !!\(focusPane && window\.Quadro && window\.Quadro\.abrir\(focusPane\)\);\s*\n\s*if \(window\.api && window\.api\.quadroAbriu\) window\.api\.quadroAbriu\(abriu\);/);
  assert.ok(m, 'acaoDeMenu não está mais confirmando pro main.js se o quadro abriu de verdade — atualizar main.js/preload.js junto');
});

/* ===================== R2-017: Chaveiro negado trava a janela até 16s ===================== */

test('R2-017 plataforma.js: tokenClaude() é assíncrono e não bloqueia o laço de eventos esperando o Chaveiro', async () => {
  const src = fs.readFileSync(path.join(__dirname, '../plataforma.js'), 'utf8');
  const mod = { exports: {} };
  const modPath = path.join(__dirname, '../plataforma.js');
  const fakeRequire = (name) => {
    if (name === 'child_process') {
      return {
        spawn: () => { throw new Error('spawn não usado neste teste'); },
        execFileSync: () => { throw new Error('execFileSync não devia mais ser chamado por tokenClaude'); },
        // Chaveiro negado/lento: o callback só chega depois de um tick assíncrono
        execFile: (bin, args, opts, cb) => { setTimeout(() => cb(new Error('security: acesso negado'), ''), 15); },
      };
    }
    return require(name);
  };
  // eslint-disable-next-line no-new-func
  const fn = new Function('require', 'module', 'exports', '__dirname', '__filename', src);
  fn(fakeRequire, mod, mod.exports, path.dirname(modPath), modPath);
  const plataforma = mod.exports;

  const chamada = plataforma.tokenClaude();
  assert.equal(typeof chamada.then, 'function',
    'tokenClaude() precisa devolver uma Promise — se devolver o token direto, quem chama trava esperando o Chaveiro');

  let ticou = false;
  const t = setTimeout(() => { ticou = true; }, 3);
  await chamada;
  clearTimeout(t);
  assert.equal(ticou, true, 'o laço de eventos ficou preso enquanto tokenClaude esperava o Chaveiro responder');
});

test('R2-017 main.js: uso:ler (claude) não chama fetch quando o Chaveiro não devolve token — prova que credClaude foi aguardado (await)', async () => {
  const h = loadMain();
  // o stub de plataforma no harness devolve '' (sem token) de forma síncrona: se algum
  // chamador esquecer o await, credClaude(false) devolve uma Promise (sempre "verdadeira"),
  // o "if (!t) return null" nunca dispara e o código tenta buscar (fetch), que é proibido aqui
  await h.call('uso:ler', 'claude');
  assert.ok(!h.violations.includes('fetch'),
    'buscarUsoDoClaude chamou fetch mesmo sem token: credClaude não foi aguardado (await) em algum chamador');
});
