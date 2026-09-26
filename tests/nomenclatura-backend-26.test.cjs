'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadMain } = require('./main-harness.cjs');
const settle = () => new Promise(setImmediate);
function iniciar() { const h = loadMain(); h.put(h.HOME + '/.local/bin/claude', 'fake'); return h; }
const dados = (extra = {}) => ({ engine: 'claude', id: 's1', paneId: 'p', mensagens: ['Analisar criativos do Manual Claude e fazer três vídeos'], ...extra });
const pedir = (h, extra) => h.call('sessao:nomeCurto', dados(extra));
function concluir(p, texto, code = 0) { p.proc.stdout.emit('data', Buffer.from(texto)); p.proc.emit('close', code); }
async function login(h, extra = {}) {
  await settle(); const auth = h.spawned.at(-1); assert.deepEqual(Array.from(auth.args), ['auth', 'status']);
  concluir(auth, JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty', subscriptionType: 'max', ...extra }));
  await settle(); return h.spawned.at(-1);
}
const nomes = h => JSON.parse(h.files.get(h.HOME + '/app-data/nomes.json').toString());

test('nome usa só assinatura, remove fontes API falsas, preserva OAuth e manda texto privado por stdin', async () => {
  const h = iniciar();
  h.evaluate(`const filtrarNomeEnv = maisDetalhes.ambienteDoDetalhe;
    maisDetalhes.ambienteDoDetalhe = () => filtrarNomeEnv({PATH:'/bin',CLAUDE_CODE_OAUTH_TOKEN:'oauth-falso',CLAUDE_CONFIG_DIR:'/login-falso',
      ANTHROPIC_API_KEY:'api-falsa',ANTHROPIC_AUTH_TOKEN:'token-falso',CLAUDE_CODE_USE_BEDROCK:'1',AWS_ACCESS_KEY_ID:'aws-falsa'});`);
  const r = pedir(h); const prompt = await login(h);
  assert.equal(h.spawned.length, 2); assert.equal(prompt.options.env.ANTHROPIC_API_KEY, undefined); assert.equal(prompt.options.env.CLAUDE_CODE_USE_BEDROCK, undefined);
  assert.equal(prompt.options.env.CLAUDE_CODE_OAUTH_TOKEN, 'oauth-falso'); assert.equal(prompt.options.env.CLAUDE_CONFIG_DIR, '/login-falso');
  assert.equal(prompt.options.cwd, h.HOME); assert.ok(prompt.writes.some(x => String(x).includes('três vídeos')));
  assert.ok(!prompt.args.some(x => x.includes('Analisar criativos')));
  const config = JSON.parse(prompt.args[prompt.args.indexOf('--settings') + 1]); assert.equal(config.forceLoginMethod, 'claudeai');
  assert.equal(prompt.args[prompt.args.indexOf('--tools') + 1], '');
  concluir(prompt, 'Criativos Manual Claude'); assert.equal(await r, 'Criativos Manual Claude'); assert.equal(h.evaluate('nomesAtivos.size'), 0);
});

test('Console salvo, provedor externo ou autenticação inválida não iniciam geração do nome', async () => {
  for (const conta of [{ apiKeySource: '/login managed key' }, { apiProvider: 'bedrock' }, { loggedIn: false }, { authMethod: 'api_key' }]) {
    const h = iniciar(), r = pedir(h); await login(h, conta); assert.equal(await r, ''); assert.equal(h.spawned.length, 1); assert.equal(h.evaluate('nomesAtivos.size'), 0);
  }
});

test('duas telas com a mesma revisão/conteúdo compartilham auth e geração', async () => {
  const h = iniciar(), a = pedir(h), b = pedir(h);
  const p = await login(h); assert.equal(h.spawned.length, 2); assert.equal(h.evaluate('nomesAtivos.size'), 1);
  concluir(p, 'Criativos Manual Claude'); assert.deepEqual(await Promise.all([a, b]), ['Criativos Manual Claude', 'Criativos Manual Claude']);
});

test('conteúdo mais novo cancela geração antiga, inclusive durante auth, antes de iniciar a próxima', async () => {
  for (const fase of ['auth', 'prompt']) {
    const h = iniciar(), velho = pedir(h); if (fase === 'prompt') await login(h); else await settle();
    const p = h.spawned.at(-1); let matou = false; p.proc.kill = () => { matou = true; };
    const novo = pedir(h, { mensagens: ['Criar página de captura do Pedro'] }); await settle(); assert.equal(matou, true, fase); assert.equal(await velho, '');
    const geracao = await login(h); concluir(geracao, 'Página Captura Pedro'); assert.equal(await novo, 'Página Captura Pedro');
  }
});

test('nome manual é protegido de auto atrasado e também cancela a IA ainda em andamento', async () => {
  const h = iniciar(), r = pedir(h); await settle(); const p = h.spawned.at(-1); let matou = false; p.proc.kill = () => { matou = true; };
  assert.equal(await h.call('sessao:renomear', {engine:'claude',id:'s1',nome:'Meu Nome',origem:'manual'}), true);
  assert.equal(matou, true); assert.equal(await r, '');
  const conflito = await h.call('sessao:renomear', {engine:'claude',id:'s1',nome:'Nome Antigo da IA',origem:'auto'});
  assert.equal(conflito.ok, false); assert.equal(conflito.conflito, true); assert.equal(conflito.nome, 'Meu Nome'); assert.equal(conflito.origem, 'manual');
  assert.equal(nomes(h).s1, 'Meu Nome'); assert.equal(nomes(h)._origem.s1, 'manual');
  const antes = h.spawned.length; assert.equal(await pedir(h), ''); assert.equal(h.spawned.length, antes);
});

test('CAS opcional rejeita nome automático superado, confirma gravação exata e preserva origem', async () => {
  const h = iniciar();
  assert.equal(await h.call('sessao:renomear',{engine:'claude',id:'s1',nome:'Primeiro Nome',origem:'auto',anterior:''}), true);
  assert.equal(await h.call('sessao:renomear',{engine:'claude',id:'s1',nome:'Segundo Nome',origem:'auto',anterior:'Primeiro Nome'}), true);
  const r = await h.call('sessao:renomear',{engine:'claude',id:'s1',nome:'Atrasado',origem:'auto',anterior:'Primeiro Nome'});
  assert.equal(r.conflito,true); assert.equal(r.nome,'Segundo Nome'); assert.equal(nomes(h).s1,'Segundo Nome'); assert.equal(nomes(h)._origem.s1,'auto');
  h.evaluate("fs.writeFileSync=()=>{throw new Error('ENOSPC')}");
  const erro = await h.call('sessao:renomear',{engine:'claude',id:'s1',nome:'Não Gravado',origem:'auto',anterior:'Segundo Nome'});
  assert.equal(erro.ok,false); assert.match(erro.error,/salvar/); assert.equal(nomes(h).s1,'Segundo Nome');
});

test('teto global e inputs inválidos não criam processos adicionais', async () => {
  const h = iniciar();
  for (const extra of [{mensagens:[{}]},{mensagens:Array(129).fill('pedido')},{respostas:[{}]},{mensagens:['x'.repeat(512001)]}]) assert.equal(await pedir(h,extra),'');
  assert.equal(h.spawned.length,0);
  const rs = [0,1,2,3].map(i => pedir(h,{id:'s'+i,paneId:'p'+i})); await settle(); assert.equal(h.spawned.length,4);
  assert.equal(await pedir(h,{id:'quinta'}),''); assert.equal(h.spawned.length,4);
  await h.evaluate('shutdown()'); assert.deepEqual(await Promise.all(rs),['','','','']); assert.equal(h.evaluate('nomesAtivos.size'),0);
});

test('shutdown espera o grupo durante auth e durante geração, sem resultado tardio', async () => {
  for (const fase of ['auth','prompt']) {
    const h = iniciar(), r = pedir(h); if (fase === 'prompt') await login(h); else await settle();
    h.spawned.at(-1).proc.pid=9876; h.evaluate('globalThis.sinais=[];process.kill=(pid,sinal)=>sinais.push(sinal)');
    let saiu=false; const shutdown=h.evaluate('shutdown()').then(()=>{saiu=true}); await settle(); assert.equal(saiu,false,fase);
    assert.ok(h.evaluate("sinais.includes('SIGTERM')")); for(const fn of [...h.timers.values()])fn(); await shutdown;
    assert.ok(h.evaluate("sinais.includes('SIGKILL')")); assert.equal(await r,''); assert.equal(h.evaluate('nomesAtivos.size'),0);
  }
});

test('fechar painel cancela nome pendente sem mexer no pedido de outro painel', async () => {
  const h=iniciar(), a=pedir(h), b=pedir(h,{id:'s2',paneId:'q'}); await settle();
  await h.call('pane:stop',{paneId:'p',engine:'claude'}); assert.equal(await a,''); assert.equal(h.evaluate('[...nomesAtivos.values()].filter(x=>!x.cancelado).length'),1);
  await h.evaluate('shutdown()'); assert.equal(await b,'');
});

test('erro e timeout deixam a tentativa seguinte possível, mantendo retorno string', async () => {
  const h=iniciar(), r=pedir(h); await settle(); const p=h.spawned.at(-1); concluir(p,'login indisponível',1); assert.equal(await r,'');
  const novo=pedir(h); const prompt=await login(h); const antes=h.spawned.length;
  for(const fn of [...h.timers.values()])fn(); assert.equal(await novo,''); assert.equal(h.evaluate('nomesAtivos.size'),0);
  assert.ok(prompt); const outra=pedir(h); await settle(); assert.equal(h.spawned.length,antes+1); await h.evaluate('shutdown()'); assert.equal(await outra,'');
});

test('histórico Claude local/remoto já exclui SKILL isMeta antes de chegar ao renderer', async () => {
  const h=iniciar(), file=h.HOME+'/history.jsonl';
  const linhas=[{type:'user',isMeta:true,message:{content:'SKILL Faça faxina do Mac'}},{type:'user',message:{content:'Criar três vídeos Manual Claude'}}].map(JSON.stringify).join('\n');
  h.put(file,linhas); const local=await h.call('sessions:history',{engine:'claude',file});
  const remoto=h.evaluate('claudeHistoryTexto('+JSON.stringify(linhas)+')');
  for(const hist of [local,remoto]) { assert.equal(hist.length,1); assert.equal(hist[0].text,'Criar três vídeos Manual Claude'); }
});

test('nome manual legado sem origem é protegido na geração e na gravação automática', async () => {
  const h=iniciar(); h.put(h.HOME+'/app-data/nomes.json',JSON.stringify({s1:'Nome Escolhido por Mim'}));
  assert.equal(h.call('sessao:donoNome',{id:'s1'}),'manual'); assert.equal(await pedir(h),''); assert.equal(h.spawned.length,0);
  const r=await h.call('sessao:renomear',{engine:'claude',id:'s1',nome:'Automático Atrasado',origem:'auto'});
  assert.equal(r.conflito,true); assert.equal(r.origem,'manual'); assert.equal(nomes(h).s1,'Nome Escolhido por Mim');
});

test('nome manual gravado fora do IPC enquanto Haiku responde bloqueia resultado tardio', async () => {
  const h=iniciar(), r=pedir(h), p=await login(h);
  h.put(h.HOME+'/app-data/nomes.json',JSON.stringify({s1:'Nome Manual Externo'})); concluir(p,'Criativos Manual Claude'); assert.equal(await r,'');
});

test('conexão Codex atrasada não envia nome automático que perdeu para manual', async () => {
  const h=iniciar(); h.attachCodex('local');
  h.evaluate('globalThis.soltarConexao=null;const conexaoDoNome=new Promise(r=>soltarConexao=r);codexStart=()=>conexaoDoNome');
  const auto=h.call('sessao:renomear',{engine:'codex',id:'s1',nome:'Nome Automático',origem:'auto'});
  const manual=h.call('sessao:renomear',{engine:'codex',id:'s1',nome:'Nome Manual',origem:'manual'});
  h.evaluate('soltarConexao()'); assert.equal((await auto).conflito,true); assert.equal(await manual,true);
  const escritas=h.wire.filter(x=>x.method==='thread/name/set'); assert.equal(escritas.length,1); assert.equal(escritas[0].params.name,'Nome Manual');
});
