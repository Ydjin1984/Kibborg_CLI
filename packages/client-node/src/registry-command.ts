/**
 * The read-only registry summaries: `kibborg models` and `kibborg stats`.
 *
 * Both print what the host serves rather than driving a turn, so they resolve,
 * render, and exit. The model catalog is host-scoped; the statistics summary
 * needs a session because it reads that session's log.
 * @module @kibborg/client-node/registry-command
 */

import type { IApiClient } from '@deepseek-ai/dsh-host-apiproxy/client'
import { formatModelRegistry, readModelRegistry } from './registries.ts'
import { readHistoryEvents, resolveSession } from './sessions.ts'
import { formatStats, summarizeHistory } from './stats.ts'
import type { ClientIntent } from './types.ts'

/** How much of a session log the statistics summary reads. */
const STATS_HISTORY_LIMIT = 2000

/** Print one rendered table or its JSON form. */
function emit(text: string, json: unknown, asJson: boolean): void {
  process.stdout.write(asJson ? `${JSON.stringify(json, undefined, 2)}\n` : text)
}

/**
 * Run one registry summary.
 * @param client - the in-process API client.
 * @param intent - the resolved invocation intent.
 * @returns the process exit code.
 */
export async function runRegistryCommand(
  client: IApiClient,
  intent: ClientIntent,
): Promise<number> {
  const asJson = intent.json === true
  try {
    if (intent.kind === 'models') {
      const view = await readModelRegistry(client)
      emit(formatModelRegistry(view).join(''), view, asJson)
      return 0
    }
    const resolved = await resolveSession(client, intent.sessionId)
    if (resolved === undefined) {
      process.stderr.write('kibborg: no session found for statistics; run a task first or pass a session id\n')
      return 1
    }
    const read = await readHistoryEvents(client, resolved.sessionId, STATS_HISTORY_LIMIT)
    if (read === undefined) return 1
    const stats = summarizeHistory(read.events)
    const title = read.title ?? resolved.title
    emit(formatStats(stats, {
      sessionId: resolved.sessionId,
      ...(title === undefined ? {} : { title }),
    }).join(''), stats, asJson)
    return 0
  } catch (error) {
    process.stderr.write(`kibborg: ${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  }
}
