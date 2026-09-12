import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { IApiClient } from '@deepseek-ai/dsh-host-apiproxy/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { isLocalCommand, routeCommand, splitCommand, type LocalCommandContext, type SurfaceState } from '../src/command-router.ts'

/** Build a context whose only observable behaviour is what it writes. */
function surface(): { readonly context: LocalCommandContext; readonly written: string[] } {
  const written: string[] = []
  const state: SurfaceState = {
    model: 'deepseek-official/deepseek-chat',
    effort: undefined,
    mode: 'Agent',
    contextPercent: 12,
    branch: 'feat/k4',
    dirty: true,
  }
  const context: LocalCommandContext = {
    ctx: {} as Context,
    client: {} as IApiClient,
    sessionId: 'session-1' as SessionId,
    write: chunk => void written.push(chunk),
    state,
  }
  return { context, written }
}

describe('splitCommand', () => {
  it('splits a name from its argument text', () => {
    expect(splitCommand('/model deepseek/deepseek-chat')).toEqual({
      name: 'model',
      argument: 'deepseek/deepseek-chat',
    })
  })

  it('returns an empty argument for a bare command', () => {
    expect(splitCommand('/status')).toEqual({ name: 'status', argument: '' })
  })
})

describe('isLocalCommand', () => {
  it('claims the surface commands and nothing else', () => {
    expect(isLocalCommand('/status')).toBe(true)
    expect(isLocalCommand('/compact')).toBe(false)
  })
})

describe('routeCommand', () => {
  it('answers a local command without asking the host', async () => {
    const { context, written } = surface()
    const host = vi.fn()
    const outcome = await routeCommand('/status', context, host)

    expect(outcome.ok).toBe(true)
    expect(host).not.toHaveBeenCalled()
    expect(written.join('')).toContain('deepseek-official/deepseek-chat')
    expect(written.join('')).toContain('feat/k4')
  })

  it('delegates everything else to the host registry', async () => {
    const { context, written } = surface()
    const host = vi.fn(async () => ({ ok: true, text: 'compacted' }))
    const outcome = await routeCommand('/compact', context, host)

    expect(host).toHaveBeenCalledWith('/compact')
    expect(outcome.text).toBe('compacted')
    expect(written).toEqual([])
  })
})
