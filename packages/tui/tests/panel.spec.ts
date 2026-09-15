import { describe, expect, it } from 'vitest'
import { columns, moveSelection, moveTab, panelLines, type PanelView } from '../src/panel.ts'
import { plainPalette } from '../src/tokens.ts'

const view: PanelView = {
  tabs: [
    { name: 'Skills', rows: ['name', '✔️ tdd', '· other'], hint: '[enter] show' },
    { name: 'MCP', rows: ['name', '✔️ context7'], hint: '[tab] next' },
  ],
  active: 0,
  selected: 1,
}

describe('panelLines', () => {
  it('draws a boxed header with the active tab bracketed', () => {
    const lines = panelLines(view, { palette: plainPalette, cols: 80 })

    expect(lines[0]).toContain('Kibborg')
    expect(lines[0]).toContain('[Skills]')
    expect(lines[0]).toContain('MCP')
    expect(lines[0]?.startsWith('┌')).toBe(true)
    expect(lines.at(-1)?.startsWith('└')).toBe(true)
  })

  it('marks the selected row and keeps the header row unpainted', () => {
    const lines = panelLines(view, { palette: plainPalette, cols: 80 }).join('\n')

    expect(lines).toContain('▸ ✔️ tdd')
    expect(lines).toContain('· other')
  })

  it('shows only the active tab rows', () => {
    const lines = panelLines(view, { palette: plainPalette, cols: 80 }).join('\n')

    expect(lines).not.toContain('context7')
    expect(lines).toContain('[enter] show')
  })

  it('elides rows past the visible limit', () => {
    const many: PanelView = {
      tabs: [{ name: 'Skills', rows: ['name', ...Array.from({ length: 30 }, (_, index) => `skill-${String(index)}`)], hint: 'hint' }],
      active: 0,
      selected: 1,
    }
    const lines = panelLines(many, { palette: plainPalette, cols: 80 }).join('\n')

    expect(lines).toContain('more')
    expect(lines).not.toContain('skill-29')
  })

  it('never exceeds the terminal width', () => {
    for (const line of panelLines(view, { palette: plainPalette, cols: 40 })) {
      expect(line.length).toBeLessThanOrEqual(38)
    }
  })
})

describe('moveSelection', () => {
  it('moves down inside the rows and stops at the last one', () => {
    expect(moveSelection(view, 1).selected).toBe(2)
    expect(moveSelection({ ...view, selected: 2 }, 1).selected).toBe(2)
  })

  it('never selects the header row', () => {
    expect(moveSelection({ ...view, selected: 1 }, -1).selected).toBe(1)
  })
})

describe('moveTab', () => {
  it('wraps forward and backwards', () => {
    expect(moveTab(view, 1).active).toBe(1)
    expect(moveTab({ ...view, active: 1 }, 1).active).toBe(0)
    expect(moveTab(view, -1).active).toBe(1)
  })
})

describe('columns', () => {
  it('pads names to one column', () => {
    const rows = columns([
      { mark: '✔️', name: 'a', detail: 'one' },
      { mark: '·', name: 'longer', detail: 'two' },
    ])

    expect(rows[0]).toBe('✔️ a       one')
    expect(rows[1]).toBe('· longer  two')
  })
})
