/**
 * Key decoding for the surface.
 *
 * A raw terminal delivers bytes, not keys: `Enter` is `\r`, a CSI sequence can
 * be one of three encodings, and a Windows terminal reports a modified Enter
 * only through its own input mode. These tests pin the encodings the surface
 * promises to understand, including the Shift+Enter that starts a new line.
 */
import { describe, expect, it } from 'vitest'
import { parseKeys } from '../src/input.ts'
import { detectCaps } from '../src/screen.ts'

describe('parseKeys', () => {
  it('reads Shift+Enter from the kitty keyboard protocol', () => {
    expect(parseKeys('\u001B[13;2u').keys).toEqual([{ kind: 'newline' }])
    expect(parseKeys('\u001B[13u').keys).toEqual([{ kind: 'enter' }])
  })

  it('reads Shift+Enter from the Win32 input mode', () => {
    // [VK_RETURN, scanCode, '\r', keyDown, shift=16, repeat=1]
    expect(parseKeys('\u001B[13;28;13;1;16;1_').keys).toEqual([{ kind: 'newline' }])
    // The same report without Shift is a plain Enter.
    expect(parseKeys('\u001B[13;28;13;1;0;1_').keys).toEqual([{ kind: 'enter' }])
  })

  it('reads ordinary keys, arrows, and control keys from the Win32 reports', () => {
    expect(parseKeys('\u001B[65;30;97;1;0;1_').keys).toEqual([{ kind: 'char', text: 'a' }])
    expect(parseKeys('\u001B[38;72;0;1;0;1_').keys).toEqual([{ kind: 'up' }])
    expect(parseKeys('\u001B[40;80;0;1;0;1_').keys).toEqual([{ kind: 'down' }])
    expect(parseKeys('\u001B[9;15;9;1;16;1_').keys).toEqual([{ kind: 'shift-tab' }])
    expect(parseKeys('\u001B[67;46;99;1;8;1_').keys).toEqual([{ kind: 'ctrl-c' }])
  })

  it('drops the key release of a Win32 report instead of typing twice', () => {
    // keyDown = 0 marks the release half of the pair.
    expect(parseKeys('\u001B[65;30;97;0;0;1_').keys).toEqual([])
  })

  it('keeps decoding the plain encodings', () => {
    expect(parseKeys('\r').keys).toEqual([{ kind: 'enter' }])
    expect(parseKeys('\n').keys).toEqual([{ kind: 'newline' }])
    expect(parseKeys('\u001B[A').keys).toEqual([{ kind: 'up' }])
    expect(parseKeys('\u001B[5~').keys).toEqual([{ kind: 'page-up' }])
  })
})

describe('detectCaps', () => {
  it('asks for the Win32 input mode only on Windows terminals', () => {
    const base = { isTTY: true }
    expect(detectCaps(base, { TERM: 'xterm-256color', OS: 'Windows_NT' }).win32Input).toBe(true)
    expect(detectCaps(base, { TERM: 'xterm-256color', OS: 'Linux' }).win32Input).toBe(false)
    expect(detectCaps({ isTTY: false }, { TERM: 'xterm-256color', OS: 'Windows_NT' }).win32Input).toBe(false)
  })
})
