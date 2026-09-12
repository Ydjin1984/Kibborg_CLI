import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { IApiClient } from '@deepseek-ai/dsh-host-apiproxy/client'
import { defaultExportPath, exportSessionLog } from '../src/export-session.ts'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

/** A client that reports exactly one session, so the export resolves it. */
function clientWithOneSession(): IApiClient {
  return {
    sessions: {
      list: async () => ({
        result: {
          ok: true,
          value: {
            items: [{ sessionId: 'session-1', updatedAt: 1, blank: false, cwd: process.cwd() }],
          },
        },
      }),
    },
  } as unknown as IApiClient
}

/** A proxy whose export surface answers with the bytes handed in. */
function proxyAnswering(bytes: readonly number[], status = 200): Context {
  return {
    apiProxy: {
      downloads: {
        sessionLog: async () => new Response(new Uint8Array(bytes), { status }),
      },
    },
  } as unknown as Context
}

describe('defaultExportPath', () => {
  it('names the archive after the session', () => {
    expect(defaultExportPath('session-1')).toBe('kibborg-session-session-1.zip')
  })
})

describe('exportSessionLog', () => {
  it('writes the archive the host streamed and reports success', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'kibborg-export-'))
    directories.push(directory)
    const output = join(directory, 'log.zip')

    const code = await exportSessionLog(proxyAnswering([1, 2, 3]), clientWithOneSession(), { output })

    expect(code).toBe(0)
    expect([...readFileSync(output)]).toEqual([1, 2, 3])
  })

  it('fails when the host refuses the export', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'kibborg-export-'))
    directories.push(directory)
    const output = join(directory, 'log.zip')

    const code = await exportSessionLog(proxyAnswering([], 404), clientWithOneSession(), { output })

    expect(code).toBe(1)
  })

  it('fails when no session matches', async () => {
    const client = { sessions: { list: async () => ({ result: { ok: true, value: { items: [] } } }) } } as unknown as IApiClient

    const code = await exportSessionLog(proxyAnswering([1]), client, {})

    expect(code).toBe(1)
  })
})
