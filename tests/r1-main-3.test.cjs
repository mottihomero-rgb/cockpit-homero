'use strict';

// Testes de guarda do lote "main" (R1) — faixa consertador, rodada 1, lote 3.
// Cobrem: R1-011 (ditado por voz com arquivo temporario fixo, colidia entre duas ditacoes ao
// mesmo tempo), R1-012 ("puxar aba do navegador" abria Chrome/Safari escondidos so pra
// descobrir que nao ha aba), R1-046 ("Abrir no Mac" rodava .command/.app sem perguntar nada),
// R1-013/R1-047 (enderecoTailscale() travava o processo principal inteiro com execFileSync
// sincrono; mesmo defeito, achado 2x por revisores diferentes).
// Padrao de arquivo: tests/main-harness.cjs + tests/r1-main-2.test.cjs.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadMain } = require('./main-harness.cjs');

// ---------- R1-011: ditado por voz nao pode ter nome de arquivo fixo ----------

test('R1-011: duas ditacoes ao mesmo tempo (2 paineis, ou Mac + celular) usam arquivo .webm DIFERENTE cada uma', async () => {
  const h = loadMain();
  h.put(path.join(h.HOME, '.cockpit', 'modelos', 'ggml-small.bin'), 'modelo-fake');
  h.evaluate(`
    // o harness nao simula os.tmpdir(); so este handler usa
    os.tmpdir = () => '/cockpit-test/tmp';
    globalThis.__webmBases = [];
    const __origWrite = fs.writeFileSync;
    fs.writeFileSync = (nome, dado) => {
      if (/ck-voz-.*\\.webm$/.test(String(nome))) globalThis.__webmBases.push(String(nome));
      return __origWrite(nome, dado);
    };
    // stub do ffmpeg/whisper-cli: escreve exatamente o arquivo de saida que o handler espera,
    // igual ao que os binarios reais fariam, sem precisar deles instalados no CI
    rodar = async (bin, args) => {
      if (String(bin) === 'ffmpeg') {
        fs.writeFileSync(args[args.length - 1], 'wav-fake');
        return { err: null, out: '', errout: '' };
      }
      if (String(bin) === 'whisper-cli') {
        const base = args[args.indexOf('-of') + 1];
        fs.writeFileSync(base + '.txt', 'texto ditado');
        return { err: null, out: '', errout: '' };
      }
      return { err: null, out: '', errout: '' };
    };
  `);
  const a1 = Buffer.from('audio-do-chat-a').toString('base64');
  const a2 = Buffer.from('audio-do-chat-b').toString('base64');
  // as duas comecam SEM esperar uma pela outra, igual o app real: o Chat B pode ditar de novo
  // enquanto o Chat A ainda esta "pensando" no main
  const p1 = h.call('voz:transcrever', { audio: a1 });
  const p2 = h.call('voz:transcrever', { audio: a2 });

  const bases = h.evaluate('globalThis.__webmBases');
  assert.equal(bases.length, 2, 'as duas ditacoes tem de comecar a gravar seu proprio .webm');
  assert.notEqual(bases[0], bases[1],
    'antes do conserto as duas escreviam no MESMO caminho (so o pid, que nao muda durante a vida do app) — um chat recebia o audio do outro');

  const [r1, r2] = await Promise.all([p1, p2]);
  assert.equal(r1.texto, 'texto ditado', 'cada ditacao tem de terminar com o seu proprio texto, sem erro de colisao');
  assert.equal(r2.texto, 'texto ditado');
});

// ---------- R1-012: puxar aba do navegador nao pode abrir Chrome/Safari escondidos ----------

test('R1-012: com Chrome e Safari fechados, NUNCA chama o script que abriria os dois so pra achar aba nenhuma', async () => {
  const h = loadMain();
  h.evaluate(`
    // R2-042 trocou a checagem de processo de "System Events" por pgrep (System Events pede
    // permissao de Automacao propria e falhava calada); o mock tem de simular pgrep agora.
    globalThis.__chamadas = [];
    rodar = async (bin, args) => {
      globalThis.__chamadas.push({ bin: String(bin), args });
      if (String(bin) === '/usr/bin/pgrep') {
        // Chrome e Safari fechados: pgrep nao acha o processo, devolve erro
        return { err: new Error('saiu com código 1'), out: '', errout: '' };
      }
      // se o codigo chegasse aqui de verdade (osascript "tell application"), o macOS teria
      // acabado de abrir o app so pra responder — e' exatamente o que nao pode acontecer
      // com os dois fechados
      return { err: null, out: '', errout: '' };
    };
  `);
  const r = await h.call('navegador:aba');
  const chamadas = h.evaluate('globalThis.__chamadas');
  assert.equal(chamadas.length, 2, 'so as duas checagens de processo (Chrome, Safari) — nada mais');
  assert.ok(chamadas.every((c) => c.bin === '/usr/bin/pgrep'),
    'nenhuma chamada pode ser o osascript que pede a URL da aba: esse e o que abre o app sozinho');
  assert.ok(r && r.error, 'com os dois fechados tem de devolver erro, sem ter aberto nada');
});

test('R1-012: com o Chrome aberto de verdade, continua achando a aba normal (nao quebrou o caminho bom)', async () => {
  const h = loadMain();
  h.evaluate(`
    rodar = async (bin, args) => {
      if (String(bin) === '/usr/bin/pgrep') {
        // pgrep -x <nome>: acha o Chrome, nao acha o Safari
        return args[1] === 'Google Chrome'
          ? { err: null, out: '', errout: '' }
          : { err: new Error('saiu com código 1'), out: '', errout: '' };
      }
      const script = args[1] || '';
      if (/Google Chrome/.test(script)) {
        return { err: null, out: 'https://exemplo.com\\nTitulo da aba', errout: '' };
      }
      return { err: null, out: '', errout: '' };
    };
  `);
  const r = await h.call('navegador:aba');
  assert.equal(r.url, 'https://exemplo.com');
  assert.equal(r.navegador, 'Google Chrome');
});

// ---------- R1-046: "Abrir no Mac" nao pode rodar codigo sem perguntar ----------

test('R1-046: arquivo que RODA codigo (.command) pergunta antes — confirmando, abre normal', async () => {
  const h = loadMain();
  h.evaluate(`
    globalThis.__abriu = [];
    globalThis.__dialogos = [];
    shell.openPath = (p) => { globalThis.__abriu.push(p); return ''; };
    dialog.showMessageBox = async (_w, opts) => { globalThis.__dialogos.push(opts); return { response: 1 }; };
  `);
  await h.call('shell:open', '/tmp/atualizacao.command');
  assert.equal(h.evaluate('globalThis.__dialogos.length'), 1, 'tem de perguntar antes de um .command');
  const abriu = h.evaluate('globalThis.__abriu');
  assert.equal(abriu.length, 1, 'confirmando "abrir mesmo assim", abre');
  assert.equal(abriu[0], '/tmp/atualizacao.command');
});

test('R1-046: cancelando o aviso, shell.openPath NUNCA roda', async () => {
  const h = loadMain();
  h.evaluate(`
    globalThis.__abriu = [];
    shell.openPath = (p) => { globalThis.__abriu.push(p); return ''; };
    dialog.showMessageBox = async () => ({ response: 0 });
  `);
  await h.call('shell:open', '/tmp/atualizacao.command');
  assert.equal(h.evaluate('globalThis.__abriu.length'), 0, 'cancelou: nada pode ter rodado');
});

test('R1-046: tipo comum (.png) continua abrindo direto, sem pergunta nova na tela', async () => {
  const h = loadMain();
  h.evaluate(`
    globalThis.__abriu = [];
    globalThis.__dialogos = [];
    shell.openPath = (p) => { globalThis.__abriu.push(p); return ''; };
    dialog.showMessageBox = async (_w, opts) => { globalThis.__dialogos.push(opts); return { response: 1 }; };
  `);
  await h.call('shell:open', '/tmp/foto.png');
  assert.equal(h.evaluate('globalThis.__dialogos.length'), 0, 'imagem nao roda codigo: nao pode aparecer frase nova na tela');
  const abriu = h.evaluate('globalThis.__abriu');
  assert.equal(abriu.length, 1);
  assert.equal(abriu[0], '/tmp/foto.png');
});

// ---------- R1-013/R1-047: enderecoTailscale nao pode travar o processo principal ----------

test('R1-013/R1-047: enderecoTailscale() virou assincrona (Promise) — nao trava mais o boot nem o "ligar celular"', async () => {
  const h = loadMain();
  h.evaluate(`
    globalThis.__rodarChamado = null;
    rodar = async (bin, args) => {
      globalThis.__rodarChamado = { bin, args };
      return {
        err: null,
        out: JSON.stringify({ Web: { 'meu-host.ts.net:443': { Handlers: { '/': { Proxy: 'http://127.0.0.1:7788' } } } } }),
        errout: '',
      };
    };
  `);
  const p = h.evaluate('enderecoTailscale()');
  assert.equal(typeof (p && p.then), 'function',
    'tem de devolver uma Promise — a versao antiga (execFileSync) devolvia a string na hora, travando o processo ate o tailscale responder');
  const endereco = await p;
  assert.equal(endereco, 'https://meu-host.ts.net');
  assert.ok(h.evaluate('globalThis.__rodarChamado'), 'tem de ter usado rodar() (spawn assincrono), o mesmo caminho do resto do arquivo');
  assert.equal(h.violations.length, 0, 'execFileSync (bloqueado de proposito no harness) nunca pode ter sido chamado');
});

test('R1-013/R1-047: se o tailscale nao estiver servindo a porta 7788, devolve o aviso sem travar nem quebrar', async () => {
  const h = loadMain();
  h.evaluate(`rodar = async () => ({ err: null, out: JSON.stringify({ Web: {} }), errout: '' });`);
  const endereco = await h.evaluate('enderecoTailscale()');
  assert.match(endereco, /Sem endereço/i);
});

test('R1-013/R1-047: boot compartilha a transição assíncrona de web:ligar, sem execFileSync', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.match(src, /const endereco = await enderecoTailscale\(\);/);
  assert.match(src, /HANDLERS\['web:ligar'\]\(null, true\)\.then/,
    'o boot dispara a mesma transição em paralelo, sem bloquear janela e sem servidor concorrente');
  assert.doesNotMatch(src, /execFileSync\s*\(/);
});
