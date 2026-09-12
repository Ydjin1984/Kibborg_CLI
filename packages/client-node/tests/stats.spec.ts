import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { formatStats, summarizeHistory } from '../src/stats.ts'

/** Build one session event of the given type with its data. */
function event(type: string, seq: number, time: number, data: unknown): SessionEvent {
  return { type, seq, time, data } as unknown as SessionEvent
}

const log: readonly SessionEvent[] = [
  event('turn/start', 1, 1000, { turn: 0 }),
  event('step/start', 2, 1010, { turn: 0, step: 0 }),
  event('user/message', 3, 1015, { content: [{ type: 'text', text: 'hi' }] }),
  event('tool/call', 4, 1020, { name: 'read', arguments: '{}', turn: 0, step: 0 }),
  event('tool/result', 5, 1030, { error: { name: 'Error' }, turn: 0, step: 0 }),
  event('assistant/message', 6, 1040, {
    message: { content: [{ type: 'text', text: 'done' }] },
    usage: { inputTokens: 100, outputTokens: 20 },
    turn: 0,
    step: 0,
  }),
  event('turn/end', 7, 1050, { turn: 0, reason: { kind: 'completed' } }),
  event('turn/start', 8, 2000, { turn: 1 }),
  event('step/start', 9, 2010, { turn: 1, step: 0 }),
  event('assistant/chunk', 10, 2020, { chunk: { type: 'usage', usage: { inputTokens: 50, outputTokens: 5 } }, turn: 1, step: 0 }),
  event('turn/end', 11, 2100, { turn: 1, reason: { kind: 'completed' } }),
]

describe('summarizeHistory', () => {
  it('counts turns, steps, messages, tools, and failures', () => {
    const stats = summarizeHistory(log)

    expect(stats.turns).toBe(2)
    expect(stats.steps).toBe(2)
    expect(stats.userMessages).toBe(1)
    expect(stats.assistantMessages).toBe(1)
    expect(stats.tools).toBe(1)
    expect(stats.toolErrors).toBe(1)
  })

  it('sums usage once per step across chunk and message carriers', () => {
    const stats = summarizeHistory(log)

    expect(stats.inputTokens).toBe(150)
    expect(stats.outputTokens).toBe(25)
  })

  it('reports the largest step, which is what the live footer shows', () => {
    expect(summarizeHistory(log).peakStepTokens).toBe(120)
  })

  it('reports both the turn time and the whole span', () => {
    const stats = summarizeHistory(log)

    expect(stats.turnSeconds).toBeCloseTo(0.15, 5)
    expect(stats.seconds).toBeCloseTo(1.1, 5)
  })

  it('reports zeros for an empty log', () => {
    expect(summarizeHistory([])).toMatchObject({ turns: 0, steps: 0, tools: 0, inputTokens: 0, outputTokens: 0, peakStepTokens: 0, seconds: 0 })
  })
})

describe('formatStats', () => {
  it('names the session and prints every measure', () => {
    const text = formatStats(summarizeHistory(log), { sessionId: 'session-1', title: 'Smoke' }).join('')

    expect(text).toContain('Smoke')
    expect(text).toContain('session-1')
    expect(text).toContain('turns         2')
    expect(text).toContain('150 in, 25 out')
  })

  it('falls back to the id when the session has no title', () => {
    expect(formatStats(summarizeHistory([]), { sessionId: 'session-1' }).join('')).toContain('session-1')
  })
})
