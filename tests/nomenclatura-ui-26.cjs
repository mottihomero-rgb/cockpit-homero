'use strict';
// Interface real isolada; eventos de motor e gerador de nomes são simulados.
// Persistência usa o main real em VM, com disco/processos falsos. Nenhuma IA é iniciada.
const {chromium}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {loadMain}=require('./main-harness.cjs');
const root=path.resolve(__dirname,'..');
const output=process.env.COCKPIT_QA_OUT||fs.mkdtempSync(path.join(require('node:os').tmpdir(),'cockpit-nomes-ui-'));fs.mkdirSync(output,{recursive:true});
const mapping=[...fs.readFileSync(path.join(root,'preload.js'),'utf8').matchAll(/(\w+):[^\n]*ipcRenderer\.invoke\('([^']+)'/g)].map(m=>[m[1],m[2]]);
const callbacks=['onInbox','onTermEvent','onPaneEvent','onCodexEvent','onMenu','onErroApp','onMotoresAtualizado'];
const engines=['claude','codex','gemini','grok'];
const pedido='Analisa os criativos em vídeo do manual do claude lá no meta, ve o melhor em resultados, e cria 3 variações dele com o repo aberto que instalamos hoje kuntos';
const main=loadMain();main.attachCodex();
const names=[],acks=[],calls=[],results=[],errors=[];
let holdAck=true,browser,server;
function sessions(engine){return [{id:'s-'+engine,engine,file:'/qa/'+engine+'.jsonl',cwd:'/qa/projeto',when:Date.now(),title:main.evaluate('lerNomes()')['s-'+engine]||'Faxina do Mac'}];}
async function invoke(ch,arg){
 calls.push({ch,arg});
 if(ch==='sessao:renomear'){
  const result=await main.call(ch,arg);
  if(arg.origem==='auto'&&holdAck&&arg.nome!=='Faxina do Mac')return new Promise(resolve=>acks.push({arg,result,resolve}));
  return result;
 }
 if(ch==='sessao:donoNome')return main.call(ch,arg);
 if(ch==='sessao:nomeCurto')return new Promise(resolve=>names.push({arg,resolve}));
 if(ch==='sys:home')return '/qa';
 if(ch==='config:get')return {defCwd:'/qa/projeto',tema:'escuro',autoAtualizarMotores:false};
 if(ch==='motores:disponiveis')return {claude:true,codex:true,gemini:true,grok:true,acp:true};
 if(ch==='web:estado')return {ligado:false};
 if(ch==='conta:ler')return {nome:'QA',logado:true};
 if(ch==='uso:ler')return {};
 if(ch==='sessions:claude')return sessions('claude');if(ch==='sessions:codex')return sessions('codex');
 if(ch==='sessions:cli')return sessions(typeof arg==='string'?arg:arg.engine);
 if(ch==='sessions:acp')return [];
 if(ch==='sessions:history')return [{role:'user',text:'Funcionando ai?'},{role:'bot',text:'Sim estou funcionando. O Obsidian não conectou...'}];
 if(ch==='ligacoes:ler')return {};
 if(ch==='sessions:titulo')return '';
 if(/sessions:|skills:|prompts:ler|contas:listar|codex:models|fs:list|motores:versoes|rotinas:|torre:/.test(ch))return [];
 if(ch==='git:status')return {branch:'qa',arquivos:[]};
 if(ch==='quadro:rascunhoLer')return null;
 if(ch==='inbox:pasta')return '/qa/inbox';
 return {ok:true};
}
async function aguardar(fn,desc){for(let i=0;i<100;i++){if(fn())return;await new Promise(r=>setTimeout(r,30));}throw Error('Timeout: '+desc);}
(async()=>{
 for(const engine of engines)await main.call('sessao:renomear',{engine,id:'s-'+engine,nome:'Faxina do Mac',origem:'auto'});
 server=http.createServer((req,res)=>{
  const file=path.resolve(root,'renderer','.'+decodeURIComponent(req.url.split('?')[0]));
  if(!file.startsWith(path.join(root,'renderer')+path.sep)){res.writeHead(403).end();return;}
  res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream');
  fs.readFile(file,(e,d)=>e?res.writeHead(404).end():res.end(d));
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));
 browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:900}});
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>{const u=new URL(route.request().url());return u.hostname==='127.0.0.1'?route.continue():route.abort();});
 await page.exposeFunction('__qaInvoke',invoke);
 await page.addInitScript(({mapping,callbacks})=>{
  const observers={};window.__qaEmit=ev=>{for(const f of observers.onPaneEvent||[])f(ev);};
  window.api=Object.fromEntries(mapping.map(([name,ch])=>[name,async arg=>{
   const r=await window.__qaInvoke(ch,arg);
   if(ch==='pane:start')window.__qaEmit({paneId:arg.paneId,kind:'sessao',id:arg.resumeId||'new-session',file:'/qa/'+arg.engine+'.jsonl'});
   if(ch==='pane:send')setTimeout(()=>{
    window.__qaEmit({paneId:arg.paneId,kind:'text-final',id:'qa-'+Date.now(),text:'Analisei os vídeos do Manual do Claude no Meta e preparei três variações do melhor criativo.'});
    window.__qaEmit({paneId:arg.paneId,kind:'turn-end'});
   },60);
   return r;
  }]));for(const name of callbacks)window.api[name]=fn=>(observers[name]||=[]).push(fn);
 },{mapping,callbacks});
 await page.goto('http://127.0.0.1:'+server.address().port+'/index.html');
 await page.locator('#naOk').waitFor({state:'visible'});await page.locator('#naOk').click();
 await page.evaluate(async()=>{for(const engine of ['claude','codex','gemini','grok'])await loadHist(engine,true);});
 if(await page.locator('#sidebar').evaluate(x=>x.classList.contains('hidden')))await page.locator('.act[data-view=conversas]').click();
 for(const engine of engines){
  const id='s-'+engine, before=names.length;
  await page.locator('.hist-item[data-sid="'+id+'"]').click();
  await page.waitForFunction(id=>focusPane?.resumeId===id&&!focusPane.carregandoHistorico,id);
  const paneId=await page.evaluate(()=>focusPane.id);
  // O seletor do painel usa o id nativo; foco é confirmado antes de digitar.
  const input=page.locator('.pane').filter({has:page.locator('.p-input')}).last().locator('.p-input');
  await input.fill(pedido);await input.press('Enter');
  await aguardar(()=>names.length>before,'geração '+engine);
  const req=names.at(-1);assert.equal(req.arg.engine,engine);assert.ok(req.arg.mensagens.includes(pedido));
  const beforeAck=acks.length;req.resolve('Criativos Manual Claude');await aguardar(()=>acks.length>beforeAck,'ACK pendente '+engine);
  assert.equal(await page.evaluate(()=>focusPane.titulo),'Faxina do Mac','não muda antes do ACK');
  acks.at(-1).resolve(acks.at(-1).result);
  await page.waitForFunction(()=>focusPane.titulo==='Criativos Manual Claude');
  assert.equal(await page.locator('.pane').last().locator('.pn-txt').textContent(),'Criativos Manual Claude');
  await page.waitForFunction(id=>document.querySelector('.hist-item[data-sid="'+id+'"] .hi-t')?.textContent==='Criativos Manual Claude',id);
  assert.equal(main.evaluate('lerNomes()')[id],'Criativos Manual Claude');
  await page.screenshot({path:path.join(output,engine+'-corrigido.png'),fullPage:true});
  results.push({engine,titulo:'Criativos Manual Claude',lista:true,persistencia:true,antesAck:'Faxina do Mac'});
 }
 // Novo pedido no Grok enquanto há resposta de título pendente; nome manual via lápis vence.
 const before=names.length;await page.locator('.pane').last().locator('.p-input').fill('Agora ajuste a chamada final do vídeo.');
 await page.locator('.pane').last().locator('.p-input').press('Enter');await aguardar(()=>names.length>before,'geração antes do manual');
 holdAck=false;
 await page.locator('.pane').last().locator('.pn-edit').click();await page.locator('.pn-input').fill('Nome escolhido pelo Homero');await page.locator('.pn-input').press('Enter');
 await page.waitForFunction(()=>focusPane.nomeManual&&focusPane.titulo==='Nome escolhido pelo Homero');
 names.at(-1).resolve('Título automático atrasado');
 await page.waitForFunction(()=>!focusPane.nomeando);
 assert.equal(await page.locator('.pane').last().locator('.pn-txt').textContent(),'Nome escolhido pelo Homero');
 assert.equal(main.evaluate('lerNomes()')['s-grok'],'Nome escolhido pelo Homero');
 await page.waitForFunction(()=>document.querySelector('.hist-item[data-sid="s-grok"] .hi-t')?.textContent==='Nome escolhido pelo Homero');
 await page.screenshot({path:path.join(output,'manual-protegido.png'),fullPage:true});
 assert.deepEqual(errors,[]);assert.equal(main.spawned.length,0);
 fs.writeFileSync(path.join(output,'qa-nomes-ui.json'),JSON.stringify({tipo:'Chromium real; motores e geração simulados; persistência main real com disco falso',resultados:results,manualProtegido:true,erros:errors},null,2));
 console.log(JSON.stringify({resultados:results,manualProtegido:true,erros:errors}));
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();if(server)await new Promise(r=>server.close(r));});
