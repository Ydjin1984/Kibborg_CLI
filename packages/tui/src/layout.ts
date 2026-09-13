/**
 * Region layout of the fullscreen surface.
 *
 * The surface stacks four regions over the full terminal height: the brand
 * header, the scrolling log, the optional overlay, the composer, and the status
 * line. Every size is derived from the terminal size, so a resize only recomputes
 * geometry and never reflows the transcript.
 * @module @kibborg/tui/layout
 */

import type { Rect } from './box.ts'

/** Detail level the surface renders at, chosen from the terminal width. */
export type Density = 'rich' | 'balanced' | 'compact'

/** Requested geometry for one frame. */
export interface LayoutRequest {
  /** Detail level for this width; see {@link densityFor}. */
  readonly density: Density
  /** Rows reserved for the composer, including its borders. */
  readonly composerHeight: number
  /** Rows reserved for the overlay stack above the composer; defaults to none. */
  readonly overlayHeight?: number
  /** Rows reserved for the brand header; defaults to two. */
  readonly headerHeight?: number
  /**
   * Whether a status row is reserved below the composer.
   *
   * Off by default: the framed composer carries the session facts in its bottom
   * border. A caller that still prints a status row of its own asks for it.
   */
  readonly showStatus?: boolean
}

/** Vertical regions of one frame. */
export interface Layout {
  /** Brand header at the top. */
  readonly header: Rect
  /** Scrolling log; absorbs the remaining height. */
  readonly log: Rect
  /** Overlay stack drawn directly above the composer, or `null` when closed. */
  readonly overlay: Rect | null
  /** Composer at the bottom of the content area. */
  readonly composer: Rect
  /** Status line pinned to the last row, or `null` when it does not fit. */
  readonly status: Rect | null
  /** Width available to content inside a frame: the terminal width minus margins. */
  readonly inner: number
}

/** Rows reserved for the header when the caller does not ask for a size. */
const DEFAULT_HEADER_HEIGHT = 2

/** Rows below which the status line is dropped to keep the composer usable. */
const STATUS_MIN_ROWS = 6

/** Horizontal margin between the terminal edge and inner content. */
const MARGIN = 4

/** Clamp a value into an inclusive range. */
function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}

/**
 * Choose the detail level for a terminal width.
 * @param cols - terminal width in columns.
 * @returns `rich` from 110 columns, `balanced` from 80, otherwise `compact`.
 */
export function densityFor(cols: number): Density {
  if (cols >= 110) return 'rich'
  if (cols >= 80) return 'balanced'
  return 'compact'
}

/**
 * Compute the vertical regions of one frame.
 *
 * Regions are stacked header, log, overlay, composer, status and always sum to
 * the terminal height. When the terminal is too short, the log is dropped first,
 * then the overlay, header, and finally the composer shrinks to one row.
 * @param cols - terminal width in columns.
 * @param rows - terminal height in rows.
 * @param options - requested sizes and visibility flags.
 * @returns the regions and the inner content width.
 */
export function computeLayout(cols: number, rows: number, options: LayoutRequest): Layout {
  const safeCols = Math.max(1, Math.floor(cols))
  const safeRows = Math.max(1, Math.floor(rows))

  let headerH = clamp(options.headerHeight ?? DEFAULT_HEADER_HEIGHT, 0, safeRows)
  let composerH = clamp(options.composerHeight, 1, safeRows)
  let statusH = options.showStatus === true && safeRows >= STATUS_MIN_ROWS ? 1 : 0
  let overlayH = clamp(options.overlayHeight ?? 0, 0, safeRows)

  let logH = safeRows - headerH - composerH - statusH - overlayH
  if (logH < 0) {
    let deficit = -logH
    const reduce = (size: number, floor: number): number => {
      const amount = Math.min(deficit, Math.max(0, size - floor))
      deficit -= amount
      return amount
    }
    overlayH -= reduce(overlayH, 0)
    headerH -= reduce(headerH, 0)
    composerH -= reduce(composerH, 1)
    statusH -= reduce(statusH, 0)
    logH = 0
  }

  const logY = headerH
  const overlayY = logY + logH
  const composerY = overlayY + overlayH
  const statusY = safeRows - statusH

  return {
    header: { x: 0, y: 0, w: safeCols, h: headerH },
    log: { x: 0, y: logY, w: safeCols, h: logH },
    overlay: overlayH > 0 ? { x: 0, y: overlayY, w: safeCols, h: overlayH } : null,
    composer: { x: 0, y: composerY, w: safeCols, h: composerH },
    status: statusH > 0 ? { x: 0, y: statusY, w: safeCols, h: statusH } : null,
    inner: Math.max(1, safeCols - MARGIN),
  }
}
