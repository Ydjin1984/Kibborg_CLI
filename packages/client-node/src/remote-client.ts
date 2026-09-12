/**
 * The client half of `kibborg attach`: the same API surface the in-process
 * client offers, carried over HTTP and WebSocket to another process.
 *
 * The browser client reaches the host through the same routes; this one differs
 * only in where it runs and in what it presents as proof. Two facts are specific
 * to a terminal:
 *
 * - the token rides every request as `Authorization: Bearer`, and the event
 *   downlinks carry it as a query parameter, because a WebSocket handshake
 *   cannot set headers from every environment;
 * - the event streams are WebSocket frames (`server-request` envelopes), not
 *   server-sent events, so the two downlinks override the SSE default.
 * @module @kibborg/client-node/remote-client
 */

import { AbstractApiClient, type IApiClient } from '@deepseek-ai/dsh-host-apiproxy/client'
import type { HostFrame, MuxFrame, RpcRequest } from '@deepseek-ai/dsh-host-apiproxy/api'
import { API_PATH, HOST_EVENTS_PATH, MUX_EVENTS_PATH } from '@deepseek-ai/dsh-client-connection'
import WebSocket from 'ws'

/** One server-request envelope as the downlink sends it. */
interface ServerRequestFrame {
  readonly type: 'server-request'
  readonly rpcId: string
  readonly payload: MuxFrame | HostFrame
}

/** A server address the client can reach, as `http://host:port`. */
export interface AttachTarget {
  /** Origin to reach, without a trailing slash. */
  readonly origin: string
  /** Shared token the server requires; empty when the deployment is loopback. */
  readonly token: string
}

/**
 * Read an `http(s)://host:port` argument, refusing anything else.
 * @param raw - the URL the caller passed.
 * @returns the normalized origin and the token the URL carries, if any.
 * @throws when the argument is not an HTTP(S) URL.
 */
export function parseAttachTarget(raw: string): AttachTarget {
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw new Error(`attach needs an http(s) URL, got ${JSON.stringify(raw)}`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`attach needs an http(s) URL, got ${JSON.stringify(raw)}`)
  }
  const token = parsed.searchParams.get('token') ?? ''
  parsed.search = ''
  return { origin: parsed.origin, token }
}

/** Decode one WebSocket message into a server-request frame. */
function asServerRequest(data: unknown): ServerRequestFrame | undefined {
  const text = typeof data === 'string' ? data : Buffer.isBuffer(data) ? data.toString('utf8') : undefined
  if (text === undefined) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return undefined
  }
  if (parsed === null || typeof parsed !== 'object') return undefined
  const frame = parsed as { type?: unknown; rpcId?: unknown; payload?: unknown }
  if (frame.type !== 'server-request' || typeof frame.rpcId !== 'string') return undefined
  if (frame.payload === null || typeof frame.payload !== 'object') return undefined
  return frame as unknown as ServerRequestFrame
}

/**
 * An API client bound to a running `kibborg serve` process.
 */
export class RemoteApiClient extends AbstractApiClient implements IApiClient {
  /**
   * @param target - where the server is and what token it expects.
   * @param timeoutMs - timeout for bounded unary calls.
   */
  constructor(
    private readonly target: AttachTarget,
    timeoutMs?: number,
  ) {
    super(timeoutMs)
  }

  /** The server origin, replacing the base URL a browser or in-process client would use. */
  protected override resolveBase(): string {
    return this.target.origin
  }

  /** Attach the token to every request this client makes. */
  protected override async doFetch(input: URL, init?: RequestInit): Promise<Response> {
    const headers = new Headers(init?.headers)
    if (this.target.token !== '') headers.set('authorization', `Bearer ${this.target.token}`)
    return await fetch(input, { ...init, headers })
  }

  /** The mux downlink: events for every session the caller is subscribed to. */
  protected override openMux(
    payload: Parameters<IApiClient['events']['mux']>[0],
    signal: AbortSignal,
    onOpen?: () => void,
  ): AsyncIterable<RpcRequest<MuxFrame>> {
    return this.readSocket(MUX_EVENTS_PATH, payload, signal, onOpen)
  }

  /** The host downlink: events that belong to the host rather than one session. */
  protected override openHost(
    payload: Parameters<IApiClient['events']['host']>[0],
    signal: AbortSignal,
    onOpen?: () => void,
  ): AsyncIterable<RpcRequest<HostFrame>> {
    return this.readSocket(HOST_EVENTS_PATH, payload, signal, onOpen)
  }

  /**
   * Pump one WebSocket downlink as an async iterable of frames.
   *
   * The generator ends when the socket closes or the caller aborts; both paths
   * remove their listeners, so a cancelled turn does not leave a socket behind.
   */
  private async *readSocket<F extends MuxFrame | HostFrame>(
    path: string,
    _payload: unknown,
    signal: AbortSignal,
    onOpen?: () => void,
  ): AsyncIterable<RpcRequest<F>> {
    const url = new URL(`${this.target.origin}${path}`)
    if (this.target.token !== '') url.searchParams.set('token', this.target.token)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    const socket = new WebSocket(url, { headers: this.target.token === '' ? {} : { authorization: `Bearer ${this.target.token}` } })
    const queue: RpcRequest<F>[] = []
    let wake: (() => void) | undefined
    let closed = false
    let failure: Error | undefined
    const stop = (): void => {
      closed = true
      wake?.()
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close()
    }
    socket.on('open', () => { onOpen?.() })
    socket.on('message', (data: unknown) => {
      const frame = asServerRequest(data)
      if (frame === undefined) return
      queue.push({ rpcId: frame.rpcId as RpcRequest<F>['rpcId'], payload: frame.payload as F })
      wake?.()
    })
    socket.on('error', (error: Error) => {
      failure = error
      stop()
    })
    socket.on('close', () => { stop() })
    signal.addEventListener('abort', stop, { once: true })
    try {
      while (!closed || queue.length > 0) {
        const next = queue.shift()
        if (next !== undefined) {
          yield next
          continue
        }
        await new Promise<void>(resolve => { wake = resolve })
        wake = undefined
      }
      if (failure !== undefined && !signal.aborted) throw failure
    } finally {
      signal.removeEventListener('abort', stop)
      stop()
    }
  }
}

/** The API path the client posts commands and RPC calls to. */
export const REMOTE_API_PATH = API_PATH
