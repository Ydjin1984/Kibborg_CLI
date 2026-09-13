/**
 * The lower zone of the interactive surface.
 *
 * The zone is the only part of the screen redrawn in place: an optional overlay
 * above the composer, and the composer box itself, whose bottom border carries
 * the session facts. Its height is known before painting, which is what lets the
 * renderer erase exactly the rows it owns and leave the scrollback above
 * untouched (`UI.md` §10).
 * @module @kibborg/tui/zone
 */

import { COMPOSER_MAX_ROWS, COMPOSER_RUNNING_HINT, composerCursorPosition, composerLines, type ComposerInput } from './composer.ts'
import { composerFacts, type StatusInput } from './status.ts'
import type { Palette } from './tokens.ts'

/** Everything the zone renders. */
export interface ZoneState {
  /** The current draft. */
  readonly draft: string
  /** Inner width of the zone (`cols - 4`). */
  readonly innerWidth: number
  /** Whether the composer hint may show. */
  readonly showHint: boolean
  /** Status line contents; the width comes from the zone. */
  readonly status: Omit<StatusInput, 'cols'>
  /** Terminal width in columns. */
  readonly cols: number
  /** Overlay rows drawn above the composer, already formatted. */
  readonly overlay?: readonly string[]
  /** Caret index in the draft; when set, the caret sits at that index instead of the end. */
  readonly cursorIndex?: number
  /** Row of the cursor inside the zone (0-based), when the caller places it. */
  readonly cursorRow?: number
  /** Column of the cursor inside the zone, when the caller places it. */
  readonly cursorColumn?: number
}

/**
 * Render the zone's rows.
 *
 * The composer grows with the draft, so the zone's height follows the draft: the
 * overlay rows, then the composer box with the session facts in its border.
 * @param state - the zone's current values.
 * @param palette - the active palette.
 * @returns overlay rows (when present) and the composer's rows.
 */
export function zoneLines(state: ZoneState, palette: Palette): readonly string[] {
  const facts = composerFacts({ ...state.status, cols: state.cols })
  // The zone has no header, so the facts a header would carry — the measured share
  // of the context window and the branch in use — join the border's counters.
  const extras: string[] = []
  if (state.status.contextPercent > 0) extras.push(`ctx ${String(Math.round(state.status.contextPercent))}%`)
  if (state.cols >= 88 && state.status.branch !== undefined && state.status.branch !== '') {
    extras.push(`${state.status.branch}${state.status.dirty === true ? '*' : ''}`)
  }
  const counters = [facts.counters, ...extras].filter(part => part !== '').join(' · ')
  const composer = composerLines(
    {
      draft: state.draft,
      innerWidth: state.innerWidth,
      showHint: state.showHint,
      ...(state.status.running === true ? { hint: COMPOSER_RUNNING_HINT } : {}),
      status: facts.status,
      counters,
    } satisfies ComposerInput,
    palette,
  )
  return [...(state.overlay ?? []), ...composer]
}

/**
 * Where the caret belongs inside the zone, counting from the zone's first row.
 * @param state - the zone's current values.
 * @returns the zero-based row and column of the caret.
 */
export function zoneCursor(state: ZoneState): { readonly row: number; readonly column: number } {
  const overlayRows = state.overlay?.length ?? 0
  const cursor = state.cursorIndex ?? state.draft.length
  const position = composerCursorPosition(state.draft, cursor, state.innerWidth, COMPOSER_MAX_ROWS)
  return { row: overlayRows + position.row, column: position.column }
}

/**
 * Height of the zone for a given overlay size.
 * @param overlayRows - number of overlay rows above the composer.
 * @param composerRows - rows the composer box occupies, border to border.
 * @returns `overlayRows + composerRows`.
 */
export function zoneHeight(overlayRows = 0, composerRows = 4): number {
  return overlayRows + composerRows
}

/**
 * Move the cursor up by a number of rows.
 * @param rows - how many rows to move; zero emits nothing.
 * @returns the escape sequence.
 */
export function cursorUp(rows: number): string {
  return rows <= 0 ? '' : `\u001B[${String(rows)}A`
}

/** Erase from the cursor to the end of the screen, then park the cursor at column 1. */
export const ERASE_DOWN = '\u001B[0J\r'

/**
 * Place the cursor at a zero-based row and column of the screen.
 * @param row - absolute screen row.
 * @param column - zero-based column.
 * @returns the escape sequence.
 */
export function cursorTo(row: number, column: number): string {
  return `\u001B[${String(row + 1)};${String(column + 1)}H`
}

/**
 * Move the cursor to a zero-based column of the current row.
 * @param column - zero-based column.
 * @returns the escape sequence.
 */
export function cursorColumn(column: number): string {
  return `\u001B[${String(Math.max(1, column + 1))}G`
}
