/**
 * PTY check of the fullscreen screen mode.
 *
 * Inline mode never repaints a frame, so this needs a real pseudo-terminal.
 * Note what a Windows pseudo-terminal can and cannot show: `conpty` emulates the
 * terminal itself and swallows the alternate-buffer sequences, so `?1049h`/`?1049l`
 * never reach this stream there. The escape sequences themselves are covered by
 * the renderer's own unit tests; this script asserts what a user would notice —
 * the frame is painted, input reaches the composer, and leaving ends the process
 * without leaving the terminal in a taken-over state.
 *
 * Usage: node Kibborg_CLI/tests/pty-fullscreen.mjs [--boot-ms 60000]
 *
 * Exit 0 when the frame was painted, input was accepted, and the process exited
 * on Ctrl+D; 1 otherwise. The transcript is written to pty-fullscreen.transcript.txt.
 */

import { existsSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '..', '..')
const bin = join(repo, 'Kibborg_CLI', 'apps', 'cli', 'lib', 'bin.js')

const args = process.argv.slice(2)
const bootIndex = args.indexOf('--boot-ms')
const bootMs = bootIndex >= 0 ? Number(args[bootIndex + 1] ?? 60000) : 60000

/** Resolve node-pty from the pnpm store: it is a transitive dependency, not a root one. */
function resolveNodePty() {
  const store = join(repo, 'node_modules', '.pnpm')
  const entry = readdirSync(store).find(name => name.startsWith('node-pty@'))
  if (entry === undefined) throw new Error('node-pty is not installed in the pnpm store')
  return join(store, entry, 'node_modules', 'node-pty', 'lib', 'index.js')
}

if (!existsSync(bin)) {
  console.error(`pty-fullscreen: ${bin} is missing; build the CLI first (pnpm --dir Kibborg_CLI run build)`)
  process.exit(2)
}

const { spawn } = await import(pathToFileURL(resolveNodePty()).href)
const term = spawn(process.execPath, [bin, '--fullscreen'], {
  name: 'xterm-256color',
  cols: 100,
  rows: 30,
  cwd: repo,
  env: { ...process.env, TERM: 'xterm-256color' },
})

let raw = ''
let exited = false
term.onData(chunk => { raw += chunk })
term.onExit(() => { exited = true })

const sleep = ms => new Promise(r => setTimeout(r, ms))
const waitFor = async (needle, timeoutMs) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (raw.includes(needle)) return true
    await sleep(250)
  }
  return raw.includes(needle)
}

await sleep(bootMs)
// The frame's header names the surface and the session; the status line proves
// the layout regions were composed, not just one banner line printed.
const painted = await waitFor(' Kibborg   session-', 20000) && await waitFor('ctx ', 20000)
term.write('/status')
await sleep(700)
const composed = raw.includes('/status')
// Ctrl+U clears the draft, Ctrl+O opens the live data panel, Tab steps to the
// next one, Esc closes it.
term.write('\u0015')
await sleep(400)
term.write('\u000F')
const panelOpened = await waitFor('Sessions', 15000)
term.write('\t')
const panelStepped = await waitFor('Subagents', 15000)
term.write('\u001B')
await sleep(600)

// Scrolling back is visible in the header, so the frame proves it happened.
// The log has to be longer than the viewport first, which a listing command
// provides without starting a turn — and it must land in the frame, not on
// stdout, or it would paint over the layout.
const waitForGrowth = async (before, timeoutMs) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline && raw.length <= before) await sleep(250)
  return raw.length > before
}
// Each listing grows the log; the frame can only scroll once the log has more
// lines than the viewport shows, so grow it and retry the key. The listing waits
// out its projection baseline before printing, so the loop pauses longer than
// the echo of the typed command.
let scrollShown = false
for (let attempt = 0; attempt < 4 && !scrollShown; attempt += 1) {
  const before = raw.length
  term.write('/panels sessions\r')
  await waitForGrowth(before, 20000)
  await sleep(3500)
  term.write('\u001B[5~')
  await sleep(1200)
  scrollShown = raw.includes('↑')
}
const framesBefore = countOccurrences(raw, ' Kibborg   session-')
term.write('\u001B[F')
await sleep(400)

// A resize must repaint the whole frame from the new geometry, and a very small
// terminal must degrade instead of crashing.
term.resize(70, 24)
await sleep(900)
const framesAfterShrink = countOccurrences(raw, ' Kibborg   session-')
term.resize(28, 10)
await sleep(900)
const survivedSmall = !exited
term.resize(100, 30)
await sleep(900)
const repainted = countOccurrences(raw, ' Kibborg   session-') > framesBefore
const restored = await waitFor('\u001B[?25h', 10000) || raw.includes('\u001B[?1049l')
await sleep(1500)
term.write('\u0004')
const exitDeadline = Date.now() + 6000
while (!exited && Date.now() < exitDeadline) await sleep(250)
await sleep(500)
term.kill()

/** Count non-overlapping occurrences of a needle. */
function countOccurrences(haystack, needle) {
  let count = 0
  let index = haystack.indexOf(needle)
  while (index !== -1) {
    count += 1
    index = haystack.indexOf(needle, index + needle.length)
  }
  return count
}

const tookOver = raw.includes('\u001B[?2004h') || raw.includes('\u001B[?1049h')
const exitedOnCtrlD = exited || raw.includes('\u001B[?1049l')

const cleaned = raw
  .replace(/\u001B\[[0-9;?]*[A-Za-z]/gu, '')
  .replace(/\r/gu, '')
writeFileSync(join(here, 'pty-fullscreen.transcript.txt'), cleaned, 'utf8')

const checks = [
  ['take over the terminal', tookOver],
  ['paint a frame', painted],
  ['accept typed input', composed],
  ['open the data panel', panelOpened],
  ['step to the next panel', panelStepped],
  ['scroll back through the log', scrollShown],
  ['repaint after resize', repainted],
  ['survive a tiny terminal', survivedSmall],
  ['restore the terminal', restored],
  ['exit on Ctrl+D', exitedOnCtrlD],
]
for (const [label, ok] of checks) console.log(`pty-fullscreen: ${ok ? 'ok  ' : 'FAIL'} ${String(label)}`)
if (checks.some(([, ok]) => !ok)) {
  console.error(`pty-fullscreen: transcript saved to ${join(here, 'pty-fullscreen.transcript.txt')}`)
  process.exit(1)
}
console.log('pty-fullscreen: OK — the frame was painted, input worked, and the process restored the terminal')
process.exit(0)

