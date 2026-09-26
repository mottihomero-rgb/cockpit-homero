'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadMain } = require('./main-harness.cjs');

function prepararLeitura(h) {
  h.evaluate(`
    globalThis.setImmediate = (fn) => Promise.resolve().then(fn);
    const abertos = new Map(); let fd = 10;
    fs.openSync = (nome) => { const id = fd++; abertos.set(id, fs.readFileSync(nome)); return id; };
    fs.fstatSync = (id) => ({ size: abertos.get(id).length });
    fs.readSync = (id, buf, off, len, pos) => {
      const b = abertos.get(id), n = Math.max(0, Math.min(len, b.length-pos));
      b.copy(buf, off, pos, pos+n); return n;
    };
    fs.closeSync = (id) => abertos.delete(id);
  `);
  return h;
}

test('busca deve encontrar pedido real depois das instruções técnicas do Codex', async () => {
  const h = prepararLeitura(loadMain());
  const file = h.HOME + '/codex.jsonl';
  h.put(file, [
    {type:'response_item',payload:{type:'message',role:'developer',content:[{type:'input_text',text:'Instruções técnicas '.repeat(1000)}]}},
    {type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:'Corrigir checkout do produto Pedro'}]}},
    {type:'response_item',payload:{type:'message',role:'assistant',content:[{type:'output_text',text:'Corrigi o checkout.'}]}},
  ].map(JSON.stringify).join('\n'));
  const result = await h.call('sessions:buscar',{engine:'codex',termo:'checkout',itens:[{id:'C1',file}]});
  assert.equal(result.achados.length,1,'a instrução técnica não deve ocupar todo o índice');
});

test('saída do pai não pode liberar app.exit enquanto descendente do grupo segue vivo', async () => {
  const h = loadMain();
  await h.call('pane:start',{paneId:'p1',engine:'claude',cwd:h.HOME});
  h.spawned.at(-1).proc.pid=4321;
  h.evaluate(`
    globalThis.__filhoVivo = true; globalThis.__saiu = false;
    process.kill = (pid, signal) => { if(signal === 'SIGKILL') __filhoVivo = false; };
    app.exit = () => { __saiu = true; };
  `);
  h.appEvents.get('before-quit')({preventDefault(){}});
  h.spawned.at(-1).proc.emit('exit',0,null);
  await new Promise(setImmediate);
  assert.equal(h.evaluate('__saiu && __filhoVivo'),false,'Electron sai antes do SIGKILL obrigatório do grupo');
});

test('costura antiga não pode preferir conversa errada por resposta genérica', () => {
  const h=loadMain();
  const result=h.evaluate(`acharParteAntiga(
    {engine:'codex',id:'novo',cwd:'/cliente',nasceu:1000000},
    {motor:'claude',fala:'Corrija a página de vendas do Produto Azul',resposta:'Vou verificar os arquivos e fazer os ajustes.'},
    [
      {engine:'claude',id:'outra',file:'/outra.jsonl',cwd:'/cliente',when:999000},
      {engine:'claude',id:'certa',file:'/certa.jsonl',cwd:'/cliente',when:998000}
    ],
    s => s.id === 'outra' ? JSON.stringify({content:'Pedido de outro produto. Vou verificar os arquivos e fazer os ajustes.'})
      : JSON.stringify({content:'Corrija a página de vendas do Produto Azul'})
  )`);
  assert.equal(result.id,'certa','resposta genérica vence evidência do pedido real');
});

test('renomear deve indicar falha quando a gravação não acontece', async () => {
  const h=loadMain();
  h.evaluate("fs.writeFileSync = () => { throw new Error('ENOSPC'); };");
  const result=await h.call('sessao:renomear',{engine:'claude',id:'c1',nome:'Nome que não foi salvo',origem:'manual'});
  assert.notEqual(result,true,'nome não existe no disco mas handler confirma sucesso');
});

test('reiniciar Claude deve descartar pergunta e plano do processo antigo', async () => {
  const h=loadMain();
  await h.call('pane:start',{paneId:'p1',engine:'claude',cwd:h.HOME});
  h.evaluate(`claudeMessage('p1',{type:'control_request',request_id:'velho',request:{subtype:'can_use_tool',tool_name:'AskUserQuestion',input:{questions:[{question:'Qual cliente?',options:[]}]}}});`);
  const velha = h.paneEvents('perguntas').at(-1).key;
  await h.call('pane:stop',{paneId:'p1',engine:'claude'});
  await h.call('pane:start',{paneId:'p1',engine:'claude',cwd:h.HOME});
  const novo=h.spawned.at(-1), antes=novo.writes.length;
  const estado=h.call('pane:estado',{paneId:'p1'});
  await h.call('pane:perguntas',{paneId:'p1',key:velha,answers:{'Qual cliente?':'Pedro'}});
  assert.equal(novo.writes.length,antes,'resposta a reqId velho não pode ir para o processo novo');
  assert.equal(estado.aprovacao,null,'reconexão não pode reapresentar pergunta de processo morto');
});

function prepararWeb(h) {
  h.evaluate(`
    globalThis.__fimEndereco=[]; globalThis.__servidores=[];
    enderecoTailscale=()=>new Promise(r=>__fimEndereco.push(r));
    manterAcordado=()=>{};
    const requireAntesDoWeb=require;
    require=(name)=>name==='./servidor-web.js'?{criar:()=>{
      const ocupada=__servidores.some(s=>s.aberto);
      const s={aberto:!ocupada,endereco:'https://teste',fechar(){this.aberto=false;}};
      s.pronto=ocupada?Promise.reject(new Error('EADDRINUSE')):Promise.resolve();
      __servidores.push(s);return s;
    }}:requireAntesDoWeb(name);
  `);
}

test('desligar durante a conexão deve vencer o pedido anterior de ligar', async()=>{
  const h=loadMain();prepararWeb(h);
  const ligar=h.call('web:ligar',true);
  await h.call('web:ligar',false);
  h.evaluate("__fimEndereco[0]('https://teste')");
  await ligar;
  assert.equal(h.call('web:estado').ligado,false,'o acesso do celular voltou a ligar sozinho após ele desmarcar');
});

test('liga-desliga-liga não pode deixar servidor órfão apesar de estado desligado',async()=>{
  const h=loadMain();prepararWeb(h);
  const primeira=h.call('web:ligar',true);
  await h.call('web:ligar',false);
  const segunda=h.call('web:ligar',true);
  h.evaluate("__fimEndereco[0]('https://teste')");await Promise.all([primeira, segunda]);
  assert.equal(h.evaluate('__servidores.length'), 1, 'uma tentativa compartilhada, sem servidores concorrentes');
  await h.call('web:ligar',false);
  assert.equal(h.evaluate('__servidores.some(s=>s.aberto)'),false,'estado web=null impede botão de fechar o primeiro servidor que permaneceu ouvindo');
});

test('rodar deve resolver com erro quando seu prazo vence mesmo sem close do filho',async()=>{
  const h=loadMain(),antes=new Set(h.timers.keys());
  const tarefa=h.evaluate("rodar('fake-comando',[],25)");
  let terminou=false;tarefa.then(()=>{terminou=true;});
  for(const[id,fn]of h.timers)if(!antes.has(id))fn();
  await new Promise(setImmediate);
  const semResultado= !terminou;
  h.spawned.at(-1).proc.emit('close',null);await tarefa;
  assert.equal(semResultado,false,'timeout só enviou kill e deixou a promessa eternamente pendurada');
});

test('ligar créditos não pode sobrescrever chat salvo durante consulta ao chaveiro',async()=>{
  const h=loadMain(),config=h.HOME+'/app-data/config.json';
  h.put(config,JSON.stringify({tema:'clara',abas:[{cwd:'/cliente',chats:[{sessao:'c1'}]}]}));
  h.evaluate(`temChaveAstra=()=>new Promise(r=>{globalThis.__chavePronta=r;});estadoAstra=async()=>({ok:true});`);
  const ligar=h.call('codex:api-config:set',{enabled:true,capUsd:10});
  h.call('config:set',{tema:'escura',abas:[{cwd:'/cliente',chats:[{sessao:'c1'},{sessao:'c2'}]}]});
  h.evaluate('__chavePronta(true)');await ligar;
  const final=JSON.parse(h.files.get(config));
  assert.equal(final.abas[0].chats.length,2,'retrato antigo lido antes do await apagou o chat recém-salvo');
  assert.equal(final.tema,'escura');
});

test('índice antigo é reconstruído mesmo sem mudar data ou tamanho da conversa', async () => {
  const h = loadMain(), file = h.HOME + '/indexada.jsonl';
  const conteudo = JSON.stringify({type:'response_item',payload:{type:'message',role:'user',content:[{text:'Checkout precisa corrigir'}]}});
  h.put(file, conteudo);
  h.put(h.HOME + '/.cockpit/indice-carimbos.json',JSON.stringify({[file]:{m:1,t:Buffer.byteLength(conteudo),b:100}}));
  h.put(h.HOME + '/.cockpit/indice-texto.ndjson',JSON.stringify({f:file,m:1,t:Buffer.byteLength(conteudo),x:'instrução técnica contaminada'})+'\n');
  assert.equal((await h.call('sessions:buscar',{termo:'checkout',itens:[{id:'1',file}]})).achados.length,1);
  assert.equal((await h.call('sessions:buscar',{termo:'contaminada',itens:[{id:'1',file}]})).achados.length,0);
});

test('duas conversas com o mesmo pedido não são costuradas pela recência', () => {
  const h=loadMain();
  assert.equal(h.evaluate(`acharParteAntiga({engine:'codex',id:'nova',cwd:'/p',nasceu:1000},
    {motor:'claude',fala:'Corrigir checkout do produto Pedro',resposta:'Vou conferir.'},
    [{engine:'claude',id:'a',file:'/a',cwd:'/p',when:500},{engine:'claude',id:'b',file:'/b',cwd:'/p',when:600}],
    ()=>JSON.stringify({content:'Corrigir checkout do produto Pedro'}))`),null);
});

test('reqId repetido em Claude novo ganha chave nova e resposta velha não é enviada', async () => {
  const h=loadMain();
  const pedir=()=>h.evaluate(`claudeMessage('p',{type:'control_request',request_id:'mesmo',request:{subtype:'can_use_tool',tool_name:'AskUserQuestion',input:{questions:[{question:'Cliente?',options:[]}]}}})`);
  await h.call('pane:start',{paneId:'p',engine:'claude',cwd:h.HOME});pedir();
  const velha=h.paneEvents('perguntas').at(-1).key;
  await h.call('pane:stop',{paneId:'p',engine:'claude'});
  await h.call('pane:start',{paneId:'p',engine:'claude',cwd:h.HOME});pedir();
  const nova=h.paneEvents('perguntas').at(-1).key;
  assert.notEqual(nova,velha);
  const proc=h.spawned.at(-1),n=proc.writes.length;
  assert.ok(h.call('pane:perguntas',{paneId:'p',key:velha,answers:{'Cliente?':'errado'}}).error);
  assert.equal(proc.writes.length,n);
  assert.equal(h.call('pane:perguntas',{paneId:'p',key:nova,answers:{'Cliente?':'certo'}}).ok,true);
});

test('desligar fecha também a instância ainda aguardando confirmação de abertura', async () => {
  const h=loadMain();prepararWeb(h);
  h.evaluate(`const anterior=require;require=n=>n==='./servidor-web.js'?{criar:()=>{
    const s={aberto:true,endereco:'teste',fechar(){this.aberto=false;}};
    s.pronto=new Promise(r=>{globalThis.__servidorPronto=r;});__servidores.push(s);return s;
  }}:anterior(n);`);
  const tarefa=h.call('web:ligar',true);h.evaluate("__fimEndereco[0]('teste')");await new Promise(setImmediate);
  await h.call('web:ligar',false);
  assert.equal(h.evaluate('__servidores[0].aberto'),false);
  h.evaluate('__servidorPronto()');await tarefa;
  assert.equal(h.call('web:estado').ligado,false);
});

test('falha ao gravar créditos não confirma cache nem altera o arquivo anterior', async () => {
  const h=loadMain(),config=h.HOME+'/app-data/config.json';
  h.put(config,JSON.stringify({codexApiEnabled:false,codexApiCapUsd:5}));
  h.evaluate("temChaveAstra=async()=>true;fs.writeFileSync=()=>{throw new Error('ENOSPC');};");
  const r=await h.call('codex:api-config:set',{enabled:true,capUsd:10});
  assert.ok(r.error);assert.equal(JSON.parse(h.files.get(config)).codexApiEnabled,false);
});

test('histórico inteiro acima de 64 MB preserva a primeira e última fala e cede a vez', async () => {
  const h=loadMain(),file=h.HOME+'/grande.jsonl';
  const primeiro=JSON.stringify({type:'user',message:{content:'Primeira fala preservada'}});
  const fim=JSON.stringify({type:'assistant',message:{content:[{type:'text',text:'Última fala preservada'}]}});
  // Registros de ferramentas grandes, nenhuma mensagem de conversa cortada pelo teto antigo.
  const bloco=JSON.stringify({type:'progress',data:'x'.repeat(1024*1024)})+'\n';
  h.put(file,primeiro+'\n'+bloco.repeat(65)+fim);
  let vezes=0,rodando=true;
  const tick=()=>{vezes++;if(rodando)setImmediate(tick);};setImmediate(tick);
  const historico=await h.call('sessions:history',{engine:'claude',file});rodando=false;
  assert.equal(historico[0].text,'Primeira fala preservada');
  assert.equal(historico.at(-1).text,'Última fala preservada');
  assert.ok(vezes>100,'varredura deve deixar outras chamadas trabalharem');
});

test('grupo Unix real: filho que ignora TERM é morto antes do encerramento finalizar', {skip:process.platform==='win32',timeout:10000}, async () => {
  const {spawn}=require('node:child_process'),fs=require('node:fs'),vm=require('node:vm');
  const source=fs.readFileSync(require.resolve('../main.js'),'utf8');
  const ini=source.indexOf('const gruposEncerrando ='),fn=source.slice(ini,source.indexOf('\nconst { horaDaUltimaFala',ini));
  const filho=`process.on('SIGTERM',()=>{});process.stdout.write('ready\\n');setInterval(()=>{},1000);`;
  const paiCodigo=`const{spawn}=require('node:child_process');process.on('SIGTERM',()=>process.exit(0));spawn(process.execPath,['-e',${JSON.stringify(filho)}],{stdio:['ignore','inherit','inherit']});setInterval(()=>{},1000);`;
  const pai=spawn(process.execPath,['-e',paiCodigo],{detached:true,stdio:['ignore','pipe','pipe']});
  try {
    await new Promise((res,rej)=>{pai.stdout.once('data',res);pai.once('error',rej);});
    const ctx=vm.createContext({process,EH_WIN:false,setTimeout,clearTimeout,Promise,matarProcesso:p=>p.kill()});vm.runInContext(fn,ctx);
    const inicio=Date.now();await ctx.matarGrupoExtra(pai);
    assert.ok(Date.now()-inicio>=1000,'exit rápido do pai não pode liberar promessa');
    let vivo=true;
    for(let i=0;i<20;i++) {try{process.kill(-pai.pid,0);}catch(e){if(e.code==='ESRCH'){vivo=false;break;}}await new Promise(r=>setTimeout(r,20));}
    assert.equal(vivo,false,'não restam processos do grupo');
  } finally {try{process.kill(-pai.pid,'SIGKILL');}catch{}}
});

test('cache legado contaminado não vence a linha reconstruída com os mesmos carimbos', async () => {
  const h=loadMain(),file=h.HOME+'/legado.jsonl';
  h.put(file,JSON.stringify({type:'user',message:{content:'Conversa correta'}}));
  h.put(h.HOME+'/.cockpit/indice-busca.json',JSON.stringify({[file]:{m:1,t:h.files.get(file).length,x:'instrução contaminada'}}));
  assert.equal((await h.call('sessions:buscar',{termo:'contaminada',itens:[{id:'1',file}]})).achados.length,0);
  assert.equal((await h.call('sessions:buscar',{termo:'correta',itens:[{id:'1',file}]})).achados.length,1);
});

test('fechar o app espera também o grupo de um painel que já saiu do mapa', async () => {
  const h=loadMain();await h.call('pane:start',{paneId:'p',engine:'claude',cwd:h.HOME});
  h.spawned.at(-1).proc.pid=4444;
  h.evaluate("process.kill=()=>{};globalThis.__appSaiu=false;app.exit=()=>{__appSaiu=true;};");
  const antes=new Set(h.timers.keys());const parando=h.call('pane:stop',{paneId:'p',engine:'claude'});
  h.appEvents.get('before-quit')({preventDefault(){}});await new Promise(setImmediate);
  assert.equal(h.evaluate('__appSaiu'),false);
  for(const [id,fn]of h.timers)if(!antes.has(id))fn();await parando;await new Promise(setImmediate);
  assert.equal(h.evaluate('__appSaiu'),true);
});
