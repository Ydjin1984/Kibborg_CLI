import { describe, expect, it } from 'vitest'
import { ADDRESSABLE_ROWS, buildToolOverlay } from '../src/tool-filter.ts'

describe('buildToolOverlay', () => {
  it('returns nothing when the invocation restricts no tools', () => {
    expect(buildToolOverlay({})).toBeUndefined()
    expect(buildToolOverlay({ tools: [], deny: [] })).toBeUndefined()
  })

  it('disables every addressable row outside the allow list', () => {
    const overlay = buildToolOverlay({ tools: ['read', 'grep'] }) ?? ''
    for (const row of ADDRESSABLE_ROWS) {
      const entry = `- id: ${row}`
      if (row === 'tool-fs' || row === 'tool-fs-search') {
        expect(overlay).not.toContain(`${entry}\n  disabled: true`)
        continue
      }
      expect(overlay).toContain(`${entry}\n  disabled: true`)
    }
  })

  it('disables one named tool and keeps the rest', () => {
    const overlay = buildToolOverlay({ deny: ['web_search'] }) ?? ''
    expect(overlay).toContain('- id: tool-web\n  disabled: true\n')
    expect(overlay).not.toContain('- id: tool-fs\n  disabled: true')
  })

  it('accepts a loader row name directly', () => {
    expect(buildToolOverlay({ deny: ['tool-terminal'] })).toContain('- id: tool-terminal\n  disabled: true\n')
  })

  it('lets an explicit allow win over a deny of the same row', () => {
    const overlay = buildToolOverlay({ tools: ['bash'], deny: ['bash'] })
    expect(overlay).toBeDefined()
    expect(overlay).not.toContain('- id: tool-bash\n  disabled: true')
  })
})
