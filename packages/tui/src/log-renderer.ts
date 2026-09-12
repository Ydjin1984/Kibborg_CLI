/**
 * Transcript renderer of the fullscreen surface.
 *
 * It implements the same {@link TurnRenderer} surface as the scrollback
 * renderer, so `runTurn` does not know which one it drives: instead of writing
 * the turn into the scrollback, this one appends entries to the transcript model
 * and lets the app repaint the region.
 * @module @kibborg/tui/log-renderer
 */

import type { LogModel } from './log.ts'
import type { TurnRenderer } from './render.ts'
import type { FooterInput, StatusInput } from './status.ts'

/** Construction options of the transcript renderer. */
export interface LogRendererOptions {
  /** The transcript to fill. */
  readonly log: LogModel
  /** Receives the footer of a finished turn. */
  readonly onFooter?: (footer: FooterInput) => void
  /** Receives the status line of a finished turn. */
  readonly onStatus?: (status: Omit<StatusInput, 'cols'>) => void
}

/**
 * Build a renderer that writes a turn into the transcript.
 * @param options - transcript and measurement callbacks.
 * @returns the renderer `runTurn` drives.
 */
export function createLogRenderer(options: LogRendererOptions): TurnRenderer {
  const { log } = options
  let tools = 0
  let answerId: number | null = null
  let runningToolId: number | null = null

  return {
    user(text) {
      answerId = null
      log.append({ kind: 'user', text })
    },
    toolCall(name, argument, call) {
      tools += 1
      answerId = null
      runningToolId = log.append({
        kind: 'tool',
        text: argument ?? '',
        name,
        status: 'running',
        ...(call?.input === undefined ? {} : { input: call.input }),
        ...(call?.diff === undefined ? {} : { diff: call.diff }),
        ...(call?.added === undefined ? {} : { added: call.added }),
        ...(call?.removed === undefined ? {} : { removed: call.removed }),
      })
    },
    toolFailure(name, reason) {
      const id = runningToolId
      if (id === null) {
        log.append({ kind: 'error', text: `${name}: ${reason}` })
        return
      }
      log.patch(id, { status: 'fail', meta: reason })
      runningToolId = null
    },
    toolDone(name, durationMs, result) {
      const id = runningToolId
      if (id === null) return
      log.patch(id, {
        status: 'ok',
        ...(durationMs === undefined ? {} : { durationMs }),
        ...(name === '' ? {} : { name }),
        ...(result?.output === undefined ? {} : { output: result.output }),
        ...(result?.diff === undefined ? {} : { diff: result.diff }),
        ...(result?.added === undefined ? {} : { added: result.added }),
        ...(result?.removed === undefined ? {} : { removed: result.removed }),
      })
      runningToolId = null
    },
    changedFiles(paths) {
      if (paths.length === 0) return
      answerId = null
      log.append({
        kind: 'notice',
        text: `Changed ${String(paths.length)} ${paths.length === 1 ? 'file' : 'files'}`,
        detail: paths,
      })
    },
    text(delta) {
      if (answerId === null) {
        answerId = log.append({ kind: 'assistant', text: delta })
        return
      }
      const id = answerId
      const entries = log.entries
      const current = entries.find(entry => entry.id === id)
      if (current === undefined) return
      log.patch(id, { text: current.text + delta })
    },
    notice(text) {
      answerId = null
      log.append({ kind: 'notice', text })
    },
    error(text) {
      answerId = null
      log.append({ kind: 'error', text })
    },
    closeAnswer() {
      answerId = null
    },
    finish(footer) {
      options.onFooter?.({ ...footer, tools: footer.tools ?? tools })
    },
    status(input) {
      options.onStatus?.(input)
    },
    toolCount() {
      return tools
    },
  }
}
