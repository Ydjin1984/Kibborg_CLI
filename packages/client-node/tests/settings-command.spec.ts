import { describe, expect, it, vi } from 'vitest'
import type { IApiClient } from '@deepseek-ai/dsh-host-apiproxy/client'
import type { SettingsNamespaceView } from '@deepseek-ai/dsh-host-apiproxy/api'
import { runSettingsCommand } from '../src/settings-command.ts'

/** A namespace descriptor carrying one credential reference. */
function namespace(ns: string, value: unknown): SettingsNamespaceView {
  return {
    ns,
    schema: {},
    value,
    applies: 'live',
    secrets: [{ path: ['apiKey'], set: true }],
    revision: 3,
  }
}

/** A client whose settings and credential domains answer from fixed values. */
function clientStub(): { readonly client: IApiClient; readonly described: string[] } {
  const described: string[] = []
  const client = {
    settings: {
      describe: async () => ({
        result: {
          ok: true,
          value: {
            writable: true,
            hasDocument: true,
            namespaces: [
              namespace('llm-pi-ai', { providers: { kibborg: { apiKeyEnv: 'KIBBORG_API_KEY' } } }),
              namespace('web-search-deepseek', { search: { apiKeyEnv: 'SEARCH_KEY' } }),
            ],
          },
        },
      }),
      mutate: vi.fn(async () => ({ result: { ok: true, value: { ns: 'orchestrator', revision: 4 } } })),
    },
    credentials: {
      describe: async (payload: { refs: readonly string[] }) => {
        described.push(...payload.refs)
        return {
          result: {
            ok: true,
            value: {
              credentials: Object.fromEntries(payload.refs.map(ref => [ref, { configured: true, source: 'file', writable: true }])),
            },
          },
        }
      },
      set: vi.fn(async () => ({ result: { ok: true, value: {} } })),
      unset: vi.fn(async () => ({ result: { ok: true, value: {} } })),
    },
  } as unknown as IApiClient
  return { client, described }
}

describe('runSettingsCommand', () => {
  it('lists the namespaces with their secret state', async () => {
    const { client } = clientStub()
    const code = await runSettingsCommand(client, { kind: 'settings' })

    expect(code).toBe(0)
  })

  it('collects the credential references declared by the mounted settings', async () => {
    const { client, described } = clientStub()
    const code = await runSettingsCommand(client, { kind: 'auth' })

    expect(code).toBe(0)
    expect(described).toEqual(['KIBBORG_API_KEY', 'SEARCH_KEY'])
  })

  it('refuses a namespace-less show without touching the client', async () => {
    const { client } = clientStub()

    expect(await runSettingsCommand(client, { kind: 'settings', sub: 'show' })).toBe(2)
  })

  it('applies a set operation through the mutate method', async () => {
    const { client } = clientStub()
    const code = await runSettingsCommand(client, {
      kind: 'settings',
      sub: 'set',
      ns: 'orchestrator',
      path: 'headDenyTools',
      value: ['read'],
    })

    expect(code).toBe(0)
    expect(client.settings.mutate).toHaveBeenCalledWith({
      ns: 'orchestrator',
      ops: [{ op: 'set', path: ['headDenyTools'], value: ['read'] }],
    })
  })

  it('refuses a malformed subcommand', async () => {
    const { client } = clientStub()

    expect(await runSettingsCommand(client, { kind: 'settings', sub: 'nonsense' })).toBe(2)
  })
})
