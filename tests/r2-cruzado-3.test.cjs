'use strict';

// Teste de guarda do lote "cruzado" (R2) — faixa consertador, rodada 2, lote 3.
// Cobre: R1-012-teste-desatualizado — o teste de r1-main-3.test.cjs ficou preso ao mecanismo
// antigo ("System Events") depois que R2-042 trocou a checagem de processo por pgrep. Este
// teste prova, isolado, que o mock baseado em pgrep bate com o main.js atual (sem precisar
// reler o arquivo inteiro pra confirmar).
// Padrao de arquivo: tests/main-harness.cjs + tests/r1-main-3.test.cjs.

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadMain } = require('./main-harness.cjs');

test('R1-012-teste-desatualizado: com pgrep dizendo "processo nao existe" pros dois, navegador:aba NUNCA chama osascript', async () => {
  const h = loadMain();
  h.evaluate(`
    globalThis.__bins = [];
    rodar = async (bin, args) => {
      globalThis.__bins.push(String(bin));
      if (String(bin) === '/usr/bin/pgrep') return { err: new Error('saiu com código 1'), out: '', errout: '' };
      return { err: null, out: '', errout: '' };
    };
  `);
  const r = await h.call('navegador:aba');
  const bins = h.evaluate('globalThis.__bins');
  // sem deepEqual: o array vem de outro realm (vm), e deepStrictEqual falha so pelo prototype
  assert.equal(bins.length, 2, 'so pgrep pode ser chamado quando os dois processos nao existem');
  assert.ok(bins.every((b) => b === '/usr/bin/pgrep'));
  assert.ok(r && r.error);
});

test('R1-012-teste-desatualizado: um mock que so reconhece "System Events" (o jeito antigo) faria o teste acima passar por engano — prova que o mock precisa ser por pgrep', async () => {
  const h = loadMain();
  h.evaluate(`
    globalThis.__osascriptChamado = false;
    rodar = async (bin, args) => {
      const script = args[1] || '';
      // mock ANTIGO: so trata como "checagem de processo" quem tiver "System Events" no texto.
      // Com o main.js atual (pgrep), essa condicao nunca bate, entao cai no else — que e'
      // exatamente o osascript real (o que abre o app escondido). Isso mede a falha descrita
      // no defeito: o mock velho deixa o teste "engolir" 4 chamadas em vez de 2.
      if (/System Events/.test(script)) return { err: null, out: 'false\\n', errout: '' };
      globalThis.__osascriptChamado = true;
      return { err: null, out: '', errout: '' };
    };
  `);
  await h.call('navegador:aba');
  assert.equal(h.evaluate('globalThis.__osascriptChamado'), true,
    'confirma o defeito: mock preso a "System Events" deixa passar a chamada de osascript que abriria o app escondido');
});
