/**
 * One turn of the terminal surface.
 *
 * A turn opens with the task text, follows the session's mux stream until
 * `turn/end`, renders every user-visible fact it sees, and reports what it
 * measured. Both the one-shot invocation and the interactive loop call this, so
 * a task answered from a shell command and a task typed into the REPL behave
 * identically.
 * @module @kibborg/client-node/turn
 */

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session/types'
import type { IApiClient } from '@deepseek-ai/dsh-host-apiproxy/client'
import { createTurnRenderer, type Palette, type ToolResultDetail, type TurnRenderer } from '@kibborg/tui'
import { prettyArguments } from './arguments.ts'
import { createAgentTracker, type AgentObservation } from './agents.ts'
import {
  answerApproval,
  answerQuestions,
  describeHeadlessApproval,
  headlessAnswers,
  type ApprovalDecision,
  type HeadlessQuestionPolicy,
  type PendingApproval,
  type PendingQuestion,
  type QuestionAnswer,
  type QuestionItem,
} from './interaction.ts'

/** Context-occupancy projection key owned by the token meter. */
const PRESSURE_KEY = 'contextPressure'

/** Shape of the context-occupancy projection as this client reads it. */
interface ContextPressure {
  readonly projectedTokens?: number
  readonly pressureTokens?: number
  readonly contextWindow?: number
}

/** How one turn ended, with the measurements the caller renders or returns. */
export interface TurnOutcome {
  /** `completed`, `max-tokens`, `aborted`, `error`, `blocked`, or another kind. */
  readonly kind: string
  /** Tokens the turn moved through the meter, as far as it reported them. */
  readonly tokens: number
  /** Wall-clock seconds the turn took. */
  readonly seconds: number
  /** Tool calls the turn made. */
  readonly tools: number
  /** Context occupancy after the turn, 0–100. */
  readonly contextPercent: number
  /** Failure message when the turn ended in an error. */
  readonly errorMessage?: string
  /** The assistant's visible text, exactly as the turn produced it. */
  readonly answer: string
}

/** Options of {@link runTurn}. */
export interface TurnOptions {
  /** The in-process client. */
  readonly client: IApiClient
  /** The session the turn belongs to. */
  readonly sessionId: SessionId
  /** The task text. */
  readonly task: string
  /** Active palette. */
  readonly palette: Palette
  /** Where the renderer writes. */
  readonly sink: { write(chunk: string): void }
  /**
   * Renderer to drive instead of the scrollback renderer.
   *
   * The fullscreen surface passes its transcript renderer, so a turn appends
   * entries to the scrolling log instead of printing into the scrollback.
   */
  readonly renderer?: TurnRenderer
  /** Terminal width for the status line. */
  readonly cols: number
  /** Print a wall-clock prefix beside the speaker label. */
  readonly timestamps?: boolean
  /** Aborts the turn; the caller owns the controller so it can cancel from a key. */
  readonly signal: AbortSignal
  /** Called once the prompt was admitted, so the UI can mark the turn running. */
  readonly onAccepted?: () => void
  /** Files to attach; each becomes one content part beside the task text. */
  readonly files?: readonly string[]
  /** Answers an approval request; absent means a headless run denies it. */
  readonly onApproval?: (pending: PendingApproval) => Promise<ApprovalDecision>
  /** Answers a question batch; absent means the headless policy decides. */
  readonly onQuestion?: (pending: PendingQuestion) => Promise<readonly QuestionAnswer[] | undefined>
  /** Headless question policy: fail loudly, or answer from a prepared document. */
  readonly questions?: { readonly policy: HeadlessQuestionPolicy; readonly answersFile?: string }
  /** Observes every session event of this turn, in order, for machine output. */
  readonly onEvent?: (event: SessionEvent) => void
  /** Stop after this many turns of this session, cancelling the one in flight. */
  readonly maxTurns?: number
  /**
   * Route the session's chat model runs on, when the caller already read it.
   *
   * The transcript names the agent behind each line; without this the head's
   * model is learned from the session's own `request/header` instead.
   */
  readonly model?: string
}

/** One attached file as the prompt contract expects it. */
interface AttachedFile {
  readonly type: 'file'
  readonly name: string
  readonly mediaType: string
  /** Canonical base64 of the file's bytes. */
  readonly data: string
  readonly path: string
}

/** Media type by file extension; the host validates the declared type. */
function mediaTypeOf(name: string): string {
  const extension = name.slice(name.lastIndexOf('.') + 1).toLowerCase()
  switch (extension) {
    case 'png': return 'image/png'
    case 'jpg':
    case 'jpeg': return 'image/jpeg'
    case 'gif': return 'image/gif'
    case 'webp': return 'image/webp'
    case 'svg': return 'image/svg+xml'
    case 'json': return 'application/json'
    case 'md': return 'text/markdown'
    case 'txt':
    case 'ts':
    case 'tsx':
    case 'js':
    case 'mjs':
    case 'py':
    case 'yml':
    case 'yaml':
    case 'toml':
    case 'css':
    case 'html': return 'text/plain'
    default: return 'application/octet-stream'
  }
}

/** Whether an attached file is an image, which a text-only model cannot see. */
function isImage(mediaType: string): boolean {
  return mediaType.startsWith('image/')
}

/**
 * Build the prompt's content parts: the task text first, then one part per file.
 *
 * Attachments ride the same content-part contract the browser uses (canonical
 * base64 plus an optional path), so the host applies its own size and count
 * limits and folds each file into the durable user message. An image is
 * announced on stderr: the head model of this deployment sees no image, so the
 * task has to send it to a subagent that does.
 * @param task - the task text.
 * @param files - the paths to attach.
 * @returns the content parts to send, and which attachments were images.
 */
function buildContent(task: string, files: readonly string[] | undefined): {
  readonly content: ({ readonly type: 'text'; readonly text: string } | AttachedFile)[]
  readonly images: readonly string[]
} {
  const content: ({ type: 'text'; text: string } | AttachedFile)[] = [{ type: 'text', text: task }]
  const images: string[] = []
  for (const file of files ?? []) {
    const name = file.replace(/\\/gu, '/').split('/').pop() ?? file
    const mediaType = mediaTypeOf(name)
    try {
      const bytes = readFileSync(file)
      content.push({ type: 'file', name, mediaType, data: bytes.toString('base64'), path: file })
      if (isImage(mediaType)) images.push(file)
    } catch (error) {
      process.stderr.write(`kibborg: cannot attach ${file}: ${error instanceof Error ? error.message : String(error)}\n`)
    }
  }
  return { content, images }
}

/** The task a delegation named, when its arguments carry one. */
function delegationLabel(arguments_: unknown): string | undefined {
  const description = (arguments_ as { readonly description?: unknown } | null | undefined)?.description
  return typeof description === 'string' && description !== '' ? description : undefined
}

/** Percentage of the context window the newest sample occupies, when known. */function contextPercent(pressure: ContextPressure | undefined): number {
  if (pressure === undefined) return 0
  const used = pressure.projectedTokens ?? pressure.pressureTokens
  const window = pressure.contextWindow
  if (used === undefined || window === undefined || window <= 0) return 0
  return Math.max(0, Math.min(100, Math.round((used / window) * 100)))
}

/** Paths the working tree reports as changed, or an empty set outside a repository. */
function changedPaths(cwd: string): ReadonlySet<string> {
  const status = spawnSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf8' })
  if (status.status !== 0) return new Set()
  const paths = String(status.stdout)
    .split(/\r?\n/u)
    .map(line => line.slice(3).trim())
    .filter(path => path !== '')
  return new Set(paths)
}

/**
 * Report the files this turn changed.
 *
 * The working tree is the authority: a turn that edited, created, or removed a
 * file shows up as a path the snapshot before the turn did not have, and the
 * footer's line counts come from the same source.
 * @param before - the changed-path snapshot taken before the turn.
 * @param after - the snapshot taken after it.
 * @param palette - the active palette.
 * @param sink - where the report goes.
 */
function reportChangedFiles(
  before: ReadonlySet<string>,
  after: ReadonlySet<string>,
  palette: Palette,
  sink: { write(chunk: string): void },
): void {
  const touched = [...after].filter(path => !before.has(path))
  if (touched.length === 0) return
  sink.write(`\n  ${palette.paint('Changed', 'Muted')}\n`)
  for (const path of touched.slice(0, 12)) {
    sink.write(`    ${palette.paint('✎', 'Warn')}  ${palette.paint(path, 'Text')}\n`)
  }
  if (touched.length > 12) {
    sink.write(`    ${palette.paint(`… и ещё ${String(touched.length - 12)}`, 'Muted')}\n`)
  }
}

/**
 * Render a tool argument compactly: the first path-like token, else a short prefix.
 *
 * This is only the label beside the tool name; the full argument JSON travels
 * separately so the transcript can show what was really requested.
 */
function summarizeArguments(raw: string): string | undefined {
  const trimmed = raw.trim()
  if (trimmed === '') return undefined
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>
    for (const key of ['path', 'file', 'file_path', 'pattern', 'command', 'query']) {
      const value = parsed[key]
      if (typeof value === 'string' && value !== '') return value.slice(0, 80)
    }
  } catch {
    return trimmed.slice(0, 80)
  }
  return trimmed.slice(0, 80)
}

/** The model-facing text of a tool result: every text block it carries, joined. */
function toolOutput(message: unknown): string | undefined {
  const content = (message as { readonly content?: readonly { readonly type?: string; readonly text?: string }[] } | undefined)?.content
  const outer = content?.[0]
  const blocks = (outer as { readonly content?: readonly { readonly type?: string; readonly text?: string }[] } | undefined)?.content
  if (!Array.isArray(blocks)) return undefined
  const text = blocks
    .filter(block => block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text as string)
    .join('\n')
  return text.trim() === '' ? undefined : text
}

/**
 * Build a line diff of one replaced range.
 *
 * The hunks a file tool reports are small (a change plus its context), so a
 * longest-common-subsequence walk over them is cheap and gives the familiar
 * `-`/`+`/` ` rows the user needs to see which lines actually changed.
 * @param before - the text before the change, or `null` when the file is new.
 * @param after - the text after the change.
 * @returns the diff rows and the number of added and removed lines.
 */
function lineDiff(before: string | null, after: string): { readonly lines: string[]; readonly added: number; readonly removed: number } {
  const oldLines = before === null ? [] : before.split('\n')
  const newLines = after.split('\n')
  const table: number[][] = Array.from({ length: oldLines.length + 1 }, () => new Array<number>(newLines.length + 1).fill(0))
  for (let i = oldLines.length - 1; i >= 0; i -= 1) {
    for (let j = newLines.length - 1; j >= 0; j -= 1) {
      const row = table[i]
      const next = table[i + 1]
      if (row === undefined || next === undefined) continue
      row[j] = oldLines[i] === newLines[j] ? (next[j + 1] ?? 0) + 1 : Math.max(next[j] ?? 0, row[j + 1] ?? 0)
    }
  }
  const lines: string[] = []
  let added = 0
  let removed = 0
  let i = 0
  let j = 0
  while (i < oldLines.length && j < newLines.length) {
    if (oldLines[i] === newLines[j]) {
      lines.push(` ${oldLines[i] ?? ''}`)
      i += 1
      j += 1
      continue
    }
    const down = table[i + 1]?.[j] ?? 0
    const right = table[i]?.[j + 1] ?? 0
    if (down >= right) {
      lines.push(`-${oldLines[i] ?? ''}`)
      removed += 1
      i += 1
    } else {
      lines.push(`+${newLines[j] ?? ''}`)
      added += 1
      j += 1
    }
  }
  for (; i < oldLines.length; i += 1) {
    lines.push(`-${oldLines[i] ?? ''}`)
    removed += 1
  }
  for (; j < newLines.length; j += 1) {
    lines.push(`+${newLines[j] ?? ''}`)
    added += 1
  }
  return { lines, added, removed }
}

/**
 * Build the change a call is about to make from its own arguments.
 *
 * File tools report the applied diff only once they have run, and a tool that
 * creates a file reports no hunk at all, so the argument payload is the only
 * source for showing a creation as added lines. The result-time diff replaces
 * this one when the tool provides it.
 * @param name - the tool's name.
 * @param raw - the argument JSON.
 * @returns the diff rows and counts, or `undefined` when this call does not edit.
 */
function argumentDiff(name: string, raw: string): { readonly diff: readonly string[]; readonly added: number; readonly removed: number } | undefined {
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>
  } catch {
    return undefined
  }
  const textOf = (key: string): string | undefined => {
    const value = parsed[key]
    return typeof value === 'string' ? value : undefined
  }
  if (name === 'write' || name === 'create') {
    const content = textOf('content') ?? textOf('file_text')
    if (content === undefined) return undefined
    const lines = content === '' ? [] : content.replace(/\n$/u, '').split('\n')
    return {
      diff: lines.map(line => `+${line}`),
      added: lines.length,
      removed: 0,
    }
  }
  if (name === 'edit' || name === 'str_replace' || name === 'str_replace_editor') {
    const before = textOf('old_string') ?? textOf('old_str')
    const after = textOf('new_string') ?? textOf('new_str')
    if (before === undefined && after === undefined) return undefined
    const path = parsed['file_path'] ?? parsed['path']
    const hunk = lineDiff(before ?? null, after ?? '')
    return {
      diff: [...(typeof path === 'string' ? [`@@ ${path}`] : []), ...hunk.lines],
      added: hunk.added,
      removed: hunk.removed,
    }
  }
  return undefined
}

/** Read the applied diff out of a file tool's result meta, when it carries one. */
function resultDiff(meta: unknown): ToolResultDetail | undefined {
  const diffs = (meta as { readonly diffs?: readonly { readonly path?: unknown; readonly oldText?: unknown; readonly newText?: unknown }[] } | undefined)?.diffs
  if (!Array.isArray(diffs) || diffs.length === 0) return undefined
  const lines: string[] = []
  let added = 0
  let removed = 0
  for (const diff of diffs) {
    if (typeof diff.path !== 'string' || typeof diff.newText !== 'string') continue
    const before = typeof diff.oldText === 'string' ? diff.oldText : null
    lines.push(`@@ ${diff.path}`)
    const hunk = lineDiff(before, diff.newText)
    lines.push(...hunk.lines)
    added += hunk.added
    removed += hunk.removed
  }
  return lines.length === 0 ? undefined : { diff: lines, added, removed }
}

/**
 * Run one turn and render it.
 * @param options - client, session, task text, rendering, and cancellation.
 * @returns the turn's outcome and measurements.
 */
export async function runTurn(options: TurnOptions): Promise<TurnOutcome> {
  const { client, sessionId, task, signal } = options
  const renderer: TurnRenderer = options.renderer ?? createTurnRenderer({
    palette: options.palette,
    sink: options.sink,
    cols: options.cols,
    ...(options.timestamps === true ? { timestamps: true } : {}),
  })
  renderer.user(task)
  const started = Date.now()
  const cwd = process.cwd()
  const changedBefore = changedPaths(cwd)
  const frames = client.events.mux({}, signal)
  const { content, images } = buildContent(task, options.files)
  for (const image of images) {
    process.stderr.write(`kibborg: ${image} is an image and this model reads text only; delegate it to a subagent that can see images\n`)
  }
  const accepted = await client.sessions.prompt({
    sessionId,
    mode: 'queue',
    content,
  })
  if (!accepted.result.ok) {
    renderer.error(accepted.result.error.message)
    return { kind: 'error', tokens: 0, seconds: 0, tools: 0, contextPercent: 0, answer: '', errorMessage: accepted.result.error.message }
  }
  options.onAccepted?.()

  let streamed = false
  let tokens = 0
  let answer = ''
  let turnsSeen = 0
  /** When each running tool call started, so its result can report a duration. */
  const toolStarts = new Map<string, number>()
  let pressure: ContextPressure | undefined
  // Who is working: the session the user typed into, and the subagents it
  // delegates to. The tree is read before the prompt so a child's first event
  // already has an identity to draw it with.
  const anonymous = process.env['KIBBORG_NO_AGENTS'] === '1'
  const agents = createAgentTracker(client, {
    sessionId,
    ...(options.model === undefined ? {} : { model: options.model }),
  })
  if (!anonymous) await agents.load()
  /** Session whose agent the surface is currently showing. */
  let announced: string | undefined
  /** Activity already reported for that agent, so a heading is not rewritten per event. */
  let announcedDetail: string | undefined
  /** Report the agent that just spoke, opening its branch on the surface. */
  const announce = (observation: AgentObservation): void => {
    if (anonymous) return
    if (observation.finished) {
      renderer.agentDone?.(observation.agent, observation.detail)
      if (announced === observation.agent.sessionId) announced = undefined
      return
    }
    if (observation.renamed === true) {
      // The agent's name or route became known after its heading was drawn, so the
      // heading is replaced instead of keeping the session id on screen.
      announced = undefined
      announcedDetail = undefined
    }
    if (announced === observation.agent.sessionId
      && (observation.detail === undefined || observation.detail === announcedDetail)) return
    announced = observation.agent.sessionId
    announcedDetail = observation.detail
    renderer.agent?.(observation.agent, observation.detail)
  }
  /** Return the surface to the session the user typed into. */
  const announceRoot = (): void => {
    if (anonymous || announced === sessionId) return
    announced = sessionId
    announcedDetail = undefined
    renderer.agent?.(agents.root())
  }
  const finish = (kind: string, errorMessage?: string): TurnOutcome => {
    renderer.closeAnswer()
    const changed = [...changedPaths(cwd)].filter(path => !changedBefore.has(path))
    if (renderer.changedFiles !== undefined) renderer.changedFiles(changed)
    else reportChangedFiles(changedBefore, changedPaths(cwd), options.palette, options.sink)
    const outcome: TurnOutcome = {
      kind,
      tokens,
      seconds: (Date.now() - started) / 1000,
      tools: renderer.toolCount(),
      contextPercent: contextPercent(pressure),
      answer,
      ...(errorMessage === undefined ? {} : { errorMessage }),
    }
    renderer.finish({ tokens: outcome.tokens, seconds: outcome.seconds, tools: outcome.tools })
    return outcome
  }

  for await (const frame of frames) {
    const payload = frame.payload
    if (payload.type === 'stream/error') {
      renderer.error(payload.error.message)
      return { ...finish('error', payload.error.message), errorMessage: payload.error.message }
    }
    if (payload.type === 'session/projection') {
      if (payload.sessionId === sessionId && payload.key === PRESSURE_KEY) {
        pressure = payload.value as ContextPressure
      } else {
        // A subagent's own projection is how the surface learns what that agent is
        // doing right now: the host pushes activity only for subagent sessions.
        const observation = agents.observe(payload)
        if (observation !== undefined) announce(observation)
      }
      continue
    }
    if (payload.type === 'approval/requested') {
      const pending: PendingApproval = {
        rpcId: String(frame.rpcId),
        sessionId: payload.sessionId,
        approvalId: String(payload.approvalId),
        toolName: payload.toolName,
        ...(payload.reason === undefined ? {} : { reason: payload.reason }),
      }
      const decision: ApprovalDecision = options.onApproval === undefined
        ? 'rejected'
        : await options.onApproval(pending)
      if (options.onApproval === undefined) {
        process.stderr.write(`kibborg: ${describeHeadlessApproval(pending)}\n`)
      }
      const accepted = await answerApproval(client, pending, decision)
      renderer.notice(accepted
        ? `approval ${decision === 'allowed-once' ? 'granted' : 'denied'}: ${pending.toolName}`
        : `approval answer for ${pending.toolName} was not accepted`)
      continue
    }
    if (payload.type === 'question/requested') {
      const pending: PendingQuestion = {
        rpcId: String(frame.rpcId),
        sessionId: payload.sessionId,
        questions: payload.questions as readonly QuestionItem[],
      }
      const answers = options.onQuestion === undefined
        ? headlessAnswers(pending, options.questions ?? { policy: 'fail' })
        : await options.onQuestion(pending)
      if (answers === undefined) {
        renderer.error('a question needs an interactive answer')
        return finish('needs-input', 'the model asked a question this run cannot answer')
      }
      const accepted = await answerQuestions(client, pending, answers)
      if (!accepted) renderer.notice('the question answer was not accepted')
      continue
    }
    if (payload.type !== 'session/event') continue
    if (payload.sessionId !== sessionId) {
      // A subagent of this run: its tool calls are shown inside the branch of the
      // agent that delegated them, while its own prose stays in its own session.
      const observation = agents.observe(payload)
      if (observation === undefined) continue
      if (payload.event.type === 'tool/call') {
        announce(observation)
        renderer.toolCall(payload.event.data.name, summarizeArguments(payload.event.data.arguments), undefined)
      } else if (payload.event.type === 'tool/result') {
        announce(observation)
        const name = (payload.event.data as { readonly name?: string }).name ?? 'tool'
        if ((payload.event.data as { readonly error?: unknown }).error !== undefined) renderer.toolFailure(name, 'failed')
        else renderer.toolDone?.(name)
      } else {
        announce(observation)
      }
      continue
    }
    const event = payload.event
    options.onEvent?.(event)

    if (event.type === 'assistant/chunk') {
      const chunk = event.data.chunk
      // Reasoning deltas are dropped: hidden reasoning is not user-facing (R10).
      if (chunk.type === 'text-delta') {
        answer += chunk.text
        renderer.text(chunk.text)
        streamed = true
      } else if (chunk.type === 'usage') {
        tokens = Math.max(tokens, chunk.usage.inputTokens + (chunk.usage.outputTokens ?? 0))
      }
      continue
    }
    if (event.type === 'assistant/message') {
      const usage = event.data.usage
      if (usage !== undefined) tokens = Math.max(tokens, usage.inputTokens + (usage.outputTokens ?? 0))
      if (!streamed) {
        const text = event.data.message.content
          .filter(block => block.type === 'text')
          .map(block => block.text)
          .join('')
        if (text !== '') {
          answer += text
          renderer.text(text)
          streamed = true
        }
      }
      continue
    }
    if (event.type === 'tool/call') {
      announceRoot()
      // A one-shot delegation carries the task it was given in its own arguments and
      // leaves no descriptor behind, so the child takes its name from this call.
      if (event.data.name === 'executor') {
        const label = delegationLabel(event.data.arguments)
        if (label !== undefined) agents.hint(label)
      }
      toolStarts.set(event.data.name, Date.now())
      const input = prettyArguments(event.data.arguments)
      const change = argumentDiff(event.data.name, event.data.arguments)
      const detail = {
        ...(input === undefined ? {} : { input }),
        ...(change ?? {}),
      }
      renderer.toolCall(
        event.data.name,
        summarizeArguments(event.data.arguments),
        Object.keys(detail).length === 0 ? undefined : detail,
      )
      continue
    }
    if (event.type === 'tool/result') {
      const data = event.data as {
        readonly name?: string
        readonly error?: { readonly name: string }
        readonly message?: unknown
        readonly meta?: unknown
      }
      const name = data.name ?? 'tool'
      const startedAt = toolStarts.get(name)
      toolStarts.delete(name)
      if (data.error !== undefined) renderer.toolFailure(name, data.error.name)
      else if (renderer.toolDone !== undefined) {
        const detail = resultDiff(data.meta)
        const output = toolOutput(data.message)
        const result = {
          ...(output === undefined ? {} : { output }),
          ...(detail ?? {}),
        }
        renderer.toolDone(
          name,
          startedAt === undefined ? undefined : Date.now() - startedAt,
          Object.keys(result).length === 0 ? undefined : result,
        )
      }
      continue
    }
    // Retry records come from the LLM retry plugin, which merges its own session
    // events into the map; reading the tag as a string keeps this renderer
    // independent of that package's type graph.
    const eventTag: string = event.type
    if (eventTag === 'llm/retry') {
      renderer.notice('provider retry scheduled')
      continue
    }
    if (event.type === 'turn/end') {
      const reason = event.data.reason as { kind: string; error?: { message: string } }
      turnsSeen += 1
      if (reason.kind === 'error') {
        renderer.error(reason.error?.message ?? 'the turn failed')
        return finish('error', reason.error?.message ?? 'the turn failed')
      }
      // A turn that completed on its own is a finished answer, even when the
      // budget allowed exactly this many turns: only a turn that ended wanting to
      // continue is what the budget actually stops.
      if (reason.kind === 'completed') return finish('completed')
      if (options.maxTurns !== undefined && turnsSeen >= options.maxTurns) {
        // The budget is spent: stop the session rather than let another turn
        // start behind the caller's back.
        void client.sessions.cancel({ sessionId })
        renderer.notice(`turn budget of ${String(options.maxTurns)} reached`)
        return finish('max-turns')
      }
      if (reason.kind === 'max-tokens') {
        renderer.notice('the reply reached the output cap; send "continue" to resume in a new turn')
      }
      if (reason.kind === 'aborted') renderer.notice('turn cancelled')
      if (reason.kind === 'blocked') renderer.notice('the turn was blocked before it ran')
      return finish(reason.kind)
    }
  }
  renderer.error('the mux stream ended before the turn did')
  return finish('error', 'the mux stream ended before the turn did')
}
