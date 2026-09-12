/**
 * PTY check of the surface's own slash commands and completion.
 *
 * These paths only exist on a terminal: `/status`, `/help`, `/mcp`, and `/skills`
 * are answered by the local router without opening a turn, and Tab completes the
 * draft in place inside the lower zone. This script types each one into a real
 * pseudo-terminal and asserts what the terminal showed.
 *
 * Usage: node Kibborg_CLI/tests/pty-commands.mjs [--boot-ms 60000]
 *
 * It exits 0 when every check matched, 1 otherwise, and always writes the
 * captured transcript to pty-commands.transcript.txt.
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
  console.error(`pty-commands: ${bin} is missing; build the CLI first (pnpm --dir Kibborg_CLI run build)`)
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

/** Type one line and wait for the text it should produce. */
const checks = []
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
await typeAndExpect('/status', 'permission', 'status')
await typeAndExpect('/help', 'skills', 'help')
await typeAndExpect('/mcp', 'context7', 'mcp')
// Tab completion happens in the composer, so the line is never submitted: a
// submitted `/ski` would be a prompt (a skill name) and would start a turn.
await keysAndExpect('/ski\t', '/skills', 'completion')
// The composer legend is translated with the rest of the surface, so the check
// reads the legend marker, not the English wording.
await keysAndExpect('\u0015', 'команды', 'composer cleared')
await typeAndExpect('/find zzz-nothing-matches', 'no matches', 'find')
await typeAndExpect('/transcript', 'wrote', 'transcript')
await typeAndExpect('/copy', 'no answer to copy', 'copy')
await typeAndExpect('/panel', '[Skills]', 'panel opens')
await keysAndExpect('\t', '[MCP]', 'panel tab switches')
await keysAndExpect('\u001B', 'shift+tab', 'panel closes')
await keysAndExpect('/stat\t', '/status', 'composer works after the modal')

term.write('\u0004')
await sleep(2000)
term.kill()

const cleaned = transcript
  .replace(/\u001B\[[0-9;?]*[A-Za-z]/gu, '')
  .replace(/\r/gu, '')
writeFileSync(join(here, 'pty-commands.transcript.txt'), cleaned, 'utf8')
console.log(cleaned.split('\n').slice(-30).join('\n'))

const failed = checks.filter(check => !check.ok)
for (const check of checks) console.log(`pty-commands: ${check.ok ? 'ok  ' : 'FAIL'} ${check.label}`)
if (failed.length > 0) {
  console.error(`pty-commands: FAIL (${failed.map(check => check.label).join(', ')})`)
  for (const check of failed) console.error(`pty-commands: ${check.label} saw:\n${check.tail}`)
  console.error(`pty-commands: transcript saved to ${join(here, 'pty-commands.transcript.txt')}`)
  process.exit(1)
}
console.log('pty-commands: OK — the local commands answered and Tab completed the draft')
process.exit(0)
