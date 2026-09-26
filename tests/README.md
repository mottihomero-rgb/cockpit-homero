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
