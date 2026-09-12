import { describe, expect, it } from 'vitest'
import { checkSchema, exitCodeOf, parseStructured } from '../src/headless.ts'
import type { TurnOutcome } from '../src/turn.ts'

/** Build a turn outcome with the fields the exit-code mapping reads. */
function outcome(kind: string): TurnOutcome {
  return { kind, tokens: 0, seconds: 0, tools: 0, contextPercent: 0, answer: '' }
}

describe('exitCodeOf', () => {
  it('maps a finished turn to 0', () => {
    expect(exitCodeOf(outcome('completed'))).toBe(0)
  })

  it('maps a failure to 1, an interruption to 130, and a question to 3', () => {
    expect(exitCodeOf(outcome('error'))).toBe(1)
    expect(exitCodeOf(outcome('aborted'))).toBe(130)
    expect(exitCodeOf(outcome('needs-input'))).toBe(3)
  })

  it('treats a spent turn budget as a stop the caller must notice', () => {
    expect(exitCodeOf(outcome('max-turns'))).toBe(1)
  })
})

describe('checkSchema', () => {
  it('accepts an object satisfying the required list', () => {
    expect(checkSchema({ status: 'ok' }, { type: 'object', required: ['status'] })).toBeUndefined()
  })

  it('reports a missing required field', () => {
    expect(checkSchema({ status: 'ok' }, { type: 'object', required: ['missing'] })).toContain('missing')
  })

  it('rejects a non-object when the schema asks for one', () => {
    expect(checkSchema('ok', { type: 'object' })).toContain('not a JSON object')
  })

  it('accepts anything when the schema states nothing it can enforce', () => {
    expect(checkSchema(42, {})).toBeUndefined()
    expect(checkSchema(42, null)).toBeUndefined()
  })
})

describe('parseStructured', () => {
  it('parses a plain JSON answer', () => {
    expect(parseStructured('{"status":"ok"}', undefined).value).toEqual({ status: 'ok' })
  })

  it('peels a markdown fence before parsing', () => {
    expect(parseStructured('```json\n{"status":"ok"}\n```', undefined).value).toEqual({ status: 'ok' })
  })

  it('reports invalid JSON instead of returning a value', () => {
    const parsed = parseStructured('not json at all', undefined)

    expect(parsed.value).toBeUndefined()
    expect(parsed.error).toContain('not valid JSON')
  })

  it('applies the schema after parsing', () => {
    expect(parseStructured('{"status":"ok"}', { type: 'object', required: ['missing'] }).error).toContain('missing')
  })
})
