'use strict';

// Um único aviso nativo por trabalho concluído, independente das telas conectadas.
// O intervalo deixa a fila/continuação automática assumir antes de anunciar o fim.
function criarSomConclusao({ spawn, arquivo, plataforma = process.platform,
  agendar = setTimeout, cancelarTimer = clearTimeout, silencioMs = 1500,
  registrarErro = () => {} }) {
  const paineis = new Map(), fila = [];
  let fechado = false, tocando = null;
  function limparTimer(st) { if (st.timer != null) cancelarTimer(st.timer); st.timer = null; }
  function cancelar(paneId) {
    const st = paineis.get(paneId);
    if (!st) return;
    limparTimer(st); st.cancelado = true; st.finalizado = false;
  }
  function iniciar(paneId, turnId) {
    if (fechado || plataforma !== 'darwin' || !turnId) return;
    const anterior = paineis.get(paneId);
    // A repetição de started não revive um turno cancelado ou já anunciado.
    if (anterior && anterior.turnId === turnId) return;
    cancelar(paneId);
    paineis.set(paneId, { turnId, timer: null, finalizado: false, cancelado: false, tocou: false, revisao: 0 });
  }
  function proximo() {
    if (fechado || tocando || plataforma !== 'darwin') return;
    let item;
    while ((item = fila.shift())) {
      const { paneId, st, revisao } = item;
      if (paineis.get(paneId) !== st || st.revisao !== revisao || st.cancelado || !st.finalizado || st.tocou) continue;
      st.tocou = true;
      let proc;
      try { proc = spawn('/usr/bin/afplay', [arquivo], { stdio: 'ignore', windowsHide: true }); }
      catch (e) { registrarErro(e); continue; }
      let resolver;
      const player = { proc, timer: null, garantia: null, pronto: new Promise(r => { resolver = r; }) };
      tocando = player;
      const concluir = () => {
        if (player.concluido) return;
        player.concluido = true;
        cancelarTimer(player.timer); cancelarTimer(player.garantia);
        if (tocando === player) tocando = null;
        resolver(); proximo();
      };
      player.parar = () => {
        if (player.concluido) return player.pronto;
        try { proc.kill('SIGKILL'); } catch {}
        // Também resolve se um processo que nem abriu não entregar close.
        if (!player.concluido && player.garantia == null) player.garantia = agendar(concluir, 300);
        return player.pronto;
      };
      proc.once('close', concluir);
      proc.once('error', e => { registrarErro(e); concluir(); });
      player.timer = agendar(player.parar, 4000);
      return;
    }
  }
  function evento(paneId, kind, data = {}) {
    if (fechado || plataforma !== 'darwin') return;
    if (kind === 'busy') { iniciar(paneId, data.turnId); return; }
    if (kind === 'engine-down') { cancelar(paneId); return; }
    const st = paineis.get(paneId);
    if (!st || st.cancelado || (data.turnId && data.turnId !== st.turnId)) return;
    if (['turn-activity', 'text-delta', 'text-final', 'think-delta', 'tool-start'].includes(kind) && st.finalizado) {
      limparTimer(st); st.finalizado = false; st.tocou = false; st.revisao++;
    }
    // idle/replay só limpa a UI; não confirma que o trabalho deu certo.
    if (kind !== 'turn-end' || !data.resultado) return;
    if (data.resultado !== 'sucesso') { cancelar(paneId); return; }
    if (st.finalizado || st.tocou) return;
    st.finalizado = true;
    st.timer = agendar(() => {
      st.timer = null;
      if (!fechado && paineis.get(paneId) === st && !st.cancelado && st.finalizado) {
        fila.push({ paneId, st, revisao: st.revisao }); proximo();
      }
    }, silencioMs);
  }
  function fechar() {
    fechado = true;
    for (const st of paineis.values()) limparTimer(st);
    paineis.clear(); fila.length = 0;
    return tocando ? tocando.parar() : Promise.resolve();
  }
  return { iniciar, evento, cancelar, fechar, reabrir() { fechado = false; } };
}

module.exports = { criarSomConclusao };
