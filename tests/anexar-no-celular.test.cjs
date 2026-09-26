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

test('no Mac o menu do + continua inteiro, na mesma ordem', () => {
  const l = itensDoMenu(false);
  assert.equal(atos(l), 'file,image,folder,cwd,recorte,foto');
  const img = l.find(i => i.act === 'image');
  // redesenho 26/09: os nomes do menu Anexar passaram a ser os do design ("Imagem…", "Pasta…"),
  // com "…" porque abrem outra janela; o que o item faz e a explicação continuam iguais
  assert.equal(img.nome, 'Imagem…');
  assert.equal(img.desc, 'png, jpg, webp');
});

test('no telefone nao sobra nenhum item que so daria um alerta', () => {
  const l = itensDoMenu(true);
  assert.equal(atos(l), 'image,cwd,foto');
  // 'file' e 'folder' sao os dois que o web.js so responde com alert()
  assert.equal(l.filter(i => i.act === 'file' || i.act === 'folder').length, 0);
});

test('no telefone o item de imagem avisa que video tambem vale', () => {
  const img = itensDoMenu(true).find(i => i.act === 'image');
  assert.match(img.nome, /vídeo/);
  assert.doesNotMatch(img.desc, /webp/, 'no celular quem manda e a galeria, nao a lista de extensoes');
});

/* A trava do outro lado: o nome "Enviar foto ou vídeo" so e verdade se o seletor do telefone
   deixar escolher video. Se alguem voltar o accept para so imagem, o rotulo vira mentira. */
test('o seletor do telefone aceita video, como o nome do item promete', () => {
  const web = fs.readFileSync(path.resolve(__dirname, '../renderer/web.js'), 'utf8');
  assert.match(web, /accept\s*=\s*'image\/\*,\s*video\/\*'/,
    "renderer/web.js precisa de inp.accept = 'image/*,video/*'");
});
