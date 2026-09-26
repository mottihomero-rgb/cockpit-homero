'use strict';
// Conserto da caixa (26/09, rodada 1 da conferência do redesenho). Guarda o que a conferência
// achou faltando contra o desenho (README e Cockpit Janela.dc.html):
//   1. "Sempre permitir" no pedido de autorização, de ponta a ponta: o motor diz se oferece
//      (allowAlways no evento), a tela mostra o botão, e o "sempre" chega ao motor na língua dele
//      (Claude: updatedPermissions com as sugestões dele; Codex: acceptForSession /
//      approved_for_session / scope session). O ACP está no teste-acp-ponte.js.
//   2. As teclas do pedido (↩ Permitir, ⌥↩ Sempre permitir, esc Negar) e a dica delas no botão.
//   3. O número da linha no antes/depois do pedido, só quando dá para saber.
//   4. O anel de foco da caixa some com qualquer camada aberta por cima.
//   5. O botão do plano nos motores que têm o modo Plano.
//   6. Reduzir movimento para o microfone e o anel do Resumir conversa.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Ajv = require('ajv');
const { loadMain } = require('./main-harness.cjs');

const ler = (f) => fs.readFileSync(path.resolve(__dirname, '..', f), 'utf8');
const app = ler('renderer/app.js');
const css = ler('renderer/redesign/caixa.css');
const ajv = new Ajv({ allErrors: true, unknownFormats: 'ignore', logger: false });
const schema = (name, value) => {
  const check = ajv.compile(JSON.parse(ler('tests/fixtures/protocolo/' + name + '.json')));
  assert.ok(check(value), name + ': ' + JSON.stringify(check.errors));
};

function pegar(nome) {
  const m = new RegExp('^(?:async )?function ' + nome + '\\(', 'm').exec(app);
  assert.ok(m, nome + ' existe');
  return app.slice(m.index, app.indexOf('\n}', m.index) + 2);
}

/* ---------------- elemento falso, só o que as funções usam ---------------- */
function el(cls = '') {
  const c = new Set(cls.split(' ').filter(Boolean));
  const e = {
    nodes: {}, children: [], attrs: {}, textContent: '', innerHTML: '', disabled: false, cliques: 0, className: cls,
    classList: { add: (x) => c.add(x), remove: (x) => c.delete(x), contains: (x) => c.has(x),
      toggle: (x, on) => { if (on === undefined) on = !c.has(x); if (on) c.add(x); else c.delete(x); return on; } },
    appendChild(x) { this.children.push(x); return x; }, append(...xs) { this.children.push(...xs); },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    click() { this.cliques++; if (this.onclick) this.onclick(); },
  };
  return e;
}
const $ = (s, e) => (e && e.nodes && e.nodes[s]) || null;

/* ============================ 1. Sempre permitir no main.js ============================ */
function json(proc, value) { proc.stdout.emit('data', Buffer.from(JSON.stringify(value) + '\n')); }
async function claude(h, paneId = 3) {
  await h.call('pane:start', { paneId, engine: 'claude', cwd: '/projeto', approval: 'manual' });
  h.clear();
  return h.spawned.at(-1);
}
const SUGESTOES = [{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'npm test:*' }], behavior: 'allow', destination: 'localSettings' }];

test('Claude: pedido com sugestões oferece "Sempre permitir" e o "sempre" devolve as regras dele', async () => {
  const h = loadMain(); const p = await claude(h);
  const input = { command: 'npm test' };
  json(p.proc, { type: 'control_request', request_id: 'r1', request: { subtype: 'can_use_tool', tool_name: 'Bash', input, permission_suggestions: SUGESTOES } });
  const q = h.paneEvents('approval').at(-1);
  assert.equal(q.allowAlways, true, 'o cartão precisa saber que pode oferecer o botão');
  assert.equal(await h.call('pane:approve', { key: q.key, allow: true, sempre: true }), true);
  const r = p.writes.at(-1).response.response;
  assert.equal(r.behavior, 'allow'); assert.deepEqual(r.updatedInput, input);
  assert.deepEqual(r.updatedPermissions, SUGESTOES, 'o alcance da regra é o que o próprio Claude sugeriu');
});

test('Claude: permitir de uma vez continua sem regra nenhuma', async () => {
  const h = loadMain(); const p = await claude(h);
  json(p.proc, { type: 'control_request', request_id: 'r2', request: { subtype: 'can_use_tool', tool_name: 'Bash', input: { command: 'ls' }, permission_suggestions: SUGESTOES } });
  const q = h.paneEvents('approval').at(-1);
  await h.call('pane:approve', { key: q.key, allow: true });
  assert.equal(p.writes.at(-1).response.response.updatedPermissions, undefined);
});

test('Claude: sem sugestão, ou pedindo para esconder, não há "sempre" (nem se a tela mandar)', async () => {
  for (const extra of [{}, { permission_suggestions: SUGESTOES, suppress_always_allow_rule: true }]) {
    const h = loadMain(); const p = await claude(h);
    json(p.proc, { type: 'control_request', request_id: 'r3', request: { subtype: 'can_use_tool', tool_name: 'Bash', input: { command: 'rm x' }, ...extra } });
    const q = h.paneEvents('approval').at(-1);
    assert.equal(q.allowAlways, false);
    await h.call('pane:approve', { key: q.key, allow: true, sempre: true });
    assert.equal(p.writes.at(-1).response.response.updatedPermissions, undefined, 'o "sempre" que o pedido não ofereceu vira permitir de uma vez');
  }
});

test('Claude: "sempre" que troca o modo avisa a tela; default_to_no tira o Enter', async () => {
  const h = loadMain(); const p = await claude(h);
  json(p.proc, { type: 'control_request', request_id: 'r4', request: { subtype: 'can_use_tool', tool_name: 'Edit',
    input: { file_path: '/projeto/a.txt', old_string: 'a', new_string: 'b' },
    permission_suggestions: [{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }], default_to_no: true } });
  const q = h.paneEvents('approval').at(-1);
  assert.equal(q.sempreModo, 'auto-edit', 'o botão de permissão acompanha "Editar automaticamente"');
  assert.equal(q.semEnter, true);
});

test('pane:approve recusa "sempre" que não é sim/não', async () => {
  const h = loadMain(); const p = await claude(h);
  json(p.proc, { type: 'control_request', request_id: 'r5', request: { subtype: 'can_use_tool', tool_name: 'Bash', input: {}, permission_suggestions: SUGESTOES } });
  const q = h.paneEvents('approval').at(-1), antes = p.writes.length;
  assert.equal(await h.call('pane:approve', { key: q.key, allow: true, sempre: 'sim' }), false);
  assert.equal(p.writes.length, antes, 'nada foi respondido');
});

async function codex() {
  const h = loadMain(); h.attachCodex('local');
  await h.call('pane:start', { paneId: 1, engine: 'codex', cwd: '/projetos/cockpit', model: 'gpt-6-astra', approval: 'manual', resumeId: 'thread-local' });
  h.clear(); return h;
}
const pedir = (h, method, params, id) => h.incoming('local', { id, method, params: { threadId: 'thread-local', turnId: 'turn-local', itemId: 'i' + id, ...params } });
const resposta = (h) => h.wire.filter(x => x.id !== undefined && !x.method).at(-1).result;

test('Codex: "sempre" vira acceptForSession (e approved_for_session no protocolo antigo), no schema', async () => {
  const casos = [
    ['item/commandExecution/requestApproval', { command: 'npm test', cwd: '/projeto' }, 'CommandExecutionRequestApprovalResponse', 'acceptForSession'],
    ['item/fileChange/requestApproval', {}, 'FileChangeRequestApprovalResponse', 'acceptForSession'],
    ['execCommandApproval', { command: ['npm', 'test'] }, 'ExecCommandApprovalResponse', 'approved_for_session'],
    ['applyPatchApproval', {}, 'ApplyPatchApprovalResponse', 'approved_for_session'],
  ];
  let id = 70;
  for (const [method, params, shape, decisao] of casos) {
    const h = await codex();
    pedir(h, method, params, ++id);
    const q = h.paneEvents('approval').at(-1);
    assert.equal(q.allowAlways, true, method);
    await h.call('pane:approve', { key: q.key, allow: true, sempre: true });
    const r = resposta(h); schema(shape, r); assert.equal(r.decision, decisao, method);
  }
});

test('Codex: permissão adicional com "sempre" vale para a conversa (scope session); sem, só o turno', async () => {
  for (const [sempre, scope] of [[true, 'session'], [false, 'turn']]) {
    const h = await codex();
    pedir(h, 'item/permissions/requestApproval', { permissions: { network: { enabled: true } } }, 90);
    const q = h.paneEvents('approval').at(-1);
    await h.call('pane:approve', sempre ? { key: q.key, allow: true, sempre } : { key: q.key, allow: true });
    const r = resposta(h); schema('PermissionsRequestApprovalResponse', r); assert.equal(r.scope, scope);
  }
});

test('Codex: negar com "sempre" continua negando', async () => {
  const h = await codex();
  pedir(h, 'item/commandExecution/requestApproval', { command: 'rm -rf x' }, 95);
  const q = h.paneEvents('approval').at(-1);
  await h.call('pane:approve', { key: q.key, allow: false, sempre: true });
  assert.equal(resposta(h).decision, 'decline');
});

/* ============================ número da linha do pedido ============================ */
test('pedido de edição do Claude leva a linha onde o trecho começa (só quando é certo)', async () => {
  const h = loadMain(); const p = await claude(h);
  h.put('/projeto/pagina.html', 'a\nb\n<title>Manual 2025</title>\nc\n');
  h.put('/projeto/repete.html', 'x\ny\nx\n');
  const pedido = (id, input, tool = 'Edit') => {
    json(p.proc, { type: 'control_request', request_id: id, request: { subtype: 'can_use_tool', tool_name: tool, input } });
    return h.paneEvents('approval').at(-1).mudanca.partes[0];
  };
  assert.equal(pedido('n1', { file_path: '/projeto/pagina.html', old_string: '<title>Manual 2025</title>', new_string: '<title>Manual 2026</title>' }).linha, 3);
  assert.equal(pedido('n2', { file_path: '/projeto/repete.html', old_string: 'x', new_string: 'z' }).linha, undefined, 'trecho repetido: sem número');
  assert.equal(pedido('n3', { file_path: '/projeto/sumiu.html', old_string: 'a', new_string: 'b' }).linha, undefined, 'arquivo que não existe: sem número');
  assert.equal(pedido('n4', { file_path: '/projeto/novo.txt', content: 'um\ndois' }, 'Write').linha, 1, 'Write mostra o arquivo inteiro');
});

test('cartão numera antes e depois a partir da linha do pedido; sem linha, sem coluna', () => {
  const ctx = { document: { createElement: () => el() }, $, shortPath: (x) => x, duracaoCurta: () => '1s', Date, Number, String };
  vm.createContext(ctx);
  vm.runInContext(['partesDoPedido', 'pintarPedido', 'pintarHaPedido', 'linhasDoDiff', 'comContexto', 'numerarDesde']
    .map(pegar).join('\n') + '\nconst DIFF_TETO = 500, CONTEXTO = 3;\nthis.pintar = pintarPedido;', ctx);
  const cartao = () => { const bar = el(); for (const s of ['.pp-tit', '.pp-txt', '.pp-cam', '.pp-por']) bar.nodes[s] = el(); bar.nodes['.pp-diff'] = el('pp-diff hidden'); return bar; };
  let bar = cartao();
  ctx.pintar({ el: el() }, bar, { title: 'Claude quer usar: Edit', detail: '/p/a.html',
    mudanca: { arquivo: '/p/a.html', partes: [{ antes: '<title>2025</title>', depois: '<title>2026</title>', linha: 12 }] } });
  let dif = bar.nodes['.pp-diff'];
  assert.ok(dif.classList.contains('com-num'));
  const nums = dif.children.map(l => [l.children[0].className, l.children[0].textContent, l.children[1].textContent]);
  assert.deepEqual(nums, [['ppd-n', '12', '−'], ['ppd-n', '12', '+']], 'as duas linhas são a 12: a que sai e a que entra');
  bar = cartao();
  ctx.pintar({ el: el() }, bar, { title: 'Claude quer usar: Edit', detail: '/p/a.html', mudanca: { arquivo: '/p/a.html', partes: [{ antes: 'a', depois: 'b' }] } });
  dif = bar.nodes['.pp-diff'];
  assert.equal(dif.classList.contains('com-num'), false);
  assert.equal(dif.children[0].children[0].className, 'ppd-s', 'sem número inventado');
});

/* ============================ 2. a tela do pedido ============================ */
function cartaoDoPedido() {
  const bar = el('pane-perm hidden');
  for (const s of ['.pp-yes', '.pp-no', '.pp-sempre']) bar.nodes[s] = el(s.slice(1) + (s === '.pp-sempre' ? ' hidden' : ''));
  const P = { id: 'p1', engine: 'claude', mode: 'manual', el: el() }; P.el.nodes['.pane-perm'] = bar;
  const pedidos = [], avisos = [];
  const ctx = { $, marcarEspera() {}, pintarPedido() {}, chegadaDoPedido() {}, avisoTemp: (P, t) => avisos.push(t),
    pintarModo() { ctx.pintouModo = true; }, savePanes() {}, MODOS: { claude: [{ id: 'manual' }, { id: 'auto-edit' }] },
    window: { api: { approve: async (o) => { pedidos.push(o); return true; } } }, Date };
  vm.createContext(ctx);
  vm.runInContext(pegar('showApproval') + '\n' + pegar('teclaDoPedido') + '\nthis.show = showApproval; this.tecla = teclaDoPedido;', ctx);
  return { ctx, P, bar, pedidos };
}
const tecla = (key, extra = {}) => ({ key, altKey: false, metaKey: false, ctrlKey: false, shiftKey: false, isComposing: false,
  defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...extra });

test('cartão: "Sempre permitir" só aparece quando o motor oferece, e manda sempre: true', async () => {
  let { ctx, P, bar, pedidos } = cartaoDoPedido();
  ctx.show(P, { key: 'k1', title: 'Pode?' });
  assert.equal(bar.nodes['.pp-sempre'].classList.contains('hidden'), true);
  ({ ctx, P, bar, pedidos } = cartaoDoPedido());
  ctx.show(P, { key: 'k2', title: 'Pode?', allowAlways: true, sempreModo: 'auto-edit' });
  assert.equal(bar.nodes['.pp-sempre'].classList.contains('hidden'), false);
  await bar.nodes['.pp-sempre'].onclick();
  const simples = (x) => JSON.parse(JSON.stringify(x));   // objeto criado dentro do vm
  assert.deepEqual(simples(pedidos), [{ key: 'k2', allow: true, sempre: true }]);
  assert.equal(P.mode, 'auto-edit', 'o botão de permissão acompanha o modo que o "sempre" ligou');
  assert.ok(ctx.pintouModo);
  // permitir e negar continuam mandando só allow (sem o campo novo)
  ({ ctx, P, bar, pedidos } = cartaoDoPedido());
  ctx.show(P, { key: 'k3', title: 'Pode?', allowAlways: true });
  await bar.nodes['.pp-yes'].onclick();
  assert.deepEqual(simples(pedidos), [{ key: 'k3', allow: true }]);
  assert.equal(P.mode, 'manual');
});

test('teclas do pedido: ↩ permite, ⌥↩ sempre permite, esc nega; só com o cartão à vista', () => {
  const { ctx, P, bar } = cartaoDoPedido();
  assert.equal(ctx.tecla(P, tecla('Enter')), false, 'sem pedido, o Enter é do campo');
  ctx.show(P, { key: 'k', title: 'Pode?', allowAlways: true });
  const yes = bar.nodes['.pp-yes'], no = bar.nodes['.pp-no'], sempre = bar.nodes['.pp-sempre'];
  yes.onclick = no.onclick = sempre.onclick = null;   // só conta o clique (el.click conta sozinho)
  assert.equal(ctx.tecla(P, tecla('Enter')), true); assert.equal(yes.cliques, 1);
  assert.equal(ctx.tecla(P, tecla('Enter', { altKey: true })), true); assert.equal(sempre.cliques, 1);
  assert.equal(ctx.tecla(P, tecla('Escape')), true); assert.equal(no.cliques, 1);
  assert.equal(ctx.tecla(P, tecla('Enter', { metaKey: true })), false, '⌘↩ não é resposta ao pedido');
  assert.equal(ctx.tecla(P, tecla('Escape', { defaultPrevented: true })), false, 'Esc que outro campo já tratou não nega');
  bar.classList.add('hidden');
  assert.equal(ctx.tecla(P, tecla('Enter')), false, 'cartão escondido (outra aba): nada');
});

test('teclas do pedido: sem "sempre" o ⌥↩ não faz nada; pedido semEnter não aceita o ↩', () => {
  const { ctx, P, bar } = cartaoDoPedido();
  ctx.show(P, { key: 'k', title: 'Pode?', semEnter: true });
  const yes = bar.nodes['.pp-yes']; yes.onclick = null;
  assert.equal(ctx.tecla(P, tecla('Enter', { altKey: true })), false);
  assert.equal(ctx.tecla(P, tecla('Enter')), false); assert.equal(yes.cliques, 0);
  assert.ok(bar.classList.contains('pp-sem-enter'), 'e a dica ↩ some do botão');
});

test('Enter no campo: vazio responde ao pedido, com texto continua mandando a mensagem; Esc nega antes de parar', () => {
  assert.match(app, /if \(!inp\.value\.trim\(\) && !\(P\.anexos \|\| \[\]\)\.length && !P\.quadroColado\s*&& VIVO\.P !== P && DITADO\.P !== P && teclaDoPedido\(P, e\)\) return;\s*e\.preventDefault\(\); send\(P\);/);
  const i = app.indexOf('if (popupAberto) { fecharMenus();');
  const depois = app.slice(i, app.indexOf('window.api.paneInterrupt', i));
  assert.match(depois, /if \(focusPane && teclaDoPedido\(focusPane, e\)\) return;/, 'com pedido à vista, o Esc nega em vez de parar a IA');
});

test('moldes: "Sempre permitir" à esquerda e a tecla dentro de cada botão, no Mac e no celular', () => {
  for (const f of ['renderer/index.html', 'renderer/index-web.html']) {
    const t = ler(f);
    const i = t.indexOf('class="pp-btns"'), linha = t.slice(i, t.indexOf('</div>', i));
    assert.ok(linha.indexOf('pp-sempre') < linha.indexOf('pp-no') && linha.indexOf('pp-no') < linha.indexOf('pp-yes'), f);
    assert.match(linha, /class="pp-sempre hidden"[^>]*>Sempre permitir</);
    assert.match(linha, /Negar<span class="pp-tecla" aria-hidden="true">esc<\/span>/);
    assert.match(linha, /Permitir<span class="pp-tecla" aria-hidden="true">↩<\/span>/);
  }
  assert.match(css, /\.pp-sempre\{height:26px;padding:0 10px;margin-right:auto;[^}]*background:transparent;color:var\(--label-2\);font:500 13px/);
  assert.match(css, /\.pp-no \.pp-tecla\{color:var\(--label-3\)\}/);
  assert.match(css, /\.pp-yes \.pp-tecla\{opacity:\.7\}/);
  assert.match(css, /@media \(max-width: 820px\)[\s\S]*\.pp-tecla\{display:none\}/, 'no telefone não há teclado');
  const i = app.indexOf('const ATALHOS = ['), lista = app.slice(i, app.indexOf('\n];\n', i));
  assert.match(lista, /\['Autorização', \[\s*\['Enter', [^\n]*\],\s*\['Esc', 'Negar'\],\s*\['Alt\+Enter', /);
});

/* ============================ 4. anel de foco ============================ */
test('anel de foco da caixa some com qualquer camada aberta por cima', () => {
  const m = /body:has\(([^{]+)\) \.pane\.focus \.pane-cmp\{box-shadow:var\(--shadow-float\)\}/.exec(css);
  assert.ok(m, 'regra que tira o anel');
  for (const camada of ['.pane .p-modal:not(.hidden)', '.pane .p-visor:not(.hidden)', '#telaAtalhos:not(.hidden)', '#novaAba:not(.hidden)',
    '#modalGrupo:not(.hidden)', '#popGrupo:not(.hidden)', '#qdPainel:not(.hidden)', '#agPainel:not(.hidden)'])
    assert.ok(m[1].includes(camada), 'falta ' + camada);
  // e ela vem DEPOIS do anel (mesma media query do Mac), senão não ganha
  assert.ok(css.indexOf(m[0]) > css.indexOf('.pane.focus .pane-cmp{border-color:transparent;box-shadow:var(--shadow-float),var(--anel-foco)}'));
});

/* ============================ 5. botões da barra ============================ */
/* 26/09 (pedido dele): o checklist do plano fora do Codex saiu — fazia o mesmo que o "Plano" do
   cadeado, e um clique perdido reiniciava o chat e deixava o padrão de chat novo em Plano. */
test('botão do plano só no Codex; nos outros motores ele some', () => {
  const MODOS = { claude: [{ id: 'manual' }, { id: 'plan' }], gemini: [{ id: 'manual' }, { id: 'plan' }], grok: [{ id: 'manual' }, { id: 'bypass' }] };
  const ctx = { $, MODOS, ico: (n) => '<' + n + '>', modoDe: (P) => ({ id: P.mode }) };
  vm.createContext(ctx);
  vm.runInContext(pegar('pintarPlano') + '\nthis.f = pintarPlano;', ctx);
  const pane = (engine, mode) => { const P = { engine, mode, el: el() }; P.el.nodes['.p-plano'] = el('cb p-plano'); return P; };
  for (const engine of ['claude', 'gemini', 'grok']) {
    const P = pane(engine, 'plan'); ctx.f(P);
    assert.equal(P.el.nodes['.p-plano'].classList.contains('hidden'), true, engine + ': sem o checklist');
  }
  assert.match(pegar('pintarControlesCodex'), /if \(!codex\) \{ pintarPlano\(P\); return; \}/);
});

/* 26/09: "tem que funcionar como antes, só que com o visual de hoje" — o modo volta a ser
   escrito: raio + Entra, fila + Fila, numa pílula discreta */
test('modo de envio: raio no Entra, fila na Fila, sempre com a palavra', () => {
  const corpo = /const pintarEnvio = \(\) => \{([\s\S]*?)\n  \};/.exec(app)[1];
  assert.match(corpo, /ico\(entra \? 'zap' : 'queue'\)/);
  assert.match(css, /\.p-modoenvio span\{display:inline;/);
});

/* ============================ 6. reduzir movimento ============================ */
test('Reduzir movimento para o microfone e o anel do Resumir conversa', () => {
  const blocos = [...css.matchAll(/@media \(prefers-reduced-motion: reduce\)\{([\s\S]*?)\n\}/g)].map(m => m[1]).join('\n');
  assert.match(blocos, /\.p-mic\.gravando,\.p-mic\.pensando,\.p-compactar\.rodando \.an\{animation:none\}/);
});
