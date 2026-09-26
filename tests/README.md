# Contratos do Cockpit com o Codex

Executar: `node --test tests/astra-contract.test.cjs`.

`main-harness.cjs` avalia o `main.js` inteiro e seus módulos locais em uma VM.
Não extrai funções por recorte de texto e não substitui os handlers testados.
Electron, disco e subprocessos recebem implementações controladas; o transporte
JSONRPC é simulado, preservando `codexReq`, `codexIncoming` e `codexReply` reais.
O boot do aplicativo fica suspenso. Os testes não usam contas, chaveiro ou rede.

Os schemas em `fixtures/protocolo` são cópias dos contratos oficiais extraídos
do Codex CLI 0.153.4, já registrados na auditoria de 07/09/2026, em
`Revisão do Astra no Cockpit - 07-09-2026/evidencias/protocolo`. A validação usa o AJV
disponível entre as dependências de desenvolvimento do projeto.

Para guardar a evidência resumida, definir `COCKPIT_TEST_EVIDENCE` com o caminho
de um JSON fora da pasta de código. A evidência distingue testes de contrato
sintéticos de testes operacionais com o motor real.

## Auditoria de estabilidade de 26/09/2026

- `npm test`: suíte Node completa e os dois protocolos ACP simulados. Inclui
  regressões de busca, gravação, aprovações, cancelamento, histórico e processos.
- `npm run test:ui`: Chromium real nos quatro tamanhos de tela, desenho por mouse
  e toque, mais cenários de perguntas, Torre, conta, recuperação de contexto, detalhes e
  criação/organização de chats em HTTP.
- `npm run test:electron`: main/preload/IPC reais com motores simulados e dados
  em pasta temporária. `COCKPIT_QA_SOURCE` permite apontar para o conteúdo de um
  app.asar, carregado no Electron de desenvolvimento para permitir isolamento
  das contas e dos subprocessos. A abertura operacional após instalar é separada.
- `COCKPIT_QA_OUT` escolhe a pasta das capturas e evidências visuais.

As provas de processos Unix e navegador precisam de subprocessos, PTY e portas
locais. Não usam IA real, chaveiro, logout/login nem serviços pagos. Os dados do
app instalado são preservados. Testar em navegador móvel não substitui conferir
Safari em um iPhone físico; Windows e permissões de câmera/microfone também
exigem validação própria no ambiente correspondente.

Históricos grandes cedem execução entre blocos, mas uma única linha JSON gigante
ainda exige interpretação síncrona. A primeira indexação do Gemini é linear e
usa cache nas leituras seguintes. Miniaturas ACP usam o arquivo original do anexo.

O aviso sonoro é centralizado em `som-conclusao.js`. `som-conclusao.test.cjs` cobre
os quatro motores, cancelamento, duplicatas, retomada automática, fila, player e
fechar/reabrir a janela. O áudio é simulado na suíte para não produzir alertas a
cada teste. O WAV original do Codex fica fora do ASAR como extraResource no Mac.
