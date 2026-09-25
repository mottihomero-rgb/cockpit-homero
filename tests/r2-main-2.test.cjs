'use strict';

// Testes de guarda da faixa "main" (lote 2), rodada 2 da auditoria (25/09/2026).
// Cada teste falha sem o conserto do defeito e passa com ele. Segue o padrao de
// tests/auditoria-main-20260921.test.cjs (main.js inteiro numa VM, via main-harness.cjs).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { loadMain } = require('./main-harness.cjs');

const tick = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

// ---------------------------------------------------------------------------
// R2-035 — codexHistory() sem teto de tamanho para arquivo .jsonl gigante
// ---------------------------------------------------------------------------
test('R2-035: codexHistory tem o mesmo teto de tamanho que claudeHistory (nao le arquivo gigante inteiro)', async () => {
  const h = loadMain();
  // uma linha valida e reconhecivel, repetida ate passar de 6MB
  const linha = JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'MENSAGEM-MARCADORA' }] } }) + '\n';
  const vezes = Math.ceil((6 * 1024 * 1024 + 1024) / linha.length);
  h.put('/historico/gigante.jsonl', linha.repeat(vezes));
  const items = await h.call('sessions:history', { engine: 'codex', file: '/historico/gigante.jsonl' });
  // sem o teto, fs.readFileSync leria o arquivo inteiro e essas mensagens apareceriam.
  // com o teto, o codigo troca para tailRead (arquivo > 6MB) em vez de ler tudo.
  assert.ok(!items.some(m => m.text === 'MENSAGEM-MARCADORA'), 'leu o arquivo gigante inteiro em vez de usar o teto/tailRead, igual claudeHistory ja faz');
});

// ---------------------------------------------------------------------------
// R2-009 — sessions:history ignorava o arquivo clicado quando havia id
// ---------------------------------------------------------------------------
test('R2-009: sessions:history usa o ARQUIVO clicado (alvo) antes de perguntar ao motor pelo id', async () => {
  const h = loadMain();
  h.attachCodex('local', async () => {
    // se isto for chamado, o defeito voltou: o codigo esta perguntando ao app-server
    // pelo id em vez de ler o arquivo que o usuario clicou
    throw new Error('nao deveria consultar o motor quando ja existe o arquivo clicado (alvo)');
  });
  const conteudoAntigo = JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'CONTEUDO DO ARQUIVO ANTIGO' }] } });
  h.put('/historico/conversa-antiga.jsonl', conteudoAntigo);
  // 'mesmo-id' simula duas conversas (arquivos diferentes) que compartilham o mesmo id de thread
  const items = await h.call('sessions:history', { engine: 'codex', id: 'mesmo-id', file: '/historico/conversa-antiga.jsonl', cwd: '/projeto' });
  assert.equal(items.length, 1);
  assert.equal(items[0].text, 'CONTEUDO DO ARQUIVO ANTIGO');
  assert.equal(h.wire.length, 0, 'chamou o motor (thread/read) apesar de ja ter o arquivo clicado');
});

// ---------------------------------------------------------------------------
// R2-026 — atalho global de ditar nao reabria a janela fechada
// ---------------------------------------------------------------------------
function extrairCallbackAtalho() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const m = src.match(/globalShortcut\.register\(TECLA_DITAR,\s*\(\)\s*=>\s*\{([\s\S]*?)\n {4}\}\);\n {4}if \(!ok\)/);
  assert.ok(m, 'nao achei o callback do atalho global em main.js (mudou de formato?)');
  return m[1];
}

test('R2-026: atalho global recria a janela quando ela foi fechada, e so manda ditar depois do did-finish-load', () => {
  const body = extrairCallbackAtalho();
  const ctx = vm.createContext({});
  vm.runInContext(`
    var win = null;
    var criandoJanelaPeloAtalho = false;
    var createWindowCalls = 0;
    var eventos = [];
    // R3-002: o callback agora arma um timeout de rede extra (ver main.js) — este contexto
    // isolado nao tem setTimeout/clearTimeout do Node, so' precisa nao explodir ao chamar
    function setTimeout() { return 0; }
    function clearTimeout() {}
    function createWindow() {
      createWindowCalls++;
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
    function callback() { ${body} }
  `, ctx, { filename: 'callback-atalho.js' });

  // objeto vem de outro contexto de VM: clonar em JSON pra comparar sem falso negativo de realm
  const eventosAgora = () => JSON.parse(JSON.stringify(ctx.eventos));

  // janela fechada (botao vermelho): o atalho tem que recriar a janela
  ctx.callback();
  assert.equal(ctx.createWindowCalls, 1, 'nao recriou a janela quando ela estava fechada');
  assert.deepEqual(eventosAgora(), [], 'mandou "ditar" antes da tela terminar de carregar');

  // tela termina de carregar: so agora mostra, foca e manda ditar
  ctx.win.webContents._once['did-finish-load']();
  assert.deepEqual(eventosAgora(), ['show', 'focus', ['send', 'menu', 'ditar']], 'nao mostrou/focou/mandou ditar depois do did-finish-load');

  // com a janela ja aberta, apertar de novo so traz pra frente (sem recriar)
  ctx.eventos.length = 0;
  ctx.callback();
  assert.equal(ctx.createWindowCalls, 1);
  assert.deepEqual(eventosAgora(), ['show', 'focus', ['send', 'menu', 'ditar']]);

  // trava contra aperto repetido: enquanto a janela ainda esta sendo criada
  // (criandoJanelaPeloAtalho=true), um segundo aperto NAO pode chamar createWindow de novo
  ctx.win = null;
  ctx.criandoJanelaPeloAtalho = true;
  ctx.callback();
  assert.equal(ctx.createWindowCalls, 1, 'a trava criandoJanelaPeloAtalho nao impediu criar outra janela');
});

// ---------------------------------------------------------------------------
// R2-042 — checagem de navegador aberto via System Events pedia permissao propria
// ---------------------------------------------------------------------------
test('R2-042: "puxar aba do navegador" checa com pgrep, nao com System Events (nao pede permissao extra)', async () => {
  const h = loadMain();
  const p = h.call('navegador:aba', undefined);
  await tick();
  const check = h.spawned.at(-1);
  assert.equal(check.bin, '/usr/bin/pgrep', 'ainda esta checando por outro caminho (osascript/System Events)');
  assert.deepEqual(check.args, ['-x', 'Google Chrome']);
  assert.ok(!JSON.stringify(check.args).includes('System Events'), 'ainda depende do System Events, que pede permissao de Automacao propria');

  check.proc.emit('close', 0); // pgrep achou o processo (Chrome aberto)
  await tick();
  const script = h.spawned.at(-1);
  assert.equal(script.bin, '/usr/bin/osascript');
  script.proc.stdout.emit('data', Buffer.from('https://exemplo.com/pagina\nTitulo da pagina\n'));
  script.proc.emit('close', 0);

  const resultado = await p;
  assert.equal(resultado.url, 'https://exemplo.com/pagina', 'com o Chrome aberto (pgrep achou), tinha que devolver a aba, nao erro de "abra o navegador"');
});

// ---------------------------------------------------------------------------
// R2-043 — "Abrir com cuidado" abria arquivo perigoso se o dialogo falhasse
// ---------------------------------------------------------------------------
test('R2-043: se o dialogo de confirmacao falhar, abrirComCuidado NAO abre o arquivo perigoso', async () => {
  const h = loadMain();
  let abriu = false;
  h.evaluate("dialog.showMessageBox = () => { throw new Error('janela fechou no meio'); }; true");
  h.evaluate("shell.openPath = (p) => { __abriu.push(p); return Promise.resolve(''); }; true");
  h.evaluate('__abriu = []; true');
  const resultado = await h.call('shell:open', '/tmp/script-suspeito.command');
  abriu = h.evaluate('__abriu.length > 0');
  assert.equal(abriu, false, 'abriu o .command mesmo com o dialogo de confirmacao falhando');
  assert.equal(resultado, '', 'nao tratou o dialogo falho como "Cancelar"');
});
