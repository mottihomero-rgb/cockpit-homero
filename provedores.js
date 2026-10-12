'use strict';

/* IAs de fora que entram no Cockpit por CHAVE (não por login): DeepSeek, MiMo (Xiaomi) e Muse
   Spark (Meta). Todas falam o "idioma" da Anthropic, então o motor delas é o próprio Claude Code
   apontado para outro endereço, com a chave de cada uma (ANTHROPIC_BASE_URL + ANTHROPIC_AUTH_TOKEN).
   Mesmas ferramentas, mesmas pastas, mesmo histórico. O Muse Spark entra pelo OpenRouter, o único
   caminho público que a Meta tem hoje. A chave mora em ~/.cockpit/provedores.json (só o dono lê). */
const fs = require('fs');
const path = require('path');

const PROVEDORES = {
  deepseek: {
    nome: 'DeepSeek', via: 'Chave da DeepSeek',
    base: 'https://api.deepseek.com/anthropic',
    painel: 'https://platform.deepseek.com/api_keys',
    dica: 'sk-…',
    modelos: [
      { id: 'deepseek-flash', nome: 'DeepSeek V4.1 Flash', desc: 'Rápido e muito barato', efforts: [], padrao: true },
      { id: 'deepseek-v4-pro', nome: 'DeepSeek V4 Pro', desc: 'O mais forte da DeepSeek', efforts: [] },
    ],
  },
  mimo: {
    nome: 'MiMo', via: 'Chave da Xiaomi',
    base: 'https://api.xiaomimimo.com/anthropic',
    basePlano: 'https://token-plan-sgp.xiaomimimo.com/anthropic',   // chave "tp-…" é do Token Plan (endereço de Singapura, visto no painel em 07/10)
    painel: 'https://platform.xiaomimimo.com',
    dica: 'sk-… ou tp-…',
    modelos: [
      { id: 'mimo-v2.6-pro', nome: 'MiMo V2.6 Pro', desc: 'O mais forte da Xiaomi', efforts: [], padrao: true },
    ],
  },
  muse: {
    nome: 'Muse Spark', via: 'Chave do OpenRouter',
    base: 'https://openrouter.ai/api',
    painel: 'https://openrouter.ai/settings/keys',
    dica: 'sk-or-…',
    modelos: [
      { id: 'nvidia/meta/muse-glimmer-30b', nome: 'Muse Glimmer 30B (grátis)', desc: 'Muse aberto da Meta, pela NVIDIA, sem custo', efforts: [], via: 'omni', padrao: true },
      { id: 'meta/muse-spark-1.3', nome: 'Muse Spark 1.3', desc: 'Com a sua chave do OpenRouter, rápido e forte', efforts: [] },
    ],
  },
};

/* Rota grátis: o OmniRoute (já instalado no Mac, porta 20128) fala o idioma da Anthropic por cima da
   camada grátis da NVIDIA. Serve sem chave nenhuma, só com a chave do próprio OmniRoute. */
const OMNI = { base: 'http://localhost:20128', arquivoChave: '.omniroute_api_key', statusUrl: 'http://localhost:20128/api/auth/status' };
const ehProvedor = (id) => Object.prototype.hasOwnProperty.call(PROVEDORES, id);
const mascara = (chave) => { const c = String(chave || ''); return c ? '••••' + c.slice(-4) : ''; };

// o que o Claude Code leria da conta Anthropic e atrapalharia a chave de fora
const VARIAVEIS_ANTHROPIC = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL', 'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'ANTHROPIC_SMALL_FAST_MODEL', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX'];

function criarProvedores({ HOME, fetchFn, spawnFn, buildEnv }) {
  const arquivo = () => path.join(HOME, '.cockpit', 'provedores.json');
  const f = () => fetchFn || globalThis.fetch;

  /* Saldo do plano da Xiaomi (07/10): ela não tem endereço de saldo por chave, mas o painel dela
     tem (`/api/v1/tokenPlan/usage`) e só abre com o login da conta. Guardamos esse login uma vez
     em ~/.cockpit/xiaomi-sessao.json (cookies, só o dono lê) e lemos por ele. Vencido, o
     ~/.cockpit/xiaomi-renovar.py refaz o login sozinho pelo perfil guardado. */
  const sessaoXiaomi = () => path.join(HOME, '.cockpit', 'xiaomi-sessao.json');
  function cookiesXiaomi() {
    try {
      const j = JSON.parse(fs.readFileSync(sessaoXiaomi(), 'utf8'));
      if (!Array.isArray(j)) return '';
      return j.filter((c) => c && c.name && c.value && /xiaomi/i.test(c.domain || ''))
        .map((c) => c.name + '=' + c.value).join('; ');
    } catch { return ''; }
  }
  function renovarSessaoXiaomi() {
    const script = path.join(HOME, '.cockpit', 'xiaomi-renovar.py');
    if (!fs.existsSync(script)) return false;
    try {
      const filho = (spawnFn || require('child_process').spawn)('python3', [script], { stdio: 'ignore', detached: true });
      if (filho && filho.unref) filho.unref();
      return true;
    } catch { return false; }
  }
  // "88,5 mi" / "4,1 bi" — o tamanho dos créditos do plano não é dinheiro, é token
  const qtd = (n) => {
    const v = Number(n) || 0;
    const pt = (x, casas) => x.toFixed(casas).replace('.', ',').replace(/,0$/, '');
    if (v >= 1e9) return pt(v / 1e9, 1) + ' bi';
    if (v >= 1e6) return pt(v / 1e6, 1) + ' mi';
    if (v >= 1e3) return Math.round(v / 1e3) + ' mil';
    return String(Math.round(v));
  };

  function lerTudo() {
    try { const j = JSON.parse(fs.readFileSync(arquivo(), 'utf8')); return j && typeof j === 'object' ? j : {}; }
    catch { return {}; }
  }
  function gravarTudo(obj) {
    const alvo = arquivo(), tmp = alvo + '.tmp';
    fs.mkdirSync(path.dirname(alvo), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n', { mode: 0o600 });
    fs.chmodSync(tmp, 0o600);
    fs.renameSync(tmp, alvo);   // atômico: ou entra inteiro, ou fica o antigo
  }
  function baseDe(id, reg) {
    const p = PROVEDORES[id];
    const chave = String((reg && reg.chave) || '');
    if (reg && reg.base) return String(reg.base).replace(/\/+$/, '');
    return id === 'mimo' && /^tp-/i.test(chave) ? p.basePlano : p.base;
  }

  const chaveOmni = () => { try { return fs.readFileSync(path.join(HOME, OMNI.arquivoChave), 'utf8').trim(); } catch { return ''; } };
  const temGratis = (id) => PROVEDORES[id].modelos.some(m => m.via === 'omni') && !!chaveOmni();
  const modeloDe = (id, modelo) => PROVEDORES[id].modelos.find(m => m.id === modelo);
  const ehGratis = (id, modelo) => !!(ehProvedor(id) && modeloDe(id, modelo) && modeloDe(id, modelo).via === 'omni');

  function ler(id) {
    if (!ehProvedor(id)) return { entrou: false };
    const p = PROVEDORES[id], reg = lerTudo()[id];
    const comChave = !!(reg && reg.chave), gratis = temGratis(id);
    const entrou = comChave || gratis;
    return { entrou, comChave, gratis, email: comChave ? mascara(reg.chave) : gratis ? 'Grátis · NVIDIA' : '', nome: p.nome, plano: '', via: comChave ? p.via : gratis ? 'Rota grátis (OmniRoute)' : p.via,
      base: entrou ? baseDe(id, reg) : p.base, padrao: p.base, painel: p.painel, dica: p.dica,
      motivo: entrou ? '' : 'Cole a sua chave de API para usar o ' + p.nome + '.' };
  }
  function chaveDe(id) { const reg = lerTudo()[id]; return reg && reg.chave ? String(reg.chave) : ''; }

  // confere o formato ANTES de gastar uma chamada ou mexer no arquivo; devolve a chave limpa
  function validar(id, { chave, base } = {}) {
    if (!ehProvedor(id)) throw new Error('IA desconhecida.');
    const c = String(chave || '').trim();
    if (!c) throw new Error('Cole a chave.');
    if (/\s/.test(c) || c.length < 12) throw new Error('Essa chave parece incompleta.');
    const b = String(base || '').trim();
    if (b && !/^https:\/\/[\w.-]+(:\d+)?(\/[\w./-]*)?$/i.test(b)) throw new Error('O endereço precisa começar com https://');
    return { chave: c, base: b };
  }
  function salvar(id, entrada = {}) {
    const { chave: c, base: b } = validar(id, entrada);
    const tudo = lerTudo();
    tudo[id] = { chave: c, ...(b && b.replace(/\/+$/, '') !== PROVEDORES[id].base ? { base: b.replace(/\/+$/, '') } : {}), salvoEm: Date.now() };
    gravarTudo(tudo);
    return ler(id);
  }
  function remover(id) {
    const tudo = lerTudo();
    delete tudo[id];
    gravarTudo(tudo);
    return ler(id);
  }

  /* Ambiente do Claude Code para este provedor. O modelo vai em TODOS os apelidos (opus, sonnet,
     haiku, rápido, subagente): o CLI chama o "haiku" para título e sugestão, e sem isto ele
     pediria um modelo da Anthropic que o endereço de fora não conhece. */
  function ambiente(id, modelo, base) {
    const p = PROVEDORES[id], reg = lerTudo()[id];
    const m = modelo || (p && (p.modelos.find(x => x.padrao) || p.modelos[0]).id);
    const gratis = ehGratis(id, m);
    if (!p || (!gratis && (!reg || !reg.chave))) throw new Error('Cole a chave do ' + (p ? p.nome : 'provedor') + ' em Ajustes › Contas, ou escolha o modelo grátis.');
    if (gratis && !chaveOmni()) throw new Error('A rota grátis precisa do OmniRoute instalado (chave em ~/' + OMNI.arquivoChave + ').');
    const env = { ...(base || process.env) };
    for (const k of VARIAVEIS_ANTHROPIC) delete env[k];
    Object.assign(env, {
      ANTHROPIC_BASE_URL: gratis ? OMNI.base : baseDe(id, reg),
      ANTHROPIC_AUTH_TOKEN: gratis ? chaveOmni() : reg.chave,
      ANTHROPIC_API_KEY: '',
      ANTHROPIC_MODEL: m,
      ANTHROPIC_DEFAULT_OPUS_MODEL: m, ANTHROPIC_DEFAULT_SONNET_MODEL: m, ANTHROPIC_DEFAULT_HAIKU_MODEL: m,
      ANTHROPIC_SMALL_FAST_MODEL: m, CLAUDE_CODE_SUBAGENT_MODEL: m,
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      API_TIMEOUT_MS: '3000000',
    });
    return env;
  }

  /* Confere a chave com uma mensagem de 1 token (custo de centavos de centavo). 401/403 = chave
     errada, não salva. 402 = chave boa, sem saldo: salva e avisa. Rede caída: não dá para dizer. */
  async function testar(id, { chave, base } = {}) {
    const p = PROVEDORES[id];
    if (!p) return { ok: false, erro: 'IA desconhecida.' };
    const c = String(chave || chaveDe(id)).trim();
    const url = (base ? String(base).replace(/\/+$/, '') : baseDe(id, { chave: c, base: lerTudo()[id] && lerTudo()[id].base })) + '/v1/messages';
    try {
      const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 20000);
      const r = await f()(url, {
        method: 'POST', signal: ctl.signal,
        headers: { 'content-type': 'application/json', 'anthropic-version': '2023-06-01', 'x-api-key': c, Authorization: 'Bearer ' + c },
        body: JSON.stringify({ model: p.modelos[0].id, max_tokens: 1, messages: [{ role: 'user', content: 'oi' }] }),
      });
      clearTimeout(t);
      if (r.status === 401 || r.status === 403) return { ok: false, status: r.status, erro: 'A chave foi recusada. Confira se copiou inteira.' };
      if (r.status === 402) return { ok: true, status: 402, aviso: 'Chave válida, mas a conta está sem saldo.' };
      if (r.status === 429) return { ok: true, status: 429, aviso: 'Chave válida (limite de pedidos agora).' };
      if (r.ok) return { ok: true, status: r.status };
      if (r.status === 404 || r.status === 400) return { ok: true, status: r.status, aviso: 'Chave aceita; o modelo pode ter outro nome.' };
      return { ok: false, status: r.status, erro: 'O servidor respondeu ' + r.status + '.' };
    } catch (e) {
      return { ok: null, erro: 'Sem resposta do servidor (' + String(e && e.name === 'AbortError' ? 'demorou demais' : e && e.message || e).slice(0, 80) + ').' };
    }
  }

  const dinheiro = (n, moeda) => {
    const simbolo = { USD: 'US$ ', CNY: '¥ ', BRL: 'R$ ' }[moeda] || (moeda ? moeda + ' ' : '');
    return simbolo + Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };
  const curto = (n, moeda) => {
    const simbolo = { USD: '$', CNY: '¥', BRL: 'R$' }[moeda] || '';
    const v = Number(n);
    return simbolo + (v >= 100 ? Math.round(v) : v.toFixed(1).replace('.', ',').replace(/,0$/, ''));
  };

  /* Saldo: o que a conta do provedor deixa ler. DeepSeek e OpenRouter têm endereço de saldo; a
     Xiaomi só mostra o uso no painel, e aí entramos com o login da conta (ramo "mimo" abaixo).
     pct só existe quando há TETO: crédito
     total no OpenRouter, ou o limite que a chave tem. */
  async function saldo(id) {
    const c = chaveDe(id);
    if (!c) return null;
    const cab = { Authorization: 'Bearer ' + c, Accept: 'application/json' };
    try {
      /* MiMo (07/10): o uso do plano só existe no painel da Xiaomi, e o painel só abre com o login
         da conta (a chave "tp-" não serve para isto). Lemos com os cookies guardados; se estiverem
         vencidos, o renovar.py refaz o login e tentamos de novo. */
      if (id === 'mimo') {
        for (let vez = 0; vez < 2; vez++) {
          const cookie = cookiesXiaomi();
          if (!cookie) return null;
          const cabecalho = { Accept: 'application/json', Cookie: cookie };
          const [ru, rd] = await Promise.all([
            f()('https://platform.xiaomimimo.com/api/v1/tokenPlan/usage', { headers: cabecalho }),
            f()('https://platform.xiaomimimo.com/api/v1/tokenPlan/detail', { headers: cabecalho }),
          ]);
          if (ru.status === 401 || rd.status === 401) {
            if (vez === 0 && renovarSessaoXiaomi()) { await new Promise(r => setTimeout(r, 15000)); continue; }
            return null;
          }
          if (!ru.ok) return { erro: ru.status };
          const ju = await ru.json();
          const itens = (ju && ju.data && ju.data.usage && ju.data.usage.items) || [];
          const gasto = itens.find(x => x.name === 'plan_total_token') || itens[0];
          if (!gasto || !Number(gasto.limit)) return null;
          const usado = Number(gasto.used) || 0, teto = Number(gasto.limit) || 0;
          let plano = '', reseta = 0;
          try {
            const jd = rd.ok ? await rd.json() : null;
            plano = (jd && jd.data && jd.data.planName) || '';
            const fim = jd && jd.data && jd.data.currentPeriodEnd;
            if (fim) reseta = Date.parse(String(fim).replace(' ', 'T')) || 0;
          } catch { /* o número do uso já basta */ }
          return {
            texto: qtd(usado) + ' de ' + qtd(teto) + ' tokens',
            curto: Math.round(usado / teto * 100) + '%',
            restante: teto - usado, moeda: 'tokens',
            semSaldo: usado >= teto, pct: Math.min(100, Math.max(0, usado / teto * 100)),
            reseta, plano,
          };
        }
        return null;
      }
      if (id === 'deepseek') {
        const r = await f()('https://api.deepseek.com/user/balance', { headers: cab });
        if (!r.ok) return { erro: r.status };
        const j = await r.json();
        const info = (j.balance_infos || []).find(x => x.currency === 'USD') || (j.balance_infos || [])[0];
        if (!info) return null;
        const total = Number(info.total_balance);
        return { texto: dinheiro(total, info.currency), curto: curto(total, info.currency), restante: total, moeda: info.currency,
          semSaldo: j.is_available === false || total <= 0, pct: null };
      }
      if (id === 'muse') {
        const [rk, rc] = await Promise.all([
          f()('https://openrouter.ai/api/v1/key', { headers: cab }),
          f()('https://openrouter.ai/api/v1/credits', { headers: cab }),
        ]);
        const k = rk.ok ? (await rk.json()).data || {} : {};
        const cr = rc.ok ? (await rc.json()).data || {} : {};
        let restante = null, pct = null;
        if (Number.isFinite(k.limit) && k.limit > 0) {
          restante = Number.isFinite(k.limit_remaining) ? k.limit_remaining : k.limit - (k.usage || 0);
          pct = Math.min(100, Math.max(0, (k.limit - restante) / k.limit * 100));
        } else if (Number.isFinite(cr.total_credits) && cr.total_credits > 0) {
          restante = cr.total_credits - (cr.total_usage || 0);
          pct = Math.min(100, Math.max(0, (cr.total_usage || 0) / cr.total_credits * 100));
        }
        if (restante == null) return rk.ok || rc.ok ? { texto: 'Sem teto', curto: '', restante: null, moeda: 'USD', pct: null } : { erro: rk.status };
        return { texto: dinheiro(restante, 'USD'), curto: curto(restante, 'USD'), restante, moeda: 'USD', semSaldo: restante <= 0, pct };
      }
    } catch { /* rede: a tela fica com o último número */ }
    return null;
  }

  /* Liga o OmniRoute se ainda não estiver de pé (o mesmo que o claude-plus faz). Espera até 40 s. */
  async function garantirOmni() {
    const no = async () => { try { const r = await f()(OMNI.statusUrl, { signal: AbortSignal.timeout(2500) }); return r.status < 500; } catch { return false; } };
    if (await no()) return true;
    const bin = path.join(HOME, '.nvm', 'versions', 'node');
    let omni = '';
    try { const v = fs.readdirSync(bin).sort().pop(); omni = path.join(bin, v, 'bin', 'omniroute'); } catch {}
    if (!omni || !fs.existsSync(omni)) return false;
    const log = fs.openSync(path.join(HOME, '.omniroute', 'server.log'), 'a');
    const amb = buildEnv ? buildEnv() : process.env;
    const filho = (spawnFn || require('child_process').spawn)(omni, ['serve'], {
      detached: true, stdio: ['ignore', log, log], env: { ...amb, PATH: path.dirname(omni) + ':' + (amb.PATH || '') } });
    if (filho && filho.unref) filho.unref();
    for (let i = 0; i < 40; i++) { await new Promise(r => setTimeout(r, 1000)); if (await no()) return true; }
    return false;
  }

  return { ler, validar, salvar, remover, ambiente, testar, saldo, chaveDe, lerTudo, ehGratis, garantirOmni };
}

module.exports = { PROVEDORES, ehProvedor, criarProvedores, mascara };
