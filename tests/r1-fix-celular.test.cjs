'use strict';
// Rodada 1 de consertos do CELULAR depois do redesenho (26/09). Cada teste é um defeito que o
// caçador mediu no iPhone 15 (servidor-web + Chromium com toque) e que tem de continuar fora:
//   1-2. gaveta: o nome da conversa cortado em 7 a 13 letras (logos + tempo + 4 botões na fileira)
//   3.   busca: os logos das IAs por cima da pasta e do "…"
//   4.   Nova aba com as medidas do Mac (24/26/28 de altura) no telefone
//   5.   o uso de 4 IAs empurrando a lista para o fim da gaveta
//   6.   anel e parar grudados por cima do time e do cadeado
//   7.   Conta e Configuração sem nada para fechar (sem Concluir, sem ×, sem Esc)
//   8.   "Configuração do…" cortado pela pasta
//   9.   alvos do topo (+, × da aba, troca de IA) abaixo de 44
// Tudo é CSS de telefone: o teste lê só o bloco do celular de cada arquivo, para garantir que a
// regra existe E que ela não vaza para o Mac.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ler = (f) => fs.readFileSync(path.resolve(__dirname, '..', f), 'utf8');
const semComentario = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '');
const css = {
  lateral: semComentario(ler('renderer/redesign/lateral.css')),
  caixa: semComentario(ler('renderer/redesign/caixa.css')),
  sheets: semComentario(ler('renderer/redesign/sheets.css')),
  janela: semComentario(ler('renderer/redesign/janela.css')),
  painel: semComentario(ler('renderer/redesign/painel.css')),
};

// o corpo de um @media (do "{" dele até a chave que fecha), achado pelo cabeçalho
function bloco(texto, cabecalho, depois = 0) {
  const i = texto.indexOf(cabecalho, depois);
  assert.ok(i >= 0, 'falta o bloco ' + cabecalho);
  const abre = texto.indexOf('{', i);
  let n = 0;
  for (let k = abre; k < texto.length; k++) {
    if (texto[k] === '{') n++;
    else if (texto[k] === '}' && --n === 0) return texto.slice(abre + 1, k);
  }
  throw new Error('bloco sem fechar: ' + cabecalho);
}
const CEL = '@media (max-width: 820px), (pointer: coarse) and (max-width: 1100px)';
const fora = (texto, corpo) => texto.replace(corpo, '');

test('as chaves { } batem nos cinco arquivos mexidos', () => {
  for (const [nome, t] of Object.entries(css)) assert.equal(t.split('{').length, t.split('}').length, nome);
});

test('gaveta no telefone: nome na linha de cima inteira, logos e tempo embaixo, 44 de altura', () => {
  const cel = bloco(css.lateral, CEL);
  const linha = 'body:has(#btnGaveta) .hist-item:not(.com-trecho):not(.com-onde)';
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  assert.match(cel, new RegExp(esc(linha) + '\\{display:grid;\\s*grid-template-columns:auto auto minmax\\(0,1fr\\) repeat\\(4,20px\\)'));
  assert.match(cel, /min-height:44px;padding:6px 9px\}/, '6 + 16 + 2 + 14 + 6 = 44');
  assert.match(cel, new RegExp(esc(linha) + ' :is\\(\\.hi-t,\\.pn-input\\)\\{grid-column:1/4;grid-row:1\\}'), 'o nome (e o campo de renomear) tem a linha de cima');
  assert.match(cel, new RegExp(esc(linha) + ' \\.hi-motores\\{grid-column:1;grid-row:2\\}'));
  assert.match(cel, new RegExp(esc(linha) + ' \\.hi-w\\{display:block;grid-column:2;grid-row:2\\}'));
  assert.match(cel, /:is\(\.hi-fav,\.hi-edit,\.hi-grupo,\.hi-mais\)\{\s*grid-row:1\/3;width:20px;margin:0\}/, 'os 4 botões no meio das duas linhas');
  // o anel de toque de lado cabe no vão de 8 (4 + 4) sem um botão roubar o toque do outro
  assert.match(cel, /:is\(\.hi-fav,\.hi-edit,\.hi-grupo,\.hi-mais\)::after\{inset:-12px -4px\}/);
  assert.ok(!/grid-template-columns:auto auto minmax\(0,1fr\) repeat\(4,20px\)/.test(fora(css.lateral, cel)), 'no Mac a linha continua de uma fileira só');
});

test('busca no telefone: os logos descem para a linha do "IA · cliente" e saem de cima dos botões', () => {
  const cel = bloco(css.lateral, CEL);
  assert.match(cel, /body:has\(#btnGaveta\) \.hist-item\.com-onde\{display:grid;grid-template-columns:auto minmax\(0,1fr\) auto;/);
  assert.match(cel, /body:has\(#btnGaveta\) \.hist-item\.com-onde \.hi-motores\{grid-column:1;grid-row:2;float:none;/, 'sem o float:right do canto de cima');
  assert.match(cel, /body:has\(#btnGaveta\) \.hist-item\.com-onde \.hi-onde\{grid-column:2;grid-row:2;/);
  assert.match(cel, /body:has\(#btnGaveta\) \.hist-item\.com-onde \.hi-w\{position:static;display:block;grid-column:3;grid-row:2\}/);
});

test('uso do plano no telefone: uma linha por IA, sem barras', () => {
  const cel = bloco(css.lateral, CEL);
  assert.match(cel, /body:has\(#btnGaveta\) \.cv-uso-motor\{flex-direction:row;align-items:center;/);
  assert.match(cel, /body:has\(#btnGaveta\) :is\(\.cv-uso-plano,\.cv-uso-barra,\.cv-uso-zera\)\{display:none\}/);
  assert.match(cel, /body:has\(#btnGaveta\) \.cv-uso-janelas\{flex:none;flex-direction:row;/);
});

test('caixa no celular em pé: modo de envio, plano, quadro e time no "…", e a ponta direita sem empurrar ninguém', () => {
  const b = bloco(css.caixa, '@media (max-width: 480px)');
  assert.match(b, /\.cmp-bar \.p-modoenvio,\.cmp-bar \.p-plano,\.cmp-bar \.p-quadro,\.cmp-bar \.p-agentes\{display:none\}/);
  assert.match(b, /\.cmp-bar \.p-mais\{display:grid\}/);
  // 36 fixo + 4 de vão: o "right" de cada um é o lugar natural dele (sem rolar, ninguém é puxado)
  assert.match(b, /\.cmp-bar > :is\(\.p-compactar,\.p-stop,\.p-send\)\{flex:none;width:36px\}/);
  assert.match(b, /\.cmp-bar > \.p-stop\{right:40px;/);
  assert.match(b, /\.cmp-bar > \.p-compactar\{right:40px\}/);
  assert.match(b, /\.cmp-bar:has\(> \.p-stop:not\(\.hidden\)\) > \.p-compactar\{right:80px\}/);
  // o bloco vem DEPOIS do bloco do celular (que esconde o "…"), senão perde para ele
  assert.ok(css.caixa.indexOf('@media (max-width: 480px)') > css.caixa.indexOf(CEL));
});

test('Nova aba no telefone: segmentado, "Escolher pasta…", atalhos, caminho e Começar com 44', () => {
  const cel = bloco(css.sheets, '@media (max-width:820px),(pointer:coarse) and (max-width:1100px)');
  assert.match(cel, /\.na-onde\{height:44px\}/);
  assert.match(cel, /\.na-pasta\{width:100%;height:44px;/);
  assert.match(cel, /\.na-atalho\{height:44px;/);
  assert.match(cel, /\.na-caminho\{height:44px;[^}]*font-size:16px\}/, '16px: o Safari não dá zoom ao focar');
  assert.match(cel, /\.na-cancela,\.na-ok\{height:44px;/);
  assert.match(cel, /\.na-rodape > button\{flex:1\}/);
});

test('Conta e Configuração: sem "Concluir" na tela, o × volta (no telefone não há Esc)', () => {
  const cel = bloco(css.sheets, '@media (max-width:820px),(pointer:coarse) and (max-width:1100px)');
  assert.match(cel, /\.cx-conta:not\(:has\(#ctOk\)\) \.mo-x,\.cx-config:not\(:has\(#cfOk\)\) \.mo-x\{display:inline-block\}/);
  assert.match(cel, /\.mo-x::after\{content:"";position:absolute;inset:-8px\}/, '28 + 8 + 8 = 44 de toque');
  // os ids que a regra procura são os do "Concluir" de verdade
  const app = ler('renderer/app.js');
  assert.match(app, /<button class="mo-btn destaque" id="ctOk">Concluir<\/button>/);
  assert.match(app, /<button class="mo-btn destaque" id="cfOk">Concluir<\/button>/);
  // no Mac o × continua escondido, como no desenho
  assert.match(css.sheets, /\.cx-conta \.mo-x,\.cx-config \.mo-x\{display:none\}/);
});

test('Configuração do Claude: o título não encolhe, quem encolhe é a pasta', () => {
  const cel = bloco(css.sheets, '@media (max-width:820px),(pointer:coarse) and (max-width:1100px)');
  // precisa ganhar do ":is(.p-modal:not(.como-menu),.modal.global) .mo-tit{flex:0 1 auto}" (0,3,0)
  assert.match(cel, /:is\(\.p-modal:not\(\.como-menu\),\.modal\.global\) \.cx-config \.mo-tit\{flex-shrink:0\}/);
});

test('topo no telefone: "+", × da aba e troca de IA com 44 de toque', () => {
  const jan = bloco(css.janela, CEL);
  assert.match(jan, /#abasTopo \.aba-mais\{width:44px;height:44px;margin-left:0\}/);
  assert.match(jan, /#abasLista\{align-self:stretch\}/, 'senão a lista corta o anel do × nos 28 da aba');
  assert.match(jan, /\.aba \.aba-x\{position:relative;width:36px;margin:0 -12px 0 2px\}/);
  // 8 para a esquerda (cai no vão, não no contador) e 0 para a direita (não passa da aba)
  assert.match(jan, /\.aba \.aba-x::after\{content:"";position:absolute;inset:-8px 0 -8px -8px\}/);
  const pai = bloco(css.painel, '@media (max-width: 820px), (pointer: coarse) and (max-width: 1100px)');
  assert.match(pai, /:root:has\(\.so-celular\) \.ch-lado\{min-width:44px;justify-content:center\}/);
  assert.match(pai, /:root:has\(\.so-celular\) \.ch-lado::after\{content:"";position:absolute;inset:-6px 0\}/);
});
