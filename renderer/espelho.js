/* ============ Espelho Mac <-> celular (16/11/2026) ============
   Pedido dele: "o que tá rolando no Mac tem que estar igual no celular, e vice-versa; se eu
   digitar no celular tem que aparecer no computador em tempo real". Antes o celular abria a
   MESMA conversa num chat proprio dele; ao mandar mensagem, o Mac recusava ("esta conversa ja
   esta aberta no Mac") e, na segunda vez, o celular roubava a conversa e o chat do Mac parava.

   Agora existe UM dono so: a janela principal do Mac. O celular vira espelho dela:
   - MAC: cada chat da janela principal tem a conversa (.pane-chat) e a pilha de baixo (pedido
     de permissao, perguntas, plano, aviso de limite) copiadas em pedacos com chave (data-ek).
     So o pedaco que mudou viaja. O main guarda a ultima copia e numera cada mudanca, entao o
     celular que volta do fundo pede "tudo desde a versao N" e recebe so a diferenca.
   - CELULAR: monta os mesmos chats, nas mesmas abas, e mostra o que o Mac mostra. Nao liga
     motor nenhum: o que ele escreve vai para o chat do Mac (enviar, parar, fechar, responder
     permissao/pergunta por clique repassado). O rascunho anda nos dois sentidos.
   Motor antigo (sem espelho:estado) = nada disto liga e o celular segue como era. */
(function () {
  'use strict';
  const NO_TELEFONE = !!window.SEM_ELECTRON;
  const api = window.api;
  if (!api) return;
  const qs = (sel, raiz) => (raiz || document).querySelector(sel);

  // a pilha de baixo do chat: tudo que fica entre a conversa e a caixa de escrever
  function pilhaDe(el, soEspelho) {
    const chat = el.querySelector(':scope > .pane-chat');
    const lista = [];
    if (!chat) return lista;
    for (let n = chat.nextElementSibling; n && !n.classList.contains('pane-cmp'); n = n.nextElementSibling) {
      if (soEspelho && n.dataset.esp !== '1') continue;
      lista.push(n);
    }
    return lista;
  }
  function raizesDe(P, zona, soEspelho) {
    if (zona === 'chat') return [...P.chat.children];
    return pilhaDe(P.el, soEspelho);
  }

  if (NO_TELEFONE) iniciarTelefone();
  else if (!JANELA_N) iniciarMac();   // janela extra (Dock > Nova janela) nao e espelhada

  /* =============================== MAC =============================== */
  function iniciarMac() {
    if (!api.espelhoMac || !api.onEspelhoCmd) return;   // motor antigo: espelho desligado
    const PREFIXO = Math.random().toString(36).slice(2, 5) + '-';
    const LIMITE_FILHOS = 160;   // historico muito antigo fica so no Mac (o resto vai inteiro)
    let seq = 0, ligado = false, relogio = 0, metaEnviada = '', forcar = true;
    const rast = new Map();      // paneId -> { P, mo, sujos:Set, ordem:{chat,pilha}, enviado:{chat:Map,pilha:Map} }

    function chave(el, vistos) {
      let k = el.dataset.ek;
      if (!k || vistos.has(k)) { k = PREFIXO + (++seq); el.dataset.ek = k; }
      vistos.add(k);
      return k;
    }
    function reescreverSrc(html) {
      // foto do disco do Mac nao abre no celular: passa pela rota do servidor (so imagem e video)
      return html.replace(/(\s(?:src|poster)=")(file:\/\/[^"]+|\/(?:Users|private|tmp|var|Volumes)\/[^"]+)"/g, (m, a, v) => {
        let cam = v;
        if (cam.startsWith('file://')) { try { cam = decodeURI(cam.slice(7)); } catch { cam = cam.slice(7); } }
        cam = cam.replace(/&amp;/g, '&');
        return a + '/espelho-arquivo?c=' + encodeURIComponent(cam) + '"';
      });
    }
    function serializar(el) {
      let alvo = el;
      if (el.matches('input,textarea,select') || el.querySelector('input,textarea,select')) {
        alvo = el.cloneNode(true);
        const sel = 'input,textarea,select';
        const orig = [el, ...el.querySelectorAll(sel)].filter(x => x.matches(sel));
        const copia = [alvo, ...alvo.querySelectorAll(sel)].filter(x => x.matches(sel));
        orig.forEach((o, i) => {
          const d = copia[i]; if (!d) return;
          if (o.tagName === 'TEXTAREA') d.textContent = o.value;
          else if (o.tagName === 'SELECT') [...d.options].forEach((op, j) => op.toggleAttribute('selected', o.options[j] && o.options[j].selected));
          else if (o.type === 'checkbox' || o.type === 'radio') d.toggleAttribute('checked', o.checked);
          else d.setAttribute('value', o.value);
        });
      }
      return reescreverSrc(alvo.outerHTML);
    }

    function acompanhar(P) {
      let r = rast.get(P.id);
      if (r && r.P === P) return r;
      if (r) { try { r.mo.disconnect(); } catch {} }
      r = { P, sujos: new Set(), ordem: { chat: '', pilha: '' }, enviado: { chat: new Map(), pilha: new Map() }, tudo: true };
      r.mo = new MutationObserver((lista) => {
        for (const m of lista) {
          if (m.type === 'attributes' && m.attributeName === 'data-ek') continue;
          let n = m.target.nodeType === 1 ? m.target : m.target.parentElement;
          if (!n) continue;
          if (n === P.el) { r.tudo = true; continue; }          // entrou/saiu algo da pilha
          if (n === P.chat) { if (m.type === 'childList') r.tudo = true; continue; }
          let topo = null;
          if (P.chat.contains(n)) { while (n && n.parentElement !== P.chat) n = n.parentElement; topo = n; }
          else { while (n && n.parentElement !== P.el) n = n.parentElement; if (n && pilhaDe(P.el).includes(n)) topo = n; }
          if (topo) r.sujos.add(topo);
        }
        agendar();
      });
      r.mo.observe(P.el, { subtree: true, childList: true, attributes: true, characterData: true });
      rast.set(P.id, r);
      return r;
    }

    function coletarZona(P, zona, r) {
      let filhos = raizesDe(P, zona);
      if (zona === 'chat' && filhos.length > LIMITE_FILHOS) filhos = filhos.slice(-LIMITE_FILHOS);
      const vistos = new Set(), ordem = [], html = {};
      const env = r.enviado[zona];
      for (const f of filhos) {
        const k = chave(f, vistos);
        ordem.push(k);
        if (forcar || r.tudo || r.sujos.has(f) || !env.has(k)) {
          const h = serializar(f);
          if (forcar || env.get(k) !== h) { env.set(k, h); html[k] = h; }
        }
      }
      for (const k of [...env.keys()]) if (!vistos.has(k)) env.delete(k);
      const assinatura = ordem.join(',');
      if (!forcar && assinatura === r.ordem[zona] && !Object.keys(html).length) return null;
      r.ordem[zona] = assinatura;
      return { paneId: P.id, zona, ordem, html };
    }

    function metaAtual() {
      const ordemAbas = [...document.querySelectorAll('#abasLista > [data-aid]')].map(e => e.dataset.aid);
      const lista = ordemAbas.map(aid => abas.get(aid)).filter(Boolean);
      for (const A of abas.values()) if (!lista.includes(A)) lista.push(A);
      const ps = {};
      for (const P of panes.values()) {
        if (!P || !P.el || !P.el.isConnected) continue;
        const pt = qs('.p-dot', P.el), stop = qs('.p-stop', P.el), inp = qs('.p-input', P.el);
        let espera = false; try { espera = estadoDoPainel(P).cls === 'espera'; } catch {}
        ps[P.id] = {
          engine: P.engine, model: P.model, effort: P.effort, mode: P.mode, cwd: P.cwd,
          titulo: (qs('.pn-txt', P.el) || {}).textContent || P.titulo || '',
          sessao: P.sessaoId || P.resumeId || '', dot: P.dotEstado || 'off', busy: !!P.busy, espera,
          dotCls: pt ? pt.className : '', stop: !!(stop && !stop.classList.contains('hidden')),
          rascunho: inp ? inp.value : '', aid: P.aid,
        };
      }
      return {
        abas: lista.map(A => ({ aid: A.id, cwd: A.cwd, chats: A.ordem.filter(id => ps[id]), ativo: A.ativo })).filter(a => a.chats.length),
        abaAtiva: abaAtiva ? abaAtiva.id : '', foco: focusPane ? focusPane.id : '', panes: ps,
      };
    }

    function agendar(rapido) {
      if (!ligado || relogio) return;
      relogio = setTimeout(despejar, rapido ? 0 : 120);
    }
    function despejar() {
      relogio = 0;
      if (!ligado || !window.__cockpitPronto) return;
      const lote = { zonas: [] };
      if (forcar) lote.tudo = true;
      // chat novo entra no acompanhamento; chat fechado sai
      for (const P of panes.values()) if (P && P.el && P.el.isConnected && !ESTA_TELA) acompanhar(P);
      for (const [id, r] of rast) {
        if (panes.get(id) !== r.P || !r.P.el.isConnected) { try { r.mo.disconnect(); } catch {} rast.delete(id); continue; }
        if (!forcar && !r.tudo && !r.sujos.size) continue;
        for (const zona of ['chat', 'pilha']) {
          const z = coletarZona(r.P, zona, r);
          if (z) lote.zonas.push(z);
        }
        r.sujos.clear(); r.tudo = false;
      }
      const meta = metaAtual(), txt = JSON.stringify(meta);
      if (forcar || txt !== metaEnviada) { metaEnviada = txt; lote.meta = meta; }
      forcar = false;
      if (lote.tudo || lote.meta || lote.zonas.length) { try { api.espelhoMac(lote); } catch (e) { console.warn('[espelho]', e); } }
    }
    // o que nao gera mudanca no DOM da conversa (titulo, bolinha, rascunho, aba) e conferido aqui
    setInterval(() => { if (ligado) agendar(); }, 600);
    document.addEventListener('input', (e) => { if (ligado && e.target.matches && e.target.matches('.p-input')) agendar(); }, true);

    function ligar() { ligado = true; forcar = true; for (const r of rast.values()) { r.enviado.chat.clear(); r.enviado.pilha.clear(); } agendar(true); }
    function desligar() {
      ligado = false; clearTimeout(relogio); relogio = 0;
      for (const r of rast.values()) { try { r.mo.disconnect(); } catch {} }
      rast.clear(); metaEnviada = '';
    }

    function acharAlvo(P, zona, ek, caminho) {
      let el = raizesDe(P, zona).find(x => x.dataset.ek === ek);
      if (!el) return null;
      for (const i of caminho || []) { el = el.children[i]; if (!el) return null; }
      return el;
    }
    async function enviarNoPainel(P, texto, anexos) {
      const inp = qs('.p-input', P.el);
      if (Array.isArray(anexos) && anexos.length) await anexar(P, anexos.filter(a => typeof a === 'string'));
      if (inp) { inp.value = String(texto || ''); inp.dispatchEvent(new Event('input', { bubbles: true })); }
      await send(P);
      return { ok: true };
    }

    async function executar(c) {
      const P = c.paneId ? panes.get(c.paneId) : null;
      const semChat = { error: 'Este chat não está mais aberto no Mac.' };
      switch (c.tipo) {
        case 'ligar': ligar(); return { ok: true };
        case 'desligar': desligar(); return { ok: true };
        case 'enviar': return P ? enviarNoPainel(P, c.texto, c.anexos) : semChat;
        case 'rascunho': {
          if (!P) return semChat;
          const inp = qs('.p-input', P.el);
          if (inp && inp.value !== String(c.texto || '')) { inp.value = String(c.texto || ''); inp.dispatchEvent(new Event('input', { bubbles: true })); }
          return { ok: true };
        }
        case 'clique': {
          const el = P && acharAlvo(P, c.zona, c.ek, c.caminho);
          if (!el) return { error: 'Isto mudou no Mac antes do toque chegar. Tente de novo.' };
          for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) {
            const Ev = t.startsWith('pointer') && window.PointerEvent ? PointerEvent : MouseEvent;
            el.dispatchEvent(new Ev(t, { bubbles: true, cancelable: true, view: window, button: 0 }));
          }
          el.click();
          return { ok: true };
        }
        case 'valor': {
          const el = P && acharAlvo(P, c.zona, c.ek, c.caminho);
          if (!el || !('value' in el)) return { error: 'O campo mudou no Mac.' };
          el.value = String(c.valor || '');
          el.dispatchEvent(new Event('input', { bubbles: true }));
          return { ok: true };
        }
        case 'tecla': {
          const el = P && acharAlvo(P, c.zona, c.ek, c.caminho);
          if (!el) return { error: 'O campo mudou no Mac.' };
          el.dispatchEvent(new KeyboardEvent('keydown', { key: c.key || 'Enter', bubbles: true, cancelable: true }));
          return { ok: true };
        }
        case 'parar': { if (!P) return semChat; const b = qs('.p-stop', P.el); if (b) b.click(); return { ok: true }; }
        case 'fechar': if (!P) return { ok: true }; await closePane(P.id, true); return { ok: true };
        case 'motor': if (!P) return semChat; await trocarMotor(P, c.motor); return { ok: true };
        case 'novoChat': {
          const A = abaDoCaminho(c.cwd || HOME, true);
          const Q = newPane({ engine: c.engine, cwd: c.cwd || A.cwd, aba: A, model: c.model, effort: c.effort, mode: c.mode });
          if (c.texto || (c.anexos || []).length) await enviarNoPainel(Q, c.texto, c.anexos);
          return { ok: true, paneId: Q.id };
        }
        case 'abrirSessao': {
          const s = c.s || {};
          if (!s.id || !s.engine) return { error: 'Conversa sem identificação.' };
          await openSession(s);
          const Q = [...panes.values()].find(q => q.engine === s.engine && (q.resumeId === s.id || q.sessaoId === s.id)) || focusPane;
          if (Q && (c.texto || (c.anexos || []).length)) await enviarNoPainel(Q, c.texto, c.anexos);
          return { ok: true, paneId: Q ? Q.id : '' };
        }
      }
      return { error: 'Pedido desconhecido.' };
    }
    api.onEspelhoCmd(async (c) => {
      if (!c || typeof c !== 'object') return;
      let r;
      try { r = await executar(c); } catch (e) { r = { error: (e && e.message) || String(e) }; }
      if (c.id && api.espelhoResposta) { try { api.espelhoResposta(c.id, r || { ok: true }); } catch {} }
      agendar(true);
    });
    // tela recarregada (tela viva): o main religa o espelho se tiver celular olhando
    const ola = () => { try { api.espelhoMac({ ola: true }); } catch {} };
    if (window.__cockpitPronto) ola(); else window.addEventListener('cockpit:pronto', ola);
  }

  /* ============================= CELULAR ============================= */
  function iniciarTelefone() {
    // quem descobre se o Mac sabe espelhar e o getConfig do web.js, que roda DEPOIS deste
    // arquivo carregar: por isso tudo comeca so quando a tela termina de abrir
    const ir = () => { if (window.ESPELHO && api.espelhoEstado && api.espelhoCmd) telefone(); };
    if (window.__cockpitPronto) ir(); else window.addEventListener('cockpit:pronto', ir, { once: true });
  }
  function telefone() {
    const mapa = new Map();          // id do chat no Mac -> painel do celular
    let versao = 0, emSinc = false, sincDeNovo = false, pronto = false;
    let escondidoDesde = 0, focoPendente = '', locaisPorTrocar = new Map();
    let criando = false, ultimaMeta = null;
    const ultimoRascunhoMac = new Map(), digitouEm = new Map();
    const cmd = (o) => api.espelhoCmd(o).catch(e => ({ error: (e && e.message) || 'O Mac não respondeu.' }));
    const doMac = (P) => P && P.espelho;
    const painelDoEl = (el) => { const id = el && el.dataset.id; return id ? panes.get(id) : null; };

    // ---- receber ----
    async function sincronizar(inicio) {
      if (emSinc) { sincDeNovo = true; return; }
      emSinc = true;
      try {
        const r = await api.espelhoEstado({ desde: inicio ? 0 : versao });
        if (!r || r.error) return;
        aplicar(r);
      } catch (_) { /* a ponte ja mostra a conexao caida */ }
      finally {
        emSinc = false;
        if (sincDeNovo) { sincDeNovo = false; sincronizar(); }
      }
    }
    function aplicar(r, aoVivo) {
      if (r.meta) aplicarMeta(r.meta);
      let faltou = false;
      animar = !!aoVivo && !r.tudo && !document.hidden;
      try { for (const z of r.zonas || []) if (aplicarZona(z) === false) faltou = true; }
      finally { animar = false; }
      if (typeof r.v === 'number') versao = r.v;
      if (faltou) { versao = 0; sincDeNovo = true; }
    }

    function aplicarMeta(meta) {
      ultimaMeta = meta;
      const vivos = new Set(Object.keys(meta.panes || {}));
      // 1) chats que fecharam no Mac saem daqui
      for (const [mid, P] of [...mapa]) {
        if (vivos.has(mid) && panes.get(P.id) === P) continue;
        mapa.delete(mid);
        if (panes.get(P.id) === P) { try { closePane(P.id, true); } catch {} }
      }
      // 2) abas e chats na mesma ordem do Mac
      criando = true;
      try {
        for (const a of meta.abas || []) {
          let A = null;
          for (const mid of a.chats) { const Q = mapa.get(mid); if (Q && abaDe(Q)) { A = abaDe(Q); break; } }
          for (const mid of a.chats) {
            const m = meta.panes[mid]; if (!m) continue;
            let P = mapa.get(mid);
            if (P && A && abaDe(P) !== A) { mapa.delete(mid); try { closePane(P.id, true); } catch {} P = null; }
            if (!P) {
              if (!A) A = novaAbaProjeto(a.cwd || m.cwd || HOME);
              P = newPane({ engine: m.engine, aba: A, cwd: m.cwd || a.cwd, model: m.model, effort: m.effort, mode: m.mode, titulo: m.titulo });
              P.espelho = mid;
              P.el.classList.add('espelho');
              mapa.set(mid, P);
              const vazio = qs('.pane-empty', P.chat); if (vazio && !vazio.dataset.ek) vazio.remove();
            }
          }
          if (A) {
            const ordem = a.chats.map(mid => mapa.get(mid)).filter(Boolean).map(P => P.id);
            const extras = A.ordem.filter(id => !ordem.includes(id));   // chat novo feito aqui, ainda local
            const nova = [...ordem, ...extras];
            if (nova.join() !== A.ordem.join()) { A.ordem = nova; try { remontarEspaco(A); } catch {} }
            const at = mapa.get(a.ativo); if (at && !A.ativo) A.ativo = at.id;
            try { pintarAba(A); } catch {}
          }
        }
      } finally { criando = false; }
      // 3) cada chat com a cara do Mac
      for (const [mid, P] of mapa) {
        const m = meta.panes[mid]; if (!m) continue;
        if (m.engine && P.engine !== m.engine) { P.engine = m.engine; try { fillModels(P); } catch {} }
        if (m.model && P.model !== m.model) P.model = m.model;
        if (m.effort) P.effort = m.effort;
        try { paintEngine(P); } catch {}
        P.sessaoId = m.sessao || null; P.resumeId = m.sessao || null;
        if ((m.titulo || '') !== (P.titulo || '')) { P.titulo = m.titulo || ''; try { pintarNome(P); } catch {} }
        P.busy = !!m.busy; P.dotEstado = m.dot;
        P.el.classList.toggle('ocupado', m.dot === 'busy');
        const pt = qs('.p-dot', P.el); if (pt && m.dotCls) pt.className = m.dotCls;
        const st = qs('.p-stop', P.el); if (st) st.classList.toggle('hidden', !m.stop);
        P.esperaMac = !!m.espera;
        const A = abaDe(P); if (A) { try { pintarAba(A); } catch {} }
        aplicarRascunho(mid, P, m.rascunho || '');
      }
      // 4) chat criado aqui que o Mac acabou de abrir: troca o local pelo espelhado
      for (const [mid, local] of [...locaisPorTrocar]) {
        const P = mapa.get(mid); if (!P) continue;
        locaisPorTrocar.delete(mid);
        if (local && panes.get(local.id) === local) { try { closePane(local.id, true); } catch {} }
        focoPendente = mid;
      }
      if (focoPendente && mapa.has(focoPendente)) { focar(mapa.get(focoPendente)); focoPendente = ''; }
      // primeira vez: abre no chat que esta na frente no Mac
      if (!pronto) {
        pronto = true;
        const na = qs('#novaAba');
        if (mapa.size && na) { na.dataset.travada = ''; na.classList.add('hidden'); }
        seguirFocoDoMac();
      }
    }
    function focar(P) {
      if (!P || panes.get(P.id) !== P) return;
      const A = abaDe(P);
      try { if (A && abaAtiva !== A) ativarAbaProjeto(A); } catch {}
      try { setFocus(P); } catch {}
      try { const na = qs('#novaAba'); if (na && !na.classList.contains('hidden')) { na.dataset.travada = ''; na.classList.add('hidden'); } } catch {}
      setTimeout(() => { try { P.chat.scrollTop = P.chat.scrollHeight; } catch {} }, 30);
    }
    function seguirFocoDoMac() {
      if (!ultimaMeta) return;
      const P = mapa.get(ultimaMeta.foco) || mapa.values().next().value;
      if (P) focar(P);
    }

    const rascunhoEsperando = new Map();
    function aplicarRascunho(mid, P, texto) {
      if (ultimoRascunhoMac.get(mid) === texto) return;
      const inp = qs('.p-input', P.el);
      if (!inp || inp.value === texto) { ultimoRascunhoMac.set(mid, texto); return; }
      // ele esta digitando aqui agora: o Mac so esta ecoando o que veio daqui, nao atropela.
      // Mas o que o Mac escreveu de verdade entra assim que ele parar de digitar aqui.
      const falta = 2500 - (Date.now() - (digitouEm.get(mid) || 0));
      if (falta > 0) {
        clearTimeout(rascunhoEsperando.get(mid));
        rascunhoEsperando.set(mid, setTimeout(() => {
          const m = ultimaMeta && ultimaMeta.panes && ultimaMeta.panes[mid];
          if (m && mapa.get(mid) === P) aplicarRascunho(mid, P, m.rascunho || '');
        }, falta + 50));
        return;
      }
      ultimoRascunhoMac.set(mid, texto);
      inp.value = texto;
      inp.style.height = 'auto'; inp.style.height = Math.min(inp.scrollHeight, 190) + 'px';
    }

    function deHtml(h) {
      const t = document.createElement('template');
      t.innerHTML = h;
      return t.content.firstElementChild;
    }
    // troca so o que mudou: o que gira (icone de trabalhando, spinner) nao recomeca a cada pedaco.
    // animar = pedaco ao vivo da resposta: o texto que cresceu ganha um <span class="mv-pal"> que
    // surge suave (movimento.css), como no app do Claude. Esses spans so existem aqui no celular;
    // por isso os filhos sao lidos "logicamente" (texto + spans que o seguem = um texto so).
    let animar = false;
    function grupos(el) {
      const g = [];
      for (const n of [...el.childNodes]) {
        if (n.nodeType === 1 && n.dataset && n.dataset.mvf === '1' && g.length && g[g.length - 1].n.nodeType === 3) g[g.length - 1].f.push(n);
        else if (n.nodeType === 1 && n.dataset && n.dataset.mvf === '1') { const t = document.createTextNode(n.textContent); n.replaceWith(t); g.push({ n: t, f: [] }); }
        else g.push({ n, f: [] });
      }
      return g;
    }
    function crescerTexto(item, novo) {
      const agora = Date.now();
      const atual = item.n.nodeValue + item.f.map(x => x.textContent).join('');
      if (novo === atual) return;
      if (!animar || !novo.startsWith(atual)) { item.n.nodeValue = novo; item.f.forEach(x => x.remove()); return; }
      // pedacos que ja terminaram de surgir voltam a ser texto comum
      while (item.f.length && agora - item.f[0].__t > 700) { item.n.nodeValue += item.f[0].textContent; item.f.shift().remove(); }
      const sp = document.createElement('span');
      sp.dataset.mvf = '1'; sp.className = 'mv-pal'; sp.__t = agora;
      sp.textContent = novo.slice(atual.length);
      (item.f.length ? item.f[item.f.length - 1] : item.n).after(sp);
      item.f.push(sp);
    }
    function surgir(n) {
      if (!animar || !n.animate) return;
      n.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 450, easing: 'ease-out' });
    }
    function morfar(a, b) {
      if (a.nodeType !== b.nodeType || a.nodeName !== b.nodeName) { a.replaceWith(b); return; }
      if (a.nodeType !== 1) { if (a.nodeValue !== b.nodeValue) a.nodeValue = b.nodeValue; return; }
      for (const at of [...a.attributes]) if (!b.hasAttribute(at.name)) a.removeAttribute(at.name);
      for (const at of [...b.attributes]) if (a.getAttribute(at.name) !== at.value) a.setAttribute(at.name, at.value);
      if ((a.tagName === 'INPUT' || a.tagName === 'TEXTAREA') && document.activeElement !== a) {
        const v = a.tagName === 'TEXTAREA' ? b.textContent : (b.getAttribute('value') || '');
        if (a.value !== v) a.value = v;
        if (a.type === 'checkbox' || a.type === 'radio') a.checked = b.hasAttribute('checked');
      }
      const ag = grupos(a), bc = [...b.childNodes];
      for (let i = 0; i < bc.length; i++) {
        const item = ag[i], bn = bc[i];
        if (!item) {
          if (animar && bn.nodeType === 3 && bn.nodeValue.trim()) {
            const sp = document.createElement('span'); sp.dataset.mvf = '1'; sp.className = 'mv-pal'; sp.__t = Date.now();
            sp.textContent = bn.nodeValue; a.appendChild(document.createTextNode('')); a.appendChild(sp);
          } else { a.appendChild(bn); if (bn.nodeType === 1) surgir(bn); }
          continue;
        }
        if (item.n.nodeType === 3 && bn.nodeType === 3) { crescerTexto(item, bn.nodeValue); continue; }
        item.f.forEach(x => x.remove());
        morfar(item.n, bn);
      }
      for (let i = bc.length; i < ag.length; i++) { ag[i].f.forEach(x => x.remove()); ag[i].n.remove(); }
    }

    function aplicarZona(z) {
      const P = mapa.get(z.paneId);
      if (!P || panes.get(P.id) !== P) return true;
      const chat = P.chat;
      const noFim = chat.scrollHeight - chat.scrollTop - chat.clientHeight < 140;
      const atuais = new Map();
      for (const e of raizesDe(P, z.zona, true)) if (e.dataset.ek) atuais.set(e.dataset.ek, e);
      const html = z.html || {};
      const novos = [];
      let faltou = false;
      for (const k of z.ordem) {
        let el = atuais.get(k);
        if (html[k] != null) {
          const novo = deHtml(html[k]);
          if (!novo) continue;
          if (z.zona === 'pilha') novo.dataset.esp = '1';
          if (el) { morfar(el, novo); if (!el.isConnected) el = novo; }
          else el = novo;
        }
        if (!el) { faltou = true; continue; }
        novos.push(el);
      }
      const ficam = new Set(novos);
      for (const e of atuais.values()) if (!ficam.has(e)) e.remove();
      if (z.zona === 'chat') {
        // o que esta tela escreveu sozinha (aviso de erro do envio) fica embaixo de tudo
        const proprios = [...chat.children].filter(e => !e.dataset.ek && !e.classList.contains('pane-empty'));
        chat.querySelectorAll(':scope > .pane-empty:not([data-ek])').forEach(e => e.remove());
        let ref = chat.firstChild;
        for (const el of novos) {
          if (el !== ref) chat.insertBefore(el, ref);
          ref = el.nextSibling;
        }
        for (const e of proprios) chat.appendChild(e);
        // acompanhar a resposta deslizando (movimento.js); sem ele, pula direto pro fim
        if (noFim) { if (animar && window.MV && window.MV.seguirFim) window.MV.seguirFim(chat); else chat.scrollTop = chat.scrollHeight; }
      } else {
        const cmp = P.el.querySelector(':scope > .pane-cmp');
        for (const el of novos) if (el.nextElementSibling !== cmp || el.parentElement !== P.el) P.el.insertBefore(el, cmp);
        // a ordem relativa entre eles
        let ref = cmp;
        for (let i = novos.length - 1; i >= 0; i--) { if (novos[i].nextElementSibling !== ref) P.el.insertBefore(novos[i], ref); ref = novos[i]; }
      }
      return !faltou;
    }

    api.onEspelho && api.onEspelho((lote) => {
      if (!pronto && !lote.tudo) return;
      if (lote.antes !== versao && !lote.tudo) { sincronizar(); return; }
      aplicar(lote, true);
    });

    // ---- mandar ----
    const enviarOriginal = window.send;
    window.send = async function (P, textoProg, opcoes) {
      if (!P || criando) return enviarOriginal.apply(this, arguments);
      const programatico = typeof textoProg === 'string';
      const inp = qs('.p-input', P.el);
      const texto = programatico ? textoProg : (inp ? inp.value : '');
      const anexos = programatico ? [] : (P.anexos || []).map(a => a && a.path).filter(Boolean);
      const limpar = () => {
        if (programatico || !inp) return;
        inp.value = ''; inp.style.height = 'auto';
        P.anexos = []; try { pintarAnexos(P); } catch {}
        if (doMac(P)) { ultimoRascunhoMac.set(P.espelho, ''); digitouEm.set(P.espelho, 0); }
        window.dispatchEvent(new CustomEvent('cockpit:salvar-rascunhos'));
      };
      const devolver = (r) => {
        if (!programatico && inp && !inp.value) inp.value = texto;
        try { avisoTemp(P, 'Não consegui mandar para o Mac: ' + ((r && r.error) || 'sem resposta'), true); } catch {}
      };
      const retorno = (ok) => (opcoes && opcoes.ajustes ? { ok } : undefined);
      if (doMac(P)) {
        limpar();
        const r = await cmd({ tipo: 'enviar', paneId: P.espelho, texto, anexos });
        if (!r || r.error) { devolver(r); return retorno(false); }
        return retorno(true);
      }
      // chat aberto aqui no celular (ainda sem dono no Mac): o Mac abre um igual e manda
      if (!texto.trim() && !anexos.length) return enviarOriginal.apply(this, arguments);
      const fio = P.sessaoId || P.resumeId;
      limpar();
      const r = await cmd(fio
        ? { tipo: 'abrirSessao', s: { id: fio, engine: P.engine, cwd: P.cwd, file: P.sessaoFile || '' }, texto, anexos }
        : { tipo: 'novoChat', engine: P.engine, cwd: P.cwd, model: P.model, effort: P.effort, mode: P.mode, texto, anexos });
      if (!r || r.error || !r.paneId) { devolver(r); return retorno(false); }
      locaisPorTrocar.set(r.paneId, P);
      sincronizar();
      return retorno(true);
    };

    // abrir conversa pela gaveta: quem abre e o Mac, e aqui so leva ate ela
    const abrirOriginal = window.openSession;
    window.openSession = async function (s, el) {
      if (!s || criando) return abrirOriginal.apply(this, arguments);
      const ja = [...mapa.values()].find(P => P.engine === s.engine && (P.sessaoId === s.id || P.resumeId === s.id));
      document.body.classList.remove('gaveta');
      if (ja) { focar(ja); return; }
      const limpo = { id: s.id, engine: s.engine, cwd: s.cwd, file: s.file || '', remoto: !!s.remoto, titulo: s.titulo || '' };
      if (Array.isArray(s.partes)) limpo.partes = s.partes.map(p => ({ engine: p.engine, id: p.id, file: p.file || '', cwd: p.cwd }));
      const r = await cmd({ tipo: 'abrirSessao', s: limpo });
      if (!r || r.error) { alert('Não consegui abrir no Mac: ' + ((r && r.error) || 'sem resposta')); return; }
      if (r.paneId) { focoPendente = r.paneId; sincronizar(); }
    };

    // rascunho daqui para o Mac, enquanto ele digita
    const relogiosRascunho = new Map();
    document.addEventListener('input', (e) => {
      const t = e.target;
      if (!t || !t.matches) return;
      const paneEl = t.closest('.pane.espelho'); if (!paneEl) return;
      const P = painelDoEl(paneEl); if (!doMac(P)) return;
      if (t.matches('.p-input')) {
        const mid = P.espelho;
        digitouEm.set(mid, Date.now());
        clearTimeout(relogiosRascunho.get(mid));
        relogiosRascunho.set(mid, setTimeout(() => {
          ultimoRascunhoMac.set(mid, t.value);
          cmd({ tipo: 'rascunho', paneId: mid, texto: t.value });
        }, 150));
        return;
      }
      // campo dentro do que veio do Mac (resposta de pergunta, ajuste do plano)
      const raiz = raizEspelhada(t, P); if (!raiz) return;
      clearTimeout(t.__espRel);
      t.__espRel = setTimeout(() => cmd({ tipo: 'valor', paneId: P.espelho, zona: raiz.zona, ek: raiz.el.dataset.ek, caminho: caminhoDe(t, raiz.el), valor: t.value }), 120);
    }, true);
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.shiftKey) return;
      const t = e.target; if (!t || !t.matches || !t.matches('input,textarea') || t.matches('.p-input')) return;
      const paneEl = t.closest('.pane.espelho'); if (!paneEl) return;
      const P = painelDoEl(paneEl); if (!doMac(P)) return;
      const raiz = raizEspelhada(t, P); if (!raiz) return;
      e.preventDefault(); e.stopImmediatePropagation();
      clearTimeout(t.__espRel);
      const onde = { paneId: P.espelho, zona: raiz.zona, ek: raiz.el.dataset.ek, caminho: caminhoDe(t, raiz.el) };
      cmd({ tipo: 'valor', ...onde, valor: t.value }).then(() => cmd({ tipo: 'tecla', ...onde, key: 'Enter' }));
    }, true);

    function raizEspelhada(t, P) {
      let n = t;
      while (n && n !== P.el) {
        if (n.parentElement === P.chat && n.dataset.ek) return { el: n, zona: 'chat' };
        if (n.parentElement === P.el && n.dataset.esp === '1' && n.dataset.ek) return { el: n, zona: 'pilha' };
        n = n.parentElement;
      }
      return null;
    }
    function caminhoDe(alvo, raiz) {
      const c = [];
      for (let n = alvo; n && n !== raiz; n = n.parentElement) c.unshift([...n.parentElement.children].indexOf(n));
      return c;
    }
    const INTERATIVO = 'button, summary, [role="button"], [role="tab"], [role="option"], [role="checkbox"], [role="radio"], [role="menuitem"], label, input[type="checkbox"], input[type="radio"], select, [data-acao]';
    function interativo(t, raiz) {
      for (let n = t; n && n !== raiz.parentElement; n = n.parentElement) {
        if (n.nodeType !== 1) continue;
        if (n.matches('input[type="text"], textarea, input:not([type])')) return null;   // campo: so foca, aqui mesmo
        if (n.matches(INTERATIVO)) return n;
        try { if (getComputedStyle(n).cursor === 'pointer') return n; } catch {}
      }
      return null;
    }

    document.addEventListener('click', (e) => {
      const t = e.target;
      if (!t || !t.closest) return;
      const paneEl = t.closest('.pane.espelho'); if (!paneEl) return;
      const P = painelDoEl(paneEl); if (!doMac(P)) return;
      const para = () => { e.preventDefault(); e.stopImmediatePropagation(); };
      if (t.closest('.p-stop')) { para(); cmd({ tipo: 'parar', paneId: P.espelho }); return; }
      if (t.closest('.p-close')) {
        para();
        if ((P.busy || P.esperaMac) && !confirm('Este chat está trabalhando no Mac. Fechar joga fora o que ele está fazendo. Fechar mesmo assim?')) return;
        cmd({ tipo: 'fechar', paneId: P.espelho });
        return;
      }
      const lado = t.closest('.ch-lado');
      if (lado && lado.dataset.motor && lado.dataset.motor !== P.engine) { para(); cmd({ tipo: 'motor', paneId: P.espelho, motor: lado.dataset.motor }); return; }
      const raiz = raizEspelhada(t, P); if (!raiz) return;
      if (t.closest('a[href]')) return;                        // link: o celular abre do jeito dele
      const alvo = interativo(t, raiz.el); if (!alvo) return;
      if (alvo.matches('.bt-copiar')) {
        // copiar e do celular: o texto vai para a area de copiar DESTE aparelho
        para();
        const caixa = alvo.closest('pre') || raiz.el;
        const corpo = caixa.matches('pre') ? caixa : (caixa.querySelector('.msg-body, .md') || caixa);
        try { copiarTexto(corpo.innerText, alvo); } catch { try { api.copiar(corpo.innerText); } catch {} }
        return;
      }
      para();
      cmd({ tipo: 'clique', paneId: P.espelho, zona: raiz.zona, ek: raiz.el.dataset.ek, caminho: caminhoDe(alvo, raiz.el) })
        .then(r => { if (r && r.error) { try { avisoTemp(P, r.error, true); } catch {} sincronizar(); } });
    }, true);

    // ---- voltar do fundo ----
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { escondidoDesde = Date.now(); return; }
      const longe = escondidoDesde && Date.now() - escondidoDesde > 20000;
      escondidoDesde = 0;
      sincronizar().then(() => { if (longe) seguirFocoDoMac(); });
    });
    window.addEventListener('pageshow', () => sincronizar());
    window.addEventListener('cockpit:conectado', () => sincronizar());
    sincronizar(true);
  }
})();
