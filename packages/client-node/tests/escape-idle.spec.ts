/**
 * Escape timing of the interactive loops.
 *
 * A terminal sends a key sequence as one read, but a lone `Escape` has no tail:
 * without a timer it would stay pending forever and the key would be lost, while
 * a timer that clears every pending buffer would instead eat an unfinished
 * bracketed paste. These tests pin both halves.
 */
import { describe, expect, it, vi } from 'vitest'
import { createEscapeIdle, ESCAPE_IDLE_MS } from '../src/escape-idle.ts'

/** Wait past the idle window so the timer either fired or was cancelled. */
const settle = () => new Promise(resolve => setTimeout(resolve, ESCAPE_IDLE_MS + 30))

describe('createEscapeIdle', () => {
  it('reads a lone Escape as the escape key', async () => {
    const onEscape = vi.fn()
    const idle = createEscapeIdle(onEscape)
    expect(idle.push('\u001B')).toEqual([])
    expect(onEscape).not.toHaveBeenCalled()
    await settle()
    expect(onEscape).toHaveBeenCalledTimes(1)
    idle.stop()
  })

  it('keeps an unfinished sequence for its tail', async () => {
    const onEscape = vi.fn()
    const idle = createEscapeIdle(onEscape)
    expect(idle.push('\u001B[')).toEqual([])
    await settle()
    expect(onEscape).not.toHaveBeenCalled()
    expect(idle.push('A')).toEqual([{ kind: 'up' }])
    idle.stop()
  })

  it('keeps an unfinished paste for its tail', async () => {
    const onEscape = vi.fn()
    const idle = createEscapeIdle(onEscape)
    expect(idle.push('\u001B[200~первая')).toEqual([])
    await settle()
    expect(onEscape).not.toHaveBeenCalled()
    const tail = idle.push(' строка\u001B[201~')
    expect(tail).toEqual([{ kind: 'paste', text: 'первая строка' }])
    idle.stop()
  })

  it('decodes a whole sequence from one read', () => {
    const onEscape = vi.fn()
    const idle = createEscapeIdle(onEscape)
    expect(idle.push('\u001B[5~')).toEqual([{ kind: 'page-up' }])
    expect(onEscape).not.toHaveBeenCalled()
    idle.stop()
  })

  it('drops the timer on stop', async () => {
    const onEscape = vi.fn()
    const idle = createEscapeIdle(onEscape)
    idle.push('\u001B')
    idle.stop()
    await settle()
    expect(onEscape).not.toHaveBeenCalled()
  })
})
