'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const app=fs.readFileSync(path.join(__dirname,'../renderer/app.js'),'utf8');
const noop=()=>{},tick=()=>new Promise(r=>setImmediate(r));
function func(n){const m=new RegExp('^(?:async )?function '+n+'\\(','m').exec(app);assert.ok(m,n);const linha=app.slice(m.index,app.indexOf('\n',m.index));return linha.endsWith('}')?linha:app.slice(m.index,app.indexOf('\n}',m.index)+2);}
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};}
const nomes=['mensagensDele','materialDoNome','proximoMarcoNome','conversaDoNomeAtual','nomearCurto','nomearNoFimDoTurno','assumirNome','lembrarDonoDoNome','salvarNomeCurto','buscarNome'];
function harness(){
 const calls=[],writes=[],cache=[],panes=new Map();
 const c=vm.createContext({panes,pintarNome:noop,savePanes:noop,lateralAberta:()=>false,loadHist:noop,lembrarNomeDaParte:(p,n)=>cache.push({id:p.id,n}),window:{api:{
  nomeCurto:o=>{const d=deferred();calls.push({o,d});return d.promise;},renomear:async o=>{writes.push(o);return true;},donoNome:async()=> 'ia'
 }}});vm.runInContext(['painelAindaAtual',...nomes].map(func).join('\n'),c);
 function panel(n=1){const hist=Array.from({length:n},(_,i)=>({quem:'Você',texto:'Pedido anterior '+i}));hist.push({quem:'Claude',texto:'Resposta'});const P={id:'p'+panes.size,engine:'claude',sessaoId:'S',cwd:'/qa',hist,titulo:'Faxina do Mac',nomeDono:hist,nomeCurto:true,nomeMarco:n,revisaoConversa:0};panes.set(P.id,P);return P;}
 return{c,calls,writes,cache,panes,panel};
}
function pedido(P,texto='Crie três variações de criativos do Manual Claude para Meta'){P.hist.push({quem:'Você',texto},{quem:'Claude',texto:'Criativos entregues'});}
test('pedido16 recebe nome correto no próprio turno, sem esperar20/25 ou confirmação',async()=>{
 const h=harness(),P=h.panel(15);pedido(P);const p=h.c.nomearNoFimDoTurno(P);assert.equal(h.calls.length,1);h.calls[0].d.resolve('Criativos Manual Claude');await p;
 assert.equal(P.titulo,'Criativos Manual Claude');assert.equal(P.nomeMarco,16);assert.equal(h.writes.length,1);
});
test('reabrir com nomeAuto simples continua no próximo pedido, sem pendência perdida',async()=>{
 const h=harness(),P=h.panel(20);P.nomeMarco=20;pedido(P);const p=h.c.nomearNoFimDoTurno(P);h.calls[0].d.resolve('Criativos Manual Claude');await p;assert.equal(P.titulo,'Criativos Manual Claude');
});
test('falha não consome revisão, saudação sem nome mantém provisório sem ler aiTitle',async()=>{
 const h=harness(),P=h.panel(1);pedido(P);let reservas=0;h.c.window.api.sessionTitulo=async()=>{reservas++;return'Funcionando ai';};
 const p=h.c.nomearNoFimDoTurno(P);h.calls[0].d.resolve('');await p;assert.equal(P.nomeMarco,1);assert.equal(reservas,0);assert.equal(P.titulo,'Faxina do Mac');
 const retry=h.c.nomearNoFimDoTurno(P);assert.equal(h.calls.length,2);h.calls[1].d.resolve('Criativos Manual Claude');await retry;assert.equal(P.titulo,'Criativos Manual Claude');
});
test('novo pedido durante geração descarta título antigo e consolida uma revisão atual',async()=>{
 const h=harness(),P=h.panel();pedido(P,'Faça a página do Pedro');const primeira=h.c.nomearNoFimDoTurno(P);pedido(P);h.c.nomearNoFimDoTurno(P);h.calls[0].d.resolve('Página Pedro');await tick();
 assert.equal(P.titulo,'Faxina do Mac');assert.equal(h.writes.length,0);assert.equal(h.calls.length,2);h.calls[1].d.resolve('Criativos Manual Claude');await primeira;assert.equal(P.titulo,'Criativos Manual Claude');
});
for(const alteracao of ['id','engine','revisao','hist','fechou'])test('resposta atrasada ignorada depois de mudar '+alteracao,async()=>{
 const h=harness(),P=h.panel();pedido(P);const p=h.c.nomearNoFimDoTurno(P);
 if(alteracao==='id')P.sessaoId='OUTRA';if(alteracao==='engine')P.engine='codex';if(alteracao==='revisao')P.revisaoConversa++;if(alteracao==='hist')P.hist=[...P.hist];if(alteracao==='fechou')h.panes.delete(P.id);
 h.calls[0].d.resolve('Nome atrasado');await p;assert.equal(P.titulo,'Faxina do Mac');assert.equal(h.writes.length,0);
});
test('título/caches só mudam com ACK; falha deixa nome anterior e próxima revisão disponível',async()=>{
 const h=harness(),P=h.panel();pedido(P);const ack=deferred();h.c.window.api.renomear=o=>{h.writes.push(o);return ack.promise;};
 const p=h.c.nomearNoFimDoTurno(P);h.calls[0].d.resolve('Criativos Manual Claude');await tick();assert.equal(P.titulo,'Faxina do Mac');assert.equal(h.cache.length,0);
 ack.resolve({ok:false,error:'disco indisponível'});await p;assert.equal(P.titulo,'Faxina do Mac');assert.equal(P.nomeMarco,1);assert.equal(h.cache.length,0);
});
test('conflito manual adota nome humano e nenhum resultado posterior o sobrescreve',async()=>{
 const h=harness(),P=h.panel();pedido(P);h.c.window.api.renomear=async()=>({ok:false,conflito:true,nome:'Título do Homero',origem:'manual'});
 const p=h.c.nomearNoFimDoTurno(P);h.calls[0].d.resolve('Nome automático');await p;assert.equal(P.titulo,'Título do Homero');assert.equal(P.nomeManual,true);pedido(P);await h.c.nomearNoFimDoTurno(P);assert.equal(h.calls.length,1);
});
test('duas janelas: criação desconhecida usa CAS vazio e conflito adota nome automático já salvo',async()=>{
 const h=harness(),P=h.panel();pedido(P);h.c.window.api.renomear=async o=>{h.writes.push(o);return{ok:false,conflito:true,nome:'Nome da outra janela',origem:'auto'};};
 const p=h.c.nomearNoFimDoTurno(P);h.calls[0].d.resolve('Nome antigo desta janela');await p;assert.equal(h.writes[0].anterior,'');assert.equal(P.titulo,'Nome da outra janela');assert.equal(P.nomePersistido.nome,'Nome da outra janela');
});
test('novo pedido durante ACK não pinta nome desatualizado e próxima gravação usa baseline confirmado',async()=>{
 const h=harness(),P=h.panel(),ack=deferred();pedido(P);h.c.window.api.renomear=o=>{h.writes.push(o);return h.writes.length===1?ack.promise:Promise.resolve(true);};
 const p=h.c.nomearNoFimDoTurno(P);h.calls[0].d.resolve('Primeiro trabalho');await tick();pedido(P,'Agora faça a página do Pedro');h.c.nomearNoFimDoTurno(P);ack.resolve(true);await tick();
 assert.equal(P.titulo,'Faxina do Mac');assert.equal(P.nomePersistido.nome,'Primeiro trabalho');h.calls[1].d.resolve('Página Pedro');await p;
 assert.equal(P.titulo,'Página Pedro');assert.equal(h.writes[1].anterior,'Primeiro trabalho');
});
test('isMeta/is_meta nunca contam como pedidos; fala longa conserva a demanda no fim',()=>{
 const h=harness(),P=h.panel(0);P.hist=[{quem:'Você',texto:'oi'},{quem:'Você',texto:'x'.repeat(6000)+' Crie criativos do Manual Claude para Meta'},{quem:'Você',texto:'SKILL INJETADA',isMeta:true},{quem:'Você',texto:'OUTRA SKILL',is_meta:true},null];
 const m=h.c.materialDoNome(P);assert.equal(m.total,2);assert.equal(m.mensagens.length,2);assert.match(m.mensagens[1],/Crie criativos do Manual Claude para Meta$/);assert.ok(m.mensagens[1].length<=3000);
});
test('restaurar histórico preserva flag meta para nomeação sem alterar texto da bolha',()=>{
 const h=harness(),P=h.panel(0);h.c.userMsg=(p,t)=>p.hist.push({quem:'Você',texto:t});vm.runInContext(func('renderizarHistorico'),h.c);
 h.c.renderizarHistorico(P,{role:'user',text:'SKILL',isMeta:true});h.c.renderizarHistorico(P,{role:'user',text:'PEDIDO'});
 assert.equal(P.hist.at(-2).texto,'SKILL');assert.equal(h.c.mensagensDele(P).length,1);assert.equal(h.c.mensagensDele(P)[0],'PEDIDO');
});
for(const totalPartes of [1,2])test('abrir histórico com '+totalPartes+' parte(s) descobre dono e permite atualizar no próximo pedido',async()=>{
 const h=harness(),c=h.c;let donoConsultas=0;
 Object.assign(c,{NA_VPS:()=>false,focusPane:null,document:{querySelectorAll:()=>[],body:{classList:{remove:noop}}},$:()=>({focus:noop}),$$:()=>[],abaDoCaminho:()=>({id:'A'}),partesDaCadeia:s=>[s],refDaParte:s=>s,
 newPane:o=>{const P=h.panel(0);P.engine=o.engine;P.sessaoId=null;P.nomeDono=null;P.blocks=new Map();P.tools=new Map();P.chat={};P.el={};return P;},invalidarConversa:P=>P.revisaoConversa++,escondePerm:noop,limparPlano:noop,limparSugestoes:noop,fillModels:noop,paintEngine:noop,setDot:noop,pintarPasta:noop,nomePasta:x=>x,mostrarPastaNoPainel:noop,atualizarGit:noop,pintarModo:noop,setFocus:noop,marcarAbertas:noop,note:noop,somarTempoDoHistorico:noop,scroll:noop,
 lerPartes:async partes=>partes.map(parte=>({parte,msgs:[{quem:'Você',texto:'Demanda'}]})),desenharPartes:(P,lidas)=>{P.hist.push(...lidas.flatMap(x=>x.msgs));return P.hist.length;},renderizarHistorico:(P,m)=>P.hist.push(m)});
 c.window.api.sessionHistory=async()=>[{quem:'Você',texto:'Demanda'}];c.window.api.donoNome=async()=>{donoConsultas++;return'ia';};vm.runInContext(func('openSession'),c);
 const partes=Array.from({length:totalPartes},(_,i)=>({id:'S'+i,engine:i?'codex':'claude',cwd:'/qa'}));const P=await c.openSession({...partes.at(-1),title:'Faxina do Mac',partes},null);await tick();pedido(P);const promise=c.nomearNoFimDoTurno(P);
 assert.equal(donoConsultas,1);assert.equal(h.calls.length,1);h.calls[0].d.resolve('Criativos Manual Claude');await promise;assert.equal(P.titulo,'Criativos Manual Claude');
});
for(const manual of [false,true])test('restauração real: '+(manual?'nome humano fica protegido':'primeiro pedido atualiza título automático com CAS salvo'),async()=>{
 const h=harness(),c=h.c,abas=new Map();let restaurado;
 Object.assign(c,{console,abas,HOME:'/qa',cfg:{abaAberta:0},clienteQueEstavaAberto:'',abasQueNaoVoltaram:[],NA_VPS:()=>false,
 novaAbaProjeto:cwd=>{const A={id:'A',cwd,ordem:[]};abas.set(A.id,A);return A;},
 newPane:o=>{const P=h.panel(0);P.hist=[];P.nomeDono=null;P.nomeCurto=false;P.nomeMarco=0;P.sessaoId=null;P.titulo=o.titulo;P.engine=o.engine;P.aid=o.aba.id;P.cwd=o.cwd;P.el={};P.chat={};o.aba.ordem.push(P.id);restaurado=P;return P;},
 partesDaCadeia:r=>[r],ativarAbaProjeto:noop,note:noop,somarTempoDoHistorico:noop,renderizarHistorico:(P,m)=>P.hist.push(m),$:()=>null,$$:()=>[],clearEmpty:noop,scroll:noop});
 c.window.api.sessionHistory=async()=>[{quem:'Você',texto:'Limpe o Mac'},{quem:'Claude',texto:'Pronto'}];
 c.window.api.renomear=async o=>{h.writes.push(o);assert.equal(o.anterior,'Faxina do Mac');return true;};
 vm.runInContext(func('restaurarAbasCorpo'),c);
 const chats=[{engine:'claude',sessao:'S',titulo:'Faxina do Mac',nomeManual:manual,nomeAuto:manual?undefined:{marco:1,curto:true}}];
 assert.equal(await c.restaurarAbasCorpo([{cwd:'/qa',chats}]),1);pedido(restaurado);const p=c.nomearNoFimDoTurno(restaurado);
 if(manual){assert.equal(h.calls.length,0);assert.equal(restaurado.titulo,'Faxina do Mac');}
 else{assert.equal(h.calls.length,1);h.calls[0].d.resolve('Criativos Manual Claude');await p;assert.equal(restaurado.titulo,'Criativos Manual Claude');assert.equal(h.writes.length,1);}
});
