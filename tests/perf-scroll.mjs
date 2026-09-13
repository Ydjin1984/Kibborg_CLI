/**
 * Measure what one frame costs while the reader scrolls a long transcript.
 *
 * The complaint this answers is "scrolling up and down lags". A terminal scrolling
 * gesture becomes a stream of arrow keys, and every key repaints a frame, so the
 * number that matters is the cost of one frame on a long log — not the cost of the
 * whole session.
 *
 * Usage: node Kibborg_CLI/tests/perf-scroll.mjs [--entries 2000] [--width 100] [--rows 30]
 */
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const lib = join(here, '..', 'packages', 'tui', 'lib', 'index.js')
const { createLog, renderTranscript, createApp, plainPalette, displayWidth } = await import(pathToFileURL(lib).href)

const argv = process.argv.slice(2)
const flag = (name, fallback) => {
  const index = argv.indexOf(name)
  return index === -1 ? fallback : Number(argv[index + 1])
}
const entries = flag('--entries', 2000)
const width = flag('--width', 100)
const rows = flag('--rows', 30)

/** A transcript shaped like a real session: prompts, answers, tool calls, branches. */
function fill(count) {
  const log = createLog()
  const answer = Array.from({ length: 12 }, (_, index) => `строка ответа ${String(index)} с текстом`).join('\n')
  for (let index = 0; index < count; index += 1) {
    const kind = index % 5
    if (kind === 0) log.append({ kind: 'user', text: `задача ${String(index)} — посмотри файл и посчитай строки` })
    else if (kind === 1) log.append({ kind: 'assistant', text: answer })
    else if (kind === 2) log.append({ kind: 'tool', text: 'README.md', name: 'read', status: 'ok', title: 'Читает README.md', output: answer })
    else if (kind === 3) log.append({ kind: 'thought', text: '', durationMs: 2200 })
    else log.append({ kind: 'tool', text: 'go test ./...', name: 'bash', status: 'ok', title: 'Запускает go test ./...', detail: ['ok  engine-go', 'FAIL cmd'] })
  }
  return log
}

const log = fill(entries)
console.log(`entries: ${String(log.entries.length)}`)

/** Time one operation, in milliseconds, as the median of several runs. */
function time(label, run, runs = 7) {
  const samples = []
  for (let index = 0; index < runs; index += 1) {
    const started = process.hrtime.bigint()
    run(index)
    samples.push(Number(process.hrtime.bigint() - started) / 1e6)
  }
  samples.sort((left, right) => left - right)
  const median = samples[Math.floor(samples.length / 2)]
  const worst = samples[samples.length - 1]
  console.log(`${label}: median ${median.toFixed(2)} ms, worst ${worst.toFixed(2)} ms`)
  return median
}

// One transcript render with the reader standing in the same place: the cache holds.
time('renderTranscript (same selection)', () => {
  renderTranscript(log.entries, width, { version: log.version, selectedId: 3 })
})

// The same render while the selection moves: this is what a scroll step costs.
let selection = 1
time('renderTranscript (selection moves)', () => {
  selection = (selection + 7) % log.entries.length
  renderTranscript(log.entries, width, { version: log.version, selectedId: selection })
})

// A whole frame through the surface, including the cell buffer and the terminal diff.
let written = 0
const fake = {
  columns: width,
  rows,
  isTTY: true,
  write: chunk => { written += chunk.length },
  on: () => {},
  off: () => {},
  once: () => {},
  removeListener: () => {},
  removeAllListeners: () => {},
  setRawMode: () => {},
  resume: () => {},
  pause: () => {},
}
const app = createApp({
  stdout: fake,
  stdin: fake,
  palette: plainPalette,
  version: 'v0.1.0',
  cwd: '/work',
  status: { model: 'm', mode: 'Agent', contextPercent: 10 },
  caps: { altScreen: true, mouse: false, trueColor: false, syncOutput: true, bracketedPaste: true, interactive: true },
})
for (const entry of log.entries) app.log.append(entry)
app.start()
app.render()
written = 0
time('createApp.render (idle)', () => { app.render() }, 5)
written = 0
const step = time('createApp.render (arrow step)', index => {
  app.handleKey({ kind: index % 2 === 0 ? 'up' : 'down' })
}, 10)
console.log(`bytes written while stepping: ${String(written)} (${(written / 10).toFixed(0)} per step)`)
console.log(`rows pushed per frame: roughly ${String(Math.round(step))} ms of work`)
app.stop()

// Sanity: the frame really did contain the transcript, not an empty screen.
console.log(`frame width used: ${String(displayWidth(' '.repeat(Math.min(width, 40))))}`)
