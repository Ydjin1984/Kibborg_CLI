/**
 * The terminal surface's settings section.
 *
 * The screen default is the product's most visible switch: `fullscreen` must be
 * the terminal default, and a missing section must fall back to it rather than
 * silently starting in a scrollback-only mode.
 */
import { describe, expect, it } from 'vitest'
import type { IApiClient } from '@deepseek-ai/dsh-host-apiproxy/client'
import { readSurfaceSettings, SURFACE_DEFAULTS } from '../src/surface-settings.ts'

describe('SURFACE_DEFAULTS', () => {
  it('opens the fullscreen surface on a terminal by default', () => {
    expect(SURFACE_DEFAULTS.screen).toBe('fullscreen')
  })
})

describe('readSurfaceSettings', () => {
  it('falls back to the defaults when the settings domain is unavailable', async () => {
    const client = {
      settings: { describe: async () => ({ result: { ok: false, error: { code: 'unavailable', message: 'no settings' } } }) },
    } as unknown as IApiClient

    const settings = await readSurfaceSettings(client)
    expect(settings).toEqual(SURFACE_DEFAULTS)
  })

  it('reads a user-chosen screen mode', async () => {
    const client = {
      settings: {
        describe: async () => ({
          result: {
            ok: true,
            value: {
              namespaces: [
                { ns: 'kibborg-cli', value: { theme: 'ice', timestamps: true, multiline: false, screen: 'minimal' } },
              ],
            },
          },
        }),
      },
    } as unknown as IApiClient

    const settings = await readSurfaceSettings(client)
    expect(settings.screen).toBe('minimal')
  })
})
