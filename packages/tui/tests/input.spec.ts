import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  appendHistory,
  COMPOSER_RUNNING_HINT,
  cursorTo,
  cursorUp,
  displayWidth,
  historyPath,
  loadHistory,
  parseKeys,
  plainPalette,
  saveHistory,
  zoneHeight,
  zoneLines,
} from '../src/index.ts'

describe('parseKeys', () => {
  it('decodes printable text and control keys', () => {
    expect(parseKeys('ab').keys).toEqual([{ kind: 'char', text: 'a' }, { kind: 'char', text: 'b' }])
    expect(parseKeys('\r').keys).toEqual([{ kind: 'enter' }])
    expect(parseKeys('\n').keys).toEqual([{ kind: 'newline' }])
    expect(parseKeys('\u0003').keys).toEqual([{ kind: 'ctrl-c' }])
    expect(parseKeys('\u0004').keys).toEqual([{ kind: 'ctrl-d' }])
    expect(parseKeys('\u007F').keys).toEqual([{ kind: 'backspace' }])
    expect(parseKeys('\t').keys).toEqual([{ kind: 'tab' }])
    // Ctrl+X arrives either as the control byte or, in Windows input mode, as the
    // letter with the control modifier set.
    expect(parseKeys('\u0018').keys).toEqual([{ kind: 'ctrl-x' }])
  })

  it('decodes arrow, home, end and delete sequences', () => {
    expect(parseKeys('\u001B[A').keys).toEqual([{ kind: 'up' }])
    expect(parseKeys('\u001B[B').keys).toEqual([{ kind: 'down' }])
    expect(parseKeys('\u001B[C').keys).toEqual([{ kind: 'right' }])
    expect(parseKeys('\u001B[D').keys).toEqual([{ kind: 'left' }])
    expect(parseKeys('\u001B[H').keys).toEqual([{ kind: 'home' }])
    expect(parseKeys('\u001B[F').keys).toEqual([{ kind: 'end' }])
    expect(parseKeys('\u001B[3~').keys).toEqual([{ kind: 'delete' }])
    expect(parseKeys('\u001B[13;2u').keys).toEqual([{ kind: 'newline' }])
  })

  it('keeps an unterminated sequence as pending input', () => {
    const partial = parseKeys('\u001B[')
    expect(partial.keys).toEqual([])
    expect(partial.pending).toBe('\u001B[')
    const arrow = parseKeys(`${partial.pending}A`)
    expect(arrow.keys).toEqual([{ kind: 'up' }])
    expect(arrow.pending).toBe('')
  })

  it('decodes a bracketed paste as one event', () => {
    const pasted = parseKeys('\u001B[200~line one\nline two\u001B[201~')
    expect(pasted.keys).toEqual([{ kind: 'paste', text: 'line one\nline two' }])
    const unfinished = parseKeys('\u001B[200~partial')
    expect(unfinished.keys).toEqual([])
    expect(unfinished.pending).toContain('partial')
  })

  it('drops report tails whose escape byte was lost', () => {
    // A Windows terminal reports one sequence per key and a paste delivers a burst, so a
    // read boundary that swallows an escape byte leaves the rest of the report behind.
    // Typing it into the draft is what put `[13;28;13;1;0;1_` in the composer.
    const enter = parseKeys('[13;28;13;1;0;1_')
    expect(enter.keys).toEqual([])
    expect(enter.noise).toEqual(['orphan-win32:[13;28;13;1;0;1_'])
    // An escape byte reported as a key of its own arrives with an empty virtual key.
    expect(parseKeys('[;0;27;1;0;1_').noise).toEqual(['orphan-win32:[;0;27;1;0;1_'])
    expect(parseKeys('[A').noise).toEqual(['orphan-csi:A'])
    expect(parseKeys('[201~').noise).toEqual(['orphan-paste:201~'])
    expect(parseKeys('[<0;10;5M').noise).toEqual(['orphan-mouse:[<0;10;5M'])
  })

  it('recovers pasted characters from a tail and keeps real text', () => {
    // A character report repeats a paste the terminal already sent as key reports, so the
    // character is worth recovering; a report for a control key is not, because acting on
    // a key the user never pressed is worse than losing it.
    expect(parseKeys('[4;20;116;1;0;1_').keys).toEqual([{ kind: 'char', text: 't' }])
    const afterPaste = parseKeys('\u001B[200~test\u001B[201~[4;20;116;1;0;1_')
    expect(afterPaste.keys).toEqual([{ kind: 'paste', text: 'test' }])
    expect(afterPaste.noise).toEqual(['paste-duplicate:orphan-win32:[4;20;116;1;0;1_'])
    // Only a report is noise: text that merely starts with a bracket still reaches the draft.
    expect(parseKeys('[0;30m').keys).toEqual([
      { kind: 'char', text: '[' },
      { kind: 'char', text: '0' },
      { kind: 'char', text: ';' },
      { kind: 'char', text: '3' },
      { kind: 'char', text: '0' },
      { kind: 'char', text: 'm' },
    ])
    expect(parseKeys('[0;30m').noise).toBeUndefined()
  })
})

describe('history', () => {
  const created: string[] = []
  const makeHome = (): string => {
    const home = mkdtempSync(join(tmpdir(), 'kibborg-history-'))
    created.push(home)
    return home
  }
  afterEach(() => {
    for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  it('appends, skips repeats, and reloads within the limit', () => {
    const home = makeHome()
    const path = historyPath(home)
    expect(loadHistory(path)).toEqual([])
    expect(appendHistory(path, 'first task')).toBe(true)
    expect(appendHistory(path, 'first task')).toBe(false)
    expect(appendHistory(path, '   ')).toBe(false)
    expect(appendHistory(path, 'second\ntask')).toBe(true)
    expect(loadHistory(path)).toEqual(['first task', 'second task'])
    expect(loadHistory(path, 1)).toEqual(['second task'])
    expect(readFileSync(path, 'utf8')).toBe('first task\nsecond task\n')
  })

  it('trims stored history to the newest entries', () => {
    const home = makeHome()
    const path = historyPath(home)
    saveHistory(path, ['a', 'b', 'c'])
    expect(loadHistory(path)).toEqual(['a', 'b', 'c'])
    saveHistory(path, [])
    expect(loadHistory(path)).toEqual([])
  })
})

describe('zone', () => {
  it('renders overlay and composer rows within the width', () => {
    const lines = zoneLines({
      draft: '/mo',
      innerWidth: 80,
      showHint: false,
      status: { model: 'm', contextPercent: 12, mode: 'Agent' },
      cols: 84,
      overlay: ['  /model', '  /mcp'],
    }, plainPalette)
    // The composer is a box of three rows above a non-empty draft: two borders and
    // the draft row. The session facts sit inside the bottom border.
    expect(lines).toHaveLength(2 + 3)
    expect(lines[0]).toBe('  /model')
    expect(lines[4]).toContain('m · Agent')
    for (const line of lines) expect(displayWidth(line)).toBeLessThanOrEqual(84)
    expect(zoneHeight(2)).toBe(6)
    expect(zoneHeight(2, 4)).toBe(6)
    expect(zoneHeight()).toBe(4)
  })

  it('reports the running turn and the key that stops it', () => {
    const lines = zoneLines({
      draft: '',
      innerWidth: 80,
      showHint: true,
      status: { model: 'm', contextPercent: 12, mode: 'Agent', running: true, turnSeconds: 4 },
      cols: 84,
    }, plainPalette)
    const text = lines.join('\n')
    // The zone has no header, so the border is the only place that can say a turn
    // is running and which key cancels it.
    expect(text).toContain('Работает 4.0s · Agent')
    expect(text).toContain(COMPOSER_RUNNING_HINT)
    expect(text).not.toContain('model ·')
  })

  it('emits cursor helpers only when they move something', () => {
    expect(cursorUp(0)).toBe('')
    expect(cursorUp(3)).toBe('\u001B[3A')
    expect(cursorTo(4, 9)).toBe('\u001B[5;10H')
  })
})
