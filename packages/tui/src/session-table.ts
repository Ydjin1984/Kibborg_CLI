/**
 * Session table renderer.
 *
 * A session list is a table of aligned rows: the short id, how long ago the
 * session moved, a marker for the current project, and the title. The title is
 * the only elastic column, and it truncates with an ellipsis so no row ever
 * exceeds the terminal width.
 * @module @kibborg/tui/session-table
 */

import { displayWidth, padRight, takeHeadWidth } from './width.ts'
import type { Palette } from './tokens.ts'

/** One session row as the client receives it. */
export interface SessionRow {
  /** Durable session identity; only its first eight characters are shown. */
  readonly sessionId: string
  /** Unix epoch milliseconds of the last activity. */
  readonly updatedAt: number
  /** Durable title, when the session has one. */
  readonly title?: string
  /** Session working directory, when recorded. */
  readonly cwd?: string
  /** Whether the agent is running right now. */
  readonly running?: boolean
  /** Whether no turn has run yet. */
  readonly blank?: boolean
}

/** Options of {@link sessionTable}. */
export interface SessionTableOptions {
  /** Active palette. */
  readonly palette: Palette
  /** Total terminal width in columns. */
  readonly cols: number
  /** Current time, injected so the output stays testable. */
  readonly now: number
  /** Directory the table is rendered for; rows of this directory are marked. */
  readonly cwd?: string
}

/** Leading margin shared with the conversation body. */
const MARGIN = '  '

/** Fixed column widths: id, age, and the project marker. */
const ID_WIDTH = 8
const AGE_WIDTH = 5
const MARKER_WIDTH = 2

/**
 * Reduce a session id to the eight characters shown in the table.
 *
 * Ids arrive in two shapes — a bare uuid and the `session-<uuid>` form the
 * harness mints for some sessions — and a naive prefix would show a column of
 * identical `session-` rows, so the marker prefix is dropped first.
 * @param sessionId - the full session identity.
 * @returns at most eight identifying characters.
 */
function shortId(sessionId: string): string {
  const prefix = 'session-'
  const bare = sessionId.startsWith(prefix) ? sessionId.slice(prefix.length) : sessionId
  return bare.slice(0, ID_WIDTH)
}

/**
 * Truncate a title to a column budget, appending an ellipsis when it is cut.
 * @param title - the title to fit.
 * @param budget - the columns available for the title.
 * @returns the title, cut to the budget when it does not fit.
 */
function fitTitle(title: string, budget: number): string {
  if (displayWidth(title) <= budget) return title
  if (budget <= 1) return takeHeadWidth(title, budget)
  return `${takeHeadWidth(title, budget - 1)}…`
}

/**
 * Render a session list as aligned rows.
 * @param rows - the session rows to render, in the order the caller sorted them.
 * @param options - palette, terminal width, current time, and the current directory.
 * @returns one line per session, or a single line when there are none.
 */
export function sessionTable(rows: readonly SessionRow[], options: SessionTableOptions): readonly string[] {
  const { palette, cols, now, cwd } = options
  if (rows.length === 0) return [palette.paint(`${MARGIN}no sessions`, 'Muted')]
  const fixed = displayWidth(MARGIN) + ID_WIDTH + 2 + AGE_WIDTH + 2 + MARKER_WIDTH
  const budget = Math.max(4, cols - fixed)
  return rows.map(row => {
    const id = palette.paint(shortId(row.sessionId), 'Subtle')
    const age = palette.paint(padRight(relativeAge(row.updatedAt, now), AGE_WIDTH), 'Muted')
    const isCurrent = cwd !== undefined && row.cwd !== undefined && row.cwd === cwd
    const marker = isCurrent ? palette.paint('▸ ', 'Accent') : '  '
    const titled = row.title !== undefined && row.title !== ''
    const title = palette.paint(fitTitle(titled ? row.title as string : '(no title)', budget), titled ? 'Text' : 'Muted')
    return `${MARGIN}${id}  ${age}  ${marker}${title}`
  })
}

/**
 * Render a compact relative age.
 * @param updatedAt - the timestamp to render.
 * @param now - the current time for comparison.
 * @returns `now`, `14m`, `2h`, `3d`, or `YYYY-MM-DD` beyond a week.
 */
export function relativeAge(updatedAt: number, now: number): string {
  const diff = now - updatedAt
  if (diff < 60_000) return 'now'
  if (diff < 3_600_000) return `${String(Math.floor(diff / 60_000))}m`
  if (diff < 86_400_000) return `${String(Math.floor(diff / 3_600_000))}h`
  if (diff < 604_800_000) return `${String(Math.floor(diff / 86_400_000))}d`
  const date = new Date(updatedAt)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${String(date.getFullYear())}-${month}-${day}`
}
