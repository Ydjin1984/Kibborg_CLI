/**
 * Host-side WebSocket carrier for the two server-to-client event streams.
 *
 * The wire contract is the one the API proxy already defines: each frame is a
 * `ServerRequest` envelope (`type`, `rpcId`, `method`, `payload`), and client
 * messages are a protocol violation — upstream traffic stays on HTTP. The
 * envelope is rebuilt here rather than imported because the durable contract is
 * the `ServerRequest` type in `dsh-host-apiproxy/api`, not the carrier that
 * happens to send it.
 * @module @kibborg/server/downlinks
 */

import { randomUUID } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import WebSocket, { WebSocketServer } from 'ws'
import type { ApiProxy, HostFrame, MuxFrame, RpcRequest, ServerRequest } from '@deepseek-ai/dsh-host-apiproxy/api'
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api'

/** One event frame from either stream. */
type Frame = MuxFrame | HostFrame

/** Wrap one event frame in the wire envelope a client reads. */
function serverRequest(frame: RpcRequest<Frame>): ServerRequest {
  return {
    type: 'server-request',
    rpcId: frame.rpcId,
    method: frame.payload.type,
    payload: frame.payload,
  }
}

/** Send one frame, resolving once the socket accepted it. */
function send(socket: WebSocket, frame: RpcRequest<Frame>): Promise<void> {
  return new Promise((resolve, reject) => {
    if (socket.readyState !== WebSocket.OPEN) {
      reject(new Error('websocket downlink closed before frame delivery'))
      return
    }
    socket.send(JSON.stringify(serverRequest(frame)), (error) => {
      if (error === null || error === undefined) resolve()
      else reject(error)
    })
  })
}

/**
 * Refuse an upgrade this server will not serve.
 * @param socket - the socket the upgrade requested.
 */
export function rejectWebSocketUpgrade(socket: Duplex): void {
  socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
  socket.destroy()
}

/**
 * Owns WebSocket negotiation and frame pumping for the two downlinks.
 */
export class WebSocketDownlinks {
  private readonly server = new WebSocketServer({ noServer: true })
  private readonly pumps = new Set<Promise<void>>()

  /** @param api - host API supplying the typed event streams. */
  constructor(private readonly api: ApiProxy) {}

  /**
   * Upgrade one socket and pump the mux stream until either side closes.
   * @param req - HTTP upgrade request.
   * @param socket - raw socket transferred by the HTTP server.
   * @param head - bytes already read after the upgrade headers.
   */
  handleMux(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    this.upgrade(req, socket, head, signal => this.api.events.mux({ rpcId: RpcId(randomUUID()), payload: {} }, signal))
  }

  /**
   * Upgrade one socket and pump the host stream until either side closes.
   * @param req - HTTP upgrade request.
   * @param socket - raw socket transferred by the HTTP server.
   * @param head - bytes already read after the upgrade headers.
   */
  handleHost(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    this.upgrade(req, socket, head, signal => this.api.events.host({ rpcId: RpcId(randomUUID()), payload: {} }, signal))
  }

  /**
   * Terminate owned sockets and await every frame pump.
   * @returns a promise resolving after the acceptor and the pumps stop.
   */
  async close(): Promise<void> {
    for (const socket of this.server.clients) socket.terminate()
    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => {
        if (error === undefined) resolve()
        else reject(error)
      })
    })
    await Promise.all(this.pumps)
  }

  /** Negotiate one upgrade and pump its stream. */
  private upgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    open: (signal: AbortSignal) => AsyncIterable<RpcRequest<Frame>>,
  ): void {
    this.server.handleUpgrade(req, socket, head, (client) => {
      const controller = new AbortController()
      client.on('close', () => { controller.abort() })
      client.on('error', () => { controller.abort() })
      const pump = (async () => {
        try {
          for await (const frame of open(controller.signal)) await send(client, frame)
        } catch {
          // A closed socket or a stopped source both end the downlink; there is
          // no second consumer for the failure, and the client reconnects.
        } finally {
          if (client.readyState === WebSocket.OPEN) client.close()
        }
      })()
      this.pumps.add(pump)
      void pump.finally(() => this.pumps.delete(pump))
    })
  }
}
