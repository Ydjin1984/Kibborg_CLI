/**
 * Menus and dialogs of the fullscreen surface.
 *
 * Everything the surface asks the user to choose between is described here as
 * data plus a pure renderer: the slash palette with its groups and fuzzy filter
 * (`UI.md` §4.4), and the request boxes — permission, question, plan review,
 * resume picker, and the extensions modal (§4.5–§4.9). The caller draws the
 * frame around these rows, so the accent color stays a property of the request.
 * @module @kibborg/tui/menus
 */

import type { Span, StyledLine } from './log.ts'
import type { TokenName } from './tokens.ts'
import { displayWidth, padRight, takeHeadWidth } from './width.ts'

/** One palette entry. */
export interface MenuItem {
  /** Group heading the entry is listed under. */
  readonly group: string
  /** Command or skill name, including its prefix. */
  readonly name: string
  /** One-line description. */
  readonly desc: string
}

/** Palette state. */
export interface MenuState {
  /** The draft typed into the composer; the palette filters on it. */
  readonly query: string
  /** Index of the highlighted entry within the filtered list, or -1. */
  readonly selected: number
}

/** A rendered palette. */
export interface MenuView {
  /** Rows that go inside the frame. */
  readonly lines: readonly StyledLine[]
  /** Filtered entries, in display order. */
  readonly items: readonly MenuItem[]
  /** Highlighted index within {@link MenuView.items}, or -1 when empty. */
  readonly selected: number
}

/** A request box: its frame color, its label, and its rows. */
export interface DialogView {
  /** Accent color of the frame, chosen by the kind of action. */
  readonly token: TokenName
  /** Label written into the top border. */
  readonly label: string
  /** Rows that go inside the frame. */
  readonly lines: readonly StyledLine[]
  /**
   * Whether the arrows belong to the caller rather than to the box.
   *
   * Set for a box whose rows are a selection the caller maintains itself (the
   * tabs modal): the surface must pass `up`/`down` through instead of moving its
   * own highlight, or the selection never reaches the owner.
   */
  readonly passthroughArrows?: boolean
}

/**
 * Description and group of the commands the surface knows by name.
 *
 * The palette lists names, not keys: a key printed beside a command has to work
 * there, and a hint nobody implemented reads as a broken key rather than as a
 * shortcut the surface does not have.
 */
const COMMAND_META: Readonly<Record<string, { readonly group: string; readonly desc: string }>> = {
  new: { group: 'SESSION', desc: 'clear + fresh' },
  resume: { group: 'SESSION', desc: 'session picker' },
  sessions: { group: 'SESSION', desc: 'list sessions' },
  fork: { group: 'SESSION', desc: 'branch this session' },
  rename: { group: 'SESSION', desc: 'rename this session' },
  compact: { group: 'SESSION', desc: 'squeeze context' },
  home: { group: 'SESSION', desc: 'welcome screen' },
  quit: { group: 'SESSION', desc: 'leave the surface' },
  exit: { group: 'SESSION', desc: 'leave the surface' },
  model: { group: 'MODEL', desc: 'switch model' },
  effort: { group: 'MODEL', desc: 'reasoning depth' },
  status: { group: 'MODEL', desc: 'current settings' },
  plan: { group: 'MODE', desc: 'plan-only, no writes' },
  ask: { group: 'MODE', desc: 'read-only' },
  agent: { group: 'MODE', desc: 'write with approval' },
  yolo: { group: 'MODE', desc: 'always-approve' },
  permission: { group: 'MODE', desc: 'permission mode' },
  context: { group: 'CONTEXT', desc: 'context usage' },
  transcript: { group: 'CONTEXT', desc: 'save the transcript' },
  copy: { group: 'CONTEXT', desc: 'copy the last answer' },
  find: { group: 'CONTEXT', desc: 'search the transcript' },
  export: { group: 'CONTEXT', desc: 'export the session' },
  rewind: { group: 'CONTEXT', desc: 'drop the last turns' },
  init: { group: 'PROJECT', desc: 'write KIBBORG.md' },
  diff: { group: 'PROJECT', desc: 'unstaged + session edits' },
  review: { group: 'PROJECT', desc: 'review the working tree' },
  memory: { group: 'PROJECT', desc: 'project memory' },
  worktree: { group: 'PROJECT', desc: 'isolated worktree' },
  doctor: { group: 'SYS', desc: 'environment check' },
  logs: { group: 'SYS', desc: 'журнал действий и ошибок' },
  usage: { group: 'SYS', desc: 'token and cost usage' },
  theme: { group: 'SYS', desc: 'ice or mono' },
  config: { group: 'SYS', desc: 'settings file' },
  help: { group: 'SYS', desc: 'keys and commands' },
  tasks: { group: 'SYS', desc: 'background tasks' },
  goal: { group: 'SYS', desc: 'session goal' },
  panel: { group: 'SYS', desc: 'skills, MCP, hooks, plugins' },
  feedback: { group: 'SYS', desc: 'send feedback' },
  mcp: { group: 'EXT', desc: 'MCP servers' },
  skills: { group: 'EXT', desc: 'installed skills' },
  hooks: { group: 'EXT', desc: 'hook bridges' },
  plugins: { group: 'EXT', desc: 'mounted plugins' },
}

/** Order the palette lists groups in, matching `UI.md` §4.4. */
const GROUP_ORDER: readonly string[] = ['SESSION', 'MODEL', 'MODE', 'CONTEXT', 'PROJECT', 'SYS', 'EXT', 'OTHER']

/**
 * Build palette entries for the commands a surface registers.
 * @param names - command names, with or without their leading slash.
 * @returns entries sorted by group and name, with the description of each known command.
 */
export function commandMenuItems(names: readonly string[]): readonly MenuItem[] {
  const unique = [...new Set(names.map(raw => raw.replace(/^\//u, '')))]
  const items: MenuItem[] = unique.map(clean => {
    const meta = COMMAND_META[clean]
    return {
      group: meta?.group ?? 'OTHER',
      name: `/${clean}`,
      desc: meta?.desc ?? 'команда сессии',
    }
  })
  return items.sort((left, right) => {
    const group = GROUP_ORDER.indexOf(left.group) - GROUP_ORDER.indexOf(right.group)
    if (group !== 0) return group
    return left.name.localeCompare(right.name)
  })
}

/**
 * Whether a query matches text as a subsequence, case-insensitively.
 * @param text - the candidate text.
 * @param query - the typed query; an empty query matches everything.
 * @returns true when every query character appears in order.
 */
export function fuzzyMatch(text: string, query: string): boolean {
  if (query === '') return true
  let cursor = 0
  const lower = text.toLowerCase()
  for (const character of query.toLowerCase()) {
    const found = lower.indexOf(character, cursor)
    if (found === -1) return false
    cursor = found + 1
  }
  return true
}

/**
 * Filter palette entries by the typed query.
 * @param items - every entry.
 * @param query - the draft, with or without its leading slash.
 * @returns the entries whose name matches as a subsequence or whose description contains the query.
 */
export function filterMenu(items: readonly MenuItem[], query: string): readonly MenuItem[] {
  const cleaned = query.trim().replace(/^\//u, '')
  if (cleaned === '') return items
  const lower = cleaned.toLowerCase()
  return items.filter(item => fuzzyMatch(item.name, cleaned) || item.desc.toLowerCase().includes(lower))
}

/**
 * Render the palette rows.
 * @param items - every entry.
 * @param state - the query and the highlighted index.
 * @param width - the width available inside the frame.
 * @returns the rows, the filtered entries, and the highlighted index.
 */
export function renderMenu(items: readonly MenuItem[], state: MenuState, width: number): MenuView {
  const filtered = filterMenu(items, state.query)
  const selected = filtered.length === 0 ? -1 : ((state.selected % filtered.length) + filtered.length) % filtered.length
  const lines: StyledLine[] = []
  const query = state.query.trim().replace(/^\//u, '')

  let lastGroup = ''
  for (const [index, item] of filtered.entries()) {
    if (item.group !== lastGroup) {
      if (lines.length > 0) lines.push({ spans: [] })
      lastGroup = item.group
      lines.push({ spans: [{ text: `   ${item.group}`, token: 'Muted' }] })
    }
    const active = index === selected
    // The name column fits the longest entry in view, so a long model id never
    // runs into its description; the description then takes what is left.
    const nameWidth = Math.max(10, Math.min(28, filtered.reduce((max, entry) => Math.max(max, displayWidth(entry.name)), 0) + 2))
    const descWidth = Math.max(8, width - nameWidth - 5)
    const desc = padRight(takeHeadWidth(item.desc, descWidth), descWidth)
    const spans: Span[] = [
      { text: active ? ' ▸ ' : '   ', token: active ? 'Accent' : 'Muted' },
      ...nameSpans(item.name, query, nameWidth),
      { text: desc, token: 'Muted' },
    ]
    lines.push({ spans: fit(spans, width) })
  }

  if (filtered.length === 0) lines.push({ spans: [{ text: '   нет совпадений', token: 'Muted' }] })
  return { lines, items: filtered, selected }
}

/** The entry name with the matched run highlighted, padded to a fixed width. */
function nameSpans(name: string, query: string, width: number): readonly Span[] {
  const hit = query === '' ? -1 : name.toLowerCase().indexOf(query.toLowerCase())
  if (hit === -1) return [{ text: padRight(name, width), token: 'Text' }]
  const head = name.slice(0, hit)
  const match = name.slice(hit, hit + query.length)
  const tail = name.slice(hit + query.length)
  const used = displayWidth(head) + displayWidth(match) + displayWidth(tail)
  return [
    { text: head, token: 'Text' },
    { text: match, token: 'Accent', bold: true },
    { text: padRight(tail, Math.max(0, width - (used - displayWidth(tail)))), token: 'Text' },
  ]
}

/** Cut spans to a column budget. */
function fit(spans: readonly Span[], width: number): readonly Span[] {
  const out: Span[] = []
  let used = 0
  for (const span of spans) {
    if (used >= width) break
    let text = span.text
    if (displayWidth(text) > width - used) text = takeHeadWidth(text, width - used)
    if (text === '') continue
    used += displayWidth(text)
    out.push({ ...span, text })
  }
  return out
}

/** One row of a request box. */
function row(text: string, token: TokenName = 'Text', style: { bold?: boolean; dim?: boolean } = {}): StyledLine {
  return {
    spans: [{
      text,
      token,
      ...(style.bold === undefined ? {} : { bold: style.bold }),
      ...(style.dim === undefined ? {} : { dim: style.dim }),
    }],
  }
}

/** A row built from several styled runs. */
function runs(spans: readonly Span[]): StyledLine {
  return { spans }
}

/** The permission request, with the frame color of the action it guards. */
export interface PermissionInput {
  /** Tool about to run. */
  readonly tool: string
  /** What it will act on. */
  readonly target: string
  /** Preview lines, such as a diff. */
  readonly preview?: readonly string[]
  /** Whether the action destroys data, which focuses `deny`. */
  readonly destructive?: boolean
}

/**
 * Build the permission box.
 * @param input - the request to describe.
 * @returns the rows and the frame color for this request.
 */
export function permissionDialog(input: PermissionInput): DialogView {
  const token: TokenName = input.destructive === true
    ? 'Error'
    : input.tool === 'bash' || input.tool === 'shell'
      ? 'BashPink'
      : 'Accent'
  const lines: StyledLine[] = []
  for (const preview of (input.preview ?? []).slice(0, 8)) {
    lines.push(row(preview, preview.startsWith('+') ? 'Success' : preview.startsWith('-') ? 'Error' : 'Text'))
  }
  if (lines.length > 0) lines.push({ spans: [] })
  if (input.destructive === true) {
    lines.push(row('destructive-действие: фокус по умолчанию на [n]', 'Error'))
  }
  lines.push(runs([
    { text: '[y] once', token: input.destructive === true ? 'Muted' : 'Accent' },
    { text: '   ', token: 'Muted' },
    { text: '[n] deny', token: 'Error' },
    { text: '   ', token: 'Muted' },
    { text: '[esc]', token: 'Muted' },
  ]))
  return { token, label: `Allow ${input.tool}  ${input.target}`, lines }
}

/** One question of a batch. */
export interface QuestionInput {
  /** Question text. */
  readonly question: string
  /** Position in the batch, one-based. */
  readonly index: number
  /** Total questions in the batch. */
  readonly total: number
  /** Answer options. */
  readonly options: readonly QuestionOptionInput[]
  /** Highlighted option, or the free-text row when it equals `options.length`. */
  readonly selected: number
  /** Whether several options may be chosen. */
  readonly multi?: boolean
  /** Options already chosen in multi-select mode. */
  readonly chosen?: readonly number[]
  /** Free-text answer being typed, shown on the `Свой ответ` row. */
  readonly typed?: string
}

/** One answer a question offers, as the box draws it. */
export interface QuestionOptionInput {
  /** Short name of the answer. */
  readonly label: string
  /** Explanation shown beside the name. */
  readonly description?: string
}

/**
 * Build the question box.
 *
 * The shape follows the question card of the reference CLIs: a numbered row per
 * answer with its explanation, a row of its own for a typed answer, and the keys
 * that work written under them. The number is what the user reads, so a batch of
 * questions is answered without moving the hands off the top row of the keyboard.
 * @param input - the question to describe.
 * @returns the rows; the frame is `PermLav` because a question waits on a decision.
 */
export function questionDialog(input: QuestionInput): DialogView {
  const lines: StyledLine[] = [row(input.question, 'Text')]
  lines.push({ spans: [] })
  const width = input.options.reduce(
    (max, option) => Math.max(max, displayWidth(option.label)),
    0,
  )
  for (const [index, option] of input.options.entries()) {
    const active = index === input.selected
    const chosen = input.chosen?.includes(index) === true
    const mark = input.multi === true ? (chosen ? '◉' : '○') : active ? '●' : '○'
    lines.push(runs([
      { text: `${String(index + 1)} `, token: active ? 'Accent' : 'Muted' },
      { text: `(${mark}) `, token: chosen || active ? 'Accent' : 'Subtle' },
      { text: option.label, token: 'Text', ...(active ? { bold: true } : {}) },
      { text: ' '.repeat(Math.max(1, width - displayWidth(option.label) + 3)), token: 'Muted' },
      { text: option.description ?? '', token: 'Muted', dim: true },
    ]))
  }
  const typing = input.selected === input.options.length
  const typed = input.typed ?? ''
  lines.push(runs([
    { text: 'z ', token: typing ? 'Accent' : 'Muted' },
    { text: typing ? '(◉) ' : '(○) ', token: typing ? 'Accent' : 'Subtle' },
    { text: 'Свой ответ', token: 'Text', ...(typing ? { bold: true } : {}) },
    { text: typing && typed !== '' ? `   ${typed}` : '   наберите текст и нажмите Enter', token: 'Muted', dim: typing && typed !== '' },
  ]))
  lines.push({ spans: [] })
  lines.push(row(
    input.multi === true
      ? '[↑↓] выбор   [space] отметить   [enter] подтвердить   [esc] отменить'
      : '[↑↓] выбор   [1-9] выбрать сразу   [z] свой ответ   [enter] подтвердить   [esc] отменить',
    'Muted',
  ))
  return { token: 'PermLav', label: `Вопрос ${String(input.index)}/${String(input.total)}`, lines }
}

/**
 * Build the plan review box.
 * @param steps - the plan steps, in order.
 * @returns the rows; editing is refused until the plan is approved.
 */
export function planReviewDialog(steps: readonly string[]): DialogView {
  const lines: StyledLine[] = steps.map((step, index) => row(`${String(index + 1)}. ${step}`, 'Text'))
  lines.push({ spans: [] })
  lines.push(runs([
    { text: '[e] edit', token: 'Accent' },
    { text: '   ', token: 'Muted' },
    { text: '[enter] approve & execute', token: 'Accent' },
    { text: '   ', token: 'Muted' },
    { text: '[esc] reject', token: 'Error' },
  ]))
  return { token: 'PermLav', label: 'Plan review', lines }
}

/** One resumable session row. */
export interface ResumeRow {
  /** Short session id. */
  readonly id: string
  /** Relative age. */
  readonly age: string
  /** Recap title. */
  readonly title: string
  /** Branch or worktree marker. */
  readonly place: string
  /** Mode in force when the session was left. */
  readonly mode: string
  /** Model of the session. */
  readonly model: string
  /** Trailing state, such as `pending tests`. */
  readonly state: string
}

/**
 * Build the resume picker box.
 * @param rows - sessions to choose from.
 * @param selected - highlighted row.
 * @returns the rows; the picker is a navigable list, not a prompt for text.
 */
export function resumeDialog(rows: readonly ResumeRow[], selected: number): DialogView {
  const lines: StyledLine[] = []
  for (const [index, item] of rows.entries()) {
    const active = index === selected
    lines.push(runs([
      { text: active ? ' ▸ ' : '   ', token: active ? 'Accent' : 'Muted' },
      { text: `${item.id}  `, token: 'Text' },
      { text: `${item.age}  `, token: 'Muted' },
      { text: item.title, token: 'Text' },
    ]))
    lines.push(runs([
      { text: '       ', token: 'Muted' },
      { text: `${item.place}  `, token: 'Warn' },
      { text: `${item.mode}  `, token: 'Accent' },
      { text: `${item.model}  `, token: 'Muted' },
      { text: item.state, token: 'Muted', dim: true },
    ]))
  }
  lines.push({ spans: [] })
  lines.push(row('enter resume   ctrl+f fork   d delete   / find', 'Muted'))
  return { token: 'Subtle', label: 'Resume session', lines }
}

/**
 * Build the extensions modal box.
 * @param tabs - tab names; the active one is drawn in the accent color.
 * @param rows - rows of the active tab.
 * @param selected - highlighted row.
 * @param activeTab - index of the active tab.
 * @returns the rows with a tab strip on the first line.
 */
export function modalDialog(
  tabs: readonly string[],
  rows: readonly string[],
  selected: number,
  activeTab: number,
): DialogView {
  const strip: Span[] = []
  tabs.forEach((tab, index) => {
    if (index > 0) strip.push({ text: ' ', token: 'Muted' })
    strip.push(index === activeTab
      ? { text: `[${tab}]`, token: 'Accent' }
      : { text: tab, token: 'Muted' })
  })
  const lines: StyledLine[] = [runs(strip), { spans: [] }]
  for (const [index, text] of rows.entries()) {
    lines.push(runs([
      { text: index === selected ? ' ▸ ' : '   ', token: index === selected ? 'Accent' : 'Muted' },
      { text, token: 'Text' },
    ]))
  }
  lines.push({ spans: [] })
  lines.push(row('[enter] открыть  [space] enable/disable  [v] версии  [esc] выход', 'Muted'))
  return { token: 'Subtle', label: 'Kibborg', lines }
}
