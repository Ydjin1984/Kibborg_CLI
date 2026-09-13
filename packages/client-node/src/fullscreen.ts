/**
 * The fullscreen screen mode: one repainted frame on the alternate buffer.
 *
 * Inline mode appends to the scrollback and lets the terminal own wrapping and
 * history; fullscreen owns the whole grid instead, so the layout can place a
 * header, the conversation, an overlay, the composer, and the status line in
 * fixed regions. The mode is opt-in (`--fullscreen` or the `screen` setting) and
 * reverts to inline whenever the terminal cannot enter the alternate buffer —
 * a redirected pipe or `TERM=dumb` must keep working, and a terminal that was
 * taken over must always be given back.
 *
 * The conversation is replayed from the lines this process kept: the assistant
 * stream, tool rows, and notices arrive through a sink that appends to a ring of
 * lines instead of writing to stdout. Those lines are painted by the frame
 * renderer, so the turn itself runs with a plain palette and the frame decides
 * color from tokens.
 * @module @kibborg/client-node/fullscreen
 */

import { stdin, stdout } from 'node:process'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { IApiClient } from '@deepseek-ai/dsh-host-apiproxy/client'
import {
  appendHistory,
  completeDraft,
  completionHint,
  composerFrame,
  computeLayout,
  createBuffer,
  createScreen,
  densityFor,
  detectCaps,
  displayWidth,
  historyPath,
  loadHistory,
  makeDash,
  paletteForTheme,
  panelLines,
  permissionDialog,
  plainPalette,
  questionDialog,
  spinnerFrame,
  statusLine,
  thinkingToken,
  type CellBuffer,
  type CompletionSources,
  type KeyEvent,
  type Palette,
  type TerminalCaps,
  type TokenName,
} from '@kibborg/tui'
import { runTurn } from './turn.ts'
import { createEscapeIdle } from './escape-idle.ts'
import { splitCommand, type SurfaceState } from './command-router.ts'
import {
  type ApprovalDecision,
  type PendingApproval,
  type PendingQuestion,
  type QuestionAnswer,
} from './interaction.ts'
import { actOnPanel, movePanelSelection, switchPanelTab, type PanelSession, type PanelState } from './panel.ts'
import { formatPanelSnapshot, PANEL_NAMES, readPanelSnapshot, type PanelName } from './panels.ts'
import type { CommandOutcome } from './remote.ts'
import type { SurfaceSettings } from './surface-settings.ts'

/** How many conversation lines the mode keeps for redraw. */
const LINE_LIMIT = 4000

/** Repaint interval while a turn runs, in milliseconds. */
const ANIMATION_MS = 160

/** Two Ctrl+C presses within this window leave the session. */
const INTERRUPT_WINDOW_MS = 1500

/** What the fullscreen mode needs from the surface. */
export interface FullscreenSession {
  /** The API client this invocation talks through. */
  readonly client: IApiClient
  /** The session every submitted task goes to. */
  readonly sessionId: SessionId
  /** Live surface state (model, mode, context, git). */
  readonly state: SurfaceState
  /** Behaviour read from the `kibborg-cli` settings section. */
  readonly settings: SurfaceSettings
  /** Harness home, where the input history lives. */
  readonly home: string
  /** Candidate sets the Tab key completes from. */
  readonly sources: CompletionSources
  /**
   * Load the file and session candidates the first completion needs.
   *
   * The scan waits for Tab: a deep working directory and a long stored history
   * cost seconds, and the frame has to appear without them.
   */
  readonly fillSources?: () => Promise<void>
  /** The tabs modal: how to read it and what to act through. */
  readonly panel: { open(): Promise<PanelState>; readonly session: PanelSession }
  /** Runs one slash line; the local router owns its own commands and writes through the given sink. */
  readonly onCommand: (line: string, write: (chunk: string) => void) => Promise<CommandOutcome>
}

/** The panel name `delta` steps away from the current one, wrapping around. */
function nextPanelName(current: PanelName, delta: number): PanelName {
  const index = PANEL_NAMES.indexOf(current)
  const next = (index + delta + PANEL_NAMES.length) % PANEL_NAMES.length
  return PANEL_NAMES[next] ?? current
}

/** Human title of one live data panel. */
function panelTitle(name: PanelName): string {
  switch (name) {
    case 'sessions': return 'Sessions'
    case 'subagents': return 'Subagents'
    case 'jobs': return 'Jobs'
    case 'queue': return 'Queue'
    case 'context': return 'Context'
    case 'goals': return 'Goal'
    case 'todos': return 'Todos'
    default: return name
  }
}

/** Lines accumulated for redraw, split as they arrive. */
interface Feed {
  readonly lines: string[]
  write(chunk: string): void
  /**
   * The newest `count` lines, or a window ending `offset` lines before the tail.
   * @param count - how many lines the frame can show.
   * @param offset - lines scrolled back from the tail; 0 follows new output.
   * @returns the lines to draw, oldest first.
   */
  snapshot(count: number, offset?: number): readonly string[]
}

/** Build a line feed that keeps the tail of the conversation. */
function createFeed(): Feed {
  const lines: string[] = ['']
  return {
    lines,
    write(chunk: string) {
      for (const part of chunk.split('\n')) {
        if (part === '' && lines[lines.length - 1] === '') continue
        const current = lines[lines.length - 1]
        if (current === '' || part.startsWith('\r')) lines[lines.length - 1] = part.replace(/^\r/u, '')
        else lines[lines.length - 1] = `${current}${part}`
        lines.push('')
      }
      if (lines.length > LINE_LIMIT) lines.splice(0, lines.length - LINE_LIMIT)
    },
    snapshot(count: number, offset = 0) {
      const content = lines.filter((line, index) => !(index === lines.length - 1 && line === ''))
      const end = Math.max(0, content.length - offset)
      return content.slice(Math.max(0, end - count), end)
    },
  }
}

/** Total conversation lines the feed currently holds. */
function feedLength(feed: Feed): number {
  return feed.lines.filter((line, index) => !(index === feed.lines.length - 1 && line === '')).length
}

/** One painted run of a conversation line. */
export interface LineSegment {
  /** Text of the run. */
  readonly text: string
  /** Token painting it. */
  readonly token: TokenName
}

/**
 * Split one conversation line into painted runs.
 *
 * The turn renderer writes plain text into the feed (the frame owns color), so
 * the glyphs it prints are what identifies a row: a speaker label, a tool call,
 * a failure, a footer, or a notice. Anything unrecognised stays `Text` — the
 * point is that the common rows are legible at a glance, not that every byte is
 * classified.
 * @param line - one line of the conversation.
 * @returns the runs to write, in order.
 */
export function lineSegments(line: string): readonly LineSegment[] {
  const trimmed = line.trimStart()
  const indent = line.slice(0, line.length - trimmed.length)
  if (trimmed.startsWith('You')) return [{ text: `${indent}You`, token: 'Muted' }, { text: trimmed.slice(3), token: 'Text' }]
  if (trimmed.startsWith('⚙')) {
    const rest = trimmed.slice(1)
    const gap = rest.search(/ {2,}/u)
    return gap === -1
      ? [{ text: `${indent}⚙`, token: 'Accent' }, { text: rest, token: 'Muted' }]
      : [
        { text: `${indent}⚙`, token: 'Accent' },
        { text: rest.slice(0, gap + 1), token: 'Muted' },
        { text: rest.slice(gap + 1), token: 'Text' },
      ]
  }
  if (trimmed.startsWith('✗')) return [{ text: line, token: 'Error' }]
  if (trimmed.startsWith('✓')) return [{ text: line, token: 'Success' }]
  if (trimmed.startsWith('→')) return [{ text: line, token: 'Accent' }]
  if (trimmed.startsWith('⚠')) return [{ text: line, token: 'Warn' }]
  if (trimmed.startsWith('session ') || trimmed.startsWith('/panel')) return [{ text: line, token: 'Muted' }]
  return [{ text: line, token: 'Text' }]
}

/** Write one conversation line as painted runs, clipped to the width. */
function writeLine(buffer: CellBuffer, y: number, line: string, cols: number, palette: Palette): void {
  let column = 0
  for (const segment of lineSegments(line)) {
    if (column >= cols) break
    const room = cols - column
    const text = displayWidth(segment.text) > room ? segment.text.slice(0, room) : segment.text
    buffer.write(column, y, text, segment.token)
    column += displayWidth(text)
  }
  void palette
}

/**
 * Run the interactive loop on the alternate screen.
 * @param session - the client, session, settings, and command routing.
 * @returns the process exit code, or `unsupported` when this terminal cannot
 * enter the alternate screen and the caller should fall back to inline mode.
 */
export async function runFullscreen(session: FullscreenSession): Promise<number | 'unsupported'> {
  // KIBBORG_INLINE=1 is the emergency escape hatch: a terminal that mis-renders
  // the frame (or a session that must stay scrollback-only) falls back to the
  // inline loop instead of being taken over.
  if (process.env['KIBBORG_INLINE'] === '1') return 'unsupported'
  const palette = paletteForTheme(session.settings.theme, process.env, true)
  const caps: TerminalCaps = detectCaps(stdout, process.env)
  if (process.env['KIBBORG_TRACE'] === '1') {
    process.stderr.write(`kibborg[trace]: fullscreen caps ${JSON.stringify(caps)}\n`)
  }
  if (!caps.interactive || !caps.altScreen) return 'unsupported'

  const screen = createScreen({ stdout, stdin, caps })
  const feed = createFeed()
  const history = [...loadHistory(historyPath(session.home))]
  let historyIndex = history.length
  let draft = ''
  let hint = ''
  let running = false
  let runningSince = 0
  let tick = 0
  /** When the last Ctrl+C arrived, so two presses inside the window leave. */
  let lastInterrupt = 0
  /** Conversation lines scrolled back from the tail; 0 shows the newest. */
  let scroll = 0
  let controller: AbortController | undefined
  let panel: PanelState | undefined
  /** The live data panel opened with Ctrl+O. */
  let sidePanel: { readonly name: PanelName; readonly lines: readonly string[] } | undefined
  /** Bumped by every panel load and by every close, so stale loads are dropped. */
  let panelEpoch = 0
  /** Close whatever panel is showing and invalidate loads still in flight. */
  const closePanels = (): void => {
    panelEpoch += 1
    sidePanel = undefined
    panel = undefined
  }
  let exitCode: number | undefined
  let animation: NodeJS.Timeout | undefined
  /** Whether the deferred completion scan has run. */
  let sourcesFilled = false
  /** The request the turn is waiting on, and the question batch it asked. */
  let approval: { readonly pending: PendingApproval; readonly resolve: (decision: ApprovalDecision) => void } | undefined
  let question: {
    readonly pending: PendingQuestion
    readonly resolve: (answers: readonly QuestionAnswer[] | undefined) => void
    readonly collected: QuestionAnswer[]
    index: number
    /** Highlighted option of the question on screen. */
    selected: number
    /** Options marked in a multi-select question. */
    chosen: number[]
  } | undefined

  /** Ask this surface to answer an approval request. */
  const askApproval = (pending: PendingApproval): Promise<ApprovalDecision> =>
    new Promise<ApprovalDecision>(resolve => {
      approval = { pending, resolve }
      render()
    })

  /** Ask this surface to answer a batch of questions, one at a time. */
  const askQuestion = (pending: PendingQuestion): Promise<readonly QuestionAnswer[] | undefined> =>
    new Promise<readonly QuestionAnswer[] | undefined>(resolve => {
      question = { pending, resolve, collected: [], index: 0, selected: 0, chosen: [] }
      draft = ''
      render()
    })

  /** Submit the highlighted answer of the question on screen. */
  const acceptCurrentQuestion = (): void => {
    const active = question
    if (active === undefined) return
    const current = active.pending.questions[active.index]
    if (current === undefined) return
    const options = current.options ?? []
    const selected = current.multiSelect === true && active.chosen.length > 0
      ? active.chosen.map(index => options[index]?.label ?? '').filter(label => label !== '')
      : options[active.selected] === undefined ? [] : [options[active.selected]?.label as string]
    if (selected.length === 0) {
      hint = 'выберите вариант стрелками или введите свой ответ'
      render()
      return
    }
    active.collected.push({ id: current.id, selected })
    active.index += 1
    active.selected = 0
    active.chosen = []
    draft = ''
    hint = ''
    if (active.index >= active.pending.questions.length) {
      question = undefined
      active.resolve(active.collected)
    }
    render()
  }

  const restore = (): void => {
    if (animation !== undefined) clearInterval(animation)
    animation = undefined
    screen.leave()
    if (stdin.isTTY === true) stdin.setRawMode(false)
    stdin.pause()
  }

  const render = (): void => {
    const cols = screen.cols
    const rows = screen.rows
    // A shrink may leave the view scrolled past the conversation: clamp before
    // drawing so the frame never shows an empty window by accident.
    scroll = Math.min(scroll, Math.max(0, feedLength(feed) - 1))
    const innerWidth = Math.max(20, cols - 4)
    const composerFrameView = composerFrame({ draft, innerWidth, showHint: draft === '' && !running }, palette)
    const composer = composerFrameView.lines
    // A request the turn waits on owns the overlay: a question or an approval is
    // the only thing the user can answer, so it must be on screen while it waits.
    const requestLines = approval !== undefined
      ? permissionDialog({
          tool: approval.pending.toolName,
          target: approval.pending.reason ?? '',
        }).lines.map(line => line.spans.map(span => span.text).join(''))
      : undefined
    const questionLines = question === undefined
      ? undefined
      : (() => {
          const current = question.pending.questions[question.index]
          if (current === undefined) return undefined
          return questionDialog({
            question: current.question,
            index: question.index + 1,
            total: question.pending.questions.length,
            options: (current.options ?? []).map(option => option.label),
            selected: question.selected,
            ...(current.multiSelect === true ? { multi: true } : {}),
            ...(current.multiSelect === true ? { chosen: question.chosen } : {}),
          }).lines.map(line => line.spans.map(span => span.text).join(''))
        })()
    const overlayLines = requestLines ?? questionLines ?? (panel !== undefined
      ? panelLines(panel.view, { palette, cols })
      : sidePanel !== undefined
        ? [`  ${panelTitle(sidePanel.name)}`, ...sidePanel.lines.map(line => `  ${line}`)]
        : (hint === '' ? [] : [`  ${hint}`]))
    const layout = computeLayout(cols, rows, {
      density: densityFor(cols),
      composerHeight: composer.length,
      overlayHeight: overlayLines.length,
      headerHeight: 2,
      showStatus: true,
    })
    const buffer = createBuffer(cols, rows, palette)
    // The scroll marker is deliberately short: the header is clipped to the
    // terminal width, and a long hint would eat the session and model names.
    const scrolled = scroll > 0 ? `  ↑${String(scroll)} (End to follow)` : ''
    const header = ` Kibborg   ${session.sessionId}   ${session.state.model}${scrolled}`
    buffer.write(0, layout.header.y, header.slice(0, cols), 'Text', { bold: true })
    buffer.write(0, layout.header.y + 1, makeDash(cols), 'Subtle')

    const lines = feed.snapshot(Math.max(0, layout.log.h), scroll)
    const start = layout.log.y + Math.max(0, layout.log.h - lines.length)
    for (const [index, line] of lines.entries()) {
      writeLine(buffer, start + index, line, cols, palette)
    }
    if (layout.overlay !== null) {
      for (const [index, line] of overlayLines.entries()) {
        if (index >= layout.overlay.h) break
        buffer.write(0, layout.overlay.y + index, line, 'Muted')
      }
    }
    for (const [index, line] of composer.entries()) {
      buffer.write(0, layout.composer.y + index, line, index === 0 || index === composer.length - 1 ? 'Subtle' : 'Text')
    }
    // The status line keeps its shape while a turn runs: the model, the context
    // meter and the branch stay exactly where they are, and the turn's own facts
    // (spinner, elapsed time, tokens) are added to them. Replacing the line made
    // the context window look like it had disappeared.
    const status = statusLine({
      model: session.state.model,
      contextPercent: session.state.contextPercent,
      mode: session.state.mode,
      cols,
      ...(running
        ? {
            spinner: spinnerFrame(tick),
            spinnerToken: thinkingToken(tick),
            turnSeconds: (Date.now() - runningSince) / 1000,
          }
        : {}),
      ...(session.state.branch === undefined ? {} : { branch: session.state.branch }),
      ...(session.state.dirty === undefined ? {} : { dirty: session.state.dirty }),
      ...(running ? { hint: 'esc прерывает ход' } : {}),
    }, palette)
    if (layout.status !== null) buffer.write(0, layout.status.y, status.slice(0, cols), 'Muted')
    screen.present(buffer)
    screen.setCursor(layout.composer.y + composerFrameView.cursorRow, composerFrameView.cursorColumn)
  }

  /**
   * Load one live data panel and show it.
   *
   * The panel reads its snapshot asynchronously, so a close or a newer load can
   * land while this one is in flight; the epoch makes the stale result a no-op
   * instead of reopening a panel the user already dismissed.
   */
  const loadSidePanel = async (name: PanelName): Promise<void> => {
    const epoch = (panelEpoch += 1)
    let loaded: { readonly name: PanelName; readonly lines: readonly string[] }
    try {
      const snapshot = await readPanelSnapshot(session.client, session.sessionId)
      loaded = { name, lines: formatPanelSnapshot(snapshot, name) }
    } catch (error) {
      loaded = { name, lines: [error instanceof Error ? error.message : String(error)] }
    }
    if (epoch !== panelEpoch) return
    sidePanel = loaded
    render()
  }

  /** Run one task from the composer. */
  const submit = async (text: string): Promise<void> => {
    const task = text.trim()
    if (task === '') return
    appendHistory(historyPath(session.home), task)
    history.push(task)
    historyIndex = history.length
    draft = ''
    hint = ''
    if (task === '/panel') {
      const epoch = (panelEpoch += 1)
      const opened = await session.panel.open()
      if (epoch !== panelEpoch) return
      panel = opened
      render()
      return
    }
    if (task.startsWith('/') && session.sources.commands.includes(splitCommand(task).name)) {
      // A command's own output belongs in the frame, not on stdout: writing it
      // straight out would paint over the layout this loop owns. A command that
      // already printed its answer must not also get the generic acknowledgement.
      let printed = false
      const outcome = await session.onCommand(task, chunk => {
        printed = true
        void feed.write(chunk)
      })
      if (!outcome.ok) feed.write(`\n  ✗ ${outcome.error ?? 'command failed'}\n`)
      else if (!printed) feed.write(`\n  ${outcome.text ?? 'ok'}\n`)
      render()
      return
    }
    feed.write(`\n  You  ${task}\n`)
    running = true
    runningSince = Date.now()
    tick = 0
    scroll = 0
    controller = new AbortController()
    animation = setInterval(() => {
      tick += 1
      render()
    }, ANIMATION_MS)
    const outcome = await runTurn({
      client: session.client,
      sessionId: session.sessionId,
      task,
      palette: plainPalette,
      sink: { write: chunk => void feed.write(chunk) },
      cols: screen.cols,
      signal: controller.signal,
      ...session.state.model === undefined || session.state.model === '' ? {} : { model: session.state.model },
      ...(session.settings.timestamps ? { timestamps: true } : {}),
      // A question or an approval has to reach this surface: without the callbacks
      // the host applies the headless policy, and the model can never offer a choice.
      onApproval: askApproval,
      onQuestion: askQuestion,
    })
    if (animation !== undefined) clearInterval(animation)
    animation = undefined
    controller = undefined
    running = false
    session.state.contextPercent = outcome.contextPercent
    feed.write(`\n`)
    render()
  }

  const handle = (key: KeyEvent): void => {
    if (process.env['KIBBORG_TRACE'] === '1') process.stderr.write(`kibborg[trace]: key ${key.kind}\n`)
    // The live data panel owns the keyboard while it is open: it is a read-only
    // view, so only navigation, refresh, and close apply.
    if (sidePanel !== undefined) {
      switch (key.kind) {
        case 'ctrl-o':
        case 'escape':
          closePanels()
          render()
          return
        case 'ctrl-d':
          // Ctrl+D means leave, whatever is on screen; Esc is the key that only
          // closes a view.
          closePanels()
          exitCode = 0
          return
        case 'tab':
          void loadSidePanel(nextPanelName(sidePanel.name, 1))
          return
        case 'shift-tab':
          void loadSidePanel(nextPanelName(sidePanel.name, -1))
          return
        case 'char':
          if (key.text === 'r' || key.text === 'R') void loadSidePanel(sidePanel.name)
          return
        default:
          return
      }
    }
    if (approval !== undefined) {
      const active = approval
      const decide = (decision: ApprovalDecision): void => {
        approval = undefined
        hint = ''
        active.resolve(decision)
        render()
      }
      switch (key.kind) {
        case 'char':
          if (key.text === 'y' || key.text === 'Y' || key.text === 'a' || key.text === 'A') decide('allowed-once')
          else if (key.text === 'n' || key.text === 'N') decide('rejected')
          return
        case 'enter':
          decide('allowed-once')
          return
        case 'escape':
        case 'ctrl-c':
          decide('rejected')
          return
        default:
          return
      }
    }
    if (question !== undefined) {
      const active = question
      const options = active.pending.questions[active.index]?.options ?? []
      const multi = active.pending.questions[active.index]?.multiSelect === true
      switch (key.kind) {
        case 'up':
        case 'down': {
          if (options.length === 0) return
          const step = key.kind === 'up' ? -1 : 1
          active.selected = (active.selected + step + options.length) % options.length
          render()
          return
        }
        case 'enter':
          acceptCurrentQuestion()
          return
        case 'char':
          if (key.text === ' ' && multi) {
            const at = active.chosen.indexOf(active.selected)
            if (at === -1) active.chosen.push(active.selected)
            else active.chosen.splice(at, 1)
            render()
            return
          }
          break
        case 'escape':
        case 'ctrl-c':
          question = undefined
          hint = ''
          active.resolve(undefined)
          render()
          return
        default:
          break
      }
    }
    if (panel !== undefined) {
      const act = (action: 'enter' | 'space' | 'v'): void => {
        void actOnPanel(panel as PanelState, action, session.panel.session).then(() => { render() })
      }
      switch (key.kind) {
        case 'tab': panel = switchPanelTab(panel, 1); render(); return
        case 'shift-tab': panel = switchPanelTab(panel, -1); render(); return
        case 'up': panel = movePanelSelection(panel, -1); render(); return
        case 'down': panel = movePanelSelection(panel, 1); render(); return
        case 'enter': act('enter'); return
        case 'char':
          if (key.text === ' ') act('space')
          else if (key.text === 'v' || key.text === 'V') act('v')
          return
        case 'escape':
        case 'ctrl-d':
          closePanels()
          render()
          return
        default:
          return
      }
    }
    switch (key.kind) {
      case 'ctrl-o':
        // Reaching here means no data panel is open: the branch above closes one.
        if (panel !== undefined) return
        void loadSidePanel('sessions')
        return
      case 'ctrl-l':
        // A full repaint on demand: the diff cache is dropped first, so a
        // terminal that lost part of the frame (resize races, external writes)
        // is redrawn from scratch.
        screen.invalidate()
        render()
        return
      case 'page-up': {
        const page = Math.max(1, screen.rows - 8)
        scroll = Math.min(Math.max(0, feedLength(feed) - 1), scroll + page)
        if (process.env['KIBBORG_TRACE'] === '1') process.stderr.write(`kibborg[trace]: scroll ${String(scroll)} of ${String(feedLength(feed))}\n`)
        render()
        return
      }
      case 'page-down': {
        const page = Math.max(1, screen.rows - 8)
        scroll = Math.max(0, scroll - page)
        render()
        return
      }
      case 'home':
        scroll = Math.max(0, feedLength(feed) - 1)
        render()
        return
      case 'end':
        scroll = 0
        render()
        return
      case 'ctrl-c':
        if (running) {
          controller?.abort()
          void session.client.sessions.cancel({ sessionId: session.sessionId })
          return
        }
        if (draft !== '') {
          draft = ''
          render()
          return
        }
        // Two presses leave, the first only says how: one stray Ctrl+C must not
        // drop a session the user meant to keep.
        if (Date.now() - lastInterrupt <= INTERRUPT_WINDOW_MS) {
          exitCode = 130
          return
        }
        lastInterrupt = Date.now()
        hint = 'ещё раз Ctrl+C — выйти'
        render()
        return
      case 'ctrl-d':
        exitCode = 0
        return
      case 'escape':
        // Escape is the interrupt key while a turn runs, as in the inline loop.
        if (running) {
          controller?.abort()
          void session.client.sessions.cancel({ sessionId: session.sessionId })
          hint = 'прерываю ход'
          render()
          return
        }
        draft = ''
        hint = ''
        render()
        return
      case 'enter':
        if (draft.trim() === '') return
        if (session.settings.multiline) {
          draft += '\n'
          render()
          return
        }
        void submit(draft)
        return
      case 'newline':
        draft += '\n'
        render()
        return
      case 'char':
        draft += key.text
        hint = ''
        render()
        return
      case 'paste':
        draft += key.text
        render()
        return
      case 'backspace':
        draft = draft.slice(0, -1)
        render()
        return
      case 'ctrl-u':
        // With text in the composer this is the readline kill-line key; on an
        // empty composer it scrolls half a page back, the Vim convention.
        if (draft === '') {
          const half = Math.max(1, Math.floor((screen.rows - 8) / 2))
          scroll = Math.min(Math.max(0, feedLength(feed) - 1), scroll + half)
        } else {
          draft = ''
        }
        render()
        return
      case 'tab': {
        const apply = (): void => {
          const completed = completeDraft(draft, session.sources)
          if (completed.active) {
            draft = completed.draft
            hint = completed.candidates.length > 1 ? completionHint(completed.candidates) : ''
            if (completed.candidates.length === 0) hint = 'no match'
          }
          render()
        }
        // The candidate scan is deferred to the first completion: walking a deep
        // working directory and listing the stored sessions must not delay the frame.
        if (session.fillSources !== undefined && !sourcesFilled) {
          sourcesFilled = true
          hint = 'собираю подсказки…'
          render()
          void session.fillSources().catch(() => undefined).then(() => {
            hint = ''
            apply()
          })
          return
        }
        apply()
        return
      }
      case 'up':
        if (history.length === 0) return
        historyIndex = Math.max(0, historyIndex - 1)
        draft = history[historyIndex] ?? ''
        render()
        return
      case 'down':
        if (history.length === 0) return
        historyIndex = Math.min(history.length, historyIndex + 1)
        draft = historyIndex >= history.length ? '' : (history[historyIndex] ?? '')
        render()
        return
      default:
        return
    }
  }

  screen.enter()
  if (stdin.isTTY === true) stdin.setRawMode(true)
  stdin.resume()
  const escapeIdle = createEscapeIdle(() => {
    handle({ kind: 'escape' })
    if (exitCode !== undefined) finish(exitCode)
  })
  const onInput = screen.onInput((chunk: string) => {
    for (const key of escapeIdle.push(chunk)) {
      handle(key)
      if (exitCode !== undefined) break
    }
    if (exitCode !== undefined) finish(exitCode)
  })
  const onResize = screen.onResize(() => {
    // The screen already dropped its previous frame on resize; invalidate again
    // so a terminal that reports the new size before the redraw cannot diff
    // against rows from the old geometry.
    screen.invalidate()
    render()
  })

  const finish = (code: number): void => {
    escapeIdle.stop()
    onInput()
    onResize()
    restore()
    resolveExit(code)
  }

  let resolveExit: (code: number) => void = () => {}
  const done = new Promise<number>(resolve => { resolveExit = resolve })
  // A terminal that was taken over must be given back even on a signal or an
  // unexpected throw: leaving the alternate buffer is part of exiting.
  const onSignal = (): void => { restore(); process.exit(130) }
  process.once('SIGINT', onSignal)
  process.once('SIGTERM', onSignal)
  process.once('exit', restore)
  feed.write(`  session ${session.sessionId}\n  /panel tabs · /panels data · Ctrl+O panel · Tab completes · PgUp/PgDn scroll · Ctrl+C cancels · Ctrl+D leaves\n`)
  render()
  const code = await done
  process.off('SIGINT', onSignal)
  process.off('SIGTERM', onSignal)
  process.off('exit', restore)
  return code
}
