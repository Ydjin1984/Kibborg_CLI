/**
 * The HTTP carrier between a node request and the fetch-shaped API handler.
 *
 * The API gateway speaks `Request`/`Response`; a node server speaks
 * `IncomingMessage`/`ServerResponse`. This module is that translation and
 * nothing else: it buffers the body under the configured cap, hands one
 * `Request` down, and writes the `Response` back. Hop-by-hop headers are
 * dropped, because a downstream client must not be told to reuse a connection
 * the server owns.
 * @module @kibborg/server/bridge
 */

import type { IncomingMessage, ServerResponse } from 'node:http'

/** A fetch-shaped handler, as the API gateway and the connection service expose. */
export interface FetchHandler {
  fetch(request: Request): Promise<Response>
}

/** Headers RFC 9110 forbids a proxy or carrier to forward. */
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])

/**
 * Read the whole request body under a byte cap.
 * @param request - the incoming request.
 * @param maxBytes - the largest body this server buffers.
 * @returns the body bytes, or `undefined` when the cap was exceeded.
 */
async function readBody(request: IncomingMessage, maxBytes: number): Promise<Buffer | undefined> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
    size += buffer.byteLength
    if (size > maxBytes) return undefined
    chunks.push(buffer)
  }
  return Buffer.concat(chunks)
}

/** Copy response headers onto the node response, dropping hop-by-hop ones. */
function writeHeaders(response: Response, res: ServerResponse): void {
  response.headers.forEach((value, key) => {
    if (HOP_BY_HOP.has(key.toLowerCase())) return
    res.setHeader(key, value)
  })
}

/**
 * Serve one node request through a fetch-shaped handler.
 * @param request - the incoming request.
 * @param res - the response to write.
 * @param handler - the fetch-shaped handler that owns the answer.
 * @param maxBytes - the largest body this server buffers.
 */
export async function bridge(
  request: IncomingMessage,
  res: ServerResponse,
  handler: FetchHandler,
  maxBytes: number,
): Promise<void> {
  const body = await readBody(request, maxBytes)
  if (body === undefined) {
    res.writeHead(413, { 'content-type': 'text/plain' })
    res.end('request body too large')
    return
  }
  const authority = request.headers.host ?? 'localhost'
  const headers = new Headers()
  for (const [key, value] of Object.entries(request.headers)) {
    if (value === undefined) continue
    if (HOP_BY_HOP.has(key.toLowerCase())) continue
    headers.set(key, Array.isArray(value) ? value.join(', ') : value)
  }
  const init: RequestInit = {
    method: request.method ?? 'GET',
    headers,
    ...(body.byteLength === 0 ? {} : { body: new Uint8Array(body) }),
  }
  let response: Response
  try {
    response = await handler.fetch(new Request(`http://${authority}${request.url ?? '/'}`, init))
  } catch (error) {
    res.writeHead(500, { 'content-type': 'text/plain' })
    res.end(error instanceof Error ? error.message : String(error))
    return
  }
  res.statusCode = response.status
  writeHeaders(response, res)
  const bytes = Buffer.from(await response.arrayBuffer())
  res.end(bytes)
}

/**
 * Answer one request with a plain status, used by the fence and the health probe.
 * @param res - the response to write.
 * @param status - the status code.
 * @param body - the response body.
 * @param contentType - the body's media type.
 */
export function answer(res: ServerResponse, status: number, body: string, contentType = 'text/plain; charset=utf-8'): void {
  res.writeHead(status, { 'content-type': contentType, 'cache-control': 'no-store' })
  res.end(body)
}
