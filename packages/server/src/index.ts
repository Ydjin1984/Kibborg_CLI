/**
 * `@kibborg/server` — the API gateway behind a network carrier.
 *
 * The terminal surface reaches the host in process; this package is the other
 * shape of the same contract: the same `ctx.apiProxy` served over HTTP with
 * WebSocket event downlinks, so a `kibborg attach` client (or any HTTP client)
 * drives the host from another process or another machine.
 *
 * Two facts make that safe. Every request must present the shared token, and a
 * non-loopback deployment refuses to start without one — a server that is
 * reachable by others is not a server that trusts them. The transport itself is
 * deliberately thin: bodies are buffered under a cap, hop-by-hop headers are
 * dropped, and nothing is cached.
 * @module @kibborg/server
 */

import z from '@deepseek-ai/schemastery'
import type { Context } from '@deepseek-ai/cordis'
import type { WebRoute, WebUpgradeRoute } from '@deepseek-ai/dsh-host-webserver'
import { toFetchHandler } from '@deepseek-ai/dsh-host-apiproxy'
import { API_PATH, HOST_EVENTS_PATH, MUX_EVENTS_PATH } from '@deepseek-ai/dsh-client-connection'
import { answer, bridge, type FetchHandler } from './bridge.ts'
import { rejectWebSocketUpgrade, WebSocketDownlinks } from './downlinks.ts'
import { createAccessLogger, createGate } from './gate.ts'
import { localAddresses, publishService } from './mdns.ts'

/** Stable Cordis plugin name. */
export const name = 'kibborg-server'

/** Services required before the carrier can register its routes. */
export const inject = ['webServer', 'apiProxy']

/** Headroom over the aggregate image limit, mirroring the web carrier. */
const DEFAULT_MAX_REQUEST_BODY_BYTES = 32 * 1024 * 1024

/** Deployment of one `kibborg serve` process. */
export interface ServerConfig {
  /** Shared secret every request must present; required off loopback. */
  token: string
  /**
   * Authorities served beyond loopback, as `host:port` or a port-less `host`.
   * A non-empty list means this deployment is reachable by others, which is why
   * it also requires a token.
   */
  trustedHosts: string[]
  /** Largest JSON body buffered for one `/api` request. */
  maxRequestBodyBytes: number
  /** Print one access-log line per request on stderr. */
  log: boolean
  /** Advertise this server over mDNS so `kibborg discover` finds it. */
  mdns: boolean
  /** Instance name for the mDNS record; defaults to `kibborg-<hostname>`. */
  instance: string
  /** Protocol version the mDNS record advertises. */
  version: string
}

export const Config: z<ServerConfig> = z.object({
  token: z.string().default(''),
  trustedHosts: z.array(String).default([]),
  maxRequestBodyBytes: z.natural().min(1).default(DEFAULT_MAX_REQUEST_BODY_BYTES),
  log: z.boolean().default(true),
  mdns: z.boolean().default(false),
  instance: z.string().default(''),
  version: z.string().default(''),
})

/** Whether a peer address is this machine. */
function isLoopback(address: string | undefined): boolean {
  if (address === undefined) return false
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

/**
 * Mount the network carrier over `ctx.apiProxy`.
 * @param ctx - host context carrying the webserver and the API proxy.
 * @param config - resolved plugin config; a hand-built context may pass none.
 */
export function apply(ctx: Context, config?: ServerConfig): void {
  const resolved: ServerConfig = {
    token: config?.token ?? '',
    trustedHosts: config?.trustedHosts ?? [],
    maxRequestBodyBytes: config?.maxRequestBodyBytes ?? DEFAULT_MAX_REQUEST_BODY_BYTES,
    log: config?.log ?? true,
    mdns: config?.mdns ?? false,
    instance: config?.instance ?? '',
    version: config?.version ?? '',
  }
  if (resolved.trustedHosts.length > 0 && resolved.token === '') {
    throw new Error('kibborg-server: a non-loopback deployment requires a token; refusing to serve without one')
  }
  const gate = createGate({ token: resolved.token, trustedHosts: resolved.trustedHosts })
  const logger = createAccessLogger({ enabled: resolved.log })

  const apiProxy = ctx.apiProxy
  const handler: FetchHandler = toFetchHandler(apiProxy)

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: API_PATH,
    handler: (async (req, res) => {
      const started = Date.now()
      const refusal = gate.admit(req)
      if (refusal !== undefined) {
        answer(res, refusal.status, refusal.reason)
        logger.record(req, refusal.status, started)
        return
      }
      await bridge(req, res, handler, resolved.maxRequestBodyBytes)
      logger.record(req, res.statusCode, started)
    }) satisfies WebRoute['handler'],
  }), 'kibborg-server: /api route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/healthz',
    handler: (async (req, res) => {
      // A health probe carries no token by design; it answers only to this
      // machine, so it cannot be used to confirm a remote deployment exists.
      if (!isLoopback(req.socket.remoteAddress)) {
        answer(res, 403, 'loopback only')
        return
      }
      answer(res, 200, `${JSON.stringify({ ok: true, sessions: ctx.get('sessions')?.list().length ?? 0 })}\n`, 'application/json')
    }) satisfies WebRoute['handler'],
  }), 'kibborg-server: healthz route')

  const downlinks = new WebSocketDownlinks(apiProxy)
  ctx.effect(() => () => downlinks.close(), 'kibborg-server: WebSocket downlinks')
  const registerDownlink = (path: string, handle: WebUpgradeRoute['handler']): void => {
    ctx.effect(() => ctx.webServer.registerUpgrade({
      path,
      handler: (req, socket, head) => {
        const refusal = gate.admit(req)
        if (refusal !== undefined) {
          rejectWebSocketUpgrade(socket)
          return
        }
        return handle(req, socket, head)
      },
    }), `kibborg-server: ${path} WebSocket`)
  }
  registerDownlink(MUX_EVENTS_PATH, (req, socket, head) => { downlinks.handleMux(req, socket, head) })
  registerDownlink(HOST_EVENTS_PATH, (req, socket, head) => { downlinks.handleHost(req, socket, head) })

  if (resolved.mdns) {
    // The record advertises reachability, never the token: it says whether one
    // is required, and the client is still given the secret out of band.
    const published = publishService({
      ...(resolved.instance === '' ? {} : { instance: resolved.instance }),
      port: Number(process.env['KIBBORG_SERVE_PORT'] ?? 7317),
      tokenRequired: resolved.token !== '',
      addresses: localAddresses(),
      ...(resolved.version === '' ? {} : { version: resolved.version }),
    })
    ctx.effect(() => () => published.close(), 'kibborg-server: mDNS publication')
  }
}
