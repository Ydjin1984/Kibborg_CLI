import { describe, expect, it } from 'vitest'
import { plainPalette } from '@kibborg/tui'
import { renderSessionHistory } from '../src/history-render.ts'

/** Minimal session event factory: only the fields the renderer reads. */
function event(type: string, data: Record<string, unknown>, seq: number, time: number): never {
  return { type, seq, time, data } as never
}

function sink() {
  let text = ''
  return { write: (chunk: string) => { text += chunk }, text: () => text }
}

describe('renderSessionHistory', () => {
  it('renders the user line, the answer, the tools and the turn footer', () => {
    const out = sink()
    renderSessionHistory([
      event('turn/start', { turn: 1 }, 0, 1_000),
      event('user/message', { role: 'user', content: [{ type: 'text', text: 'привет' }] }, 1, 1_100),
      event('tool/call', { turn: 1, step: 1, callId: 'c1', name: 'read', arguments: '{"path":"README.md"}' }, 2, 1_200),
      event('assistant/message', { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: 'готово' }] }, usage: { inputTokens: 100, outputTokens: 20 } }, 3, 3_000),
      event('turn/end', { turn: 1, reason: { kind: 'completed' } }, 4, 11_000),
    ], { palette: plainPalette, sink: out, cols: 100 })

    const text = out.text()
    // The task keeps its own marker and the time the log recorded for it.
    expect(text).toMatch(/  > привет {2}\d\d:\d\d/u)
    expect(text).toContain('read')
    expect(text).toContain('README.md')
    expect(text).toContain('  готово')
    expect(text).toContain('✔️')
    expect(text).toContain('10.0s')
  })

  it('never prints hidden reasoning', () => {
    const out = sink()
    renderSessionHistory([
      event('assistant/message', {
        turn: 1,
        step: 1,
        message: { role: 'assistant', content: [{ type: 'reasoning', text: 'внутренние рассуждения' }, { type: 'text', text: 'видимый ответ' }] },
      }, 1, 2_000),
    ], { palette: plainPalette, sink: out, cols: 100 })
    expect(out.text()).toContain('видимый ответ')
    expect(out.text()).not.toContain('внутренние рассуждения')
  })

  it('reports a failed tool result', () => {
    const out = sink()
    renderSessionHistory([
      event('tool/result', { turn: 1, step: 1, message: { role: 'tool', content: [] }, error: { name: 'exit-1', code: 'FAILED' } }, 1, 1_500),
    ], { palette: plainPalette, sink: out, cols: 100 })
    expect(out.text()).toContain('✗')
    expect(out.text()).toContain('exit-1')
  })
})
