import { describe, it, expect } from 'vitest'
import { createBuffer } from '../src/framebuffer.ts'
import { createLog, clampScroll, renderEntries, visibleLines, scrollIndicator, wrapText, lineWidth, plainText, type AgentBadge } from '../src/log.ts'
import { drawLogView } from '../src/logview.ts'
import { parseKeys } from '../src/input.ts'
import { decodeSgrMouse, decodeX10Mouse, wheelDelta } from '../src/mouse.ts'
import { createApp } from '../src/app.ts'
import { plainPalette } from '../src/tokens.ts'
import { statusLine } from '../src/status.ts'
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
  })

  it('keeps the heading of a user entry for the sticky header', () => {
    const log = createLog()
    log.append({ kind: 'user', text: 'привет' })
    const lines = renderEntries(log.entries, 60)
    expect(lines[0]?.heading).toBe(true)
    expect(lines[0]?.anchor).toBe('You')
    expect(lines[1]?.anchor).toBe('You')
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
})

describe('fullscreen app', () => {
  it('paints the brand header, the composer, and the status line', () => {
    const { stream, written } = fakeStream(100, 30)
    const app = createApp({
      stdout: stream,
      stdin: stream as unknown as NodeJS.ReadStream,
      palette: plainPalette,
      version: 'v1.0.0',
      cwd: '/work',
      status: { model: 'DeepSeek V4 Flash', mode: 'Agent', contextPercent: 18 },
      caps: { altScreen: true, mouse: true, trueColor: false, syncOutput: true, bracketedPaste: true, interactive: true },
    })
    app.log.append({ kind: 'user', text: 'привет' })
    app.start()
    const output = written.join('')
    expect(output).toContain('KIBBORG')
    expect(output).toContain('\u001B[?1049h')
    expect(output).toContain('DeepSeek V4 Flash')
    app.stop()
    expect(written.join('')).toContain('\u001B[?1049l')
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

  it('names the model and the state in the header row', () => {
    const header = renderHeader({
      model: 'kibborg/Kibborg_Flash_v5.7',
      cwd: '/work',
      version: 'v0.1.0',
      mode: 'Agent',
      running: true,
      tick: 3,
      elapsedMs: 1200,
      density: 'full',
    }, 120).map(line => line.spans.map(span => span.text).join(''))
    // One row carries the brand, the context, and the model; the second is the rule.
    expect(header).toHaveLength(2)
    expect(header[0]).toContain('KIBBORG')
    expect(header[0]).toContain('/work')
    expect(header[0]).toContain('kibborg/Kibborg_Flash_v5.7')
    expect(header[1]).toContain('─')
  })

  it('hides a long tool output behind a row that expands it on a click', () => {
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

  it('writes nothing when the frame did not change', () => {
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
    expect(written.join('')).toBe('')
    app.stop()
  })
})
