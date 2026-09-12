#!/usr/bin/env bash
# Ночной запуск Kibborg CLI из cron.
#
# Контракт, на который опирается скрипт: stdout — результат, stderr — диагностика,
# exit 0 — успех, 1 — ошибка прогона (в том числе исчерпанный --max-turns),
# 2 — ошибка окружения, 3 — модель ждёт решения (cron ответить не может).
set -euo pipefail

REPO="${KIBBORG_REPO:-$HOME/Deepseec_DaVinchi}"
LOG_DIR="${KIBBORG_LOG_DIR:-$HOME/.kibborg/logs}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$LOG_DIR/digest-$STAMP.json"

mkdir -p "$LOG_DIR"

cd "$REPO"

# Задача идёт из файла: так её правит человек, а не строка cron.
cat > /tmp/kibborg-nightly-prompt.txt <<'PROMPT'
Собери короткий дайджест: какие изменения в репозитории появились за сутки,
что выглядит рискованным, и какие тесты стоит прогнать.
PROMPT

set +e
node Kibborg_CLI/apps/cli/lib/bin.js \
  -p \
  --prompt-file /tmp/kibborg-nightly-prompt.txt \
  --output-format json \
  --max-turns 3 \
  --no-session-persistence \
  > "$OUT" 2> "$LOG_DIR/digest-$STAMP.err"
CODE=$?
set -e

case "$CODE" in
  0) echo "ok: $OUT" ;;
  1) echo "прогон завершился ошибкой; подробности в $LOG_DIR/digest-$STAMP.err" >&2; exit 1 ;;
  2) echo "окружение не готово: проверьте kibborg doctor" >&2; exit 2 ;;
  3) echo "модель ждёт ответа: добавьте --question-answers с заготовленными ответами" >&2; exit 3 ;;
  *) echo "неожиданный код $CODE" >&2; exit "$CODE" ;;
esac

# Держим последние 14 дайджестов, чтобы каталог не рос бесконечно.
ls -1t "$LOG_DIR"/digest-*.json 2>/dev/null | tail -n +15 | xargs -r rm -f

# Пример строки cron (запуск в 03:17 каждую ночь):
#   17 3 * * * /home/user/Deepseec_DaVinchi/Kibborg_CLI/examples/cron-kibborg.sh >> /home/user/.kibborg/cron.log 2>&1
