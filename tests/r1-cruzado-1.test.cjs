'use strict';

// Teste de guarda da faixa "cruzado" (R1, lote 1) — consertador do lote final, roda sozinho
// depois de todas as outras faixas.
// Cobre: R1-001 (desfazer de edicao grande acusava "arquivo mudou" mesmo intacto, e podia
// cortar o arquivo de verdade), R1-009 (terminal embutido sobrevivia a um ⌘R e ficava orfao),
// R1-050 (log "abas caindo... (ele fechou)" tambem nascia da fusao automatica de abas no boot).
// Padrao de arquivo: tests/main-harness.cjs + tests/r1-main-1.test.cjs (main.js inteiro em VM)
// e tests/abas-nao-somem.test.cjs (extrai o texto real do renderer por regex antes de rodar).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { loadMain } = require('./main-harness.cjs');

const CORTADO_MARCA = '\n… (cortado)';

// ---------- R1-001: desfazer de edicao cortada ----------
test('R1-001: "depois" cortado nao pode acusar "arquivo mudou" (o arquivo esta intacto)', () => {
  const h = loadMain();
  const arquivo = h.HOME + '/projeto/grande.js';
  h.put(arquivo, 'conteudo qualquer, ninguem mexeu depois da edicao');
  const depoisCortado = 'x'.repeat(40000) + CORTADO_MARCA;

  const r = h.call('arquivo:desfazer', { arquivo, antes: 'a', depois: depoisCortado });

  assert.equal(r.ok, undefined, 'nao pode dar ok:true — nao ha texto completo pra achar no arquivo');
  assert.equal(r.error, 'edição grande demais para desfazer automaticamente');
  assert.notEqual(r.error, 'o arquivo mudou depois dessa edição — desfazer aqui ia estragar',
    'essa mensagem e falsa aqui: o arquivo nao mudou, so o texto guardado foi cortado');
});

test('R1-001: "antes" cortado recusa em vez de arriscar cortar o arquivo de verdade', () => {
  const h = loadMain();
  const arquivo = h.HOME + '/projeto/grande2.js';
  const original = 'INICIO trecho-novo FIM';
  h.put(arquivo, original);
  const antesCortado = 'y'.repeat(40000) + CORTADO_MARCA;

  const r = h.call('arquivo:desfazer', { arquivo, antes: antesCortado, depois: 'trecho-novo' });

  assert.ok(r.error, 'tem de recusar (o "antes" cortado nao e o texto completo pra devolver)');
  assert.equal(h.files.get(arquivo).toString(), original, 'o arquivo real nao pode mudar');
});

test('R1-001: edicao pequena (sem corte) continua desfazendo normalmente — regressao', () => {
  const h = loadMain();
  const arquivo = h.HOME + '/projeto/pequeno.js';
  h.put(arquivo, 'const x = 1;\nconst y = NOVO;\n');

  const r = h.call('arquivo:desfazer', { arquivo, antes: 'VELHO', depois: 'NOVO' });

  assert.equal(r.ok, true);
  assert.equal(h.files.get(arquivo).toString(), 'const x = 1;\nconst y = VELHO;\n');
});

// ---------- R1-009: terminal embutido orfao apos recarregar a tela ----------
test('R1-009: recarregar a tela (⌘R) mata terminal aberto, nao so zera a caixa de entrada', () => {
  const h = loadMain();
  const fonte = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
  const m = /win\.webContents\.on\('did-start-loading',\s*\(\)\s*=>\s*\{([^}]*)\}\);/.exec(fonte);
  assert.ok(m, 'o listener did-start-loading da janela do Mac sumiu ou mudou de forma — confira o conserto');
  const corpo = m[1];

  // JSON.stringify aqui dentro: o objeto voltando cru do vm (outro realm) falha em deepEqual
  // por causa do Array/Object de outro contexto, mesmo com os valores identicos.
  const resultado = JSON.parse(h.evaluate(`
    (() => {
      const matados = [];
      terms.set('t1', { matar() { matados.push('t1'); } });
      terms.set('t2', { matar() { matados.push('t2'); } });
      inboxOuvinte = true;
      (() => { ${corpo} })();
      return JSON.stringify({ inboxOuvinte, termsRestantes: terms.size, matados: matados.slice().sort() });
    })()
  `));

  assert.equal(resultado.inboxOuvinte, false, 'continua zerando o ouvinte da caixa de entrada (comportamento antigo)');
  assert.equal(resultado.termsRestantes, 0, 'terminal aberto nao pode sobreviver a um recarregamento da tela');
  assert.deepEqual(resultado.matados, ['t1', 't2'], 'os dois terminais tem de ser mortos, nao so um por sorte de ID');
});

// ---------- R1-050: log "abas caindo... (ele fechou)" tambem nascia do agrupamento do boot ----------
// Ponta da tela: a linha que decide 'agrupou' vs 'fechou' vs nada, extraida do texto real do
// renderer (mesmo padrao de tests/abas-nao-somem.test.cjs) e rodada com os tres valores de fechou.
test('R1-050 (tela): savePanes distingue fechou / agrupou / nenhum na origem que manda pro Mac', () => {
  const fonte = fs.readFileSync(path.join(__dirname, '../renderer/app.js'), 'utf8');
  const linha = /const origemGravacao = ([^\n]+);/.exec(fonte);
  assert.ok(linha, 'a linha que monta a origem da gravacao sumiu do savePanes — confira o conserto');
  const expr = linha[1];

  // JSON.stringify antes de sair do vm: o objeto cru de outro realm falha em deepEqual mesmo
  // com valores identicos (Object/Array de outro contexto).
  const rodar = (fechou) => JSON.parse(JSON.stringify(
    vm.runInContext(`(function(fechou){ return ${expr}; })(${JSON.stringify(fechou)})`, vm.createContext({})),
  ));

  assert.deepEqual(rodar(true), { fechou: true }, 'clique dele (true) continua marcando fechou');
  assert.deepEqual(rodar('agrupou'), { agrupou: true }, "'agrupou' tem de virar { agrupou: true }, nao { fechou: true }");
  assert.equal(rodar(undefined), null, 'gravacao comum (sem motivo) continua sem marca nenhuma');
});

// Ponta do Mac: com a origem 'agrupou' chegando pelo config:set, o log tem de dizer isso — nao
// "(ele fechou)", que e mentira quando foi so a fusao automatica de abas no boot.
test('R1-050 (main): origem.agrupou grava log "(agrupou no boot)", nao "(ele fechou)"', () => {
  const h = loadMain();
  const arquivo = h.HOME + '/app-data/config.json';
  const aba = (cwd) => ({ cwd, ativo: 0, chats: [{ engine: 'claude', cwd, titulo: 'conversa de ' + cwd }] });
  h.put(arquivo, JSON.stringify({ abas: [aba('/p/a'), aba('/p/b'), aba('/p/c')], abaAberta: 0 }));

  // agrupamento no boot: 3 abas do disco viraram 2 (duas do mesmo cliente se fundiram) — sem
  // clique nenhum. abasQueNaoVoltaram vazio => todas voltaram => a conta pode legitimamente cair.
  const r = h.call('config:set', { abas: [aba('/p/a'), aba('/p/b')], abaAberta: 0 }, null, { agrupou: true });

  assert.equal(r.abasDevolvidas, 0, 'origem.agrupou tem licenca pra diminuir a lista, igual origem.fechou');
  const log = h.files.get(h.HOME + '/app-data/cockpit.log').toString();
  assert.match(log, /abas caindo de 3 para 2 \(agrupou no boot\): guardei config\.json\.anterior/);
  assert.doesNotMatch(log, /\(ele fechou\)/, 'agrupamento automatico nao pode aparecer como se ele tivesse clicado');
});

test('R1-050 (main): origem.fechou continua gravando "(ele fechou)" — regressao', () => {
  const h = loadMain();
  const arquivo = h.HOME + '/app-data/config.json';
  const aba = (cwd) => ({ cwd, ativo: 0, chats: [{ engine: 'claude', cwd, titulo: 'conversa de ' + cwd }] });
  h.put(arquivo, JSON.stringify({ abas: [aba('/p/a'), aba('/p/b')], abaAberta: 0 }));

  h.call('config:set', { abas: [aba('/p/a')], abaAberta: 0 }, null, { fechou: true });

  const log = h.files.get(h.HOME + '/app-data/cockpit.log').toString();
  assert.match(log, /abas caindo de 2 para 1 \(ele fechou\): guardei config\.json\.anterior/);
});
