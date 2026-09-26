'use strict';
// App e layout completos em origem HTTP não segura; arquivos e APIs atendidos por mocks.
// Nenhum socket externo, conta real, motor de IA ou servidor de produção é usado.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..'), renderer = path.join(root, 'renderer');
const mapping = [...fs.readFileSync(path.join(root, 'preload.js'), 'utf8').matchAll(/(\w+):[^\n]*ipcRenderer\.invoke\('([^']+)'/g)].map(m => [m[1], m[2]]);
const callbacks = ['onInbox', 'onTermEvent', 'onPaneEvent', 'onCodexEvent', 'onMenu', 'onErroApp', 'onMotoresAtualizado'];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function resposta(nome) {
  if (nome === 'sys:home') return '/qa';
  if (nome === 'config:get') return { defCwd:'/qa/projeto', tema:'escuro', autoAtualizarMotores:false };
  if (nome === 'motores:disponiveis') return { claude:true, codex:true, gemini:true, grok:true, acp:true };
  if (nome === 'web:estado') return { ligado:false };
  if (nome === 'conta:ler') return { nome:'Teste', email:'teste@example.invalid', logado:true };
  if (nome === 'uso:ler') return {};
  if (nome === 'sessions:titulo' || nome === 'sessao:nomeCurto') return '';
  if (/sessions:|skills:|prompts:ler|contas:listar|codex:models|fs:list|motores:versoes|rotinas:|torre:/.test(nome)) return [];
  if (nome === 'git:status') return { branch:'qa', arquivos:[] };
  if (nome === 'quadro:rascunhoLer') return null;
  if (nome === 'inbox:pasta') return '/qa/inbox';
  return { ok:true };
}
(async () => {
  const browser = await chromium.launch({ headless:true });
  try {
    for (const largura of [1280,390]) {
      const page = await browser.newPage({ viewport:{width:largura,height:850}, isMobile:largura===390, hasTouch:largura===390 });
      const erros=[]; page.on('pageerror', e => erros.push(e.message));
      await page.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.origin !== 'http://192.0.2.1') return route.abort();
        const file = path.resolve(renderer, '.' + decodeURIComponent(url.pathname));
        if (!file.startsWith(renderer + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return route.fulfill({status:404,body:''});
        const tipos={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2'};
        await route.fulfill({contentType:tipos[path.extname(file)] || 'application/octet-stream',body:fs.readFileSync(file)});
      });
      await page.addInitScript(({mapping,callbacks,values}) => {
        window.__qaCalls=[];
        window.api=Object.fromEntries(mapping.map(([name,channel]) => [name,async arg => {
          window.__qaCalls.push({channel,arg});
          if (['pane:start','pane:send','auth:acao'].includes(channel)) throw new Error('Ação real proibida neste teste');
          return values[channel];
        }]));
        callbacks.forEach(name => { window.api[name]=()=>{}; });
      },{mapping,callbacks,values:Object.fromEntries(mapping.map(([,ch]) => [ch,resposta(ch)]))});
      await page.goto('http://192.0.2.1/index.html');
      await page.locator('#naOk').click();
      await page.locator('.p-input').first().waitFor();
      const estado=await page.evaluate(() => {
        const P=focusPane, A=abaDe(P), ids=[P.coluna];
        const Q=newPane({engine:'claude',aba:A}); ids.push(Q.coluna);
        organizarPainel(Q,P,true);
        const empilhou=Q.coluna===P.coluna;
        organizarPainel(Q,P,false); ids.push(Q.coluna);
        const separou=Q.coluna!==P.coluna;
        delete Q.coluna; colunasDaAba(A); ids.push(Q.coluna);
        const B=novaAbaProjeto(A.cwd); moverPane(Q,B); ids.push(Q.coluna);
        window.__qaP=Q;
        window.__qaAcks=[];
        window.api.detalhePerguntar=arg => { window.__qaCalls.push({channel:'detalhe:perguntar',arg}); return new Promise(r=>window.__qaAcks.push(r)); };
        abrirMaisDetalhes(Q,'trecho','resposta');
        const request=window.__qaCalls.filter(c=>c.channel==='detalhe:perguntar').at(-1).arg;
        ids.push(request.requestId);
        return {seguro:isSecureContext,nativo:typeof crypto.randomUUID,ids,empilhou,separou,movido:Q.aid===B.id,ocupado:detalheAberto.ocupado};
      });
      assert.equal(estado.seguro,false); assert.equal(estado.nativo,'undefined');
      assert.ok(estado.empilhou && estado.separou && estado.movido && estado.ocupado);
      estado.ids.forEach(id => assert.match(id,uuid)); assert.equal(new Set(estado.ids).size,estado.ids.length);
      await page.evaluate(()=>__qaAcks[0]({texto:'Detalhe correto em HTTP'}));
      await page.waitForFunction(()=>!detalheAberto.ocupado);
      assert.ok((await page.locator('#maisDetalhes').innerText()).includes('Detalhe correto em HTTP'));
      // Falha antes da chamada: sem fonte aleatória, deve sair de ocupado e aceitar retry.
      await page.evaluate(()=>{
        fecharMaisDetalhes(); window.__qaCrypto=crypto.getRandomValues.bind(crypto);
        crypto.getRandomValues=()=>{throw new Error('Falha simulada no gerador');};
        abrirMaisDetalhes(__qaP,'trecho','resposta');
      });
      await page.waitForFunction(()=>!detalheAberto.ocupado);
      assert.match(await page.locator('.md-erro').innerText(),/Falha simulada no gerador/);
      assert.equal(await page.locator('.md-pensando').count(),0);
      await page.evaluate(()=>{crypto.getRandomValues=window.__qaCrypto;});
      await page.locator('.md-in').fill('Tentar novamente'); await page.locator('.md-in').press('Enter');
      await page.evaluate(()=>__qaAcks[1]({texto:'Retry concluído'}));
      await page.waitForFunction(()=>!detalheAberto.ocupado);
      assert.ok((await page.locator('#maisDetalhes').innerText()).includes('Retry concluído'));
      // Preparação do contexto também está dentro do finally, inclusive com dado legado inválido.
      await page.evaluate(()=>{fecharMaisDetalhes(); __qaP.hist=[null]; abrirMaisDetalhes(__qaP,'trecho','resposta');});
      await page.waitForFunction(()=>!detalheAberto.ocupado);
      assert.equal(await page.locator('.md-erro').count(),1); assert.equal(await page.locator('.md-pensando').count(),0);
      assert.equal(await page.evaluate(()=>detalheAberto.pedido),null);
      assert.deepEqual(erros,[]);
      console.log(`N04 OK ${largura}px: newPane, mover, empilhar/separar, restaurar coluna, detalhes e recuperação após falha, em HTTP real simulado.`);
      await page.close();
    }
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
