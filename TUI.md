# UI — экраны, меню и палитра Kibborg CLI

Статус: дизайн-спека консольного интерфейса. Дополняет `PLAN.md` (единственный источник правды по составу и порядку работ), не меняет его решения R1–R12 и не расширяет объём фаз.
Живое демо этой спеки: `demo/kibborg-demo.bat` (двойной щёлчок или `demo\kibborg-demo.bat all`).
Привязка к задачам: K1.2–K1.6 (inline-рендер, статус-строка, ввод), K2.2/K2.3 (сессии, история), K3.1–K3.3 (approval, question, plan), K4.1/K4.7/K4.9 (команды, модал, autocomplete), K7.1–K7.4 (fullscreen, панели, клавиши, темы).

---

## 1. Принципы хрома

1. **Одна акцентная рамка на экране.** Всё остальное — `Muted`/`Subtle`. Акцент принадлежит тому элементу, который ждёт решения пользователя (permission, question, plan-review).
2. **Wordmark — только first-run и `/home`.** В рабочей сессии вместо figlet одна строка бренда: `◆ KIBBORG  v1.0.0`. Figlet не печатается повторно и не ломается переносом: при `cols < 72` — `◆ KIBBORG`.
3. **Никакой рамки вокруг всего экрана.** Рамку получают permission, question, plan-review, модальные панели и tool-вызовы, меняющие состояние (bash/edit/write). Лента, ответ модели, read/search-вызовы и composer — без рамки.
4. **Composer отделён от ленты пунктиром**, ярлык промпта — `>` внутри композера, не `kibborg>`.
5. **Статус-строка прибита внизу всегда** (модель · контекст · стоимость · git · режим). Это главный признак «дорогого» CLI.
6. **Анимируется яркость, не геометрия.** Спиннер этапа и волна band — да; прыгающие рамки и очистка экрана — нет.
7. **R10 соблюдается в рендере:** reasoning-чанки mux не печатаются никогда; печатаются статус этапа, тул-строки, план, ошибки/ретраи/нотисы лимита, метрика контекста и финальный ответ. Отладка reasoning — только `--debug` в stderr.

---

## 2. Токены темы

| Токен | HEX | Где применяется |
|---|---|---|
| `Accent` | `#5CE1E6` | бренд, активный режим, рамка edit/write, полоса контекста |
| `Shimmer` | `#9AF0F3` | кадры спиннера этапа, волна band |
| `Success` | `#3DDC97` | `✓` завершённый инструмент, `+` в diff |
| `Warn` | `#F5B942` | plan, ожидание, `⚠` нотис лимита, рамка сетевых действий |
| `Error` | `#FF5C7A` | `deny`, `✗` сбой, `-` в diff, рамка destructive-действий |
| `Muted` | `#7A8494` | chrome, подсказки, горячие клавиши, второстепенный текст |
| `Subtle` | `#3A4250` | разделители, пунктир композера, неактивные границы |
| `Text` | `#D6DEEB` | основной текст, ответ модели |
| `Surface` | `#161B22` | фон модальных панелей; для сообщений пользователя в v1 не используется (reserved) |
| `BashPink` | `#E879F9` | только рамка shell-инструмента (один «чужой» цвет, как у референсов) |
| `PermLav` | `#A5B4FC` | рамка permission/question |

Fallback при отсутствии 24-бит цвета (`NO_COLOR`, `TERM=dumb`, классический conhost без VT): `Accent`/`Shimmer`→`96`, `Success`→`92`, `Warn`→`93`, `Error`→`91`, `Muted`/`Subtle`→`90`, `Text`→`97`, `BashPink`→`95`, `PermLav`→`94`. Семантика «тип действия → цвет рамки» сохраняется.

Правило для кода: цвета берутся только из токенов темы (`/theme`), ANSI-коды не хардкодятся внутри виджетов.

---

## 3. Плотности и адаптация по ширине

| Плотность | Условие | Что меняется |
|---|---|---|
| `rich` | `cols ≥ 110` | полный wordmark, recap сессий в две строки, стоимость в статусе, timestamps |
| `balanced` | `80 ≤ cols < 110` | дефолт: figlet (порог логотипа 72 не зависит от плотности), статус без стоимости, recap в одну строку |
| `compact` | `cols < 80` | `◆ KIBBORG`, recap в одну строку без времени, палитра в одну колонку без описаний; состав статуса — по алгоритму ниже (полоса уходит только при `cols < 72`) |

Узкий терминал: сначала убирается стоимость, затем полоса контекста, затем git. Статус-строка **никогда не переносится** и не обрезает правый край рамок.

**Геометрия (обязательные правила рендера, проверяются в демо):**

- `inner = cols − 4`; рамки, dashed-линия, колонки панелей и recap-поля выводятся из `inner`. Магических 74/80 в коде нет.
- Composer: `dashed` ровно `inner` (кратно паре «- »), строка ввода `| … |` шириной `inner`, отступ 2 колонки от края.
- Ширина считается **display-width** (CJK/emoji = 2, комбинирующие и zero-width = 0), а не `string.length` — иначе колонки разъезжаются в Windows Terminal.
- Анимации (band, спиннер) перерисовывают ровно одну зарезервированную строку через `SetCursorPosition`, без `\r` + «угаданных» пробелов.
- Подсказка composer (`@ / ! shift+enter`) гаснет на первом введённом символе.
- Figlet — вертикальный градиент `Shimmer → Accent`; band анимируется фазой синуса по тем же блокам `░▒▓█` (меняется яркость, не геометрия).
- Полоса контекста считается от процента: `filled = round(10 × pct / 100)`, а не зашита.

---

## 4. Экраны

### 4.1 Welcome (first-run в проекте)

Figlet — только здесь, только при first-run и `cols ≥ 72` (иначе строка `◆ KIBBORG`). Продаёт не арт, а продолжение работы: контекст проекта, recent-сессии с recap, действия. Повторный запуск в том же каталоге даёт compact header (§4.2).

```
  ██╗  ██╗██╗██████╗ ██████╗  ██████╗ ██████╗  ██████╗
  ██║ ██╔╝██║██╔══██╗██╔══██╗██╔═══██╗██╔══██╗██╔════╝
  █████╔╝ ██║██████╔╝██████╔╝██║   ██║██████╔╝██║  ███╗
  ██╔═██╗ ██║██╔══██╗██╔══██╗██║   ██║██╔══██╗██║   ██║
  ██║  ██╗██║██████╔╝██████╔╝╚██████╔╝██║  ██║╚██████╔╝
  ╚═╝  ╚═╝╚═╝╚═════╝ ╚═════╝  ╚═════╝ ╚═╝  ╚═╝ ╚═════╝
  ░░░░░░▒▒▒▒▓▓▓▓██████▓▓▓▓▒▒▒▒░░░░░░     v1.0.0

  ~/Projects/my-app   main* +12 ~4   DeepSeek V4 Flash   Agent

  Recent
    2h  Auth guard + JWT refresh · pending tests          8f31
    1d  Repo scan · 4 findings in src/auth                a91c
    3d  Worktree feat/payments · plan accepted            c0e2

  [enter]  New session
  [f3]     Resume picker
  [ctrl+w] Isolated worktree
  [ctrl+p] Command palette
  [/]      Commands

  tip  Shift+Tab cycles Ask → Plan → Agent → YOLO
```

Правила: `Quit` в меню не печатается (выход — `ctrl+q`/`ctrl+d`); tip ротируется каждые ~9 с и служит онбордингом вместо `/help`; recent-сессии берутся из `session.list` того же каталога.

### 4.2 Compact header (повторный запуск)

```
  ◆ KIBBORG  v1.0.0    ~/Projects/my-app    main*    DeepSeek V4 Flash
  ────────────────────────────────────────────────────────────────────
  Recent   2h  Auth guard + JWT refresh                     8f31 ↵
```

### 4.3 Session — рабочий холст (inline, дефолт)

Три зоны: лента / dashed composer / статус-строка. Рамки вокруг экрана нет.

```
  ◆ 8f31  Auth guard · ~/Projects/my-app                   Agent · write

  You
  проанализируй этот проект и найди проблемы

  ✳  Scanning…  4.2s   esc interrupt   12.4k tok

    ✓  read     README.md
    ✓  read     package.json
    ⚙  search   src/**  auth
       ⎿  14 files · 3 matches in src/auth/jwt.ts
    ✓  read     src/auth/jwt.ts

  Planning
    1. Inspect project
    2. Read project manifest
    3. Scan source  ←
    4. Report findings
    [e] edit plan   [enter] execute   [esc] discard

  - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  |  > _                                                  |
  |    @ files   / commands   ! shell   shift+enter nl    |
  - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  DeepSeek V4 Flash · ctx 18% ▓▓░░░░░░ · $0.04 · 4.2s · main* · Agent
```

Обязательные приёмы:

- **Спиннер этапа** — кадры `· ✢ ✳ ✶ ✻ ✽` цвета `Shimmer` + живой глагол (`Scanning`, `Reading`, `Wiring`, `Hunting`) + elapsed + токены + `esc`. Глагол отражает этап, а не «thinking», потому что скрытых рассуждений в выводе нет (R10).
- **Тул-строки без фона**, плоские: `✓` (`Success`) / `⚙` (`Accent`, выполняется) / `✗` (`Error`). Непрерывные вызовы группируются продолжением `⎿`, а не отдельным блоком на каждый файл.
- **Рамку получают только bash/edit/write-вызовы** (shell — `BashPink`, edit — `Accent`) и permission-диалог.
- **Сообщение пользователя** — sticky-заголовок `You`, без рамки и без фона; `Surface` используется только там, где нужен явный блок кода.
- **Plan — интерактивный виджет**, а не текст в ленте: `[e] edit`, `[enter] execute`, `[esc] discard`.

В макете выше `draft` пустой — поэтому видна hint-строка композера; при непустом вводе она гаснет (§3). Plan-виджет здесь — черновик плана во время хода в режиме `Plan`; бинарный gate перед записью кода — отдельный экран §4.7, они не показываются одновременно.

### 4.4 Slash-палитра (`/`)

Fuzzy-поиск, группы, алиасы справа, preview снизу. Скиллы с `user-invocable` попадают в ту же палитру как `/<skill>`.

```
  /mo█
  ┌ commands ─────────────────────────────────────────────┐
  │  SESSION                                              │
  │    /new            clear + fresh            ctrl+n    │
  │    /resume         session picker           f3        │
  │    /fork           branch this session                │
  │    /compact        squeeze context                    │
  │  MODEL                                                │
  │  ▸ /model          switch model             ctrl+m    │
  │    /effort         reasoning depth                    │
  │  MODE                                                 │
  │    /plan           plan-only, no writes     s-tab     │
  │    /ask            read-only                          │
  │    /yolo           always-approve                     │
  │  PROJECT                                              │
  │    /init           write KIBBORG.md                   │
  │    /diff           unstaged + session edits           │
  └───────────────────────────────────────────────────────┘
    /model [name]   DeepSeek V4 Flash · local · 128k
```

Источник данных — хостовый реестр команд (`command.list`), локальные псевдо-команды помечаются отдельной группой `LOCAL`.

Overlay занимает строки **над** composer: палитра не перекрывает строку ввода и не сдвигает статус-строку. Курсор остаётся в composer, фильтр палитры — это и есть набранный draft.

### 4.5 Permission

Дорого выглядит не размером, а цветом рамки, зависящим от типа действия (edit/write — `Accent`, bash — `BashPink`, сеть — `Warn`, destructive — `Error` с фокусом по умолчанию на `n`).

```
  ┌─ Allow Edit  src/auth/jwt.ts ─────────────────────────┐
  │  + verifyRefresh()                                    │
  │  + rotate tokens on 401                               │
  │                                                       │
  │  [y] once   [a] always session   [n] deny   [esc]     │
  └───────────────────────────────────────────────────────┘
```

Ответ уходит в `POST /api/respond` с тем же `rpcId`, что пришёл в mux-фрейме `approval/requested`. В headless по умолчанию `--fail-on-question`: ответа нет → выход с кодом 3 (R11).

### 4.6 Question

Один вопрос — один блок; single/multi-select + свободный ввод, валидация по схеме вопроса.

```
  ┌─ Question  1/2 ───────────────────────────────────────┐
  │  Какой объём ревью нужен?                             │
  │  ▸ only src/auth                                      │
  │    весь src                                           │
  │    весь репозиторий                                   │
  │  other… > _                                           │
  │                                                       │
  │  [↑↓] выбрать   [space] отметить   [enter] подтвердить│
  └───────────────────────────────────────────────────────┘
```

### 4.7 Plan review

Бинарный review после `exit_plan_mode`: правки кода запрещены до одобрения. Решение — `approve`/`reject`, редактирование плана — до approve.

Этот экран и plan-виджет §4.3 не сосуществуют: §4.3 — черновик плана во время хода в режиме `Plan`; §4.7 — gate перед первой записью на диск, который заменяет виджет.

```
  ┌─ Plan review ─────────────────────────────────────────┐
  │  1. Inspect project structure                         │
  │  2. Read manifests and entrypoints                    │
  │  3. Scan src/ for auth flow regressions               │
  │  4. Report findings with evidence                     │
  │                                                       │
  │  [e] edit   [enter] approve & execute   [esc] reject  │
  └───────────────────────────────────────────────────────┘
```

### 4.8 Resume picker

Не сырой последний промпт, а recap + состояние git + модель + режим.

```
  Resume session                                          /resume
  ┌──────────────────────────────────────────────────────────────┐
  │  ▸ 8f31  2h   Auth guard + JWT refresh                       │
  │        main*  Agent  DeepSeek V4  +18/-4  pending tests      │
  │    a91c  1d   Repo scan · 4 findings                         │
  │        main   Plan    DeepSeek V4  clean                     │
  │    c0e2  3d   feat/payments worktree                         │
  │        wt     Agent   DeepSeek V3  dirty 3 files             │
  └──────────────────────────────────────────────────────────────┘
  enter resume   ctrl+f fork   d delete   / find
```

### 4.9 Модальные панели (один экран с табами)

Расширения открываются одним модалом с табами, а не пятью разными экранами: `Skills` · `MCP` · `Hooks` · `Plugins` · `Permissions`.

```
  ┌ Kibborg ─ [Skills] MCP Hooks Plugins Permissions ─────┐
  │  ✓ security-review        model-invocable   v3        │
  │  ✓ graphify               user-invocable    v5        │
  │  · tunerpro-xdf-engineer  manual            v2        │
  │                                                       │
  │  [enter] открыть  [space] enable/disable  [v] версии  │
  │  [b] benchmark    [t] в корзину           [esc] выход │
  └───────────────────────────────────────────────────────┘
```

### 4.10 Статус-строка и footer хода

Формат (одна строка, всегда внизу, никогда не wrap):

```
{model} · ctx {pct}% {bar10} · ${cost} · {turn_s} · {git}{dirty} · {mode}
```

Footer завершённого хода — как в референсах, чтобы стоимость и объём правок были видны по факту:

```
  ✓  14.1k tok · $0.07 · 18.4s · 6 tools · +82/-11
```

### 4.11 Fullscreen (K7, дефолт в терминале)

Alt-screen, панели, ресайз. Аварийный plain-режим и корректное восстановление alt-screen/курсора обязательны.

Режим экрана — свойство поверхности, а не узла беседы. Поверхность владеет терминалом, когда вывод идёт в терминал: включаются alt-screen, скрытие курсора, mouse-reporting (`1000/1002/1006`, включая колесо), bracketed paste и синхронный вывод; кадр собирается в буфер ячеек и печатается разницей с предыдущим кадром. `inline` остаётся фоллбэком для не-терминала, `CI` и `TERM=dumb`, а также для запуска с `KIBBORG_INLINE=1`; в нём лента дописывается в scrollback, а на месте перерисовывается только нижняя зона §10. Постоянный рендер-цикл при простое не пишет в терминал ничего: неизменившийся кадр даёт пустую разницу.

```
  ┌ Sessions ─────┬ Conversation ──────────────────────────┬ Context ─┐
  │ ▸ 8f31 Auth   │ You: проанализируй проект             │ system 6%│
  │   a91c Scan   │ ✳ Scanning… 4.2s   12.4k tok          │ tools 9% │
  │   c0e2 Pay    │   ✓ read README.md                    │ chat 3%  │
  │               │   ⚙ search src/** auth                │ ──────── │
  │               │       ⎿ 3 matches in jwt.ts           │ 18%      │
  ├───────────────┴───────────────────────────────────────┴──────────┤
  │ Tasks │ Jobs │ Goals │ Files │ Diff │ Queue        ctrl+o детали │
  └──────────────────────────────────────────────────────────────────┘
  DeepSeek V4 Flash · ctx 18% ▓▓░░░░░░ · $0.04 · main* · Agent
```

### 4.12 Вне TUI (мгновенные ответы и CI)

Пока идёт ход, статусные команды отвечают немедленно, не вставая в очередь: `/status`, `/tasks`, `/usage`.

```
$ kibborg -p "describe the repo" --output-format json
{"type":"result","subtype":"success","duration_ms":18420,"num_turns":6,
 "result":"Репозиторий — плагинный агентный харнесс...","session_id":"8f31...",
 "total_cost_usd":0.07,"is_error":false}

$ kibborg -p "..." --fail-on-question   # approval/question без ответа
$ echo $?                               # 3
```

Exit-коды — по `README.md`: `0` успех, `1` сбой задачи/инструмента, `2` конфигурация/окружение/ключ, `3` нужен интерактивный ответ, `130` прервано.

---

## 5. Клавиатура

| Область | Клавиши |
|---|---|
| Режимы | `Shift+Tab` — цикл `Ask → Plan → Agent → YOLO`; `/ask`, `/plan`, `/agent`, `/yolo` |
| Ввод | `Enter` — отправить либо принять пункт overlay; `Ctrl+J` / `Shift+Enter` — перевод строки; `Esc` — см. стек ниже |
| Прерывание | `Ctrl+C` — см. `ARCHITECTURE.md` §4.1 (единственный источник семантики) |
| История и поиск | `Ctrl+R` — поиск по истории; `/find` — поиск по ленте; `Ctrl+O` — детали узла |
| Автодополнение | `/` — команды и скиллы; `@` — файлы; `#` — сессии и ссылки |
| Панели (fullscreen) | `Ctrl+X` — лидер-клавиша; `Ctrl+O` — детали; `Vim`-скролл `j/k`, `g/G` |
| Сессии | `Ctrl+N` — новая, `F3` — picker, `Ctrl+F` — fork, `Ctrl+W` — worktree |
| Выход | `Ctrl+Q`, `Ctrl+D` на пустом вводе |

**Стек `Esc` (порядок обязателен, `Esc` никогда не выходит из процесса):**

```
1. overlay открыт        → pop overlay (палитра, файлы, сессии)
2. plan-review открыт    → reject / discard плана
3. идёт ход              → interrupt turn
4. draft непустой        → clear draft
5. иначе                 → ничего (подсказка в статусе, процесс жив)
```

Выход — только `Ctrl+Q` (TTY) или `Ctrl+D` на пустом вводе. Семантика `Ctrl+C`, сигналов и режима без TTY — `ARCHITECTURE.md` §4.1; здесь она не дублируется.

---

## 6. Карта slash-команд

Карта — бэклог v1 для K4.1/K4.2; источник исполнения — хостовый реестр.

```
SESSION     /new /resume /sessions /fork /rename /home /quit
CONTEXT     /compact /context /rewind /export /copy /find /transcript
MODE        /plan /ask /agent /yolo /always-approve /permissions
MODEL       /model /effort /status
PROJECT     /init /memory /diff /review /add-dir /worktree*
SYS         /doctor /usage /theme /config /help /tasks /goal
EXT         /mcp /skills /hooks /plugins
GIT         /commit (skill), /worktree
```

`*` `/worktree` — единственная команда, доступная и в TUI, и как подкоманда: `kibborg worktree [name]` (изоляция требует запуска до старта сессии, поэтому интерактивная форма — переключение в уже созданное дерево).

Внешний CLI-паритет (основные подкоманды): `kibborg [задача] | resume | sessions | models | mcp | skills | export | stats | doctor | serve | attach | worktree | version`.

---

## 7. Что демонстрирует `demo/kibborg-demo.bat` (FROZEN)

**Демо заморожено как visual golden.** Новые экраны и фичи в него не добавляются: он фиксирует эту спеку и служит эталоном вывода. Боевой рендер — пакет `@kibborg/tui` (PLAN.md R3), а не этот файл; изменения демо допустимы только вместе с правкой спеки и перегенерацией golden.

**Слайды (13 штук) + live** — отрисовка 4.1–4.11: палитра с fuzzy-подсветкой, permission с тремя цветами рамок, question, plan-review, resume picker, модал с табами, три плотности статус-строки (форсируются локально, не зависят от размера окна), fullscreen-панели, headless-пример, карта slash-команд. `live` — не слайд, а живой кадр ниже.

**Live-кадр (`live`)** — интерактивный экран, который проверяет поведение, а не картинку:

| Что проверяется | Как это видно |
|---|---|
| Ввод в composer | печать символов, `Backspace`, курсор в строке ввода |
| Горизонтальный скролл ввода | длинный draft показывается хвостом с «…», строка не переносится |
| Отправка хода | `Enter` → лента: You (`demo replay`) → спиннер → тул-строки `⎿` → plan → ответ → footer |
| Живая палитра | `/` открывает overlay; фильтр идёт от `$draft`, `↑↓`/`Tab` — выбор, `Enter` вставляет команду в composer |
| Режимы | `Shift+Tab` циклит Ask → Plan → Agent → YOLO, badge в статусе меняется на месте |
| Прерывание | `Ctrl+C` по стеку `ARCHITECTURE.md` §4.1; `Esc` снимает overlay или очищает ввод и **никогда не выходит**; выход — `Ctrl+Q` / `Ctrl+D` |
| Resize | ширина поллится таймером (120 мс): зона пересчитывается без нажатия клавиши |
| Лента не перерисовывается | нижняя зона стирается и печатается заново, история остаётся в scrollback |

`Enter` всегда печатает `demo replay: текст не уходит в LLM` — демо не имитирует ответ модели, а проигрывает записанный ход.

```
demo\kibborg-demo.bat                  # интерактивное меню: ↑↓/jk, enter, 1-9, l live, a, q
demo\kibborg-demo.bat live             # живой кадр: ввод, overlay, режимы, прерывание
demo\kibborg-demo.bat menu             # только список экранов
demo\kibborg-demo.bat all              # все слайды подряд
demo\kibborg-demo.bat session          # один слайд по имени
demo\kibborg-demo.bat 3                # один слайд по номеру из меню
demo\kibborg-demo.bat golden           # перезаписать эталон demo\golden\all-plain.txt
demo\kibborg-demo.bat check            # сверить вывод с эталоном (exit 1 при расхождении)
demo\kibborg-demo.bat all --plain      # без цвета и анимации (CI, перенаправленный вывод)
demo\kibborg-demo.bat all --truecolor  # принудительный 24-бит цвет
```

Если ввод недоступен (пайп, CI), `live` проигрывает тот же кадр сценарием, `exit 0`. `check` — гейт заморозки: гоняет все слайды в фиксированной геометрии (88 cols, `balanced`) и сравнивает построчно.

Демо использует только стандартные средства Windows (cmd + PowerShell, без внешних зависимостей), уважает `NO_COLOR` и перенаправленный вывод. Явный `--truecolor` перебивает `NO_COLOR`; анимации включаются только в настоящем TTY. Единственный файл, который демо пишет на диск, — эталон по команде `golden`.

---

## 8. Привязка спеки к задачам

| Раздел спеки | Задача `TASKS.md` |
|---|---|
| 4.3 Session, тул-строки, спиннер, R10 | K1.2, K1.6 |
| 4.10 Статус-строка и footer | K1.3, K2.6 |
| 5 Клавиатура, §4.1 `ARCHITECTURE.md` | K1.4, K3.7 |
| 10 Контракт нижней зоны | K1.4, K2.1, K3.7 |
| 11 Лента, переносы, поверхности | K1.4, K2.3, K3.1, K7.1 |
| 4.12 Headless | K1.5, K5.1–K5.3 |
| 4.8 Resume picker, 4.3 заголовок сессии | K2.2, K2.3 |
| 4.5 Permission, 4.6 Question, 4.7 Plan review | K3.1, K3.2, K3.3, K3.6 |
| 4.4 Палитра, 4.9 Модал, autocomplete | K4.1, K4.7, K4.9 |
| 4.4 Overlay-стек (FIFO, rpcId) | K3.1, K3.7 |
| 4.11 Fullscreen, панели, темы | K7.1–K7.4 |
| 1 Принципы, 2 Токены, 3 Плотности и геометрия | сквозные для `@kibborg/tui` |

---

## 9. Стек рендера и границы демо

Стек боевого TUI зафиксирован в `PLAN.md` **R3**: TypeScript / Node ≥ 22.19, собственный минимальный ANSI-рендер пакета `@kibborg/tui` **без внешних TUI-библиотек**; `fullscreen` — дефолт в терминале, `inline` — фоллбэк через `KIBBORG_INLINE=1` (или когда вывод не терминал). Демо на PowerShell — не заготовка движка, а замороженный макет спеки: оно заменяется реализацией K1/K7, а не развивается в неё.

Почему PowerShell не может быть основой боевого TUI: alt-screen, перерасчёт при resize без мерцания, IME/ввод состава символов, mouse-reporting, ConPTY-ресайз и 60 fps на нижней зоне упираются в платформу. Боевой рендер — пакет в общем TS-воркспейсе, а не скрипт.

**Порядок порта (первый пакет K1, по зависимостям):** `tokens` → `displayWidth` → `makeDash` → `bar10` → `statusText` → `composerBlock` → `actionBorderColor(kind)` → редьюсер зоны (§10). Всё, что за пределами этого списка, в PowerShell больше не развивается.

**Переносится в `@kibborg/tui` 1:1:** токены и 16-цветный fallback; `Get-DisplayWidth` (CSI, combining, Wide, surrogate-пары, tab); `Make-Dash`, `Composer-Block`, `Get-ComposerView`, `Bar10`, `Status-Text`; модель зоны из §10; правило «анимация на зарезервированной строке»; порядок drop при узком терминале; таблица «тип действия → цвет рамки».

**Сознательно не покрыто демо — это DoD соответствующих задач:**
- стрим токенов при одновременном вводе в composer (K1.2);
- очередь слэш-команд во время хода: `/status` отвечает сразу, `/model` ждёт (K2.1);
- стек permission из 2+ запросов и очередь `rpcId` (K3.1, K3.7);
- `@`-fuzzy-picker файлов с превью и `#` по сессиям (K4.9) — в live работает только палитра `/`;
- пересборка уже напечатанной ленты после resize: демо перерисовывает только зону (K7.1);
- alt-screen и восстановление терминала после аварийного выхода (K7.1, K7.5);
- несколько параллельных ходов и их очередь (K2.1, K7.2).

---

## 10. Контракт нижней зоны

Зона — единственный виджет, который перерисовывается на месте; всё остальное дописывается в scrollback. Контракт одинаков для `live`-кадра демо и для боевого рендера.

```
Zone       = [Overlay*] + Composer + Status     # высота известна до paint
Scrollback = всё выше Zone                      # TUI его не перерисовывает
Stack      = palette | files | sessions | permission | question | plan-review | modal
             # FIFO, виден верхний; закрытие верхнего не меняет нижние
Paint      = только dirty-rect зоны + reserved spin-line; лента дописывается вниз
Esc        = pop overlay → plan-review reject → interrupt turn → clear draft → (ничего)
Ctrl+C     = ARCHITECTURE.md §4.1 (единственный источник семантики)
Shift+Tab  = cycle modes (Ask → Plan → Agent → YOLO)
/          = palette over zone, filter from draft
↑↓ / Tab   = move selection inside overlay
Enter      = accept overlay item | submit draft
resize     = Sync-Geometry + redraw zone only (лента не replay)
```

**Инварианты (проверяются в коде и в демо):**

| Инвариант | Формула |
|---|---|
| Высота зоны | `height = (overlay ? 1 + overlay.lines : 0) + 4 + 1` |
| Позиция зоны | `zoneTop = CursorTop` после печати ленты; координаты вручную не передаются |
| Ширина composer | `prefix + content + border = inner`, где `inner = cols − 4` |
| Столбец курсора | `cursorCol = displayWidth(prefix) + displayWidth(view.text)` |
| Видимая часть ввода | `view.text = draft`, если влезает; иначе `'…' + tail(draft, avail − 1)` |
| Состояние палитры | `overlay.open = draft.StartsWith('/')`, `query = draft`, `selected` — индекс в отфильтрованном списке |
| Пустой фильтр | при `items.length = 0` overlay остаётся открытым со строкой «нет совпадений» |
| Срез ленты | перед печатью хода зона стирается; остаток стирается после, курсор возвращается в `zoneTop` |

**Модель состояния для `@kibborg/tui` (TypeScript, без внешних зависимостей):**

```ts
type Mode = 'ask' | 'plan' | 'agent' | 'yolo';

interface CommandItem { readonly group: string; readonly name: string; readonly desc: string; readonly key?: string }

interface ComposerState {
  readonly draft: string;
  readonly view: { readonly text: string; readonly hidden: number };
  readonly cursorCol: number;
}

interface OverlayState {
  readonly open: boolean;
  readonly query: string;
  readonly items: readonly CommandItem[];
  readonly selected: number;          // -1 при пустом списке
}

interface ZoneState {
  readonly mode: Mode;
  readonly composer: ComposerState;
  readonly overlay: OverlayState;
  readonly status: { readonly pct: number; readonly costUsd: number; readonly turnMs: number; readonly branch: string };
  readonly height: number;
}

type ZoneEvent =
  | { readonly kind: 'key'; readonly key: string; readonly shift?: boolean; readonly ctrl?: boolean }
  | { readonly kind: 'resize'; readonly cols: number }
  | { readonly kind: 'turn-start' }
  | { readonly kind: 'turn-chunk'; readonly text: string }
  | { readonly kind: 'turn-end'; readonly tokens: number; readonly costUsd: number; readonly files: number }
  | { readonly kind: 'approval'; readonly rpcId: string };

type ZoneEffect =
  | { readonly kind: 'submit'; readonly prompt: string }
  | { readonly kind: 'insert'; readonly text: string }
  | { readonly kind: 'cancel-turn' }
  | { readonly kind: 'respond'; readonly rpcId: string; readonly decision: 'once' | 'session' | 'always' | 'deny' }
  | { readonly kind: 'quit' }
  | { readonly kind: 'none' };

type ZoneReducer = (state: ZoneState, event: ZoneEvent) => { readonly state: ZoneState; readonly effects: readonly ZoneEffect[] };
```

Ключи обрабатываются в порядке приоритета: overlay (`↑↓`, `Tab`, `Enter`, `Esc`) → режимы (`Shift+Tab`) → ввод → глобальные (`Ctrl+C`, `Ctrl+Q`). Ни один эффект не меняет ленту: лента — функция от событий сессии, зона — функция от ввода.

**Инварианты overlay-стека:** одновременно рисуется один бокс — верхний; запросы не теряются (FIFO); каждый несёт свой `rpcId`, ответ уходит по `rpcId` верхнего; закрытие верхнего не меняет состояние нижних.

---

## 11. Лента, переносы и поверхности

Решения, которые нельзя оставлять на усмотрение отдельных K-тикетов.

| Вопрос | Решение |
|---|---|
| Кто владеет переносами строк | `inline` — терминал: лента хранит логические строки и не знает про wrap, уже напечатанное после resize не перерисовывается. `fullscreen` — рендер: лента хранит логические строки, перенос считает рендер по `inner`, resize переразбивает виртуальный буфер. Владение переносами — свойство режима экрана, а не узла Conversation |
| Sticky `You` | `fullscreen` — заголовок узла липнет к верху области ленты при скролле; `inline` — не липнет (областей нет, скроллит терминал) |
| Очередь approval | FIFO-стек из §10: показывается верхний запрос, остальные ждут; два бокса одновременно не рисуются |
| `! shell` из композера | Рендерится как обычная tool-строка `bash` с рамкой `BashPink` — тем же путём, что вызов инструмента; отдельного вида строки в ленте нет |
| `/theme` | Пресеты `ice` (дефолт) и `mono`; пользовательская тема — файл токенов `$DSH_HOME/themes/<name>.yaml` с ключами §2. Тема переопределяет значения токенов, но не добавляет новых |
| Timestamps | Только в `rich`: относительные до 24 ч (`14m`, `2h`), дальше абсолютные (`12.03`). Один формат для recap §4.1 и §4.8 и для заголовков узлов |
| Поверхность `Surface` | В v1 — только фон модальных панелей §4.9. Сообщение пользователя и composer фона не получают: лента остаётся плоской |
