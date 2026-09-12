import { describe, expect, it } from 'vitest'
import { absorbPacket, formatDiscovered, SERVICE_TYPE, txtOf, type DiscoveredServer } from '../src/mdns.ts'

describe('txtOf', () => {
  it('says whether a token is required', () => {
    expect(txtOf({ tokenRequired: true })).toEqual({ token: 'required' })
    expect(txtOf({ tokenRequired: false })).toEqual({ token: 'none' })
  })

  it('carries the version when one is advertised', () => {
    expect(txtOf({ tokenRequired: true, version: '0.1.0' })).toEqual({ token: 'required', version: '0.1.0' })
  })
})

describe('absorbPacket', () => {
  const instance = 'kibborg-test'
  const full = `${instance}.${SERVICE_TYPE}`

  it('assembles a server from the records of one packet', () => {
    const servers = new Map<string, DiscoveredServer>()
    absorbPacket(servers, {
      answers: [
        { name: SERVICE_TYPE, type: 'PTR', data: full },
        { name: full, type: 'SRV', data: { port: 7317, target: 'kibborg-host.local' } },
        { name: full, type: 'TXT', data: ['token=required', 'version=0.1.0'] },
        { name: 'kibborg-host.local', type: 'A', data: '10.0.0.7' },
      ],
    })

    const found = [...servers.values()][0]
    expect(found?.instance).toBe(instance)
    expect(found?.port).toBe(7317)
    expect(found?.host).toBe('kibborg-host.local')
    expect(found?.addresses).toEqual(['10.0.0.7'])
    expect(found?.tokenRequired).toBe(true)
    expect(found?.version).toBe('0.1.0')
  })

  it('folds records that arrive across several packets', () => {
    const servers = new Map<string, DiscoveredServer>()
    absorbPacket(servers, { answers: [{ name: SERVICE_TYPE, type: 'PTR', data: full }] })
    absorbPacket(servers, { answers: [
      { name: full, type: 'SRV', data: { port: 7318, target: 'host.local' } },
      { name: 'host.local', type: 'A', data: '10.0.0.8' },
    ] })
    absorbPacket(servers, { additionals: [{ name: full, type: 'TXT', data: [{ token: 'none' }] }] })

    const found = [...servers.values()][0]
    expect(found?.port).toBe(7318)
    expect(found?.addresses).toEqual(['10.0.0.8'])
    expect(found?.tokenRequired).toBe(false)
  })

  it('ignores records that belong to another service type', () => {
    const servers = new Map<string, DiscoveredServer>()
    absorbPacket(servers, { answers: [{ name: '_http._tcp.local', type: 'PTR', data: 'printer._http._tcp.local' }] })

    expect(servers.size).toBe(0)
  })
})

describe('formatDiscovered', () => {
  it('prints the address, port, and token state', () => {
    const text = formatDiscovered([{
      instance: 'kibborg-a',
      host: 'a.local',
      port: 7317,
      addresses: ['10.0.0.7'],
      tokenRequired: true,
    }]).join('')

    expect(text).toContain('kibborg-a')
    expect(text).toContain('http://10.0.0.7:7317')
    expect(text).toContain('token required')
  })

  it('says so when nothing answered', () => {
    expect(formatDiscovered([]).join('')).toContain('no kibborg servers answered')
  })
})
