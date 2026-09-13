/**
 * Tool rows in the transcript.
 *
 * A tool's title is an argument the agent was given, and a path or a command can be far
 * longer than the terminal is wide. The row must stay inside the columns it has, keep the
 * facts that make it useful (how long it took, how much it changed), and cut the title
 * where a reader still recognises it: a path keeps its file name at the end, a command
 * keeps its start.
 */
import { describe, expect, it } from 'vitest'
import { createLog, plainText, renderEntries } from '../src/log.ts'
import { displayWidth } from '../src/width.ts'

const PATH = `C:/Users/lex66/AppData/Roaming/tabby/plugins/node_modules/${'tabby-ai-agent/'.repeat(8)}dist/index.js`

describe('tool rows', () => {
  it('keeps a long title inside the columns and ends it with the file name', () => {
    const log = createLog()
    log.append({
      kind: 'tool',
      text: 'read',
      name: 'read',
      status: 'done',
      title: `Читает ${PATH}`,
      durationMs: 1240,
    })
    for (const width of [114, 80, 60]) {
      const line = renderEntries(log.entries, width).map(plainText)[0] ?? ''
      expect(displayWidth(line)).toBeLessThanOrEqual(width)
      expect(line).toContain('…')
      expect(line).toContain('index.js')
      expect(line).toContain('1.2s')
      // The beginning still names what the tool did, so the row reads as one sentence.
      expect(line).toContain('▣  Читает C:/Users/')
    }
  })

  it('shows the whole title when the terminal is wide enough for it', () => {
    const log = createLog()
    log.append({ kind: 'tool', text: 'read', name: 'read', status: 'done', title: 'Читает engine-go/guard.go' })
    const line = renderEntries(log.entries, 114).map(plainText)[0] ?? ''
    expect(line.trimStart()).toBe('▣  Читает engine-go/guard.go')
  })

  it('keeps the change counters beside a title it had to cut', () => {
    const log = createLog()
    log.append({
      kind: 'tool',
      text: 'edit',
      name: 'edit',
      status: 'done',
      title: `Правит ${PATH}`,
      added: 12,
      removed: 3,
    })
    const line = renderEntries(log.entries, 70).map(plainText)[0] ?? ''
    expect(displayWidth(line)).toBeLessThanOrEqual(70)
    // The counters are the reason the row is worth reading, so cutting the title must
    // never cost them.
    expect(line).toContain('+12')
    expect(line).toContain('−3')
    expect(line).toContain('index.js')
  })
})
