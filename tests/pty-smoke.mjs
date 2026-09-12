/**
 * PTY smoke test of the interactive surface.
 *
 * A terminal is the one thing a unit test cannot fake: raw mode, key decoding,
 * in-place redrawing of the lower zone, and the Ctrl+C/Ctrl+D contract all need
 * a real pseudo-terminal. This script runs the built CLI inside one, types a
 * task, waits for the turn, then leaves with Ctrl+D and asserts what the
 * terminal actually showed.
 *
 * Usage: node Kibborg_CLI/tests/pty-smoke.mjs [--task "text"] [--boot-ms 60000]
 *
 * It exits 0 when the transcript contains the user line and the turn footer,
 * 1 otherwise, and always prints the captured transcript.
 */

import { existsSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '..', '..')
const bin = join(repo, 'Kibborg_CLI', 'apps', 'cli', 'lib', 'bin.js')

const args = process.argv.slice(2)
const taskIndex = args.indexOf('--task')
const task = taskIndex >= 0 ? (args[taskIndex + 1] ?? 'скажи одно слово: тест') : 'скажи одно слово: тест'
const bootIndex = args.indexOf('--boot-ms')
const bootMs = bootIndex >= 0 ? Number(args[bootIndex + 1] ?? 60000) : 60000
/** Lines typed before the task, for setups such as enabling plan mode. */
const pre = args.reduce((collected, value, index) => (value === '--pre' ? [...collected, args[index + 1] ?? ''] : collected), [])
/** Text typed when the surface asks a question (option number or free text). */
const answerIndex = args.indexOf('--answer')
const answer = answerIndex >= 0 ? args[answerIndex + 1] : undefined

/** Resolve node-pty from the pnpm store: it is a transitive dependency, not a root one. */
function resolveNodePty() {
  const store = join(repo, 'node_modules', '.pnpm')
  const entry = readdirSync(store).find(name => name.startsWith('node-pty@'))
  if (entry === undefined) throw new Error('node-pty is not installed in the pnpm store')
  return join(store, entry, 'node_modules', 'node-pty', 'lib', 'index.js')
}

if (!existsSync(bin)) {
  console.error(`pty-smoke: ${bin} is missing; build the CLI first (pnpm --dir Kibborg_CLI run build)`)
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
const waitFor = async (needle, timeoutMs) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (transcript.includes(needle)) return true
    await sleep(500)
  }
  return transcript.includes(needle)
}

await sleep(bootMs)
for (const line of pre) {
  term.write(`${line}\r`)
  await sleep(4000)
}
term.write(`${task}\r`)
// A question or an approval shows up before the turn can finish: answer it when
// the caller supplied an answer, otherwise wait for the turn footer directly.
if (answer !== undefined) {
  const asked = await waitFor('type an option number', 180000)
  if (asked) term.write(`${answer}\r`)
}
const answered = await waitFor('✓', 180000)
term.write('\u0004')
await sleep(3000)
term.kill()

const cleaned = transcript
  .replace(/\u001B\[[0-9;?]*[A-Za-z]/gu, '')
  .replace(/\r/gu, '')
writeFileSync(join(here, 'pty-smoke.transcript.txt'), cleaned, 'utf8')
console.log(cleaned.split('\n').slice(-24).join('\n'))

const sawUser = cleaned.includes('You')
const sawStatus = cleaned.includes('ctx ')
if (!answered || !sawUser || !sawStatus) {
  console.error(`pty-smoke: FAIL (answered=${String(answered)} user=${String(sawUser)} status=${String(sawStatus)})`)
  console.error(`pty-smoke: transcript saved to ${join(here, 'pty-smoke.transcript.txt')}`)
  process.exit(1)
}
console.log('pty-smoke: OK — interactive transcript contains the user line, the turn footer, and the status line')
process.exit(0)
