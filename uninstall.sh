#!/bin/sh
# uninstall.sh — удаление шима `kibborg`, созданного install.sh.
#
# Удаляет `<prefix>/kibborg` и (если не задан --no-path) строку добавления префикса
# из ~/.profile. Ничего вне префикса не удаляется.
#
# Параметры:
#   --prefix DIR   каталог с шимом (по умолчанию $HOME/.local/bin)
#   --no-path      не изменять ~/.profile
#   --dry-run      только показать, что будет сделано
#
# Пример:
#   sh Kibborg_CLI/uninstall.sh

set -eu

PREFIX="${HOME}/.local/bin"
NO_PATH=false
DRY_RUN=false

while [ $# -gt 0 ]; do
  case "$1" in
    --prefix)
      if [ $# -lt 2 ]; then
        echo "Ошибка: --prefix требует значение" >&2
        exit 2
      fi
      PREFIX="$2"
      shift 2
      ;;
    --no-path) NO_PATH=true; shift ;;
    --dry-run) DRY_RUN=true; shift ;;
    -h|--help)
      sed -n '2,14p' "$0"
      exit 0
      ;;
    *)
      echo "Неизвестный параметр: $1" >&2
      exit 2
      ;;
  esac
done

echo "Удаление kibborg из ${PREFIX}"

if [ -f "${PREFIX}/kibborg" ]; then
  if [ "$DRY_RUN" = true ]; then
    echo "Был бы удалён ${PREFIX}/kibborg"
  else
    rm -f "${PREFIX}/kibborg"
    echo "Удалён ${PREFIX}/kibborg"
  fi
else
  echo "Шима в ${PREFIX} нет — удалять нечего."
fi

if [ "$NO_PATH" = true ]; then
  echo "PATH не изменялся (--no-path)"
  echo "Удаление завершено."
  exit 0
fi

PROFILE="${HOME}/.profile"
LINE="export PATH=\"${PREFIX}:\$PATH\""
if [ ! -f "$PROFILE" ]; then
  echo "Файл ${PROFILE} отсутствует — PATH не изменялся."
  exit 0
fi
if grep -Fqx "$LINE" "$PROFILE"; then
  if [ "$DRY_RUN" = true ]; then
    echo "Из ${PROFILE} была бы удалена строка: ${LINE}"
  else
    # Копия без нашей строки уходит на место оригинала: sed -i не переносим,
    # потому что GNU и BSD расходятся в его аргументах.
    tmp="${PROFILE}.kibborg.$$"
    grep -Fvx "$LINE" "$PROFILE" > "$tmp"
    mv "$tmp" "$PROFILE"
    echo "Из ${PROFILE} удалена строка: ${LINE}"
  fi
else
  echo "В ${PROFILE} нет строки kibborg — PATH не изменялся."
fi

echo "Удаление завершено."
