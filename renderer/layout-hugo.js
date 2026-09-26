/* Organização visual adaptada do fork do Hugo. Cada aba conserva seus próprios
   painéis e suas sessões. Mover um painel só reposiciona seu elemento existente. */
function colunasDaAba(A) {
  const grupos = new Map();
  for (const id of A.ordem) {
    const P = panes.get(id); if (!P) continue;
    if (!P.coluna) P.coluna = crypto.randomUUID();
    if (!grupos.has(P.coluna)) grupos.set(P.coluna, []);
    grupos.get(P.coluna).push(P);
  }
  return [...grupos.values()];
}

function montarColunasDaAba(A) {
  const foco = document.activeElement;
  const selecao = foco && typeof foco.selectionStart === 'number'
    ? [foco.selectionStart, foco.selectionEnd] : null;
  semPerderRolagem(A, () => {
    const grupos = colunasDaAba(A);
    // Ordem de leitura, atalhos e salvamento acompanham a ordem na tela.
    A.ordem = grupos.flatMap(ps => ps.map(P => P.id));
    const fragmento = document.createDocumentFragment();
    grupos.forEach((ps, i) => {
      if (i) fragmento.appendChild(makeSplitter());
      const col = document.createElement('div');
      col.className = 'coluna'; col.dataset.coluna = ps[0].coluna;
      const largura = ps.find(P => P.larguraColuna > 0)?.larguraColuna;
      if (largura) col.style.flex = '0 0 ' + largura + 'px';
      ps.forEach((P, j) => {
        if (j) col.appendChild(divisorAltura());
        P.el.style.flex = (P.pesoAltura || 1) + ' 1 0';
        P.el.style.minWidth = '';
        P.el.classList.toggle('empilhado', ps.length > 1);
        col.appendChild(P.el);
      });
      fragmento.appendChild(col);
    });
    A.corpoEl.replaceChildren(fragmento);
    pintarMulti();
    if (foco?.isConnected && typeof foco.focus === 'function') {
      foco.focus({ preventScroll: true });
      if (selecao) foco.setSelectionRange(...selecao);
    }
  });
}

function guardarLarguraColuna(col) {
  const largura = Math.round(col.getBoundingClientRect().width);
  for (const el of col.querySelectorAll(':scope > .pane')) {
    const P = panes.get(el.dataset.id); if (P) P.larguraColuna = largura;
  }
}

function observarAlturaPainel(P) {
  const medir = () => {
    if (!P.el.clientWidth) return;
    // Reserva espaço de leitura além do título, plano, anexos e campo expandido.
    // Se a pilha não couber, a coluna rola, sem cortar o botão Enviar.
    const fixos = [...P.el.children].filter(e => e !== P.chat && getComputedStyle(e).position !== 'absolute');
    const altura = fixos.reduce((n, e) => {
      const c = getComputedStyle(e);
      return n + e.getBoundingClientRect().height + (parseFloat(c.marginTop) || 0) + (parseFloat(c.marginBottom) || 0);
    }, 0);
    P.el.style.setProperty('--painel-min', Math.max(220, Math.ceil(altura + 85)) + 'px');
  };
  P.tamanhoObserver = new ResizeObserver(medir);
  // .p-uso: o aviso de limite virou linha própria da pilha de baixo (redesenho), fora da caixa
  for (const selector of ['.pane-cmp', '.pane-perm', '.p-uso', '.pane-hd', '.pane-nome']) {
    const e = $(selector, P.el); if (e) P.tamanhoObserver.observe(e);
  }
}

function divisorAltura() {
  const s = document.createElement('div'); s.className = 'pane-split-h';
  s.tabIndex = 0; s.setAttribute('role', 'separator'); s.setAttribute('aria-orientation', 'horizontal');
  s.setAttribute('aria-label', 'Ajustar a altura das conversas');
  s.title = 'Arraste para ajustar a altura. Dois cliques dividem por igual.';
  const ajustar = (anterior, proximo, altura) => {
    const total = anterior.getBoundingClientRect().height + proximo.getBoundingClientRect().height;
    const minimo = Math.min(220, total / 2);
    const h = Math.max(minimo, Math.min(total - minimo, altura));
    const P = panes.get(anterior.dataset.id), Q = panes.get(proximo.dataset.id);
    const pesos = (P.pesoAltura || 1) + (Q.pesoAltura || 1);
    P.pesoAltura = pesos * h / total; Q.pesoAltura = pesos * (total - h) / total;
    anterior.style.flex = P.pesoAltura + ' 1 0'; proximo.style.flex = Q.pesoAltura + ' 1 0';
  };
  s.addEventListener('dblclick', () => {
    for (const el of s.parentElement.querySelectorAll(':scope > .pane')) {
      panes.get(el.dataset.id).pesoAltura = 1; el.style.flex = '1 1 0';
    }
    savePanes();
  });
  s.addEventListener('keydown', e => {
    if (!['ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault();
    const a = s.previousElementSibling, b = s.nextElementSibling;
    ajustar(a, b, a.getBoundingClientRect().height + (e.key === 'ArrowDown' ? 20 : -20)); savePanes();
  });
  s.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    e.preventDefault();
    const a = s.previousElementSibling, b = s.nextElementSibling;
    const y = e.clientY, h = a.getBoundingClientRect().height;
    const mover = ev => ajustar(a, b, h + ev.clientY - y);
    const fim = () => {
      window.removeEventListener('mousemove', mover); window.removeEventListener('mouseup', fim);
      window.removeEventListener('blur', fim); document.body.style.cursor = ''; savePanes();
    };
    document.body.style.cursor = 'row-resize';
    window.addEventListener('mousemove', mover); window.addEventListener('mouseup', fim); window.addEventListener('blur', fim);
  });
  return s;
}

function organizarPainel(P, Q, empilhar, antes = false) {
  const A = abaDe(P);
  if (!A || !Q || Q === P || abaDe(Q) !== A) return false;
  const origem = P.coluna;
  const destino = A.ordem.map(id => panes.get(id)).filter(q => q && q !== P && q.coluna === Q.coluna);
  if (empilhar && destino.length >= 3) {
    avisoTemp(P, 'Cabem até três conversas por coluna.'); return false;
  }
  guardarAntesDeMexer([A], null);
  try {
    A.ordem = A.ordem.filter(id => id !== P.id);
    const referencia = empilhar ? Q : (antes ? destino[0] : destino[destino.length - 1]);
    A.ordem.splice(A.ordem.indexOf(referencia.id) + (antes ? 0 : 1), 0, P.id);
    P.coluna = empilhar ? Q.coluna : crypto.randomUUID();
    P.larguraColuna = empilhar ? Q.larguraColuna : 0;
    for (const id of A.ordem) {
      const q = panes.get(id);
      if (q && [origem, P.coluna].includes(q.coluna)) q.pesoAltura = 1;
    }
    remontarEspaco(A); setFocus(P); savePanes();
    return true;
  } finally { guardaTravada = false; }
}

function separarPainel(P) {
  const A = abaDe(P); if (!A) return;
  const grupo = colunasDaAba(A).find(ps => ps.includes(P));
  if (!grupo || grupo.length < 2) return;
  organizarPainel(P, grupo.find(q => q !== P), false);
}

function abrirMenuLayout(P, evento, itens) {
  // :not(.menu-fantasma): a cópia que esmaece ao fechar também tem .layout-menu e some sozinha
  document.querySelector('.layout-menu:not(.menu-fantasma)')?.remove();
  const menu = document.createElement('div'); menu.className = 'pop-global layout-menu';
  menu.setAttribute('role', 'menu');
  const fechar = () => {
    // some em 120ms como os outros menus (redesenho 26/09): a cópia do app.js esmaece no lugar
    if (menu.isConnected && typeof menuSaindo === 'function') menuSaindo(menu, document.body);
    menu.remove(); document.removeEventListener('mousedown', fora); document.removeEventListener('keydown', teclado, true);
  };
  const fora = e => { if (!menu.contains(e.target)) fechar(); };
  const teclado = e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); fechar(); return; }
    if (['ArrowDown', 'ArrowUp'].includes(e.key)) {
      e.preventDefault(); const bs = [...menu.querySelectorAll('button')];
      const i = bs.indexOf(document.activeElement); bs[(i + (e.key === 'ArrowDown' ? 1 : bs.length - 1)) % bs.length]?.focus();
    }
  };
  for (const item of itens) {
    const b = document.createElement('button'); b.textContent = item.nome; b.setAttribute('role', 'menuitem');
    b.onclick = () => { fechar(); item.fn(); }; menu.appendChild(b);
  }
  document.body.appendChild(menu);
  menu.style.left = Math.max(8, Math.min(evento.clientX, innerWidth - menu.offsetWidth - 8)) + 'px';
  menu.style.top = Math.max(8, Math.min(evento.clientY, innerHeight - menu.offsetHeight - 8)) + 'px';
  menu.querySelector('button')?.focus();
  document.addEventListener('mousedown', fora); document.addEventListener('keydown', teclado, true);
}

function normalizarPlano(itens) {
  if (!Array.isArray(itens)) return [];
  return itens.slice(0, 60).filter(x => x && typeof x === 'object').map(x => {
    const s = x.estado || x.status || 'pending';
    return { txt: String(x.txt || x.step || x.text || x.title || x.content || x.description || '').slice(0, 2000),
      estado: ['feito', 'completed', 'done'].includes(s) ? 'feito'
        : ['fazendo', 'in_progress', 'inProgress'].includes(s) ? 'fazendo' : 'pendente' };
  }).filter(x => x.txt);
}

function desenharPlano(P, itens) {
  P.plano = normalizarPlano(itens);
  let cx = $('.pane-plano', P.el);
  // sem unobserve o nó antigo fica preso no ResizeObserver pra sempre (mesmo padrão de limparPlano)
  if (!P.plano.length) { if (cx) { P.tamanhoObserver?.unobserve(cx); cx.remove(); } return; }
  if (!cx) {
    cx = document.createElement('section'); cx.className = 'pane-plano';
    P.el.insertBefore(cx, $('.pane-perm', P.el));
    P.tamanhoObserver?.observe(cx);
  }
  if (P.planoAberto === undefined) P.planoAberto = true;
  const feitos = P.plano.filter(x => x.estado === 'feito').length;
  const cab = document.createElement('button'); cab.className = 'pl-cab';
  cab.setAttribute('aria-expanded', String(P.planoAberto));
  cab.innerHTML = '<span class="pl-seta"></span><span class="pl-tit">Plano</span><span class="pl-conta"></span><span class="pl-barra"><span class="pl-cheio"></span></span>';
  $('.pl-seta', cab).innerHTML = ico(P.planoAberto ? 'chevron-down' : 'chevron-right');
  $('.pl-conta', cab).textContent = feitos + '/' + P.plano.length;
  const barra = $('.pl-barra', cab); barra.setAttribute('role', 'progressbar');
  barra.setAttribute('aria-label', 'Tarefas concluídas'); barra.setAttribute('aria-valuemin', '0');
  barra.setAttribute('aria-valuemax', String(P.plano.length)); barra.setAttribute('aria-valuenow', String(feitos));
  $('.pl-cheio', cab).style.width = (100 * feitos / P.plano.length) + '%';
  cab.onclick = () => { P.planoAberto = !P.planoAberto; desenharPlano(P, P.plano); savePanes(); };
  cx.replaceChildren(cab);
  if (P.planoAberto) {
    const corpo = document.createElement('div'); corpo.className = 'pl-corpo';
    for (const it of P.plano) {
      const linha = document.createElement('div'); linha.className = 'pl-item pl-' + it.estado;
      const marca = document.createElement('span'); marca.className = 'pl-pt';
      marca.setAttribute('aria-label', {feito: 'Concluído', fazendo: 'Em andamento', pendente: 'A fazer'}[it.estado]);
      const texto = document.createElement('span'); texto.className = 'pl-txt'; texto.textContent = it.txt;
      linha.append(marca, texto); corpo.appendChild(linha);
    }
    cx.appendChild(corpo);
  }
}

function limparPlano(P) { P.plano = []; const cx = $('.pane-plano', P.el); if (cx) { P.tamanhoObserver?.unobserve(cx); cx.remove(); } }
function limparSugestoes(P) { P.sugestoesPendentes = null; $('.p-sugs', P.el)?.remove(); }
function mostrarSugestoes(P, itens) {
  limparSugestoes(P);
  if (cfg.sugestoes === false) return;
  const lista = [...new Set((Array.isArray(itens) ? itens : []).filter(t => typeof t === 'string' && t.trim()).map(t => t.trim().slice(0, 4000)))].slice(0, 2);
  if (!lista.length) return;
  if (P.busy) { P.sugestoesPendentes = lista; return; }
  const box = document.createElement('div'); box.className = 'p-sugs';
  box.setAttribute('aria-label', 'Sugestões de próxima mensagem');
  for (const texto of lista) {
    const b = document.createElement('button'); b.className = 'sug-chip'; b.textContent = texto;
    b.title = texto + '\nClique para colocar no campo de mensagem.';
    b.onclick = () => {
      const campo = $('.p-input', P.el);
      // Um rascunho escrito pelo Homero nunca pode ser apagado pela sugestão.
      campo.value = campo.value.trim() ? campo.value.replace(/\s+$/, '') + '\n' + texto : texto;
      limparSugestoes(P); campo.dispatchEvent(new Event('input', { bubbles: true })); campo.focus();
      campo.setSelectionRange(campo.value.length, campo.value.length);
    };
    box.appendChild(b);
  }
  $('.cmp-top', P.el).before(box);
}
