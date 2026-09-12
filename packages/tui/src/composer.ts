/**
 * Input area of the terminal surface (`UI.md` §4.3 and §10).
 *
 * The composer lives directly above the status line and is the only element
 * redrawn in place: a dashed rule, the input row with its prompt prefix, an
 * optional hint row, and a second dashed rule. The drafted text never wraps —
 * an over-long draft shows its tail behind an ellipsis, so the zone keeps a
 * known height and the terminal never reflows the scrollback above it.
 * @module @kibborg/tui/composer
 */

import type { Palette } from './tokens.ts'
import { displayWidth, padRight, takeTailWidth } from './width.ts'

/** Prompt prefix of the input row, including the two-column outer margin. */
export const COMPOSER_PREFIX = '  |   > '

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

/** The visible part of a draft together with how many characters it hides. */
export interface ComposerView {
  /** The text to render; an ellipsis prefixes a truncated tail. */
  readonly text: string
  /** Number of characters hidden at the start of the draft. */
  readonly hidden: number
}

/**
 * Resolve the visible part of the draft for the available columns.
 * @param draft - the full draft text.
 * @param availableWidth - the columns the draft may occupy.
 * @returns the visible text and the hidden character count.
 */
export function composerView(draft: string, availableWidth: number): ComposerView {
  if (availableWidth <= 0) return { text: '', hidden: 0 }
  if (displayWidth(draft) <= availableWidth) return { text: draft, hidden: 0 }
  const tail = takeTailWidth(draft, availableWidth - 1)
  return { text: `…${tail}`, hidden: characterCount(draft) - characterCount(tail) }
}

/**
 * Column of the cursor inside the input row.
 * @param draft - the current draft.
 * @param innerWidth - the composer's inner width (`cols - 4`).
 * @returns the zero-based column where the cursor renders.
 */
export function composerCursorColumn(draft: string, innerWidth: number): number {
  const available = Math.max(1, innerWidth - displayWidth(COMPOSER_PREFIX) - 1)
  return displayWidth(COMPOSER_PREFIX) + displayWidth(composerView(draft, available).text)
}

/** Inputs of {@link composerLines}. */
export interface ComposerInput {
  /** The current draft. */
  readonly draft: string
  /** The composer's inner width (`cols - 4`). */
  readonly innerWidth: number
  /** Whether the hint row may appear; it never shows above a non-empty draft. */
  readonly showHint: boolean
}

/**
 * Render the composer's lines.
 * @param input - the draft, the inner width, and whether the hint may show.
 * @param palette - the active palette.
 * @returns the dashed rule, the input row, the hint or blank row, and the closing rule.
 */
export function composerLines(input: ComposerInput, palette: Palette): readonly string[] {
  const inner = input.innerWidth
  const border = palette.paint('|', 'Subtle')
  const rule = `  ${palette.paint(makeDash(inner), 'Subtle')}`
  const available = Math.max(1, inner - displayWidth(COMPOSER_PREFIX) - 1)
  const view = composerView(input.draft, available)
  const typed = palette.paint(view.text, 'Text') + palette.paint('_', 'Accent')
  const inputRow = `${palette.paint(COMPOSER_PREFIX, 'Muted')}${padRight(typed, inner - displayWidth(COMPOSER_PREFIX) - 1)}${border}`
  const hintRow = input.showHint && input.draft === ''
    ? `  ${border} ${padRight(palette.paint(HINT, 'Muted'), inner - 3)}${border}`
    : `  ${border} ${' '.repeat(Math.max(0, inner - 3))}${border}`
  return [rule, inputRow, hintRow, rule]
}
