/**
 * Cell framebuffer of the fullscreen surface.
 *
 * The surface owns the screen: every frame is composed in this buffer and then
 * emitted as the difference against the previous frame. A cell stores its
 * already-resolved SGR prefix, so repainting compares two cells by value and an
 * unchanged frame writes nothing at all.
 * @module @kibborg/tui/framebuffer
 */

import type { Palette, TokenName, TokenStyle } from './tokens.ts'
import { plainPalette } from './tokens.ts'
import { displayWidth } from './width.ts'

/** One screen cell: a glyph, its resolved color prefix, and its wide-glyph role. */
export interface Cell {
  /** The glyph occupying the cell; a continuation cell holds a space. */
  readonly ch: string
  /** The SGR prefix painting the glyph, or the empty string for the default style. */
  readonly sgr: string
  /** Whether the glyph occupies two columns and paints both of them. */
  /** Hyperlink target this cell belongs to, or absent for plain text. */
  readonly url?: string
  readonly wide: boolean
  /** Whether the cell is the right half of the wide glyph in the cell to its left. */
  readonly continuation: boolean
}

/** A blank cell in the default style. */
export const EMPTY_CELL: Cell = { ch: ' ', sgr: '', wide: false, continuation: false }

/** A cell grid addressed by column and row. */
export interface CellBuffer {
  /** Columns in the grid. */
  readonly cols: number
  /** Rows in the grid. */
  readonly rows: number
  /** The palette resolving token names into SGR prefixes for cells written here. */
  readonly palette: Palette
  /**
   * Read a cell; out-of-range coordinates yield a blank cell.
   * @param x - column, zero-based from the left edge.
   * @param y - row, zero-based from the top edge.
   * @returns the cell at that position.
   */
  get(x: number, y: number): Cell
  /**
   * Store an already-resolved cell; out-of-range coordinates are ignored.
   * @param x - column of the cell.
   * @param y - row of the cell.
   * @param cell - the cell to store.
   */
  set(x: number, y: number, cell: Cell): void
  /**
   * Write one glyph; out-of-range coordinates are ignored.
   * @param x - column of the glyph.
   * @param y - row of the glyph.
   * @param ch - glyph text; a two-column glyph claims the cell to its right.
   * @param token - theme token painting the glyph, or `null` for the default style.
   * @param style - optional bold/dim attributes.
   * @param url - hyperlink target for these cells, when the text is clickable.
   */
  put(x: number, y: number, ch: string, token?: TokenName | null, style?: TokenStyle | null, url?: string): void
  /**
   * Write text left to right, advancing by display width.
   * @param x - starting column.
   * @param y - row of the text.
   * @param text - the text to write; glyphs past the right edge are dropped.
   * @param token - theme token painting the text.
   * @param style - optional bold/dim attributes.
   * @param url - hyperlink target for this text, when it is clickable.
   */
  write(x: number, y: number, text: string, token?: TokenName | null, style?: TokenStyle | null, url?: string): void
  /**
   * Fill a rectangle, clipped to the grid.
   * @param x - left column of the rectangle.
   * @param y - top row of the rectangle.
   * @param w - rectangle width in columns.
   * @param h - rectangle height in rows.
   * @param ch - glyph filling the rectangle.
   * @param token - theme token painting the fill.
   * @param style - optional bold/dim attributes.
   */
  fillRect(
    x: number,
    y: number,
    w: number,
    h: number,
    ch?: string,
    token?: TokenName | null,
    style?: TokenStyle | null,
  ): void
  /** Reset every cell to blank. */
  clear(): void
  /**
   * Rows as plain text with wide-glyph columns preserved.
   * @returns one string per row, each `cols` columns wide.
   */
  snapshot(): readonly string[]
  /**
   * Rows as text carrying the stored SGR prefixes, without cursor positioning.
   * @returns one string per row, each ending in a reset when it carries color.
   */
  toAnsiRows(): readonly string[]
}

/**
 * Create a blank grid.
 * @param cols - grid width in columns; must be positive.
 * @param rows - grid height in rows; must be positive.
 * @param palette - palette resolving token styles; defaults to plain output.
 * @returns the new buffer.
 */
export function createBuffer(cols: number, rows: number, palette: Palette = plainPalette): CellBuffer {
  if (cols <= 0 || rows <= 0) throw new Error(`Buffer dimensions must be positive: ${String(cols)}×${String(rows)}`)

  const cells: Cell[] = new Array<Cell>(cols * rows).fill(EMPTY_CELL)

  const buffer: CellBuffer = {
    cols,
    rows,
    palette,
    get(x, y) {
      if (x < 0 || y < 0 || x >= cols || y >= rows) return EMPTY_CELL
      return cells[y * cols + x] ?? EMPTY_CELL
    },
    set(x, y, cell) {
      if (x < 0 || y < 0 || x >= cols || y >= rows) return
      cells[y * cols + x] = cell
    },
    put(x, y, ch, token = null, style = null, url = undefined) {
      if (ch === '' || x < 0 || y < 0 || x >= cols || y >= rows) return
      const width = displayWidth(ch)
      if (width === 0) return
      const sgr = token === null ? '' : palette.sgr(token, style ?? undefined)
      if (width === 1) {
        buffer.set(x, y, { ch, sgr, wide: false, continuation: false, ...(url === undefined ? {} : { url }) })
        return
      }
      if (x + 1 >= cols) {
        buffer.set(x, y, { ch: ' ', sgr, wide: false, continuation: false, ...(url === undefined ? {} : { url }) })
        return
      }
      buffer.set(x, y, { ch, sgr, wide: true, continuation: false, ...(url === undefined ? {} : { url }) })
      buffer.set(x + 1, y, { ch: ' ', sgr, wide: false, continuation: true, ...(url === undefined ? {} : { url }) })
    },
    write(x, y, text, token = null, style = null, url = undefined) {
      if (y < 0 || y >= rows) return
      let column = x
      for (const ch of text) {
        if (column >= cols) break
        if (column >= 0) buffer.put(column, y, ch, token, style, url)
        column += displayWidth(ch)
      }
    },
    fillRect(x, y, w, h, ch = ' ', token = null, style = null) {
      for (let row = 0; row < h; row++) {
        for (let column = 0; column < w; column++) buffer.put(x + column, y + row, ch, token, style)
      }
    },
    clear() {
      cells.fill(EMPTY_CELL)
    },
    snapshot() {
      const lines: string[] = []
      for (let y = 0; y < rows; y++) {
        let line = ''
        for (let x = 0; x < cols; x++) {
          const cell = cells[y * cols + x] ?? EMPTY_CELL
          if (cell.continuation) continue
          line += cell.ch
        }
        lines.push(line)
      }
      return lines
    },
    toAnsiRows() {
      const lines: string[] = []
      for (let y = 0; y < rows; y++) lines.push(paintRow(buffer, y))
      return lines
    },
  }

  return buffer
}

/**
 * Paint one row as text carrying SGR prefixes, skipping wide-glyph continuations.
 * @param buffer - the buffer holding the row.
 * @param row - row index to paint.
 * @returns the row text, reset at the end when it carries color.
 */
function paintRow(buffer: CellBuffer, row: number): string {
  let line = ''
  let active = ''
  let activeUrl: string | undefined
  for (let x = 0; x < buffer.cols; x++) {
    const cell = buffer.get(x, row)
    if (cell.continuation) continue
    if (cell.sgr !== active) {
      if (active !== '') line += '\u001B[0m'
      if (cell.sgr !== '') line += cell.sgr
      active = cell.sgr
    }
    // A hyperlink is a terminal feature attached to the printed text, so it is
    // opened and closed around the run of cells that shares one target.
    if (cell.url !== activeUrl) {
      if (activeUrl !== undefined) line += '\u001B]8;;\u001B\\'
      if (cell.url !== undefined) line += `\u001B]8;;${cell.url}\u001B\\`
      activeUrl = cell.url
    }
    line += cell.ch
  }
  if (activeUrl !== undefined) line += '\u001B]8;;\u001B\\'
  if (active !== '') line += '\u001B[0m'
  return line
}

/**
 * Whether two cells paint the same glyph in the same style.
 * @param left - first cell.
 * @param right - second cell.
 * @returns true when the cells are indistinguishable on screen.
 */
function sameCell(left: Cell, right: Cell): boolean {
  return (
    left.ch === right.ch
    && left.sgr === right.sgr
    && left.url === right.url
    && left.wide === right.wide
    && left.continuation === right.continuation
  )
}

/**
 * Render the difference between two frames.
 *
 * Each changed row is positioned, erased, and repainted; unchanged rows emit
 * nothing. Rows never end in a line feed, so painting the last screen row cannot
 * scroll the surface, and an identical frame returns the empty string.
 * @param prev - the frame currently on screen; `null` paints every row.
 * @param next - the frame to display.
 * @returns the ANSI update, or the empty string when nothing changed.
 */
export function diffBuffers(prev: CellBuffer | null, next: CellBuffer): string {
  if (prev === null || prev.cols !== next.cols || prev.rows !== next.rows) {
    let full = ''
    for (let y = 0; y < next.rows; y++) full += `\u001B[${String(y + 1)};1H\u001B[2K${paintRow(next, y)}`
    return full
  }

  let update = ''
  for (let y = 0; y < next.rows; y++) {
    let changed = false
    for (let x = 0; x < next.cols; x++) {
      if (!sameCell(prev.get(x, y), next.get(x, y))) {
        changed = true
        break
      }
    }
    if (!changed) continue
    update += `\u001B[${String(y + 1)};1H\u001B[2K${paintRow(next, y)}`
  }
  return update
}

/**
 * Copy a buffer, cells included, so a frame can serve as the base of the next diff.
 * @param source - the buffer to copy.
 * @returns an independent buffer with the same palette and contents.
 */
export function copyBuffer(source: CellBuffer): CellBuffer {
  const clone = createBuffer(source.cols, source.rows, source.palette)
  for (let y = 0; y < source.rows; y++) {
    for (let x = 0; x < source.cols; x++) clone.set(x, y, source.get(x, y))
  }
  return clone
}
