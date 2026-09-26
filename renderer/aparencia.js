/* Aparência do app (redesenho de 25/09/2026): Automática / Clara / Escura.
   Os temas antigos (Escuro, Claro e Jornal) sairam. O que vai no <html> e o data-theme dos
   tokens do handoff (cockpit-tokens.css): dark, light, dark-hc ou light-hc.
   - Automática segue o claro/escuro do Mac (ou do iPhone, na tela do celular).
   - "-hc" (contraste aumentado) entra sozinho quando o sistema pede "Aumentar contraste" ou
     "Reduzir transparência": os tokens -hc tiram o vidro e reforçam texto e divisórias.

   Este arquivo roda no <head>, ANTES do CSS pintar: sem ele a janela nasceria sem data-theme e
   todas as cores dos tokens ficariam vazias ate o config chegar. No Mac o main.js ja acerta o
   nativeTheme pela escolha salva antes de abrir a janela, entao o prefers-color-scheme daqui ja
   responde a escolha dele (Escura forca escuro, Clara forca claro, Automática segue o Mac) — por
   isso o palpite de partida "auto" ja sai certo, sem piscar a cor errada.
   O app.js chama Aparencia.aplicar(cfg.tema) quando o config chega e quando ele troca nos Ajustes. */
(function () {
  var raiz = document.documentElement;
  var mq = function (q) { try { return window.matchMedia(q); } catch (e) { return null; } };
  var escuro = mq('(prefers-color-scheme: dark)');
  var contraste = mq('(prefers-contrast: more)');
  var semVidro = mq('(prefers-reduced-transparency: reduce)');
  var casou = function (m) { return !!(m && m.matches); };
  var escolha = 'auto';

  // o que estava salvo antes do redesenho vira a opcao nova mais proxima: o Jornal era claro
  function normalizar(t) {
    if (t === 'escura' || t === 'escuro') return 'escura';
    if (t === 'clara' || t === 'claro' || t === 'jornal') return 'clara';
    return 'auto';
  }
  function efetivo(a) {
    var e = a === 'escura' || (a === 'auto' && casou(escuro));
    return (e ? 'dark' : 'light') + (casou(contraste) || casou(semVidro) ? '-hc' : '');
  }
  function aplicar(t) {
    escolha = normalizar(t);
    var tema = efetivo(escolha);
    if (raiz.getAttribute('data-theme') !== tema) raiz.setAttribute('data-theme', tema);
    return escolha;
  }
  // o Mac trocou de claro para escuro (ou ligou o contraste): reaplica a MESMA escolha e avisa
  // quem depende da cor ja resolvida (a borda das abas le o --accent do chat em foco)
  function mudou() {
    aplicar(escolha);
    try { window.dispatchEvent(new CustomEvent('cockpit:aparencia', { detail: { escolha: escolha } })); } catch (e) {}
  }
  [escuro, contraste, semVidro].forEach(function (m) {
    if (!m) return;
    if (m.addEventListener) m.addEventListener('change', mudou);
    else if (m.addListener) m.addListener(mudou);
  });

  window.Aparencia = {
    normalizar: normalizar,
    efetivo: efetivo,
    aplicar: aplicar,
    escolha: function () { return escolha; },
  };
  aplicar('auto');
})();
