/**
 * PTY check of the palette and the nested lists it opens.
 *
 * The palette is the way in to every command a user does not remember, and a
 * command that needs one more decision opens a list of its own. This scenario
 * types into a real pseudo-terminal and asserts what the terminal showed: the
 * command list, the nested list with its way back, applying a choice, and
 * returning one level up.
 *
 * Usage: node Kibborg_CLI/tests/pty-menu.mjs [--boot-ms 60000]
 *
 * It exits 0 when every check matched, 1 otherwise, and always writes the
 * captured transcript to pty-menu.transcript.txt.
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
  console.error(`pty-menu: ${bin} is missing; build the CLI first (pnpm --dir Kibborg_CLI run build)`)
  process.exit(2)
}

const { spawn } = await import(pathToFileURL(resolveNodePty()).href)
const term = spawn(process.execPath, [bin], {
  name: 'xterm-256color',
  cols: 100,
  rows: 32,
  cwd: repo,
  env: { ...process.env, TERM: 'xterm-256color' },
})

let transcript = ''
term.onData(chunk => { transcript += chunk })

const sleep = ms => new Promise(r => setTimeout(r, ms))
const waitFor = async (needle, timeoutMs = 30000) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (transcript.includes(needle)) return true
    await sleep(250)
  }
  return transcript.includes(needle)
}

const checks = []
/** Type one line, wait for the text it should produce, and record the outcome. */
const typeAndExpect = async (line, expected, label) => {
  const before = transcript.length
  term.write(`${line}\r`)
  const ok = await waitFor(expected)
  checks.push({ label, ok, tail: transcript.slice(before).slice(0, 400) })
}

/** Send raw keys (no Enter appended) and wait for the text they should produce. */
const keysAndExpect = async (keys, expected, label) => {
  const before = transcript.length
  term.write(keys)
  const ok = await waitFor(expected)
  checks.push({ label, ok, tail: transcript.slice(before).slice(0, 400) })
}

await sleep(bootMs)
// The surface answers a command only once it owns the terminal, so the scenario
// waits for one real answer instead of trusting the boot budget alone.
let ready = false
for (let attempt = 0; attempt < 5 && !ready; attempt += 1) {
  term.write('/status\r')
  ready = await waitFor('cwd', 8000)
}
if (!ready) {
  console.error('pty-menu: the surface never answered a command; is the build current?')
  term.kill()
  process.exit(1)
}

await keysAndExpect('/', '/new', 'palette lists the new-session command')
await keysAndExpect('\u001B', 'shift+tab', 'palette closes')
// A nested list: its own title, a visible way back, and Enter applying the
// preselected real choice rather than the back row.
await typeAndExpect('/model', 'НАВИГАЦИЯ', 'model picker opens with a way back')
await keysAndExpect('\r', 'модель:', 'model picker applies the choice')
await typeAndExpect('/model', 'модель', 'model picker opens again')
await keysAndExpect('\u001B[A', 'НАВИГАЦИЯ', 'arrow reaches the back row')
await keysAndExpect('\r', 'commands', 'back row returns to the command palette')
await keysAndExpect('\u001B', 'shift+tab', 'palette closes after going back')

term.write('\u0004')
await sleep(2000)
term.kill()

const cleaned = transcript
  .replace(/\u001B\[[0-9;?]*[A-Za-z]/gu, '')
  .replace(/\r/gu, '')
writeFileSync(join(here, 'pty-menu.transcript.txt'), cleaned, 'utf8')

const failed = checks.filter(check => !check.ok)
for (const check of checks) console.log(`pty-menu: ${check.ok ? 'ok  ' : 'FAIL'} ${check.label}`)
if (failed.length > 0) {
  console.error(`pty-menu: FAIL (${failed.map(check => check.label).join(', ')})`)
  for (const check of failed) console.error(`pty-menu: ${check.label} saw:\n${check.tail}`)
  console.error(`pty-menu: transcript saved to ${join(here, 'pty-menu.transcript.txt')}`)
  process.exit(1)
}
console.log('pty-menu: OK — the palette listed its commands and the nested list had a way back')
