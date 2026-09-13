# ARCHITECTURE — Kibborg CLI

Документ описывает текущее устройство CLI и границы взаимодействия с ядром. Источник правды по объёму и порядку работ — `PLAN.md`.

## 1. Место в системе

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

## 2. Поток хода

1. Пользователь вводит текст в TUI; ввод попадает в объектный слой (`client-runtime`), который владеет состоянием сессии, окном событий и сборкой узлов разговора.
2. Строка, начинающаяся с `/`, идёт в `command.execute` (хостовый реестр слэш-команд); скилл вида `/имя` — это обычный `session.prompt`, распознаваемый хостом на границе pre-step. Отдельного провода для скиллов нет.
3. Обычный текст уходит как `session.prompt`; запрос идёт через in-process fetch к `typertGateway` либо к `apiProxy` — без HTTP и без портов.
4. Хост-плоскость исполняет ход: agent-loop → инструменты → подтверждения → результат.
5. Обратный поток идёт двумя каналами того же Conn/`IApiClient`: `events.mux` (события сессий, `session/projection`, `session/queue`, `session/jobs`, `approval/requested`, вопросы) и `events.host` (события хоста: сессии, workspace, архив, forwarded-события Remote).
6. Объектный слой складывает события в узлы Conversation; рендер печатает статус этапа, строки инструментов, diff, ошибки, метрику контекста и финальный ответ. Внутренние рассуждения не печатаются.

## 3. Поток remote

`kibborg serve` поднимает host-плоскость вместе с `webServer` и собственным `/api`-маршрутом: проверка bearer-токена, ограничения media-type и размера тела, WS-даунлинки для обоих потоков. `kibborg attach <url>` использует тот же клиентский слой, но с `WebApiClient` вместо in-process транспорта, поэтому различие между локальным и удалённым режимом ограничено транспортом.

## 4. Контракт прерывания и сигналов

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

## 5. Решения

**R1.** Код — в `Kibborg_CLI/` как отдельный workspace-корень: `Kibborg_CLI/apps/*` и `Kibborg_CLI/packages/*` в `pnpm-workspace.yaml`; host-face пакеты — в `tsconfig.host.json`.

**R2.** In-process клиент поверх того же Remote-контракта: `InProcessApiClient(toFetchHandler(ctx.apiProxy))`; `WebApiClient` — только для `attach`/remote.

**R3.** Собственный минимальный ANSI-рендер без внешних зависимостей: одна полноэкранная поверхность `@kibborg/tui` (`App`) — дефолт в терминале; `inline` — scrollback-fallback для не-TTY и `KIBBORG_INLINE=1`; `minimal` — то же, что `inline` (без захвата экрана и анимации).

**R4.** Server, remote и headless входят в первую поставку.

**R5.** Объём v1 — полный список возможностей пользователя плюс оркестратор, vision-маршрутизация и внешние агенты как субагенты.

**R6.** Общий дом данных `$DSH_HOME`; `KIBBORG_HOME` — только для тестов и CI. Отдельного конфиг-слоя нет: настройки CLI живут в существующем `settings` под namespace `kibborg-cli`.

**R7.** Профиль `kibborg` создаётся автоматически с бандлами `@deepseek-ai/dsh-base` и `@kibborg/cli-bundle`. Расхождение бандлов — fail loud. `kibborg doctor` только диагностирует; исправление — исключительно по явному `kibborg doctor --fix`, с печатью изменений.

**R8.** Core API Boundary: импорт внутренностей запрещён; цель — ноль правок ядра. Единственная известная зона — RPC-caller: допустим один аддитивный субпуть-export; копирование протокольной логики `createWebConnectionRpc` запрещено.

**R9.** Имя — `kibborg` (команда, профиль, скоуп `@kibborg/*`); форма `kiborg` запрещена и проверяется в чек-листе.

**R10.** thinking ≠ chain-of-thought: скрытые рассуждения не выводятся. Показываются статус этапа (Planning / Executing / Verifying), строки инструментов, план после plan-mode, ошибки, ретраи, нотис лимита токенов, метрика контекста и финальный ответ. Reasoning-чанки из mux не рендерятся; отладочный вывод — только `--debug` в stderr.

**R11.** Headless-интерактив: по умолчанию `--fail-on-question` — approval или вопрос остаются без ответа и процесс завершается кодом 3; явные `--permission-mode`, `--auto`, `--yolo`, allow/deny-правила и `--question-answers <file.json>` заменяют это поведение.

**R12.** Контракт прерывания и сигналов — раздел 4 этого документа.

## 6. Core API Boundary

Разрешённые пути взаимодействия CLI с ядром:

1. Публичные экспорты `@deepseek-ai/dsh-app-boot` (profile, boot, compose, patches, fail-loud, watch).
2. Композиция профиля: patch-слои, `--patch` overlays, in-memory overlays для `--tools`/`--allow`/`--deny`.
3. `ctx.apiProxy` вместе с `InProcessApiClient`/`toFetchHandler` (локально) либо `WebApiClient` (remote).
4. Remote-домены: `session.*`, `workspace.*`, `command.*`, `skill.*`, `mcp.*`, `goals.*`, `settings.*`, `credentials.*`, `llm.*`, `host.*`, `subagent.*`.
5. Forwarded-события через `ctx.remote.$on` и объектный слой `client-runtime` — при подтверждённой Node-совместимости в K0.0.
6. Собственные пакеты внутри `Kibborg_CLI/`.

Запрещено: импортировать внутренние модули `agent`, `agent-loop`, `orchestrator`, реализации инструментов и хранилище сессий напрямую; обходить approval, permission и sandbox через внутренние сервисы; заводить второй реестр инструментов, второе хранилище сессий, второй конфиг-слой или второй слой скиллов.

Гейт: `Kibborg_CLI/tests/import-boundary.spec.ts` — статическая проверка импортов `Kibborg_CLI/**` по allowlist и запрет путей `packages/*/src/*`.

## 7. Карта ядра, на которое опирается CLI

| Что нужно CLI | Где это уже есть | Как используется |
|---|---|---|
| Launcher профилей | `apps/cli/src/args.ts` | образец механики `--profile`; CLI поднимает свой профиль `kibborg` |
| Профиль и бандлы | `$DSH_HOME/profiles/*`, поле `dsh.profile.bundles` | наш профиль: `dsh-base` + `@kibborg/cli-bundle` |
| Агентский функционал | `packages/bundle/base/cordis.patch.yml` | берётся как есть: tools, plan-mode, compaction, permissions, approval, sessions, MCP, skills, jobs, workflow, subagents, goals |
| Точка подъёма дерева | `packages/boot/app-boot` (`initProfile`, `loadProfile`, `composeEntries`, `boot`, `installFailLoud`, `watchUserPatches`, `healProfilesModuleFallback`) | публичные экспорты для нашего profile-boot |
| Remote-хост | `packages/typert/*` (`typert`, `typert-loader`, `typert-gateway` уже в базовом слое) | цель вызовов `ctx.remote` |
| Транспорт без сети | `packages/host/apiproxy/src/fetch/{client,handler}.ts` (`InProcessApiClient`, `toFetchHandler`) | локальный режим |
| Домены клиента | `packages/host/apiproxy/src/fetch/client.ts` (`AbstractApiClient`) | sessions, host, workspace, skills, mcp, goals, settings, credentials, llm, subagents, events, `respond` |
| Интерактив | `packages/host/apiproxy/src/api/{approvals,events}.ts` | фреймы `approval/requested` и вопросы; ответ — `POST /api/respond` |
| Команды и скиллы | `packages/host/apiproxy/README.md` (`command.execute`, `command/run|done`, `skill.list`) | один реестр с Web |
| Объектный слой | `packages/client/runtime/src/client/index.ts` | `SessionRuntime`, `WorkspaceRuntime`, `ConversationNodeAssembler`, проекции, очередь, pending |
| Точка расширения транспорта | `packages/client/connection/src/client/index.ts` | при исходе (в) — аддитивный экспорт RPC-caller'а |

## 8. Границы: чего проект не делает

- Не создаёт вторую реализацию агента, второй реестр инструментов, второе хранилище сессий, вторую систему скиллов и второй конфиг-слой.
- Не вводит собственный дом данных (`~/.kibborg`) в первой поставке.
- Не монтирует веб-бандл и браузерные `ui-*` плагины в CLI-профиль.
- Не поднимает HTTP для локального режима и не требует фоновых процессов.
- Не печатает внутренние рассуждения модели.
- Не копирует протокольную логику ядра в свой код.
