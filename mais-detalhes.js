/* "Mais detalhes" de um trecho (26/09, pedido dele, igual ao app do Codex): ele seleciona um pedaço
   da resposta, clica "Mais detalhes" e abre uma janelinha que explica aquele ponto e aceita perguntas
   sobre ele, EM PARALELO ao trabalho do chat principal — sem entrar na conversa de lá nem esperar ela.
   Cada pergunta é uma chamada avulsa ao Claude pelo login dele: sem gravar sessão
   (não vira conversa na lista), sem ferramenta, sem MCP e sem o CLAUDE.md da casa (resposta rápida).
   O contexto vai colado: o fim da conversa do chat, a resposta onde está o trecho, o trecho e o que já
   foi perguntado na janelinha. Vale para os 4 chats (o motor do chat não importa: quem explica é o
   Claude). */
const MAX_CONVERSA = 16000, MAX_RESPOSTA = 8000, MAX_TRECHO = 1500, MAX_JANELA = 8000;
const MAX_PERGUNTA = 12000;

function validarEntrada(d) {
  if (typeof d.pergunta !== 'undefined' && typeof d.pergunta !== 'string') return 'A pergunta precisa ser um texto.';
  if ((d.pergunta || '').length > MAX_PERGUNTA) return 'A pergunta passou de 12.000 caracteres. Divida em perguntas menores.';
  if (typeof d.trecho !== 'string' || !d.trecho.trim()) return 'Sem trecho.';
  if (d.trecho.length > MAX_TRECHO) return 'O trecho passou de 1.500 caracteres. Selecione um trecho menor.';
  let total = d.trecho.length + (d.pergunta || '').length;
  if (d.resposta != null && typeof d.resposta !== 'string') return 'A resposta precisa ser um texto.';
  total += (d.resposta || '').length;
  for (const campo of ['conversa', 'janela']) {
    if (d[campo] == null) continue;
    if (!Array.isArray(d[campo]) || d[campo].length > 128) return 'O contexto ficou grande demais. Abra os detalhes novamente.';
    for (const item of d[campo]) {
      if (!item || typeof item !== 'object' || typeof item.texto !== 'string') return 'O contexto contém uma mensagem inválida.';
      total += item.texto.length + String(item.quem || item.de || '').length;
      if (total > 512000) return 'O contexto ficou grande demais. Abra os detalhes de um trecho menor.';
    }
  }
  return total > 512000 ? 'O contexto ficou grande demais. Abra os detalhes de um trecho menor.' : '';
}

function ambienteDoDetalhe(base) {
  const env = { ...base };
  // Esta chamada usa o login local, nunca credenciais/roteamento de API herdados do app.
  for (const k of Object.keys(env)) {
    if (/^(?:ANTHROPIC_|AWS_|AZURE_|GOOGLE_|GCLOUD_|VERTEX_|CLOUD_ML_)/i.test(k)
      || /^CLAUDE_CODE_(?:USE_|API_KEY)/i.test(k)) delete env[k];
  }
  return env;
}

function contaDeAssinatura(conta) {
  // Claude 2.1.283 também diz authMethod="claude.ai" para a chave API salva
  // pelo login Console. apiKeySource distingue essa cobrança do OAuth local.
  return !!conta && conta.loggedIn === true && conta.authMethod === 'claude.ai'
    && conta.apiProvider === 'firstParty'
    && (conta.apiKeySource === undefined || conta.apiKeySource === 'none');
}

const SISTEMA = 'Você explica UM trecho de uma conversa de trabalho entre uma pessoa e uma IA, numa '
  + 'janelinha ao lado do chat. Não mexe no trabalho: só explica e responde perguntas sobre aquele ponto. '
  + 'Português do Brasil, palavras simples (termo técnico ganha explicação curta entre parênteses). '
  + 'Resultado na primeira linha, curto (até umas 150 palavras), sem travessão, sem repetir o trecho. '
  + 'Use o contexto da conversa. Se o contexto não basta para responder, diga o que falta em uma linha.';

const PRIMEIRA = 'Explique com mais detalhes este trecho: o que ele quer dizer aqui e por que importa.';

const corta = (t, n) => { const s = String(t || '').trim(); return s.length > n ? '…' + s.slice(-n) : s; };

function montarPedido({ conversa, resposta, trecho, janela, pergunta } = {}) {
  const t = String(trecho || '').trim().slice(0, MAX_TRECHO);
  if (!t) return '';
  const hist = (Array.isArray(conversa) ? conversa : [])
    .map(h => '### ' + (h.quem || '?') + ':\n' + String(h.texto || '').trim().slice(0, 3000)).join('\n\n');
  const jan = (Array.isArray(janela) ? janela : [])
    .map(m => (m.de === 'eu' ? 'Ele perguntou: ' : 'Você respondeu: ') + String(m.texto || '').trim()).join('\n\n');
  return [
    hist ? 'Conversa do chat (o fim dela):\n' + corta(hist, MAX_CONVERSA) : '',
    resposta ? 'Resposta onde está o trecho:\n' + corta(resposta, MAX_RESPOSTA) : '',
    'Trecho selecionado:\n"' + t + '"',
    jan ? 'O que já foi conversado nesta janelinha:\n' + corta(jan, MAX_JANELA) : '',
    'Pergunta agora: ' + (String(pergunta || '').trim() || PRIMEIRA),
  ].filter(Boolean).join('\n\n');
}

/* Sonnet: rápido o bastante para uma pergunta lateral e bom de explicação. Raciocínio desligado. */
function argsDoDetalhe() {
  return ['-p', '--model', 'sonnet', '--no-session-persistence',
    '--setting-sources', '', '--strict-mcp-config', '--tools', '',
    '--settings', '{"alwaysThinkingEnabled":false,"forceLoginMethod":"claudeai"}',
    '--system-prompt', SISTEMA];
}

module.exports = { montarPedido, argsDoDetalhe, validarEntrada, ambienteDoDetalhe, contaDeAssinatura, MAX_PERGUNTA, PRIMEIRA, SISTEMA };
