/**
 * Input area of the terminal surface (`UI.md` §4.3 and §10).
 *
 * The composer is a rounded box drawn directly above the session's own rows: the
 * top border, the draft rows with their prompt, a key legend, and a bottom border
 * that carries the session facts (model, mode, counters). The draft grows the box
 * row by row up to {@link COMPOSER_MAX_ROWS}; past that the box keeps its height
 * and shows the newest rows, with a marker that says how many are above.
 *
 * The box is inset by {@link COMPOSER_MARGIN} columns on both sides, so a
 * full-width row is `innerWidth + 2` columns wide and the borders line up with
 * the header's content.
 * @module @kibborg/tui/composer
 */

import type { Palette } from './tokens.ts'
import { displayWidth, padRight, takeHeadWidth, takeTailWidth } from './width.ts'

/** Outer inset of the box from the terminal edge, in columns. */
export const COMPOSER_MARGIN = 2

/** Prompt of the first draft row, drawn inside the box. */
export const COMPOSER_PREFIX = '> '

/** Prompt of a continuation row, aligned under the first one. */
export const COMPOSER_CONTINUATION = '  '

/** How many draft rows the box shows before it starts scrolling. */
export const COMPOSER_MAX_ROWS = 8

/** Key legend shown between the draft and the bottom border. */
export const COMPOSER_HINT = '@ файлы   / команды   ! shell   shift+enter — новая строка'

/** Legend shown while a turn runs: the keys that act on the turn itself. */
export const COMPOSER_RUNNING_HINT = 'Ctrl+C — прервать ход   ↑↓ — читать ленту'

/**
 * The composer's top border.
 * @param innerWidth - the box width between its outer edges.
 * @returns the border row without the inset.
 */
export function composerBorderTop(innerWidth: number): string {
  const width = Math.max(4, Math.floor(innerWidth))
  return `╭${'─'.repeat(width - 2)}╮`
}

/**
 * The composer's bottom border, carrying the session facts.
 *
 * The facts sit inside the border the way the reference CLIs place them: the
 * user reads the model and the mode while typing, and they cost no row of their
 * own. The counters stay flush with the right corner, where they survive a
 * narrow terminal longest.
 * @param innerWidth - the box width between its outer edges.
 * @param status - the model and mode, or the running turn.
 * @param counters - the run's scale, empty when there is nothing to report.
 * @returns the border row without the inset.
 */
export function composerBorderBottom(innerWidth: number, status: string, counters: string): string {
  const width = Math.max(4, Math.floor(innerWidth))
  const span = width - 2
  if (status === '' && counters === '') return `╰${'─'.repeat(span)}╯`
  // The counters are measured first and the label takes what is left, so the row
  // never grows past the box: on a narrow terminal something has to be clipped,
  // and the border staying inside the frame matters more than either string.
  const wanted = counters === '' ? '' : ` ${counters} ─`
  const right = takeHeadWidth(wanted, Math.max(0, span - 6))
  const room = status === '' ? 0 : Math.max(0, span - displayWidth(right) - 4)
  const label = status === '' ? '' : `─ ${takeHeadWidth(status, room)} `
  const fill = Math.max(0, span - displayWidth(label) - displayWidth(right))
  return `╰${label}${'─'.repeat(fill)}${right}╯`
}

/** Characters currently typed, independent of display columns. */
function characterCount(text: string): number {
  return [...text].length
}

/**
 * Build the dashed rule of a framed row.
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

/** Inputs of {@link composerFrame}. */
export interface ComposerInput {
  /** The current draft. */
  readonly draft: string
  /** The composer's inner width (`cols - 4`), which the box spans exactly. */
  readonly innerWidth: number
  /** Whether the key legend appears; the caller decides which legend fits. */
  readonly showHint: boolean
  /** Draft rows the box may show; defaults to {@link COMPOSER_MAX_ROWS}. */
  readonly maxRows?: number
  /** Legend text; defaults to {@link COMPOSER_HINT}. */
  readonly hint?: string
  /** Session facts for the bottom border, such as the model and the mode. */
  readonly status?: string
  /** Run counters for the bottom border's right corner. */
  readonly counters?: string
}

/** What one composer frame contains. */
export interface ComposerFrame {
  /** The rows to paint, top to bottom, including both borders and the legend. */
  readonly lines: readonly string[]
  /** Frame row of the caret, addressed from one like the terminal's own rows. */
  readonly cursorRow: number
  /** Column of the caret, addressed from one like the terminal's own columns. */
  readonly cursorColumn: number
}

/**
 * Render the composer, growing with the draft up to eight rows.
 *
 * The caret sits at the end of the newest draft row, which is the last row shown,
 * so a `Shift+Enter` break is visible the moment it is typed.
 * @param input - the draft, the inner width, and the strings painted around it.
 * @param palette - the active palette.
 * @returns the rows to paint and where the caret belongs.
 */
export function composerFrame(input: ComposerInput, palette: Palette): ComposerFrame {
  const inner = Math.max(6, input.innerWidth)
  const inset = ' '.repeat(COMPOSER_MARGIN)
  const border = palette.paint('│', 'Subtle')
  const content = Math.max(1, inner - 2)
  const rows = input.draft.split('\n')
  const limit = Math.max(1, input.maxRows ?? COMPOSER_MAX_ROWS)
  const shown = rows.length <= limit ? rows : rows.slice(rows.length - limit)
  const hidden = rows.length - shown.length
  const lines: string[] = [`${inset}${palette.paint(composerBorderTop(inner), 'Subtle')}`]
  for (const [index, row] of shown.entries()) {
    const prefix = index === 0 && hidden === 0 ? COMPOSER_PREFIX : COMPOSER_CONTINUATION
    // The first visible row says how many rows are above it when the draft outgrew
    // the box: without it a long draft looks like a short one with its head cut.
    // The marker is taken out of that row's room, so the row still fits the box.
    const marker = index === 0 && hidden > 0 ? `▲ +${String(hidden)} ` : ''
    const available = Math.max(1, content - 1 - displayWidth(prefix) - displayWidth(marker))
    const view = composerView(row, available)
    const body = ` ${palette.paint(prefix, 'Accent')}${palette.paint(marker, 'Subtle')}${palette.paint(view.text, 'Text')}`
    lines.push(`${inset}${border}${padRight(body, content)}${border}`)
  }
  if (input.showHint) {
    const legend = input.hint ?? COMPOSER_HINT
    if (legend !== '') {
      lines.push(`${inset}${border}${palette.paint(padRight(` ${takeHeadWidth(legend, Math.max(0, content - 1))}`, content), 'Muted', { dim: true })}${border}`)
    }
  }
  const last = shown[shown.length - 1] ?? ''
  const lastPrefix = shown.length === 1 && hidden === 0 ? COMPOSER_PREFIX : COMPOSER_CONTINUATION
  // The scroll marker shares a row only when that row is the single visible one;
  // otherwise it stands above the caret and takes nothing from its columns.
  const caretMarker = hidden > 0 && shown.length === 1 ? `▲ +${String(hidden)} ` : ''
  const caretRoom = Math.max(1, content - 1 - displayWidth(lastPrefix) - displayWidth(caretMarker))
  const caretColumn = COMPOSER_MARGIN + 2 + displayWidth(lastPrefix) + displayWidth(caretMarker)
    + displayWidth(composerView(last, caretRoom).text)
  lines.push(`${inset}${palette.paint(composerBorderBottom(inner, input.status ?? '', input.counters ?? ''), 'Subtle')}`)
  return { lines, cursorRow: 1 + shown.length, cursorColumn: caretColumn + 1 }
}

/**
 * Render the composer's rows.
 * @param input - the draft, the inner width, and the strings painted around it.
 * @param palette - the active palette.
 * @returns the borders, the draft rows, and the legend row.
 */
export function composerLines(input: ComposerInput, palette: Palette): readonly string[] {
  return composerFrame(input, palette).lines
}

/**
 * Column of the caret inside the composer, counted from zero for a row cursor.
 * @param draft - the current draft.
 * @param innerWidth - the composer's inner width (`cols - 4`).
 * @returns the zero-based column where the caret renders.
 */
export function composerCursorColumn(draft: string, innerWidth: number, maxRows = COMPOSER_MAX_ROWS): number {
  const rows = draft.split('\n')
  const last = rows[rows.length - 1] ?? ''
  const shown = Math.min(rows.length, Math.max(1, maxRows))
  const hidden = rows.length - shown
  const prefix = shown === 1 && hidden === 0 ? COMPOSER_PREFIX : COMPOSER_CONTINUATION
  const marker = hidden > 0 && shown === 1 ? `▲ +${String(hidden)} ` : ''
  const content = Math.max(1, Math.max(6, innerWidth) - 2)
  const available = Math.max(1, content - 1 - displayWidth(prefix) - displayWidth(marker))
  return COMPOSER_MARGIN + 2 + displayWidth(prefix) + displayWidth(marker) + displayWidth(composerView(last, available).text)
}

/**
 * Row of the caret inside the composer, counted from zero.
 * @param draft - the current draft.
 * @param maxRows - draft rows the box may show.
 * @returns the zero-based row of the caret, relative to the top border.
 */
export function composerCursorRow(draft: string, maxRows = COMPOSER_MAX_ROWS): number {
  const rows = draft.split('\n').length
  return Math.min(rows, Math.max(1, maxRows))
}
