import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, createLogbook, logLevelOf, plainPalette, silentLogbook } from '../src/index.ts'

const created: string[] = []

/** A temporary directory for journal files. */
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'kibborg-logbook-'))
  created.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/**
 * A sink that keeps every record as its own line.
 *
 * The journal writes in batches, so one call to the sink may carry several records.
 */
function collect(): { readonly lines: string[]; readonly sink: (chunk: string) => void } {
  const lines: string[] = []
  return {
    lines,
    sink: chunk => {
      for (const line of chunk.split('\n')) if (line.trim() !== '') lines.push(line)
    },
  }
}

describe('logbook', () => {
  it('reads a level from the environment, defaulting to info', () => {
    expect(logLevelOf(undefined)).toBe('info')
    expect(logLevelOf('')).toBe('info')
    expect(logLevelOf('1')).toBe('info')
    expect(logLevelOf('trace')).toBe('trace')
    expect(logLevelOf('debug')).toBe('trace')
    expect(logLevelOf('error')).toBe('error')
    expect(logLevelOf('off')).toBe('off')
    expect(logLevelOf('0')).toBe('off')
  })

  it('filters by level and writes JSONL with time, scope, and action', () => {
    const collector = collect()
    const lines = collector.lines
    const book = createLogbook({ level: 'info', sink: collector.sink })
    book.write({ level: 'trace', scope: 'key', action: 'press' })
    book.write({ level: 'info', scope: 'command', action: 'submit' })
    book.flush()
    // A trace record is dropped at the info level, so only the action is recorded.
    expect(lines).toHaveLength(1)
    const record = JSON.parse(lines[0] ?? '{}') as { time: string; level: string; scope: string; action: string }
    expect(record.level).toBe('info')
    expect(record.scope).toBe('command')
    expect(record.action).toBe('submit')
    expect(Number.isNaN(Date.parse(record.time))).toBe(false)
  })

  it('records an action with its duration, outcome, and reason', () => {
    const collector = collect()
    const lines = collector.lines
    let clock = 1_000
    const book = createLogbook({ level: 'info', sink: collector.sink, now: () => (clock += 25) })
    const okValue = book.record('reader', 'toggle-entry', { entryId: 7 }, () => ({ ok: true, details: { expanded: true } }))
    const refused = book.record('reader', 'toggle-entry', { entryId: 8 }, () => ({ ok: false, reason: 'у записи нет скрытых строк' }))
    book.flush()
    expect(okValue).toBeUndefined()
    expect(refused).toBeUndefined()
    const records = lines.map(line => JSON.parse(line) as { action: string; ok: boolean; ms: number; reason?: string; details: Record<string, unknown> })
    expect(records[0]?.ok).toBe(true)
    expect(records[0]?.ms).toBe(25)
    expect(records[0]?.details).toMatchObject({ entryId: 7, expanded: true })
    expect(records[1]?.ok).toBe(false)
    expect(records[1]?.reason).toBe('у записи нет скрытых строк')
  })

  it('records a thrown action as a failure and rethrows it', () => {
    const collector = collect()
    const lines = collector.lines
    const book = createLogbook({ level: 'info', sink: collector.sink })
    expect(() => book.record('reader', 'copy-entry', {}, () => { throw new Error('буфер недоступен') })).toThrow('буфер недоступен')
    book.flush()
    const record = JSON.parse(lines[0] ?? '{}') as { ok: boolean; reason: string; details: Record<string, unknown> }
    expect(record.ok).toBe(false)
    expect(record.reason).toContain('буфер недоступен')
    expect(String(record.details['error'])).toContain('буфер недоступен')
  })

  it('writes records to a file and rotates it when it grows too large', () => {
    const dir = tempDir()
    const file = join(dir, 'nested', 'kibborg.jsonl')
    const book = createLogbook({ level: 'info', file, maxBytes: 200, keep: 2 })
    // Records reach the file in batches, so the loop flushes the way the timer does.
    for (let index = 0; index < 12; index += 1) {
      book.write({ level: 'info', scope: 'test', action: `event-${String(index)}`, details: { pad: 'x'.repeat(40) } })
      book.flush()
    }
    const first = readFileSync(file, 'utf8')
    expect(first).toContain('event-')
    // The journal rotated while growing, and it keeps a bounded number of copies.
    expect(readFileSync(`${file}.1`, 'utf8')).toContain('event-')
    expect(() => readFileSync(`${file}.3`, 'utf8')).toThrow()
  })

  it('rotates an oversized file before appending the next batch', () => {
    const dir = tempDir()
    const file = join(dir, 'kibborg.jsonl')
    writeFileSync(file, 'x'.repeat(500), 'utf8')
    const book = createLogbook({ level: 'info', file, maxBytes: 100, keep: 2 })
    book.write({ level: 'info', scope: 'test', action: 'after-rotate' })
    book.close()
    expect(readFileSync(`${file}.1`, 'utf8')).toContain('x'.repeat(10))
    expect(readFileSync(file, 'utf8')).toContain('after-rotate')
  })

  it('records nothing when the level is off', () => {
    const collector = collect()
    const lines = collector.lines
    const book = createLogbook({ level: 'off', sink: collector.sink })
    expect(book.enabled('error')).toBe(false)
    book.write({ level: 'error', scope: 'test', action: 'never' })
    book.record('test', 'never', {}, () => ({ ok: true }))
    book.flush()
    expect(lines).toEqual([])
    expect(silentLogbook.enabled('trace')).toBe(false)
  })
})

describe('surface journal', () => {
  /** A stream that swallows frames and records their size. */
  function fakeStream(cols: number, rows: number) {
    let written = ''
    const stream = {
      columns: cols,
      rows,
      isTTY: true,
      write: (chunk: string) => { written += chunk; return true },
      on: () => {},
      off: () => {},
      once: () => {},
      removeListener: () => {},
      removeAllListeners: () => {},
      setRawMode: () => {},
      resume: () => {},
      pause: () => {},
    }
    return { stream, written: () => written }
  }

  it('journals a key with the part of the surface that took it and a frame with its cost', () => {
    const collector = collect()
    const lines = collector.lines
    const book = createLogbook({ level: 'trace', sink: collector.sink })
    const { stream } = fakeStream(80, 20)
    const app = createApp({
      stdout: stream as unknown as NodeJS.WriteStream,
      stdin: stream as unknown as NodeJS.ReadStream,
      palette: plainPalette,
      version: 'v0.1.0',
      cwd: '/work',
      status: { model: 'm', mode: 'Agent', contextPercent: 0 },
      caps: { altScreen: true, mouse: false, trueColor: false, syncOutput: true, bracketedPaste: true, interactive: true },
      logbook: book,
    })
    app.start()
    lines.length = 0
    app.handleKey({ kind: 'page-down' })
    book.flush()
    const records = lines.map(line => JSON.parse(line) as { scope: string; action: string; ms?: number; ok?: boolean; details?: Record<string, unknown> })
    const key = records.find(record => record.scope === 'key')
    expect(key?.action).toBe('page-down')
    expect(typeof key?.ms).toBe('number')
    expect(key?.details).toMatchObject({ by: 'surface' })
    const frame = records.find(record => record.scope === 'render')
    expect(frame?.action).toBe('frame')
    expect(typeof frame?.details?.['bytes']).toBe('number')
    app.stop()
    book.close()
  })

  it('says why unfolding a short entry changed nothing', () => {
    const collector = collect()
    const lines = collector.lines
    const book = createLogbook({ level: 'info', sink: collector.sink })
    const { stream } = fakeStream(80, 20)
    const app = createApp({
      stdout: stream as unknown as NodeJS.WriteStream,
      stdin: stream as unknown as NodeJS.ReadStream,
      palette: plainPalette,
      version: 'v0.1.0',
      cwd: '/work',
      status: { model: 'm', mode: 'Agent', contextPercent: 0 },
      caps: { altScreen: true, mouse: false, trueColor: false, syncOutput: true, bracketedPaste: true, interactive: true },
      logbook: book,
    })
    // A one-line entry has nothing hidden behind a marker, so Enter cannot unfold it.
    app.log.append({ kind: 'assistant', text: 'готово' })
    app.start()
    app.handleKey({ kind: 'up' })
    lines.length = 0
    app.handleKey({ kind: 'enter' })
    book.flush()
    const record = lines.map(line => JSON.parse(line) as { scope: string; action: string; ok: boolean; reason?: string; details?: Record<string, unknown> })
      .find(entry => entry.action === 'toggle-entry')
    expect(record?.ok).toBe(false)
    expect(record?.reason).toBe('у записи нет скрытых строк: разворачивать нечего')
    expect(record?.details).toMatchObject({ kind: 'assistant' })
    app.stop()
    book.close()
  })

  it('says why the reader cannot move further up', () => {
    const collector = collect()
    const lines = collector.lines
    const book = createLogbook({ level: 'info', sink: collector.sink })
    const { stream } = fakeStream(80, 20)
    const app = createApp({
      stdout: stream as unknown as NodeJS.WriteStream,
      stdin: stream as unknown as NodeJS.ReadStream,
      palette: plainPalette,
      version: 'v0.1.0',
      cwd: '/work',
      status: { model: 'm', mode: 'Agent', contextPercent: 0 },
      caps: { altScreen: true, mouse: false, trueColor: false, syncOutput: true, bracketedPaste: true, interactive: true },
      logbook: book,
    })
    app.log.append({ kind: 'assistant', text: 'первый' })
    app.start()
    lines.length = 0
    app.handleKey({ kind: 'up' })
    app.handleKey({ kind: 'up' })
    book.flush()
    const records = lines.map(line => JSON.parse(line) as { scope: string; action: string; ok: boolean; reason?: string })
      .filter(record => record.scope === 'reader')
    expect(records[0]?.ok).toBe(true)
    expect(records[1]?.ok).toBe(false)
    expect(records[1]?.reason).toBe('выше записей больше нет')
    app.stop()
    book.close()
  })
})
