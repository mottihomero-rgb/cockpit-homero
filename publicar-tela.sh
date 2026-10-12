#!/bin/bash
# publicar-tela.sh — publica mudança de TELA do Cockpit sem reiniciar o app.
#
# Uso:   publicar-tela.sh <pasta>            publica e recarrega a tela
#        publicar-tela.sh --ensaio <pasta>   faz tudo menos instalar (confere se o pacote monta)
#
# <pasta> espelha o app e traz SÓ os arquivos mudados, ex.:  <pasta>/renderer/app.js
# Só aceita arquivo dentro de renderer/. Mexeu em main.js, preload.js ou outro arquivo do
# motor: isso só entra reiniciando o app (receita completa, memória cockpit-build-e-assinatura).
#
# Grava nos DOIS lugares, nesta ordem:
#   1. no app.asar instalado (a verdade: é dele que qualquer build futuro parte)
#   2. na cópia viva (~/Library/Application Support/cockpit/tela-viva/renderer), que é o que
#      o app aberto lê, e encosta no arquivo "recarregar" para a tela recarregar sozinha.
# Sempre parte do app.asar INSTALADO, nunca de uma pasta de projeto (elas estão atrasadas).
set -u
ENSAIO=0; [ "${1:-}" = "--ensaio" ] && { ENSAIO=1; shift; }
ORIGEM="${1:-}"
APP=/Applications/Cockpit.app
R="$APP/Contents/Resources"
VIVA="$HOME/Library/Application Support/cockpit/tela-viva"
falha() { echo "PAROU: $*" >&2; exit 1; }

[ -d "$ORIGEM" ] || falha "informe a pasta com os arquivos mudados"
ORIGEM="$(cd "$ORIGEM" && pwd)"
ARQS=()
while IFS= read -r f; do ARQS+=("$f"); done < <(cd "$ORIGEM" && find . -type f ! -name .DS_Store | sed 's#^\./##' | sort)
[ "${#ARQS[@]}" -gt 0 ] || falha "a pasta está vazia"
for f in "${ARQS[@]}"; do
  case "$f" in renderer/*) ;; *) falha "$f não é da tela. Fora de renderer/ só entra reiniciando o app." ;; esac
  case "$f" in *.js) node --check "$ORIGEM/$f" || falha "erro de sintaxe em $f" ;; esac
done

B="$(mktemp -d /private/tmp/ck-tela.XXXXXX)" || falha "sem pasta temporária"
trap 'rm -rf "$B"' EXIT
mkdir "$B/orig" && cp "$R/app.asar" "$B/orig/" && cp -R "$R/app.asar.unpacked" "$B/orig/" || falha "não copiei o pacote instalado"
BASE="$(md5 -q "$B/orig/app.asar")"
cd "$B" || falha "cd"
npx --yes asar extract orig/app.asar ck || falha "não extraí o pacote"
npx asar list orig/app.asar | sort > antes.txt
for f in "${ARQS[@]}"; do mkdir -p "ck/$(dirname "$f")" && cp "$ORIGEM/$f" "ck/$f" || falha "não copiei $f"; done
npx asar pack ck app.asar --unpack-dir "node_modules/@lydell/{node-pty,node-pty-darwin-arm64}" || falha "não empacotei"
npx asar list app.asar | sort > depois.txt
# nada pode SUMIR do pacote; arquivo novo de tela pode entrar
SUMIU="$(comm -23 antes.txt depois.txt)"
[ -z "$SUMIU" ] || falha "arquivos sumiram do pacote: $SUMIU"
diff -rq orig/app.asar.unpacked app.asar.unpacked >/dev/null || falha "o node-pty fora do pacote saiu diferente"

if [ "$ENSAIO" = 1 ]; then echo "ENSAIO OK: ${#ARQS[@]} arquivo(s), pacote monta ($(stat -f %z app.asar) bytes). Nada foi instalado."; exit 0; fi

[ "$(md5 -q "$R/app.asar")" = "$BASE" ] || falha "outro chat publicou no meio. Rode de novo."
cp -p "$R/app.asar" "$R/app.asar.antes-tela-$(date +%d%m-%H%M%S)" || falha "sem cópia de segurança"
# trocar = renomear, nunca cp por cima com o app aberto
cp app.asar "$R/app.asar.novo" && mv "$R/app.asar.novo" "$R/app.asar" || falha "não troquei o pacote"
# guarda só as 3 últimas cópias de segurança deste script
ls -t "$R"/app.asar.antes-tela-* 2>/dev/null | tail -n +4 | while IFS= read -r v; do rm -f "$v"; done
codesign --force --sign - "$APP" >/dev/null 2>&1
printf 'designated => identifier "com.adsure.cockpit"\n' > "$B/ck.req"
codesign --force --sign - -r "$B/ck.req" "$APP" >/dev/null 2>&1
codesign -d -r- "$APP" 2>&1 | grep -q 'designated => identifier "com.adsure.cockpit"' || falha "a assinatura não ficou pelo nome: conferir o Acesso Total ao Disco"

if [ -f "$VIVA/renderer/index.html" ]; then
  for f in "${ARQS[@]}"; do mkdir -p "$VIVA/$(dirname "$f")" && cp "$ORIGEM/$f" "$VIVA/$f.novo" && mv "$VIVA/$f.novo" "$VIVA/$f" || falha "não gravei $f na cópia viva"; done
  date > "$VIVA/recarregar"
  echo "PUBLICADO: ${#ARQS[@]} arquivo(s). A tela recarrega sozinha em 1 segundo."
else
  echo "PUBLICADO no pacote: ${#ARQS[@]} arquivo(s). O app aberto ainda não usa a tela viva: entra ao reiniciar."
fi
