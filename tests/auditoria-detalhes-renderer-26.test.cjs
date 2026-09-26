'use strict';
// Funções reais, APIs simuladas. Nunca inicia motor nem altera conta/arquivo do usuário.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const assert=require('node:assert/strict'),test=require('node:test');
const app=fs.readFileSync(path.join(__dirname,'../renderer/app.js'),'utf8');
function func(nome){const m=new RegExp('^(?:async )?function '+nome+'\\(','m').exec(app);assert.ok(m,nome);const line=app.slice(m.index,app.indexOf('\n',m.index));if(line.endsWith('}'))return line;const t=app.slice(m.index);return t.slice(0,[...t.matchAll(/^}$/mg)][0].index+1);}
const noop=()=>{};
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};}
function contexto(engine='codex',id='original'){
 const A={id:'aba-a',cwd:'/cliente-a'},B={id:'aba-b',cwd:'/cliente-b'},abas=new Map([[A.id,A],[B.id,B]]),panes=new Map(),criados=[],focus=[];
 const input=()=>({value:'',dispatchEvent:noop,focus:noop,setSelectionRange:noop});
 const P={id:'p',aid:A.id,engine,cwd:'/cliente-a/subpasta',sessaoId:id,titulo:'Origem',hist:[{quem:'Você',texto:'Pedido original'}]};panes.set(P.id,P);
 const ack=deferred();let forks=0,seq=0;
 const c=vm.createContext({panes,abas,abaAtiva:A,NA_VPS:p=>String(p||'').startsWith('vps:'),abaDe:p=>abas.get(p.aid),Event:class{},
  window:{api:{sessaoFork:()=>{forks++;return ack.promise;}}},$:(_s,e)=>e.input,
  novoChatNaAba:(e,aba)=>{const q={id:'novo'+(++seq),aid:(aba||c.abaAtiva).id,engine:e,el:{input:input()},hist:[]};panes.set(q.id,q);criados.push(q);return q;},
  pintarPasta:noop,nomePasta:x=>x,pintarNome:noop,faixaDeRamo:noop,savePanes:noop,note:noop,avisoTemp:noop,setFocus:q=>focus.push(q.id)});
 vm.runInContext(['painelAindaAtual','perguntarNoChatLateral','ramificarInteiro','forkClaude','abrirRamo','ramoDeReserva','ramificarDaqui'].map(func).join('\n'),c);
 return{c,P,A,B,panes,abas,criados,focus,ack,input,forks:()=>forks};
}
test('N01: fork atrasado retorna ramo exato na aba original e preserva título/rascunho do outro chat',async()=>{
 const h=contexto(),{c,P,A,B,panes,ack}=h;const promise=c.perguntarNoChatLateral(P,'TRECHO_A');
 c.abaAtiva=B;const outro={id:'outro',aid:B.id,titulo:'Cliente B',el:{input:h.input()}};outro.el.input.value='Rascunho importante';panes.set(outro.id,outro);
 P.titulo='Título automático posterior';ack.resolve({id:'fork-certo'});await promise;
 const Q=h.criados[0];assert.equal(Q.resumeId,'fork-certo');assert.equal(Q.aid,A.id);assert.equal(Q.cwd,'/cliente-a/subpasta');
 assert.equal(Q.titulo,'Lateral: Origem');assert.match(Q.el.input.value,/TRECHO_A/);
 assert.equal(outro.titulo,'Cliente B');assert.equal(outro.el.input.value,'Rascunho importante');assert.deepEqual(h.focus,[Q.id]);
});
for(const motivo of ['fechou painel','fechou aba','mudou conversa'])test('N01: conclusão tardia não cria painel quando '+motivo,async()=>{
 const h=contexto();const promise=h.c.perguntarNoChatLateral(h.P,'trecho antigo');
 if(motivo==='fechou painel')h.panes.delete(h.P.id);
 else if(motivo==='fechou aba')h.abas.delete(h.A.id);
 else h.P.revisaoConversa=1;
 h.ack.resolve({id:'fork-tardio'});await promise;assert.equal(h.criados.length,0);assert.equal(h.focus.length,0);
});
for(const engine of ['claude','codex','gemini'])test('N01: variante '+engine+' devolve o próprio painel ao chamador',async()=>{
 const h=contexto(engine,engine==='gemini'?null:'original');const promise=h.c.ramificarInteiro(h.P);
 if(engine==='codex')h.ack.resolve({id:'fork-novo'});
 const Q=await promise;assert.equal(Q,h.criados[0]);assert.equal(Q.aid,h.A.id);
 if(engine==='claude'){assert.equal(Q.forkPendente,true);assert.equal(Q.resumeId,'original');}
 if(engine==='gemini')assert.match(Q.passarContexto,/Pedido original/);
});
test('N01: erro do fork usa reserva da origem capturada, mesmo com outra aba ativa',async()=>{
 const h=contexto();const promise=h.c.ramificarInteiro(h.P);h.c.abaAtiva=h.B;h.P.hist.push({quem:'Você',texto:'Mensagem depois do clique'});
 h.ack.resolve({error:'sem suporte'});const Q=await promise;
 assert.equal(Q.aid,h.A.id);assert.match(Q.passarContexto,/Pedido original/);assert.ok(!Q.passarContexto.includes('Mensagem depois do clique'));
});
test('N01: novoChatNaAba real encaminha aba explícita para newPane, nunca a aba ativa concorrente',()=>{
 const A={id:'a',cwd:'/a'},B={id:'b',cwd:'/b'},chamadas=[];
 const c=vm.createContext({abas:new Map([['a',A],['b',B]]),abaAtiva:B,focusPane:null,cfg:{},motorVisivel:e=>e,motorIndisponivelNaPasta:()=>'',
  newPane:o=>{chamadas.push(o);return{id:'q',el:{}};},avisarInstalacaoMotor:noop,igualarChats:noop,setTimeout:noop});
 vm.runInContext(func('novoChatNaAba'),c);assert.equal(c.novoChatNaAba('codex',A).id,'q');assert.equal(chamadas[0].aba,A);
 c.abas.delete('a');assert.equal(c.novoChatNaAba('codex',A),undefined);assert.equal(chamadas.length,1);
});

test('N04: fallback UUID usa 16 bytes fortes com versão e variante RFC, sem Math.random',()=>{
 const c=vm.createContext({crypto:{getRandomValues:bytes=>{bytes.fill(255);return bytes;}},Math:{random:()=>{throw new Error('fonte fraca');}}});
 vm.runInContext(func('novoIdAleatorio'),c);
 assert.equal(c.novoIdAleatorio(),'ffffffff-ffff-4fff-bfff-ffffffffffff');
});
test('N04: UUID nativo mantém receptor Crypto e ausência de aleatoriedade falha explicitamente',()=>{
 const crypto={randomUUID(){assert.equal(this,crypto);return 'uuid-nativo';}};
 const c=vm.createContext({crypto}); vm.runInContext(func('novoIdAleatorio'),c);
 assert.equal(c.novoIdAleatorio(),'uuid-nativo'); c.crypto={};
 assert.throws(()=>c.novoIdAleatorio(),/Gerador seguro/);
});
