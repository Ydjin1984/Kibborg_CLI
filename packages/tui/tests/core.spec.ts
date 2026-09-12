import { describe, it, expect } from 'vitest'
import { createBuffer, copyBuffer, diffBuffers } from '../src/framebuffer.ts'
import { detectCaps } from '../src/screen.ts'
import { drawBox, dashedLine, boxWidths } from '../src/box.ts'
import { densityFor, computeLayout } from '../src/layout.ts'
import { spinnerFrame, bandWave, progressBar, elapsedLabel, createTicker } from '../src/anim.ts'
import { plainPalette, trueColorPalette } from '../src/tokens.ts'
import { displayWidth } from '../src/width.ts'

describe('framebuffer', () => {
  it('creates a buffer with the requested dimensions', () => {
    const buffer = createBuffer(10, 5)
    expect(buffer.cols).toBe(10)
    expect(buffer.rows).toBe(5)
  })

  it('rejects degenerate dimensions', () => {
    expect(() => createBuffer(0, 5)).toThrow()
    expect(() => createBuffer(10, 0)).toThrow()
  })

  it('ignores writes outside the grid', () => {
    const buffer = createBuffer(10, 5)
    expect(() => {
      buffer.put(-1, 0, 'a')
      buffer.put(10, 0, 'b')
      buffer.put(0, 5, 'c')
      buffer.put(0, -1, 'd')
      buffer.fillRect(-5, -5, 100, 100, 'x')
    }).not.toThrow()
    expect(buffer.snapshot()[0]).toBe('xxxxxxxxxx')
  })

  it('keeps a wide glyph on two columns', () => {
    const buffer = createBuffer(10, 5)
    buffer.put(0, 0, '漢')
    expect(buffer.get(0, 0).ch).toBe('漢')
    expect(buffer.get(0, 0).wide).toBe(true)
    expect(buffer.get(1, 0).continuation).toBe(true)
    expect(displayWidth(buffer.snapshot()[0] as string)).toBe(10)
  })

  it('does not split a wide glyph at the right edge', () => {
    const buffer = createBuffer(3, 1)
    buffer.put(2, 0, '漢')
    expect(buffer.get(2, 0).ch).toBe(' ')
    expect(displayWidth(buffer.snapshot()[0] as string)).toBe(3)
  })

  it('advances by display width when writing text', () => {
    const buffer = createBuffer(8, 1)
    buffer.write(0, 0, 'ab漢', 'Text')
    expect(buffer.get(0, 0).ch).toBe('a')
    expect(buffer.get(2, 0).ch).toBe('漢')
    expect(buffer.get(3, 0).continuation).toBe(true)
  })

  it('clears every cell', () => {
    const buffer = createBuffer(5, 5)
    buffer.put(0, 0, 'a')
    buffer.clear()
    expect(buffer.get(0, 0).ch).toBe(' ')
  })

  it('resolves a token into the SGR prefix stored in the cell', () => {
    const buffer = createBuffer(4, 1, trueColorPalette())
    buffer.put(0, 0, 'A', 'Accent')
    expect(buffer.get(0, 0).sgr).toBe('\u001B[38;2;92;225;230m')
    buffer.put(1, 0, 'B', 'Error', { bold: true })
    expect(buffer.get(1, 0).sgr).toBe('\u001B[38;2;255;92;122;1m')
  })

  it('stores no color in a plain buffer', () => {
    const buffer = createBuffer(4, 1, plainPalette)
    buffer.put(0, 0, 'A', 'Accent')
    expect(buffer.get(0, 0).sgr).toBe('')
  })
})

describe('framebuffer diff', () => {
  it('paints every row of the first frame', () => {
    const buffer = createBuffer(4, 2)
    buffer.write(0, 0, 'ab')
    const update = diffBuffers(null, buffer)
    expect(update).toContain('\u001B[1;1H')
    expect(update).toContain('\u001B[2;1H')
  })

  it('never emits a line feed', () => {
    const buffer = createBuffer(6, 3)
    buffer.write(0, 1, 'hello')
    expect(diffBuffers(null, buffer)).not.toContain('\n')
    const other = createBuffer(6, 3)
    other.write(0, 2, 'x')
    expect(diffBuffers(buffer, other)).not.toContain('\n')
  })

  it('writes nothing when the frame is unchanged', () => {
    const buffer = createBuffer(6, 3, trueColorPalette())
    buffer.write(0, 0, 'hello', 'Accent')
    expect(diffBuffers(buffer, copyBuffer(buffer))).toBe('')
  })

  it('repaints exactly the changed row', () => {
    const before = createBuffer(6, 3)
    before.write(0, 0, 'aaaaa')
    const after = copyBuffer(before)
    after.write(0, 1, 'b')
    const update = diffBuffers(before, after)
    expect(update.match(/\u001B\[\d+;1H/g)).toHaveLength(1)
    expect(update).toContain('\u001B[2;1H')
    expect(update).toContain('\u001B[2K')
  })

  it('repaints everything after a resize', () => {
    const before = createBuffer(6, 3)
    const after = createBuffer(8, 4)
    const update = diffBuffers(before, after)
    expect(update.match(/\u001B\[\d+;1H/g)).toHaveLength(4)
  })

  it('carries color into the update', () => {
    const before = createBuffer(4, 1, trueColorPalette())
    const after = copyBuffer(before)
    after.put(0, 0, 'A', 'Success')
    expect(diffBuffers(before, after)).toContain('\u001B[38;2;61;220;151m')
  })
})

describe('copyBuffer', () => {
  it('copies cells, colors, and palette independently', () => {
    const source = createBuffer(4, 1, trueColorPalette())
    source.put(0, 0, 'A', 'Accent')
    const copy = copyBuffer(source)
    expect(copy.get(0, 0).ch).toBe('A')
    expect(copy.get(0, 0).sgr).toBe(source.get(0, 0).sgr)
    expect(copy.palette).toBe(source.palette)
    source.put(0, 0, 'Z', 'Error')
    expect(copy.get(0, 0).ch).toBe('A')
  })
})

describe('screen capabilities', () => {
  it('refuses the alternate screen when output is not a terminal', () => {
    const caps = detectCaps({ isTTY: false }, {})
    expect(caps.interactive).toBe(false)
    expect(caps.altScreen).toBe(false)
    expect(caps.mouse).toBe(false)
  })

  it('treats TERM=dumb as non-interactive', () => {
    expect(detectCaps({ isTTY: true }, { TERM: 'dumb' }).interactive).toBe(false)
  })

  it('refuses color under NO_COLOR', () => {
    expect(detectCaps({ isTTY: true }, { NO_COLOR: '1' }).trueColor).toBe(false)
  })

  it('recognizes a true-color terminal', () => {
    expect(detectCaps({ isTTY: true }, { WT_SESSION: 'x' }).trueColor).toBe(true)
    expect(detectCaps({ isTTY: true }, { COLORTERM: 'truecolor' }).trueColor).toBe(true)
  })

  it('honours KIBBORG_NO_MOUSE', () => {
    expect(detectCaps({ isTTY: true }, { KIBBORG_NO_MOUSE: '1' }).mouse).toBe(false)
    expect(detectCaps({ isTTY: true }, {}).mouse).toBe(true)
  })
})

describe('box', () => {
  it('builds a dashed rule of exactly the requested width', () => {
    for (let width = 0; width <= 80; width++) {
      expect(displayWidth(dashedLine(width))).toBe(width)
      expect(displayWidth(dashedLine(width, true))).toBe(width)
    }
  })

  it('derives the inner width from the terminal width', () => {
    expect(boxWidths(80)).toEqual({ inner: 76, box: 80 })
    expect(boxWidths(4).inner).toBe(1)
    expect(boxWidths(1).inner).toBe(1)
  })

  it('survives degenerate rectangles', () => {
    const buffer = createBuffer(10, 5)
    expect(() => {
      drawBox(buffer, { x: 0, y: 0, w: 0, h: 0 }, {})
      drawBox(buffer, { x: 0, y: 0, w: 1, h: 1 }, {})
      drawBox(buffer, { x: 2, y: 1, w: 1, h: 4 }, {})
    }).not.toThrow()
  })

  it('never paints outside the rectangle', () => {
    const rect = { x: 3, y: 1, w: 20, h: 5 }
    const buffer = createBuffer(40, 10)
    drawBox(buffer, rect, { title: 'Киборг', token: 'Accent' })
    for (let y = 0; y < 10; y++) {
      for (let x = 0; x < 40; x++) {
        const inside = x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h
        if (!inside) expect(buffer.get(x, y).ch).toBe(' ')
      }
    }
  })

  it('keeps the frame width stable for every width', () => {
    for (let width = 4; width <= 60; width++) {
      const buffer = createBuffer(width, 4)
      drawBox(buffer, { x: 0, y: 0, w: width, h: 4 }, { title: 'Киборг v1.0.0' })
      for (const line of buffer.snapshot()) expect(displayWidth(line)).toBe(width)
    }
  })
})

describe('layout', () => {
  it('classifies terminal widths into densities', () => {
    expect(densityFor(140)).toBe('rich')
    expect(densityFor(110)).toBe('rich')
    expect(densityFor(109)).toBe('balanced')
    expect(densityFor(80)).toBe('balanced')
    expect(densityFor(79)).toBe('compact')
  })

  it('stacks header, log, composer, and status over the full height', () => {
    const layout = computeLayout(80, 24, { density: 'balanced', composerHeight: 3 })
    expect(layout.header.h).toBe(2)
    expect(layout.composer.h).toBe(3)
    expect(layout.status?.h).toBe(1)
    expect(layout.log.h).toBe(18)
    expect(layout.inner).toBe(76)
  })

  it('keeps the height invariant for every terminal size', () => {
    for (let rows = 1; rows <= 60; rows++) {
      for (const cols of [40, 79, 80, 110, 200]) {
        const layout = computeLayout(cols, rows, { density: densityFor(cols), composerHeight: 3 })
        const total = layout.header.h + layout.log.h + (layout.overlay?.h ?? 0) + layout.composer.h + (layout.status?.h ?? 0)
        expect(total).toBe(rows)
        for (const rect of [layout.header, layout.log, layout.overlay, layout.composer, layout.status]) {
          if (rect === null) continue
          expect(rect.w).toBeGreaterThanOrEqual(0)
          expect(rect.h).toBeGreaterThanOrEqual(0)
        }
      }
    }
  })

  it('never overlaps two regions', () => {
    const layout = computeLayout(100, 30, { density: 'balanced', composerHeight: 3, overlayHeight: 6 })
    const regions = [layout.header, layout.log, layout.overlay, layout.composer, layout.status].filter(
      (rect): rect is NonNullable<typeof rect> => rect !== null,
    )
    for (let i = 0; i < regions.length; i++) {
      for (let j = i + 1; j < regions.length; j++) {
        const a = regions[i] as { readonly y: number; readonly h: number }
        const b = regions[j] as { readonly y: number; readonly h: number }
        const overlaps = a.y < b.y + b.h && b.y < a.y + a.h
        expect(overlaps).toBe(false)
      }
    }
  })

  it('drops the log first and the status below six rows', () => {
    const small = computeLayout(10, 5, { density: 'compact', composerHeight: 3, headerHeight: 2 })
    expect(small.log.h).toBe(0)
    expect(small.composer.h).toBe(3)
    expect(small.status).toBeNull()
  })

  it('keeps the composer intact when the terminal is one row', () => {
    const tiny = computeLayout(20, 1, { density: 'compact', composerHeight: 3 })
    expect(tiny.composer.h).toBe(1)
    expect(tiny.log.h).toBe(0)
  })
})

describe('anim', () => {
  it('cycles the spinner deterministically', () => {
    expect(spinnerFrame(0)).toBe(spinnerFrame(10))
    expect(displayWidth(spinnerFrame(3))).toBeGreaterThan(0)
  })

  it('builds a band of exactly the requested width', () => {
    for (let cells = 0; cells <= 100; cells++) expect(displayWidth(bandWave(7, cells))).toBe(cells)
  })

  it('builds a progress bar of exactly the requested width', () => {
    for (let cells = 0; cells <= 100; cells++) expect(progressBar(50, cells)).toBe('▓'.repeat(Math.round(cells / 2)) + '░'.repeat(cells - Math.round(cells / 2)))
  })

  it('clamps the progress percentage', () => {
    expect(progressBar(-10, 10)).toBe('░░░░░░░░░░')
    expect(progressBar(110, 10)).toBe('▓▓▓▓▓▓▓▓▓▓')
    expect(progressBar(50, 0)).toBe('')
  })

  it('formats elapsed time', () => {
    expect(elapsedLabel(500)).toBe('0.5s')
    expect(elapsedLabel(1500)).toBe('1.5s')
    expect(elapsedLabel(4200)).toBe('4.2s')
    expect(elapsedLabel(65000)).toBe('1m 05s')
  })

  it('starts and stops the ticker idempotently', () => {
    let ticks = 0
    const ticker = createTicker(1000, () => {
      ticks += 1
    })
    expect(ticker.running).toBe(false)
    ticker.start()
    ticker.start()
    expect(ticker.running).toBe(true)
    ticker.stop()
    ticker.stop()
    expect(ticker.running).toBe(false)
    expect(ticks).toBe(0)
  })
})
