'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {once}=require('node:events');
const {loadMain}=require('./main-harness.cjs');
const detalhes=require('../mais-detalhes');
function inicio(){const h=loadMain();h.put(h.HOME+'/.local/bin/claude','fake');return h;}
function pedir(h,id='teste',extra={},e=null){return h.call('detalhe:perguntar',{requestId:id,trecho:'Trecho importante',...extra},e);}
function concluir(p,texto){p.proc.stdout.emit('data',Buffer.from(texto));p.proc.emit('close',0);}
async function login(h){concluir(h.spawned.at(-1),JSON.stringify({loggedIn:true,authMethod:'claude.ai',apiProvider:'firstParty',subscriptionType:'max'}));await new Promise(setImmediate);return h.spawned.at(-1);}
function contarKill(p){p.morto=false;p.proc.kill=()=>{p.morto=true;};}

test('cancelar durante auth impede prompt posterior e limpa o registro',async()=>{
 const h=inicio(),r=pedir(h),p=h.spawned[0];contarKill(p);
 assert.equal(h.evaluate('agentesTrabalhando()'),1);
 await h.call('detalhe:cancelar',{requestId:'teste'});
 assert.equal(p.morto,true);assert.equal((await r).cancelado,true);
 concluir(p,JSON.stringify({loggedIn:true,authMethod:'claude.ai'}));await new Promise(setImmediate);
 assert.equal(h.spawned.length,1);assert.equal(h.evaluate('detalhesAtivos.size'),0);
});

test('cancelar prompt fecha processo e resposta tardia não reaparece',async()=>{
 const h=inicio(),r=pedir(h),p=await login(h);contarKill(p);
 await h.call('detalhe:cancelar',{requestId:'teste'});
 assert.equal(p.morto,true);assert.equal((await r).cancelado,true);
 concluir(p,'Resposta tardia');assert.equal(h.evaluate('detalhesAtivos.size'),0);
});

test('shutdown espera grupo tanto durante auth quanto durante pergunta',async()=>{
 for(const fase of ['auth','pergunta']){
  const h=inicio(),r=pedir(h);if(fase==='pergunta')await login(h);
  h.spawned.at(-1).proc.pid=9876;
  h.evaluate('globalThis.sinais=[];process.kill=(pid,sinal)=>sinais.push(sinal)');
  let acabou=false;const saida=h.evaluate('shutdown()').then(()=>{acabou=true});
  await new Promise(setImmediate);assert.equal(acabou,false,fase);
  assert.ok(h.evaluate("sinais.includes('SIGTERM')"));
  for(const fn of [...h.timers.values()])fn();await saida;
  assert.ok(h.evaluate("sinais.includes('SIGKILL')"));assert.equal((await r).cancelado,true);
 }
});

test('id repetido não substitui processo; outra origem não consegue cancelar',async()=>{
 const h=inicio(),e={remoto:true,conexaoId:'A'},r=pedir(h,'id',{},e),p=h.spawned[0];contarKill(p);
 assert.ok((await pedir(h,'id',{},e)).error);assert.equal(h.spawned.length,1);
 await h.call('detalhe:cancelar',{requestId:'id'},{remoto:true,conexaoId:'B'});assert.equal(p.morto,false);
 await h.call('detalhe:cancelar',{requestId:'id'},e);assert.equal((await r).cancelado,true);
});

test('quatro chamadas no máximo e inputs inválidos não iniciam processo',async()=>{
 const h=inicio();
 for(const extra of [{pergunta:'x'.repeat(12001)},{trecho:'x'.repeat(1501)},{conversa:[null]},{janela:Array(129).fill({texto:'x'})}])assert.ok((await pedir(h,'invalido',extra)).error);
 assert.equal(h.spawned.length,0);
 const ativos=Array.from({length:4},(_,i)=>pedir(h,'d'+i));assert.ok((await pedir(h,'d5')).error);assert.equal(h.spawned.length,4);
 await h.evaluate('shutdown()');assert.ok((await Promise.all(ativos)).every(r=>r.cancelado));
});

test('prompt segue em stdin e UTF-8 fragmentado mantém acentos na resposta e erro',async()=>{
 const h=inicio(),r=pedir(h,'utf8',{pergunta:'Pergunta particular'}),p=await login(h);
 assert.ok(!p.args.some(a=>a.includes('Pergunta particular')));assert.ok(p.writes.some(w=>String(w).includes('Pergunta particular')));
 assert.equal(p.options.cwd,h.HOME);assert.deepEqual(Array.from(p.options.stdio),['pipe','pipe','pipe']);
 const b=Buffer.from('Conclusão correta'),i=b.indexOf(Buffer.from('ã'))+1;
 p.proc.stdout.emit('data',b.subarray(0,i));p.proc.stdout.emit('data',b.subarray(i));p.proc.emit('close',0);
 assert.equal((await r).texto,'Conclusão correta');
 const erro=h.evaluate("rodar('fake',[],1000)");const proc=h.spawned.at(-1).proc;
 proc.stderr.emit('data',b.subarray(0,i));proc.stderr.emit('data',b.subarray(i));proc.emit('close',1);assert.equal((await erro).errout,'Conclusão correta');
});

test('ambiente remove billing e conserva OAuth/login; conta API não inicia geração',async()=>{
 const original={PATH:'/bin',CLAUDE_CODE_OAUTH_TOKEN:'oauth-falso',CLAUDE_CONFIG_DIR:'/config-ficticio',ANTHROPIC_API_KEY:'api-falsa',ANTHROPIC_AUTH_TOKEN:'api-falsa',ANTHROPIC_BASE_URL:'https://invalido',ANTHROPIC_CUSTOM_HEADERS:'x-api-key: falsa',CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR:'9',CLAUDE_CODE_USE_BEDROCK:'1',AWS_ACCESS_KEY_ID:'aws-falsa'};
 const env=detalhes.ambienteDoDetalhe(original);
 assert.deepEqual(env,{PATH:'/bin',CLAUDE_CODE_OAUTH_TOKEN:'oauth-falso',CLAUDE_CONFIG_DIR:'/config-ficticio'});assert.equal(original.ANTHROPIC_API_KEY,'api-falsa');
 const h=inicio(),r=pedir(h);concluir(h.spawned[0],JSON.stringify({loggedIn:true,authMethod:'api_key'}));assert.match((await r).error,/assinatura/);assert.equal(h.spawned.length,1);
});

test('auth Claude real: chave Console salva também diz claude.ai e não pode iniciar geração',async()=>{
 const h=inicio(),r=pedir(h);
 const consoleSalvo={loggedIn:true,authMethod:'claude.ai',apiProvider:'firstParty',apiKeySource:'/login managed key',subscriptionType:null};
 concluir(h.spawned[0],JSON.stringify(consoleSalvo));
 assert.match((await r).error,/assinatura/);assert.equal(h.spawned.length,1);assert.equal(h.evaluate('detalhesAtivos.size'),0);
});

test('autenticação exige firstParty sem fonte API e mantém OAuth de assinatura válido',()=>{
 const conta={loggedIn:true,authMethod:'claude.ai',apiProvider:'firstParty',subscriptionType:'max'};
 for(const subscriptionType of ['pro','max','team','enterprise',null])assert.equal(detalhes.contaDeAssinatura({...conta,subscriptionType}),true);
 assert.equal(detalhes.contaDeAssinatura({...conta,apiKeySource:'none'}),true);
 for(const apiKeySource of ['/login managed key','ANTHROPIC_API_KEY','apiKeyHelper','desconhecida'])assert.equal(detalhes.contaDeAssinatura({...conta,apiKeySource}),false);
 for(const apiProvider of ['bedrock','vertex','foundry','gateway',undefined])assert.equal(detalhes.contaDeAssinatura({...conta,apiProvider}),false);
 for(const authMethod of ['api_key','api_key_helper','third_party','none',undefined])assert.equal(detalhes.contaDeAssinatura({...conta,authMethod}),false);
 assert.equal(detalhes.contaDeAssinatura({...conta,loggedIn:false}),false);
 assert.equal(detalhes.contaDeAssinatura(null),false);
});

function ponte(){const sockets=[],timers=new Map();let id=0;class Socket{constructor(){this.readyState=1;this.sent=[];sockets.push(this);}send(s){this.sent.push(JSON.parse(s));}}
 const window={dispatchEvent(){},addEventListener(){}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../renderer/web.js'),'utf8'),{window,WebSocket:Socket,CustomEvent:class{},document:{body:{classList:{add(){},remove(){}}},addEventListener(){}},location:{protocol:'https:',host:'fake',replace(){}},setTimeout(fn,ms){const i=++id;timers.set(i,{fn,ms});return i;},clearTimeout(i){timers.delete(i);}});
 return {api:window.api,ws:sockets[0],timers};}

test('ponte espera além do backend e cancela se exceder prazo de transporte',async()=>{
 const b=ponte(),r=b.api.detalhePerguntar({requestId:'celular',trecho:'x'});
 const erro=assert.rejects(r,/não respondeu/),timer=[...b.timers.values()][0];assert.equal(timer.ms,185000);
 timer.fn();await erro;
 assert.equal(b.ws.sent[1].nome,'detalhe:cancelar');assert.equal(b.ws.sent[1].arg.requestId,'celular');
 const c=ponte(),ok=c.api.detalhePerguntar({requestId:'resposta'});c.ws.onmessage({data:JSON.stringify({tipo:'resposta',id:c.ws.sent[0].id,resposta:{texto:'Chegou aos150s'}})});
 assert.equal((await ok).texto,'Chegou aos150s');assert.equal(c.timers.size,0);
});

test('fechar WebSocket cancela pedido do dono mesmo após tentativa duplicada',async t=>{
 const {criar}=require('../servidor-web'),WebSocket=require('ws');let resolver,iniciou,contextoCancelado,avisarCancelamento;
 const cancelou=new Promise(r=>{avisarCancelamento=r});
 const inicio=new Promise(r=>{iniciou=r});const chamadas=[];
 const s=criar({pastaRenderer:path.join(__dirname,'../renderer'),porta:0,senha:'teste',somenteTailscale:true,ouvintes:new Set(),handlers:{
 'detalhe:perguntar':(e)=>{chamadas.push(e);if(chamadas.length>1)return {error:'duplicado'};iniciou();return new Promise(r=>{resolver=r});},
 'detalhe:cancelar':(e)=>{contextoCancelado=e;resolver({cancelado:true});avisarCancelamento();return {ok:true};}}});
 t.after(()=>s.fechar());await s.pronto;const url='http://127.0.0.1:'+s.servidor.address().port;
 const login=await fetch(url+'/entrar',{method:'POST',redirect:'manual',body:new URLSearchParams({s:'teste'})});const cookie=login.headers.get('set-cookie').split(';')[0];
 const ws=new WebSocket(url.replace('http:','ws:')+'/ws',{headers:{Origin:url,Cookie:cookie}});t.after(()=>ws.terminate());await once(ws,'open');
 const enviar=id=>ws.send(JSON.stringify({tipo:'chamada',id,nome:'detalhe:perguntar',arg:{requestId:'mesmo'}}));enviar(1);await inicio;
 const repetido=once(ws,'message');enviar(2);await repetido;
 ws.close();await once(ws,'close');
 let limite;try{await Promise.race([cancelou,new Promise((_,no)=>{limite=setTimeout(()=>no(new Error('Não cancelou ao fechar socket')),1000);})]);}finally{clearTimeout(limite);}
 assert.ok(contextoCancelado);assert.equal(contextoCancelado.conexaoId,chamadas[0].conexaoId);
});
