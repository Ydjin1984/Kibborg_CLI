import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { formatTools, listTools } from '../src/tools-command.ts'

/** A context whose tool registry answers with the given schemas. */
function contextWith(schemas: readonly { readonly name: string; readonly description: string }[]): Context {
  return { get: () => ({ schemas: () => schemas }) } as unknown as Context
}

describe('listTools', () => {
  it('sorts the mounted tools by name and flattens their descriptions', () => {
    const tools = listTools(contextWith([
      { name: 'write', description: 'Write\n  a file' },
      { name: 'executor', description: 'Delegate work' },
    ]))

    expect(tools.map(tool => tool.name)).toEqual(['executor', 'write'])
    expect(tools[1]?.description).toBe('Write a file')
  })

  it('answers with nothing when the composition has no tool registry', () => {
    expect(listTools({ get: () => undefined } as unknown as Context)).toEqual([])
  })
})

describe('formatTools', () => {
  it('aligns the names and truncates a long description', () => {
    const lines = formatTools([
      { name: 'read', description: 'Read a file' },
      { name: 'executor', description: 'x'.repeat(200) },
    ]).join('')

    expect(lines).toContain('read')
    expect(lines).toContain('executor')
    expect(lines).toContain('…')
    expect(lines).not.toContain('x'.repeat(150))
  })

  it('says so when nothing is mounted', () => {
    expect(formatTools([]).join('')).toContain('no tools mounted')
  })
})
