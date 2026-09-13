/**
 * Render one terminal frame to text and HTML.
 *
 * The TUI paints with ANSI cell updates, which a transcript cannot show: this
 * tool replays a real PTY session into a screen matrix and writes it twice —
 * `frame.txt` for reading and grep, `frame.html` for looking at the frame in a
 * browser, where a screenshot can be taken.
 *
 * Usage:
 *   node Kibborg_CLI/tests/frame-render.mjs [--boot-ms 45000] [--send "/status"]... [--cols 120] [--rows 34]
 */
import { readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '..', '..')
const bin = join(here, '..', 'apps', 'cli', 'lib', 'bin.js')

const argv = process.argv.slice(2)
const flag = (name, fallback) => {
  const index = argv.indexOf(name)
  return index === -1 ? fallback : argv[index + 1]
}
const sends = argv.reduce((all, value, index) => (value === '--send' ? [...all, argv[index + 1]] : all), [])
const keys = argv.reduce((all, value, index) => (value === '--keys' ? [...all, argv[index + 1]] : all), [])
const steps = argv.reduce((all, value, index) => (value === '--step' ? [...all, argv[index + 1]] : all), [])
const bootMs = Number(flag('--boot-ms', '45000'))
const cols = Number(flag('--cols', '120'))
const rows = Number(flag('--rows', '34'))

const store = join(repo, 'node_modules', '.pnpm')
const ptyEntry = readdirSync(store).find(name => name.startsWith('node-pty@'))
if (ptyEntry === undefined) throw new Error('node-pty is not installed in the pnpm store')
const { spawn } = await import(pathToFileURL(join(store, ptyEntry, 'node_modules', 'node-pty', 'lib', 'index.js')).href)

/** The eight ANSI colors the surface uses through 30–37 and 90–97. */
const ANSI = ['#1c1c1c', '#d16d6d', '#8fbf6f', '#d1c46d', '#6d8fd1', '#b06dd1', '#6dc4c4', '#d8d8d8']
const DEFAULT_FG = '#d8dee9'

const screen = Array.from({ length: rows }, () => Array.from({ length: cols }, () => ({ ch: ' ', fg: DEFAULT_FG })))
let raw = ''
let row = 0
let col = 0
let fg = DEFAULT_FG

const put = (ch) => {
  if (row < 0) row = 0
  if (row >= rows) row = rows - 1
  if (col < 0) col = 0
  if (col >= cols) {
    col = 0
    row = Math.min(rows - 1, row + 1)
  }
  screen[row][col] = { ch, fg }
  col += 1
}

const blank = () => ({ ch: ' ', fg: DEFAULT_FG })
const eraseLine = (mode) => {
  const line = screen[row]
  if (mode === 0) for (let i = col; i < cols; i += 1) line[i] = blank()
  else if (mode === 1) for (let i = 0; i <= col && i < cols; i += 1) line[i] = blank()
  else for (let i = 0; i < cols; i += 1) line[i] = blank()
}
const clearFrom = (fromRow) => {
  for (let r = fromRow; r < rows; r += 1) for (let c = 0; c < cols; c += 1) screen[r][c] = blank()
}

const eraseDisplay = (mode) => {
  if (mode === 2) {
    clearFrom(0)
    return
  }
  eraseLine(0)
  clearFrom(row + 1)
}

const sgr = (bodies) => {
  const codes = bodies.split(';').map(part => (part === '' ? 0 : Number(part)))
  for (let i = 0; i < codes.length; i += 1) {
    const code = codes[i] ?? 0
    if (code === 0 || code === 39) fg = DEFAULT_FG
    else if (code >= 30 && code <= 37) fg = ANSI[code - 30] ?? DEFAULT_FG
    else if (code >= 90 && code <= 97) fg = ANSI[code - 90] ?? DEFAULT_FG
    else if (code === 38 && codes[i + 1] === 5) {
      const index = codes[i + 2] ?? 0
      fg = index < 8 ? ANSI[index] ?? DEFAULT_FG : `hsl(${String((index * 37) % 360)}deg 45% 65%)`
      i += 2
    } else if (code === 38 && codes[i + 1] === 2) {
      fg = `rgb(${String(codes[i + 2] ?? 0)},${String(codes[i + 3] ?? 0)},${String(codes[i + 4] ?? 0)})`
      i += 4
    }
  }
}

const feed = (chunk) => {
  raw = (raw + chunk).slice(-200_000)
  let index = 0
  while (index < chunk.length) {
    const ch = chunk[index]
    if (ch === '\u001B') {
      const rest = chunk.slice(index)
      const match = /^\u001B\[(\??)([0-9;]*)([A-Za-z])/u.exec(rest)
      if (match === null) {
        index += 1
        continue
      }
      const [, privateMarker, body, final] = match
      const numbers = body.split(';').filter(part => part !== '').map(Number)
      const first = numbers[0] ?? 0
      if (final === 'm' && privateMarker === '') sgr(body)
      else if (final === 'H' && privateMarker === '') {
        row = Math.max(0, (numbers[0] ?? 1) - 1)
        col = Math.max(0, (numbers[1] ?? 1) - 1)
      } else if (final === 'A') row = Math.max(0, row - Math.max(1, first))
      else if (final === 'B') row = Math.min(rows - 1, row + Math.max(1, first))
      else if (final === 'C') col = Math.min(cols - 1, col + Math.max(1, first))
      else if (final === 'D') col = Math.max(0, col - Math.max(1, first))
      else if (final === 'G') col = Math.max(0, first - 1)
      else if (final === 'K' && privateMarker === '') eraseLine(first)
      else if (final === 'X' && privateMarker === '') {
        // Erase characters in place: the surface clears the tail of a row this
        // way, and without it stale glyphs survive into the rendered frame.
        const count = Math.max(1, first)
        for (let i = col; i < Math.min(cols, col + count); i += 1) screen[row][i] = blank()
      } else if (final === 'P' && privateMarker === '') {
        const count = Math.max(1, first)
        const line = screen[row]
        for (let i = col; i < cols; i += 1) line[i] = i + count < cols ? line[i + count] : blank()
      } else if (final === 'J' && privateMarker === '') eraseDisplay(first)
      index += match[0].length
      continue
    }
    if (ch === '\r') col = 0
    else if (ch === '\n') row = Math.min(rows - 1, row + 1)
    else if (ch === '\b') col = Math.max(0, col - 1)
    else if (ch === '\t') col = Math.min(cols - 1, col + (8 - (col % 8)))
    else if (ch >= ' ') put(ch)
    index += 1
  }
}

// The agent environment sets NO_COLOR, which would render every frame plain; a
// visual check wants the colors a user sees. TERM and COLORTERM are left alone:
// forcing TERM=xterm-256color changes the capability set the surface negotiates
// (mouse, bracketed paste, alternate screen) and drops input on this conpty.
const env = { ...process.env }
delete env.NO_COLOR

const term = spawn(process.execPath, [bin], {
  name: process.env.TERM === undefined || process.env.TERM === '' ? 'xterm-256color' : process.env.TERM,
  cols,
  rows,
  cwd: repo,
  env,
})
term.onData(feed)
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
// Boot cost varies with machine load, so the tool reports how long the opening
// screen took, but still waits the full budget: while the welcome screen is up
// the surface handles keys itself, and a command typed during that window is
// read as the screen's own key rather than as a submitted line.
const readyMarker = flag('--ready-marker', 'ctx ')
const startedAt = Date.now()
const deadline = startedAt + bootMs
while (Date.now() < deadline && !raw.includes(readyMarker)) await sleep(250)
const readyAfter = raw.includes(readyMarker) ? Date.now() - startedAt : null
if (readyAfter === null) {
  console.log(`frame-render: WARNING the surface did not report readiness within ${String(bootMs)} ms; keys may be lost`)
} else {
  console.log(`frame-render: surface ready after ${String(readyAfter)} ms, waiting the rest of ${String(bootMs)} ms`)
}
await sleep(Math.max(0, deadline - Date.now()))
await sleep(Number(flag('--settle-ms', '1500')))
// `--step` runs sends and keys in one interleaved order, which a scenario needs when
// a key belongs to a list a command just opened. Each step is either
// `send:<line>` (written with Enter) or `keys:<json string>` (raw keystrokes).
for (const step of steps) {
  if (step.startsWith('send:')) {
    term.write(`${step.slice('send:'.length)}\r`)
    await sleep(Number(flag('--after-send-ms', '2500')))
    continue
  }
  const raw = step.startsWith('keys:') ? step.slice('keys:'.length) : step
  term.write(JSON.parse(`"${raw}"`))
  await sleep(Number(flag('--after-key-ms', '1200')))
}
for (const send of sends) {
  term.write(`${send}\r`)
  // A submitted line may start a turn, so the wait after it is its own knob:
  // the default suits a slash command, a task needs the model's whole answer.
  await sleep(Number(flag('--after-send-ms', '2500')))
}
for (const rawKeys of keys) {
  // Keys arrive as JSON so a sequence like an arrow can be written in a shell
  // command without fighting either shell's own escaping.
  term.write(JSON.parse(`"${rawKeys}"`))
  await sleep(1200)
}
term.kill()

const lines = screen.map(line => line.map(cell => cell.ch).join('').replace(/\s+$/u, ''))
writeFileSync(join(here, 'frame.txt'), `${lines.join('\n')}\n`, 'utf8')

const escapeHtml = text => text.replace(/[&<>]/gu, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[ch])
const body = screen.map(line => {
  let html = ''
  let index = 0
  while (index < cols) {
    const color = line[index].fg
    let text = ''
    while (index < cols && line[index].fg === color) {
      text += line[index].ch
      index += 1
    }
    html += `<span style="color:${color}">${escapeHtml(text)}</span>`
  }
  return html.replace(/(<span style="color:[^"]+">\s+<\/span>)+$/u, '')
}).join('\n')

writeFileSync(join(here, 'frame.html'), `<!doctype html>
<meta charset="utf-8">
<title>Kibborg frame</title>
<style>
  body { margin: 0; background: #101418; }
  pre { margin: 0; padding: 18px; font: 14px/1.35 "Cascadia Mono", Consolas, "Courier New", monospace; color: ${DEFAULT_FG}; }
</style>
<pre>${body}</pre>
`, 'utf8')

const nonEmpty = lines.filter(line => line.trim() !== '')
const colors = new Set(screen.flat().map(cell => cell.fg))
writeFileSync(join(here, 'frame.raw.txt'), raw, 'utf8')
const sgrCount = (raw.match(/\u001B\[[0-9;]*m/gu) ?? []).length
console.log(`frame-render: wrote ${join(here, 'frame.txt')} and ${join(here, 'frame.html')}`)
console.log(`frame-render: ${String(nonEmpty.length)} non-empty rows, ${String(colors.size)} colors, ${String(sgrCount)} SGR sequences in ${String(raw.length)} raw bytes`)
console.log(nonEmpty.slice(0, 3).join('\n'))
