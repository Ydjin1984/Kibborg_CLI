/**
 * Brand header of the fullscreen surface.
 *
 * Two rows: the brand line with the working context and the active model, and a
 * thin rule separating the header from the transcript. Everything the session is
 * doing lives in the status row under the transcript, where it is read next to
 * the work it describes instead of competing with the brand.
 * @module @kibborg/tui/header
 */

import type { CellBuffer } from './framebuffer.ts'
import type { Rect } from './box.ts'
import type { Density } from './layout.ts'
import type { Span, StyledLine } from './log.ts'
import { paintStyledLine } from './logview.ts'
import { displayWidth } from './width.ts'

/** Everything the header displays about the session. */
export interface HeaderState {
  /** Active model name. */
  readonly model: string
  /** Working directory shown next to the brand. */
  readonly cwd: string
  /** Surface version. */
  readonly version: string
  /** Permission mode in force. */
  readonly mode: string
  /** Whether a turn is running. */
  readonly running: boolean
  /** Animation frame counter. */
  readonly tick: number
  /** Time the current turn has been running. */
  readonly elapsedMs: number
  /** Tokens spent this turn, when known. */
  readonly tokens?: number
  /** Git branch, when the directory is a repository. */
  readonly dirty?: boolean
  /** Git dirty marker follows the branch name when set. */
  readonly branch?: string
  /** Current stage verb, such as `Scanning`. */
  readonly activity?: string
  /** Detail level for this terminal width. */
  readonly density: Density
  /** The brand's own title row, replaced by the wordmark on the welcome screen. */
  readonly title?: readonly Span[]
}

/** Rows the header occupies. */
export const HEADER_HEIGHT = 2

/** Pad a span list with spaces so the trailing run ends at the right edge. */
function withRight(left: readonly Span[], right: readonly Span[], width: number): readonly Span[] {
  const used = (spans: readonly Span[]): number => spans.reduce((total, span) => total + displayWidth(span.text), 0)
  const gap = width - used(left) - used(right)
  if (gap <= 0) return left
  return [...left, { text: ' '.repeat(gap), token: 'Muted' }, ...right]
}

/**
 * Render the header rows: brand, rule.
 *
 * The whole row is one statement about where the session is: the brand, the
 * version, the working directory, the model that answers, and the permission
 * mode in force.
 * @param state - session values to display.
 * @param width - available columns.
 * @returns two styled lines.
 */
export function renderHeader(state: HeaderState, width: number): readonly StyledLine[] {
  const brand: Span[] = state.title === undefined
    ? [
        { text: '  ', token: 'Muted' },
        { text: '◆ KIBBORG', token: 'AgentKibborg', bold: true },
        { text: `  ${state.version}`, token: 'Muted' },
        { text: `    ${state.cwd}`, token: 'Text' },
      ]
    : [...state.title]

  const right: Span[] = []
  if (state.running) right.push({ text: '●', token: 'Success' }, { text: ' ', token: 'Muted' })
  right.push({ text: state.model, token: 'Text' })
  if (state.mode !== '') right.push({ text: `   ${state.mode}`, token: 'RoleBadge' })

  return [
    { spans: withRight(brand, right, width) },
    { spans: [{ text: `  ${'─'.repeat(Math.max(0, width - 4))}`, token: 'Subtle' }] },
  ]
}

/**
 * Draw the header into its region.
 * @param buf - frame buffer to paint into.
 * @param rect - header region.
 * @param state - session values to display.
 */
export function drawHeader(buf: CellBuffer, rect: Rect, state: HeaderState): void {
  if (rect.h <= 0 || rect.w <= 0) return
  const lines = renderHeader(state, rect.w)
  for (let row = 0; row < lines.length && row < rect.h; row++) {
    const line = lines[row]
    if (line === undefined) continue
    paintStyledLine(buf, rect.x, rect.y + row, rect.w, line)
  }
}
