'use strict';
/* Teste de fumaça do app EMPACOTADO (o que a pessoa instala), rodado no GitHub no Mac e no
   Windows depois do build: abre o app numa pasta de dados vazia, confere que a tela carregou
   e que o terminal de verdade (ptybridge no Mac, ConPTY no Windows) roda um comando.
   Uso: node tests/fumaca-app.cjs <caminho do executável> [pasta para o print] */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const exe = process.argv[2];
const saida = process.argv[3] || os.tmpdir();
const PORTA = 9377;
const espera = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  if (!exe || !fs.existsSync(exe)) throw new Error('executável não encontrado: ' + exe);
  const dados = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-fumaca-'));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = spawn(exe, ['--user-data-dir=' + dados, '--remote-debugging-port=' + PORTA], { env, stdio: 'inherit' });
  let saiu = null; app.on('exit', c => { saiu = c; });
  try {
    let pronto = false;
    for (let i = 0; i < 60 && !pronto; i++) {
      if (saiu !== null) throw new Error('o app fechou sozinho ao abrir (código ' + saiu + ')');
      try { pronto = (await (await fetch('http://127.0.0.1:' + PORTA + '/json')).json()).some(p => p.type === 'page'); } catch {}
      if (!pronto) await espera(1000);
    }
    if (!pronto) throw new Error('a janela do app não apareceu em 60 s');
    const browser = await chromium.connectOverCDP('http://127.0.0.1:' + PORTA);
    const pagina = browser.contexts()[0].pages().find(p => p.url().includes('index.html'));
    const erros = []; pagina.on('pageerror', e => erros.push(e.message));
    await pagina.waitForFunction(() => document.readyState === 'complete' && window.api, null, { timeout: 30000 });
    await espera(3000);
    const tela = await pagina.evaluate(() => ({ titulo: document.title, texto: document.body.innerText.slice(0, 300) }));
    console.log('tela:', JSON.stringify(tela));
    await pagina.screenshot({ path: path.join(saida, 'cockpit-' + process.platform + '.png') });
    if (tela.titulo !== 'Cockpit') throw new Error('título inesperado: ' + tela.titulo);
    if (!/Nova aba|Claude|Codex/.test(tela.texto)) throw new Error('a tela abriu vazia');
    if (process.platform === 'win32' && !tela.texto.includes('Neste computador')) throw new Error('no Windows o botão ainda diz Mac');

    const term = await pagina.evaluate(() => new Promise(resolve => {
      let junto = '';
      window.api.onTermEvent(e => {
        if (e.id !== 'fumaca') return;
        if (e.kind === 'data') junto += e.data;
        if (junto.includes('COCKPIT_OK') || e.kind === 'exit') resolve(junto);
      });
      window.api.termRun({ id: 'fumaca', linha: 'echo COCKPIT_OK', cols: 80, rows: 24 }).then(r => { if (r && r.error) resolve('ERRO: ' + r.error); });
      setTimeout(() => resolve(junto || 'SEM RESPOSTA'), 20000);
    }));
    console.log('terminal:', JSON.stringify(term.slice(0, 300)));
    if (!term.includes('COCKPIT_OK')) throw new Error('o terminal não rodou o comando: ' + term.slice(0, 200));

    if (erros.length) throw new Error('erro na tela: ' + erros.join(' | '));
    await browser.close().catch(() => {});
    console.log('FUMAÇA OK: o app abriu, a tela carregou e o terminal respondeu.');
  } finally {
    try { app.kill(); } catch {}
  }
})().then(() => process.exit(0), e => { console.error('FUMAÇA FALHOU:', e.message); process.exit(1); });
