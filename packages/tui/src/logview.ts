/**
 * Transcript drawing for the fullscreen surface.
 *
 * The view owns only the scroll offset: it slices the rendered transcript,
 * paints it into a rectangle, and reports where the viewport landed. A sticky
 * heading keeps the current entry identifiable while the transcript scrolls.
 * @module @kibborg/tui/logview
 */

import type { CellBuffer } from './framebuffer.ts'
import type { Rect } from './box.ts'
import type { StyledLine, Transcript } from './log.ts'
import { clampScroll, lineWidth, plainText, scrollIndicator, transcriptWindow } from './log.ts'

/** Scroll state of the transcript view. */
export interface LogViewState {
  /** Rows hidden above the viewport. */
  readonly offset: number
  /** Whether the viewport stays pinned to the newest line. */
  readonly follow: boolean
}

/** One transcript line and the frame row it was painted on. */
export interface PaintedRow {
  /** Absolute row in the frame buffer. */
  readonly row: number
  /** The line painted there. */
  readonly line: StyledLine
}

/** Where the viewport ended up after drawing. */
export interface LogViewResult {
  /** Offset actually used. */
  readonly offset: number
  /** Total rendered lines. */
  readonly total: number
  /** Heading pinned to the top row, or `null` when the first row is a heading. */
  readonly sticky: string | null
  /** The rows the viewport shows, top to bottom. */
  readonly visible: readonly StyledLine[]
  /**
   * Every painted row with its frame position.
   *
   * The pinned heading shifts the content down by one row, so a caller that maps a
   * pointer position to a line has to read the mapping the view produced instead
   * of recomputing it from the scroll offset.
   */
  readonly painted: readonly PaintedRow[]
}

/**
 * A transcript the view can read: either every rendered line, or the parts a
 * frame takes its viewport from.
 */
export type LogSource = readonly StyledLine[] | Transcript

/** Whether the source is a transcript of parts rather than a flat line list. */
function isTranscript(source: LogSource): source is Transcript {
  return (source as Transcript).parts !== undefined
}

/**
 * Draw the transcript into a rectangle.
 *
 * @param buf - the frame buffer to paint into.
 * @param rect - the log region.
 * @param source - the rendered transcript, flat or as parts.
 * @param state - current scroll state; `follow` wins over `offset`.
 * @returns the offset used, the transcript height, the pinned heading, and the visible rows.
 */
export function drawLogView(buf: CellBuffer, rect: Rect, source: LogSource, state: LogViewState): LogViewResult {
  const total = isTranscript(source) ? source.total : source.length
  if (rect.w <= 0 || rect.h <= 0) return { offset: 0, total, sticky: null, visible: [], painted: [] }
  const maxOffset = Math.max(0, total - rect.h)
  const offset = state.follow ? maxOffset : clampScroll(state.offset, total, rect.h)
  const visible = isTranscript(source)
    ? transcriptWindow(source, rect.h, offset)
    : (source as readonly StyledLine[]).slice(offset, offset + rect.h)

  const first = visible[0]
  const sticky = first !== undefined && first.heading !== true && first.anchor !== undefined ? first.anchor : null

  let row = 0
  if (sticky !== null) {
    buf.write(rect.x, rect.y, sticky, 'Muted', { dim: true })
    row = 1
  }
  const painted: PaintedRow[] = []
  for (const line of visible) {
    if (row >= rect.h) break
    paintStyledLine(buf, rect.x, rect.y + row, rect.w, line)
    painted.push({ row: rect.y + row, line })
    row += 1
  }

  const indicator = scrollIndicator(total, rect.h, offset)
  // The "above" marker means "there is older content above the viewport", which is
  // only informative while the viewport is not already pinned to the newest line.
  if (indicator.above > 0 && !state.follow) {
    const label = `↑ ${String(indicator.above)}`
    const x = rect.x + Math.max(0, rect.w - label.length - 1)
    buf.write(x, rect.y, label, 'Muted', { dim: true })
  }
  if (indicator.below > 0) {
    const label = `↓ ${String(indicator.below)}`
    const x = rect.x + Math.max(0, rect.w - label.length - 1)
    buf.write(x, rect.y + rect.h - 1, label, 'Muted', { dim: true })
  }
  // A very narrow region keeps its text: the scrollbar would take the only column
  // the transcript has left, and the position is already reported by the markers.
  if (total > rect.h && rect.w >= 22) drawScrollbar(buf, rect, offset, maxOffset)
  return { offset, total, sticky, visible, painted }
}

/**
 * Paint one styled line at a position, clipping it to a column budget.
 * @param buf - the frame buffer to paint into.
 * @param x - left column of the line.
 * @param y - row of the line.
 * @param maxWidth - available columns.
 * @param line - the line to paint.
 */
export function paintStyledLine(buf: CellBuffer, x: number, y: number, maxWidth: number, line: StyledLine): void {
  if (maxWidth <= 0 || lineWidth(line) === 0) return
  let column = x
  const limit = x + maxWidth
  for (const span of line.spans) {
    if (column >= limit) break
    const style = {
      ...(span.bold === undefined ? {} : { bold: span.bold }),
      ...(span.dim === undefined ? {} : { dim: span.dim }),
      ...(span.underline === undefined ? {} : { underline: span.underline }),
    }
    // The target travels with the cells so the frame prints a real hyperlink and
    // a Ctrl+click can resolve what sits under the pointer.
    buf.write(column, y, span.text, span.token, style, span.url)
    column += lineWidth({ spans: [span] })
  }
}

/** Draw the scrollbar thumb in the rightmost column. */
function drawScrollbar(buf: CellBuffer, rect: Rect, offset: number, maxOffset: number): void {
  const x = rect.x + rect.w - 1
  const track = rect.h
  const position = maxOffset === 0 ? 0 : Math.min(track - 1, Math.round((offset / maxOffset) * (track - 1)))
  for (let row = 0; row < track; row++) {
    buf.put(x, rect.y + row, row === position ? '█' : '│', row === position ? 'Muted' : 'Subtle')
  }
}

/** The plain text of the first row the viewport shows, for tests and assertions. */
export function firstVisibleText(lines: readonly StyledLine[], rect: Rect, state: LogViewState): string {
  const total = lines.length
  const offset = state.follow ? Math.max(0, total - rect.h) : clampScroll(state.offset, total, rect.h)
  const first = lines[offset]
  return first === undefined ? '' : plainText(first)
}
