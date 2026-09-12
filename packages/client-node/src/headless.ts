/**
 * Machine-readable output for `kibborg -p`.
 *
 * The contract is the one CI depends on: stdout carries ONLY the answer — one
 * text block, one JSON document, or one JSON object per line — while every
 * human-oriented line (the streaming render, notices, tool rows) goes to stderr.
 * An exit code therefore never competes with a progress line for the same file
 * descriptor.
 * @module @kibborg/client-node/headless
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type { TurnOutcome } from './turn.ts'

/** Output shapes `--output-format` accepts. */
export type OutputFormat = 'text' | 'json' | 'stream-json'

/** What the headless writer needs to describe the run it is reporting. */
export interface HeadlessOptions {
  /** The requested shape. */
  readonly format: OutputFormat
  /** Emit an event line per streamed chunk, not only per finished message. */
  readonly includePartial: boolean
  /** The session the turn belongs to. */
  readonly sessionId: string
  /** The model this invocation ran, as `provider/model`. */
  readonly model: string
  /** Turn wall-clock start, for `durationMs`. */
  readonly startedAt: number
}

/** The writer the turn feeds, plus the way to close the report. */
export interface HeadlessWriter {
  /** Observe one session event; ignored by the `text` and `json` shapes. */
  readonly onEvent: (event: SessionEvent) => void
  /**
   * Print the run's result.
   * @param outcome - how the turn ended and what it produced.
   * @returns the exit code the report implies.
   */
  readonly finish: (outcome: TurnOutcome) => number
}

/** Print one JSON line to stdout. */
function line(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`)
}

/** The exit code one turn outcome implies. */
export function exitCodeOf(outcome: TurnOutcome): number {
  switch (outcome.kind) {
    case 'error': return 1
    case 'aborted': return 130
    case 'needs-input': return 3
    // A spent turn budget is a stop the caller asked for, not a clean finish:
    // CI has to tell it apart from an answer that completed on its own.
    case 'max-turns': return 1
    default: return 0
  }
}

/**
 * Validate an answer against a caller-supplied JSON Schema subset.
 *
 * The subset is the one a CLI flag can honestly enforce without pulling a schema
 * engine: `type` and `required` at the root object level. Anything the schema
 * states beyond that is left to the caller.
 * @param value - the parsed answer.
 * @param schema - the schema to check, as parsed JSON.
 * @returns a failure message, or `undefined` when the answer satisfies it.
 */
export function checkSchema(value: unknown, schema: unknown): string | undefined {
  if (schema === null || typeof schema !== 'object') return undefined
  const root = schema as { type?: unknown; required?: unknown }
  if (root.type === 'object' && (value === null || typeof value !== 'object' || Array.isArray(value))) {
    return 'the answer is not a JSON object'
  }
  if (Array.isArray(root.required)) {
    for (const key of root.required) {
      if (typeof key !== 'string') continue
      if (value === null || typeof value !== 'object' || !Object.hasOwn(value as object, key)) {
        return `the answer is missing required field ${JSON.stringify(key)}`
      }
    }
  }
  return undefined
}

/**
 * Parse an answer as JSON and check it against the schema, reporting on stderr.
 * @param answer - the assistant's text.
 * @param schema - the parsed schema, or `undefined` when none was requested.
 * @returns a failure message, or `undefined` when the answer is acceptable.
 */
export function parseStructured(answer: string, schema: unknown | undefined): { readonly value?: unknown; readonly error?: string } {
  const trimmed = answer.trim()
  // A model asked for JSON sometimes fences it; the fence is not part of the
  // value, so it is peeled before parsing rather than reported as a bad answer.
  const unfenced = trimmed.startsWith('```')
    ? trimmed.replace(/^```[a-zA-Z]*\n?/u, '').replace(/```$/u, '').trim()
    : trimmed
  let parsed: unknown
  try {
    parsed = JSON.parse(unfenced)
  } catch (error) {
    return { error: `the answer is not valid JSON: ${error instanceof Error ? error.message : String(error)}` }
  }
  if (schema !== undefined) {
    const failure = checkSchema(parsed, schema)
    if (failure !== undefined) return { error: failure }
  }
  return { value: parsed }
}

/**
 * Build the writer for the requested output shape.
 * @param options - the shape, the session, and the model this run used.
 * @returns the writer the turn feeds.
 */
export function createHeadlessWriter(options: HeadlessOptions): HeadlessWriter {
  let streamed = false
  let partialOpen = false
  const onEvent = (event: SessionEvent): void => {
    if (options.format !== 'stream-json') return
    if (event.type === 'assistant/chunk') {
      const chunk = event.data.chunk
      if (chunk.type !== 'text-delta') return
      if (!options.includePartial) {
        // Without `--include-partial-messages` a chunk only marks that text is
        // coming; the assembled message is reported once below.
        partialOpen = true
        return
      }
      streamed = true
      line({ type: 'assistant', text: chunk.text, sessionId: options.sessionId })
      return
    }
    if (event.type === 'assistant/message') {
      if (streamed || partialOpen) return
      const text = event.data.message.content
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join('')
      if (text === '') return
      streamed = true
      line({ type: 'assistant', text, sessionId: options.sessionId })
      return
    }
    if (event.type === 'tool/call') {
      line({ type: 'tool', name: event.data.name, sessionId: options.sessionId })
    }
  }

  const finish = (outcome: TurnOutcome): number => {
    const code = exitCodeOf(outcome)
    const durationMs = Date.now() - options.startedAt
    if (options.format === 'text') {
      process.stdout.write(outcome.answer === '' ? '' : `${outcome.answer.replace(/\s+$/u, '')}\n`)
      return code
    }
    if (options.format === 'stream-json') {
      line({
        type: 'result',
        result: outcome.answer,
        isError: code !== 0,
        kind: outcome.kind,
        sessionId: options.sessionId,
        model: options.model,
        tokens: outcome.tokens,
        tools: outcome.tools,
        durationMs,
        ...(outcome.errorMessage === undefined ? {} : { error: outcome.errorMessage }),
      })
      return code
    }
    process.stdout.write(`${JSON.stringify({
      result: outcome.answer,
      isError: code !== 0,
      kind: outcome.kind,
      sessionId: options.sessionId,
      model: options.model,
      tokens: outcome.tokens,
      tools: outcome.tools,
      durationMs,
      ...(outcome.errorMessage === undefined ? {} : { error: outcome.errorMessage }),
    }, undefined, 2)}\n`)
    return code
  }

  return { onEvent, finish }
}
