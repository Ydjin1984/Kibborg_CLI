# Kibborg CLI — консольная версия DeepSeek_Kibborg_Harness (v3, заморожен)

Статус: план утверждён и заморожен; v4 не выпускается. Этот файл — единственный источник правды.
Порядок исполнения: **нулевой шаг (документы)** → **K0.0 Spike** → отчёт по шаблону → **СТОП** → K0+.

## 1. Цель и критерии успеха

**Цель.** Третий интерфейс `DeepSeek_Kibborg_Harness` — консольный `kibborg` уровня Claude Code / OpenCode / Grok CLI, работающий поверх **того же ядра и того же Remote-контракта**, что Web GUI. Ни второго агента, ни второго реестра инструментов, ни второго хранилища сессий, ни второго конфиг-слоя.

**Критерии успеха:**
1. `kibborg` из любого каталога (в т.ч. терминал VS Code) открывает интерактивную сессию.
2. `kibborg "задача"` — одноразовая задача; `kibborg -p "..."` — headless с `--output-format text|json|stream-json` и пригодными для CI exit-кодами.
3. Функционал Web доступен в CLI по Capability Matrix (§11).
4. `kibborg serve` + `kibborg attach <url>` работают; локальный режим — in-process, без сети и фоновых процессов.
5. Ядро не переписано: правки `packages/`/`apps/` только аддитивные и минимальные (R8, §7).
6. Каждая фаза закрывается **одной пользовательской командой** (DoD, §6).

## 2. Ключевые факты репозитория (основа решений)

| Факт | Где |
|---|---|
| `dsh` — launcher профилей (`--profile <name>`, алиасы `web`, `plugin`, `mcp`, `--dump-config`) | `apps/cli/src/args.ts` |
| Профиль = `$DSH_HOME/profiles/<name>/{package.json,cordis.yml,cordis.patch.yml}`, поле `dsh.profile.bundles` | `~/.dsh/profiles/{web,headless}` |
| База уже содержит агентский функционал: tools (fs/shell/jobs/workflow/subagent/skill/todo/goal/ralph/web), plan-mode, compaction, permission-presets, sandbox, approval, sessions (JSONL), MCP, settings, credentials, session-query, token-meter, subprocess | `packages/bundle/base/cordis.patch.yml` |
| **`typert`, `typert-loader`, `typert-gateway` уже в базе** | там же, строки 30–38 |
| Веб-плоскость = `webServer` + `api-gateway`(host) + `api-remotes` + `host-apiproxy` + ~40 `ui-*`; агентские ряды отключены ради presets | `packages/bundle/web-app/cordis.patch.yml` |
| Там же: базовые агентские ряды оставлены «для TUI, который single-session и компонует агента на уровне процесса» | там же, строки 343–348 |
| `api-remotes` README: клиентская часть «переиспользуема Web или будущим TUI с тем же React-free `ctx.remote`» | `packages/api/remotes/README.md:11` |
| Изоморфный транспорт без сети: `InProcessApiClient` + `toFetchHandler(apiProxy)` | `packages/host/apiproxy/src/fetch/{client,handler}.ts` |
| `AbstractApiClient`: домены `sessions/subagents/host/workspace/skills/mcp/telegram/goals/settings/credentials/llm/events` + `respond()` | `packages/host/apiproxy/src/fetch/client.ts` |
| Approvals/вопросы — mux-фреймы со стабильным `rpcId`; ответ — `POST /api/respond` | `packages/host/apiproxy/src/api/{approvals,events}.ts`, `api-proxy.ts:4333–4344` |
| Слэш-команды — хостовый реестр (`command.execute` + `command/run|done`); скилл — обычный `session.prompt` с `/name` | `packages/host/apiproxy/README.md:61` |
| React-free object-layer: `SessionRuntime`, `WorkspaceRuntime`, `ConversationNodeAssembler`, `createSnapshotStore` | `packages/client/runtime/src/client/index.ts` |
| `healProfilesModuleFallback(anchor)` линкует closure зависимостей манифеста приложения в `$DSH_HOME/profiles/node_modules` | `packages/boot/app-boot/src/profile.ts:204–255` |
| `initProfile`, `DEFAULT_PROFILE_BUNDLES`, `boot/loadProfile/composeEntries/installFailLoud/watchUserPatches` — публичные экспорты | `packages/boot/app-boot/src/index.ts` |
| Клиентская половина `connection` **не экспортирует** `createWebConnectionRpc`/`ConnectionController` | `packages/client/connection/src/client/{index,rpc,connection}.ts` |
| Клиентские плагины объявлены `dsh.client.platform: web`; код уже defensively проверяет отсутствие браузера | `packages/typert/registry/package.json`, `packages/client/connection/src/client/index.ts:85` |
| Референсы доступны локально: `claude`, `opencode`, `grok` | `~/.local/bin/claude.exe`, npm `opencode`, `~/.grok/bin/grok.exe` |

## 3. Зафиксированные решения

**R1.** Код — в `Kibborg_CLI/` как отдельный workspace-корень: `+ Kibborg_CLI/apps/*`, `+ Kibborg_CLI/packages/*` в `pnpm-workspace.yaml`; host-face пакеты — в `tsconfig.host.json`.

**R2.** In-process клиент поверх того же Remote-контракта. Дефолт `InProcessApiClient(toFetchHandler(ctx.apiProxy))`; `WebApiClient` — только `attach`/remote.

**R3.** Собственный минимальный ANSI-рендер без внешних зависимостей. `inline` — дефолт; `fullscreen` — opt-in `--fullscreen`. Визуальный эталон интерфейса — `UI.md`; замороженный макет `demo/kibborg-demo.bat` фиксирует спеку и служит golden-гейтом (`demo\kibborg-demo.bat check`) для будущего пакета `@kibborg/tui`. Демо — макет, а не движок: боевой рендер реализуется в TypeScript и в PowerShell не развивается.

**R4.** Server/remote/headless — в первую поставку: `kibborg serve`, `kibborg attach <url>`, headless-форматы и exit-коды.

**R5.** Объём v1 — всё отмеченное пользователем (§11) + оркестратор, vision-маршрутизация, внешние агенты как субагенты (§14).

**R6.** Общий дом данных `$DSH_HOME`; `KIBBORG_HOME` — только тесты/CI. Собственного конфиг-слоя нет: настройки CLI — namespace `kibborg-cli` в существующем `settings`.

**R7.** Профиль `kibborg` создаётся автоматически (`initProfile`) с `bundles: [@deepseek-ai/dsh-base, @kibborg/cli-bundle]`. Расхождение бандлов — fail loud. `kibborg doctor` **только диагностирует**; исправление — только явным `kibborg doctor --fix` с отчётом об изменениях. Тихих починок нет.

**R8.** Core API Boundary: ноль импортов внутренностей; цель — ноль правок ядра. Единственная известная зона — RPC-caller: допустим **один аддитивный субпуть-export**; копия протокольной логики (`createWebConnectionRpc`) запрещена.

**R9.** Единое имя — **`kibborg`** (команда, профиль, скоуп `@kibborg/*`); форма `kiborg` запрещена и проверяется грепом в чек-листе.

**R10.** thinking ≠ chain-of-thought: скрытые рассуждения никогда не печатаются. Печатаются статус этапа (Planning / Executing / Verifying), тул-строки, план после plan-mode, ошибки/ретраи/нотис лимита, token-meter, финальный ответ. Reasoning-чанки mux не рендерятся; отладка — `--debug` в stderr.

**R11.** Headless-интерактив: дефолт `--fail-on-question` → approval/question без ответа + выход с кодом **3**; явные `--permission-mode`, `--auto`, `--yolo`, allow/deny, `--question-answers <file.json>`.

**R12.** Контракт прерывания (TTY/не-TTY) — §4.1.

### 3.1 Core API Boundary (раздел `ARCHITECTURE.md` + CI-гейт)

Разрешено: (1) публичные экспорты `@deepseek-ai/dsh-app-boot`; (2) композиция профиля (patch-слои, `--patch`, in-memory overlays для `--tools/--allow/--deny`); (3) `ctx.apiProxy` + `InProcessApiClient`/`toFetchHandler` или `WebApiClient`; (4) Remote-домены (`session.*`, `workspace.*`, `command.*`, `skill.*`, `mcp.*`, `goals.*`, `settings.*`, `credentials.*`, `llm.*`, `host.*`, `subagent.*`); (5) forwarded-события `ctx.remote.$on` и объектный слой `client-runtime` — если K0.0 подтвердил Node-совместимость; (6) собственные пакеты `Kibborg_CLI/`.

Запрещено: импорт внутренних модулей `agent`, `agent-loop`, `orchestrator`, tool-реализаций, хранилища сессий напрямую; обход approval/permission/sandbox через внутренние сервисы; второй реестр инструментов; второе хранилище сессий; второй конфиг-слой; второй слой скиллов.

Гейт: `Kibborg_CLI/tests/import-boundary.spec.ts` — allowlist импортов `Kibborg_CLI/**` + запрет путей `packages/*/src/*`.

## 4. Архитектура

```
kibborg (bin) → @kibborg/cli (Kibborg_CLI/apps/cli)
   │ init/heal профиля kibborg → compose patch-слоёв → boot cordis-дерева
   ▼
HOST-плоскость (тот же процесс)
   base: agent-loop, tools, sessions, approvals, plan, compaction, MCP, skills,
         jobs, workflow, subagent, goals, settings, credentials, typert, typert-gateway
 + @kibborg/cli-bundle (patch + startup-плагин: флаги CLI → ctx.cmdlineArgs/сервисы,
                        режим экрана, политика, разрешённые инструменты)
 + host-apiproxy (ctx.apiProxy) + api-remotes (host-политика Agent/Session)
   ▲
   │ InProcessApiClient(toFetchHandler(ctx.apiProxy))  — ноль сети
   ▼
КЛИЕНТ-плоскость (тот же процесс, @kibborg/client-node)
   connection-сервис (совместимый ConnectionHandle: api / домены / respond / rpc /
                      hostDescription / start) + RPC-caller
 + typert-registry/client → api-gateway/client (ctx.remote) → api-remotes/client
 + client-runtime (SessionRuntime, WorkspaceRuntime, ConversationNodeAssembler, projections)
   ▼
@kibborg/tui (ANSI: inline | fullscreen; стриминг, тул-строки, diff, промпты approval/
              question/plan, панели, статус-строка)
```

Ход: ввод → объектный слой → `session.prompt` / `command.execute` → in-process fetch → gateway/apiProxy → host agent-loop → потоки `events.mux`/`events.host` → узлы Conversation → рендер. Ответ на интерактив → `/api/respond`.

Remote: тот же клиент-слой против `kibborg serve` (host-плоскость + `webServer` + собственный `/api`-маршрут с bearer-токеном + WS-даунлинки).

CLI-профиль не монтирует web-app бандл и браузерные `ui-*`; `client-connection`(host-half) в in-process не нужен.

### 4.1 Контракт прерывания и сигналов (`ARCHITECTURE.md`)

```
TTY:
  1-й Ctrl+C или Esc         → session.cancel
  2-й Ctrl+C в течение ~800мс → выход: восстановление alt-screen, курсора, raw-mode;
                                корректное завершение процессов дерева
  Ctrl+C во время approval   → ответ 'rejected' + выход; никогда не разрыв посреди
                                записи файла инструментом
  Ctrl+D на пустом вводе     → выход
Не-TTY:
  SIGINT/SIGTERM             → завершение (130/0 по источнику), без интерактивных
                                промптов; незавершённый ход закрывается как cancelled
```

## 5. Структура `Kibborg_CLI/`

```
Kibborg_CLI/
├── README.md              # быстрый старт, команды, требования, таблица exit-кодов
├── PLAN.md                # этот план — единственный источник правды
├── TASKS.md               # задачи по ID, зависимости, DoD
├── CHECKLIST.md           # приёмка, Capability Matrix, паритет, фикстуры, грепы имени
├── ARCHITECTURE.md        # схема, поток данных, R1–R12, Core API Boundary, §4.1
├── TROUBLESHOOTING.md
├── UI.md                  # дизайн-спека интерфейса: экраны, токены темы, геометрия, клавиши, контракт нижней зоны
├── demo/                  # замороженный visual golden: kibborg-demo.bat (PowerShell-макет) + golden/all-plain.txt
├── bin/                   # kibborg.cmd/.ps1/kibborg(, kb.*), install.ps1, install.sh
├── apps/cli/              # @kibborg/cli — bin kibborg: argv, profile-boot, команды, doctor
├── packages/
│   ├── cli-bundle/        # @kibborg/cli-bundle — cordis.patch.yml + startup-плагин
│   ├── client-node/       # @kibborg/client-node — in-process carrier + client kernel + RPC-caller
│   ├── tui/               # @kibborg/tui — рендер, ввод, keybindings, промпты, панели
│   ├── ui-domains/        # @kibborg/ui-domains — экраны доменов
│   └── server/            # @kibborg/server — serve/attach, HTTP+WS, bearer-auth, mDNS(опц.)
└── tests/                 # интеграционные, e2e, снапшоты терминала, import-boundary.spec.ts
```

Конвенции репо для каждого пакета: `@kibborg/*`, `private: true`, ESM, `./invariant`, JSDoc на экспортах, README с разделом Model Experience, регистрация в `tsconfig.host.json` и `pnpm-workspace.yaml`.

## 6. Фазы, задачи и DoD

### K0.0 — Vertical Slice (hard gate; до всего остального)

**Строгий объём:** только профиль + пустой cli-bundle + `client-node` + plain stdout. **Никакого TUI, `/help`, `doctor`, шимов PATH, интерактивных промптов и полного парсера флагов.**

| ID | Задача |
|---|---|
| K0.0.1 | Минимальный профиль `kibborg` + пустой cli-bundle + запуск дерева |
| K0.0.2 | `@kibborg/client-node`: `InProcessApiClient`, `host.describe`, generic RPC-caller, подписка на mux |
| K0.0.3 | Проверка Node-исполнения клиентских плагинов (`typert-registry/client`, `api-gateway/client`, `api-remotes/client`, `client-runtime`): перечень модулей, обращающихся к DOM |
| K0.0.4 | Решение по исходу spike |

**Приоритет исхода:** (а) клиентский слой в Node без правок ядра — целевой; (б) свой тонкий слой поверх `IApiClient` + `ctx.typertGateway` без копирования протоколов — допустимый; (в) один аддитивный субпуть-export RPC-caller'а — только если (а) и (б) ломают Remote-контракт. Исход (в) требует Agent Note по шаблону §7.

**DoD — два прогона, каждый в TTY и в пайпе:**
1. `kibborg "hello"` — CLI → Core → LLM → stream → stdout.
2. `kibborg "прочитай README.md и кратко опиши проект"` — prompt → tool call → filesystem → tool result → model → final (доказательство подключения именно к существующему agent-loop).

Плюс: mux-события видны как status/tool/final; `packages/*` и `apps/*` не изменены, кроме возможного аддитивного export (исход «в»).

**Отчёт строго по шаблону, затем СТОП:**
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

### K0 — Foundation
| ID | Задача |
|---|---|
| K0.1 | Каркас пакетов: workspace-записи, package.json/tsconfig/tsdown, `./invariant` (документы созданы нулевым шагом) |
| K0.2 | `@kibborg/cli`: bin `kibborg`, сборка, версия |
| K0.3 | Свой profile-boot на публичных экспортах `dsh-app-boot`: anchor, авто-init, heal, compose, boot, cmdline, fail-loud, watch, SIGINT/SIGTERM |
| K0.4 | `@kibborg/cli-bundle`: patch-слой (insert'ы: startup, runtime, `host-apiproxy`, `api-remotes`) + `parseCmdline` |
| K0.5 | Шимы `bin/*`, `install.ps1\|sh` (PATH или `pnpm link --global`) |
| K0.6 | `kibborg doctor` (+`--json`, `--fix`): диагностика не меняет ничего; `--fix` исправляет и печатает изменения; секреты маскируются без `--reveal` |
| K0.7 | `kibborg version`, `--help`, `--dump-config` (маскирование секретов) |
| K0.8 | Agent Note про третью поверхность |

**DoD:** `kibborg version|doctor|--help` из любого cwd; профиль создаётся сам; stale bundles → fail loud с причиной и рекомендацией `kibborg doctor --fix`.

### K1 — Vertical slice в CLI + inline-рендер
| ID | Задача |
|---|---|
| K1.1 | Маппинг флагов (сессии, пермишены, io, модель) в профильный overlay и `cmdlineArgs` |
| K1.2 | Inline-рендер: стриминг, тул-строки с прогрессом/статусом, ошибки провайдера, retry- и max-tokens-нотисы |
| K1.3 | Статус-строка (модель, режим пермишенов, git-ветка, контекст-метрика, сессия) |
| K1.4 | Ввод: multiline, история, Tab-дополнение, контракт прерывания §4.1 |
| K1.5 | Не-TTY/CI: plain-вывод, диагностика в stderr, корректные exit-коды |
| K1.6 | R10 в рендере: reasoning-чанки не печатаются |
| K1.7 | Снапшот-тесты вывода на `@deepseek-ai/dsh-llm-mock-server` — обязательны с этой фазы |

**DoD:** `kibborg "опиши каталог"` корректно в TTY и в пайпе; снапшоты зелёные.

### K2 — Agent REPL, сессии, история
| ID | Задача |
|---|---|
| K2.1 | REPL: prompt, очередь (`session/queue`), steering, прерывание |
| K2.2 | Сессии: список, открытие, `resume`/`continue`, rename, fork, архив, поиск, старт в новом workspace |
| K2.3 | История: пагинация, узлы Conversation, проекции |
| K2.4 | Todos/goals: виджет, `/goal`, Ralph-луп |
| K2.5 | Jobs/субагенты/workflow: списки, статусы, дерево, follow-up, interrupt |
| K2.6 | Файлы и diff: изменённые файлы после хода, unified-diff, `host.listChildren/readTextFile` |
| K2.7 | Вложения: файлы/пути через content parts + `imageLimits`; vision-маршрутизация (§14) |
| K2.8 | Компактизация: `/compact`, авто-компакт, чекпоинты |
| K2.9 | Git worktree (`--worktree [name]`), ветка/статус |

**DoD:** `kibborg` + `kibborg resume` дают полноценную работу с задачами; `--worktree` создаёт изолированное дерево.

### K3 — Интерактив: approvals, вопросы, plan, пермишены
| ID | Задача |
|---|---|
| K3.1 | Approval-промпт: `approval/requested` → `Allow once / for session / always / Deny` → `respond` |
| K3.2 | Question-промпт: single/multi-select + custom, валидация как в схеме |
| K3.3 | Plan mode: `Shift+Tab`/`/plan`, показ плана, бинарный plan-review, `exit_plan_mode` |
| K3.4 | Пермишены: `--safe`, `--auto`, `--yolo/--dangerously-skip-permissions`, `--permission-mode`; переключение на ходу |
| K3.5 | Ограничение инструментов: `--tools`, `--allow/--allowedTools`, `--deny/--disallowedTools` → in-memory overlay |
| K3.6 | Headless-политика (R11): `--fail-on-question` по умолчанию → exit 3; `--question-answers <file.json>`; явные `--auto/--yolo/--permission-mode` |
| K3.7 | Отмена/восстановление: cancel хода, консистентность лога, double-start → `attach` или новая сессия |

**DoD:** approval в терминале не зависает; plan не допускает правок до одобрения; `-p` без флагов завершается кодом 3, а не висит.

### K4 — Команды, реестры, настройки
| ID | Задача |
|---|---|
| K4.1 | Слэш-команды через `command.list`/`command.execute` + локальные псевдо-команды |
| K4.2 | Скиллы: список (`skill.list`, `modelInvocable`), вызов `/имя` |
| K4.3 | Менеджер скиллов: `kibborg skills list/show/save/remove/restore/trash/enable/disable/versions/rollback/benchmark` |
| K4.4 | Модели: `/model`, `kibborg models`, effort, `session.selectModel`, `llm.*` |
| K4.5 | Ключи и настройки: `kibborg auth`, `kibborg settings`, онбординг без ключа |
| K4.6 | MCP: `kibborg mcp list/add/remove/enable/disable/status` |
| K4.7 | Экран-модал с табами (skills/mcp/plugins/hooks) |
| K4.8 | Settings namespace `kibborg-cli` (тема, экран, multiline, timestamps, keybindings) |
| K4.9 | Autocomplete: `/`, `@` (файлы), `#` (сессии/ссылки) |
| K4.10 | Экспорт/статистика: `kibborg export`, `kibborg stats`, `/copy` (OSC 52), `/find`, `/transcript` |
| K4.11 | **Оркестратор**: `@deepseek-ai/dsh-orchestrator` + настройка локальной модели-исполнителя. Must для v1, не блокирует DoD K2/K3 |

**DoD:** `/model`, `/mcp`, `/skills` обслуживаются хостовыми реестрами; оркестратор включается и работает.

### K5 — Headless / CI
| ID | Задача |
|---|---|
| K5.1 | `kibborg -p/--print`, `kibborg run "task"`, `--output-format text\|json\|stream-json`, `--include-partial-messages`, `--json-schema`, `--prompt-file`, `--fail-on-question`, `--question-answers <file.json>` |
| K5.2 | `--max-turns`, `--no-session-persistence`, ограничение бюджета (если метрика доступна) |
| K5.3 | Exit-коды 0/1/2/3/130; машинно-читаемые ошибки; строгий stdout/stderr-контракт |
| K5.4 | Примеры для CI (GitHub Actions/GitLab), cron, однократный Docker-запуск |

**DoD:** `kibborg -p "..." --output-format json` пригоден для пайплайна без TTY.

### K6 — Serve / attach / auth
| ID | Задача |
|---|---|
| K6.1 | `@kibborg/server`: host-плоскость + `webServer` + собственный `/api`-маршрут |
| K6.2 | WS-даунлинки `events.mux`/`events.host` |
| K6.3 | **Безопасность (блокеры фазы)**: отказ старта при bind вне loopback без токена; токен только из `KIBBORG_TOKEN`/файла; CORS выключен; маскирование секретов в `doctor`/`--dump-config`; журнал запросов |
| K6.4 | `kibborg attach <url>` / `--connect`: тот же TUI против удалённого сервера |
| K6.5 | Эксплуатация: systemd, Dockerfile, healthcheck, graceful shutdown, `--log-file` |
| K6.6 | Опционально: mDNS/`--mdns` |

**DoD:** `serve` + `attach` с токеном работают; без токена вне loopback — отказ старта; неверный токен — 401.

### K7 — Fullscreen TUI (в поставке v1, последней фазой)
| ID | Задача |
|---|---|
| K7.1 | Alt-screen, компоновка, ресайз, `--fullscreen`/`--minimal`, аварийный plain-режим |
| K7.2 | Панели: сессии, субагенты/jobs/workflow, todo/goals, файлы/diff, контекст, очередь |
| K7.3 | Keybindings: лидер-клавиша (`Ctrl+X`), `Shift+Tab` (режимы), `Ctrl+O` (детали), `/find`, Vim-скролл |
| K7.4 | Темы, compact mode, timestamps, screen-reader/plain-режим |
| K7.5 | Устойчивость: восстановление alt-screen; проверка Windows Terminal/WSL/macOS |

**DoD:** fullscreen не ломает Windows Terminal и VS Code; режимы переключаются на ходу.

### K8 — Дистрибуция, тесты, документация
| ID | Задача |
|---|---|
| K8.1 | Сборка (`tsdown`), прод-запуск без tsx |
| K8.2 | Глобальная установка: `install.ps1\|sh`, PATH или `pnpm link --global`, проверка в pwsh/bash/WSL/VS Code |
| K8.3 | Тесты: unit, интеграционные (mock-LLM), снапшоты TUI/plain, e2e `serve`+`attach`, Windows+Linux |
| K8.4 | Гейты репо: `typecheck`, `lint`, `test`, `hygiene`, `verify-export-jsdoc` |
| K8.5 | `import-boundary.spec.ts` (CI-чек Core API Boundary) |
| K8.6 | Документация: README, ARCHITECTURE, TROUBLESHOOTING, ссылка из `docs/`, Agent Note |
| K8.7 | Нагрузка: длинная сессия, виртуализация вывода, память, время старта |

**DoD:** `kibborg` работает из любого каталога на Windows/Linux/macOS/WSL; гейты зелёные.

## 7. Изменения вне `Kibborg_CLI/`

| Файл | Изменение | Зачем |
|---|---|---|
| `pnpm-workspace.yaml` | +2 записи (`Kibborg_CLI/apps/*`, `Kibborg_CLI/packages/*`) | pnpm видит пакеты |
| `tsconfig.host.json` | +references наших пакетов | typecheck/сборка |
| `packages/client/connection/package.json` (+ клиентский index) | **только при исходе K0.0.4(в)**: один аддитивный субпуть-export RPC-caller'а | избежать копии протокольной логики |
| `.agents/notes/implemented/architecture/*` | Agent Note | конвенция репо |
| `package.json` (корень) | опционально dev-скрипт `kibborg` | удобство |
| `packages/*`, `apps/cli/*` | **не меняем** иначе | R8 |

**Шаблон Agent Note для исхода (в):** (1) почему нельзя (а) — какие модули блокируют Node-исполнение, с путями; (2) почему нельзя (б) — что в Remote-контракте требует RPC-caller'а, а не `IApiClient`; (3) какой ровно символ экспортируется (имя, субпуть, форма) и почему не вся клиентская половина `connection`; (4) кто потребитель — только `@kibborg/client-node`; почему браузерный бандл не затронут.

Не делаем: вторую реализацию агента, второй tool-реестр, второе хранилище сессий, вторую систему скиллов, второй конфиг-слой, второй дом данных (`~/.kibborg` в v1 не вводится).

## 8. Крайние случаи и сценарии отказа

- **Нет TTY / CI / пайп** → plain, без ANSI-курсоров; интерактив не ждёт ввода (R11), нужен ответ → exit 3.
- **Нет `DEEPSEEK_API_KEY`** → подсказка `kibborg auth`; в headless — внятная ошибка и exit 2.
- **Профиль отсутствует / stale bundles** → авто-init либо fail loud с точной причиной; исправление — только `kibborg doctor --fix`.
- **Нет собранных артефактов** (`lib/typert.remote-client.*`) → явная диагностика с командой сборки.
- **Клиентский слой несовместим с Node** → исход (б)/(в) из K0.0.4; TUI не строится на неизвестности.
- **Разрыв соединения (remote)** → восстановление поколения connection, повтор baselines (сессии, workspace, проекции, очередь), лог не теряется.
- **Прерывание на середине хода** → §4.1: cancel → закрытие незавершённых узлов; двойной Ctrl+C — выход.
- **Двойной запуск той же сессии** → вторая инстанция не ворует mux: `attach` или новая сессия.
- **Windows**: UTF-8/ANSI, отсутствие SIGTERM-семантики, ConPTY-ресайз, OSC 52; проверка в pwsh и VS Code.
- **Секрет в argv** → предупреждение и требование env/файла; маскирование в `doctor` и `--dump-config`.
- **`serve` вне loopback без токена или с CORS** → отказ старта.

## 9. Тесты и критерии приёмки

- **Unit**: парсер argv/команд, маппинг флагов в overlay, чистые функции рендера, RPC-caller, шимы PATH.
- **Интеграционные (keyless, mock-LLM)**: полный ход (prompt → tool → approval → ответ), resume, fork, `/compact`, `/goal`, plan-review, вопрос, прерывание, очередь, jobs, субагент; снапшоты — с K1.
- **Headless**: `-p` в трёх форматах, exit-коды (включая 3), `--json-schema`, `--question-answers`, отказ интерактива без флагов.
- **E2E сервера**: `serve` → `attach` → ход; 401 при неверном токене; отказ старта без токена вне loopback.
- **Кросс-платформенно**: Windows (pwsh), Linux (bash), macOS, WSL, VS Code-терминал вручную.
- **Гейты репо**: `typecheck`, `lint`, `test`, `hygiene` не деградируют; `import-boundary.spec.ts` зелёный.
- **Приёмка по фазам** — таблица DoD (§6) в `CHECKLIST.md`.

## 10. Порядок работ

```
K0.0 Spike (hard gate)   → отчёт a/b/c по шаблону, СТОП
K0 Foundation            → kibborg version|doctor|--help из любого cwd
K1 Slice + inline        → kibborg "опиши каталог" в TTY и пайпе
K2 REPL + sessions       → kibborg / kibborg resume, рабочая задача
K3 Approvals/plan/perm   → безопасная автономность, нет зависаний
K4 Commands/registries   → /model /mcp /skills + оркестратор (не блокирует K2/K3)
K5 Headless/CI           → kibborg -p --output-format json
K6 Serve/attach/auth     → сервер и remote с токеном
K7 Fullscreen TUI        → панели и полировка UX
K8 Distro/tests/docs     → установка, гейты, документация
```

После K3 CLI пригоден для ежедневной работы в терминале VS Code.

## 11. Capability Matrix (`CHECKLIST.md`)

| Capability | Web | CLI (TUI) | Server | Headless |
|---|---|---|---|---|
| Agent loop + tools | ✔️ | ✔️ | ✔️ | ✔️ |
| Sessions / resume / fork / rename / archive / search | ✔️ | ✔️ | ✔️ | ограниченно |
| Approvals | ✔️ | ✔️ | ✔️ | deny + exit 3, либо `--auto/--yolo/--permission-mode` |
| Questions | ✔️ | ✔️ | ✔️ | `--question-answers` иначе exit 3 |
| Plan + review | ✔️ | ✔️ | ✔️ | `--plan` / JSON |
| MCP / skills / jobs / subagents / workflow | ✔️ | ✔️ | ✔️ | ✔️ |
| Skill manager (benchmark/versions) | ✔️ | ✔️ | ✔️ | CLI-подкоманды |
| Goals / todos / queue | ✔️ | ✔️ | ✔️ | цель через флаг |
| Models / credentials / settings | ✔️ | ✔️ | ✔️ (loopback-pin) | ✔️ (env/флаги) |
| Diff / изменённые файлы | ✔️ | ✔️ | **✔️ у attach-клиента** | JSON-список |
| Vision / вложения | ✔️ | путь + маркер (+делегирование субагенту) | ✔️ | путь |
| Streaming | WS | ANSI/plain | WS | stream-json |
| Fullscreen TUI | — | ✔️ (K7) | — | — |
| Оркестратор (executor-модель) | ✔️ | ✔️ | ✔️ | ✔️ |

## 12. Паритет с референсами: по осям, не клоном флагов

Оси v1 (снято с живых `claude`, `opencode`, `grok`):
- **Жизненный цикл сессии**: `--continue`, `--resume [id|picker]`, `--fork-session`, `--name`, `-w/--worktree [--ref]`.
- **Пермишены**: `--safe`, `--auto`, `--yolo`, `--permission-mode {plan,acceptEdits,auto,dontAsk,bypassPermissions,manual}`, `--allow/--deny`, `--tools`.
- **I/O**: `-p/--print`, `--output-format {text,json,stream-json}`, `--include-partial-messages`, `--json-schema`, `--prompt-file`, `--fail-on-question`, `--question-answers`.
- **Модель**: `-m/--model`, `--effort`, `--agent/--preset`, `--add-dir`.
- **Сервер**: `serve`, `attach <url>`, `--port/--hostname`, `--mdns` (опц.).
- **Диагностика**: `doctor` (+`--json`, `--fix`), `version`, `--dump-config`/`inspect`, `stats`, `export`.
- **Слэш-команды**: `/help /status /model /effort /compact /new /clear /resume /sessions /fork /rename /plan /view-plan /permissions /auto /always-approve /skills /mcps /plugins /hooks /tasks /goal /find /transcript /copy /export /rewind /quit` (+ скиллы как `/имя`).

Бэклог (чужие продуктовые надстройки): облачные сессии/teleport, `--tmux`, `/imagine`, `/imagine-video`, marketplace, `/share`, `/btw`, `/loop`, `/deep-research`, `/dream`, GitHub-agent/`pr`, cloud multi-agent review. Наши преимущества вместо них: оркестратор, goals/ralph, jobs, workflow, субагенты (включая внешние `claude`/`codex`), skills-manager, MCP, session-query, token-meter.

## 13. Риски и допущения

| Риск | Митигация |
|---|---|
| Клиентские плагины (`platform: web`) не идут в Node | K0.0 (адресный spike) + приоритет а→б→в + изоляция решения до написания TUI |
| Строгие Remote-дескрипторы требуют собранных артефактов | `doctor` проверяет артефакты; dev — tsx + SRC на хосте; явная диагностика |
| Объём (9 фаз) | Фазовые DoD; K0.0–K3 дают рабочий CLI; K4.11 и внешние субагенты вне критического пути |
| Терминальный рендер на 3 ОС | inline по умолчанию, plain как аварийный режим, тесты Windows+Linux |
| Remote-security | K6.3 как блокеры с acceptance-тестами |
| Расхождение CLI и Web | Core API Boundary + CI-гейт импортов + единый Remote-контракт |
| Раздувание флагов/команд | §12: оси в v1, остальное бэклог |

**Допущения:** Node ≥ 22.19; сборка ядра выполнена в чекауте; общий `$DSH_HOME`; `KIBBORG_HOME` — только тесты/CI; ключ для реальных ходов; киборг-исполнитель доступен через существующие subagent-тулы.

## 14. Дополнения сверх разбора внешних моделей

1. **Режим оркестратора в CLI** (K4.11) — must для v1, не блокирует K2/K3.
2. **Vision-маршрутизация** (K2.7): у головной модели зрения нет — CLI явно делегирует чтение изображений субагенту с vision (правило в системной секции профиля + навык).
3. **Внешние агенты как субагенты** (opt-in, если бинарь найден; `doctor` это показывает): `subagent-claude-code`, `subagent-codex`.
4. **DoD-команда на каждую фазу.**
5. **Core API Boundary + CI-гейт.**
6. **R10 (thinking ≠ CoT)** и **§4.1 (контракт прерывания).**

## 15. Нулевой шаг и артефакты (до K0.0)

1. Создать `Kibborg_CLI/` и документы: `README.md`, `PLAN.md` (этот текст), `TASKS.md` (K0.0–K8.7 с зависимостями и DoD), `CHECKLIST.md`, `ARCHITECTURE.md` (R1–R12, Core API Boundary, §4.1), `TROUBLESHOOTING.md`.
2. В `README.md` — таблица exit-кодов.
3. В `CHECKLIST.md` — фикстурный пример `--question-answers` и шаблон отчёта spike.
4. В `CHECKLIST.md` и `TASKS.md` — явный объём K0.0.
5. Затем строго K0.0.1–K0.0.4, отчёт по шаблону, **СТОП**. K0+ — только после отчёта.

Git-операции (commit/push/PR) не выполняются без отдельной просьбы пользователя.
