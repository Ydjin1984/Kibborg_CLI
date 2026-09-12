/**
 * Terminal display width.
 *
 * Column layout cannot use `String.length`: a CSI sequence occupies no columns,
 * a combining mark or a zero-width joiner occupies none, and a CJK ideograph or
 * an emoji occupies two. Every widget measures text through {@link displayWidth}
 * and pads through {@link padRight} / {@link padLeft}, so a column computed once
 * stays aligned in every terminal.
 * @module @kibborg/tui/width
 */

/** Matches one CSI sequence (parameters, intermediates, final byte). */
const CSI = /\u001B\[[0-9;?]*[A-Za-z]/gu

/** Whether a code point occupies two columns (wide, CJK, or emoji ranges). */
function isWide(codePoint: number): boolean {
  return (codePoint >= 0x1100 && codePoint <= 0x115F)
    || (codePoint >= 0x2E80 && codePoint <= 0x303E)
    || (codePoint >= 0x3041 && codePoint <= 0x33FF)
    || (codePoint >= 0x3400 && codePoint <= 0x4DBF)
    || (codePoint >= 0x4E00 && codePoint <= 0x9FFF)
    || (codePoint >= 0xA000 && codePoint <= 0xA4CF)
    || (codePoint >= 0xAC00 && codePoint <= 0xD7A3)
    || (codePoint >= 0xF900 && codePoint <= 0xFAFF)
    || (codePoint >= 0xFE30 && codePoint <= 0xFE6F)
    || (codePoint >= 0xFF00 && codePoint <= 0xFF60)
    || (codePoint >= 0xFFE0 && codePoint <= 0xFFE6)
    || (codePoint >= 0x1F300 && codePoint <= 0x1FAFF)
    || (codePoint >= 0x20000 && codePoint <= 0x3FFFD)
}

/** Whether a code point occupies no column (combining marks and zero-width controls). */
function isZeroWidth(codePoint: number): boolean {
  return (codePoint >= 0x0300 && codePoint <= 0x036F)
    || (codePoint >= 0x200B && codePoint <= 0x200F)
    || (codePoint >= 0xFE00 && codePoint <= 0xFE0F)
    || codePoint === 0xFEFF
}

/**
 * Measure text in terminal columns.
 * @param text - the text to measure; ANSI sequences are ignored.
 * @returns the number of columns the text occupies.
 */
export function displayWidth(text: string): number {
  const stripped = text.replace(CSI, '')
  let columns = 0
  for (const character of stripped) {
    const codePoint = character.codePointAt(0)
    /* v8 ignore next -- iterating a string yields no empty characters */
    if (codePoint === undefined) continue
    if (codePoint === 9) {
      columns += 4
      continue
    }
    if (codePoint < 32 || codePoint === 127) continue
    if (isZeroWidth(codePoint)) continue
    columns += isWide(codePoint) ? 2 : 1
  }
  return columns
}

/**
 * Pad text on the right up to a column width.
 * @param text - the text to pad.
 * @param width - the target column width.
 * @returns the text with trailing spaces, or unchanged when already at or past the width.
 */
export function padRight(text: string, width: number): string {
  const current = displayWidth(text)
  return current >= width ? text : text + ' '.repeat(width - current)
}

/**
 * Pad text on the left up to a column width.
 * @param text - the text to pad.
 * @param width - the target column width.
 * @returns the text with leading spaces, or unchanged when already at or past the width.
 */
export function padLeft(text: string, width: number): string {
  const current = displayWidth(text)
  return current >= width ? text : ' '.repeat(width - current) + text
}

/**
 * Keep the head of a string within a column budget, iterating forward so a
 * surrogate pair is never split.
 * @param text - the source text.
 * @param width - the maximum number of columns to keep.
 * @returns the leading slice that fits, or an empty string when the budget is zero.
 */
export function takeHeadWidth(text: string, width: number): string {
  if (width <= 0 || text === '') return ''
  let used = 0
  let kept = ''
  for (const character of text) {
    const codePoint = character.codePointAt(0)
    /* v8 ignore next -- iterating a string yields no empty characters */
    if (codePoint === undefined) continue
    const columns = isZeroWidth(codePoint) ? 0 : isWide(codePoint) ? 2 : 1
    if (used + columns > width) break
    used += columns
    kept += character
  }
  return kept
}

/**
 * Keep the tail of a string within a column budget, iterating from the end so a
 * surrogate pair is never split.
 * @param text - the source text.
 * @param width - the maximum number of columns to keep.
 * @returns the trailing slice that fits, or an empty string when the budget is zero.
 */
export function takeTailWidth(text: string, width: number): string {
  if (width <= 0 || text === '') return ''
  const characters = [...text]
  let used = 0
  let index = characters.length
  while (index > 0) {
    const character = characters[index - 1]
    /* v8 ignore next -- the loop guard keeps the index inside the array */
    if (character === undefined) break
    const codePoint = character.codePointAt(0)
    /* v8 ignore next -- a character always carries a code point */
    if (codePoint === undefined) break
    const columns = isZeroWidth(codePoint) ? 0 : isWide(codePoint) ? 2 : 1
    if (used + columns > width) break
    used += columns
    index -= 1
  }
  return characters.slice(index).join('')
}

/**
 * Wrap text to a column budget.
 *
 * Words are moved whole to the next line; a word wider than the budget is cut,
 * and existing newlines start a new line. Wide glyphs count two columns.
 * @param text - the text to wrap.
 * @param width - available columns; a non-positive budget yields one empty line.
 * @returns the lines, none wider than `width`.
 */
export function wrapText(text: string, width: number): string[] {
  if (width <= 0) return ['']
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    if (paragraph === '') {
      lines.push('')
      continue
    }
    let current = ''
    for (const word of paragraph.split(' ')) {
      const candidate = current === '' ? word : `${current} ${word}`
      if (displayWidth(candidate) <= width) {
        current = candidate
        continue
      }
      if (current !== '') lines.push(current)
      let rest = word
      while (displayWidth(rest) > width) {
        const head = takeHeadWidth(rest, width)
        if (head === '') break
        lines.push(head)
        rest = rest.slice(head.length)
      }
      current = rest
    }
    lines.push(current)
  }
  return lines.length === 0 ? [''] : lines
}
