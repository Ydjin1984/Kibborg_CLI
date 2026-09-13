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
import { displayWidth, takeHeadWidth, wrapText } from './width.ts'
export { wrapText }
import { renderMarkdown } from './markdown.ts'

/** What one entry of the transcript represents. */
export type LogKind =
  | 'user'
  | 'assistant'
  | 'stage'
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
  /** Whether entry headings carry a relative timestamp. */
  readonly timestamps?: boolean
  /** Current time for relative timestamps. */
  readonly now?: number
  /** Glyph for a running tool or stage; the spinner frame when omitted. */
  readonly runningGlyph?: string
  /** Relative age of an entry heading, in the format `14m`. */
  readonly ageOf?: (entry: LogEntry, now: number) => string | undefined
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
}

/** Indentation of transcript body text. */
const INDENT = '  '

/** Indentation of a tool row. */
const TOOL_INDENT = '    '

/** Indentation of a `⎿` continuation row. */
const DETAIL_INDENT = '       '

/** Indentation of a row inside a subagent's branch. */
const BRANCH_INDENT = '  │  '

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
      entries.push({ ...entry, id, revision: 1 })
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
      out.push({
        spans: [
          { text: printed === 0 && label !== undefined ? `${BLOCK_INDENT}${label} ` : BLOCK_INDENT, token: 'Subtle' },
          { text: wrapped, token: lineToken },
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
  body: string,
  bodyToken: TokenName,
  width: number,
  extra: { readonly anchor?: string; readonly heading?: boolean; readonly suffix?: readonly Span[] },
): StyledLine[] {
  const prefixWidth = prefix.reduce((total, span) => total + displayWidth(span.text), 0)
  const suffixWidth = (extra.suffix ?? []).reduce((total, span) => total + displayWidth(span.text), 0)
  const budget = Math.max(1, width - prefixWidth - suffixWidth)
  const bodyLines = wrapText(body, budget)
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

/** Tool glyph and its color for one lifecycle state. */
function toolMark(
  status: ToolStatus | undefined,
  options: RenderOptions,
): { readonly glyph: string; readonly token: TokenName } {
  if (status === 'ok') return { glyph: '✓', token: 'Success' }
  if (status === 'fail') return { glyph: '✗', token: 'Error' }
  return { glyph: options.runningGlyph ?? '⚙', token: 'Accent' }
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
        text: `⋯ ещё ${String(hidden)} ${hidden === 1 ? 'строка' : hidden < 5 ? 'строки' : 'строк'} — клик, чтобы развернуть`,
        token: 'Accent',
      },
    ],
    entryId: entry.id,
    collapsed: true,
  }
  return [...kept, marker].map(line => fitLine({ ...line, entryId: entry.id }, width))
}

/** Render one entry into lines. */
function renderEntry(entry: LogEntry, width: number, options: RenderOptions, now: number): StyledLine[] {
  switch (entry.kind) {
    case 'user': {
      const stamp = options.timestamps === true ? options.ageOf?.(entry, now) : undefined
      const heading: Span[] = [{ text: `${INDENT}You`, token: 'Muted' }]
      if (stamp !== undefined) heading.push({ text: `   ${stamp}`, token: 'Subtle', dim: true })
      const lines: StyledLine[] = [fitLine({ spans: heading, anchor: 'You', heading: true }, width)]
      for (const line of wrapText(entry.text, Math.max(1, width - INDENT.length))) {
        lines.push(fitLine({ spans: [{ text: `${INDENT}${line}`, token: 'Text' }], anchor: 'You' }, width))
      }
      return lines
    }
    case 'assistant': {
      // The answer is Markdown, so it is rendered rather than printed: headings,
      // lists, tables, and code keep their shape, and a link or path stays
      // clickable. The answer as a whole is the conclusion of the turn, so it
      // carries its own color and its opening line is bold.
      const rendered = renderMarkdown(entry.text, {
        width: Math.max(8, width - INDENT.length),
        ...(options.hyperlinks === true ? { hyperlinks: true } : {}),
        textToken: 'Answer',
      })
      const first = rendered.findIndex(line => line.spans.some(span => span.text.trim() !== ''))
      const styled = rendered.map((line, index) => fitLine({
        spans: [
          { text: INDENT, token: 'Muted' },
          ...line.spans.map(span => (index === first ? { ...span, bold: true } : span)),
        ],
      }, width))
      return condense(styled, entry, width)
    }
    case 'stage': {
      const glyph = options.runningGlyph ?? '✳'
      const prefix: Span[] = [
        { text: INDENT, token: 'Muted' },
        { text: glyph, token: 'Shimmer', bold: true },
        { text: '  ', token: 'Muted' },
        { text: `${entry.verb ?? 'Working'}…`, token: 'Text' },
        { text: '  ', token: 'Muted' },
      ]
      const suffix: Span[] = []
      if (entry.meta !== undefined && entry.meta !== '') suffix.push({ text: entry.meta, token: 'Muted' })
      if (entry.durationMs !== undefined) {
        suffix.push({ text: `   ${(entry.durationMs / 1000).toFixed(1)}s`, token: 'Muted' })
      }
      return compose(prefix, entry.text, 'Muted', width, { suffix })
    }
    case 'tool': {
      const mark = toolMark(entry.status, options)
      const shell = entry.name === 'bash' || entry.name === 'shell'
      const prefix: Span[] = [
        { text: TOOL_INDENT, token: 'Muted' },
        { text: mark.glyph, token: mark.token },
        { text: '  ', token: 'Muted' },
        { text: entry.name ?? 'tool', token: shell ? 'BashPink' : 'Muted' },
        { text: '   ', token: 'Muted' },
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
      const lines = compose(prefix, entry.text, 'Text', width, { suffix })
      // Everything a tool sent and received is shown, wrapped rather than cut:
      // a user has to be able to read the command and its answer, and a change
      // has to be visible line by line. Only an extreme block is elided, and
      // never silently.
      const detail = entry.detail ?? []
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
      if (entry.input !== undefined && entry.input.trim() !== '') {
        lines.push(...block('IN ', entry.input.split('\n'), width, 'Text'))
      }
      if (entry.diff !== undefined && entry.diff.length > 0) {
        lines.push(...block(undefined, entry.diff, width, 'Muted', true))
      }
      if (entry.output !== undefined && entry.output.trim() !== '') {
        lines.push(...block('OUT', entry.output.split('\n'), width, 'Muted'))
      }
      return condense(lines, entry, width)
    }
    case 'agent': {
      // Who is working: the model, its role, and the name it was delegated under.
      // A subagent heading opens a branch that its own tool rows sit inside.
      const badge = entry.agent
      const token = badge?.token ?? 'Accent'
      const done = badge?.state === 'done'
      const glyph = done ? '✓' : badge === undefined || badge.depth === 0 ? '◆' : '◇'
      const branch = badge === undefined || badge.depth === 0 ? INDENT : `  ${done ? '└─' : '├─'} `
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
        spans.push({ text: '   ', token: 'Muted' }, { text: badge.role, token: 'Muted', bold: true })
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
    case 'warn':
      return compose(
        [{ text: INDENT, token: 'Muted' }, { text: '⚠', token: 'Warn' }, { text: '  ', token: 'Muted' }],
        entry.text,
        'Warn',
        width,
        {},
      )
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
        { text: '✓', token: 'Success' },
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
function renderEntryCached(entry: LogEntry, width: number, options: RenderOptions, now: number): readonly StyledLine[] {
  // Only a running entry animates, so only it has to re-render on every tick.
  const animates = entry.status === 'running' || entry.kind === 'stage'
  const tick = animates ? (options.tick ?? 0) : 0
  // A subagent's rows are indented under its branch, so the indent is part of what
  // the entry renders to and therefore part of its cache key.
  const depth = entry.kind === 'agent' ? 0 : entry.agent?.depth ?? 0
  const branch = depth > 0 ? BRANCH_INDENT.repeat(Math.min(depth, MAX_BRANCH_DEPTH)) : ''
  const key = `${String(width)}|${String(entry.revision ?? 0)}|${String(tick)}|${entry.expanded === true ? 'x' : 'c'}|${options.hyperlinks === true ? 'h' : 'p'}|d${String(depth)}`
  const cached = ENTRY_CACHE.get(entry.id)
  if (cached !== undefined && cached.key === key) return cached.lines
  const inner = renderEntry(entry, Math.max(8, width - branch.length), options, now)
  const lines = branch === ''
    ? inner
    : inner.map(line => ({ ...line, spans: [{ text: branch, token: 'Subtle' as TokenName }, ...line.spans] }))
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
}

/** The line that separates two entries of different kinds. */
const SEPARATOR: readonly StyledLine[] = [{ spans: [] }]

/** Reusable transcript storage: a repaint overwrites the parts it keeps. */
interface TranscriptState {
  readonly parts: (readonly StyledLine[])[]
  readonly tops: number[]
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
  const now = options.now ?? Date.now()
  const tick = animates(entries) ? (options.tick ?? 0) : 0
  const hyperlinks = options.hyperlinks === true
  // Relative stamps are a function of the clock, not of the model, so a transcript
  // built for one `now` cannot answer for another: those renders are not cached.
  const cacheable = options.timestamps !== true && options.ageOf === undefined
  const cached = transcriptCache
  if (cacheable
    && cached !== undefined
    && cached.entries === entries
    && cached.width === width
    && cached.version !== undefined
    && cached.version === options.version
    && cached.hyperlinks === hyperlinks
    && cached.tick === tick
    && cached.leading === options.leading) {
    return cached.state
  }
  const state: TranscriptState = cached?.state ?? { parts: [], tops: [], total: 0 }
  // A different entry list means a different transcript model — `/new`, a fork, or
  // a test's second log — and entry identities restart from one there, so the
  // per-entry cache would answer with lines another log rendered.
  if (cached !== undefined && cached.entries !== entries) ENTRY_CACHE.clear()
  const parts = state.parts as (readonly StyledLine[])[]
  const tops = state.tops
  parts.length = 0
  tops.length = 0
  let top = 0
  const push = (lines: readonly StyledLine[]): void => {
    if (lines.length === 0) return
    tops.push(top)
    parts.push(lines)
    top += lines.length
  }
  const leading = options.leading
  if (leading !== undefined) push(leading)
  const live = new Set<number>()
  let lastLine: StyledLine | undefined
  for (const entry of entries) {
    live.add(entry.id)
    const separated = entry.kind === 'user' || entry.kind === 'assistant' || entry.kind === 'stage' || entry.kind === 'plan'
    if (separated && lastLine !== undefined && plainText(lastLine).trim() !== '') push(SEPARATOR)
    const lines = renderEntryCached(entry, width, options, now)
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
  transcriptCache = { entries, width, version: options.version, hyperlinks, tick, leading, state }
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
