/**
 * Input area of the terminal surface (`UI.md` §4.3 and §10).
 *
 * The composer lives directly above the status line and is the only element
 * redrawn in place: a dashed rule, the draft rows with their prompt prefix, an
 * optional hint row, and a second dashed rule. The draft grows the box row by
 * row up to {@link COMPOSER_MAX_ROWS}; past that the box keeps its height and
 * shows the newest rows, with a marker that says how many are above.
 * @module @kibborg/tui/composer
 */

import type { Palette } from './tokens.ts'
import { displayWidth, padRight, takeTailWidth } from './width.ts'

/** Prompt prefix of the first draft row, including the two-column outer margin. */
export const COMPOSER_PREFIX = '  |   > '

/** Prefix of a continuation row, aligned under the first one. */
export const COMPOSER_CONTINUATION = '  |     '

/** How many draft rows the box shows before it starts scrolling. */
export const COMPOSER_MAX_ROWS = 8

/** Hint shown while the draft is empty. */
const HINT = '    @ files   / commands   ! shell   shift+enter nl'

/** Characters currently typed, independent of display columns. */
function characterCount(text: string): number {
  return [...text].length
}

/**
 * Build the dashed rule of the composer.
 * @param width - the rule's target column width.
 * @returns a rule of exactly that width, built from `- ` pairs.
 */
export function makeDash(width: number): string {
  if (width <= 2) return ''
  const pairs = Math.floor(width / 2)
  let line = '- '.repeat(pairs)
  if (line.length > width) line = line.slice(0, width)
  else if (line.length < width) line += '-'.repeat(width - line.length)
  return line
}

/** The visible part of a draft row together with how many characters it hides. */
export interface ComposerView {
  /** The text to render; an ellipsis prefixes a truncated tail. */
  readonly text: string
  /** Number of characters hidden at the start of the draft. */
  readonly hidden: number
}

/**
 * Resolve the visible part of one draft row for the available columns.
 * @param draft - the row's text.
 * @param availableWidth - the columns the row may occupy.
 * @returns the visible text and the hidden character count.
 */
export function composerView(draft: string, availableWidth: number): ComposerView {
  if (availableWidth <= 0) return { text: '', hidden: 0 }
  if (displayWidth(draft) <= availableWidth) return { text: draft, hidden: 0 }
  const tail = takeTailWidth(draft, availableWidth - 1)
  return { text: `…${tail}`, hidden: characterCount(draft) - characterCount(tail) }
}

/** Inputs of {@link composerLines}. */
export interface ComposerInput {
  /** The current draft. */
  readonly draft: string
  /** The composer's inner width (`cols - 4`). */
  readonly innerWidth: number
  /** Whether the hint row may appear; it never shows above a non-empty draft. */
  readonly showHint: boolean
  /** Draft rows the box may show; defaults to {@link COMPOSER_MAX_ROWS}. */
  readonly maxRows?: number
}

/** What one composer frame contains. */
export interface ComposerFrame {
  /** The rows to paint, top to bottom, including both rules and the hint row. */
  readonly lines: readonly string[]
  /** Frame row of the caret, relative to the first line. */
  readonly cursorRow: number
  /** Column of the caret inside a line, counting display columns. */
  readonly cursorColumn: number
}

/**
 * Render the composer, growing with the draft up to eight rows.
 *
 * The caret sits at the end of the newest row, which is the last row shown, so a
 * `Shift+Enter` break is visible the moment it is typed.
 * @param input - the draft, the inner width, and whether the hint may show.
 * @param palette - the active palette.
 * @returns the rows to paint and where the caret belongs.
 */
export function composerFrame(input: ComposerInput, palette: Palette): ComposerFrame {
  const inner = input.innerWidth
  const border = palette.paint('|', 'Subtle')
  const rule = `  ${palette.paint(makeDash(inner), 'Subtle')}`
  const rows = input.draft.split('\n')
  const limit = Math.max(1, input.maxRows ?? COMPOSER_MAX_ROWS)
  const shown = rows.length <= limit ? rows : rows.slice(rows.length - limit)
  const hidden = rows.length - shown.length
  const lines: string[] = [rule]
  for (const [index, row] of shown.entries()) {
    const prefix = index === 0 && hidden === 0 ? COMPOSER_PREFIX : COMPOSER_CONTINUATION
    const available = Math.max(1, inner - displayWidth(prefix) - 1)
    const view = composerView(row, available)
    const typed = palette.paint(view.text, 'Text')
    // The first visible row says how many rows are above it when the draft outgrew
    // the box: without it a long draft looks like a short one with its head cut.
    const marker = index === 0 && hidden > 0 ? palette.paint(`▲ ${String(hidden)}   `, 'Subtle') : ''
    lines.push(`${palette.paint(prefix, 'Muted')}${marker}${padRight(typed, Math.max(0, inner - displayWidth(prefix) - 1))}${border}`)
  }
  const last = shown[shown.length - 1] ?? ''
  const lastPrefix = shown.length === 1 && hidden === 0 ? COMPOSER_PREFIX : COMPOSER_CONTINUATION
  const caretColumn = displayWidth(lastPrefix) + displayWidth(composerView(last, Math.max(1, inner - displayWidth(lastPrefix) - 1)).text)
  const hintRow = input.showHint && input.draft === ''
    ? `  ${border} ${padRight(palette.paint(HINT, 'Muted'), inner - 3)}${border}`
    : `  ${border} ${' '.repeat(Math.max(0, inner - 3))}${border}`
  lines.push(hintRow)
  lines.push(rule)
  return { lines, cursorRow: shown.length, cursorColumn: caretColumn + 3 }
}

/**
 * Render the composer's lines.
 *
 * Kept as the single-row view of {@link composerFrame} for callers that only
 * need the rows.
 * @param input - the draft, the inner width, and whether the hint may show.
 * @param palette - the active palette.
 * @returns the dashed rules, the draft rows, and the hint row.
 */
export function composerLines(input: ComposerInput, palette: Palette): readonly string[] {
  return composerFrame(input, palette).lines
}

/**
 * Column of the caret inside the composer.
 * @param draft - the current draft.
 * @param innerWidth - the composer's inner width (`cols - 4`).
 * @returns the zero-based column where the caret renders.
 */
export function composerCursorColumn(draft: string, innerWidth: number): number {
  const rows = draft.split('\n')
  const last = rows[rows.length - 1] ?? ''
  const prefix = rows.length === 1 ? COMPOSER_PREFIX : COMPOSER_CONTINUATION
  const available = Math.max(1, innerWidth - displayWidth(prefix) - 1)
  return displayWidth(prefix) + displayWidth(composerView(last, available).text)
}

/**
 * Row of the caret inside the composer.
 * @param draft - the current draft.
 * @param maxRows - draft rows the box may show.
 * @returns the zero-based row of the caret, relative to the first rule.
 */
export function composerCursorRow(draft: string, maxRows = COMPOSER_MAX_ROWS): number {
  const rows = draft.split('\n').length
  return Math.min(rows, Math.max(1, maxRows))
}
