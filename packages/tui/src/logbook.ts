/**
 * Diagnostics journal of the terminal surface.
 *
 * The surface is interactive, and an interactive bug is hard to describe after the
 * fact: what the user pressed, what the surface did about it, how long that took,
 * and — when nothing happened — why. This module keeps that record in a JSONL file
 * next to the harness home, so a report can be answered from the file instead of
 * from memory.
 *
 * Records are written as one JSON object per line with the fields every entry
 * shares: `time`, `level`, `scope`, `action`, and then `ok`, `ms`, `reason`, and
 * `details` when they apply. A log is buffered and flushed on a short timer, on
 * demand, and at failure, so a crash does not lose the events that led to it.
 * @module @kibborg/tui/logbook
 */

import { appendFileSync, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from 'node:fs'
import { dirname } from 'node:path'

/** How much of the surface's life is recorded. */
export type LogLevel = 'off' | 'error' | 'info' | 'trace'

/** One recorded event. */
export interface LogRecord {
  /** Severity: `error` for failures, `info` for user actions, `trace` for everything else. */
  readonly level: Exclude<LogLevel, 'off'>
  /** Subsystem the event belongs to: `key`, `reader`, `render`, `command`, `turn`, `input`. */
  readonly scope: string
  /** What happened, as a short verb: `press`, `expand`, `submit`, `frame`. */
  readonly action: string
  /** Whether the action achieved what it was asked to do. */
  readonly ok?: boolean
  /** How long the action took, in milliseconds. */
  readonly ms?: number
  /** Why it did not happen, when `ok` is false. */
  readonly reason?: string
  /** Facts specific to the action. */
  readonly details?: Readonly<Record<string, unknown>>
}

/** What an action reports about itself, so the journal states a result and not only an attempt. */
export interface ActionOutcome<T = undefined> {
  /** Whether the action achieved what it was asked to do. */
  readonly ok: boolean
  /** Why it did not, when `ok` is false. */
  readonly reason?: string
  /** Extra facts the action learned while running. */
  readonly details?: Readonly<Record<string, unknown>>
  /** The action's own result, returned to the caller. */
  readonly value?: T
}

/** What a caller writes to. */
export interface Logbook {
  /** Level in force; `off` silences everything. */
  readonly level: LogLevel
  /** Where records go, for the surface to display. */
  readonly file: string | undefined
  /**
   * Whether an event at this level would be recorded.
   * @param level - the level to test.
   * @returns true when the event passes the level filter.
   */
  enabled(level: Exclude<LogLevel, 'off'>): boolean
  /**
   * Record one event.
   * @param record - the event; `time` is added here.
   */
  write(record: LogRecord): void
  /**
   * Run an action and record it with its duration and outcome.
   *
   * The action reports what it did through its return value, so the log states the
   * result rather than only that something was attempted.
   * @param scope - subsystem the action belongs to.
   * @param action - short verb naming the action.
   * @param details - facts known before the action runs.
   * @param run - the action; returns its outcome.
   * @returns the action's own result.
   */
  record<T>(
    scope: string,
    action: string,
    details: Readonly<Record<string, unknown>>,
    run: () => ActionOutcome<T>,
  ): T | undefined
  /** Write buffered records to the file now. */
  flush(): void
  /** Flush and stop the timer. */
  close(): void
}

/** Records kept in memory before a flush. */
const BUFFER_LIMIT = 200

/** How often the buffer reaches the file while the process lives. */
const FLUSH_MS = 200

/** How large the file may grow before it is rotated. */
const MAX_BYTES = 5_000_000

/** How many rotated files are kept. */
const KEEP_FILES = 5

/** Numeric rank of a level, for filtering. */
const RANK: Readonly<Record<LogLevel, number>> = { off: 0, error: 1, info: 2, trace: 3 }

/**
 * Read the level a caller asked for.
 * @param raw - the environment value, if any.
 * @returns the level; unknown or absent values mean `info`, and `0`/`off` disables logging.
 */
export function logLevelOf(raw: string | undefined): LogLevel {
  const value = (raw ?? '').trim().toLowerCase()
  if (value === 'off' || value === '0' || value === 'false' || value === 'no') return 'off'
  if (value === 'trace' || value === 'debug' || value === 'all') return 'trace'
  if (value === 'error') return 'error'
  return 'info'
}

/**
 * Build the journal.
 *
 * A sink replaces the file in tests and in surfaces that show their own diagnostics.
 * @param options - level, destination, clock, and rotation bounds.
 * @returns the logbook; a level of `off` costs nothing.
 */
export function createLogbook(options: {
  readonly level?: LogLevel
  readonly file?: string
  readonly sink?: (line: string) => void
  readonly now?: () => number
  readonly maxBytes?: number
  readonly keep?: number
} = {}): Logbook {
  const level = options.level ?? 'info'
  const now = options.now ?? Date.now
  const maxBytes = options.maxBytes ?? MAX_BYTES
  const keep = options.keep ?? KEEP_FILES
  const target = options.file
  const sink = options.sink
  let buffer: string[] = []
  let timer: NodeJS.Timeout | undefined
  let closed = false

  /** Rotate the file when it outgrew its bound, so one long session cannot fill the disk. */
  const rotate = (): void => {
    if (target === undefined || !existsSync(target)) return
    try {
      if (statSync(target).size < maxBytes) return
      for (let index = keep - 1; index >= 1; index -= 1) {
        const older = `${target}.${String(index)}`
        if (existsSync(older)) {
          if (index === keep - 1) unlinkSync(older)
          else renameSync(older, `${target}.${String(index + 1)}`)
        }
      }
      renameSync(target, `${target}.1`)
    } catch {
      // A journal that cannot rotate must not take the surface down with it: the
      // next flush appends to the same file and the problem is repeated, not hidden.
    }
  }

  /** Move buffered records to their destination. */
  const flush = (): void => {
    if (buffer.length === 0) return
    const lines = buffer.join('')
    buffer = []
    if (sink !== undefined) {
      sink(lines)
      return
    }
    if (target === undefined) return
    try {
      mkdirSync(dirname(target), { recursive: true })
      rotate()
      appendFileSync(target, lines, 'utf8')
    } catch {
      // Logging is diagnostics, never a reason to fail the run.
    }
  }

  const schedule = (): void => {
    if (timer !== undefined || closed) return
    timer = setTimeout(() => {
      timer = undefined
      flush()
    }, FLUSH_MS)
    timer.unref?.()
  }

  /** Whether an event at this level is recorded; kept out of the object so the
   * methods can be detached from it without losing their behaviour. */
  const allows = (at: Exclude<LogLevel, 'off'>): boolean => level !== 'off' && RANK[at] <= RANK[level]

  /** Append one record, flushing at once when it reports a failure. */
  const write = (record: LogRecord): void => {
    if (!allows(record.level)) return
    buffer.push(`${JSON.stringify({ time: new Date(now()).toISOString(), ...record })}\n`)
    if (record.level === 'error' || buffer.length >= BUFFER_LIMIT) flush()
    else schedule()
  }

  return {
    level,
    file: target,
    enabled: allows,
    write,
    record<T>(scope: string, action: string, details: Readonly<Record<string, unknown>>, run: () => ActionOutcome<T>): T | undefined {
      const started = now()
      let result: ActionOutcome<T> | undefined
      let thrown: unknown
      try {
        result = run()
      } catch (error) {
        thrown = error
      }
      const ms = now() - started
      const ok = thrown === undefined && result?.ok === true
      write({
        level: 'info',
        scope,
        action,
        ok,
        ms,
        ...(ok ? {} : { reason: thrown === undefined ? result?.reason ?? 'отказ без причины' : String(thrown) }),
        details: { ...details, ...(result?.details ?? {}), ...(thrown === undefined ? {} : { error: String(thrown) }) },
      })
      if (thrown !== undefined) throw thrown
      return result?.value
    },
    flush,
    close() {
      closed = true
      if (timer !== undefined) {
        clearTimeout(timer)
        timer = undefined
      }
      flush()
    },
  }
}

/** A logbook that records nothing, for surfaces with no journal. */
export const silentLogbook: Logbook = {
  level: 'off',
  file: undefined,
  enabled: () => false,
  write: () => {},
  record: (_scope, _action, _details, run) => run().value,  flush: () => {},
  close: () => {},
}