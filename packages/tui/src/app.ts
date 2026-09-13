/**
 * Fullscreen application surface.
 *
 * The app owns the persistent state of the screen — the screen mode (welcome or
 * session), transcript scroll, draft, status, palette, and request box — and
 * paints one frame per change. Frames are composed into a cell buffer and diffed
 * against the previous one, so an idle surface writes nothing at all and a
 * keystroke repaints only the rows it changed.
 *
 * The layout follows `UI.md`: a three-row brand header, the scrolling transcript,
 * the palette or request box over the composer, the dashed composer with its
 * `>` prompt, and the status line pinned to the last row.
 * @module @kibborg/tui/app
 */

import type { Palette } from './tokens.ts'
import type { CellBuffer } from './framebuffer.ts'
import { createBuffer } from './framebuffer.ts'
import type { Rect } from './box.ts'
import { dashedLine, drawBox } from './box.ts'
import { computeLayout, densityFor, type Density } from './layout.ts'
import type { KeyEvent } from './input.ts'
import type { LogModel, Span } from './log.ts'
import type { TokenName } from './tokens.ts'
import { createLog, clampScroll, renderTranscript, wrapText } from './log.ts'
import { drawLogView, paintStyledLine } from './logview.ts'
import { drawHeader, HEADER_HEIGHT, type HeaderState } from './header.ts'
import { renderWelcome, type WelcomeState } from './welcome.ts'
import { renderMenu, type MenuItem, type MenuView, type DialogView } from './menus.ts'
import { wheelDelta } from './mouse.ts'
import { createScreen, type Screen, type TerminalCaps } from './screen.ts'
import { displayWidth } from './width.ts'
import { elapsedLabel, progressBar, workingSpinner } from './anim.ts'
import { formatTokens } from './status.ts'

/** Session values shown in the status line. */
export interface AppStatus {
  /** Active model name. */
  readonly model: string
  /** Permission mode in force. */
  readonly mode: string
  /** Context window used, in percent. */
  readonly contextPercent: number
  /** Git branch, when the directory is a repository. */
  readonly branch?: string
  /** Whether the working tree has uncommitted changes. */
  readonly dirty?: boolean
  /** Duration of the last turn, in seconds. */
  readonly turnSeconds?: number | undefined
  /** Cost of the session in US dollars. */
  readonly costUsd?: number
  /** Tokens spent this turn. */
  readonly tokens?: number | undefined
  /** Agents working on this run, including the one the user talks to. */
  readonly agents?: number | undefined
  /** Tool calls the run has made so far. */
  readonly tasks?: number | undefined
}

/** How to build the surface. */
export interface AppOptions {
  /** Stream carrying frames. */
  readonly stdout: NodeJS.WriteStream
  /** Stream carrying input. */
  readonly stdin: NodeJS.ReadStream
  /** Active palette. */
  readonly palette: Palette
  /** Surface version shown in the header. */
  readonly version: string
  /** Working directory shown in the header. */
  readonly cwd: string
  /** Initial status values. */
  readonly status: AppStatus
  /** Composer height including its rules; defaults to four rows. */
  readonly composerHeight?: number
  /** Composer hint line; defaults to the key legend. */
  readonly hint?: string
  /** Whether the surface opens on the welcome screen. */
  readonly welcome?: WelcomeState
  /** Forced capabilities, for tests. */
  readonly caps?: TerminalCaps
}

/** The interactive surface. */
export interface App {
  /** Transcript model the caller appends to. */
  readonly log: LogModel
  /** Owned terminal screen. */
  readonly screen: Screen
  /** Current draft text. */
  readonly draft: string
  /** Whether the surface has been stopped. */
  readonly stopped: boolean
  /** Whether the welcome screen is showing instead of the session. */
  readonly inWelcome: boolean
  /** Replace the draft. */
  setDraft(text: string): void
  /** Merge status values. */
  setStatus(patch: Partial<AppStatus>): void
  /**
   * Mark the turn state.
   * @param running - whether a turn is running.
   * @param activity - stage verb shown next to the spinner.
   */
  setRunning(running: boolean, activity?: string): void
  /** Replace the composer hint line. */
  setHint(hint: string): void
  /**
   * Show a request box over the composer.
   * @param dialog - the box to show, or `null` to close it.
   */
  setDialog(dialog: DialogView | null): void
  /**
   * Provide the palette entries; the palette opens while the draft starts with `/`.
   * @param items - every entry, or `null` to disable the palette.
   */
  setMenuItems(items: readonly MenuItem[] | null): void
  /**
   * Show a list of choices the surface owns, without a typed query.
   *
   * A command that needs one more decision (which model, which session) opens
   * this list; Enter reports the pick through {@link App.onMenuAccept}, and
   * Escape closes it and calls {@link App.onMenuClose}.
   * @param items - the choices to show.
   * @param title - the frame title naming what is being chosen.
   * @param selected - index of the highlighted entry; a list that leads with a
   * way back highlights its first real choice instead.
   */
  openMenu(items: readonly MenuItem[], title?: string, selected?: number): void
  /** Close a list opened by {@link App.openMenu}. */
  closeMenu(): void
  /**
   * Register the handler for a Ctrl+click on a link or path.
   * @param handler - receives the target the pointer resolved to.
   */
  onOpen(handler: (target: string) => void): void
  /**
   * Register the handler for a finished text selection.
   *
   * A drag over the frame selects the cells under it with reverse video; when
   * the button is released the selected text is reported so the caller can put
   * it on the clipboard, which is what a terminal without native selection
   * needs.
   * @param handler - receives the selected text, already trimmed per line.
   */
  onSelection(handler: (text: string) => void): void
  /**
   * Register the handler for a closed list.
   * @param handler - receives whether the closed list was a nested one (opened
   * by a command) and therefore has a level to return to, or the command palette.
   */
  onMenuClose(handler: (nested: boolean) => void): void
  /**
   * Register the handler for an accepted palette entry.
   * @param handler - receives the chosen entry.
   */
  onMenuAccept(handler: (item: MenuItem) => void): void
  /**
   * Route one decoded key. Wheel, paging, palette navigation, and box navigation
   * are handled here; every other key goes to {@link App.onUnhandled}.
   * @param key - the decoded key.
   */
  handleKey(key: KeyEvent): void
  /**
   * Register the handler for keys the surface does not consume.
   * @param handler - receives each remaining key.
   */
  onUnhandled(handler: (key: KeyEvent) => void): void
  /**
   * Show a short confirmation that removes itself.
   *
   * A copy, a model switch, or "opened" are acknowledgements rather than
   * content: they must be visible when they happen and gone a moment later, or
   * they pile up in the transcript and read like warnings.
   * @param text - the text to show, one entry per line.
   * @param ms - how long it stays, in milliseconds.
   */
  flash(text: string, ms?: number): void
  /** Show the session screen; the welcome block stays in the transcript. */
  enterSession(): void
  /** Compose and present one frame. */
  render(): void
  /** Take over the terminal and start the animation loop. */
  start(): void
  /** Restore the terminal and stop the animation loop. */
  stop(): void
}

/** Animation frames per second while a turn runs. */
const FPS = 10

/** How long a confirmation stays on screen before it removes itself. */
const FLASH_MS = 5000

/** Input rows the composer may grow to while a draft spans several lines. */
const COMPOSER_MAX_ROWS = 8

/** Rows a wheel notch scrolls. */
const WHEEL_LINES = 3

/** Default composer legend. */
const DEFAULT_HINT = '@ файлы   / команды   ! shell   shift+enter — новая строка'

/**
 * Build the surface. Nothing is written until {@link App.start}.
 * @param options - streams, palette, and initial values.
 * @returns the surface.
 */
export function createApp(options: AppOptions): App {
  const palette = options.palette
  const screen = createScreen({
    stdout: options.stdout,
    stdin: options.stdin,
    ...(options.caps === undefined ? {} : { caps: options.caps }),
  })
  const log = createLog()
  const composerHeight = options.composerHeight ?? 4

  let status: AppStatus = options.status
  let welcome: WelcomeState | null = options.welcome ?? null
  let draft = ''
  let hint = options.hint ?? DEFAULT_HINT
  let dialog: DialogView | null = null
  let menuItems: readonly MenuItem[] | null = null
  /** Whether the palette was opened by the surface rather than typed: it then shows its own list of choices. */
  let menuForced = false
  /** Frame title of the open list: the palette names commands, a command-opened list names its subject. */
  let menuTitle = ' commands'
  let menuSelected = 0
  let menuView: MenuView | null = null
  let dialogSelected = 0
  let running = false
  let activity = 'Working'
  let startedAt = 0
  let tick = 0
  let offset = 0
  let follow = true
  let stopped = false
  let transcriptHeight = 0
  let viewportHeight = 1
  let lastCursor: { readonly row: number; readonly col: number } | null = null
  let unhandled: ((key: KeyEvent) => void) | undefined
  let onAccept: ((item: MenuItem) => void) | undefined
  let onMenuClose: ((nested: boolean) => void) | undefined
  let onSelection: ((text: string) => void) | undefined
  let onOpen: ((target: string) => void) | undefined
  /**
   * Pointer selection over the frame.
   *
   * `anchor` is where the drag started, `head` follows the pointer; both are
   * frame coordinates, so the same range that gets painted is the one that gets
   * reported when the button comes up.
   */
  let selection: { readonly anchor: { readonly x: number; readonly y: number }; head: { x: number; y: number } } | undefined
  /** The frame as it was last presented, so a selection reads exactly what is on screen. */
  let lastFrame: CellBuffer | undefined
  /** Frame row of each condensing row, mapped to the entry a click toggles. */
  const collapsedRows = new Map<number, number>()
  /** A press on a condensing row, which becomes a click when the pointer stays put. */
  let armedClick: { readonly x: number; readonly y: number; readonly entryId: number } | undefined
  let timer: NodeJS.Timeout | undefined
  /** Pending removals of flashing confirmations. */
  const flashTimers: NodeJS.Timeout[] = []

  /** Selection bounds in reading order, or `null` when nothing is selected. */
  const selectionBounds = (): { readonly y0: number; readonly x0: number; readonly y1: number; readonly x1: number } | null => {
    if (selection === undefined) return null
    const { anchor, head } = selection
    const forward = anchor.y < head.y || (anchor.y === head.y && anchor.x <= head.x)
    const start = forward ? anchor : head
    const end = forward ? head : anchor
    return { y0: start.y, x0: start.x, y1: end.y, x1: end.x }
  }

  /** The columns of one row covered by the selection; the ends stop at the pointer. */
  const selectionSpan = (
    bounds: { readonly y0: number; readonly x0: number; readonly y1: number; readonly x1: number },
    y: number,
    cols: number,
  ): { readonly from: number; readonly to: number } => ({
    from: y === bounds.y0 ? Math.max(0, bounds.x0) : 0,
    to: y === bounds.y1 ? Math.min(cols - 1, bounds.x1) : cols - 1,
  })

  /** The text of one frame row, trailing blanks removed. */
  const rowText = (buf: CellBuffer, y: number): string => {
    let text = ''
    for (let x = 0; x < buf.cols; x += 1) text += buf.get(x, y).ch
    return text.replace(/\s+$/u, '')
  }

  /**
   * Resolve what a Ctrl+click lands on.
   *
   * A cell that carries a hyperlink answers directly; otherwise the row is
   * scanned for a path or URL and the click must fall inside that match, so a
   * click on ordinary prose opens nothing.
   * @param x - clicked column.
   * @param y - clicked row.
   * @returns the target to open, or `undefined`.
   */
  const targetAt = (x: number, y: number): string | undefined => {
    const buf = lastFrame
    if (buf === undefined) return undefined
    const linked = buf.get(x, y).url
    if (linked !== undefined) return linked
    const text = rowText(buf, y)
    const pattern = /(https?:\/\/[^\s]+|[A-Za-z]:[\\/][^\s|]+|(?:[\w.-]+[\\/])+[\w.-]+)/gu
    for (const match of text.matchAll(pattern)) {
      const start = match.index ?? 0
      const end = start + match[0].length
      if (x >= start && x < end) return match[0]
    }
    return undefined
  }

  /** Paint the selection with reverse video over an assembled frame. */
  const paintSelection = (buf: CellBuffer): void => {
    const bounds = selectionBounds()
    if (bounds === null) return
    for (let y = bounds.y0; y <= bounds.y1 && y < buf.rows; y += 1) {
      const span = selectionSpan(bounds, y, buf.cols)
      for (let x = span.from; x <= span.to; x += 1) {
        const cell = buf.get(x, y)
        buf.set(x, y, { ...cell, sgr: `${cell.sgr}\u001B[7m` })
      }
    }
  }

  /** The text under the selection, one line per frame row. */
  const selectionText = (buf: CellBuffer): string => {
    const bounds = selectionBounds()
    if (bounds === null) return ''
    const lines: string[] = []
    for (let y = bounds.y0; y <= bounds.y1 && y < buf.rows; y += 1) {
      const span = selectionSpan(bounds, y, buf.cols)
      let text = ''
      for (let x = span.from; x <= span.to; x += 1) text += buf.get(x, y).ch
      lines.push(text.replace(/\s+$/u, ''))
    }
    return lines.join('\n')
  }

  /**
   * The text the current selection covers.
   *
   * A selection that never left the cell it started in is a click, and a click
   * must not put that one character on the clipboard.
   */
  const selectionTextFor = (): string => {
    if (selection === undefined || lastFrame === undefined) return ''
    if (selection.anchor.x === selection.head.x && selection.anchor.y === selection.head.y) return ''
    return selectionText(lastFrame)
  }

  /** Everything the header needs, derived from the current state. */
  const headerState = (density: Density): HeaderState => ({
    model: status.model,
    cwd: options.cwd,
    version: options.version,
    mode: status.mode,
    running,
    tick,
    elapsedMs: running ? Date.now() - startedAt : 0,
    density,
    activity,
    ...(status.branch === undefined ? {} : { branch: status.branch }),
    ...(status.dirty === undefined ? {} : { dirty: status.dirty }),
    ...(status.tokens === undefined ? {} : { tokens: status.tokens }),
  })

  /** Whether the palette is open: the draft names a command, or the surface opened it itself. */
  const paletteOpen = (): boolean => menuItems !== null && (menuForced || draft.startsWith('/'))
  const render = (): void => {
    if (stopped) return
    const cols = screen.cols
    const rows = screen.rows
    const density = densityFor(cols)
    const open = paletteOpen()
    menuView = open ? renderMenu(menuItems ?? [], { query: menuForced ? '' : draft, selected: menuSelected }, Math.max(20, cols - 10)) : null
    // A menu carries one more row than its entries and borders: the key hint that
    // tells the user how to go back.
    const overlayRows = dialog !== null
      ? dialog.lines.length + 2
      : menuView !== null ? Math.min(menuView.lines.length + 3, Math.max(6, rows - 10)) : 0
    const layout = computeLayout(cols, rows, {
      density,
      // The composer grows with the draft: a line break typed with Shift+Enter
      // stays visible instead of being clipped to the last row.
      composerHeight: Math.max(composerHeight, 3 + Math.min(COMPOSER_MAX_ROWS, draft.split('\n').length)),
      overlayHeight: overlayRows,
      // The welcome screen owns the top of the display: its wordmark is the
      // brand, so the session header is not drawn above it.
      headerHeight: welcome === null ? HEADER_HEIGHT : 0,
    })
    const buf = createBuffer(cols, rows, palette)
    if (welcome === null) drawHeader(buf, layout.header, headerState(density))

    // One column stays free at the right: the scrollbar is drawn there, and a box
    // whose corner sits in that column would be painted over by it.
    const logWidth = Math.max(20, layout.log.w - 1)
    const body = renderTranscript(log.entries, logWidth, {
      tick,
      runningGlyph: workingSpinner(tick),
      hyperlinks: true,
      version: log.version,
      ...(welcome === null ? {} : { leading: renderWelcome({ ...welcome, tick }, logWidth, layout.log.h) }),
    })
    transcriptHeight = body.total
    viewportHeight = layout.log.h
    if (follow) offset = clampScroll(Number.MAX_SAFE_INTEGER, transcriptHeight, viewportHeight)
    const view = drawLogView(buf, layout.log, body, { offset, follow })
    offset = view.offset
    follow = offset >= Math.max(0, transcriptHeight - viewportHeight)
    // Remember which frame row holds a row that reacts to a click, so the click can
    // find what it belongs to. The mapping comes from the view itself: a pinned
    // heading shifts every painted row down, and recomputing the offset here would
    // put the hotspot one row away from the marker the user sees.
    collapsedRows.clear()
    for (const painted of view.painted) {
      if (painted.line.collapsed === true && painted.line.entryId !== undefined) {
        collapsedRows.set(painted.row, painted.line.entryId)
      }
    }

    if (layout.overlay !== null) {
      if (dialog !== null) drawDialog(buf, layout.overlay, dialog)
      else if (menuView !== null) {
        drawMenu(buf, layout.overlay, menuView, menuForced ? menuTitle : ' commands', menuForced
          ? 'Esc — назад · ↑↓ — выбор · Enter — применить'
          : 'Esc — закрыть · ↑↓ — выбор · Enter — выполнить')
      }
    }
    drawComposer(buf, layout.composer, { draft, hint, running })
    drawStatus(buf, layout.status, status, cols, running)
    paintSelection(buf)
    lastFrame = buf
    screen.present(buf)
    const cursor = menuView !== null || dialog !== null ? null : composerCursor(layout.composer, draft)
    if (cursor === null) {
      screen.hideCursor()
      lastCursor = null
    } else if (lastCursor === null || lastCursor.row !== cursor.row || lastCursor.col !== cursor.col) {
      screen.showCursor()
      screen.setCursor(cursor.row, cursor.col)
      lastCursor = cursor
    }
  }

  const scrollBy = (delta: number): void => {
    offset = clampScroll(offset + delta, transcriptHeight, viewportHeight)
    follow = offset >= Math.max(0, transcriptHeight - viewportHeight)
    render()
  }

  /** Any key the composer consumes ends the welcome screen. */
  const leaveWelcome = (): void => {
    if (welcome !== null) welcome = null
  }

  return {
    log,
    screen,
    get draft() {
      return draft
    },
    get stopped() {
      return stopped
    },
    get inWelcome() {
      return welcome !== null
    },
    setDraft(text) {
      draft = text
      render()
    },
    setStatus(patch) {
      status = { ...status, ...patch }
      render()
    },
    setRunning(next, nextActivity) {
      running = next
      if (nextActivity !== undefined) activity = nextActivity
      // The counters describe the turn that just ended: leaving them on an idle line
      // would claim that three agents are still working.
      if (!next) status = { ...status, agents: undefined, tasks: undefined }
      if (next) startedAt = Date.now()
      render()
    },
    setHint(next) {
      hint = next
      render()
    },
    setDialog(next) {
      dialog = next
      dialogSelected = 0
      render()
    },
    setMenuItems(items) {
      menuItems = items
      render()
    },
    openMenu(items, title, selected) {
      menuItems = items
      menuTitle = ` ${title ?? 'выбор'} `
      menuForced = true
      menuSelected = Math.max(0, Math.min(items.length - 1, selected ?? 0))
      render()
    },
    closeMenu() {
      menuForced = false
      render()
    },
    onMenuClose(handler) {
      onMenuClose = handler
    },
    onMenuAccept(handler) {
      onAccept = handler
    },
    handleKey(key) {
      // The palette owns the arrows and the Tab key while the draft names a command.
      if (menuView !== null) {
        const count = menuView.items.length
        switch (key.kind) {
          case 'up':
            menuSelected = count === 0 ? 0 : (menuSelected - 1 + count) % count
            render()
            return
          case 'down':
            menuSelected = count === 0 ? 0 : (menuSelected + 1) % count
            render()
            return
          case 'tab':
            menuSelected = count === 0 ? 0 : (menuSelected + 1) % count
            render()
            return
          case 'shift-tab':
            menuSelected = count === 0 ? 0 : (menuSelected - 1 + count) % count
            render()
            return
          case 'escape': {
            draft = ''
            menuSelected = 0
            // The composer owns the draft in this surface, so closing the list has
            // to be reported to the loop that typed it; otherwise the next redraw
            // restores the draft and the list reappears under the frame. A list a
            // command opened has a level above it, the palette has none.
            const nested = menuForced
            menuForced = false
            onMenuClose?.(nested)
            return
          }
          case 'enter': {
            // A draft that already names an entry is a finished command, so
            // Enter runs it: completing it again would only append the space the
            // palette adds after a name the user has not typed, and a line that
            // already carries arguments would lose them. The check reads the full
            // catalogue and runs before the filter is consulted, because a typo
            // or an argument leaves the filtered list empty while the line is
            // still a command the user finished typing.
            const typed = draft.trim()
            const known = menuItems ?? []
            const named = known.some(entry => typed === entry.name || typed.startsWith(`${entry.name} `))
            if (named && !menuForced) break
            const item = menuView.items[menuView.selected]
            if (item === undefined) return
            // The surface decides what a pick means: a typed palette completes
            // the draft, a surface-opened list applies the choice directly.
            onAccept?.(item)
            if (!menuForced) {
              draft = ''
              menuSelected = 0
            }
            render()
            return
          }
          default:
            break
        }
      }
      // A request box owns the arrows while it is open, unless it declares that
      // its caller maintains the selection.
      if (dialog !== null && dialog.passthroughArrows !== true) {
        const count = dialog.lines.length
        if (key.kind === 'up' || key.kind === 'down') {
          dialogSelected = key.kind === 'up'
            ? (dialogSelected - 1 + Math.max(1, count)) % Math.max(1, count)
            : (dialogSelected + 1) % Math.max(1, count)
          render()
          return
        }
      }
      switch (key.kind) {
        case 'mouse': {
          const event = key.event
          const delta = wheelDelta(event, WHEEL_LINES)
          if (delta !== 0) {
            scrollBy(delta)
            return
          }
          // A left-button drag selects frame text and reports it on release:
          // with mouse reporting on, the terminal hands the drag to the surface
          // instead of doing its own selection, so the surface has to provide it.
          // Ctrl+click is the open gesture, and it resolves a link or a path.
          if (event.action === 'press-left' && event.ctrl) {
            const target = targetAt(event.x, event.y)
            if (target !== undefined) {
              onOpen?.(target)
              return
            }
          }
          if (event.action === 'press-left') {
            // The highlight starts on the press, the way a terminal behaves: a
            // terminal that reports no intermediate motion still has to show what
            // the drag covers. A row that reacts to clicks is remembered instead,
            // and the release decides whether this was a click or a drag.
            selection = { anchor: { x: event.x, y: event.y }, head: { x: event.x, y: event.y } }
            armedClick = undefined
            const entryId = collapsedRows.get(event.y)
            if (entryId !== undefined && !event.ctrl) armedClick = { x: event.x, y: event.y, entryId }
            render()
            return
          }
          if (event.action === 'move') {
            if (selection === undefined) {
              return
            }
            selection.head = { x: event.x, y: event.y }
            // Any movement means the user is selecting, not clicking.
            if (armedClick !== undefined && (event.y !== armedClick.y || event.x !== armedClick.x)) armedClick = undefined
            render()
            return
          }
          if (event.action === 'release') {
            const text = selectionTextFor()
            const clicked = armedClick !== undefined && selection !== undefined
              && selection.anchor.x === selection.head.x && selection.anchor.y === selection.head.y
            const entryId = armedClick?.entryId
            armedClick = undefined
            selection = undefined
            if (clicked && entryId !== undefined) {
              const entry = log.entries.find(candidate => candidate.id === entryId)
              if (entry !== undefined) log.patch(entryId, { expanded: entry.expanded !== true })
              render()
              return
            }
            render()
            // A press and a release in one cell is a click, not a selection: it
            // must not put that single character on the clipboard.
            if (text.trim() !== '') onSelection?.(text)
            return
          }
          unhandled?.(key)
          return
        }
        case 'page-up':
          scrollBy(-Math.max(1, viewportHeight - 1))
          return
        case 'page-down':
          scrollBy(Math.max(1, viewportHeight - 1))
          return
        case 'up':
        case 'down': {
          // A box that moves its own highlight owns the arrows: sending them on
          // to the loop is what lets its selection follow the keys.
          if (dialog !== null && dialog.passthroughArrows === true) {
            unhandled?.(key)
            return
          }
          // With an empty composer the arrows read the transcript, which is what
          // a user expects while reviewing a long answer; once there is a draft
          // they belong to the input line and recall history there.
          if (draft.trim() !== '') {
            leaveWelcome()
            unhandled?.(key)
            return
          }
          scrollBy(key.kind === 'up' ? -1 : 1)
          return
        }
        default:
          leaveWelcome()
          unhandled?.(key)
      }
    },
    onUnhandled(handler) {
      unhandled = handler
    },
    onSelection(handler) {
      onSelection = handler
    },
    onOpen(handler) {
      onOpen = handler
    },
    enterSession() {
      welcome = null
      render()
    },
    flash(text, ms = FLASH_MS) {
      for (const line of text.split('\n')) {
        const trimmed = line.trim()
        if (trimmed === '') continue
        const id = log.append({ kind: 'info', text: trimmed })
        flashTimers.push(setTimeout(() => {
          log.remove(id)
          render()
        }, ms))
      }
      render()
    },
    render,
    start() {
      if (stopped) return
      screen.enter()
      render()
      timer = setInterval(() => {
        tick += 1
        if (running || welcome !== null) render()
      }, Math.round(1000 / FPS))
      timer.unref()
    },
    stop() {
      if (stopped) return
      stopped = true
      for (const pending of flashTimers.splice(0)) clearTimeout(pending)
      if (timer !== undefined) {
        clearInterval(timer)
        timer = undefined
      }
      screen.leave()
    },
  }
}

/** Draw the composer: a dashed rule, the prompt rows, the hint row, and a rule. */
function drawComposer(
  buf: CellBuffer,
  rect: Rect,
  input: { readonly draft: string; readonly hint: string; readonly running: boolean },
): void {
  if (rect.h <= 0 || rect.w <= 0) return
  const inner = Math.max(8, rect.w - 4)
  const left = rect.x + 2
  const right = left + inner - 1
  buf.write(left, rect.y, dashedLine(inner), 'Subtle')

  const prefix = '> '
  const available = inner - 4
  // A multi-line draft keeps every line: the prompt marks the first one and the
  // continuation lines stay aligned under it, so Shift+Enter shows the break the
  // user just typed instead of scrolling it away. Past the window's limit the
  // view follows the caret, and the first row says how many lines are above it.
  const total = input.draft.split('\n').length
  const rows = Math.max(1, Math.min(composerRowLimit(rect), total))
  const hidden = Math.max(0, total - rows)
  const lines = input.draft.split('\n').slice(hidden)
  for (const [index, line] of lines.entries()) {
    const row = rect.y + 1 + index
    if (row >= rect.y + rect.h - 1) break
    buf.put(left, row, '│', 'Subtle')
    buf.put(right, row, '│', 'Subtle')
    const marker = index === 0 && hidden === 0 ? prefix : '  '
    const shown = index === lines.length - 1 ? takeTail(line, available).text : takeHead(line, available)
    buf.write(left + 1, row, ' ', 'Muted')
    buf.write(left + 3, row, marker, 'Accent', { bold: !input.running && index === lines.length - 1 })
    buf.write(left + 3 + displayWidth(marker), row, shown, 'Text')
  }
  if (hidden > 0) {
    // The scroll position is information: without it a draft of ten lines looks
    // like a draft of eight with its head missing.
    const label = ` ▲ ${String(hidden)} ${hidden === 1 ? 'строка' : hidden < 5 ? 'строки' : 'строк'} выше`
    buf.write(left + 4, rect.y + 1, takeHead(label, Math.max(0, available)), 'Subtle', { dim: true })
  }

  const hintRow = rect.y + rect.h - (rect.h >= 4 ? 2 : 1)
  if (hintRow > rect.y) {
    buf.put(left, hintRow, '│', 'Subtle')
    buf.put(right, hintRow, '│', 'Subtle')
    // While a turn runs the hint states that fact, so the row under the composer
    // answers "is it still working" without the user reading the status line.
    const text = input.running ? '✦ Working · Esc прерывает ход' : input.hint
    buf.write(left + 4, hintRow, takeHead(text, Math.max(0, available)), input.running ? 'Text' : 'Muted', { dim: true })
  }
  if (rect.h >= 4) buf.write(left, rect.y + rect.h - 1, dashedLine(inner), 'Subtle')
}

/** How many input rows the composer rectangle can hold. */
function composerRowLimit(rect: Rect): number {
  return Math.max(1, rect.h - 3)
}

/** Where the terminal cursor belongs inside the composer, addressed one-based. */
function composerCursor(rect: Rect, draft: string): { readonly row: number; readonly col: number } | null {
  if (rect.h <= 0 || rect.w <= 0) return null
  const inner = Math.max(8, rect.w - 4)
  const lines = draft.split('\n')
  const total = lines.length
  const rows = Math.max(1, Math.min(composerRowLimit(rect), total))
  // The caret sits at the end of the newest line, which is the last row the
  // composer shows; the column matches how `drawComposer` lays the prompt and its
  // continuations out.
  const visible = takeTail(lines[total - 1] ?? '', inner - 4)
  return { row: rect.y + rows, col: rect.x + 7 + displayWidth(visible.text) }
}

/**
 * Draw the palette inside a framed box, scrolled so the highlight is visible.
 * @param buf - the frame being assembled.
 * @param rect - the box rectangle, which includes one row for the key hint.
 * @param menu - the rendered entries.
 * @param title - the frame title naming what the list shows.
 * @param hint - the key line at the bottom of the box.
 */
function drawMenu(buf: CellBuffer, rect: Rect, menu: MenuView, title: string, hint: string): void {
  drawBox(buf, rect, { border: 'round', token: 'Subtle', title })
  const total = menu.lines.length
  const rows = Math.min(total, Math.max(0, rect.h - 3))
  const start = menu.selected < 0 ? 0 : Math.max(0, Math.min(menu.selected - Math.floor(rows / 2), Math.max(0, total - rows)))
  for (let row = 0; row < rows; row++) {
    const line = menu.lines[start + row]
    if (line === undefined) continue
    paintStyledLine(buf, rect.x + 2, rect.y + 1 + row, Math.max(1, rect.w - 4), line)
  }
  if (rect.h >= 3) {
    buf.write(rect.x + 2, rect.y + rect.h - 2, takeHead(hint, Math.max(1, rect.w - 4)), 'Muted', { dim: true })
  }
}

/** Draw a request box in the accent color of the action it guards. */
function drawDialog(buf: CellBuffer, rect: Rect, dialog: DialogView): void {
  drawBox(buf, rect, { border: 'round', token: dialog.token, title: ` ${dialog.label} ` })
  for (let row = 0; row < dialog.lines.length && row + 1 < rect.h; row++) {
    const line = dialog.lines[row]
    if (line === undefined) continue
    paintStyledLine(buf, rect.x + 2, rect.y + 1 + row, Math.max(1, rect.w - 4), line)
  }
}

/**
 * The Russian plural form of a count, for the words the status line uses.
 * @param count - the number being counted.
 * @param one - form for one.
 * @param few - form for two to four.
 * @param many - form for five and above.
 * @returns the word to print after the number.
 */
function plural(count: number, one: string, few: string, many: string): string {
  const rest = count % 100
  if (rest >= 11 && rest <= 14) return many
  const last = count % 10
  if (last === 1) return one
  if (last >= 2 && last <= 4) return few
  return many
}

/** Draw the status line pinned to the last row, dropping parts as width shrinks. */
function drawStatus(buf: CellBuffer, rect: Rect | null, status: AppStatus, cols: number, running: boolean): void {
  if (rect === null || rect.h <= 0) return
  const percent = Math.round(status.contextPercent)
  // While the model runs, the line answers "what is happening": a state word, the
  // elapsed time, and who is on it. The model that answers is named in the header,
  // so the line never mentions it twice.
  const parts: Span[] = []
  const counters: { text: string; token: TokenName }[] = []
  if (status.agents !== undefined) {
    counters.push({ text: `${String(status.agents)} ${plural(status.agents, 'агент', 'агента', 'агентов')}`, token: 'Muted' })
  }
  if (status.tasks !== undefined && status.tasks > 0) {
    counters.push({ text: `${String(status.tasks)} ${plural(status.tasks, 'задача', 'задачи', 'задач')}`, token: 'Muted' })
  }
  if (running) {
    parts.push({ text: '✦', token: 'Shimmer', bold: true }, { text: ' Working', token: 'Text' })
    if (status.turnSeconds !== undefined) {
      parts.push({ text: ' ', token: 'Muted' }, { text: elapsedLabel(status.turnSeconds * 1000), token: 'Muted' })
    }
  } else {
    parts.push({ text: status.model, token: 'Text' })
  }
  // The context meter sits before the counters: at a narrow width the counters are
  // the first thing that may go, and the meter is the fact the user asked to keep.
  const ctx: Span[] = [{ text: `ctx ${String(percent)}%`, token: 'Muted' }]
  if (cols >= 72) ctx.push({ text: ` ${progressBar(percent, 10)}`, token: 'Accent' })
  parts.push({ text: ' · ', token: 'Subtle' }, ...ctx)
  for (const counter of counters) {
    parts.push({ text: ' · ', token: 'Subtle' }, counter)
  }
  if (cols >= 110 && status.costUsd !== undefined) {
    parts.push({ text: ' · ', token: 'Subtle' }, { text: `$${status.costUsd.toFixed(2)}`, token: 'Muted' })
  }
  if (cols >= 80 && status.turnSeconds !== undefined && !running) {
    parts.push({ text: ' · ', token: 'Subtle' }, { text: `${status.turnSeconds.toFixed(1)}s`, token: 'Muted' })
  }
  if (cols >= 96 && status.tokens !== undefined) {
    parts.push({ text: ' · ', token: 'Subtle' }, { text: `${formatTokens(status.tokens)} tok`, token: 'Muted' })
  }
  if (cols >= 88 && status.branch !== undefined) {
    parts.push({ text: ' · ', token: 'Subtle' }, { text: `${status.branch}${status.dirty === true ? '*' : ''}`, token: 'Warn' })
  }
  parts.push({ text: ' · ', token: 'Subtle' }, { text: status.mode, token: 'RoleBadge' })
  if (running && cols >= 100) parts.push({ text: ' · ', token: 'Subtle' }, { text: 'Esc прерывает ход', token: 'Muted' })

  let column = rect.x + 2
  for (const span of parts) {
    if (column >= rect.x + rect.w) break
    const room = rect.x + rect.w - column
    const text = displayWidth(span.text) > room ? takeHead(span.text, room) : span.text
    if (text === '') break
    buf.write(column, rect.y, text, span.token, {
      ...(span.bold === undefined ? {} : { bold: span.bold }),
      ...(span.dim === undefined ? {} : { dim: span.dim }),
    })
    column += displayWidth(text)
  }
}

/** Keep the tail of a draft that fits, marking the cut with an ellipsis. */
function takeTail(text: string, width: number): { readonly text: string } {
  if (displayWidth(text) <= width) return { text }
  const lines = wrapText(text, Math.max(1, width - 1))
  const last = lines[lines.length - 1] ?? ''
  return { text: `…${last}` }
}

/** Keep the head of a line that fits. */
function takeHead(text: string, width: number): string {
  if (displayWidth(text) <= width) return text
  let result = ''
  for (const glyph of text) {
    if (displayWidth(result + glyph) > width) break
    result += glyph
  }
  return result
}
