import { describe, expect, it, vi } from 'vitest'
import type { IncomingMessage } from 'node:http'
import { createAccessLogger, createGate } from '../src/gate.ts'
import { answer } from '../src/bridge.ts'

/** A request stub carrying the headers, url, and peer the gate reads. */
function request(fields: {
  authorization?: string
  origin?: string
  url?: string
  remoteAddress?: string
}): IncomingMessage {
  return {
    headers: {
      ...(fields.authorization === undefined ? {} : { authorization: fields.authorization }),
      ...(fields.origin === undefined ? {} : { origin: fields.origin }),
    },
    url: fields.url ?? '/api/session.list',
    method: 'POST',
    socket: { remoteAddress: fields.remoteAddress ?? '127.0.0.1' },
  } as unknown as IncomingMessage
}

describe('createGate', () => {
  const gate = createGate({ token: 's3cret', trustedHosts: ['kibborg.example:7317'] })

  it('admits a bearer token from this machine', () => {
    expect(gate.admit(request({ authorization: 'Bearer s3cret' }))).toBeUndefined()
  })

  it('admits the token on a served authority', () => {
    const admitted = gate.admit(request({
      authorization: 'Bearer s3cret',
      origin: 'https://kibborg.example:7317',
      remoteAddress: '10.0.0.5',
    }))

    expect(admitted).toBeUndefined()
  })

  it('accepts the token as a query parameter, which a WebSocket client can send', () => {
    expect(gate.admit(request({ url: '/api/events/mux?token=s3cret' }))).toBeUndefined()
  })

  it('refuses a missing token', () => {
    expect(gate.admit(request({}))).toMatchObject({ status: 401 })
  })

  it('refuses a wrong token of the same length', () => {
    expect(gate.admit(request({ authorization: 'Bearer s3cree' }))).toMatchObject({ status: 403 })
  })

  it('refuses a wrong token of a different length', () => {
    expect(gate.admit(request({ authorization: 'Bearer short' }))).toMatchObject({ status: 403 })
  })

  it('refuses an origin this deployment does not serve', () => {
    expect(gate.admit(request({ authorization: 'Bearer s3cret', origin: 'https://evil.example' })))
      .toMatchObject({ status: 403, reason: 'origin not served' })
  })

  it('admits a loopback origin on any deployment', () => {
    expect(gate.admit(request({ authorization: 'Bearer s3cret', origin: 'http://127.0.0.1:7317' }))).toBeUndefined()
  })

  it('admits a request without a token when no token is configured', () => {
    // The launcher refuses a non-loopback bind without a token, so an empty
    // token means this deployment is reachable from this machine only.
    expect(createGate({ token: '', trustedHosts: [] }).admit(request({}))).toBeUndefined()
  })

  it('still refuses a foreign origin when no token is configured', () => {
    expect(createGate({ token: '', trustedHosts: [] }).admit(request({ origin: 'https://evil.example' })))
      .toMatchObject({ status: 403 })
  })
})

describe('createAccessLogger', () => {
  it('writes one line per request when enabled', () => {
    const lines: string[] = []
    const logger = createAccessLogger({ enabled: true, write: line => void lines.push(line) })

    logger.record(request({ remoteAddress: '10.0.0.9' }), 200, Date.now())

    expect(lines[0]).toContain('POST /api/session.list 200')
    expect(lines[0]).toContain('10.0.0.9')
  })

  it('stays silent when disabled', () => {
    const write = vi.fn()
    const logger = createAccessLogger({ enabled: false, write })

    logger.record(request({}), 200, Date.now())

    expect(write).not.toHaveBeenCalled()
  })
})

describe('answer', () => {
  it('writes the status, body, and a no-store cache header', () => {
    const writeHead = vi.fn()
    const end = vi.fn()
    answer({ writeHead, end } as never, 401, 'missing token')

    expect(writeHead).toHaveBeenCalledWith(401, expect.objectContaining({ 'cache-control': 'no-store' }))
    expect(end).toHaveBeenCalledWith('missing token')
  })
})
