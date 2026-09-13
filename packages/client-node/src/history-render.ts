/**
 * Replay of a stored session log onto the terminal surface.
 *
 * Resume prints facts that already happened: the same indent, tool rows, and
 * turn footer as a live turn (`UI.md` §4.3 / §4.10), without streaming or
 * reasoning (R10). The renderer writes only to the caller-supplied sink.
 * @module @kibborg/client-node/history-render
 */

import type { ContentBlock } from '@deepseek-ai/dsh-llm/types'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { turnFooter, type Palette } from '@kibborg/tui'

/** Two-column body indent shared with the live turn renderer. */
const BODY_INDENT = '  '

/** Argument keys shown on a tool row, in priority order. */
const ARGUMENT_KEYS = ['path', 'file', 'file_path', 'pattern', 'command', 'query'] as const

/** Per-turn measurements accumulated while walking the log. */
interface TurnAcc {
  /** `turn/start` wall time, when that event has been seen. */
  startTime?: number
  /** Sum of per-step token usage. */
  tokens: number
  /** Number of `tool/call` events in the turn. */
  tools: number
  /** Steps whose usage already contributed, so chunk and message do not double-count. */
  readonly counted: Set<number>
}

/** Accumulators keyed by the options object the caller walks the log with. */
const byOptions = new WeakMap<HistoryRenderOptions, Map<number, TurnAcc>>()

/** Options of {@link renderHistoryEntry} and {@link renderSessionHistory}. */
export interface HistoryRenderOptions {
  /** Active palette; the only source of color. */
  readonly palette: Palette
  /** Where painted text is written. */
  readonly sink: { write(chunk: string): void }
  /** Terminal width in columns; kept for parity with the live renderer. */
  readonly cols: number
}

/**
 * Print one history entry.
 * @param event - the session event to present.
 * @param options - palette, sink, and terminal width.
 * @returns nothing; output goes to {@link HistoryRenderOptions.sink}.
 */
export function renderHistoryEntry(event: SessionEvent, options: HistoryRenderOptions): void {
  const { palette, sink } = options
  const turns = turnsOf(options)

  if (event.type === 'turn/start') {
    const acc = turnAcc(turns, event.data.turn)
    if (acc.startTime === undefined) acc.startTime = event.time
    return
  }

  if (event.type === 'assistant/chunk') {
    const chunk = event.data.chunk
    if (chunk.type === 'usage') addUsage(turnAcc(turns, event.data.turn), event.data.step, chunk.usage.inputTokens, chunk.usage.outputTokens)
    return
  }

  if (event.type === 'user/message') {
    const text = visibleText(event.data.content)
    if (text === '') return
    // The task is the user's own line, with the time the log recorded for it.
    const clock = new Date(event.time)
    const stamp = `${String(clock.getHours()).padStart(2, '0')}:${String(clock.getMinutes()).padStart(2, '0')}`
    sink.write(`\n${BODY_INDENT}${palette.paint('>', 'Muted')} ${palette.paint(text, 'Text')}  ${palette.paint(stamp, 'Subtle')}\n`)
    return
  }

  if (event.type === 'assistant/message') {
    const usage = event.data.usage
    if (usage !== undefined) addUsage(turnAcc(turns, event.data.turn), event.data.step, usage.inputTokens, usage.outputTokens)
    const text = visibleText(event.data.message.content)
    if (text === '') return
    sink.write('\n')
    writeBody(sink, palette, text)
    return
  }

  if (event.type === 'tool/call') {
    const acc = turnAcc(turns, event.data.turn)
    acc.tools += 1
    const argument = summarizeArguments(event.data.arguments)
    const shown = argument === undefined ? '' : `   ${palette.paint(argument, 'Text')}`
    sink.write(`\n    ${palette.paint('⚙', 'Accent')}  ${palette.paint(event.data.name, 'Muted')}${shown}\n`)
    return
  }

  if (event.type === 'tool/result') {
    const error = event.data.error
    if (error === undefined) return
    sink.write(`    ${palette.paint('✗', 'Error')}  ${palette.paint('tool', 'Muted')}   ${palette.paint(error.name, 'Error')}\n`)
    return
  }

  if (event.type === 'turn/end') {
    const acc = turns.get(event.data.turn)
    const seconds = acc?.startTime === undefined ? undefined : (event.time - acc.startTime) / 1000
    const tools = acc === undefined || acc.tools === 0 ? undefined : acc.tools
    sink.write('\n')
    sink.write(`${turnFooter({
      tokens: acc?.tokens ?? 0,
      ...(seconds === undefined ? {} : { seconds }),
      ...(tools === undefined ? {} : { tools }),
    }, palette)}\n`)
  }
}

/**
 * Print a whole history (events already in seq order).
 * @param events - the session log, oldest first.
 * @param options - palette, sink, and terminal width.
 * @returns nothing; output goes to {@link HistoryRenderOptions.sink}.
 */
export function renderSessionHistory(events: readonly SessionEvent[], options: HistoryRenderOptions): void {
  byOptions.delete(options)
  for (const event of events) renderHistoryEntry(event, options)
}

/** Accumulators for one walk of the log. */
function turnsOf(options: HistoryRenderOptions): Map<number, TurnAcc> {
  const existing = byOptions.get(options)
  if (existing !== undefined) return existing
  const created = new Map<number, TurnAcc>()
  byOptions.set(options, created)
  return created
}

/**
 * Accumulators for one turn, created on first sight.
 * @param turns - the session's per-turn map.
 * @param turn - the turn id from `data.turn`.
 * @returns the mutable accumulator for that turn.
 */
function turnAcc(turns: Map<number, TurnAcc>, turn: number): TurnAcc {
  const existing = turns.get(turn)
  if (existing !== undefined) return existing
  const created: TurnAcc = { tokens: 0, tools: 0, counted: new Set() }
  turns.set(turn, created)
  return created
}

/**
 * Add one step's usage once.
 * @param acc - the turn being measured.
 * @param step - the step that reported usage.
 * @param inputTokens - uncached input tokens.
 * @param outputTokens - output tokens.
 */
function addUsage(acc: TurnAcc, step: number, inputTokens: number, outputTokens: number): void {
  if (acc.counted.has(step)) return
  acc.counted.add(step)
  acc.tokens += inputTokens + outputTokens
}

/**
 * Visible user/assistant text: `text` blocks only (R10).
 * @param blocks - the message content.
 * @returns the concatenated text, or empty when none is visible.
 */
export function visibleText(blocks: readonly ContentBlock[]): string {
  let text = ''
  for (const block of blocks) {
    if (block.type === 'text') text += block.text
  }
  return text
}

/**
 * Write body lines with the two-space indent, painted as `Text`.
 * @param sink - the output sink.
 * @param palette - the active palette.
 * @param text - the visible text, possibly multi-line.
 */
function writeBody(sink: HistoryRenderOptions['sink'], palette: Palette, text: string): void {
  const painted = text.split('\n').join(`\n${BODY_INDENT}`)
  sink.write(`${BODY_INDENT}${palette.paint(painted, 'Text')}\n`)
}

/**
 * Compact a tool-call argument: the first path-like field, else a short JSON prefix.
 * @param raw - the model's raw argument JSON string.
 * @returns at most 80 characters, or `undefined` when empty.
 */
function summarizeArguments(raw: string): string | undefined {
  const trimmed = raw.trim()
  if (trimmed === '') return undefined
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const record = parsed as Record<string, unknown>
      for (const key of ARGUMENT_KEYS) {
        const value = record[key]
        if (typeof value === 'string' && value !== '') return value.slice(0, 80)
      }
    }
  } catch {
    // Arguments are a model-produced string; invalid JSON is shown truncated.
    return trimmed.slice(0, 80)
  }
  return trimmed.slice(0, 80)
}
