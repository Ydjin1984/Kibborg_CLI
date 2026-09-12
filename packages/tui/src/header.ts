/**
 * Brand header of the fullscreen surface.
 *
 * Three static rows, exactly as `UI.md` §4.3 and `demo/kibborg-demo.bat` draw
 * them: the brand line with the working context, a live activity line carrying
 * the stage spinner and the band wave, and a thin rule separating the header
 * from the transcript. Only brightness and the wave phase move — never geometry.
 * @module @kibborg/tui/header
 */

import type { CellBuffer } from './framebuffer.ts'
import type { Rect } from './box.ts'
import type { Density } from './layout.ts'
import type { Span, StyledLine } from './log.ts'
import { paintStyledLine } from './logview.ts'
import { displayWidth } from './width.ts'
import { bandWave, elapsedLabel, spinnerFrame } from './anim.ts'

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
export const HEADER_HEIGHT = 3

/** Columns of the band wave. */
const BAND_CELLS = 22

/** Pad a span list with spaces so the trailing run ends at the right edge. */
function withRight(left: readonly Span[], right: readonly Span[], width: number): readonly Span[] {
  const used = (spans: readonly Span[]): number => spans.reduce((total, span) => total + displayWidth(span.text), 0)
  const gap = width - used(left) - used(right)
  if (gap <= 0) return left
  return [...left, { text: ' '.repeat(gap), token: 'Muted' }, ...right]
}

/**
 * Render the header rows: brand, live activity, rule.
 * @param state - session values to display.
 * @param width - available columns.
 * @returns three styled lines.
 */
export function renderHeader(state: HeaderState, width: number): readonly StyledLine[] {
  const brand: Span[] = state.title === undefined
    ? [
        { text: '  ', token: 'Muted' },
        { text: '◆ KIBBORG', token: 'Accent', bold: true },
        { text: `  ${state.version}`, token: 'Muted' },
        { text: `    ${state.cwd}`, token: 'Text' },
      ]
    : [...state.title]

  const right: Span[] = [{ text: state.model, token: 'Text' }]
  if (state.mode !== '') right.push({ text: `   ${state.mode}`, token: 'Accent' })

  const live: Span[] = [{ text: '  ', token: 'Muted' }]
  const tail: Span[] = []
  const used = (spans: readonly Span[]): number => spans.reduce((total, span) => total + displayWidth(span.text), 0)
  if (state.running) {
    live.push({ text: spinnerFrame(state.tick), token: 'Shimmer', bold: true })
    live.push({ text: `  ${state.activity ?? 'Working'}…`, token: 'Text' })
    live.push({ text: `  ${elapsedLabel(state.elapsedMs)}`, token: 'Muted' })
    live.push({ text: '   esc interrupt', token: 'Muted', dim: true })
    if (state.tokens !== undefined) live.push({ text: `   ${String(state.tokens)} tok`, token: 'Muted' })
  } else {
    live.push({ text: '◇', token: 'Subtle' })
    live.push({ text: '  ready', token: 'Muted' })
    live.push({ text: '   enter отправить   / команды   shift+tab режим', token: 'Muted', dim: true })
  }
  const bandCells = Math.max(0, Math.min(BAND_CELLS, width - used(live) - 4))
  if (bandCells >= 6) tail.push({ text: bandWave(state.tick, bandCells), token: 'Shimmer', dim: true })

  return [
    { spans: withRight(brand, right, width) },
    { spans: withRight(live, tail, width) },
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
