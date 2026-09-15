import { describe, expect, it } from 'vitest'
import type { IApiClient } from '@deepseek-ai/dsh-host-apiproxy/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { formatPanelSnapshot, readPanelSnapshot, type PanelSnapshot } from '../src/panels.ts'

const snapshot: PanelSnapshot = {
  sessions: [
    { sessionId: 'session-aaaa1111', updatedAt: 2, title: 'Auth review', cwd: 'D:/repo' },
    { sessionId: 'session-bbbb2222', updatedAt: 1 },
  ],
  subagents: [
    { id: 'sub-1', kind: 'child', mode: 'spawn', activity: 'running', label: 'scan auth' },
    { id: 'sub-2', kind: 'diagnostic', reason: 'depth exceeded' },
  ],
  jobs: [{ id: 'job-1', label: 'pytest', done: false, raw: {} }],
  queue: [{ id: 'msg-1', placement: 'queued' } as never],
  goals: { status: 'active', text: 'ship K7' },
  todos: [
    { status: 'completed', content: 'panels data' },
    { status: 'in_progress', content: 'wire renderer' },
    { status: 'pending', content: 'docs' },
  ],
  context: {
    pressure: { projectedTokens: 12000, contextWindow: 131072 },
    breakdown: { system: 6000, tools: 3000 },
  },
  complete: true,
}

describe('formatPanelSnapshot', () => {
  it('lists sessions newest first with their title and cwd', () => {
    const lines = formatPanelSnapshot(snapshot, 'sessions')

    expect(lines[0]).toContain('session-aaaa1111')
    expect(lines[0]).toContain('Auth review')
    expect(lines[0]).toContain('D:/repo')
    expect(lines[1]).toContain('session-bbbb2222')
  })

  it('marks diagnostic subagents with their reason', () => {
    const lines = formatPanelSnapshot(snapshot, 'subagents').join('\n')

    expect(lines).toContain('spawn · running')
    expect(lines).toContain('diagnostic: depth exceeded')
  })

  it('shows whether a job is still running', () => {
    expect(formatPanelSnapshot(snapshot, 'jobs').join('\n')).toContain('running  pytest')
  })

  it('lists the queue with each item placement', () => {
    expect(formatPanelSnapshot(snapshot, 'queue').join('\n')).toContain('queued')
  })

  it('renders the context meters', () => {
    const lines = formatPanelSnapshot(snapshot, 'context').join('\n')

    expect(lines).toContain('context  12000 / 131072')
    expect(lines).toContain('system')
    expect(lines).toContain('6000')
  })

  it('renders the goal and the todo list with status marks', () => {
    expect(formatPanelSnapshot(snapshot, 'goals').join('')).toContain('ship K7')
    const todos = formatPanelSnapshot(snapshot, 'todos').join('\n')
    expect(todos).toContain('✔️ panels data')
    expect(todos).toContain('▸ wire renderer')
    expect(todos).toContain('· docs')
  })

  it('says so when a panel has nothing', () => {
    const empty: PanelSnapshot = {
      sessions: [], subagents: [], jobs: [], queue: [], goals: undefined, todos: undefined,
      context: {}, complete: false,
    }

    expect(formatPanelSnapshot(empty, 'sessions')[0]).toBe('no sessions')
    expect(formatPanelSnapshot(empty, 'subagents')[0]).toBe('no subagents')
    expect(formatPanelSnapshot(empty, 'jobs')[0]).toBe('no background jobs')
    expect(formatPanelSnapshot(empty, 'queue')[0]).toBe('queue is empty')
    expect(formatPanelSnapshot(empty, 'goals')[0]).toBe('no goal')
    expect(formatPanelSnapshot(empty, 'todos')[0]).toBe('no todos')
    expect(formatPanelSnapshot(empty, 'context')[0]).toBe('context  unknown')
  })
})

describe('readPanelSnapshot', () => {
  it('collects durable listings and the live mux baseline', async () => {
    const sessionId = 'session-live' as SessionId
    const frames = [
      { payload: { type: 'session/jobs', sessionId, jobs: [{ id: 'job-9', status: 'running' }] } },
      { payload: { type: 'session/queue', sessionId, items: [{ id: 'msg-9', placement: 'queued' }] } },
      { payload: { type: 'session/projection', sessionId, key: 'goal', value: { status: 'active', text: 'goal' } } },
      { payload: { type: 'session/projection', sessionId, key: 'todos', value: [{ status: 'pending', content: 'todo' }] } },
      { payload: { type: 'session/projection', sessionId, key: 'contextPressure', value: { projectedTokens: 10, contextWindow: 20 } } },
      { payload: { type: 'session/projection', sessionId, key: 'contextBreakdown', value: { system: 5 } } },
      { payload: { type: 'session/projection', sessionId, key: 'tokenUsage', value: { input: 1 } } },
    ]
    const client = {
      sessions: {
        list: async () => ({ result: { ok: true, value: { items: [{ sessionId: 'session-1', updatedAt: 5, blank: false, cwd: 'D:/repo' }] } } }),
      },
      subagents: {
        list: async () => ({ result: { ok: true, value: { parentAvailable: true, entries: [{ id: 'sub-1', kind: 'child', mode: 'spawn', activity: 'idle' }] } } }),
      },
      events: {
        mux: async function* () {
          for (const frame of frames) yield { rpcId: 'rpc', payload: frame.payload }
        },
      },
    } as unknown as IApiClient

    const collected = await readPanelSnapshot(client, sessionId, { timeoutMs: 50 })

    expect(collected.sessions).toHaveLength(1)
    expect(collected.sessions[0]?.cwd).toBe('D:/repo')
    expect(collected.subagents[0]?.mode).toBe('spawn')
    expect(collected.jobs[0]?.id).toBe('job-9')
    expect(collected.queue[0]?.placement).toBe('queued')
    expect(collected.goals).toEqual({ status: 'active', text: 'goal' })
    expect(collected.todos).toEqual([{ status: 'pending', content: 'todo' }])
    expect(collected.context.pressure).toEqual({ projectedTokens: 10, contextWindow: 20 })
    expect(collected.complete).toBe(true)
  })

  it('stays empty rather than failing when the host has no baseline', async () => {
    const client = {
      sessions: { list: async () => ({ result: { ok: false, error: { message: 'nope' } } }) },
      subagents: { list: async () => ({ result: { ok: false, error: { message: 'nope' } } }) },
      events: {
        // A real stream ends when the caller aborts; the stub has to honour the
        // signal the same way, or the collector would wait forever.
        mux: async function* (_payload: unknown, signal: AbortSignal) {
          await new Promise<void>(resolve => {
            if (signal.aborted) resolve()
            else signal.addEventListener('abort', () => { resolve() }, { once: true })
          })
        },
      },
    } as unknown as IApiClient

    const collected = await readPanelSnapshot(client, 'session-x' as SessionId, { timeoutMs: 30 })

    expect(collected.sessions).toEqual([])
    expect(collected.subagents).toEqual([])
    expect(collected.jobs).toEqual([])
    expect(collected.complete).toBe(false)
  })
})
