#!/bin/sh
# install.sh — установка CLI `kibborg` на Linux/macOS.
#
# Создаёт в каталоге-префиксе исполняемый шим `kibborg`, который запускает собранный
# `apps/cli/lib/bin.js` этого репозитория, и при необходимости дописывает префикс в PATH
# (строка `export PATH="<prefix>:$PATH"` добавляется в ~/.profile, если её там ещё нет).
# Администратор не нужен, системные каталоги не затрагиваются.
#
# Параметры:
#   --prefix DIR   каталог для шима (по умолчанию $HOME/.local/bin)
#   --skip-build   не запускать pnpm run build
#   --no-path      не изменять ~/.profile
#   --dry-run      только показать, что будет сделано
#
# Примеры:
#   sh Kibborg_CLI/install.sh
#   sh Kibborg_CLI/install.sh --prefix "$HOME/bin" --no-path

set -eu

PREFIX="${HOME}/.local/bin"
SKIP_BUILD=false
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
    --skip-build) SKIP_BUILD=true; shift ;;
    --no-path) NO_PATH=true; shift ;;
    --dry-run) DRY_RUN=true; shift ;;
    -h|--help)
      sed -n '2,20p' "$0"
      exit 0
      ;;
    *)
      echo "Неизвестный параметр: $1" >&2
      exit 2
      ;;
  esac
done

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
BIN="${SCRIPT_DIR}/apps/cli/lib/bin.js"

echo "Установка kibborg в ${PREFIX}"

if ! command -v node >/dev/null 2>&1; then
  echo "Ошибка: Node.js не найден. Нужен Node.js 22.19 или новее." >&2
  exit 1
fi
NODE_VERSION=$(node --version)
NODE_MAJOR=$(printf '%s' "$NODE_VERSION" | sed -E 's/^v([0-9]+)\..*/\1/')
NODE_MINOR=$(printf '%s' "$NODE_VERSION" | sed -E 's/^v[0-9]+\.([0-9]+).*/\1/')
if [ "$NODE_MAJOR" -lt 22 ] || { [ "$NODE_MAJOR" -eq 22 ] && [ "$NODE_MINOR" -lt 19 ]; }; then
  echo "Ошибка: нужен Node.js 22.19 или новее, установлен ${NODE_VERSION}." >&2
  exit 1
fi
echo "Node.js: ${NODE_VERSION}"

if [ ! -f "$BIN" ]; then
  if [ "$SKIP_BUILD" = true ]; then
    echo "Ошибка: сборка не найдена (${BIN}). Соберите проект: pnpm run build (в ${SCRIPT_DIR})." >&2
    exit 1
  fi
  if [ "$DRY_RUN" = true ]; then
    echo "Сборка была бы запущена: pnpm run build (в ${SCRIPT_DIR})"
  else
    echo "Сборка не найдена, запускаю pnpm run build…"
    ( cd "$SCRIPT_DIR" && pnpm run build )
  fi
fi
if [ ! -f "$BIN" ]; then
  echo "Ошибка: после сборки файл всё ещё отсутствует: ${BIN}" >&2
  exit 1
fi

if [ "$DRY_RUN" = true ]; then
  echo "Каталог был бы создан: ${PREFIX}"
  echo "Был бы создан файл: ${PREFIX}/kibborg"
else
  mkdir -p "$PREFIX"
  cat > "${PREFIX}/kibborg" <<EOF
#!/bin/sh
# Запуск собранного kibborg из ${SCRIPT_DIR}.
exec node "${BIN}" "\$@"
EOF
  chmod +x "${PREFIX}/kibborg"
  echo "Создан ${PREFIX}/kibborg"
fi

if [ "$NO_PATH" = true ]; then
  echo "PATH не изменялся (--no-path)"
else
  PROFILE="${HOME}/.profile"
  LINE="export PATH=\"${PREFIX}:\$PATH\""
  if [ -f "$PROFILE" ] && grep -Fqx "$LINE" "$PROFILE"; then
    echo "PATH уже настроен в ${PROFILE}"
  elif [ "$DRY_RUN" = true ]; then
    echo "В ${PROFILE} была бы добавлена строка: ${LINE}"
  else
    printf '\n# kibborg\n%s\n' "$LINE" >> "$PROFILE"
    echo "Добавлено в ${PROFILE}: ${LINE}"
    echo "Откройте новый терминал или выполните: . ${PROFILE}"
  fi
fi

echo "Установка завершена. Проверка: kibborg version"
