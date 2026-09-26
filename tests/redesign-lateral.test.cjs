'use strict';
/* Guarda da COLUNA LATERAL do redesenho (handoff do Claude Design, 25/09/2026).
   O que a área mudou e não pode voltar sem ninguém ver:
   - o tempo da lista no formato curto do desenho ("agora", "3 h", "ontem", "4 d"), à direita;
   - pasta + busca na mesma linha, com a lista de pastas presa a ela;
   - os Ajustes em cartões (Geral, Entrada, Avançado) sem perder nenhum controle que o app.js usa;
   - toggle ligado em verde do sistema, nada de caixa alta espaçada, nada de contorno azul na
     conversa aberta;
   - rotina com ▶ (ícone) no lugar da palavra "disparar", e a torre com o logo da IA. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const raiz = path.resolve(__dirname, '..');
const ler = (f) => fs.readFileSync(path.join(raiz, f), 'utf8');
const app = ler('renderer/app.js');
const css = ler('renderer/redesign/lateral.css');
const semComentario = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '');

function pegar(nome) {
  const i = app.indexOf('function ' + nome + '(');
  assert.ok(i >= 0, 'sumiu a funcao ' + nome);
  let n = 0;
  // a chave do CORPO: com parâmetro desestruturado ({ a, b }) a primeira chave é a dos parâmetros
  for (let k = app.indexOf(') {', i) + 2; k < app.length; k++) {
    if (app[k] === '{') n++;
    else if (app[k] === '}' && --n === 0) return app.slice(i, k + 1);
  }
  throw new Error('nao achei o fim de ' + nome);
}

test('o tempo da lista sai curto, como no desenho, e bate com os grupos de data', () => {
  // "agora" do teste: 26/09 às 15:00 (hora local), longe da meia-noite
  const agora = new Date(2026, 8, 26, 15, 0).getTime();
  const ctx = { Date: class extends Date { static now() { return agora; } } };
  vm.runInNewContext(pegar('quandoCurto') + '\nthis.q = quandoCurto;', ctx);
  const min = 60000, h = 60 * min;
  assert.equal(ctx.q(0), '', 'sem data não mostra nada');
  assert.equal(ctx.q(agora - 20 * 1000), 'agora');
  assert.equal(ctx.q(agora + 5 * min), 'agora', 'relógio adiantado não vira número negativo');
  assert.equal(ctx.q(agora - 12 * min), '12 min');
  assert.equal(ctx.q(agora - 3 * h), '3 h');
  // 23:30 de ontem: mais de 1 h atrás mas já é outro dia — o grupo em cima diz "Ontem"
  assert.equal(ctx.q(new Date(2026, 8, 25, 23, 30).getTime()), 'ontem');
  assert.equal(ctx.q(new Date(2026, 8, 22, 9, 0).getTime()), '4 d');
  assert.equal(ctx.q(new Date(2026, 7, 30, 9, 0).getTime()), '27 d');
  // a linha usa o formato curto; o quando() de sempre continua nas frases ("há 3h")
  assert.match(pegar('linhaConversa'), /\$\('\.hi-w', d\)\.textContent = quandoCurto\(s\.when\)/);
  assert.match(app, /function haQuanto\(ms\) \{ const q = quando\(ms\);/);
});

test('o tempo vai para a DIREITA do título sem mexer na ordem do HTML', () => {
  // a busca e os testes antigos contam com o .hi-w vindo antes do título no DOM: quem põe cada
  // peça no lugar do desenho é o order do CSS
  assert.match(pegar('linhaConversa'), /'<span class="hi-w"><\/span><span class="hi-t"><\/span>'/);
  const c = semComentario(css);
  const ordem = (sel) => Number((new RegExp('\\' + sel + '\\{order:(\\d+)').exec(c) || [])[1]);
  assert.ok(ordem('.hi-t') < ordem('.hi-motores') && ordem('.hi-motores') < ordem('.hi-w'),
    'título, logos das IAs e tempo, nessa ordem');
});

test('pasta e busca na mesma linha; a lista de pastas continua achável pelo app.js', () => {
  for (const pagina of ['renderer/index.html', 'renderer/index-web.html']) {
    const html = ler(pagina);
    const i = html.indexOf('<div class="side-ferramentas">');
    assert.ok(i > 0, pagina + ': sumiu a linha de pasta + busca');
    const linha = html.slice(i, html.indexOf('<div class="grp-abas"', i));
    assert.match(linha, /<button class="side-filtro" data-filtro="todas"[^>]*>.*<span class="sf-txt">Mac inteiro<\/span>/);
    assert.match(linha, /<label class="side-busca-cx">.*<input class="side-busca" data-busca="todas"/);
    // presa na linha: o popover abre logo abaixo dela (position:absolute no lateral.css)
    assert.match(linha, /<div class="side-pastas hidden" data-pastas="todas"><\/div>/);
  }
  assert.match(css, /\.side-ferramentas\{[^}]*position:relative/);
  assert.match(css, /\.side-pastas\{position:absolute;/);
});

test('Ajustes em cartões sem perder nenhum controle que o app.js liga', () => {
  const grupos = (html) => [...html.matchAll(/<div class="aj-gtit">([^<]+)<\/div>/g)].map((m) => m[1]);
  const mac = ler('renderer/index.html'), web = ler('renderer/index-web.html');
  assert.deepEqual(grupos(mac), ['Geral', 'Entrada', 'Avançado']);
  assert.deepEqual(grupos(web), ['Geral', 'Avançado'], 'no celular não há Celular nem Voz');
  const ids = (html) => ['fotoPrev', 'btnFoto', 'btnFotoTirar', 'btnDefCwd', 'defCwd', 'inboxBloco', 'inboxPasta',
    'btnInboxAbrir', 'chkRobos', 'verLine'].filter((id) => !html.includes('id="' + id + '"'));
  assert.deepEqual(ids(mac), [], 'Mac: sumiu controle');
  assert.deepEqual(ids(web), [], 'celular: sumiu controle');
  for (const id of ['chkWeb', 'webInfo', 'chkAtalhosGlobais', 'atalhosAviso']) assert.ok(mac.includes('id="' + id + '"'), id);
  for (const html of [mac, web]) {
    assert.equal((html.match(/class="tema-bt" data-aparencia="(auto|clara|escura)"/g) || []).length, 3);
    // o caminho mora DENTRO do botão que troca/abre a pasta (pop-up), e a caixa de entrada fica
    // por último no cartão do celular: escondida no meio, sobraria um fio a mais em cima da vizinha
    assert.match(html, /<button class="aj-pop" id="btnDefCwd"[^>]*><span class="path-box" id="defCwd">/);
    assert.match(html, /<button class="aj-pop" id="btnInboxAbrir"[^>]*><span class="path-box" id="inboxPasta">/);
  }
  const avancadoWeb = web.slice(web.indexOf('<div class="aj-gtit">Avançado</div>'));
  assert.ok(avancadoWeb.indexOf('id="verLine"') < avancadoWeb.indexOf('id="inboxBloco"'));
});

test('toggle verde, cartão fill-4 com raio 10, e nada de caixa alta espaçada', () => {
  const c = semComentario(css);
  assert.match(c, /\.chave input:checked\{background:var\(--status-ok\)\}/, 'ligado é o verde do sistema, não o azul');
  assert.match(c, /\.chave input\{width:32px;height:18px;/);
  assert.match(c, /\.aj-cartao\{[^}]*border-radius:10px;background:var\(--fill-4\);[^}]*box-shadow:inset 0 0 0 1px var\(--separator\)/);
  assert.match(c, /\.aj\{[^}]*min-height:36px/);
  // a única maiúscula forçada é a primeira letra do grupo ("no nome" -> "No nome"), sem espaçar
  assert.doesNotMatch(c.replace(/\.hist-cab::first-letter\{text-transform:uppercase\}/, ''), /text-transform:uppercase/,
    'caixa alta saiu da coluna');
  assert.doesNotMatch(c, /letter-spacing:(?!0)/, 'letra espaçada saiu');
  // coluna de 280 + 1 de borda; item de 28; conversa aberta = fill-1 e 600, sem contorno azul
  assert.match(c, /#sidebar\{width:281px;/);
  assert.match(c, /\.hist-item\{height:28px;/);
  assert.match(c, /\.hist-item\.on,\.hist-item\.aberta\{background:var\(--fill-1\);outline:0\}/);
  assert.match(c, /\.hist-item\.on \.hi-t,\.hist-item\.aberta \.hi-t\{font-weight:600\}/);
});

test('rotina com ▶ de 26 e torre com o logo da IA e o sinal de estado', () => {
  const rot = pegar('linhaDaRotina');
  assert.match(rot, /bt\.innerHTML = ico\('play'\)/);
  assert.match(rot, /bt\.setAttribute\('aria-label', 'Disparar agora'\)/);
  assert.doesNotMatch(rot, /textContent = 'disparar'/, 'a palavra "disparar" virou o ▶');
  assert.match(rot, /ico\('warn'\)/, 'a que parou ganha o triângulo');
  assert.doesNotMatch(pegar('dispararRotina'), /textContent = 'disparando…'/);
  const torre = pegar('linhaDaTorre');
  assert.match(torre, /svgMotor\(engine\)/, 'logo oficial da IA');
  assert.match(torre, /' rd-anel' : estado\.cls === 'espera' \? ' rd-espera'/, 'anel = trabalhando, "!" = esperando você');
  assert.match(pegar('pintarTorre'), /engine: P\.engine, foco: P === focusPane/);
  assert.match(css, /\.ri-acao\{flex:none;width:26px;height:26px;/);
});
