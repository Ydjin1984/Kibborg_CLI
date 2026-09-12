---
name: Bug report
about: Сообщить о дефекте в kibborg
title: "[bug] "
labels: bug
assignees: ''
---

## Что произошло

Коротко: что вы сделали и что получили.

## Как воспроизвести

1. Команда: `kibborg …`
2. Режим: интерактивный / `--fullscreen` / headless `-p` / `serve` + `attach`
3. Дальнейшие шаги

## Ожидаемое поведение

Что должно было произойти.

## Окружение

| Поле | Значение |
|---|---|
| Версия | вывод `kibborg version` |
| ОС и терминал | Windows Terminal / PowerShell 7 / WSL / macOS Terminal / iTerm |
| Node.js | вывод `node --version` |
| pnpm | вывод `pnpm --version` |

## Диагностика

- `kibborg doctor` (можно `--json`) — приложите вывод;
- кадр TUI: `node Kibborg_CLI/tests/frame-render.mjs --boot-ms 45000 --send "<ваша команда>"` → приложите `tests/frame.txt`;
- логи: `KIBBORG_TRACE=1 kibborg …` (трассировка решений и клавиш).

## Дополнительно

Скриншоты, вывод ошибок, заметки о том, воспроизводится ли стабильно.
