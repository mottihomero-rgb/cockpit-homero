'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { organizarPastas } = require('../pastas-conversas');
function ambiente(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pastas-conversas-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const dados = path.join(home, 'dados'), projetos = path.join(home, 'Projetos');
  for (const cliente of ['Pedro', 'Pedro Alimentos', 'Adsure', 'Excelência']) fs.mkdirSync(path.join(projetos, cliente), { recursive: true });
  fs.mkdirSync(dados);
  return { home, dados, projetos, aplicar: lista => organizarPastas(lista, { home, dados }) };
}
test('histórico antigo volta ao mesmo cliente, preservando arquivo, ID e contexto costurado', t => {
  const h = ambiente(t);
  const s = { engine: 'claude', id: 'original', file: '/arquivo/original.jsonl', cwd: path.join(h.home, 'Desktop/Projetos-claude/Pedro'), partes: [{ id: 'anterior' }] };
  const [r] = h.aplicar([s]);
  assert.equal(r.cwd, path.join(h.projetos, 'Pedro'));
  assert.equal(r.file, s.file); assert.equal(r.id, s.id); assert.equal(r.partes, s.partes);
  assert.equal(s.cwd, path.join(h.home, 'Desktop/Projetos-claude/Pedro'));
});
test('renomeação de Excelencia e as duas formas de acento convergem para a pasta real', t => {
  const h = ambiente(t);
  const lista = ['Desktop/Projetos-claude/Excelencia', 'Projetos/Excelência', 'Projetos/Excelência'].map(cwd => ({ cwd: path.join(h.home, cwd) }));
  assert.deepEqual(h.aplicar(lista).map(s => s.cwd), Array(3).fill(path.join(h.projetos, 'Excelência')));
});
test('subpasta removida continua no cliente sem confundir Pedro com Pedro Alimentos', t => {
  const h = ambiente(t);
  const r = h.aplicar(['Pedro', 'Pedro Alimentos'].map(c => ({ cwd: path.join(h.home, 'Desktop/Projetos-claude', c, 'subpasta removida') })));
  assert.equal(r[0].cwd, path.join(h.projetos, 'Pedro/subpasta removida'));
  assert.equal(r[1].cwd, path.join(h.projetos, 'Pedro Alimentos/subpasta removida'));
});
test('organização por contexto usa arquivo exato: sessões Codex com ID repetido continuam distintas', t => {
  const h = ambiente(t);
  fs.writeFileSync(path.join(h.dados, 'pastas-conversas.json'), JSON.stringify({ porArquivo: { '/a.jsonl': path.join(h.projetos, 'Pedro') } }));
  const r = h.aplicar(['/a.jsonl', '/b.jsonl'].map(file => ({ engine: 'codex', id: 'repetido', file, cwd: h.home })));
  assert.equal(r[0].cwd, path.join(h.projetos, 'Pedro')); assert.equal(r[1].cwd, h.home);
});
test('pasta desconhecida, vínculo inválido e sessão remota são preservados', t => {
  const h = ambiente(t);
  fs.writeFileSync(path.join(h.dados, 'pastas-conversas.json'), JSON.stringify({ porArquivo: { '/a': '/fora', '/b': path.join(h.projetos, 'Ausente'), '/r': path.join(h.projetos, 'Pedro') } }));
  const r = h.aplicar([{ file: '/a', cwd: h.home }, { file: '/b', cwd: h.home }, { file: '/r', cwd: 'vps:/srv/pedro', remoto: true }, { cwd: path.join(h.home, 'Desktop/Projetos-claude/Ausente') }]);
  assert.deepEqual(r.map(s => s.cwd), [h.home, h.home, 'vps:/srv/pedro', path.join(h.home, 'Desktop/Projetos-claude/Ausente')]);
});
test('nome sem acento ambíguo não une clientes diferentes', t => {
  const h = ambiente(t);
  fs.mkdirSync(path.join(h.projetos, 'Valeria')); fs.mkdirSync(path.join(h.projetos, 'Valéria'));
  const cwd = path.join(h.home, 'Desktop/Projetos-claude/VALERIA');
  assert.equal(h.aplicar([{ cwd }])[0].cwd, cwd);
});
