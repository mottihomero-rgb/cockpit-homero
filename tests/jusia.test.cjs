'use strict';
/* Jus IA (05/11): a ponte local que traduz o Claude Code <-> chat do site da Jus IA.
   A Jus IA aqui é de mentira (fetchFn falso): nada sai do Mac. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { criarJusia, criarLimpador, textoDe, citacaoEmLink } = require('../jusia.js');

const TAG = '<mention-inline kind="law" id="1" ><span data-inline-ref="https://x.com/1" data-source="{&quot;title&quot;:&quot;Art. 42 da Lei&quot;,&quot;url&quot;:&quot;https://x.com/1&quot;}">&nbsp;</span></mention-inline>';

test('citação vira link markdown', () => {
  assert.strictEqual(citacaoEmLink(TAG), ' [Art. 42 da Lei](https://x.com/1)');
  assert.strictEqual(citacaoEmLink('<mention-inline><span data-inline-ref="https://y"></span></mention-inline>'), ' [fonte](https://y)');
});

test('limpador junta a marca partida em pedaços de qualquer tamanho', () => {
  const texto = 'Prazo de 10 dias ' + TAG + '.lei' + TAG + ' fim <b';
  for (const passo of [1, 3, 7, 50, 1000]) {
    const L = criarLimpador();
    let out = '';
    for (let i = 0; i < texto.length; i += passo) out += L.por(texto.slice(i, i + passo));
    out += L.fim();
    assert.strictEqual(out, 'Prazo de 10 dias [Art. 42 da Lei](https://x.com/1).lei [Art. 42 da Lei](https://x.com/1) fim <b', 'passo ' + passo);
  }
});

test('texto da pessoa sai sem os <system-reminder> do Claude Code', () => {
  const r = textoDe([
    { type: 'text', text: '<system-reminder>\nregras\n</system-reminder>' },
    { type: 'text', text: 'Qual o prazo?' },
    { type: 'image', source: {} },
  ]);
  assert.deepStrictEqual(r, { texto: 'Qual o prazo?', imagens: 1 });
  assert.strictEqual(textoDe('oi <system-reminder>x</system-reminder>').texto, 'oi');
});

// ---- ponte inteira, com a Jus IA de mentira ----
function sse(eventos) {
  const txt = eventos.map((e) => 'data: ' + JSON.stringify(e) + '\n\n').join('') + 'data: [DONE]\n\n';
  const bytes = new TextEncoder().encode(txt);
  return { ok: true, status: 200, body: (async function* () { for (let i = 0; i < bytes.length; i += 37) yield bytes.slice(i, i + 37); })(), text: async () => txt };
}
function montar(respostas) {
  const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'jusia-'));
  fs.mkdirSync(path.join(HOME, '.cockpit'));
  fs.writeFileSync(path.join(HOME, '.cockpit', 'jusia-sessao.json'), JSON.stringify({ conta: 'teste@exemplo.com', nome: 'Fulano', ua: 'UA', cookies: [{ name: 'user', value: 'abc', domain: '.jusbrasil.com.br' }] }));
  const pedidos = [];
  const fetchFn = async (url, op = {}) => {
    if (String(url).includes('127.0.0.1')) return globalThis.fetch(url, op);
    pedidos.push({ url, op, corpo: op.body ? JSON.parse(op.body) : null });
    const r = respostas.shift();
    return typeof r === 'function' ? r() : r;
  };
  let renovou = 0;
  const spawnFn = () => {
    renovou++;
    const ee = new (require('events'))();
    setTimeout(() => ee.emit('close', 0), 5);
    return ee;
  };
  fs.writeFileSync(path.join(HOME, '.cockpit', 'jusia-renovar.py'), '# falso');
  const j = criarJusia({ HOME, fetchFn, spawnFn });
  return { j, HOME, pedidos, renovou: () => renovou };
}
function perguntar(porta, corpo, sessao) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: porta, path: '/v1/messages?beta=true', method: 'POST',
      headers: { 'content-type': 'application/json', 'x-claude-code-session-id': sessao } }, (res) => {
      let b = ''; res.on('data', (d) => { b += d; }); res.on('end', () => resolve({ status: res.statusCode, corpo: b }));
    });
    req.on('error', reject); req.end(JSON.stringify(corpo));
  });
}
const eventosDe = (sseTxt) => sseTxt.split('\n').filter((l) => l.startsWith('data: ')).map((l) => JSON.parse(l.slice(6)));
const textoDaResposta = (ev) => ev.filter((e) => e.type === 'content_block_delta' && e.delta.type === 'text_delta').map((e) => e.delta.text).join('');

test('ponte: pergunta vai para a Jus IA, resposta volta no idioma da Anthropic e a conversa continua no mesmo fio', async () => {
  const { j, pedidos } = montar([
    sse([{ type: 'start' }, { type: 'tool-input-start', toolCallId: 'c1', toolName: 'jusSearch' },
      { type: 'tool-input-available', toolCallId: 'c1', toolName: 'jusSearch', input: { userInput: 'prazo recurso' } },
      { type: 'text-delta', id: 't', delta: '10 dias ' }, { type: 'text-delta', id: 't', delta: TAG.slice(0, 20) },
      { type: 'text-delta', id: 't', delta: TAG.slice(20) }, { type: 'finish' }]),
    sse([{ type: 'text-delta', id: 't', delta: 'segunda' }, { type: 'finish' }]),
  ]);
  // a ponte sobe na porta de verdade (20131); a Jus IA por trás é a de mentira
  const ok = await j.garantir();
  assert.ok(ok);
  const corpo = { model: 'jusia', stream: true, tools: [{ name: 'Bash' }], messages: [
    { role: 'user', content: [{ type: 'text', text: '<system-reminder>x</system-reminder>' }, { type: 'text', text: 'Qual o prazo?' }] }] };
  const r1 = await perguntar(j.PORTA, corpo, 'sessao-1');
  assert.strictEqual(r1.status, 200);
  const ev = eventosDe(r1.corpo);
  assert.strictEqual(ev[0].type, 'message_start');
  assert.strictEqual(ev[ev.length - 1].type, 'message_stop');
  assert.strictEqual(textoDaResposta(ev), '10 dias [Art. 42 da Lei](https://x.com/1)');
  assert.ok(ev.some((e) => e.delta && e.delta.type === 'thinking_delta' && /Pesquisando: prazo recurso/.test(e.delta.thinking)));
  assert.strictEqual(pedidos[0].corpo.messages[0].parts[0].text, 'Qual o prazo?');
  assert.strictEqual(pedidos[0].corpo.isFirstMessage, true);
  const fio = pedidos[0].corpo.threadId;

  corpo.messages.push({ role: 'assistant', content: [{ type: 'text', text: '10 dias' }] }, { role: 'user', content: 'E depois?' });
  const r2 = await perguntar(j.PORTA, corpo, 'sessao-1');
  assert.strictEqual(textoDaResposta(eventosDe(r2.corpo)), 'segunda');
  assert.strictEqual(pedidos[1].corpo.threadId, fio, 'mesma conversa da Jus IA');
  assert.strictEqual(pedidos[1].corpo.isFirstMessage, false);
  assert.strictEqual(pedidos[1].corpo.messages[0].parts[0].text, 'E depois?', 'só a pergunta nova: o histórico mora na Jus IA');
  j.parar();
});

test('ponte: login vencido (401) relê o login e tenta de novo uma vez', async () => {
  const { j, pedidos, renovou } = montar([
    { ok: false, status: 401, text: async () => '{"error":"Unauthorized"}' },
    sse([{ type: 'text-delta', id: 't', delta: 'ok' }]),
  ]);
  assert.ok(await j.garantir());
  const r = await perguntar(j.PORTA, { model: 'jusia', stream: true, tools: [{ name: 'Bash' }], messages: [{ role: 'user', content: 'oi' }] }, 's2');
  assert.strictEqual(textoDaResposta(eventosDe(r.corpo)), 'ok');
  assert.strictEqual(renovou(), 1);
  assert.strictEqual(pedidos.length, 2);
  j.parar();
});

test('ponte: conversa ramificada (sem fio na Jus IA) leva o que já foi dito', async () => {
  const { j, pedidos } = montar([sse([{ type: 'text-delta', id: 't', delta: 'ok' }])]);
  assert.ok(await j.garantir());
  await perguntar(j.PORTA, { model: 'jusia', stream: true, tools: [{ name: 'Bash' }], messages: [
    { role: 'user', content: 'primeira' }, { role: 'assistant', content: [{ type: 'text', text: 'resposta 1' }] }, { role: 'user', content: 'segunda' }] }, 'ramo');
  const enviado = pedidos[0].corpo.messages[0].parts[0].text;
  assert.match(enviado, /Eu: primeira/);
  assert.match(enviado, /Jus IA: resposta 1/);
  assert.match(enviado, /segunda$/);
  j.parar();
});

test('ler(): sem sessão = não entrou; com sessão mostra a conta', () => {
  const { j, HOME } = montar([]);
  assert.strictEqual(j.ler().entrou, true);
  assert.strictEqual(j.ler().email, 'teste@exemplo.com');
  j.sair();
  assert.strictEqual(fs.existsSync(path.join(HOME, '.cockpit', 'jusia-sessao.json')), false);
  assert.strictEqual(j.ler().entrou, false);
});
