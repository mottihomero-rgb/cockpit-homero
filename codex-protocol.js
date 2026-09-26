'use strict';

// Adaptação do protocolo app-server. Funções puras para poder conferir o contrato
// sem ligar o motor, consumir cota ou alterar a configuração do usuário.
const path = require('path');

function decodeOutput(value, encoded = false) {
  if (Array.isArray(value)) return Buffer.from(value).toString('utf8');
  if (typeof value !== 'string') return '';
  if (!encoded) return value;
  const compact = value.replace(/\s/g, '');
  if (!compact || !/^[A-Za-z0-9+/]*={0,2}$/.test(compact) || compact.length % 4 === 1) return value;
  const bytes = Buffer.from(compact, 'base64');
  if (bytes.toString('base64').replace(/=+$/, '') !== compact.replace(/=+$/, '')) return value;
  return bytes.toString('utf8');
}

function normalizeSettings(previous = {}, changes = {}) {
  const result = { ...previous };
  for (const key of ['model', 'cwd', 'approval', 'effort', 'serviceTier', 'experimentalContext', 'collaborationMode']) {
    if (changes[key] !== undefined && changes[key] !== null) result[key] = changes[key];
  }
  result.serviceTier = result.serviceTier === 'fast' ? 'priority' : (['default', 'priority'].includes(result.serviceTier) ? result.serviceTier : '');
  const mode = result.collaborationMode && typeof result.collaborationMode === 'object' ? result.collaborationMode.mode : result.collaborationMode;
  result.collaborationMode = mode === 'plan' || result.approval === 'plan' ? 'plan' : 'default';
  result.experimentalContext = result.experimentalContext === true;
  result.contextMode = result.experimentalContext ? 'experimental' : 'standard';
  return result;
}

function threadConfig(settings) {
  return {
    'features.context_management.experimental_mode': settings.experimentalContext === true,
    ...(settings.effort ? { model_reasoning_effort: settings.effort } : {}),
  };
}

function sandboxPolicy(sandbox, cwd) {
  if (sandbox === 'danger-full-access') return { type: 'dangerFullAccess' };
  if (sandbox === 'read-only') return { type: 'readOnly' };
  return { type: 'workspaceWrite', writableRoots: cwd ? [cwd] : [], networkAccess: false };
}

function turnSettings(settings, policy) {
  const result = {
    ...(settings.model ? { model: settings.model } : {}),
    ...(settings.effort ? { effort: settings.effort } : {}),
    ...(settings.cwd ? { cwd: settings.cwd } : {}),
    approvalPolicy: policy.policy,
    // null explicito: o turno seguinte na MESMA thread precisa desligar o revisor
    // automatico quando o modo deixou de ser "revisado"
    approvalsReviewer: policy.reviewer || null,
    sandboxPolicy: sandboxPolicy(policy.sandbox, settings.cwd),
    ...(settings.serviceTier ? { serviceTier: settings.serviceTier } : {}),
  };
  if (settings.model) result.collaborationMode = {
    mode: settings.collaborationMode || 'default',
    settings: { model: settings.model, reasoning_effort: settings.effort || null, developer_instructions: null },
  };
  return result;
}

const IMAGE_MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };
function userInput(text, attachments = [], { fs, destination = 'local' } = {}) {
  const input = [];
  if (typeof text === 'string' && text.trim()) input.push({ type: 'text', text });
  for (const file of attachments || []) {
    if (!file || typeof file.path !== 'string' || !file.path) throw new Error('Anexo sem caminho. Cole ou anexe o arquivo novamente.');
    const ext = path.extname(file.path).slice(1).toLowerCase();
    const mime = IMAGE_MIME[ext];
    if (mime) {
      if (!fs || !fs.existsSync(file.path)) throw new Error('Não encontrei a imagem: ' + path.basename(file.path));
      if (destination === 'local') input.push({ type: 'localImage', path: path.resolve(file.path) });
      else {
        // O caminho do Mac não existe na VPS. A imagem segue no próprio pedido.
        const stat = fs.statSync(file.path);
        if (stat.size > 20 * 1024 * 1024) throw new Error('A imagem é grande demais para enviar à VPS (máximo 20 MB).');
        input.push({ type: 'image', url: 'data:' + mime + ';base64,' + fs.readFileSync(file.path).toString('base64') });
      }
    } else {
      if (destination !== 'local' && !file.path.startsWith(destination + ':')) {
        throw new Error('Este arquivo está no Mac. Envie para um chat local ou anexe o caminho do arquivo na VPS.');
      }
      const filePath = destination === 'local' ? file.path : file.path.slice(destination.length + 1);
      // Preserva a lista já montada por versões antigas da interface.
      if (!(text || '').includes(file.path)) input.push({ type: 'text', text: 'Arquivo anexado pelo usuário: ' + filePath });
    }
  }
  if (!input.length) throw new Error('Escreva uma mensagem ou anexe um arquivo.');
  return input;
}

function answersFor(questions, answers, allowEmpty = false) {
  const result = {};
  for (const q of questions || []) {
    let value = answers && answers[q.id];
    if (value && !Array.isArray(value) && typeof value === 'object') value = value.answers;
    if (typeof value === 'string') value = [value];
    value = Array.isArray(value) ? value.filter(x => typeof x === 'string' && x.trim()).map(x => x.trim()) : [];
    if (!value.length && !allowEmpty) throw new Error('Responda à pergunta: ' + (q.header || q.question || q.id));
    result[q.id] = { answers: value };
  }
  if (!Object.keys(result).length && !allowEmpty) throw new Error('Este pedido não tem perguntas válidas.');
  return result;
}

function validateContent(schema, content) {
  if (!content || typeof content !== 'object' || Array.isArray(content)) throw new Error('Preencha os dados solicitados.');
  for (const key of schema && schema.required || []) {
    if (content[key] === undefined || content[key] === null || content[key] === '') throw new Error('Preencha o campo: ' + key);
  }
  for (const [key, value] of Object.entries(content)) {
    const spec = schema && schema.properties && schema.properties[key];
    if (!spec) {
      if (schema && schema.additionalProperties === false) throw new Error('Campo não solicitado: ' + key);
      continue;
    }
    if (spec.type === 'string' && typeof value !== 'string' || spec.type === 'boolean' && typeof value !== 'boolean' || spec.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value)) || spec.type === 'integer' && !Number.isInteger(value) || spec.type === 'array' && !Array.isArray(value)) throw new Error('Valor inválido no campo: ' + key);
    if (spec.enum && !spec.enum.includes(value)) throw new Error('Escolha uma opção válida: ' + key);
    if (typeof value === 'string' && (spec.minLength != null && value.length < spec.minLength || spec.maxLength != null && value.length > spec.maxLength)) throw new Error('Tamanho inválido no campo: ' + key);
    if (typeof value === 'number' && (spec.minimum != null && value < spec.minimum || spec.maximum != null && value > spec.maximum)) throw new Error('Número fora do limite: ' + key);
  }
  return content;
}

function requestResponse(request, data) {
  if (request.kind === 'input') return { answers: answersFor(request.questions, data.answers, data.action === 'cancel') };
  if (request.kind === 'elicitation') {
    const action = data.action;
    if (!['accept', 'decline', 'cancel'].includes(action)) throw new Error('Escolha confirmar ou cancelar.');
    return { action, ...(action === 'accept' && request.mode !== 'url' ? { content: validateContent(request.schema, data.content) } : { content: null }) };
  }
  /* "Sempre permitir" (data.sempre): vale para a conversa inteira, nunca mais do que isso — o
     escopo "session" do próprio Codex (acceptForSession; no protocolo antigo approved_for_session).
     Sem o "sempre", tudo continua exatamente como era. */
  const sempre = data.allow === true && data.sempre === true;
  if (request.kind === 'perm') return { permissions: data.allow === true ? request.permissions || {} : {}, scope: sempre ? 'session' : 'turn' };
  if (request.kind === 'cmd' || request.kind === 'file') return {
    decision: request.legacy
      ? (data.allow === true ? (sempre ? 'approved_for_session' : 'approved') : { denied: { rejection: 'Negado pelo usuário' } })
      : (data.allow === true ? (sempre ? 'acceptForSession' : 'accept') : 'decline'),
  };
  throw new Error('Tipo de pedido não suportado.');
}

function imageData(item) {
  const raw = item.result || '';
  let url = '';
  if (/^data:image\/(png|jpeg|webp|gif);base64,/i.test(raw) || /^https?:\/\//i.test(raw)) url = raw;
  else if (raw && /^[A-Za-z0-9+/\s]+={0,2}$/.test(raw)) url = 'data:image/png;base64,' + raw.replace(/\s/g, '');
  return { id: item.id, path: item.savedPath || '', url, prompt: item.revisedPrompt || '', status: item.status || '', error: item.failure || null };
}

/* Imagens dentro do resultado de uma ferramenta MCP, no formato do protocolo:
   { type:'image', mimeType, data } (o Claude usa source.base64; os dois cabem aqui).
   Mesmos tetos do main.js: 3 MB por imagem, 4 por resultado. */
const LIM_IMG_HIST = 3 * 1024 * 1024;
function imagensDoConteudo(valor) {
  const lista = Array.isArray(valor) ? valor
    : (valor && Array.isArray(valor.content) ? valor.content : []);
  const out = [];
  // conta quantas sumiram por tamanho, igual a imagensDoResultado do main.js, pra nao
  // sumir calado quando reabre uma conversa antiga
  out.descartadas = 0;
  for (const x of lista) {
    if (!x || x.type !== 'image') continue;
    const dados = (x.source && x.source.type === 'base64' && x.source.data) || x.data || '';
    if (!dados || typeof dados !== 'string') continue;
    if (dados.length > LIM_IMG_HIST) { out.descartadas++; continue; }
    out.push({ mime: (x.source && x.source.media_type) || x.mimeType || 'image/png', dados });
    if (out.length >= 4) break;
  }
  return out;
}

function historyItem(item) {
  if (!item) return null;
  if (item.type === 'userMessage') {
    const text = (item.content || []).filter(x => x.type === 'text').map(x => x.text || '').join('\n');
    const attachments = (item.content || []).filter(x => ['localImage', 'image', 'localAudio', 'audio'].includes(x.type)).map(x => ({ path: x.path || '', url: x.url || '', nome: x.path ? path.basename(x.path) : 'Imagem anexada', mini: /^data:image\//.test(x.url || '') ? x.url : undefined }));
    return { role: 'user', text, attachments, anexos: attachments };
  }
  if (item.type === 'agentMessage') return { role: 'bot', text: item.text || '', phase: item.phase || '' };
  if (item.type === 'plan') return { role: 'plan', kind: 'plan', text: item.text || '', id: item.id };
  if (item.type === 'imageGeneration') return { role: 'image', kind: 'generated-image', ...imageData(item) };
  if (item.type === 'commandExecution') return { role: 'tool', name: 'Terminal', arg: item.command || '', output: item.aggregatedOutput || '' };
  if (item.type === 'fileChange') return { role: 'tool', name: 'Editando arquivo', arg: (item.changes || []).map(x => x.path || '').join(', ') };
  if (item.type === 'webSearch') return { role: 'tool', name: 'Pesquisando na web', arg: item.query || '' };
  /* Resultado de MCP que trouxe imagem (print). Sem isto o JSON.stringify abaixo joga o
     base64 inteiro dentro do passo: megabytes de texto que ninguem le e que ainda tem de
     atravessar o cano do IPC toda vez que a conversa e' remontada. Aqui o payload da imagem
     sai do texto e vira a lista `imagens`; todo resultado SEM imagem segue pelo ramo
     original, intocado, logo abaixo. */
  if (item.type === 'mcpToolCall' || item.type === 'dynamicToolCall') {
    const conteudo = item.result != null ? item.result : item.contentItems;
    const imagens = imagensDoConteudo(conteudo);
    const blocos = Array.isArray(conteudo) ? conteudo : (conteudo && Array.isArray(conteudo.content) ? conteudo.content : []);
    const texto = blocos.filter(x => x && x.type === 'text' && typeof x.text === 'string').map(x => x.text).join('\n');
    if (imagens.length || imagens.descartadas) {
      // mesmo padrao do main.js (partes.join): junta as contagens em vez de deixar
      // '(0 imagens)' passar quando a unica imagem foi cortada por tamanho e nao sobrou texto
      const partes = [];
      if (imagens.length) partes.push(imagens.length === 1 ? '1 imagem' : imagens.length + ' imagens');
      if (imagens.descartadas) partes.push((imagens.descartadas === 1 ? '1 imagem' : imagens.descartadas + ' imagens') + ' grande(s) demais para mostrar');
      return {
        role: 'tool',
        name: [item.server, item.tool].filter(Boolean).join(' · '),
        arg: typeof item.arguments === 'string' ? item.arguments : JSON.stringify(item.arguments || {}),
        output: texto || '(' + partes.join(', ') + ')',
        ...(imagens.length ? { imagens } : {}),
      };
    }
  }
  if (item.type === 'mcpToolCall' || item.type === 'dynamicToolCall') return { role: 'tool', name: [item.server, item.tool].filter(Boolean).join(' · '), arg: typeof item.arguments === 'string' ? item.arguments : JSON.stringify(item.arguments || {}), output: item.result != null ? JSON.stringify(item.result) : (item.contentItems ? JSON.stringify(item.contentItems) : '') };
  if (item.type === 'collabAgentToolCall') return { role: 'tool', name: 'Time de agentes', arg: item.prompt || item.tool || '' };
  if (item.type === 'functionCallOutput') return { role: 'tool', name: item.name || 'Ferramenta', arg: '', output: typeof item.output === 'string' ? item.output : JSON.stringify(item.output) };
  return null;
}

/* ---------- Apps do ChatGPT ----------
   Sao os conectores da CONTA (valem em qualquer computador), nao os MCP instalados aqui.
   Duas chamadas ao app-server dizem coisas diferentes: `app/list` e' o catalogo do que existe
   na conta, `app/installed` e' o que ja esta ligado nesta maquina. Estas duas funcoes sao
   puras de proposito: da' pra conferir o contrato sem ligar motor nem gastar cota. */
function appStatus(app, runtime) {
  if (!app.isAccessible) return 'Indisponível nesta conta';
  if (runtime && runtime.callable) return 'Pronto para usar';
  if ((runtime && !runtime.enabled) || app.isEnabled === false) return 'Desligado';
  if (runtime) return 'Ligado, mas sem ferramenta disponível';
  return 'Disponível para instalar';
}

function mergeApps(listResponse, installedResponse) {
  const listed = listResponse && Array.isArray(listResponse.data) ? listResponse.data : [];
  const installed = installedResponse && Array.isArray(installedResponse.apps) ? installedResponse.apps : [];
  const runtimeById = new Map(installed.map((app) => [String(app.id), app]));
  const seen = new Set();
  const result = listed.map((app) => {
    const id = String(app.id || '');
    const runtime = runtimeById.get(id);
    seen.add(id);
    return {
      id,
      nome: String(app.name || (runtime && runtime.runtimeName) || id),
      desc: String(app.description || ''),
      acessivel: !!app.isAccessible,
      habilitado: runtime ? !!runtime.enabled : app.isEnabled !== false,
      instalado: !!runtime,
      chamavel: !!(runtime && runtime.callable),
      status: appStatus(app, runtime),
      installUrl: String(app.installUrl || ''),
      logo: String(app.logoUrl || ''),
    };
  });
  // instalado aqui mas fora do catalogo (a conta perdeu o acesso, ou o App saiu da lista):
  // sumir com ele da tela seria esconder algo que continua ligado nesta maquina
  for (const runtime of installed) {
    const id = String(runtime.id || '');
    if (!id || seen.has(id)) continue;
    result.push({
      id,
      nome: String(runtime.runtimeName || id),
      desc: '',
      acessivel: true,
      habilitado: !!runtime.enabled,
      instalado: true,
      chamavel: !!runtime.callable,
      status: runtime.callable ? 'Pronto para usar' : (runtime.enabled ? 'Ligado, mas sem ferramenta disponível' : 'Desligado'),
      installUrl: '',
      logo: '',
    });
  }
  return result;
}

module.exports = { decodeOutput, normalizeSettings, threadConfig, turnSettings, userInput, answersFor, requestResponse, imageData, historyItem, appStatus, mergeApps };
