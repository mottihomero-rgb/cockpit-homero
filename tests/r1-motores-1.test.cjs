'use strict';
// Testes de guarda da faixa "motores", lote 1 (25/09/2026).
// R1-039 (acp.js)         -> anotar() nao pode engolir erro de disco calado
// R1-040 (cli-motors.js)  -> start() do Gemini nao pode ler o .jsonl inteiro
//                             quando a conversa e' gigante (trava o processo
//                             principal do Electron pra todos os paineis)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const acp = require('../acp.js');
const { criarCli } = require('../cli-motors.js');

/* ---------------------------------------------------------------- R1-039 */

test('R1-039: anotar() continua aceitando a chamada antiga de 2 args (compat com teste-acp.js/teste-acp-ponte.js)', () => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-anotar-compat-'));
  const arquivo = path.join(pasta, 'sessao.jsonl');
  acp.anotar(arquivo, { role: 'user', text: 'oi' });
  const linhas = fs.readFileSync(arquivo, 'utf8').trim().split('\n');
  assert.equal(linhas.length, 1);
  assert.equal(JSON.parse(linhas[0]).text, 'oi');
});

test('R1-039: anotar() avisa por callback quando a escrita em disco falha, em vez de engolir o erro calado', () => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-anotar-falha-'));
  // 'bloqueio' e' um ARQUIVO, entao mkdirSync(dirname) dentro dele quebra com ENOTDIR
  // -- simula disco cheio/pasta sem permissao sem depender de chmod (mais robusto entre SOs)
  const bloqueio = path.join(pasta, 'bloqueio');
  fs.writeFileSync(bloqueio, 'nao sou uma pasta');
  const arquivoQuebrado = path.join(bloqueio, 'sub', 'sessao.jsonl');

  let erroRecebido = null;
  acp.anotar(arquivoQuebrado, { role: 'bot', text: 'nunca grava' }, (e) => { erroRecebido = e; });

  assert.ok(erroRecebido, 'sem o conserto o catch fica vazio e o callback nunca e chamado (historico some calado)');
  assert.match(String(erroRecebido && erroRecebido.message), /ENOTDIR|ENOENT|EEXIST/);
});

/* ---------------------------------------------------------------- R1-040 */

function montarCli(runtime) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-r1-040-'));
  const eventos = [];
  const cli = criarCli({
    HOME: home,
    pastaDados: () => path.join(home, 'app'),
    temBin: (bin) => bin === (runtime || 'gemini'),
    acharBin: (bin) => '/fake/bin/' + bin,
    buildEnv: () => ({}),
    emit: (paneId, kind, data) => eventos.push({ paneId, kind, ...data }),
    matarGrupo: () => {},
    spawnBin: () => {
      const p = new EventEmitter();
      p.stdout = new PassThrough(); p.stderr = new PassThrough(); p.stdin = new PassThrough();
      return p;
    },
  });
  return { cli, home, eventos };
}

test('R1-040: reabrir conversa GIGANTE do Gemini nao le o arquivo inteiro (so a cauda) quando acha o marcador nela', () => {
  const { cli, home } = montarCli('gemini');
  const id = 'sessao-gigante';
  const file = path.join(home, 'app', 'gemini', id + '.jsonl');
  fs.mkdirSync(path.dirname(file), { recursive: true });

  // enche o arquivo bem alem do teto (4 MB) com lixo, e deixa o marcador de
  // retomada perto do FIM -- onde start() deve conseguir achar sem ler tudo
  const linhaGrande = JSON.stringify({ role: 'bot', text: 'x'.repeat(2000) }) + '\n';
  const fd = fs.openSync(file, 'w');
  const bloco = Buffer.from(linhaGrande.repeat(2000)); // ~ 4 MB por bloco
  for (let i = 0; i < 3; i++) fs.writeSync(fd, bloco); // ~ 12 MB
  // runtime igual ao atual ('gemini') pra nao entrar no ramo de migracao
  // legado (historico() de cliHistory/linhasDoArquivo), que e' outro achado
  // e nao entra neste conserto
  fs.writeSync(fd, JSON.stringify({ retomada: 'sessao-nova', runtime: 'gemini' }) + '\n');
  fs.closeSync(fd);
  assert.ok(fs.statSync(file).size > 4 * 1024 * 1024, 'arquivo de teste precisa ficar acima do teto');

  const original = fs.readFileSync;
  let leuOArquivoInteiro = false;
  fs.readFileSync = (...args) => {
    if (String(args[0]) === file) leuOArquivoInteiro = true;
    return original.apply(fs, args);
  };
  let ok;
  try {
    ok = cli.start('p', { cwd: home, resumeId: id });
  } finally {
    fs.readFileSync = original;
  }

  assert.equal(ok, true);
  assert.equal(leuOArquivoInteiro, false,
    'sem o conserto, start() chama fs.readFileSync no arquivo inteiro mesmo sendo gigante (trava o processo principal do Electron)');
});

test('R1-040: arquivo pequeno continua lido por inteiro (comportamento de hoje preservado)', () => {
  const { cli, home } = montarCli('gemini');
  const id = 'sessao-pequena';
  const file = path.join(home, 'app', 'gemini', id + '.jsonl');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ retomada: 'sessao-nova', runtime: 'gemini' }) + '\n');

  const ok = cli.start('p', { cwd: home, resumeId: id });
  assert.equal(ok, true);
});
