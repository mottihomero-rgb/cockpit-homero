'use strict';
// Guarda os consertos da TELA DO CELULAR que moram no renderer/celular.css.
// Cada teste aqui e um defeito que ele viu no video de 1m47 gravado no iPhone.
// O que estes testes protegem, em portugues: nada do celular pode vazar para o Mac,
// e nenhum dos consertos pode ser apagado sem alguem perceber.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.resolve(__dirname, '../renderer/celular.css'), 'utf8');

// so o que esta DENTRO da media query do celular; o resto vale para qualquer tela
const daMediaQuery = (() => {
  const i = css.indexOf('@media');
  return css.slice(i);
})();
const foraDaMediaQuery = css.slice(0, css.indexOf('@media'));

// tira os comentarios antes de procurar regra, senao um exemplo escrito num
// comentario faria o teste passar sem a regra existir
const semComentario = t => t.replace(/\/\*[\s\S]*?\*\//g, '');
const dentro = semComentario(daMediaQuery);
const fora = semComentario(foraDaMediaQuery);

test('o Mac nao carrega este arquivo: so a pagina do celular', () => {
  const web = fs.readFileSync(path.resolve(__dirname, '../renderer/index-web.html'), 'utf8');
  const mac = fs.readFileSync(path.resolve(__dirname, '../renderer/index.html'), 'utf8');
  assert.match(web, /celular\.css/, 'a pagina do celular precisa do estilo do celular');
  assert.ok(!mac.includes('celular.css'), 'a janela do Mac nao pode carregar o estilo do celular');
});

test('as chaves { } batem: CSS quebrado apaga a tela inteira', () => {
  const limpo = semComentario(css);
  assert.equal(limpo.split('{').length, limpo.split('}').length, 'sobrou ou faltou uma chave');
});

test('a pagina fica presa na tela: sem isso o teclado joga a barra de escrever para o topo', () => {
  assert.match(dentro, /body\{position:fixed;inset:0;/, 'body precisa de position:fixed no celular');
  assert.match(dentro, /height:var\(--altura-app,100dvh\)/, 'a altura vem do mobile.js');
  assert.ok(!/body\{[^}]*position:fixed/.test(fora), 'position:fixed nao pode valer fora do celular');
});

test('toda janela flutuante nasce ABAIXO da ilha dinamica, nao por baixo dela', () => {
  // --veu-topo manda em #novaAba, #agPainel, #telaAtalhos e .modal.global de uma vez so
  assert.match(dentro, /--veu-topo:calc\(46px \+ var\(--sat\)\)/);
  assert.match(fora, /--veu-topo:38px/, 'o valor do Mac continua de fora, para o Mac nao mudar');
});

test('a janela do time de agentes: simetrica e do tamanho do conteudo', () => {
  assert.match(dentro, /\.ag-cx\{width:100%;height:auto;max-height:100%\}/);
  assert.match(dentro, /\.ag-sub\{display:none\}/, 'o subtitulo ja esta na barra de cima');
});

test('a fileira de botoes cabe na tela e nenhum botao fica minusculo', () => {
  assert.match(dentro, /\.cb,\.p-send,\.p-stop,\.p-compactar,\.p-model,\.modo-btn\{width:44px;height:44px\}/);
  assert.match(dentro, /\.cmp-bar > \*\{flex:0 1 auto;min-width:32px\}/, 'piso de 32: abaixo disso o dedo pega o vizinho');
  assert.match(dentro, /\.cmp-gap\{flex:1 0 6px;min-width:0\}/, 'o espaco vazio do meio fica de fora do piso');
  assert.match(dentro, /\.p-modoenvio span,\.p-model span,\.modo-nome\{display:none\}/, 'so o icone, senao o rotulo vaza por cima do vizinho');
});

test('os tres botoes que ficaram so com icone continuam tendo nome escrito no title', () => {
  const web = fs.readFileSync(path.resolve(__dirname, '../renderer/index-web.html'), 'utf8');
  for (const cls of ['p-modoenvio', 'p-model', 'modo-btn p-modo']) {
    const achou = new RegExp('class="[^"]*' + cls + '[^"]*"[^>]*title="[^"]+"').test(web);
    assert.ok(achou, 'o botao ' + cls + ' ficou so com icone: precisa de title para continuar entendivel');
  }
});

test('o botao laranja de enviar nao borra o que esta atras dele', () => {
  assert.match(dentro, /box-shadow:-10px 0 0 0 var\(--bg2\)/, 'sombra solida, nao desfocada');
  assert.match(dentro, /\.cmp-bar\{[^}]*padding-right:0/, 'a fresta de 2px a direita do botao');
});

test('alvo de toque: o x do chat, o x do aviso e as linhas de menu dao 44', () => {
  assert.match(dentro, /\.p-close\{width:32px;height:32px;position:relative\}/);
  assert.match(dentro, /\.p-close::after\{content:"";position:absolute;inset:-6px\}/);   // 32 + 6 + 6 = 44
  assert.match(dentro, /\.uso-x\{width:26px;height:26px;position:relative\}/);
  assert.match(dentro, /\.uso-x::after\{content:"";position:absolute;inset:-9px\}/);      // 26 + 9 + 9 = 44
  assert.match(dentro, /\.mi\{padding:13px 10px;min-height:44px;box-sizing:border-box\}/);
  assert.match(dentro, /\.ch-lado\{padding:9px 8px/, 'trocar de motor e a coisa mais tocada do app');
});

test('a caixa de escrever nao come a tela nem empurra os botoes para fora', () => {
  assert.match(dentro, /\.p-input\{font-size:16px;max-height:96px\}/, '16px evita o zoom do iPhone; 96 devolve a conversa');
  assert.match(dentro, /\.pane-cmp\{[^}]*max-height:55%\}/, 'a caixa nunca passa de pouco mais da metade da tela');
  assert.match(dentro, /\.cmp-top\{flex:0 1 auto;min-height:26px;overflow-y:auto\}/, 'o texto rola por dentro');
  assert.match(dentro, /\.pane-nome\{display:none\}/, 'o nome do chat ja esta na barra de cima');
});

test('nao sobra faixa preta morta no rodape: a folga do iPhone vira recuo DENTRO da caixa', () => {
  assert.match(dentro, /\.pane-cmp\{margin:6px 8px;padding-bottom:calc\(6px \+ var\(--sab\)\)/);
  assert.ok(!/\.pane-cmp\{margin:6px 8px calc\(8px \+ var\(--sab\)\)/.test(dentro), 'a folga nao pode voltar para fora da caixa');
});

test('a conversa some suave nas duas pontas, em vez de cortar a linha ao meio', () => {
  assert.match(dentro, /\.pane-chat\{padding-bottom:18px/);
  for (const prop of ['-webkit-mask-image', 'mask-image']) {
    const re = new RegExp(prop + ':linear-gradient\\(to bottom,transparent 0,#000 12px,#000 calc\\(100% - 12px\\),transparent 100%\\)');
    assert.match(dentro, re, prop + ' precisa apagar em cima E embaixo');
  }
});

test('o menu do "+" sobe do rodape, nao abre como cartao no meio da tela', () => {
  assert.match(dentro, /\.modal\.como-menu\{place-items:end center\}/);
  assert.match(dentro, /\.modal\.como-menu \.modal-cx\{width:100%/);
  // a classe tem que existir de verdade no app.js, senao a regra nao pega em nada
  const app = fs.readFileSync(path.resolve(__dirname, '../renderer/app.js'), 'utf8');
  assert.match(app, /classList\.add\('como-menu'\)/, 'quem poe a classe como-menu e o app.js');
});

test('o aviso de limite quebra em duas linhas em vez de cortar a frase e o prazo', () => {
  assert.match(dentro, /\.p-uso\{white-space:normal;flex-wrap:wrap\}/);
  assert.match(dentro, /\.p-uso \.uso-alerta,\.p-uso \.uso-zera\{flex:none\}/, 'parar de encolher os dois ao mesmo tempo');
});

test('as cores saem de variavel: as quatro aparencias (clara, escura e as de contraste) tem que continuar valendo', () => {
  // #000 dentro de mask-image nao e cor, e o canal que diz "aqui aparece"; sombra preta e neutra
  const semMascara = dentro.replace(/mask-image:[^;}]+/g, '').replace(/box-shadow:0 0 \d+px #0{6}\w{2}/g, '');
  const cores = semMascara.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
  assert.deepEqual(cores.filter(c => !/^#0{6}\w{0,2}$/.test(c)), [], 'cor escrita na mao: usar variavel CSS');
});
