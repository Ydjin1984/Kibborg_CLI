/**
 * Terminal key parsing for the interactive input surface.
 *
 * A raw-mode stdin delivers bytes, not keys: the arrow keys arrive as CSI
 * sequences, a bracketed paste arrives as one delimited chunk, and control keys
 * arrive as single bytes. {@link parseKeys} turns one chunk into the key events
 * the composer understands; a chunk that ends mid-sequence returns a `pending`
 * marker so the caller can keep reading instead of guessing.
 * @module @kibborg/tui/input
 */

import { decodeSgrMouse, decodeX10Mouse, type MouseEvent } from './mouse.ts'

/** One decoded key. */
export type KeyEvent =
  | { readonly kind: 'char'; readonly text: string }
  | { readonly kind: 'enter' }
  | { readonly kind: 'newline' }
  | { readonly kind: 'backspace' }
  | { readonly kind: 'delete' }
  | { readonly kind: 'up' }
  | { readonly kind: 'down' }
  | { readonly kind: 'left' }
  | { readonly kind: 'right' }
  | { readonly kind: 'page-up' }
  | { readonly kind: 'page-down' }
  | { readonly kind: 'home' }
  | { readonly kind: 'end' }
  | { readonly kind: 'tab' }
  | { readonly kind: 'shift-tab' }
  | { readonly kind: 'escape' }
  | { readonly kind: 'ctrl-c' }
  | { readonly kind: 'ctrl-d' }
  | { readonly kind: 'ctrl-l' }
  | { readonly kind: 'ctrl-o' }
  | { readonly kind: 'ctrl-u' }
  /** The key list: what every binding of the surface does. */
  | { readonly kind: 'ctrl-x' }
  | { readonly kind: 'mouse'; readonly event: MouseEvent }
  | { readonly kind: 'paste'; readonly text: string }

/** Decoded keys plus the tail of an unfinished sequence. */
export interface KeyParseResult {
  /** Keys fully decoded from this chunk, in order. */
  readonly keys: readonly KeyEvent[]
  /** Bytes of a sequence that continues in the next chunk, or an empty string. */
  readonly pending: string
}

/** Escape byte beginning every control sequence. */
const ESC = '\u001B'

/** Map a CSI final byte to its key. */
function csiKey(final: string): KeyEvent | undefined {
  switch (final) {
    case 'A': return { kind: 'up' }
    case 'B': return { kind: 'down' }
    case 'C': return { kind: 'right' }
    case 'D': return { kind: 'left' }
    case 'H': return { kind: 'home' }
    case 'F': return { kind: 'end' }
    case 'Z': return { kind: 'shift-tab' }
    default: return undefined
  }
}

/** Decode one CSI sequence body (without the leading ESC) into a key. */
function decodeCsi(body: string): KeyEvent | undefined {
  if (body.endsWith('~')) {
    const code = Number.parseInt(body.slice(0, -1), 10)
    if (code === 3) return { kind: 'delete' }
    if (code === 1 || code === 7) return { kind: 'home' }
    if (code === 4 || code === 8) return { kind: 'end' }
    if (code === 5) return { kind: 'page-up' }
    if (code === 6) return { kind: 'page-down' }
    return undefined
  }
  return csiKey(body.slice(-1))
}

/**
 * Decode one win32-input-mode report into a key.
 *
 * The report carries `[virtualKey, scanCode, codePoint, keyDown, controlState,
 * repeatCount]`, where `controlState` uses the Shift=1, Alt=2, Ctrl=4 bits of
 * the Windows API in their console form (Shift=16, Alt=2/1, Ctrl=8). Only key
 * presses are reported as keys; a key release is dropped so a held key is not
 * typed twice.
 * @param fields - the six numeric fields of the report.
 * @returns the decoded key, or `undefined` when the report carries none.
 */
function decodeWin32(fields: readonly number[]): KeyEvent | undefined {
  const [virtualKey, , codePoint, keyDown, controlState] = fields
  if (keyDown !== 1) return undefined
  const shift = ((controlState ?? 0) & 16) !== 0
  const ctrl = ((controlState ?? 0) & 8) !== 0
  switch (virtualKey) {
    case 13:
      // Shift+Enter starts a new line; a plain Enter submits.
      return shift ? { kind: 'newline' } : { kind: 'enter' }
    case 9: return shift ? { kind: 'shift-tab' } : { kind: 'tab' }
    case 27: return { kind: 'escape' }
    case 8: return { kind: 'backspace' }
    case 46: return { kind: 'delete' }
    case 37: return { kind: 'left' }
    case 38: return { kind: 'up' }
    case 39: return { kind: 'right' }
    case 40: return { kind: 'down' }
    case 33: return { kind: 'page-up' }
    case 34: return { kind: 'page-down' }
    case 36: return { kind: 'home' }
    case 35: return { kind: 'end' }
    default: break
  }
  if (ctrl && codePoint !== undefined && codePoint > 0) {
    const letter = String.fromCharCode(codePoint).toLowerCase()
    if (letter === 'c') return { kind: 'ctrl-c' }
    if (letter === 'd') return { kind: 'ctrl-d' }
    if (letter === 'l') return { kind: 'ctrl-l' }
    if (letter === 'o') return { kind: 'ctrl-o' }
    if (letter === 'u') return { kind: 'ctrl-u' }
    if (letter === 'x') return { kind: 'ctrl-x' }
  }
  // Shift changes the character a key produces (`a` → `A`, `1` → `!`) and the
  // surface already receives the resulting code point, so a shifted letter must
  // still be typed: dropping it made capitals impossible in Windows Terminal.
  if (!ctrl && codePoint !== undefined && codePoint >= 32) {
    return { kind: 'char', text: String.fromCharCode(codePoint) }
  }
  return undefined
}

/**
 * Decode one chunk of raw input.
 * @param chunk - bytes or text read from stdin.
 * @returns the decoded keys and any incomplete sequence tail.
 */
export function parseKeys(chunk: string): KeyParseResult {
  const keys: KeyEvent[] = []
  let index = 0
  while (index < chunk.length) {
    const character = chunk[index]
    /* v8 ignore next -- the loop guard keeps the index inside the chunk */
    if (character === undefined) break

    if (character === ESC) {
      const rest = chunk.slice(index)
      const pasteStart = rest.indexOf(`${ESC}[200~`)
      if (pasteStart === 0) {
        const end = rest.indexOf(`${ESC}[201~`)
        if (end === -1) return { keys, pending: rest }
        keys.push({ kind: 'paste', text: rest.slice(6, end) })
        index += end + 6
        continue
      }
      if (rest.length === 1) return { keys, pending: rest }
      // SGR mouse reporting: ESC [ < button ; column ; row M|m. The report is
      // consumed here so a click never reaches the composer as text.
      if (rest.startsWith(`${ESC}[<`)) {
        let cursor = 3
        while (cursor < rest.length && rest[cursor] !== 'M' && rest[cursor] !== 'm') cursor += 1
        if (cursor >= rest.length) return { keys, pending: rest }
        const event = decodeSgrMouse(rest.slice(2, cursor + 1))
        if (event !== null) keys.push({ kind: 'mouse', event })
        index += cursor + 1
        continue
      }
      // Legacy X10 reporting: ESC [ M followed by three bytes, still the encoding
      // a classic conhost window sends.
      if (rest.startsWith(`${ESC}[M`)) {
        if (rest.length < 6) return { keys, pending: rest }
        const event = decodeX10Mouse(rest.slice(3, 6))
        if (event !== null) keys.push({ kind: 'mouse', event })
        index += 6
        continue
      }
      if (rest[1] === '[') {
        // CSI: find the final byte (0x40–0x7E) that terminates the sequence.
        let cursor = 2
        while (cursor < rest.length && (rest[cursor] ?? '').charCodeAt(0) < 0x40) cursor += 1
        if (cursor >= rest.length) return { keys, pending: rest }
        const body = rest.slice(2, cursor + 1)
        // Win32 input mode (`ESC[Vk;Sc;Uc;Kd;Cs;Rc_`) carries the virtual key,
        // the unicode code point, and the modifier bits, which is how a Windows
        // terminal reports a Shift+Enter that is otherwise indistinguishable
        // from a plain Enter.
        if (body.endsWith('_')) {
          const decoded = decodeWin32(body.split(';').map(part => Number.parseInt(part.replace('_', ''), 10)))
          if (decoded !== undefined) keys.push(decoded)
          index += cursor + 1
          continue
        }
        const modified = body.includes(';')
        const decoded = body.endsWith('u')
          // Kitty keyboard protocol: `13u` is Enter, `13;2u` is Shift+Enter,
          // and any other modified key has no plain equivalent here.
          ? (body === '13u' ? { kind: 'enter' } as const : body === '13;2u' ? { kind: 'newline' } as const : undefined)
          : modified ? undefined : decodeCsi(body)
        if (decoded !== undefined) keys.push(decoded)
        index += cursor + 1
        continue
      }
      keys.push({ kind: 'escape' })
      index += 1
      continue
    }

    const code = character.charCodeAt(0)
    switch (code) {
      case 13: keys.push({ kind: 'enter' }); break
      case 10: keys.push({ kind: 'newline' }); break
      case 9: keys.push({ kind: 'tab' }); break
      case 8:
      case 127: keys.push({ kind: 'backspace' }); break
      case 3: keys.push({ kind: 'ctrl-c' }); break
      case 4: keys.push({ kind: 'ctrl-d' }); break
      case 12: keys.push({ kind: 'ctrl-l' }); break
      case 15: keys.push({ kind: 'ctrl-o' }); break
      case 21: keys.push({ kind: 'ctrl-u' }); break
      case 24: keys.push({ kind: 'ctrl-x' }); break
      default:
        if (code >= 32) keys.push({ kind: 'char', text: character })
        break
    }
    index += 1
  }
  return { keys, pending: '' }
}

/**
 * Whether a key inserts a character or a newline into the draft.
 * @param key - the decoded key.
 * @returns true for `char` and `newline`.
 */
export function isInsertion(key: KeyEvent): key is { kind: 'char'; text: string } | { kind: 'newline' } {
  return key.kind === 'char' || key.kind === 'newline'
}
