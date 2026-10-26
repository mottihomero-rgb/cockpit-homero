'use strict';

/* Várias contas do Claude no mesmo Mac, com troca automática perto do limite.

   A conta PRINCIPAL é a de sempre: pasta ~/.claude, item "Claude Code-credentials" do Chaveiro.
   Cada conta EXTRA ganha uma pasta de login própria (CLAUDE_CONFIG_DIR). O Claude Code guarda o
   login dela num item do Chaveiro com o nome da pasta ("Claude Code-credentials-<8 letras do
   hash da pasta>"), então as contas nunca se misturam, e cada uma renova o próprio login.
   O histórico (projects/), as configurações, as skills e os hooks são os MESMOS: a pasta extra
   só tem atalhos para os de ~/.claude. Por isso uma conversa abre em qualquer conta com --resume.

   Quem decide a conta é o Cockpit, na hora de ABRIR o processo do chat. Um processo que já está
   rodando guarda o login na memória e nunca muda de conta no meio: o trabalho em andamento não
   para. A troca vale para o próximo processo (a próxima mensagem de um chat parado). */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const LIMITE_PADRAO = 90;
const USO_URL = 'https://api.anthropic.com/api/oauth/usage';
const PERFIL_URL = 'https://api.anthropic.com/api/oauth/profile';
const LEITURA_VALE_MS = 90 * 1000;
const RODADA_MS = 2 * 60 * 1000;
const ESGOTADA_MS = 15 * 60 * 1000;
const RENOVAR_ESPERA_MS = 30 * 60 * 1000;
const PENDENTE_VELHA_MS = 24 * 3600 * 1000;

// o que a pasta extra herda de ~/.claude (atalhos). Login, sessões vivas e caches NÃO entram.
const COMPARTILHADOS = ['CLAUDE.md', 'settings.json', 'settings.local.json', 'projects', 'agents', 'commands',
  'skills', 'hooks', 'plugins', 'output-styles', 'rules', 'keybindings.json', 'todos', 'file-history',
  'plans', 'history.jsonl', 'scripts', 'teams', 'tasks'];

const LIMITE_BATIDO = /limit reached|hit your (?:\w+[ -])*limit|usage limit|limite (?:de uso )?(?:atingido|esgotado)/i;

const lerJson = (arq, padrao) => { try { return JSON.parse(fs.readFileSync(arq, 'utf8')); } catch { return padrao; } };
function gravarJson(arq, obj) {
  fs.mkdirSync(path.dirname(arq), { recursive: true });
  const tmp = arq + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, arq);
}
// apaga a pasta da conta SEM seguir os atalhos: o que está atrás deles é o ~/.claude de verdade
function apagarDir(dir) {
  try {
    for (const nome of fs.readdirSync(dir)) {
      const f = path.join(dir, nome);
      if (fs.lstatSync(f).isSymbolicLink()) fs.unlinkSync(f);
    }
    fs.rmSync(dir, { recursive: true, force: true });
  } catch { /* pasta já não existe */ }
}
const existe = (p) => { try { fs.lstatSync(p); return true; } catch { return false; } };

function janela(x, agora) {
  if (!x) return null;
  const reseta = (x.resets_at && Date.parse(x.resets_at)) || 0;
  // janela que já virou: o número guardado era do ciclo passado
  if (reseta && reseta < agora) return { pct: 0, reseta };
  return { pct: Math.round(x.utilization || 0), reseta };
}

function criarContasClaude({ HOME, pastaDados, EH_WIN = process.platform === 'win32', claudeBin, buildEnv,
  usuario = (() => { try { return os.userInfo().username; } catch { return process.env.USER || ''; } })(),
  chaveiro, buscar = (...a) => fetch(...a), rodarCli, agora = () => Date.now(), anota = () => {} }) {

  const ARQ = () => path.join(pastaDados(), 'contas-claude.json');
  const RAIZ = path.join(HOME, '.cockpit', 'contas-claude');
  const PRINCIPAL = 'principal';

  /* ---------- registro das contas ---------- */
  function lerCfg() {
    const c = lerJson(ARQ(), {});
    return {
      auto: c.auto !== false,
      limite: Math.min(99, Math.max(50, Number(c.limite) || LIMITE_PADRAO)),
      ativa: typeof c.ativa === 'string' ? c.ativa : PRINCIPAL,
      extras: Array.isArray(c.extras) ? c.extras.filter(e => e && e.id && e.dir) : [],
    };
  }
  let cfg = lerCfg();
  const salvarCfg = () => { try { gravarJson(ARQ(), cfg); } catch (e) { anota('contas-claude: não salvei o registro:', e && e.message); } };

  const extrasConfirmadas = () => cfg.extras.filter(e => !e.pendente);
  const principal = () => ({ id: PRINCIPAL, dir: null, principal: true });
  const todas = () => EH_WIN ? [principal()] : [principal(), ...extrasConfirmadas().map(e => ({ ...e, principal: false }))];
  const achar = (id) => todas().find(c => c.id === id) || null;
  function contaAtiva() { return achar(cfg.ativa) || principal(); }
  const idAtiva = () => contaAtiva().id;

  /* ---------- Chaveiro ---------- */
  const servicoDe = (c) => c.dir ? 'Claude Code-credentials-' + crypto.createHash('sha256').update(c.dir).digest('hex').slice(0, 8)
    : 'Claude Code-credentials';
  const lerChaveiro = chaveiro || ((servico, dono) => new Promise((res, rej) =>
    execFile('security', ['find-generic-password', '-s', servico, '-a', dono, '-w'], { encoding: 'utf8', timeout: 8000 },
      (err, out) => err ? rej(err) : res(out))));

  async function lerCredencial(c) {
    if (EH_WIN) {
      const base = c.dir || path.join(HOME, '.claude');
      for (const f of [path.join(base, '.credentials.json'), path.join(HOME, '.config', 'claude', '.credentials.json')]) {
        const o = (lerJson(f, {}).claudeAiOauth) || {};
        if (o.accessToken) return o;
      }
      return null;
    }
    for (const dono of c.dir ? [usuario] : [usuario, 'unknown']) {
      try {
        const o = (JSON.parse(await lerChaveiro(servicoDe(c), dono)).claudeAiOauth) || {};
        if (o.accessToken) return o;
      } catch { /* tenta o próximo dono */ }
    }
    return null;
  }

  /* ---------- pasta da conta extra ---------- */
  function sincronizarMcp(dir) {
    // servidores MCP "de usuário" moram no .claude.json da pasta; a extra copia os da principal
    const doPrincipal = (lerJson(path.join(HOME, '.claude.json'), {}).mcpServers) || {};
    const arq = path.join(dir, '.claude.json');
    const dela = lerJson(arq, {});
    const igual = JSON.stringify(dela.mcpServers || {}) === JSON.stringify(doPrincipal);
    if (igual && dela.hasCompletedOnboarding) return;
    try { gravarJson(arq, { ...dela, hasCompletedOnboarding: true, mcpServers: doPrincipal }); }
    catch (e) { anota('contas-claude: não sincronizei os MCP:', e && e.message); }
  }
  function prepararDir(c) {
    if (!c || !c.dir) return;
    try { fs.mkdirSync(c.dir, { recursive: true }); } catch (e) { anota('contas-claude: não criei a pasta da conta:', e && e.message); return; }
    const origem = path.join(HOME, '.claude');
    for (const nome of COMPARTILHADOS) {
      const de = path.join(origem, nome), para = path.join(c.dir, nome);
      if (!existe(de)) continue;
      try {
        const st = existe(para) ? fs.lstatSync(para) : null;
        if (st && st.isSymbolicLink()) continue;
        // pasta vazia que o CLI criou sozinho: troca pelo atalho. Com conteúdo, não mexe.
        if (st && st.isDirectory() && fs.readdirSync(para).length === 0) fs.rmdirSync(para);
        else if (st) continue;
        fs.symlinkSync(de, para);
      } catch (e) { anota('contas-claude: atalho de', nome, 'falhou:', e && e.message); }
    }
    sincronizarMcp(c.dir);
  }

  /* ---------- quem é cada conta ---------- */
  function emailDe(c) {
    const arq = c.dir ? path.join(c.dir, '.claude.json') : path.join(HOME, '.claude.json');
    const o = lerJson(arq, {}).oauthAccount || {};
    return String(o.emailAddress || '').trim();
  }
  async function emailPorStatus(c) {
    if (!rodarCli) return '';
    try {
      const env = envDaConta(c, buildEnv ? buildEnv() : process.env);
      const r = await rodarCli(['auth', 'status'], { env, timeout: 25000 });
      const j = JSON.parse(r.out || '{}');
      return j.loggedIn ? String(j.email || '') : '';
    } catch { return ''; }
  }

  // último recurso: o perfil da conta, pelo próprio login dela
  async function emailPorPerfil(c) {
    try {
      const cred = await lerCredencial(c);
      if (!cred) return '';
      const r = await buscar(PERFIL_URL, { headers: { Authorization: 'Bearer ' + cred.accessToken, 'anthropic-beta': 'oauth-2025-04-20' } });
      if (!r.ok) return '';
      const j = await r.json();
      return String((j && j.account && j.account.email) || '').trim();
    } catch { return ''; }
  }

  function envDaConta(c, base) {
    const env = { ...base };
    if (c && c.dir) env.CLAUDE_CONFIG_DIR = c.dir; else delete env.CLAUDE_CONFIG_DIR;
    return env;
  }

  /* ---------- uso de cada conta ---------- */
  const usos = new Map();       // id -> { dados, quando, pausaAte, pausa, voando, erro, renovadoEm }
  const esgotadas = new Map();  // id -> até quando vale "bateu o limite"
  const usoDe = (id) => { let u = usos.get(id); if (!u) { u = { dados: null, quando: 0, pausaAte: 0, pausa: 0, voando: null, erro: '', renovadoEm: 0 }; usos.set(id, u); } return u; };

  async function renovarLogin(c) {
    // um processo curto do próprio CLI renova o login (e grava no Chaveiro). No máximo 1 vez a cada 30 min.
    const u = usoDe(c.id);
    if (!rodarCli || agora() - u.renovadoEm < RENOVAR_ESPERA_MS) return false;
    u.renovadoEm = agora();
    try {
      const cwd = path.join(os.tmpdir(), 'cockpit-renovar-login');
      fs.mkdirSync(cwd, { recursive: true });
      await rodarCli(['-p', 'ok', '--model', 'haiku', '--max-turns', '1', '--output-format', 'json', '--no-session-persistence',
        '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--disable-slash-commands', '--setting-sources', 'project,local'],
      { env: envDaConta(c, buildEnv ? buildEnv() : process.env), timeout: 120000, cwd });
      return true;
    } catch (e) { anota('contas-claude: não consegui renovar o login de', c.id, e && e.message); return false; }
  }

  async function lerUsoDaConta(c, forcar) {
    const u = usoDe(c.id), t = agora();
    if (!forcar && u.dados && t - u.quando < LEITURA_VALE_MS) return u;
    if (t < u.pausaAte) return u;
    if (u.voando) return u.voando;
    u.voando = (async () => {
      try {
        let cred = await lerCredencial(c);
        if (!cred) { u.erro = 'sem-login'; return u; }
        if (cred.expiresAt && cred.expiresAt - agora() < 60000) { u.erro = 'vencido'; return u; }
        let r = await buscar(USO_URL, { headers: { Authorization: 'Bearer ' + cred.accessToken, 'anthropic-beta': 'oauth-2025-04-20' } });
        if (r.status === 401 || r.status === 403) { u.erro = 'vencido'; return u; }
        if (r.status === 429) {
          const pediu = Number(r.headers && r.headers.get && r.headers.get('retry-after')) * 1000;
          u.pausa = Math.min(15 * 60000, Math.max(60000, pediu > 0 ? pediu : (u.pausa * 2 || 120000)));
          u.pausaAte = agora() + u.pausa; u.erro = 'muita-consulta';
          return u;
        }
        if (!r.ok) { u.erro = 'http-' + r.status; return u; }
        u.dados = await r.json(); u.quando = agora(); u.erro = ''; u.pausa = 0; u.pausaAte = 0;
        return u;
      } catch (e) { u.erro = 'falhou'; return u; }
      finally { u.voando = null; }
    })();
    return u.voando;
  }

  // número usado nas decisões: o maior entre sessão e semana. null = não sei.
  function resumoDe(id) {
    const u = usos.get(id), t = agora();
    if (!u || !u.dados) return { sessao: null, semana: null, quando: 0, erro: (u && u.erro) || '' };
    return { sessao: janela(u.dados.five_hour, t), semana: janela(u.dados.seven_day, t), quando: u.quando, erro: u.erro };
  }
  function pctDe(id) {
    if ((esgotadas.get(id) || 0) > agora()) return 100;
    const r = resumoDe(id);
    const v = [r.sessao, r.semana].filter(Boolean).map(j => j.pct);
    return v.length ? Math.max(...v) : null;
  }

  /* ---------- a troca ---------- */
  const ouvintes = [];
  let trocarEmAndamento = null;

  function definirAtiva(id, motivo, de) {
    cfg.ativa = id; salvarCfg();
    const para = achar(id);
    for (const f of ouvintes) { try { f({ de, para: id, paraEmail: para ? emailDe(para) : '', motivo }); } catch (e) { anota('contas-claude: ouvinte falhou:', e && e.message); } }
  }

  // garante que a conta responde (login vivo) antes de mandar o trabalho para ela
  async function prepararParaUso(c) {
    prepararDir(c);
    const u = usoDe(c.id);
    await lerUsoDaConta(c, true);
    if (u.erro === 'vencido') {
      await renovarLogin(c);
      await lerUsoDaConta(c, true);
    }
    return !['vencido', 'sem-login'].includes(u.erro);
  }

  async function avaliar(motivo = 'perto-do-limite') {
    if (!cfg.auto || trocarEmAndamento) return null;
    const lista = todas();
    if (lista.length < 2) return null;
    const atual = contaAtiva();
    const pAtual = pctDe(atual.id);
    if (pAtual == null || pAtual < cfg.limite) return null;
    trocarEmAndamento = (async () => {
      try {
        const candidatas = lista.filter(c => c.id !== atual.id)
          .map(c => ({ c, p: pctDe(c.id) }))
          .filter(x => x.p == null || x.p < cfg.limite)
          .sort((a, b) => (a.p == null ? 50 : a.p) - (b.p == null ? 50 : b.p));
        for (const { c } of candidatas) {
          // o dado de uso pode estar velho ou faltando: confere agora, só da candidata
          if (!(await prepararParaUso(c))) continue;
          const p = pctDe(c.id);
          if (p != null && p >= cfg.limite) continue;
          definirAtiva(c.id, motivo, atual.id);
          return { de: atual.id, para: c.id, pctDe: pAtual, pctPara: p };
        }
      } finally { trocarEmAndamento = null; }
      return null;
    })();
    return trocarEmAndamento;
  }

  // o CLI relatou "limite batido" numa conversa: a conta está cheia, não importa o que a leitura diz
  async function limiteBateu(id) {
    esgotadas.set(id, agora() + ESGOTADA_MS);
    if (id !== idAtiva()) return null;
    return avaliar('limite-batido');
  }

  /* ---------- rodada de leitura ---------- */
  let usoDaAtivaFn = null, timer = null, primeiro = null;
  async function rodada() {
    const lista = todas();
    for (const c of lista) {
      try {
        if (c.id === idAtiva() && usoDaAtivaFn) {
          // a conta em uso é lida pelo mesmo caminho da faixa de uso do app (uma leitura só)
          const d = await usoDaAtivaFn();
          if (d && !d.limitado) { const u = usoDe(c.id); u.dados = d; u.quando = agora(); u.erro = ''; }
        } else await lerUsoDaConta(c, false);
      } catch (e) { anota('contas-claude: leitura falhou:', e && e.message); }
    }
    // perto de bater: aquece as outras (renova login vencido) para a troca ser instantânea
    const pAtual = pctDe(idAtiva());
    if (pAtual != null && pAtual >= cfg.limite - 10) {
      for (const c of lista) if (c.id !== idAtiva() && usoDe(c.id).erro === 'vencido') await renovarLogin(c);
    }
    await avaliar();
  }
  function iniciar({ usoDaAtiva, aoTrocar } = {}) {
    usoDaAtivaFn = usoDaAtiva || null;
    if (aoTrocar) ouvintes.push(aoTrocar);
    if (timer || EH_WIN) return;
    limparPendentes();
    primeiro = setTimeout(() => { rodada().catch(() => {}); }, 20000);
    timer = setInterval(() => { rodada().catch(() => {}); }, RODADA_MS);
    if (primeiro.unref) primeiro.unref();
    if (timer.unref) timer.unref();
  }
  function parar() { clearTimeout(primeiro); clearInterval(timer); timer = null; }

  /* ---------- adicionar e tirar conta ---------- */
  function limparPendentes() {
    const antes = cfg.extras.length;
    cfg.extras = cfg.extras.filter(e => {
      if (!e.pendente) return true;
      if (agora() - (e.criadaEm || 0) < PENDENTE_VELHA_MS) return true;
      apagarDir(e.dir);
      return false;
    });
    if (cfg.extras.length !== antes) salvarCfg();
  }

  function nova(bin) {
    if (EH_WIN) return { error: 'Várias contas do Claude por aqui só no Mac.' };
    // só existe um login em andamento por vez: o que ficou pela metade é jogado fora
    for (const velha of cfg.extras.filter(e => e.pendente)) cancelar(velha.id);
    const id = 'c' + crypto.randomBytes(4).toString('hex');
    fs.mkdirSync(RAIZ, { recursive: true });
    const dir = path.join(fs.realpathSync(RAIZ), id);
    fs.mkdirSync(dir, { recursive: true });
    const c = { id, dir, pendente: true, criadaEm: agora() };
    prepararDir(c);
    cfg.extras.push(c); salvarCfg();
    const aspas = (v) => "'" + String(v).replace(/'/g, "'\\''") + "'";
    return { id, dir, terminal: 'CLAUDE_CONFIG_DIR=' + aspas(dir) + ' ' + aspas(bin || claudeBin) + ' auth login' };
  }

  async function confirmar(id) {
    const e = cfg.extras.find(x => x.id === id);
    if (!e) return { error: 'Essa conta não está mais na lista.' };
    let email = emailDe(e);
    if (!email) email = await emailPorStatus(e);
    if (!email) email = await emailPorPerfil(e);
    if (!email) { return { error: 'O login não terminou. Tente de novo.' }; }
    const dono = todas().find(c => c.id !== id && emailDe(c).toLowerCase() === email.toLowerCase());
    const doPrincipal = emailDe(principal()).toLowerCase() === email.toLowerCase();
    if (dono || doPrincipal) {
      cancelar(id);
      return { error: 'A conta ' + email + ' já está na lista.' };
    }
    e.pendente = false; e.email = email; salvarCfg();
    return { ok: true, id, email };
  }
  function cancelar(id) {
    const e = cfg.extras.find(x => x.id === id);
    if (!e) return { ok: true };
    cfg.extras = cfg.extras.filter(x => x.id !== id);
    if (cfg.ativa === id) cfg.ativa = PRINCIPAL;
    salvarCfg();
    apagarDir(e.dir);
    usos.delete(id); esgotadas.delete(id);
    return { ok: true };
  }
  async function remover(id) {
    const e = cfg.extras.find(x => x.id === id);
    if (!e) return { error: 'Conta não encontrada.' };
    const eraAtiva = cfg.ativa === id;
    // sai do Chaveiro também: a pasta apagada deixaria o login órfão lá
    try { await new Promise((res) => execFile('security', ['delete-generic-password', '-s', servicoDe(e), '-a', usuario], () => res())); } catch {}
    cancelar(id);
    if (eraAtiva) for (const f of ouvintes) { try { f({ de: id, para: PRINCIPAL, paraEmail: emailDe(principal()), motivo: 'removida' }); } catch {} }
    return { ok: true };
  }

  /* ---------- o que a tela e o motor consultam ---------- */
  function usar(id) {
    const c = achar(id);
    if (!c) return { error: 'Conta não encontrada.' };
    if (idAtiva() === id) return { ok: true };
    const de = idAtiva();
    prepararDir(c);
    definirAtiva(id, 'manual', de);
    return { ok: true };
  }
  function ligarAuto(v) { cfg.auto = !!v; salvarCfg(); return { ok: true, auto: cfg.auto }; }

  function estado() {
    return {
      auto: cfg.auto, limite: cfg.limite, ativa: idAtiva(), mac: !EH_WIN,
      contas: todas().map(c => {
        const r = resumoDe(c.id);
        return { id: c.id, principal: !!c.principal, email: c.principal ? emailDe(c) : (c.email || emailDe(c)),
          ativa: c.id === idAtiva(), sessao: r.sessao, semana: r.semana, quando: r.quando, erro: r.erro,
          cheia: (esgotadas.get(c.id) || 0) > agora() };
      }),
    };
  }
  async function atualizarTudo() {
    for (const c of todas()) {
      if (c.id === idAtiva() && usoDaAtivaFn) { try { const d = await usoDaAtivaFn(); if (d && !d.limitado) { const u = usoDe(c.id); u.dados = d; u.quando = agora(); u.erro = ''; } } catch {} }
      else await lerUsoDaConta(c, false);
    }
    return estado();
  }

  // token da conta em uso, para a faixa de uso do app
  async function tokenDaAtiva(tokenPrincipal) {
    const c = contaAtiva();
    if (c.principal) return tokenPrincipal();
    const cred = await lerCredencial(c);
    return cred ? cred.accessToken : null;
  }

  return {
    PRINCIPAL, LIMITE_BATIDO,
    contaAtiva, achar, todas, envDaConta, prepararDir, servicoDe, estado, atualizarTudo, tokenDaAtiva,
    nova, confirmar, cancelar, remover, usar, ligarAuto, avaliar, limiteBateu, iniciar, parar, rodada,
    emailDaConta: (id) => { const c = achar(id); return c ? (c.principal ? emailDe(c) : (c.email || emailDe(c))) : ''; },
    ehLimite: (texto) => LIMITE_BATIDO.test(String(texto || '')),
    _: { usos, esgotadas, get cfg() { return cfg; }, recarregar() { cfg = lerCfg(); }, lerUsoDaConta, pctDe, lerCredencial, emailDe },
  };
}

module.exports = { criarContasClaude, COMPARTILHADOS, LIMITE_BATIDO };
