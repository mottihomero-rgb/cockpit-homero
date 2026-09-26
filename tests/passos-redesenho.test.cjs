'use strict';
/* Redesenho de 26/09, area "o que a IA fez" (renderer/redesign/passos.css + app.js):
   - o tempo no jeito do design ("38s", "1m 02s", "2m") no grupo, no "Pensou por" e no trabalhando;
   - o cabecalho do grupo: "Executou 5 comandos", e "1 passo com erro" quando tudo deu errado;
   - o diff do Codex numera as linhas pelo "@@ -211,4 +211,4 @@" (o do Claude nao tem numero);
   - a linha do trabalhando diz o passo que roda agora, e nao "trabalhando";
   - o CSS da area so usa as cores do tema e nada de CAIXA ALTA espacada.
   Cada funcao e recortada do app.js real por contagem de chaves e roda numa VM. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const raiz = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(raiz, 'renderer/app.js'), 'utf8');
const css = fs.readFileSync(path.join(raiz, 'renderer/redesign/passos.css'), 'utf8');

function pegar(nome) {
  const m = new RegExp('^(?:async )?function ' + nome + '\\(', 'm').exec(app);
  assert.ok(m, 'a funcao ' + nome + ' tem de existir no app.js');
  const abre = app.indexOf('{', m.index);
  let n = 0, i = abre;
  for (; i < app.length; i++) {
    if (app[i] === '{') n++;
    else if (app[i] === '}' && --n === 0) { i++; break; }
  }
  return app.slice(m.index, i);
}
// const de uma linha so (const X = ...;), recortada ate o ponto e virgula do fim da linha
function pegarConst(nome) {
  const m = new RegExp('^const ' + nome + ' = .*;$', 'm').exec(app);
  assert.ok(m, 'a const ' + nome + ' tem de existir no app.js');
  return m[0].replace(/^const /, 'var ');
}
function rodar(nomes, extra = {}, consts = []) {
  const ctx = { ...extra };
  vm.createContext(ctx);
  vm.runInContext(consts.map(pegarConst).join('\n') + '\n' + nomes.map(pegar).join('\n') + '\n'
    + nomes.map(n => 'this.' + n + ' = ' + n + ';').join('\n'), ctx);
  return ctx;
}

test('tempo no jeito do design: 38s, 1m 02s, 2m', () => {
  const { tempoCurto } = rodar(['tempoCurto']);
  assert.equal(tempoCurto(400), '0s');
  assert.equal(tempoCurto(38000), '38s');
  assert.equal(tempoCurto(62000), '1m 02s');
  assert.equal(tempoCurto(70000), '1m 10s');
  assert.equal(tempoCurto(120000), '2m');
});

/* grupo de mentira: so o que o tituloGrupo encosta */
function grupo(passos, t0) {
  const nm2 = { textContent: '' }, tempo = { textContent: '' };
  const card = { children: passos, querySelectorAll: () => passos.filter(p => p.erro) };
  const classes = new Set();
  const g = { dataset: { t0: String(t0) }, classList: { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)) } };
  const $ = (sel) => ({ '.exec-card': card, '.exec-nm2': nm2, '.exec-tempo': tempo })[sel];
  return { g, nm2, tempo, $ };
}
test('cabecalho do grupo: "Executou N comandos" + tempo, e o erro dito com todas as letras', () => {
  const agora = Date.now();
  let x = grupo([{}, {}, {}, {}, {}], agora - 38000);
  let c = rodar(['tempoCurto', 'tituloGrupo'], { $: x.$ });
  c.tituloGrupo(x.g);
  assert.equal(x.nm2.textContent, 'Executou 5 comandos');
  assert.equal(x.tempo.textContent, '38s');

  x = grupo([{ erro: true }], agora - 9000);
  c = rodar(['tempoCurto', 'tituloGrupo'], { $: x.$ });
  c.tituloGrupo(x.g);
  assert.equal(x.nm2.textContent, '1 passo com erro', 'grupo que so deu erro diz isso, como no design');

  x = grupo([{}, { erro: true }, {}], agora - 5000);
  c = rodar(['tempoCurto', 'tituloGrupo'], { $: x.$ });
  c.tituloGrupo(x.g);
  assert.equal(x.nm2.textContent, 'Executou 3 comandos · 1 com erro');

  // conversa reaberta: os passos voltam todos de uma vez e o tempo nao pode virar "0s"
  x = grupo([{}], agora);
  c = rodar(['tempoCurto', 'tituloGrupo'], { $: x.$ });
  c.tituloGrupo(x.g);
  assert.equal(x.nm2.textContent, 'Executou 1 comando');
  assert.equal(x.tempo.textContent, '');
});

test('diff do Codex numera as linhas pelo @@ (menos e mais na mesma linha do arquivo)', () => {
  const c = rodar(['linhasDoPatch', 'numerarPatch']);
  const cru = c.linhasDoPatch('@@ -211,4 +211,4 @@\n <div class="oferta">\n-  <a href="old">\n+  <a href="new">\n     Comprar agora');
  assert.equal(c.numerarPatch(cru), true);
  // o array nasce na VM (outro "Array"): compara pelo texto
  const numeros = cru.filter(l => l.t !== '@').map(l => l.t + l.n);
  assert.equal(JSON.stringify(numeros), JSON.stringify([' 211', '-212', '+212', ' 213']));
  // sem @@ (o antes/depois do Claude) nao inventa numero
  const semHunk = c.linhasDoPatch('-a\n+b');
  assert.equal(c.numerarPatch(semHunk), false);
  assert.ok(semHunk.every(l => l.n == null));
});

test('a linha do trabalhando diz o passo que roda agora, e cai em "Pensando" no silencio', () => {
  const { verboDoTrabalho } = rodar(['verboDoTrabalho'], {}, ['PASSO_DO_TIME']);
  assert.deepEqual({ ...verboDoTrabalho({ trabPassos: [{ id: 'a', verbo: 'Lendo', obj: 'checkout.js', nome: 'Read' }] }) }, { verbo: 'Lendo', obj: 'checkout.js' });
  assert.deepEqual({ ...verboDoTrabalho({ trabPassos: [], trabFazendo: 'Escrevendo' }) }, { verbo: 'Escrevendo', obj: '' });
  assert.deepEqual({ ...verboDoTrabalho({}) }, { verbo: 'Pensando', obj: '' });
  assert.doesNotMatch(pegar('pintaTrab'), /'trabalhando'/, 'a palavra "trabalhando" nao volta para a linha');
});

test('com o time de agentes trabalhando, a linha diz "Coordenando 3 agentes" (tela E1)', () => {
  const { verboDoTrabalho } = rodar(['verboDoTrabalho'], {}, ['PASSO_DO_TIME']);
  const time = { ativos: 2, total: 3 };
  assert.deepEqual({ ...verboDoTrabalho({ agCartao: time, trabFazendo: 'Pensando' }) }, { verbo: 'Coordenando', obj: '3 agentes' });
  // o proprio chamado do time rodando nao tira o "Coordenando"
  assert.deepEqual({ ...verboDoTrabalho({ agCartao: time, trabPassos: [{ verbo: 'Agente', obj: 'revisao', nome: 'Task' }] }) }, { verbo: 'Coordenando', obj: '3 agentes' });
  // um passo DELE rodando e mais concreto: ganha
  assert.deepEqual({ ...verboDoTrabalho({ agCartao: time, trabPassos: [{ verbo: 'Lendo', obj: 'a.js', nome: 'Read' }] }) }, { verbo: 'Lendo', obj: 'a.js' });
  // time que ja entregou tudo nao coordena mais nada
  assert.deepEqual({ ...verboDoTrabalho({ agCartao: { ativos: 0, total: 3 } }) }, { verbo: 'Pensando', obj: '' });
});

test('esperando ele (autorizacao ou pergunta), a linha do trabalhando some', () => {
  assert.match(pegar('pintaTrab'), /classList\.toggle\('espera', estadoDoPainel\(P\)\.cls === 'espera'\)/);
  assert.match(pegar('marcarEspera'), /pintaTrab\(P\)/, 'a linha tem de sumir na hora em que o pedido chega');
  assert.match(css, /\.trab\.espera\{display:none\}/);
});

test('trabalhando sem objeto: o span vazio sai do flex e o tempo fica a 8 do verbo, nao a 16', () => {
  const semComent = css.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(semComent, /\.trab\{[^}]*gap:8px/);
  assert.match(semComent, /\.trab-obj:empty\{display:none\}/, '"Organizando tarefas 6s" ganhava o dobro do espaco antes do tempo');
});

test('o bloco "$" mostra comando de verdade: cat e rg no lugar de ler e buscar, com "~"', () => {
  const c = rodar(['comandoDoPasso'], { HOME: '/Users/homero' }, ['comTil', 'aspasShell']);
  const cmd = (n, a) => ({ ...c.comandoDoPasso(n, a) });
  assert.deepEqual(cmd('Read', '/Users/homero/Projetos/Pedro/oficina/index.html'), { txt: 'cat ~/Projetos/Pedro/oficina/index.html', semCifrao: false });
  assert.deepEqual(cmd('Read', '/Users/homero/Documents/Adsure - Sistemas/a.js'), { txt: "cat ~/'Documents/Adsure - Sistemas/a.js'", semCifrao: false });
  assert.deepEqual(cmd('Read', '/etc/hosts'), { txt: 'cat /etc/hosts', semCifrao: false });
  assert.deepEqual(cmd('Grep', 'checkout'), { txt: 'rg -n checkout', semCifrao: false });
  assert.deepEqual(cmd('Grep', 'pay.zouti old'), { txt: "rg -n 'pay.zouti old'", semCifrao: false });
  // o Terminal fica letra por letra: "~" dentro de aspas nao expande no shell
  assert.deepEqual(cmd('Bash', 'cd "/Users/homero/x" && ls'), { txt: 'cd "/Users/homero/x" && ls', semCifrao: false });
  // link, pesquisa, skill: sem "$"
  assert.deepEqual(cmd('WebFetch', 'https://pay.zouti.com.br'), { txt: 'https://pay.zouti.com.br', semCifrao: true });
  assert.deepEqual(cmd('Read', ''), { txt: '', semCifrao: true });
  // pasta que so COMECA igual a casa nao vira "~"
  const d = rodar(['comandoDoPasso'], { HOME: '/Users/ho' }, ['comTil', 'aspasShell']);
  assert.equal(d.comandoDoPasso('Read', '/Users/homero/a').txt, 'cat /Users/homero/a');
});

test('time de agentes: "o que faz" no vocabulario dos passos e o tempo em "1m 02s" (cartao e painel)', () => {
  const c = rodar(['agFazendo', 'fraseCrua', 'agNomeFerramenta', 'agBonito', 'agTempo', 'tempoCurto', 'toolLabel'],
    { soNome: (x) => String(x || '').split('/').pop(), TOOL_PT: {} }, ['AG_VERBO_DO_PASSO']);
  vm.runInContext('var AG_FERR_PT = { Bash: "rodando um comando" }; var AG_MCP_PT = { browser_navigate: "abrindo uma página" };', c);
  assert.equal(c.agFazendo('agora', 'Read'), 'Lendo');
  assert.equal(c.agFazendo('agora', 'Bash'), 'Terminal');
  assert.equal(c.agFazendo('agora', 'mcp__playwright__browser_navigate'), 'Abrindo uma página');
  assert.equal(c.agFazendo('agora', ''), 'Pensando');
  assert.equal(c.agFazendo('pronto', 'Glob'), 'Pronto');
  assert.equal(c.agFazendo('erro', 'Bash'), 'Deu erro');
  assert.equal(c.agFazendo('espera', ''), 'Na fila');
  assert.equal(c.agTempo(62000), '1m 02s');
  assert.equal(c.agTempo(0), '0s');
  assert.equal(c.agTempo(undefined), '');
  assert.doesNotMatch(pegar('agCartaoAgente'), /'terminou'|'deu erro'|'esperando a vez'/, 'o painel grande volta a falar diferente do cartao');
});

test('cartao do time: medidas do design em content-box (cabecalho 30 + 1, linha 40 + 4 + 4)', () => {
  assert.match(css, /\.equipe-hd\{box-sizing:content-box;height:30px/);
  assert.match(css, /\.equipe-l\{box-sizing:content-box;[^}]*min-height:40px;padding:4px 10px/);
});

test('sozinho no galho, o passos.css nao zera o recuo antigo dos blocos (quem zera e a coluna da conversa)', () => {
  const semComent = css.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(semComent, /(^|[},])\s*\.exec\s*[,{][^}]*padding:0/m, 'o .exec perdeu o recuo de 18 do style.css');
  assert.doesNotMatch(semComent, /\.trab[^-{]*\{[^}]*[^-]height:20px/, 'com o padding antigo, altura fixa esmaga o texto do trabalhando');
  assert.match(semComent, /:where\(\.equipe\)\{margin-inline:18px\}/, 'o cartao do time precisa de recuo com peso zero');
});

test('passos.css: so cor de tema e nada de caixa alta espacada', () => {
  const semDados = css.replace(/url\("data:[^"]*"\)/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(semDados, /#[0-9a-fA-F]{3,8}\b(?![-\w])/, 'cor cravada no CSS: tem de vir de variavel do tema');
  assert.doesNotMatch(semDados, /text-transform:\s*uppercase/);
  assert.doesNotMatch(semDados, /letter-spacing:\s*[.1-9]/);
  assert.match(semDados, /\.exec-card[^{]*\{[^}]*transition:[^}]*var\(--ease-in-out\)/, 'abrir e fechar tem de usar a curva do design');
});
