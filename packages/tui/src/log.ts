/**
 * Conversation log of the fullscreen surface.
 *
 * The log is data plus a pure renderer: entries describe what happened, and
 * {@link renderEntries} turns them into styled lines whose width never exceeds
 * the region it will be drawn into. The formats follow `UI.md` §4.3 — the
 * speaker label, the stage spinner, the flat tool rows with `⎿` continuation,
 * the plan widget, and the turn footer.
 * @module @kibborg/tui/log
 */

import type { TokenName } from './tokens.ts'
import { displayWidth, clipPath, takeHeadWidth, wrapText } from './width.ts'
import { elapsedLabel } from './anim.ts'
import { formatTokens } from './status.ts'
export { wrapText }
import { renderMarkdown } from './markdown.ts'

/** What one entry of the transcript represents. */
export type LogKind =
  | 'user'
  | 'assistant'
  | 'stage'
  /** A model's hidden reasoning: only that it happened and how long it took. */
  | 'thought'
  | 'tool'
  /** A subagent entering or leaving the turn: who it is, what it runs on, its role. */
  | 'agent'
  | 'notice'
  /** A short confirmation that fades on its own: a copy, a model switch. */
  | 'info'
  | 'warn'
  | 'error'
  | 'plan'
  | 'diff'
  | 'footer'
  | 'rule'

/** Lifecycle of a tool call. */
export type ToolStatus = 'running' | 'ok' | 'fail'

/** Which agent produced an entry, and how it is drawn. */
export interface AgentBadge {
  /** Short name of the agent: a model name, or the label the delegation carried. */
  readonly label: string
  /**
   * Session the agent works in.
   *
   * The label can change while an agent works — a delegation names itself after
   * it starts — so the identity, not the name, is what a heading is matched on.
   */
  readonly sessionId?: string
  /** Role the agent runs in, such as `ORCHESTRATOR`; absent when the deployment names none. */
  readonly role?: string
  /** Model route in `provider/model` form, when it is known. */
  readonly model?: string
  /**
   * Distance from the session the user typed into: zero for that session itself,
   * one for a subagent it started, and so on. It decides the branch indent.
   */
  readonly depth: number
  /** Color this agent is drawn in. */
  readonly token: TokenName
  /** Whether the agent is starting work or has finished it. */
  readonly state?: 'open' | 'done'
}

/** One transcript entry. */
export interface LogEntry {
  /** Stable identity used by {@link LogModel.patch}. */
  readonly id: number
  /** What this entry represents. */
  readonly kind: LogKind
  /** Body text; for a tool entry this is its argument. */
  readonly text: string
  /** Tool name, for `kind: 'tool'`. */
  readonly name?: string
  /** Tool lifecycle, for `kind: 'tool'`. */
  readonly status?: ToolStatus
  /** How long the tool ran, when it finished. */
  readonly durationMs?: number
  /** Extra lines shown under the entry with the `⎿` continuation mark. */
  readonly detail?: readonly string[]
  /**
   * The tool's argument JSON exactly as the model produced it.
   *
   * Shown under a tool entry so the user can see what was actually requested,
   * rather than the one-line label the header carries.
   */
  readonly input?: string
  /** The tool's output, as the model saw it. */
  readonly output?: string
  /** Lines of the change a tool applied, `+`/`-` marked. */
  readonly diff?: readonly string[]
  /** Lines the change added. */
  readonly added?: number
  /** Lines the change removed. */
  readonly removed?: number
  /** Monotonic version of this entry; the render cache reuses lines until it changes. */
  readonly revision?: number
  /**
   * Whether a long block is expanded.
   *
   * A tool output, a diff, or an answer longer than {@link COLLAPSED_LINES} shows
   * its head plus a row that says how much is hidden; clicking that row expands
   * or collapses the entry again.
   */
  readonly expanded?: boolean
  /** Short trailing summary, such as a match count. */
  readonly meta?: string
  /** Stage verb, for `kind: 'stage'`. */
  readonly verb?: string
  /**
   * What the entry does, in words, when the raw body is not readable on its own.
   *
   * A tool call arrives as JSON; the transcript shows this sentence instead and
   * keeps the JSON in {@link LogEntry.input} for the expanded layer.
   */
  readonly title?: string
  /**
   * Tokens the entry's turn has moved so far.
   *
   * The work row reports them while the turn runs, the way the reference CLIs do:
   * a long turn then shows that it is producing something, not only that it is
   * still alive.
   */
  readonly tokens?: number
  /** Tool name, for the detail layer of `kind: 'tool'`. */
  readonly toolName?: string
  /**
   * When the entry was written, in milliseconds since the epoch.
   *
   * A message carries the time it appeared, the way the reference CLIs stamp
   * their transcripts, so a long session reads as a timeline rather than one
   * undivided stream.
   */
  readonly at?: number
  /** Hotkey legend of the plan widget, for `kind: 'plan'`. */
  readonly keys?: string
  /**
   * The agent this entry belongs to.
   *
   * A subagent's work sits inside the turn that delegated it, so the transcript
   * shows which model did what instead of one undifferentiated stream. The
   * heading entry (`kind: 'agent'`) carries the agent without a branch indent.
   */
  readonly agent?: AgentBadge
}

/** The transcript model. */
export interface LogModel {
  /** Entries in display order. */
  readonly entries: readonly LogEntry[]
  /**
   * Monotonic counter of this model's changes.
   *
   * A repaint reuses the previous transcript while this number is unchanged, so
   * scrolling and selection over a long session cost the viewport, not the log.
   */
  readonly version: number
  /**
   * Add an entry.
   * @param entry - the entry without its identity.
   * @returns the assigned identity.
   */
  append(entry: Omit<LogEntry, 'id'>): number
  /**
   * Replace fields of an existing entry, as a tool call progresses.
   * @param id - identity returned by {@link LogModel.append}.
   * @param patch - fields to replace.
   */
  patch(id: number, patch: Partial<Omit<LogEntry, 'id'>>): void
  /**
   * Drop one entry.
   * @param id - identity returned by {@link LogModel.append}.
   */
  remove(id: number): void
  /** Drop every entry. */
  clear(): void
}

/** A run of text in one style. */
export interface Span {
  /** The text of the run. */
  readonly text: string
  /** Theme token naming its color. */
  readonly token: TokenName
  /** Bold attribute. */
  readonly bold?: boolean
  /** Underline attribute, used by links. */
  readonly underline?: boolean
  /** Hyperlink target this run opens on Ctrl+click, when the terminal supports it. */
  readonly url?: string
  /** Dim attribute. */
  readonly dim?: boolean
}

/** One rendered line of the transcript. */
export interface StyledLine {
  /** Styled runs, left to right. */
  readonly spans: readonly Span[]
  /** Heading of the entry this line belongs to, used as the sticky header. */
  readonly anchor?: string
  /** Whether this line is itself an entry heading. */
  readonly heading?: boolean
  /** Entry this line was rendered from, when the line belongs to one. */
  readonly entryId?: number
  /** Whether this line condenses a long entry and toggles it when clicked. */
  readonly collapsed?: boolean
}

/** Render options. */
export interface RenderOptions {
  /** Animation tick, so a running stage or tool shows a moving glyph. */
  readonly tick?: number
  /**
   * Whether a message carries the time it was written.
   *
   * On by default, the way the reference CLIs stamp their transcripts; a caller
   * that wants a bare log turns it off.
   */
  readonly timestamps?: boolean
  /** Glyph for a running tool or stage; the spinner frame when omitted. */
  readonly runningGlyph?: string
  /**
   * Whether answers may carry OSC 8 hyperlinks.
   *
   * A terminal turns those into clickable text (Ctrl+click opens the file or
   * URL); a redirected or plain view must not receive them.
   */
  readonly hyperlinks?: boolean
  /**
   * Version of the transcript model these entries came from.
   *
   * When it is given, an unchanged version reuses the transcript of the previous
   * paint instead of walking every entry again.
   */
  readonly version?: number
  /** Lines drawn above the transcript, such as the welcome screen. */
  readonly leading?: readonly StyledLine[]
  /**
   * Entry of the newest answer.
   *
   * The answer a user is reading is never condensed, while the answers above it
   * still fold, so the transcript stays short without hiding the conclusion.
   * Set by {@link renderTranscript} from the entries it was given.
   */
  readonly lastAnswerId?: number
}

/** Identity of the newest answer in a transcript, or `undefined` when there is none. */
function lastAnswer(entries: readonly LogEntry[]): number | undefined {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]
    if (entry !== undefined && entry.kind === 'assistant') return entry.id
  }
  return undefined
}

/** Indentation of transcript body text. */
const INDENT = '  '

/** The user's own line: the marker that opens a task, then its text. */
const USER_PREFIX = `${INDENT}> `

/** Continuation of the user's task, aligned under its text. */
const CONTINUATION = `${INDENT}  `

/** Columns the message time keeps for itself at the right edge. */
const STAMP_WIDTH = 5

/** The shortest body a stamped row may keep before the time is dropped. */
const STAMP_MIN_BODY = 12

/** Indentation of a tool row. */
const TOOL_INDENT = '    '

/** Indentation of a `⎿` continuation row. */
const DETAIL_INDENT = '       '

/** Indentation of a row inside a subagent's branch. */
const BRANCH_INDENT = '  │  '

/** Columns the walls of a delegation box occupy inside a row: `  │  ` and `  │`. */
const WALL_WIDTH = 8

/** Branch levels a deeper tree is drawn with; past it the transcript runs out of width. */
const MAX_BRANCH_DEPTH = 4

/** Lines a single tool block prints before it reports what it dropped. */
const BLOCK_LINE_LIMIT = 200

/**
 * Lines a long entry shows before it condenses.
 *
 * A document, a search result, or an answer that runs past this many rows would
 * swamp the transcript, so only the head is shown with a row that says how much
 * is hidden and expands the entry on a click.
 */
const COLLAPSED_LINES = 5

/**
 * Create an empty transcript.
 * @returns the model.
 */
export function createLog(): LogModel {
  const entries: LogEntry[] = []
  // Identity to position, so a streaming answer patches its own entry instead of
  // scanning the whole transcript on every chunk.
  const positions = new Map<number, number>()
  let nextId = 1
  let version = 0
  return {
    get entries() {
      return entries
    },
    get version() {
      return version
    },
    append(entry) {
      const id = nextId
      nextId += 1
      positions.set(id, entries.length)
      // The moment is fixed when the message enters the transcript: a repaint must
      // not move it, and a relayout must not change what time the user saw.
      entries.push({ ...entry, at: entry.at ?? Date.now(), id, revision: 1 })
      version += 1
      return id
    },
    patch(id, patch) {
      const index = positions.get(id)
      if (index === undefined) return
      const current = entries[index] as LogEntry
      entries[index] = { ...current, ...patch, revision: (current.revision ?? 0) + 1 }
      version += 1
    },
    remove(id) {
      const index = positions.get(id)
      if (index === undefined) return
      entries.splice(index, 1)
      positions.delete(id)
      for (let moved = index; moved < entries.length; moved += 1) {
        positions.set((entries[moved] as LogEntry).id, moved)
      }
      version += 1
    },
    clear() {
      entries.length = 0
      positions.clear()
      version += 1
    },
  }
}

/** Total display width of a line's spans. */
export function lineWidth(line: StyledLine): number {
  let width = 0
  for (const span of line.spans) width += displayWidth(span.text)
  return width
}

/** The unstyled text of a line, for tests and sticky headers. */
export function plainText(line: StyledLine): string {
  return line.spans.map(span => span.text).join('')
}

/**
 * The clock time of a message, as the transcript prints it.
 * @param at - milliseconds since the epoch, or `undefined` when unknown.
 * @returns `HH:MM`, or `undefined` when there is no time to show.
 */
export function clockStamp(at: number | undefined): string | undefined {
  if (at === undefined || !Number.isFinite(at)) return undefined
  const date = new Date(at)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

/**
 * Put the time of a message at the right edge of its first readable row.
 *
 * A row that opens a frame or a table keeps its shape: the time moves to the next
 * row that can spare the columns. When no row can, the time is dropped rather
 * than pushed past the frame.
 * @param lines - the message's rows.
 * @param at - milliseconds since the epoch, or `undefined` when unknown.
 * @param width - the frame width available.
 * @returns the rows, with the time in one of them.
 */
function stamped(lines: readonly StyledLine[], at: number | undefined, width: number): StyledLine[] {
  const stamp = clockStamp(at)
  const room = width - STAMP_WIDTH - 2
  if (stamp === undefined || room < STAMP_MIN_BODY) return [...lines]
  const index = lines.findIndex(line => {
    const text = plainText(line).trimEnd()
    return displayWidth(text) > 0 && !/^[┌│╰├]/u.test(text.trimStart())
  })
  if (index === -1) return [...lines]
  const result = [...lines]
  const line = result[index] as StyledLine
  const head = fitLine(line, room)
  const gap = Math.max(1, room - lineWidth(head))
  result[index] = {
    ...head,
    spans: [...head.spans, { text: ' '.repeat(gap), token: 'Muted' }, { text: stamp, token: 'Subtle', dim: true }],
  }
  return result
}

/** Cut spans down to a column budget. */
function fitLine(line: StyledLine, width: number): StyledLine {
  if (lineWidth(line) <= width) return line
  const spans: Span[] = []
  let used = 0
  for (const span of line.spans) {
    if (used >= width) break
    const budget = width - used
    let text = span.text
    if (displayWidth(text) > budget) text = takeHeadWidth(text, budget)
    if (text === '') continue
    used += displayWidth(text)
    spans.push({ ...span, text })
  }
  return { ...line, spans }
}

/** A row of a tool block: the label of its first line, then the continuation indent. */
const BLOCK_INDENT = '       '

/**
 * Render a labelled multi-line block under a tool entry.
 *
 * Lines are wrapped instead of cut, so a long command or a long answer stays
 * readable; only a block larger than the elision bound is shortened, and it says
 * how many lines it dropped.
 * @param target - the lines collected so far, used only for its length.
 * @param label - the label on the first line, or `undefined` for a plain block.
 * @param source - the block's lines, in order.
 * @param width - the frame width available.
 * @param token - token painting the block's text.
 * @param marked - whether `+`/`-` prefixes take the diff colors.
 * @returns the lines to append.
 */
function block(
  label: string | undefined,
  source: readonly string[],
  width: number,
  token: TokenName,
  marked = false,
): StyledLine[] {
  const room = Math.max(1, width - BLOCK_INDENT.length - (label === undefined ? 0 : label.length + 1))
  const out: StyledLine[] = []
  let printed = 0
  for (const line of source) {
    for (const wrapped of wrapText(line, room)) {
      if (printed >= BLOCK_LINE_LIMIT) {
        const dropped = source.length - printed
        out.push({ spans: [{ text: BLOCK_INDENT, token: 'Muted' }, { text: `… ещё ${String(dropped)} строк`, token: 'Muted', dim: true }] })
        return out
      }
      const lineToken: TokenName = marked
        ? (wrapped.startsWith('+') ? 'DiffAdd' : wrapped.startsWith('-') ? 'DiffRemove' : 'Muted')
        : token
      // Unchanged context recedes: the eye should land on the two rows that carry
      // the change, not on the lines the tool happened to print around it.
      const context = marked && !wrapped.startsWith('+') && !wrapped.startsWith('-')
      out.push({
        spans: [
          { text: printed === 0 && label !== undefined ? `${BLOCK_INDENT}${label} ` : BLOCK_INDENT, token: 'Subtle' },
          { text: wrapped, token: lineToken, ...(context ? { dim: true } : {}) },
        ],
      })
      printed += 1
    }
  }
  return out
}

/** Build one line from a prefix, a wrapped body, and an optional trailing summary. */
function compose(
  prefix: readonly Span[],
  body: string | undefined,
  bodyToken: TokenName,
  width: number,
  extra: { readonly anchor?: string; readonly heading?: boolean; readonly suffix?: readonly Span[] },
): StyledLine[] {
  const prefixWidth = prefix.reduce((total, span) => total + displayWidth(span.text), 0)
  const suffixWidth = (extra.suffix ?? []).reduce((total, span) => total + displayWidth(span.text), 0)
  const budget = Math.max(1, width - prefixWidth - suffixWidth)
  // A body-less row is the prefix plus its summary: the tool title carries the
  // meaning, so there is nothing to wrap.
  const bodyLines = body === undefined || body.trim() === '' ? [''] : wrapText(body, budget)
  return bodyLines.map((text, index) => {
    const spans: Span[] = index === 0
      ? [...prefix, { text, token: bodyToken }]
      : [{ text: ' '.repeat(prefixWidth), token: bodyToken }, { text, token: bodyToken }]
    if (index === bodyLines.length - 1 && extra.suffix !== undefined && extra.suffix.length > 0) {
      const used = spans.reduce((total, span) => total + displayWidth(span.text), 0)
      const room = width - used
      let taken = 0
      for (const span of extra.suffix) {
        if (taken >= room) break
        let text = span.text
        if (displayWidth(text) > room - taken) text = takeHeadWidth(text, room - taken)
        if (text === '') continue
        taken += displayWidth(text)
        spans.push({ ...span, text })
      }
    }
    return fitLine(
      {
        spans,
        ...(extra.anchor === undefined ? {} : { anchor: extra.anchor }),
        ...(extra.heading === true ? { heading: true } : {}),
      },
      width,
    )
  })
}

/**
 * Lay out one boxed row: the left part, a rule that fills the middle, the right
 * part, and the corner that closes the row at the last column.
 * @param left - spans already drawn at the left edge.
 * @param right - spans drawn just before the corner.
 * @param corner - the glyph that lands in the last column.
 * @param width - columns available.
 * @returns the spans of one row that is exactly `width` wide.
 */
function boxRow(left: readonly Span[], right: readonly Span[], corner: Span, width: number): Span[] {
  const used = [...left, ...right].reduce((total, span) => total + displayWidth(span.text), 0)
  const fill = Math.max(1, width - used - displayWidth(corner.text) - 3)
  return [...left, { text: ` ${'─'.repeat(fill)} `, token: 'Subtle' }, ...right, corner]
}

/** Tools whose work is a delegation to another agent. */const DELEGATE_TOOLS: readonly string[] = ['executor', 'subagent', 'task', 'delegate']
/** Tools whose work is a file. */
const FILE_TOOLS: readonly string[] = ['read', 'read_file', 'readfile', 'write', 'create', 'write_file', 'edit', 'str_replace', 'str_replace_editor', 'multi_edit', 'apply_patch']
/** Tools whose work is thinking about the task rather than acting on it. */
const THINK_TOOLS: readonly string[] = ['skill', 'create_goal', 'goal', 'todo_write', 'todo', 'plan']

/**
 * Glyph and color of one row: what the agent is doing, not which tool it used.
 *
 * The agent's own color lives on its heading, so a row never mixes the two
 * questions a reader asks — who is working, and what is happening.
 */
function actionMark(
  entry: LogEntry,
  options: RenderOptions,
): { readonly glyph: string; readonly token: TokenName } {
  const name = entry.toolName ?? entry.name ?? ''
  if (entry.status === 'fail') return { glyph: '✕', token: 'Error' }
  // A delegation keeps its own arrow even while it runs: the row says what the
  // agent is doing, and "passing work on" is not the same as "running a command".
  if (DELEGATE_TOOLS.includes(name)) return { glyph: '→', token: 'ActionDelegate' }
  if (entry.status === 'running') return { glyph: options.runningGlyph ?? '◐', token: 'ActionTool' }
  if (FILE_TOOLS.includes(name)) return { glyph: '▣', token: 'ActionFile' }
  if (THINK_TOOLS.includes(name)) return { glyph: '◌', token: 'ActionThink' }
  return { glyph: '✔️', token: 'Success' }
}

/**
 * Keep a long entry to its head and add a row that expands it.
 *
 * The row carries the entry's identity and a `collapsed` marker, so the surface
 * can resolve a click on it back to the entry and toggle {@link LogEntry.expanded}.
 * @param lines - the entry's rendered lines.
 * @param entry - the entry being rendered.
 * @param width - the frame width.
 * @returns the lines to show, either condensed or whole.
 */
function condense(lines: readonly StyledLine[], entry: LogEntry, width: number): StyledLine[] {
  const tagged = lines.map(line => fitLine({ ...line, entryId: entry.id }, width))
  if (entry.expanded === true || tagged.length <= COLLAPSED_LINES) return tagged
  const kept = tagged.slice(0, COLLAPSED_LINES)
  const hidden = tagged.length - COLLAPSED_LINES
  const marker: StyledLine = {
    spans: [
      { text: INDENT, token: 'Muted' },
      {
        text: `⋯ ещё ${String(hidden)} ${hidden === 1 ? 'строка' : hidden < 5 ? 'строки' : 'строк'} — Enter, чтобы развернуть`,
        token: 'Accent',
      },
    ],
    entryId: entry.id,
    collapsed: true,
  }
  return [...kept, marker].map(line => fitLine({ ...line, entryId: entry.id }, width))
}

/** Render one entry into lines. */
function renderEntry(entry: LogEntry, width: number, options: RenderOptions): StyledLine[] {
  switch (entry.kind) {
    case 'user': {
      // The prompt is the user's own line: a marker, the text, and the time at the
      // right edge. No label and no frame — the marker says who wrote it, so the
      // row spends its width on the task instead of on decoration.
      const wrapped = wrapText(entry.text, Math.max(1, width - USER_PREFIX.length))
      // The first row is both the task itself and the entry's heading: the sticky
      // header of a scrolled view then shows which task the reader is inside,
      // instead of a separate label that repeats what the marker already says.
      const lines = (wrapped.length === 0 ? [''] : wrapped).map((text, index) => fitLine({
        spans: [{ text: `${index === 0 ? USER_PREFIX : CONTINUATION}${text}`, token: 'Text' }],
        anchor: 'You',
        ...(index === 0 ? { heading: true } : {}),
      }, width))
      return options.timestamps === false ? lines : stamped(lines, entry.at, width)
    }
    case 'assistant': {
      // The answer is Markdown, so it is rendered rather than printed: headings,
      // lists, tables, and code keep their shape, and a link or path stays
      // clickable. The answer as a whole is the conclusion of the turn, so it
      // carries its own color. The newest answer is never condensed — that is the
      // text the user came to read — while older ones fold like any long block.
      const rendered = renderMarkdown(entry.text, {
        width: Math.max(8, width - INDENT.length),
        ...(options.hyperlinks === true ? { hyperlinks: true } : {}),
        textToken: 'Answer',
      })
      const styled = rendered.map(line => fitLine({
        spans: [{ text: INDENT, token: 'Muted' }, ...line.spans],
      }, width))
      const marked = options.timestamps === false ? styled : stamped(styled, entry.at, width)
      return options.lastAnswerId === entry.id ? marked : condense(marked, entry, width)
    }
    case 'stage': {
      // The work row is the last line of the transcript while a turn runs: a mark,
      // what the agent is doing, how long it has been at it, how many tokens it has
      // spent, and the key that stops it. It is replaced by the answer itself.
      const live = entry.status === 'running'
      const glyph = live ? (options.runningGlyph ?? '♦') : '♦'
      const prefix: Span[] = [
        { text: INDENT, token: 'Muted' },
        { text: glyph, token: live ? 'Shimmer' : 'Success', bold: true },
        { text: ' ', token: 'Muted' },
        { text: entry.verb ?? 'Работаю', token: 'Text' },
        { text: '  ', token: 'Muted' },
      ]
      const suffix: Span[] = []
      if (entry.meta !== undefined && entry.meta !== '') suffix.push({ text: entry.meta, token: 'Muted' })
      if (entry.durationMs !== undefined) {
        suffix.push({ text: `  ${elapsedLabel(entry.durationMs)}`, token: 'Muted' })
      }
      if (entry.tokens !== undefined && entry.tokens > 0) {
        suffix.push({ text: `  ↓${formatTokens(entry.tokens)}`, token: 'Muted' })
      }
      if (live) suffix.push({ text: '  [Ctrl+C]', token: 'Subtle', dim: true })
      return compose(prefix, entry.text, 'Muted', width, { suffix })
    }
    case 'thought': {
      // The reasoning itself stays hidden: what the reader needs is that the model
      // spent time thinking before it answered, and how much.
      return [fitLine({
        spans: [
          { text: INDENT, token: 'Muted' },
          { text: '♦', token: 'ActionThink' },
          { text: ' Думал', token: 'Muted' },
          { text: ` ${entry.durationMs === undefined ? '…' : elapsedLabel(entry.durationMs)}`, token: 'Muted', dim: true },
        ],
      }, width)]
    }
    case 'tool': {
      const action = actionMark(entry, options)
      const prefix: Span[] = [
        { text: TOOL_INDENT, token: 'Muted' },
        { text: action.glyph, token: action.token },
        { text: '  ', token: 'Muted' },
        { text: entry.title ?? entry.text, token: 'Text' },
      ]
      const suffix: Span[] = []
      if (entry.added !== undefined || entry.removed !== undefined) {
        // Added and removed lines are two facts, so they carry two colors: a
        // glance at the line says whether a change grew or shrank the file.
        suffix.push({ text: `   +${String(entry.added ?? 0)}`, token: 'DiffAdd' })
        suffix.push({ text: ` −${String(entry.removed ?? 0)}`, token: 'DiffRemove' })
      }
      if (entry.durationMs !== undefined) {
        suffix.push({ text: `   ${entry.durationMs < 1000 ? `${String(Math.round(entry.durationMs))}ms` : `${(entry.durationMs / 1000).toFixed(1)}s`}`, token: 'Muted', dim: true })
      }
      if (entry.meta !== undefined && entry.meta !== '') suffix.push({ text: `   ${entry.meta}`, token: 'Muted', dim: true })
      const detail = entry.detail ?? []
      // What the tool sent and received is the second layer: the first line says
      // what the agent is doing, and this row says how much detail is behind it.
      const hasDetail = (entry.input ?? '').trim() !== ''
        || (entry.output ?? '').trim() !== ''
        || (entry.diff ?? []).length > 0
        || detail.length > 0
      if (hasDetail && entry.expanded !== true) {
        const hidden = [entry.input === undefined ? undefined : 'аргументы', entry.output === undefined ? undefined : 'вывод', (entry.diff ?? []).length === 0 ? undefined : 'diff']
          .filter((part): part is string => part !== undefined)
        suffix.push({ text: `   ▸ ${hidden.join(' · ')}`, token: 'Accent' })
      }
      // The title is shortened to the columns that are actually left, not to a fixed
      // budget: a wide terminal shows the whole command, a narrow one keeps the file
      // name it ends with, and the suffix stays visible either way.
      const fixed = TOOL_INDENT.length + displayWidth(action.glyph) + 2
      const suffixWidth = suffix.reduce((total, span) => total + displayWidth(span.text), 0)
      const title = clipPath(entry.title ?? entry.text, Math.max(8, width - fixed - suffixWidth))
      prefix[3] = { text: title, token: 'Text' }
      const lines = compose(prefix, undefined, 'Text', width, { suffix })
      if (hasDetail && entry.expanded !== true) {
        return lines.map(line => fitLine({ ...line, entryId: entry.id, collapsed: true }, width))
      }
      for (const line of detail) {
        for (const wrapped of wrapText(line, Math.max(1, width - DETAIL_INDENT.length - 4))) {
          lines.push({
            spans: [
              { text: DETAIL_INDENT, token: 'Muted' },
              { text: '⎿  ', token: 'Subtle' },
              { text: wrapped, token: 'Muted' },
            ],
          })
        }
      }
      if ((entry.input ?? '').trim() !== '') {
        lines.push(...block('IN ', (entry.input ?? '').split('\n'), width, 'Text'))
      }
      if ((entry.diff ?? []).length > 0) {
        lines.push(...block(undefined, entry.diff ?? [], width, 'Muted', true))
      }
      if ((entry.output ?? '').trim() !== '') {
        lines.push(...block('OUT', (entry.output ?? '').split('\n'), width, 'Muted'))
      }
      return condense(lines, entry, width)
    }
    case 'agent': {
      // Who is working: the model, its role, and the name it was delegated under.
      // A subagent heading opens a branch that its own tool rows sit inside.
      const badge = entry.agent
      const token = badge?.token ?? 'Accent'
      const done = badge?.state === 'done'
      if (badge !== undefined && badge.depth > 0) {
        // A delegation is drawn as a box: its title carries who is working, its
        // role, and its state, and the rows of that agent run between the walls.
        const lead = BRANCH_INDENT.repeat(Math.min(Math.max(0, badge.depth - 1), MAX_BRANCH_DEPTH))
        const tail: Span = { text: done ? '┘' : '┐', token: 'Subtle' }
        const state: Span[] = [
          { text: `${done ? '✔ DONE' : '◐ WORKING'} `, token: done ? 'Success' : 'ActionDelegate' },
        ]
        const head: Span[] = [{ text: `${lead}  ${done ? '└─ ✔️' : '┌─ ◐'}`, token: done ? 'Success' : 'ActionDelegate' }]
        // The name, the model, and the role are fitted into what the frame has
        // left, so the row keeps its corners on a narrow terminal instead of being
        // cut by the region.
        const chrome = lead.length + 3 + state.reduce((total, span) => total + displayWidth(span.text), 0) + displayWidth(tail.text) + 3
        let room = Math.max(8, width - chrome)
        const label = takeHeadWidth(badge.label, Math.max(6, Math.min(room, 32)))
        head.push({ text: `  ${label}`, token, bold: true })
        room -= displayWidth(label) + 2
        // The closing row repeats only the name: the model and the role were read
        // on the row that opened the box, a few lines above.
        if (!done && badge.model !== undefined && badge.model !== '' && displayWidth(badge.model) + 3 <= room) {
          head.push({ text: '   ', token: 'Muted' }, { text: badge.model, token: 'Subtle', dim: true })
          room -= displayWidth(badge.model) + 3
        }
        if (!done && badge.role !== undefined && badge.role !== '' && displayWidth(badge.role) + 3 <= room) {
          head.push({ text: '   ', token: 'Muted' }, { text: badge.role, token: 'RoleBadge' })
        }
        const lines: StyledLine[] = [fitLine({ spans: boxRow(head, state, tail, width) }, width)]
        if (entry.text.trim() !== '') {
          for (const wrapped of wrapText(entry.text, Math.max(1, width - lead.length - 8))) {
            lines.push(fitLine({
              spans: [
                { text: `${lead}  │  `, token: 'Subtle' },
                { text: wrapped, token: 'Text' },
                { text: `${' '.repeat(Math.max(0, width - lead.length - 8 - displayWidth(wrapped)))}  │`, token: 'Subtle' },
              ],
            }, width))
          }
        }
        return done
          ? lines.map(line => ({ ...line, entryId: entry.id, collapsed: true }))
          : lines
      }
      const glyph = done ? '✔️' : '◆'
      const branch = INDENT
      const spans: Span[] = [
        { text: branch, token: 'Subtle' },
        { text: glyph, token: done ? 'Success' : token, bold: true },
        { text: '  ', token: 'Muted' },
        { text: badge?.label ?? 'agent', token, bold: true },
      ]
      if (badge?.model !== undefined && badge.model !== '') {
        spans.push({ text: '   ', token: 'Muted' }, { text: badge.model, token: 'Subtle', dim: true })
      }
      if (badge?.role !== undefined && badge.role !== '') {
        spans.push({ text: '   ', token: 'Muted' }, { text: badge.role, token: 'RoleBadge', bold: true })
      }
      const lines: StyledLine[] = [fitLine({ spans }, width)]
      if (entry.text.trim() !== '') {
        const room = Math.max(1, width - branch.length - (badge?.label.length ?? 5) - 6)
        for (const wrapped of wrapText(entry.text, room)) {
          lines.push(fitLine({
            spans: [
              { text: `${branch}   `, token: 'Subtle' },
              { text: wrapped, token: 'Text' },
            ],
          }, width))
        }
      }
      return condense(lines, entry, width)
    }
    case 'info':
      // A confirmation, not a problem: it reads as a quiet note and disappears
      // on its own, so a copy or a model switch never looks like a warning.
      return compose(
        [{ text: INDENT, token: 'Muted' }, { text: '·', token: 'Accent' }, { text: '  ', token: 'Muted' }],
        entry.text,
        'Muted',
        width,
        {},
      )
    case 'notice':
    case 'warn': {
      const lines = compose(
        [{ text: INDENT, token: 'Muted' }, { text: '⚠', token: 'Warn' }, { text: '  ', token: 'Muted' }],
        entry.text,
        'Warn',
        width,
        {},
      )
      // A notice may carry a list — the key help most of all — and it is drawn as
      // the same continuation block a tool entry uses.
      for (const row of entry.detail ?? []) {
        for (const wrapped of wrapText(row, Math.max(1, width - DETAIL_INDENT.length - 4))) {
          lines.push({
            spans: [
              { text: DETAIL_INDENT, token: 'Muted' },
              { text: '⎿  ', token: 'Subtle' },
              { text: wrapped, token: 'Muted' },
            ],
          })
        }
      }
      return lines
    }
    case 'error':
      return compose(
        [{ text: INDENT, token: 'Muted' }, { text: '✗', token: 'Error' }, { text: '  ', token: 'Muted' }],
        entry.text,
        'Error',
        width,
        {},
      )
    case 'plan': {
      const lines: StyledLine[] = [fitLine({ spans: [{ text: `${INDENT}Planning`, token: 'Warn', bold: true }], heading: true, anchor: 'Planning' }, width)]
      let number = 1
      for (const item of entry.text.split('\n')) {
        lines.push(fitLine({ spans: [{ text: `    ${String(number)}. ${item}`, token: 'Text' }], anchor: 'Planning' }, width))
        number += 1
      }
      if (entry.keys !== undefined && entry.keys !== '') {
        lines.push(fitLine({ spans: [{ text: `    ${entry.keys}`, token: 'Muted', dim: true }] }, width))
      }
      return lines
    }
    case 'diff': {
      const lines: StyledLine[] = []
      for (const raw of entry.text.split('\n')) {
        const token: TokenName = raw.startsWith('+') ? 'Success' : raw.startsWith('-') ? 'Error' : 'Text'
        for (const line of wrapText(raw, Math.max(1, width - TOOL_INDENT.length))) {
          lines.push(fitLine({ spans: [{ text: `${TOOL_INDENT}${line}`, token }] }, width))
        }
      }
      return lines
    }
    case 'footer': {
      const meta = entry.meta ?? ''
      const spans: Span[] = [
        { text: INDENT, token: 'Muted' },
        { text: '✔️', token: 'Success' },
        { text: '  ', token: 'Muted' },
        { text: entry.text, token: 'Text' },
      ]
      for (const part of meta.split('\u0000')) {
        if (part === '') continue
        spans.push({ text: ' · ', token: 'Subtle' })
        spans.push({ text: part, token: part.startsWith('+') ? 'Success' : part.startsWith('-') ? 'Error' : 'Muted' })
      }
      return [fitLine({ spans }, width)]
    }
    case 'rule':
      return [{ spans: [] }]
    default:
      return []
  }
}

/**
 * Rendered lines of one entry, keyed by everything that can change them.
 *
 * A long session repaints its frame while events stream in, and re-parsing the
 * Markdown of every entry on every frame is what made scrolling and selection lag.
 * The key carries the entry's revision, so a patched tool call or a growing answer
 * is re-rendered while everything else is reused as-is.
 */
interface EntryCache {
  /** Lines rendered for the newest revision seen. */
  readonly lines: readonly StyledLine[]
  /** Cache key: width, revision, and the tick for entries that animate. */
  readonly key: string
}

const ENTRY_CACHE = new Map<number, EntryCache>()
/**
 * How many rendered entries stay cached.
 *
 * A session that outgrows the cache re-renders its oldest entries on every frame
 * that changes anything, which is exactly the streaming case, so the bound has to
 * sit well above a long session's entry count. One entry's lines cost a few
 * hundred bytes, so the ceiling stays in the low tens of megabytes.
 */
const ENTRY_CACHE_LIMIT = 20000

/** Evict the oldest rendered entries once the cache grows past its bound. */
function trimEntryCache(): void {
  if (ENTRY_CACHE.size <= ENTRY_CACHE_LIMIT) return
  let excess = ENTRY_CACHE.size - ENTRY_CACHE_LIMIT
  // Map iterates in insertion order, and a re-rendered entry keeps its original
  // position, so the head is the oldest rendering in the cache.
  for (const id of ENTRY_CACHE.keys()) {
    if (excess <= 0) break
    ENTRY_CACHE.delete(id)
    excess -= 1
  }
}

/** Render one entry through the cache. */
function renderEntryCached(entry: LogEntry, width: number, options: RenderOptions): readonly StyledLine[] {
  // Only a running entry animates, so only it has to re-render on every tick.
  const animates = entry.status === 'running' || entry.kind === 'stage'
  const tick = animates ? (options.tick ?? 0) : 0
  // A subagent's rows are indented under its branch, so the indent is part of what
  // the entry renders to and therefore part of its cache key.
  const depth = entry.kind === 'agent' ? 0 : entry.agent?.depth ?? 0
  // A box needs room for both walls and something to say between them; a narrower
  // region falls back to the plain indent rather than drawing past the frame.
  const wall = depth > 0 && entry.agent !== undefined && width >= WALL_WIDTH + 12
  // The walls replace the branch indent inside a box; a deeper tree keeps its own
  // indent to the left of them.
  const lead = depth > 1 ? BRANCH_INDENT.repeat(Math.min(depth - 1, MAX_BRANCH_DEPTH)) : ''
  const answerRole = entry.id === options.lastAnswerId ? 'last' : 'past'
  const stamps = options.timestamps === false ? 'plain' : 'time'
  const key = `${String(width)}|${String(entry.revision ?? 0)}|${String(tick)}|${entry.expanded === true ? 'x' : 'c'}|${options.hyperlinks === true ? 'h' : 'p'}|d${String(depth)}|${wall ? 'w' : 'n'}|${answerRole}|${stamps}`
  const cached = ENTRY_CACHE.get(entry.id)
  if (cached !== undefined && cached.key === key) return cached.lines
  // A row inside a delegation sits between the walls of its box; the walls take
  // their columns from the row's budget so nothing is drawn past the frame.
  const inside = Math.max(1, width - lead.length - (wall ? WALL_WIDTH : 0))
  const inner = renderEntry(entry, inside, options)
  const lines = (lead === '' && !wall
    ? inner
    : inner.map(line => {
      const spans: Span[] = [{ text: lead, token: 'Subtle' as TokenName }]
      if (wall) spans.push({ text: '  │  ', token: 'Subtle' })
      spans.push(...line.spans)
      if (!wall) return { ...line, spans }
      const used = spans.reduce((total, span) => total + displayWidth(span.text), 0)
      return {
        ...line,
        spans: [...spans, { text: `${' '.repeat(Math.max(0, width - used - 3))}  │`, token: 'Subtle' as TokenName }],
      }
    // Every row states the entry it came from. The view uses that to mark the entry
    // the reader chose, which keeps the mark out of the rendered transcript and out
    // of its cache: moving the selection repaints a frame, not the whole log.
    })).map(line => (line.entryId === undefined ? { ...line, entryId: entry.id } : line))
  ENTRY_CACHE.set(entry.id, { lines, key })
  trimEntryCache()
  return lines
}

/**
 * Render the transcript into styled lines.
 *
 * A blank line separates entries of different kinds, so the transcript reads as
 * blocks rather than as one stream.
 * @param entries - the transcript entries, in display order.
 * @param width - the region width the lines must fit.
 * @param options - animation tick and timestamp settings.
 * @returns one styled line per row of the transcript.
 */
export function renderEntries(
  entries: readonly LogEntry[],
  width: number,
  options: RenderOptions = {},
): readonly StyledLine[] {
  const transcript = renderTranscript(entries, width, options)
  const lines: StyledLine[] = []
  for (const part of transcript.parts) {
    for (const line of part) lines.push(line)
  }
  return lines
}

/**
 * The rendered transcript, kept as its parts.
 *
 * Repainting a frame used to concatenate every row of the log; on a session of
 * a few thousand entries that cost hundreds of milliseconds per frame, so
 * scrolling, selection, and streaming all lagged. The parts let a frame take
 * only the rows its viewport shows, while a part whose entry did not change is
 * reused as it is.
 *
 * The storage is reused by the next render of the same model: hold the rows you
 * need, not the transcript.
 */
export interface Transcript {
  /** Rendered parts in display order, each from one entry or one separator. */
  readonly parts: readonly (readonly StyledLine[])[]
  /** Row of each part's first line, ascending and one longer than `parts`. */
  readonly tops: readonly number[]
  /** Rows in the whole transcript. */
  readonly total: number
  /**
   * Row where each entry's own lines begin.
   *
   * A reader moves through the transcript entry by entry, and the surface scrolls
   * to the chosen one without walking the log again. An entry a folded branch
   * hides has no row and is absent.
   */
  readonly entryTops: ReadonlyMap<number, number>
}

/** The line that separates two entries of different kinds. */
const SEPARATOR: readonly StyledLine[] = [{ spans: [] }]

/** Reusable transcript storage: a repaint overwrites the parts it keeps. */
interface TranscriptState {
  readonly parts: (readonly StyledLine[])[]
  readonly tops: number[]
  readonly entryTops: Map<number, number>
  total: number
}

/** The transcript the last paint produced, and the inputs it was built from. */
let transcriptCache: {
  readonly entries: readonly LogEntry[]
  readonly width: number
  readonly version: number | undefined
  readonly hyperlinks: boolean
  readonly tick: number
  readonly leading: readonly StyledLine[] | undefined
  readonly lastAnswerId: number | undefined
  readonly state: TranscriptState
} | undefined

/** Whether any entry animates, so only then does a frame depend on the tick. */
function animates(entries: readonly LogEntry[]): boolean {
  for (const entry of entries) {
    if (entry.status === 'running' || entry.kind === 'stage') return true
  }
  return false
}

/**
 * Render the transcript and cache it against the inputs that can change it.
 *
 * @param entries - the transcript entries, in display order.
 * @param width - the region width the lines must fit.
 * @param options - animation tick, hyperlink, and model-version settings.
 * @returns the transcript parts and their row offsets.
 */
export function renderTranscript(
  entries: readonly LogEntry[],
  width: number,
  options: RenderOptions = {},
): Transcript {
  const tick = animates(entries) ? (options.tick ?? 0) : 0
  const hyperlinks = options.hyperlinks === true
  // A message's time is fixed when it enters the transcript, so a rendered
  // transcript answers for any moment: the cache holds regardless of the clock.
  const cacheable = true
  const cached = transcriptCache
  if (cacheable
    && cached !== undefined
    && cached.entries === entries
    && cached.width === width
    && cached.version !== undefined
    && cached.version === options.version
    && cached.hyperlinks === hyperlinks
    && cached.tick === tick
    && cached.leading === options.leading
    && cached.lastAnswerId === options.lastAnswerId) {
    return cached.state
  }
  const state: TranscriptState = cached?.state ?? { parts: [], tops: [], entryTops: new Map(), total: 0 }
  // A different entry list means a different transcript model — `/new`, a fork, or
  // a test's second log — and entry identities restart from one there, so the
  // per-entry cache would answer with lines another log rendered.
  if (cached !== undefined && cached.entries !== entries) ENTRY_CACHE.clear()
  const parts = state.parts as (readonly StyledLine[])[]
  const tops = state.tops
  const entryTops = state.entryTops
  parts.length = 0
  tops.length = 0
  entryTops.clear()
  let top = 0
  const push = (lines: readonly StyledLine[]): void => {
    if (lines.length === 0) return
    tops.push(top)
    parts.push(lines)
    top += lines.length
  }
  const leading = options.leading
  if (leading !== undefined) push(leading)
  const last = lastAnswer(entries)
  const live = new Set<number>()
  let lastLine: StyledLine | undefined
  const perEntry: RenderOptions = { ...options, ...(last === undefined ? {} : { lastAnswerId: last }) }
  // A delegation that finished folds to its frame plus one row that says how much
  // is behind it: the transcript then reads as a plan, and the detail of a branch
  // is one click away. A branch still running stays open — that is the live view.
  const folded = new Map<string, number>()
  const branchKey = (badge: AgentBadge): string => badge.sessionId ?? `${badge.label}|${String(badge.depth)}`
  for (const entry of entries) {
    const badge = entry.agent
    if (entry.kind !== 'agent' || badge === undefined || badge.depth === 0) continue
    if (badge.state !== 'done' || entry.expanded === true) continue
    folded.set(branchKey(badge), entry.id)
  }
  const hidden = new Map<string, number>()
  for (const entry of entries) {
    const badge = entry.agent
    if (badge === undefined || !folded.has(branchKey(badge)) || entry.kind === 'agent') continue
    hidden.set(branchKey(badge), (hidden.get(branchKey(badge)) ?? 0) + 1)
  }
  for (const entry of entries) {
    live.add(entry.id)
    const badge = entry.agent
    const key = badge === undefined ? undefined : branchKey(badge)
    const inFolded = key !== undefined && folded.has(key)
    if (inFolded && key !== undefined && entry.kind !== 'agent') continue
    // The count of a folded branch belongs inside its box, so it is written before
    // the row that closes the branch.
    if (inFolded && key !== undefined && entry.kind === 'agent' && entry.agent?.state === 'done') {
      const count = hidden.get(key) ?? 0
      const target = folded.get(key)
      if (count > 0 && target !== undefined) {
        const marker = fitLine({
          spans: [
            { text: '  │  ', token: 'Subtle' },
            { text: `⋯ ${String(count)} ${count === 1 ? 'шаг' : 'шагов'} этой ветки — Enter, чтобы развернуть`, token: 'ActionDelegate' },
          ],
          entryId: target,
          collapsed: true,
        }, width)
        push([marker])
        lastLine = marker
      }
    }
    const separated = entry.kind === 'user' || entry.kind === 'assistant' || entry.kind === 'stage'
      || entry.kind === 'plan' || entry.kind === 'thought'
    if (separated && lastLine !== undefined && plainText(lastLine).trim() !== '') push(SEPARATOR)
    const lines = renderEntryCached(entry, width, perEntry)
    // The row is recorded before the lines are pushed: a reader who moves to this
    // entry scrolls to where its own text starts, not to the blank row above it.
    entryTops.set(entry.id, top)
    push(lines)
    lastLine = lines[lines.length - 1] ?? lastLine
  }
  tops.push(top)
  state.total = top
  // Dropped entries must not keep their lines alive: the cache is keyed by id, and
  // a cleared transcript reuses ids after a fork or a `/new`.
  if (ENTRY_CACHE.size > live.size) {
    for (const id of [...ENTRY_CACHE.keys()]) if (!live.has(id)) ENTRY_CACHE.delete(id)
  }
  transcriptCache = { entries, width, version: options.version, hyperlinks, tick, leading, lastAnswerId: options.lastAnswerId, state }
  return state
}

/**
 * Take the rows one viewport shows.
 * @param transcript - the rendered transcript.
 * @param height - viewport height; a non-positive height yields no lines.
 * @param offset - rows hidden above the viewport.
 * @returns the visible lines, top to bottom.
 */
export function transcriptWindow(transcript: Transcript, height: number, offset: number): readonly StyledLine[] {
  if (height <= 0) return []
  const start = clampScroll(offset, transcript.total, height)
  const end = Math.min(transcript.total, start + height)
  const { parts, tops } = transcript
  let low = 0
  let high = parts.length - 1
  let found = -1
  while (low <= high) {
    const middle = (low + high) >> 1
    const top = tops[middle] ?? 0
    const bottom = (tops[middle + 1] ?? transcript.total)
    if (bottom <= start) low = middle + 1
    else if (top > start) high = middle - 1
    else {
      found = middle
      break
    }
  }
  const lines: StyledLine[] = []
  for (let index = found === -1 ? low : found; index < parts.length && lines.length < end - start; index += 1) {
    const part = parts[index] as readonly StyledLine[]
    const from = Math.max(0, start - (tops[index] ?? 0))
    for (let row = from; row < part.length && lines.length < end - start; row += 1) {
      lines.push(part[row] as StyledLine)
    }
  }
  return lines
}

/**
 * Clamp a scroll offset to the transcript.
 * @param offset - requested offset; rows hidden above the viewport.
 * @param total - total rendered lines.
 * @param height - viewport height.
 * @returns the offset in `[0, max(0, total - height)]`.
 */
export function clampScroll(offset: number, total: number, height: number): number {
  return Math.max(0, Math.min(Math.max(0, total - height), Math.floor(offset)))
}

/**
 * Slice the viewport out of the rendered transcript.
 * @param lines - every rendered line.
 * @param height - viewport height; a non-positive height yields no lines.
 * @param offset - rows hidden above the viewport.
 * @returns the visible lines, top to bottom.
 */
export function visibleLines(lines: readonly StyledLine[], height: number, offset: number): readonly StyledLine[] {
  if (height <= 0) return []
  const start = clampScroll(offset, lines.length, height)
  return lines.slice(start, start + height)
}

/**
 * Count the lines hidden around the viewport.
 * @param total - total rendered lines.
 * @param height - viewport height.
 * @param offset - rows hidden above the viewport.
 * @returns how many lines are hidden above and below.
 */
export function scrollIndicator(
  total: number,
  height: number,
  offset: number,
): { readonly above: number; readonly below: number } {
  const clamped = clampScroll(offset, total, height)
  return { above: clamped, below: Math.max(0, total - height - clamped) }
}
