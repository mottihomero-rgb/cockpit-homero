'use strict';
/* Auditoria 25/09, rodada 1, faixa "projeto", lote 1.
   Três achados confirmados: nenhum deles é bug de produção, é FALTA DE TESTE em código
   sensível (VPS por SSH, disparo de rotina via launchctl, empacotamento do app). O conserto
   aqui é o teste em si — sem ele, uma quebra futura nessas áreas passa pelos 345 testes do
   `npm test` sem ninguém perceber. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadMain } = require('./main-harness.cjs');

const raiz = path.resolve(__dirname, '..');

/* ===================================================================================
   R1-056 — ehRemoto/partesRemoto (decide se a pasta é da VPS) e os handlers
   vps:pastas / vps:testar (falam com a VPS por SSH) sem teste nenhum.
   =================================================================================== */

test('R1-056: ehRemoto separa caminho da VPS de pasta local com dois-pontos no nome', () => {
  const h = loadMain();
  assert.equal(h.evaluate("ehRemoto('vps:/opt/x')"), true, 'vps:/... é o formato real usado no app');
  assert.equal(h.evaluate("ehRemoto('servidor-invalido:/x')"), false, 'servidor não cadastrado não pode virar SSH');
  assert.equal(h.evaluate("ehRemoto('14:30/notas')"), false, 'pasta local com hora no nome não é remota');
  assert.equal(h.evaluate("ehRemoto('')"), false, 'string vazia não é remota');
  assert.equal(h.evaluate("ehRemoto(undefined)"), false, 'undefined não pode explodir nem virar remoto');
});

test('R1-056: partesRemoto monta host/usuário/pasta só para servidor cadastrado', () => {
  const h = loadMain();
  // objeto vem da VM de main.js: compara campo a campo (deepEqual falha cross-realm)
  const vps = h.evaluate("partesRemoto('vps:/opt/x')");
  assert.equal(vps.chave, 'vps'); assert.equal(vps.host, 'vps'); assert.equal(vps.usuario, 'homero');
  assert.equal(vps.nome, 'VPS'); assert.equal(vps.caminho, '/opt/x');
  assert.equal(h.evaluate("partesRemoto('servidor-invalido:/x')"), null, 'servidor desconhecido tem de devolver null, nunca inventar host');
  assert.equal(h.evaluate("partesRemoto('')"), null);
  assert.equal(h.evaluate("partesRemoto(undefined)"), null);
  // caminho vazio (ex.: "vps:") vira raiz "/", nunca string vazia (SSH com pasta vazia dá erro estranho)
  assert.equal(h.evaluate("partesRemoto('vps:').caminho"), '/');
});

test('R1-056: vps:pastas lista a VPS por SSH e devolve as pastas', async () => {
  const h = loadMain();
  const p = h.call('vps:pastas', 'vps:/opt/teste');
  await Promise.resolve(); await Promise.resolve();
  const ssh = h.spawned.at(-1);
  assert.equal(ssh.bin, 'ssh', 'a listagem tem de sair por ssh, não por outro binário');
  assert.ok(ssh.args.includes('vps'), 'o host tem de ir pro comando do ssh');
  assert.ok(ssh.args.some((a) => /ls -1Ap/.test(a)), 'o comando remoto é o ls que marca pasta com barra');
  ssh.proc.stdout.emit('data', Buffer.from('robos/\narquivo.txt\n'));
  ssh.proc.emit('close', 0);
  const r = await p;
  // Array.from (não .map): entries nasceu na VM de main.js, e comparar array cross-realm
  // com deepEqual falha por "mesma estrutura, mas não a mesma referência de protótipo"
  assert.deepEqual(Array.from(r.entries, (e) => e.name), ['robos', 'arquivo.txt']);
  assert.equal(r.entries[0].dir, true);
  assert.equal(r.entries[0].path, 'vps:/opt/teste/robos');
});

test('R1-056: vps:pastas devolve erro quando o SSH falha, sem lista vazia disfarçada', async () => {
  const h = loadMain();
  const p = h.call('vps:pastas', 'vps:/opt/teste');
  await Promise.resolve(); await Promise.resolve();
  const ssh = h.spawned.at(-1);
  ssh.proc.stderr.emit('data', Buffer.from('Permission denied (publickey).'));
  ssh.proc.emit('close', 255);
  const r = await p;
  assert.ok(r.error, 'falha do ssh tem de virar {error}, não {entries: []}');
  assert.equal(r.entries, undefined);
});

test('R1-056: vps:testar confirma acesso e devolve a versão do claude na VPS', async () => {
  const h = loadMain();
  const p = h.call('vps:testar');
  await Promise.resolve(); await Promise.resolve();
  const ssh = h.spawned.at(-1);
  assert.equal(ssh.bin, 'ssh');
  assert.ok(ssh.args.some((a) => /claude --version/.test(a)), 'o teste tem de checar se o claude existe na VPS');
  ssh.proc.stdout.emit('data', Buffer.from('ok\nclaude 1.2.3\n'));
  ssh.proc.emit('close', 0);
  const r = await p;
  assert.equal(r.ok, true);
  assert.equal(r.versao, 'claude 1.2.3');
});

test('R1-056: vps:testar devolve erro quando a VPS não responde', async () => {
  const h = loadMain();
  const p = h.call('vps:testar');
  await Promise.resolve(); await Promise.resolve();
  const ssh = h.spawned.at(-1);
  ssh.proc.stderr.emit('data', Buffer.from('ssh: connect to host vps port 22: Operation timed out'));
  ssh.proc.emit('close', 255);
  const r = await p;
  assert.ok(r.error);
  assert.equal(r.ok, undefined);
});

/* ===================================================================================
   R1-055 — rotinas:disparar chama launchctl kickstart DE VERDADE. As três travas
   (lista negra, nome inválido, plist que reabre o Cockpit) não tinham teste, e o
   robô de WhatsApp de todos os outros robôs (wa-ponte) mora numa delas.
   =================================================================================== */

function launchctlChamado(h) {
  return h.spawned.some((s) => s.bin === '/bin/launchctl' && s.args.includes('kickstart'));
}

test('R1-055: rotina da lista negra (wa-ponte) nunca chama launchctl kickstart', async () => {
  const h = loadMain();
  const r = await h.call('rotinas:disparar', { nome: 'wa-ponte' });
  assert.ok(r.error, 'tem de recusar com erro');
  assert.equal(launchctlChamado(h), false, 'nenhum kickstart pode sair pra essa rotina');
});

test('R1-055: rotina que reabre o próprio Cockpit (com.adsure.cockpit) é recusada', async () => {
  const h = loadMain();
  const r = await h.call('rotinas:disparar', { nome: 'com.adsure.cockpit-push' });
  assert.ok(r.error);
  assert.equal(launchctlChamado(h), false);
});

test('R1-055: nome de rotina com caractere inválido é recusado antes de qualquer spawn', async () => {
  const h = loadMain();
  const r = await h.call('rotinas:disparar', { nome: 'rotina invalida!' });
  assert.equal(r.error, 'nome de rotina inválido');
  assert.equal(h.spawned.length, 0, 'nome ruim não pode nem chegar a olhar o plist ou rodar nada');
});

test('R1-055: rotina não listada, mas cujo plist local reabre o Cockpit.app, é recusada', async () => {
  const h = loadMain();
  h.put(path.join(h.HOME, 'Library/LaunchAgents/com.homero.exemplo.plist'),
    '<plist><string>/Applications/Cockpit.app/Contents/MacOS/Cockpit</string></plist>');
  const r = await h.call('rotinas:disparar', { nome: 'com.homero.exemplo' });
  assert.ok(r.error, 'plist que aponta pro Cockpit.app tem de barrar mesmo fora da lista negra');
  assert.equal(launchctlChamado(h), false);
});

test('R1-055 (controle positivo): rotina liberada dispara o launchctl kickstart de verdade', async () => {
  const h = loadMain();
  const p = h.call('rotinas:disparar', { nome: 'com.homero.robo-liberado' });
  await Promise.resolve(); await Promise.resolve();
  const lc = h.spawned.find((s) => s.bin === '/bin/launchctl');
  assert.ok(lc, 'rotina fora da lista negra e sem plist suspeito tem de chegar a chamar o launchctl');
  assert.ok(lc.args.includes('kickstart') && lc.args.some((a) => a.includes('com.homero.robo-liberado')));
  lc.proc.emit('close', 0);
  const r = await p;
  assert.equal(r.ok, true);
});

/* ===================================================================================
   R1-054 — nada garante que todo `require('./x')` de main.js e dos módulos siga
   coberto pelo array `build.files` do package.json. Esquecer uma entrada aí só
   aparece quando o Homero instala o app empacotado, nunca no `npm test`.
   =================================================================================== */

test('R1-054: todo require local de main.js e dos módulos está coberto por build.files', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(raiz, 'package.json'), 'utf8'));
  const files = pkg.build && pkg.build.files;
  assert.ok(Array.isArray(files) && files.length, 'build.files precisa existir e não pode estar vazio');

  // entradas exatas (sem glob) e os prefixos de glob simples usados no projeto (ex.: "codex-*.js")
  const exatos = new Set();
  const prefixosGlob = [];
  for (const f of files) {
    if (typeof f !== 'string' || f.startsWith('!')) continue; // exclusão não cobre, ignora
    if (f.includes('*')) {
      const i = f.indexOf('*');
      prefixosGlob.push(f.slice(0, i));
    } else {
      exatos.add(f);
    }
  }
  function coberto(arquivoLocal) {
    if (exatos.has(arquivoLocal)) return true;
    return prefixosGlob.some((pre) => arquivoLocal.startsWith(pre));
  }

  // main.js + os módulos que ele importa direto (mesma lista do CONTEXTO da auditoria)
  const raizModulos = ['main.js', 'plataforma.js', 'contas-cli.js', 'acp.js', 'cli-motors.js', 'servidor-web.js', 'codex-protocol.js'];
  const vistos = new Set();
  const faltando = [];
  function varrer(nomeArquivo) {
    if (vistos.has(nomeArquivo)) return;
    vistos.add(nomeArquivo);
    const abs = path.join(raiz, nomeArquivo);
    if (!fs.existsSync(abs)) return; // módulo citado no contexto mas que não existe mais neste ramo
    if (!coberto(nomeArquivo)) faltando.push(nomeArquivo);
    const src = fs.readFileSync(abs, 'utf8');
    for (const m of src.matchAll(/require\(\s*['"]\.\/([^'"]+)['"]\s*\)/g)) {
      let alvo = m[1];
      if (!/\.(js|json|cjs)$/.test(alvo)) alvo += '.js';
      varrer(alvo);
    }
  }
  for (const m of raizModulos) varrer(m);
  assert.deepEqual(faltando, [], 'arquivo(s) local(is) fora de build.files: ' + faltando.join(', '));
});

test('R1-054: o teste realmente pega a quebra (simulação isolada, sem tocar o package.json do projeto)', () => {
  // prova que o teste acima não passa "por engano": tira uma entrada real e confere que falha
  const pkg = JSON.parse(fs.readFileSync(path.join(raiz, 'package.json'), 'utf8'));
  const filesSemPlataforma = pkg.build.files.filter((f) => f !== 'plataforma.js');
  const exatos = new Set(filesSemPlataforma.filter((f) => typeof f === 'string' && !f.startsWith('!') && !f.includes('*')));
  assert.equal(exatos.has('plataforma.js'), false, 'a simulação precisa ter removido a entrada de verdade');
  // main.js faz require('./plataforma'); sem "plataforma.js" na lista, o app empacotado quebraria
  const main = fs.readFileSync(path.join(raiz, 'main.js'), 'utf8');
  assert.match(main, /require\(['"]\.\/plataforma['"]\)/, 'confirma que main.js depende desse módulo');
});
