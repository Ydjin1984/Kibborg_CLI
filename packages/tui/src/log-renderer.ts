/**
 * Transcript renderer of the fullscreen surface.
 *
 * It implements the same {@link TurnRenderer} surface as the scrollback
 * renderer, so `runTurn` does not know which one it drives: instead of writing
 * the turn into the scrollback, this one appends entries to the transcript model
 * and lets the app repaint the region.
 * @module @kibborg/tui/log-renderer
 */

import type { AgentBadge, LogModel } from './log.ts'
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
  /** Text accumulated for the answer being streamed. */
  let answerText = ''
  /**
   * Rows of the calls still running, oldest first, each with the agent that made it
   * and the tool's name.
   *
   * One slot per name is not enough: a step may call the same tool twice, and its
   * two results arrive in order. The list keeps the call order, so the first result
   * settles the first row and no row stays "running" after the turn. The agent is
   * part of the key because a delegation starts inside the turn: the head starts a
   * call, a child starts its own, and a shared name would settle the wrong row.
   * A result whose name the host does not repeat settles the oldest row, which is
   * the only one it can belong to.
   */
  const running: { readonly key: string; readonly id: number }[] = []
  /** The agent whose rows are being appended, and the heading that opened it. */
  let current: { readonly badge: AgentBadge; readonly heading: number } | undefined

  /** Fields every entry carries while an agent owns the turn. */
  const owner = (): { readonly agent?: AgentBadge } => current === undefined
    ? {}
    : { agent: { ...current.badge, state: 'open' } }

  /** Key of one running call: the agent's label, then the tool's name. */
  const slot = (name: string): string => `${current?.badge.label ?? ''}\u0000${name}`

  /**
   * Take the row a finishing call belongs to.
   *
   * The name decides when the host reports it: the oldest row of that agent and
   * tool settles first. When the host repeats no name, the oldest row in the turn
   * is the only candidate.
   */
  const takeRunning = (name: string): number | undefined => {
    const known = name !== '' && name !== 'tool'
    let index = known ? running.findIndex(entry => entry.key === slot(name)) : 0
    if (index === -1 && known) index = running.findIndex(entry => entry.key.endsWith(`\u0000${name}`))
    if (index === -1 && known) index = 0
    if (index === -1) return undefined
    const [taken] = running.splice(index, 1)
    return taken?.id
  }

  return {
    user(text) {
      answerId = null
      log.append({ kind: 'user', text })
    },
    agent(badge, detail) {
      const text = detail ?? ''
      // The session identifies the agent even after its name changes; a caller that
      // passes no session falls back to the name and depth it drew the heading with.
      const same = badge.sessionId === undefined
        ? current !== undefined && current.badge.depth === badge.depth && current.badge.label === badge.label
        : current?.badge.sessionId === badge.sessionId
      if (current !== undefined && same) {
        // The agent is still the same one: its heading carries the newest activity
        // and the newest name, model, and role, instead of a new heading per call.
        const heading = current.heading
        current = { badge, heading }
        log.patch(heading, { text, agent: { ...badge, state: 'open' } })
        return
      }
      answerId = null
      const heading = log.append({
        kind: 'agent',
        text,
        agent: { ...badge, state: 'open' },
      })
      current = { badge, heading }
    },
    agentDone(badge, summary) {
      // The heading stays where it opened and the close gets its own row, so the
      // branch reads top-down: what the agent was, what it did, how it ended.
      current = undefined
      log.append({ kind: 'agent', text: summary ?? '', agent: { ...badge, state: 'done' } })
    },
    toolCall(name, argument, call) {
      tools += 1
      answerId = null
      const id = log.append({
        kind: 'tool',
        text: argument ?? '',
        name,
        toolName: name,
        status: 'running',
        ...owner(),
        ...(call?.title === undefined ? {} : { title: call.title }),
        ...(call?.input === undefined ? {} : { input: call.input }),
        ...(call?.diff === undefined ? {} : { diff: call.diff }),
        ...(call?.added === undefined ? {} : { added: call.added }),
        ...(call?.removed === undefined ? {} : { removed: call.removed }),
      })
      running.push({ key: slot(name), id })
    },
    toolFailure(name, reason) {
      const id = takeRunning(name)
      if (id === undefined) {
        // A failure with no row of its own still belongs to the agent that made it.
        log.append({ kind: 'error', text: `${name}: ${reason}`, ...owner() })
        return
      }
      log.patch(id, { status: 'fail', meta: reason })
    },
    toolDone(name, durationMs, result) {
      const id = takeRunning(name)
      if (id === undefined) return
      log.patch(id, {
        status: 'ok',
        ...(durationMs === undefined ? {} : { durationMs }),
        ...(name === '' ? {} : { name }),
        ...(result?.output === undefined ? {} : { output: result.output }),
        ...(result?.diff === undefined ? {} : { diff: result.diff }),
        ...(result?.added === undefined ? {} : { added: result.added }),
        ...(result?.removed === undefined ? {} : { removed: result.removed }),
      })
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
    thought(durationMs) {
      answerId = null
      log.append({ kind: 'thought', text: '', durationMs, ...owner() })
    },
    text(delta) {
      if (answerId === null) {
        answerId = log.append({ kind: 'assistant', text: delta })
        answerText = delta
        return
      }
      // The running text is kept here instead of read back from the entry: a long
      // answer streams in hundreds of chunks, and scanning the transcript for its
      // own entry on each one is what made streaming cost grow with the session.
      answerText += delta
      log.patch(answerId, { text: answerText })
    },
    notice(text) {
      answerId = null
      log.append({ kind: 'notice', text, ...owner() })
    },
    error(text) {
      answerId = null
      log.append({ kind: 'error', text, ...owner() })
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
