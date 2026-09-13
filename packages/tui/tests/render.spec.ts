import { describe, expect, it } from 'vitest'
import {
  COMPOSER_MARGIN,
  COMPOSER_MAX_ROWS,
  COMPOSER_PREFIX,
  composerBorderBottom,
  composerCursorColumn,
  composerCursorPosition,
  composerFrame,
  composerLines,
  composerView,
  commandMenuItems,
  contextBar,
  createTurnRenderer,
  displayWidth,
  formatTokens,
  makeDash,
  padLeft,
  padRight,
  plainPalette,
  renderMenu,
  statusLine,
  takeTailWidth,
  turnFooter,
  visualRowsOf,
} from '../src/index.ts'

/** Sink that keeps everything written for assertions. */
function bufferSink(): { write(chunk: string): void; text(): string } {
  let buffer = ''
  return {
    write: chunk => { buffer += chunk },
    text: () => buffer,
  }
}

describe('displayWidth', () => {
  it('ignores CSI sequences and counts wide and zero-width code points', () => {
    expect(displayWidth('\u001B[31mred\u001B[0m')).toBe(3)
    expect(displayWidth('читай')).toBe(5)
    expect(displayWidth('中文')).toBe(4)
    expect(displayWidth('a\u0301')).toBe(1)
    expect(displayWidth('🚀')).toBe(2)
    expect(displayWidth('\t')).toBe(4)
  })
})

describe('padding', () => {
  it('pads by display columns, not by code units', () => {
    expect(padRight('中文', 6)).toBe('中文  ')
    expect(padLeft('中文', 6)).toBe('  中文')
    expect(padRight('abcd', 2)).toBe('abcd')
    expect(takeTailWidth('ab中', 3)).toBe('b中')
  })
})

describe('status line', () => {
  it('drops parts as the terminal narrows', () => {
    const wide = statusLine({
      model: 'm', contextPercent: 47, costUsd: 0.04, turnSeconds: 4.2, branch: 'main', dirty: true, mode: 'Agent', cols: 120,
    }, plainPalette)
    expect(wide).toContain('ctx 47%')
    expect(wide).toContain('▓▓▓▓▓░░░░░')
    expect(wide).toContain('$0.04')
    expect(wide).toContain('4.2s')
    expect(wide).toContain('main*')
    expect(wide.endsWith('Agent')).toBe(true)

    const narrow = statusLine({ model: 'm', contextPercent: 47, mode: 'Agent', cols: 60 }, plainPalette)
    expect(narrow).toBe('  m · ctx 47% · Agent')
  })

  it('fills ten context cells from the percentage', () => {
    expect(contextBar(47, plainPalette)).toBe('▓▓▓▓▓░░░░░')
    expect(contextBar(86, plainPalette)).toBe('▓▓▓▓▓▓▓▓▓░')
    expect(contextBar(200, plainPalette)).toBe('▓▓▓▓▓▓▓▓▓▓')
  })
})

describe('turn footer', () => {
  it('reports what the turn measured', () => {
    expect(turnFooter({ tokens: 12400, costUsd: 0.07, seconds: 18.4, tools: 6, added: 82, removed: 11 }, plainPalette))
      .toBe('  ✓  12.4k tok · $0.07 · 18.4s · 6 tools · +82/-11')
    expect(formatTokens(980)).toBe('980')
    expect(formatTokens(1_200_000)).toBe('1.2M')
  })
})

describe('composer', () => {
  it('keeps the input row within the inner width', () => {
    const lines = composerLines({ draft: '', innerWidth: 80, showHint: true }, plainPalette)
    expect(lines).toHaveLength(4)
    for (const line of lines) expect(displayWidth(line)).toBeLessThanOrEqual(82)
    expect(lines[1]).toContain(COMPOSER_PREFIX)
    expect(lines[2]).toContain('@ файлы')
  })

  it('keeps the legend above a draft and truncates a long tail', () => {
    const typed = composerLines({ draft: 'test', innerWidth: 80, showHint: true }, plainPalette)
    expect(typed).toHaveLength(4)
    expect(typed[2]).toContain('@ файлы')
    const hidden = composerLines({ draft: 'test', innerWidth: 80, showHint: false }, plainPalette)
    expect(hidden).toHaveLength(3)
    expect(hidden.join('\n')).not.toContain('@ файлы')
    const view = composerView('x'.repeat(200), 20)
    expect(view.text.startsWith('…')).toBe(true)
    expect(view.hidden).toBe(181)
    expect(displayWidth(view.text)).toBeLessThanOrEqual(20)
    expect(composerCursorColumn('abc', 60)).toBe(COMPOSER_MARGIN + 2 + displayWidth(COMPOSER_PREFIX) + 3)
    expect(makeDash(10)).toBe('- - - - - ')
  })

  it('keeps every row inside the box on a narrow terminal', () => {
    const inner = 16
    const tall = composerLines({
      draft: Array.from({ length: 12 }, (_, index) => `строка ${String(index + 1)}`).join('\n'),
      innerWidth: inner,
      showHint: true,
      status: 'kibborg/Kibborg_Flash_v5.7 · Agent',
      counters: '3 агента · 7 задач · 12.4k tok',
    }, plainPalette)
    for (const line of tall) expect(displayWidth(line)).toBeLessThanOrEqual(inner + COMPOSER_MARGIN)
    // The scroll marker and the counters are part of the rows they share, so a
    // narrow box clips them instead of widening the frame.
    expect(tall.join('\n')).toContain('▲ +')
    expect(displayWidth(composerBorderBottom(inner, 'модель · Agent', '3 агента · 12.4k tok'))).toBe(inner)
    expect(displayWidth(composerBorderBottom(8, 'очень длинное имя модели · Agent', '3 агента'))).toBe(8)
  })

  it('addresses the caret inside the box it draws', () => {
    const inner = 40
    const frame = composerFrame({ draft: 'привет', innerWidth: inner, showHint: true }, plainPalette)
    const row = frame.lines[frame.cursorRow - 1] ?? ''
    // The caret sits after the text it follows, and the row it names is the last
    // draft row of the frame it returns.
    expect(displayWidth(row.slice(0, frame.cursorColumn - 1))).toBe(
      COMPOSER_MARGIN + 4 + displayWidth('привет'),
    )
    expect(row).toContain('> привет')
  })

  it('keeps the caret on the newest row when the draft scrolls', () => {
    const inner = 40
    const draft = Array.from({ length: 12 }, (_, index) => `строка ${String(index + 1)}`).join('\n')
    const frame = composerFrame({ draft, innerWidth: inner, showHint: true }, plainPalette)
    const row = frame.lines[frame.cursorRow - 1] ?? ''
    // The scroll marker sits on the first visible row, so it takes nothing from the
    // columns of the last one and the caret stays right after the text.
    expect(frame.cursorRow).toBe(1 + COMPOSER_MAX_ROWS)
    expect(row).toContain('строка 12')
    expect(displayWidth(row.slice(0, frame.cursorColumn - 1))).toBe(
      COMPOSER_MARGIN + 4 + displayWidth('строка 12'),
    )
    // The marker is visible on the row above and says how much is hidden.
    expect(frame.lines[1]).toContain(`▲ +${String(12 - COMPOSER_MAX_ROWS)}`)
  })
})

describe('command palette', () => {
  it('lists names and descriptions without promising keys', () => {
    const items = commandMenuItems(['new', 'model', 'quit', 'resume', 'plan'])
    const lines = renderMenu(items, { query: '', selected: 0 }, 90).lines.map(line => line.spans.map(span => span.text).join(''))
    const text = lines.join('\n')
    expect(text).toContain('/new')
    expect(text).toContain('clear + fresh')
    // A key printed beside a command has to work there: the surface implements none
    // of these, so the palette must not advertise them.
    for (const hint of ['ctrl+n', 'ctrl+q', 'ctrl+m', 'ctrl+p', 'f3', 's-tab']) {
      expect(text).not.toContain(hint)
    }
  })
})

describe('turn renderer', () => {
  it('renders the conversation without a reasoning surface', () => {
    const sink = bufferSink()
    const renderer = createTurnRenderer({ palette: plainPalette, sink, cols: 96 })
    renderer.user('привет')
    renderer.toolCall('read', 'README.md')
    renderer.text('первая ')
    renderer.text('строка')
    renderer.closeAnswer()
    renderer.finish({ tokens: 1234, seconds: 1.5 })
    renderer.status({ model: 'm', contextPercent: 10, mode: 'Agent' })
    const text = sink.text()
    expect(text).toMatch(/  > привет {2}\d\d:\d\d:\d\d/u)
    expect(text).toContain('⚙  read   README.md')
    expect(text).toContain('  первая строка')
    expect(text).toContain('✓  1.2k tok · 1.5s · 1 tools')
    expect(text).toContain('  m · ctx 10%')
    expect('reasoning' in renderer).toBe(false)
    expect(renderer.toolCount()).toBe(1)
  })

  it('reports notices and failures on their own lines', () => {
    const sink = bufferSink()
    const renderer = createTurnRenderer({ palette: plainPalette, sink, cols: 96 })
    renderer.notice('provider retry scheduled')
    renderer.toolFailure('bash', 'exit 1')
    renderer.error('turn failed')
    const text = sink.text()
    expect(text).toContain('⚠  provider retry scheduled')
    expect(text).toContain('✗  bash   exit 1')
    expect(text).toContain('✗  turn failed')
  })
})

describe('composerCursorPosition', () => {
  const prefix = COMPOSER_MARGIN + 2 + displayWidth(COMPOSER_PREFIX)

  it('sits on the first row at the prompt on an empty draft', () => {
    const position = composerCursorPosition('', 0, 80)
    expect(position.row).toBe(1)
    expect(position.column).toBe(prefix)
  })

  it('advances the column as the caret moves through a line', () => {
    expect(composerCursorPosition('abc', 1, 80).column).toBe(prefix + 1)
    expect(composerCursorPosition('abc', 3, 80).column).toBe(prefix + 3)
  })

  it('moves to the second row and its prompt on a line break', () => {
    const position = composerCursorPosition('ab\ncd', 4, 80)
    expect(position.row).toBe(2)
    // The continuation prompt is `COMPOSER_CONTINUATION` (`  `), same width as the prefix.
    expect(position.column).toBe(prefix + 1)
  })

  it('clamps a cursor past the end to the last character', () => {
    const atEnd = composerCursorPosition('abc', 3, 80)
    const beyond = composerCursorPosition('abc', 99, 80)
    expect(beyond).toEqual(atEnd)
  })

  it('wraps a long pasted line into several rows', () => {
    const rows = visualRowsOf('word '.repeat(40), 30)
    expect(rows.length).toBeGreaterThan(1)
    for (const row of rows) expect(displayWidth(row)).toBeLessThanOrEqual(30)
  })
})
