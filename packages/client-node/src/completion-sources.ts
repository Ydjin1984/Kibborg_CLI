/**
 * Candidate sources for composer completion.
 *
 * Both sources are snapshots taken when the interactive loop starts: a deep
 * directory walk and a session listing cost far more than the keystroke that
 * reads them, and a snapshot answers every Tab press in the same session
 * without touching the disk again.
 * @module @kibborg/client-node/completion-sources
 */

import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { IApiClient } from '@deepseek-ai/dsh-host-apiproxy/client'
import type { CompletionSources } from '@kibborg/tui'

/** Directories a completion walk never enters. */
const SKIPPED_DIRECTORIES = new Set(['.git', 'node_modules', 'lib', 'dist', 'out', '.venv', '.venv-graphify'])

/** Files one `@` completion offers before it stops walking. */
export const FILE_CANDIDATE_LIMIT = 400

/** Sessions one `#` completion offers. */
export const SESSION_CANDIDATE_LIMIT = 100

/**
 * Collect file paths under a directory, breadth-first and capped.
 * @param cwd - the directory to walk.
 * @param limit - how many paths to collect before stopping.
 * @returns paths relative to `cwd`, with forward slashes.
 */
export async function listWorkspaceFiles(cwd: string, limit = FILE_CANDIDATE_LIMIT): Promise<readonly string[]> {
  const found: string[] = []
  let frontier: string[] = ['']
  while (frontier.length > 0 && found.length < limit) {
    const next: string[] = []
    for (const directory of frontier) {
      const entries = await readdir(join(cwd, directory), { withFileTypes: true }).catch(() => [])
      for (const entry of entries) {
        if (found.length >= limit) break
        const path = directory === '' ? entry.name : `${directory}/${entry.name}`
        if (entry.isDirectory()) {
          if (SKIPPED_DIRECTORIES.has(entry.name) || entry.name.startsWith('.')) continue
          next.push(path)
          continue
        }
        if (!entry.isFile()) continue
        found.push(path)
      }
    }
    frontier = next
  }
  return found
}

/**
 * Collect the session ids and titles the `#` prefix addresses.
 * @param client - the in-process API client.
 * @param limit - how many sessions to offer.
 * @returns ids first, then titles, newest sessions first.
 */
export async function sessionCandidates(client: IApiClient, limit = SESSION_CANDIDATE_LIMIT): Promise<readonly string[]> {
  const listed = await client.sessions.list({})
  if (!listed.result.ok) return []
  const summaries = [...listed.result.value.items]
    .filter(summary => summary.blank !== true)
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, limit)
  return summaries.map(summary => summary.sessionId)
}

/**
 * Build the three candidate sets from the working directory and the session store.
 * @param client - the in-process API client.
 * @param options - the working directory and the slash command names to offer.
 * @returns the sources Tab consults.
 */
export async function loadCompletionSources(
  client: IApiClient,
  options: { readonly cwd: string; readonly commands: readonly string[] },
): Promise<CompletionSources> {
  const [files, sessions] = await Promise.all([
    listWorkspaceFiles(options.cwd),
    sessionCandidates(client),
  ])
  return { commands: options.commands, files, sessions }
}

/**
 * The sources a surface can hold before the candidate scan runs.
 *
 * Command names come from the host registry and are needed for every submitted
 * line, while the file and session candidates are only read by Tab. Scanning a
 * large working directory and listing every stored session before the first frame
 * made the surface feel slow to open, so the scan waits for the first completion.
 * @param commands - slash command names, without the leading slash.
 * @returns sources with empty candidate sets.
 */
export function emptyCompletionSources(commands: readonly string[]): CompletionSources {
  return { commands, files: [], sessions: [] }
}

/**
 * Fill in the file and session candidates of existing sources.
 *
 * The sets are replaced in place so a surface that already holds the object sees
 * the candidates without rebinding anything.
 * @param client - the in-process API client.
 * @param options - the working directory and the sources to fill.
 * @returns the filled sources.
 */
export async function fillCompletionSources(
  client: IApiClient,
  options: { readonly cwd: string; readonly sources: CompletionSources },
): Promise<CompletionSources> {
  const [files, sessions] = await Promise.all([
    listWorkspaceFiles(options.cwd),
    sessionCandidates(client),
  ])
  const target = options.sources as { files: readonly string[]; sessions: readonly string[] }
  target.files = files
  target.sessions = sessions
  return options.sources
}
