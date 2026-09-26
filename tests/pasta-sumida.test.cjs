/* 26/09: chat e aba salvos na pasta velha (~/Desktop/Projetos-claude, que virou ~/Projetos) morriam
   com "spawn …/claude ENOENT". A migração conhecida só vale quando o destino exato existe. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const pegar = (n) => { const i = main.indexOf('function ' + n + '('); assert.ok(i >= 0, n); return main.slice(i, main.indexOf('\n}\n', i) + 2); };

test('pasta velha vira a nova; caminho ausente é preservado para escolha explícita', t => {
  const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'casa-'));
  t.after(() => fs.rmSync(HOME, { recursive: true, force: true }));
  const PASTA_PROJETOS = path.join(HOME, 'Projetos');
  fs.mkdirSync(path.join(PASTA_PROJETOS, 'Adsure'), { recursive: true });
  fs.mkdirSync(path.join(HOME, 'Desktop'), { recursive: true });
  const f = new Function('fs', 'path', 'HOME', 'PASTA_PROJETOS', pegar('pastaQueExiste') + pegar('corrigirPastasSumidas') + 'return { pastaQueExiste, corrigirPastasSumidas };')(fs, path, HOME, PASTA_PROJETOS);
  assert.equal(f.pastaQueExiste(path.join(HOME, 'Desktop/Projetos-claude/Adsure')), path.join(PASTA_PROJETOS, 'Adsure'));
  const sumiu = path.join(HOME, 'Desktop/Projetos-claude/Sumiu');
  const outra = path.join(HOME, 'Desktop/Outra/Coisa');
  assert.equal(f.pastaQueExiste(sumiu), sumiu);
  assert.equal(f.pastaQueExiste(outra), outra);
  assert.equal(f.pastaQueExiste('vps:/opt/x'), 'vps:/opt/x');
  const cfg = { abas: [{ cwd: path.join(HOME, 'Desktop/Projetos-claude/Adsure'), chats: [{ cwd: path.join(HOME, 'Desktop/Projetos-claude/Adsure') }] }] };
  f.corrigirPastasSumidas(cfg);
  assert.equal(cfg.abas[0].cwd, path.join(PASTA_PROJETOS, 'Adsure'));
  assert.equal(cfg.abas[0].chats[0].cwd, path.join(PASTA_PROJETOS, 'Adsure'));
});

test('ao abrir o app e ao ligar o chat', () => {
  assert.match(main, /corrigirPastasSumidas\(d\);\n  return d;/);
  assert.match(main, /const certa = pastaQueExiste\(cwd\);/);
  assert.match(main, /if \(certa !== cwd\) \{ data\.cwd = cwd = certa; emit\(paneId, 'pasta-movida'/);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'renderer/app.js'), 'utf8'), /case 'pasta-movida':/);
});
