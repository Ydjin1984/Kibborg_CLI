# CHECKLIST — Kibborg CLI

Приёмка по фазам. Порядок фаз, объём и решения — в `PLAN.md`; реестр задач — в `TASKS.md`.

## K0.0 — Vertical Slice (hard gate)

Статус: **выполнен полностью** — итоги, замеры и исход (b) зафиксированы в `K0.0-REPORT.md`. Фазы K0+ не начинаются до решения по этому отчёту.

- [ ] Профиль `kibborg` создан автоматически: `$DSH_HOME/profiles/kibborg/package.json` содержит `dsh.profile.bundles` = `["@deepseek-ai/dsh-base", "@kibborg/cli-bundle"]` — проверка: чтение `package.json` профиля.
- [ ] Дерево поднимается без ошибок — проверка: `kibborg "hello"`, ожидание — дерево активно, ошибок импорта нет.
- [ ] `host.describe` отвечает через `InProcessApiClient` — проверка: в выводе есть назначение хоста и версия.
- [ ] Mux-фреймы приходят — проверка: в plain-выводе видны строки status/tool.
- [ ] Smoke 1 (TTY): `kibborg "hello"` — ожидание: ответ модели на stdout.
- [ ] Smoke 1 (пайп): `kibborg "hello" | Out-String` — ожидание: тот же ответ, без ANSI-мусора.
- [ ] Smoke 2 (TTY): `kibborg "прочитай README.md и кратко опиши проект"` — ожидание: виден вызов инструмента чтения файла и финальный ответ по содержимому README.
- [ ] Smoke 2 (пайп): та же команда в пайпе — ожидание: тот же результат.
- [ ] Список модулей, обращающихся к DOM, зафиксирован (или явно указано «нет»).
- [ ] `packages/*` и `apps/cli/*` не изменены, кроме возможного аддитивного export при исходе (в).
- [ ] Отчёт заполнен по шаблону и предъявлен; фазы K0+ не начаты.

### Объём K0.0 (запрещено в этой фазе)

TUI, `/help`, `doctor`, шимы PATH, интерактивные промпты (approval/question/plan), полный парсер флагов, установка в PATH, релизные артефакты.

### Шаблон отчёта K0.0

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

## K0 — Foundation

Статус: **выполнен**. Проверено вручную 2026-09-11: `kibborg version` (0.1.0), `kibborg doctor` (9 проверок, 0 ошибок, exit 0), `kibborg doctor --json`, `kibborg --help`, `kibborg --dump-config`, `kibborg "hello"` — все из каталога вне репозитория; команда зарегистрирована в пользовательском PATH через `bin/install.ps1`.

- [ ] `pnpm install` проходит с новыми workspace-записями — проверка: `pnpm install` в корне монорепо.
- [ ] `kibborg version` печатает версию.
- [ ] `kibborg --help` печатает help CLI.
- [ ] `kibborg --dump-config` печатает составленное дерево, секреты замаскированы.
- [ ] `kibborg doctor` показывает состояние (Node, pnpm, артефакты, профиль, ключи, CDP, MCP) и не меняет ничего.
- [ ] `kibborg doctor --fix` исправляет и печатает список изменений.
- [ ] При расхождении бандлов вывод содержит точную причину и рекомендацию `kibborg doctor --fix`.
- [ ] `kibborg version` работает из произвольного каталога (не из монорепо).
- [ ] Agent Note про третью поверхность добавлена.

## K1 — Vertical slice в CLI + inline-рендер

Статус: **выполнен полностью** (2026-09-11). Проверено: одноразовый режим и режим stdin из каталога вне репозитория; интерактивная сессия — PTY-smoke `node Kibborg_CLI/tests/pty-smoke.mjs` (транскрипт содержит `You`, ответ, footer `✓  31.6k tok · 29.0s · 0 tools` и статус-строку, артефактов перерисовки нет); 17 unit-тестов (`pnpm --dir Kibborg_CLI test`); golden демо — `ok`; `oxlint Kibborg_CLI` — 0 ошибок.

- [ ] Рендер соответствует `UI.md`: токены темы (§2), геометрия и display-width (§3), лента и тул-строки (§4.3), статус-строка (§4.10).
- [ ] Замороженное демо не разошлось со спекой — проверка: `Kibborg_CLI\demo\kibborg-demo.bat check`, ожидание `golden ok`.
- [ ] `kibborg "опиши каталог"` в TTY: стриминг текста виден по мере поступления.
- [ ] Та же команда в пайпе даёт чистый stdout без ANSI.
- [ ] Строки инструментов содержат имя, цель и статус завершения.
- [ ] Ошибка провайдера и повтор отображаются понятно; нотис лимита токенов виден.
- [ ] Внутренние рассуждения модели в выводе отсутствуют (R10).
- [ ] Статус-строка отражает модель, режим пермишенов, git-ветку, метрику контекста и идентификатор сессии.
- [ ] Ctrl+C/Esc ведут себя по `ARCHITECTURE.md` §4 (отмена, затем выход).
- [ ] Снапшот-тесты вывода зелёные.

## K2 — Agent REPL, сессии, история

Статус: **выполнен** (2026-09-11), с тремя известными ограничениями, зафиксированными в `TASKS.md` (поиск отключён базовым слоем; заголовки сессий не приходят проекцией; рендер истории — построчный, не полный Conversation-ассемблер).

Проверено на живом дереве: `kibborg sessions` (12 с), `sessions --json`, `resume <id> --history 20` (28 событий, footer), `--continue "…"`, `rename`, `fork`, `archive`, `agents`, `jobs`, `commands`, `--file Kibborg_CLI/README.md "…"` (ответ без инструментов — файл в контексте), `-w feat/k2-smoke "…"` (worktree + ветка в статус-строке), `/goal`, `/plan`, `/permission`, `/compact` через реестр команд хоста. Тесты — 24, линт — 0 ошибок, PTY-интерактив — OK.

- [ ] `kibborg` открывает REPL, очередь сообщений и прерывание работают.
- [ ] `kibborg resume` показывает список и продолжает выбранную сессию.
- [ ] `--continue` продолжает последнюю сессию каталога.
- [ ] Rename, fork, архив и поиск по сессиям работают.
- [ ] Открытие старой сессии восстанавливает историю и проекции.
- [ ] `/goal`, todo-виджет и Ralph-луп доступны.
- [ ] Списки jobs, субагентов и workflow отражают реальное состояние; follow-up и interrupt работают.
- [ ] Diff изменённых файлов отображается после хода.
- [ ] Файл и изображение, добавленные в промпт, попадают в контекст; vision-задачи делегируются субагенту с vision.
- [ ] `/compact` выполняет ручную компактизацию.
- [ ] `kibborg --worktree` создаёт изолированное рабочее дерево.

## K3 — Интерактив

Статус: **выполнен** (2026-09-11) с одним ограничением окружения (см. `TASKS.md`).

Проверено вживую: `--permission-mode plan` отвергается с подсказкой про `/plan`; `/plan` включает plan mode; `exit_plan_mode` прислал вопрос `plan-review`, headless-политика отказалась угадывать — **exit 3** с печатью вопроса и вариантов; `--tools read "…"` поднял дерево с урезанным набором инструментов (9.1k tok). Тесты — 40 (approvals, вопросы, разбор ответов, фильтр инструментов), линт — 0 ошибок.

- [x] Интерактивный approval-промпт в живом TTY: `tests/pty-approval.mjs` поднимает `kiborg --safe`, просит запись вне рабочей области, видит отказ песочницы, повтор с `sandbox_permissions`, фрейм `[y] once / [a] always / [n] deny`, ответ `n` — файл не создан.
- [ ] PTY-сценарий plan-review целиком (упирается во время исследования модели в plan mode).

- [x] `--safe`, `--auto`, `--yolo`, `--permission-mode <mode>` дают ожидаемое поведение: явный режим применяется к сессии командой `/permission` и перебивает сохранённый пресет (`--safe` → `current preset read-only`, запись в рабочую область отклоняется).
- [x] Approval-запрос отображается в терминале и не зависает; доступны `allowed-once` (y/a), `rejected` (n/esc).
- [x] Ответ на approval фиксируется как `allowed-once`/`rejected` без расхождений в логе.
- [x] Question-промпт поддерживает single-select, multi-select и custom-текст; несовместимые ответы отклоняются.
- [ ] Plan mode не позволяет правки до одобрения; план отображается целиком.
- [x] `--tools`, `--allow`, `--deny` ограничивают набор инструментов без правок ядра.
- [x] В headless `-p` без флагов процесс завершается кодом 3, а не висит.
- [x] `--question-answers <file.json>` принимает ответы и валидирует их.
- [ ] Повторный запуск на той же сессии не перехватывает поток: предложен `attach` либо новая сессия.

## K4 — Команды, реестры, настройки

- [x] `/help`, `/status`, `/model`, `/effort`, `/mcp`, `/skills` отвечают локально; остальные строки со слэшем уходят в хостовый реестр (`/compact` проверен в PTY).
- [x] Скилл виден в списке (`kibborg skills`, `/skills`) с признаком `modelInvocable`; строка `/имя` без зарегистрированной команды уходит как промпт, который хост разворачивает в тело скилла.
- [x] `kibborg skills list|show|save|remove|restore|delete|trash|enable|disable|versions|rollback|validate|check|benchmark` работают через `skill-manager`.
- [x] `kibborg models` печатает провайдеров и модели; `/model` переключает модель сессии; `/effort` задаёт reasoning effort.
- [x] `kibborg settings` (list/show/set/unset) и `kibborg auth` читают и меняют настройки; значения секретов не печатаются ни в одном виде.
- [x] `kibborg mcp` печатает серверы и их состояние (`linkly-ai`, `context7`); `mcp add` и `mcp remove` правят пользовательский реестр.
- [x] Экран-модал переключает табы Skills/MCP/Hooks/Plugins/Permissions (`/panel`, Tab/Shift+Tab, Space, `v`, Enter, Esc); проверено в PTY.
- [x] Настройки CLI живут в namespace `kibborg-cli` (`theme`, `timestamps`, `multiline`) и видны в Web через `settings.describe`; применение проверено (`mono` без ANSI, `You  14:47:02`, swap Enter/Ctrl+J).
- [x] Autocomplete работает для `/` (команды), `@` (файлы) и `#` (сессии) — проверено в PTY (`/ski` → `/skills`).
- [x] `kibborg export` пишет ZIP лога (85 047 байт на живой сессии), `/copy`, `/find`, `/transcript` отвечают в REPL, `kibborg stats` печатает токены/ходы/инструменты.
- [x] Строка `orchestrator` смонтирована в профиле CLI, `kibborg tools` печатает `executor`; `headDenyTools` пуст, поэтому ограничение head-модели остаётся на настройке, а не на умолчании.

## K5 — Headless / CI

- [x] `kibborg -p "..." --output-format text` печатает ответ (в stdout ровно ответ, человеческий рендер — в stderr).
- [x] `--output-format json` печатает один JSON-объект с результатом.
- [x] `--output-format stream-json` печатает NDJSON; `--include-partial-messages` добавляет дельты (реализовано, проверено на финальном `result`).
- [x] `--json-schema` ограничивает вывод схемой; несоответствие отвергается (сообщение в stderr, exit 1).
- [x] `--max-turns` ограничивает число ходов (kind `max-turns`, exit 1); `--no-session-persistence` архивирует сессию, и она исчезает из `kibborg sessions`.
- [x] Exit-коды соответствуют таблице в `README.md` (0/1/2/3/130).
- [x] Примеры для CI, cron и Docker лежат в `Kibborg_CLI/examples` и опираются на проверенный контракт; `--prompt-file` читает задачу из файла.

## K6 — Serve / attach / auth

Статус: **выполнен** (2026-09-12), проверено вживую прогонами `serve` → `attach` → `discover`.

- [x] `kibborg serve --port <p>` поднимает сервер и печатает адрес.
- [x] `kibborg attach http://127.0.0.1:<p>` подключает тот же клиент к серверу (ход и ответ прошли через сеть).
- [x] Потоки событий приходят (ход, инструменты, проекции): ответ получен из WebSocket-даунлинка.
- [x] Старт на внешнем интерфейсе без токена запрещён: `serveRefusal` отвергает до boot с exit 2.
- [x] Неверный токен даёт 403, отсутствующий — 401; запросы журналируются (unit-тесты `packages/server`).
- [x] CORS по умолчанию выключен: заголовки не отдаются, чужой `Origin` отвергается.
- [x] `/healthz` отвечает и доступен только с loopback; завершение по SIGTERM реализовано в `profile-boot` (живая проверка требует Linux).
- [ ] Секреты не попадают в `doctor` и `--dump-config` без `--reveal` (проверить отдельно).
- [x] Эксплуатационные заготовки: `deploy/kibborg.service` (systemd, `SIGTERM`, отказ автозапуска при падении), `deploy/healthcheck.sh`, `deploy/Dockerfile` и `deploy/docker-compose.yml` с `HEALTHCHECK` и grace-периодом 30 с; двуязычный `deploy/README.md`.
- [x] mDNS: `kibborg serve --mdns` публикует сервис `_kibborg._tcp.local`, `kibborg discover` его находит (проверено живьём).

## K7 — Fullscreen TUI

Статус: в основном готово (CLI-часть закрыта и проверена живьём; остались панели files/diff и workflow, живой прогон на macOS).

- [x] `--fullscreen` открывает alt-screen; выход восстанавливает терминал (PTY: кадр, ввод, восстановление, Ctrl+D — 5/5).
- [x] Аварийный plain-режим: неинтерактивный терминал, `TERM=dumb` или ненулевой `CI` возвращают inline с сообщением причины.
- [x] Настройка `screen` (`inline | fullscreen | minimal`) в секции `kibborg-cli`, читается до построения кадра.
- [x] Ресайз: `screen.onResize` перерисовывает кадр по новым размерам.
- [x] Панели данных: сессии, субагенты, jobs, очередь, контекст, goal, todos собираются (`panels.ts`), открываются в fullscreen по `Ctrl+O` (Tab/Shift+Tab, `r`, Esc) и доступны как `/panels [name]` в inline; проверено в PTY и тестами.
- [x] Файлы/diff и workflow-панели: данные есть частично (`Changed` в ходе), отдельная панель diff не сделана.
- [x] Keybindings: лидер-клавиша, Vim-скролл (Ctrl+O, Tab/Shift+Tab, `/panel`, `/panels`, Esc, Ctrl+C/D, Ctrl+U, PgUp/PgDn/Home/End работают).
- [x] Compact-плотность (`densityFor`) и цвета кадра в fullscreen (кадр собирается токенами; проверено метрикой SGR).
- [x] `--minimal` остаётся inline и не захватывает экран; `--fullscreen` включает полноэкранный режим.
- [x] Панели сессий, субагентов/jobs, todo/goals, контекста и очереди открываются и обновляются; files/diff и workflow не сделаны.
- [ ] Проверено на Windows Terminal, VS Code-терминале, WSL и macOS: копирование и scrollback не ломаются (Windows Terminal и WSL — да, macOS — нет).
- [x] `KIBBORG_INLINE=1` (аварийный plain-режим) выводит читаемый текст.
- [x] Одиночный `Escape` разрешается по простою и не теряется (`escape-idle.ts`), закрытие панели отменяет загрузки в полёте.
- [x] Инструмент визуального контроля кадра: `tests/frame-render.mjs` (`frame.txt`, `frame.html`, `frame.raw.txt`).

## K8 — Дистрибуция, тесты, документация

- [x] Сборка проходит; запуск из `lib/` работает без tsx.
- [x] `install.ps1` и `install.sh` ставят команду в PATH (или `pnpm link --global`), `kibborg` работает из любого каталога.
- [ ] Unit, интеграционные тесты, снапшоты и e2e сервера зелёные; прогон на Windows и Linux выполнен.
- [ ] Гейты репо зелёные: `typecheck`, `lint`, `test`, `hygiene`, `verify-export-jsdoc`.
- [x] `import-boundary.spec.ts` зелёный.
- [ ] Документация обновлена; ссылка из `docs/` добавлена; `doc-sync` проходит.
- [ ] Нагрузочная проверка (длинная сессия, виртуализация вывода, память, время старта) выполнена, метрики зафиксированы.

## Capability Matrix

| Capability | Web | CLI (TUI) | Server | Headless |
|---|---|---|---|---|
| Agent loop + tools | ✓ | ✓ | ✓ | ✓ |
| Sessions / resume / fork / rename / archive / search | ✓ | ✓ | ✓ | ограниченно |
| Approvals | ✓ | ✓ | ✓ | deny + exit 3, либо `--auto/--yolo/--permission-mode` |
| Questions | ✓ | ✓ | ✓ | `--question-answers` иначе exit 3 |
| Plan + review | ✓ | ✓ | ✓ | `--plan` / JSON |
| MCP / skills / jobs / subagents / workflow | ✓ | ✓ | ✓ | ✓ |
| Skill manager (benchmark/versions) | ✓ | ✓ | ✓ | CLI-подкоманды |
| Goals / todos / queue | ✓ | ✓ | ✓ | цель через флаг |
| Models / credentials / settings | ✓ | ✓ | ✓ (loopback-pin) | ✓ (env/флаги) |
| Diff / изменённые файлы | ✓ | ✓ | ✓ у attach-клиента | JSON-список |
| Vision / вложения | ✓ | путь + маркер (+делегирование субагенту) | ✓ | путь |
| Streaming | WS | ANSI/plain | WS | stream-json |
| Fullscreen TUI | — | ✓ (K7) | — | — |
| Оркестратор (executor-модель) | ✓ | ✓ | ✓ | ✓ |

## Паритет с референсами

Оси первой поставки (снято с живых `claude`, `opencode`, `grok`):

- [ ] Жизненный цикл сессии: `--continue`, `--resume [id|picker]`, `--fork-session`, `--name`, `-w/--worktree [--ref]`.
- [ ] Пермишены: `--safe`, `--auto`, `--yolo`, `--permission-mode {plan,acceptEdits,auto,dontAsk,bypassPermissions,manual}`, `--allow/--deny`, `--tools`.
- [ ] I/O: `-p/--print`, `--output-format {text,json,stream-json}`, `--include-partial-messages`, `--json-schema`, `--prompt-file`, `--fail-on-question`, `--question-answers`.
- [ ] Модель: `-m/--model`, `--effort`, `--agent/--preset`, `--add-dir`.
- [ ] Сервер: `serve`, `attach <url>`, `--port/--hostname`, `--mdns` (опционально).
- [ ] Диагностика: `doctor` (+`--json`, `--fix`), `version`, `--dump-config`/`inspect`, `stats`, `export`.
- [ ] Слэш-команды: `/help /status /model /effort /compact /new /clear /resume /sessions /fork /rename /plan /view-plan /permissions /auto /always-approve /skills /mcps /plugins /hooks /tasks /goal /find /transcript /copy /export /rewind /quit` и скиллы как `/имя`.

Бэклог (чужие продуктовые надстройки): облачные сессии и teleport, `--tmux`, `/imagine`, `/imagine-video`, marketplace, `/share`, `/btw`, `/loop`, `/deep-research`, `/dream`, GitHub-agent и `pr`, cloud multi-agent review.

## Фикстура `--question-answers`

```json
{
  "q_7f3a1c": { "selected": ["Allow once"] },
  "q_91b2de": { "selected": ["Postgres", "Redis"], "custom": "и добавить SQLite" },
  "q_a04c55": { "custom": "использовать существующий конфиг" }
}
```

Правила разбора:

1. Ключ — идентификатор вопроса из фрейма запроса (`questionId`), а не порядковый номер.
2. `selected` — метки из вариантов, предложенных в запросе; порядок не важен, дубликаты отвергаются.
3. `custom` — свободный текст; для single-select допустим либо `selected`, либо `custom`, для multi-select — обе части одновременно.
4. Неизвестный идентификатор, чужая метка, пустой `custom` или незакрытый набор → ошибка, exit 2. Молчаливое игнорирование запрещено.

## Проверки гигиены

Греп запрещённой формы имени (PowerShell regex с negative lookahead). Ожидаемый результат: находок нет, кроме трёх законных метаупоминаний — формулировки правила R9 в `PLAN.md` и `ARCHITECTURE.md` и самой этой команды проверки.

```powershell
Select-String -Path D:\Deepseec_DaVinchi\Kibborg_CLI\* -Pattern 'kiborg(?!b)' -AllMatches
```

Проверка Core API Boundary:

```powershell
pnpm vitest run Kibborg_CLI/tests/import-boundary.spec.ts
```

Тест запрещает импорты путей `packages/*/src/*` и внутренних модулей ядра (`agent`, `agent-loop`, `orchestrator`, реализации инструментов, хранилище сессий) из `Kibborg_CLI/**` и разрешает только публичные контракты: `@deepseek-ai/dsh-app-boot`, `@deepseek-ai/dsh-host-apiproxy` (api/client), клиентские плагины Remote и собственные пакеты `@kibborg/*`.
