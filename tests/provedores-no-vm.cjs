'use strict';
/* Vários testes montam um "mini app" com pedaços do renderer/app.js dentro de um vm. As IAs de chave
   (DeepSeek, MiMo, Muse Spark) puseram quatro nomes novos nesses pedaços (EH_PROVEDOR, motorDaLista,
   PROVEDORES_IDS, PROVEDORES_UI). Em vez de repetir os quatro em cada teste, este arquivo lê a
   definição de verdade do app.js e entrega a todo contexto novo que ainda não tenha o nome. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const src = fs.readFileSync(path.resolve(__dirname, '../renderer/app.js'), 'utf8');
const i = src.indexOf('const PROVEDORES_UI = {');
const marca = "const EH_PROVEDOR = (e) =>";
const f = src.indexOf('\n', src.indexOf(marca));
if (i < 0 || f < 0) throw new Error('trecho das IAs de chave não encontrado no app.js');
const caixa = {};
vm.runInNewContext(src.slice(i, f) + '\nthis.r = { PROVEDORES_UI, PROVEDORES_IDS, EH_PROVEDOR, motorDaLista };', caixa);
const AJUDAS = caixa.r;

const completar = (obj) => {
  if (obj && typeof obj === 'object') for (const k of Object.keys(AJUDAS)) if (!(k in obj)) obj[k] = AJUDAS[k];
  return obj;
};
const createContext = vm.createContext;
vm.createContext = (obj, ...resto) => createContext(completar(obj === undefined ? {} : obj), ...resto);
const runInNewContext = vm.runInNewContext;
vm.runInNewContext = (code, obj, ...resto) => runInNewContext(code, completar(obj === undefined ? {} : obj), ...resto);
module.exports = AJUDAS;
