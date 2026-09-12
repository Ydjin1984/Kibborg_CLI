/**
 * `kibborg export` — stream one session log to a file.
 *
 * The host exposes the export as a download surface rather than a wire method:
 * the same ZIP the browser's Save button receives, containing the root session
 * log and, on request, each subagent descendant's. Writing it here keeps the
 * terminal's export byte-identical to the browser's.
 * @module @kibborg/client-node/export-session
 */

import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { IApiClient } from '@deepseek-ai/dsh-host-apiproxy/client'
import { resolveSession } from './sessions.ts'

/** Where the export lands and which log it covers. */
export interface ExportRequest {
  /** Session to export; absent means the newest one of this directory. */
  readonly sessionId?: string
  /** Destination file; relative paths resolve against the working directory. */
  readonly output?: string
  /** Include every subagent descendant's log beside the root one. */
  readonly includeDescendants?: boolean
}

/** Default destination when the caller names none. */
export function defaultExportPath(sessionId: string): string {
  return `kibborg-session-${sessionId}.zip`
}

/**
 * Export one session log to disk.
 * @param ctx - host context carrying the API proxy.
 * @param client - the in-process API client.
 * @param request - which session, where, and whether descendants are included.
 * @returns the process exit code.
 */
export async function exportSessionLog(
  ctx: Context,
  client: IApiClient,
  request: ExportRequest,
): Promise<number> {
  const resolved = await resolveSession(client, request.sessionId)
  if (resolved === undefined) {
    process.stderr.write('kibborg: no session found to export; run a task first or pass a session id\n')
    return 1
  }
  const sessionId = resolved.sessionId
  const output = resolve(request.output ?? defaultExportPath(sessionId))
  try {
    const response = await ctx.apiProxy.downloads.sessionLog({
      sessionId,
      ...(request.includeDescendants === true ? { includeDescendants: true } : {}),
    }, new AbortController().signal)
    if (!response.ok) {
      process.stderr.write(`kibborg: session export failed with status ${String(response.status)}\n`)
      return 1
    }
    const bytes = Buffer.from(await response.arrayBuffer())
    await writeFile(output, bytes)
    process.stdout.write(`  ${output}  ${String(bytes.byteLength)} bytes\n`)
    return 0
  } catch (error) {
    process.stderr.write(`kibborg: ${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  }
}
