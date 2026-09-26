/* ===================== MOTOR ACP (o quinto motor) =====================
   ACP = Agent Client Protocol: um JSON-RPC por stdio que varios agentes de
   codigo ja falam (Gemini CLI com "--acp", Claude Code e Codex pelos
   adaptadores do Zed, OpenCode, Qwen Code...). Em vez de uma leva de adaptacao
   por agente, o Cockpit fala o protocolo UMA vez e qualquer agente ACP entra
   pelo mesmo cano: basta o comando que sobe o processo.

   O que o protocolo entrega, e onde cada coisa encaixa na tela:
     session/update agent_message_chunk  -> a fala (text-final, com freio de 100ms)
     session/update agent_thought_chunk  -> o pensamento (think-delta)
     session/update tool_call / _update  -> os passos (tool-start / tool-end)
     session/update plan                 -> o plano vivo (plano)
     session/request_permission          -> a barra Permitir/Negar que ja existe
     fs/read_text_file, fs/write_text_file -> o Cockpit le/escreve pelo agente

   Este arquivo NAO depende do Electron de proposito: quem o usa injeta emit,
   spawnBin, buildEnv etc. Assim ele roda sozinho no node contra o agente de
   verdade (testes/acp-vivo.js) e as traducoes sao testadas puras (teste-acp.js).

   Provado rodando antes de virar motor: testes/acp-log-prova-20260906.jsonl.
   As armadilhas que so' apareceram rodando estao tratadas aqui:
     1. "gemini --acp" NAO le o ~/.gemini/.env (o CLI normal le) -> a chave e'
        injetada no ambiente do processo (lerChaveGemini).
     2. a primeira resposta pode passar de 90s -> prazos generosos.
     3. a pasta nao confiada vira so' um aviso no stderr, o turno roda.
     4. o write_file do Gemini le o arquivo PELO CLIENTE antes de escrever e
        desiste se a leitura de um arquivo inexistente volta como erro ->
        arquivo que nao existe devolve conteudo vazio (o Zed faz igual). */

const fs = require('fs');
const { horaDaUltimaFala } = require('./hora-da-fala');
const path = require('path');
const crypto = require('crypto');
const { StringDecoder } = require('string_decoder');

const COMANDO_PADRAO = 'gemini --acp';
const LIM_DIFF = 100 * 1024;
const LIM_SAIDA = 8000;
const LIM_IMG = 4 * 1024 * 1024;            // imagem que VOCE manda (bytes)
const LIM_IMG_PASSO = 3 * 1024 * 1024;      // imagem que o agente devolve (base64) - mesmo teto do Claude
const MAX_IMG_PASSO = 4;
const LIM_LEITURA = 20 * 1024 * 1024;       // fs/read_text_file: acima disto trava a janela
// R3-046: uma linha de stdout sem '\n' cresce pra sempre e o indexOf a cada pedaco
// fica cada vez mais caro (sincrono no processo principal) - acima disto, corta.
// R4-002: o corte real de tamanho (LIM_DIFF/LIM_SAIDA) so' acontece DEPOIS do
// JSON.parse da linha inteira - um teto baixo aqui mata diff/edicao LEGITIMA de
// arquivo grande (>24MB de oldText+newText cru) antes desse corte rodar. 80MB
// da' folga pra diff real e ainda mata buffer genuinamente sem fim; o que fica
// na tela e na memoria do painel continua pequeno, porque o corte pos-parse
// nao mudou.
const LIM_BUF_SEM_QUEBRA = 80 * 1024 * 1024;
const MIME_IMG = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };

/* Quebra a linha de comando em programa + argumentos, respeitando aspas.
   "npx -y @zed-industries/claude-code-acp" -> { bin: 'npx', args: [...] } */
function comandoEmPartes(linha) {
  const partes = [];
  let atual = '', aspa = null, teve = false;
  for (const ch of String(linha || '').trim()) {
    if (aspa) { if (ch === aspa) aspa = null; else atual += ch; continue; }
    if (ch === '"' || ch === "'") { aspa = ch; teve = true; continue; }
    if (/\s/.test(ch)) { if (atual || teve) { partes.push(atual); atual = ''; teve = false; } continue; }
    atual += ch;
  }
  if (atual || teve) partes.push(atual);
  return { bin: partes[0] || '', args: partes.slice(1) };
}

/* Modo do Cockpit -> modo do agente. Cada agente batiza os seus (o Gemini tem
   default/autoEdit/yolo/plan; o adaptador do Claude tem default/acceptEdits/
   plan/bypassPermissions). Aqui vai a lista de apelidos conhecidos, e vale o
   primeiro que o agente anunciou ter. Sem correspondencia, nao mexe. */
const MODOS_EQUIVALENTES = {
  manual: ['default', 'ask', 'normal', 'interactive'],
  'auto-edit': ['autoEdit', 'auto_edit', 'acceptEdits', 'accept_edits', 'auto-edit'],
  plan: ['plan', 'planning', 'readOnly', 'read-only', 'read_only'],
  bypass: ['yolo', 'bypassPermissions', 'bypass_permissions', 'bypass', 'full-auto', 'fullAuto', 'dangerously-skip-permissions', 'auto'],
};
function modoDoAgente(approval, modos) {
  const lista = Array.isArray(modos) ? modos : [];
  const quer = MODOS_EQUIVALENTES[approval] || MODOS_EQUIVALENTES.manual;
  for (const apelido of quer) {
    const m = lista.find((x) => x && String(x.id || '').toLowerCase() === apelido.toLowerCase());
    if (m) return m.id;
  }
  return '';
}

/* ---- pedacos de conteudo do protocolo -> texto ---- */
function textoDoBloco(c) {
  if (!c) return '';
  if (typeof c === 'string') return c;
  if (c.type === 'text') return String(c.text == null ? '' : c.text);
  if (c.type === 'resource_link') return String(c.uri || c.name || '');
  if (c.type === 'resource' && c.resource) return String(c.resource.text || c.resource.uri || '');
  if (c.type === 'image') return '[imagem]';
  if (c.type === 'audio') return '[áudio]';
  return '';
}
const corta = (s, n) => { const t = String(s == null ? '' : s); return t.length > n ? t.slice(0, n) + '\n…(cortado)' : t; };

/* O conteudo de um passo pode ter texto, um diff (arquivo que muda) e imagem.
   O diff vira a mesma "mudanca" que a tela ja desenha pro Claude. Imagem tem
   o mesmo teto do Claude: e' pra ver o print, nao pra carregar um filme no IPC. */
function conteudoDaFerramenta(itens) {
  let texto = '';
  let mudanca = null;
  const imagens = [];
  let descartadas = 0;   // R3-047: imagem grande demais (>3MB) ou alem da 4a sumia calada
  for (const it of (Array.isArray(itens) ? itens : [])) {
    if (!it) continue;
    if (it.type === 'content') {
      const b = it.content;
      if (b && b.type === 'image' && b.data) {
        const dados = String(b.data);
        if (dados.length <= LIM_IMG_PASSO && imagens.length < MAX_IMG_PASSO) imagens.push({ mime: b.mimeType || 'image/png', dados });
        else descartadas++;
      } else { const t = textoDoBloco(b); if (t) texto += (texto ? '\n' : '') + t; }
    } else if (it.type === 'diff') {
      mudanca = {
        path: String(it.path || ''),
        antes: it.oldText == null ? '' : corta(it.oldText, LIM_DIFF),
        depois: corta(it.newText, LIM_DIFF),
        tipo: it.oldText == null ? 'write-novo' : 'edit',
      };
    } else if (it.type === 'terminal') {
      texto += (texto ? '\n' : '') + '[terminal ' + (it.terminalId || '') + ']';
    }
  }
  imagens.descartadas = descartadas;
  return { texto, mudanca, imagens };
}

/* O "kind" do passo e' a categoria padronizada do protocolo; o nome que vai pra
   tela e' o mesmo que o Claude usa, pra fraseDoPasso() traduzir igual. */
const NOME_POR_KIND = {
  read: 'Read', edit: 'Edit', delete: 'Excluindo', move: 'Movendo', search: 'Grep',
  execute: 'Bash', think: 'Pensando', fetch: 'WebFetch', switch_mode: 'Trocando o modo',
};
function passoDaFerramenta(tc) {
  const t = tc || {};
  const kind = String(t.kind || 'other');
  const loc = Array.isArray(t.locations) && t.locations[0] && t.locations[0].path;
  const raw = (t.rawInput && typeof t.rawInput === 'object') ? t.rawInput : {};
  const doInput = raw.command || raw.cmd || raw.file_path || raw.path || raw.absolute_path || raw.pattern || raw.query || raw.url;
  const titulo = String(t.title || '').replace(/\s+/g, ' ').trim();
  const name = NOME_POR_KIND[kind] || titulo || 'Ferramenta';
  let arg = String(loc || doInput || titulo || '').slice(0, 300);
  if (arg === name) arg = '';   // senao a linha do passo repetia o mesmo texto duas vezes
  return { name, arg, kind, titulo };
}
/* do tool_call, so' o que o cartao de permissao pode precisar depois: guardar
   o update inteiro segurava imagem base64/diff/rawOutput de cada passo ate' o
   fim do turno (agente de navegador = centenas de MB) */
const enxuto = (u) => ({ title: u && u.title, kind: u && u.kind, locations: u && u.locations, rawInput: u && u.rawInput });

/* A chave do "sempre permitir". O kind do protocolo tem 9 valores e "other"
   cobre MCP, web, memoria... liberar "other" inteiro liberaria tudo isso de
   uma vez - entao "other" e' por titulo. */
function chaveDePermissao(passo) {
  return passo.kind === 'other' ? 'other:' + (passo.titulo || passo.name) : passo.kind;
}
const rotuloDoPasso = (passo) => NOME_POR_KIND[passo.kind] || passo.titulo || passo.name || 'ferramenta';

const seguroJson = (v) => { try { return JSON.stringify(v).slice(0, LIM_SAIDA); } catch { return ''; } };

/* Traduz UM session/update nos eventos que a tela ja entende. Funcao pura
   (so' mexe no "st" que recebe e devolve a lista) - e' o que o teste prova. */
function traduzirUpdate(st, upd) {
  const out = [];
  if (!upd || typeof upd !== 'object') return out;
  if (!st.ferramentas) st.ferramentas = new Map();
  const tipo = upd.sessionUpdate;

  if (tipo === 'agent_message_chunk') {
    if (st.carregando) return out;   // replay do session/load: a tela ja tem o historico
    const t = textoDoBloco(upd.content);
    if (!t) return out;
    if (!st.msgId) { st.seq = (st.seq || 0) + 1; st.msgId = 'acp' + st.seq; st.acc = ''; }
    st.acc += t;
    out.push({ kind: 'text-final', id: st.msgId, text: st.acc, parcial: true });
    return out;
  }
  if (tipo === 'agent_thought_chunk') {
    if (st.carregando) return out;
    const t = textoDoBloco(upd.content);
    if (t) out.push({ kind: 'think-delta', text: t });
    return out;
  }
  if (tipo === 'user_message_chunk') return out;   // a sua fala a tela desenhou ao enviar

  if (tipo === 'tool_call') {
    if (st.carregando) return out;
    fecharFala(st, out);
    const id = String(upd.toolCallId || ('t' + Date.now()));
    const p = passoDaFerramenta(upd);
    const c = conteudoDaFerramenta(upd.content);
    // guarda o pedido cru: o request_permission pode vir so' com o id
    st.ferramentas.set(id, { name: p.name, arg: p.arg, kind: p.kind, temMudanca: !!c.mudanca, mudanca: c.mudanca, bruto: enxuto(upd), fim: false });
    out.push({ kind: 'tool-start', id, name: p.name, arg: p.arg, mudanca: c.mudanca || null });
    if (upd.status === 'completed' || upd.status === 'failed') {
      let saida = c.texto;
      // R3-047: imagem grande demais sumia sem aviso; entra no texto ANTES do corta() de LIM_SAIDA
      if (c.imagens.descartadas) saida = (saida ? saida + '\n' : '') + '(' + (c.imagens.descartadas === 1 ? '1 imagem' : c.imagens.descartadas + ' imagens') + ' grande(s) demais para mostrar)';
      out.push({ kind: 'tool-end', id, output: corta(saida, LIM_SAIDA), error: upd.status === 'failed', imagens: c.imagens });
      st.ferramentas.get(id).fim = true;
    }
    return out;
  }
  if (tipo === 'tool_call_update') {
    if (st.carregando) return out;
    const id = String(upd.toolCallId || '');
    if (!id) return out;
    const c = conteudoDaFerramenta(upd.content);
    let f = st.ferramentas.get(id);
    if (f && f.fim) {
      // passo ja terminado: so' um diff tardio interessa; o resto e' repeticao
      // (renascer como passo novo dava passo e fim em dobro na linha do tempo)
      if (c.mudanca && !f.temMudanca) { f.temMudanca = true; f.mudanca = c.mudanca; out.push({ kind: 'tool-mudanca', id, mudanca: c.mudanca }); }
      return out;
    }
    if (!f) {
      // update de um passo que nunca teve o tool_call (alguns agentes mandam
      // so' o update): o passo nasce agora, em vez de sumir
      fecharFala(st, out);
      const p = passoDaFerramenta(upd);
      f = { name: p.name, arg: p.arg, kind: p.kind, temMudanca: !!c.mudanca, mudanca: c.mudanca, bruto: enxuto(upd), fim: false };
      st.ferramentas.set(id, f);
      out.push({ kind: 'tool-start', id, name: p.name, arg: p.arg, mudanca: c.mudanca || null });
    } else if (c.mudanca && !f.temMudanca) {
      f.temMudanca = true; f.mudanca = c.mudanca;
      out.push({ kind: 'tool-mudanca', id, mudanca: c.mudanca });
    }
    const status = upd.status;
    if (status === 'completed' || status === 'failed') {
      let saida = c.texto;
      if (!saida && upd.rawOutput != null) saida = typeof upd.rawOutput === 'string' ? upd.rawOutput : seguroJson(upd.rawOutput);
      // R3-047: imagem grande demais sumia sem aviso; entra no texto ANTES do corta() de LIM_SAIDA
      if (c.imagens.descartadas) saida = (saida ? saida + '\n' : '') + '(' + (c.imagens.descartadas === 1 ? '1 imagem' : c.imagens.descartadas + ' imagens') + ' grande(s) demais para mostrar)';
      out.push({ kind: 'tool-end', id, output: corta(saida, LIM_SAIDA), error: status === 'failed', imagens: c.imagens });
      f.fim = true;
    } else if (c.texto) {
      out.push({ kind: 'tool-output', id, text: c.texto });
    }
    return out;
  }
  if (tipo === 'plan') {
    const itens = (Array.isArray(upd.entries) ? upd.entries : []).slice(0, 30).map((e) => ({
      txt: String((e && e.content) || '').slice(0, 200),
      estado: e && e.status === 'completed' ? 'feito' : (e && e.status === 'in_progress' ? 'fazendo' : 'pendente'),
    })).filter((x) => x.txt);
    out.push({ kind: 'plano', itens });
    return out;
  }
  if (tipo === 'available_commands_update') {
    st.comandos = (Array.isArray(upd.availableCommands) ? upd.availableCommands : [])
      .map((c) => ({ name: String((c && c.name) || '').trim(), desc: String((c && c.description) || '').slice(0, 140) }))
      .filter((c) => c.name);
    out.push({ kind: 'acp-comandos', itens: st.comandos });
    return out;
  }
  if (tipo === 'current_mode_update') {
    if (upd.currentModeId) { st.modoAtual = String(upd.currentModeId); out.push({ kind: 'acp-modo', modo: st.modoAtual }); }
    return out;
  }
  return out;
}
/* uma fala que estava chegando fecha antes de um passo: o que ele disser
   depois da ferramenta e' outra fala (igual ao Gemini/Grok por turno) */
function fecharFala(st, out) {
  if (!st.msgId) return;
  out.push({ kind: 'text-final', id: st.msgId, text: st.acc, fecha: true });
  st.msgId = null; st.acc = '';
}

/* Qual opcao responder num pedido de permissao. O protocolo padroniza os tipos
   (allow_once/allow_always/reject_once/reject_always); se um agente inventar
   outro nome, cai no texto. */
function escolherOpcao(options, allow, sempre) {
  const ops = Array.isArray(options) ? options.filter(Boolean) : [];
  const porKind = (k) => ops.find((o) => o.kind === k);
  if (allow) {
    return (sempre && porKind('allow_always')) || porKind('allow_once') || porKind('allow_always')
      || ops.find((o) => /allow|permit|accept|yes|sim/i.test(String(o.kind || '') + ' ' + String(o.name || ''))) || null;
  }
  return porKind('reject_once') || porKind('reject_always')
    || ops.find((o) => /reject|deny|no|n[aã]o/i.test(String(o.kind || '') + ' ' + String(o.name || ''))) || null;
}

/* ---- a chave do Gemini, que o modo --acp nao le sozinho ---- */
function lerChaveGemini(HOME) {
  try {
    const txt = fs.readFileSync(path.join(HOME, '.gemini', '.env'), 'utf8');
    const m = txt.match(/^\s*(?:export\s+)?(?:GEMINI_API_KEY|GOOGLE_API_KEY)\s*=\s*["']?([^"'\r\n]+)["']?\s*$/m);
    return m ? m[1].trim() : '';
  } catch { return ''; }
}

/* ---- a conversa gravada pelo proprio Cockpit ----
   O agente guarda a dele onde quiser (cada um num formato); a tela precisa
   reabrir a conversa depois, entao o Cockpit anota o que passou por aqui, num
   JSONL simples por sessao. Cabecalho na 1a linha; depois uma linha por fala. */
function pastaAcp(pastaDados) { return path.join(pastaDados(), 'acp'); }
function arquivoDaSessao(pastaDados, id) {
  return path.join(pastaAcp(pastaDados), String(id || '').replace(/[^\w.-]/g, '_') + '.jsonl');
}
/* R1-039: antes o catch ficava vazio e a falha de disco (cheio, sem permissao)
   sumia calada -- o historico parecia ok na tela (emit roda antes/fora daqui)
   mas nunca era gravado. aoFalhar e' opcional pra nao quebrar quem ja chama
   anotar(arquivo, obj) direto (ex.: tests/teste-acp.js, tests/teste-acp-ponte.js). */
function anotar(arquivo, obj, aoFalhar) {
  if (!arquivo) return;
  try {
    fs.mkdirSync(path.dirname(arquivo), { recursive: true });
    fs.appendFileSync(arquivo, JSON.stringify({ t: Date.now(), ...obj }) + '\n', 'utf8');
  } catch (e) {
    if (typeof aoFalhar === 'function') { try { aoFalhar(e); } catch {} }
  }
}
function linhasDoTranscrito(bruto) {
  const meta = {};
  const msgs = [];
  for (const linha of String(bruto || '').split('\n')) {
    if (linha.charCodeAt(0) !== 123) continue;
    let d; try { d = JSON.parse(linha); } catch { continue; }
    if (d.cabecalho) { Object.assign(meta, d); continue; }
    if (d.role) msgs.push(d);
  }
  return { meta, msgs };
}
function lerTranscrito(arquivo) {
  try { return linhasDoTranscrito(fs.readFileSync(arquivo, 'utf8')); }
  catch { return { meta: {}, msgs: [] }; }
}
/* pra lista basta o comeco do arquivo (cabecalho + primeira fala sua): ler
   tudo a cada abertura da lateral custaria o tamanho somado das conversas */
const CABECA_LISTA = 64 * 1024;
function lerCabeca(arquivo) {
  let fd = null;
  try {
    fd = fs.openSync(arquivo, 'r');
    const buf = Buffer.alloc(CABECA_LISTA);
    const n = fs.readSync(fd, buf, 0, CABECA_LISTA, 0);
    return buf.slice(0, n).toString('utf8');
  } catch { return ''; } finally { if (fd != null) { try { fs.closeSync(fd); } catch {} } }
}
const cacheLista = new Map();   // arquivo -> { mtime, item }
function listarSessoes(pastaDados) {
  const dir = pastaAcp(pastaDados);
  let nomes = [];
  try { nomes = fs.readdirSync(dir); } catch { return []; }
  const out = [];
  for (const n of nomes) {
    if (!/\.jsonl$/i.test(n)) continue;
    const f = path.join(dir, n);
    let when = 0;
    try { when = fs.statSync(f).mtimeMs; } catch { continue; }
    const guardado = cacheLista.get(f);
    if (guardado && guardado.mtime === when) { if (guardado.item) out.push(guardado.item); continue; }
    const gravado = when;
    when = horaDaUltimaFala(f, gravado);   // 26/09: a última fala ("t"), não a última gravação do arquivo
    let { meta, msgs } = linhasDoTranscrito(lerCabeca(f));
    let primeira = msgs.find((m) => m.role === 'user' && String(m.text || '').trim());
    // 1a fala sua maior que a cabeca (um log colado): le o arquivo inteiro UMA vez
    let tamanho = 0;
    try { tamanho = fs.statSync(f).size; } catch {}
    if (!primeira && tamanho > CABECA_LISTA) { ({ meta, msgs } = lerTranscrito(f)); primeira = msgs.find((m) => m.role === 'user' && String(m.text || '').trim()); }
    const id = meta.id || n.replace(/\.jsonl$/i, '');
    // sessao que nunca recebeu uma fala sua (nas primeiras linhas) nao e' conversa
    const item = primeira ? {
      engine: 'acp', id, file: f, when, entrada: 'cockpit',
      cwd: meta.cwd || '', comando: meta.comando || COMANDO_PADRAO, agente: meta.agente || '',
      title: String(primeira.text).replace(/\s+/g, ' ').trim().slice(0, 120),
    } : null;
    cacheLista.set(f, { mtime: gravado, item });
    if (item) out.push(item);
  }
  if (cacheLista.size > 2000) cacheLista.clear();
  out.sort((a, b) => b.when - a.when);
  return out.slice(0, 300);
}
const MIME_MINI = { ...MIME_IMG, bmp: 'image/bmp', heic: 'image/heic', svg: 'image/svg+xml' };
function anexosDaMensagem(anexos, texto = '', comMini = false) {
  const lista = Array.isArray(anexos) ? anexos : [];
  // Registros anteriores guardavam os caminhos só no texto. Recupera antes
  // de semContexto retirar esse trecho para desenhar o balão.
  const bloco = String(texto).match(/(?:Arquivos que anexei[^\n]*|Arquivos anexados (?:no Mac|pelo usuário)):\r?\n([\s\S]*)$/);
  const caminhos = bloco ? bloco[1].split(/\r?\n/).map(l => l.replace(/^\s*-\s*/, '').trim()).filter(p => path.isAbsolute(p)) : [];
  const vistos = new Set();
  return [...lista, ...caminhos].flatMap(item => {
    const a = typeof item === 'string' ? { path: item } : item;
    if (!a || typeof a.path !== 'string' || !a.path || vistos.has(a.path)) return [];
    vistos.add(a.path);
    const ext = path.extname(a.path).slice(1).toLowerCase();
    const r = { path: a.path, nome: String(a.nome || a.name || path.basename(a.path)), ext };
    if (Number.isFinite(a.bytes)) r.bytes = a.bytes;
    else try { r.bytes = fs.statSync(a.path).size; } catch {}
    if (comMini) {
      if (typeof a.mini === 'string') r.mini = a.mini;
      else if (MIME_MINI[ext]) {
        try {
          if (fs.statSync(a.path).size <= 8 * 1024 * 1024) r.mini = 'data:' + MIME_MINI[ext] + ';base64,' + fs.readFileSync(a.path).toString('base64');
        } catch {}
      }
    }
    return [r];
  });
}
function historicoDaSessao(arquivo, maxMsgs) {
  const { msgs } = lerTranscrito(arquivo);
  const out = [];
  for (const m of msgs) {
    if (m.role === 'user') {
      const attachments = anexosDaMensagem(m.attachments || m.anexos, m.text);
      if (String(m.text || '').trim() || attachments.length) out.push({ role: 'user', text: String(m.text || ''), ...(attachments.length ? { attachments, anexos: attachments } : {}) });
    }
    else if (m.role === 'bot') { if (String(m.text || '').trim()) out.push({ role: 'bot', text: String(m.text) }); }
    else if (m.role === 'tool') out.push({ role: 'tool', name: m.name || 'Ferramenta', arg: String(m.arg || '').slice(0, 120) });
  }
  return out.slice(-(maxMsgs || 60)).map(m => {
    if (!m.attachments?.length) return m;
    const attachments = anexosDaMensagem(m.attachments, '', true);
    return { ...m, attachments, anexos: attachments };
  });
}

/* ======================= o motor de verdade ======================= */
function criarAcp(dep) {
  const { emit, spawnBin, buildEnv, matarProcesso, HOME, pastaDados, aoPedirPermissao, aoCair, aoFimDoTurno } = dep;
  const autoLiberada = dep.autoLiberada || (() => false);
  const paineis = new Map();     // paneId -> st
  const partidas = new Map();
  const encerrando = new Map(); // aguarda o grupo anterior morrer antes de religar
  const iniciando = new Map();   // paneId -> { comando, promessa }: dois Enter durante o "Ligando…" viram UM start

  const escrever = (st, obj) => {
    if (st.invalidado || !st.proc || !st.proc.stdin) return false;
    try { st.proc.stdin.write(JSON.stringify(obj) + '\n'); return true; } catch { return false; }
  };
  function mandar(st, method, params, msTimeout) {
    return new Promise((res, rej) => {
      const id = ++st.rpcId;
      let timer = 0;
      if (msTimeout) {
        timer = setTimeout(() => {
          st.pend.delete(id);
          rej(new Error('o agente não respondeu a "' + method + '" em ' + Math.round(msTimeout / 1000) + 's'));
        }, msTimeout);
      }
      st.pend.set(id, {
        res: (v) => { if (timer) clearTimeout(timer); res(v); },
        rej: (e) => { if (timer) clearTimeout(timer); rej(e); },
      });
      if (!escrever(st, { jsonrpc: '2.0', id, method, params: params || {} })) {
        st.pend.delete(id); if (timer) clearTimeout(timer);
        rej(new Error('o processo do agente não está de pé'));
      }
    });
  }
  const notificar = (st, method, params) => escrever(st, { jsonrpc: '2.0', method, params: params || {} });
  const responder = (st, id, result) => escrever(st, { jsonrpc: '2.0', id, result });
  const responderErro = (st, id, code, message) => escrever(st, { jsonrpc: '2.0', id, error: { code, message } });
  const pararFala = (st) => { if (st.timerFala) { clearTimeout(st.timerFala); st.timerFala = null; } st.ultimaFala = null; };
  // R1-039: 1 aviso por sessao (nao spamar o painel a cada fala que falha gravar)
  const avisarFalhaDeGravar = (st) => (e) => {
    if (st.avisouErroGravar) return;
    st.avisouErroGravar = true;
    emit(st.paneId, 'note', { text: 'Não consegui salvar esta mensagem no Mac: ' + e.message, error: true });
  };

  /* fala com freio: no maximo 10 desenhos por segundo, e o fecho sai na hora */
  function despachar(st, ev) {
    const { kind, ...data } = ev;
    if (kind === 'text-final') {
      if (ev.fecha) {
        pararFala(st);
        emit(st.paneId, 'text-final', { id: ev.id, text: ev.text });
        anotar(st.arquivo, { role: 'bot', text: ev.text }, avisarFalhaDeGravar(st));
        return;
      }
      st.ultimaFala = { id: ev.id, text: ev.text };
      if (st.timerFala) return;
      st.timerFala = setTimeout(() => {
        st.timerFala = null;
        if (st.ultimaFala) emit(st.paneId, 'text-final', st.ultimaFala);
      }, 100);
      return;
    }
    if (kind === 'tool-start') anotar(st.arquivo, { role: 'tool', name: data.name, arg: data.arg }, avisarFalhaDeGravar(st));
    emit(st.paneId, kind, data);
  }

  function tratarPermissao(st, m) {
    if (st.cancelando) return responder(st, m.id, { outcome: { outcome: 'cancelled' } });   // spec: cancelou, tudo pendente e' cancelled
    const p = m.params || {};
    const tc = p.toolCall || {};
    const opcoes = Array.isArray(p.options) ? p.options : [];
    // o pedido pode vir so' com o toolCallId: o resto ja veio no tool_call
    const antes = st.ferramentas.get(String(tc.toolCallId || '')) || {};
    const passo = passoDaFerramenta({ ...(antes.bruto || {}), ...tc });
    const c = conteudoDaFerramenta(tc.content);
    const mudanca = c.mudanca || antes.mudanca || null;
    const chave = chaveDePermissao(passo);
    const rotulo = rotuloDoPasso(passo);
    const porBypass = st.approval === 'bypass';
    if (porBypass || autoLiberada(st.paneId, chave)) {
      // no bypass, allow_always poupa idas e vindas; liberado por "sempre
      // permitir", allow_once - cada chamada volta aqui e deixa rastro na auditoria
      const op = escolherOpcao(opcoes, true, porBypass);
      if (op) {
        responder(st, m.id, { outcome: { outcome: 'selected', optionId: op.optionId } });
        if (!porBypass) emit(st.paneId, 'auto-liberado', { tool: rotulo, arg: passo.arg });
        return;
      }
    }
    st.pedidos.set(m.id, { opcoes });
    aoPedirPermissao(st.paneId, m.id, {
      title: (st.info.title || st.info.name || 'O agente') + ' quer: ' + (passo.titulo || rotulo),
      detail: passo.arg, tool: chave, rotulo, mudanca,
      // o cartao so mostra "Sempre permitir" quando o agente oferece essa opcao
      sempre: opcoes.some((o) => o && o.kind === 'allow_always'),
    });
  }

  function pedidoDoAgente(st, m) {
    const p = m.params || {};
    const geracao = st.geracao;
    const ativo = () => paineis.get(st.paneId) === st && !st.invalidado && !st.cancelando && st.geracao === geracao;
    const conferir = () => { if (!ativo()) throw new Error('pedido cancelado'); };
    if (!ativo()) {
      if (m.method === 'session/request_permission') return responder(st, m.id, { outcome: { outcome: 'cancelled' } });
      return responderErro(st, m.id, -32800, 'pedido cancelado');
    }
    if (p.sessionId && st.sessionId && String(p.sessionId) !== st.sessionId) {
      return responderErro(st, m.id, -32602, 'sessão desconhecida');
    }
    if (m.method === 'session/request_permission') return tratarPermissao(st, m);
    // caminho relativo resolve na pasta do PAINEL, nunca na do Electron
    const caminho = (s) => { const t = String(s || ''); return path.isAbsolute(t) ? t : path.resolve(st.cwd, t); };
    if (m.method === 'fs/read_text_file') {
      const alvo = caminho(p.path);
      fs.promises.stat(alvo)
        .then((s) => {
          conferir();
          if (s.size > LIM_LEITURA) throw Object.assign(new Error('arquivo acima de 20 MB'), { code: 'EFBIG' });
          return fs.promises.readFile(alvo, 'utf8');
        })
        .then((txt) => {
          conferir();
          if (p.line != null || p.limit != null) {
            const linhas = txt.split('\n');
            const de = Math.max(0, (Number(p.line) || 1) - 1);
            const ate = p.limit != null ? de + Number(p.limit) : linhas.length;
            txt = linhas.slice(de, ate).join('\n');
          }
          responder(st, m.id, { content: txt });
        })
        .catch((e) => {
          if (!ativo()) return;
          // arquivo que nao existe = conteudo vazio (armadilha 4 do cabecalho)
          if (e && e.code === 'ENOENT') return responder(st, m.id, { content: '' });
          responderErro(st, m.id, -32603, 'não consegui ler: ' + (e && e.message || e));
        });
      return;
    }
    if (m.method === 'fs/write_text_file') {
      const alvo = caminho(p.path);
      fs.promises.mkdir(path.dirname(alvo), { recursive: true })
        .then(() => { conferir(); return fs.promises.writeFile(alvo, String(p.content == null ? '' : p.content), 'utf8'); })
        .then(() => { if (ativo()) responder(st, m.id, {}); })
        .catch((e) => { if (ativo()) responderErro(st, m.id, -32603, 'não consegui escrever: ' + (e && e.message || e)); });
      return;
    }
    // terminal/* e o que mais vier: o Cockpit nao anunciou, o agente usa o dele
    return responderErro(st, m.id, -32601, 'método não suportado pelo Cockpit: ' + m.method);
  }

  function tratarLinha(st, linha) {
    if (st.invalidado || paineis.get(st.paneId) !== st) return;
    let m; try { m = JSON.parse(linha); } catch { return; }   // banner/aviso fora do protocolo
    if (!m || typeof m !== 'object') return;
    if (m.id !== undefined && m.method === undefined) {
      const q = st.pend.get(m.id);
      if (!q) return;
      st.pend.delete(m.id);
      if (m.error) q.rej(new Error(String((m.error && m.error.message) || 'erro do agente') + (m.error && m.error.code != null ? ' (' + m.error.code + ')' : '')));
      else q.res(m.result);
      return;
    }
    if (!m.method) return;
    if (m.id !== undefined) return pedidoDoAgente(st, m);
    if (m.method === 'session/update') {
      if (st.cancelando) return;
      const p = m.params || {};
      if (st.sessionId && p.sessionId && String(p.sessionId) !== st.sessionId) return;
      for (const ev of traduzirUpdate(st, p.update)) despachar(st, ev);
    }
  }

  function cancelarPedidos(st) {
    for (const [id] of [...st.pedidos]) { responder(st, id, { outcome: { outcome: 'cancelled' } }); st.pedidos.delete(id); }
  }

  /* o modo do agente e' aplicado sem segurar a sessao: agente que nao responde
     ao set_mode nao pode atrasar o painel em 30s (o current_mode_update
     corrige o modoAtual depois, se vier) */
  function aplicarModo(st) {
    if (!st.modos.length || !st.sessionId) return;
    const alvo = modoDoAgente(st.approval, st.modos);
    if (!alvo || alvo === st.modoAtual) return;
    mandar(st, 'session/set_mode', { sessionId: st.sessionId, modeId: alvo }, 15000)
      .then(() => { if (paineis.get(st.paneId) !== st) return; st.modoAtual = alvo; emit(st.paneId, 'acp-modo', { modo: alvo }); })
      .catch(() => {});
  }

  function motivoDaQueda(st, codigo) {
    const s = String(st.erro || '').replace(/\x1b\[[0-9;]*m/g, '');
    const linha = s.split('\n').map((l) => l.trim())
      .filter((l) => l && !/^\s*at /.test(l) && !/Skipping project agents/i.test(l) && !/YOLO mode/i.test(l))
      .slice(-2).join(' · ');
    return linha ? linha.slice(0, 240) : ('o agente saiu (código ' + codigo + ')');
  }

  /* derruba ESTE st, nunca o que veio depois dele no mesmo painel */
  function pararSt(st) {
    if (paineis.get(st.paneId) !== st) return;
    parar(st.paneId);
  }

  function start(paneId, opts) {
    const o = opts || {};
    const comando = String(o.comando || COMANDO_PADRAO).trim();
    /* dois Enter durante o "Ligando o ACP…" (10-90s) chegavam como dois starts:
       o catch do primeiro matava o processo do segundo. Agora um start IGUAL
       em curso e' reaproveitado. Igual = mesmo comando, pasta, modo e retomada;
       mudou qualquer um, e' outro start de verdade (e derruba o em curso). */
    const chave = JSON.stringify([comando, o.cwd || '', o.approval || '', o.resumeId || '', o.authMethod || '', o.chaveApi === true]);
    const emCurso = iniciando.get(paneId);
    if (emCurso && emCurso.chave === chave) return emCurso.promessa;
    const promessa = startDeVerdade(paneId, comando, o);
    iniciando.set(paneId, { chave, promessa });
    // so' solta a entrada se ainda for ESTA promessa: a rejeicao de um start
    // velho (morto pelo novo) chega depois e apagava a entrada do novo
    const solta = () => { const g = iniciando.get(paneId); if (g && g.promessa === promessa) iniciando.delete(paneId); };
    promessa.then(solta, solta);
    return promessa;
  }

  async function startDeVerdade(paneId, comando, opts) {
    const { bin, args } = comandoEmPartes(comando);
    if (!bin) throw new Error('O comando do agente ACP está vazio. Escolha um no menu do modelo.');
    const partida = {}; partidas.set(paneId, partida);
    if (paineis.has(paneId) || encerrando.has(paneId)) await parar(paneId, true);
    else parar(paneId, true);
    if (partidas.get(paneId) !== partida) throw new Error('início do agente cancelado');
    const st = {
      paneId, comando, geracao: 0, invalidado: false, cwd: opts.cwd || HOME, approval: opts.approval || 'manual',
      proc: null, buf: '', erro: '', rpcId: 0, pend: new Map(), pedidos: new Map(),
      sessionId: '', nova: false, caps: {}, info: {}, modos: [], modoAtual: '', modelos: [], modeloAtual: '', comandos: [],
      ferramentas: new Map(), msgId: null, acc: '', seq: 0, carregando: false, ocupado: false, cancelando: false,
      arquivo: '', timerFala: null, timerFila: null, ultimaFala: null, parandoDeProposito: false, contextoAntigo: null,
      avisouErroGravar: false, // R1-039: um aviso de "falhou gravar" por sessao, nao um por fala
    };
    paineis.set(paneId, st);
    try {
      await subir(st, bin, args, opts);
      return true;
    } catch (e) {
      pararSt(st);   // por identidade: se outro start ja assumiu o painel, ele fica
      throw e;
    }
  }

  async function subir(st, bin, args, opts) {
    const paneId = st.paneId;
    const env = opts.authMethod === 'cached_token'
      ? require('./contas-cli').ambienteSemChaves('grok', buildEnv()) : buildEnv();
    // a chave vale pro comando INTEIRO ("npx @google/gemini-cli --acp" tambem e' gemini)
    if (/gemini/i.test(st.comando) && !env.GEMINI_API_KEY && !env.GOOGLE_API_KEY) {
      const chave = lerChaveGemini(HOME);
      if (chave) env.GEMINI_API_KEY = chave;
    }
    let proc;
    try { proc = spawnBin(bin, args, { cwd: st.cwd, env, detached: (typeof process !== 'undefined' ? process : require('process')).platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] }); }
    catch (e) { throw new Error('Não consegui rodar "' + st.comando + '": ' + (e && e.message || e)); }
    st.proc = proc;
    proc.stdin.on('error', () => {});
    /* a resposta chega em pedacos, e letra com acento ocupa 2 bytes: se o corte
       cair no meio dela, virar texto pedaco a pedaco perde a letra para sempre
       ("configuracao" com cedilha virava "configura??ao"). O decoder guarda o
       resto do byte e so' entrega a letra quando ela fecha - igual cli-motors.js */
    const decoder = new StringDecoder('utf8');
    proc.stdout.on('data', (chunk) => {
      if (st.invalidado || paineis.get(paneId) !== st) return;
      // o que ja estava no buffer foi varrido e nao tinha '\n' (o laco abaixo so' para quando
      // nao sobra quebra): a busca comeca no pedaco NOVO. Refazer o indexOf do zero a cada
      // pedaco deixava uma linha longa quadratica (80MB = bilhoes de comparacoes no processo principal).
      const jaVarrido = st.buf.length;
      st.buf += decoder.write(chunk);
      // R3-046: uma linha de protocolo sem '\n' (ex.: imagem grande em base64 numa
      // unica mensagem) crescia pra sempre - cada pedaco novo refazia o indexOf sobre
      // um buffer cada vez maior e travava o processo principal do Electron inteiro.
      // Sem '\n' ainda, nao da pra descartar so' o excesso (quebraria o JSON-RPC no
      // meio): mata o processo e deixa o proc.on('close', caiu) avisar como qualquer
      // outra queda.
      if (st.buf.length > LIM_BUF_SEM_QUEBRA) {
        st.erro = 'resposta do agente grande demais sem quebra de linha';
        st.buf = '';
        matarProcesso(proc);
        return;
      }
      let i = st.buf.indexOf('\n', jaVarrido);
      if (i < 0) return;
      for (; i >= 0; i = st.buf.indexOf('\n')) {
        const linha = st.buf.slice(0, i).trim(); st.buf = st.buf.slice(i + 1);
        if (!linha) continue;
        // formato inesperado de um agente novo nao pode derrubar o app inteiro
        try { tratarLinha(st, linha); } catch (e) { st.erro = (st.erro + ' ' + (e && e.message || e)).slice(-1500); }
      }
    });
    proc.stderr.on('data', (d) => { st.erro = (st.erro + d.toString('utf8')).slice(-1500); });
    const caiu = (codigo) => {
      const motivo = motivoDaQueda(st, codigo);
      // escrever num stdin morto nao lanca: sem isto um mandar() novo esperava o
      // prazo inteiro (ate' 240s) em silencio, em vez de falhar com o motivo
      st.proc = null;
      for (const [, q] of [...st.pend]) q.rej(new Error(motivo));   // o start lanca com o stderr de verdade
      st.pend.clear();
      pararFala(st);
      if (paineis.get(paneId) !== st) return;
      paineis.delete(paneId);
      // sem sessao ainda, nao e' queda de motor: e' falha de start, e quem
      // avisa e' o proprio start (senao saiam tres avisos, um deles mentindo
      // "a proxima mensagem religa")
      if (st.parandoDeProposito || !st.sessionId) return;
      st.pedidos.clear();
      try { aoCair && aoCair(paneId); } catch {}
      emit(paneId, 'engine-down', { motivo, codigo });
    };
    proc.on('close', caiu);
    proc.on('error', (e) => { st.erro += ' ' + (e && e.message || e); caiu(-1); });

    // handshake
    const init = await mandar(st, 'initialize', {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: false },
      clientInfo: { name: 'cockpit', title: 'Cockpit', version: '1.0' },
    }, 120000);
    st.caps = (init && init.agentCapabilities) || {};
    st.info = (init && init.agentInfo) || {};
    const metodosAuth = (init && Array.isArray(init.authMethods)) ? init.authMethods : [];
    // Grok exige autenticar explicitamente mesmo quando o login já está salvo.
    // Só o método solicitado pelo painel, sem migrar para chave paga automaticamente.
    if (opts.authMethod) {
      if (!metodosAuth.some(m => m.id === opts.authMethod)) throw new Error('Entre no Grok com "grok login" pelo terminal antes de abrir este chat.');
      await mandar(st, 'authenticate', { methodId: opts.authMethod, _meta: { headless: true } }, 60000);
    }
    const queria = opts.resumeId ? String(opts.resumeId) : '';

    const abrirSessao = async () => {
      let r = null;
      let motivoLoad = '';
      if (queria && st.caps.loadSession) {
        st.carregando = true;
        try {
          r = await mandar(st, 'session/load', { sessionId: queria, cwd: st.cwd, mcpServers: [] }, 300000);
          st.sessionId = queria;
        } catch (e) {
          if (!st.proc) throw e;   // o agente MORREU no load: nao adianta tentar sessao nova nele
          r = null; motivoLoad = String(e && e.message || e);
        }
        finally { st.carregando = false; st.msgId = null; st.acc = ''; }
      }
      if (!st.sessionId) {
        r = await mandar(st, 'session/new', { cwd: st.cwd, mcpServers: [] }, 240000);
        st.sessionId = String((r && r.sessionId) || '');
        if (!st.sessionId) throw new Error('o agente não devolveu o id da sessão');
        st.nova = true;
      }
      return { r: r || {}, motivoLoad };
    };
    let aberta;
    try { aberta = await abrirSessao(); }
    catch (e) {
      const msg = String(e && e.message || e);
      // sem login: tenta o metodo por chave se houver chave no ambiente; senao explica
      const porChave = metodosAuth.find((a) => /api[-_]?key/i.test(String(a.id || '')));
      const temChave = !!(env.GEMINI_API_KEY || env.GOOGLE_API_KEY || env.ANTHROPIC_API_KEY || env.OPENAI_API_KEY);
      /* chave de API e' PAGA por token. Entrar por ela sozinho fazia o gasto cair
         na fatura sem ninguem ver, achando que era a cota da conta. Agora so' entra
         se foi pedido: opts.chaveApi (opcao do painel) ou COCKPIT_ACP_CHAVE_API=1
         no ambiente. E quando entra, avisa na tela que este uso e' cobrado. */
      const pediuChaveApi = opts.chaveApi === true || /^(1|true|sim)$/i.test(String(env.COCKPIT_ACP_CHAVE_API || ''));
      if (!opts.authMethod && /auth/i.test(msg) && porChave && temChave && pediuChaveApi) {
        await mandar(st, 'authenticate', { methodId: porChave.id }, 60000);
        aberta = await abrirSessao();
        emit(paneId, 'note', { text: 'Entrei com a chave de API (' + (porChave.name || porChave.id) + '). Este uso é cobrado por token na fatura da chave, não sai da cota da conta.', error: true });
      } else if (/auth/i.test(msg)) {
        const como = metodosAuth.map((a) => a.name || a.id).filter(Boolean).join(' / ');
        throw new Error('O agente pede login' + (como ? ' (' + como + ')' : '') + '. Rode "' + bin + '" uma vez pelo terminal, entre na conta e volte aqui.'
          + (porChave && temChave ? ' Para entrar pela chave de API (uso cobrado por token), ligue COCKPIT_ACP_CHAVE_API=1.' : ''));
      } else throw e;
    }
    const r = aberta.r;
    const modos = r.modes && Array.isArray(r.modes.availableModes) ? r.modes.availableModes : [];
    st.modos = modos.map((m) => ({ id: String(m.id || ''), nome: String(m.name || m.id || ''), desc: String(m.description || '') })).filter((m) => m.id);
    st.modoAtual = (r.modes && r.modes.currentModeId) ? String(r.modes.currentModeId) : '';
    const modelos = r.models && Array.isArray(r.models.availableModels) ? r.models.availableModels : [];
    st.modelos = modelos.map((m) => ({ id: String(m.modelId || m.id || ''), nome: String(m.name || m.modelId || ''), desc: String(m.description || '') })).filter((m) => m.id);
    st.modeloAtual = (r.models && r.models.currentModelId) ? String(r.models.currentModelId) : '';

    st.arquivo = arquivoDaSessao(pastaDados, st.sessionId);
    // cabecalho: sessao nova, ou retomada cujo arquivo sumiu (sem ele a lista
    // mostraria comando errado e pasta vazia)
    if (st.nova || !fs.existsSync(st.arquivo)) {
      anotar(st.arquivo, { cabecalho: 1, id: st.sessionId, comando: st.comando, cwd: st.cwd, criado: Date.now(), agente: st.info.title || st.info.name || bin }, avisarFalhaDeGravar(st));
    }
    const retomou = !!(queria && st.sessionId === queria);
    if (queria && !retomou) {
      /* a tela ja desenhou o historico da conversa antiga, mas o agente nao
         tem contexto nenhum dela: avisa, e leva as ultimas falas junto na
         primeira mensagem (mesma ideia do passarContexto da troca de motor) */
      st.contextoAntigo = historicoDaSessao(arquivoDaSessao(pastaDados, queria), 20);
      if (!st.contextoAntigo.length) st.contextoAntigo = null;
      const porque = !st.caps.loadSession ? 'este agente não retoma conversa antiga' : ('o agente não achou a conversa' + (aberta.motivoLoad ? ' (' + aberta.motivoLoad.slice(0, 120) + ')' : ''));
      emit(paneId, 'note', { text: 'Comecei uma conversa nova: ' + porque + '. ' + (st.contextoAntigo
        ? 'O que está acima é só o registro — mando um resumo dele junto com a sua próxima mensagem.'
        : 'Não achei o registro da conversa antiga neste computador; ele começa sem contexto.'), error: true });
    }
    emit(paneId, 'sessao', { id: st.sessionId, file: st.arquivo });
    const pc = st.caps.promptCapabilities || {};
    emit(paneId, 'acp-info', {
      agente: st.info.title || st.info.name || bin, versao: st.info.version || '',
      modos: st.modos, modoAtual: st.modoAtual, modelos: st.modelos, modeloAtual: st.modeloAtual,
      comandos: st.comandos, retomou, imagem: !!pc.image,
    });
    aplicarModo(st);
  }

  function fimDoTurno(st, motivo) {
    const cancelado = st.cancelando || st.parandoDeProposito || motivo === 'cancelled';
    // R2-006: turno fechou por qualquer caminho, o watchdog do cancelamento nao serve mais
    if (st.timerCancelamento) { clearTimeout(st.timerCancelamento); st.timerCancelamento = null; }
    const out = [];
    fecharFala(st, out);
    for (const ev of out) despachar(st, ev);
    st.ocupado = false;
    st.cancelando = false;
    st.ferramentas.clear();
    cancelarPedidos(st);
    // A mensagem continua na fila até poder sair. Tirar antes dos 50 ms perdia
    // a mensagem se chegasse outra nesse intervalo, além de inverter a ordem.
    if (st.fila && st.fila.length && !st.timerFila) {
      st.timerFila = setTimeout(() => {
        st.timerFila = null;
        if (paineis.get(st.paneId) !== st || st.ocupado) return;
        const prox = st.fila.shift();
        if (prox) enviar(st.paneId, prox.texto, prox.anexos);
      }, 50);
    }
    // pedido de permissao que sobrou nao vale mais: o main tira o cartao da tela
    try { aoFimDoTurno && aoFimDoTurno(st.paneId); } catch {}
    if (motivo === 'refusal') emit(st.paneId, 'note', { text: 'O agente recusou continuar este pedido.', error: true });
    else if (motivo === 'max_turn_requests') emit(st.paneId, 'note', { text: 'O agente parou no teto de passos do turno. Mande "continue" pra seguir.' });
    else if (motivo === 'max_tokens') emit(st.paneId, 'note', { text: 'A resposta bateu no teto de tamanho. Mande "continue" pra seguir.' });
    emit(st.paneId, 'turn-end', { turnId: st.somTurno, resultado: cancelado ? 'cancelado' : motivo === 'end_turn' ? 'sucesso' : 'erro' });
  }

  function textoDoContextoAntigo(msgs) {
    const linhas = [];
    for (const m of (msgs || [])) {
      if (m.role === 'user') linhas.push('### Você:\n' + m.text);
      else if (m.role === 'bot') linhas.push('### Assistente:\n' + m.text);
    }
    if (!linhas.length) return '';
    return 'Estou continuando uma conversa anterior que você não tem mais na memória. Abaixo estão as últimas falas dela; '
      + 'assuma o trabalho daqui em diante, sem recomeçar do zero.\n\n--- conversa até aqui ---\n'
      + linhas.join('\n\n').slice(0, 14000) + '\n--- fim da conversa anterior ---\n\nAgora, o novo pedido:\n';
  }

  function enviar(paneId, texto, anexos) {
    const st = paineis.get(paneId);
    if (!st || st.invalidado || st.cancelando || !st.proc || !st.sessionId) return false;
    if (st.ocupado || st.timerFila) {
      // ocupado NAO e' morto: a tela traduzia o false como "conexao caiu" e
      // religava por cima do turno. Vai pra fila e sai no fim do turno.
      (st.fila = st.fila || []).push({ texto, anexos: (anexos || []).slice() });
      return true;
    }
    const pc = st.caps.promptCapabilities || {};
    const prompt = [];
    let t = String(texto == null ? '' : texto);
    const sobraram = [];
    const attachments = anexosDaMensagem(anexos, t);
    for (const { path: f } of attachments) {
      const mime = MIME_IMG[path.extname(String(f)).slice(1).toLowerCase()];
      if (!mime || !pc.image) { sobraram.push(f); continue; }
      try {
        if (fs.statSync(f).size > LIM_IMG) { sobraram.push(f); continue; }
        prompt.push({ type: 'image', data: fs.readFileSync(f).toString('base64'), mimeType: mime });
      } catch { sobraram.push(f); }
    }
    if (sobraram.length && !t.includes('Arquivos que anexei')) {
      t += '\n\nArquivos que anexei (abra cada um antes de responder):\n' + sobraram.map((f) => '- ' + f).join('\n');
    }
    // grava o que VOCE escreveu; o prefixo de contexto vai so' pro agente
    // (gravado, virava o titulo da conversa e um balao seu de 14 KB ao reabrir)
    anotar(st.arquivo, { role: 'user', text: t, ...(attachments.length ? { attachments } : {}), ...(st.contextoAntigo ? { comContexto: true } : {}) }, avisarFalhaDeGravar(st));
    if (st.contextoAntigo) { t = textoDoContextoAntigo(st.contextoAntigo) + t; st.contextoAntigo = null; }
    prompt.push({ type: 'text', text: t });
    st.geracao++;
    st.ocupado = true; st.cancelando = false; st.ferramentas.clear(); st.msgId = null; st.acc = '';
    st.somTurno = crypto.randomUUID();
    emit(paneId, 'busy', { turnId: st.somTurno });
    // sem prazo: um turno de agente pode levar meia hora, e quem encerra e' o
    // proprio agente (ou o botao de parar, via session/cancel)
    const promessaDoPrompt = mandar(st, 'session/prompt', { sessionId: st.sessionId, prompt }, 0);
    // R2-006: guarda o id deste rpc pra interromper() poder dar um prazo SO' ao cancelamento
    st.promptRpcId = st.rpcId;
    promessaDoPrompt
      .then((r) => { if (paineis.get(paneId) === st) fimDoTurno(st, r && r.stopReason); })
      .catch((e) => {
        if (paineis.get(paneId) !== st) return;
        if (!st.parandoDeProposito) emit(paneId, 'note', { text: 'O agente falhou neste turno: ' + String(e && e.message || e).slice(0, 240), error: true });
        fimDoTurno(st, 'erro');
      });
    return true;
  }

  // R2-006: quanto tempo esperar o agente ACP honrar o session/cancel antes de
  // forcar o fecho do turno (agente que ignora o cancel nao pode travar o Parar pra sempre)
  const PRAZO_CANCELAMENTO_MS = 7500;

  function interromper(paneId) {
    const st = paineis.get(paneId);
    if (!st || !st.sessionId) return false;
    // spec: ao cancelar, o cliente responde 'cancelled' a TODO pedido de
    // permissao pendente - agora, nao quando o prompt voltar (agente que espera
    // a resposta pra devolver o prompt travaria pra sempre)
    st.cancelando = true; st.geracao++;
    cancelarPedidos(st);   // primeiro destrava quem esta' esperando a permissao...
    notificar(st, 'session/cancel', { sessionId: st.sessionId });   // ...depois avisa que o turno acabou
    // R2-006: se o agente nao responder ao cancel, o proprio session/prompt (msTimeout=0)
    // nunca teria timer de seguranca - sem isso o botao Parar fica preso pra sempre
    if (st.timerCancelamento) clearTimeout(st.timerCancelamento);
    st.timerCancelamento = setTimeout(() => {
      st.timerCancelamento = null;
      if (paineis.get(paneId) !== st) return;
      const pendente = st.promptRpcId != null ? st.pend.get(st.promptRpcId) : null;
      if (!pendente) return;   // ja respondeu (ou ja fechou por outro caminho)
      // Sem confirmação de fim, este processo nunca pode receber outro turno.
      // Invalida callbacks antes de esperar a morte de toda a árvore.
      const motivo = 'o agente não respondeu ao cancelamento; o processo foi encerrado';
      const out = []; fecharFala(st, out); for (const ev of out) despachar(st, ev);
      Promise.resolve(parar(paneId)).then(() => {
        if (paineis.has(paneId)) return; // outro start já assumiu a tela
        try { aoCair && aoCair(paneId); } catch {}
        emit(paneId, 'engine-down', { motivo, codigo: null });
        emit(paneId, 'turn-end', {});
      });
    }, PRAZO_CANCELAMENTO_MS);
    try { aoFimDoTurno && aoFimDoTurno(paneId); } catch {}
    return true;
  }

  function parar(paneId, manterInicio = false) {
    if (!manterInicio) partidas.delete(paneId);
    iniciando.delete(paneId);
    const st = paineis.get(paneId);
    if (!st) return encerrando.get(paneId) || Promise.resolve();
    st.parandoDeProposito = true;
    pararFala(st);
    if (st.timerFila) { clearTimeout(st.timerFila); st.timerFila = null; }
    if (st.timerCancelamento) { clearTimeout(st.timerCancelamento); st.timerCancelamento = null; }   // R2-006
    st.fila = [];
    cancelarPedidos(st);
    st.invalidado = true; st.geracao++;
    for (const [, q] of [...st.pend]) q.rej(new Error('painel parado'));
    st.pend.clear();
    // R3-009: devolve a Promise do matarProcesso (so' resolve quando o processo morre de
    // verdade), pra shutdown() esperar em vez de deixar o Electron fechar antes da hora
    let espera = Promise.resolve();
    if (st.proc) { try { st.proc.stdout.removeAllListeners('data'); } catch {} espera = matarProcesso(st.proc); st.proc = null; }
    paineis.delete(paneId);
    const fim = Promise.resolve(espera);
    encerrando.set(paneId, fim);
    fim.finally(() => { if (encerrando.get(paneId) === fim) encerrando.delete(paneId); });
    return fim;
  }

  // sempre: o "Sempre permitir" do cartao escolhe o allow_always do proprio agente
  function responderPermissao(paneId, rpcId, allow, sempre) {
    const st = paineis.get(paneId);
    if (!st) return false;
    const pedido = st.pedidos.get(rpcId);
    if (!pedido) return false;
    st.pedidos.delete(rpcId);
    if (allow == null) return responder(st, rpcId, { outcome: { outcome: 'cancelled' } });
    const op = escolherOpcao(pedido.opcoes, !!allow, !!allow && sempre === true);
    if (!op) return responder(st, rpcId, { outcome: { outcome: 'cancelled' } });
    return responder(st, rpcId, { outcome: { outcome: 'selected', optionId: op.optionId } });
  }

  async function setModelo(paneId, modelId) {
    const st = paineis.get(paneId);
    if (!st || !st.sessionId) return { error: 'o agente não está ligado' };
    try {
      await mandar(st, 'session/set_model', { sessionId: st.sessionId, modelId: String(modelId) }, 30000);
      st.modeloAtual = String(modelId);
      return { ok: true };
    } catch (e) { return { error: 'este agente não deixa trocar o modelo por aqui (' + String(e && e.message || e).slice(0, 120) + ')' }; }
  }

  /* comandos que o agente DESTE painel anunciou (available_commands_update) */
  function comandos(paneId) {
    const st = paneId ? paineis.get(paneId) : null;
    return st ? (st.comandos || []).slice() : [];
  }

  return {
    start, enviar, interromper, parar, responderPermissao, setModelo, comandos,
    trabalhando: () => [...paineis.values()].filter(st => st.ocupado).length,
    // R3-010: pane:estado (reconexao do celular) so enxergava Claude/Codex; sem isto um
    // turno de ACP/Grok em andamento era relido como "terminou" ao reconectar
    ocupado: paneId => !!paineis.get(paneId)?.ocupado,
    vivo: paneId => !!paineis.get(paneId)?.proc,
    // R3-009: shutdown() precisa esperar o kill de verdade, nao so' disparar e seguir
    // Um start pode estar esperando a limpeza do grupo anterior, sem painel
    // vivo ainda. Invalida também essas partidas antes de esperar os kills.
    fechar: () => Promise.all([...new Set([...partidas.keys(), ...paineis.keys(), ...encerrando.keys()])].map(id => parar(id))),
    sessoes: () => listarSessoes(pastaDados),
    historico: (id, file, max) => historicoDaSessao(file && fs.existsSync(file) ? file : arquivoDaSessao(pastaDados, id), max || 60),
    arquivoDe: (id) => arquivoDaSessao(pastaDados, id),
  };
}

module.exports = {
  criarAcp, traduzirUpdate, comandoEmPartes, modoDoAgente, escolherOpcao, passoDaFerramenta, chaveDePermissao,
  conteudoDaFerramenta, lerChaveGemini, listarSessoes, historicoDaSessao, arquivoDaSessao, anotar,
  COMANDO_PADRAO, MODOS_EQUIVALENTES,
};
