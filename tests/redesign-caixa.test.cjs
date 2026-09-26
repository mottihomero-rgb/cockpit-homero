'use strict';
// Redesenho 25/09 — a pilha de baixo do painel (plano · autorização · aviso de limite · caixa).
// Guarda o que a aparência nova precisa para não voltar atrás sem ninguém perceber: a ordem da
// pilha nos dois moldes (Mac e celular), o "…" do painel estreito, o pedido de autorização
// separado em cabeçalho/objeto/pasta e as larguras do painel no caixa.css.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ler = (f) => fs.readFileSync(path.resolve(__dirname, '..', f), 'utf8');
const app = ler('renderer/app.js');
const css = ler('renderer/redesign/caixa.css');
const moldes = { mac: ler('renderer/index.html'), celular: ler('renderer/index-web.html') };

function pegar(nome) {
  const m = new RegExp('^function ' + nome + '\\(', 'm').exec(app);
  assert.ok(m, nome + ' existe');
  return app.slice(m.index, app.indexOf('\n}', m.index) + 2);
}

for (const [qual, html] of Object.entries(moldes)) {
  test('molde do ' + qual + ': pilha na ordem do desenho (autorização, aviso de limite, caixa)', () => {
    const i = html.indexOf('id="tplPane"');
    const t = html.slice(i, html.indexOf('</template>', i));
    const perm = t.indexOf('class="pane-perm'), uso = t.indexOf('class="p-uso'), cmp = t.indexOf('class="pane-cmp');
    assert.ok(perm > 0 && perm < uso && uso < cmp, 'o aviso de limite mora entre a autorização e a caixa, fora dela');
    // Negar antes de Permitir: o azul fica na ponta direita
    assert.ok(t.indexOf('class="pp-no"') < t.indexOf('class="pp-yes"'));
    // barra da direita: permissão → "…" → anel → parar → enviar
    const ordem = ['p-modo', 'p-mais', 'p-compactar', 'p-stop', 'p-send'].map(c => t.search(new RegExp('class="[^"]*\\b' + c + '\\b')));
    assert.ok(ordem.every((n, k) => n > 0 && (k === 0 || n > ordem[k - 1])), 'ordem da barra: ' + ordem.join(','));
    assert.match(t, /placeholder="Mensagem para Claude"/);
  });
}

test('pedido de autorização: cabeçalho curto, objeto inteiro e a pasta embaixo', () => {
  const ctx = { shortPath: (p) => String(p).replace('/Users/h', '~') };
  vm.createContext(ctx);
  vm.runInContext(pegar('partesDoPedido') + '\nthis.f = partesDoPedido;', ctx);
  // Claude: "quer usar: Bash" vira "Rodar comando", e o comando vem inteiro
  let r = ctx.f({ title: 'Claude quer usar: Bash', detail: 'npm run deploy -- --prod' });
  assert.equal(r.cab, 'Rodar comando'); assert.equal(r.obj, 'npm run deploy -- --prod'); assert.equal(r.caminho, '');
  // Codex: a última linha "em /pasta" desce para a linha do caminho
  r = ctx.f({ title: 'Rodar comando no seu Mac', detail: 'ls -la\nem /Users/h/Projetos' });
  assert.equal(r.cab, 'Rodar comando no seu Mac'); assert.equal(r.obj, 'ls -la'); assert.equal(r.caminho, '~/Projetos');
  // arquivo: nome em cima, pasta embaixo
  r = ctx.f({ title: 'Claude quer usar: Edit', detail: '/Users/h/site/index.html', reason: 'trocar o título' });
  assert.equal(r.cab, 'Editar arquivo'); assert.equal(r.obj, 'index.html'); assert.equal(r.caminho, '~/site'); assert.equal(r.porque, 'trocar o título');
  // ferramenta desconhecida: o título do motor continua valendo
  r = ctx.f({ title: 'Permitir acesso adicional neste trabalho', detail: '{"rede": true}' });
  assert.equal(r.cab, 'Permitir acesso adicional neste trabalho');
});

test('"…" do painel estreito só clica os botões de verdade', () => {
  const f = pegar('menuMais');
  for (const b of ['.p-modoenvio', '.p-plano', '.p-quadro', '.p-agentes']) assert.ok(f.includes("'" + b + "'"), 'falta ' + b);
  assert.ok((f.match(/\.click\(\)/g) || []).length === 4, 'cada item repete o clique do botão, sem regra nova');
  assert.match(app, /\$\('\.p-mais', el\)[\s\S]{0,120}menuMais\(P\)/, 'o botão "…" abre o menu');
});

test('caixa.css: larguras do painel e o que é só do Mac', () => {
  assert.match(css, /@container \(min-width: 560px\)\{[\s\S]*?\.p-limite\{display:inline\}[\s\S]*?\.modo-nome\{display:inline\}/);
  assert.match(css, /@container \(max-width: 399\.98px\)\{[\s\S]*?\.p-modoenvio,\.cmp-bar \.p-plano,\.cmp-bar \.p-quadro,\.cmp-bar \.p-agentes\{display:none\}[\s\S]*?\.p-mais\{display:grid\}/);
  // o contrário exato da media query do celular: senão os 44px de toque do iPhone perdiam
  assert.match(css, /@media \(min-width: 821px\) and \(not \(pointer: coarse\)\), \(min-width: 1101px\) \{/);
  assert.match(css, /@media \(max-width: 820px\), \(pointer: coarse\) and \(max-width: 1100px\) \{[\s\S]*?\.p-compactar\.baixo\{display:none\}/);
  // enviar nunca na cor do motor; autorização com contorno âmbar
  assert.ok(!/--agent|--logo-/.test(css), 'a cor do assistente não entra na caixa');
  assert.match(css, /inset 0 0 0 1px var\(--status-wait-line\)/);
});

test('aviso de limite sem frase explicativa', () => {
  const f = pegar('pintarUso').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');   // sem os comentários
  assert.ok(!/Metade do limite|Limite da sessão chegando|▲/.test(f), 'o número diz tudo; frase vai no title');
  assert.match(f, /'Semana '/);
});
