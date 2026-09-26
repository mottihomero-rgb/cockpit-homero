'use strict';
// DOM e gestos reais em Chromium isolado. Toda chamada de IA é uma promessa simulada.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const{chromium}=require('playwright');
const app=fs.readFileSync(path.join(__dirname,'../renderer/app.js'),'utf8');
const css=fs.readFileSync(path.join(__dirname,'../renderer/redesign/caixa.css'),'utf8');
function func(nome){const m=new RegExp('^(?:async )?function '+nome+'\\(','m').exec(app);assert.ok(m,nome);const line=app.slice(m.index,app.indexOf('\n',m.index));if(line.endsWith('}'))return line;const t=app.slice(m.index);return t.slice(0,[...t.matchAll(/^}$/mg)][0].index+1);}
const pre=`var $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
var ico=()=>'',marked={parse:s=>s},linkarArquivos=()=>{},botaoResponder=null,detalheAberto=null;
var P={id:'P',aid:'A',engine:'codex',cwd:'/teste',titulo:'Teste',hist:[{quem:'Você',texto:'CONTEXTO_A'}],el:document.querySelector('#P')};
var Q={id:'Q',aid:'B',engine:'claude',cwd:'/outra',hist:[],el:document.querySelector('#Q')};
var A={id:'A',ordem:['P'],ativo:'P',el:document.querySelector('#tabA'),corpoEl:document.querySelector('#spaceA')};
var B={id:'B',ordem:['Q'],ativo:'Q',el:document.querySelector('#tabB'),corpoEl:document.querySelector('#spaceB')};
var panes=new Map([['P',P],['Q',Q]]),abas=new Map([['A',A],['B',B]]),focusPane=P,abaAtiva=A,agPaneAberto=null,guardaTravada=false;
var agTrabalhando=()=>false,vozSoltar=()=>{},pararBuscaDeArquivos=()=>{},soltarNavArquivos=()=>{},abaDe=p=>abas.get(p.aid),guardarAntesDeMexer=()=>{},guardarFechado=()=>{},marcarAbertas=()=>{},avisarQuemEspera=()=>{},loadTree=()=>{},atualizarGit=()=>{},pintarCorFoco=()=>{},shortPath=x=>x,nomeDoMotor=x=>x,savePanes=()=>{},remontarEspaco=()=>{},pintarAba=()=>{},telaNovaAba=()=>{},ativarAbaProjeto=a=>{abaAtiva=a;};
var chamadas=[],cancelados=[],acks=[],laterais=0;var perguntarNoChatLateral=()=>{laterais++;};
window.api={paneStop:async()=>{},detalhePerguntar:o=>{chamadas.push(structuredClone(o));return new Promise(r=>acks.push(r));},detalheCancelar:async o=>{cancelados.push(o.requestId);return{ok:true};}};
`;
const funcs=['novoIdAleatorio','painelAindaAtual','selecaoNaResposta','mostrarBotaoResponder','esconderBotaoResponder','fecharMaisDetalhes','detalheAindaAtual','posicionarMaisDetalhes','abrirMaisDetalhes','citarTrecho','limparCitacao','closePane','fecharAba','invalidarConversa','setFocus'];
const inicio=app.indexOf("document.addEventListener('mouseup', () => setTimeout(mostrarBotaoResponder, 0));"),fim=app.indexOf('/* ---- responder pela torre',inicio);
(async()=>{const browser=await chromium.launch({headless:true});let total=0;
try{
async function page(touch=false){const p=await browser.newPage({viewport:{width:touch?390:1000,height:844},isMobile:touch,hasTouch:touch});
 p.on('pageerror', e => console.error('Erro no Chromium:', e.message));
 await p.route('http://localhost/cockpit-teste', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html></html>' }));
 await p.goto('http://localhost/cockpit-teste');
 await p.setContent('<style>*{box-sizing:border-box}.pane{width:374px;height:750px;position:absolute;left:8px;top:20px}.hidden{display:none}button{font:12px Arial}#Q{left:500px}</style><div id="tbTitle"></div><div id="tabA"></div><div id="tabB"></div><div id="spaceA"><div id="P" class="pane"><div class="msg bot"><div class="msg-body">Resposta de teste com trecho selecionado.</div></div><div class="pane-cmp"><textarea class="p-input"></textarea></div></div></div><div id="spaceB"><div id="Q" class="pane"></div></div>');
 await p.addStyleTag({content:css});await p.addScriptTag({content:pre+funcs.map(func).join('\n')+'\n'+app.slice(inicio,fim)});await p.evaluate(t=>window.SEM_ELECTRON=t,touch);return p;}
async function select(p){await p.evaluate(()=>{const n=document.querySelector('#P .msg-body').firstChild,r=document.createRange();r.setStart(n,0);r.setEnd(n,17);window.getSelection().removeAllRanges();window.getSelection().addRange(r);mostrarBotaoResponder();});}
for(const gesto of ['Enter','Space','mouse','touch']){const p=await page(gesto==='touch');await select(p);const b=p.locator('.sb-op').nth(1);
 if(gesto==='mouse')await b.dblclick();else if(gesto==='touch')await b.tap();else{await b.focus();await p.keyboard.press(gesto);}
 assert.equal(await p.locator('#maisDetalhes').count(),1);assert.equal(await p.evaluate(()=>chamadas.length),1);
 const id=await p.evaluate(()=>chamadas[0].requestId);assert.match(id,/^[A-Za-z0-9_-]{1,120}$/);
 await p.evaluate(()=>fecharMaisDetalhes());assert.deepEqual(await p.evaluate(()=>cancelados),[id]);await p.close();total++;console.log('N02 OK: '+gesto+' ativa uma vez, sem perder seleção.');}
for(const acao of [0,2]){const p=await page();await select(p);await p.locator('.sb-op').nth(acao).focus();await p.keyboard.press(acao?'Space':'Enter');
 if(acao)assert.equal(await p.evaluate(()=>laterais),1);else assert.equal(await p.evaluate(()=>P.citacao),'Resposta de teste');await p.close();total++;}
for(const fechar of ['painel','aba','conversa']){const p=await page();await p.evaluate(()=>abrirMaisDetalhes(P,'trecho','resposta'));
 const id=await p.evaluate(()=>chamadas[0].requestId);
 await p.evaluate(async tipo=>{if(tipo==='painel')await closePane('P',true);else if(tipo==='aba')await fecharAba(A);else invalidarConversa(P);acks[0]({texto:'RESPOSTA_TARDIA'});},fechar);
 await p.waitForTimeout(40);assert.equal(await p.locator('#maisDetalhes').count(),0);assert.deepEqual(await p.evaluate(()=>cancelados),[id]);
 assert.equal(await p.evaluate(()=>!!focusPane&&!panes.has(focusPane.id)),false);assert.equal(await p.evaluate(()=>P.citacao||null),null);await p.close();total++;console.log('N03 OK: fechar '+fechar+' cancela e ignora resposta tardia.');}
{
 const p=await page();await p.evaluate(()=>abrirMaisDetalhes(P,'trecho','resposta'));await p.evaluate(async()=>{await closePane('Q',true);});
 assert.equal(await p.locator('#maisDetalhes').count(),1);assert.equal(await p.evaluate(()=>cancelados.length),0);await p.close();total++;
}
{
 const p=await page();await p.evaluate(()=>{abrirMaisDetalhes(P,'antigo','resposta antiga');abrirMaisDetalhes(P,'novo','resposta nova');acks[0]({texto:'ANTIGO'});acks[1]({texto:'NOVO'});});
 await p.waitForTimeout(10);assert.ok(!(await p.locator('#maisDetalhes').innerText()).includes('ANTIGO'));assert.ok((await p.locator('#maisDetalhes').innerText()).includes('NOVO'));
 assert.equal(await p.evaluate(()=>new Set(chamadas.map(x=>x.requestId)).size),2);assert.equal(await p.evaluate(()=>cancelados[0]===chamadas[0].requestId),true);
 await p.locator('.md-in').fill('Pergunta seguinte');await p.locator('.md-in').press('Enter');
 assert.equal(await p.evaluate(()=>new Set(chamadas.map(x=>x.requestId)).size),3);await p.evaluate(()=>acks[2]({texto:'Explicação final'}));await p.waitForTimeout(10);
 await p.locator('.md-levar').click();assert.equal(await p.evaluate(()=>P.citacao),'Explicação final');assert.equal(await p.evaluate(()=>focusPane===P),true);assert.equal(await p.evaluate(()=>cancelados.length),1);
 await p.close();total++;console.log('N03 OK: popup substituído não é invadido; follow-up tem novo ID; Levar usa dono atual.');
}
{
 const p=await page();await p.evaluate(()=>{abrirMaisDetalhes(P,'trecho','resposta');acks[0]({texto:'Explicação'});});await p.waitForTimeout(10);
 await p.locator('.md-in').fill('x'.repeat(12001));await p.locator('.md-in').press('Enter');assert.equal(await p.evaluate(()=>chamadas.length),1);assert.equal((await p.locator('.md-in').inputValue()).length,12001);
 assert.ok((await p.locator('.md-erro').innerText()).includes('12.000'));await p.close();total++;
}
{
 const p=await page();await select(p);await p.evaluate(()=>{P.hist=[];P.revisaoConversa=1;});await p.locator('.sb-op').nth(1).click();
 assert.equal(await p.evaluate(()=>chamadas.length),0);assert.equal(await p.locator('#maisDetalhes').count(),0);await p.close();total++;
}
console.log(total+' cenários Chromium aprovados.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
