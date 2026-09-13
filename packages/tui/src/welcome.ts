/**
 * Welcome screen of the fullscreen surface.
 *
 * The wordmark is shown once, when the surface starts: the figlet block, the
 * animated band, the working context, the recent sessions of this directory, and
 * the action legend (`UI.md` §4.1). Below the wordmark's width threshold the
 * block collapses to the single brand line.
 * @module @kibborg/tui/welcome
 */

import type { Span, StyledLine } from './log.ts'
import { displayWidth, padRight, takeHeadWidth } from './width.ts'
import { bandWave } from './anim.ts'

/** One recent session of the working directory. */
export interface WelcomeRecent {
  /** Relative age, such as `2h`. */
  readonly age: string
  /** Recap title. */
  readonly title: string
  /** Trailing note, such as the pending work. */
  readonly note?: string
  /** Short session id. */
  readonly id: string
}

/** Everything the welcome screen displays. */
export interface WelcomeState {
  /** Surface version. */
  readonly version: string
  /** Working directory. */
  readonly cwd: string
  /** Active model. */
  readonly model: string
  /** Permission mode. */
  readonly mode: string
  /** Animation frame counter for the band. */
  readonly tick: number
  /** Recent sessions of this directory. */
  readonly recent: readonly WelcomeRecent[]
  /** Git branch, when the directory is a repository. */
  readonly branch?: string
  /** Whether the working tree has uncommitted changes. */
  readonly dirty?: boolean
  /** Lines added and removed in the working tree. */
  readonly changes?: { readonly added: number; readonly removed: number }
}

/** Columns below which the figlet block is replaced by the brand line. */
const WORDMARK_MIN_WIDTH = 72

/** The figlet wordmark, as `demo/kibborg-demo.bat` draws it. */
const WORDMARK: readonly string[] = [
  '██╗  ██╗██╗██████╗ ██████╗  ██████╗ ██████╗  ██████╗',
  '██║ ██╔╝██║██╔══██╗██╔══██╗██╔═══██╗██╔══██╗██╔════╝',
  '█████╔╝ ██║██████╔╝██████╔╝██║   ██║██████╔╝██║  ███╗',
  '██╔═██╗ ██║██╔══██╗██╔══██╗██║   ██║██╔══██╗██║   ██║',
  '██║  ██╗██║██████╔╝██████╔╝╚██████╔╝██║  ██║╚██████╔╝',
  '╚═╝  ╚═╝╚═╝╚═════╝ ╚═════╝  ╚═════╝ ╚═╝  ╚═╝ ╚═════╝',
]

/** The action legend of the welcome screen. */
const ACTIONS: readonly (readonly [string, string])[] = [
  ['[enter]', 'New session'],
  ['[f3]', 'Resume picker'],
  ['[ctrl+w]', 'Isolated worktree'],
  ['[ctrl+p]', 'Command palette'],
  ['[/]', 'Commands'],
]

/** One rotating hint, replaced by onboarding instead of `/help`. */
const TIPS: readonly string[] = [
  'Shift+Tab cycles Ask → Plan → Agent → YOLO',
  '/ opens the command palette; @ completes files',
  'Tab moves between the transcript and the prompt',
  'select text with the terminal itself; the mouse stays yours',
  'PgUp/PgDn page the transcript; Ctrl+Q leaves',
]

/** Build a line from a single styled span. */
function line(text: string, token: Span['token'], style: { bold?: boolean; dim?: boolean } = {}): StyledLine {
  return {
    spans: [{
      text,
      token,
      ...(style.bold === undefined ? {} : { bold: style.bold }),
      ...(style.dim === undefined ? {} : { dim: style.dim }),
    }],
  }
}

/**
 * Render the welcome screen.
 * @param state - session and directory context to display.
 * @param width - available columns.
 * @param height - available rows; the block is trimmed to fit.
 * @returns the styled lines of the screen.
 */
export function renderWelcome(state: WelcomeState, width: number, height: number): readonly StyledLine[] {
  const lines: StyledLine[] = []
  const wide = width >= WORDMARK_MIN_WIDTH

  lines.push({ spans: [] })
  if (wide) {
    for (const [index, row] of WORDMARK.entries()) {
      const token = index < 2 ? 'Shimmer' : index < 4 ? 'Accent' : 'Accent'
      lines.push(line(`  ${row}`, token, index >= 4 ? { dim: true } : {}))
    }
    const bandCells = Math.max(8, Math.min(24, width - 24))
    lines.push({
      spans: [
        { text: '  ', token: 'Muted' },
        { text: bandWave(state.tick, bandCells), token: 'Shimmer' },
        { text: `     ${state.version}`, token: 'Muted' },
      ],
    })
  } else {
    lines.push({ spans: [{ text: '  ◆ KIBBORG', token: 'Accent', bold: true }, { text: `  ${state.version}`, token: 'Muted' }] })
  }
  lines.push({ spans: [] })

  const context: Span[] = [
    { text: `  ${state.cwd}`, token: 'Text' },
    { text: '   ', token: 'Muted' },
  ]
  if (state.branch !== undefined) {
    context.push({ text: state.branch + (state.dirty === true ? '*' : ''), token: 'Warn' })
    context.push({ text: ' ', token: 'Muted' })
  }
  if (state.changes !== undefined) {
    context.push({ text: `+${String(state.changes.added)}`, token: 'Success' })
    context.push({ text: ' ', token: 'Muted' })
    context.push({ text: `~${String(state.changes.removed)}`, token: 'Error' })
    context.push({ text: '   ', token: 'Muted' })
  }
  context.push({ text: state.model, token: 'Text' })
  context.push({ text: '   ', token: 'Muted' })
  context.push({ text: state.mode, token: 'Accent' })
  lines.push({ spans: context })
  lines.push({ spans: [] })

  if (state.recent.length > 0) {
    lines.push(line('  Recent', 'Muted'))
    const recapWidth = Math.max(10, width - 20)
    for (const recent of state.recent.slice(0, 3)) {
      const recap = recent.note === undefined ? recent.title : `${recent.title} · ${recent.note}`
      const text = padRight(takeHeadWidth(recap, recapWidth), recapWidth)
      lines.push({
        spans: [
          { text: `    ${recent.age}  `, token: 'Muted' },
          { text, token: 'Text' },
          { text: recent.id, token: 'Subtle' },
        ],
      })
    }
    lines.push({ spans: [] })
  }

  for (const [key, label] of ACTIONS) {
    lines.push({
      spans: [
        { text: `  ${key.padEnd(9)}`, token: 'Accent' },
        { text: label, token: 'Text' },
      ],
    })
  }
  lines.push({ spans: [] })

  const tip = TIPS[Math.floor(state.tick / 45) % TIPS.length] ?? TIPS[0] ?? ''
  lines.push({
    spans: [
      { text: '  tip  ', token: 'Warn' },
      { text: takeHeadWidth(tip, Math.max(8, width - 8)), token: 'Muted' },
    ],
  })
  lines.push({ spans: [] })

  return lines.slice(0, Math.max(0, height))
}

/**
 * Whether a rendered line is wider than the region it will be drawn into.
 * @param rendered - the rendered welcome lines.
 * @param width - available columns.
 * @returns the offending width, or `null` when every line fits.
 */
export function overflowWidth(rendered: readonly StyledLine[], width: number): number | null {
  for (const rendered_line of rendered) {
    const used = rendered_line.spans.reduce((total, span) => total + displayWidth(span.text), 0)
    if (used > width) return used
  }
  return null
}
