import { describe, expect, it } from 'vitest'
import { displayWidth, plainPalette, relativeAge, sessionTable } from '../src/index.ts'

const NOW = 1_700_000_000_000

describe('relativeAge', () => {
  it('collapses the age into a compact form', () => {
    expect(relativeAge(NOW, NOW)).toBe('now')
    expect(relativeAge(NOW - 59_000, NOW)).toBe('now')
    expect(relativeAge(NOW - 14 * 60_000, NOW)).toBe('14m')
    expect(relativeAge(NOW - 3 * 3_600_000, NOW)).toBe('3h')
    expect(relativeAge(NOW - 3 * 86_400_000, NOW)).toBe('3d')
    expect(relativeAge(NOW - 30 * 86_400_000, NOW)).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('sessionTable', () => {
  it('reports an empty registry with one line', () => {
    const lines = sessionTable([], { palette: plainPalette, cols: 80, now: NOW })
    expect(lines).toEqual(['  no sessions'])
  })

  it('strips the session- prefix from the short id and marks the current directory', () => {
    const lines = sessionTable([
      { sessionId: 'session-42b4afcf-3c07-40e6-80e2-5c69c56901cd', updatedAt: NOW - 60_000, title: 'auth review', cwd: 'D:/repo' },
      { sessionId: 'f0fc4bc3-2112-413d-a73a-7e3796503de6', updatedAt: NOW - 3_600_000, title: 'other', cwd: 'D:/elsewhere' },
    ], { palette: plainPalette, cols: 100, now: NOW, cwd: 'D:/repo' })
    expect(lines[0]).toContain('42b4afcf')
    expect(lines[0]).toContain('▸ auth review')
    expect(lines[1]).toContain('f0fc4bc3')
    expect(lines[1]?.startsWith('  f0fc4bc3')).toBe(true)
    expect(lines[1]).not.toContain('▸')
  })

  it('never exceeds the terminal width and marks a missing title', () => {
    const rows = [
      { sessionId: 'f0fc4bc3-2112-413d-a73a-7e3796503de6', updatedAt: NOW, title: 'x'.repeat(120) },
      { sessionId: 'bb1f0619-191e-4612-b4ed-3844b49f1770', updatedAt: NOW },
    ]
    for (const cols of [40, 88, 140]) {
      const lines = sessionTable(rows, { palette: plainPalette, cols, now: NOW })
      for (const line of lines) expect(displayWidth(line)).toBeLessThanOrEqual(cols)
      expect(lines[0]?.endsWith('…')).toBe(true)
      expect(lines[1]).toContain('(no title)')
    }
  })
})
