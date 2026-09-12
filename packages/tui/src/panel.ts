/**
 * The tabs modal (`UI.md` §4.9).
 *
 * Extensions open in one modal with tabs rather than one screen each, so the
 * surface needs a single renderer for it. The box is drawn the same way whether
 * the surface runs inline or fullscreen: the caller decides where the lines go.
 * Only the active tab's rows are drawn — the modal owns no scrolling, because
 * every tab it serves is short enough to list whole.
 * @module @kibborg/tui/panel
 */

import { displayWidth, padRight, takeHeadWidth } from './width.ts'
import type { Palette } from './tokens.ts'

/** One tab of the modal: its label, its rows, and the keys that act on a row. */
export interface PanelTab {
  /** Tab label shown in the header. */
  readonly name: string
  /** Rows of the active tab, already formatted; the first is the column header. */
  readonly rows: readonly string[]
  /** Keys line shown at the bottom while this tab is active. */
  readonly hint: string
}

/** What the modal shows right now. */
export interface PanelView {
  /** Tabs in header order. */
  readonly tabs: readonly PanelTab[]
  /** Index of the active tab. */
  readonly active: number
  /** Index of the selected row inside the active tab, or `-1` for none. */
  readonly selected: number
}

/** How wide the modal may grow before it uses the whole terminal. */
export const PANEL_MAX_WIDTH = 78

/** Rows one tab may print before the rest are elided. */
export const PANEL_MAX_ROWS = 14

/** Characters of the header title, before the tabs. */
const TITLE = 'Kibborg'

/** Build the header line: the title, then every tab with the active one bracketed. */
function header(view: PanelView, inner: number, palette: Palette): string {
  const parts = view.tabs.map((tab, index) => index === view.active
    ? palette.paint(`[${tab.name}]`, 'Accent')
    : palette.paint(tab.name, 'Muted'))
  const text = ` ${palette.paint(TITLE, 'Text')} ─ ${parts.join(' ')} `
  const clipped = takeHeadWidth(text, inner)
  return `┌${clipped}${'─'.repeat(Math.max(0, inner - displayWidth(clipped)))}┐`
}

/** Pad one body line to the modal width. */
function body(line: string, inner: number): string {
  const clipped = takeHeadWidth(line, inner)
  return `│${clipped}${' '.repeat(Math.max(0, inner - displayWidth(clipped)))}│`
}

/**
 * Render the modal.
 * @param view - the tabs and the current selection.
 * @param options - the active palette and the terminal width.
 * @returns the modal's lines, top border first.
 */
export function panelLines(view: PanelView, options: { readonly palette: Palette; readonly cols: number }): string[] {
  const { palette, cols } = options
  const width = Math.max(24, Math.min(PANEL_MAX_WIDTH, cols - 2))
  const inner = width - 2
  const lines = [header(view, inner, palette)]
  const tab = view.tabs[view.active]
  if (tab === undefined) {
    lines.push(body('  no tabs', inner))
  } else {
    const shown = tab.rows.slice(0, PANEL_MAX_ROWS)
    for (const [index, row] of shown.entries()) {
      const selected = index === view.selected
      const marker = selected ? palette.paint('▸', 'Accent') : ' '
      const text = index === 0 ? palette.paint(row, 'Muted') : row
      lines.push(body(` ${marker} ${text}`, inner))
    }
    if (tab.rows.length > shown.length) {
      lines.push(body(`   ${palette.paint(`… ${String(tab.rows.length - shown.length)} more`, 'Muted')}`, inner))
    }
    lines.push(body(`   ${palette.paint(tab.hint, 'Muted')}`, inner))
  }
  lines.push(`└${'─'.repeat(inner)}┘`)
  return lines
}

/**
 * Render the modal's content without its own frame.
 *
 * A surface that draws the modal inside a container of its own (the composed
 * inline app hands it to a request box) supplies the frame, so the tabs header,
 * the rows, and the hint are all it needs.
 * @param view - the tabs and the current selection.
 * @param options - the active palette and the terminal width.
 * @returns the header line, the active tab's rows, and the hint line.
 */
export function panelBodyLines(view: PanelView, options: { readonly palette: Palette; readonly cols: number }): string[] {
  const { palette, cols } = options
  const inner = Math.max(20, Math.min(PANEL_MAX_WIDTH, cols - 2) - 2)
  const parts = view.tabs.map((tab, index) => index === view.active
    ? palette.paint(`[${tab.name}]`, 'Accent')
    : palette.paint(tab.name, 'Muted'))
  const header = takeHeadWidth(` ${parts.join(' ')}`, inner)
  const tab = view.tabs[view.active]
  if (tab === undefined) return [header, '  no tabs']
  const shown = tab.rows.slice(0, PANEL_MAX_ROWS)
  const rows = shown.map((row, index) => {
    const marker = index === view.selected ? palette.paint('▸', 'Accent') : ' '
    const text = index === 0 ? palette.paint(row, 'Muted') : row
    return `${marker} ${text}`
  })
  const more = tab.rows.length > shown.length
    ? [`${palette.paint(`… ${String(tab.rows.length - shown.length)} more`, 'Muted')}`]
    : []
  return [header, ...rows, ...more, palette.paint(tab.hint, 'Muted')]
}

/**
 * Move the selection inside the active tab, clamped to its rows.
 * @param view - the current modal state.
 * @param delta - how many rows to move; negative moves up.
 * @returns the modal state with the selection moved.
 */
export function moveSelection(view: PanelView, delta: number): PanelView {
  const tab = view.tabs[view.active]
  const count = Math.min(tab?.rows.length ?? 0, PANEL_MAX_ROWS)
  if (count <= 1) return { ...view, selected: count === 0 ? -1 : 0 }
  const from = view.selected < 0 ? 0 : view.selected
  const next = Math.min(count - 1, Math.max(1, from + delta))
  return { ...view, selected: next }
}

/**
 * Switch to another tab, wrapping around.
 * @param view - the current modal state.
 * @param delta - how many tabs to move; negative moves backwards.
 * @returns the modal state with the new tab active and its selection reset.
 */
export function moveTab(view: PanelView, delta: number): PanelView {
  if (view.tabs.length === 0) return { ...view, active: 0, selected: -1 }
  const next = (view.active + delta + view.tabs.length) % view.tabs.length
  return { ...view, active: next, selected: 1 }
}

/**
 * Align rows as `marker name  detail` for the tabs that list named entries.
 * @param entries - the rows to format.
 * @returns one formatted row per entry.
 */
export function columns(entries: readonly { readonly mark: string; readonly name: string; readonly detail: string }[]): string[] {
  const width = entries.reduce((max, entry) => Math.max(max, displayWidth(entry.name)), 0)
  return entries.map(entry => `${entry.mark} ${padRight(entry.name, width)}  ${entry.detail}`)
}
