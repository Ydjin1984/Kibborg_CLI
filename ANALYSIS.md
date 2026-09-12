# АНАЛИЗ КЛИЕНТСКОЙ АРХИТЕКТУРЫ CLI/TUI

## РЕПОЗИТОРИЙ:

- Каталог: `D:\Deepseec_DaVinchi\Kibborg_CLI`
- Отдельный git-репозиторий (см. `git status --short` и `git branch --show-current`)
- Текущая ветка: `master`
- Последние коммиты: 03dcd6a443, 962540f0a7, 5be58bd98d, c50768b2f1, 02329d9981
- Структура: содержит `apps/cli`, `packages/tui`, `packages/client-node`, `bin`, `demo`, `tests`

## СТЕК:

- Язык: TypeScript/Node.js
- Основные зависимости из package.json:
  - `@deepseek-ai/dsh-app-boot`
  - `@deepseek-ai/dsh-base` 
  - `@deepseek-ai/dsh-cmdline`
  - `@deepseek-ai/dsh-home-paths`
  - `@deepseek-ai/dsh-launch-environment`
  - `@kibborg/cli-bundle`
  - `commander`
- TUI-библиотека: `@kibborg/tui`
- Транспорт: `InProcessApiClient(toFetchHandler(ctx.apiProxy))` — ноль сети, в одном процессе

## ТОЧКА ВХОДА и ЗАПУСК:

- Точка входа: `apps/cli/src/bin.ts` (точка входа `kibborg`)
- Путь исполнения: 
  1. `kibborg` вызывает `apps/cli/src/bin.ts`
  2. Парсинг аргументов через `parseKiborgArgs()`
  3. Запуск профиля через `runProfile()`
  4. Для интерактивного режима вызывается `runInteractive()` из `packages/client-node/src/repl.ts`
  5. Для одноразовой задачи вызывается `runTurn()` из `packages/client-node/src/turn.ts`

## ФАЙЛЫ РЕНДЕРИНГА:

- `packages/tui/src/render.ts`: основной рендеринг хода (user, tool, text, notice, error)
- `packages/tui/src/status.ts`: строка состояния и футер хода
- `packages/tui/src/composer.ts`: вводная зона (композер) с подсказками
- `packages/tui/src/zone.ts`: область отображения (композер + статус)
- `packages/client-node/src/repl.ts`: интерактивный цикл с перерисовкой нижней зоны
- `packages/client-node/src/turn.ts`: выполнение и рендеринг хода с обработкой событий

## ПРИЧИНА «ПЕЧАТНОЙ МАШИНКИ»:

- `packages/client-node/src/repl.ts`: строка 215, 251 - использование `cursorUp()` + `ERASE_DOWN` для перерисовки нижней зоны
- `packages/client-node/src/repl.ts`: строка 245-246 - установка позиции курсора для ввода
- `packages/tui/src/zone.ts`: функции `cursorUp()`, `cursorTo()`, `cursorColumn()` - для точной позиционировки
- `packages/tui/src/zone.ts`: константа `ERASE_DOWN`='\u001B[0J\r' - для полной очистки экрана

## ПАНЕЛИ/РАМКИ/ПУНКТИРЫ:

- Символы: `─│┌┐└┘═` и прочие ASCII-символы
- Используются в `UI.md` как дизайн-спека
- Формируются в `demo\golden\all-plain.txt` и `demo\kibborg-demo.bat` 
- Визуальные элементы: рамки вокруг меню, диалогов, статуса
- Ширина рассчитывается на основе `displayWidth` из `packages/tui/src/width.ts`

## ВВОД/МЫШЬ/СКРОЛЛ/RESIZE:

- Обработка ввода в raw-режиме через `stdin.setRawMode(true)` в `repl.ts`
- Парсинг клавиш в `packages/tui/src/input.ts` (функция `parseKeys`)
- Поддержка:
  - Стрелки вверх/вниз (в истории)
  - Tab (автодополнение)
  - Ctrl+C, Ctrl+D, Esc
  - Клавиши с модификаторами
  - Bracketed paste (Ctrl+Shift+V)
  - Перехват `SIGWINCH` через `process.stdout.columns`
- Обработка мыши отсутствует в текущей версии (описано как K4-фича)

## ТЕМА/БРЕНДИНГ:

- `packages/tui/src/tokens.ts`: цветовая схема с токенами (Accent, Success, Warn, Error, Muted, Subtle, Text, Surface, BashPink, PermLav)
- Темы: `ice` (по умолчанию) и `mono`
- `paletteForTheme()` выбирает палитру по теме
- `UI.md` §2 описывает токен-значения

## ТЕСТЫ:

- Файл: `tests/pty-commands.mjs` 
- Команды: `kibborg doctor`, `kibborg --help`
- Команды: `kibborg sessions`, `kibborg models`, `kibborg mcp`, `kibborg skills`
- Файл: `tests/pty-smoke.mjs` 
- Файл: `tests/pty-approval.mjs`
- Запуск тестов: `pnpm test`

## РИСКИ:

1. Отсутствие обработки событий мыши в текущей реализации
2. Ограниченная поддержка размеров окна (неполная реакция на SIGWINCH)
3. Форматирование текста в рендеринге не использует структурированные токены, только строки
4. Перерисовка нижней зоны может вызвать мигание при высокой нагрузке
5. Отсутствие поддержки полноэкранного режима (fullscreen) в текущей реализации
6. Синхронизация между вводом и рендерингом в интерактивном режиме
7. Не все интерфейсные элементы из `UI.md` реализованы в текущей версии