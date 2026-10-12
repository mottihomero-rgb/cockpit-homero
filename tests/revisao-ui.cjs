'use strict';
const {chromium,webkit,devices}=require('playwright'),fs=require('fs'),path=require('path'),assert=require('assert/strict');
const root=path.resolve(__dirname,'..'),out=process.env.COCKPIT_QA_OUT,fixtures=path.join(out,'Arquivos de teste');
const docs=require('../revisao-arquivos').criar(),ouvintes=new Set(),envios=[],config={defCwd:fixtures,tema:'escuro',autoAtualizarMotores:false};
const mapping=[...fs.readFileSync(path.join(root,'preload.js'),'utf8').matchAll(/(\w+):[^\n]*ipcRenderer\.invoke\('([^']+)'/g)].map(m=>[m[1],m[2]]);
const handlers=Object.fromEntries(mapping.map(([,nome])=>[nome,(_e,arg)=>{
 if(nome==='config:get')return config;if(nome==='sys:home')return '/qa';
 if(nome==='motores:disponiveis')return {claude:true,codex:true,gemini:true,grok:true,acp:true};
 if(nome==='pane:send'){if(recusar){recusar=false;return {error:'Falha de teste no envio'};}envios.push(arg);setTimeout(()=>{for(const ev of [{kind:'busy'},{kind:'text-final',id:'qa'+envios.length,text:'Resposta de teste.'},{kind:'turn-end'}])for(const fn of ouvintes)fn.send(JSON.stringify({tipo:'evento',canal:'pane:event',dados:{paneId:arg.paneId,...ev}}));},40);return {ok:true};}
 if(nome==='conta:ler')return {nome:'Teste',logado:true};if(nome==='uso:ler')return {};
 if(/sessions:|skills:|prompts:ler|contas:listar|codex:models|fs:list|motores:versoes|rotinas:|torre:/.test(nome))return [];
 if(nome==='quadro:rascunhoLer')return null;if(nome==='sessions:titulo'||nome==='sessao:nomeCurto')return '';
 return {ok:true};
}]));
Object.assign(handlers,{'arquivo:revisar':(_e,f)=>docs.abrir(f),'arquivo:revisaoConferir':(_e,o)=>docs.conferir(o),'arquivo:revisaoConteudo':(_e,o)=>docs.conteudo(o)});
const web=require('../servidor-web').criar({pastaRenderer:path.join(root,'renderer'),handlers,ouvintes,porta:0,senha:'qa',somenteTailscale:true});
const results=[];let browser,recusar=false;
async function selecionar(page,tipo){
 await page.evaluate(tipo=>{
  const doc=tipo==='pdf'?document:document.querySelector('.rev-frame').contentDocument;
  const n=tipo==='pdf'?[...doc.querySelectorAll('.textLayer span')].find(n=>n.textContent.includes('Organizamos')): [...doc.querySelectorAll('p')].find(n=>n.textContent.includes('Organizamos'));
  if(!n)throw Error('Texto não encontrado '+tipo);
  const r=doc.createRange();r.selectNodeContents(n);const s=doc.defaultView.getSelection();s.removeAllRanges();s.addRange(r);doc.dispatchEvent(new doc.defaultView.Event('selectionchange')); console.log('Texto selecionado:',String(s),'colapsado',s.isCollapsed,'area',JSON.stringify(r.getBoundingClientRect().toJSON()),'selecao',doc.defaultView.getComputedStyle(n).webkitUserSelect);
 },tipo);
 await page.locator('.rev-ajustar').waitFor({state:'visible',timeout:15000});await page.locator('.rev-ajustar').click();
}
async function comentar(page,pedido){await page.locator('.rev-pedido').fill(pedido);await page.locator('.rev-salvar').click();}
async function abrir(page,file){
 await page.evaluate(file=>{textFinal(focusPane,'qa-arquivo-'+Math.random(),`Entrega: [Abrir arquivo](<${file}>)`);},file);
 await page.locator('.entrega-doc').last().click();
 await page.waitForFunction(()=>!!focusPane.revisorArquivo);
 await page.evaluate(()=>focusPane.revisorArquivo.ready);
 assert.equal(await page.locator('.rev-enviar').isVisible(),false);
}
(async()=>{await web.pronto;
for(const mode of (process.env.COCKPIT_QA_MODE?[process.env.COCKPIT_QA_MODE]:['computador','celular','safari'])){
 const engine=mode==='safari'?webkit:chromium;
 browser=await engine.launch({headless:true,executablePath:mode==='safari'?'/Users/homeromotti/Library/Caches/ms-playwright/webkit-2359/pw_run.sh':'/Users/homeromotti/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell'});
 const context=await browser.newContext(mode==='computador'?{viewport:{width:1440,height:980}}:{...devices['iPhone 13']});const page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')console.log(mode,'console:',m.text());});
 await page.goto('http://127.0.0.1:'+web.servidor.address().port);await page.locator('input[name=s]').fill('qa');await page.locator('button').first().click();await page.locator('#naOk').click();
 for(const [file,tipo] of [['Página para revisar.html','html'],['Documento para revisar.docx','docx'],['Documento antigo para revisar.doc','doc'],['PDF para revisar.pdf','pdf']]){
  console.log('Testando',mode,tipo);const abs=path.join(fixtures,file);await abrir(page,abs); console.log(await page.evaluate(()=>Object.fromEntries(['.visor-cx','.visor-corpo','.rev-root','.rev-frame'].map(s=>{const n=document.querySelector(s),c=n&&getComputedStyle(n);return [s,n&&{width:n.clientWidth,height:n.clientHeight,display:c.display,classes:n.className}];}))));
  if(tipo==='html')assert.equal(await page.evaluate(()=>window.__documentoExecutou),undefined);
  if(tipo==='docx')assert.ok(await page.locator('.rev-frame').contentFrame().locator('table').count());
  if(tipo==='pdf'){assert.ok(await page.locator('.textLayer span').count()>3);assert.ok(await page.locator('.rev-page canvas').first().evaluate(c=>new Set(new Uint32Array(c.getContext('2d').getImageData(0,0,c.width,c.height).data.buffer)).size)>30);}
  await selecionar(page,tipo);await comentar(page,'Trocar este texto por uma explicação mais simples.');
  assert.equal(await page.locator('.rev-enviar').isVisible(),true);
  await page.locator('.rev-modo').filter({hasText:'Marcar área'}).click();
  await page.evaluate(()=>{window.__gestos=[];const d=document.querySelector('.rev-frame')?.contentDocument||document;for(const t of ['pointerdown','pointermove','pointerup','pointercancel'])d.addEventListener(t,e=>window.__gestos.push({t,x:e.clientX,y:e.clientY,target:e.target.tagName,area:d.documentElement.className}));});const palco=await page.locator(tipo==='pdf'?'.rev-page':'.rev-frame').first().boundingBox();
  const x=palco.x+Math.min(100,palco.width*.3),y=palco.y+Math.min(80,palco.height*.25);
  if(mode==='celular'){
   const cdp=await context.newCDPSession(page);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+80,y:y+50,id:1}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();
  }else{await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+80,y+50,{steps:5});await page.mouse.up();}
  console.log('Gestos',await page.evaluate(()=>window.__gestos));await page.locator('.rev-ajustar').waitFor({state:'visible',timeout:8000});await page.locator('.rev-ajustar').click();await comentar(page,'Dar mais destaque para esta área.');
  assert.equal(await page.locator('.rev-item').count(),2);
  assert.equal(await page.locator('.rev-pino').count(),2);assert.equal(await page.locator('.rev-balao').isVisible(),false);
  await page.locator('.rev-pino').nth(1).click();assert.equal(await page.locator('.rev-balao-texto').textContent(),'Dar mais destaque para esta área.');assert.equal(await page.locator('.rev-pino').nth(1).getAttribute('aria-expanded'),'true');
  await page.screenshot({path:path.join(out,'Balão aberto '+mode+' '+tipo+'.png')});
  await page.locator('.rev-pino').nth(1).click();assert.equal(await page.locator('.rev-balao').isVisible(),false);
  if(mode==='computador' && ['docx','pdf'].includes(tipo)){
   const antes=await page.locator('.rev-pino').first().boundingBox();
   await page.evaluate(tipo=>{if(tipo==='pdf')document.querySelector('.rev-palco').scrollTop+=80;else document.querySelector('.rev-frame').contentWindow.scrollBy(0,80);},tipo);
   await page.waitForFunction(y=>Math.abs(document.querySelector('.rev-pino').getBoundingClientRect().top-y)>20,antes.y);
   await page.evaluate(tipo=>{if(tipo==='pdf')document.querySelector('.rev-palco').scrollTop=0;else document.querySelector('.rev-frame').contentWindow.scrollTo(0,0);},tipo);await page.waitForFunction(y=>Math.abs(document.querySelector('.rev-pino').getBoundingClientRect().top-y)<2,antes.y);
  }
  await page.screenshot({path:path.join(out,'Prévia '+mode+' '+tipo+'.png')});
  if(mode==='computador')await page.evaluate(()=>{delete focusPane.revisorArquivo.ajustes[1].ancora;});
  await page.locator('.visor-x:visible').click();await page.locator('.entrega-doc').last().click();await page.waitForFunction(()=>!!focusPane.revisorArquivo);await page.evaluate(()=>focusPane.revisorArquivo.ready);
  assert.equal(await page.locator('.rev-item').count(),2);assert.equal(await page.locator('.rev-pino').count(),2);
  await page.locator('.rev-pino').nth(1).click();assert.equal(await page.locator('.rev-balao-texto').textContent(),'Dar mais destaque para esta área.');await page.locator('.rev-balao-fechar').click();assert.equal(await page.locator('.rev-balao').isVisible(),false);
  if(mode==='computador' && tipo==='html'){
   const longo=('Comentário completo com mais detalhes.\n').repeat(100)+'Fim do comentário.';
   await page.locator('.rev-item-editar').first().click();await page.locator('.rev-pedido').fill(longo);await page.locator('.rev-salvar').click();await page.locator('.rev-pino').first().click();assert.equal(await page.locator('.rev-balao-texto').textContent(),longo);assert.ok(await page.locator('.rev-balao-texto').evaluate(n=>n.scrollHeight>n.clientHeight));await page.locator('.rev-balao-fechar').click();
   await page.locator('.rev-item-editar').first().click();await page.locator('.rev-pedido').fill('Trocar este texto por uma explicação mais simples e curta.');await page.locator('.rev-salvar').click();assert.equal(await page.locator('.rev-item').count(),2);
   await page.locator('.rev-geral').click();await comentar(page,'Nota para remover');await page.locator('.rev-item-remover').last().click();assert.equal(await page.locator('.rev-item').count(),2);
   const original=fs.readFileSync(abs),antesEnvios=envios.length;fs.appendFileSync(abs,'<!-- versão alterada -->');await page.locator('.rev-enviar').click();await page.locator('.rev-dica.rev-erro').waitFor();assert.equal(envios.length,antesEnvios);assert.equal(await page.locator('.rev-item').count(),2);fs.writeFileSync(abs,original);
   await page.locator('.p-input').first().evaluate(n=>{n.value='Rascunho para depois';});recusar=true;await page.locator('.rev-enviar').click();await page.waitForFunction(()=>document.querySelector('.rev-dica.rev-erro')?.textContent.includes('não recebeu os ajustes'));assert.equal(envios.length,antesEnvios);assert.equal(await page.locator('.rev-item').count(),2);assert.equal(await page.locator('.p-input').first().inputValue(),'Rascunho para depois');
  }
  const n=envios.length;await page.locator('.rev-enviar').click();await page.waitForFunction(()=>!document.querySelector('.p-visor:not(.hidden)'));
  assert.equal(envios.length,n+1);assert.ok(envios[n].text.includes('AJUSTE 2'));assert.ok(envios[n].text.includes(abs));assert.ok(envios[n].text.includes('Organizamos'));
  await page.waitForFunction(()=>!focusPane.busy);results.push({mode,tipo,ajustes:2,enviado:true});
 }
 assert.deepEqual(errors,[]);await browser.close();browser=null;
}
fs.writeFileSync(path.join(out,'Teste das prévias.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results));
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{await browser?.close();web.fechar();});
