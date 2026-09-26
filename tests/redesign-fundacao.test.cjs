'use strict';
/* Guarda da BASE do redesenho (handoff do Claude Design, 25/09/2026): tokens, arquivos de CSS
   por área, Aparência (Automática / Clara / Escura) e os ícones novos.
   Os agentes de cada área vão mexer no visual por cima disto; o que este teste segura é o chão:
   se um deles tirar os tokens do lugar, voltar a tingir o painel com a cor do motor ou pedir um
   ícone que não existe no icones.js, a tela quebra calada — por isso o teste. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const raiz = path.resolve(__dirname, '..');
const ler = (f) => fs.readFileSync(path.join(raiz, f), 'utf8');
const AREAS = ['base', 'janela', 'painel', 'mensagens', 'passos', 'caixa', 'lateral', 'menus', 'sheets'];

function aparencia({ escuro = false, contraste = false, semVidro = false } = {}) {
  const attrs = {};
  const documentElement = { setAttribute: (k, v) => { attrs[k] = v; }, getAttribute: (k) => attrs[k] };
  const casa = { '(prefers-color-scheme: dark)': escuro, '(prefers-contrast: more)': contraste,
    '(prefers-reduced-transparency: reduce)': semVidro };
  const window = { matchMedia: (q) => ({ matches: !!casa[q], addEventListener() {} }), dispatchEvent() {} };
  vm.runInNewContext(ler('renderer/aparencia.js'), { window, document: { documentElement }, CustomEvent: class {} });
  return { A: window.Aparencia, attrs };
}

test('o que estava salvo antes do redesenho vira a Aparência mais próxima (o Jornal era claro)', () => {
  const { A } = aparencia();
  assert.equal(A.normalizar('escuro'), 'escura');
  assert.equal(A.normalizar('claro'), 'clara');
  assert.equal(A.normalizar('jornal'), 'clara');
  assert.equal(A.normalizar(undefined), 'auto');
  assert.equal(A.normalizar('escura'), 'escura');
});

test('Automática segue o sistema, e contraste/transparência reduzida viram -hc', () => {
  assert.equal(aparencia({ escuro: true }).attrs['data-theme'], 'dark', 'o palpite de partida já sai no 1o quadro');
  assert.equal(aparencia({ escuro: false }).attrs['data-theme'], 'light');
  const { A, attrs } = aparencia({ escuro: false, contraste: true });
  A.aplicar('escura');
  assert.equal(attrs['data-theme'], 'dark-hc', 'Escura forca escuro mesmo com o sistema claro');
  assert.equal(aparencia({ escuro: true, semVidro: true }).attrs['data-theme'], 'dark-hc');
});

test('as duas páginas carregam tokens antes do style.css e as áreas depois, na ordem', () => {
  for (const pagina of ['renderer/index.html', 'renderer/index-web.html']) {
    const html = ler(pagina);
    const pos = (href) => html.indexOf('href="' + href + '"');
    assert.ok(pos('cockpit-tokens.css') > 0 && pos('cockpit-tokens.css') < pos('style.css'), pagina + ': tokens antes do style.css');
    let antes = Math.max(pos('style.css'), pos('quadro.css'), pos('celular.css'));
    for (const a of AREAS) {
      const p = pos('redesign/' + a + '.css');
      assert.ok(p > antes, pagina + ': redesign/' + a + '.css fora de ordem ou faltando');
      antes = p;
      assert.ok(fs.existsSync(path.join(raiz, 'renderer/redesign', a + '.css')), 'falta o arquivo redesign/' + a + '.css');
    }
    assert.match(html, /<html lang="pt-BR" data-theme="dark">/, pagina + ': sem data-theme a janela nasce sem cor');
    assert.ok(html.indexOf('src="icones.js"') > 0 && html.indexOf('src="icones.js"') < html.indexOf('src="quadro.js"'),
      pagina + ': o icones.js tem de vir antes do quadro.js e do app.js');
    assert.doesNotMatch(html, /data-tema=|Jornal/, pagina + ': o seletor antigo de tema voltou');
  }
});

test('a cor do motor não tinge mais o painel: --accent é o azul do sistema', () => {
  const css = ler('renderer/style.css') + ler('renderer/quadro.css');
  assert.doesNotMatch(css, /--accent:\s*var\(--(claude|codex|acp|gemini|grok|qd)\)/,
    'cor do assistente so no logo (README, regra 2): quem tinge e o --motor');
  assert.doesNotMatch(css, /data-tema/, 'o tema agora e data-theme no <html>');
  assert.match(ler('renderer/cockpit-tokens.css'), /--accent: #0A84FF;/, 'os tokens do handoff sairam do lugar');
});

test('todo ícone que o app e o quadro pedem existe no icones.js', () => {
  const window = {};
  vm.runInNewContext(ler('renderer/icones.js'), { window, globalThis: window });
  const CK = window.CK_ICONES;
  const app = ler('renderer/app.js');
  const mapa = app.match(/const ICONE_NOVO = \{([\s\S]*?)\};/)[1];
  for (const [, velho, novo] of mapa.matchAll(/'([^']+)':\s*'([^']+)'/g)) assert.ok(CK[novo], 'ico(\'' + velho + '\') aponta para ' + novo + ', que nao existe');
  const qd = ler('renderer/quadro.js').match(/const ICONES_QD = \{([\s\S]*?)\};/)[1];
  for (const [, velho, novo] of qd.matchAll(/(\w+):\s*'([^']+)'/g)) assert.ok(CK[novo], 'qico(\'' + velho + '\') aponta para ' + novo + ', que nao existe');
  /* Nome pedido direto (ico('queue'), ico('info'), o ico(x ? 'a' : 'b') do Entra/Fila) e o
     ic: '...' dos menus nao passam pelos mapas acima: sem esta varredura um nome errado saia
     como icone vazio, calado. ico() resolve primeiro pelo ICONE_NOVO e depois direto no icones.js. */
  const novoDe = {};
  for (const [, velho, novo] of mapa.matchAll(/'([^']+)':\s*'([^']+)'/g)) novoDe[velho] = novo;
  const existe = (n) => !!CK[novoDe[n] || n];
  const pedidos = new Set();
  for (const arq of ['renderer/app.js', 'renderer/layout-hugo.js', 'renderer/mobile.js']) {
    if (!fs.existsSync(path.join(raiz, arq))) continue;
    const src = ler(arq);
    // o texto comparado no ternario (tipo === 'alerta' ? ...) nao e nome de icone: sai antes
    for (const [, args] of src.matchAll(/\bico\(([^()]*)\)/g)) {
      for (const [, n] of args.replace(/[!=]==?\s*'[^']*'/g, '').matchAll(/'([^']+)'/g)) pedidos.add(n);
    }
    // '/' e texto de proposito (a skill no menu do "/"): so nome de icone entra
    for (const [, n] of src.matchAll(/\bic:\s*'([a-z][a-z0-9-]*)'/g)) pedidos.add(n);
  }
  const tipoIco = app.match(/const TIPO_ICO = \(ext\) => \{([\s\S]*?)\n\};/)[1];
  for (const [, n] of tipoIco.matchAll(/return '([^']+)'/g)) pedidos.add(n);
  assert.ok(pedidos.has('queue') && pedidos.has('info') && pedidos.has('external'), 'a varredura perdeu as chamadas diretas');
  for (const n of pedidos) assert.ok(existe(n), 'o app pede o icone \'' + n + '\', que nao existe no icones.js');
  // os logos provisorios do handoff ficaram de fora: logo de assistente e o oficial (svgMotor)
  assert.equal(Object.keys(CK).some(k => k.startsWith('logo-')), false);
  assert.match(window.ckIcone('plus'), /^<svg viewBox="0 0 16 16" class="ic"/);
  assert.doesNotMatch(window.ckIcone('plus').match(/^<svg[^>]*>/)[0], /\s(width|height)=/, 'o tamanho do icone e do CSS');
});

test('o botão do modo de envio mostra o ícone da fila E o nome (Entra / Fila); o modo é o fundo', () => {
  /* O redesenho trocou o ícone da Fila e um comentário no fim da linha engoliu o rótulo: com um
     chat só na aba (o uso mais comum no Mac) o botão ficava só com o raio, sem dizer o modo. */
  const app = ler('renderer/app.js');
  const corpo = app.match(/const pintarEnvio = \(\) => \{([\s\S]*?)\n  \};/);
  assert.ok(corpo, 'pintarEnvio mudou de forma: ajuste este teste');
  /* 26/09 (conserto da caixa): o desenho é o "queue" nos DOIS modos; o raio do Entra não existe
     no desenho. Quem diz o modo é o fundo (.ligado = entrar na fila), como o botão do plano. */
  const cls = new Set(), attrs = {};
  const btEnvio = { innerHTML: '', title: '', classList: { toggle: (c, on) => { if (on) cls.add(c); else cls.delete(c); } },
    setAttribute: (k, v) => { attrs[k] = v; } };
  const ctx = { P: { envio: 'entra' }, btEnvio, ico: (n) => '<svg data-n="' + n + '"></svg>' };
  vm.runInNewContext('{ const pintarEnvio = () => {' + corpo[1] + '\n}; pintarEnvio(); }', ctx);
  assert.equal(ctx.btEnvio.innerHTML, '<svg data-n="zap"></svg><span>Entra</span>');
  assert.equal(cls.has('ligado'), false); assert.equal(attrs['aria-pressed'], 'false');
  ctx.P.envio = 'fila';
  vm.runInNewContext('{ const pintarEnvio = () => {' + corpo[1] + '\n}; pintarEnvio(); }', ctx);
  assert.equal(ctx.btEnvio.innerHTML, '<svg data-n="queue"></svg><span>Fila</span>');
  assert.equal(cls.has('ligado'), true, 'fila ligada: fundo de selecionado'); assert.equal(attrs['aria-pressed'], 'true');
  assert.ok(ctx.btEnvio.title.length > 0, 'a explicação continua no title (tooltip)');
});

test('a bolinha fixa da aba não é pintada de azul (azul é "resposta nova")', () => {
  /* Com a ponte, o --aba-cor (que era a cor do motor em foco) virou o --accent: toda aba ganhava
     um ponto azul fixo, que no README é o sinal de resposta nova. Um sinal por aba, nenhum falso. */
  const css = ['renderer/style.css', 'renderer/celular.css', ...AREAS.map(a => 'renderer/redesign/' + a + '.css')].map(ler).join('\n');
  const regras = [...css.matchAll(/(?:^|[}\s,])\.aba \.aba-ic\s*\{([^}]*)\}/g)].map(m => m[1]);
  assert.ok(regras.length > 0, 'a regra da bolinha da aba sumiu: ajuste este teste');
  for (const r of regras) {
    assert.doesNotMatch(r, /background[^;]*var\(--(accent|aba-cor|cor-foco|aba-neon)\b/,
      'a bolinha de TODA aba voltou a ser azul: ' + r.trim());
  }
});

test('no iPhone a dica da Aparência fala do iPhone, não do Mac', () => {
  // no telefone quem responde o claro/escuro e o Safari do iPhone; o nativeTheme do Mac nao chega la
  const dica = (html) => (html.match(/Aparência<button class="info"[^>]*data-dica="([^"]*)"/) || [])[1] || '';
  const web = dica(ler('renderer/index-web.html'));
  assert.match(web, /iPhone/);
  assert.doesNotMatch(web, /\bMac\b/, 'a dica do celular promete seguir o Mac: ' + web);
  assert.match(dica(ler('renderer/index.html')), /do Mac/, 'no Mac a dica continua falando do Mac');
});

test('Aparência escolhida chega ao Mac: config:set acerta o nativeTheme (e o nome antigo vale)', () => {
  const { loadMain } = require(path.join(__dirname, 'main-harness.cjs'));
  const h = loadMain();
  const casos = [['escura', 'dark'], ['clara', 'light'], ['auto', 'system'],
    ['escuro', 'dark'], ['claro', 'light'], ['jornal', 'light'], [undefined, 'system']];
  for (const [tema, fonte] of casos) {
    h.nativeTheme.themeSource = 'nada';
    const r = h.call('config:set', { tema, abas: [] });
    assert.equal(r && r.ok, true, 'config:set falhou com tema ' + tema);
    assert.equal(h.nativeTheme.themeSource, fonte, 'tema ' + tema + ' tinha de virar ' + fonte);
  }
  // o fundo de reserva da janela (antes da pagina pintar) segue o claro/escuro resolvido
  h.nativeTheme.shouldUseDarkColors = false;
  assert.equal(h.evaluate('fundoDaJanela()'), '#FFFFFF');
  h.nativeTheme.shouldUseDarkColors = true;
  assert.equal(h.evaluate('fundoDaJanela()'), '#161617');
});
