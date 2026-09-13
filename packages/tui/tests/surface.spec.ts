import { describe, it, expect } from 'vitest'
import { createBuffer } from '../src/framebuffer.ts'
import { createLog, clampScroll, renderEntries, visibleLines, scrollIndicator, wrapText, lineWidth, plainText, type AgentBadge } from '../src/log.ts'
import { drawLogView } from '../src/logview.ts'
import { parseKeys } from '../src/input.ts'
import { decodeSgrMouse, decodeX10Mouse, wheelDelta } from '../src/mouse.ts'
import { createApp } from '../src/app.ts'
import { plainPalette } from '../src/tokens.ts'
import { statusLine } from '../src/status.ts'
import { zoneCursor, zoneLines } from '../src/zone.ts'
import { detectCaps } from '../src/screen.ts'
import { renderHeader } from '../src/header.ts'
import { displayWidth } from '../src/width.ts'

/** A writable stream stub that records what the surface emitted. */
function fakeStream(columns = 100, rows = 30): { stream: NodeJS.WriteStream; written: string[] } {
  const written: string[] = []
  const stream = {
    columns,
    rows,
    isTTY: true,
    write: (chunk: string) => {
      written.push(chunk)
      return true
    },
    on: () => stream,
    off: () => stream,
    removeListener: () => stream,
  }
  return { stream: stream as unknown as NodeJS.WriteStream, written }
}

describe('mouse decoding', () => {
  it('leaves the mouse to the terminal unless the surface opts in', () => {
    const stream = fakeStream(80, 24).stream
    // Every reference CLI (Grok, Codex, Claude Code, OpenCode) keeps reporting off,
    // which is what lets the terminal own drag-select, copy and the wheel.
    expect(detectCaps(stream, {}).mouse).toBe(false)
    expect(detectCaps(stream, { KIBBORG_MOUSE: '' }).mouse).toBe(false)
    expect(detectCaps(stream, { KIBBORG_MOUSE: '1' }).mouse).toBe(true)
  })

  it('keeps reporting off in a non-interactive stream', () => {
    const stream = { columns: 80, rows: 24, isTTY: false, write: () => true } as unknown as NodeJS.WriteStream
    expect(detectCaps(stream, { KIBBORG_MOUSE: '1' }).mouse).toBe(false)
  })

  it('decodes wheel reports', () => {
    const up = decodeSgrMouse('<64;10;5M')
    expect(up?.action).toBe('wheel-up')
    expect(up?.x).toBe(9)
    expect(up?.y).toBe(4)
    expect(decodeSgrMouse('<65;1;1M')?.action).toBe('wheel-down')
  })

  it('keeps wheel modifiers and button clicks apart', () => {
    const shifted = decodeSgrMouse('<68;3;2M')
    expect(shifted?.action).toBe('wheel-up')
    expect(shifted?.shift).toBe(true)
    expect(decodeSgrMouse('<0;3;2M')?.action).toBe('press-left')
    expect(decodeSgrMouse('<2;3;2M')?.action).toBe('press-right')
    expect(decodeSgrMouse('<0;3;2m')?.action).toBe('release')
  })

  it('rejects malformed reports', () => {
    expect(decodeSgrMouse('<x;y;zM')).toBeNull()
    expect(decodeSgrMouse('garbage')).toBeNull()
    expect(decodeX10Mouse('ab')).toBeNull()
  })

  it('decodes legacy X10 reports', () => {
    const event = decodeX10Mouse(String.fromCharCode(32 + 64, 32 + 4, 32 + 2))
    expect(event?.action).toBe('wheel-up')
    expect(event?.x).toBe(3)
    expect(event?.y).toBe(1)
  })

  it('turns wheel events into a line delta', () => {
    expect(wheelDelta({ action: 'wheel-up', x: 0, y: 0, shift: false, alt: false, ctrl: false }, 3)).toBe(-3)
    expect(wheelDelta({ action: 'wheel-down', x: 0, y: 0, shift: false, alt: false, ctrl: false }, 3)).toBe(3)
    expect(wheelDelta({ action: 'move', x: 0, y: 0, shift: false, alt: false, ctrl: false }, 3)).toBe(0)
  })

  it('drags a selection from the first press, and clicks a fold row instead of copying it', () => {
    const { stream } = fakeStream(80, 24)
    const app = createApp({
      stdout: stream,
      stdin: stream as unknown as NodeJS.ReadStream,
      palette: plainPalette,
      version: 'v1.0.0',
      cwd: '/work',
      status: { model: 'm', mode: 'Agent', contextPercent: 0 },
      caps: { altScreen: true, mouse: true, trueColor: false, syncOutput: true, bracketedPaste: true, interactive: true },
    })
    const picked: string[] = []
    app.onSelection(text => { picked.push(text) })
    const id = app.log.append({
      kind: 'tool',
      text: 'guard.go',
      name: 'read',
      status: 'ok',
      title: 'Читает guard.go',
      output: 'первая строка вывода',
    })
    app.start()
    const mouse = (action: 'press-left' | 'move' | 'release', x: number, y: number): void => {
      app.handleKey({ kind: 'mouse', event: { action, x, y, shift: false, alt: false, ctrl: false } })
    }
    // A drag from any row paints at once and reports the range it covers, even if
    // the terminal never reported the motion in between.
    const dragAll = (): string => {
      picked.length = 0
      mouse('press-left', 0, 0)
      mouse('move', 79, 23)
      mouse('release', 79, 23)
      return picked[0] ?? ''
    }
    const frame = dragAll()
    expect(frame.trim()).not.toBe('')
    expect(frame).toContain('Читает guard.go')
    // A click on the fold row of that entry expands it, and copies nothing.
    const markerRow = frame.split('\n').findIndex(line => line.includes('▸'))
    expect(markerRow).toBeGreaterThan(0)
    picked.length = 0
    mouse('press-left', 10, markerRow)
    mouse('release', 10, markerRow)
    expect(app.log.entries.find(entry => entry.id === id)?.expanded).toBe(true)
    expect(picked).toHaveLength(0)
    app.stop()
  })

  it('grows the composer with the draft and scrolls its own text past eight lines', () => {
    const { stream } = fakeStream(80, 24)
    const app = createApp({
      stdout: stream,
      stdin: stream as unknown as NodeJS.ReadStream,
      palette: plainPalette,
      version: 'v1.0.0',
      cwd: '/work',
      status: { model: 'm', mode: 'Agent', contextPercent: 0 },
      caps: { altScreen: true, mouse: true, trueColor: false, syncOutput: true, bracketedPaste: true, interactive: true },
    })
    const picked: string[] = []
    app.onSelection(text => { picked.push(text) })
    app.setDraft(Array.from({ length: 12 }, (_, index) => `строка ${String(index + 1)}`).join('\n'))
    app.start()
    // The draft is longer than the window, so the frame shows its tail and says
    // how much is above it.
    const readFrame = (): string => {
      picked.length = 0
      app.handleKey({ kind: 'mouse', event: { action: 'press-left', x: 0, y: 0, shift: false, alt: false, ctrl: false } })
      app.handleKey({ kind: 'mouse', event: { action: 'move', x: 79, y: 23, shift: false, alt: false, ctrl: false } })
      app.handleKey({ kind: 'mouse', event: { action: 'release', x: 79, y: 23, shift: false, alt: false, ctrl: false } })
      return picked.join('\n')
    }
    const long = readFrame()
    expect(long).toContain('строка 12')
    expect(long).toContain('▲ +4')
    // Under the limit every line is on screen and nothing claims to be hidden.
    app.setDraft(['первая', 'вторая', 'третья'].join('\n'))
    const short = readFrame()
    expect(short).toContain('первая')
    expect(short).toContain('третья')
    expect(short).not.toContain('▲')
    app.stop()
  })
})

describe('key parsing extensions', () => {
  it('decodes paging, Ctrl+O, and mouse reports', () => {
    expect(parseKeys('\u001B[5~').keys[0]).toEqual({ kind: 'page-up' })
    expect(parseKeys('\u001B[6~').keys[0]).toEqual({ kind: 'page-down' })
    expect(parseKeys('\u000F').keys[0]).toEqual({ kind: 'ctrl-o' })
    const parsed = parseKeys('\u001B[<64;10;5M')
    expect(parsed.keys).toHaveLength(1)
    expect(parsed.keys[0]?.kind).toBe('mouse')
  })

  it('never turns a mouse report into text', () => {
    const parsed = parseKeys('\u001B[<0;10;5M')
    expect(parsed.keys.every(key => key.kind === 'mouse')).toBe(true)
    expect(parsed.pending).toBe('')
  })

  it('keeps an unfinished mouse report pending', () => {
    const parsed = parseKeys('\u001B[<64;10')
    expect(parsed.keys).toHaveLength(0)
    expect(parsed.pending).not.toBe('')
  })
})

describe('transcript rendering', () => {
  it('never renders a line wider than the region, boxes included', () => {
    const log = createLog()
    log.append({ kind: 'user', text: 'проанализируй этот проект и найди проблемы' })
    log.append({ kind: 'assistant', text: 'Начинаю анализ. ' + 'Очень длинное слово'.repeat(8) })
    log.append({ kind: 'tool', text: 'src/**/auth', name: 'search', status: 'ok', meta: '14 files · 3 matches' })
    log.append({ kind: 'tool', text: 'nmap -sV 10.0.0.1', name: 'bash', status: 'running' })
    log.append({ kind: 'error', text: 'соединение разорвано' })
    log.append({ kind: 'notice', text: 'провайдер повторит запрос' })
    log.append({ kind: 'plan', text: 'Inspect project\nRead manifest' })
    log.append({ kind: 'diff', text: '+ added\n- removed' })
    log.append({ kind: 'rule', text: '' })
    // A delegation box, its own rows, a finished branch, and a deeper tree: every
    // one of them has to hold its walls inside the region.
    const agent: AgentBadge = {
      label: 'Очень длинное имя делегированной задачи для проверки ширины',
      model: 'kibborg/Kibborg_Flash_v5.7',
      role: 'EXECUTOR',
      depth: 1,
      token: 'AgentFlash',
      sessionId: 'child',
    }
    log.append({ kind: 'agent', text: 'Анализирует код', agent })
    log.append({ kind: 'tool', text: 'guard.go', name: 'read', status: 'ok', title: 'Читает engine-go/guard.go', agent })
    log.append({
      kind: 'agent',
      text: '',
      agent: { ...agent, depth: 3, sessionId: 'grand', state: 'done' },
    })
    log.append({ kind: 'tool', text: 'deep', name: 'grep', status: 'ok', title: 'Ищет deep', agent: { ...agent, depth: 3, sessionId: 'grand' } })
    for (let width = 8; width <= 200; width += 7) {
      const lines = renderEntries(log.entries, width)
      for (const line of lines) expect(lineWidth(line)).toBeLessThanOrEqual(width)
    }
  })

  it('reports that the model reasoned without showing the reasoning', () => {
    const log = createLog()
    log.append({ kind: 'thought', text: 'внутренние рассуждения', durationMs: 2200 })
    const text = renderEntries(log.entries, 80).map(plainText).join('\n')
    expect(text).toContain('♦ Думал 2.2s')
    // The reasoning body itself never reaches the transcript.
    expect(text).not.toContain('внутренние рассуждения')
  })

  it('shows the running turn as one work row with time, tokens, and the stop key', () => {
    const log = createLog()
    const id = log.append({
      kind: 'stage',
      text: '',
      verb: 'Запускает go test ./...',
      status: 'running',
      durationMs: 24_000,
      tokens: 34_700,
    })
    const running = renderEntries(log.entries, 100).map(plainText).join('\n')
    expect(running).toContain('♦ Запускает go test ./...')
    expect(running).toContain('24.0s')
    expect(running).toContain('↓34.7k')
    expect(running).toContain('[Ctrl+C]')
    // A finished row reports what the turn did and stops offering the key that would
    // have stopped it.
    log.patch(id, { status: 'ok' })
    const done = renderEntries(log.entries, 100).map(plainText).join('\n')
    expect(done).not.toContain('[Ctrl+C]')
    expect(done).toContain('↓34.7k')
  })

  it('marks the status of a tool with its lifecycle color', () => {
    const log = createLog()
    log.append({ kind: 'tool', text: 'README.md', name: 'grep', status: 'ok', title: 'Ищет строки' })
    log.append({ kind: 'tool', text: 'x', name: 'grep', status: 'fail', title: 'Ищет строки' })
    const lines = renderEntries(log.entries, 80, { runningGlyph: '✳' })
    const tokens = lines.flatMap(line => line.spans.map(span => span.text))
    expect(tokens).toContain('✓')
    expect(tokens).toContain('✕')
    // The word, not the tool name, is what the row says.
    expect(tokens).toContain('Ищет строки')
  })

  it('hides a tool detail behind one clickable row', () => {
    const log = createLog()
    const detail = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
    const id = log.append({ kind: 'tool', text: 'ls', name: 'bash', status: 'ok', detail, title: 'Запускает ls' })
    const condensed = renderEntries(log.entries, 100, { runningGlyph: '✳' })
    // Nothing but the action line and the row that offers the detail.
    expect(condensed.map(plainText).join('\n')).toContain('Запускает ls')
    expect(condensed.some(line => line.collapsed === true)).toBe(true)
    expect(condensed.some(line => plainText(line).includes('⎿  h'))).toBe(false)
    log.patch(id, { expanded: true })
    const lines = renderEntries(log.entries, 100, { runningGlyph: '✳' })
    const shown = lines.map(line => plainText(line))
    for (const row of detail) expect(shown.some(text => text.includes(`⎿  ${row}`))).toBe(true)
    expect(lines.some(line => line.collapsed === true)).toBe(false)
  })

  it('shows what a tool was sent and what it returned, with the change counts', () => {
    const log = createLog()
    const input = '{\n  "file_path": "a.txt",\n  "old_string": "x"\n}'
    const output = 'The file a.txt has been updated'
    const id = log.append({
      kind: 'tool',
      text: 'a.txt',
      name: 'edit',
      status: 'ok',
      input,
      output,
      diff: ['@@ a.txt', ' context', '-x', '+y'],
      added: 1,
      removed: 1,
      durationMs: 135,
      // The entry is longer than the collapse bound, so the block is read after
      // expanding it — which is what the header row offers a click for.
      expanded: true,
    })
    expect(renderEntries(log.entries, 100, {}).some(line => line.entryId === id)).toBe(true)
    const lines = renderEntries(log.entries, 100, { runningGlyph: '✳' })
    const text = lines.map(line => plainText(line)).join('\n')
    expect(text).toContain('+1 −1')
    expect(text).toContain('135ms')
    expect(text).toContain('"file_path": "a.txt"')
    expect(text).toContain('IN  {')
    expect(text).toContain('@@ a.txt')
    expect(text).toContain('-x')
    expect(text).toContain('+y')
    expect(text).toContain('OUT The file a.txt has been updated')
    const diffTokens = lines.flatMap(line => line.spans).filter(span => span.token === 'DiffAdd' || span.token === 'DiffRemove')
    expect(diffTokens.length).toBeGreaterThan(0)
    // Unchanged context recedes so the two changed rows carry the eye, and the
    // added and removed rows take one accent each.
    const added = lines.flatMap(line => line.spans).find(span => span.text === '+y')
    const removed = lines.flatMap(line => line.spans).find(span => span.text === '-x')
    const context = lines.flatMap(line => line.spans).find(span => span.text.trim() === 'context')
    expect(added?.token).toBe('DiffAdd')
    expect(removed?.token).toBe('DiffRemove')
    expect(context?.token).toBe('Muted')
    expect(context?.dim).toBe(true)
  })

  it('marks the task row of a user entry as the heading of its branch', () => {
    const log = createLog()
    log.append({ kind: 'user', text: 'привет' })
    const lines = renderEntries(log.entries, 60)
    // The task row carries the marker and the heading at once: the sticky header of
    // a scrolled view shows the task, not a label repeating who wrote it.
    expect(lines[0]?.heading).toBe(true)
    expect(lines[0]?.anchor).toBe('You')
    expect(plainText(lines[0] as StyledLine)).toContain('  > привет')
    // The time of the task sits at the right edge of that same row.
    expect(plainText(lines[0] as StyledLine)).toMatch(/\d\d:\d\d$/u)
    // A task that wraps keeps every row under the same anchor.
    const long = createLog()
    long.append({ kind: 'user', text: Array.from({ length: 12 }, () => 'слово').join(' ') })
    const wrapped = renderEntries(long.entries, 30)
    expect(wrapped.length).toBeGreaterThan(1)
    for (const line of wrapped) expect(line.anchor).toBe('You')
  })

  it('wraps long words without a space', () => {
    const lines = wrapText('a'.repeat(25), 10)
    expect(lines.length).toBeGreaterThan(1)
    for (const line of lines) expect(displayWidth(line)).toBeLessThanOrEqual(10)
  })

  it('clamps scrolling and reports hidden rows', () => {
    expect(clampScroll(-5, 100, 20)).toBe(0)
    expect(clampScroll(500, 100, 20)).toBe(80)
    expect(clampScroll(10, 5, 20)).toBe(0)
    expect(visibleLines([{ spans: [] }, { spans: [] }], 1, 0)).toHaveLength(1)
    expect(visibleLines([{ spans: [] }], 0, 0)).toHaveLength(0)
    expect(scrollIndicator(100, 20, 30)).toEqual({ above: 30, below: 50 })
  })
})

describe('transcript view', () => {
  it('follows the tail and paints only inside its rectangle', () => {
    const log = createLog()
    for (let index = 0; index < 40; index++) log.append({ kind: 'assistant', text: `строка ${String(index)}` })
    const lines = renderEntries(log.entries, 40)
    const buf = createBuffer(40, 12, plainPalette)
    const result = drawLogView(buf, { x: 0, y: 0, w: 40, h: 10 }, lines, { offset: 0, follow: true })
    expect(result.offset).toBe(lines.length - 10)
    expect(result.total).toBe(lines.length)
  })

  it('shows an indicator while scrolled back', () => {
    const log = createLog()
    for (let index = 0; index < 40; index++) log.append({ kind: 'assistant', text: `строка ${String(index)}` })
    const lines = renderEntries(log.entries, 40)
    const buf = createBuffer(40, 12, plainPalette)
    drawLogView(buf, { x: 0, y: 0, w: 40, h: 10 }, lines, { offset: 5, follow: false })
    const text = buf.snapshot().join('\n')
    expect(text).toContain('↓')
  })

  it('draws a thin scrollbar in the rightmost column only while the log overflows', () => {
    const log = createLog()
    for (let index = 0; index < 40; index++) log.append({ kind: 'assistant', text: `строка ${String(index)}` })
    const lines = renderEntries(log.entries, 40)
    const buf = createBuffer(40, 12, plainPalette)
    const rect = { x: 0, y: 0, w: 40, h: 10 }
    drawLogView(buf, rect, lines, { offset: 0, follow: true })
    const column = (offset: number): string => {
      const frame = createBuffer(40, 12, plainPalette)
      drawLogView(frame, rect, lines, { offset, follow: false })
      return frame.snapshot().map(row => row[39] ?? ' ').join('')
    }
    // The thumb sits at the bottom when the view follows the tail and moves up as the
    // reader scrolls back; the track behind it is one column wide.
    const tail = column(lines.length - rect.h)
    expect(tail).toContain('█')
    expect(tail.indexOf('█')).toBe(rect.h - 1)
    expect(column(0).indexOf('█')).toBe(0)
    // One thumb, and a track that fills the rest of the viewport.
    expect(tail.match(/█/gu)).toHaveLength(1)
    expect(tail).toContain('│')
    // A log that fits needs no scrollbar at all.
    const short = createBuffer(40, 12, plainPalette)
    drawLogView(short, rect, lines.slice(0, 4), { offset: 0, follow: true })
    expect(short.snapshot().map(row => row[39] ?? ' ').join('')).not.toContain('█')
  })
})

describe('fullscreen app', () => {
  it('paints the location row, the composer, and the status line', () => {
    const { stream, written } = fakeStream(100, 30)
    const app = createApp({
      stdout: stream,
      stdin: stream as unknown as NodeJS.ReadStream,
      palette: plainPalette,
      version: 'v1.0.0',
      cwd: '/work',
      status: { model: 'DeepSeek V4 Flash', mode: 'Agent', contextPercent: 18, branch: 'main' },
      caps: { altScreen: true, mouse: true, trueColor: false, syncOutput: true, bracketedPaste: true, interactive: true },
    })
    app.log.append({ kind: 'user', text: 'привет' })
    app.start()
    const output = written.join('')
    // The header answers "where am I": branch, directory, and context share.
    expect(output).toContain('≡ main  /work')
    expect(output).toContain('ctx 18%')
    expect(output).toContain('\u001B[?1049h')
    // The model belongs to the composer's bottom border, where the user types.
    expect(output).toContain('╰─ DeepSeek V4 Flash · Agent ')
    app.stop()
    expect(written.join('')).toContain('\u001B[?1049l')
  })

  it('omits the branch name outside a repository', () => {
    const { stream, written } = fakeStream(80, 20)
    const app = createApp({
      stdout: stream,
      stdin: stream as unknown as NodeJS.ReadStream,
      palette: plainPalette,
      version: 'v1.0.0',
      cwd: '/work',
      status: { model: 'm', mode: 'Agent', contextPercent: 0 },
      caps: { altScreen: true, mouse: true, trueColor: false, syncOutput: true, bracketedPaste: true, interactive: true },
    })
    app.start()
    const output = written.join('')
    // Nothing measured the context yet, and there is no branch to name: the row
    // says where the session is and nothing it cannot know.
    expect(output).toContain('≡  /work')
    expect(output).not.toContain('≡ main')
    expect(output).not.toContain('ctx 0%')
    app.stop()
  })

  it('scrolls the transcript on wheel events and returns to the tail', () => {    const { stream, written } = fakeStream(80, 20)
    const app = createApp({
      stdout: stream,
      stdin: stream as unknown as NodeJS.ReadStream,
      palette: plainPalette,
      version: 'v1.0.0',
      cwd: '/work',
      status: { model: 'm', mode: 'Agent', contextPercent: 0 },
      caps: { altScreen: true, mouse: true, trueColor: false, syncOutput: true, bracketedPaste: true, interactive: true },
    })
    for (let index = 0; index < 60; index++) app.log.append({ kind: 'assistant', text: `строка ${String(index)}` })
    app.start()
    written.length = 0
    app.handleKey({ kind: 'mouse', event: { action: 'wheel-up', x: 1, y: 1, shift: false, alt: false, ctrl: false } })
    const scrolled = written.join('')
    expect(scrolled).toContain('↑')
    written.length = 0
    app.handleKey({ kind: 'page-down' })
    app.handleKey({ kind: 'page-down' })
    expect(written.join('')).not.toContain('↑')
    app.stop()
  })

  it('reports the pick from a list the surface opened', () => {
    const { stream, written } = fakeStream(80, 24)
    const app = createApp({
      stdout: stream,
      stdin: stream as unknown as NodeJS.ReadStream,
      palette: plainPalette,
      version: 'v1.0.0',
      cwd: '/work',
      status: { model: 'm', mode: 'Agent', contextPercent: 0 },
      caps: { altScreen: true, mouse: true, trueColor: false, syncOutput: true, bracketedPaste: true, interactive: true },
    })
    const picks: string[] = []
    app.onMenuAccept(item => { picks.push(item.name) })
    app.start()
    written.length = 0
    app.openMenu([
      { group: 'MODEL', name: 'glm-5', desc: 'glm' },
      { group: 'MODEL', name: 'glm-4.6', desc: 'glm' },
    ], 'модель')
    const opened = written.join('')
    expect(opened).toContain('модель')
    expect(opened).toContain('glm-5')
    written.length = 0
    app.handleKey({ kind: 'down' })
    app.handleKey({ kind: 'enter' })
    expect(picks).toEqual(['glm-4.6'])
    app.stop()
  })

  it('leads a nested list with a way back but preselects the first real choice', () => {
    const { stream, written } = fakeStream(80, 24)
    const app = createApp({
      stdout: stream,
      stdin: stream as unknown as NodeJS.ReadStream,
      palette: plainPalette,
      version: 'v1.0.0',
      cwd: '/work',
      status: { model: 'm', mode: 'Agent', contextPercent: 0 },
      caps: { altScreen: true, mouse: true, trueColor: false, syncOutput: true, bracketedPaste: true, interactive: true },
    })
    const picks: string[] = []
    app.onMenuAccept(item => { picks.push(item.name) })
    app.start()
    written.length = 0
    app.openMenu([
      { group: 'НАВИГАЦИЯ', name: '↩ назад', desc: 'вернуться к списку команд' },
      { group: 'MODEL', name: 'glm-5', desc: 'glm' },
    ], 'модель', 1)
    const opened = written.join('')
    expect(opened).toContain('↩ назад')
    expect(opened).toContain('Esc — назад')
    app.handleKey({ kind: 'enter' })
    // Enter takes the preselected real choice, not the back row that leads the list.
    expect(picks).toEqual(['glm-5'])
    app.stop()
  })

  it('closes a surface-opened list on Escape and reports it', () => {
    const { stream, written } = fakeStream(80, 24)
    const app = createApp({
      stdout: stream,
      stdin: stream as unknown as NodeJS.ReadStream,
      palette: plainPalette,
      version: 'v1.0.0',
      cwd: '/work',
      status: { model: 'm', mode: 'Agent', contextPercent: 0 },
      caps: { altScreen: true, mouse: true, trueColor: false, syncOutput: true, bracketedPaste: true, interactive: true },
    })
    let closed = 0
    app.onMenuClose(() => { closed += 1 })
    app.start()
    app.openMenu([{ group: 'MODEL', name: 'glm-5', desc: 'glm' }], 'модель')
    written.length = 0
    app.handleKey({ kind: 'escape' })
    expect(closed).toBe(1)
    // The frame must come back without the list: the diff repaints the rows the
    // list occupied, so the title cannot reappear in the next frame.
    written.length = 0
    app.render()
    expect(written.join('')).not.toContain('модель')
    app.stop()
  })

  it('runs the command a palette entry names', () => {
    const { stream, written } = fakeStream(80, 24)
    const app = createApp({
      stdout: stream,
      stdin: stream as unknown as NodeJS.ReadStream,
      palette: plainPalette,
      version: 'v1.0.0',
      cwd: '/work',
      status: { model: 'm', mode: 'Agent', contextPercent: 0 },
      caps: { altScreen: true, mouse: true, trueColor: false, syncOutput: true, bracketedPaste: true, interactive: true },
    })
    const picks: string[] = []
    const handled: string[] = []
    app.onMenuAccept(item => { picks.push(item.name) })
    app.onUnhandled(key => { handled.push(key.kind) })
    app.setMenuItems([{ group: 'SESSION', name: '/new', desc: 'start a new session' }])
    app.start()
    written.length = 0
    // A draft that already spells a command is submitted by the loop rather than
    // completed by the palette: Enter reaches the unhandled handler, and the
    // palette must not report a pick of its own.
    app.setDraft('/new')
    app.handleKey({ kind: 'enter' })
    expect(picks).toEqual([])
    expect(handled).toContain('enter')
    app.stop()
  })

  it('reports a dragged text selection when the button comes up', () => {
    const { stream, written } = fakeStream(60, 16)
    const app = createApp({
      stdout: stream,
      stdin: stream as unknown as NodeJS.ReadStream,
      palette: plainPalette,
      version: 'v1.0.0',
      cwd: '/work',
      status: { model: 'm', mode: 'Agent', contextPercent: 0 },
      caps: { altScreen: true, mouse: true, trueColor: false, syncOutput: true, bracketedPaste: true, interactive: true },
    })
    const picked: string[] = []
    app.onSelection(text => { picked.push(text) })
    app.log.append({ kind: 'assistant', text: 'привет мир' })
    app.start()
    written.length = 0
    app.handleKey({ kind: 'mouse', event: { action: 'press-left', x: 0, y: 0, shift: false, alt: false, ctrl: false } })
    app.handleKey({ kind: 'mouse', event: { action: 'move', x: 59, y: 15, shift: false, alt: false, ctrl: false } })
    // The drag paints in reverse video, so the user sees what will be copied.
    expect(written.join('')).toContain('\u001B[7m')
    written.length = 0
    app.handleKey({ kind: 'mouse', event: { action: 'release', x: 59, y: 15, shift: false, alt: false, ctrl: false } })
    expect(picked).toHaveLength(1)
    expect(picked[0]).toContain('привет мир')
    // The highlight is gone once the selection is reported, and no second copy
    // happens on a later release.
    expect(written.join('')).not.toContain('\u001B[7m')
    app.handleKey({ kind: 'mouse', event: { action: 'release', x: 59, y: 15, shift: false, alt: false, ctrl: false } })
    expect(picked).toHaveLength(1)
    app.stop()
  })

  it('lets the arrows reach a question box that owns its own selection', () => {
    const { stream } = fakeStream(80, 24)
    const app = createApp({
      stdout: stream,
      stdin: stream as unknown as NodeJS.ReadStream,
      palette: plainPalette,
      version: 'v1.0.0',
      cwd: '/work',
      status: { model: 'm', mode: 'Agent', contextPercent: 0 },
      caps: { altScreen: true, mouse: true, trueColor: false, syncOutput: true, bracketedPaste: true, interactive: true },
    })
    const handled: string[] = []
    app.onUnhandled(key => { handled.push(key.kind) })
    app.start()
    app.setDialog({ token: 'PermLav', label: 'Question 1/1', lines: [{ spans: [] }], passthroughArrows: true })
    app.handleKey({ kind: 'up' })
    app.handleKey({ kind: 'down' })
    // The loop that owns the question moves the highlight, so the frame must not
    // swallow the arrows.
    expect(handled).toEqual(['up', 'down'])
    // A box that does not ask for them keeps the arrows: its own highlight moves.
    handled.length = 0
    app.setDialog({ token: 'PermLav', label: 'Question 1/1', lines: [{ spans: [] }, { spans: [] }] })
    app.handleKey({ kind: 'down' })
    expect(handled).toEqual([])
    app.stop()
  })

  it('grows the lower zone with the draft and scrolls its own rows', () => {
    const draft = Array.from({ length: 12 }, (_, index) => `строка ${String(index + 1)}`).join('\n')
    const state = {
      draft,
      innerWidth: 60,
      showHint: false,
      status: { model: 'm', mode: 'Agent', contextPercent: 0 },
      cols: 80,
    }
    const lines = zoneLines(state, plainPalette)
    const text = lines.join('\n')
    // The newest rows are on screen, and the first one says how many are above.
    expect(text).toContain('строка 12')
    expect(text).toContain('▲ +4')
    // The zone is taller than the four rows a single-line composer needs.
    expect(lines.length).toBeGreaterThan(6)
    const caret = zoneCursor(state)
    expect(caret.row).toBeGreaterThan(0)
    expect(caret.row).toBeLessThan(lines.length)
  })

  it('shows a short draft in full and keeps the caret on its last row', () => {
    const state = {
      draft: ['первая', 'вторая', 'третья'].join('\n'),
      innerWidth: 60,
      showHint: false,
      status: { model: 'm', mode: 'Agent', contextPercent: 0 },
      cols: 80,
    }
    const lines = zoneLines(state, plainPalette)
    const text = lines.join('\n')
    expect(text).toContain('первая')
    expect(text).toContain('третья')
    expect(text).not.toContain('▲')
    expect(zoneCursor(state).row).toBe(3)
  })

  it('shows a confirmation briefly and then removes it', async () => {
    const { stream } = fakeStream(80, 20)
    const app = createApp({
      stdout: stream,
      stdin: stream as unknown as NodeJS.ReadStream,
      palette: plainPalette,
      version: 'v1.0.0',
      cwd: '/work',
      status: { model: 'm', mode: 'Agent', contextPercent: 0 },
      caps: { altScreen: true, mouse: true, trueColor: false, syncOutput: true, bracketedPaste: true, interactive: true },
    })
    app.start()
    app.flash('модель: kibborg/Kibborg_Flash_v5.7', 40)
    const entries = app.log.entries.filter(entry => entry.kind === 'info').map(entry => entry.text)
    expect(entries).toContain('модель: kibborg/Kibborg_Flash_v5.7')
    await new Promise(resolve => setTimeout(resolve, 90))
    expect(app.log.entries.filter(entry => entry.kind === 'info')).toHaveLength(0)
    app.stop()
  })

  it('sets the model in the status line when the session switches', () => {
    const { stream, written } = fakeStream(80, 20)
    const app = createApp({
      stdout: stream,
      stdin: stream as unknown as NodeJS.ReadStream,
      palette: plainPalette,
      version: 'v1.0.0',
      cwd: '/work',
      status: { model: 'old/model', mode: 'Agent', contextPercent: 0 },
      caps: { altScreen: true, mouse: true, trueColor: false, syncOutput: true, bracketedPaste: true, interactive: true },
    })
    app.start()
    written.length = 0
    app.setStatus({ model: 'kibborg/Kibborg_Flash_v5.7' })
    expect(written.join('')).toContain('Kibborg_Flash_v5.7')
    expect(written.join('')).not.toContain('old/model')
    app.stop()
  })

  it('scrolls with the arrows while the composer is empty and recalls history when it is not', () => {
    const { stream, written } = fakeStream(80, 20)
    const app = createApp({
      stdout: stream,
      stdin: stream as unknown as NodeJS.ReadStream,
      palette: plainPalette,
      version: 'v1.0.0',
      cwd: '/work',
      status: { model: 'm', mode: 'Agent', contextPercent: 0 },
      caps: { altScreen: true, mouse: true, trueColor: false, syncOutput: true, bracketedPaste: true, interactive: true },
    })
    const handled: string[] = []
    app.onUnhandled(key => { handled.push(key.kind) })
    for (let index = 0; index < 60; index++) app.log.append({ kind: 'assistant', text: `строка ${String(index)}` })
    app.start()
    written.length = 0
    app.setDraft('')
    app.handleKey({ kind: 'up' })
    // An empty composer belongs to the transcript: the arrow pages back instead
    // of replacing the line with an old prompt.
    expect(written.join('')).toContain('↑')
    expect(handled).toEqual([])
    written.length = 0
    app.setDraft('новый запрос')
    app.handleKey({ kind: 'up' })
    expect(handled).toContain('up')
    app.stop()
  })

  it('keeps the context meter in the status line while the model runs', () => {
    const line = statusLine({
      model: 'kibborg/Kibborg_Flash_v5.7',
      contextPercent: 26,
      mode: 'Agent',
      cols: 120,
      running: true,
      turnSeconds: 26.6,
      tokens: 32119,
      agents: 3,
      tasks: 7,
      hint: 'esc прерывает ход',
    }, plainPalette)
    // The line answers "what is happening"; the model that answers is in the header.
    expect(line).toContain('Working')
    expect(line).toContain('26.6s')
    expect(line).toContain('ctx 26%')
    expect(line).toContain('32.1k tok')
    expect(line).toContain('3 агента')
    expect(line).toContain('7 задач')
    expect(line).toContain('Agent')
    expect(line).toContain('esc прерывает ход')
  })

  it('locates the session in the header row', () => {
    const header = renderHeader({
      model: 'kibborg/Kibborg_Flash_v5.7',
      cwd: '/work',
      version: 'v0.1.0',
      mode: 'Agent',
      running: true,
      tick: 3,
      elapsedMs: 1200,
      density: 'full',
      branch: 'feat/ui',
      dirty: true,
      contextPercent: 34,
      panel: 'Задачи',
    }, 120).map(line => line.spans.map(span => span.text).join(''))
    // The row says where the session is: branch and directory on the left, the
    // context share and the open panel on the right; the second row is the rule.
    expect(header).toHaveLength(2)
    expect(header[0]).toContain('≡ feat/ui*  /work')
    expect(header[0]).toContain('ctx 34%')
    expect(header[0]).toContain('[Задачи]')
    expect(header[1]).toContain('─')
  })

  it('walks the transcript with the arrows and folds the chosen entry', () => {
    const { stream, written } = fakeStream(90, 20)
    const app = createApp({
      stdout: stream,
      stdin: stream as unknown as NodeJS.ReadStream,
      palette: plainPalette,
      version: 'v1.0.0',
      cwd: '/work',
      status: { model: 'm', mode: 'Agent', contextPercent: 0 },
      caps: { altScreen: true, mouse: true, trueColor: false, syncOutput: true, bracketedPaste: true, interactive: true },
    })
    const output = Array.from({ length: 40 }, (_, index) => `строка вывода ${String(index)}`).join('\n')
    const tool = app.log.append({ kind: 'tool', text: 'big.md', name: 'read', status: 'ok', output, title: 'Читает big.md' })
    const answer = app.log.append({ kind: 'assistant', text: 'готово' })
    app.start()
    written.length = 0
    // The first `↑` picks the newest entry and marks it, so the reader knows what
    // Enter and `y` will act on.
    app.handleKey({ kind: 'up' })
    let frame = written.join('')
    expect(frame).toContain('▌')
    expect(frame).toContain('h/l — свернуть/развернуть')
    written.length = 0
    app.handleKey({ kind: 'up' })
    expect(written.join('')).toContain('Читает big.md')
    // `l` unfolds the chosen entry and `h` folds it back.
    written.length = 0
    app.handleKey({ kind: 'char', text: 'l' })
    expect(app.log.entries.find(entry => entry.id === tool)?.expanded).toBe(true)
    app.handleKey({ kind: 'char', text: 'h' })
    expect(app.log.entries.find(entry => entry.id === tool)?.expanded).toBe(false)
    // `y` copies the entry's own body, arguments and output included.
    const copied: string[] = []
    app.onSelection(text => { copied.push(text) })
    app.handleKey({ kind: 'char', text: 'y' })
    expect(copied.join('\n')).toContain('Читает big.md')
    expect(copied.join('\n')).toContain('строка вывода 39')
    // Walking past the last entry releases the mark and follows the tail again.
    app.handleKey({ kind: 'down' })
    written.length = 0
    app.handleKey({ kind: 'down' })
    expect(written.join('')).not.toContain('▌')
    expect(answer).toBeGreaterThan(0)
    app.stop()
  })

  it('moves the focus between the transcript and the input with Tab', () => {
    const { stream, written } = fakeStream(90, 20)
    const app = createApp({
      stdout: stream,
      stdin: stream as unknown as NodeJS.ReadStream,
      palette: plainPalette,
      version: 'v1.0.0',
      cwd: '/work',
      status: { model: 'm', mode: 'Agent', contextPercent: 0 },
      caps: { altScreen: true, mouse: true, trueColor: false, syncOutput: true, bracketedPaste: true, interactive: true },
    })
    app.log.append({ kind: 'assistant', text: 'первый ответ' })
    app.log.append({ kind: 'assistant', text: 'второй ответ' })
    const handled: string[] = []
    app.onUnhandled(key => { handled.push(key.kind) })
    app.start()
    written.length = 0
    // On an empty draft the first Tab takes the transcript, the second gives the
    // input back; a draft of its own keeps Tab for completion.
    app.handleKey({ kind: 'tab' })
    expect(written.join('')).toContain('▌')
    expect(handled).toEqual([])
    written.length = 0
    app.handleKey({ kind: 'tab' })
    expect(written.join('')).not.toContain('▌')
    app.setDraft('/mo')
    app.handleKey({ kind: 'tab' })
    expect(handled).toEqual(['tab'])
    app.stop()
  })

  it('lets an open dialog own the reader keys', () => {
    const { stream, written } = fakeStream(90, 20)
    const app = createApp({
      stdout: stream,
      stdin: stream as unknown as NodeJS.ReadStream,
      palette: plainPalette,
      version: 'v1.0.0',
      cwd: '/work',
      status: { model: 'm', mode: 'Agent', contextPercent: 0 },
      caps: { altScreen: true, mouse: true, trueColor: false, syncOutput: true, bracketedPaste: true, interactive: true },
    })
    const output = Array.from({ length: 30 }, (_, index) => `строка ${String(index)}`).join('\n')
    const id = app.log.append({ kind: 'tool', text: 'big.md', name: 'read', status: 'ok', output, title: 'Читает big.md' })
    app.start()
    app.handleKey({ kind: 'up' })
    const handled: string[] = []
    app.onUnhandled(key => { handled.push(key.kind) })
    // A question or an approval is the only thing the user can act on, so Enter and
    // `y` belong to it and must not fold or copy a block behind it.
    app.setDialog({ token: 'PermLav', label: 'Question 1/1', lines: [{ spans: [] }] })
    written.length = 0
    app.handleKey({ kind: 'enter' })
    app.handleKey({ kind: 'char', text: 'y' })
    expect(handled).toEqual(['enter', 'char'])
    expect(app.log.entries.find(entry => entry.id === id)?.expanded).toBeUndefined()
    app.stop()
  })

  it('releases the reader mark when its entry disappears', () => {
    const { stream, written } = fakeStream(90, 20)
    const app = createApp({
      stdout: stream,
      stdin: stream as unknown as NodeJS.ReadStream,
      palette: plainPalette,
      version: 'v1.0.0',
      cwd: '/work',
      status: { model: 'm', mode: 'Agent', contextPercent: 0 },
      caps: { altScreen: true, mouse: true, trueColor: false, syncOutput: true, bracketedPaste: true, interactive: true },
    })
    const work = app.log.append({ kind: 'stage', text: '', verb: 'Думает', status: 'running' })
    app.log.append({ kind: 'assistant', text: 'готово' })
    app.start()
    // Two steps up: the newest entry first, then the work row above it.
    app.handleKey({ kind: 'up' })
    written.length = 0
    app.handleKey({ kind: 'up' })
    expect(written.join('')).toContain('▌')
    expect(written.join('')).toContain('Думает')
    // The work row is removed when the answer arrives: the mark and the reader's
    // legend must go with it, or the keys would act on an entry that is gone.
    app.log.remove(work)
    written.length = 0
    app.render()
    const frame = written.join('')
    expect(frame).not.toContain('▌')
    expect(frame).not.toContain('h/l — свернуть/развернуть')
    app.stop()
  })

  it('lets a pick callback close a list or reopen the palette it came from', () => {
    const { stream, written } = fakeStream(90, 20)
    const app = createApp({
      stdout: stream,
      stdin: stream as unknown as NodeJS.ReadStream,
      palette: plainPalette,
      version: 'v1.0.0',
      cwd: '/work',
      status: { model: 'm', mode: 'Agent', contextPercent: 0 },
      caps: { altScreen: true, mouse: true, trueColor: false, syncOutput: true, bracketedPaste: true, interactive: true },
    })
    const commands = [{ group: 'CMD', name: '/model', desc: 'switch model' }]
    const models = [
      { group: 'НАВИГАЦИЯ', name: '↩ назад', desc: 'вернуться к списку команд' },
      { group: 'MODEL', name: 'deepseek-v4-pro', desc: 'deepseek-official' },
    ]
    app.setMenuItems(commands)
    app.onMenuAccept(item => {
      if (item.name === '↩ назад') {
        // Returning one level up: the nested list closes and the command palette
        // comes back with an empty filter, which is what the row promises.
        app.closeMenu()
        app.setMenuItems(commands)
        app.setDraft('/')
        return
      }
      if (item.name === '/model') {
        app.setMenuItems(models)
        app.openMenu(models, 'модель', 1)
        return
      }
      // Picking a real model closes everything and leaves an empty composer.
      app.closeMenu()
      app.setDraft('')
    })
    app.start()
    app.setDraft('/')
    written.length = 0
    app.handleKey({ kind: 'enter' })
    expect(written.join('')).toContain('deepseek-v4-pro')
    // The way back leads the list: one step up, then Enter.
    app.handleKey({ kind: 'up' })
    app.handleKey({ kind: 'enter' })
    written.length = 0
    // Enter now acts on the command palette: its first entry opens the model list
    // again. Were the nested list still on screen — or left empty by a filter that
    // matched nothing — this key would do nothing at all.
    app.handleKey({ kind: 'enter' })
    expect(written.join('')).toContain('deepseek-v4-pro')
    // A real pick closes the list instead of leaving it half-open behind the pick.
    written.length = 0
    app.handleKey({ kind: 'enter' })
    expect(written.join('')).not.toContain('deepseek-v4-pro')
    app.stop()
  })

  it('hides a long tool output behind a row that unfolds it', () => {
    const { stream, written } = fakeStream(90, 24)
    const app = createApp({
      stdout: stream,
      stdin: stream as unknown as NodeJS.ReadStream,
      palette: plainPalette,
      version: 'v1.0.0',
      cwd: '/work',
      status: { model: 'm', mode: 'Agent', contextPercent: 0 },
      caps: { altScreen: true, mouse: true, trueColor: false, syncOutput: true, bracketedPaste: true, interactive: true },
    })
    const output = Array.from({ length: 40 }, (_, index) => `строка вывода ${String(index)}`).join('\n')
    const id = app.log.append({ kind: 'tool', text: 'big.md', name: 'read', status: 'ok', output, title: 'Читает big.md' })
    app.start()
    const condensed = renderEntries(app.log.entries, 90, {})
    // The row itself is the hotspot: it names what is behind it and carries the
    // entry identity a click resolves.
    const marker = condensed.find(line => line.collapsed === true)
    expect(marker).toBeDefined()
    expect(plainText(marker as never)).toContain('вывод')
    expect(marker?.entryId).toBe(id)
    expect(condensed.some(line => plainText(line).includes('строка вывода 39'))).toBe(false)
    written.length = 0
    app.log.patch(id, { expanded: true })
    app.render()
    const expanded = renderEntries(app.log.entries, 90, {})
    expect(expanded.some(line => plainText(line).includes('строка вывода 39'))).toBe(true)
    expect(expanded.some(line => line.collapsed === true)).toBe(false)
    app.stop()
  })

  it('writes no cells when the frame did not change', () => {
    const { stream, written } = fakeStream(80, 20)
    const app = createApp({
      stdout: stream,
      stdin: stream as unknown as NodeJS.ReadStream,
      palette: plainPalette,
      version: 'v1.0.0',
      cwd: '/work',
      status: { model: 'm', mode: 'Agent', contextPercent: 0 },
      caps: { altScreen: true, mouse: true, trueColor: false, syncOutput: true, bracketedPaste: true, interactive: true },
    })
    app.start()
    written.length = 0
    app.render()
    // Painting a frame moves the terminal's own caret, so an unchanged frame still
    // reposts the caret; it must not repaint a single cell.
    expect(written.join('')).toMatch(/^(?:\u001B\[\?25h|\u001B\[\d+;\d+H)*$/u)
    app.stop()
  })
})
