'use strict';
/* Guarda do PAINEL DE CHAT no redesenho (handoff do Claude Design, README "Painel de chat").
   O que se perde calado quando alguém mexe no molde ou no CSS depois:
   - a frase do estado vazio e a da troca de motor voltando para a tela (regra 3: explicação
     vai no title, nunca no texto);
   - o cabeçalho voltando a ter o seletor no meio e a branch à esquerda;
   - o bloco do telefone do painel.css valendo também numa janela estreita do Mac (esconderia
     o nome da conversa no Mac sem motivo). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const raiz = path.resolve(__dirname, '..');
const ler = (f) => fs.readFileSync(path.join(raiz, f), 'utf8');
const app = ler('renderer/app.js');
const css = ler('renderer/redesign/painel.css');
const funcao = (nome) => {
  const i = app.indexOf('function ' + nome + '(');
  assert.ok(i >= 0, 'sumiu a função ' + nome);
  return app.slice(i, app.indexOf('\n}\n', i) + 2);
};

test('os dois moldes do painel: seletor à esquerda, branch/medidor/fechar à direita, vazio sem frase', () => {
  for (const pagina of ['renderer/index.html', 'renderer/index-web.html']) {
    const h = ler(pagina);
    const molde = h.slice(h.indexOf('<template id="tplPane">'), h.indexOf('</template>', h.indexOf('<template id="tplPane">')));
    assert.doesNotMatch(molde, /Escreva embaixo/, pagina + ': a frase do estado vazio voltou');
    assert.doesNotMatch(molde, /hd-esq/, pagina + ': o lado esquerdo do cabeçalho voltou (o seletor encostava no meio)');
    const chave = molde.indexOf('class="p-chave"'), dir = molde.indexOf('hd-dir');
    assert.ok(chave > 0 && dir > chave, pagina + ': o seletor tem de vir antes do lado direito');
    const git = molde.indexOf('class="p-git'), tok = molde.indexOf('class="p-tokens"'), x = molde.indexOf('class="p-close"');
    assert.ok(dir < git && git < tok && tok < x, pagina + ': a ordem é branch, medidor, fechar');
    for (const m of ['Claude', 'Codex', 'Gemini', 'Grok']) {
      assert.ok(molde.includes('<span class="ch-nome">' + m + '</span>'),
        pagina + ': o nome do ' + m + ' precisa de span próprio (some abaixo de 560pt)');
    }
  }
  assert.doesNotMatch(funcao('voltarVazio'), /pe-txt|Escreva/, 'a conversa zerada voltou a escrever a frase');
});

test('a troca de motor e o ramo mostram só o nome; a frase fica no title', () => {
  const troca = funcao('marcaTroca');
  assert.match(troca, /d\.title = 'Daqui em diante quem responde/, 'a explicação da troca tem de ir no title');
  assert.doesNotMatch(troca, /textContent = 'daqui em diante/, 'a frase da troca voltou para a tela');
  const ramo = funcao('faixaDeRamo');
  assert.match(ramo, /d\.title = /, 'a explicação do ramo tem de ir no title');
  assert.doesNotMatch(ramo, /textContent = [^\n]*(lembra da conversa|Escreva pra continuar)/, 'a frase do ramo voltou para a tela');
});

test('o medidor do cabeçalho é só o número, sem a barrinha azul', () => {
  const f = funcao('pintarTokens');
  assert.doesNotMatch(f, /tok-bar|tok-fill/, 'a barrinha azul voltou para o cabeçalho');
});

test('o bloco do telefone do painel.css só vale na página do celular', () => {
  const i = css.indexOf('@media (max-width: 820px)');
  assert.ok(i > 0, 'sumiu o bloco do telefone (o celular perde alvo de toque e ganha o nome da conversa)');
  const bloco = css.slice(i, css.indexOf('\n}\n', i));
  const regras = bloco.split('\n').filter((l) => /\{/.test(l) && !/@media/.test(l));
  assert.ok(regras.length > 0);
  for (const r of regras) {
    assert.match(r.trim(), /^:root:has\(\.so-celular\) /, 'regra do telefone valendo no Mac estreito: ' + r.trim());
  }
  assert.ok(/:root:has\(\.so-celular\) \.pane-nome\{display:none\}/.test(bloco), 'no telefone o nome da conversa continua escondido');
});

test('a cor do assistente fica só no logo do seletor (nenhum fundo azul nem da cor do motor)', () => {
  const ativo = css.match(/\.ch-lado\[aria-pressed="true"\]\{([^}]*)\}/);
  assert.ok(ativo, 'sumiu a regra do item ativo do seletor');
  assert.doesNotMatch(ativo[1], /--accent|--motor|--logo-/, 'o item ativo voltou a ser pintado com cor: ' + ativo[1]);
  assert.match(ativo[1], /--control-selected/, 'o item ativo é o --control-selected do README');
});
