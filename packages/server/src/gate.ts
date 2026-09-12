/**
 * The admission fence in front of the server's API surface.
 *
 * Two independent facts gate every request: the caller must present the shared
 * token, and the request's Origin, when present, must be an authority this
 * server serves. The token is what makes a non-loopback bind safe; the Origin
 * check is what keeps a browser page on another site from driving the API with
 * a token it should never have had — the API answers no CORS preflight, so a
 * cross-site browser call cannot read a response even before this fence.
 * @module @kibborg/server/gate
 */

import { timingSafeEqual } from 'node:crypto'
import type { IncomingMessage } from 'node:http'

/** Authorities that always count as local, whatever the bind address is. */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost', '0.0.0.0', '::'])

/** Compare two strings without leaking their length-wise agreement in timing. */
function secretEquals(presented: string, expected: string): boolean {
  const left = Buffer.from(presented, 'utf8')
  const right = Buffer.from(expected, 'utf8')
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

/** The token a request carries, from the Authorization header or the query. */
function presentedToken(request: IncomingMessage): string | undefined {
  const header = request.headers.authorization
  if (typeof header === 'string' && header.toLowerCase().startsWith('bearer ')) {
    return header.slice('bearer '.length).trim()
  }
  if (typeof header === 'string' && header !== '') return header.trim()
  const url = new URL(request.url ?? '/', 'http://localhost')
  const query = url.searchParams.get('token')
  return query === null || query === '' ? undefined : query
}

/** The bare hostname of an authority, without its port. */
function hostnameOf(authority: string): string {
  if (authority.startsWith('[')) {
    const end = authority.indexOf(']')
    return end === -1 ? authority : authority.slice(1, end)
  }
  const colon = authority.lastIndexOf(':')
  return colon === -1 ? authority : authority.slice(0, colon)
}

/** Whether an Origin header belongs to this server. */
function originAllowed(origin: string, trustedHosts: readonly string[]): boolean {
  let parsed: URL
  try {
    parsed = new URL(origin)
  } catch {
    return false
  }
  if (LOOPBACK_HOSTS.has(parsed.hostname)) return true
  return trustedHosts.some(authority => hostnameOf(authority) === parsed.hostname)
}

/** Why one request was refused, or `undefined` when it may proceed. */
export interface Refusal {
  /** HTTP status to answer with. */
  readonly status: number
  /** Short machine-readable reason. */
  readonly reason: string
}

/** The fence one composed server applies to every request. */
export interface ServerGate {
  /**
   * Decide whether a request may proceed.
   * @param request - the incoming HTTP request or WebSocket upgrade.
   * @returns the refusal, or `undefined` when the request is admitted.
   */
  readonly admit: (request: IncomingMessage) => Refusal | undefined
}

/**
 * Build the fence for one deployment.
 * @param options - the shared token and the non-loopback authorities served.
 * @returns the gate every route consults before it answers.
 */
export function createGate(options: { readonly token: string; readonly trustedHosts: readonly string[] }): ServerGate {
  return {
    admit(request) {
      // The Origin check applies in every deployment: a browser page on another
      // site must never drive this API, with or without a token.
      const origin = request.headers.origin
      if (typeof origin === 'string' && origin !== '' && !originAllowed(origin, options.trustedHosts)) {
        return { status: 403, reason: 'origin not served' }
      }
      // No token configured means this deployment serves loopback only, which
      // the launcher enforces before boot; there is nothing to compare here.
      if (options.token === '') return undefined
      const presented = presentedToken(request)
      if (presented === undefined) return { status: 401, reason: 'missing token' }
      if (!secretEquals(presented, options.token)) return { status: 403, reason: 'bad token' }
      return undefined
    },
  }
}

/** One access-log line, printed to stderr so it never mixes with a response. */
export interface AccessLogger {
  /**
   * Record one finished request.
   * @param request - the request that was served.
   * @param status - the status the server answered with.
   * @param startedAt - `Date.now()` when the request was admitted.
   */
  readonly record: (request: IncomingMessage, status: number, startedAt: number) => void
}

/**
 * Build the access logger.
 * @param options - whether logging is on, and where a line goes.
 * @returns the logger the routes call when a request settles.
 */
export function createAccessLogger(options: { readonly enabled: boolean; readonly write?: (line: string) => void }): AccessLogger {
  const write = options.write ?? (line => void process.stderr.write(line))
  return {
    record(request, status, startedAt) {
      if (!options.enabled) return
      const peer = request.socket.remoteAddress ?? '-'
      const method = request.method ?? '-'
      const path = request.url ?? '-'
      const millis = Date.now() - startedAt
      write(`kibborg serve: ${method} ${path} ${String(status)} ${String(millis)}ms ${peer}\n`)
    },
  }
}
