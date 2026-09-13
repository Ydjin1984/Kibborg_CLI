/**
 * Escape-key timing for the interactive loops.
 *
 * A lone `Escape` is byte-identical to the start of a CSI sequence, so the
 * parser holds it as pending input and waits for the tail. A terminal that only
 * sends `Escape` never provides one, and the key would be lost; this helper
 * resolves that pending byte into `escape` after a short idle window that a real
 * sequence (whose bytes arrive back to back) never reaches.
 */
import { parseKeys, type KeyEvent } from '@kibborg/tui'

/** How long an unterminated sequence is held before it is read as `Escape`. */
export const ESCAPE_IDLE_MS = 80

/** Escape decoding for one interactive loop. */
export interface EscapeIdle {
  /**
   * Decode one raw chunk, carrying over an incomplete sequence tail.
   * @param chunk - bytes read from stdin, decoded as UTF-8.
   * @returns the keys this chunk completed, in input order, and the report fragments
   * that were dropped as damaged terminal noise.
   */
  push(chunk: string): EscapeIdlePush
  /** Cancel the idle timer; call when the loop stops reading input. */
  stop(): void
}

/** The keys one chunk completed, plus every fragment dropped as terminal noise. */
export interface EscapeIdlePush {
  /** Keys decoded from this chunk, in input order. */
  readonly keys: readonly KeyEvent[]
  /** Terminal reports dropped because their escape byte was lost, if any. */
  readonly noise?: readonly string[]
}

/**
 * Create an escape-idle decoder.
 * @param onEscape - called with the resolved `Escape` key when no tail arrives.
 * @returns the decoder for one input stream.
 */
export function createEscapeIdle(onEscape: () => void): EscapeIdle {
  let pending = ''
  let timer: NodeJS.Timeout | undefined
  const stop = (): void => {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
    pending = ''
  }
  return {
    push(chunk: string): EscapeIdlePush {
      if (timer !== undefined) {
        clearTimeout(timer)
        timer = undefined
      }
      const parsed = parseKeys(pending + chunk)
      pending = parsed.pending ?? ''
      if (pending !== '') {
        timer = setTimeout(() => {
          timer = undefined
          // Only a lone Escape is a key on its own. Anything else that is still
          // incomplete (a CSI tail, an unclosed bracketed paste) keeps waiting
          // for its bytes instead of being dropped.
          if (pending !== '\u001B') return
          pending = ''
          onEscape()
        }, ESCAPE_IDLE_MS)
      }
      return parsed.noise === undefined ? { keys: parsed.keys } : { keys: parsed.keys, noise: parsed.noise }
    },
    stop,
  }
}
