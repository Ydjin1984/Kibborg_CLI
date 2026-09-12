/**
 * Terminal mouse decoding for the interactive surface.
 *
 * A raw-mode stdin delivers bytes, not events. {@link decodeSgrMouse} and
 * {@link decodeX10Mouse} turn the two reporting encodings into structured
 * events whose coordinates are zero-based, matching the frame buffer.
 * @module @kibborg/tui/mouse
 */

/** A decoded pointer action. */
export type MouseAction = 'wheel-up' | 'wheel-down' | 'press-left' | 'press-middle' | 'press-right' | 'move' | 'release'

/** One decoded pointer event. */
export interface MouseEvent {
  /** What the pointer did. */
  readonly action: MouseAction
  /** Zero-based column under the pointer. */
  readonly x: number
  /** Zero-based row under the pointer. */
  readonly y: number
  /** Whether Shift was held. */
  readonly shift: boolean
  /** Whether Alt was held. */
  readonly alt: boolean
  /** Whether Ctrl was held. */
  readonly ctrl: boolean
}

/** Modifier bits carried in the button field of both encodings. */
const MODIFIERS = 4 | 8 | 16

/** Wheel codes before modifiers are removed. */
const WHEEL_UP = 64
const WHEEL_DOWN = 65
const MOTION = 32

/** Decode the button field shared by both encodings. */
function buttonEvent(active: number, released: boolean): MouseAction | null {
  const modifiers = active & MODIFIERS
  const base = active - modifiers
  if (base === WHEEL_UP) return 'wheel-up'
  if (base === WHEEL_DOWN) return 'wheel-down'
  if (released) return 'release'
  if (base === 0) return 'press-left'
  if (base === 1) return 'press-middle'
  if (base === 2) return 'press-right'
  if (base === MOTION || base === 3 + MOTION) return 'move'
  return null
}

/** Split the modifier bits off a button field. */
function modifiersOf(active: number): { readonly shift: boolean; readonly alt: boolean; readonly ctrl: boolean } {
  return {
    shift: (active & 4) !== 0,
    alt: (active & 8) !== 0,
    ctrl: (active & 16) !== 0,
  }
}

/**
 * Decode an SGR mouse sequence body.
 * @param body - the body including its final byte, for example `<64;10;5M` or `<0;3;7m`.
 * @returns the event, or `null` when the body is not an SGR mouse report.
 */
export function decodeSgrMouse(body: string): MouseEvent | null {
  if (body.length < 4 || !body.startsWith('<')) return null
  const final = body.slice(-1)
  if (final !== 'M' && final !== 'm') return null
  const parts = body.slice(1, -1).split(';')
  if (parts.length !== 3) return null
  const [button, column, row] = parts.map(part => Number.parseInt(part, 10))
  if (button === undefined || column === undefined || row === undefined) return null
  if (Number.isNaN(button) || Number.isNaN(column) || Number.isNaN(row)) return null
  const action = buttonEvent(button, final === 'm')
  if (action === null) return null
  return { action, x: column - 1, y: row - 1, ...modifiersOf(button) }
}

/**
 * Decode a legacy X10 mouse report.
 * @param bytes - the three bytes following `ESC [ M`.
 * @returns the event, or `null` when the bytes are too short.
 */
export function decodeX10Mouse(bytes: string): MouseEvent | null {
  if (bytes.length < 3) return null
  const active = bytes.charCodeAt(0) - 32
  const action = buttonEvent(active, (active & 0x03) === 3 && (active & MODIFIERS) === active)
  if (action === null) return null
  return {
    action,
    x: bytes.charCodeAt(1) - 33,
    y: bytes.charCodeAt(2) - 33,
    ...modifiersOf(active),
  }
}

/**
 * Lines to scroll for a wheel event.
 * @param event - the pointer event.
 * @param lines - how many lines one notch covers.
 * @returns the signed line delta: negative scrolls towards older content.
 */
export function wheelDelta(event: MouseEvent, lines: number): number {
  if (event.action === 'wheel-up') return -lines
  if (event.action === 'wheel-down') return lines
  return 0
}
