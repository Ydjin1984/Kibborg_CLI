import { describe, expect, it } from 'vitest'
import {
  COMPOSER_PREFIX,
  composerCursorColumn,
  composerLines,
  composerView,
  contextBar,
  createTurnRenderer,
  displayWidth,
  formatTokens,
  makeDash,
  padLeft,
  padRight,
  plainPalette,
  statusLine,
  takeTailWidth,
  turnFooter,
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
    expect(lines[1]?.startsWith(COMPOSER_PREFIX)).toBe(true)
    expect(lines[2]).toContain('@ files')
  })

  it('hides the hint above a draft and shows a truncated tail', () => {
    const typed = composerLines({ draft: 'test', innerWidth: 80, showHint: true }, plainPalette)
    expect(typed[2]).not.toContain('@ files')
    const lines = composerLines({ draft: 'x'.repeat(200), innerWidth: 60, showHint: true }, plainPalette)
    expect(lines[2]).not.toContain('@ files')
    const view = composerView('x'.repeat(200), 20)
    expect(view.text.startsWith('…')).toBe(true)
    expect(view.hidden).toBe(181)
    expect(displayWidth(view.text)).toBeLessThanOrEqual(20)
    expect(composerCursorColumn('abc', 60)).toBe(displayWidth(COMPOSER_PREFIX) + 3)
    expect(makeDash(10)).toBe('- - - - - ')
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
    expect(text).toContain('  You\n  привет')
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
