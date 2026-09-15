/**
 * Data behind the fullscreen panels (`UI.md` §4.11).
 *
 * Panels show live state, and live state arrives on the mux stream: jobs and the
 * inbox queue are whole snapshots pushed per subscription, and goals, todos, and
 * the context meters are projection units. So one short subscription collects
 * everything a panel set needs, and durable listings (sessions, subagents) come
 * from their own domains. Nothing here renders — the renderer draws what this
 * returns, and {@link formatPanelSnapshot} exists for tests and for the inline
 * fallback, not as a second UI.
 * @module @kibborg/client-node/panels
 */

import type { IApiClient } from '@deepseek-ai/dsh-host-apiproxy/client'
import type { QueuedInboxItem } from '@deepseek-ai/dsh-host-apiproxy/api'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { padRight } from '@kibborg/tui'

/** Panel names the fullscreen layout can show. */
export type PanelName = 'sessions' | 'subagents' | 'jobs' | 'queue' | 'context' | 'goals' | 'todos'

/** Every panel name, in the order the layout lists them. */
export const PANEL_NAMES: readonly PanelName[] = ['sessions', 'subagents', 'jobs', 'queue', 'context', 'goals', 'todos']

/** How long one snapshot waits for the mux baseline. */
export const PANEL_BASELINE_TIMEOUT_MS = 1500

/** Projection keys the context, goals, and todos panels read. */
const PROJECTION_KEYS = ['contextPressure', 'contextBreakdown', 'tokenUsage', 'goal', 'todos'] as const

/** One session row a panel shows. */
export interface PanelSessionRow {
  /** Session identity. */
  readonly sessionId: string
  /** Durable title, when the session has one. */
  readonly title?: string
  /** Last activity, epoch milliseconds. */
  readonly updatedAt: number
  /** Working directory the session was created for. */
  readonly cwd?: string
}

/** One subagent row a panel shows. */
export interface PanelSubagentRow {
  /** Subagent identity. */
  readonly id: string
  /** `child` for a live delegation, `diagnostic` for a refused one. */
  readonly kind: string
  /** Delegation mode (`spawn`, …) when the row is a child. */
  readonly mode?: string
  /** Current activity of that child. */
  readonly activity?: string
  /** Human label the delegation carried. */
  readonly label?: string
  /** Why a diagnostic row exists. */
  readonly reason?: string
}

/** One background job as the host reports it. */
export interface PanelJobRow {
  /** Job identity. */
  readonly id: string
  /** Human description, when the host provides one. */
  readonly label?: string
  /** Whether the job already finished. */
  readonly done: boolean
  /** Raw view, so a caller can read fields this panel does not name. */
  readonly raw: unknown
}

/** Everything the panels read for one session. */
export interface PanelSnapshot {
  /** Recent sessions, newest first. */
  readonly sessions: readonly PanelSessionRow[]
  /** Subagents this session spawned. */
  readonly subagents: readonly PanelSubagentRow[]
  /** Background jobs visible from this session. */
  readonly jobs: readonly PanelJobRow[]
  /** Messages the user queued while the agent was busy. */
  readonly queue: readonly QueuedInboxItem[]
  /** Goals projection value, as the host publishes it. */
  readonly goals: unknown
  /** Todos projection value, as the host publishes it. */
  readonly todos: unknown
  /** Context meters: pressure, breakdown, and token usage. */
  readonly context: {
    readonly pressure?: unknown
    readonly breakdown?: unknown
    readonly usage?: unknown
  }
  /** Whether every panel got a live baseline within the wait. */
  readonly complete: boolean
}

/** Read the durable title out of a session-list projection block. */
function titleOf(values: unknown): string | undefined {
  if (values === null || typeof values !== 'object') return undefined
  const title = (values as Record<string, unknown>)['title']
  if (title === null || typeof title !== 'object') return undefined
  const text = (title as { title?: unknown }).title
  return typeof text === 'string' && text !== '' ? text : undefined
}

/** Read one job view into a panel row. */
function jobRow(raw: unknown): PanelJobRow {
  const record = (raw ?? {}) as Record<string, unknown>
  const id = typeof record['id'] === 'string' ? record['id'] : JSON.stringify(record).slice(0, 24)
  const label = typeof record['label'] === 'string' ? record['label'] : typeof record['command'] === 'string' ? record['command'] : undefined
  const status = typeof record['status'] === 'string' ? record['status'] : undefined
  return {
    id,
    ...(label === undefined ? {} : { label }),
    done: status === 'exited' || status === 'done' || record['done'] === true,
    raw,
  }
}

/** Read one subagent catalog entry into a panel row. */
function subagentRow(entry: unknown): PanelSubagentRow {
  const record = (entry ?? {}) as Record<string, unknown>
  const id = String(record['id'] ?? '')
  const kind = typeof record['kind'] === 'string' ? record['kind'] : 'child'
  return {
    id,
    kind,
    ...(typeof record['mode'] === 'string' ? { mode: record['mode'] } : {}),
    ...(typeof record['activity'] === 'string' ? { activity: record['activity'] } : {}),
    ...(typeof record['label'] === 'string' ? { label: record['label'] } : {}),
    ...(typeof record['reason'] === 'string' ? { reason: record['reason'] } : {}),
  }
}

/**
 * Collect one panel snapshot for a session.
 * @param client - the API client this invocation talks through.
 * @param sessionId - the session whose panels are read.
 * @param options - how long to wait for the mux baseline.
 * @returns the snapshot; panels with no baseline stay empty and `complete` is false.
 */
export async function readPanelSnapshot(
  client: IApiClient,
  sessionId: SessionId,
  options: { readonly timeoutMs?: number } = {},
): Promise<PanelSnapshot> {
  const controller = new AbortController()
  let jobs: readonly unknown[] | undefined
  let queue: readonly QueuedInboxItem[] | undefined
  const projections: Record<string, unknown> = {}
  const seen = new Set<string>(PROJECTION_KEYS)
  const complete = (): boolean => jobs !== undefined && queue !== undefined && seen.size === 0
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? PANEL_BASELINE_TIMEOUT_MS)

  const listed = await client.sessions.list({})
  const sessions = listed.result.ok
    ? [...listed.result.value.items]
      .filter(item => item.blank !== true)
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, 50)
      .map(item => ({
        sessionId: item.sessionId,
        updatedAt: item.updatedAt,
        ...(titleOf(item.projections?.values) === undefined ? {} : { title: titleOf(item.projections?.values) as string }),
        ...(item.cwd === undefined ? {} : { cwd: item.cwd }),
      }))
    : []

  const children = await client.subagents.list({ parentSessionId: sessionId })
  const subagents = children.result.ok ? children.result.value.entries.map(subagentRow) : []

  try {
    for await (const frame of client.events.mux({}, controller.signal)) {
      const payload = frame.payload
      if ('sessionId' in payload && payload.sessionId !== sessionId) continue
      if (payload.type === 'session/jobs') jobs = payload.jobs
      else if (payload.type === 'session/queue') queue = payload.items
      else if (payload.type === 'session/projection') {
        const key = String(payload.key)
        if ((PROJECTION_KEYS as readonly string[]).includes(key)) {
          projections[key] = payload.value
          seen.delete(key)
        }
      }
      if (complete()) break
    }
  } catch {
    // The timeout abort is the normal end when a session has no live baseline.
  } finally {
    clearTimeout(timer)
    controller.abort()
  }

  return {
    sessions,
    subagents,
    jobs: (jobs ?? []).map(jobRow),
    queue: queue ?? [],
    goals: projections['goal'],
    todos: projections['todos'],
    context: {
      ...(projections['contextPressure'] === undefined ? {} : { pressure: projections['contextPressure'] }),
      ...(projections['contextBreakdown'] === undefined ? {} : { breakdown: projections['contextBreakdown'] }),
      ...(projections['tokenUsage'] === undefined ? {} : { usage: projections['tokenUsage'] }),
    },
    complete: jobs !== undefined && queue !== undefined,
  }
}

/** Render tokens-like numbers the context panel shows. */
function tokensOf(value: unknown): string {
  const record = (value ?? {}) as Record<string, unknown>
  const used = typeof record['projectedTokens'] === 'number' ? record['projectedTokens'] : record['pressureTokens']
  const window = record['contextWindow']
  if (typeof used !== 'number') return 'unknown'
  return typeof window === 'number' ? `${String(used)} / ${String(window)}` : String(used)
}

/**
 * Render one panel as text lines.
 *
 * The fullscreen renderer draws panels into its own cells; this projection is
 * what tests assert and what a plain terminal can print when the cell renderer
 * is unavailable.
 * @param snapshot - the collected data.
 * @param panel - which panel to render.
 * @returns one line per row, header first.
 */
export function formatPanelSnapshot(snapshot: PanelSnapshot, panel: PanelName): string[] {
  switch (panel) {
    case 'sessions': {
      if (snapshot.sessions.length === 0) return ['no sessions']
      const width = snapshot.sessions.reduce((max, row) => Math.max(max, row.sessionId.length), 0)
      return snapshot.sessions.map(row => `${padRight(row.sessionId, width)}  ${row.title ?? ''}  ${row.cwd ?? ''}`.trimEnd())
    }
    case 'subagents': {
      if (snapshot.subagents.length === 0) return ['no subagents']
      const width = snapshot.subagents.reduce((max, row) => Math.max(max, row.id.length), 0)
      return snapshot.subagents.map(row =>
        row.kind === 'diagnostic'
          ? `${padRight(row.id, width)}  diagnostic: ${row.reason ?? ''}`
          : `${padRight(row.id, width)}  ${row.mode ?? ''} · ${row.activity ?? ''}  ${row.label ?? ''}`.trimEnd())
    }
    case 'jobs': {
      if (snapshot.jobs.length === 0) return ['no background jobs']
      const width = snapshot.jobs.reduce((max, row) => Math.max(max, row.id.length), 0)
      return snapshot.jobs.map(row => `${padRight(row.id, width)}  ${row.done ? 'done' : 'running'}  ${row.label ?? ''}`.trimEnd())
    }
    case 'queue': {
      if (snapshot.queue.length === 0) return ['queue is empty']
      const width = snapshot.queue.reduce((max, item) => Math.max(max, String(item.id).length), 0)
      return snapshot.queue.map(item => `${padRight(String(item.id), width)}  ${item.placement}`)
    }
    case 'context': {
      const lines = [`context  ${tokensOf(snapshot.context.pressure)}`]
      const breakdown = (snapshot.context.breakdown ?? {}) as Record<string, unknown>
      for (const [key, value] of Object.entries(breakdown)) {
        if (typeof value === 'number') lines.push(`  ${padRight(key, 14)} ${String(value)}`)
      }
      return lines
    }
    case 'goals': {
      const goals = snapshot.goals
      if (goals === undefined || goals === null) return ['no goal']
      const record = goals as Record<string, unknown>
      const text = typeof record['text'] === 'string' ? record['text'] : JSON.stringify(goals)
      return [`${String(record['status'] ?? 'active')}  ${text}`]
    }
    case 'todos': {
      const todos = snapshot.todos
      if (todos === undefined || todos === null) return ['no todos']
      const list = Array.isArray(todos) ? todos : ((todos as Record<string, unknown>)['items'] ?? [])
      if (!Array.isArray(list) || list.length === 0) return ['no todos']
      return list.map(entry => {
        const record = (entry ?? {}) as Record<string, unknown>
        const mark = record['status'] === 'completed' ? '✔️' : record['status'] === 'in_progress' ? '▸' : '·'
        return `${mark} ${String(record['content'] ?? record['text'] ?? '')}`
      })
    }
    default:
      return []
  }
}
