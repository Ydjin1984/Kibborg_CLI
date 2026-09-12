/**
 * mDNS publication and discovery for `kibborg serve`.
 *
 * A server on a local network is reachable by name if it says so once, which is
 * what multicast DNS is for: the operator runs `kibborg discover`, gets the
 * `host:port` of every Kibborg server on the link, and attaches. Discovery only
 * finds a server — it never carries a token, and the record says whether one is
 * required, so a client still has to be given the secret out of band.
 *
 * The record shape is deliberately conventional: a PTR under
 * `_kibborg._tcp.local` pointing at `<instance>._kibborg._tcp.local`, an SRV
 * with the port and target host, a TXT with `token=required|none` and
 * `version=…`, and an A record for the address to use.
 * @module @kibborg/server/mdns
 */

import { hostname, networkInterfaces } from 'node:os'
import multicastDns from 'multicast-dns'

/** One DNS record as this module reads it; the parser's own types are wider. */
interface DnsRecordLike {
  readonly name: string
  readonly type: string
  readonly data?: unknown
}

/** One received packet, reduced to the fields discovery folds. */
interface DnsPacketLike {
  readonly questions?: readonly { readonly name: string; readonly type: string }[]
  readonly answers?: readonly DnsRecordLike[]
  readonly additionals?: readonly DnsRecordLike[]
}

/** The service type every Kibborg server publishes under. */
export const SERVICE_TYPE = '_kibborg._tcp.local'

/** One Kibborg server found on the link. */
export interface DiscoveredServer {
  /** Instance name, unique per host. */
  readonly instance: string
  /** Host name the SRV record points at. */
  readonly host: string
  /** Port the API listens on. */
  readonly port: number
  /** Addresses advertised for that host, if any were. */
  readonly addresses: readonly string[]
  /** Whether the server requires a token. */
  readonly tokenRequired: boolean
  /** Protocol version the server advertises. */
  readonly version?: string
}

/** What a server publishes about itself. */
export interface PublishOptions {
  /** Instance name; defaults to `kibborg-<hostname>`. */
  readonly instance?: string
  /** Port the API listens on. */
  readonly port: number
  /** Whether the deployment requires a token. */
  readonly tokenRequired: boolean
  /** Addresses to advertise; defaults to the addresses mDNS discovers itself. */
  readonly addresses?: readonly string[]
  /** Protocol version string. */
  readonly version?: string
}

/** The TXT record one publication carries. */
export function txtOf(options: { readonly tokenRequired: boolean; readonly version?: string }): Record<string, string> {
  return {
    token: options.tokenRequired ? 'required' : 'none',
    ...(options.version === undefined ? {} : { version: options.version }),
  }
}

/** The instance name a publication uses when the caller names none. */
export function defaultInstance(): string {
  return `kibborg-${hostname().split('.')[0] ?? 'host'}`
}

/**
 * The non-internal IPv4 addresses of this machine.
 * @returns the addresses to advertise in the mDNS record.
 */
export function localAddresses(): readonly string[] {
  const found: string[] = []
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === 'IPv4' && address.internal !== true) found.push(address.address)
    }
  }
  return found
}

/** Read one TXT record back into the flags a client cares about. */
function flagsOf(txt: unknown): { tokenRequired: boolean; version?: string } {
  const entries = Array.isArray(txt) ? txt : []
  const map = new Map<string, string>()
  for (const entry of entries) {
    if (typeof entry === 'string') {
      const equals = entry.indexOf('=')
      if (equals > 0) map.set(entry.slice(0, equals), entry.slice(equals + 1))
    } else if (entry !== null && typeof entry === 'object') {
      for (const [key, value] of Object.entries(entry as Record<string, string>)) map.set(key, value)
    }
  }
  const version = map.get('version')
  return {
    tokenRequired: map.get('token') !== 'none',
    ...(version === undefined ? {} : { version }),
  }
}

/**
 * Fold one mDNS packet into the set of servers seen so far.
 *
 * Records for one instance arrive across several packets (PTR, then SRV, then A
 * and TXT), so the fold is stateful: every call may complete a server that an
 * earlier packet only hinted at.
 * @param servers - the accumulated servers, keyed by instance.
 * @param packet - one received packet.
 * @returns nothing; the map is updated in place.
 */
export function absorbPacket(servers: Map<string, DiscoveredServer>, packet: DnsPacketLike): void {
  const records = [...(packet.answers ?? []), ...(packet.additionals ?? [])]
  const addresses = new Map<string, string[]>()
  for (const record of records) {
    if (record.type !== 'A' || typeof record.data !== 'string') continue
    addresses.set(record.name.toLowerCase(), [...(addresses.get(record.name.toLowerCase()) ?? []), record.data])
  }
  for (const record of records) {
    if (record.type === 'PTR' && typeof record.data === 'string' && record.data.toLowerCase().endsWith(SERVICE_TYPE)) {
      const instance = record.data.slice(0, record.data.toLowerCase().indexOf(`.${SERVICE_TYPE}`))
      if (!servers.has(instance)) {
        servers.set(instance, { instance, host: '', port: 0, addresses: [], tokenRequired: true })
      }
      continue
    }
    if (record.type !== 'SRV' || typeof record.data !== 'object' || record.data === null) continue
    const data = record.data as { target?: string; port?: number }
    const instance = record.name.slice(0, record.name.toLowerCase().indexOf(`.${SERVICE_TYPE}`))
    const previous = servers.get(instance) ?? { instance, host: '', port: 0, addresses: [], tokenRequired: true }
    servers.set(instance, {
      ...previous,
      host: data.target ?? previous.host,
      port: data.port ?? previous.port,
      addresses: addresses.get((data.target ?? '').toLowerCase()) ?? previous.addresses,
    })
  }
  for (const record of records) {
    if (record.type !== 'TXT') continue
    const instance = record.name.slice(0, record.name.toLowerCase().indexOf(`.${SERVICE_TYPE}`))
    const previous = servers.get(instance)
    if (previous === undefined) continue
    servers.set(instance, { ...previous, ...flagsOf(record.data) })
  }
}

/**
 * Advertise this server on the local link.
 * @param options - the instance name, port, and what the record should say.
 * @returns the handle that stops advertising.
 */
export function publishService(options: PublishOptions): { readonly close: () => void } {
  const mdns = multicastDns()
  const instance = options.instance ?? defaultInstance()
  const fullName = `${instance}.${SERVICE_TYPE}`
  const target = `${defaultInstance()}.local`
  const txt = txtOf(options)
  const answers = () => [
    { name: SERVICE_TYPE, type: 'PTR' as const, data: fullName, ttl: 120 },
    { name: fullName, type: 'SRV' as const, data: { port: options.port, target, priority: 0, weight: 0 }, ttl: 120 },
    { name: fullName, type: 'TXT' as const, data: Object.entries(txt).map(([key, value]) => `${key}=${value}`), ttl: 120 },
    ...(options.addresses ?? []).map(address => ({ name: target, type: 'A' as const, data: address, ttl: 120 })),
  ]
  mdns.on('query', (query: DnsPacketLike) => {
    const asks = (query.questions ?? []).some(question =>
      question.name.toLowerCase() === SERVICE_TYPE || question.name.toLowerCase() === fullName)
    if (asks) mdns.respond({ answers: [...answers()] })
  })
  // Announce on start and refresh well inside the TTL, so a server that is up
  // stays discoverable without waiting for the next query.
  const announce = (): void => { mdns.respond({ answers: [...answers()] }) }
  announce()
  const timer = setInterval(announce, 60_000)
  timer.unref()
  return { close: () => { clearInterval(timer); mdns.destroy() } }
}

/**
 * Discover Kibborg servers on the local link.
 * @param options - how long to listen before answering.
 * @returns every server that answered, newest information per instance.
 */
export async function discoverServers(options: { readonly timeoutMs: number }): Promise<readonly DiscoveredServer[]> {
  const mdns = multicastDns({ reuseAddr: true })
  const servers = new Map<string, DiscoveredServer>()
  mdns.on('response', (packet: DnsPacketLike) => { absorbPacket(servers, packet) })
  await new Promise<void>((resolve) => {
    mdns.query({ questions: [{ name: SERVICE_TYPE, type: 'PTR' }] })
    const timer = setTimeout(resolve, options.timeoutMs)
    timer.unref()
  })
  mdns.destroy()
  return [...servers.values()].filter(server => server.port !== 0)
}

/**
 * Render discovered servers as aligned text.
 * @param servers - what discovery found.
 * @returns one line per server.
 */
export function formatDiscovered(servers: readonly DiscoveredServer[]): string[] {
  if (servers.length === 0) return ['  no kibborg servers answered on this link\n']
  return servers.map(server => {
    const address = server.addresses[0] ?? server.host
    const token = server.tokenRequired ? 'token required' : 'no token'
    return `  ${server.instance}  http://${address}:${String(server.port)}  (${token})\n`
  })
}
