import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { lastAssistantMessageId } from '../src/message-feedback.ts'

/** Build an assistant message event with a stable id. */
function assistant(seq: number, id: string): SessionEvent {
  return {
    type: 'assistant/message',
    seq,
    time: seq,
    data: { message: { id, content: [{ type: 'text', text: 'answer' }] }, turn: 0, step: 0 },
  } as unknown as SessionEvent
}

/** Build a user message event. */
function user(seq: number): SessionEvent {
  return { type: 'user/message', seq, time: seq, data: { content: [{ type: 'text', text: 'question' }] } } as unknown as SessionEvent
}

describe('lastAssistantMessageId', () => {
  it('returns the newest answer id', () => {
    const events = [user(1), assistant(2, 'm1'), user(3), assistant(4, 'm2')]
    expect(lastAssistantMessageId(events)).toBe('m2')
  })

  it('skips assistant events without an id', () => {
    const events = [assistant(1, ''), assistant(2, 'm2')]
    expect(lastAssistantMessageId(events)).toBe('m2')
  })

  it('returns undefined when the log holds no answer', () => {
    expect(lastAssistantMessageId([user(1)])).toBeUndefined()
    expect(lastAssistantMessageId([])).toBeUndefined()
  })
})
