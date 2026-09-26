'use strict';
// 26/09: com pensamento antes da fala, o ao vivo vinha como 'b1' e o final picado como 'b0':
// a tela abria dois blocos com a mesma resposta.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadMain } = require('./main-harness.cjs');

async function chat() {
  const h = loadMain(); await h.call('pane:start', { paneId: 'p', engine: 'claude', cwd: h.HOME });
  await h.call('pane:send', { paneId: 'p', engine: 'claude', text: 'pedido' });
  return h;
}
const ids = (h, kind) => h.paneEvents(kind).map(e => e.id);

test('texto final herda o número do bloco ao vivo quando o pensamento vem antes', async () => {
  const h = await chat();
  h.evaluate(`
    claudeMessage('p',{type:'stream_event',event:{type:'message_start',message:{id:'m1'}}});
    claudeMessage('p',{type:'stream_event',event:{type:'content_block_delta',index:0,delta:{type:'thinking_delta',thinking:'hm'}}});
    claudeMessage('p',{type:'stream_event',event:{type:'content_block_delta',index:1,delta:{type:'text_delta',text:'BANANA'}}});
    claudeMessage('p',{type:'assistant',message:{id:'m1',content:[{type:'thinking',thinking:'hm'}]}});
    claudeMessage('p',{type:'assistant',message:{id:'m1',content:[{type:'text',text:'BANANA'}]}});
    claudeMessage('p',{type:'result',is_error:false});`);
  assert.deepEqual(ids(h, 'text-delta'), ['b1']);
  assert.deepEqual(ids(h, 'text-final'), ['b1']);
});

test('dois textos na mesma mensagem e mensagem nova no mesmo turno', async () => {
  const h = await chat();
  h.evaluate(`
    claudeMessage('p',{type:'stream_event',event:{type:'message_start',message:{id:'m1'}}});
    claudeMessage('p',{type:'stream_event',event:{type:'content_block_delta',index:1,delta:{type:'text_delta',text:'A'}}});
    claudeMessage('p',{type:'stream_event',event:{type:'content_block_delta',index:3,delta:{type:'text_delta',text:'B'}}});
    claudeMessage('p',{type:'assistant',message:{id:'m1',content:[{type:'text',text:'A'}]}});
    claudeMessage('p',{type:'assistant',message:{id:'m1',content:[{type:'text',text:'B'}]}});
    claudeMessage('p',{type:'stream_event',event:{type:'message_start',message:{id:'m2'}}});
    claudeMessage('p',{type:'stream_event',event:{type:'content_block_delta',index:0,delta:{type:'text_delta',text:'C'}}});
    claudeMessage('p',{type:'assistant',message:{id:'m2',content:[{type:'text',text:'C'}]}});`);
  assert.deepEqual(ids(h, 'text-final'), ['b1', 'b3', 'b0']);
});

test('sem ao vivo, o número continua sendo a posição do texto', async () => {
  const h = await chat();
  h.evaluate(`claudeMessage('p',{type:'assistant',message:{id:'m9',content:[{type:'thinking',thinking:'x'},{type:'text',text:'oi'}]}});`);
  assert.deepEqual(ids(h, 'text-final'), ['b1']);
});
