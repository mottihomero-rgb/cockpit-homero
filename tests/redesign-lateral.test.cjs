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
    const i = html.indexOf('<div class="side-ferramentas');
    assert.ok(i > 0, pagina + ': sumiu a linha de pasta + busca');
    const linha = html.slice(i, html.indexOf('<div class="grp-abas"', i));
    // Mac (26/09): "+ Inicie um novo chat" vem antes, e a linha é só lupa + pasta (ícones)
    if (pagina.endsWith('index.html')) {
      assert.ok(html.indexOf('class="new-chat"') < i, 'o novo chat fica em cima da lupa e da pasta');
      assert.match(linha, /^<div class="side-ferramentas icones">\s*<button class="side-lupa"/);
    }
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
  assert.deepEqual(grupos(mac), ['Contas', 'Geral', 'Entrada', 'Avançado'], 'Contas no topo: vincular conta num botão só (26/09)');
  assert.deepEqual(grupos(web), ['Geral', 'Avançado'], 'no celular não há Celular nem Voz');
  const ids = (html) => ['fotoPrev', 'btnFoto', 'btnFotoTirar', 'btnDefCwd', 'defCwd', 'inboxBloco', 'inboxPasta',
    'btnInboxAbrir', 'chkRobos', 'verLine'].filter((id) => !html.includes('id="' + id + '"'));
  assert.deepEqual(ids(mac), [], 'Mac: sumiu controle');
  assert.deepEqual(ids(web), [], 'celular: sumiu controle');
  for (const id of ['chkWeb', 'webInfo', 'chkAtalhosGlobais', 'atalhosAviso']) assert.ok(mac.includes('id="' + id + '"'), id);
  for (const html of [mac, web]) {
    // Aparência é pop-up (26/09): <select> com as três opções dentro do botão de 22
    assert.match(html, /<label class="aj-pop aj-sel"><span class="path-box" id="aparenciaTxt">[^<]*<\/span>.*<select id="selAparencia"[^>]*><option value="auto">Automática<\/option><option value="clara">Clara<\/option><option value="escura">Escura<\/option><\/select><\/label>/);
    assert.doesNotMatch(html, /class="tema-bt"/, 'o segmentado saiu');
    // Versão sem (i): a explicação mora na dica da linha
    assert.match(html, /<section class="aj" title="Acesso total ligado[^"]*">\s*<div class="aj-tit">Versão<\/div>/);
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
  // selecionada é UMA: a do chat em foco (.no-foco); aberta em outro chat só ganha peso 500
  assert.match(c, /\.hist-item\.on,\.hist-item\.aberta\{background:transparent;outline:0\}/);
  assert.match(c, /\.hist-item\.no-foco\{background:var\(--fill-1\)\}/);
  assert.match(c, /\.hist-item\.no-foco \.hi-t\{font-weight:600\}/);
  assert.match(c, /\.aj \+ \.aj\{[^}]*min-height:37px/, '36 de linha + 1 de fio');
});

test('rotina com ▶ de 26 e torre com o logo da IA e o sinal de estado', () => {
  const torre = pegar('linhaDaTorre');
  assert.match(torre, /svgMotor\(engine\)/, 'logo oficial da IA');
  assert.match(torre, /' rd-anel' : estado\.cls === 'espera' \? ' rd-espera'/, 'anel = trabalhando, "!" = esperando você');
  assert.match(pegar('pintarTorre'), /engine: P\.engine, foco: P === focusPane/);
  assert.match(css, /\.ri-acao\{flex:none;width:26px;height:26px;/);
});

test('a selecionada da lista segue o chat em foco', () => {
  const pa = pegar('pintarAberta');
  assert.match(pa, /d\.classList\.toggle\('no-foco'/);
  assert.match(pa, /F\.resumeId === sid \|\| F\.sessaoId === sid/);
  assert.match(pegar('setFocus'), /marcarAbertas\(\);/, 'trocar de chat repinta a selecionada');
});

test('torre e rotinas sem linha de resumo e com as palavras curtas do desenho', () => {
  const torre = pegar('pintarTorre');
  assert.match(torre, /textContent = 'Fora do app'/);
  assert.doesNotMatch(torre, /Fora do Cockpit/);
  assert.doesNotMatch(torre, /box\.appendChild\(resumo\)/, 'a contagem saiu da tela (foi para a dica)');
  const lt = pegar('linhaDaTorre');
  assert.match(lt, /estado\.cls === 'espera' \? 'esperando você'/);
  assert.match(lt, /'parado, motor ligado' \? 'pronto'/);
  assert.match(lt, /' rd-nova'/, 'resposta nova = ponto azul');
  const c = semComentario(css);
  // o ▶ desativado é o do botão normal da folha do Sistema (label-4 sobre fill-4 sumia no claro)
  assert.match(c, /\.ri-acao:disabled,\.ri-acao:disabled:hover\{opacity:1;background:var\(--fill-3\);color:var\(--label-3\)/);
  // os botões da sessão de fora QUEBRAM de linha na coluna estreita, em vez de sair cortados
  assert.match(c, /\.ti-acoes\{[^}]*flex-wrap:wrap/);
});

test('busca: a palavra achada cai na parte visível do trecho', () => {
  const ctx = {};
  vm.runInNewContext(pegar('trechoPerto') + '\nthis.f = trechoPerto;', ctx);
  const t = '…no Higgsfield com o seu Google pra ver se o checkout novo da página abre certo no celular';
  const r = ctx.f(t, 'checkout');
  assert.ok(r.startsWith('…'));
  assert.ok(r.toLowerCase().indexOf('checkout') <= 20, 'a marca tem de ficar no começo da linha: ' + r);
  assert.ok(r.endsWith('abre certo no celular'), 'o que vem depois fica igual');
  assert.equal(ctx.f('o checkout abriu', 'checkout'), 'o checkout abriu', 'perto do começo não mexe');
  assert.equal(ctx.f('nada a ver aqui com isso tudo junto', 'xyz'), 'nada a ver aqui com isso tudo junto');
  assert.match(pegar('linhaConversa'), /marcarTermo\(\$\('\.hi-trecho', d\), trechoPerto\(trecho, termo\), termo\)/);
});

test('uso por IA: nome da IA na linha, conta na dica; ↻ só no hover do cabeçalho; busca 16px só no celular', () => {
  const b = pegar('pintarBlocoDeUso');
  assert.match(b, /\$\('\.cv-uso-nome', bloco\)\.textContent = motor;/);
  const c = semComentario(css);
  assert.match(c, /\.cv-uso-logo\{width:16px;height:16px\}/);
  assert.match(c, /\.cv-uso-motor\{gap:12px;/);
  assert.match(c, /@media \(hover:hover\)\{\s*\.side-head \.mini\{position:absolute;[^}]*opacity:0\}/);
  assert.doesNotMatch(c, /\n\s*\.side-busca\{font-size:16px\}/, 'sem o guarda do celular a busca virava 16px numa janela estreita do Mac');
  assert.match(c, /body:has\(#btnGaveta\) \.side-busca\{font-size:16px\}/);
});

/* ---- rodada 1 de consertos da área lateral (26/09) ---- */

test('logo da IA numa cor só no bloco de uso, na cadeia da lista e na Torre (o Gemini sem o degradê)', () => {
  /* o logo oficial do Gemini é uma estrela de fill branco com um grupo de manchas coloridas por
     máscara em cima. Pôr a cor no contêiner não basta: o grupo tem de sair e o path tem de pegar
     a cor (senão a estrela fica branca e some no claro). Regra 8 do README. */
  const regras = [...semComentario(css).matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => ({ sel: m[1], dec: m[2] }));
  const cobre = (cls, alvo, dec) => regras.some((r) => new RegExp('\\' + cls + '(?![\\w-])').test(r.sel)
    && r.sel.includes(alvo) && dec.test(r.dec));
  for (const cls of ['.cv-uso-logo', '.hi-motor', '.ti-logo']) {
    assert.ok(cobre(cls, '.logo-motor > g[mask]', /display:none/), cls + ': o degradê colorido do Gemini tem de sair');
    assert.ok(cobre(cls, '.logo-motor > path', /fill:currentColor/), cls + ': sem o fill a estrela sai branca');
  }
});

test('o limite zera na HORA do reset ("zera 14:20", "zera seg 09:00"), não em tempo relativo', () => {
  // "agora" do teste: sábado, 26/09 às 15:00 (hora local)
  const agora = new Date(2026, 8, 26, 15, 0).getTime();
  const ctx = { Date: class extends Date { static now() { return agora; } } };
  vm.runInNewContext(pegar('textoDoZera') + '\nthis.z = textoDoZera;', ctx);
  assert.equal(ctx.z(new Date(2026, 8, 26, 17, 20).getTime()), 'zera 17:20', 'hoje: só a hora');
  assert.equal(ctx.z(new Date(2026, 8, 27, 0, 30).getTime()), 'zera dom 00:30', 'passou da meia-noite já é outro dia');
  assert.equal(ctx.z(new Date(2026, 8, 28, 9, 0).getTime()), 'zera seg 09:00');
  assert.equal(ctx.z(new Date(2026, 9, 2, 9, 5).getTime()), 'zera sex 09:05');
  assert.equal(ctx.z(new Date(2026, 9, 6, 9, 0).getTime()), 'zera 06/10 09:00', 'mais de uma semana: a data, o dia da semana enganaria');
  assert.equal(ctx.z(agora - 60000), 'já zerou', 'antes saía "zera já zerou"');
  const b = pegar('pintarBlocoDeUso');
  assert.match(b, /escaparAtributo\(textoDoZera\(j\.reseta\)\)/, 'a barra usa a hora do reset');
  assert.doesNotMatch(b, /'zera ' \+ escaparAtributo\(quandoFuturo/, 'o relativo ("zera em 2h") saiu da barra');
  // o aviso de limite em cima da caixa continua relativo: lá o que importa é quanto falta
  assert.match(app, /function quandoFuturo\(ms\) \{/);
});

test('IA logada sem número de uso não cria bloco (Grok, Claude antes da leitura)', () => {
  const b = pegar('pintarBlocoDeUso');
  const corte = b.indexOf('if (c.entrou && !janelas) { if (bloco) bloco.remove(); return; }');
  assert.ok(corte > 0, 'sem Sessão nem Semana o bloco não entra');
  assert.ok(corte < b.indexOf("document.createElement('div')"), 'o corte vem antes de criar o bloco');
});

test('acabamento da lista, da rotina e dos Ajustes na coluna estreita', () => {
  const c = semComentario(css);
  // o tempo tem largura fixa à direita: o logo da cadeia fica na mesma coluna com "2 d" ou "ontem"
  assert.match(c, /\.hi-w\{order:3;min-width:36px;text-align:right;/);
  // ▶ só preenchido (o ico() põe contorno de 1,4 em todo ícone)
  assert.match(c, /\.ri-acao \.ic\{width:12px;height:12px;stroke:none\}/);
  // com a alça no mínimo (220) o título não encolhe abaixo da palavra + (i): quem cede é o pop-up
  const tit = /\.aj-tit\{([^}]*)\}/.exec(c)[1];
  assert.doesNotMatch(tit, /min-width:0/, 'com min-width:0 o (i) da Caixa de entrada ia para baixo do botão da pasta');
  assert.match(c, /\.aj-pop\{flex:0 1 auto;min-width:0;max-width:min\(120px,50%\);/);
  // e a alça continua com o mínimo de 220
  assert.match(app, /Math\.min\(480, Math\.max\(220, e\.clientX - sb\.getBoundingClientRect\(\)\.left\)\)/);
});
