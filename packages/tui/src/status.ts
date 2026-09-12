/**
 * Status line and turn footer of the terminal surface.
 *
 * The status line is the one row that never wraps: its composition is a
 * function of the terminal width, dropping the least important parts first
 * (`UI.md` §3 and §4.10). The footer reports what a finished turn cost.
 * @module @kibborg/tui/status
 */

import type { Palette, TokenName } from './tokens.ts'

/** Everything the status line can show. */
export interface StatusInput {
  /** Active model's display name. */
  readonly model: string
  /** Context window usage, 0–100. */
  readonly contextPercent: number
  /** Turn cost in dollars, when the deployment reports one. */
  readonly costUsd?: number
  /** Elapsed seconds of the current or last turn. */
  readonly turnSeconds?: number
  /** Current git branch, when the project is a repository. */
  readonly branch?: string
  /** Whether the worktree has uncommitted changes. */
  readonly dirty?: boolean
  /** Permission mode badge (Ask, Plan, Agent, YOLO). */
  readonly mode: string
  /** Terminal width in columns; decides which parts survive. */
  readonly cols: number
  /** Spinner glyph while the model is thinking; absent when the surface is idle. */
  readonly spinner?: string
  /** Token painting the spinner, which warms while the turn runs. */
  readonly spinnerToken?: TokenName
  /** Tokens the turn has moved so far, shown beside the elapsed time. */
  readonly tokens?: number
  /** Short hint appended while the line has room, such as how to interrupt. */
  readonly hint?: string
}

/**
 * The color of the thinking spinner for one animation tick.
 *
 * A running turn reads as motion: the glyph warms from amber through orange and
 * back, so a glance at the status line says whether the model is still working.
 * @param tick - frames advanced since the turn started.
 * @returns the token for this frame.
 */
export function thinkingToken(tick: number): TokenName {
  const phase = Math.floor(tick / 2) % 4
  if (phase === 0) return 'Warn'
  if (phase === 3) return 'Shimmer'
  return 'Orange'
}

/** Ten context cells: filled = round(10 × pct / 100), the rest empty. */
export function contextBar(percent: number, palette: Palette): string {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)))
  const filled = Math.round(10 * clamped / 100)
  return palette.paint('▓'.repeat(filled), 'Accent') + palette.paint('░'.repeat(10 - filled), 'Subtle')
}

/**
 * Format a token count compactly.
 * @param count - the number of tokens.
 * @returns `12.4k`, `980`, or `1.2M`.
 */
export function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`
  return String(count)
}

/**
 * Compose the status line for one terminal width.
 * @param input - the values to show.
 * @param palette - the active palette.
 * @returns one line, never wrapped.
 */
export function statusLine(input: StatusInput, palette: Palette): string {
  const separator = palette.paint(' · ', 'Subtle')
  const percent = String(Math.round(input.contextPercent))
  const model = input.spinner === undefined
    ? palette.paint(input.model, 'Text')
    : `${palette.paint(input.spinner, input.spinnerToken ?? 'Warn')} ${palette.paint(input.model, 'Text')}`
  const parts: string[] = [
    model,
    `${palette.paint('ctx ', 'Muted')}${palette.paint(`${percent}%`, 'Text')}`,
  ]
  if (input.cols >= 72) parts.push(contextBar(input.contextPercent, palette))
  if (input.cols >= 110 && input.costUsd !== undefined) {
    parts.push(palette.paint(`$${input.costUsd.toFixed(2)}`, 'Muted'))
  }
  if (input.cols >= 80 && input.turnSeconds !== undefined) {
    parts.push(palette.paint(`${input.turnSeconds.toFixed(1)}s`, 'Muted'))
  }
  if (input.cols >= 96 && input.tokens !== undefined) {
    parts.push(palette.paint(`${formatTokens(input.tokens)} tok`, 'Muted'))
  }
  if (input.cols >= 88 && input.branch !== undefined && input.branch !== '') {
    parts.push(palette.paint(input.dirty === true ? `${input.branch}*` : input.branch, 'Warn'))
  }
  parts.push(palette.paint(input.mode, 'Accent'))
  if (input.hint !== undefined && input.hint !== '' && input.cols >= 100) {
    parts.push(palette.paint(input.hint, 'Muted'))
  }
  return `  ${parts.join(separator)}`
}

/** What the footer reports about a finished turn. */
export interface FooterInput {
  /** Total tokens the turn moved through the meter. */
  readonly tokens: number
  /** Turn cost in dollars, when the deployment reports one. */
  readonly costUsd?: number
  /** Wall-clock seconds the turn took. */
  readonly seconds?: number
  /** Number of tool calls the turn made. */
  readonly tools?: number
  /** Lines added by the turn's edits. */
  readonly added?: number
  /** Lines removed by the turn's edits. */
  readonly removed?: number
}

/**
 * Compose the footer of a finished turn.
 * @param input - the turn's measurements; absent values are omitted.
 * @param palette - the active palette.
 * @returns one line: `✓  14.1k tok · $0.07 · 18.4s · 6 tools · +82/-11`.
 */
export function turnFooter(input: FooterInput, palette: Palette): string {
  const separator = palette.paint(' · ', 'Subtle')
  const parts: string[] = [
    `${palette.paint('✓', 'Success')}  ${palette.paint(`${formatTokens(input.tokens)} tok`, 'Text')}`,
  ]
  if (input.costUsd !== undefined) parts.push(palette.paint(`$${input.costUsd.toFixed(2)}`, 'Muted'))
  if (input.seconds !== undefined) parts.push(palette.paint(`${input.seconds.toFixed(1)}s`, 'Muted'))
  if (input.tools !== undefined) parts.push(palette.paint(`${String(input.tools)} tools`, 'Muted'))
  if (input.added !== undefined || input.removed !== undefined) {
    const added = palette.paint(`+${String(input.added ?? 0)}`, 'Success')
    const removed = palette.paint(`-${String(input.removed ?? 0)}`, 'Error')
    parts.push(`${added}/${removed}`)
  }
  return `  ${parts.join(separator)}`
}
