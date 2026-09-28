'use strict';
// Leitura de sessões/comandos portada do fork fork do Cockpit (52dee0f).
const fs = require('fs');
const { horaDaUltimaFala, horaDoRegistro } = require('./hora-da-fala');
const path = require('path');
const crypto = require('crypto');
const { StringDecoder } = require('string_decoder');
function criarCli({ HOME, emit, spawnBin, acharBin, temBin, buildEnv, pastaDados, matarGrupo, aoConfirmarConta, aoFalharConta }) {
const CLIS = { gemini: { nome: 'Gemini', bin: 'gemini', conversas: true, comandos: true,
  pastaSessoes: () => path.join(HOME, '.gemini', 'tmp') } };
const headRead = (file, max) => {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const buffer = Buffer.alloc(max);
    return buffer.subarray(0, fs.readSync(fd, buffer, 0, max, 0)).toString('utf8');
  } catch { return ''; }
  finally { if (fd !== undefined) fs.closeSync(fd); }
};
// Limite do contexto legado ao trocar o runtime; a ficha da lateral tem cache próprio.
const TETO_LEITURA_COMPLETA = 4 * 1024 * 1024;
const CAUDA_RETOMADA = 1024 * 1024; // os marcadores de retomada/runtime ficam perto de onde a conversa esta sendo escrita agora
const caudaRead = (file, tamanho, max) => {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const n = Math.min(max, tamanho);
    const buffer = Buffer.alloc(n);
    fs.readSync(fd, buffer, 0, n, tamanho - n);
    return buffer.toString('utf8');
  } catch { return ''; }
  finally { if (fd !== undefined) fs.closeSync(fd); }
};
const mensagemValida = m => m && typeof m === 'object' && !Array.isArray(m);
const linhasDoArquivo = file => fs.readFileSync(file, 'utf8').split('\n').flatMap(l => {
  try { const valor = JSON.parse(l); return mensagemValida(valor) ? [valor] : []; } catch { return []; }
});
function cliFalaDeGente(t) {
  const s = String(t || '').trim();
  return !!s && !s.startsWith('/') && !s.startsWith('?')
    && !s.startsWith('<session_context>') && !s.startsWith('<hook_context>');
}
const cliTexto = (c) => (Array.isArray(c)
  ? c.map((p) => (p && typeof p.text === 'string' ? p.text : '')).join('')
  : (typeof c === 'string' ? c : ''));

/* A lateral usa uma ficha pequena por arquivo, invalidada por tamanho/data.
   Nos JSONL escritos por append, somente os registros novos entram na ficha.
   O corpo completo continua disponível em historico(), sem corte para título. */
const fichas = new Map();
function fichaSessao(file) {
  const stat = fs.statSync(file);
  let f = fichas.get(file);
  if (f && f.mtime === stat.mtimeMs && f.size === stat.size && f.ctime === stat.ctimeMs) return f;
  const lerTrecho = (pos, bytes) => {
    const fd = fs.openSync(file, 'r');
    try { const b = Buffer.alloc(bytes); return b.subarray(0, fs.readSync(fd, b, 0, bytes, pos)).toString('base64'); }
    finally { fs.closeSync(fd); }
  };
  const json = /\.json$/i.test(file);
  const segue = !json && f && stat.ino === f.ino && stat.size > f.size
    && lerTrecho(0, Math.min(256, f.size)) === f.cabeca
    && lerTrecho(Math.max(0, f.size - 256), Math.min(256, f.size)) === f.cauda;
  if (!segue) f = { meta: {}, primeiro: null, retomada: '', runtime: '', hora: 0, ids: new Map(), offset: 0 };
  const resumirMensagem = m => ({ id: m.id, type: m.type,
    titulo: m.type === 'user' && cliFalaDeGente(cliTexto(m.content))
      ? cliTexto(m.content).replace(/\s+/g, ' ').trim().slice(0, 120) : '' });
  const aplicar = d => {
    if (!mensagemValida(d)) return;
    f.hora = Math.max(f.hora, horaDoRegistro(d));
    if (d.cockpit) f.meta = { cockpit: d.cockpit, id: d.id, cwd: d.cwd };
    if (d.role === 'user' && !f.primeiro) f.primeiro = { text: String(d.text || '').replace(/\s+/g, ' ').slice(0, 120) };
    if (d.retomada) f.retomada = d.retomada;
    if (d.runtime) f.runtime = d.runtime;
    if (typeof d.sessionId === 'string') f.meta.sessionId = d.sessionId;
    if (typeof d.$rewindTo === 'string') {
      const ids = [...f.ids.keys()], i = ids.indexOf(d.$rewindTo);
      if (i < 0) f.ids.clear();
      else for (const id of ids.slice(i)) f.ids.delete(id);
    }
    if (d.$set && typeof d.$set === 'object') {
      if (d.$set.sessionId) f.meta.sessionId = d.$set.sessionId;
      if (Array.isArray(d.$set.messages)) {
        f.ids.clear();
        for (const m of d.$set.messages) if (m && typeof m.id === 'string') f.ids.set(m.id, resumirMensagem(m));
      }
    }
    if (typeof d.id === 'string' && !d.cockpit) f.ids.set(d.id, resumirMensagem(d));
  };
  if (json) {
    const { meta, msgs } = cliLerConversa(file);
    aplicar({ sessionId: meta.sessionId, startTime: meta.startTime, timestamp: meta.timestamp });
    for (const [i, m] of msgs.entries()) aplicar({ ...m, id: typeof m.id === 'string' ? m.id : String(i) });
  } else {
    const fd = fs.openSync(file, 'r');
    try {
      const buf = Buffer.alloc(64 * 1024), decoder = new StringDecoder('utf8');
      let pos = f.offset, linhaInicio = pos, partes = [];
      while (pos < stat.size) {
        const n = fs.readSync(fd, buf, 0, Math.min(buf.length, stat.size - pos), pos);
        if (!n) break;
        pos += n;
        const trecho = decoder.write(buf.subarray(0, n));
        let inicio = 0, fim;
        while ((fim = trecho.indexOf('\n', inicio)) >= 0) {
          partes.push(trecho.slice(inicio, fim));
          const linha = partes.length === 1 ? partes[0] : partes.join('');
          partes = []; inicio = fim + 1;
          linhaInicio += Buffer.byteLength(linha) + 1;
          try { aplicar(JSON.parse(linha)); } catch {}
        }
        if (inicio < trecho.length) partes.push(trecho.slice(inicio));
      }
      // A linha grande só é juntada uma vez. Busca de quebra nunca revisita
      // os blocos anteriores (base64 de dezenas de MB permanece linear).
      const pendente = partes.join('');
      f.offset = linhaInicio;
      if (!decoder.lastNeed) {
        if (pendente.trim()) try { aplicar(JSON.parse(pendente)); f.offset = pos; } catch {}
        else f.offset = pos;
      }
    } finally { fs.closeSync(fd); }
  }
  f.titulo = f.primeiro?.text || [...f.ids.values()].find(m => m.titulo)?.titulo || '';
  Object.assign(f, { mtime: stat.mtimeMs, ctime: stat.ctimeMs, size: stat.size, ino: stat.ino,
    cabeca: lerTrecho(0, Math.min(256, stat.size)), cauda: lerTrecho(Math.max(0, stat.size - 256), Math.min(256, stat.size)) });
  if (fichas.size >= 2000) fichas.clear();
  fichas.set(file, f);
  return f;
}

/* Remonta o mapa de mensagens de um arquivo de conversa, na mesma ordem e com
   as mesmas regras do CLI. Devolve { meta, msgs }. */
function cliLerConversa(file) {
  const mapa = new Map();
  let meta = {};
  let bruto = '';
  try {
    bruto = fs.readFileSync(file, 'utf8');
  } catch { return { meta, msgs: [] }; }
  // As versões atuais também usam um JSON completo, não apenas JSONL.
  try {
    const registro = JSON.parse(bruto);
    if (registro.sessionId && Array.isArray(registro.messages)) return { meta: registro, msgs: registro.messages.filter(mensagemValida) };
  } catch {}
  for (const linha of bruto.split('\n')) {
    // chave aberta como TEXTO engana o contador de chaves de quem extrai a
    // funcao pra testar (ja quebrou o andaime). Aqui vai o codigo do caractere.
    if (linha.charCodeAt(0) !== 123) continue;
    let d; try { d = JSON.parse(linha); } catch { continue; }
    if (!mensagemValida(d)) continue;
    if (typeof d.$rewindTo === 'string') {
      // apaga dali pra frente; se o id nao esta no mapa, o CLI limpa tudo
      const ids = [...mapa.keys()];
      const i = ids.indexOf(d.$rewindTo);
      if (i < 0) mapa.clear();
      else for (const id of ids.slice(i)) mapa.delete(id);
      continue;
    }
    if (d.$set && typeof d.$set === 'object') {
      if (Array.isArray(d.$set.messages)) {
        mapa.clear();
        for (const m of d.$set.messages) if (m && typeof m.id === 'string') mapa.set(m.id, m);
      }
      meta = { ...meta, ...d.$set };
      continue;
    }
    if (typeof d.id === 'string') { mapa.set(d.id, d); continue; }
    if (typeof d.sessionId === 'string') meta = { ...meta, ...d };
  }
  return { meta, msgs: [...mapa.values()] };
}

/* ~/.gemini/projects.json guarda "caminho em minusculas" -> "nome da pasta em
   tmp". Sem ele a lista mostraria "hugom" como se fosse a pasta do painel, e o
   filtro por aba nunca casaria. */
function cliMapaProjetos(engine) {
  const fora = {};
  const raizCli = path.dirname(CLIS[engine].pastaSessoes());
  try {
    const j = JSON.parse(fs.readFileSync(path.join(raizCli, 'projects.json'), 'utf8'));
    for (const [caminho, apelido] of Object.entries((j && j.projects) || {})) {
      fora[apelido] = String(caminho).replace(/^([a-z]):/, (_m, d) => d.toUpperCase() + ':');
    }
  } catch {}
  return fora;
}


function cliSessions(engine) {
  const cli = CLIS[engine];
  if (!cli || !cli.conversas) return [];
  const raizCli = cli.pastaSessoes();
  if (!fs.existsSync(raizCli)) return [];
  const projetos = cliMapaProjetos(engine);
  const out = [];
  const olhar = (dir, fundo, apelido) => {
    if (fundo > 3) return;
    let itens = [];
    try { itens = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const it of itens) {
      const p = path.join(dir, it.name);
      if (it.isDirectory()) { olhar(p, fundo + 1, fundo === 0 ? it.name : apelido); continue; }
      if (!/\.jsonl?$/i.test(it.name)) continue;
      if (/[\\/]logs[\\/]/i.test(p)) continue;   // log do desenvolvedor nao e' conversa
      let quando = 0;
      try { quando = fs.statSync(p).mtimeMs; } catch { continue; }
      quando = horaDaUltimaFala(p, quando);   // 26/09: a última fala, não a última gravação do arquivo
      let ficha; try { ficha = fichaSessao(p); } catch { continue; }
      if (ficha.hora) quando = Math.min(ficha.hora, ficha.mtime);
      const id = ficha.meta.sessionId;
      if (!id || !ficha.titulo) continue;   // conversa que nunca saiu do contexto inicial
      out.push({
        engine, id, file: p, when: quando, entrada: 'cockpit',
        cwd: projetos[apelido] || HOME,
        title: ficha.titulo,
      });
    }
  };
  olhar(raizCli, 0, '');
  out.sort((a, b) => b.when - a.when);
  return out.slice(0, 300);
}

/* Reabrir a conversa na tela, no mesmo formato que o Claude e o Codex ja
   devolvem: { role: 'user' | 'bot' | 'tool', text, name, arg }. */
function cliHistory(file, maxMsgs) {
  const { msgs } = cliLerConversa(file);
  const out = [];
  for (const m of msgs) {
    if (!m || m.type === 'info' || m.type === 'error' || m.type === 'warning') continue;
    const texto = cliTexto(m.content).trim();
    if (m.type === 'user') {
      if (!cliFalaDeGente(texto)) continue;
      out.push({ role: 'user', text: texto });
      continue;
    }
    // o CLI chama a fala do modelo de "gemini"
    if (texto) out.push({ role: 'bot', text: texto });
    for (const t of (Array.isArray(m.toolCalls) ? m.toolCalls.filter(mensagemValida) : [])) {
      let arg = '';
      try { arg = t.args ? JSON.stringify(t.args).slice(0, 120) : ''; } catch {}
      out.push({ role: 'tool', name: t.name || 'Ferramenta', arg });
    }
  }
  return out.slice(-(maxMsgs || 60));
}

function comandosDoCli(engine) {
  const cli = CLIS[engine];
  if (!cli || !cli.comandos) return [];
  const raizCmd = path.join(path.dirname(cli.pastaSessoes()), 'commands');
  const out = [];
  const olhar = (dir, prefixo, fundo) => {
    if (fundo > 4) return;
    let itens = [];
    try { itens = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const it of itens) {
      const p = path.join(dir, it.name);
      if (it.isDirectory()) { olhar(p, prefixo + it.name + ':', fundo + 1); continue; }
      if (!/\.toml$/i.test(it.name)) continue;
      out.push({ name: prefixo + it.name.replace(/\.toml$/i, ''), desc: descricaoDoToml(p) });
    }
  };
  olhar(raizCmd, '', 0);
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/* Do arquivo inteiro so' a linha "description = ..." interessa pro menu. Trazer
   um leitor de TOML pra dentro do app por causa de uma linha nao se paga. */
function descricaoDoToml(file) {
  const cabeca = headRead(file, 2000);
  const m = cabeca.match(/^[ \t]*description[ \t]*=[ \t]*(.+)$/m);
  if (!m) return '';
  return m[1].trim().replace(/^["']|["']$/g, '').slice(0, 140);
}

const paineis = new Map();
const arquivo = id => path.join(pastaDados(), 'gemini', String(id).replace(/[^\w-]/g, '') + '.jsonl');
const anotar = (st, msg) => {
  fs.mkdirSync(path.dirname(st.file), { recursive: true });
  // 26/09: cada linha leva a hora ("t"): a lista usa a da última fala, não a da gravação do arquivo
  fs.appendFileSync(st.file, JSON.stringify(msg && typeof msg === 'object' && msg.t === undefined ? { ...msg, t: Date.now() } : msg) + '\n', 'utf8');
};
function motivo(erro) {
  const s = String(erro || '').replace(/\x1b\[[0-9;]*m/g, '');
  if (/UNSUPPORTED_CLIENT|no longer supported for Gemini Code Assist/i.test(s)) return 'O Google aceitou seu login, mas encerrou o acesso gratuito pelo Gemini CLI. A conta continua salva; o Google indica usar o Antigravity.';
  if (/quota|RESOURCE_EXHAUSTED|429/i.test(s)) return 'O Gemini atingiu o limite de uso da conta. Tente mais tarde.';
  if (/IneligibleTierError/i.test(s)) return 'Sua conta Google não está liberada para usar este Gemini. O login pode estar salvo, mas o serviço recusou o acesso.';
  if (/auth|credentials|GEMINI_API_KEY|Please login/i.test(s)) return 'Entre na conta do Gemini pelo terminal antes de usar este chat.';
  return s.trim().split('\n').filter(x => !/^\s*at /.test(x)).slice(-2).join(' ').slice(0, 300) || 'O Gemini encerrou sem responder.';
}
function fala(st) {
  if (!st.acc) return;
  emit(st.paneId, 'text-final', { id: st.msgId, text: st.acc });
}
function fecharFala(st) {
  clearTimeout(st.timer); st.timer = null;
  if (st.acc) {
    fala(st);
    try { anotar(st, { role: 'bot', text: st.acc }); }
    catch (e) { emit(st.paneId, 'note', { text: 'A resposta está na tela, mas não consegui salvá-la no Mac: ' + e.message, error: true }); }
  }
  st.acc = ''; st.msgId = null;
}
function evento(st, ev) {
  if (!ev || typeof ev !== 'object') return;
  if (ev.event) return eventoAntigravity(st, ev);
  if (ev.type === 'init' && ev.session_id) {
    st.resumeId = String(ev.session_id);
    anotar(st, { retomada: st.resumeId, runtime: st.runtime });
    return;
  }
  if (ev.type === 'message' && ev.role !== 'user') {
    const t = cliTexto(ev.content);
    if (!t) return;
    if (!st.msgId) st.msgId = 'gemini-' + crypto.randomUUID();
    st.acc = ev.delta === false ? t : st.acc + t;
    if (!st.timer) st.timer = setTimeout(() => { st.timer = null; if (paineis.get(st.paneId) === st) fala(st); }, 100);
  } else if (ev.type === 'tool_use') {
    fecharFala(st);
    const args = ev.parameters || ev.args || {};
    const name = ev.tool_name || ev.name || 'Ferramenta';
    const id = ev.tool_id || ev.id || crypto.randomUUID();
    if (name === 'write_todos' && Array.isArray(args.todos)) {
      emit(st.paneId, 'plan', { id: 'gemini', steps: args.todos.map(t => ({ step: String(t.description || t.content || ''), status: t.status || 'pending' })) });
    }
    const arg = typeof args === 'string' ? args : JSON.stringify(args);
    emit(st.paneId, 'tool-start', { id, name, arg: arg.slice(0, 400) });
    anotar(st, { role: 'tool', name, arg: arg.slice(0, 400) });
  } else if (ev.type === 'tool_result') {
    emit(st.paneId, 'tool-end', { id: ev.tool_id || ev.id, output: cliTexto(ev.output) || JSON.stringify(ev.output || ''), error: ev.status === 'error' || !!ev.error });
  } else if (ev.type === 'error' || (ev.type === 'result' && ev.status === 'error')) {
    if (st.runtime === 'agy' && /auth|credentials|login|UNAUTHENTICATED|401/i.test(String(ev.message || ev.error?.message || ev.error || ''))) aoFalharConta?.();
    st.erro = motivo(ev.message || ev.error?.message || ev.error);
    emit(st.paneId, 'note', { text: st.erro, error: true });
    st.avisou = true;
  } else if (ev.type === 'result') {
    st.resultadoSucesso = ev.status === 'success';
    const s = ev.stats || {};
    const entrada = s.input_tokens || s.inputTokens || 0, saida = s.output_tokens || s.outputTokens || 0;
    if (entrada || saida) emit(st.paneId, 'tokens', { total: entrada + saida });
  }
}
// Protocolo oficial Antigravity. A tela e os arquivos do Cockpit conservam o
// mesmo formato Gemini; somente a conversa com o programa mudou.
function eventoAntigravity(st, ev) {
  if (ev.event === 'init' && ev.conversation_id) {
    st.resumeId = String(ev.conversation_id);
    st.contextoLegado = '';
    anotar(st, { retomada: st.resumeId, runtime: 'agy' });
    return;
  }
  if (ev.event === 'step_update') {
    const s = ev.step_update || {};
    if (s.step_type === 'agent_response' && typeof s.text_delta === 'string' && s.text_delta) {
      st.teveTexto = true;
      evento(st, { type: 'message', role: 'assistant', content: s.text_delta, delta: true });
    }
    if (s.step_type === 'tool') {
      const id = 'agy-' + (s.conversation_id || st.resumeId || st.id) + '-' + s.step_index;
      const info = s.tool_info || {};
      if (!st.tools.has(id)) {
        st.tools.add(id);
        evento(st, { type: 'tool_use', tool_id: id, tool_name: info.name || s.tool_name,
          parameters: info.parameters || {} });
      }
      if (s.state === 'DONE' && !st.tools.has(id + ':fim')) {
        st.tools.add(id + ':fim');
        evento(st, { type: 'tool_result', tool_id: id, output: info.output || info.error?.message || '',
          status: info.error ? 'error' : 'success' });
      }
    }
    return;
  }
  if (ev.event === 'result') {
    const r = ev.result || {};
    if (r.conversation_id && st.resumeId !== String(r.conversation_id)) {
      st.resumeId = String(r.conversation_id); st.contextoLegado = '';
      anotar(st, { retomada: st.resumeId, runtime: 'agy' });
    }
    if (!st.teveTexto && typeof r.response === 'string' && r.response) {
      evento(st, { type: 'message', role: 'assistant', content: r.response, delta: false });
    }
    if (r.status && r.status !== 'SUCCESS') {
      evento(st, { type: 'error', message: r.error || 'O Gemini terminou com estado ' + r.status + '.' });
    } else {
      if (r.status === 'SUCCESS') aoConfirmarConta?.();
      evento(st, { type: 'result', status: r.status === 'SUCCESS' ? 'success' : 'unknown', stats: r.usage || {} });
    }
  }
}
function parar(paneId, manter) {
  const st = paineis.get(paneId);
  if (!st) return Promise.resolve();
  const proc = st.proc;
  st.proc = null;
  fecharFala(st);
  // R3-009: devolve a Promise do matarGrupo (so' resolve quando o processo morre de
  // verdade), pra shutdown() esperar em vez de deixar o Electron fechar antes da hora
  const espera = proc ? matarGrupo(proc) : Promise.resolve();
  if (!manter) paineis.delete(paneId);
  else if (proc) emit(paneId, 'turn-end', { turnId: st.somTurno, resultado: 'cancelado' });
  return espera;
}
function start(paneId, opts) {
  if (String(opts.cwd || '').startsWith('vps:')) throw new Error('O Gemini deste painel roda somente em uma pasta do Mac.');
  const runtime = temBin('agy') ? 'agy' : 'gemini';
  if (!temBin(runtime)) throw new Error('Gemini ainda não está instalado neste Mac. Instale o Antigravity e entre com sua conta Google.');
  parar(paneId);
  const id = opts.resumeId || crypto.randomUUID();
  const file = arquivo(id);
  let resumeId = opts.resumeId || '', runtimeAnterior = 'gemini', contextoLegado = '', mensagensLegado = [];
  if (fs.existsSync(file)) {
    resumeId = '';
    // R1-040: le tudo so' se o arquivo for pequeno (comportamento de hoje). Acima
    // do teto, le so' a CAUDA (os marcadores ficam perto de onde a conversa esta
    // sendo escrita agora); se a cauda nao achar nada, cai pro arquivo inteiro
    // em vez de arriscar tratar uma conversa ja migrada como se nao fosse.
    const aplicarLinhas = (bruto) => {
      let achou = false;
      for (const l of String(bruto || '').split('\n')) {
        let x; try { x = JSON.parse(l); } catch { continue; }
        if (x.runtime) { runtimeAnterior = x.runtime; achou = true; }
        if (x.retomada) { resumeId = x.retomada; achou = true; }
      }
      return achou;
    };
    const tamanho = fs.statSync(file).size;
    if (tamanho > TETO_LEITURA_COMPLETA) {
      let cauda = caudaRead(file, tamanho, CAUDA_RETOMADA);
      if (cauda) cauda = cauda.slice(cauda.indexOf('\n') + 1); // descarta a 1a linha, truncada no meio
      if (!aplicarLinhas(cauda)) { try { aplicarLinhas(fs.readFileSync(file, 'utf8')); } catch {} }
    } else {
      aplicarLinhas(fs.readFileSync(file, 'utf8'));
    }
  }
  if (resumeId && runtime !== runtimeAnterior) {
    // IDs do Gemini antigo não são aceitos pelo Antigravity. Mantém o arquivo
    // antigo legível e transmite as falas como contexto na primeira retomada.
    const fonte = fs.existsSync(file) ? file : cliSessions('gemini').find(s => s.id === opts.resumeId)?.file;
    let msgs = [], tamanhoFonte = 0;
    try { tamanhoFonte = fonte ? fs.statSync(fonte).size : 0; } catch {}
    const cockpit = fonte && /"cockpit"\s*:\s*1/.test(headRead(fonte, 1024));
    if (fonte && cockpit && tamanhoFonte > TETO_LEITURA_COMPLETA) {
      // Cresce até achar falas COMPLETAS. Uma última resposta >1MB não pode
      // sumir por começar antes do recorte original da cauda.
      for (let bytes = Math.min(CAUDA_RETOMADA, tamanhoFonte); ; bytes = Math.min(bytes * 2, tamanhoFonte)) {
        let cauda = caudaRead(fonte, tamanhoFonte, bytes);
        if (bytes < tamanhoFonte) cauda = cauda.slice(cauda.indexOf('\n') + 1);
        msgs = cauda.split('\n').flatMap(l => {
          try {
            const d = JSON.parse(l);
            return mensagemValida(d) && ['user', 'bot'].includes(d.role) ? [{ role: d.role, text: String(d.text || '') }] : [];
          } catch { return []; }
        }).slice(-60);
        if (msgs.length >= 60 || bytes === tamanhoFonte) break;
      }
    } else if (fonte) {
      // JSON/JSONL nativo pode ter $set e $rewindTo: só o leitor completo
      // sabe quais mensagens continuam na conversa após essas operações.
      msgs = historico(fonte).filter(m => ['user', 'bot'].includes(m.role)).slice(-60);
    }
    mensagensLegado = msgs;
    const legado = msgs.map(m => (m.role === 'user' ? 'Usuário: ' : 'Assistente: ') + String(m.text || '')).join('\n\n');
    if (tamanhoFonte > TETO_LEITURA_COMPLETA || msgs.length >= 60 || legado.length > 80000) emit(paneId, 'note', { text: 'Ao trocar o motor Gemini, retomei só as últimas falas como contexto. O histórico completo continua salvo nesta conversa.' });
    contextoLegado = legado.slice(-80000);
    resumeId = '';
  }
  const st = { paneId, id, file, resumeId, runtime, contextoLegado, cwd: opts.cwd || HOME, model: opts.model || '',
    modo: ({ manual: 'default', auto: 'auto_edit', plan: 'plan', bypass: 'yolo' })[opts.approval] || 'default',
    proc: null, acc: '', msgId: null, timer: null, tools: new Set() };
  if (!fs.existsSync(file)) {
    anotar(st, { cockpit: 1, id, runtime, cwd: st.cwd, model: st.model, criado: Date.now() });
    for (const m of mensagensLegado) anotar(st, { role: m.role, text: m.text, legado: true });
  }
  paineis.set(paneId, st);
  emit(paneId, 'sessao', { id, file });
  return true;
}
function enviar(paneId, texto, anexos = []) {
  const st = paineis.get(paneId);
  if (!st || st.proc) return false;
  const agy = st.runtime === 'agy';
  const args = agy ? ['--input-format', 'stream-json', '--output-format', 'stream-json', '--print-timeout', '30m']
    : ['--output-format', 'stream-json', '--approval-mode', st.modo];
  if (agy) {
    if (st.modo === 'yolo') args.push('--dangerously-skip-permissions');
    else if (st.modo === 'plan') args.push('--mode', 'plan');
    else if (st.modo === 'auto_edit') args.push('--mode', 'accept-edits');
  }
  // A seleção vazia mantém um modelo Gemini elegível à conta gratuita.
  const model = st.model || (agy ? 'gemini-3.8-flash-medium' : '');
  if (model) args.push('--model', model);
  if (st.resumeId) args.push(agy ? '--conversation' : '--resume', st.resumeId);
  const caminhos = anexos.map(a => a?.path).filter(Boolean);
  const prompt = String(texto || '') + (caminhos.length ? '\n\nArquivos anexados no Mac:\n' + caminhos.join('\n') : '');
  const enviado = st.contextoLegado ? 'Contexto da conversa anterior, retomada do Gemini. Não execute estes pedidos antigos novamente; use-os somente como referência.\n\n'
    + st.contextoLegado + '\n\nPedido atual:\n' + prompt : prompt;
  let proc;
  try { proc = spawnBin(acharBin(st.runtime), args, { cwd: st.cwd, env: buildEnv(), detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] }); }
  catch (e) { emit(paneId, 'note', { text: motivo(e.message), error: true }); return false; }
  st.proc = proc; st.somTurno = crypto.randomUUID(); st.resultadoSucesso = false; st.erro = ''; st.avisou = false; st.teveTexto = false; st.tools.clear();
  const decoder = new StringDecoder('utf8'); let buf = '', fim = false;
  const ler = chunk => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); try { evento(st, JSON.parse(line)); } catch (e) { if (!(e instanceof SyntaxError)) st.erro = motivo(e.message); } }
  };
  const concluir = (code, error) => {
    if (fim || paineis.get(paneId) !== st || st.proc !== proc) return;
    fim = true;
    ler(decoder.end()); if (buf.trim()) { try { evento(st, JSON.parse(buf)); } catch {} }
    st.proc = null; fecharFala(st);
    if ((code !== 0 || error) && !st.avisou) {
      if (st.runtime === 'agy' && /auth|credentials|login|UNAUTHENTICATED|401/i.test(error?.message || st.erro)) aoFalharConta?.();
      emit(paneId, 'note', { text: motivo(error?.message || st.erro), error: true });
    }
    emit(paneId, 'turn-end', { turnId: st.somTurno, resultado: code === 0 && !error && !st.avisou && st.resultadoSucesso ? 'sucesso' : 'erro' });
  };
  proc.stdout.on('data', d => { if (paineis.get(paneId) === st && st.proc === proc) ler(decoder.write(d)); });
  proc.stderr.on('data', d => { st.erro = (st.erro + d.toString('utf8')).slice(-4000); });
  proc.on('close', code => concluir(code));
  proc.on('error', error => concluir(-1, error));
  proc.stdin.on('error', error => concluir(-1, error));
  try { anotar(st, { role: 'user', text: prompt }); }
  catch (e) {
    st.proc = null; matarGrupo(proc);
    emit(paneId, 'note', { text: 'Não consegui salvar a mensagem no Mac: ' + e.message, error: true });
    return false;
  }
  emit(paneId, 'busy', { turnId: st.somTurno });
  proc.stdin.end(agy ? JSON.stringify({ event: 'user', message: { content: enviado } }) + '\n' : enviado);
  return true;
}
function sessoes() {
  const out = cliSessions('gemini');
  const dir = path.join(pastaDados(), 'gemini');
  try { for (const nome of fs.readdirSync(dir)) {
    if (!nome.endsWith('.jsonl')) continue;
    try {
    const file = path.join(dir, nome);
    const ficha = fichaSessao(file), meta = ficha.meta;
    if (!meta?.cockpit || !ficha.primeiro) continue;
    const retomada = ficha.retomada;
    const existente = out.findIndex(s => s.id === retomada || s.id === meta.id);
    if (existente >= 0) out.splice(existente, 1);
    out.push({ engine: 'gemini', id: meta.id, file, cwd: meta.cwd, when: horaDaUltimaFala(file, fs.statSync(file).mtimeMs), title: ficha.titulo });
    } catch { /* Uma sessão ilegível não esconde as demais. */ }
  } } catch {}
  return out.sort((a, b) => b.when - a.when).slice(0, 300);
}
function historico(file) {
  try {
    const linhas = linhasDoArquivo(file);
    if (linhas[0]?.cockpit) return linhas.filter(m => ['user', 'bot', 'tool'].includes(m.role));
  } catch { return []; }
  return cliHistory(file, 5000);
}
return { start, enviar, parar, sessoes, historico,
  vivo: paneId => paineis.has(paneId),
  trabalhando: () => [...paineis.values()].filter(st => !!st.proc).length,
  // R3-010: pane:estado (reconexao do celular) so enxergava Claude/Codex; sem isto um
  // turno de Gemini em andamento era relido como "terminou" ao reconectar
  ocupado: paneId => !!paineis.get(paneId)?.proc,
  comandos: () => comandosDoCli('gemini'),
  // R3-009: shutdown() precisa esperar o kill de verdade, nao so' disparar e seguir
  fechar: () => Promise.all([...paineis.keys()].map(id => parar(id))) };
}
module.exports = { criarCli };
