/**
 * Markdown rendering for the transcript.
 *
 * A model answers in Markdown, and printing it verbatim leaves headings,
 * tables, lists, and code indistinguishable from prose. This module turns the
 * answer into styled lines: headings bold, list markers aligned, tables laid out
 * as columns, fenced code set apart, inline code and links colored, and every
 * URL or file path carried as a real terminal hyperlink so a Ctrl+click opens
 * it.
 * @module @kibborg/tui/markdown
 */

import type { TokenName } from './tokens.ts'
import { displayWidth, takeHeadWidth, wrapText } from './width.ts'
import type { Span, StyledLine } from './log.ts'

/** How one answer is rendered. */
export interface MarkdownOptions {
  /** Columns available for the answer. */
  readonly width: number
  /** Whether to emit OSC 8 hyperlinks (a terminal-only feature). */
  readonly hyperlinks?: boolean
  /** Token painting ordinary prose. */
  readonly textToken?: TokenName
}

/** One row of a Markdown table, already split into cells. */
type TableRow = readonly string[]

/** Matches a fenced code block opener, capturing its language. */
const FENCE = /^\s*```\s*([A-Za-z0-9+#._-]*)\s*$/u
/** Matches a heading, capturing its level and text. */
const HEADING = /^(#{1,6})\s+(.*)$/u
/** Matches an unordered list item, capturing its indent and text. */
const BULLET = /^(\s*)[-*+]\s+(.*)$/u
/** Matches an ordered list item, capturing its indent, number, and text. */
const ORDERED = /^(\s*)(\d+)[.)]\s+(.*)$/u
/** Matches a quote line, capturing its text. */
const QUOTE = /^>\s?(.*)$/u
/** Matches a horizontal rule. */
const RULE = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/u
/** Matches a table row: a pipe-delimited line. */
const TABLE_ROW = /^\s*\|(.+)\|\s*$/u
/** Matches the `---` alignment row under a table header. */
const TABLE_RULE = /^\s*\|?[\s:|-]+\|[\s:|-]*$/u
/** Matches inline markdown: bold, code, links, and bare URLs. */
const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\)|https?:\/\/[^\s<>()]+)/gu
/** Matches `text -> link` in a link token. */
const LINK = /^\[([^\]]+)\]\(([^)\s]+)\)$/u
/** Whether a token is a path the terminal can open. */
const PATH_LIKE = /(?:^|[\s("'`])((?:[A-Za-z]:[\\/]|\.{1,2}[\\/]|\/)[^\s"'`|]+|[A-Za-z0-9_.-]+[\\/][^\s"'`|]+)/u

/** Language keywords painted as such inside fenced code. */
const KEYWORDS = new Set([
  'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while',
  'do', 'switch', 'case', 'break', 'continue', 'import', 'export', 'from',
  'await', 'async', 'class', 'new', 'extends', 'try', 'catch', 'finally',
  'throw', 'def', 'lambda', 'type', 'interface', 'enum', 'public', 'private',
  'readonly', 'static', 'true', 'false', 'null', 'undefined', 'this', 'super',
  'in', 'of', 'void', 'typeof', 'and', 'or', 'not', 'None', 'True', 'False',
])

/**
 * Highlight one line of fenced code into styled spans.
 *
 * The highlighter is deliberately small: it colors line comments, string
 * literals, numbers, and a fixed keyword set. It is not a language parser —
 * anything it does not recognise keeps the plain code color, so a wrong guess
 * costs one color, never the code's text.
 * @param line - one line of the code block.
 * @param language - the fence language, which chooses the comment marker.
 * @returns the styled spans.
 */
function highlightCode(line: string, language: string): Span[] {
  const hashComment = ['py', 'python', 'sh', 'bash', 'ps1', 'pwsh', 'yaml', 'yml', 'toml', 'rb', 'pl'].includes(language)
  const comment = hashComment ? '#[^\n]*' : '//[^\n]*'
  const tokenRe = new RegExp(
    `(${comment}|'(?:[^'\\\\]|\\\\.)*'|"(?:[^"\\\\]|\\\\.)*"|\`(?:[^\`\\\\]|\\\\.)*\`|\\b\\d+(?:\\.\\d+)?\\b|\\b[A-Za-z_$][A-Za-z0-9_$]*\\b)`,
    'gu',
  )
  const spans: Span[] = []
  let cursor = 0
  for (const match of line.matchAll(tokenRe)) {
    const found = match[0]
    const start = match.index ?? 0
    if (start > cursor) spans.push({ text: line.slice(cursor, start), token: 'Shimmer' })
    cursor = start + found.length
    const first = found[0] ?? ''
    if (first === '/' || first === '#') spans.push({ text: found, token: 'Muted', dim: true })
    else if (first === "'" || first === '"' || first === '`') spans.push({ text: found, token: 'Success' })
    else if (/^\d/u.test(found)) spans.push({ text: found, token: 'Warn' })
    else if (KEYWORDS.has(found)) spans.push({ text: found, token: 'Accent', bold: true })
    else spans.push({ text: found, token: 'Shimmer' })
  }
  if (cursor < line.length) spans.push({ text: line.slice(cursor), token: 'Shimmer' })
  return spans
}

/** The visible text of a line, ignoring its styles. */
function plain(line: StyledLine): string {
  return line.spans.map(span => span.text).join('')
}

/**
 * Split one line into styled spans, resolving inline markdown.
 * @param text - the line's text.
 * @param options - palette, width, and hyperlink setting.
 * @param token - token for plain text.
 * @returns the spans for that line.
 */
function inline(text: string, options: MarkdownOptions, token: TokenName = options.textToken ?? 'Text'): Span[] {
  const spans: Span[] = []
  let cursor = 0
  for (const match of text.matchAll(INLINE)) {
    const found = match[0]
    const start = match.index ?? 0
    if (start > cursor) spans.push({ text: text.slice(cursor, start), token })
    cursor = start + found.length
    if (found.startsWith('**')) {
      spans.push({ text: found.slice(2, -2), token, bold: true })
      continue
    }
    if (found.startsWith('`')) {
      spans.push({ text: found.slice(1, -1), token: 'Shimmer' })
      continue
    }
    const link = LINK.exec(found)
    if (link !== null) {
      const label = link[1] ?? ''
      const target = link[2] ?? ''
      spans.push({ text: label, token: 'Accent', underline: true, url: target })
      continue
    }
    spans.push({ text: found, token: 'Accent', underline: true, url: found })
  }
  if (cursor < text.length) spans.push({ text: text.slice(cursor), token })
  return spans.filter(span => span.text !== '')
}

/**
 * Wrap a span list into lines of a given width, keeping styles.
 * @param spans - the spans of one logical line.
 * @param width - the available columns.
 * @returns one styled line per wrapped row.
 */
function wrap(spans: readonly Span[], width: number): StyledLine[] {
  const lines: StyledLine[] = []
  let current: Span[] = []
  let used = 0
  const flush = (): void => {
    if (current.length > 0) lines.push({ spans: current })
    current = []
    used = 0
  }
  for (const span of spans) {
    if (span.text === '') continue
    // A run that fits as it is keeps its own text, spaces included: wrapping it
    // would trim the gap that separates it from the run before it.
    const whole = displayWidth(span.text)
    if (!span.text.includes('\n') && used + whole <= width) {
      current.push(span)
      used += whole
      if (used >= width) flush()
      continue
    }
    const pieces = wrapText(span.text, Math.max(1, width))
    for (const [index, piece] of pieces.entries()) {
      const size = displayWidth(piece)
      if (used + size > width && used > 0) flush()
      // Continuation pieces keep their style but lose the leading space the
      // wrapper inserts, so a wrapped word never starts mid-word with a gap.
      current.push({ ...span, text: index > 0 ? piece.replace(/^\s+/u, '') : piece })
      used += size
      if (used >= width) flush()
    }
  }
  flush()
  return lines.length === 0 ? [{ spans: [] }] : lines
}

/**
 * Render Markdown tables as aligned columns.
 * @param rows - the table's rows, header first.
 * @param options - palette, width, and hyperlink setting.
 * @returns the rendered lines.
 */
function table(rows: readonly TableRow[], options: MarkdownOptions): StyledLine[] {
  const columns = rows.reduce((max, row) => Math.max(max, row.length), 0)
  const widths = Array.from({ length: columns }, (_, index) => rows.reduce((max, row) => {
    const cell = row[index] ?? ''
    return Math.max(max, displayWidth(cell))
  }, 1))
  // Fit the table into the frame: trim the widest columns until it fits.
  const total = (): number => widths.reduce((sum, value) => sum + value, 0) + (columns - 1) * 3
  while (total() > options.width && Math.max(...widths) > 4) {
    const widest = widths.indexOf(Math.max(...widths))
    widths[widest] = (widths[widest] ?? 1) - 1
  }
  const lines: StyledLine[] = []
  for (const [rowIndex, row] of rows.entries()) {
    const spans: Span[] = []
    for (let index = 0; index < columns; index += 1) {
      const cell = row[index] ?? ''
      const fitted = displayWidth(cell) > (widths[index] ?? 1) ? takeHeadWidth(cell, widths[index] ?? 1) : cell
      const padding = ' '.repeat(Math.max(0, (widths[index] ?? 1) - displayWidth(fitted)))
      const header = rowIndex === 0
      // A cell is painted verbatim (no inline markdown): `inline()` would drop
      // the `**`/`` ` `` markers, so the visible width would no longer equal the
      // measured width and every `│` after that cell would shift. Alignment wins.
      spans.push({ text: fitted, token: header ? 'Text' : options.textToken ?? 'Text', ...(header ? { bold: true } : {}) })
      spans.push({ text: padding, token: 'Subtle' })
      if (index < columns - 1) spans.push({ text: ' │ ', token: 'Subtle' })
    }
    lines.push({ spans })
    if (rowIndex === 0) {
      lines.push({ spans: [{ text: widths.map(value => '─'.repeat(value)).join('─┼─'), token: 'Subtle' }] })
    }
  }
  return lines
}

/** Split a table row into its trimmed cells. */
function cellsOf(line: string): TableRow {
  const inner = TABLE_ROW.exec(line)?.[1] ?? line
  return inner.split('|').map(cell => cell.trim())
}

/**
 * Render one Markdown answer.
 * @param text - the answer as the model wrote it.
 * @param options - palette, width, and hyperlink setting.
 * @returns the styled lines of the answer.
 */
export function renderMarkdown(text: string, options: MarkdownOptions): StyledLine[] {
  const lines: StyledLine[] = []
  const source = text.split('\n')
  let insideFence = false
  let fenceLanguage = ''
  let tableRows: string[] = []

  /** Whether the previous line was blank, so a block can be set off from prose. */
  const blankBefore = (): boolean => {
    const last = lines[lines.length - 1]
    return lines.length === 0 || last === undefined || last.spans.every(span => span.text.trim() === '')
  }
  /** The visible text of the line rendered last. */
  const lastText = (): string => (lines[lines.length - 1]?.spans ?? []).map(span => span.text).join('')
  /** Whether a line opens a list item, so a list runs on instead of breaking. */
  const isItemLine = /^\s{2,}(?:[•◦]|\d+\.)\s/u
  // Blocks are separated by one blank row: a heading, a table, a code block, or a
  // list that follows prose reads as its own block instead of running into it.
  const breathe = (): void => {
    if (!blankBefore() && !isItemLine.test(lastText())) lines.push({ spans: [] })
  }
  const flushTable = (): void => {
    if (tableRows.length === 0) return
    const rows = tableRows.filter(line => !TABLE_RULE.test(line)).map(cellsOf)
    if (rows.length > 0) {
      breathe()
      const rendered = table(rows, options)
      const width = rendered.reduce((max, line) => Math.max(max, line.spans.reduce((sum, span) => sum + displayWidth(span.text), 0)), 0)
      lines.push(...rendered)
      // A rule under the last row closes the table, so it does not look like the
      // prose after it continues the same block.
      lines.push({ spans: [{ text: '─'.repeat(Math.max(4, width)), token: 'Subtle', dim: true }] })
    }
    tableRows = []
  }
  for (const line of source) {
    const fence = FENCE.exec(line)
    if (fence !== null) {
      flushTable()
      insideFence = !insideFence
      if (insideFence) {
        breathe()
        fenceLanguage = fence[1] ?? ''
        // A framed block marks where code starts and ends; the language rides the
        // frame instead of standing alone above it.
        lines.push({
          spans: [
            { text: '  ┌─', token: 'Subtle' },
            ...fenceLanguage === '' ? [] : [{ text: ` ${fenceLanguage} `, token: 'Accent', dim: true } as Span],
          ],
        })
      } else {
        lines.push({ spans: [{ text: '  └─', token: 'Subtle' }] })
        fenceLanguage = ''
      }
      continue
    }
    if (insideFence) {
      // Code is set apart: a rail keeps it visually inside the block, and the
      // body is highlighted so a keyword, a string, and a comment read as such
      // instead of one undifferentiated run.
      for (const piece of wrapText(line === '' ? ' ' : line, Math.max(1, options.width - 4))) {
        lines.push({ spans: [{ text: '  │ ', token: 'Subtle' }, ...highlightCode(piece, fenceLanguage)] })
      }
      continue
    }
    if (TABLE_ROW.test(line) || (tableRows.length > 0 && TABLE_RULE.test(line))) {
      tableRows.push(line)
      continue
    }
    flushTable()
    if (line.trim() === '') {
      if (!blankBefore()) lines.push({ spans: [] })
      continue
    }
    const heading = HEADING.exec(line)
    if (heading !== null) {
      const level = (heading[1] ?? '#').length
      const body = heading[2] ?? ''
      breathe()
      const spans = inline(body, options, level === 1 ? 'Answer' : 'Text').map(span => ({ ...span, bold: true }))
      // A marker plus, for the top level, a rule under the title: the answer then
      // reads as a document with a title rather than as one more bold line.
      lines.push({ spans: [{ text: '  ▎ ', token: level <= 2 ? 'Accent' : 'Subtle' }, ...spans] })
      if (level === 1) {
        const titleWidth = spans.reduce((sum, span) => sum + displayWidth(span.text), 0)
        lines.push({ spans: [{ text: `  ${'─'.repeat(Math.max(4, Math.min(options.width - 4, titleWidth)))}`, token: 'Subtle', dim: true }] })
      }
      continue
    }
    if (RULE.test(line)) {
      breathe()
      lines.push({ spans: [{ text: '  ', token: 'Subtle' }, { text: '─'.repeat(Math.max(4, options.width - 2)), token: 'Subtle' }] })
      continue
    }
    const quote = QUOTE.exec(line)
    if (quote !== null) {
      for (const styled of wrap(inline(quote[1] ?? '', options, 'Muted'), Math.max(1, options.width - 4))) {
        lines.push({ spans: [{ text: '  ▏ ', token: 'Accent' }, ...styled.spans] })
      }
      continue
    }
    const bullet = BULLET.exec(line)
    if (bullet !== null) {
      breathe()
      const depth = Math.floor((bullet[1] ?? '').length / 2)
      const marker = `${'  '.repeat(depth + 1)}${depth === 0 ? '• ' : '◦ '}`
      for (const styled of wrap(inline(bullet[2] ?? '', options), Math.max(1, options.width - displayWidth(marker)))) {
        lines.push({ spans: [{ text: marker, token: 'Accent' }, ...styled.spans] })
      }
      continue
    }
    const ordered = ORDERED.exec(line)
    if (ordered !== null) {
      breathe()
      const depth = Math.floor((ordered[1] ?? '').length / 2)
      const marker = `${'  '.repeat(depth + 1)}${ordered[2] ?? '1'}. `
      for (const styled of wrap(inline(ordered[3] ?? '', options), Math.max(1, options.width - displayWidth(marker)))) {
        lines.push({ spans: [{ text: marker, token: 'Accent' }, ...styled.spans] })
      }
      continue
    }
    // A paragraph line that carries a bare path keeps it clickable too, so a
    // file the model mentions can be opened the same way as a link.
    const path = options.hyperlinks === true ? PATH_LIKE.exec(line) : null
    if (path !== null) {
      const target = path[1] ?? ''
      const start = (path.index ?? 0) + path[0].length - target.length
      const spans = inline(line.slice(0, start), options)
      spans.push({ text: target, token: 'Accent', underline: true, url: target })
      spans.push(...inline(line.slice(start + target.length), options))
      lines.push(...wrap(spans, options.width))
      continue
    }
    lines.push(...wrap(inline(line, options), options.width))
  }
  flushTable()
  return lines
}

/** Export the plain text of rendered lines, for tests and searches. */
export { plain as markdownPlainText }
