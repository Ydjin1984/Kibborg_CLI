/**
 * The invocation intent the launcher hands to the client half.
 *
 * The binary owns argv and turns it into one JSON intent on
 * `KIBBORG_INTENT`; this module reads and validates it. Keeping the parse on
 * the launcher side means the client never re-derives what the user asked for,
 * and a malformed intent fails loudly instead of quietly becoming a task.
 * @module @kibborg/client-node/intent
 */

import type { ClientIntent } from './types.ts'

/** Environment variable carrying the serialized intent. */
const INTENT_ENV = 'KIBBORG_INTENT'

/** The kinds this build understands. */
const KINDS: readonly string[] = ['task', 'sessions', 'resume', 'search', 'rename', 'fork', 'archive', 'agents', 'jobs', 'commands', 'models', 'mcp', 'skills', 'export', 'tools', 'stats', 'settings', 'auth', 'attach']

/**
 * Read the invocation intent.
 * @param environment - the environment to read; defaults to the process environment.
 * @returns the parsed intent, or `undefined` when the launcher supplied none.
 * @throws when the value is present but not a valid intent.
 */
export function readIntent(environment: NodeJS.ProcessEnv = process.env): ClientIntent | undefined {
  const raw = environment[INTENT_ENV]
  if (raw === undefined || raw === '') return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`${INTENT_ENV} is not valid JSON`)
  }
  if (typeof parsed !== 'object' || parsed === null) throw new Error(`${INTENT_ENV} must be a JSON object`)
  const candidate = parsed as { kind?: unknown }
  if (typeof candidate.kind !== 'string' || !KINDS.includes(candidate.kind)) {
    throw new Error(`${INTENT_ENV} has an unknown kind: ${JSON.stringify(candidate.kind)}`)
  }
  return parsed as ClientIntent
}
