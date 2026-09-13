/**
 * Command-line parsing of the `kibborg` binary.
 *
 * The screen-mode flags and the discover/attach validation are the branches a
 * typo in the parser would silently invert, so they are pinned here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseKiborgArgs } from '../src/args.ts'

describe('parseKiborgArgs screen mode', () => {
  it('maps --minimal to the minimal screen mode', () => {
    const invocation = parseKiborgArgs(['--minimal', 'hello'], '0.1.0')
    expect(invocation.mode).toBe('client')
    if (invocation.mode === 'client') expect(invocation.intent.screen).toBe('minimal')
  })

  it('maps --fullscreen to the fullscreen screen mode', () => {
    const invocation = parseKiborgArgs(['--fullscreen', 'hello'], '0.1.0')
    expect(invocation.mode).toBe('client')
    if (invocation.mode === 'client') expect(invocation.intent.screen).toBe('fullscreen')
  })

  it('keeps inline when both --minimal and --fullscreen are given', () => {
    const invocation = parseKiborgArgs(['--minimal', '--fullscreen', 'hello'], '0.1.0')
    expect(invocation.mode).toBe('client')
    if (invocation.mode === 'client') expect(invocation.intent.screen).toBe('inline')
  })
})

describe('parseKiborgArgs argument validation', () => {
  let exit: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    exit = vi.spyOn(process, 'exit').mockImplementation((code?: number) => {
      throw new Error(`exit:${String(code)}`)
    })
  })

  afterEach(() => {
    exit.mockRestore()
  })

  it('rejects a non-positive --timeout', () => {
    expect(() => parseKiborgArgs(['discover', '--timeout', '0'], '0.1.0')).toThrow('exit:1')
  })

  it('rejects a --timeout above the cap', () => {
    expect(() => parseKiborgArgs(['discover', '--timeout', '61'], '0.1.0')).toThrow('exit:1')
  })

  it('rejects a non-URL attach target when a token is supplied', () => {
    expect(() => parseKiborgArgs(['attach', 'not-a-url', '--token', 'secret'], '0.1.0')).toThrow('exit:1')
  })
})
