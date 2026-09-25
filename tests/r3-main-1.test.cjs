'use strict';

// Testes de guarda do lote "main" (R3), faixa consertador, rodada 3/3.
// Cobrem: R3-003 (podarPorPasta rodava em SYNC a cada saveConfig, travando a interface),
// R3-013 (limite de sessao no meio da conversa nao era avisado, virava loop de "Continue"),
// R3-014 (regex unico que solta o fio 'sessao-sumiu' sem teste nenhum) e R3-022
// (acharNaConversa era codigo morto, removido). R3-021 nao entrou aqui (arquivo r2-main-1
// ja cobre o padrao de gravarCarimbosDepois/timer; adicionado como teste isolado abaixo
// mesmo assim, pra travar o comportamento exato do conserto).
// Padrao de arquivo: tests/main-harness.cjs (main.js inteiro numa VM).

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadMain } = require('./main-harness.cjs');

function json(proc, value) { proc.stdout.emit('data', Buffer.from(JSON.stringify(value) + '\n')); }
async function claude(h, paneId = 'p1') {
  await h.call('pane:start', { paneId, engine: 'claude', cwd: h.HOME });
  return h.spawned.at(-1).proc;
}

// ===================== R3-003 =====================
// saveConfig() so pode chamar podarPorPasta() de vez em quando (PODA_A_CADA), nao em toda
// gravacao — senao vira uma rodada de fs.existsSync SINCRONO por chave de cfg.porPasta a
// cada troca de aba, redimensionar de coluna etc.

test('R3-003: podarPorPasta so roda 1 vez a cada PODA_A_CADA saveConfig, nao em toda gravacao', () => {
  const h = loadMain();
  h.evaluate(`
    globalThis.__chamadasExists = 0;
    const __origExists = fs.existsSync.bind(fs);
    fs.existsSync = (p) => { globalThis.__chamadasExists++; return __origExists(p); };
  `);
  const cfg = { abas: [], porPasta: {} };
  for (let i = 0; i < 30; i++) cfg.porPasta['/pasta-inexistente-' + i + '|claude'] = { model: 'opus', effort: 'alto' };
  for (let i = 0; i < 25; i++) h.evaluate(`saveConfig(${JSON.stringify(cfg)})`);
  const chamadas = h.evaluate('globalThis.__chamadasExists');
  // sem o conserto: 25 gravacoes x 30 chaves = 750 chamadas de fs.existsSync so' pela poda.
  // com o conserto (1 rodada a cada 20): uma rodada de ~30 chamadas, nao 25.
  assert.ok(chamadas < 25 * 30 / 2,
    'saveConfig ainda esta chamando fs.existsSync pra CADA chave EM TODA gravacao (throttle nao aplicado): ' + chamadas + ' chamadas');
  assert.ok(chamadas > 0, 'a poda tem de rodar pelo menos 1 vez em 25 gravacoes seguidas (nao pode nunca rodar)');
});

test('R3-003: apos PODA_A_CADA gravacoes a poda ja aconteceu (pasta sumida ha dias some)', () => {
  const h = loadMain();
  const N = h.evaluate('PODA_A_CADA');
  const pastaSumida = h.HOME + '/pasta-sumida-ha-dias';
  const quatroDiasAtras = Date.now() - 4 * 24 * 60 * 60 * 1000;
  const cfg = {
    abas: [], porPasta: { [pastaSumida + '|claude']: { model: 'opus', effort: 'alto' } },
    porPastaAusenteDesde: { [pastaSumida + '|claude']: quatroDiasAtras },
  };
  for (let i = 0; i < N; i++) h.evaluate(`saveConfig(${JSON.stringify(cfg)})`);
  const final = h.evaluate('loadConfig()');
  assert.ok(!final.porPasta[pastaSumida + '|claude'], 'depois de N gravacoes a rodada de poda tem de ter acontecido pelo menos 1 vez');
});

// ===================== R3-013 =====================
// Limite de sessao batido no MEIO da conversa vinha como texto de assistente comum
// (model === '<synthetic>'), sem nenhum aviso — precisa emitir 'note' error alem do
// 'text-final' de sempre, sem duplicar nota identica em retentativas seguidas.

test('R3-013: resposta sintetica de limite de sessao emite note error ALEM do text-final', async () => {
  const h = loadMain();
  const proc = await claude(h);
  h.clear();
  const texto = "You've hit your session limit · resets 1pm (America/Sao_Paulo)";
  json(proc, { type: 'assistant', message: { model: '<synthetic>', content: [{ type: 'text', text: texto }] } });
  const notas = h.paneEvents('note');
  const finais = h.paneEvents('text-final');
  assert.equal(finais.length, 1, 'text-final original tem de continuar saindo igual (nao pode sumir nem mudar)');
  assert.equal(finais[0].text, texto);
  assert.equal(notas.length, 1, 'sem o conserto, nenhum aviso especial aparece e o usuario so ve uma resposta normal');
  assert.equal(notas[0].error, true);
  assert.equal(notas[0].text, texto, 'a nota tem de usar o texto ORIGINAL do CLI, nao uma frase fixa (o mesmo caminho cobre outros erros sinteticos: 529, sem internet, deslogado)');
});

test('R3-013: retentativa com o MESMO texto sintetico nao duplica a nota (dedupe)', async () => {
  const h = loadMain();
  const proc = await claude(h);
  h.clear();
  const texto = "You've hit your session limit · resets 1pm (America/Sao_Paulo)";
  // 2 retentativas seguidas ("Continue") batendo no MESMO limite -> CLI devolve o mesmo texto
  json(proc, { type: 'assistant', message: { model: '<synthetic>', content: [{ type: 'text', text: texto }] } });
  json(proc, { type: 'assistant', message: { model: '<synthetic>', content: [{ type: 'text', text: texto }] } });
  json(proc, { type: 'assistant', message: { model: '<synthetic>', content: [{ type: 'text', text: texto }] } });
  const notas = h.paneEvents('note').filter((n) => n.text === texto);
  assert.equal(notas.length, 1, 'sem o dedupe, cada "Continue"/retentativa com o MESMO texto enche a tela com o mesmo aviso repetido');
});

test('R3-013: resposta normal (nao sintetica) nao gera note extra — regressao', async () => {
  const h = loadMain();
  const proc = await claude(h);
  h.clear();
  json(proc, { type: 'assistant', message: { model: 'claude-opus-4-5', content: [{ type: 'text', text: 'resposta normal de trabalho' }] } });
  const notas = h.paneEvents('note');
  assert.equal(notas.length, 0, 'resposta com modelo normal nao pode virar aviso vermelho — so o caso sintetico');
});

// ===================== R3-014 =====================
// 'sessao-sumiu' e' o UNICO caminho que solta o resumeId preso (app.js:3603). Depende
// inteiramente de um regex hardcoded batendo no texto do erro do CLI. Sem teste nenhum antes.

test('R3-014: regex de sessao-sumiu ainda bate no texto exato que o CLI produz hoje', () => {
  const h = loadMain();
  const bate = h.evaluate("/No conversation found with session ID/i.test('No conversation found with session ID: abc123')");
  assert.equal(bate, true,
    'se uma atualizacao do CLI mudar essa frase, este teste quebra e avisa — sem ele a quebra e silenciosa (main.js:1128 e o UNICO lugar que solta o fio)');
});

test('R3-014: erro exato do CLI solta o fio (sessao-sumiu) de ponta a ponta, ao fechar o processo', async () => {
  const h = loadMain();
  const proc = await claude(h);
  h.clear();
  proc.stderr.emit('data', Buffer.from('No conversation found with session ID: abc123\n'));
  proc.emit('close', 1);
  const soltou = h.paneEvents('sessao-sumiu');
  assert.equal(soltou.length, 1, 'erro exato do CLI tem de soltar o fio (sessao-sumiu); sem isso o resumeId fica preso e a conversa martela --resume num id morto pra sempre');
});

test('R3-014: outro erro (engine caiu por outro motivo) NAO solta o fio — regressao', async () => {
  const h = loadMain();
  const proc = await claude(h);
  h.clear();
  proc.stderr.emit('data', Buffer.from('529 Overloaded\n'));
  proc.emit('close', 1);
  const soltou = h.paneEvents('sessao-sumiu');
  assert.equal(soltou.length, 0, 'erro que nao e "sessao nao existe mais" nao pode soltar o fio, senao a proxima mensagem perde o resumeId a toa');
});

// ===================== R3-022 =====================
// acharNaConversa() era codigo morto: zero chamadas em todo o projeto. Removida.

test('R3-022: acharNaConversa foi removida (era codigo morto, nunca chamada em lugar nenhum)', () => {
  const h = loadMain();
  assert.equal(h.evaluate('typeof acharNaConversa'), 'undefined',
    'a funcao morta acharNaConversa deveria ter sido removida do main.js');
});

// ===================== R3-021 =====================
// gravarCarimbosDepois() marcava carimbosSujos = false mesmo quando a gravacao em disco
// falhava — so pode marcar "salvo" quando gravarSeguro() de fato devolve true.

test('R3-021: gravacao que falha NAO marca carimbosSujos como false (nao mente "salvo")', () => {
  const h = loadMain();
  h.evaluate(`
    indCarimbos = { 'a.jsonl': { m: 1, t: 1 } };
    globalThis.__falhaUmaVez = true;
    const __origWrite = fs.writeFileSync.bind(fs);
    fs.writeFileSync = (nome, dados) => {
      if (globalThis.__falhaUmaVez) { globalThis.__falhaUmaVez = false; throw new Error('disco cheio'); }
      return __origWrite(nome, dados);
    };
  `);
  h.evaluate('gravarCarimbosDepois()');
  let [id] = [...h.timers.keys()];
  h.timers.get(id)();   // dispara os 4s com a gravacao falhando
  assert.equal(h.evaluate('carimbosSujos'), true,
    'sem o conserto, carimbosSujos vira false mesmo com a escrita em disco tendo falhado (proximo boot le indice velho)');

  // proxima rodada, sem falha: agora tem de voltar a false de verdade
  h.evaluate('gravarCarimbosDepois()');
  [id] = [...h.timers.keys()];
  h.timers.get(id)();
  assert.equal(h.evaluate('carimbosSujos'), false, 'apos gravar com sucesso, a flag tem de voltar a false');
});
