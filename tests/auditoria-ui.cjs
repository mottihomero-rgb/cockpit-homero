'use strict';
// Navegador real, código real da tela e da ponte mobile, motores simulados.
// Não lê contas, não inicia IA, não envia pedidos para serviços externos.
// Uso: COCKPIT_QA_OUT=/pasta/de/evidencias node tests/auditoria-ui.cjs
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { criar } = require('../servidor-web');
const root = path.resolve(__dirname, '..');
const output = process.env.COCKPIT_QA_OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-ui-'));
fs.mkdirSync(output, { recursive: true });
const mapping = [...fs.readFileSync(path.join(root, 'preload.js'), 'utf8').matchAll(/(\w+):[^\n]*ipcRenderer\.invoke\('([^']+)'/g)].map(m => [m[1], m[2]]);
const callbacks = ['onInbox', 'onTermEvent', 'onPaneEvent', 'onCodexEvent', 'onMenu', 'onErroApp', 'onMotoresAtualizado'];
const config = { defCwd: '/qa/projeto', tema: 'escuro', autoAtualizarMotores: false };
const results = [];
let browser, staticServer, mobile;
function respostas(nome) {
  if (nome === 'sys:home') return '/qa';
  if (nome === 'config:get') return structuredClone(config);
  if (nome === 'motores:disponiveis') return { claude: true, codex: true, gemini: true, grok: true, acp: true };
  if (nome === 'web:estado') return { ligado: false };
  if (nome === 'conta:ler') return { nome: 'Conta de teste', email: 'teste@example.invalid', logado: true };
  if (nome === 'uso:ler') return {};
  if (nome === 'sessions:titulo' || nome === 'sessao:nomeCurto') return '';
  if (/sessions:|skills:|prompts:ler|contas:listar|codex:models|fs:list|motores:versoes|rotinas:|torre:/.test(nome)) return [];
  if (nome === 'git:status') return { branch: 'qa', arquivos: [] };
  if (nome === 'quadro:rascunhoLer') return null;
  if (nome === 'inbox:pasta') return '/qa/inbox';
  if (nome === 'anexo:ler') return { path: '/qa/desenho.png', nome: 'desenho.png', tipo: 'image', data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aBf8AAAAASUVORK5CYII=' };
  if (nome === 'quadro:salvar') return { png: '/qa/desenho.png', json: '/qa/desenho.json' };
  return { ok: true };
}
function eventosDoEnvio(arg, emitir) {
  setTimeout(() => {
    emitir({ paneId: arg.paneId, kind: 'busy' });
    emitir({ paneId: arg.paneId, kind: 'text-final', id: 'qa-resposta', text: 'Resposta de teste: ação concluída, com **acentos** e conteúdo preservado.' });
    emitir({ paneId: arg.paneId, kind: 'turn-end' });
  }, 60);
}
async function esperarPintura(page) {
  // A seleção altera a altura da barra mobile. O ResizeObserver redimensiona
  // o canvas, e o desenho volta no frame seguinte. Capturar antes parece vazio.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function desenharRetangulo(page, mobileMode) {
  const ferramenta = page.locator('.qd-fer[data-f=retangulo]');
  if (mobileMode) await ferramenta.tap(); else await ferramenta.click();
  await esperarPintura(page);
  const c = await page.locator('.qd-canvas').boundingBox();
  // As ferramentas flutuam sobre o canto do canvas. Desenhar numa área livre
  // testa o quadro, sem acionar acidentalmente Selecionar em telas pequenas.
  const inicio = { x: c.x + Math.min(160, c.width * .4), y: c.y + Math.min(160, c.height * .4) };
  const fim = { x: inicio.x + 100, y: inicio.y + 70 };
  if (!await page.evaluate(p => document.elementFromPoint(p.x, p.y)?.matches('.qd-canvas'), inicio)) {
    throw new Error('O ponto inicial do desenho está encoberto por outro controle');
  }
  if (mobileMode) {
    // CDP produz eventos touch reais do navegador, incluindo pointer capture.
    // Mouse em viewport estreita não comprova que desenhar com o dedo funciona.
    const session = await page.context().newCDPSession(page);
    try {
      const touch = p => [{ ...p, id: 1, radiusX: 1, radiusY: 1, force: 1 }];
      await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: touch(inicio) });
      for (let i = 1; i <= 8; i++) await session.send('Input.dispatchTouchEvent', {
        type: 'touchMove', touchPoints: touch({ x: inicio.x + (fim.x - inicio.x) * i / 8,
          y: inicio.y + (fim.y - inicio.y) * i / 8 }),
      });
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } finally { await session.detach(); }
  } else {
    await page.mouse.move(inicio.x, inicio.y);
    await page.mouse.down(); await page.mouse.move(fim.x, fim.y, { steps: 8 }); await page.mouse.up();
  }
  await page.waitForFunction(() => document.querySelector('.qd-conta')?.textContent.startsWith('1 peça'));
  await esperarPintura(page);
  const cores = await page.locator('.qd-canvas').evaluate(c => {
    const pixels = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    return new Set(new Uint32Array(pixels.buffer)).size;
  });
  assert.ok(cores > 20, 'O quadro deve estar desenhado, não só com a contagem atualizada.');
  return { gesto: mobileMode ? 'toque' : 'mouse', pecas: 1, coresDesenhadas: cores };
}
async function testarPaleta(page) {
  // Desfazer/refazer limpa a seleção. Reabrir suas ações para provar que o
  // bloco fixo de seleção não cobre as cores e os controles da paleta.
  await page.keyboard.press('Control+a');
  await page.locator('.qd-grupo-sel').waitFor({ state: 'visible' });
  const cores = page.locator('.qd-cor');
  const total = await cores.count();
  for (let i = 0; i < total; i++) {
    // Sem force: exige alvo real, revelado pela rolagem, sem botão sobreposto.
    await cores.nth(i).click({ timeout: 4000 });
    await page.waitForFunction(index => document.querySelectorAll('.qd-cor')[index]?.classList.contains('ativa'), i);
  }
  await page.locator('.qd-fundo').click({ timeout: 4000 });
  await page.waitForFunction(() => document.querySelector('.qd-fundo').classList.contains('ativa'));
  await page.locator('.qd-fundo').click({ timeout: 4000 });
  const antes = await page.locator('.qd-esp-bt').getAttribute('data-esp');
  await page.locator('.qd-esp-bt').click({ timeout: 4000 });
  await page.waitForFunction(valor => document.querySelector('.qd-esp-bt').dataset.esp !== valor, antes);
  const rolagem = await page.locator('.qd-ferramentas').evaluate(el => ({
    horizontal: el.scrollLeft, vertical: el.scrollTop,
    larguraVisivel: el.clientWidth, larguraTotal: el.scrollWidth,
    alturaVisivel: el.clientHeight, alturaTotal: el.scrollHeight,
  }));
  return { coresAcessiveis: total, preenchimento: true, espessura: true, rolagem };
}
async function auditar(page, label, mobileMode) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  if (mobileMode) {
    await page.goto(`http://127.0.0.1:${mobile.servidor.address().port}`);
    await page.locator('input[name=s]').fill('acesso-ficticio-qa');
    await page.locator('button[type=submit], button').first().click();
  } else {
    await page.addInitScript(({ mapping, callbacks, values }) => {
      const observers = {};
      window.__qaCalls = [];
      window.api = Object.fromEntries(mapping.map(([name, channel]) => [name, async arg => {
        window.__qaCalls.push({ channel, arg });
        if (channel === 'pane:send') setTimeout(() => {
          for (const ev of [{ kind: 'busy' }, { kind: 'text-final', id: 'qa-resposta', text: 'Resposta de teste: ação concluída, com **acentos** e conteúdo preservado.' }, { kind: 'turn-end' }]) {
            for (const cb of observers.onPaneEvent || []) cb({ paneId: arg.paneId, ...ev });
          }
        }, 60);
        return values[channel];
      }]));
      for (const name of callbacks) window.api[name] = cb => { (observers[name] ||= []).push(cb); };
    }, { mapping, callbacks, values: Object.fromEntries(mapping.map(([, ch]) => [ch, respostas(ch)])) });
    await page.goto(`http://127.0.0.1:${staticServer.address().port}/index.html`);
  }
  await page.locator('#naOk').waitFor({ state: 'visible' });
  await page.locator('#naOk').click();
  await page.locator('.p-input').first().fill('Teste local de revisão, sem IA real.');
  await page.locator('.p-send').first().click();
  await page.getByText('Resposta de teste:', { exact: false }).first().waitFor();
  assert.equal(await page.locator('.p-input').first().inputValue(), '');
  const dimensions = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
  assert.ok(dimensions.scroll <= dimensions.width + 1, `${label}: conteúdo vazou ${JSON.stringify(dimensions)}`);
  await page.screenshot({ path: path.join(output, label + '.png'), fullPage: true });
  // Abrir o quadro pelo mesmo comando usado pelo atalho, desenhar e desfazer.
  await page.evaluate(() => window.Quadro.abrir(focusPane));
  await page.locator('#qdPainel').waitFor({ state: 'visible' });
  const desenho = await desenharRetangulo(page, mobileMode);
  await page.locator('.qd-desfazer').click();
  await page.waitForFunction(() => document.querySelector('.qd-conta')?.textContent === 'Quadro vazio');
  await page.locator('.qd-refazer').click();
  await page.waitForFunction(() => document.querySelector('.qd-conta')?.textContent.startsWith('1 peça'));
  await esperarPintura(page);
  await page.screenshot({ path: path.join(output, label + '-quadro.png'), fullPage: true });
  const paleta = await testarPaleta(page);
  await esperarPintura(page);
  await page.screenshot({ path: path.join(output, label + '-paleta.png'), fullPage: true });
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => window.Quadro.aberto()), false);
  if (mobileMode) {
    await page.locator('#btnGaveta').click();
    await page.locator('.act[data-view=settings]').click();
    await page.locator('#defCwd').waitFor({ state: 'visible' });
  } else {
    await page.locator('.act[data-view=settings]').click();
    await page.locator('#defCwd').waitFor({ state: 'visible' });
  }
  assert.deepEqual(errors, [], label + ': erros JavaScript');
  results.push({ tela: label, envio: true, resposta: true, quadro: { ...desenho, desfazer: true, refazer: true, paleta },
    ajustes: true, largura: dimensions, erros: errors });
}
(async () => {
  staticServer = http.createServer((req, res) => {
    const requested = decodeURIComponent(req.url.split('?')[0]);
    const file = path.resolve(root, 'renderer', '.' + requested);
    if (!file.startsWith(path.join(root, 'renderer') + path.sep)) { res.writeHead(403).end(); return; }
    const ext = path.extname(file);
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' })[ext] || 'application/octet-stream');
    fs.readFile(file, (err, data) => { if (err) res.writeHead(404).end(); else res.end(data); });
  });
  await new Promise(r => staticServer.listen(0, '127.0.0.1', r));
  const ouvintes = new Set();
  const handlers = Object.fromEntries(mapping.map(([, ch]) => [ch, async (_e, arg) => {
    if (ch === 'pane:send') eventosDoEnvio(arg, ev => { for (const s of ouvintes) s.send(JSON.stringify({ tipo: 'evento', canal: 'pane:event', dados: ev })); });
    return respostas(ch);
  }]));
  mobile = criar({ pastaRenderer: path.join(root, 'renderer'), handlers, ouvintes, porta: 0, senha: 'acesso-ficticio-qa', somenteTailscale: true });
  await mobile.pronto;
  browser = await chromium.launch({ headless: true });
  for (const [label, width, height, mobileMode] of [['desktop', 1440, 900, false], ['celular-390', 390, 844, true], ['celular-414', 414, 896, true], ['tablet', 768, 1024, true]]) {
    const context = await browser.newContext({ viewport: { width, height }, isMobile: mobileMode, hasTouch: mobileMode });
    try { await auditar(await context.newPage(), label, mobileMode); } finally { await context.close(); }
  }
  fs.writeFileSync(path.join(output, 'qa-interface.json'), JSON.stringify({ tipo: 'Navegador real, motores simulados', resultados: results }, null, 2));
  console.log(JSON.stringify(results, null, 2));
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  if (mobile) mobile.fechar();
  if (staticServer) await new Promise(r => staticServer.close(r));
});
