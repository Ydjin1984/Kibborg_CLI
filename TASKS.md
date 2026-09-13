# TASKS — Kibborg CLI

Реестр задач по фазам. Определения фаз, DoD и порядок — в `PLAN.md`. Статусы: `todo` / `in-progress` / `done` / `blocked`.

## Правила работы над задачами

1. Документы (`README.md`, `PLAN.md`, `TASKS.md`, `CHECKLIST.md`, `ARCHITECTURE.md`, `TROUBLESHOOTING.md`) — нулевой шаг, выполняется до любого кода.
2. **K0.0 — hard gate.** Пока нет отчёта K0.0 по шаблону, фазы K0+ не начинаются.
3. **Строгий объём K0.0:** только профиль, пустой cli-bundle, `client-node` и plain stdout. Запрещено в объёме K0.0: TUI, `/help`, `doctor`, шимы PATH, интерактивные промпты, полный парсер флагов.
4. **Приоритет исхода K0.0: (а) → (б) → (в).** (а) — клиентский слой работает в Node без правок ядра; (б) — тонкий слой поверх `IApiClient` + `ctx.typertGateway` без копирования протоколов; (в) — один аддитивный субпуть-export RPC-caller'а, только если (а) и (б) ломают Remote-контракт.
5. **Копирование `createWebConnectionRpc` (или его логики) запрещено.** Исход (в) сопровождается Agent Note по шаблону из `PLAN.md` §7.
6. Git-операции (commit, push, PR) выполняются только по отдельной просьбе пользователя.
7. Каждая фаза закрывается DoD-командой: фаза не считается готовой, если команда не проходит.

## Отчёт K0.0 (шаблон, заполняется дословно)

```
Исход: a | b | c
Модули с DOM: <пути или «нет»>
Нужен export: нет | имя+субпуть
kibborg "hello" TTY: ok/fail
kibborg "hello" pipe: ok/fail
tool-call smoke TTY: ok/fail
tool-call smoke pipe: ok/fail
Правки ядра: нет | список
```

## K0.0 — Vertical Slice (hard gate)

| ID | Статус | Задача | Зависит от | Артефакт | DoD-команда |
|---|---|---|---|---|---|
| K0.0.1 | done | Минимальный профиль `kibborg` + пустой cli-bundle + запуск дерева | нулевой шаг | `Kibborg_CLI/apps/cli`, `Kibborg_CLI/packages/cli-bundle`, `$DSH_HOME/profiles/kibborg` | дерево поднимается без ошибок |
| K0.0.2 | done | `@kibborg/client-node`: `InProcessApiClient`, `host.describe`, generic RPC-caller, подписка на mux | K0.0.1 | `Kibborg_CLI/packages/client-node` | `host.describe` отвечает, mux-фреймы печатаются |
| K0.0.3 | done | Проверка Node-исполнения клиентских плагинов и список DOM-модулей | K0.0.2 | `K0.0-REPORT.md` | список модулей с DOM либо «нет» |
| K0.0.4 | done | Два smoke-прогона в TTY и пайпе, решение по исходу | K0.0.3 | `K0.0-REPORT.md` | обе команды печатают ответ |

Smoke-прогоны:
- `kibborg "hello"` — доказывает CLI → Core → LLM → stream → stdout.
- `kibborg "прочитай README.md и кратко опиши проект"` — доказывает prompt → tool call → filesystem → tool result → model → final.

## K0 — Foundation

| ID | Статус | Задача | Зависит от | Артефакт | DoD-команда |
|---|---|---|---|---|---|
| K0.1 | done | Каркас пакетов: workspace-записи, package.json/tsconfig/tsdown, `./invariant` | K0.0 | `pnpm-workspace.yaml`, `tsconfig.host.json` | `pnpm install` зелёный |
| K0.2 | done | `@kibborg/cli`: bin `kibborg`, сборка, версия | K0.1 | `apps/cli` | `kibborg version` |
| K0.3 | done | Свой profile-boot на публичных экспортах `dsh-app-boot` | K0.2 | `apps/cli/src/profile-boot.ts` | `kibborg --dump-config` печатает дерево |
| K0.4 | done | `@kibborg/cli-bundle`: patch-слой и `parseCmdline` | K0.3 | `packages/cli-bundle` | профиль бутается, флаги попадают в дерево |
| K0.5 | done | Шимы `bin/*`, `install.ps1\|sh` | K0.2 | `Kibborg_CLI/bin` | `kibborg version` из чужого каталога |
| K0.6 | done | `kibborg doctor` (+`--json`, `--fix`), маскирование секретов | K0.3 | `apps/cli/src/doctor.ts` | `kibborg doctor` и `kibborg doctor --fix` |
| K0.7 | done | `version`, `--help`, `--dump-config` без секретов | K0.2 | `apps/cli/src/args.ts`, `dump-config.ts` | `kibborg --help` |
| K0.8 | done | Agent Note про третью поверхность | K0.2 | `.agents/notes/implemented/architecture/2026-09-11-kibborg-terminal-surface.md` | заметка существует |

## K1 — Vertical slice в CLI + inline-рендер

| ID | Статус | Задача | Зависит от | Артефакт | DoD-команда |
|---|---|---|---|---|---|
| K1.1 | todo | Маппинг флагов в профильный overlay и `cmdlineArgs` | K0 | `apps/cli`, `packages/cli-bundle` | флаги применяются к дереву |
| K1.2 | todo | Inline-рендер: стриминг, тул-строки, ошибки, ретраи, нотис лимита | K0.0 | `packages/tui`, `UI.md` §4.3 | `kibborg "опиши каталог"` |
| K1.3 | done | Статус-строка (модель, режим, git-ветка, метрика, сессия) | K1.2 | `packages/tui`, `UI.md` §4.10 | статус-строка отражает проекции |
| K1.4 | done | Ввод: multiline, история, Tab, контракт прерывания | K1.2 | `packages/tui` (`input`/`history`/`zone`), `packages/client-node/src/repl.ts` | PTY-smoke зелёный: `node Kibborg_CLI/tests/pty-smoke.mjs` |
| K1.5 | done | Не-TTY/CI: plain-вывод, диагностика в stderr, exit-коды | K1.2 | `packages/tui`, `UI.md` §4.12 | пайп даёт чистый stdout |
| K1.6 | done | R10: reasoning-чанки не печатаются | K1.2 | `packages/tui`, `UI.md` §1 | reasoning в выводе отсутствует |
| K1.7 | done | Снапшот-тесты вывода на mock-LLM; сверка с golden демо | K1.2 | `packages/tui/tests`, `Kibborg_CLI/vitest.config.ts` | 9 тестов зелёные; `demo\kibborg-demo.bat check` — golden ok |

## K2 — Agent REPL, сессии, история

| ID | Статус | Задача | Зависит от | Артефакт | DoD-команда |
|---|---|---|---|---|---|
| K2.1 | done | REPL: prompt, очередь, steering, прерывание | K1 | `packages/client-node/src/repl.ts` | `kibborg` (PTY-smoke), Enter во время хода → steering |
| K2.2 | done | Сессии: список, `resume`/`continue`, rename, fork, архив, поиск | K2.1 | `packages/client-node/src/sessions.ts`, `packages/tui/src/session-table.ts` | `sessions`, `resume`, `--continue`, `rename`, `fork`, `archive` проверены; поиск — известное ограничение (см. ниже) |
| K2.3 | done | История: пагинация, узлы Conversation, проекции | K2.2 | `packages/client-node/src/history-render.ts` | `resume <id> --history N` собирает страницы; рендер узлов упрощённый |
| K2.4 | done | Todos/goals: виджет, `/goal`, Ralph-луп | K2.1 | реестр команд хоста | `kibborg --continue "/goal"` отвечает; Ralph доступен как инструмент |
| K2.5 | done | Jobs/субагенты/workflow: списки, статусы, дерево, follow-up | K2.1 | `packages/client-node/src/sessions.ts` | `kibborg agents`, `kibborg jobs`; follow-up/workflow-панель — позже |
| K2.6 | done | Файлы и diff: изменённые файлы, unified-diff | K1.2 | `packages/client-node/src/turn.ts` | после хода печатается блок `Changed` |
| K2.7 | done | Вложения и vision-маршрутизация | K2.1 | `packages/client-node/src/turn.ts` | `kibborg --file README.md "…"` — модель отвечает по файлу; изображение печатает подсказку о делегировании |
| K2.8 | done | Компактизация: `/compact`, авто-компакт, чекпоинты | K2.1 | реестр команд хоста | `kibborg --continue "/compact"` отвечает текстом команды |
| K2.9 | done | Git worktree, ветка/статус | K2.2 | `apps/cli/src/worktree.ts` | `kibborg -w feat/x "…"` создаёт worktree, статус-строка показывает его ветку |

### Итоги K2 (2026-09-11)

Проверено на живом дереве: `sessions`, `sessions --json`, `resume <id>` (+`--history N`), `--continue "…"`, `rename`, `fork`, `archive`, `agents`, `jobs`, `commands`, `--file`, `-w <branch> "…"`, `"/goal"`, `"/plan"`, `"/permission"`, `"/compact"`. Тесты — 24 (рендер, ввод, история, таблица сессий), `oxlint` — 0 ошибок, PTY-интерактив зелёный.

Известные ограничения фазы: полнотекстовый поиск (`session.search`) в базовом слое выключен (`session-query-sqlite: openAt: never`), а его включение в нашем бандле роняет загрузку профиля (`TimeoutError` при boot) — поиск оставлен как в базе; заголовки сессий не приходят проекцией `title` в CLI-профиле (список показывает `(no title)`, хотя `rename` заголовок принимает); рендер истории печатает события лентой, а не полным `ConversationNodeAssembler`.



## K3 — Интерактив

| ID | Статус | Задача | Зависит от | Артефакт | DoD-команда |
|---|---|---|---|---|---|
| K3.1 | done | Approval-промпт: `approval/requested` → grant/deny → `respond` | K2 | `packages/client-node/src/interaction.ts`, `repl.ts` | `answerApproval` покрыт тестами; headless отклоняет; интерактивно `[y] once [a] always [n] deny` |
| K3.2 | done | Question-промпт: single/multi-select + custom | K3.1 | `packages/client-node/src/interaction.ts` | `parseAnswerLine`: номера, списки, `other:<текст>`; неверный ввод переспрашивает |
| K3.3 | done | Plan mode и бинарный plan-review | K2 | реестр команд + `interaction.ts` | вживую: `/plan` включает режим, `exit_plan_mode` присылает вопрос `plan-review` |
| K3.4 | done | Режимы: `--safe`, `--auto`, `--yolo`, `--permission-mode` | K0 | `apps/cli/src/args.ts` | значения валидируются; `/permission` переключает пресет на ходу |
| K3.5 | done | Фильтрация инструментов через overlay | K3.4 | `apps/cli/src/tool-filter.ts` | `--tools read` поднимает дерево без лишних рядов (9.1k tok) |
| K3.6 | done | Headless-политика: exit 3 и `--question-answers` | K3.1 | `packages/client-node/src/interaction.ts` | вживую: вопрос `plan-review` → печать вопроса и вариантов + **exit 3**; ответы из файла покрыты тестами |
| K3.7 | done | Отмена, консистентность лога, double-start | K2.1 | `repl.ts`, `sessions.ts` | Ctrl+C/Esc отменяют ход; занятая сессия предупреждает о втором потребителе |

### Итоги K3 (2026-09-11)

Проверено вживую: `--permission-mode plan` отвергается с подсказкой про `/plan`; `/plan` включает режим; `exit_plan_mode` прислал вопрос `plan-review`, headless-политика отказалась угадывать — процесс завершился кодом **3**; `--tools read "…"` собрал дерево с урезанным набором инструментов. Тесты — 40 (11 на approvals/questions, 5 на фильтр), линт — 0 ошибок.

Известное ограничение фазы: в этом окружении хост не запрашивает approvals для записи файлов и shell-команд (sandbox на Windows не ограничивает эти операции), поэтому интерактивный approval-промпт проверен кодом и unit-тестами, но не живым фреймом; полный PTY-сценарий plan-review не воспроизведён из-за длительного исследования модели в plan mode.

Снято в K4 (2026-09-12): запись под `--safe` действительно ограничивается, а повтор с `sandbox_permissions` поднимает живой approval-фрейм — воспроизводится скриптом `tests/pty-approval.mjs`. Причина прежнего наблюдения: сессия пинилась сохранённым пресетом `danger-full-access`, который перебивал `DSH_PERMISSION_MODE`; теперь явный флаг CLI применяется к сессии командой `/permission`.


## K4 — Команды, реестры, настройки

| ID | Статус | Задача | Зависит от | Артефакт | DoD-команда |
|---|---|---|---|---|---|
| K4.1 | done | Слэш-команды через `command.list`/`command.execute` | K1 | `packages/client-node/src/command-router.ts` | `/help`, `/status` |
| K4.2 | done | Скиллы: список и вызов `/имя` | K4.1 | `packages/client-node/src/skills-command.ts` | `/skills`, `kibborg skills` |
| K4.3 | done | Менеджер скиллов (10 подкоманд) | K4.2 | `packages/client-node/src/skills-command.ts` | `kibborg skills show <name>` |
| K4.4 | done | Модели: `/model`, `kibborg models`, effort | K1 | `packages/client-node/src/registry-command.ts` | `/model`, `kibborg models` |
| K4.5 | done | Ключи и настройки: `auth`, `settings` | K0 | `packages/client-node/src/settings-command.ts` | `kibborg auth`, `kibborg settings` |
| K4.6 | done | MCP: `list/add/remove` | K0 | `packages/client-node/src/mcp-command.ts` | `kibborg mcp add`, `kibborg mcp remove` |
| K4.7 | done | Экран-модал с табами (Skills/MCP/Hooks/Plugins/Permissions) | K4.1 | `packages/tui/src/panel.ts`, `packages/client-node/src/panel.ts` | `/panel`, Tab переключает таб |
| K4.8 | done | Namespace `kibborg-cli` в settings (тема, timestamps, multiline) | K1 | `packages/cli-bundle/src/index.ts` | `kibborg settings show kibborg-cli` |
| K4.9 | done | Autocomplete `/`, `@`, `#` | K1.4 | `packages/tui/src/completion.ts` | Tab дополняет команду, файл, сессию |
| K4.10 | done | Экспорт/статистика: `export`, `stats`, `/copy`, `/find`, `/transcript` | K2.3 | `packages/client-node/src/transcript.ts` | `kibborg export`, `/find`, `/transcript`, `/copy` |
| K4.11 | done | Оркестратор: монтирование и настройка модели-исполнителя | K4.4 | `packages/cli-bundle/cordis.patch.yml` | `kibborg tools` печатает `executor` |

### Итоги K4 (2026-09-12)

Проверено вживую: локальные слэш-команды (`/status`, `/help`, `/mcp`, `/find`, `/transcript`, `/copy`) отвечают в REPL без обращения к модели, автодополнение по Tab доводит `/ski` до `/skills` — все семь проверок PTY-сценария `tests/pty-commands.mjs` зелёные. `kibborg models` печатает 39 провайдеров (активны `deepseek-official`, `kibborg`, `glm`), `kibborg mcp` — `linkly-ai` и `context7` с состоянием подключения, `kibborg skills` — каталог проекта, `kibborg tools` — 28 смонтированных инструментов, включая `executor` и `mcp__context7__*`. `kibborg export` выгрузил ZIP лога на 85 047 байт, `kibborg stats` — 67 002 входных и 69 выходных токенов за ход, `kibborg settings` и `kibborg auth` показали неймспейсы и три ключа (`set (file)`) без единого значения секрета. Жизненный цикл скилла пройден целиком на временном `kb-probe`: `validate` и `check` (`valid`), `save --scope user`, `show` (scope, версия `v1`, тело), `versions`, `disable`/`enable`, `remove` → `trash` → `restore` → `remove` → `delete` (папка и корзина пусты); `kibborg mcp add --command node --disabled` и `mcp remove` отработали на `probe-server`. Вызов скилла строкой подтверждён: `/caveman ответь одним словом: ок` ушёл промптом, модель ответила. Тесты — 94, линт — 0 ошибок на 57 файлах.

Дефекты, найденные и исправленные по ходу: вывод слэш-команды затирался перерисовкой нижней зоны (команда выполнялась до `clearZone`, а следующий `drawZone` стирал всё ниже курсора); shim `bin/kibborg.ps1` объявлял `param()`, из-за чего PowerShell перехватывал `-o` как префикс своих `-OutVariable`/`-OutBuffer`, а конвейерный ввод (`echo … | kibborg`, `Get-Content … | kibborg skills save`) не доходил до stdin дочернего процесса — теперь скрипт читает `$args` и пробрасывает `$input` при `$MyInvocation.ExpectingInput`; `--safe` не ограничивал сессию, потому что режим пинится сохранённым пресетом (`permission.defaultPreset: danger-full-access` в `$DSH_HOME/settings.yaml`), а `DSH_PERMISSION_MODE` его не перебивает — теперь явный флаг применяется командой `/permission` после создания сессии, и `/permission` в такой сессии показывает запрошенный режим; строка `/имя` уходила в хостовый реестр команд и не доходила до модели, хотя вызов скилла — это промпт, который разворачивает pre-step граница `dsh-tool-skill`; теперь слэш-строка считается командой только при совпадении с зарегистрированным именем.

Смонтировано в профиль CLI: `orchestrator` (инструмент `executor`), `skill-manager` (жизненный цикл скиллов: show/save/remove/restore/delete/trash/enable/disable/versions/rollback/validate/check/benchmark), `plugin-inventory` (таб Plugins) и собственный узел бандла (`kibborg-cli`), который регистрирует settings-секцию `kibborg-cli`.

Модал и настройки: `/panel` открывает один экран с табами Skills · MCP · Hooks · Plugins · Permissions (`UI.md` §4.9); Tab/Shift+Tab переключают табы, ↑↓ выбирают строку, Space включает/выключает скилл, `v` печатает версии, Enter показывает тело скилла или применяет пресет разрешений, Esc закрывает. Проверено PTY-сценарием (открытие, переключение таба `[Skills]` → `[MCP]`, закрытие, работа композера после модала). Секция `kibborg-cli` (theme `ice|mono`, timestamps, multiline) видна и в `kibborg settings`, и в Web: `theme mono` убирает ANSI из вывода, `timestamps true` печатает `You  14:47:02`, `multiline` меняет местами Enter и Ctrl+J; настройки возвращены в дефолты после проверки.

Ревью Grok по дефектам (передано целиком, вердикты по коду): фиксы зоны, `bin/kibborg.ps1`, `--safe`, маршрутизации `/имя` и монтирования `skill-manager` признаны верными либо неполными. Из родственных находок исправлены: отказ `/permission` больше не проглатывается (иначе `--safe` продолжал бы без ограничений); ввод блокируется, пока идёт команда (`commandBusy`), иначе Enter запускал второй `submit`; заметки REPL (steering, отмена, Ctrl+C, ответ на approval, «не тот номер») печатаются через `note()` — с очисткой зоны, иначе их стирала перерисовка; `skills validate/check` сообщают о пустом stdin вместо schema-error; one-shot `kibborg "/status"` идёт через `routeCommand`, а не в хостовый реестр. Осталось незакрытым из разбора: реакция на `SIGWINCH` (ширина зоны фиксируется при входе в цикл) и `exit $LASTEXITCODE` в PowerShell 5.1, когда `node` не найден.

Добавлено сверх таблицы: `kibborg tools` (28 инструментов композиции, включая `executor` и `mcp__context7__*`), `kibborg settings` (list/show/set/unset по неймспейсам, секреты замаскированы) и `kibborg auth` (состояние ключей из настроек; `set` читает значение из stdin, чтобы оно не попало в историю команд).

Известные ограничения фазы: на ширину зоны не влияет `SIGWINCH` (колонки читаются при входе в цикл и в хуках шага); `screen` и `keybindings` из замысла `PLAN.md` в секцию не вошли — экран переключается флагом K7, а клавиши зафиксированы `UI.md`; `${DSH_HOME}/settings.yaml` держит `headDenyTools: []`, поэтому оркестратор ограничивает head-модель только при явно заполненном списке.

## K5 — Headless / CI

| ID | Статус | Задача | Зависит от | Артефакт | DoD-команда |
|---|---|---|---|---|---|
| K5.1 | done | `-p/--print`, `run`, форматы вывода, `--json-schema`, `--question-answers` | K3.6 | `packages/client-node/src/headless.ts` | `kibborg -p "..." --output-format json` |
| K5.2 | done | `--max-turns`, `--no-session-persistence` | K5.1 | `packages/client-node/src/turn.ts` | флаги применяются |
| K5.3 | done | Exit-коды 0/1/2/3/130 и машинно-читаемые ошибки | K5.1 | `packages/client-node/src/headless.ts` | коды соответствуют `README.md` |
| K5.4 | done | Примеры для CI, cron, Docker | K5.3 | `Kibborg_CLI/examples` | пример запускается |

### Итоги K5 (2026-09-12)

Проверено вживую: `kibborg -p "…"` печатает в stdout ровно ответ (`ок`), а человеческий рендер уходит в stderr (6 строк) — контракт «stdout только результат» соблюдён; `--output-format json` отдаёт один документ (`result`, `isError`, `kind`, `sessionId`, `model`, `tokens`, `tools`, `durationMs`), `stream-json` — тот же набор строками плюс финальный `result`; `--prompt-file` читает задачу из файла (stdin не трогается, поэтому CI-пайп остаётся свободным); `--json-schema` валидирует ответ (при `required: ["status"]` — успех, при отсутствующем поле — сообщение в stderr и exit 1); `--max-turns 1` завершает ход с `kind: "max-turns"` и кодом 1; `--no-session-persistence` архивирует сессию, и она исчезает из `kibborg sessions` (список теперь читает архивный набор из реестра воркспейсов, как это делает сайдбар Web). `kibborg run "…"` — тот же вызов, что и голая задача.

Дефект, найденный при проверке: `run` как отдельная подкоманда теряла headless-флаги — короткий `-p` перехватывался родительским парсером, и в intent попадали только `kind`/`task` (видно по `KIBBORG_TRACE=1`). `run` стал алиасом: аргумент снимается до разбора, и вся строка flags принадлежит корневой задаче.

Примеры: `examples/github-actions.yml` (шаг workflow со схемой и вердиктом), `examples/cron-kibborg.sh` (ночной прогон с `--max-turns` и ротацией логов), `examples/Dockerfile` (одноразовый контейнер, ключ только в рантайме) и `examples/README.md` (+ китайская пара).

Ограничение: ограничение бюджета по токенам/стоимости не реализовано — в headless-отчёте есть только фактические `tokens`, потому что метрика стоимости в этом хосте не публикуется.

## K6 — Serve / attach / auth

| ID | Статус | Задача | Зависит от | Артефакт | DoD-команда |
|---|---|---|---|---|---|
| K6.1 | done | `@kibborg/server`: host-плоскость + `/api`-маршрут | K5 | `packages/server/src/index.ts` | `kibborg serve` |
| K6.2 | done | WS-даунлинки `events.mux`/`events.host` | K6.1 | `packages/server/src/downlinks.ts` | клиент получает поток |
| K6.3 | done | Безопасность: токен, отказ bind без токена, CORS off, журнал | K6.1 | `packages/server/src/gate.ts`, `apps/cli/src/serve.ts` | отказ старта без токена вне loopback |
| K6.4 | done | `attach <url>` на том же клиентском слое | K6.2 | `packages/client-node/src/remote-client.ts` | `kibborg attach <url>` |
| K6.5 | done | Эксплуатация: systemd, Docker, healthcheck, shutdown | K6.3 | `Kibborg_CLI/deploy` | сервис поднимается и останавливается |
| K6.6 | done | mDNS (опционально) | K6.4 | `packages/server/src/mdns.ts` | `kibborg discover` |

### Статус K6 (2026-09-12) — проверено вживую

Живые прогоны выполнены на собранном `apps/cli/lib/bin.js` (сборка — обходным путём через `tsconfig.emit*.json`, потому что пакет `tui` в это время переписывался параллельно):

- `kibborg serve --port 7317 --mdns --instance kibborg-live` поднялся; `/healthz` ответил `{"ok":true,"sessions":0}` (loopback), `/api/session.list` **без токена — 401**, с токеном — корректный `server-response` (ручной POST получил `bad-request`, потому что клиент формирует оболочку иначе; клиентский путь проверен ниже).
- `kibborg attach http://127.0.0.1:7317 --token … "ответь одним словом: ок"` прошёл целиком через сеть: ход, ответ (`ок`), footer и статус-строка; `--output-format json` вернул `{"result":"ок","isError":false,…}` — значит WebSocket-даунлинк работает (ответ приходит из потока событий, а не из HTTP-ответа).
- `kibborg discover --timeout 3` нашёл сервер по mDNS: `kibborg-live  http://172.27.160.1:7317  (token required)`.

Дефекты, найденные живыми прогонами и исправленные:
1. `@kibborg/server` импортировал `dsh-client-connection/src/websocket-downlink.ts` — TypeScript-исходник чужого пакета; Node при загрузке падал с `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` (parameter property в strip-only режиме). Теперь у сервера собственный WS-мост `packages/server/src/downlinks.ts`, собранный из публичного контракта `ServerRequest`; правок в ядре не потребовалось.
2. Ряд сервера не ждал `apiProxy`: `inject` был `['webServer']`, и boot падал с «ctx.apiProxy is absent». Теперь `inject = ['webServer', 'apiProxy']`.
3. `attach` уходил в ветку session-команд (`unsupported session command attach`) — исключён из неё.
4. Флаги подкоманды перехватывались родителем: `--print`/`--output-format` у `attach` не доходили до intent (родитель объявляет те же флаги). Включён `program.enablePositionalOptions()`; проверено, что при этом root-форма `kibborg -p "…"` и флаги после задачи (`kibborg "…" --safe`) работают как прежде.

Ограничение окружения: корректное завершение по `SIGTERM` проверено на уровне кода (`profile-boot` регистрирует SIGTERM/SIGINT и диспозирует дерево, закрывая маршруты, WS-даунлинки и HTTP-сервер), живая проверка требует Linux — на Windows сигнал доставляется иначе.

Как только `tui` снова собирается, обходные конфиги не нужны: `pnpm run build` из `Kibborg_CLI` собирает всё штатно.

Что проверено: `tsc -b packages/server/tsconfig.json` — чисто; `tsc -p tsconfig.check.json` (проверка `client-node` против уже собранных типов зависимостей) — чисто; тесты `packages/server` — 10 зелёных (токен, Origin, журнал, ответы фенса); тесты `packages/client-node` ранее — 114.

Что сделано:
- `packages/server`: HTTP-носитель `/api` над `ctx.apiProxy` (буферизация тела под лимитом, отбрасывание hop-by-hop заголовков, без кеша), WebSocket-даунлинки `/api/events/mux` и `/api/events/host` через `WebSocketDownlinks` из `dsh-client-connection`, `/healthz` только для loopback.
- `packages/server/src/gate.ts`: `Authorization: Bearer` и query-параметр для WS, сравнение токена constant-time, отказ по чужому `Origin`, access-log в stderr.
- `apps/cli/src/serve.ts` + `kibborg serve --host --port --token --trusted-host --no-log`: overlay добавляет ряды `webserver` и `kibborg/server`, отключает `kibborg-client`; токен идёт через окружение и в файл не пишется; не-loopback bind без токена отвергается до boot (exit 2).
- `packages/client-node/src/remote-client.ts`: `RemoteApiClient` поверх `AbstractApiClient` (токен на каждый запрос, WS-даунлинки вместо SSE), `parseAttachTarget`, команда `kibborg attach <url> [task…]`; тип клиента во всех модулях сменён с `InProcessApiClient` на `IApiClient`, чтобы обе половины были взаимозаменяемы. Хост-команды в attach-сессии отклоняются с понятным сообщением: они живут в процессе-хосте, которым подключённый клиент не владеет.

Ограничение: `tsconfig.check.json` в корне Kibborg CLI — вспомогательный конфиг для проверки типов без сборки зависимых пакетов; он нужен, пока идёт рефакторинг `tui`.

K6.5 (эксплуатация): `deploy/kibborg.service` (отдельный пользователь, hardening, `KillSignal=SIGTERM`, `TimeoutStopSec=30`, `Restart=on-failure`), `deploy/kibborg.env.example` (токен и ключ провайдера вне unit-файла, права 0600), `deploy/healthcheck.sh` (проверяет `/healthz` и то, что `/api` без токена отвечает `401`/`403`, а на loopback-only развёртывании — `200` с предупреждением), `deploy/Dockerfile` (образ серверного режима с `EXPOSE 7317` и `HEALTHCHECK`) и `deploy/docker-compose.yml` (том `$DSH_HOME`, публикация порта только на loopback, `stop_grace_period: 30s`), плюс двуязычный `deploy/README.md`. Фенс исправлен по ходу: при пустом токене сервер обслуживает loopback-развёртывание без токена, но по-прежнему отвергает чужой `Origin`; тесты `packages/server` выросли до 12.

Осталось проверить живьём (после сборки): запуск `kibborg serve`, handshake WebSocket, `attach` с задачей и без, ответ на approval через сетевой транспорт, корректное завершение по SIGTERM, healthcheck против запущенного сервера.

## K7 — Fullscreen TUI

| ID | Статус | Задача | Зависит от | Артефакт | DoD-команда |
|---|---|---|---|---|---|
| K7.1 | done | Alt-screen, компоновка, ресайз, `--fullscreen`/`--minimal` | K4 | `packages/tui/src/{screen,framebuffer,layout,box}.ts` + `packages/client-node/src/fullscreen.ts` | `kibborg --fullscreen` |
| K7.2 | partial | Панели: сессии, субагенты/jobs/workflow, todo/goals, контекст, очередь | K7.1 | `packages/client-node/src/panels.ts` | `/panels`, `Ctrl+O` |
| K7.3 | done | Keybindings: лидер-клавиша, `Shift+Tab`, `Ctrl+O`, `/find`, Vim-скролл | K7.1 | `packages/client-node/src/fullscreen.ts`, `packages/tui/src/app.ts` | комбинации работают |
| K7.4 | done | Темы, compact mode, timestamps, plain-режим | K7.1 | `packages/cli-bundle/src/index.ts` | темы переключаются |
| K7.5 | partial | Устойчивость: восстановление alt-screen, Windows Terminal/WSL/macOS | K7.1 | `packages/tui/src/screen.ts`, `packages/client-node/src/fullscreen.ts` | терминал восстанавливается |

### Статус K7 (2026-09-12)

Разделение работы: рендер-примитивы (`screen.ts`, `framebuffer.ts`, `layout.ts`, `box.ts`, `anim.ts`) писал второй агент; CLI-интеграцию поверх них сделал я.

Сделано с моей стороны:
- Режим экрана в секции `kibborg-cli`: `screen: inline | fullscreen | minimal` (плюс флаги `--fullscreen` и `--minimal`), читается клиентом до построения кадра.
- `packages/client-node/src/fullscreen.ts`: полноэкранный цикл на примитивах tui — `computeLayout` делит кадр на шапку, ленту, оверлей, композер и статус; лента накапливается sink'ом (ограничена 4000 строк); кадр собирается в `CellBuffer` и отдаётся `screen.present` (диффовая отрисовка); ресайз приходит через `screen.onResize`; ход выполняется плейн-палитрой, а цвет кадра решают токены.
- Восстановление терминала: `leave()` вызывается в `finally`, на `SIGINT`/`SIGTERM` и на `process.exit`; при выходе снимаются обработчики, выключается raw-режим.
- Аварийный plain-режим: если терминал не интерактивен или не поддерживает альтернативный буфер (пайп, `TERM=dumb`, ненулевой `CI`), режим возвращает `unsupported`, печатает причину и продолжает в inline — это не ошибка запуска.
- Проверено живьём: `tests/pty-fullscreen.mjs` — захват терминала, отрисованный кадр (шапка с сессией и моделью), принятый ввод, открытие панели данных (`Ctrl+O`), переключение панели (`Tab`), восстановление терминала и выход по Ctrl+D (7/7).

Данные панелей (K7.2, моя часть): `packages/client-node/src/panels.ts` собирает снапшот из двух источников — durable-списки (`sessions.list`, `subagents.list`) и одна короткая подписка на mux, из которой приходят `session/jobs`, `session/queue` (поле `items`) и проекции `contextPressure`, `contextBreakdown`, `tokenUsage`, `goal`, `todos`; `complete: false` честно означает, что живого baseline не было. `formatPanelSnapshot` рендерит семь панелей текстом (для тестов, inline-режима и скриптов), `PANEL_NAMES` задаёт порядок. В fullscreen `Ctrl+O` открывает панель, `Tab`/`Shift+Tab` переключают, `r` обновляет, `Esc` закрывает, `Ctrl+D` выходит; в inline доступна команда `/panels [name]`. Проверено: PTY-сценарий (открытие и переключение панели), тесты `panels.spec.ts` (9) и живые прогоны `/panels jobs` (пустой список + отметка об отсутствии baseline) и `/panels nope` (внятная ошибка, exit 1).

Дефект, найденный при проверке: `detectCaps` считал признаком CI сам факт наличия переменной `CI`, поэтому пустая `CI=` (как в этом окружении) отключала интерактивность и альтернативный буфер; теперь читается только непустое значение — так же, как в остальных environment-гейтах проекта.

Ограничение проверки: `conpty` на Windows сам эмулирует терминал и поглощает `?1049h`/`?1049l`, поэтому включение альтернативного буфера подтверждается unit-тестами рендерера, а PTY-скрипт проверяет наблюдаемое — кадр, ввод, восстановление и выход.

Осталось в K7: панели files/diff и workflow, живая проверка на macOS, полный прогон в WSL с установленными для Linux зависимостями.

### Статус K7, продолжение (CLI-качество)

Довёл клавиатуру, режимы и отрисовку до состояния «продукт», закрыв четыре реальных дефекта, которые всплыли на живых прогонах:

- Одиночный `Escape` терялся: парсер ждал продолжения последовательности и никогда не получал его, поэтому модальные панели не закрывались и продолжали перехватывать ввод (ввод команды уходил в панель, лента не пополнялась). Новый модуль `packages/client-node/src/escape-idle.ts` держит незавершённую последовательность и по 40 мс простоя читает её как `escape`; fullscreen и inline используют один и тот же декодер, а `stop()` снимает таймер при выходе.
- Панель данных, открытая до закрытия, «воскресала» после `Esc`: фоновое чтение снапшота дописывало результат уже после закрытия. Введён счётчик `panelEpoch` — закрытие и каждая новая загрузка его увеличивают, устаревший результат не применяется.
- Палитра команд съедала `Enter`: набранная команда заменялась именем пункта с пробелом, поэтому `Enter` после `/status` ничего не запускал, а `Enter` после `/find zzz` терял аргумент. `packages/tui/src/app.ts` теперь выполняет строку, которая уже называет зарегистрированную команду.
- Вывод локальных команд в inline-режиме писался прямо в stdout и стирался следующим кадром: в кадре выживали только первые строки ответа. Поверхность получает вывод через свой лог (по строке на запись), а `onCommand` принимает sink.

Прочее в этой итерации: `Ctrl+U` на пустом композере прокручивает полстраницы назад (с непустым — по-прежнему очищает строку); `Esc`, `Ctrl+O` и `Ctrl+D` закрывают панели одним обработчиком; `KIBBORG_INLINE=1` принудительно возвращает inline (аварийный plain-режим), fullscreen отвечает `unsupported` и печатает причину.

Проверка: `tests/pty-fullscreen.mjs` — 10/10 (кадр, ввод, панель, скролл с маркером `↑N (End to follow)`, ресайз, терминал 28×10, восстановление, выход), `tests/pty-commands.mjs` — 12/12 (локальные команды, автодополнение, открытие/переключение/закрытие модала), unit — 199/199, lint — 0 предупреждений. Новый инструмент `tests/frame-render.mjs` реплеит PTY-вывод в экранную матрицу и пишет `frame.txt`, `frame.html` и `frame.raw.txt`; на нём видно, что цветной кадр даёт 7 цветов и 1654 SGR-последовательности, а с `NO_COLOR` (как в среде агента) — плейн-кадр, поэтому инструмент явно выставляет `COLORTERM` и снимает `NO_COLOR`.

Ограничение проверки: исполнительная модель (`Kibborg_Flash_v5.7`) не принимает изображения, поэтому скриншот кадра некому прочитать глазами — визуальный контроль выполнен программно (дамп кадра, метрики цветов, ассерты PTY-сценариев); скриншот сохраняется файлом для ручного осмотра. Прогон в WSL (`Ubuntu-26.04`) показал: `version`, `doctor` и `--help` работают, полный стек требует Linux-установки зависимостей (в Windows-`node_modules` pnpm-симлинки указывают на Windows-пути, поэтому загрузчик профиля не находит пакеты).

### Статус K8 (начало)

- **K8.1 — сделано.** Сборка `pnpm --dir Kibborg_CLI run build` (tsc → `lib/types`, tsdown → `lib/`) собирает все пакеты; запуск идёт из `apps/cli/lib/bin.js` без tsx. Проверено: `kibborg version` → `0.1.0` за ~190 мс.
- **K8.2 — сделано.** `Kibborg_CLI/install.ps1`, `install.sh`, `uninstall.ps1`, `uninstall.sh`. Установка создаёт шимы (`kibborg.cmd` и `kibborg.ps1` на Windows, `kibborg` на POSIX), которые вызывают собранный `apps/cli/lib/bin.js` по абсолютному пути, и по умолчанию дописывают префикс в пользовательский PATH (Windows) или в `~/.profile` (POSIX); есть `-SkipBuild`/`--skip-build`, `-NoPath`/`--no-path`, `-DryRun`/`--dry-run`. Проверено живьём: установка под Windows PowerShell 5.1, запуск шимов из другого каталога (`0.1.0`, exit 0), проброс stdin (`kibborg skills validate` получает документ из потока и отвечает `valid`), идемпотентность, удаление; `install.sh`/`uninstall.sh` прошли `sh -n` и установку в WSL (`--dry-run`).
  Дефект, найденный на ревью и исправленный: `Set-Content -Encoding UTF8` под PowerShell 5.1 писал BOM в `kibborg.cmd`, из-за чего `cmd.exe` печатал ошибку на каждый запуск; теперь `.cmd` пишется `[System.IO.File]::WriteAllText` с `UTF8Encoding($false)`, а `.ps1`-шим — с BOM (там есть кириллица).
- **K8.5 — сделано.** `Kibborg_CLI/tests/import-boundary.spec.ts`: относительный импорт не выходит за пределы своего пакета, код не ссылается на исходники харнесса по пути, внешние импорты — только `@deepseek-ai/*`, `@kibborg/*`, `node:*` и обычные имена пакетов (4 теста).
- **K8.7 — частично.** `Kibborg_CLI/tests/load-check.mjs` замеряет три пути старта. Метрики на этой машине: `version` ≈ 187 мс, `doctor` ≈ 187 мс, `sessions --json` ≈ 32 с (boot профиля — доминирующая стоимость, оптимизация не входила в фазу). Длинная сессия и виртуализация вывода не замерялись.
- **K8.3 — частично.** Зелёные: unit 208 (22 файла), `oxlint` 0 замечаний, PTY-сценарии `pty-commands` 12/12 и `pty-fullscreen` 10/10, `pty-approval`. Не сделаны снапшоты и отдельный Linux-прогон (в WSL профиль не грузится: pnpm-симлинкы Windows указывают на Windows-пути, нужна отдельная Linux-установка зависимостей).
- **K8.4, K8.6 — не начаты** (гейты репозитория и документация с ссылкой из `docs/`); README получил разделы «Установка» и актуальное «Состояние работ».

### Независимое ревью (Grok CLI)

Два раунда ревью внешней моделью. Первый нашёл семь дефектов, все закрыты и подтверждены вторым раундом: BOM в шиме `kibborg.cmd` (cmd.exe печатал ошибку на каждый запуск), Enter палитры с аргументами, потеря незавершённой последовательности в `escape-idle`, лишний `ok` после команды, двойная рамка и мёртвые стрелки в модале inline, ошибка панели мимо лога, ранний `exit 0` в `uninstall.sh --no-path`. Второй раунд нашёл ещё один: проверка «строка называет команду» стояла после `item === undefined`, поэтому при пустом фильтре (`/status verbose`, опечатка) Enter не доходил до отправки — проверка перенесена выше, живой прогон с посимвольным вводом подтверждает выполнение команды с аргументом. Оттуда же два UX-замечания: `kibborg sessions --json` стартует около 32–34 с (холодный старт профиля), и асинхронная команда `/panel` не рисовала кадр до конца чтения реестров — модал теперь появляется сразу со строкой «читаю реестры…».

### Инструменты проверки, добавленные в K8

- `Kibborg_CLI/tests/frame-render.mjs` — реплей PTY-вывода в экранную матрицу; пишет `frame.txt`, `frame.html` и `frame.raw.txt`, сообщает число непустых строк, цветов и SGR-последовательностей; умеет отправлять строки (`--send`) и клавиши (`--keys`). Инструмент снимает `NO_COLOR` (в среде агента он выставлен, и кадр был бы плейн) и не подменяет `TERM`: подмена меняет набор возможностей терминала, который поверхность согласует.
- `Kibborg_CLI/tests/load-check.mjs` — метрики старта.
- `Kibborg_CLI/tests/import-boundary.spec.ts` — гейт импортов.

### Навигация по меню (дефекты, найденные пользователем)

Живая проверка палитры вскрыла, что «поход по меню» был сломан на трёх уровнях, и все три закрыты:

- **Выбор пункта ничего не делал.** Обработчик выбора только подставлял имя команды в композер с пробелом, поэтому выбор `model` оставлял пользователя с текстом в строке вместо подменю. Теперь поверхность различает два случая: набранную строку (`Enter` отдаёт её циклу, который выполняет команду) и список, открытый самой командой (`Enter` сообщает выбор через `onMenuAccept`, и команда его применяет).
- **У команд с решением не было второго уровня.** Добавлены списки выбора: `/model` (каталог моделей с отметкой текущей), `/resume` и `/sessions` (список сессий с переключением), `/effort` (`low|medium|high`), `/permission` (`Ask|Plan|Agent|YOLO`). Список открывается методом `App.openMenu(items, title)` и подписан предметом выбора («модель», «сессия»), а не словом `commands`.
- **В палитре не было `new`,** и вообще отсутствовали команды поверхности: добавлены `/new` (создать сессию в текущем каталоге через `session.create` и переключиться), `/resume`, `/sessions`, `/quit`; `/model` и `/effort` теперь описаны как выбор из списка. Каталог команд (`LOCAL_COMMANDS`) и палитра читают один и тот же список, поэтому команда не может появиться в одном месте и отсутствовать в другом.
- **Рамка оставалась после выхода (наплыв).** `Escape` очищал черновик только внутри поверхности, а цикл на следующей перерисовке возвращал набранный `/`, и палитра появлялась снова поверх прежней рамки. Теперь `Escape` сообщает о закрытии наружу (`onMenuClose`), цикл очищает свой черновик и восстанавливает каталог команд; проверено кадром: после `Escape` рамки в кадре нет.

Проверка: `tests/pty-commands.mjs` — 17/17, включая новые этапы «в палитре есть /new», «`/model` открывает список моделей», «`Enter` применяет выбор», «`Escape` оставляет чистый композер»; юнит-тесты поверхности — открытие списка, выбор стрелками, закрытие с уведомлением владельца (22 теста в `packages/tui/tests/surface.spec.ts`). Инструмент `tests/frame-render.mjs` научился разбирать `ECH` (`ESC[nX`) и `DCH` (`ESC[nP`) — без них кадр показывал текст, который терминал уже стёр.

### Выделение мышью и копирование

Пользователь сообщил, что выделить текст в окне нельзя. Причина: поверхность запрашивает mouse-reporting (нужен для колеса и прокрутки), поэтому терминал отдаёт перетаскивание приложению и своё выделение не делает, а своего у поверхности не было — протяжка не давала ничего.

Сделано: `App` ведёт выделение по кадру. `press-left` ставит якорь, `move` тянет за собой второй конец, `release` снимает текст и сообщает его владельцу; подсветка — обратное видео (`ESC[7m`) поверх готового кадра, поэтому выделяется ровно то, что видно, включая ленту, списки выбора и композер. Клиент (`repl.ts`) кладёт текст в буфер обмена тем же `copyToClipboard`, что использует `/copy`, и пишет в ленту «скопировано строк: N».

Найдено и исправлено попутно: `detectCaps` выключала мышь по самому факту наличия переменной `KIBBORG_NO_MOUSE` — экспортированная пустая переменная в этой среде отключала mouse-reporting (та же ошибка, что раньше была с `CI` и `NO_COLOR`); теперь читается только непустое значение. Кто хочет нативное выделение терминала, ставит `KIBBORG_NO_MOUSE=1` — тогда колесо и прокрутка мышью недоступны, а выделение и копирование делает терминал.

Проверка: юнит-тест поверхности (протяжка → обратное видео в кадре → текст в обработчике → повторный `release` не копирует второй раз); всего 212 тестов, `pty-commands` 17/17, `lint` чистый. Ограничение: в PTY-прогоне подтвердить протяжку нельзя — `conpty` фильтрует mouse-последовательности, поэтому живое подтверждение выделения и попадания текста в буфер остаётся за настоящим терминалом; в кадре и в буфере обмена это проверяется на стороне пользователя.

### Возврат из вложенного меню

Пользователь не нашёл способа вернуться из подменю. Причина: выход был только по `Escape`, и об этом нигде не было написано — ни строкой в списке, ни подсказкой в рамке.

Сделано: у вложенных списков появился первый пункт `↩ назад` («вернуться к списку команд») и строка подсказки внизу рамки — «Esc — назад · ↑↓ — выбор · Enter — применить» для подменю и «Esc — закрыть · ↑↓ — выбор · Enter — выполнить» для палитры команд. Возврат из подменю открывает палитру команд заново, так что следующим действием можно выбрать другую команду; `Escape` в самой палитре закрывает её и очищает ввод. `Enter` в подменю применяет первый настоящий вариант, а не строку «назад»: она стоит первой, но преселект ставится на следующую строку.

Попутно выяснилось, что прежний `Escape` в палитре команд возвращал её же (закрытие и «назад» были одним и тем же действием) — теперь это два разных уровня, и уровень передаётся владельцу (`onMenuClose(nested)`).

Проверка: новый сценарий `tests/pty-menu.mjs` — 8/8 (палитра перечисляет `/new`; `/model` открывает список с «↩ назад» и заголовком «модель»; `Enter` применяет модель; стрелка вверх доходит до строки возврата; выбор строки возвращает к палитре команд; `Escape` закрывает). Меню-этапы вынесены из `pty-commands.mjs` в отдельный сценарий: в общем прогоне они наследовали состояние модальной панели и давали ложный отказ. Юнит-тест поверхности проверяет, что «назад» стоит первым, подсказка попадает в кадр, а `Enter` берёт первый реальный вариант (всего 213 тестов).

### Лента инструментов: полный ввод, вывод и diff

Пользователь сообщил, что вызовы инструментов показаны одной обрезанной строкой: не видно, что именно модель отправила, что получила и какие строки правила.

Причина: контракт рендера нес только короткую метку (`toolCall(name, argument)`, `toolDone(name, durationMs)`), а `log.ts` печатал детали с жёстким лимитом в 6 строк и обрезкой по ширине.

Сделано:
- `TurnRenderer` получил `ToolCallDetail` (полный JSON аргументов, diff, `+N −M`) и `ToolResultDetail` (вывод инструмента, применённый diff); `toolDone(name, durationMs, result)`.
- `turn.ts` собирает детали из событий: `IN` — pretty-print `tool/call.arguments`; `OUT` — текстовые блоки `tool/result.message`; diff — из `meta.diffs` (контекстный diff, который файловые инструменты прикладывают к результату), с LCS-разбором хунков; для создания файла, где хунков нет, diff строится из переданного содержимого (`write` → все строки как `+`, `edit` → `old_string`/`new_string`).
- `log.ts` печатает блоки `IN`/diff/`OUT`, перенося строки по ширине вместо обрезки, а лимит остался только на объём блока (200 строк) и сопровождается строкой «… ещё N строк»; заголовок получил `+N −M` и время. `render.ts` (scrollback-режим) печатает те же блоки, `log-renderer.ts` хранит их в записи и патчит при завершении.
- Палитра получила токены `DiffAdd`/`DiffRemove` (зелёный/красный, с 16-цветными фолбэками).

Проверка: юнит-тест «shows what a tool was sent and what it returned, with the change counts» (IN/OUT/diff/`+1 −1`/`135ms` попадают в кадр, diff-строки окрашены) и обновлённый тест деталей (строки больше не усекаются); всего 214 тестов, `lint` чистый, `pty-commands` и `pty-menu` зелёные. Живой прогон `kibborg -p "замени в файле … hello на goodbye"` показал в ленте `IN {…}`, `@@ kibborg-tool-probe.txt`, `-hello`, `+goodbye` и `OUT The file … has been updated successfully.`

### Цвет, Markdown и кликабельные ссылки

Пользователь сообщил, что интерфейс однотонный, ответы модели сливаются, разметка не читается, а выделить и открыть ссылку нельзя.

Сделано:
- **Markdown-рендер ответа** (`packages/tui/src/markdown.ts`): заголовки, списки (маркеры и отступы), цитаты, горизонтальные линии, таблицы с выравниванием колонок и разделителем под шапкой, блоки кода с меткой языка и рельсом `│`, инлайн-код, `**жирный**`, ссылки `[текст](url)` и голые URL. Строки переносятся, а не обрезаются.
- **Кликабельные цели**: ссылки и пути становятся гиперссылками терминала (OSC 8). Цель хранится в ячейке кадра (`Cell.url`), печатается в `paintRow`, поэтому `Ctrl+клик` разрешает её в `App.onOpen`; если ячейка без гиперссылки, строка под курсором проверяется на путь или URL — клик по обычному тексту ничего не открывает. Открытие выполняет `packages/client-node/src/open-target.ts` (`start`/`open`/`xdg-open`), `file://`-адрес превращается в локальный путь.
- **Разделение по цветам**: добавлены токены `Answer` (заключение модели), `DiffAdd`/`DiffRemove`, `Orange`; ответ рисуется своим тоном, первая строка — жирная, спиннер в статусной строке перебирает символы и меняет цвет (`thinkingToken`: янтарный → оранжевый → янтарный), инструменты — серые, `IN` — текстовый цвет, `OUT` — приглушённый, diff — зелёный/красный, ссылки — акцентные с подчёркиванием.
- `wrapText` перенесён в `width.ts`: рендер Markdown и лента используют один перенос, и циклический импорт `log ↔ markdown` исчез.

Проверка: `packages/tui/tests/markdown.spec.ts` — 7 тестов (таблица выравнивается, код отделён и не теряет символы, списки нумеруются, ссылка становится целью с подчёркиванием без escape-кодов в тексте, жирный сохраняется, путь открывается, длинный абзац переносится); всего 221 тест, `lint` чистый. Живой кадр (`tests/frame-render.mjs --send "<задача с таблицей, кодом и ссылкой>"`) показал заголовок «Итог», таблицу `ID │ Статус` с разделителем `───┼────────`, блок `ts` с рельсом и подчёркнутую ссылку, а в потоке — `ESC]8;;https://example.com/docs` (гиперссылка) и `ESC[4m` (подчёркивание).

### Смена модели и «мигающие» подтверждения

Пользователь сообщил: при выборе модели в меню модель будто не меняется, а вместо подтверждения загорается жёлтый восклицательный знак.

Разобрано две причины:
- **Источник истины был не тот.** Клиент печатал модель, собранную из выбранной строки списка, а статусная строка поверхности модель вообще не обновляла — поэтому интерфейс продолжал показывать прежнюю модель, даже когда хост переключил сессию. Теперь берётся ответ хоста `session.selectModel` → `value.selected` (провайдер, модель и reasoning effort), он же уходит в состояние и в статусную строку через `setStatus`. Это важно и потому, что маршрутизатор может разрешить запрос в другую модель, чем выбранная строка.
- **Подтверждения выглядели как предупреждения.** Сообщения «скопировано строк: N», «модель: …», «открыто: …», «режим: …» печатались как `notice` с символом ⚠ и оставались в ленте навсегда.

Сделано: `App.flash(text, ms = 5000)` — подтверждение добавляется записью вида `info` (значок `·` в акцентном цвете) и через пять секунд удаляется вместе с перерисовкой; `LogModel` получил `remove(id)`, а `stop()` снимает все отложенные удаления. Через `announce()` проходят подтверждения копирования, смены модели, усилия, режима и открытия ссылки; `announce` также обновляет статусную строку. Ошибки и предупреждения по-прежнему остаются в ленте, потому что их нужно видеть.

Проверка: юнит-тесты поверхности — подтверждение показывается и исчезает через заданный срок, смена модели меняет строку статуса (27 тестов в `surface.spec.ts`, всего 223 теста, `lint` чистый). Живой прогон в PTY: `/model` → выбор `kibborg/Kibborg_Flash_v5.7` → в ленте подтверждение, статусная строка переключилась на `Kibborg_Flash_v5.7`, через пять секунд кадр перерисован без подтверждения.

### Мерцание кадра, исчезающий счётчик контекста и кодировка буфера

Пользователь сообщил о трёх проблемах: при движении стрелками вверх/вниз «моргают все надписи», счётчик контекста пропадает и вместо него появляются другие надписи, а скопированный текст приходит в неверной кодировке.

Разобрано:
- **Стрелки подставляли историю.** В поверхности стрелки не обрабатывались и уходили в строку ввода, где вверх/вниз листают историю: введённое задание возвращалось в композер, и каждый такой возврат перерисовывал кадр — это и воспринималось как мерцание и как «ТЗ остаётся в окне ввода». Теперь при пустом композере стрелки прокручивают ленту на строку (как и ожидается при чтении длинного ответа), а при непустом — по-прежнему листают историю. Задание после отправки уходит в ленту, композер остаётся пустым.
- **Строка статуса подменялась.** Во время хода вместо обычной строки печаталась другая («Working… esc interrupt 32119 tok»), поэтому счётчик контекста исчезал. Теперь строка сохраняет состав — модель, `ctx N%`, полоса контекста, ветка, режим — и лишь дополняется фактами хода: спиннер с градиентом цвета, затраченное время, токены и подсказка «esc прерывает ход».
- **Кодировка буфера обмена.** `clip.exe` читает stdin в кодовой странице консоли, поэтому UTF-8 приходил в буфер «кракозябрами». На Windows текст теперь кладётся через `Set-Clipboard`, читающий временный файл в UTF-8 (с откатом на `clip` для машин без PowerShell); проверено живьём: в буфере оказывается ровно «Проверка кодировки: кириллица, тире —, ё, №».

Проверка: юнит-тесты поверхности — стрелки прокручивают ленту при пустом композере и уходят в историю при непустом; строка статуса во время хода содержит модель, `ctx 26%`, время, токены и режим (29 тестов в `surface.spec.ts`, всего 225 тестов, `lint` чистый). Живой кадр подтверждает, что строка статуса сохраняет `ctx`; кодировка буфера проверена вызовом `copyToClipboard` с кириллицей и чтением буфера.

### Полное ревью Grok CLI и Shift+Enter

Независимое ревью (живые PTY-прогоны, `frame-render`, прямые пробы буфера) подтвердило основу — палитра с подменю и возвратом, OSC 8, UTF-8 буфер, статус с `ctx` на ходу, Markdown-рендер, IN/OUT/diff — и нашло восемь дефектов. Исправлено шесть:

- вывод команд шёл как `notice` и выглядел предупреждением (`⚠ session`, `⚠ help`) — теперь это `info`;
- колонка имени в палитре была фиксированной (12), поэтому длинный идентификатор модели слипался с описанием (`deepseek-v4-flashdeepseek-official`); ширина считается по самому длинному пункту, описание занимает остаток;
- опечатка уходила модели как промпт и запускала платный ход: `/statuss` теперь распознаётся как опечатка (расстояние Дамерау–Левенштейна, один правка для коротких имён и две для длинных) и подсказывает `/status`; настоящие имена скиллов не задеваются;
- палитра не прокручивалась и на 40 строках обрезала хвост каталога: высота оверлея ограничена кадром, окно следует за выделением;
- `Shift+Tab` в меню не работал (только `Tab` вниз) — теперь двигает выбор вверх;
- дубликат `/permission` (локальная и хостовая регистрация) убран дедупликацией каталога.

Отложено по итогам ревью: хоткеи, заявленные в легенде (`Ctrl+P/N/M/Q`, `F3`), подсветка синтаксиса и копирование код-блока одной клавишей, складывание длинных IN/OUT, меню действий по клику на строку инструмента. Ограничение среды, а не дефект: под `conpty` не входит альтернативный экран и не проходят mouse-последовательности, поэтому `--fullscreen` и протяжка мышью проверяются только в реальном терминале.

**Shift+Enter** реализован: Win32 input mode (`ESC[?9001h`) и kitty keyboard protocol (`ESC[>1u`) включаются при входе на экран и выключаются при выходе, парсер понимает оба отчёта (`VK;Sc;Uc;Kd;Cs;Rc_` и `13;2u`) и отличает нажатие от отпускания, а композер растёт вместе с черновиком (до восьми строк), поэтому перенос остаётся видимым. `Ctrl+J` работает как перенос в любом терминале, отключить режимы можно `KIBBORG_NO_WIN32_INPUT=1`.

Проверка: 234 теста (добавлены `input-keys.spec.ts` — Shift+Enter из обоих протоколов, отпускание клавиши, отсутствие дубля; `command-typo.spec.ts` — опечатки и защита от ложных срабатываний), `lint` чистый, `pty-menu` 8/8. Живой PTY подтверждает, что `?9001h` запрашивается и что обычный текст и стрелки по-прежнему доходят; саму последовательность Shift+Enter `conpty` не пропускает, поэтому её проверка — за реальным терминалом.

### Задание оставалось в строке ввода

Пользователь показал кадр: после `Enter` отправленный текст продолжал висеть в композере, хотя в ленте уже была запись `You …`.

Причина: при старте хода вызывался `clearZone()`, который в composed-режиме сразу возвращается (кадром владеет поверхность), а `app.setDraft('')` не вызывался вовсе; вдобавок `drawZone()` не выполнялся, пока `running` — значит и последующая перерисовка не могла синхронизировать строку. Композер держал отправленный текст до конца хода.

Сделано: при старте хода и при `steer` строка явно очищается в поверхности (`setDraft('')`, `setHint('')`), а `drawZone()` теперь вызывается и во время хода, когда поверхностью владеет composed-режим (там кадр рисуется разницей, поэтому обновление безопасно; в scrollback-режиме зона по-прежнему не перерисовывается, чтобы не стирать вывод хода).

Проверка: живой PTY-прогон — задание уходит в ленту (`You …`), в композере остаётся пустая строка ввода («> » без текста). Всего 234 теста, `lint` чистый.

### Сворачивание длинных блоков

Пользователь попросил не захламлять ленту: блок длиннее двадцати строк должен показываться началом и разворачиваться по нажатию.

Сделано: `log.ts` конденсирует записи длиннее `COLLAPSED_LINES` (20 строк) — ответ модели, вывод инструмента и diff. Показывается начало и строка `⋯ ещё N строк — клик, чтобы развернуть`; она несёт идентификатор записи и признак `collapsed`, поэтому `app.ts` сопоставляет строку кадра с записью и по клику переключает `LogEntry.expanded` (повторный клик сворачивает). Клик по обычной строке по-прежнему начинает выделение текста, а Ctrl+клик открывает ссылку, так что жесты не конфликтуют.

Проверка: юнит-тест поверхности — длинная запись сжимается до 20 строк с маркером, полный блок скрыт, после `expanded: true` видны все строки (30 тестов в `surface.spec.ts`); живой PTY-прогон с ответом на 30 строк показал маркер «ещё 3 строки — клик, чтобы развернуть».

## K8 — Дистрибуция, тесты, документация

| ID | Статус | Задача | Зависит от | Артефакт | DoD-команда |
|---|---|---|---|---|---|
| K8.1 | done | Сборка (`tsdown`), прод-запуск без tsx | K7 | все пакеты | запуск из `lib/` |
| K8.2 | done | Глобальная установка: PATH или `pnpm link --global` | K8.1 | `Kibborg_CLI/install.*` | `kibborg` из любого каталога |
| K8.3 | partial | Тесты: unit, интеграционные, снапшоты, e2e сервера, Windows+Linux | K8.1 | `Kibborg_CLI/tests` | тесты зелёные |
| K8.4 | todo | Гейты репо: typecheck, lint, test, hygiene, verify-export-jsdoc | K8.3 | — | гейты зелёные |
| K8.5 | done | `import-boundary.spec.ts` | K8.3 | `Kibborg_CLI/tests` | гейт импортов зелёный |
| K8.6 | todo | Документация и ссылка из `docs/` | K8.2 | `docs/`, `Kibborg_CLI/*` | `pnpm run doc-sync` |
| K8.7 | partial | Нагрузка: длинная сессия, виртуализация вывода, память, старт | K8.1 | отчёт | метрики в норме |

### Интерфейс по образцу Grok CLI — отдельный план

Переработка интерфейса и взаимодействия ведётся по отдельному плану `UI_GROK_PLAN.md`, зафиксированному по живым фактам: документация установленного Grok CLI и кадры четырёх CLI (Grok, Codex, Claude Code, OpenCode), снятые инструментами `tests/ref-probe.mjs` и `tests/ref-render.mjs`.

Основание: ни один из четырёх CLI не перехватывает мышь, поэтому выделение, копирование и колесо у них терминальные; Kibborg включал `1000h/1002h/1006h` и повторял эти жесты сам.

| Этап | Статус | Содержание |
|---|---|---|
| 0.1 | **done** | Мышь возвращена терминалу (`KIBBORG_MOUSE=1` — обратно) |
| 0.2 | **done** | Убран стек-трейс `ERR_INVALID_STATE` при старте |
| 0.3 | **done** | Карточка вопроса как у Grok, включая свой ответ набранным текстом |
| 1 | **done** | Каркас экрана: строка места, лента со временем сообщений, строка работы `♦ действие · время · ↓токены · [stop]`, рамка ввода со статусом в нижней границе, контекстная строка клавиш, тонкий скроллбар |
| 2 | **done** | Отображение работы: человеческие действия вместо сырых имён, сворачивание результатов с раскрытием клавишей, diff с приглушённым контекстом, блоки размышлений с длительностью, субагенты дочерними сессиями с боксом и сводкой |
| 3 | **done** | Цвета: палитра GrokNight (нейтральная база, приглушённые границы, один акцент), агенты без собственных цветов, тема `terminal` из профиля терминала |
| 4 | **done** | Клавиши Grok: `Ctrl+C` отменяет ход, `Esc` — нет, `Tab` переводит фокус, `↑↓` выбирают запись, `h`/`l` сворачивают и разворачивают, `y` копирует, `Shift+Tab` меняет режим разрешений, `Ctrl+x` печатает справку |
| 5 | todo | Тесты, PTY-кадры, README/CHANGELOG |

Детали, артефакты и проверки по каждой задаче — в `UI_GROK_PLAN.md`.


### Переработка ленты: структура, клики, три оси цвета, боксы субагентов

Пользователь потребовал превратить ленту из «консоли с логами» в панель работы агентов: последний ответ не сворачивать и оформлять как документ, клик по «ещё N строк» должен раскрывать блок, а не копировать строку, сырой JSON убрать из основной ленты, разделить цвет агента, роль и семантику действия, показать субагентов боксами с деревом и статусом, убрать декоративный прогресс-бар и показать живой статус со счётчиками. Дизайн прогнан через Grok CLI по фактическому коду, затем его же ревью нашло 14 дефектов — все исправлены.

Разобрано:

- **Ответ как документ.** `renderTranscript` находит последнюю assistant-запись и передаёт её id в `RenderOptions.lastAnswerId`; эта запись не конденсируется, предыдущие — сворачиваются. `markdown.ts` получил отбивку пустой строкой перед блоками (`breathe` с учётом списков), заголовки с маркером `▎` и линией под H1, рамку `┌─ lang … └─` вокруг кода, линейку под телом таблицы и разные маркеры уровней списка. Там же исправлена потеря пробелов между стилизованными фрагментами: `wrap` больше не прогоняет короткий спан через `wrapText`, поэтому «**не покрывают** `run_command`» и «[отчёт](…) и текст» склеивались без пробела.
- **Действие вместо протокола.** `toolTitle(name, raw)` в `arguments.ts` превращает аргументы в фразу («Запускает go test ./...», «Правит engine-go/guard.go», «Делегирует: посчитать строки», «Ставит цель: …»); `ToolCallDetail.title` доносит её до ленты; `LogEntry.title` печатается в основной строке, а `input`/`output`/`diff` уходят за строку-клик `▸ аргументы · вывод` (`collapsed: true` + `entryId`). Неизвестный инструмент сохраняет своё имя — роли и названия не выдумываются.
- **Три оси цвета.** В `tokens.ts` добавлены `AgentKibborg/AgentDeepSeek/AgentGrok/AgentFlash/AgentCodex/AgentClaude` (агент отвечает на «кто»), `RoleBadge` (роль — приглушённый бейдж, больше не цвет агента) и `ActionThink/ActionTool/ActionFile/ActionDelegate` (семантика действия); `agentToken` распознаёт известные имена, причём `flash` проверяется раньше `kibborg`, иначе локальный исполнитель красился бы как голова.
- **Боксы и прогрессивное раскрытие.** Делегирование рисуется рамкой: `boxRow` раскладывает `┌─ ◐ имя · модель · роль ─── ◐ WORKING ┐`, строки агента идут между стенками (`WALL_WIDTH = 8`, обе стенки в бюджете строки), закрытие — `└─ ✓ имя ─── ✔ DONE ┘`. Завершённая ветка сворачивается: её записи пропускаются, вместо них — строка `⋯ N шагов этой ветки — клик, чтобы развернуть` (клик по ней или по рамке закрытия переключает `expanded`). Живая ветка остаётся раскрытой.
- **Клик и выделение.** Карту кликов строит сама область ленты (`drawLogView` возвращает `painted` — соответствие строки кадра и строки ленты), потому что липкий заголовок сдвигал строки вниз и клик по маркеру уходил в соседнюю строку, начиная выделение и копируя её текст. Теперь press только «взводит» клик, протяжка превращает его в выделение, а нажатие и отпускание в одной клетке ничего не копирует.
- **Шапка, статус, счётчики.** Шапка стала двумя строками (бренд, версия, каталог, модель + правило), `bandWave` из неё убран, `HEADER_HEIGHT = 2` согласован с раскладкой. Статус во время хода: `✦ Working 26.6s · ctx 26% ▓▓▓░░░░░░░ · 3 агента · 7 задач · Agent · Esc прерывает ход` — счётчики приходят из `turn.ts` через `onProgress` (`agents.count()` и число вызовов инструментов), после хода сбрасываются, а `ctx` стоит раньше счётчиков, чтобы не обрезаться на узком терминале.
- **Ревью Grok (вертикальное и горизонтальное).** Найдено 14 дефектов: переполнение строк бокса углами при узкой ширине и длинных именах, двойная стенка (`WALL_WIDTH` считал одну), затирание угла скроллбаром, отсутствие потолка глубины в заголовке, фолд ветки без `sessionId`, невозможность свернуть ветку обратно, зависший `armedClick`, порог протяжки в одну клетку, копирование одной буквы кликом, `/new` без очистки ленты, порядок `ctx` в статусе, счётчики только по корневым вызовам, несброшенные счётчики после хода, вырожденный тест цвета агента. Все исправлены, инвариант «строка не шире региона» расширен на боксы и глубину 1–3.

Проверка: 264 теста (`surface.spec.ts` — инвариант ширины с боксами, скрытие деталей и раскрытие по `expanded`, шапка и статус, выделение с первого нажатия и клик по маркеру, рост и прокрутка композера; `agents.spec.ts` — бокс, рамка, сворачивание ветки, параллельные вызовы, глубина; `markdown.spec.ts` — отбивка блоков и маркеры уровней; `tool-title.spec.ts` — человекочитаемые названия действий, неизвестный инструмент, обрезка длинного аргумента), `oxlint` чистый, живой PTY-прогон подтверждает кадр: бокс `┌─ ◐ … ◐ WORKING ┐`, строки между стенками, `⋯ N шагов этой ветки`, закрытие `└─ ✓ … ✔ DONE ┘`, развёрнутый ответ и статус со счётчиками.

### Четыре аномалии: `/new`, выход, Shift+Enter и выделение мышью

Пользователь сообщил о четырёх дефектах: `/new` не начинает новый контекст, `Ctrl+C` не закрывает CLI и в меню нет команды выхода, `Shift+Enter` не переводит курсор на новую строку, а окно ввода не растёт до восьми строк с прокруткой, и сломалось копирование выделением мышью.

Разобрано:

- **`/new` уходил модели.** В обработчике Enter команда, набранная во время хода, отправлялась как steering: хост получал строку `/new` вместо команды поверхности, поэтому сессия не менялась, лента и `ctx` оставались прежними. Теперь `namesLocalCommand` распознаёт команду поверхности или хоста и в этом случае запускает `submit` даже во время хода. Первая попытка дождаться отменённого хода через сохранённый промис `submit` дала взаимную блокировку (промис `/new` ждал сам себя) — видно по живому прогону: лента очищалась, но в неё успевала попасть ошибка оборванного mux-потока. Заменено на ожидание флага `running` с пределом 5 с, а отменённый ход теперь гасится через `sessions.cancel` без разрыва потока (разрыв давал в stderr хоста `ERR_INVALID_STATE`). Статус новой сессии защищён номером поколения: ход, начатый до переключения, больше не пишет свои секунды и токены в новую сессию.
- **Выхода не было в меню.** Палитра команд строилась только по каталогу хоста, а `/quit` живёт в локальных командах поверхности, поэтому в списке его не было. Добавлены `LOCAL_COMMANDS` (палитра объединяет их с каталогом хоста) и команда `/exit` как второй, привычный вход. `Ctrl+C` вне хода теперь завершает работу сразу; первое нажатие при непустом черновике очищает его.
- **Курсор композера.** `composerCursor` адресовал курсор на строку ниже последней строки ввода, то есть на строку подсказки, а колонку считал на единицу правее текста. Исправлено; заодно `drawComposer` для длинного черновика показывает последние восемь строк и пишет `▲ N строк выше`, так что видно и хвост черновика, и то, что выше остались строки.
- **Выделение сломалось из-за кликов.** Нажатие лишь «взводило» клик по строке-маркеру и не создавало выделение; в терминале, который не присылает промежуточные движения, подсветка не появлялась вовсе. Теперь нажатие сразу начинает выделение, а строка-маркер запоминается: отпускание в той же клетке выполняет раскрытие, протяжка копирует текст.

Проверка: 264 теста (`surface.spec.ts` — протяжка копирует и рисует подсветку, клик по маркеру раскрывает запись и не копирует, длинный черновик показывает хвост и `▲ 4 строки выше`, короткий не показывает индикатор), `oxlint` чистый, живой PTY-прогон: `/new` во время хода оставляет только строку «новая сессия», `ctx 0%` без токенов и времени, палитра `Ctrl`/`/` показывает `/exit` и `/quit` в группе SESSION.

### Диалог с моделью, окно ввода, наложения и время старта

Пользователь сообщил, что модель не задаёт вопросов с вариантами (нет окна), окно ввода не растёт и `Shift+Enter` не переносит строку, поверх окна ввода появляются стек-трейсы, и `kibborg` долго запускается. Присланный кадр показал окно `╭ Question 1/1 ╮`, в котором `Enter` отвечал «that was not an option number», — то есть окно было, а выбора не было.

Разобрано:

- **Инструмента вопросов не было в профиле.** Базовый слой даёт только шов `userQuestions`, а сам `ask_user_question` — отдельный плагин `@deepseek-ai/dsh-tool-ask-user`, которого в профиле `kibborg` не было (проверено `kibborg tools`: инструмент отсутствовал). Ряд добавлен в `cli-bundle` вместе с зависимостью; `kibborg tools` теперь показывает `ask_user_question`, а живой прогон подтверждает вызов и появление окна.
- **Выбор вариантов.** Подсветка в окне вопроса бралась из `selected: 0`, который передавался константой, а `Enter` вызывал разбор текста, поэтому без введённого номера отвечал ошибкой. Теперь поверхность ведёт выбор сама: `↑`/`↓` двигают выделение, `Space` отмечает варианты при множественном выборе, `Enter` подтверждает выделенный, `Esc` отменяет; окно помечено `passthroughArrows`, поэтому кадр не перехватывает стрелки, а прокидывает их владельцу.
- **Окно ввода.** Композерный режим рисовал фиксированные четыре строки через `zoneLines`, а полноэкранный — одну строку с обрезкой, поэтому `Shift+Enter` не давал видимой новой строки. Общий рендер `composerFrame` показывает до восьми строк, дальше прокручивает собственный текст и пишет `▲ N строк выше`; каретка считается по строке и колонке (`zoneCursor`), а не фиксированной позицией под окном.
- **Подтверждения в полноэкранном режиме.** `runFullscreen` не передавал `onApproval`/`onQuestion`, поэтому хост применял headless-политику. Оба колбэка добавлены, рамка запроса рисуется в overlay, клавиши `y`/`a`/`n`, стрелки, `Enter` и `Esc` обрабатываются.
- **Наложения поверх ввода.** Стек-трейсы хоста (`api-proxy: stream error: ERR_INVALID_STATE`) шли прямо в stderr, то есть поверх кадра. Строки stderr во время работы поверхности складываются в ленту, а отмена хода сначала просит хост остановить турн и только через две секунды обрывает поток — это и было источником того стек-трейса.
- **Время старта.** Диагностика (`KIBBORG_TRACE`, CPU-профиль, `DSH_HOME` на пустом каталоге) показала две причины: `sessionPersistence.list()` читал заголовки 1462 сессий последовательно (≈6 с при 568 МБ логов) и поверхность сканировала рабочую директорию и список сессий для автодополнения. Чтение заголовков идёт с ограниченным параллелизмом (`LIST_READ_CONCURRENCY = 32`, с сохранением порядка), а скан подсказок отложен до первого `Tab`. Старт сократился с 19,2 с до 8,3 с.

Проверка: 267 тестов (новые: `surface.spec.ts` — стрелки доходят до окна вопроса и не перехватываются, когда окно ведёт выбор само; длинный черновик даёт восемь строк и метку `▲ 4`; короткий показывается целиком), `oxlint` чистый, тесты пакета `session-persistence-jsonl` (239) зелёные после правки чтения заголовков. Живые PTY-прогоны: окно `╭ Question 1/1 ╮` появляется, стрелка вниз и `Enter` закрывают его и ход продолжается; замер старта `frame-render`: ready after 8 332 ms (было 19 251 ms).




### Двухцветные счётчики, скорость ленты и подписи агентов

Пользователь попросил три вещи одним заходом: `+43` зелёным и `−12` красным; убрать лаги прокрутки и копирования во время длинных прогонов; показывать в ленте, какая модель и в какой роли выполняет каждое действие, включая субагентов, с разными цветами на агента. Дизайн третьего пункта прогнан через Grok CLI (`packages/core/session/src/types.ts`, `packages/subagent/subagent/src/projection.ts`, `packages/host/apiproxy/src/api-proxy.ts`), чтобы не выдумывать поля событий.

Разобрано:

- **Счётчики.** В composed-ленте они уже печатались двумя спанами, но в scrollback-режиме строка `+N −M` собиралась без `paint`, поэтому наследовала цвет терминала. `changeCounts` теперь красит обе половины (`DiffAdd` / `DiffRemove`).
- **Лаги.** Замер бенчем на 3000 записях (16 000 строк) показал кадр в 355 мс даже без изменений и 339 мс на кадре с потоком. Две причины: `renderEntries` на каждый кадр склеивала все строки, а кэш отрендеренных записей ограничивался 600 — то есть в длинной сессии пересобирались все записи, кроме хвоста. Теперь транскрипт живёт частями (`renderTranscript` → `parts` + `tops`) и переиспользуется, пока `LogModel.version` не изменился, а окно (`transcriptWindow`) берёт только видимые строки; `drawLogView` принимает и плоский список, и транскрипт. Кэш записей поднят до 20 000 и вытесняется в порядке вставки без сортировки, `patch` находит запись по индексу (`Map<id, position>`) вместо `findIndex`, а поток текста ответа накапливает строку сам, а не ищет свою запись по всей ленте. Итог на том же бенче: кадр без изменений 0,13 мс, кадр с потоком 3,4 мс, кадр со спиннером 0,02 мс.
- **Агенты.** Трекер `agents.ts` строит дерево сессий по `sessions.list` (`parentSessionId`, `origin`, `agentPreset`) и роль по настройкам оркестратора (`executorProvider`/`executorModel`); модель ребёнка берётся из `request/header` его лога, имя — из `subagent/descriptor` или проекции `subagent`, а у одноразового исполнителя, который дескриптора не пишет, — из самого вызова `executor` (поле `description`); активность — из проекции `subagentActivity`, которую хост пушит только для субагентских сессий. Факты записываются для любой названной хостом сессии ещё до того, как дерево разместит ребёнка: его первые кадры приходят раньше, чем список успевает его показать. События чужих сессий в `turn.ts` больше не отбрасываются: вызовы инструментов субагента показываются внутри ветки делегировавшего агента, а слот выполняющегося вызова ведётся по паре «агент + имя инструмента», иначе параллельные вызовы головы и ребёнка закрывали бы чужие строки. Роль не выдумывается: `CODER`/`REVIEWER` в событиях отсутствуют, поэтому печатаются только те роли, которые следуют из фактов.

Проверка: 256 тестов (новые `packages/tui/tests/agents.spec.ts` и `packages/client-node/tests/agents.spec.ts` — заголовок с моделью и ролью, отступ ветки по уровням, закрытие ветки ниже её работы, переиспользование транскрипта и границы окна, дерево сессий, роль `EXECUTOR` по маршруту, имя из вызова делегирования, отсев чужой сессии, закрытие параллельных вызовов каждый в своей строке), `lint` чистый. Независимое ревью Grok CLI нашло 8 дефектов (слот выполняющегося вызова, сличание агента по имени вместо сессии, отброшенные факты ребёнка при `revalidate` по TTL, глубина ветки, кэш относительных меток времени, отсутствие таймаута у clipboard-helper'а) — все исправлены и покрыты тестами. Живой PTY-прогон подтвердил кадр: `◆  KIBORG   deepseek-official/deepseek-v4-flash   ORCHESTRATOR`, ниже `├─ ◇  Подсчёт строк SECURITY.md   kibborg/Kibborg_Flash_v5.7   EXECUTOR` с отступом строк инструментов и закрытием `└─ ✓`.

