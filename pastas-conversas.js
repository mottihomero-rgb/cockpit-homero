'use strict';
const fs = require('node:fs');
const path = require('node:path');

// O vínculo é separado do arquivo original: reindexar ou atualizar não perde a organização.
function organizarPastas(lista, { home, dados }) {
  const projetos = path.join(home, 'Projetos');
  const antiga = path.join(home, 'Desktop', 'Projetos-claude');
  const dentro = (p, raiz) => p === raiz || p.startsWith(raiz + path.sep);
  const chave = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  let clientes = [], vinculos = {};
  try { clientes = fs.readdirSync(projetos, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name); } catch {}
  try { vinculos = JSON.parse(fs.readFileSync(path.join(dados, 'pastas-conversas.json'), 'utf8')).porArquivo || {}; } catch {}
  const diretorio = p => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
  return lista.map(s => {
    if (!s || !s.cwd || s.remoto || /^vps:/.test(s.cwd)) return s;
    let cwd = s.cwd;
    const vinculo = s.file && vinculos[s.file];
    if (typeof vinculo === 'string' && dentro(vinculo, projetos) && diretorio(vinculo)) cwd = vinculo;
    else {
      const base = dentro(cwd, antiga) ? antiga : dentro(cwd, projetos) ? projetos : '';
      if (base) {
        const resto = cwd.slice(base.length).replace(/^[\\/]+/, '');
        const [cliente, ...subpastas] = resto.split(path.sep);
        const iguais = clientes.filter(n => chave(n) === chave(cliente));
        if (!cliente && diretorio(projetos)) cwd = projetos;
        else if (iguais.length === 1) cwd = path.join(projetos, iguais[0], ...subpastas);
      }
    }
    return cwd === s.cwd ? s : { ...s, cwd };
  });
}
module.exports = { organizarPastas };
