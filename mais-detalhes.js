/* "Mais detalhes" de um trecho (26/09, pedido dele, igual ao app do Codex): ele seleciona um pedaço
   da resposta, clica "Mais detalhes" e abre uma janelinha que explica aquele ponto e aceita perguntas
   sobre ele, EM PARALELO ao trabalho do chat principal — sem entrar na conversa de lá nem esperar ela.
   Cada pergunta é uma chamada avulsa ao Claude pelo login dele (sem custo por uso): sem gravar sessão
   (não vira conversa na lista), sem ferramenta, sem MCP e sem o CLAUDE.md da casa (resposta rápida).
   O contexto vai colado: o fim da conversa do chat, a resposta onde está o trecho, o trecho e o que já
   foi perguntado na janelinha. Vale para os 4 chats (o motor do chat não importa: quem explica é o
   Claude). */
const MAX_CONVERSA = 16000, MAX_RESPOSTA = 8000, MAX_TRECHO = 1500, MAX_JANELA = 8000;

const SISTEMA = 'Você explica UM trecho de uma conversa de trabalho entre o Homero e uma IA, numa '
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
function argsDoDetalhe(pedido) {
  return ['-p', '--model', 'sonnet', '--no-session-persistence',
    '--setting-sources', '', '--strict-mcp-config', '--tools', '',
    '--settings', '{"alwaysThinkingEnabled":false}',
    '--system-prompt', SISTEMA, String(pedido || '')];
}

module.exports = { montarPedido, argsDoDetalhe, PRIMEIRA, SISTEMA };
