'use strict';
/* Testes de guarda do lote "main" da rodada 3 (R3-001).
   Cada teste extrai o trecho REAL de main.js (não uma cópia reescrita à mão) e roda dentro
   do harness que carrega o main.js inteiro, para pegar o bug de verdade: sem o campo `evento`
   no pendingApprovals, o handshake pane:estado (R2-012) não repõe a aprovação/pergunta no
   celular depois do reconnect. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadMain } = require('./main-harness.cjs');

const mainSrc = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');

function extrair(re, nome) {
  const m = re.exec(mainSrc);
  assert.ok(m, nome + ' não encontrado em main.js (o trecho mudou de lugar?)');
  return m[1];
}

/* ===================== R3-001: aprovação do ACP não volta no reconnect do celular ===================== */

test('R3-001a main.js: aoPedirPermissao (cartão Permitir/Negar do ACP/Grok) guarda `evento` no pendingApprovals', () => {
  // pega o corpo REAL do callback aoPedirPermissao passado pro acp.js
  const corpo = extrair(/aoPedirPermissao: (\(paneId, rpcId, info\) => \{[\s\S]*?\n  \}),\n  aoCair:/, 'aoPedirPermissao');
  const h = loadMain();
  h.evaluate('const __testarAoPedirPermissao = ' + corpo + ';');
  h.evaluate("__testarAoPedirPermissao('p1', 'rpc1', { title: 'Rodar ferramenta X', detail: 'arg', tool: 'bash', rotulo: 'Bash' });");

  // 1) o registro em si tem o campo `evento`, no mesmo formato dos outros 6 pontos (cmd/file/perm/input/elicitation)
  const registro = h.evaluate("JSON.parse(JSON.stringify(pendingApprovals.get('acp_p1_rpc1')))");
  assert.equal(registro.kind, 'acp');
  assert.ok(registro.evento, 'pendingApprovals do ACP não tem `evento` — pane:estado não vai repor o cartão no celular');
  assert.equal(registro.evento.tipo, 'approval');
  assert.equal(registro.evento.dados.key, 'acp_p1_rpc1');
  assert.equal(registro.evento.dados.title, 'Rodar ferramenta X');

  // 2) fim a fim: pane:estado (o que o celular chama no reconnect) devolve a aprovação
  const r = h.call('pane:estado', { paneId: 'p1' });
  assert.ok(r.aprovacao, 'pane:estado voltou aprovacao=null: o celular não vai reexibir o cartão do ACP');
  assert.equal(r.aprovacao.tipo, 'approval');
  assert.equal(r.aprovacao.dados.key, 'acp_p1_rpc1');
});

test('R3-001b main.js: pergunta assíncrona do Codex (kind:async) guarda `evento` no pendingApprovals', () => {
  // pega o bloco REAL que trata it.delivery === 'async' dentro de item/completed
  const bloco = extrair(/(if \(it\.delivery === 'async'[\s\S]*?\n        \})\n/, "bloco 'async' do Codex");
  const h = loadMain();
  h.evaluate('function __testarAsync(it, destino, params, pane, pendingApprovals, emit) { ' + bloco + ' }');
  h.evaluate(`__testarAsync(
    { delivery: 'async', questions: [{ title: 'Pode seguir?' }], id: 'item1' },
    'local', { threadId: 'th1' }, 'p1', pendingApprovals, emit
  );`);

  const registro = h.evaluate("JSON.parse(JSON.stringify(pendingApprovals.get('async_local_item1')))");
  assert.equal(registro.kind, 'async');
  assert.ok(registro.evento, 'pendingApprovals async do Codex não tem `evento` — pane:estado não vai repor a pergunta no celular');
  assert.equal(registro.evento.tipo, 'question');
  assert.equal(registro.evento.dados.key, 'async_local_item1');
  assert.equal(registro.evento.dados.questionKind, 'async');

  const r = h.call('pane:estado', { paneId: 'p1' });
  assert.ok(r.aprovacao, 'pane:estado voltou aprovacao=null: o celular não vai reexibir a pergunta assíncrona do Codex');
  assert.equal(r.aprovacao.tipo, 'question');
});

/* ===================== R3-026: rename com ' -> ' literal no nome ANTIGO ===================== */

test("R3-026 main.js: git:status separa 'antigo -> novo' sem quebrar quando o nome ANTIGO citado contém ' -> '", () => {
  // pega o trecho REAL que interpreta cada linha do `git status --porcelain`
  const corpo = extrair(
    /(const estado = l\.slice\(0, 2\)\.trim\(\);[\s\S]*?nome = inteiro \|\| gitCitado\(nome\) \|\| nome;)/,
    'parser de linha do git:status'
  );
  const h = loadMain();
  h.evaluate('function __processarLinha(l) { ' + corpo + ' return { estado, nome }; }');
  const processar = (l) => JSON.parse(JSON.stringify(h.evaluate('__processarLinha(' + JSON.stringify(l) + ')')));

  // caso 1: arquivo comum, sem aspas nem rename
  assert.deepEqual(processar('M  arquivo.txt'), { estado: 'M', nome: 'arquivo.txt' });

  // caso 2: nome citado simples (tem espaço), sem rename
  assert.deepEqual(processar('M  "nome com espaço.txt"'), { estado: 'M', nome: 'nome com espaço.txt' });

  // caso 3: rename simples, sem aspas
  assert.deepEqual(processar('R  antigo.txt -> novo.txt'), { estado: 'R', nome: 'novo.txt' });

  // caso 4 (o bug): nome ANTIGO citado porque tem espaço, e esse nome tem ' -> ' dentro dele.
  // git cita esse nome (confirmado: git 2.54 cita por causa do espaço) e o parser antigo cortava
  // pela PRIMEIRA seta, que cai dentro das aspas, produzindo 'after.txt" -> notes.txt'.
  assert.deepEqual(processar('R  "before -> after.txt" -> notes.txt'), { estado: 'R', nome: 'notes.txt' },
    "nome antigo com ' -> ' dentro das aspas não pode vazar pro nome final");
});
