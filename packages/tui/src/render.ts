/**
 * Turn rendering for the terminal surface.
 *
 * A turn is a stream of durable facts (user message, tool calls, tool results,
 * assistant text, notices) that the renderer writes into the scrollback. The
 * renderer owns presentation only: it counts tools, indents assistant text, and
 * prints the footer of a finished turn. It never receives reasoning chunks —
 * hidden reasoning is not a user-facing artifact (`PLAN.md` R10) — so no method
 * exists for one.
 * @module @kibborg/tui/render
 */

import type { AgentBadge } from './log.ts'
import type { FooterInput, StatusInput } from './status.ts'
import { statusLine, turnFooter } from './status.ts'
import type { Palette } from './tokens.ts'

/** Where the renderer writes; a test passes a buffer, production passes stdout. */
export interface RenderSink {
  /**
   * Write one chunk.
   * @param chunk - the text to append.
   */
  write(chunk: string): void
}

/** Construction options of a turn renderer. */
export interface TurnRendererOptions {
  /** Active palette. */
  readonly palette: Palette
  /** Output sink. */
  readonly sink: RenderSink
  /** Terminal width in columns; the status line adapts to it. */
  readonly cols: number
  /** Print the time a message was written beside it; on unless set to `false`. */
  readonly timestamps?: boolean
}

/** What a tool call carries besides its short label. */
export interface ToolCallDetail {
  /** What the call does in words, shown instead of the raw arguments. */
  readonly title?: string
  /** The argument JSON exactly as the model produced it. */
  readonly input?: string
  /** Lines of the change the call is about to make, `+`/`-` marked. */
  readonly diff?: readonly string[]
  /** Lines the change adds. */
  readonly added?: number
  /** Lines the change removes. */
  readonly removed?: number
}

/** What a finished tool call returned. */
export interface ToolResultDetail {
  /** The tool's own output, as the model saw it. */
  readonly output?: string
  /** Lines of the change that was applied. */
  readonly diff?: readonly string[]
  /** Lines the change added. */
  readonly added?: number
  /** Lines the change removed. */
  readonly removed?: number
}

/** The rendering surface of one turn. */
export interface TurnRenderer {
  /** Report the user's message. */
  user(text: string): void
  /**
   * Report a tool call that started.
   * @param name - the tool's name.
   * @param argument - the short label shown beside the name (path, command, query).
   * @param call - the call's own payload: the full argument JSON and, when the
   * tool edits a file, the diff it is about to apply.
   */
  toolCall(name: string, argument?: string, call?: ToolCallDetail): void
  /** Report a tool call that failed. */
  toolFailure(name: string, reason: string): void
  /**
   * Report a tool call that finished successfully.
   *
   * Optional: the scrollback renderer leaves a finished call as it printed it,
   * while the fullscreen transcript updates the entry it opened.
   * @param name - the tool's name.
   * @param durationMs - how long the call took, when measured.
   * @param result - what the tool returned: its output text and, for an edit,
   * the applied diff.
   */
  toolDone?(name: string, durationMs?: number, result?: ToolResultDetail): void
  /**
   * Report the files a turn changed.
   *
   * Optional: the fullscreen transcript shows them as one entry with details,
   * while the scrollback renderer prints each path.
   * @param paths - repository-relative paths the working tree gained.
   */
  changedFiles?(paths: readonly string[]): void
  /**
   * Announce which agent is working, and what it is doing.
   *
   * Optional: the transcript shows a heading per agent with its model and role
   * and indents that agent's own rows under a branch, while the scrollback
   * renderer prints one line. The same call repeats while the agent works, so an
   * implementation updates the heading it already opened instead of adding one.
   * @param badge - the agent, its model, its role, and its depth in this session.
   * @param detail - what the agent is doing now, when the host reports it.
   */
  agent?(badge: AgentBadge, detail?: string): void
  /** Close the branch of an agent that finished. */
  agentDone?(badge: AgentBadge, summary?: string): void
  /** Append a streamed piece of the assistant's visible text. */
  text(delta: string): void
  /** Report a non-fatal notice (retry, output cap). */
  notice(text: string): void
  /** Report a failure of the turn itself. */
  error(text: string): void
  /** Close the assistant text block. */
  closeAnswer(): void
  /** Print the footer of the finished turn. */
  finish(footer: FooterInput): void
  /** Print the status line for the current width. */
  status(input: Omit<StatusInput, 'cols'>): void
  /** How many tool calls the turn reported. */
  toolCount(): number
}

/** Two-column body indent shared by every line of the conversation body. */
const BODY_INDENT = '  '

/** Build the `+N −M` suffix of a changed-file line, empty when nothing changed. */
function changeCounts(palette: Palette, added: number | undefined, removed: number | undefined): string {
  if (added === undefined && removed === undefined) return ''
  return `   ${palette.paint(`+${String(added ?? 0)}`, 'DiffAdd')} ${palette.paint(`−${String(removed ?? 0)}`, 'DiffRemove')}`
}

/**
 * Create the renderer of one turn.
 * @param options - palette, sink, and terminal width.
 * @returns the turn's rendering surface.
 */
export function createTurnRenderer(options: TurnRendererOptions): TurnRenderer {
  const { palette, sink, cols } = options
  /** A `HH:MM:SS` stamp for the message line, empty when timestamps are off. */
  const stamp = (): string => options.timestamps !== false
    ? `  ${palette.paint(new Date().toTimeString().slice(0, 8), 'Muted')}`
    : ''
  let tools = 0
  let textStarted = false

  /** Indent every line of a multi-line delta. */
  const indent = (text: string): string => text.split('\n').join(`\n${BODY_INDENT}`)

  /**
   * Print a labelled block of lines, one terminal line each.
   *
   * Nothing is truncated: the point of the block is that the user can read the
   * argument the model sent and the answer it got, so both are printed whole.
   */
  const writeBlock = (target: RenderSink, active: Palette, label: string, lines: readonly string[]): void => {
    for (const [index, line] of lines.entries()) {
      const prefix = index === 0 ? `      ${active.paint(label, 'Subtle')} ` : '         '
      target.write(`${prefix}${active.paint(line, 'Muted')}\n`)
    }
  }

  /** Print a change hunk: added lines green, removed lines red, context plain. */
  const writeDiff = (target: RenderSink, active: Palette, lines: readonly string[]): void => {
    for (const line of lines) {
      const token = line.startsWith('+') ? 'DiffAdd' : line.startsWith('-') ? 'DiffRemove' : 'Muted'
      target.write(`      ${active.paint(line, token)}\n`)
    }
  }

  return {
    user(text) {
      // The task is the user's own line: a marker, the text, and the time it was
      // written. No label — the marker says who wrote it.
      sink.write(`\n${BODY_INDENT}${palette.paint('>', 'Muted')} ${palette.paint(text, 'Text')}${stamp()}\n`)
    },
    agent(badge, detail) {
      // In the scrollback every agent line stands alone, because there is no frame
      // to indent rows against; the branch glyph and the role carry who it is.
      const branch = badge.depth === 0 ? '' : `${'│  '.repeat(Math.max(0, badge.depth - 1))}├─ `
      const parts = [
        palette.paint(badge.label, badge.token),
        ...badge.model === undefined || badge.model === '' ? [] : [palette.paint(badge.model, 'Subtle')],
        ...badge.role === undefined || badge.role === '' ? [] : [palette.paint(badge.role, 'Muted')],
        ...detail === undefined || detail === '' ? [] : [palette.paint(detail, 'Text')],
      ]
      sink.write(`\n  ${palette.paint(branch, 'Subtle')}${palette.paint('◆', badge.token)}  ${parts.join('   ')}\n`)
    },
    agentDone(badge, summary) {
      const branch = badge.depth === 0 ? '' : `${'│  '.repeat(Math.max(0, badge.depth - 1))}└─ `
      const tail = summary === undefined || summary === '' ? '' : `   ${palette.paint(summary, 'Muted')}`
      sink.write(`  ${palette.paint(branch, 'Subtle')}${palette.paint('✓', 'Success')}  ${palette.paint(badge.label, badge.token)}${tail}\n`)
    },
    toolCall(name, argument, call) {
      tools += 1
      const shown = call?.title ?? argument
      const line = shown === undefined || shown === '' ? '' : `   ${palette.paint(shown, 'Text')}`
      const counts = changeCounts(palette, call?.added, call?.removed)
      sink.write(`\n    ${palette.paint('⚙', 'ActionTool')}  ${palette.paint(name, 'Muted')}${line}${counts}\n`)
      if (call?.input !== undefined && call.input.trim() !== '') {
        writeBlock(sink, palette, 'IN ', call.input.split('\n'))
      }
      if (call?.diff !== undefined && call.diff.length > 0) {
        writeDiff(sink, palette, call.diff)
      }
    },
    toolFailure(name, reason) {
      sink.write(`    ${palette.paint('✗', 'Error')}  ${palette.paint(name, 'Muted')}   ${palette.paint(reason, 'Error')}\n`)
    },
    toolDone(name, durationMs, result) {
      const seconds = durationMs === undefined
        ? ''
        : `   ${palette.paint(durationMs < 1000 ? `${String(Math.round(durationMs))}ms` : `${(durationMs / 1000).toFixed(1)}s`, 'Muted')}`
      if (seconds !== '') sink.write(`    ${palette.paint('└', 'Subtle')}  ${palette.paint(name, 'Muted')}${seconds}\n`)
      if (result?.diff !== undefined && result.diff.length > 0) writeDiff(sink, palette, result.diff)
      if (result?.output !== undefined && result.output.trim() !== '') {
        writeBlock(sink, palette, 'OUT', result.output.split('\n'))
      }
    },
    text(delta) {
      if (!textStarted) {
        sink.write(`\n${BODY_INDENT}`)
        textStarted = true
      }
      sink.write(indent(delta))
    },
    notice(text) {
      sink.write(`\n${BODY_INDENT}${palette.paint('⚠', 'Warn')}  ${palette.paint(text, 'Muted')}\n`)
    },
    error(text) {
      sink.write(`\n${BODY_INDENT}${palette.paint('✗', 'Error')}  ${palette.paint(text, 'Error')}\n`)
    },
    closeAnswer() {
      if (textStarted) {
        sink.write('\n')
        textStarted = false
      }
    },
    finish(footer) {
      sink.write(`${turnFooter({ ...footer, tools: footer.tools ?? tools }, palette)}\n`)
    },
    status(input) {
      sink.write(`${statusLine({ ...input, cols }, palette)}\n`)
    },
    toolCount() {
      return tools
    },
  }
}
