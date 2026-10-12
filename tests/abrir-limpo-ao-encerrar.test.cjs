'use strict';

// 04/10: fechar no X volta com as abas de antes; encerrar o app de vez abre limpo na proxima.
// So as abas abertas saem do config: senha do telefone, ajustes e o resto ficam.
// Padrao de arquivo: tests/main-harness.cjs (main.js inteiro numa VM).

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadMain } = require('./main-harness.cjs');

const ABAS = [
  { cwd: '/a', ativo: 0, chats: [{ sessao: 's1', titulo: 'Ajustes Cockpit' }] },
  { cwd: '/b', ativo: 0, chats: [{ sessao: 's2' }, { sessao: 's3' }] },
];
function montar() {
  const h = loadMain();
  const dados = path.posix.join(h.HOME, 'app-data');
  const cfgPath = path.posix.join(dados, 'config.json');
  const marca = path.posix.join(dados, 'abrir-limpo');
  h.put(cfgPath, JSON.stringify({ abas: ABAS, abaAberta: 1, tema: 'escuro', senhaWeb: 'segredo', webLigado: true, porPasta: { '/a|claude': { model: 'opus' } } }));
  h.evaluate('app.exit = () => {};');
  const ler = () => JSON.parse(h.files.get(cfgPath).toString());
  const encerrar = () => h.appEvents.get('before-quit')({ preventDefault() {} });
  return { h, cfgPath, marca, ler, encerrar };
}

test('fechar no X (sem encerrar) não deixa marca: as abas voltam como estavam', () => {
  const { h, marca, ler } = montar();
  h.evaluate('janelaJaAbriu = true;');
  h.appEvents.get('window-all-closed')();
  assert.equal(h.files.has(marca), false, 'fechar a janela não pode marcar abertura limpa');
  assert.equal(h.evaluate('abrirLimpoSeEncerrou()'), false);
  assert.equal(ler().abas.length, 2, 'as abas têm de continuar no config');
});

test('encerrar o app de vez deixa a marca e a próxima abertura vem sem aba nenhuma', () => {
  const { h, marca, cfgPath, ler, encerrar } = montar();
  h.evaluate('janelaJaAbriu = true;');
  encerrar();
  assert.equal(h.files.has(marca), true, 'o encerramento tem de deixar a marca');
  assert.equal(ler().abas.length, 2, 'na saída o config fica intacto: quem esvazia é o boot seguinte');

  assert.equal(h.evaluate('abrirLimpoSeEncerrou()'), true);
  const depois = ler();
  assert.deepEqual(depois.abas, [], 'a abertura depois de encerrar não traz aba');
  assert.equal(depois.abaAberta, 0);
  assert.equal(depois.senhaWeb, 'segredo', 'a senha do telefone fica');
  assert.equal(depois.webLigado, true);
  assert.equal(depois.tema, 'escuro', 'os ajustes ficam');
  assert.deepEqual(depois.porPasta, { '/a|claude': { model: 'opus' } }, 'a escolha de modelo por pasta fica');
  assert.equal(h.files.has(marca), false, 'a marca vale uma abertura só');
  assert.equal(JSON.parse(h.files.get(cfgPath + '.anterior').toString()).abas.length, 2, 'o retrato de antes fica guardado em config.json.anterior');
});

test('a marca vale uma vez: abas abertas depois dela voltam normalmente', () => {
  const { h, ler, encerrar } = montar();
  h.evaluate('janelaJaAbriu = true;');
  encerrar();
  h.evaluate('abrirLimpoSeEncerrou()');
  h.evaluate(`saveConfig(Object.assign(loadConfig(), { abas: [{ cwd: '/c', chats: [{ sessao: 's9' }] }] }))`);
  assert.equal(h.evaluate('abrirLimpoSeEncerrou()'), false);
  assert.equal(ler().abas.length, 1, 'a aba aberta depois continua lá');
});

test('2ª cópia barrada pela trava (nunca abriu janela) não marca', () => {
  const { h, marca, encerrar } = montar();
  encerrar();
  assert.equal(h.files.has(marca), false, 'a cópia que se fecha sozinha não pode limpar as abas da principal');
});

test('Mac desligando ou reiniciando não marca: as abas voltam', () => {
  const { h, marca, encerrar } = montar();
  h.evaluate('janelaJaAbriu = true; macDesligando = true;');
  encerrar();
  assert.equal(h.files.has(marca), false);
});
