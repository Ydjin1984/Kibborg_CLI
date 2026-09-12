/**
 * `kibborg stats` — what one session cost and how it spent itself.
 *
 * The numbers are derived from the session log itself: turn boundaries, per-step
 * usage, and tool calls are all recorded events, so the summary needs no
 * telemetry store and matches what a replay of the same log would show.
 * @module @kibborg/client-node/stats
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session/types'

/** Token and activity totals of one session. */
export interface SessionStats {
  /** Completed turns in the log. */
  readonly turns: number
  /** Model steps across those turns. */
  readonly steps: number
  /** Tool calls the model issued. */
  readonly tools: number
  /** Tool calls that returned an error. */
  readonly toolErrors: number
  /** User messages. */
  readonly userMessages: number
  /** Assistant messages. */
  readonly assistantMessages: number
  /** Uncached input tokens, summed once per step. */
  readonly inputTokens: number
  /** Output tokens, summed once per step. */
  readonly outputTokens: number
  /**
   * Largest single step, input plus output. Every step resends the whole
   * context, so the sum measures what the provider processed while this
   * measures how full the window got — the number the live footer shows.
   */
  readonly peakStepTokens: number
  /** Wall time from the first turn start to the last turn end, in seconds. */
  readonly seconds: number
  /** Wall time the turns themselves took, in seconds. */
  readonly turnSeconds: number
}

/** Add one step's usage once, whichever event carried it first. */
function account(
  counted: Set<string>,
  key: string,
  usage: { readonly inputTokens: number; readonly outputTokens: number } | undefined,
  totals: { input: number; output: number; peak: number },
): void {
  if (usage === undefined || counted.has(key)) return
  counted.add(key)
  totals.input += usage.inputTokens
  totals.output += usage.outputTokens
  totals.peak = Math.max(totals.peak, usage.inputTokens + usage.outputTokens)
}

/**
 * Summarize one session log.
 * @param events - the log, oldest first.
 * @returns the totals this log supports; an empty log yields zeros.
 */
export function summarizeHistory(events: readonly SessionEvent[]): SessionStats {
  const counted = new Set<string>()
  const totals = { input: 0, output: 0, peak: 0 }
  const starts = new Map<number, number>()
  let turns = 0
  let steps = 0
  let tools = 0
  let toolErrors = 0
  let userMessages = 0
  let assistantMessages = 0
  let firstStart: number | undefined
  let lastEnd: number | undefined
  let turnSeconds = 0

  for (const event of events) {
    switch (event.type) {
      case 'turn/start':
        turns += 1
        starts.set(event.data.turn, event.time)
        if (firstStart === undefined) firstStart = event.time
        break
      case 'turn/end': {
        lastEnd = event.time
        const start = starts.get(event.data.turn)
        if (start !== undefined) turnSeconds += (event.time - start) / 1000
        break
      }
      case 'step/start':
        steps += 1
        break
      case 'user/message':
        userMessages += 1
        break
      case 'assistant/message':
        assistantMessages += 1
        account(counted, `${String(event.data.turn)}:${String(event.data.step)}`, event.data.usage, totals)
        break
      case 'assistant/chunk':
        if (event.data.chunk.type === 'usage') {
          account(counted, `${String(event.data.turn)}:${String(event.data.step)}`, event.data.chunk.usage, totals)
        }
        break
      case 'tool/call':
        tools += 1
        break
      case 'tool/result':
        if (event.data.error !== undefined) toolErrors += 1
        break
      default:
        break
    }
  }

  return {
    turns,
    steps,
    tools,
    toolErrors,
    userMessages,
    assistantMessages,
    inputTokens: totals.input,
    outputTokens: totals.output,
    peakStepTokens: totals.peak,
    seconds: firstStart === undefined || lastEnd === undefined ? 0 : (lastEnd - firstStart) / 1000,
    turnSeconds,
  }
}

/**
 * Render one session summary as aligned text lines.
 * @param stats - the totals to print.
 * @param options - the session id and its durable title.
 * @returns one line per measure.
 */
export function formatStats(
  stats: SessionStats,
  options: { readonly sessionId: string; readonly title?: string },
): string[] {
  const heading = options.title === undefined || options.title === '' ? options.sessionId : options.title
  const lines = [
    `  ${heading}`,
    `  session       ${options.sessionId}`,
    `  turns         ${String(stats.turns)}  (${stats.turnSeconds.toFixed(1)} s in turns, ${stats.seconds.toFixed(1)} s total)`,
    `  steps         ${String(stats.steps)}`,
    `  messages      ${String(stats.userMessages)} you, ${String(stats.assistantMessages)} assistant`,
    `  tools         ${String(stats.tools)} calls, ${String(stats.toolErrors)} failed`,
    `  tokens        ${String(stats.inputTokens)} in, ${String(stats.outputTokens)} out (summed over steps; peak step ${String(stats.peakStepTokens)})`,
  ]
  return lines.map(line => `${line}\n`)
}
