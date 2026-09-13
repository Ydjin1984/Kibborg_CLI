/**
 * Session-domain commands of the terminal surface.
 *
 * Listing, searching, renaming, forking, and resuming all go through the same
 * API proxy the browser uses, so the terminal and the Web GUI see one session
 * registry and one set of durable logs. Resuming prints the session's existing
 * history before handing the terminal back to the interactive loop.
 * @module @kibborg/client-node/sessions
 */

import type { HistoryEntry, SessionSummary } from '@deepseek-ai/dsh-host-apiproxy/api'
import type { IApiClient } from '@deepseek-ai/dsh-host-apiproxy/client'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session/types'
import { paletteFor, sessionTable, type Palette, type SessionRow } from '@kibborg/tui'
import { renderSessionHistory } from './history-render.ts'

/** Title projection key owned by the session title plugins. */
const TITLE_KEY = 'title'

/** How many sessions the list command shows by default. */
export const SESSION_LIST_LIMIT = 20

/** A session the client resolved for resuming or forking. */
export interface ResolvedSession {
  /** The session identity to use from here on. */
  readonly sessionId: SessionId
  /** The durable title, when the session has one. */
  readonly title?: string
  /** Whether an agent already has this session attached. */
  readonly running?: boolean
}

/** How many rows may cost one extra history read to learn their title. */
const TITLE_LOOKUP_BUDGET = 8

/**
 * The session ids the registry hides from grouping surfaces.
 *
 * `session.list` carries no archive flag, so the archive set is read from the
 * workspace registry — the same baseline the Web sidebar filters with. A host
 * without that registry answers nothing, and every session stays visible.
 * @param client - the in-process API client.
 * @returns the archived ids as a set.
 */
async function archivedSessionIds(client: IApiClient): Promise<ReadonlySet<string>> {
  const listed = await client.workspace.list({})
  if (!listed.result.ok) return new Set()
  return new Set<string>(listed.result.value.archivedSessionIds)
}

/**
 * Read a title out of a projections block, tolerating an absent or foreign shape.
 * @param values - the projections block's `values`, or `undefined`.
 * @returns the durable title, or `undefined` when the block carries none.
 */
function titleFromValues(values: unknown): string | undefined {
  if (typeof values !== 'object' || values === null) return undefined
  const value = (values as Record<string, unknown>)[TITLE_KEY]
  if (typeof value !== 'object' || value === null) return undefined
  const title = (value as { title?: unknown }).title
  return typeof title === 'string' && title !== '' ? title : undefined
}

/** Read a projection block's title, tolerating an absent or foreign-shaped block. */
function titleOf(summary: SessionSummary): string | undefined {
  return titleFromValues(summary.projections?.values)
}

/**
 * Learn the titles the session list did not carry.
 *
 * A list row only carries a projection baseline when one is available, which a
 * cold session often lacks; the session's history tail is the same projection
 * source, so the first few unnamed rows pay one read to become legible.
 * @param client - the in-process API client.
 * @param summaries - the rows, already sorted and capped.
 * @returns id → title for the rows whose title is known.
 */
async function knownTitles(
  client: IApiClient,
  summaries: readonly SessionSummary[],
): Promise<Map<string, string>> {
  const titles = new Map<string, string>()
  let lookups = 0
  for (const summary of summaries) {
    const inline = titleOf(summary)
    if (inline !== undefined) {
      titles.set(summary.sessionId, inline)
      continue
    }
    if (lookups >= TITLE_LOOKUP_BUDGET) continue
    lookups += 1
    const page = await client.sessions.history({ sessionId: summary.sessionId, maxMessages: 1 })
    if (!page.result.ok) continue
    const title = titleFromValues(page.result.value.projections?.values)
    if (title !== undefined) titles.set(summary.sessionId, title)
  }
  return titles
}

/** Map a session summary onto the renderer's row. */
function rowOf(summary: SessionSummary, title?: string): SessionRow {
  const resolved = title ?? titleOf(summary)
  return {
    sessionId: summary.sessionId,
    updatedAt: summary.updatedAt,
    running: summary.running,
    blank: summary.blank,
    ...(resolved === undefined ? {} : { title: resolved }),
    ...(summary.cwd === undefined ? {} : { cwd: summary.cwd }),
  }
}

/** The palette and width every session command renders with. */
function renderContext(): { palette: Palette; cols: number } {
  return { palette: paletteFor(process.env, process.stdout.isTTY === true), cols: process.stdout.columns ?? 88 }
}

/**
 * Print the session list.
 * @param client - the in-process API client.
 * @param options - `json` selects machine-readable output; `limit` caps the rows.
 * @returns the process exit code.
 */
export async function listSessions(
  client: IApiClient,
  options: { json: boolean; limit?: number },
): Promise<number> {
  const listed = await client.sessions.list({})
  if (!listed.result.ok) {
    process.stderr.write(`kibborg: session.list failed: ${listed.result.error.message}\n`)
    return 1
  }
  const archived = await archivedSessionIds(client)
  const summaries = [...listed.result.value.items]
    .filter(summary => summary.blank !== true && !archived.has(summary.sessionId))
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, options.limit ?? SESSION_LIST_LIMIT)
  if (options.json) {
    const titles = await knownTitles(client, summaries)
    process.stdout.write(`${JSON.stringify(summaries.map(summary => rowOf(summary, titles.get(summary.sessionId))), undefined, 2)}\n`)
    return 0
  }
  const { palette, cols } = renderContext()
  const titles = await knownTitles(client, summaries)
  const rows = sessionTable(summaries.map(summary => rowOf(summary, titles.get(summary.sessionId))), {
    palette,
    cols,
    now: Date.now(),
    cwd: process.cwd(),
  })
  process.stdout.write(`${rows.join('\n')}\n`)
  return 0
}

/**
 * Search session content.
 * @param client - the in-process API client.
 * @param query - the search text.
 * @param options - `json` selects machine-readable output.
 * @returns the process exit code.
 */
export async function searchSessions(
  client: IApiClient,
  query: string,
  options: { json: boolean },
): Promise<number> {
  const controller = new AbortController()
  const found = await client.sessions.search({ query }, controller.signal)
  if (!found.result.ok) {
    // Content search is switched off in this profile (the base layer mounts the
    // index with `openAt: never`), so say that instead of leaking the raw error:
    // a user cannot act on "session search failed".
    const reason = found.result.error.message
    process.stderr.write(
      reason.toLowerCase().includes('disabled') || reason.toLowerCase().includes('search failed')
        ? 'kibborg: поиск по содержимому сессий выключен в этом профиле; используйте kibborg sessions и kibborg resume\n'
        : `kibborg: session.search failed: ${reason}\n`,
    )
    return 1
  }
  const items = found.result.value.items
  if (options.json) {
    process.stdout.write(`${JSON.stringify(items, undefined, 2)}\n`)
    return 0
  }
  const { palette } = renderContext()
  if (items.length === 0) {
    process.stdout.write(`${palette.paint('  no matches', 'Muted')}\n`)
    return 0
  }
  for (const item of items) {
    process.stdout.write(`  ${palette.paint(item.sessionId.slice(0, 8), 'Subtle')}  ${palette.paint(item.snippet, 'Text')}\n`)
  }
  return 0
}

/** Rename one session and print the accepted title. */
async function renameSession(
  client: IApiClient,
  sessionId: SessionId,
  title: string,
): Promise<number> {
  const renamed = await client.sessions.rename({ sessionId, title })
  if (!renamed.result.ok) {
    process.stderr.write(`kibborg: session.rename failed: ${renamed.result.error.message}\n`)
    return 1
  }
  process.stdout.write(`${renamed.result.value.title}\n`)
  return 0
}

/** Fork one session and print the child identity. */
async function forkSession(client: IApiClient, sessionId: SessionId): Promise<number> {
  const forked = await client.sessions.fork({ sessionId })
  if (!forked.result.ok) {
    process.stderr.write(`kibborg: session.fork failed: ${forked.result.error.message}\n`)
    return 1
  }
  process.stdout.write(`${forked.result.value.sessionId}\n`)
  return 0
}

/**
 * Resolve which session this invocation addresses.
 *
 * An explicit id is used as given; otherwise the newest session of this
 * directory wins, which is what `--continue` means. A directory with no session
 * yet is not an error for a task: the caller creates a fresh one.
 * @param client - the in-process API client.
 * @param requested - the id from the command line, when one was given.
 * @returns the resolved session, or `undefined` when none matches.
 */
export async function resolveSession(
  client: IApiClient,
  requested: string | undefined,
): Promise<ResolvedSession | undefined> {
  if (requested !== undefined && requested !== '') {
    return { sessionId: requested as SessionId }
  }
  const listed = await client.sessions.list({})
  if (!listed.result.ok) return undefined
  const cwd = process.cwd()
  const candidates = listed.result.value.items
    .filter(summary => summary.blank !== true)
    .sort((left, right) => right.updatedAt - left.updatedAt)
  const match = candidates.find(summary => summary.cwd === cwd) ?? candidates[0]
  if (match === undefined) return undefined
  const title = titleOf(match)
  return {
    sessionId: match.sessionId,
    running: match.running,
    ...(title === undefined ? {} : { title }),
  }
}

/** How many history messages a resume prints before it continues. */
export const HISTORY_DEFAULT_LIMIT = 200

/** How many older pages one resume may walk. */
const HISTORY_MAX_PAGES = 10

/**
 * Print a session's existing history, newest page last.
 *
 * The tail page is fetched first and older pages are prepended until the caller's
 * budget is reached, so a resumed conversation reads in log order without
 * holding more than the budget in memory.
 * @param client - the in-process API client.
 * @param sessionId - the session whose log is printed.
 * @param limit - how many messages to collect, counted by the host's page rule.
 * @returns the process exit code.
 */
export async function printHistory(
  client: IApiClient,
  sessionId: SessionId,
  limit: number = HISTORY_DEFAULT_LIMIT,
): Promise<number> {
  const { palette, cols } = renderContext()
  const read = await readHistoryEvents(client, sessionId, limit)
  if (read === undefined) return 1
  process.stdout.write(`  ${palette.paint(read.title ?? sessionId, 'Accent')}\n`)
  renderSessionHistory(read.events, {
    palette,
    sink: { write: chunk => void process.stdout.write(chunk) },
    cols,
  })
  process.stdout.write(`  ${palette.paint(`${String(read.events.length)} events · ${sessionId}`, 'Muted')}\n`)
  return 0
}

/**
 * Read a session's history, oldest event first.
 *
 * The host paginates from the tail, so this walks pages backwards until the
 * budget is met and returns the collected window in conversation order. Callers
 * that only render a transcript and callers that search it share this read.
 * @param client - the in-process API client.
 * @param sessionId - the session whose log is read.
 * @param limit - how many messages to collect, counted by the host's page rule.
 * @returns the events with the durable title, or `undefined` when the read failed.
 */
export async function readHistoryEvents(
  client: IApiClient,
  sessionId: SessionId,
  limit: number = HISTORY_DEFAULT_LIMIT,
): Promise<{ readonly events: readonly SessionEvent[]; readonly title: string | undefined } | undefined> {
  const events: SessionEvent[] = []
  let title: string | undefined
  let beforeSeq: number | undefined
  for (let page = 0; page < HISTORY_MAX_PAGES; page += 1) {
    const remaining = Math.max(1, limit - events.length)
    const result = await client.sessions.history({
      sessionId,
      maxMessages: Math.min(200, remaining),
      ...(beforeSeq === undefined ? {} : { beforeSeq }),
    })
    if (!result.result.ok) {
      process.stderr.write(`kibborg: session.history failed: ${result.result.error.message}\n`)
      return undefined
    }
    const value = result.result.value
    if (page === 0) title = titleFromValues(value.projections?.values)
    const pageEvents = entriesOf(value.events)
    events.unshift(...pageEvents)
    if (value.hasMore !== true || events.length >= limit) break
    const oldest = pageEvents[0]
    if (oldest === undefined) break
    beforeSeq = oldest.seq
  }
  return { events, title }
}

/** Extract the raw events from a history page. */
function entriesOf(entries: readonly HistoryEntry[]): SessionEvent[] {
  return entries.map(entry => entry.event)
}

/** How long a job snapshot waits for its subscription baseline. */
const JOBS_BASELINE_TIMEOUT_MS = 3000

/**
 * Print the subagents a session spawned.
 * @param client - the in-process API client.
 * @param sessionId - the parent session.
 * @param options - `json` selects machine-readable output.
 * @returns the process exit code.
 */
export async function listSubagents(
  client: IApiClient,
  sessionId: SessionId,
  options: { json: boolean },
): Promise<number> {
  const listed = await client.subagents.list({ parentSessionId: sessionId })
  if (!listed.result.ok) {
    process.stderr.write(`kibborg: subagent.list failed: ${listed.result.error.message}\n`)
    return 1
  }
  const catalog = listed.result.value
  const items = catalog.entries
  if (!catalog.parentAvailable) {
    process.stderr.write('kibborg: this session has no parent agent to list children for\n')
  }
  if (options.json) {
    process.stdout.write(`${JSON.stringify(catalog, undefined, 2)}\n`)
    return 0
  }
  const { palette } = renderContext()
  if (items.length === 0) {
    process.stdout.write(`${palette.paint('  no subagents', 'Muted')}\n`)
    return 0
  }
  for (const item of items) {
    const id = palette.paint(String(item.id).slice(-8), 'Subtle')
    if (item.kind === 'diagnostic') {
      process.stdout.write(`  ${id}  ${palette.paint(`diagnostic: ${item.reason}`, 'Error')}\n`)
      continue
    }
    const mode = palette.paint(`${item.mode} · ${item.activity}`, 'Muted')
    const label = palette.paint(item.label ?? '', 'Text')
    process.stdout.write(`  ${id}  ${mode}  ${label}\n`)
  }
  return 0
}

/**
 * Print the background jobs a session can see.
 *
 * Jobs are live state, not a durable record: the gateway sends a whole snapshot
 * per subscription, so this waits for the first `session/jobs` frame of that
 * subscription and reports the empty set when none arrives in time.
 * @param client - the in-process API client.
 * @param sessionId - the session whose jobs are listed.
 * @param options - `json` selects machine-readable output.
 * @returns the process exit code.
 */
export async function listJobs(
  client: IApiClient,
  sessionId: SessionId,
  options: { json: boolean },
): Promise<number> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), JOBS_BASELINE_TIMEOUT_MS)
  let jobs: readonly unknown[] | undefined
  try {
    for await (const frame of client.events.mux({}, controller.signal)) {
      const payload = frame.payload
      if (payload.type === 'session/jobs' && payload.sessionId === sessionId) {
        jobs = payload.jobs
        break
      }
    }
  } catch {
    // The timeout abort is the normal end of a session with no baseline.
  } finally {
    clearTimeout(timer)
    controller.abort()
  }
  const list = jobs ?? []
  if (options.json) {
    process.stdout.write(`${JSON.stringify(list, undefined, 2)}\n`)
    return 0
  }
  const { palette } = renderContext()
  if (list.length === 0) {
    process.stdout.write(`${palette.paint('  no background jobs', 'Muted')}\n`)
    return 0
  }
  for (const job of list) {
    process.stdout.write(`  ${palette.paint(JSON.stringify(job), 'Text')}\n`)
  }
  return 0
}

/** What a session command needs to run. */
export interface SessionCommandResult {
  /** The process exit code. */
  readonly code: number
}

/**
 * Run one session command from the invocation intent.
 * @param client - the in-process API client.
 * @param intent - the launcher's intent.
 * @returns the exit code and, for session-shaped commands, the resolved session.
 */
export async function runSessionCommand(
  client: IApiClient,
  intent: {
    readonly kind: string
    readonly sessionId?: string
    readonly title?: string
    readonly query?: string
    readonly json?: boolean
    readonly fork?: boolean
    readonly continue?: boolean
  },
): Promise<SessionCommandResult> {
  switch (intent.kind) {
    case 'sessions':
      return { code: await listSessions(client, { json: intent.json === true }) }
    case 'search':
      return { code: await searchSessions(client, intent.query ?? '', { json: intent.json === true }) }
    case 'rename': {
      const resolved = await resolveSession(client, intent.sessionId)
      if (resolved === undefined) {
        process.stderr.write('kibborg: no session to rename\n')
        return { code: 1 }
      }
      return { code: await renameSession(client, resolved.sessionId, intent.title ?? '') }
    }
    case 'fork': {
      const resolved = await resolveSession(client, intent.sessionId)
      if (resolved === undefined) {
        process.stderr.write('kibborg: no session to fork\n')
        return { code: 1 }
      }
      return { code: await forkSession(client, resolved.sessionId) }
    }
    case 'agents': {
      const resolved = await resolveSession(client, intent.sessionId)
      if (resolved === undefined) {
        process.stderr.write('kibborg: no session to inspect\n')
        return { code: 1 }
      }
      return { code: await listSubagents(client, resolved.sessionId, { json: intent.json === true }) }
    }
    case 'jobs': {
      const resolved = await resolveSession(client, intent.sessionId)
      if (resolved === undefined) {
        process.stderr.write('kibborg: no session to inspect\n')
        return { code: 1 }
      }
      return { code: await listJobs(client, resolved.sessionId, { json: intent.json === true }) }
    }
    case 'archive': {
      const resolved = await resolveSession(client, intent.sessionId)
      if (resolved === undefined) {
        process.stderr.write('kibborg: no session to archive\n')
        return { code: 1 }
      }
      const archived = await client.workspace.archiveSession({ sessionId: resolved.sessionId })
      if (!archived.result.ok) {
        process.stderr.write(`kibborg: workspace.archiveSession failed: ${archived.result.error.message}\n`)
        return { code: 1 }
      }
      process.stdout.write(`  archived ${resolved.sessionId}\n`)
      return { code: 0 }
    }
    default:
      process.stderr.write(`kibborg: unsupported session command ${intent.kind}\n`)
      return { code: 2 }
  }
}
