'use strict';

/* Jus IA (Jusbrasil) dentro do Cockpit — 05/11/2026.
   A Jus IA não tem API: ela só existe no site, com o login da conta. Então o Cockpit fala com ela
   do mesmo jeito que o site fala: o chat do site manda a pergunta para
   POST https://ia.jusbrasil.com.br/web/wingman/api/jusia/stream e recebe a resposta aos pedaços.
   Esta ponte é um servidorzinho local (127.0.0.1) que finge ser a Anthropic: o motor é o Claude
   Code de sempre (mesma tela, mesmo histórico), só que cada pergunta vai para a Jus IA.
   - O login: cookies do site guardados em ~/.cockpit/jusia-sessao.json (só o dono lê).
     Vencido, o ~/.cockpit/jusia-renovar.py relê do Chrome da conta e tenta de novo, sozinho.
   - A memória: cada conversa do Cockpit vira UMA conversa da Jus IA (ela guarda o histórico do
     lado dela). O mapa fica em ~/.cockpit/jusia-conversas.json.
   - A Jus IA não usa as ferramentas do Mac (ler arquivo, terminal): ela só conversa. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORTA = 20131;
const SITE = 'https://ia.jusbrasil.com.br';
const MODELO = 'jusia';
const UA_PADRAO = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36';
// o que o site manda junto com a pergunta (copiado do chat do site em 05/11)
const FLAGS = { durable_lead: 'chat_events', tool_suspend: 'pesquisaLight', initial_profile_import: true,
  prompt_injection_input_block: true, attachment_catalog_limit: '20', consulta_parte_dossie: true, consulta_parte: true,
  peca_skill: 'OFF', paste_as_document: '50000', pesquisa_light: true, pesquisa_elite: true };
const FONTES = { sourceSelect: { jurisprudence: true, doctrine: true, law: true, web: true } };

const idCurto = (n = 16) => {
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const b = crypto.randomBytes(n);
  let s = '';
  for (let i = 0; i < n; i++) s += abc[b[i] % abc.length];
  return s;
};

const desescapar = (s) => String(s || '').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');

/* As citações chegam como <mention-inline ...><span data-source="{...}"></span></mention-inline>.
   No Cockpit viram link normal: [Art. 42 da Lei 9.099](https://www.jusbrasil.com.br/topicos/...). */
function citacaoEmLink(tag) {
  let titulo = '', url = '';
  const ds = tag.match(/data-source="([^"]*)"/);
  if (ds) { try { const j = JSON.parse(desescapar(ds[1])); titulo = j.title || ''; url = j.url || ''; } catch {} }
  if (!url) { const r = tag.match(/data-inline-ref="([^"]*)"/); if (r) url = desescapar(r[1]); }
  if (!url) return '';
  return ' [' + (titulo || 'fonte').replace(/[[\]]/g, '') + '](' + url + ')';
}
const ABRE = '<mention-inline', FECHA = '</mention-inline>';
/* o texto chega picado: a marca da citação pode vir partida em dois pedaços. Guarda o pedaço
   incompleto e solta só o que já dá para mostrar. */
function criarLimpador() {
  let pend = '', ultimo = ' ';
  const soltar = (fim) => {
    let saida = '';
    for (;;) {
      const i = pend.indexOf(ABRE);
      if (i < 0) {
        if (fim) { saida += pend; pend = ''; break; }
        // segura um possível começo de marca no fim ("<men…")
        const lt = pend.lastIndexOf('<');
        if (lt >= 0 && ABRE.startsWith(pend.slice(lt))) { saida += pend.slice(0, lt); pend = pend.slice(lt); }
        else { saida += pend; pend = ''; }
        break;
      }
      saida += pend.slice(0, i);
      const j = pend.indexOf(FECHA, i);
      if (j < 0) { pend = pend.slice(i); if (fim) { pend = ''; } break; }
      const link = citacaoEmLink(pend.slice(i, j + FECHA.length));
      const antes = (saida || ultimo).slice(-1);
      saida += /\s/.test(antes) ? link.trimStart() : link;
      pend = pend.slice(j + FECHA.length);
    }
    if (saida) ultimo = saida.slice(-1);
    return saida;
  };
  return { por: (t) => { pend += t; return soltar(false); }, fim: () => soltar(true) };
}

// texto do que a pessoa escreveu, sem os avisos que o Claude Code mete no meio (<system-reminder>)
function textoDe(conteudo) {
  const partes = typeof conteudo === 'string' ? [{ type: 'text', text: conteudo }] : Array.isArray(conteudo) ? conteudo : [];
  const out = [];
  let imagens = 0;
  for (const p of partes) {
    if (!p) continue;
    if (p.type === 'image' || p.type === 'document') { imagens++; continue; }
    if (p.type !== 'text') continue;
    const t = String(p.text || '').replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();
    if (t) out.push(t);
  }
  return { texto: out.join('\n\n'), imagens };
}

function criarJusia({ HOME, fetchFn, spawnFn, buildEnv }) {
  const f = () => fetchFn || globalThis.fetch;
  const arqSessao = () => path.join(HOME, '.cockpit', 'jusia-sessao.json');
  const arqConversas = () => path.join(HOME, '.cockpit', 'jusia-conversas.json');
  const scriptRenovar = () => path.join(HOME, '.cockpit', 'jusia-renovar.py');

  const lerJson = (arq, padrao) => { try { const j = JSON.parse(fs.readFileSync(arq, 'utf8')); return j && typeof j === 'object' ? j : padrao; } catch { return padrao; } };
  function gravar(arq, obj) {
    fs.mkdirSync(path.dirname(arq), { recursive: true });
    const tmp = arq + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 1), { mode: 0o600 });
    fs.chmodSync(tmp, 0o600);
    fs.renameSync(tmp, arq);
  }

  const sessao = () => lerJson(arqSessao(), null);
  function cabecalho(s) {
    const cks = (s && Array.isArray(s.cookies) ? s.cookies : []).filter((c) => c && c.name && /jusbrasil/i.test(c.domain || ''));
    return { cookie: cks.map((c) => c.name + '=' + c.value).join('; '), ua: (s && s.ua) || UA_PADRAO };
  }
  const temLogin = (s) => !!(s && Array.isArray(s.cookies) && s.cookies.some((c) => c && c.name === 'user' && c.value));

  /* prova de que o login vale: o perfil que a Jus IA guarda da pessoa (nome, OAB). O /graphql do
     site é barrado pelo Cloudflare fora do navegador; o canal do chat (/web/wingman) não. */
  let planoCache = { quando: 0, dados: null };
  async function conferir(forcar) {
    if (!forcar && planoCache.dados && Date.now() - planoCache.quando < 300000) return planoCache.dados;
    const s = sessao();
    if (!temLogin(s)) return { ok: false, motivo: 'sem-login' };
    const { cookie, ua } = cabecalho(s);
    try {
      const r = await f()(SITE + '/web/wingman/api/jusia/resource/memory', {
        signal: AbortSignal.timeout(15000), headers: { cookie, 'user-agent': ua, accept: 'application/json' } });
      if (!r.ok) return { ok: false, motivo: r.status === 401 ? 'sem-login' : r.status === 403 ? 'barrado' : 'status-' + r.status };
      const j = await r.json();
      const campos = {};
      for (const c of (j && j.fields) || []) if (c && c.key) campos[c.key] = c.value;
      const dados = { ok: true, nome: campos.nome_completo || campos.nome_preferido || '' };
      planoCache = { quando: Date.now(), dados };
      return dados;
    } catch (e) { return { ok: null, motivo: 'rede' }; }
  }

  // relê o login do Chrome da conta (sem senha nem clique). Até 90 s.
  let renovando = null;
  function renovar() {
    if (renovando) return renovando;
    renovando = new Promise((resolve) => {
      const script = scriptRenovar();
      if (!fs.existsSync(script)) return resolve({ ok: false, erro: 'Falta o ~/.cockpit/jusia-renovar.py.' });
      let saida = '', feito = false;
      // o python do sistema já tem o playwright (o caminho do Chrome escondido precisa dele)
      const py = fs.existsSync('/usr/bin/python3') ? '/usr/bin/python3' : 'python3';
      const filho = (spawnFn || require('child_process').spawn)(py, [script], { stdio: ['ignore', 'pipe', 'pipe'], env: buildEnv ? buildEnv() : process.env });
      const fim = (r) => { if (feito) return; feito = true; clearTimeout(t); planoCache = { quando: 0, dados: null }; resolve(r); };
      const t = setTimeout(() => { try { filho.kill(); } catch {} fim({ ok: false, erro: 'O login da Jus IA demorou demais.' }); }, 90000);
      if (filho.stdout) filho.stdout.on('data', (d) => { saida += d; });
      if (filho.stderr) filho.stderr.on('data', (d) => { saida += d; });
      filho.on('error', (e) => fim({ ok: false, erro: String(e && e.message || e) }));
      filho.on('close', (code) => fim(code === 0 ? { ok: true } : { ok: false, erro: (saida.trim().split('\n').pop() || 'Não consegui entrar na Jus IA.').slice(0, 300) }));
    }).finally(() => { renovando = null; });
    return renovando;
  }

  function ler() {
    const s = sessao();
    const entrou = temLogin(s);
    return { entrou, comChave: entrou, gratis: false, nome: 'Jus IA', via: 'Login do site', base: 'http://127.0.0.1:' + PORTA,
      email: entrou ? (s.conta || 'Conta do Jusbrasil') : '', plano: entrou ? (s.nome || '') : '',
      painel: SITE, dica: '', motivo: entrou ? '' : 'Entre na Jus IA em Ajustes › Contas.' };
  }
  async function entrar() {
    const r = await renovar();
    if (!r.ok) return r;
    const c = await conferir(true);
    if (c.ok === false) return { ok: false, erro: 'O Chrome da conta não está logado na Jus IA. Entre uma vez em ia.jusbrasil.com.br no Chrome dela.' };
    return { ok: true };
  }
  function sair() { try { fs.unlinkSync(arqSessao()); } catch {} planoCache = { quando: 0, dados: null }; }

  /* ---- a conversa ---- */
  function threadDa(sessaoId) {
    const mapa = lerJson(arqConversas(), {});
    return sessaoId ? mapa[sessaoId] || '' : '';
  }
  function lembrarThread(sessaoId, thread) {
    if (!sessaoId) return;
    const mapa = lerJson(arqConversas(), {});
    mapa[sessaoId] = thread;
    const chaves = Object.keys(mapa);
    if (chaves.length > 3000) for (const k of chaves.slice(0, chaves.length - 3000)) delete mapa[k];
    try { gravar(arqConversas(), mapa); } catch {}
  }

  async function pedirJusia(thread, texto, primeira) {
    const { cookie, ua } = cabecalho(sessao());
    return f()(SITE + '/web/wingman/api/jusia/stream', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: '*/*', cookie, 'user-agent': ua, 'x-client-capabilities': 'genui',
        origin: SITE, referer: SITE + '/conversa/c/' + thread },
      body: JSON.stringify({ threadId: thread, messages: [{ role: 'user', parts: [{ type: 'text', text: texto }], id: idCurto() }],
        flags: FLAGS, chatModes: FONTES, isAutoSend: !!primeira, isFirstMessage: !!primeira, enableBypass: true }),
    });
  }

  /* resposta no idioma da Anthropic (o que o Claude Code entende), em pedaços */
  function abrirResposta(res, modelo, emStream) {
    const id = 'msg_jusia_' + idCurto(20);
    let indice = -1, aberto = null, saida = 0;
    const blocos = [];
    const ev = (tipo, dados) => { if (emStream) res.write('event: ' + tipo + '\ndata: ' + JSON.stringify({ type: tipo, ...dados }) + '\n\n'); };
    if (emStream) {
      res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive' });
      ev('message_start', { message: { id, type: 'message', role: 'assistant', model: modelo, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } } });
    }
    const fechar = () => {
      if (!aberto) return;
      if (aberto === 'thinking') ev('content_block_delta', { index: indice, delta: { type: 'signature_delta', signature: 'jusia' } });
      ev('content_block_stop', { index: indice });
      aberto = null;
    };
    const escrever = (tipo, t) => {
      if (!t) return;
      if (aberto !== tipo) {
        fechar(); indice++; aberto = tipo;
        blocos.push(tipo === 'thinking' ? { type: 'thinking', thinking: '', signature: 'jusia' } : { type: 'text', text: '' });
        ev('content_block_start', { index: indice, content_block: tipo === 'thinking' ? { type: 'thinking', thinking: '', signature: '' } : { type: 'text', text: '' } });
      }
      const b = blocos[blocos.length - 1];
      if (tipo === 'thinking') { b.thinking += t; ev('content_block_delta', { index: indice, delta: { type: 'thinking_delta', thinking: t } }); }
      else { b.text += t; ev('content_block_delta', { index: indice, delta: { type: 'text_delta', text: t } }); }
      saida += Math.ceil(t.length / 4);
    };
    const terminar = () => {
      fechar();
      if (emStream) {
        ev('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: saida } });
        ev('message_stop', {});
        res.end();
      } else {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ id, type: 'message', role: 'assistant', model: modelo, content: blocos.length ? blocos : [{ type: 'text', text: '' }],
          stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 0, output_tokens: saida } }));
      }
    };
    return { texto: (t) => escrever('text', t), pensando: (t) => escrever('thinking', t), terminar };
  }

  // o que aparece no "pensando" enquanto a Jus IA pesquisa
  function passoDaFerramenta(nome, entrada) {
    const e = entrada && typeof entrada === 'object' ? entrada : {};
    if (nome === 'skillActivate') return 'Habilidade: ' + (e.id || 'jurídica');
    const oQue = e.userInput || e.query || e.q || e.termo || e.cnj || '';
    const rotulo = { jusSearch: 'Pesquisando', pesquisaLight: 'Pesquisando', pesquisaElite: 'Pesquisa a fundo' }[nome] || nome;
    return rotulo + (oQue ? ': ' + String(oQue).slice(0, 300) : '');
  }

  async function responder(req, res, corpo) {
    const modelo = corpo.model || MODELO;
    const emStream = !!corpo.stream;
    const msgs = Array.isArray(corpo.messages) ? corpo.messages : [];
    const saida = abrirResposta(res, modelo, emStream);
    const semFerramentas = !Array.isArray(corpo.tools) || !corpo.tools.length;
    // pedido de bastidor do Claude Code (título, resumo): não gasta a Jus IA
    if (semFerramentas && !emStream) { saida.texto('Jus IA'); return saida.terminar(); }

    let ult = null;
    for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i] && msgs[i].role === 'user') { ult = msgs[i]; break; }
    const { texto, imagens } = textoDe(ult && ult.content);
    if (!texto) { saida.texto(imagens ? 'A Jus IA no Cockpit só recebe texto. Escreva a pergunta.' : 'Escreva a pergunta.'); return saida.terminar(); }

    const sessaoId = String(req.headers['x-claude-code-session-id'] || '') || (() => {
      try { return JSON.parse((corpo.metadata && corpo.metadata.user_id) || '{}').session_id || ''; } catch { return ''; }
    })();
    let thread = threadDa(sessaoId), primeira = false, pergunta = texto;
    if (!thread) {
      thread = idCurto(); primeira = true;
      // conversa ramificada ou retomada sem par na Jus IA: leva o que já foi dito
      const antes = [];
      for (const m of msgs) {
        if (m === ult) break;
        const t = textoDe(m && m.content).texto;
        if (t && (m.role === 'user' || m.role === 'assistant')) antes.push((m.role === 'user' ? 'Eu: ' : 'Jus IA: ') + t);
      }
      if (antes.some((l) => l.startsWith('Jus IA: '))) pergunta = 'Contexto da nossa conversa até aqui:\n\n' + antes.join('\n\n').slice(-30000) + '\n\n---\n\n' + texto;
    }
    if (imagens) pergunta += '\n\n(Obs.: ' + imagens + ' anexo(s) não foram enviados; aqui só vai texto.)';

    if (!temLogin(sessao())) {
      const r = await renovar();
      if (!r.ok || !temLogin(sessao())) { saida.texto('Sem login na Jus IA. Entre em Ajustes › Contas › Jus IA. (' + (r.erro || 'sem sessão') + ')'); return saida.terminar(); }
    }

    let resp;
    try {
      resp = await pedirJusia(thread, pergunta, primeira);
      // 401/403: login vencido ou o Cloudflare pediu nova checagem. Relê e tenta uma vez.
      if (resp.status === 401 || resp.status === 403) {
        try { await resp.text(); } catch {}
        const r = await renovar();
        if (r.ok) resp = await pedirJusia(thread, pergunta, primeira);
      }
    } catch (e) {
      saida.texto('Não consegui falar com a Jus IA: ' + String(e && e.message || e).slice(0, 200));
      return saida.terminar();
    }
    if (!resp.ok) {
      let corpoErro = '';
      try { corpoErro = (await resp.text()).slice(0, 300); } catch {}
      const msg = resp.status === 401 || resp.status === 403
        ? 'O login da Jus IA venceu. Abra ia.jusbrasil.com.br no Chrome da conta, entre, e clique em Entrar em Ajustes › Contas › Jus IA.'
        : resp.status === 429 ? 'A Jus IA pediu uma pausa (limite de uso do plano). Tente de novo em alguns minutos.'
          : 'A Jus IA respondeu ' + resp.status + '. ' + corpoErro.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
      saida.texto(msg);
      return saida.terminar();
    }
    lembrarThread(sessaoId, thread);

    const limpo = criarLimpador();
    const nomes = {};
    let buf = '', falou = false;
    const linha = (l) => {
      if (!l.startsWith('data:')) return;
      const dado = l.slice(5).trim();
      if (!dado || dado === '[DONE]') return;
      let e; try { e = JSON.parse(dado); } catch { return; }
      switch (e.type) {
        case 'text-delta': { const t = limpo.por(e.delta || ''); if (t) { falou = true; saida.texto(t); } break; }
        case 'reasoning-delta': if (e.delta) saida.pensando(e.delta); break;
        case 'tool-input-start': nomes[e.toolCallId] = e.toolName; break;
        case 'tool-input-available': saida.pensando(passoDaFerramenta(e.toolName || nomes[e.toolCallId], e.input) + '\n'); break;
        case 'error': saida.texto('\n\nErro da Jus IA: ' + String(e.errorText || e.error || '').slice(0, 300)); falou = true; break;
        default: break;
      }
    };
    try {
      const dec = new TextDecoder();
      for await (const pedaco of resp.body) {
        buf += dec.decode(pedaco, { stream: true });
        let i;
        while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (l) linha(l); }
      }
      if (buf.trim()) linha(buf.trim());
    } catch (e) {
      saida.texto('\n\n(A conexão com a Jus IA caiu: ' + String(e && e.message || e).slice(0, 120) + ')');
    }
    const resto = limpo.fim();
    if (resto) { falou = true; saida.texto(resto); }
    if (!falou) saida.texto('(A Jus IA não mandou texto nesta resposta.)');
    saida.terminar();
  }

  let servidor = null, subindo = null;
  function atender(req, res) {
    const url = String(req.url || '').split('?')[0];
    if (req.method === 'GET' && url === '/saude') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"jusia":true}'); }
    if (req.method !== 'POST') { res.writeHead(404); return res.end(); }
    let bruto = '';
    req.on('data', (d) => { bruto += d; if (bruto.length > 50e6) req.destroy(); });
    req.on('end', async () => {
      let corpo = {};
      try { corpo = JSON.parse(bruto || '{}'); } catch {}
      if (url.endsWith('/count_tokens')) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ input_tokens: Math.ceil(bruto.length / 4) })); }
      if (!url.endsWith('/v1/messages')) { res.writeHead(404); return res.end(); }
      try { await responder(req, res, corpo); }
      catch (e) {
        try {
          if (!res.headersSent) { res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'Jus IA: ' + String(e && e.message || e) } })); }
          else res.end();
        } catch {}
      }
    });
  }
  // liga a ponte se ainda não estiver de pé (outra cópia do Cockpit pode já ter ligado: serve igual)
  async function garantir() {
    if (servidor) return true;
    if (subindo) return subindo;
    subindo = (async () => {
      try {
        const r = await f()('http://127.0.0.1:' + PORTA + '/saude', { signal: AbortSignal.timeout(1500) });
        if (r.ok && (await r.json()).jusia) return true;
      } catch {}
      return new Promise((resolve) => {
        const s = require('http').createServer(atender);   // só aqui: no teste o main não pode carregar http
        s.on('error', () => resolve(false));
        s.listen(PORTA, '127.0.0.1', () => { servidor = s; resolve(true); });
      });
    })().finally(() => { subindo = null; });
    return subindo;
  }
  function parar() { if (servidor) { try { servidor.close(); } catch {} servidor = null; } }

  return { ler, entrar, sair, conferir, renovar, garantir, parar, PORTA, MODELO, _interno: { criarLimpador, textoDe, citacaoEmLink } };
}

module.exports = { criarJusia, PORTA, MODELO, criarLimpador, textoDe, citacaoEmLink };
