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
    expect(idle.push('\u001B').keys).toEqual([])
    expect(onEscape).not.toHaveBeenCalled()
    await settle()
    expect(onEscape).toHaveBeenCalledTimes(1)
    idle.stop()
  })

  it('keeps an unfinished sequence for its tail', async () => {
    const onEscape = vi.fn()
    const idle = createEscapeIdle(onEscape)
    expect(idle.push('\u001B[').keys).toEqual([])
    await settle()
    expect(onEscape).not.toHaveBeenCalled()
    expect(idle.push('A').keys).toEqual([{ kind: 'up' }])
    idle.stop()
  })

  it('keeps an unfinished paste for its tail', async () => {
    const onEscape = vi.fn()
    const idle = createEscapeIdle(onEscape)
    expect(idle.push('\u001B[200~первая').keys).toEqual([])
    await settle()
    expect(onEscape).not.toHaveBeenCalled()
    const tail = idle.push(' строка\u001B[201~')
    expect(tail.keys).toEqual([{ kind: 'paste', text: 'первая строка' }])
    idle.stop()
  })

  it('decodes a whole sequence from one read', () => {
    const onEscape = vi.fn()
    const idle = createEscapeIdle(onEscape)
    expect(idle.push('\u001B[5~').keys).toEqual([{ kind: 'page-up' }])
    expect(onEscape).not.toHaveBeenCalled()
    idle.stop()
  })

  it('reports a report tail whose escape byte was lost', async () => {
    const onEscape = vi.fn()
    const idle = createEscapeIdle(onEscape)
    // A read boundary that ends between the escape byte and the rest of a report makes
    // the escape byte a key of its own; the tail then arrives with nothing to attach it
    // to, and typing it is what put `[13;28;13;1;0;1_` in the composer.
    expect(idle.push('\u001B').keys).toEqual([])
    await settle()
    expect(onEscape).toHaveBeenCalledTimes(1)
    const tail = idle.push('[13;28;13;1;0;1_')
    expect(tail.keys).toEqual([])
    expect(tail.noise).toEqual(['orphan-win32:[13;28;13;1;0;1_'])
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
