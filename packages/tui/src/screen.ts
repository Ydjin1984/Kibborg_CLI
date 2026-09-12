/**
 * Terminal screen ownership for the fullscreen surface.
 *
 * The screen owns the alternate buffer, the cursor, mouse reporting, and the
 * previous frame, so a caller only composes a {@link CellBuffer} and hands it to
 * {@link Screen.present}. Leaving the screen always restores the terminal, which
 * is what makes an interrupted turn survivable.
 * @module @kibborg/tui/screen
 */

import type { CellBuffer } from './framebuffer.ts'
import { copyBuffer, diffBuffers } from './framebuffer.ts'

/** Terminal capabilities the surface adapts to. */
export interface TerminalCaps {
  /** Whether the surface may take over the alternate screen. */
  readonly altScreen: boolean
  /** Whether mouse reporting may be enabled for wheel and click input. */
  readonly mouse: boolean
  /** Whether 24-bit color is safe to emit. */
  readonly trueColor: boolean
  /** Whether frames may be wrapped in the synchronized-output guard. */
  readonly syncOutput: boolean
  /** Whether pasted text arrives delimited from a bracketed-paste terminal. */
  readonly bracketedPaste: boolean
  /** Whether the surface owns the screen at all; false falls back to line output. */
  readonly interactive: boolean
  /**
   * Whether the terminal can report Win32 key events.
   *
   * Windows Terminal and conhost with `ESC[?9001h` send the virtual key, the
   * code point, and the modifier state, which is the only way to tell Shift+Enter
   * from Enter on Windows. Optional so a test can state its own capability set.
   */
  readonly win32Input?: boolean
}

/** How the screen learns about the terminal it runs in. */
export interface ScreenOptions {
  /** The stream carrying frames; also the source of terminal size. */
  readonly stdout: NodeJS.WriteStream
  /** The stream carrying input. */
  readonly stdin: NodeJS.ReadStream
  /** Capabilities to force instead of detecting them. */
  readonly caps?: TerminalCaps
}

/** The surface's owned terminal. */
export interface Screen {
  /** Current terminal width in columns. */
  readonly cols: number
  /** Current terminal height in rows. */
  readonly rows: number
  /** Capabilities this screen was built with. */
  readonly caps: TerminalCaps
  /** Whether the screen has taken over the terminal. */
  readonly active: boolean
  /** Take over the screen: alternate buffer, hidden cursor, mouse reporting. */
  enter(): void
  /** Restore the terminal; idempotent and safe after a fatal error. */
  leave(): void
  /**
   * Display a composed frame, writing only the rows that changed.
   * @param buffer - the frame to display; it is copied, so the caller may reuse it.
   */
  present(buffer: CellBuffer): void
  /**
   * Place the terminal cursor, one-based as the terminal addresses it.
   * @param row - one-based row.
   * @param col - one-based column.
   */
  setCursor(row: number, col: number): void
  /** Hide the terminal cursor. */
  hideCursor(): void
  /** Show the terminal cursor. */
  showCursor(): void
  /** Discard the previous frame so the next {@link Screen.present} repaints everything. */
  invalidate(): void
  /**
   * Observe terminal resizes.
   * @param handler - called with the new width and height.
   * @returns a disposer removing the handler.
   */
  onResize(handler: (cols: number, rows: number) => void): () => void
  /**
   * Observe input chunks as UTF-8 text.
   * @param handler - called with each chunk.
   * @returns a disposer removing the handler.
   */
  onInput(handler: (chunk: string) => void): () => void
}

/**
 * Decide what the terminal in `out` supports.
 *
 * Non-interactive output, `TERM=dumb`, and a refused color environment fall back
 * to plain line output: the alternate screen is never entered for a redirect.
 * @param out - the output stream, inspected only for `isTTY`.
 * @param env - the environment naming the terminal.
 * @returns the capabilities of this terminal.
 */
export function detectCaps(out: { readonly isTTY?: boolean }, env: NodeJS.ProcessEnv): TerminalCaps {
  // `CI=false` and an empty `CI=` both mean "not CI": only a non-empty value is
  // the switch, which is the reading the rest of the harness uses for its
  // environment gates.
  const ci = env['CI'] ?? ''
  const interactive = out.isTTY === true && env['TERM'] !== 'dumb' && ci === ''
  const colorRefused = (env['NO_COLOR'] ?? '') !== ''
  const trueColor = interactive
    && !colorRefused
    && (
      env['COLORTERM'] === 'truecolor'
      || env['COLORTERM'] === '24bit'
      || env['TERM_PROGRAM'] === 'vscode'
      || env['TERM_PROGRAM'] === 'iTerm.app'
      || env['TERM_PROGRAM'] === 'WezTerm'
      || env['WT_SESSION'] !== undefined
      || (env['TERM'] ?? '').includes('direct')
    )
  return {
    altScreen: interactive,
    // Only a non-empty value disables the mouse: an exported-but-empty variable
    // means "unset" here, the same way the colour and CI gates read the
    // environment.
    mouse: interactive && (env['KIBBORG_NO_MOUSE'] ?? '') === '',
    trueColor,
    syncOutput: interactive,
    bracketedPaste: interactive,
    interactive,
    win32Input: interactive && (env['OS'] ?? '') === 'Windows_NT' && (env['KIBBORG_NO_WIN32_INPUT'] ?? '') === '',
  }
}

/**
 * Build the screen surface.
 * @param options - output and input streams, palette, and optional forced capabilities.
 * @returns the screen; nothing is written until {@link Screen.enter}.
 */
export function createScreen(options: ScreenOptions): Screen {
  const { stdout, stdin } = options
  const caps = options.caps ?? detectCaps(stdout, process.env)

  let cols = stdout.columns ?? 80
  let rows = stdout.rows ?? 24
  let entered = false
  let previous: CellBuffer | null = null

  const resizeHandlers = new Set<(cols: number, rows: number) => void>()
  const inputHandlers = new Set<(chunk: string) => void>()

  const onResizeEvent = (): void => {
    cols = stdout.columns ?? cols
    rows = stdout.rows ?? rows
    previous = null
    for (const handler of resizeHandlers) handler(cols, rows)
  }
  const onInputEvent = (chunk: Buffer | string): void => {
    const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8')
    for (const handler of inputHandlers) handler(text)
  }
  stdout.on('resize', onResizeEvent)
  stdin.on('data', onInputEvent)

  return {
    get cols() {
      return cols
    },
    get rows() {
      return rows
    },
    caps,
    get active() {
      return entered
    },
    enter() {
      if (entered) return
      entered = true
      let sequence = '\u001B[?25l'
      if (caps.bracketedPaste) sequence += '\u001B[?2004h'
      // Two protocols make a modified Enter visible: the Win32 input mode reports
      // the virtual key and the modifier state, and the kitty keyboard protocol
      // reports `13;2u` for Shift+Enter. A terminal that supports neither reports
      // a plain Enter, which is why Ctrl+J stays the portable line break.
      if (caps.win32Input === true) sequence += '\u001B[>1u\u001B[?9001h'
      if (caps.mouse) sequence += '\u001B[?1000h\u001B[?1002h\u001B[?1006h'
      if (caps.altScreen) sequence += '\u001B[?1049h'
      if (caps.altScreen) sequence += '\u001B[2J\u001B[H'
      stdout.write(sequence)
    },
    leave() {
      if (!entered) return
      entered = false
      stdout.removeListener('resize', onResizeEvent)
      stdin.removeListener('data', onInputEvent)
      let sequence = ''
      if (caps.mouse) sequence += '\u001B[?1000l\u001B[?1002l\u001B[?1006l'
      if (caps.bracketedPaste) sequence += '\u001B[?2004l'
      if (caps.win32Input === true) sequence += '\u001B[?9001l\u001B[<u'
      sequence += '\u001B[0m'
      if (caps.altScreen) sequence += '\u001B[?1049l'
      sequence += '\u001B[?25h'
      stdout.write(sequence)
      previous = null
    },
    present(buffer) {
      if (!entered) return
      const update = diffBuffers(previous, buffer)
      previous = copyBuffer(buffer)
      if (update === '') return
      const frame = caps.syncOutput ? `\u001B[?2026h${update}\u001B[?2026l` : update
      stdout.write(frame)
    },
    setCursor(row, col) {
      if (!entered) return
      stdout.write(`\u001B[${String(row)};${String(col)}H`)
    },
    hideCursor() {
      if (!entered) return
      stdout.write('\u001B[?25l')
    },
    showCursor() {
      if (!entered) return
      stdout.write('\u001B[?25h')
    },
    invalidate() {
      previous = null
    },
    onResize(handler) {
      resizeHandlers.add(handler)
      return () => {
        resizeHandlers.delete(handler)
      }
    },
    onInput(handler) {
      inputHandlers.add(handler)
      return () => {
        inputHandlers.delete(handler)
      }
    },
  }
}
