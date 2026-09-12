/**
 * Typo detection for slash commands.
 *
 * A slash line that is not a registered command is a prompt — the host expands
 * `/name` as a skill invocation — so the suggestion has to fire only for a near
 * miss and stay silent for a genuine skill name.
 */
import { describe, expect, it } from 'vitest'
import { nearestCommand } from '../src/command-router.ts'

const COMMANDS = ['new', 'resume', 'sessions', 'help', 'status', 'model', 'effort', 'permission', 'quit', 'mcp', 'skills', 'copy', 'find']

describe('nearestCommand', () => {
  it('suggests the command behind a one-letter typo', () => {
    expect(nearestCommand('/statuss', COMMANDS)).toBe('status')
    expect(nearestCommand('/modell', COMMANDS)).toBe('model')
    expect(nearestCommand('/quti', COMMANDS)).toBe('quit')
  })

  it('stays silent when nothing is close', () => {
    expect(nearestCommand('/caveman', COMMANDS)).toBeUndefined()
    expect(nearestCommand('/some-skill-name', COMMANDS)).toBeUndefined()
    expect(nearestCommand('/ab', COMMANDS)).toBeUndefined()
  })

  it('does not suggest a command that was typed exactly', () => {
    expect(nearestCommand('/status', ['status'])).toBeUndefined()
  })
})
