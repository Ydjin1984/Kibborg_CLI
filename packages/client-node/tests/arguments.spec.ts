/**
 * Argument rendering of a tool call.
 *
 * A model sends a file body or a script as one JSON string with escaped newlines.
 * The transcript has to show it as readable lines, and the argument structure has
 * to stay visible around it.
 */
import { describe, expect, it } from 'vitest'
import { expandMultilineValues, prettyArguments } from '../src/arguments.ts'

describe('prettyArguments', () => {
  it('expands a multi-line value into real lines', () => {
    const call = prettyArguments(JSON.stringify({
      file_path: 'fix.ps1',
      content: '$a = 1\n$b = 2\nWrite-Output $a',
    }))
    expect(call).toBeDefined()
    const lines = (call ?? '').split('\n')
    expect(lines[0]).toBe('{')
    expect(lines.some(line => line.trim() === '"file_path": "fix.ps1",')).toBe(true)
    expect(lines.some(line => line.trim() === '"content":')).toBe(true)
    expect(lines).toContain('    $a = 1')
    expect(lines).toContain('    $b = 2')
    expect(lines).toContain('    Write-Output $a')
    expect(call).not.toContain('\\n')
  })

  it('keeps a single-line value on its own row', () => {
    const call = prettyArguments('{"file_path":"a.txt","offset":3}')
    expect(call).toBe('{\n  "file_path": "a.txt",\n  "offset": 3\n}')
  })

  it('keeps the original text when the arguments are not JSON', () => {
    expect(prettyArguments('ls -la | grep ts')).toBe('ls -la | grep ts')
    expect(prettyArguments('   ')).toBeUndefined()
  })

  it('leaves a value without newlines untouched', () => {
    expect(expandMultilineValues('{\n  "command": "npm test"\n}')).toBe('{\n  "command": "npm test"\n}')
  })
})
