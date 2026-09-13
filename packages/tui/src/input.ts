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
  /**
   * Terminal sequences that were recognised as such and dropped.
   *
   * A terminal may send an escape sequence whose leading `ESC` was lost — a paste or
   * a burst of hardware key reports cut across two reads — and the rest of it would
   * otherwise be typed into the draft as text. Such fragments are recognised by their
   * shape, dropped, and reported here so the journal can say they happened.
   */
  readonly noise?: readonly string[]
}

/** The six fields of a win32-input-mode report whose leading escape byte was lost. */
const ORPHAN_WIN32 = /^\[\d*(?:;\d+){4,}_/

/** An SGR mouse report whose leading escape byte was lost. */
const ORPHAN_MOUSE = /^\[<\d+(?:;\d+)*[Mm]/

/** A terminal sequence tail recognised without its escape byte. */
interface OrphanTail {
  /** How many characters of the chunk the tail occupies. */
  readonly length: number
  /** Journal label naming the tail. */
  readonly noise: string
  /** A character recovered from the tail, when the tail repeats a paste. */
  readonly key?: KeyEvent
}

/**
 * Recognise a terminal report whose escape byte was lost.
 *
 * A Windows terminal in win32-input-mode reports one sequence per key, and a paste
 * delivers a burst of them; when the burst is cut across two reads the escape byte can
 * be consumed as a lone `Escape` while the rest of the report still arrives, which is
 * what typed `[13;28;13;1;0;1_` into the composer. Only shapes that decode to a key are
 * recognised, so pasted text such as `[0;30m` keeps reaching the draft unchanged.
 * @param rest - the chunk from the offending `[` onwards.
 * @returns the length, journal label, and any recovered character, or `undefined` when
 * the text is not a report tail.
 */
function orphanTail(rest: string): OrphanTail | undefined {
  const win32 = ORPHAN_WIN32.exec(rest)
  if (win32 !== null) {
    const body = win32[0]
    const decoded = decodeWin32(body.slice(1, -1).split(';').map(part => Number.parseInt(part, 10)))
    // Only a character is recovered: a paste arrives as one report per character, while
    // a report for a control key would act on a key the user may never have pressed.
    return {
      length: body.length,
      noise: `orphan-win32:${body}`,
      ...(decoded?.kind === 'char' ? { key: decoded } : {}),
    }
  }
  const mouse = ORPHAN_MOUSE.exec(rest)
  if (mouse !== null) return { length: mouse[0].length, noise: `orphan-mouse:${mouse[0]}` }
  let cursor = 1
  while (cursor < rest.length && (rest[cursor] ?? '').charCodeAt(0) < 0x40) cursor += 1
  if (cursor >= rest.length) return undefined
  const body = rest.slice(1, cursor + 1)
  if (body === '200~' || body === '201~') return { length: body.length + 1, noise: `orphan-paste:${body}` }
  const key = body === '13u'
    ? { kind: 'enter' } as const
    : body === '13;2u' ? { kind: 'newline' } as const : decodeCsi(body)
  if (key === undefined) return undefined
  return { length: body.length + 1, noise: `orphan-csi:${body}` }
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
 * Decode the content of a bracketed paste.
 *
 * A terminal in Win32-input-mode places its raw key reports inside the bracketed
 * paste instead of the decoded text, so the paste carries `ESC[Vk;…_` for every
 * character and line break. This walks those reports back into plain text; a paste
 * that already carries plain text (no escape bytes) is returned unchanged.
 * @param text - the paste content between the `ESC[200~` and `ESC[201~` markers.
 * @returns the plain text the paste represents.
 */
function decodePasteContent(text: string): string {
  if (!text.includes('\u001B')) return text
  const parsed = parseKeys(text)
  let out = ''
  for (const key of parsed.keys) {
    if (key.kind === 'char') out += key.text
    else if (key.kind === 'enter' || key.kind === 'newline') out += '\n'
    else if (key.kind === 'tab') out += '\t'
    else if (key.kind === 'backspace') out = out.slice(0, -1)
  }
  return out
}

/**
 * Decode one chunk of raw input.
 * @param chunk - bytes or text read from stdin.
 * @returns the decoded keys and any incomplete sequence tail.
 */
export function parseKeys(chunk: string): KeyParseResult {
  const keys: KeyEvent[] = []
  const noise: string[] = []
  let index = 0
  // A bracketed paste already carried the characters, so the key reports a Windows
  // terminal sends for the same characters in the same read would type them twice.
  let pasted = false
  /** Result for a chunk that ends inside a sequence, carrying the tail to the next read. */
  const incomplete = (pending: string): KeyParseResult =>
    ({ keys, pending, ...(noise.length === 0 ? {} : { noise }) })
  while (index < chunk.length) {
    const character = chunk[index]
    /* v8 ignore next -- the loop guard keeps the index inside the chunk */
    if (character === undefined) break

    if (character === ESC) {
      const rest = chunk.slice(index)
      const pasteStart = rest.indexOf(`${ESC}[200~`)
      if (pasteStart === 0) {
        const end = rest.indexOf(`${ESC}[201~`)
        if (end === -1) return incomplete(rest)
        keys.push({ kind: 'paste', text: decodePasteContent(rest.slice(6, end)) })
        pasted = true
        index += end + 6
        continue
      }
      if (rest.length === 1) return incomplete(rest)
      // SGR mouse reporting: ESC [ < button ; column ; row M|m. The report is
      // consumed here so a click never reaches the composer as text.
      if (rest.startsWith(`${ESC}[<`)) {
        let cursor = 3
        while (cursor < rest.length && rest[cursor] !== 'M' && rest[cursor] !== 'm') cursor += 1
        if (cursor >= rest.length) return incomplete(rest)
        const event = decodeSgrMouse(rest.slice(2, cursor + 1))
        if (event !== null) keys.push({ kind: 'mouse', event })
        index += cursor + 1
        continue
      }
      // Legacy X10 reporting: ESC [ M followed by three bytes, still the encoding
      // a classic conhost window sends.
      if (rest.startsWith(`${ESC}[M`)) {
        if (rest.length < 6) return incomplete(rest)
        const event = decodeX10Mouse(rest.slice(3, 6))
        if (event !== null) keys.push({ kind: 'mouse', event })
        index += 6
        continue
      }
      if (rest[1] === '[') {
        // CSI: find the final byte (0x40–0x7E) that terminates the sequence.
        let cursor = 2
        while (cursor < rest.length && (rest[cursor] ?? '').charCodeAt(0) < 0x40) cursor += 1
        if (cursor >= rest.length) return incomplete(rest)
        const body = rest.slice(2, cursor + 1)
        // Win32 input mode (`ESC[Vk;Sc;Uc;Kd;Cs;Rc_`) carries the virtual key,
        // the unicode code point, and the modifier bits, which is how a Windows
        // terminal reports a Shift+Enter that is otherwise indistinguishable
        // from a plain Enter.
        if (body.endsWith('_')) {
          const decoded = decodeWin32(body.split(';').map(part => Number.parseInt(part.replace('_', ''), 10)))
          // The characters of a paste were already delivered as text: the key report
          // for the same character is the terminal saying it twice.
          const duplicate = pasted && decoded?.kind === 'char'
          if (decoded !== undefined && !duplicate) keys.push(decoded)
          if (duplicate) noise.push(`paste-duplicate:${body}`)
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

    // A fragment of a terminal report whose escape byte was lost, which is what a
    // paste leaves behind when a Windows terminal cuts its burst of key reports across
    // two reads: typing it into the draft is what put `[13;28;13;1;0;1_` in the composer.
    if (character === '[') {
      const rest = chunk.slice(index)
      const orphan = orphanTail(rest)
      if (orphan !== undefined) {
        // A character repeats a paste that was already delivered as text, so it is
        // dropped with the rest of the tail; every tail is reported as noise.
        const duplicate = pasted && orphan.key !== undefined
        if (orphan.key !== undefined && !duplicate) keys.push(orphan.key)
        noise.push(duplicate ? `paste-duplicate:${orphan.noise}` : orphan.noise)
        index += orphan.length
        continue
      }
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
  return { keys, pending: '', ...(noise.length === 0 ? {} : { noise }) }
}

/**
 * Whether a key inserts a character or a newline into the draft.
 * @param key - the decoded key.
 * @returns true for `char` and `newline`.
 */
export function isInsertion(key: KeyEvent): key is { kind: 'char'; text: string } | { kind: 'newline' } {
  return key.kind === 'char' || key.kind === 'newline'
}
