'use strict';
/* No iPhone o menu do "+" mostrava dois itens que nao levavam a lugar nenhum: "Enviar do
   computador" e "Adicionar pasta". Os dois abrem janela de arquivo do MAC — pelo telefone o
   toque so dava um alerta dizendo que nao dava. Agora eles nem aparecem la, do mesmo jeito
   que o "Recortar a tela" ja fazia. E o item que sobrou mudou de nome, porque no celular ele
   tambem aceita video, nao so imagem. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const src = fs.readFileSync(path.resolve(__dirname, '../renderer/app.js'), 'utf8');

/* Pega a lista de itens de dentro do menuAnexo e a roda de verdade, uma vez como Mac e outra
   como telefone. Ler o texto do arquivo com regex nao provaria nada: o que decide e o valor
   de window.SEM_ELECTRON na hora em que a lista e montada. */
function itensDoMenu(noTelefone) {
  const m = src.indexOf('function menuAnexo(P) {');
  assert.ok(m >= 0, 'menuAnexo sumiu do app.js');
  const i = src.indexOf('const itens = [', m);
  const f = src.indexOf('\n  ];', i);
  assert.ok(i > 0 && f > i, 'a lista de itens do menuAnexo mudou de forma');
  const trecho = src.slice(i, f + 5);
  const caixa = { window: { SEM_ELECTRON: noTelefone }, shortPath: (c) => c, P: { cwd: '/Users/x' } };
  vm.createContext(caixa);
  return vm.runInContext(trecho + '\nitens;', caixa);
}

// a lista nasce dentro do vm (outro mundo): comparar como texto evita a briga de prototipo
const atos = (l) => l.map(i => i.act).join(',');

/* 26/09 (pedido dele): o + ficou com dois itens, cada um com o seu ícone — "Anexar arquivo"
   (uma janela só, que aceita arquivo, pasta, imagem e vídeo) e "Fotografar". Iguais no Mac e
   no telefone: lá o "Anexar arquivo" abre a galeria/arquivos do próprio celular. */
test('o + tem só Anexar arquivo e Fotografar, com ícone, no Mac e no telefone', () => {
  for (const tel of [false, true]) {
    const l = itensDoMenu(tel);
    assert.equal(atos(l), 'tudo,foto');
    assert.equal(l.map(i => i.nome).join('|'), 'Anexar arquivo|Fotografar');
    assert.equal(l.map(i => i.ic).join('|'), 'clip|camera');
  }
  assert.doesNotMatch(src, /Recortar a tela'|recortarTela\(/, 'o recorte de tela saiu do app');
});

test('Anexar arquivo pede ao Mac uma janela que aceita arquivo E pasta, vários de uma vez', () => {
  const main = fs.readFileSync(path.resolve(__dirname, '../main.js'), 'utf8');
  assert.match(main, /else if \(kind === 'tudo'\) opt\.properties\.push\('openFile', 'openDirectory'\)/);
  const web = fs.readFileSync(path.resolve(__dirname, '../renderer/web.js'), 'utf8');
  assert.match(web, /tipo === 'image' \|\| tipo === 'tudo'/, 'no celular o tudo abre a galeria');
});

/* A trava do outro lado: o nome "Enviar foto ou vídeo" so e verdade se o seletor do telefone
   deixar escolher video. Se alguem voltar o accept para so imagem, o rotulo vira mentira. */
test('o seletor do telefone aceita video, como o nome do item promete', () => {
  const web = fs.readFileSync(path.resolve(__dirname, '../renderer/web.js'), 'utf8');
  assert.match(web, /accept\s*=\s*'image\/\*,\s*video\/\*'/,
    "renderer/web.js precisa de inp.accept = 'image/*,video/*'");
});
