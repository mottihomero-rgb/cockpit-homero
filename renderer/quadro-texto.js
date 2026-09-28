/* quadro-texto.js — lê o desenho do quadro e escreve o fluxo em português.
   Função pura: mesma cena entra, mesmo texto sai. Sem DOM, sem rede, sem Date.

   window.QuadroTexto.descrever(cena, opts) -> { titulo, texto, mermaid, resumo, mensagem }

   Regra-mãe: nunca lança exceção e nunca devolve texto/mermaid/resumo vazios.
   Se der ruim aqui, a imagem do quadro TEM que chegar no Claude do mesmo jeito. */
(function () {
  'use strict';

  /* ══════════════════════════════════════════════════════════════
     1. CONSTANTES — tudo que se ajusta mora aqui
     ══════════════════════════════════════════════════════════════ */

  var RAIO_ANCORA    = 40;   // px de MUNDO: raio de busca da forma para uma ponta de seta solta
  var TOL_ABSORCAO   = 2;    // px de folga no teste "centro do texto dentro da caixa"
  var PERTO          = 250;  // px: até aqui uma observação é descrita como "perto de X"
  var BANDA_Y        = 40;   // px: faixa de altura para considerar dois blocos "na mesma linha"
  var MAX_ROTULO     = 80;   // caracteres visíveis de um rótulo, no texto e no mermaid
  var MAX_TITULO     = 60;
  var MAX_NOS        = 200;  // teto de nós narrados (opts.maxNos sobrescreve)
  var MIN_SETA_LONGA = 20;   // px: abaixo disso, seta curta pode ancorar as 2 pontas na mesma forma

  var CABECALHO = 'Desenhei um fluxograma no quadro do Cockpit para explicar o que eu quero. ' +
    'A imagem está anexada nesta mensagem (o caminho do arquivo vem no fim). ' +
    'Abaixo está o MESMO desenho já lido em texto, para você não precisar adivinhar nada da imagem.';

  var LINHA_FINAL = 'O que eu quero com esse fluxo: ';

  var TIPOS_FORMA = ['retangulo', 'elipse', 'losango', 'nota', 'texto', 'caneta'];
  var TIPOS_HOSPEDEIROS = ['retangulo', 'elipse', 'losango', 'nota']; // quem pode absorver um texto

  /* ══════════════════════════════════════════════════════════════
     2. HELPERS DE TEXTO
     ══════════════════════════════════════════════════════════════ */

  // Todo número da cena passa por aqui: NaN/undefined/'12' viram 0.
  // Um NaN vindo de um save corrompido envenena toda a geometria em silêncio.
  function num(v) {
    return (typeof v === 'number' && isFinite(v)) ? v : 0;
  }

  // Tira caracteres de controle. Mantém \n (tratado depois), acentos e emoji.
  function txt(v) {
    var s = String(v == null ? '' : v);
    s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
    return s.trim();
  }

  function colapsar(s) {
    return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  }

  function semAcento(s) {
    try {
      return String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    } catch (e) {
      return String(s == null ? '' : s);
    }
  }

  // Array.from e não slice direto: cortar no meio de um emoji gera lixo na tela.
  function cortar(s, max) {
    s = String(s == null ? '' : s);
    var arr;
    try { arr = Array.from(s); } catch (e) { arr = s.split(''); }
    if (arr.length <= max) return s;
    if (max <= 1) return '…';
    return arr.slice(0, max - 1).join('') + '…';
  }

  function palavraTipo(t) {
    if (t === 'retangulo') return 'caixa';
    if (t === 'elipse') return 'balão';
    if (t === 'losango') return 'decisão';
    if (t === 'nota') return 'observação';
    if (t === 'caneta') return 'rabisco';
    return 'texto';
  }

  function genericoTipo(t) {
    if (t === 'retangulo') return 'caixa sem nome';
    if (t === 'elipse') return 'balão sem nome';
    if (t === 'losango') return 'decisão sem nome';
    if (t === 'nota') return 'observação sem nome';
    if (t === 'caneta') return 'rabisco';
    return 'texto sem nome';
  }

  /* ══════════════════════════════════════════════════════════════
     3. GEOMETRIA (helpers puros)
     ══════════════════════════════════════════════════════════════ */

  function caixa(f) {
    return { x1: f.x, y1: f.y, x2: f.x + f.w, y2: f.y + f.h };
  }

  function centro(f) {
    return { x: f.x + f.w / 2, y: f.y + f.h / 2 };
  }

  function area(f) {
    return f.w * f.h;
  }

  // 0 se o ponto está DENTRO da caixa.
  function distPontoCaixa(px, py, f) {
    var c = caixa(f);
    var dx = Math.max(c.x1 - px, 0, px - c.x2);
    var dy = Math.max(c.y1 - py, 0, py - c.y2);
    return Math.sqrt(dx * dx + dy * dy);
  }

  function distCaixaCaixa(a, b) {
    var ca = caixa(a), cb = caixa(b);
    var dx = Math.max(cb.x1 - ca.x2, 0, ca.x1 - cb.x2);
    var dy = Math.max(cb.y1 - ca.y2, 0, ca.y1 - cb.y2);
    return Math.sqrt(dx * dx + dy * dy);
  }

  function dentro(px, py, f, tol) {
    var c = caixa(f);
    return px >= c.x1 - tol && px <= c.x2 + tol && py >= c.y1 - tol && py <= c.y2 + tol;
  }

  // ORDEM DE LEITURA — sempre as 3 chaves.
  // O terceiro critério (id) não é enfeite: sem ele, duas formas no mesmo ponto saem
  // em ordem diferente a cada leitura e a saída deixa de ser reprodutível.
  function ordemLeitura(a, b) {
    if (a.y !== b.y) return a.y - b.y;
    if (a.x !== b.x) return a.x - b.x;
    return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0);
  }

  // y cresce para BAIXO na tela — este é o erro clássico.
  function direcao(dx, dy) {
    if (dx === 0 && dy === 0) return 'sem direção';
    var ang = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
    if (ang < 22.5 || ang >= 337.5) return 'para a direita';
    if (ang < 67.5) return 'para baixo e para a direita';
    if (ang < 112.5) return 'para baixo';
    if (ang < 157.5) return 'para baixo e para a esquerda';
    if (ang < 202.5) return 'para a esquerda';
    if (ang < 247.5) return 'para cima e para a esquerda';
    if (ang < 292.5) return 'para cima';
    return 'para cima e para a direita';
  }

  // De que lado a seta VEM (usado na seta meia-solta que chega no nó).
  function ladoDeOrigem(dx, dy) {
    if (dx === 0 && dy === 0) return 'de algum lado';
    var ang = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
    if (ang < 22.5 || ang >= 337.5) return 'da esquerda';
    if (ang < 67.5) return 'de cima e da esquerda';
    if (ang < 112.5) return 'de cima';
    if (ang < 157.5) return 'de cima e da direita';
    if (ang < 202.5) return 'da direita';
    if (ang < 247.5) return 'de baixo e da direita';
    if (ang < 292.5) return 'de baixo';
    return 'de baixo e da esquerda';
  }

  var NOMES_QUADRANTE = [
    ['no canto de cima à esquerda', 'na parte de cima', 'no canto de cima à direita'],
    ['à esquerda', 'no meio', 'à direita'],
    ['no canto de baixo à esquerda', 'na parte de baixo', 'no canto de baixo à direita']
  ];

  function quadrante(bb, px, py) {
    if (!bb || bb.w <= 0 || bb.h <= 0) return 'no meio';
    var cx = Math.floor((px - bb.x) / (bb.w / 3));
    var cy = Math.floor((py - bb.y) / (bb.h / 3));
    if (cx < 0) cx = 0; if (cx > 2) cx = 2;
    if (cy < 0) cy = 0; if (cy > 2) cy = 2;
    return NOMES_QUADRANTE[cy][cx];
  }

  /* ══════════════════════════════════════════════════════════════
     2 (SPEC). SANEAMENTO DA ENTRADA
     ══════════════════════════════════════════════════════════════ */

  function sanear(cena) {
    var fonteF = (cena && Array.isArray(cena.formas)) ? cena.formas : [];
    var fonteS = (cena && Array.isArray(cena.setas)) ? cena.setas : [];

    var formas = [];
    var usados = Object.create(null);

    function idUnico(bruto, prefixo, i) {
      var id = (typeof bruto === 'string' && bruto.trim()) ? bruto.trim() : (prefixo + i);
      // ID duplicado só nasce de bug do quadro.js. Manter o primeiro é a única
      // escolha determinística possível: o segundo vira id~2, o terceiro id~3.
      if (!usados[id]) { usados[id] = 1; return id; }
      usados[id]++;
      return id + '~' + usados[id];
    }

    for (var i = 0; i < fonteF.length; i++) {
      var b = fonteF[i];
      if (!b || typeof b !== 'object') continue;

      var tipo = String(b.tipo || '');
      if (TIPOS_FORMA.indexOf(tipo) === -1) tipo = 'retangulo';

      var f = {
        id: idUnico(b.id, 'f', i),
        tipo: tipo,
        x: num(b.x), y: num(b.y), w: num(b.w), h: num(b.h),
        texto: txt(b.texto),
        pontos: null,
        indice: i,
        absorvida: null,
        absorvidos: null
      };

      // 2.3 Caixa invertida (arrastada de baixo-direita para cima-esquerda).
      // Sem isto nada absorve, nada ancora, tudo ordena errado — e sem erro visível.
      if (f.w < 0) { f.x += f.w; f.w = -f.w; }
      if (f.h < 0) { f.y += f.h; f.h = -f.h; }

      if (tipo === 'caneta') {
        var pts = [];
        if (Array.isArray(b.pontos)) {
          for (var p = 0; p < b.pontos.length; p++) {
            var pt = b.pontos[p];
            if (Array.isArray(pt) && pt.length >= 2) pts.push([num(pt[0]), num(pt[1])]);
            else if (pt && typeof pt === 'object' && ('x' in pt)) pts.push([num(pt.x), num(pt.y)]);
          }
        }
        if (!pts.length) continue;             // caneta sem ponto válido é descartada inteira
        f.pontos = pts;
        // A caixa salva pode estar velha: recalcular sempre a bbox dos pontos.
        var mnx = pts[0][0], mny = pts[0][1], mxx = pts[0][0], mxy = pts[0][1];
        for (var q = 1; q < pts.length; q++) {
          if (pts[q][0] < mnx) mnx = pts[q][0];
          if (pts[q][0] > mxx) mxx = pts[q][0];
          if (pts[q][1] < mny) mny = pts[q][1];
          if (pts[q][1] > mxy) mxy = pts[q][1];
        }
        f.x = mnx; f.y = mny; f.w = mxx - mnx; f.h = mxy - mny;
      }

      // 2.7 Descartes: texto vazio não é nada; caixa de tamanho zero sem traço também não.
      if (tipo === 'texto' && !f.texto) continue;
      if (tipo !== 'caneta' && f.w < 1 && f.h < 1) continue;

      formas.push(f);
    }

    var setas = [];
    var usadosS = Object.create(null);
    function idUnicoS(bruto, i) {
      var id = (typeof bruto === 'string' && bruto.trim()) ? bruto.trim() : ('s' + i);
      if (!usadosS[id]) { usadosS[id] = 1; return id; }
      usadosS[id]++;
      return id + '~' + usadosS[id];
    }

    var vistas = Object.create(null);
    for (var k = 0; k < fonteS.length; k++) {
      var sb = fonteS[k];
      if (!sb || typeof sb !== 'object') continue;

      var st = String(sb.tipo || '');
      if (st !== 'seta' && st !== 'linha') st = 'seta';

      var de = sb.de && typeof sb.de === 'object' ? sb.de : {};
      var para = sb.para && typeof sb.para === 'object' ? sb.para : {};
      var idDe = (typeof de.forma === 'string' && de.forma.trim()) ? de.forma.trim() : null;
      var idPara = (typeof para.forma === 'string' && para.forma.trim()) ? para.forma.trim() : null;

      var s = {
        id: idUnicoS(sb.id, k),
        tipo: st,
        de: { forma: idDe, x: num(de.x), y: num(de.y) },
        para: { forma: idPara, x: num(para.x), y: num(para.y) },
        texto: colapsar(txt(sb.texto)),
        indice: k
      };

      // 2.7 seta degenerada: mesmo ponto exato e sem nenhuma ancoragem.
      if (!idDe && !idPara && s.de.x === s.para.x && s.de.y === s.para.y) continue;

      // 2.8 Deduplicar: duas setas empilhadas por acidente viram uma linha repetida na leitura.
      var chave = (idDe || ('@' + s.de.x + ',' + s.de.y)) + '>' +
                  (idPara || ('@' + s.para.x + ',' + s.para.y)) + '>' + st + '>' + s.texto;
      if (vistas[chave]) continue;
      vistas[chave] = 1;

      setas.push(s);
    }

    return { formas: formas, setas: setas };
  }

  /* ══════════════════════════════════════════════════════════════
     4. ABSORÇÃO DE TEXTO SOLTO (o texto escrito POR CIMA de uma forma)
     ══════════════════════════════════════════════════════════════ */

  function absorverTextos(formas, setas) {
    var i, j;
    var hospedeiros = [];
    for (i = 0; i < formas.length; i++) {
      if (TIPOS_HOSPEDEIROS.indexOf(formas[i].tipo) !== -1) hospedeiros.push(formas[i]);
    }
    if (!hospedeiros.length) return;

    var absorcoes = []; // {texto:T, host:H}
    for (i = 0; i < formas.length; i++) {
      var T = formas[i];
      if (T.tipo !== 'texto') continue;
      var c = centro(T);
      var melhor = null;
      for (j = 0; j < hospedeiros.length; j++) {
        var H = hospedeiros[j];
        if (H === T) continue;
        // Só o CENTRO conta: rótulo de seta e legenda ao lado da caixa continuam separados.
        if (!dentro(c.x, c.y, H, TOL_ABSORCAO)) continue;
        if (!melhor) { melhor = H; continue; }
        var aH = area(H), aM = area(melhor);
        // Menor área ganha (numa caixa grande de fundo, o rótulo pertence à pequena).
        if (aH < aM) melhor = H;
        else if (aH === aM) {
          if (H.indice > melhor.indice) melhor = H;            // o desenhado por cima
          else if (H.indice === melhor.indice && H.id < melhor.id) melhor = H;
        }
      }
      if (melhor) absorcoes.push({ texto: T, host: melhor });
    }
    if (!absorcoes.length) return;

    // (a) marcar, sem dar splice durante o laço
    var porHost = new Map();
    for (i = 0; i < absorcoes.length; i++) {
      var a = absorcoes[i];
      a.texto.absorvida = a.host.id;
      if (!porHost.has(a.host)) porHost.set(a.host, []);
      porHost.get(a.host).push(a.texto);
    }

    // (b) juntar os textos no hospedeiro, na ordem de leitura
    porHost.forEach(function (lista, host) {
      lista.sort(ordemLeitura);
      var partes = [];
      if (host.texto) partes.push(host.texto);
      for (var n = 0; n < lista.length; n++) if (lista[n].texto) partes.push(lista[n].texto);
      host.texto = partes.join(' — ');
      host.absorvidos = lista;
    });

    // (c) re-apontar as setas. Pular isto deixa referência pendurada
    //     e a ligação some da leitura sem nenhum aviso.
    var mapa = Object.create(null);
    for (i = 0; i < absorcoes.length; i++) mapa[absorcoes[i].texto.id] = absorcoes[i].host.id;
    for (i = 0; i < setas.length; i++) {
      var s = setas[i];
      if (s.de.forma && mapa[s.de.forma]) s.de.forma = mapa[s.de.forma];
      if (s.para.forma && mapa[s.para.forma]) s.para.forma = mapa[s.para.forma];
    }
  }

  /* Rótulo de seta escrito ao LADO da linha, não em cima dela.
     No quadro, o "sim" / "não" de uma decisão é o texto mais comum, e a mão erra a linha por
     alguns pixels: o texto nasce solto e a leitura enviada ao Claude dizia "observação solta"
     em vez de dizer qual ramo é qual — que é justamente o que ele precisa saber.
     Aqui um texto curto e órfão, perto do meio de uma seta ainda SEM rótulo, vira o rótulo dela. */
  var TOL_ROTULO_SETA = 60;   // unidades de mundo (a caixa de texto padrão tem ~34 de altura)
  var MAX_ROTULO_SETA = 30;   // "sim", "não", "se pagar até sexta" — rótulo é curto por natureza

  function distPontoSegmento(px, py, ax, ay, bx, by) {
    var vx = bx - ax, vy = by - ay;
    var t = (vx * vx + vy * vy) < 0.000001 ? 0
      : Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy)));
    var dx = px - (ax + t * vx), dy = py - (ay + t * vy);
    return Math.sqrt(dx * dx + dy * dy);
  }

  function absorverRotulosDeSeta(formas, setas) {
    var i, j;
    var livres = [];
    for (i = 0; i < setas.length; i++) if (!String(setas[i].texto || '').trim()) livres.push(setas[i]);
    if (!livres.length) return;

    for (i = 0; i < formas.length; i++) {
      var T = formas[i];
      if (T.tipo !== 'texto' || T.absorvida) continue;
      var txt = colapsar(String(T.texto || ''));
      if (!txt || txt.length > MAX_ROTULO_SETA) continue;

      var c = centro(T);
      var melhor = null, dMelhor = TOL_ROTULO_SETA;
      for (j = 0; j < livres.length; j++) {
        var s2 = livres[j];
        if (s2._rotuloDe) continue;                    // uma seta recebe um rótulo só
        var d = distPontoSegmento(c.x, c.y, s2.de.x, s2.de.y, s2.para.x, s2.para.y);
        if (d < dMelhor) { dMelhor = d; melhor = s2; }
      }
      if (melhor) { melhor.texto = txt; melhor._rotuloDe = T.id; T.absorvida = melhor.id; }
    }
  }

  /* ══════════════════════════════════════════════════════════════
     5. NOMES (garante que dois nós nunca se confundem)
     ══════════════════════════════════════════════════════════════ */

  function nomear(formas) {
    var i;
    var ordem = formas.slice().sort(ordemLeitura);

    // 5.1 / 5.2 nome cru e nome genérico
    var contador = Object.create(null);
    for (i = 0; i < ordem.length; i++) {
      var f = ordem[i];
      var cru = colapsar(String(f.texto || '').replace(/\r\n|\r|\n/g, ' / '));
      cru = cru.replace(/`/g, '');   // backtick escaparia da cerca ```mermaid e destruiria a mensagem
      cru = colapsar(cru);
      if (cru) {
        f.nomeBase = cru;
      } else {
        var g = genericoTipo(f.tipo);
        contador[g] = (contador[g] || 0) + 1;
        f.nomeBase = g + ' ' + contador[g];
      }
      f.sufixo = '';
    }

    // 5.3 desambiguação sobre o nome JÁ CORTADO em MAX_ROTULO.
    // Comparar o nome inteiro deixava passar duas caixas que só divergem depois do
    // caractere 80: na tela e no mermaid elas saíam byte a byte iguais, sem (1)/(2).
    var grupos = new Map();
    for (i = 0; i < ordem.length; i++) {
      var ch = colapsar(semAcento(cortar(ordem[i].nomeBase, MAX_ROTULO)).toLowerCase());
      if (!grupos.has(ch)) grupos.set(ch, []);
      grupos.get(ch).push(ordem[i]);
    }
    grupos.forEach(function (g) {
      if (g.length < 2) return;
      g.sort(ordemLeitura);
      var tipos = Object.create(null), nTipos = 0, n;
      for (n = 0; n < g.length; n++) if (!tipos[g[n].tipo]) { tipos[g[n].tipo] = 1; nTipos++; }
      if (nTipos > 1) {
        for (n = 0; n < g.length; n++) g[n].sufixo = ' (' + palavraTipo(g[n].tipo) + ')';
      }
      // se ainda colidir dentro do grupo (mesmo tipo), numerar
      var sub = new Map();
      for (n = 0; n < g.length; n++) {
        var k = colapsar(semAcento(cortar(g[n].nomeBase, MAX_ROTULO) + g[n].sufixo).toLowerCase());
        if (!sub.has(k)) sub.set(k, []);
        sub.get(k).push(g[n]);
      }
      sub.forEach(function (lista) {
        if (lista.length < 2) return;
        for (var m = 0; m < lista.length; m++) lista[m].sufixo += ' (' + (m + 1) + ')';
      });
    });
  }

  // 5.4 truncar só na hora de renderizar; o sufixo fica FORA do corte.
  function nomeDe(f, max) {
    if (!f) return '';
    if (max == null) return f.nomeBase + f.sufixo;
    return cortar(f.nomeBase, max) + f.sufixo;
  }

  /* ══════════════════════════════════════════════════════════════
     6. ANCORAGEM DAS SETAS
     ══════════════════════════════════════════════════════════════ */

  function candidatasPerto(px, py, cands) {
    var achadas = [];
    for (var i = 0; i < cands.length; i++) {
      var d = distPontoCaixa(px, py, cands[i]);
      if (d <= RAIO_ANCORA) {
        var c = centro(cands[i]);
        achadas.push({ f: cands[i], d: d, dc: Math.sqrt((c.x - px) * (c.x - px) + (c.y - py) * (c.y - py)) });
      }
    }
    achadas.sort(function (a, b) {
      if (a.d !== b.d) return a.d - b.d;
      if (a.dc !== b.dc) return a.dc - b.dc;
      return a.f.id < b.f.id ? -1 : (a.f.id > b.f.id ? 1 : 0);
    });
    return achadas.map(function (a) { return a.f; });
  }

  function ancorar(formas, setas) {
    var porId = new Map();
    var cands = [];
    for (var i = 0; i < formas.length; i++) {
      porId.set(formas[i].id, formas[i]);
      // CANETA NUNCA É CANDIDATA: rabisco não é nó, âncora em rabisco produz leitura sem sentido.
      if (formas[i].tipo !== 'caneta') cands.push(formas[i]);
    }

    for (var k = 0; k < setas.length; k++) {
      var s = setas[k];
      s._de = null; s._para = null; s._deAuto = false; s._paraAuto = false;

      var fe = s.de.forma ? porId.get(s.de.forma) : null;
      if (fe && fe.tipo !== 'caneta') s._de = fe;
      var fp = s.para.forma ? porId.get(s.para.forma) : null;
      if (fp && fp.tipo !== 'caneta') s._para = fp;

      var listaPara = null;
      if (!s._de) {
        var r1 = candidatasPerto(s.de.x, s.de.y, cands);
        if (r1.length) { s._de = r1[0]; s._deAuto = true; }
      }
      if (!s._para) {
        listaPara = candidatasPerto(s.para.x, s.para.y, cands);
        if (listaPara.length) { s._para = listaPara[0]; s._paraAuto = true; }
      }

      // 6.3 seta curta desenhada DENTRO de um retângulo grande viraria um laço falso.
      if (s._deAuto && s._paraAuto && s._de === s._para && listaPara && listaPara.length > 1) {
        var dx = s.para.x - s.de.x, dy = s.para.y - s.de.y;
        if (Math.sqrt(dx * dx + dy * dy) > MIN_SETA_LONGA) s._para = listaPara[1];
      }

      s._classe = (s._de && s._para) ? 'ligada' : ((s._de || s._para) ? 'meia-solta' : 'solta');
    }
  }

  /* ══════════════════════════════════════════════════════════════
     7. GRAFO, BLOCOS E ORDEM
     ══════════════════════════════════════════════════════════════ */

  function montarGrafo(formas, setas) {
    var i, s;

    var ligadas = [], meias = [], soltas = [];
    for (i = 0; i < setas.length; i++) {
      s = setas[i];
      if (s._classe === 'ligada') ligadas.push(s);
      else if (s._classe === 'meia-solta') meias.push(s);
      else soltas.push(s);
    }

    // 7.1 quem é nó de fluxo
    var setNos = new Set();
    for (i = 0; i < formas.length; i++) {
      var t = formas[i].tipo;
      if (t === 'retangulo' || t === 'elipse' || t === 'losango') setNos.add(formas[i]);
    }
    for (i = 0; i < ligadas.length; i++) {
      // nota e texto só viram etapa se estiverem ligados por alguma seta/linha
      if (ligadas[i]._de.tipo === 'nota' || ligadas[i]._de.tipo === 'texto') setNos.add(ligadas[i]._de);
      if (ligadas[i]._para.tipo === 'nota' || ligadas[i]._para.tipo === 'texto') setNos.add(ligadas[i]._para);
    }
    var nos = [];
    for (i = 0; i < formas.length; i++) if (setNos.has(formas[i])) nos.push(formas[i]);

    // 7.2 blocos (componentes conexos), ignorando o sentido
    var pai = new Map();
    nos.forEach(function (n) { pai.set(n, n); });
    function achar(n) { while (pai.get(n) !== n) { pai.set(n, pai.get(pai.get(n))); n = pai.get(n); } return n; }
    function unir(a, b) { a = achar(a); b = achar(b); if (a !== b) pai.set(a, b); }
    for (i = 0; i < ligadas.length; i++) unir(ligadas[i]._de, ligadas[i]._para);

    var mapaBloco = new Map();
    nos.forEach(function (n) {
      var r = achar(n);
      if (!mapaBloco.has(r)) mapaBloco.set(r, []);
      mapaBloco.get(r).push(n);
    });
    var blocos = [];
    mapaBloco.forEach(function (lista) {
      lista.sort(ordemLeitura);
      var minY = Infinity, minX = Infinity;
      for (var b = 0; b < lista.length; b++) {
        if (lista[b].y < minY) minY = lista[b].y;
        if (lista[b].x < minX) minX = lista[b].x;
      }
      blocos.push({ nos: lista, minY: minY, minX: minX, faixa: Math.round(minY / BANDA_Y) });
    });
    blocos.sort(function (a, b) {
      if (a.faixa !== b.faixa) return a.faixa - b.faixa;
      if (a.minX !== b.minX) return a.minX - b.minX;
      return a.nos[0].id < b.nos[0].id ? -1 : 1;
    });

    // arestas dirigidas (linha NÃO cria precedência — só junta o bloco)
    var saidas = new Map(), entradas = new Map();
    nos.forEach(function (n) { saidas.set(n, []); entradas.set(n, []); });
    for (i = 0; i < ligadas.length; i++) {
      s = ligadas[i];
      saidas.get(s._de).push(s);
      entradas.get(s._para).push(s);
    }

    // 7.3 Kahn com escolha visual
    var quebrouCiclo = false;
    var emitidos = [];
    for (var bi = 0; bi < blocos.length; bi++) {
      var bloco = blocos[bi];
      var restantes = new Set(bloco.nos);
      var grau = new Map();
      bloco.nos.forEach(function (n) {
        var g = 0, lst = entradas.get(n);
        for (var e = 0; e < lst.length; e++) {
          if (lst[e].tipo === 'seta' && lst[e]._de !== n) g++;   // laço não conta como entrada
        }
        grau.set(n, g);
      });
      var teto = bloco.nos.length * 2 + 10, voltas = 0;
      while (restantes.size && voltas++ < teto) {
        var disp = [];
        restantes.forEach(function (n) { if (grau.get(n) <= 0) disp.push(n); });
        if (!disp.length) {
          quebrouCiclo = true;
          restantes.forEach(function (n) { disp.push(n); });
        }
        disp.sort(ordemLeitura);
        var esc = disp[0];
        restantes.delete(esc);
        emitidos.push(esc);
        var out = saidas.get(esc);
        for (var o = 0; o < out.length; o++) {
          if (out[o].tipo !== 'seta') continue;
          var alvo = out[o]._para;
          if (alvo !== esc && restantes.has(alvo)) grau.set(alvo, grau.get(alvo) - 1);
        }
      }
      if (restantes.size) {  // teto de segurança estourado: emite o resto na ordem de leitura
        var sobra = [];
        restantes.forEach(function (n) { sobra.push(n); });
        sobra.sort(ordemLeitura);
        for (var z = 0; z < sobra.length; z++) emitidos.push(sobra[z]);
      }
    }

    var pos = new Map();
    for (i = 0; i < emitidos.length; i++) pos.set(emitidos[i], i);

    // 7.4 arestas de volta
    for (i = 0; i < ligadas.length; i++) {
      s = ligadas[i];
      s._laco = (s._de === s._para);
      s._volta = false;
      if (s.tipo === 'seta' && !s._laco) {
        s._volta = pos.get(s._para) < pos.get(s._de);
      }
    }

    // entradas efetivas: dirigidas, sem laço e sem aresta de volta
    var efetivas = new Map();
    nos.forEach(function (n) {
      var lst = entradas.get(n), r = [];
      for (var e = 0; e < lst.length; e++) {
        var a = lst[e];
        if (a.tipo !== 'seta') continue;
        if (a._laco || a._volta) continue;
        r.push(a);
      }
      r.sort(function (p, q) {
        var pp = pos.get(p._de), qq = pos.get(q._de);
        if (pp !== qq) return pp - qq;
        return p.id < q.id ? -1 : 1;
      });
      efetivas.set(n, r);
    });

    // bbox da cena (para o quadrante das observações)
    var bb = null;
    (function () {
      var mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity, achou = false;
      for (var a = 0; a < formas.length; a++) {
        var f = formas[a];
        if (f.x < mnx) mnx = f.x; if (f.y < mny) mny = f.y;
        if (f.x + f.w > mxx) mxx = f.x + f.w; if (f.y + f.h > mxy) mxy = f.y + f.h;
        achou = true;
      }
      for (var c = 0; c < setas.length; c++) {
        var st = setas[c];
        var xs = [st.de.x, st.para.x], ys = [st.de.y, st.para.y];
        for (var d = 0; d < 2; d++) {
          if (xs[d] < mnx) mnx = xs[d]; if (xs[d] > mxx) mxx = xs[d];
          if (ys[d] < mny) mny = ys[d]; if (ys[d] > mxy) mxy = ys[d];
        }
        achou = true;
      }
      if (achou) bb = { x: mnx, y: mny, w: mxx - mnx, h: mxy - mny };
    })();

    // 8.5 observações: nota/texto que não viraram nó, caneta e seta solta
    var obs = [];
    for (i = 0; i < formas.length; i++) {
      var f2 = formas[i];
      if (setNos.has(f2)) continue;
      if (f2.tipo === 'caneta') obs.push({ especie: 'caneta', forma: f2, y: f2.y, x: f2.x, id: f2.id });
      else if (f2.tipo === 'nota' || f2.tipo === 'texto') obs.push({ especie: f2.tipo, forma: f2, y: f2.y, x: f2.x, id: f2.id });
    }
    for (i = 0; i < soltas.length; i++) {
      var ss = soltas[i];
      var my = (ss.de.y + ss.para.y) / 2, mx = (ss.de.x + ss.para.x) / 2;
      obs.push({ especie: 'seta', seta: ss, y: my, x: mx, id: ss.id });
    }
    obs.sort(ordemLeitura);

    return {
      formas: formas, setas: setas, nos: emitidos, blocos: blocos, pos: pos,
      ligadas: ligadas, meias: meias, soltas: soltas,
      saidas: saidas, entradas: entradas, efetivas: efetivas,
      obs: obs, bb: bb, quebrouCiclo: quebrouCiclo, setNos: setNos, titulo: ''
    };
  }

  /* ══════════════════════════════════════════════════════════════
     11. TÍTULO — só existe se for INEQUÍVOCO. Na dúvida, ''.
     ══════════════════════════════════════════════════════════════ */

  function acharTitulo(G) {
    var i;
    if (G.nos.length < 3) return null;   // precisa sobrar 2+ nós além do candidato

    // quem tem alguma seta/linha ligada (grau > 0) não pode ser título
    var comGrau = new Set();
    for (i = 0; i < G.setas.length; i++) {
      if (G.setas[i]._de) comGrau.add(G.setas[i]._de);
      if (G.setas[i]._para) comGrau.add(G.setas[i]._para);
    }

    var candidatos = [];
    for (i = 0; i < G.formas.length; i++) {
      var f = G.formas[i];
      if (f.tipo !== 'texto' && f.tipo !== 'retangulo' && f.tipo !== 'elipse' && f.tipo !== 'nota') continue;
      if (!f.texto) continue;
      if (comGrau.has(f)) continue;
      candidatos.push(f);
    }
    if (!candidatos.length) return null;

    // mediana das alturas dos 'texto' da cena (bônus do texto grande)
    var alturas = [];
    for (i = 0; i < G.formas.length; i++) if (G.formas[i].tipo === 'texto') alturas.push(G.formas[i].h);
    alturas.sort(function (a, b) { return a - b; });
    var mediana = alturas.length ? alturas[Math.floor((alturas.length - 1) / 2)] : 0;

    var escolhido = null;
    for (i = 0; i < candidatos.length; i++) {
      var c = candidatos[i];

      // (d) está ACIMA de todo o resto
      var menorY = Infinity;
      for (var j = 0; j < G.formas.length; j++) {
        var o = G.formas[j];
        if (o === c) continue;
        if (o.tipo === 'caneta') continue;
        if (o.y < menorY) menorY = o.y;
      }
      if (menorY === Infinity) continue;
      if (!(c.y + c.h <= menorY + 4)) continue;

      // (e) tem que sobrar pelo menos 2 outros nós de fluxo
      var outros = 0;
      for (var k = 0; k < G.nos.length; k++) if (G.nos[k] !== c) outros++;
      if (outros < 2) continue;

      c._grande = (c.tipo === 'texto' && mediana > 0 && c.h >= 1.4 * mediana);
      if (!escolhido) { escolhido = c; continue; }
      if (c._grande !== escolhido._grande) { if (c._grande) escolhido = c; continue; }
      if (c.h !== escolhido.h) { if (c.h > escolhido.h) escolhido = c; continue; }
      if (c.w !== escolhido.w) { if (c.w > escolhido.w) escolhido = c; continue; }
      if (c.y !== escolhido.y) { if (c.y < escolhido.y) escolhido = c; continue; }
      if (c.id < escolhido.id) escolhido = c;
    }
    return escolhido;
  }

  function formatarTitulo(f) {
    var s = colapsar(String(f.texto || '').replace(/\r\n|\r|\n/g, ' ').replace(/`/g, ''));
    return cortar(s, MAX_TITULO);
  }

  /* ══════════════════════════════════════════════════════════════
     8.5 — texto de cada observação (usado no texto E nos comentários do mermaid)
     ══════════════════════════════════════════════════════════════ */

  function noMaisPerto(G, alvo) {
    var melhor = null, melhorD = Infinity;
    for (var i = 0; i < G.nos.length; i++) {
      var d = distCaixaCaixa(alvo, G.nos[i]);
      if (d < melhorD) { melhorD = d; melhor = G.nos[i]; }
    }
    return melhor ? { no: melhor, d: melhorD } : null;
  }

  function textoObs(G, o) {
    var perto, q;
    if (o.especie === 'nota' || o.especie === 'texto') {
      var base = '"' + cortar(o.forma.nomeBase, MAX_ROTULO) + o.forma.sufixo + '"';
      perto = noMaisPerto(G, o.forma);
      if (perto && perto.d <= PERTO) return base + ' (perto de ' + nomeDe(perto.no, MAX_ROTULO) + ')';
      if (G.nos.length) return base + ' (' + quadrante(G.bb, centro(o.forma).x, centro(o.forma).y) + ')';
      return base;   // não há nó nenhum na cena: quadrante não diz nada
    }
    if (o.especie === 'caneta') {
      var t = 'rabisco à mão livre';
      if (o.forma.texto) t += ' "' + cortar(o.forma.nomeBase, MAX_ROTULO) + '"';
      perto = noMaisPerto(G, o.forma);
      if (perto && perto.d <= PERTO) return t + ' (perto de ' + nomeDe(perto.no, MAX_ROTULO) + ')';
      q = quadrante(G.bb, centro(o.forma).x, centro(o.forma).y);
      return t + ' ' + q;
    }
    // seta solta — nunca interpretar, só dizer para onde aponta e onde está
    var s = o.seta;
    var dir = direcao(s.para.x - s.de.x, s.para.y - s.de.y);
    var rot = s.tipo === 'linha' ? 'linha solta ' + dir : 'seta solta apontando ' + dir;
    if (s.texto) rot += ' com "' + cortar(s.texto, MAX_ROTULO) + '"';
    var fake = { x: Math.min(s.de.x, s.para.x), y: Math.min(s.de.y, s.para.y), w: Math.abs(s.para.x - s.de.x), h: Math.abs(s.para.y - s.de.y) };
    perto = noMaisPerto(G, fake);
    if (perto && perto.d <= PERTO) return rot + ', perto de ' + nomeDe(perto.no, MAX_ROTULO);
    return rot + ', ' + quadrante(G.bb, (s.de.x + s.para.x) / 2, (s.de.y + s.para.y) / 2);
  }

  /* ══════════════════════════════════════════════════════════════
     8. SAÍDA `texto` — a leitura numerada
     ══════════════════════════════════════════════════════════════ */

  function saidasDe(G, n) {
    var itens = [], i;
    var lst = G.saidas.get(n) || [];
    for (i = 0; i < lst.length; i++) {
      var s = lst[i];
      if (s.tipo !== 'seta') continue;                     // linha entra em 8.4
      itens.push({ tipo: 'aresta', seta: s, destino: s._para, volta: !!s._volta, laco: !!s._laco });
    }
    for (i = 0; i < G.meias.length; i++) {
      var m = G.meias[i];
      if (m._de === n && !m._para) itens.push({ tipo: 'fora', seta: m, volta: false, laco: false });
    }
    itens.sort(function (a, b) {
      var av = a.volta ? 1 : 0, bv = b.volta ? 1 : 0;
      if (av !== bv) return av - bv;
      var af = a.tipo === 'fora' ? 1 : 0, bf = b.tipo === 'fora' ? 1 : 0;
      if (af !== bf) return af - bf;
      var ap = a.destino ? G.pos.get(a.destino) : 1e9;
      var bp = b.destino ? G.pos.get(b.destino) : 1e9;
      if (ap !== bp) return ap - bp;
      return a.seta.id < b.seta.id ? -1 : 1;
    });
    return itens;
  }

  function linhaDeSaida(G, n, it) {
    var pre;
    var rot = it.seta.texto;

    // LINHA (sem ponta) com a outra extremidade no vazio: o desenho não diz sentido
    // nenhum. Narrar como "depois → seta solta apontando ..." inventava uma direção
    // que o usuário não desenhou.
    if (it.tipo === 'fora' && it.seta.tipo === 'linha') {
      var sl = it.seta;
      var linha = '   - sai uma linha ' + direcao(sl.para.x - sl.de.x, sl.para.y - sl.de.y) +
                  ' (não chega em nada, e não diz para que lado vai)';
      if (rot) linha += ' com "' + cortar(rot, MAX_ROTULO) + '"';
      return linha;
    }

    if (n.tipo === 'losango') {
      pre = rot ? ('   - se ' + cortar(rot, MAX_ROTULO) + ' → ') : '   - saída sem resposta escrita → ';
    } else {
      pre = rot ? ('   - ' + cortar(rot, MAX_ROTULO) + ' → ') : '   - depois → ';
    }
    var dest;
    if (it.tipo === 'fora') {
      var s = it.seta;
      dest = 'seta solta apontando ' + direcao(s.para.x - s.de.x, s.para.y - s.de.y) + ' (não chega em nada)';
    } else if (it.laco) {
      dest = 'ela mesma (fica em looping)';
    } else if (it.volta) {
      dest = 'volta para ' + nomeDe(it.destino, MAX_ROTULO);
    } else {
      dest = nomeDe(it.destino, MAX_ROTULO);
    }
    return pre + dest;
  }

  function extrasDe(G, n) {
    var out = [], i;
    // linha sem ponta: emitida UMA vez, no extremo de MENOR posição
    for (i = 0; i < G.ligadas.length; i++) {
      var s = G.ligadas[i];
      if (s.tipo !== 'linha') continue;
      var a = s._de, b = s._para;
      if (a !== n && b !== n) continue;
      var dono = a;
      if (a !== b) dono = (G.pos.get(a) <= G.pos.get(b)) ? a : b;
      if (dono !== n) continue;
      var outro = (a === n) ? b : a;
      out.push('   - ligado a ' + nomeDe(outro, MAX_ROTULO) + ' (linha sem ponta: não diz para que lado vai)');
    }
    // seta meia-solta que CHEGA nele (a ponta de trás está no vazio)
    for (i = 0; i < G.meias.length; i++) {
      var m = G.meias[i];
      if (m._para === n && !m._de) {
        if (m.tipo === 'linha') {
          // sem ponta: só encosta, não afirma direção
          out.push('   - encosta uma linha que vem ' + ladoDeOrigem(m.para.x - m.de.x, m.para.y - m.de.y) +
                   ' de fora (a outra extremidade está solta, e não diz para que lado vai)');
        } else {
          out.push('   - chega uma seta vinda ' + ladoDeOrigem(m.para.x - m.de.x, m.para.y - m.de.y) +
                   ' de fora (a ponta não está grudada em nada)');
        }
      }
    }
    return out;
  }

  // A linha do nó `prox` vai mesmo começar com "Isso vai para"? Espelha, na mesma ordem,
  // os desvios de corpoLinha que NÃO nomeiam a origem.
  function diraIssoVaiPara(G, prox, n, primeirosDoBloco) {
    if (primeirosDoBloco.has(prox)) return false;   // "Começa em: ..."
    if (prox.tipo === 'losango') return false;      // 'Decisão "..."'
    if (prox.tipo === 'nota') return false;         // "Observação no meio do fluxo"
    if (prox.tipo === 'elipse') return false;       // "Fim: ..." / "Marco: ..."
    var ent = G.efetivas.get(prox) || [];
    return ent.length === 1 && ent[0]._de === n && !ent[0].texto;
  }

  function escreverTexto(G) {
    var maxNos = G.opts.maxNos;
    var linhas = [];
    var i;

    if (!G.nos.length) {
      var temNotaOuTexto = false, temSeta = false, temCaneta = false;
      for (i = 0; i < G.obs.length; i++) {
        if (G.obs[i].especie === 'nota' || G.obs[i].especie === 'texto') temNotaOuTexto = true;
        if (G.obs[i].especie === 'seta') temSeta = true;
        if (G.obs[i].especie === 'caneta') temCaneta = true;
      }
      if (!G.obs.length) return 'O quadro está em branco: não desenhei nada nele.';
      var prefixo = '';
      if (!temNotaOuTexto) {
        if (temSeta) prefixo = 'Não há caixas, só setas soltas.';
        else if (temCaneta) prefixo = 'Não há caixas nem setas, só desenho à mão livre.';
      }
      var corpo = ['Observações soltas:'];
      for (i = 0; i < G.obs.length; i++) corpo.push('- ' + textoObs(G, G.obs[i]));
      return (prefixo ? prefixo + '\n\n' : '') + corpo.join('\n');
    }

    var quantos = Math.min(G.nos.length, maxNos);
    var primeirosDoBloco = new Set();
    for (i = 0; i < G.blocos.length; i++) {
      // o primeiro EMITIDO do bloco (não o primeiro da lista ordenada)
      var melhor = null;
      for (var b = 0; b < G.blocos[i].nos.length; b++) {
        var cand = G.blocos[i].nos[b];
        if (!melhor || G.pos.get(cand) < G.pos.get(melhor)) melhor = cand;
      }
      if (melhor) primeirosDoBloco.add(melhor);
    }
    var blocoDe = new Map();
    for (i = 0; i < G.blocos.length; i++) {
      for (var c = 0; c < G.blocos[i].nos.length; c++) blocoDe.set(G.blocos[i].nos[c], i);
    }
    var mostrarCabecalhoBloco = G.blocos.length > 1;
    var blocoAtual = -1;

    for (i = 0; i < quantos; i++) {
      var n = G.nos[i];
      var anterior = i > 0 ? G.nos[i - 1] : null;
      var bi = blocoDe.get(n);
      if (mostrarCabecalhoBloco && bi !== blocoAtual) {
        if (linhas.length) linhas.push('');
        linhas.push('Bloco ' + (bi + 1) + ':');
        blocoAtual = bi;
      }

      var ent = G.efetivas.get(n) || [];
      var saidas = saidasDe(G, n);
      var dirigidas = 0;
      for (var d = 0; d < saidas.length; d++) if (saidas[d].tipo === 'aresta') dirigidas++;

      var nome = nomeDe(n, MAX_ROTULO);
      var corpoLinha;

      if (primeirosDoBloco.has(n)) {
        corpoLinha = 'Começa em: ' + nome;
      } else if (n.tipo === 'losango') {
        corpoLinha = 'Decisão "' + nome + '":';
      } else if (n.tipo === 'nota') {
        corpoLinha = 'Observação no meio do fluxo: "' + nome + '"';
      } else if (n.tipo === 'elipse' && dirigidas === 0) {
        corpoLinha = 'Fim: ' + nome;
      } else if (n.tipo === 'elipse') {
        corpoLinha = 'Marco: ' + nome;
      } else if (ent.length === 1 && ent[0]._de === anterior && !ent[0].texto) {
        corpoLinha = 'Isso vai para: ' + nome;
      } else if (ent.length === 1 && ent[0]._de.tipo === 'losango') {
        corpoLinha = 'Nesse caminho: ' + nome;
      } else if (ent.length >= 2) {
        var vindos = [];
        for (var e = 0; e < ent.length; e++) vindos.push(nomeDe(ent[e]._de, MAX_ROTULO));
        corpoLinha = nome + ' (chega de: ' + vindos.join(', ') + ')';
      } else if (ent.length === 1) {
        corpoLinha = 'Vindo de ' + nomeDe(ent[0]._de, MAX_ROTULO) + ': ' + nome;
      } else if (ent.length === 0) {
        corpoLinha = 'Também tem: ' + nome;
      } else {
        corpoLinha = 'Passo: ' + nome;
      }

      // sufixo de fim de linha. Conta só grau DIRIGIDO (seta): um nó ligado apenas por
      // linha sem ponta não termina caminho nenhum — antes o bloco inteiro ganhava
      // "(aqui acaba)" em todos os nós de uma vez.
      var grauDirigido = 0;
      var lsai = G.saidas.get(n) || [], lent = G.entradas.get(n) || [];
      for (var g1 = 0; g1 < lsai.length; g1++) if (lsai[g1].tipo === 'seta') grauDirigido++;
      for (var g2 = 0; g2 < lent.length; g2++) if (lent[g2].tipo === 'seta') grauDirigido++;
      if (dirigidas === 0 && grauDirigido > 0 && n.tipo !== 'elipse' && G.nos.length >= 2) corpoLinha += ' (aqui acaba)';

      linhas.push((i + 1) + '. ' + corpoLinha);

      // omitir o bloco de saídas SÓ quando a linha seguinte realmente repete a ligação
      // ("Isso vai para: X"). Losango, nota e elipse têm corpo próprio que NÃO diz de
      // onde vieram — omitir ali apagava a seta da leitura.
      var mostrar = true;
      if (n.tipo !== 'losango' && saidas.length === 1) {
        var s0 = saidas[0];
        var prox = (i + 1 < quantos) ? G.nos[i + 1] : null;
        if (s0.tipo === 'aresta' && !s0.volta && !s0.laco && !s0.seta.texto && prox && s0.destino === prox &&
            diraIssoVaiPara(G, prox, n, primeirosDoBloco)) {
          mostrar = false;
        }
      }
      if (mostrar) {
        for (var w = 0; w < saidas.length; w++) linhas.push(linhaDeSaida(G, n, saidas[w]));
      }
      var ex = extrasDe(G, n);
      for (var y = 0; y < ex.length; y++) linhas.push(ex[y]);
    }

    if (G.nos.length > quantos) {
      linhas.push('…e mais ' + (G.nos.length - quantos) + ' caixas que não couberam nesta leitura (elas estão na imagem).');
    }

    if (G.obs.length) {
      linhas.push('');
      linhas.push('Observações soltas:');
      for (i = 0; i < G.obs.length; i++) linhas.push('- ' + textoObs(G, G.obs[i]));
    }

    return linhas.join('\n');
  }

  /* ══════════════════════════════════════════════════════════════
     9. SAÍDA `mermaid`
     ══════════════════════════════════════════════════════════════ */

  function idMermaid(n) {   // 1->A, 26->Z, 27->AA (bijetivo base 26, sempre maiúsculo)
    var s = '';
    while (n > 0) {
      var r = (n - 1) % 26;
      s = String.fromCharCode(65 + r) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s || 'A';
  }

  // O CORTE vem ANTES das substituições: cortar depois partia a entidade no meio
  // ('#quo…' aparecia literal no rótulo). Depois disso, a ORDEM das substituições
  // importa: '#' primeiro, senão as entidades recém-criadas (#quot; #124;) são reescritas.
  // max === null: string já veio cortada por nomeDe (o sufixo (1)/(2) fica fora do corte).
  function rotMermaid(s, tipo, max) {
    s = String(s == null ? '' : s);
    s = s.replace(/[`\\]/g, '');
    if (max !== null) s = cortar(s, max === undefined ? MAX_ROTULO : max);
    s = s.replace(/\r\n|\r|\n/g, '<br/>');
    s = s.replace(/#/g, '#35;');
    s = s.replace(/"/g, '#quot;');
    s = s.replace(/\|/g, '#124;');
    if (!s.trim()) s = genericoTipo(tipo || 'retangulo');
    return s;
  }

  function comentarioMermaid(s) {
    return cortar(String(s == null ? '' : s).replace(/\r\n|\r|\n/g, ' / '), 120);
  }

  function escreverMermaid(G) {
    var linhas = ['flowchart TD'];
    var i;

    if (!G.nos.length) {
      if (!G.obs.length) return 'flowchart TD\n  %% quadro em branco';
      var soCaneta = true, temCaneta = false;
      for (i = 0; i < G.obs.length; i++) {
        if (G.obs[i].especie !== 'caneta') soCaneta = false;
        else temCaneta = true;
      }
      if (soCaneta && temCaneta) return 'flowchart TD\n  %% so rabisco a mao livre, sem caixas';
      if (G.titulo) linhas.push('  %% ' + comentarioMermaid(G.titulo));
      for (i = 0; i < G.obs.length; i++) {
        var o0 = G.obs[i];
        var pref0 = (o0.especie === 'nota' || o0.especie === 'texto') ? 'observação: ' : '';
        linhas.push('  %% ' + comentarioMermaid(pref0 + textoObs(G, o0)));
      }
      return linhas.join('\n');
    }

    if (G.titulo) linhas.push('  %% ' + comentarioMermaid(G.titulo));

    // TODOS os nós declarados primeiro, com rótulo sempre aspado.
    // "Forma na primeira menção" dentro das arestas é a fonte nº 1 de mermaid quebrado.
    var idm = new Map();
    for (i = 0; i < G.nos.length; i++) {
      var n = G.nos[i];
      var mid = idMermaid(i + 1);
      idm.set(n, mid);
      var rot = rotMermaid(nomeDe(n, MAX_ROTULO), n.tipo, null);
      var decl;
      if (n.tipo === 'losango') decl = mid + '{"' + rot + '"}';
      else if (n.tipo === 'elipse') decl = mid + '(["' + rot + '"])';
      else if (n.tipo === 'nota') decl = mid + '[/"' + rot + '"/]';
      else decl = mid + '["' + rot + '"]';
      linhas.push('  ' + decl);
    }

    for (i = 0; i < G.ligadas.length; i++) {
      var s = G.ligadas[i];
      var a = idm.get(s._de), b = idm.get(s._para);
      if (!a || !b) continue;
      var seta = s.tipo === 'linha' ? '---' : '-->';
      if (s.texto) linhas.push('  ' + a + ' ' + seta + '|"' + rotMermaid(s.texto) + '"| ' + b);
      else linhas.push('  ' + a + ' ' + seta + ' ' + b);
    }

    // Nada de nó-fantasma para a ponta solta: fantasma é lido como etapa real.
    for (i = 0; i < G.meias.length; i++) {
      var m = G.meias[i];
      var eLinha = (m.tipo === 'linha');   // sem ponta: o comentário não pode afirmar sentido
      if (m._de && idm.has(m._de)) {
        linhas.push('  %% ' + comentarioMermaid((eLinha ? 'linha solta saindo de ' : 'seta solta saindo de ') +
          nomeDe(m._de, MAX_ROTULO) + ' ' + direcao(m.para.x - m.de.x, m.para.y - m.de.y) +
          (eLinha ? ' (nao diz para que lado vai)' : '')));
      } else if (m._para && idm.has(m._para)) {
        linhas.push('  %% ' + comentarioMermaid((eLinha ? 'linha solta encostando em ' : 'seta solta chegando em ') +
          nomeDe(m._para, MAX_ROTULO) + ', vinda ' + ladoDeOrigem(m.para.x - m.de.x, m.para.y - m.de.y) + ' de fora' +
          (eLinha ? ' (nao diz para que lado vai)' : '')));
      }
    }

    for (i = 0; i < G.obs.length; i++) {
      var o = G.obs[i];
      var pref = (o.especie === 'nota' || o.especie === 'texto') ? 'observação: ' : '';
      linhas.push('  %% ' + comentarioMermaid(pref + textoObs(G, o)));
    }

    return linhas.join('\n');
  }

  /* ══════════════════════════════════════════════════════════════
     10. SAÍDA `resumo` (uma linha só)
     ══════════════════════════════════════════════════════════════ */

  function escreverResumo(G) {
    var i;

    if (!G.nos.length) {
      if (!G.obs.length) return 'Quadro em branco.';
      var nNota = 0, nCaneta = 0, nSeta = 0, ultimaNota = null;
      for (i = 0; i < G.obs.length; i++) {
        if (G.obs[i].especie === 'nota' || G.obs[i].especie === 'texto') { nNota++; ultimaNota = G.obs[i]; }
        else if (G.obs[i].especie === 'caneta') nCaneta++;
        else nSeta++;
      }
      if (nNota === 1 && !nCaneta && !nSeta) {
        return 'Só uma observação escrita: "' + cortar(ultimaNota.forma.nomeBase, 40) + '".';
      }
      if (nNota && !nCaneta && !nSeta) return 'Só ' + nNota + ' observações escritas, sem nenhuma caixa.';
      if (nSeta && !nNota && !nCaneta) return 'Só setas soltas, sem nenhuma caixa.';
      if (nCaneta && !nNota && !nSeta) return 'Rabisco à mão livre, sem caixas nem setas.';
      return 'Só rabiscos e observações soltas, sem nenhuma caixa.';
    }

    var nDecisoes = 0, nCaixas = 0;
    for (i = 0; i < G.nos.length; i++) {
      if (G.nos[i].tipo === 'losango') nDecisoes++; else nCaixas++;
    }

    var primeiro = G.nos[0];
    var ultimo = null;
    for (i = G.nos.length - 1; i >= 0; i--) {
      var lst = G.saidas.get(G.nos[i]) || [];
      var temDirigida = false;
      for (var e = 0; e < lst.length; e++) if (lst[e].tipo === 'seta') temDirigida = true;
      if (!temDirigida) { ultimo = G.nos[i]; break; }
    }
    if (!ultimo) ultimo = G.nos[G.nos.length - 1];

    if (G.nos.length === 1) {
      var uma = primeiro.tipo === 'losango' ? 'Uma decisão só: "' : 'Uma caixa só: "';
      return uma + cortar(primeiro.nomeBase, 40) + primeiro.sufixo + '".';
    }

    var partes = 'Fluxo de ' + nCaixas + (nCaixas === 1 ? ' caixa' : ' caixas');
    if (nDecisoes > 0) partes += ' e ' + nDecisoes + (nDecisoes === 1 ? ' decisão' : ' decisões');
    partes += ', de "' + cortar(primeiro.nomeBase, 40) + primeiro.sufixo + '"';
    partes += ' até "' + cortar(ultimo.nomeBase, 40) + ultimo.sufixo + '"';
    if (G.blocos.length > 1) partes += ', em ' + G.blocos.length + ' blocos separados';

    var temCiclo = false;
    for (i = 0; i < G.ligadas.length; i++) if (G.ligadas[i]._volta) temCiclo = true;
    if (temCiclo || G.quebrouCiclo) partes += ' (tem um ponto que volta atrás)';

    return partes + '.';
  }

  /* ══════════════════════════════════════════════════════════════
     13. `mensagem` — o texto EXATO que vai pro chat
     ══════════════════════════════════════════════════════════════ */

  function montarMensagem(d, G, o) {
    var partes = [];
    if (o.comCabecalho !== false) partes.push(CABECALHO);
    if (d.titulo) partes.push('Título do quadro: ' + d.titulo);
    partes.push('Como o fluxo se lê:\n\n' + d.texto);

    var temAresta = G && G.ligadas && G.ligadas.length > 0;
    var nNos = G && G.nos ? G.nos.length : 0;
    if (o.comMermaid !== false && nNos >= 2 && temAresta) {
      partes.push('O mesmo fluxo em mermaid:\n\n```mermaid\n' + d.mermaid + '\n```');
    }
    if (o.comLinhaFinal !== false) partes.push(LINHA_FINAL);
    return partes.join('\n\n');
  }

  /* ══════════════════════════════════════════════════════════════
     G2 — objeto de emergência: um bug aqui NUNCA pode impedir
     o usuário de mandar o desenho.
     ══════════════════════════════════════════════════════════════ */

  function emergencia(opts) {
    var o = opts || {};
    var frase = 'Desenhei alguma coisa no quadro, mas não consegui ler o desenho em texto. Vale só a imagem anexada.';
    var partes = [];
    if (o.comCabecalho !== false) partes.push(CABECALHO);
    partes.push(frase);
    if (o.comLinhaFinal !== false) partes.push(LINHA_FINAL);
    return {
      titulo: '',
      texto: frase,
      mermaid: 'flowchart TD\n  %% nao foi possivel ler a cena',
      resumo: 'Desenho no quadro (não deu para descrever em texto).',
      mensagem: partes.join('\n\n')
    };
  }

  /* ══════════════════════════════════════════════════════════════
     PIPELINE
     ══════════════════════════════════════════════════════════════ */

  function descrever(cena, opts) {
    try {
      var o = {
        comMermaid: true,
        maxNos: MAX_NOS,
        comCabecalho: true,
        comLinhaFinal: true
      };
      if (opts && typeof opts === 'object') {
        if (opts.comMermaid !== undefined) o.comMermaid = opts.comMermaid;
        if (typeof opts.maxNos === 'number' && opts.maxNos > 0) o.maxNos = Math.floor(opts.maxNos);
        if (opts.comCabecalho !== undefined) o.comCabecalho = opts.comCabecalho;
        if (opts.comLinhaFinal !== undefined) o.comLinhaFinal = opts.comLinhaFinal;
      }

      var s = sanear(cena);
      var formas = s.formas, setas = s.setas;

      absorverTextos(formas, setas);
      absorverRotulosDeSeta(formas, setas);   // o que sobrou perto de uma seta vira rótulo dela
      formas = formas.filter(function (f) { return !f.absorvida; });

      nomear(formas);
      ancorar(formas, setas);

      var G = montarGrafo(formas, setas);
      var tituloForma = acharTitulo(G);
      var titulo = '';
      if (tituloForma) {
        titulo = formatarTitulo(tituloForma);
        formas = formas.filter(function (f) { return f !== tituloForma; });
        ancorar(formas, setas);          // recontar sem o título
        G = montarGrafo(formas, setas);
      }
      G.titulo = titulo;
      G.opts = o;

      var d = {
        titulo: titulo,
        texto: escreverTexto(G),
        mermaid: escreverMermaid(G),
        resumo: escreverResumo(G),
        mensagem: ''
      };
      if (!d.texto) d.texto = 'O quadro está em branco: não desenhei nada nele.';
      if (!d.mermaid) d.mermaid = 'flowchart TD\n  %% quadro em branco';
      if (!d.resumo) d.resumo = 'Quadro em branco.';
      d.mensagem = montarMensagem(d, G, o);
      if (!d.mensagem) d.mensagem = d.texto;
      return d;
    } catch (e) {
      return emergencia(opts);
    }
  }

  /* ══════════════════════════════════════════════════════════════
     AUTO-TESTE — só roda com window.QUADRO_TESTE = true
     (ou chamando QuadroTexto.autoTeste() no console / no node)
     ══════════════════════════════════════════════════════════════ */

  function cenasDeTeste() {
    return [
      {
        nome: '1) fluxo simples (3 caixas em fila)',
        cena: {
          v: 1,
          formas: [
            { id: 'a', tipo: 'elipse', x: 100, y: 40, w: 220, h: 60, texto: 'Lead entra pelo anúncio' },
            { id: 'b', tipo: 'retangulo', x: 100, y: 160, w: 220, h: 60, texto: 'Página de captura' },
            { id: 'c', tipo: 'retangulo', x: 100, y: 280, w: 220, h: 60, texto: 'Manda pro WhatsApp' }
          ],
          setas: [
            { id: 's1', tipo: 'seta', de: { forma: 'a', x: 210, y: 100 }, para: { forma: 'b', x: 210, y: 160 } },
            { id: 's2', tipo: 'seta', de: { forma: 'b', x: 210, y: 220 }, para: { forma: 'c', x: 210, y: 280 } }
          ]
        }
      },
      {
        nome: '2) fluxo com decisão, nota solta e volta (o exemplo da spec)',
        cena: {
          v: 1,
          formas: [
            { id: 'a', tipo: 'elipse', x: 100, y: 40, w: 220, h: 60, texto: 'Lead entra pelo anúncio' },
            { id: 'b', tipo: 'retangulo', x: 100, y: 160, w: 220, h: 60, texto: 'Página de captura' },
            { id: 'c', tipo: 'losango', x: 100, y: 280, w: 220, h: 80, texto: 'Preencheu o formulário?' },
            { id: 'd', tipo: 'retangulo', x: -60, y: 430, w: 200, h: 60, texto: 'Manda pro WhatsApp' },
            { id: 'e', tipo: 'retangulo', x: 300, y: 430, w: 200, h: 60, texto: 'Remarketing' },
            { id: 'n', tipo: 'nota', x: 400, y: 160, w: 180, h: 60, texto: 'testar 2 versões' }
          ],
          setas: [
            { id: 's1', tipo: 'seta', de: { forma: 'a' }, para: { forma: 'b' } },
            { id: 's2', tipo: 'seta', de: { forma: 'b' }, para: { forma: 'c' } },
            { id: 's3', tipo: 'seta', de: { forma: 'c' }, para: { forma: 'd' }, texto: 'sim' },
            { id: 's4', tipo: 'seta', de: { forma: 'c' }, para: { forma: 'e' }, texto: 'não' },
            { id: 's5', tipo: 'seta', de: { forma: 'e' }, para: { forma: 'b' } }
          ]
        }
      },
      {
        nome: '3) dois blocos desconexos',
        cena: {
          v: 1,
          formas: [
            { id: 'a', tipo: 'retangulo', x: 40, y: 40, w: 180, h: 60, texto: 'Anúncio' },
            { id: 'b', tipo: 'retangulo', x: 40, y: 160, w: 180, h: 60, texto: 'Página' },
            { id: 'c', tipo: 'retangulo', x: 500, y: 40, w: 180, h: 60, texto: 'E-mail frio' },
            { id: 'd', tipo: 'retangulo', x: 500, y: 160, w: 180, h: 60, texto: 'Reunião' },
            { id: 'p', tipo: 'caneta', x: 0, y: 0, w: 0, h: 0, pontos: [[300, 340], [340, 380], [310, 400]] }
          ],
          setas: [
            { id: 's1', tipo: 'seta', de: { forma: 'a' }, para: { forma: 'b' } },
            { id: 's2', tipo: 'seta', de: { forma: 'c' }, para: { forma: 'd' } }
          ]
        }
      },
      {
        nome: '4) ciclo puro A→B→C→A, com texto escrito por cima de uma caixa',
        cena: {
          v: 1,
          formas: [
            { id: 'a', tipo: 'retangulo', x: 100, y: 40, w: 200, h: 60, texto: '' },
            { id: 't', tipo: 'texto', x: 130, y: 55, w: 140, h: 24, texto: 'Captura' },
            { id: 'b', tipo: 'retangulo', x: 100, y: 200, w: 200, h: 60, texto: 'Nutrição' },
            { id: 'c', tipo: 'retangulo', x: 100, y: 360, w: 200, h: 60, texto: 'Oferta' }
          ],
          setas: [
            { id: 's1', tipo: 'seta', de: { forma: 't' }, para: { forma: 'b' } },
            { id: 's2', tipo: 'seta', de: { forma: 'b' }, para: { forma: 'c' } },
            { id: 's3', tipo: 'seta', de: { forma: 'c' }, para: { forma: 'a' } }
          ]
        }
      },
      {
        nome: '5) cena vazia',
        cena: { v: 1, formas: [], setas: [] }
      }
    ];
  }

  function autoTeste() {
    var casos = cenasDeTeste();
    for (var i = 0; i < casos.length; i++) {
      var d = descrever(casos[i].cena);
      /* eslint-disable no-console */
      console.log('\n══════ ' + casos[i].nome + ' ══════');
      console.log('titulo :', JSON.stringify(d.titulo));
      console.log('resumo :', d.resumo);
      console.log('--- texto ---\n' + d.texto);
      console.log('--- mermaid ---\n' + d.mermaid);
      console.log('--- mensagem ---\n' + d.mensagem);
    }
    return casos.length;
  }

  var API = { descrever: descrever, autoTeste: autoTeste, _cenasDeTeste: cenasDeTeste };

  if (typeof window !== 'undefined') {
    window.QuadroTexto = API;
    if (window.QUADRO_TESTE) { try { autoTeste(); } catch (e) { console.log('auto-teste falhou:', e); } }
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})();
