/* A mesma interface e os mesmos históricos do Mac, pelo Tailscale.
   No modo protegido, só escuta no próprio Mac: o Tailscale entrega a conexão ali. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const cacheArq = new Map();
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.json': 'application/json', '.ico': 'image/x-icon' };

/* O que o telefone PODE pedir ao Mac. E a mesma lista que o renderer/web.js usa, ou seja,
   tudo que a tela do celular realmente faz — e nada alem disso. Antes valia qualquer nome de
   comando do app: quem descobrisse a senha nao via so as conversas, rodava o que quisesse aqui.
   Ficaram de fora de proposito os que abrem um terminal de verdade no Mac (term:run, term:input,
   term:resize, term:kill) e o shell:open, que manda o Finder abrir um caminho — e abrir um .app
   e rodar programa. Pelo celular esses cinco agora respondem "so funciona no Mac".
   Mexeu no renderer/web.js? Ponha o nome novo aqui tambem, senao o telefone nao alcanca. */
const PERMITIDOS = new Set([
  'config:get', 'sys:home', 'fs:list', 'fs:read', 'fs:buscarArquivos',
  'pane:start', 'pane:send', 'pane:respond', 'pane:perguntas', 'pane:plano', 'pane:settings', 'pane:steer',
  'pane:compactar', 'pane:interrupt', 'pane:stop', 'pane:approve',
  // so LEITURA (R2-012): o celular usa isso so pra reconciliar no reconnect, nunca muda nada no Mac
  'pane:estado',
  'codex:models', 'codex:api-status', 'codex:apps',
  'sessions:claude', 'sessions:codex', 'sessions:cli', 'sessions:acp', 'sessions:history',
  'sessions:titulo', 'sessions:buscar', 'sessions:claudeRemoto', 'sessions:historyRemoto',
  'sessao:renomear', 'sessao:nomeCurto', 'sessao:donoNome', 'sessao:fork',
  // a costura das conversas quando se troca de IA (ler e gravar; apagar so no Mac)
  'ligacoes:ler', 'ligacoes:gravar',
  'acp:config', 'skills:list', 'prompts:ler', 'prompts:salvar',
  'anexo:ler', 'imagem:salvar', 'ocr:ler',
  // ditar do celular: ele grava pelo microfone DELE e o Mac so passa o texto a limpo,
  // igual ao ocr:ler da foto. Sem este nome aqui o audio era gravado e jogado fora.
  'voz:transcrever',
  'quadro:salvar', 'quadro:rascunhoGravar', 'quadro:rascunhoLer',
  'arquivo:ver', 'arquivo:verVps', 'term:linhaShell',
  'conta:ler', 'uso:ler', 'agentes:claude', 'agentes:nomes', 'git:status', 'git:diff',
  'motores:versoes', 'motores:disponiveis', 'rotinas:listar',
  'mcp:list', 'mcp:acao', 'auth:acao',
  /* Estes tres a tela do celular OFERECE no menu, e sem eles aqui o toque so respondia
     "so funciona no Mac". Nenhum abre terminal: config:claude so LE e devolve contagem
     (nao volta chave nem senha), arquivo:desfazer volta uma edicao que o agente ja fez e
     recusa se o arquivo mudou depois, e vault:salvar grava a conversa no Obsidian. Quem
     entrou com a senha ja manda o agente escrever arquivo pelo pane:send: estes tres nao
     abrem porta nova nenhuma. */
  'config:claude', 'arquivo:desfazer', 'vault:salvar',
]);

/* A sessao era procurada solta no meio do texto dos cookies: 'ck=' casa dentro de
   'track=abc123', e o servidor lia o valor errado — o telefone ficava pedindo senha mesmo ja
   logado. Agora o nome do cookie tem de comecar de verdade (no inicio ou logo depois do ';')
   e o valor tem o tamanho certo do nosso token. */
const pegarSessao = (cabecalho) =>
  (String(cabecalho || '').match(/(?:^|;\s*)ck=([a-f0-9]{64})(?:;|$)/) || [])[1];

function ipDaRede() {
  for (const lista of Object.values(os.networkInterfaces())) {
    for (const i of lista || []) if (i.family === 'IPv4' && !i.internal) return i.address;
  }
  return '127.0.0.1';
}

/* ===================== foto e video do telefone (rota /upload) =====================
   Antes TODO anexo do celular ia pelo WebSocket, em base64, e morria de tres jeitos: base64
   engorda o arquivo um terco, o quadro do WebSocket tem teto, e o Mac ainda precisava segurar
   o paredao inteiro na memoria antes de gravar. Video de 1m47 nao passava de jeito nenhum.
   Aqui o arquivo desce direto para o disco enquanto chega. */

const LIMITE_UPLOAD = 500 * 1024 * 1024;   // teto generoso, mas existe: 500 MB

/* Onde o print colado ja mora hoje: userData/colados, a mesma pasta do imagem:salvar do
   main.js, com a mesma faxina automatica de 7 dias. Quem chama criar() pode mandar o caminho
   pronto (os testes mandam); dentro do app a gente pergunta ao Electron, igual o main faz. */
function pastaDeColados(caminho) {
  if (caminho) return String(caminho);
  try {
    const { app } = require('electron');
    if (app && typeof app.getPath === 'function') return path.join(app.getPath('userData'), 'colados');
  } catch {}
  return path.join(os.homedir(), 'Library', 'Application Support', 'cockpit', 'colados');
}

/* O que os primeiros bytes DIZEM que o arquivo e'. O nome e a extensao que vem do telefone
   nao valem nada (num nome cabe "../../" e um ".mov" pode ser qualquer coisa por dentro),
   entao o tipo sai daqui. Cobre o que um iPhone manda: foto (png, jpg, gif, webp, heic) e
   video (mov, mp4, webm). */
function tipoPelosBytes(b) {
  if (b.length < 12) return '';
  const txt = (i, f) => b.subarray(i, f).toString('latin1');
  if (txt(0, 8) === '\x89PNG\r\n\x1a\n') return 'png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (txt(0, 4) === 'GIF8') return 'gif';
  if (txt(0, 4) === 'RIFF' && txt(8, 12) === 'WEBP') return 'webp';
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'webm';
  if (txt(4, 8) === 'ftyp') {            // familia do .mov/.mp4/.heic: a marca vem logo depois
    const marca = txt(8, 12);
    if (marca === 'qt  ') return 'mov';
    if (['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1', 'heim', 'heis'].includes(marca)) return 'heic';
    return 'mp4';
  }
  return '';
}

/* Quando o navegador manda o arquivo dentro de um formulario (multipart), ele embrulha:
   uma linha de fronteira, os cabecalhos do campo, uma linha em branco, o arquivo, e a
   fronteira de novo no fim. Esta funcao devolve so' o miolo, pedaco por pedaco, sem nunca
   juntar o arquivo inteiro na memoria. Guarda so' o rabinho de cada pedaco, porque a
   fronteira pode chegar partida entre dois. */
function cortadorMultipart(fronteira) {
  if (!fronteira || fronteira.length > 200 || /[\r\n]/.test(fronteira)) throw new Error('fronteira inválida');
  const marca = Buffer.from('\r\n--' + fronteira);
  let fase = 'cabecalho', resto = Buffer.alloc(0), acabou = false;
  const cortar = (entrada) => {
    if (acabou) return Buffer.alloc(0);
    resto = resto.length ? Buffer.concat([resto, entrada]) : entrada;
    if (fase === 'cabecalho') {
      const i = resto.indexOf('\r\n\r\n');                  // a linha em branco abre o arquivo
      if (i < 0) {
        if (resto.length > 16384) throw new Error('formulario estranho');
        return Buffer.alloc(0);
      }
      if (i > 16384 || !resto.subarray(0, i).toString('latin1').startsWith('--' + fronteira + '\r\n')) throw new Error('formulario estranho');
      resto = resto.subarray(i + 4); fase = 'corpo';
    }
    // Bytes parecidos dentro de um vídeo não são uma fronteira. Só termina
    // quando também chegaram os dois bytes que fecham/separam o campo.
    let f = resto.indexOf(marca);
    while (f >= 0 && resto.length >= f + marca.length + 2) {
      const sufixo = resto.subarray(f + marca.length, f + marca.length + 2).toString('latin1');
      if (sufixo === '--' || sufixo === '\r\n') {
        acabou = true; const saida = resto.subarray(0, f); resto = Buffer.alloc(0); return saida;
      }
      f = resto.indexOf(marca, f + 1);
    }
    const guardar = Math.min(resto.length, marca.length + 1);
    const saida = resto.subarray(0, resto.length - guardar);
    resto = resto.subarray(resto.length - guardar);
    return saida;
  };
  cortar.terminou = () => acabou;
  return cortar;
}

// pagina de outro site nao fala com o Cockpit. O cookie ja e' SameSite=Strict; isto e' o
// cinto de seguranca do suspensorio, o mesmo cuidado que o WebSocket ja toma la embaixo.
const mesmaOrigem = (req, endereco = '') => {
  const o = String(req.headers.origin || '');
  if (!o) return true;                   // pedido sem origem nao nasceu na pagina de outro site
  try {
    const origem = new URL(o);
    if (!['http:', 'https:'].includes(origem.protocol)) return false;
    // O Tailscale recebe HTTPS e entrega HTTP no loopback. A origem pública
    // continua HTTPS, mesmo que o proxy reescreva o Host para 127.0.0.1.
    if (origem.host === String(req.headers.host || '')) return true;
    try { return origem.origin === new URL(endereco).origin; } catch { return false; }
  } catch { return false; }
};

/* POST /upload — recebe UM arquivo e grava em colados/, escrevendo enquanto recebe.
   O corpo pode vir dos dois jeitos que o navegador usa: o arquivo cru
   (fetch('/upload', { method: 'POST', body: arquivo })) ou um formulario multipart com o
   arquivo no primeiro campo. Devolve { arquivo: "/caminho/no/mac" } — o mesmo formato do
   imagem:salvar, para o renderer/web.js so' trocar de porta de entrada. */
function receberUpload(req, res, { temSessao, pasta, endereco }) {
  const responder = (status, corpo, fechar) => {
    if (res.headersSent) return;
    const cab = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
    if (fechar) {
      cab.Connection = 'close';
      cab['Content-Length'] = Buffer.byteLength(JSON.stringify(corpo));
      // fecha a torneira DEPOIS que a resposta sai. Sem isto o Mac continuaria engolindo os
      // 500 MB que ja recusou, e o telefone veria a conexao cair em vez de ler o aviso.
      res.on('finish', () => { try { req.destroy(); } catch {} });
    }
    res.writeHead(status, cab);
    res.end(JSON.stringify(corpo));
  };
  // toda recusa fecha a conexao: o arquivo ja esta subindo e nao adianta deixar o resto chegar
  if (req.method !== 'POST') return responder(405, { error: 'use POST' }, true);
  if (!temSessao) return responder(401, { error: 'sessão expirada, entre de novo no Cockpit' }, true);
  if (!mesmaOrigem(req, endereco)) return responder(403, { error: 'origem inválida' }, true);

  const grande = 'arquivo grande demais (o limite é 500 MB)';
  const soFotoVideo = 'só foto ou vídeo (png, jpg, gif, webp, heic, mov, mp4, webm)';
  if (Number(req.headers['content-length'] || 0) > LIMITE_UPLOAD) return responder(413, { error: grande }, true);

  const tipo = String(req.headers['content-type'] || '');
  const fronteira = (tipo.match(/boundary=(?:"([^"]+)"|([^;]+))/i) || []).slice(1).find(Boolean);
  if (/^multipart\//i.test(tipo) && !fronteira) return responder(400, { error: 'não entendi o formulário' }, true);
  let cortar; try { cortar = fronteira ? cortadorMultipart(fronteira.trim()) : (p) => p; }
  catch { return responder(400, { error: 'não entendi o formulário' }, true); }

  let fluxo = null, destino = '', cabeca = Buffer.alloc(0), total = 0, falhou = false, pronto = false;
  // conexao cortada no meio (ele saiu do app, o Wi-Fi trocou) nao pode deixar meio video na pasta
  const limpar = () => {
    const f = fluxo; fluxo = null;
    if (f) { try { f.destroy(); } catch {} }
    if (destino) { try { fs.unlinkSync(destino); } catch {} destino = ''; }
  };
  const desistir = (status, msg) => { if (falhou) return; falhou = true; limpar(); responder(status, { error: msg }, true); };

  req.on('data', (parte) => {
    if (falhou || pronto) return;
    let dados; try { dados = cortar(parte); } catch { return desistir(400, 'não entendi o formulário'); }
    total += dados.length;
    if (total > LIMITE_UPLOAD) return desistir(413, grande);
    if (!dados.length) return;
    if (!fluxo) {
      cabeca = cabeca.length ? Buffer.concat([cabeca, dados]) : dados;
      if (cabeca.length < 12) return;                        // ainda nao da para saber o que e'
      const ext = tipoPelosBytes(cabeca);
      if (!ext) return desistir(415, soFotoVideo);
      try {
        fs.mkdirSync(pasta, { recursive: true });
        const raiz = fs.realpathSync(pasta);
        // o nome nasce AQUI. Nada do que veio do telefone entra nele: e' por nome de fora que
        // se escapa da pasta com ../../
        const nome = 'celular-' + Date.now() + '-' + crypto.randomBytes(4).toString('hex') + '.' + ext;
        const caminho = path.resolve(raiz, nome);
        // e ainda assim confere DEPOIS de resolver: tem de cair dentro de colados/
        if (path.dirname(caminho) !== raiz) return desistir(400, 'caminho inválido');
        // 'wx' = so' cria arquivo novo; nunca sobrescreve nem segue atalho plantado ali
        // Abre antes de aceitar mais dados: abortar enquanto o open assíncrono
        // ainda estava na fila deixava um arquivo vazio depois da limpeza.
        const fd = fs.openSync(caminho, 'wx');
        destino = caminho;
        fluxo = fs.createWriteStream(destino, { fd });
        fluxo.on('error', () => desistir(500, 'não consegui gravar o arquivo no Mac'));
      } catch { return desistir(500, 'não consegui gravar o arquivo no Mac'); }
      dados = cabeca; cabeca = Buffer.alloc(0);
    }
    // segura a torneira quando o disco fica para tras (video grande)
    if (!fluxo.write(dados)) { req.pause(); fluxo.once('drain', () => { try { req.resume(); } catch {} }); }
  });

  req.on('end', () => {
    if (falhou || pronto) return;
    if (cortar.terminou && !cortar.terminou()) return desistir(400, 'o arquivo chegou incompleto; tente anexar de novo');
    if (!fluxo) return desistir(400, cabeca.length ? soFotoVideo : 'não chegou nenhum arquivo');
    pronto = true;
    const f = fluxo, caminho = destino; fluxo = null;
    f.end(() => responder(200, { arquivo: caminho, bytes: total }));
  });

  const abortou = () => { if (pronto || falhou) return; falhou = true; limpar(); };
  req.on('aborted', abortou);
  req.on('error', abortou);
  res.on('close', abortou);
}

function criar({ pastaRenderer, handlers, ouvintes, porta, senha, aoLog, somenteTailscale = false, endereco = '', pastaColados = '' }) {
  const { WebSocketServer } = require('ws');
  // R2-041: o main.js sobe com endereco placeholder e troca depois (web.endereco = end),
  // ja que o tailscale responde so depois do boot. Antes esse valor ficava preso no
  // PARAMETRO 'endereco' (fechamento fixo): mesmaOrigem() e receberUpload() nunca viam a
  // troca e o celular ficava travado pra sempre com "origem invalida". Agora e uma variavel
  // que o getter/setter do retorno atualiza, calculada uma unica vez aqui na criacao.
  let enderecoAtual = endereco || (somenteTailscale ? '' : ('http://' + ipDaRede() + ':' + porta));
  const sessoes = new Map();
  const tentativas = new Map();
  const clientes = new Set();
  let encerrado = false;
  const VIDA_SESSAO = 8 * 60 * 60 * 1000;
  const JANELA_TENTATIVAS = 15 * 60 * 1000;
  const MAX_TENTATIVAS = 5;
  const ip = (req) => String(req.socket && req.socket.remoteAddress || 'desconhecido');
  const ipTailscale = (enderecoIp) => {
    const v = String(enderecoIp || '').replace(/^::ffff:/, '');
    const p = v.split('.').map(Number);
    return p.length === 4 && p[0] === 100 && p[1] >= 64 && p[1] <= 127;
  };
  // O Tailscale em userspace (Homebrew no Mac) e o Serve entregam a conexão
  // por loopback. Exigir IP 100.x aqui barrava inclusive o iPhone autorizado.
  // Aceitar loopback SÓ é seguro junto do listen em 127.0.0.1 abaixo: a LAN
  // continua sem conseguir chegar ao servidor. Não confiar em headers de proxy.
  const redePermitida = (req) => !somenteTailscale || ipTailscale(ip(req))
    || ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip(req));
  const igual = (a, b) => {
    const x = Buffer.from(String(a || ''));
    const y = Buffer.from(String(b || ''));
    return x.length === y.length && crypto.timingSafeEqual(x, y);
  };
  const sessaoValida = (token) => {
    const ate = sessoes.get(token);
    if (!ate || ate < Date.now()) { sessoes.delete(token); return false; }
    return true;
  };
  const podeTentar = (endereco) => {
    const item = tentativas.get(endereco);
    if (!item || item.inicio + JANELA_TENTATIVAS < Date.now()) return true;
    return item.total < MAX_TENTATIVAS;
  };
  const falhou = (endereco) => {
    const anterior = tentativas.get(endereco);
    const item = (!anterior || anterior.inicio + JANELA_TENTATIVAS < Date.now())
      ? { inicio: Date.now(), total: 0 } : anterior;
    item.total += 1; tentativas.set(endereco, item);
  };
  // Le o corpo do POST da tela de senha. Teto pequeno de proposito: aqui so passa "s=<senha>",
  // e assim ninguem enche a memoria do Mac mandando um corpo gigante.
  const lerCorpo = (req, pronto) => {
    let txt = '';
    req.on('data', (p) => { if (txt.length <= 4096) txt += p; });
    req.on('end', () => pronto(new URLSearchParams(txt.length > 4096 ? '' : txt)));
  };
  const paginaLogin = (res, status, errou, detalhe = '') => {
    res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(paginaSenha(errou, detalhe));
  };

  const arquivoDaTela = (nome) => {
    try {
      const raiz = fs.realpathSync(pastaRenderer);
      const alvo = fs.realpathSync(path.join(raiz, nome));
      const relativo = path.relative(raiz, alvo);
      if (!relativo || relativo === '..' || relativo.startsWith('..' + path.sep) || path.isAbsolute(relativo)) return null;
      return fs.statSync(alvo).isFile() ? alvo : null;
    } catch { return null; }
  };
  const servidor = http.createServer((req, res) => {
    if (encerrado) { res.writeHead(503); return res.end('acesso desligado'); }
    let url;
    try { url = new URL(req.url, 'http://x'); }
    catch { res.writeHead(400); return res.end('endereco invalido'); }
    if (!redePermitida(req)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end('Abra pelo Tailscale para proteger seu Mac.');
    }
    // entrada com senha
    if (url.pathname === '/entrar') {
      // A senha vinha DENTRO do endereco (/entrar?s=...): ficava no historico do Safari, na
      // sugestao da barra do iPhone, no backup do iCloud e em qualquer log de rede do caminho.
      // Agora ela vem no corpo do POST. Endereco velho com a senha colada nao entra mais:
      // e ignorado e so devolve para a porta de entrada.
      if (req.method !== 'POST') {
        res.writeHead(302, { Location: '/', 'Cache-Control': 'no-store' });
        return res.end();
      }
      // R3-053: /upload e o WebSocket ja conferem a origem; aqui faltava — uma pagina de outro
      // site com um <form> escondido conseguia mandar POST de senha sem passar por isto. Pedido
      // sem cabeçalho Origin continua passando (mesmaOrigem ja trata isso), so a origem ERRADA e barrada.
      if (!mesmaOrigem(req, enderecoAtual)) return paginaLogin(res, 403, true, 'Origem não permitida.');
      const endereco = ip(req);
      const jaDentro = sessaoValida(pegarSessao(req.headers.cookie));
      return lerCorpo(req, (campos) => {
        // A senha certa entra SEMPRE. Antes a trava de 5 erros era conferida ANTES dela: como
        // o Tailscale entrega todo mundo como 127.0.0.1, cinco erros de qualquer um (ou de uma
        // pagina aberta no navegador do Mac) deixavam o dono 15 minutos de fora do proprio Mac.
        if (igual(campos.get('s'), senha)) {
          const t = crypto.randomBytes(32).toString('hex');
          sessoes.set(t, Date.now() + VIDA_SESSAO);
          tentativas.delete(endereco);
          res.writeHead(302, { 'Set-Cookie': 'ck=' + t + '; Path=/; Max-Age=28800; HttpOnly; SameSite=Strict', Location: '/' });
          return res.end();
        }
        // agora a trava so pega quem erra a senha, e nem isso para quem ja tem sessao valida
        if (!jaDentro && !podeTentar(endereco)) {
          return paginaLogin(res, 429, true, 'Muitas senhas erradas. Espere 15 minutos, ou entre com a senha certa.');
        }
        falhou(endereco);
        paginaLogin(res, 401, true);
      });
    }
    // o telefone busca estes sem cookie; sao inofensivos
    if (['/manifest.json', '/icone-180.png', '/icone-512.png', '/favicon.ico'].includes(url.pathname)) {
      const pub = arquivoDaTela(url.pathname.replace(/^\//, ''));
      if (url.pathname === '/favicon.ico' || !pub) { res.writeHead(204); return res.end(); }
      return mandarArquivo(req, res, pub);
    }
    const t = pegarSessao(req.headers.cookie);
    // Foto e video do celular entram por aqui. Vem ANTES da pagina de senha porque quem perdeu
    // a sessao precisa receber um erro curto em JSON, e nao a tela de login inteira em HTML
    // (o app leria 200 "deu certo" e anexaria a pagina de login no lugar do video).
    if (url.pathname === '/upload') {
      return receberUpload(req, res, { temSessao: !!t && sessaoValida(t), pasta: pastaDeColados(pastaColados), endereco: enderecoAtual });
    }
    if (!t || !sessaoValida(t)) return paginaLogin(res, 200, false);

    let arq;
    try { arq = url.pathname === '/' ? 'index-web.html' : decodeURIComponent(url.pathname).replace(/^\//, ''); }
    catch { res.writeHead(400); return res.end('endereco invalido'); }
    const alvo = arquivoDaTela(arq);
    if (!alvo) { res.writeHead(404); return res.end('nao achei'); }
    mandarArquivo(req, res, alvo);
  });

  // 256 KB era pouco: o config do Mac tem mais de 2 MB (a foto de perfil em base64 sozinha
  // passa de 2 MB) e a conexao do telefone caia toda vez que uma mensagem grande passava.
  // 8 MB tambem estava errado, por um motivo mais chato: era MENOS que o teto de 9 MB do
  // imagem:salvar (main.js), entao um arquivo entre 8 e 9 MB DERRUBAVA a conexao em vez de
  // voltar o aviso "imagem grande demais". Agora o cano e' maior que o teto de la e quem
  // recusa e' sempre o main, com frase em portugues. Foto e video grandes nem passam por
  // aqui: vao pela rota /upload, que grava direto no disco.
  const wss = new WebSocketServer({ server: servidor, path: '/ws', maxPayload: 12 * 1024 * 1024 });
  wss.on('connection', (ws, req) => {
    ws.on('error', (e) => { aoLog && aoLog('erro do telefone: ' + ((e && e.message) || e)); });
    // Navegadores sempre informam a origem. Sem esta checagem, uma página aberta
    // no celular poderia tentar falar com o Cockpit usando a sessão já existente.
    if (!redePermitida(req)) { ws.close(1008, 'fora do Tailscale'); return; }
    if (!mesmaOrigem(req, enderecoAtual)) { ws.close(1008, 'origem invalida'); return; }
    const t = pegarSessao(req.headers.cookie);
    if (!t || !sessaoValida(t)) { ws.close(1008, 'sem sessao'); return; }
    ws.ck = t;                       // guarda a sessao deste telefone para reconferir depois
    clientes.add(ws); ouvintes.add(ws);
    aoLog && aoLog('telefone conectado');
    ws.on('close', () => { clientes.delete(ws); ouvintes.delete(ws); aoLog && aoLog('telefone saiu'); });
    ws.on('message', async (bruto) => {
      // A sessao era conferida uma unica vez, no aperto de mao. Quem ja estava conectado
      // nunca mais era checado: podia rodar comando no Mac para sempre, mesmo depois das
      // 8 horas de validade e mesmo depois de desligar o acesso pelo Wi-Fi nos Ajustes.
      if (!sessaoValida(ws.ck)) { try { ws.close(1008, 'sessao expirou'); } catch {} return; }
      let m; try { m = JSON.parse(bruto.toString()); } catch { return; }
      if (!m || typeof m !== 'object' || Array.isArray(m) || m.tipo !== 'chamada' || typeof m.nome !== 'string'
        || !(Number.isSafeInteger(m.id) || typeof m.id === 'string')) return;
      // So passa o que esta na lista PERMITIDOS la de cima. O resto nem chega no comando.
      if (!PERMITIDOS.has(m.nome)) {
        aoLog && aoLog('telefone pediu comando fora da lista: ' + m.nome);
        // mesma resposta que o renderer/web.js ja da nos comandos so do Mac: a tela avisa na
        // hora, em vez de o toque ficar dois minutos esperando uma resposta que nao vem
        try { ws.send(JSON.stringify({ tipo: 'resposta', id: m.id, resposta: { error: 'Este comando só funciona no Mac.' }, erro: null })); } catch {}
        return;
      }
      const fn = handlers[m.nome];
      let resposta = null, erro = null;
      try { resposta = fn ? await fn({ remoto: true, ip: ip(req) }, m.arg) : null; if (!fn) erro = 'comando desconhecido: ' + m.nome; }
      catch (e) { erro = String(e && e.message || e); }
      try { ws.send(JSON.stringify({ tipo: 'resposta', id: m.id, resposta, erro })); } catch {}
    });
  });

  // varre de minuto em minuto e fecha quem ja venceu, em vez de esperar o telefone
  // mandar alguma coisa para so entao descobrir que a sessao caiu
  const varredura = setInterval(() => {
    for (const ws of [...clientes]) {
      if (!sessaoValida(ws.ck)) { try { ws.close(1008, 'sessao expirou'); } catch {} ouvintes.delete(ws); }
    }
    for (const token of sessoes.keys()) sessaoValida(token);
    for (const [endereco, item] of tentativas) if (item.inicio + JANELA_TENTATIVAS < Date.now()) tentativas.delete(endereco);
  }, 60000);
  if (varredura.unref) varredura.unref();
  servidor.on('close', () => clearInterval(varredura));

  // O listen() e assincrono e nao havia ninguem ouvindo o erro dele. Com a porta 7788 ocupada,
  // criar() voltava dizendo "ligado", a tela mostrava endereco e senha, e o telefone nunca
  // conectava. Agora quem chama espera o "listening" de verdade e o erro vira frase em portugues.
  // A ordem importa: o on('error') generico vem ANTES do once, porque o close() de um servidor
  // que nunca escutou re-emite erro.
  servidor.on('error', (e) => { aoLog && aoLog('erro do servidor do telefone: ' + ((e && e.message) || e)); });
  // o ws se pendura no mesmo servidor e REPASSA o erro para si: sem ouvinte aqui, um
  // "porta ocupada" virava excecao nao tratada e derrubava o processo
  wss.on('error', (e) => { aoLog && aoLog('erro do canal do telefone: ' + ((e && e.message) || e)); });
  const pronto = new Promise((ok, deuErro) => {
    const limparInicio = () => {
      servidor.removeListener('listening', iniciou);
      servidor.removeListener('error', caiu);
      wss.removeListener('error', caiu);
    };
    const iniciou = () => { limparInicio(); ok(); };
    const caiu = (e) => {
      limparInicio();
      try { clearInterval(varredura); } catch {}
      try { wss.close(); } catch {}
      try { servidor.close(); } catch {}
      deuErro(new Error(e && e.code === 'EADDRINUSE'
        ? 'a porta ' + porta + ' ja esta sendo usada por outro programa'
        : ((e && e.message) || String(e))));
    };
    servidor.once('listening', iniciou);
    servidor.once('error', caiu);
    wss.once('error', caiu);
  });
  // O Node corta sozinho qualquer pedido que passe de 5 minutos. Um video de 100 MB subindo
  // pelo 4G leva mais que isso e morria no meio, sem explicacao. Os 15 minutos valem so' para
  // o corpo do pedido; o teto de 60 s para os cabecalhos continua igual, que e' o que segura
  // conexao de araque aberta de proposito.
  servidor.requestTimeout = 15 * 60 * 1000;
  servidor.listen(porta, somenteTailscale ? '127.0.0.1' : '0.0.0.0');

  // Desligar o acesso so parava de aceitar telefone NOVO: quem ja estava dentro continuava
  // com poder total sobre o Mac. Este fechar() derruba tambem as conexoes abertas.
  const fechar = () => {
    if (encerrado) return;
    encerrado = true;
    sessoes.clear(); tentativas.clear();
    clearInterval(varredura);
    for (const ws of [...clientes]) {
      try { ws.close(1001, 'acesso desligado'); } catch {}
      ouvintes.delete(ws);
      // Um telefone sem rede não responde ao fechamento. Isso não pode
      // manter o servidor antigo ocupando a porta depois de desligar.
      const limite = setTimeout(() => { if (ws.readyState !== 3) ws.terminate(); }, 1000);
      limite.unref?.(); ws.once('close', () => clearTimeout(limite));
    }
    try { wss.close(); } catch {}
    try { servidor.close(); } catch {}
    // Interrompe também um upload em andamento; seu tratador apaga o parcial.
    try { servidor.closeAllConnections(); } catch {}
  };

  return {
    servidor, fechar, pronto,
    // get/set em vez de campo fixo: main.js faz 'web.endereco = end' quando o tailscale
    // responde, e essa escrita precisa chegar em mesmaOrigem()/receberUpload() acima.
    get endereco() { return enderecoAtual; },
    set endereco(v) { enderecoAtual = v; },
  };
}

function mandarArquivo(req, res, arq) {
  // guarda em memoria, mas solta a copia velha assim que o arquivo muda,
  // senao o telefone fica vendo a tela antiga depois de atualizar o app
  let st; try { st = fs.statSync(arq); } catch { res.writeHead(404); return res.end('nao achei'); }
  const selo = st.mtimeMs + ':' + st.size;
  /* O mesmo selo (hora da ultima mudanca + tamanho) que solta a copia velha da memoria vira a
     etiqueta que o telefone guarda. Antes ia 'no-store' em tudo: o iPhone rebaixava ~900 KB a
     cada abertura e a tela ficava cinza quase um segundo. Agora ele pergunta "mudou?" e, se
     nao mudou, volta um 304 vazio.
     'no-cache' NAO e' "nao guarde": e' "guarde, mas pergunte antes de usar". Por isso nunca
     fica com versao velha — mexeu no arquivo, muda a hora, muda o selo, e ele baixa na hora. */
  const etiqueta = '"' + selo + '"';
  const trazida = String((req && req.headers && req.headers['if-none-match']) || '');
  if (trazida && trazida.split(',').some((x) => x.trim().replace(/^W\//, '') === etiqueta)) {
    res.writeHead(304, { ETag: etiqueta, 'Cache-Control': 'no-cache' });
    return res.end();
  }
  let item = cacheArq.get(arq);
  if (!item || item.selo !== selo) {
    try { item = { selo, dados: fs.readFileSync(arq) }; cacheArq.set(arq, item); }
    catch { res.writeHead(404); return res.end('nao achei'); }
  }
  res.writeHead(200, {
    'Content-Type': TIPOS[path.extname(arq)] || 'application/octet-stream',
    'Content-Length': item.dados.length,
    ETag: etiqueta,
    'Cache-Control': 'no-cache',
  });
  res.end(item.dados);
}

function paginaSenha(errou, detalhe = '') {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Cockpit">
<meta name="theme-color" content="#161617" media="(prefers-color-scheme: dark)">
<meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">
<link rel="manifest" href="/manifest.json"><link rel="apple-touch-icon" href="/icone-180.png">
<title>Cockpit</title><style>
/* As cores eram cravadas no escuro: quem usa o tema Claro tomava uma tela preta na cara e o
   app saltava para o branco logo depois. Agora a porta de entrada segue o aparelho, com a
   mesma paleta do app (os tokens do redesenho de 25/09, renderer/cockpit-tokens.css).
   O botao de entrar e a acao principal: azul do sistema, e nao mais a cor do Claude. */
:root{--fundo:#161617;--texto:rgba(255,255,255,.92);--tit:rgba(255,255,255,.92);--fraco:rgba(235,235,245,.62);
--campo:rgba(255,255,255,.075);--borda:rgba(255,255,255,.15);--acao:#0A84FF;--erro:#FF6961;--ajuda:rgba(235,235,245,.62)}
@media (prefers-color-scheme: light){
:root{--fundo:#ffffff;--texto:rgba(0,0,0,.88);--tit:rgba(0,0,0,.88);--fraco:rgba(40,40,48,.68);--campo:rgba(0,0,0,.055);
--borda:rgba(0,0,0,.15);--acao:#0071E3;--erro:#D70015;--ajuda:rgba(40,40,48,.68)}
}
body{margin:0;height:100dvh;display:grid;place-items:center;background:var(--fundo);color:var(--texto);
font:15px -apple-system,system-ui,sans-serif}
form{width:min(320px,86%);text-align:center}
h1{font-size:19px;color:var(--tit);margin:0 0 6px}p{color:var(--fraco);font-size:13px;margin:0 0 18px}
input{box-sizing:border-box;width:100%;padding:13px;border-radius:11px;border:1px solid var(--borda);background:var(--campo);
color:var(--texto);font-size:16px;outline:none;text-align:center}
input:focus{border-color:var(--acao)}
button{width:100%;margin-top:10px;padding:13px;border:0;border-radius:11px;background:var(--acao);
color:#fff;font-size:15px;font-weight:600}
.erro{color:var(--erro);font-size:12.5px;margin-top:10px}
details{margin-top:28px;color:var(--ajuda);font-size:13px;line-height:1.6}summary{cursor:pointer}details p{margin-top:10px}
</style></head><body><form action="/entrar" method="post">
<h1>Cockpit</h1><p>Digite a senha que aparece no Mac</p>
<input name="s" type="password" autocomplete="current-password" aria-label="Senha do Cockpit" placeholder="senha mostrada no Mac" required>
<button>Entrar</button>${errou ? '<div class="erro">' + (detalhe || 'Senha errada') + '</div>' : ''}
<details><summary>Instalar no iPhone</summary><p>No Safari, toque em Compartilhar e em Adicionar à Tela de Início. Ative Abrir como App da Web e toque em Adicionar.</p><p>As conversas ficam no Mac. Mantenha o Mac ligado e o Tailscale conectado.</p></details>
</form></body></html>`;
}

module.exports = { criar, ipDaRede };
