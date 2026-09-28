// O Cockpit vai para outras pessoas: nada do dono desta máquina pode ir cravado no que entra no
// instalador. Servidor, vault, robôs e nome moram no ~/.cockpit/pessoal.json de cada um.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { loadMain } = require('./main-harness.cjs');

const raiz = path.resolve(__dirname, '..');
const PROIBIDO = /homero|motti|raissa|heitor|matheus|excel[eê]ncia prev|\/Users\/[a-z]|\/opt\/adsure|Adsure - (Copy|Sistemas)/i;

function arquivosDoInstalador() {
  const lista = [];
  const andar = (d) => {
    for (const n of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, n.name);
      if (n.isDirectory()) { if (n.name !== 'vendor' && n.name !== 'logos') andar(f); }
      else if (/\.(js|cjs|html|css|json)$/.test(n.name)) lista.push(f);
    }
  };
  andar(path.join(raiz, 'renderer'));
  for (const n of fs.readdirSync(raiz)) if (/\.js$/.test(n)) lista.push(path.join(raiz, n));
  lista.push(path.join(raiz, 'package.json'));
  return lista;
}

test('nenhum nome, pasta ou servidor pessoal no código que vai no instalador', () => {
  const achados = [];
  for (const f of arquivosDoInstalador()) {
    fs.readFileSync(f, 'utf8').split('\n').forEach((l, i) => {
      if (PROIBIDO.test(l)) achados.push(path.relative(raiz, f) + ':' + (i + 1) + '  ' + l.trim().slice(0, 100));
    });
  }
  assert.deepStrictEqual(achados, [], 'dado pessoal no código:\n' + achados.join('\n'));
});

test('sem o pessoal.json: sem servidor, sem vault e a instrução do Codex só pede o idioma', async () => {
  const h = loadMain({ pessoal: null });
  const info = await h.call('sys:pessoal');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(info)), { servidor: false, pastasServidor: [], nome: '' });
  const r = await h.call('vault:salvar', { titulo: 't', cwd: h.HOME, motor: 'Claude', texto: 'x' });
  assert.ok(r.error, 'sem vault configurado tem que recusar');
  const instr = h.evaluate('instrucoesCasa()');
  assert.strictEqual(instr, 'Responda SEMPRE em português do Brasil, nunca em inglês.');
});
