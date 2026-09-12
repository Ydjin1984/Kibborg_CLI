import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { defaultTranscriptPath, findInHistory, lastAssistantText, markdownOfHistory } from '../src/transcript.ts'

/** Build a user message event. */
function user(seq: number, text: string): SessionEvent {
  return { type: 'user/message', seq, time: seq, data: { content: [{ type: 'text', text }] } } as unknown as SessionEvent
}

/** Build an assistant message event. */
function assistant(seq: number, text: string): SessionEvent {
  return {
    type: 'assistant/message',
    seq,
    time: seq,
    data: { message: { content: [{ type: 'text', text }] }, turn: 0, step: 0 },
  } as unknown as SessionEvent
}

/** Build a tool call event. */
function toolCall(seq: number, name: string): SessionEvent {
  return { type: 'tool/call', seq, time: seq, data: { name, arguments: '{}', turn: 0, step: 0 } } as unknown as SessionEvent
}

const history: readonly SessionEvent[] = [
  user(1, 'проверь песочницу'),
  assistant(2, 'Проверил: запись разрешена.'),
  toolCall(3, 'read'),
]

describe('markdownOfHistory', () => {
  it('renders the title, both sides, and the tool list', () => {
    const markdown = markdownOfHistory(history, { title: 'Sandbox check', sessionId: 'session-1', now: 0 })

    expect(markdown).toContain('# Sandbox check')
    expect(markdown).toContain('## You')
    expect(markdown).toContain('проверь песочницу')
    expect(markdown).toContain('## Assistant')
    expect(markdown).toContain('## Tools')
    expect(markdown).toContain('- `read`')
    expect(markdown.endsWith('\n')).toBe(true)
  })

  it('falls back to the session id when the session has no title', () => {
    expect(markdownOfHistory([], { sessionId: 'session-1', now: 0 })).toContain('# session-1')
  })
})

describe('findInHistory', () => {
  it('matches case-insensitively and reports the side', () => {
    const matches = findInHistory(history, 'ПЕСОЧНИЦУ', 10)

    expect(matches).toHaveLength(1)
    expect(matches[0]?.role).toBe('you')
    expect(matches[0]?.seq).toBe(1)
    expect(matches[0]?.snippet).toContain('песочницу')
  })

  it('matches assistant text too', () => {
    expect(findInHistory(history, 'запись разрешена', 10)[0]?.role).toBe('assistant')
  })

  it('returns nothing for an empty query', () => {
    expect(findInHistory(history, '   ', 10)).toEqual([])
  })

  it('honours the match limit', () => {
    expect(findInHistory(history, 'е', 1)).toHaveLength(1)
  })
})

describe('lastAssistantText', () => {
  it('returns the newest answer', () => {
    expect(lastAssistantText([...history, assistant(4, 'Второй ответ')])).toBe('Второй ответ')
  })

  it('returns undefined when the log holds no answer', () => {
    expect(lastAssistantText([user(1, 'вопрос')])).toBeUndefined()
  })
})

describe('defaultTranscriptPath', () => {
  it('names the file after the session', () => {
    expect(defaultTranscriptPath('session-1')).toBe('kibborg-transcript-session-1.md')
  })
})
