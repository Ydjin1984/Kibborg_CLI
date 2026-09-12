import { describe, expect, it } from 'vitest'
import { completeDraft, completionHint } from '../src/completion.ts'

const sources = {
  commands: ['help', 'status', 'model', 'mcp', 'skills'],
  files: ['Kibborg_CLI/PLAN.md', 'Kibborg_CLI/README.md', 'packages/core/session/src/index.ts'],
  sessions: ['session-abc', 'session-def'],
}

describe('completeDraft', () => {
  it('completes a unique command and leaves the cursor after the name', () => {
    expect(completeDraft('/he', sources).draft).toBe('/help')
  })

  it('lists every match and leaves an ambiguous draft alone', () => {
    const result = completeDraft('/m', sources)

    expect(result.draft).toBe('/m')
    expect(result.candidates).toEqual(['mcp', 'model'])
    expect(result.active).toBe(true)
  })

  it('completes a file path after an at-sign and adds a separating space', () => {
    expect(completeDraft('look at @Kibborg_CLI/PLAN', sources).draft).toBe('look at @Kibborg_CLI/PLAN.md ')
  })

  it('matches file paths case-sensitively, unlike names', () => {
    expect(completeDraft('@kibborg_cli/', sources).candidates).toEqual([])
  })

  it('completes a session reference after a hash', () => {
    expect(completeDraft('#session-a', sources).draft).toBe('#session-abc ')
  })

  it('leaves an unprefixed draft to the caller', () => {
    const result = completeDraft('hello', sources)

    expect(result.active).toBe(false)
    expect(result.draft).toBe('hello')
  })

  it('reports an active prefix with no match instead of completing', () => {
    const result = completeDraft('/zzz', sources)

    expect(result.active).toBe(true)
    expect(result.candidates).toEqual([])
    expect(result.draft).toBe('/zzz')
  })

  it('completes only the last token, keeping the text before it', () => {
    expect(completeDraft('run /sk', sources).draft).toBe('run /skills')
  })
})

describe('completionHint', () => {
  it('renders the matches on one line', () => {
    expect(completionHint(['mcp', 'model'])).toBe('mcp  model')
  })

  it('elides the overflow past the limit', () => {
    expect(completionHint(['a', 'b', 'c'], 2)).toBe('a  b  (+1 more)')
  })

  it('renders nothing when there is nothing to show', () => {
    expect(completionHint([])).toBe('')
  })
})
