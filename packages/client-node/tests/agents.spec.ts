import { describe, it, expect } from 'vitest'
import { createAgentTracker } from '../src/agents.ts'
import type { MuxFrame } from '@deepseek-ai/dsh-host-apiproxy/api'
import type { IApiClient } from '@deepseek-ai/dsh-host-apiproxy/client'

/** A client stub that answers the two reads the tracker performs. */
function fakeClient(options: {
  readonly items?: readonly Record<string, unknown>[]
  readonly orchestrator?: Record<string, unknown>
} = {}): IApiClient {
  return {
    sessions: {
      list: async () => ({
        result: { ok: true, value: { items: options.items ?? [] } },
      }),
    },
    settings: {
      describe: async () => ({
        result: {
          ok: true,
          value: {
            namespaces: options.orchestrator === undefined
              ? []
              : [{ ns: 'orchestrator', value: options.orchestrator }],
          },
        },
      }),
    },
  } as unknown as IApiClient
}

/** A session event frame for one session. */
function event(sessionId: string, type: string, data: Record<string, unknown> = {}): MuxFrame {
  return { type: 'session/event', sessionId, event: { type, data } } as unknown as MuxFrame
}

describe('agent tracking', () => {
  it('knows the subagents of the session and their depth', async () => {
    const tracker = createAgentTracker(fakeClient({
      items: [
        { sessionId: 'root' },
        { sessionId: 'child', parentSessionId: 'root', origin: 'subagent' },
        { sessionId: 'grand', parentSessionId: 'child', origin: 'subagent' },
        { sessionId: 'other', parentSessionId: 'somewhere-else' },
      ],
    }), { sessionId: 'root', model: 'kibborg/head' })
    await tracker.load()
    expect(tracker.owns('child')).toBe(true)
    expect(tracker.owns('grand')).toBe(true)
    expect(tracker.owns('other')).toBe(false)
    expect(tracker.of('child')?.depth).toBe(1)
    expect(tracker.of('grand')?.depth).toBe(2)
  })

  it('gives the head a role only while the orchestrator is on', async () => {
    const off = createAgentTracker(fakeClient(), { sessionId: 'root' })
    await off.load()
    expect(off.root().role).toBeUndefined()
    const on = createAgentTracker(fakeClient({
      orchestrator: { enabled: true, executorProvider: 'kibborg', executorModel: 'flash' },
    }), { sessionId: 'root' })
    await on.load()
    expect(on.root().role).toBe('ORCHESTRATOR')
  })

  it('names an executor child by the route it was pinned to', async () => {
    const tracker = createAgentTracker(fakeClient({
      items: [{ sessionId: 'child', parentSessionId: 'root', origin: 'subagent' }],
      orchestrator: { enabled: true, executorProvider: 'kibborg', executorModel: 'Kibborg_Flash_v5.7' },
    }), { sessionId: 'root' })
    await tracker.load()
    tracker.observe(event('child', 'request/header', { header: { config: { provider: 'kibborg', model: 'Kibborg_Flash_v5.7' } } }))
    const described = tracker.observe(event('child', 'subagent/descriptor', { label: 'посчитать файлы', mode: 'one-shot', agentProvider: 'kibborg', agentModel: 'Kibborg_Flash_v5.7' }))
    // The descriptor renames the child, so the surface redraws the heading it opened.
    expect(described?.renamed).toBe(true)
    expect(described?.agent.label).toBe('посчитать файлы')
    const tool = tracker.observe(event('child', 'tool/call', { name: 'bash' }))
    expect(tool?.agent.role).toBe('EXECUTOR')
    expect(tool?.agent.label).toBe('посчитать файлы')
    expect(tool?.agent.model).toBe('kibborg/Kibborg_Flash_v5.7')
    expect(tool?.agent.depth).toBe(1)
  })

  it('keeps a child\'s facts that arrive before the tree places it', async () => {
    const items: Record<string, unknown>[] = []
    const tracker = createAgentTracker(fakeClient({ items }), { sessionId: 'root' })
    await tracker.load()
    // The child is not in the listing yet, so this frame names no agent.
    expect(tracker.observe(event('child', 'subagent/descriptor', {
      label: 'посчитать файлы',
      agentProvider: 'kibborg',
      agentModel: 'Kibborg_Flash_v5.7',
    }))).toBeUndefined()
    items.push({ sessionId: 'child', parentSessionId: 'root', origin: 'subagent' })
    await tracker.load()
    const tool = tracker.observe(event('child', 'tool/call', { name: 'bash' }))
    expect(tool?.agent.label).toBe('посчитать файлы')
    expect(tool?.agent.model).toBe('kibborg/Kibborg_Flash_v5.7')
  })

  it('takes the name of a one-shot child from the delegation that started it', async () => {
    const tracker = createAgentTracker(fakeClient({
      items: [{ sessionId: 'child', parentSessionId: 'root', origin: 'subagent' }],
    }), { sessionId: 'root' })
    await tracker.load()
    tracker.hint('посчитать строки README')
    const tool = tracker.observe(event('child', 'tool/call', { name: 'bash' }))
    expect(tool?.agent.label).toBe('посчитать строки README')
  })

  it('keeps another session out of this run', async () => {
    const tracker = createAgentTracker(fakeClient({
      items: [{ sessionId: 'stranger', parentSessionId: 'elsewhere' }],
    }), { sessionId: 'root' })
    await tracker.load()
    expect(tracker.observe(event('stranger', 'tool/call', { name: 'bash' }))).toBeUndefined()
  })

  it('reports activity and the end of a child turn', async () => {
    const tracker = createAgentTracker(fakeClient({
      items: [{ sessionId: 'child', parentSessionId: 'root', origin: 'subagent' }],
    }), { sessionId: 'root' })
    await tracker.load()
    const activity = tracker.observe({ type: 'session/projection', sessionId: 'child', key: 'subagentActivity', value: { status: 'running', detail: 'grep' }, seq: 3 } as unknown as MuxFrame)
    expect(activity?.detail).toBe('grep')
    const end = tracker.observe(event('child', 'turn/end', { turn: 1, reason: { kind: 'completed' } }))
    expect(end?.finished).toBe(true)
    expect(tracker.observe(event('child', 'turn/end', { turn: 1 }))).toBeUndefined()
  })
})
