'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Ajv = require('ajv');
const { loadMain: loadMainBase } = require('./main-harness.cjs');
const loadMain = () => loadMainBase({ directories: ['/projetos/cockpit', '/projetos/novo', '/projeto', '/outra'] });
const ajv = new Ajv({ allErrors: true, unknownFormats: 'ignore', logger: false });
const validators = new Map();
const results = [];
function schema(name, value) {
  if (!validators.has(name)) validators.set(name, ajv.compile(JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/protocolo', name + '.json'), 'utf8'))));
  const check = validators.get(name);
  assert.ok(check(value), name + ': ' + JSON.stringify(check.errors));
}
function spec(name, fn) {
  test(name, async () => {
    try { await fn(); results.push({ teste: name, passou: true }); }
    catch (error) { results.push({ teste: name, passou: false, motivo: error.message }); throw error; }
  });
}
after(() => {
  if (!process.env.COCKPIT_TEST_EVIDENCE) return;
  fs.mkdirSync(path.dirname(process.env.COCKPIT_TEST_EVIDENCE), { recursive: true });
  fs.writeFileSync(process.env.COCKPIT_TEST_EVIDENCE, JSON.stringify({
    executadoEm: new Date().toISOString(),
    fonte: 'main.js inteiro em VM; protocolo JSONRPC real com transporte simulado; schemas oficiais CLI 0.153.4',
    semInferenciaPaga: true, total: results.length, passaram: results.filter(x => x.passou).length, testes: results,
  }, null, 2));
});
async function ready(options = {}, destino = 'local', responder) {
  const h = loadMain(); h.attachCodex(destino, responder);
  await h.call('pane:start', { paneId: 1, engine: 'codex', cwd: destino === 'local' ? '/projetos/cockpit' : destino + ':/opt/projeto', model: 'gpt-6-astra', approval: 'manual', effort: 'xhigh', resumeId: 'thread-' + destino, ...options });
  return h;
}
function lastRequest(h, method) { const m = h.wire.filter(x => x.method === method).at(-1); assert.ok(m, 'Pedido ' + method + ' não enviado'); return m.params; }
function one(h, kind) { const m = h.paneEvents(kind).at(-1); assert.ok(m, 'Evento ' + kind + ' não emitido'); return m; }
function request(h, method, params = {}, id = 42, destino = 'local') {
  h.incoming(destino, { id, method, params: { threadId: 'thread-' + destino, turnId: 'turn-' + destino, itemId: 'item-1', ...params } });
}
function replies(h) { return h.wire.filter(x => x.id !== undefined && !x.method); }

spec('main.js completo registra os handlers sem abrir Electron nem criar processos', () => {
  const h = loadMain();
  for (const name of ['pane:start', 'pane:send', 'pane:approve', 'sessions:history']) assert.ok(h.ipc.has(name), name);
  assert.equal(h.spawned.length, 0); assert.equal(h.violations.length, 0); assert.equal(h.timers.size, 0);
});

spec('retomar conversa transmite modelo, pasta e permissões escolhidas', async () => {
  const h = await ready(); const p = lastRequest(h, 'thread/resume');
  schema('ThreadResumeParams', p);
  assert.equal(p.model, 'gpt-6-astra'); assert.equal(p.cwd, '/projetos/cockpit');
  assert.equal(p.approvalPolicy, 'untrusted'); assert.equal(p.sandbox, 'workspace-write');
  await h.call('pane:send', { paneId: 1, engine: 'codex', text: 'Conferir' });
  const t = lastRequest(h, 'turn/start'); schema('TurnStartParams', t);
  assert.equal(t.effort || t.collaborationMode?.settings?.reasoning_effort, 'xhigh');
});

spec('conversa nova transmite regras, modelo e pasta com schema válido', async () => {
  const h = await ready({ resumeId: undefined }); const p = lastRequest(h, 'thread/start');
  schema('ThreadStartParams', p);
  assert.equal(p.model, 'gpt-6-astra'); assert.equal(p.cwd, '/projetos/cockpit');
  assert.match(p.developerInstructions, /português/); assert.equal(p.approvalPolicy, 'untrusted');
});

spec('Plano chega como collaborationMode e mantém instrução nativa do modo', async () => {
  const h = await ready({ collaborationMode: 'plan', approval: 'plan' });
  await h.call('pane:send', { paneId: 1, engine: 'codex', text: 'Planeje o trabalho' });
  const p = lastRequest(h, 'turn/start'); schema('TurnStartParams', p);
  assert.equal(p.collaborationMode?.mode, 'plan');
  assert.equal(p.collaborationMode.settings.model, 'gpt-6-astra');
  assert.equal(p.collaborationMode.settings.reasoning_effort, 'xhigh');
  assert.equal(p.collaborationMode.settings.developer_instructions, null);
  assert.notEqual(lastRequest(h, 'thread/resume').sandbox, 'danger-full-access');
});

spec('trocar configuração entre turnos preserva a conversa e chega ao motor', async () => {
  const h = await ready(); h.clear();
  await h.call('pane:settings', { paneId: 1, engine: 'codex', model: 'gpt-5.6-terra', effort: 'high', approval: 'auto', collaborationMode: 'default', cwd: '/projetos/novo' });
  await h.call('pane:send', { paneId: 1, engine: 'codex', text: 'Continuar' });
  const p = lastRequest(h, 'turn/start'); schema('TurnStartParams', p);
  assert.equal(p.threadId, 'thread-local'); assert.equal(p.model || p.collaborationMode?.settings?.model, 'gpt-5.6-terra');
  assert.equal(p.effort || p.collaborationMode?.settings?.reasoning_effort, 'high');
  assert.equal(p.cwd, '/projetos/novo'); assert.equal(p.approvalPolicy, 'on-request');
});

spec('imagem sozinha segue como localImage e o texto vazio não vira mensagem', async () => {
  const h = await ready(); h.put('/imagens/print.png', Buffer.from([137,80,78,71])); h.clear();
  const ok = await h.call('pane:send', { paneId: 1, engine: 'codex', text: '', attachments: [{ path: '/imagens/print.png', nome: 'print.png', ext: 'png', mini: '' }] });
  assert.equal(ok, true);
  const p = lastRequest(h, 'turn/start'); schema('TurnStartParams', p);
  assert.deepEqual(p.input.filter(x => x.type === 'localImage'), [{ type: 'localImage', path: '/imagens/print.png' }]);
  assert.equal(p.input.filter(x => x.type === 'text' && !x.text.trim()).length, 0);
});

spec('imagem com texto mantém ambos os conteúdos no mesmo pedido', async () => {
  const h = await ready(); h.put('/imagens/print.png', 'imagem'); h.clear();
  await h.call('pane:send', { paneId: 1, engine: 'codex', text: 'Leia a imagem', attachments: [{ path: '/imagens/print.png', nome: 'print.png', ext: 'png' }] });
  const p = lastRequest(h, 'turn/start'); schema('TurnStartParams', p);
  assert.ok(p.input.some(x => x.type === 'text' && x.text.includes('Leia a imagem')));
  assert.ok(p.input.some(x => x.type === 'localImage' && x.path === '/imagens/print.png'));
});

spec('pergunta do modelo aguarda resposta humana e responde no schema certo', async () => {
  const h = await ready(); h.clear();
  request(h, 'item/tool/requestUserInput', { questions: [{ id: 'q1', header: 'Período', question: 'Qual período?', options: [{ label: 'Semana', description: 'Últimos sete dias' }] }] });
  assert.equal(replies(h).length, 0, 'Pergunta não pode receber resposta vazia automática');
  const q = one(h, 'question'); assert.equal(q.questionKind, 'requestUserInput');
  await h.call('pane:respond', { paneId: 1, key: q.key, answers: { q1: ['Semana'] } });
  const r = replies(h).at(-1); assert.ok(r); schema('ToolRequestUserInputResponse', r.result);
  assert.deepEqual(r.result.answers.q1.answers, ['Semana']); assert.equal(r.destino, 'local');
});

spec('pedidos com mesmo ID em local e VPS não colidem nem trocam destino', async () => {
  const h = await ready(); h.attachCodex('vps');
  await h.call('pane:start', { paneId: 2, engine: 'codex', cwd: 'vps:/opt/projeto', model: 'gpt-6-astra', approval: 'manual', resumeId: 'thread-vps' }); h.clear();
  const questions = [{ id: 'q', header: 'Opção', question: 'Escolha', options: [] }];
  request(h, 'item/tool/requestUserInput', { questions }, 7, 'local');
  request(h, 'item/tool/requestUserInput', { questions }, 7, 'vps');
  const q = h.paneEvents('question'); assert.equal(q.length, 2); assert.notEqual(q[0].key, q[1].key);
  await h.call('pane:respond', { paneId: 2, key: q[1].key, answers: { q: ['VPS'] } });
  await h.call('pane:respond', { paneId: 1, key: q[0].key, answers: { q: ['Mac'] } });
  const r = replies(h); assert.equal(r.length, 2);
  assert.equal(r[0].destino, 'vps'); assert.equal(r[1].destino, 'local');
  assert.deepEqual(r[0].result.answers.q.answers, ['VPS']); assert.deepEqual(r[1].result.answers.q.answers, ['Mac']);
});

spec('resposta de outro painel não consome uma pergunta pendente', async () => {
  const h = await ready(); h.clear(); request(h, 'item/tool/requestUserInput', { questions: [{ id: 'q', question: 'Escolha', header: 'Opção' }] });
  const q = one(h, 'question');
  const result = await h.call('pane:respond', { paneId: 99, key: q.key, answers: { q: ['incorreta'] } });
  assert.ok(result === false || result?.error); assert.equal(replies(h).length, 0);
  await h.call('pane:respond', { paneId: 1, key: q.key, answers: { q: ['correta'] } }); assert.equal(replies(h).length, 1);
});

spec('formulário de conector espera e devolve conteúdo estruturado sem vazio', async () => {
  const h = await ready(); h.clear();
  request(h, 'mcpServer/elicitation/request', { serverName: 'agenda', mode: 'form', message: 'Qual calendário?', requestedSchema: { type: 'object', properties: { nome: { type: 'string' } }, required: ['nome'] } });
  assert.equal(replies(h).length, 0); const q = one(h, 'question'); assert.equal(q.questionKind, 'elicitation');
  await h.call('pane:respond', { paneId: 1, key: q.key, action: 'accept', content: { nome: 'Adsure' } });
  const r = replies(h).at(-1); schema('McpServerElicitationRequestResponse', r.result);
  assert.deepEqual(r.result, { action: 'accept', content: { nome: 'Adsure' } });
});

spec('cancelar conector devolve cancel sem conteúdo inventado', async () => {
  const h = await ready(); h.clear();
  request(h, 'mcpServer/elicitation/request', { serverName: 'agenda', mode: 'url', url: 'https://example.test/auth', message: 'Conectar', elicitationId: 'e1' });
  const q = one(h, 'question');
  await h.call('pane:respond', { paneId: 1, key: q.key, action: 'cancel' });
  const r = replies(h).at(-1); schema('McpServerElicitationRequestResponse', r.result); assert.equal(r.result.action, 'cancel');
  assert.ok(r.result.content == null);
});

spec('permissão adicional aprovada usa permissions e scope, nunca decision', async () => {
  const h = await ready({}, 'vps'); h.clear();
  const permissions = { network: { enabled: true } };
  request(h, 'item/permissions/requestApproval', { permissions, reason: 'Consultar fonte' }, 8, 'vps');
  const q = one(h, 'approval'); assert.equal(replies(h).length, 0);
  await h.call('pane:approve', { paneId: 1, key: q.key, allow: true });
  const r = replies(h).at(-1); schema('PermissionsRequestApprovalResponse', r.result);
  assert.deepEqual(r.result.permissions, permissions); assert.ok(['turn', 'session'].includes(r.result.scope));
  assert.equal(r.result.decision, undefined); assert.equal(r.destino, 'vps');
});

spec('permissão adicional negada não concede rede ou escrita', async () => {
  const h = await ready(); h.clear(); request(h, 'item/permissions/requestApproval', { permissions: { network: { enabled: true } } });
  const q = one(h, 'approval'); await h.call('pane:approve', { key: q.key, allow: false });
  const r = replies(h).at(-1); schema('PermissionsRequestApprovalResponse', r.result);
  assert.ok(!r.result.permissions.network?.enabled); assert.ok(!r.result.permissions.fileSystem?.write?.length);
});

spec('aprovação normal de terminal segue o schema existente', async () => {
  const h = await ready(); h.clear(); request(h, 'item/commandExecution/requestApproval', { command: 'pwd', cwd: '/projeto' });
  const q = one(h, 'approval'); await h.call('pane:approve', { key: q.key, allow: true });
  schema('CommandExecutionRequestApprovalResponse', replies(h).at(-1).result);
});

spec('pedido de ferramenta dinâmica desconhecida falha explicitamente', async () => {
  const h = await ready(); h.clear(); request(h, 'item/tool/call', { callId: 'call-1', tool: 'ferramenta_inexistente', arguments: {} });
  const r = replies(h).at(-1); assert.ok(r);
  // Nenhuma ferramenta dinâmica é anunciada por este cliente. Method-not-found
  // é uma resposta RPC válida e não finge que uma ferramenta foi executada.
  if (r.error) { assert.equal(r.error.code, -32601); assert.ok(r.error.message); return; }
  schema('DynamicToolCallResponse', r.result); assert.equal(r.result.success, false);
  assert.ok(r.result.contentItems.length > 0);
});

spec('plano ao vivo e plano concluído aparecem sem perder texto ou etapas', async () => {
  const h = await ready(); h.clear();
  h.notify('turn/plan/updated', { threadId: 'thread-local', turnId: 'turn-local', explanation: 'Conferir em duas etapas', plan: [{ step: 'Ler', status: 'completed' }, { step: 'Testar', status: 'inProgress' }] });
  const p = one(h, 'plan'); assert.equal((p.steps || p.plan).length, 2);
  assert.equal((p.steps || p.plan)[1].status, 'inProgress');
  h.notify('item/completed', { threadId: 'thread-local', item: { id: 'p1', type: 'plan', text: 'Plano final de implementação' } });
  assert.match(JSON.stringify(h.paneEvents()), /Plano final de implementação/);
});

spec('agente criado e atualização de subagente ficam visíveis', async () => {
  const h = await ready(); h.clear();
  h.notify('item/started', { threadId: 'thread-local', item: { id: 'a1', type: 'collabAgentToolCall', tool: 'spawnAgent', status: 'inProgress', receiverThreadIds: ['child-1'], senderThreadId: 'thread-local', agentsStates: {} } });
  assert.ok(h.paneEvents().length > 0); assert.match(JSON.stringify(h.paneEvents()), /a1/);
  h.clear(); h.notify('item/started', { threadId: 'thread-local', item: { id: 'a2', type: 'subAgentActivity', agentThreadId: 'child-1', agentPath: '/root/teste', kind: 'started' } });
  assert.ok(h.paneEvents().length > 0); assert.match(JSON.stringify(h.paneEvents()), /child-1|teste/);
});

spec('imagem gerada preserva caminho e status para ser aberta na tela', async () => {
  const h = await ready(); h.clear();
  h.notify('item/completed', { threadId: 'thread-local', item: { id: 'i1', type: 'imageGeneration', status: 'completed', savedPath: '/imagens/gerada.png', result: 'aW1hZ2Vt' } });
  const m = one(h, 'generated-image'); assert.equal(m.path, '/imagens/gerada.png'); assert.equal(m.status, 'completed');
});

spec('espera, meta e compactação notificam a interface', async () => {
  const h = await ready(); h.clear();
  h.notify('item/started', { threadId: 'thread-local', item: { id: 's1', type: 'sleep', durationMs: 60000 } }); one(h, 'waiting');
  h.notify('thread/goal/updated', { threadId: 'thread-local', goal: { objective: 'Concluir auditoria', status: 'active' } });
  assert.match(JSON.stringify(one(h, 'goal')), /Concluir auditoria/);
  h.notify('item/completed', { threadId: 'thread-local', item: { id: 'c1', type: 'contextCompaction' } }); one(h, 'compactou');
});

spec('troca de modelo pelo servidor informa o modelo realmente usado', async () => {
  const h = await ready(); h.clear();
  h.notify('model/rerouted', { threadId: 'thread-local', turnId: 'turn-local', fromModel: 'gpt-6-astra', toModel: 'gpt-5.6-terra', reason: 'highRiskCyberActivity' });
  assert.match(JSON.stringify(h.paneEvents()), /gpt-5.6-terra/);
});

spec('cota e conta globais chegam ao aplicativo mesmo sem threadId', async () => {
  const h = await ready(); h.clear();
  h.notify('account/rateLimits/updated', { rateLimits: { primary: { usedPercent: 5, windowDurationMins: 300 } } });
  assert.ok(h.events.length > 0, 'Cota global foi descartada'); assert.match(JSON.stringify(h.events), /5/);
  h.clear(); h.notify('account/updated', { authMode: 'chatgpt', planType: 'pro' });
  assert.ok(h.events.length > 0, 'Conta global foi descartada'); assert.match(JSON.stringify(h.events), /chatgpt|pro/);
});

spec('saída UTF-8 do terminal não é interpretada como base64', async () => {
  const h = await ready(); h.clear();
  for (const text of ['test', 'Olá, ação concluída.\n', 'YWJj']) {
    h.notify('item/commandExecution/outputDelta', { threadId: 'thread-local', turnId: 'turn-local', itemId: 'c1', delta: text });
    assert.equal(one(h, 'tool-output').text, text);
  }
});

spec('saída global de command/exec decodifica deltaBase64 explicitamente', async () => {
  const h = await ready(); h.clear();
  const text = 'Olá, ação concluída.\n';
  h.notify('command/exec/outputDelta', { processId: 'proc-1', deltaBase64: Buffer.from(text).toString('base64'), stream: 'stdout', capReached: false });
  assert.ok(h.events.length > 0, 'Saída de processo global foi descartada');
  assert.ok(h.events.some(e => JSON.stringify(e).includes('Olá, ação concluída.')));
});

spec('histórico recupera ferramentas antigas e novas com o resultado correspondente', async () => {
  const h = loadMain(); const file = '/historico/codex.jsonl';
  const payloads = [
    { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Conferir a página' }] },
    { type: 'function_call', call_id: 'old', name: 'shell', arguments: '{"command":"pwd"}' },
    { type: 'function_call_output', call_id: 'old', output: '/projeto' },
    { type: 'custom_tool_call', call_id: 'new', name: 'exec', input: 'text(await tools.exec_command({cmd:"ls"}))' },
    { type: 'custom_tool_call_output', call_id: 'new', output: 'index.html' },
    { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Página conferida.' }] },
  ];
  h.put(file, payloads.map(payload => JSON.stringify({ type: 'response_item', payload })).join('\n'));
  const messages = await h.call('sessions:history', { engine: 'codex', file });
  assert.equal(messages.filter(x => x.role === 'user').length, 1); assert.equal(messages.filter(x => x.role === 'bot').length, 1);
  const tools = messages.filter(x => x.role === 'tool'); assert.equal(tools.length, 2);
  assert.match(JSON.stringify(tools[0]), /pwd/); assert.match(JSON.stringify(tools[0]), /\/projeto/);
  assert.match(JSON.stringify(tools[1]), /exec_command/); assert.match(JSON.stringify(tools[1]), /index.html/);
});

spec('Claude continua iniciando com o modelo/modo/esforço e enviando texto', async () => {
  const h = loadMain();
  await h.call('pane:start', { paneId: 3, engine: 'claude', cwd: '/projeto', model: 'opus', approval: 'plan', effort: 'high', resumeId: 'claude-sessao' });
  assert.equal(h.spawned.length, 1); const p = h.spawned[0];
  for (const flag of ['--permission-mode', '--model', '--effort', '--resume']) assert.ok(p.args.includes(flag));
  assert.equal(p.args[p.args.indexOf('--permission-mode') + 1], 'plan');
  assert.equal(p.args[p.args.indexOf('--model') + 1], 'opus');
  assert.equal(p.args[p.args.indexOf('--resume') + 1], 'claude-sessao');
  const sent = await h.call('pane:send', { paneId: 3, engine: 'claude', text: 'Conferir o projeto' }); assert.equal(sent, true);
  const message = p.writes.at(-1); assert.equal(message.type, 'user'); assert.equal(message.message.content[0].text, 'Conferir o projeto');
  await h.call('pane:compactar', { paneId: 3, engine: 'claude' }); assert.equal(p.writes.at(-1).message.content[0].text, '/compact');
});

spec('Claude continua aprovando ferramentas pelo próprio protocolo', async () => {
  const h = loadMain(); await h.call('pane:start', { paneId: 3, engine: 'claude', cwd: '/projeto', approval: 'manual' }); h.clear();
  const p = h.spawned[0]; const input = { command: 'pwd' };
  p.proc.stdout.emit('data', Buffer.from(JSON.stringify({ type: 'control_request', request_id: 'cl-r1', request: { subtype: 'can_use_tool', tool_name: 'Bash', input } }) + '\n'));
  const q = one(h, 'approval'); await h.call('pane:approve', { key: q.key, allow: true });
  const r = p.writes.at(-1); assert.equal(r.type, 'control_response');
  assert.equal(r.response.request_id, 'cl-r1'); assert.equal(r.response.response.behavior, 'allow'); assert.deepEqual(r.response.response.updatedInput, input);
});

spec('falha de rede ao retomar não cria conversa nova silenciosamente', async () => {
  const h = loadMain(); h.attachCodex('local', () => { throw new Error('rede indisponível'); });
  await assert.rejects(h.call('pane:start', { paneId: 1, engine: 'codex', cwd: '/projeto', resumeId: 'original' }), /rede indisponível/);
  assert.equal(h.wire.filter(x => x.method === 'thread/start').length, 0);
});

spec('modo rápido e contexto experimental só são enviados à conversa escolhida', async () => {
  const h = await ready({ serviceTier: 'priority', experimentalContext: true });
  const resume = lastRequest(h, 'thread/resume'); schema('ThreadResumeParams', resume);
  assert.equal(resume.serviceTier, 'priority'); assert.equal(resume.config['features.context_management.experimental_mode'], true);
  assert.equal(resume.config.model_reasoning_effort, 'xhigh');
  await h.call('pane:send', { paneId: 1, engine: 'codex', text: 'Conferir' });
  assert.equal(lastRequest(h, 'turn/start').serviceTier, 'priority');
  await h.call('pane:start', { paneId: 2, engine: 'codex', cwd: '/outra', model: 'gpt-6-astra', resumeId: 'thread-dois', approval: 'manual' });
  const other = lastRequest(h, 'thread/resume'); assert.notEqual(other.serviceTier, 'priority');
  assert.equal(other.config['features.context_management.experimental_mode'], false);
  assert.equal([...h.files.keys()].filter(p => p.endsWith('config.toml')).length, 0);
});

spec('imagem enviada à VPS leva dados da imagem, sem caminho inacessível do Mac', async () => {
  const h = await ready({}, 'vps'); h.put('/imagens/local.png', Buffer.from([137,80,78,71])); h.clear();
  await h.call('pane:send', { paneId: 1, engine: 'codex', text: '', attachments: [{ path: '/imagens/local.png', nome: 'local.png', ext: 'png' }] });
  const p = lastRequest(h, 'turn/start'); schema('TurnStartParams', p);
  assert.equal(p.input[0].type, 'image'); assert.equal(p.input[0].url, 'data:image/png;base64,iVBORw==');
  assert.equal(h.wire.at(-1).destino, 'vps');
});

spec('imagem que sumiu falha antes de enviar e não finge sucesso', async () => {
  const h = await ready(); h.clear();
  await assert.rejects(h.call('pane:send', { paneId: 1, engine: 'codex', text: '', attachments: [{ path: '/imagens/sumiu.png' }] }), /imagem|encontrei/i);
  assert.equal(h.wire.filter(x => x.method === 'turn/start').length, 0);
});

spec('pergunta sem resposta permanece aberta e não recebe answers vazio', async () => {
  const h = await ready(); h.clear(); request(h, 'item/tool/requestUserInput', { questions: [{ id: 'q', header: 'Escolha', question: 'Qual opção?' }] });
  const q = one(h, 'question'); const result = await h.call('pane:respond', { paneId: 1, key: q.key, answers: {} });
  assert.ok(result.error); assert.equal(replies(h).length, 0);
  await h.call('pane:respond', { paneId: 1, key: q.key, answers: { q: ['Outra opção'] } }); assert.equal(replies(h).length, 1);
});

spec('resposta inválida de conector não é enviada e permite corrigir', async () => {
  const h = await ready(); h.clear();
  request(h, 'mcpServer/elicitation/request', { serverName: 'agenda', mode: 'form', message: 'Escolha quantidade', requestedSchema: { type: 'object', properties: { quantidade: { type: 'integer', minimum: 1 } }, required: ['quantidade'] } });
  const q = one(h, 'question');
  const result = await h.call('pane:respond', { paneId: 1, key: q.key, action: 'accept', content: { quantidade: 'dois' } });
  assert.ok(result.error); assert.equal(replies(h).length, 0);
  await h.call('pane:respond', { paneId: 1, key: q.key, action: 'accept', content: { quantidade: 2 } }); assert.equal(replies(h).length, 1);
});

spec('pedido encerrado pelo servidor não aceita resposta atrasada', async () => {
  const h = await ready(); h.clear(); request(h, 'item/tool/requestUserInput', { questions: [{ id: 'q', header: 'Escolha', question: 'Qual opção?' }] }, 12);
  const q = one(h, 'question'); h.notify('serverRequest/resolved', { requestId: 12, threadId: 'thread-local' });
  const result = await h.call('pane:respond', { paneId: 1, key: q.key, answers: { q: ['opção'] } });
  assert.ok(result.error || result === false); assert.equal(replies(h).length, 0);
});

spec('pergunta assíncrona respondida durante trabalho segue por turn/steer', async () => {
  const h = await ready(); h.clear(); h.notify('turn/started', { threadId: 'thread-local', turn: { id: 'turn-local' } });
  h.notify('item/completed', { threadId: 'thread-local', item: { type: 'agentMessage', id: 'async-1', text: 'Qual período?', delivery: 'async', questions: [{ title: 'Período', options: ['Semana', 'Mês'] }] } });
  const q = one(h, 'question'); assert.equal(q.questionKind, 'async'); assert.equal(q.isBlocking, false);
  const id = q.questions[0].id; assert.ok(id);
  const result = await h.call('pane:respond', { paneId: 1, key: q.key, answers: { [id]: ['Semana'] } }); assert.ok(result.ok);
  const p = lastRequest(h, 'turn/steer'); assert.equal(p.threadId, 'thread-local'); assert.equal(p.expectedTurnId, 'turn-local'); assert.match(p.input[0].text, /Semana/);
});

spec('pergunta assíncrona sobrevive ao fim do turno e retoma a mesma conversa', async () => {
  const h = await ready(); h.clear();
  h.notify('item/completed', { threadId: 'thread-local', item: { type: 'agentMessage', id: 'async-2', text: 'Qual período?', delivery: 'async', questions: [{ title: 'Período', options: ['Semana', 'Mês'] }] } });
  const q = one(h, 'question'); h.notify('turn/completed', { threadId: 'thread-local', turn: { id: 'turn-local', status: 'completed' } });
  const result = await h.call('pane:respond', { paneId: 1, key: q.key, answers: { [q.questions[0].id]: ['Mês'] } }); assert.ok(result.ok);
  const p = lastRequest(h, 'turn/start'); schema('TurnStartParams', p); assert.equal(p.threadId, 'thread-local'); assert.match(p.input[0].text, /Mês/);
});

spec('aprovações antigas continuam respondendo no schema legado, aprovado e negado', async () => {
  const h = await ready(); h.clear();
  for (const [method, shape] of [['execCommandApproval', 'ExecCommandApprovalResponse'], ['applyPatchApproval', 'ApplyPatchApprovalResponse']]) {
    for (const allow of [true, false]) {
      request(h, method, { command: 'pwd' }, allow ? 51 : 52); const q = one(h, 'approval');
      await h.call('pane:approve', { key: q.key, allow }); schema(shape, replies(h).at(-1).result);
    }
  }
});

spec('Claude recebe imagem sozinha e mantém a recuperação de sessão por aprovação', async () => {
  const h = loadMain(); await h.call('pane:start', { paneId: 3, engine: 'claude', cwd: '/projeto', approval: 'manual' });
  const sent = await h.call('pane:send', { paneId: 3, engine: 'claude', text: '', attachments: [{ path: '/imagens/print.png', nome: 'print.png' }] });
  assert.equal(sent, true); assert.match(h.spawned[0].writes.at(-1).message.content[0].text, /\/imagens\/print\.png/);
  h.spawned[0].proc.stdin.writable = false;
  const failed = await h.call('pane:send', { paneId: 3, engine: 'claude', text: 'retomar' }); assert.equal(failed, false); one(h, 'engine-down');
});

spec('histórico oficial na VPS recupera imagem do usuário, plano e imagem gerada', async () => {
  const h = loadMain(); h.attachCodex('vps', (method, params) => {
    assert.equal(method, 'thread/read'); schema('ThreadReadParams', params);
    return { thread: { id: 'hist-vps', turns: [{ id: 'turn-1', itemsView: 'full', items: [
      { id: 'u1', type: 'userMessage', content: [{ type: 'localImage', path: '/opt/print.png' }] },
      { id: 'p1', type: 'plan', text: 'Plano aprovado' },
      { id: 'i1', type: 'imageGeneration', status: 'completed', savedPath: '/opt/gerada.png', result: 'aW1hZ2Vt' },
      { id: 'a1', type: 'agentMessage', text: 'Concluído' },
    ] }] } };
  });
  const items = await h.call('sessions:history', { engine: 'codex', id: 'hist-vps', cwd: 'vps:/opt/projeto' });
  assert.equal(items.length, 4); assert.equal(items[0].role, 'user'); assert.equal(items[0].attachments[0].path, '/opt/print.png');
  assert.equal(items[1].role, 'plan'); assert.equal(items[2].role, 'image'); assert.equal(items[2].path, '/opt/gerada.png');
  assert.equal(h.wire[0].destino, 'vps'); assert.equal(h.wire.filter(x => x.method === 'thread/items/list').length, 0);
});

spec('histórico paginado busca páginas restantes e apresenta a ordem original', async () => {
  const h = loadMain(); h.attachCodex('local', (method, params) => {
    if (method === 'thread/read') return { thread: { id: 'paginated', turns: [{ id: 't1', itemsView: 'summary', items: [] }] } };
    assert.equal(method, 'thread/items/list'); schema('ThreadItemsListParams', params); assert.equal(params.sortDirection, 'desc');
    if (!params.cursor) return { data: [{ turnId: 't1', item: { id: 'a1', type: 'agentMessage', text: 'Terceira' } }, { turnId: 't1', item: { id: 'p1', type: 'plan', text: 'Segunda' } }], nextCursor: 'segunda-pagina' };
    assert.equal(params.cursor, 'segunda-pagina');
    return { data: [{ turnId: 't1', item: { id: 'u1', type: 'userMessage', content: [{ type: 'text', text: 'Primeira' }] } }], nextCursor: null };
  });
  const items = await h.call('sessions:history', { engine: 'codex', id: 'paginated', cwd: '/projeto' });
  assert.deepEqual(Array.from(items, x => x.text), ['Primeira', 'Segunda', 'Terceira']);
  assert.equal(h.wire.filter(x => x.method === 'thread/items/list').length, 2);
});

spec('histórico usa arquivo local quando o motor fica indisponível', async () => {
  const h = loadMain(); h.attachCodex('local', () => { throw new Error('motor indisponível'); });
  h.put('/historico/backup.jsonl', JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Texto preservado' }] } }));
  const items = await h.call('sessions:history', { engine: 'codex', id: 'id-1', file: '/historico/backup.jsonl', cwd: '/projeto' });
  assert.equal(items.length, 1); assert.equal(items[0].text, 'Texto preservado');
});

spec('histórico Claude continua legível com mensagens e ferramentas', async () => {
  const h = loadMain(); h.put('/historico/claude.jsonl', [
    { type: 'user', message: { content: 'Conferir a página' } },
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'pwd' } }, { type: 'text', text: 'Conferida' }] } },
    { type: 'user', isMeta: true, message: { content: 'Contexto interno' } },
  ].map(x => JSON.stringify(x)).join('\n'));
  const items = await h.call('sessions:history', { engine: 'claude', file: '/historico/claude.jsonl' });
  assert.deepEqual(Array.from(items, x => x.role), ['user', 'tool', 'bot']);
  assert.equal(items[1].arg, 'pwd'); assert.equal(items[2].text, 'Conferida'); assert.equal(h.spawned.length, 0);
});

spec('stop atrasado de conversa antiga não apaga destino e escolhas da nova conversa', async () => {
  const h = loadMain(); let releaseInterrupt;
  h.attachCodex('vps', async (method, params) => {
    if (method === 'turn/interrupt') return new Promise(resolve => { releaseInterrupt = resolve; });
    if (method === 'thread/resume') return { thread: { id: params.threadId }, model: params.model };
    return {};
  });
  await h.call('pane:start', { paneId: 1, engine: 'codex', cwd: 'vps:/opt/antiga', resumeId: 'antiga', model: 'gpt-6-astra', effort: 'high', approval: 'manual' });
  h.notify('turn/started', { threadId: 'antiga', turnId: 'turno-antigo' }, 'vps');
  const stopping = h.call('pane:stop', { paneId: 1, engine: 'codex' }); await Promise.resolve();
  assert.equal(typeof releaseInterrupt, 'function');
  await h.call('pane:start', { paneId: 1, engine: 'codex', cwd: 'vps:/opt/nova', resumeId: 'nova', model: 'gpt-5.6-terra', effort: 'xhigh', approval: 'manual' });
  releaseInterrupt({}); await stopping; h.clear();
  await h.call('pane:send', { paneId: 1, engine: 'codex', text: 'Continuar a nova' });
  const request = h.wire.find(x => x.method === 'turn/start'); assert.ok(request);
  assert.equal(request.destino, 'vps'); assert.equal(request.params.threadId, 'nova');
  assert.equal(request.params.model, 'gpt-5.6-terra'); assert.equal(request.params.effort, 'xhigh');
  assert.equal(request.params.cwd, '/opt/nova'); assert.equal(request.params.approvalPolicy, 'untrusted');
});

spec('resume com esforço antigo informa low como efetivo e preserva high para o próximo envio', async () => {
  const h = loadMain(); h.attachCodex('local', (method, params) => {
    if (method === 'thread/resume') return { thread: { id: params.threadId }, model: 'gpt-6-astra', reasoningEffort: 'low' };
    if (method === 'turn/start') {
      // Uma notificação real recebida durante o pedido deve vencer a intenção
      // local, inclusive quando o servidor aceita um esforço diferente.
      h.notify('thread/settings/updated', { threadId: 'effort-thread', threadSettings: { model: 'gpt-6-astra', reasoningEffort: 'medium' } });
      return { turn: { id: 'effort-turn', status: 'inProgress' } };
    }
    return {};
  });
  await h.call('pane:start', { paneId: 1, engine: 'codex', cwd: '/projeto', resumeId: 'effort-thread', model: 'gpt-6-astra', effort: 'high', approval: 'manual' });
  assert.equal(lastRequest(h, 'thread/resume').config.model_reasoning_effort, 'high');
  const resumed = one(h, 'settings'); assert.equal(resumed.effort, 'low'); assert.equal(resumed.pending, true);
  assert.equal(resumed.requestedSettings.effort, 'high');
  await h.call('pane:send', { paneId: 1, engine: 'codex', text: 'Executar agora' });
  const p = lastRequest(h, 'turn/start'); schema('TurnStartParams', p); assert.equal(p.effort, 'high');
  assert.equal(p.collaborationMode.settings.reasoning_effort, 'high');
  const effective = one(h, 'settings'); assert.equal(effective.effort, 'medium'); assert.equal(effective.pending, false);
  h.notify('thread/settings/updated', { threadId: 'effort-thread', threadSettings: { model: 'gpt-6-astra', reasoningEffort: 'low' } });
  assert.equal(one(h, 'settings').effort, 'low'); assert.equal(one(h, 'settings').pending, false);
});

spec('paneSettings preserva esforço pendente quando resume devolve o esforço anterior', async () => {
  const h = loadMain(); h.attachCodex('local', (method, params) => {
    if (method === 'thread/resume') return { thread: { id: params.threadId }, model: 'gpt-6-astra', reasoningEffort: 'low' };
    return {};
  });
  await h.call('pane:start', { paneId: 1, engine: 'codex', cwd: '/projeto', resumeId: 'effort-thread', model: 'gpt-6-astra', effort: 'low', approval: 'manual' });
  const response = await h.call('pane:settings', { paneId: 1, engine: 'codex', effort: 'high' });
  assert.equal(response.ok, true); assert.equal(response.pending, true);
  assert.equal(response.settings.effort, 'low'); assert.equal(response.requestedSettings.effort, 'high');
  await h.call('pane:send', { paneId: 1, engine: 'codex', text: 'Enviar com a escolha guardada' });
  const p = lastRequest(h, 'turn/start'); schema('TurnStartParams', p); assert.equal(p.effort, 'high');
  assert.equal(p.collaborationMode.settings.reasoning_effort, 'high');
  assert.equal(one(h, 'settings').pending, false);
});

spec('ativar contexto no envio não deixa resume com low substituir esforço high escolhido', async () => {
  const h = loadMain(); h.attachCodex('local', (method, params) => {
    if (method === 'thread/resume') return { thread: { id: params.threadId }, model: 'gpt-6-astra', reasoningEffort: 'low' };
    return {};
  });
  await h.call('pane:start', { paneId: 1, engine: 'codex', cwd: '/projeto', resumeId: 'effort-thread', model: 'gpt-6-astra', effort: 'low', approval: 'manual', experimentalContext: false }); h.clear();
  await h.call('pane:send', { paneId: 1, engine: 'codex', text: 'Usar contexto longo', effort: 'high', experimentalContext: true });
  const resume = lastRequest(h, 'thread/resume'); assert.equal(resume.config['features.context_management.experimental_mode'], true);
  assert.equal(resume.config.model_reasoning_effort, 'high');
  const p = lastRequest(h, 'turn/start'); schema('TurnStartParams', p); assert.equal(p.effort, 'high');
  assert.equal(p.collaborationMode.settings.reasoning_effort, 'high');
  assert.equal(one(h, 'settings').experimentalContext, true); assert.equal(one(h, 'settings').pending, false);
});
