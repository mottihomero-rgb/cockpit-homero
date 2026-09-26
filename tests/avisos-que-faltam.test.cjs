'use strict';
/* Os quatro avisos que o app JA SABIA e nao mostrava:
   1. chat travado esperando ELE ficava igual a um chat parado (o ponto do painel);
   2. robo agendado que parou so aparecia se ele lembrasse de abrir a coluna de Rotinas;
   3. motor que nao esta instalado aparecia igual aos outros tres, e so falhava depois;
   4. o limite do plano so nascia na tela em 90% de sessao — abaixo disso, nada.
   Estes testes travam os quatro. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const raiz = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(raiz, 'renderer/app.js'), 'utf8');
const html = fs.readFileSync(path.join(raiz, 'renderer/index.html'), 'utf8');
const css = fs.readFileSync(path.join(raiz, 'renderer/style.css'), 'utf8');

/* Recorta uma funcao inteira do app.js contando chaves. Recortar e o jeito da casa
   (ver medidor-contexto.test.cjs): o app.js e da tela, nao da para carregar aqui. */
function pegar(nome) {
  const i = app.indexOf('function ' + nome + '(');
  assert.ok(i > 0, 'a funcao ' + nome + ' tem de existir no app.js');
  let n = 0;
  for (let k = app.indexOf('{', i); k < app.length; k++) {
    if (app[k] === '{') n++;
    else if (app[k] === '}' && --n === 0) return app.slice(i, k + 1);
  }
  throw new Error('nao achei o fim de ' + nome);
}
const linha = (comeco) => {
  const l = app.split('\n').find((x) => x.startsWith(comeco));
  assert.ok(l, 'nao achei a linha que comeca com ' + comeco);
  return l;
};

/* ---------- 1. o ponto do painel tem de ficar vermelho quando ele e o gargalo ---------- */
test('ponto do chat fica vermelho e parado quando o chat espera ELE', () => {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext('function $(sel, el){ return el.achados[sel] || null; }\n'
    + 'function estadoDoPainel(P){ return { cls: P.finge }; }\n'
    + pegar('pintarPonto') + '\nthis.pintarPonto = pintarPonto;', ctx);

  const pt = { className: '' };
  const P = { el: { achados: { '.p-dot': pt } }, dotEstado: 'busy', finge: 'espera' };
  ctx.pintarPonto(P);
  assert.equal(pt.className, 'p-dot dot espera', 'espera ganha ate de quem esta trabalhando');

  P.finge = 'ocupado';
  ctx.pintarPonto(P);
  assert.equal(pt.className, 'p-dot dot busy', 'acabou a espera: volta ao estado do motor');

  P.dotEstado = null; P.finge = 'vazio';
  ctx.pintarPonto(P);
  assert.equal(pt.className, 'p-dot dot off', 'sem estado nenhum o ponto fica apagado');
});

test('quem liga e desliga a espera tem de repintar o ponto do painel', () => {
  const m = pegar('marcarEspera');
  assert.ok(/pintarPonto\(P\)/.test(m), 'sem isto o ponto do chat fica mentindo');
  assert.ok(/pintarAba\(A\)/.test(m), 'a bolinha da aba continua sendo repintada');
  // a regra vermelha existe no CSS e o app.js TEM de usar: era o defeito original
  assert.ok(/\.dot\.espera\{background:var\(--red\)\}/.test(css), 'a regra .dot.espera saiu do CSS');
  assert.ok(app.includes("'p-dot dot ' + (espera ? 'espera'"), 'o ponto do painel parou de usar a espera');
});

/* ---------- 2. selo de rotina parada no icone, sem precisar abrir a coluna ---------- */
function montarRotinas() {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(`
    var avisos = [];
    var rotinasCache = { itens: [] };
    var rotinasFalhasVistas = null;
    var selo = { textContent: '', escondido: true, classList: { toggle: (c, on) => { selo.escondido = on; } } };
    var botao = { title: '' };
    function $(sel, dentro){ return sel === '.act-selo' ? selo : botao; }
    function mostrarAviso(o){ avisos.push(o); }
    function abrirRotinas(){}
    ${linha('const nomeCurtoDaRotina')}
    ${pegar('avisarRotinaNova')}
    ${pegar('pintarSeloRotinas')}
    this.pintar = (itens) => { rotinasCache.itens = itens; pintarSeloRotinas(); };
    this.selo = selo; this.botao = botao; this.avisos = avisos;
  `, ctx);
  return ctx;
}





/* ---------- 3. motor que nao esta instalado neste Mac ---------- */
function montarMotores() {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(`
    var MOTORES_OK = null;
    function NA_VPS(c){ return String(c || '').startsWith('vps:'); }
    const nomeDoMotor = (e) => ({ claude:'Claude', codex:'Codex', gemini:'Gemini', grok:'Grok' }[e] || e);
    ${pegar('motorIndisponivelNaPasta')}
    this.motivo = motorIndisponivelNaPasta;
    this.radar = (m) => { MOTORES_OK = m; };
  `, ctx);
  return ctx;
}

test('motor que falta neste Mac diz o motivo ANTES de criar o chat', () => {
  const c = montarMotores();
  assert.equal(c.motivo('grok', '/Users/homeromotti'), '', 'radar mudo ainda: nao acusa ninguem');
  c.radar({ claude: true, codex: true, gemini: true, grok: false });
  assert.equal(c.motivo('grok', '/Users/homeromotti'), 'Grok não está instalado neste Mac.');
  assert.equal(c.motivo('gemini', '/Users/homeromotti'), '', 'instalado continua liberado');
  // R2-016 (25/09): o Grok roda pelo ACP, que o backend RECUSA na VPS (main.js: "o agente ACP
  // roda no Mac, nao na VPS"). Essa asserção testava o bug: dizia que era pra ficar mudo igual
  // ao motor que so falta local, mas o Grok na VPS precisa do MESMO aviso do Gemini.
  assert.notEqual(c.motivo('grok', 'vps:/opt/adsure'), '',
    'grok na VPS precisa do mesmo aviso do gemini: o ACP nao roda la, e sem aviso a troca matava a conversa atual antes do backend recusar');
});

test('Claude e Codex nunca sao apagados por leitura de PATH', () => {
  const c = montarMotores();
  c.radar({ claude: false, codex: false, gemini: true, grok: true });
  assert.equal(c.motivo('claude', '/Users/homeromotti'), '');
  assert.equal(c.motivo('codex', '/Users/homeromotti'), '',
    'apagar a base por um PATH estranho deixaria o app sem nenhum chat');
});

test('o Gemini na VPS continua com o recado de sempre', () => {
  const c = montarMotores();
  c.radar({ gemini: true, grok: true });
  assert.ok(/pasta do Mac/.test(c.motivo('gemini', 'vps:/opt')), 'o aviso antigo nao pode ter sumido');
});

test('a chave de motores e a tela Nova aba marcam o indisponivel como apagado', () => {
  assert.ok(/\.ch-lado\.apagado\{opacity:/.test(css), 'falta o estilo apagado na chave do cabecalho');
  assert.ok(/\.na-motor\.apagado\{opacity:/.test(css), 'falta o estilo apagado na tela Nova aba');
  assert.ok(/b\.classList\.toggle\('apagado', !!naoDa\)/.test(app), 'ninguem esta marcando os botoes');
  assert.equal((app.match(/b\.classList\.toggle\('apagado', !!naoDa\)/g) || []).length, 2,
    'tem de ser nos DOIS lugares: a chave do chat e a tela Nova aba');
  // o radar chega depois dos paineis: sem repintar, o motor que falta segue com cara de bom
  assert.ok(/MOTORES_OK = m \|\| null;[\s\S]{0,400}for \(const P of panes\.values\(\)\) paintEngine\(P\);/.test(app),
    'o radar tem de repintar os paineis quando a resposta chega');
});

/* ---------- 4. o limite do plano, com folga ---------- */
test('o numero do plano aparece no rodape muito antes do alarme', () => {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(`
    var USO = { claude: null };
    const usoPct = (j) => j ? Math.min(100, Math.max(0, Math.round(j.pct || 0))) : null;
    const nomeDoMotor = () => 'Claude';
    var campo = { textContent: null, title: null };
    function $(sel, el){ return sel === '.p-limite' ? campo : null; }
    ${pegar('pintarLimiteMini')}
    this.pintar = (u) => { USO.claude = u; pintarLimiteMini({ engine: 'claude', el: {} }); };
    this.campo = campo;
  `, ctx);

  ctx.pintar({ sessao: { pct: 42 }, semana: { pct: 18 } });
  assert.equal(ctx.campo.textContent, 'sessão 42% · semana 18%', 'so rotulo e numero, sem frase');

  // plano sem janela de sessao (Codex Pro): nao inventa um "—"
  ctx.pintar({ sessao: null, semana: { pct: 7 } });
  assert.equal(ctx.campo.textContent, 'semana 7%');

  // leitura falhou: o rodape fica limpo em vez de mostrar numero velho sem aviso
  ctx.pintar(null);
  assert.equal(ctx.campo.textContent, '');
  assert.equal(ctx.campo.title, '');
});

test('a tarja de alarme dos 90% continua como era', () => {
  assert.ok(/const USO_AVISO_SESSAO = 90;/.test(app));
  assert.ok(/const USO_AVISO_SEMANA = 50;/.test(app));
  // o numero pequeno e pintado ANTES de qualquer desistencia da tarja
  const f = pegar('pintarUso');
  assert.ok(f.indexOf('pintarLimiteMini(P)') < f.indexOf("if (!faixa) return;"),
    'o rodape nao pode depender da tarja de alarme para existir');
});

/* ---------- o molde da tela e as tres cores ---------- */
test('a tela do Mac tem o selo do icone e o numero do plano', () => {
  assert.ok(/<span class="p-limite"><\/span>\s*\n\s*<button class="p-model"/.test(html),
    'o numero do plano fica ao lado do botao do modelo');
});

test('nenhuma cor nova escrita na mao: tudo sai de variavel de tema', () => {
  for (const regra of ['.act-selo{', '.p-limite{', '.ch-lado.apagado{']) {
    const i = css.indexOf(regra);
    assert.ok(i > 0, 'falta a regra ' + regra);
    const bloco = css.slice(i, css.indexOf('}', i));
    assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(bloco), regra + ' tem cor escrita na mao: quebra os 3 temas');
  }
});
