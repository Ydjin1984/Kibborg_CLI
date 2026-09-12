#!/usr/bin/env bash
# Разворачивает Kibborg CLI внутри монорепозитория harness и собирает его.
#
# Kibborg CLI использует пакеты `@deepseek-ai/dsh-*` из монорепозитория harness через `workspace:^`,
# поэтому ему нужна такая раскладка:
#
#   <Kiborg>/
#   ├── packages/     ← harness
#   ├── vendor/       ← harness
#   └── Kibborg_CLI/  ← этот репозиторий
#
# Скрипт клонирует (или обновляет) harness, копирует туда этот репозиторий, ставит зависимости,
# собирает обе части и (если не задан --no-install) создаёт команду `kibborg` через install.sh.
#
# Использование:
#   sh scripts/bootstrap.sh [--target ~/Kibborg] [--repo URL] [--ref master] [--skip-build] [--no-install] [--force]
set -eu

TARGET="${HOME}/Kibborg"
REPO="https://github.com/Ydjin1984/DeepSeek_Kibborg_Harness.git"
REF="master"
SKIP_BUILD=false
NO_INSTALL=false
FORCE=false

while [ $# -gt 0 ]; do
  case "$1" in
    --target) TARGET="$2"; shift 2 ;;
    --repo) REPO="$2"; shift 2 ;;
    --ref) REF="$2"; shift 2 ;;
    --skip-build) SKIP_BUILD=true; shift ;;
    --no-install) NO_INSTALL=true; shift ;;
    --force) FORCE=true; shift ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "Неизвестный параметр: $1" >&2; exit 2 ;;
  esac
done

SOURCE="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
CLI="${TARGET}/Kibborg_CLI"

need() {
  command -v "$1" >/dev/null 2>&1 || { echo "Не найден $1. Установите его и повторите." >&2; exit 1; }
}

echo "Kibborg CLI → ${TARGET}"
need git
need node
need pnpm

NODE_VERSION="$(node --version)"
NODE_MAJOR="$(printf '%s' "$NODE_VERSION" | sed -E 's/^v([0-9]+)\..*/\1/')"
NODE_MINOR="$(printf '%s' "$NODE_VERSION" | sed -E 's/^v[0-9]+\.([0-9]+).*/\1/')"
if [ "$NODE_MAJOR" -lt 22 ] || { [ "$NODE_MAJOR" -eq 22 ] && [ "$NODE_MINOR" -lt 19 ]; }; then
  echo "Нужен Node.js 22.19 или новее, установлен ${NODE_VERSION}" >&2
  exit 1
fi
echo "Node.js ${NODE_VERSION}, pnpm $(pnpm --version)"

if [ -d "${TARGET}/.git" ]; then
  echo "Обновляю harness…"
  git -C "$TARGET" fetch --depth 1 origin "$REF"
  git -C "$TARGET" checkout "$REF"
  git -C "$TARGET" pull --ff-only origin "$REF"
else
  echo "Клонирую harness…"
  mkdir -p "$TARGET"
  git clone --depth 1 --branch "$REF" "$REPO" "$TARGET"
fi

if [ -d "$CLI" ] && [ "$FORCE" = true ]; then
  rm -rf "$CLI"
fi

echo "Копирую Kibborg CLI в раскладку…"
mkdir -p "$CLI"
( cd "$SOURCE" && tar --exclude=node_modules --exclude=lib --exclude=.git --exclude=.dsh --exclude=coverage -cf - . ) | ( cd "$CLI" && tar -xf - )

if [ "$SKIP_BUILD" = true ]; then
  echo "Файлы разложены, сборка пропущена (--skip-build)."
  exit 0
fi

echo "Ставлю зависимости монорепо (это может занять несколько минут)…"
( cd "$TARGET" && pnpm install )
( cd "$TARGET" && pnpm run build )
( cd "$CLI" && pnpm run build )

if [ "$NO_INSTALL" = false ]; then
  echo "Создаю команду kibborg…"
  ( cd "$CLI" && sh install.sh )
fi

cat <<EOF

Готово.
  Раскладка:      ${TARGET}
  Точка входа:    ${CLI}/apps/cli/lib/bin.js
$( [ "$NO_INSTALL" = false ] && printf '  Проверка:       kibborg version   (после перезапуска терминала)\n' )
  Первый запуск:  kibborg "объясни, что делает этот репозиторий"
  Нужен ключ:     DEEPSEEK_API_KEY либо \$DSH_HOME/.credentials.yaml
  Сервер:         kibborg serve --port 7317 --token <секрет>  →  kibborg attach http://127.0.0.1:7317 --token <секрет>
EOF
