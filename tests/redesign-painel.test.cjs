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
    // 26/09 (pedido dele): no lugar do número "84k / 1000k" fica a bolinha da memória da conversa
    const git = molde.indexOf('class="p-git'), tok = molde.indexOf('class="p-compactar"'), x = molde.indexOf('class="p-close"');
    assert.ok(dir < git && git < tok && tok < x, pagina + ': a ordem é branch, bolinha, fechar');
    assert.ok(!molde.includes('class="p-tokens"'), pagina + ': o número saiu do topo');
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

/* Revisão 2 do painel (26/09): os sinais seguem a tabela "Estados" do README em todo lugar. */
const blocoCelular = () => { const i = css.indexOf('@media (max-width: 820px)'); return css.slice(i, css.indexOf('\n}\n', i)); };

test('o sinal do telefone é o mesmo do Mac: parado sem nada, anel neutro, "!" âmbar, triângulo', () => {
  const b = blocoCelular();
  assert.match(b, /\.pane-hd \.p-dot\{display:none/, 'no telefone o ponto parado (idle/off) voltou a aparecer');
  const busy = b.match(/\.p-dot\.busy\{([^}]*)\}/);
  assert.ok(busy && /ck-spin/.test(busy[1]) && /--label-1/.test(busy[1]), 'trabalhando tem de ser o anel neutro girando');
  const esp = b.match(/\.p-dot\.espera\{([^}]*)\}/);
  assert.ok(esp && /--status-wait/.test(esp[1]), 'esperando tem de ser o círculo em --status-wait');
  assert.match(b, /\.p-dot\.espera::before\{content:"!"/, 'o círculo de esperando perdeu o "!"');
  assert.doesNotMatch(b, /\.p-dot[^{]*\{[^}]*(--green|--yellow|--red)\b/, 'o ponto do telefone voltou às cores antigas (âmbar = trabalhando, vermelho = esperando)');
});

test('erro no chat: triângulo em --status-error antes do nome, tirado do cartão de erro da conversa', () => {
  const r = css.match(/\.note\.err\):not\(:has\(> \.pane-chat > \.note\.err ~ \.msg\)\) > \.pane-nome::before\{([^}]*)\}/);
  assert.ok(r, 'sumiu o sinal de erro da linha 2');
  assert.match(r[1], /--status-error/);
  assert.match(r[1], /--pn-warn/);
  assert.match(css, /:not\(:has\(> \.pane-hd \.p-dot:is\(\.busy,\.espera\)\)\):has\(> \.pane-chat > \.note\.err\)/,
    'o erro tem de perder para esperando e trabalhando (um sinal por chat)');
});

test('vazio no alto como no design; achado atual igual aos outros', () => {
  assert.match(css, /\.pane-chat > \.pane-empty\{flex:0 1 600px;min-height:0/, 'o logo do vazio voltou a centrar no espaço até a caixa (~36pt mais baixo que a tela E6)');
  assert.doesNotMatch(css, /mark\.acha\.agora\{/, 'o achado atual voltou a ter marca própria (o design pinta todos iguais)');
});

test('o ritmo de 22 é margem (a mesma regra do mensagens.css), nunca gap + margem', () => {
  const chat = css.match(/\n\.pane-chat\{([^}]*)\}/);
  assert.ok(chat, 'sumiu a regra da coluna de leitura');
  assert.doesNotMatch(chat[1], /gap:(?!0)/, 'o .pane-chat voltou a ter gap: somado à margem do mensagens.css dá 44 entre blocos');
  assert.match(css, /\.pane-chat > \* \+ \*\{margin-top:22px\}/, 'sumiu o vão de 22 entre blocos');
});
