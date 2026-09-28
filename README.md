# Cockpit

Codex e Claude lado a lado, numa tela só. Roda no Mac e no Windows.

App de mesa (Electron) que abre vários painéis de terminal com agentes de IA rodando ao mesmo tempo. Dá pra falar com cada um, ver o gasto de tokens de cada conversa e continuar do celular pelo navegador.

## O que tem dentro

- **Painéis lado a lado** — Claude Code e Codex abertos juntos, cada um no seu terminal
- **Histórico de conversa** — as sessões ficam salvas e dá pra voltar nelas
- **Medidor de tokens** — mostra quanto da janela de contexto já foi usada
- **Acesso pelo celular** — liga um servidor local protegido por senha e você continua do iPhone, na mesma rede ou via Tailscale

## Instalar

Baixe o instalador na aba [Releases](../../releases/latest).

Antes, instale o que o Cockpit comanda (ele não traz as IAs dentro):
- **Node.js 22 ou mais novo** — [nodejs.org](https://nodejs.org)
- **Claude Code** — `npm install -g @anthropic-ai/claude-code`
- **Codex** (opcional) — `npm install -g @openai/codex`

Depois entre na sua conta pelo próprio Cockpit: **Ajustes › Contas › Vincular**.

### Mac (Apple Silicon: M1, M2, M3, M4)

1. Baixe o `Cockpit-...-Mac.dmg`, abra e arraste o Cockpit para **Aplicativos**.
2. Na primeira vez o Mac avisa que não conhece o desenvolvedor. Abra o **Terminal** e rode:
   ```bash
   xattr -cr /Applications/Cockpit.app
   ```
   Depois abra normalmente. (Ou: botão direito no app › Abrir › Abrir.)
3. Para o Cockpit enxergar todas as suas pastas: **Ajustes do Sistema › Privacidade e
   Segurança › Acesso Total ao Disco** › ligar o Cockpit. A permissão fica mesmo quando
   você instala uma versão nova.

### Windows (10 ou 11, 64 bits)

1. Baixe o `Cockpit-...-Windows.exe` e abra.
2. O Windows pode mostrar "O Windows protegeu o computador". Clique em **Mais informações ›
   Executar assim mesmo** (o app não tem certificado pago, é só isso).
3. Siga o instalador. O atalho aparece na Área de Trabalho e no Menu Iniciar.

No Windows ficam de fora só os recursos que dependem do macOS: ditado nativo e leitura de
texto em imagem (OCR). O resto é igual.

## Gerar uma versão nova

Mude o `version` do `package.json`, grave e suba uma etiqueta:

```bash
git tag v1.2.0
git push homero main v1.2.0
```

O GitHub monta sozinho o instalador do Mac e o do Windows e publica em Releases
(receita em `.github/workflows/instaladores.yml`).

## Rodar a partir do código

```bash
npm install
npm start
```

Precisa de Node.js 22.12+ e do Claude Code e/ou Codex CLI já instalados na máquina.

## Conferir antes de gerar o app

```bash
npm test
npm audit
npx playwright install chromium
npm run test:ui
npm run test:electron
```

Os testes de interface usam o Chromium real no computador, celular e tablet.
O teste nativo abre uma janela Electron com `main.js`, preload e IPC reais,
usando uma pasta temporária. Os motores de IA são simulados nos dois casos:
nenhuma conta, conversa ou serviço pago é acessado.

Para guardar capturas e resultados, definir `COCKPIT_QA_OUT` com uma pasta de
evidências. O teste nativo também aceita `COCKPIT_QA_SOURCE` apontando para o
`app.asar` gerado pelo build, para conferir o conteúdo efetivamente empacotado.

Electron está fixado na versão 43.7.3, que mantém a API de clipboard usada
pelo app. Atualizações de versão principal exigem repetir os testes nativos.

## Gerar o app

```bash
npm run build       # Mac
npm run build:win   # Windows
```

O resultado sai na pasta `dist/`.

## Segurança

O acesso pelo celular é desligado por padrão. Quando ligado, gera uma senha aleatória a cada instalação e escuta só na rede local (ou só no Tailscale, se você marcar). Nada de senha ou chave fica dentro deste repositório — as configurações ficam na pasta de dados do app, no seu computador.

## Licença

MIT — Homero Motti


