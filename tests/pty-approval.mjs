/**
 * PTY check of the sandbox escalation path.
 *
 * A read-only session refuses a write inside the workspace and answers with an
 * escalation hint; a retry that carries `sandbox_permissions` must reach the
 * terminal as an approval request instead of being silently allowed. This script
 * runs the real binary under a real terminal, asks for a file outside the
 * workspace, and watches what the host does.
 *
 * Usage: node Kibborg_CLI/tests/pty-approval.mjs [--boot-ms 60000] [--answer n]
 *
 * Exit 0 means the sandbox held (the probe file never appeared) and the surface
 * said why; 1 means the probe file was written. Whether an approval frame showed
 * up is reported either way, because a model that never retries never raises it.
 */

import { existsSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '..', '..')
const bin = join(repo, 'Kibborg_CLI', 'apps', 'cli', 'lib', 'bin.js')
const probe = join(process.env['TEMP'] ?? process.env['TMP'] ?? repo, 'kibborg-approval-probe.txt')

const args = process.argv.slice(2)
const bootIndex = args.indexOf('--boot-ms')
const bootMs = bootIndex >= 0 ? Number(args[bootIndex + 1] ?? 60000) : 60000
const answerIndex = args.indexOf('--answer')
const answer = answerIndex >= 0 ? (args[answerIndex + 1] ?? 'n') : 'n'
const promptIndex = args.indexOf('--prompt')
const prompt = promptIndex >= 0
  ? (args[promptIndex + 1] ?? '')
  : `создай файл ${probe} со словом hi. Если запись запрещена — повтори тот же вызов, указав sandbox_permissions=["danger-full-access"] и justification "нужно записать файл вне рабочей области", чтобы получить разрешение.`

/** Resolve node-pty from the pnpm store: it is a transitive dependency, not a root one. */
function resolveNodePty() {
  const store = join(repo, 'node_modules', '.pnpm')
  const entry = readdirSync(store).find(name => name.startsWith('node-pty@'))
  if (entry === undefined) throw new Error('node-pty is not installed in the pnpm store')
  return join(store, entry, 'node_modules', 'node-pty', 'lib', 'index.js')
}

if (!existsSync(bin)) {
  console.error(`pty-approval: ${bin} is missing; build the CLI first (pnpm --dir Kibborg_CLI run build)`)
  process.exit(2)
}
rmSync(probe, { force: true })

const { spawn } = await import(pathToFileURL(resolveNodePty()).href)
const term = spawn(process.execPath, [bin, '--safe'], {
  name: 'xterm-256color',
  cols: 110,
  rows: 36,
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
term.write(`${prompt}\r`)
const asked = await waitFor('[y] once', 180000)
if (asked) {
  term.write(`${answer}\r`)
  await sleep(2000)
}
await waitFor('✔️', 120000)
term.write('\u0004')
await sleep(2000)
term.kill()

const cleaned = transcript
  .replace(/\u001B\[[0-9;?]*[A-Za-z]/gu, '')
  .replace(/\r/gu, '')
writeFileSync(join(here, 'pty-approval.transcript.txt'), cleaned, 'utf8')
console.log(cleaned.split('\n').slice(-30).join('\n'))

const created = existsSync(probe)
if (created) rmSync(probe, { force: true })
console.log(`pty-approval: approval frame ${asked ? 'seen' : 'not seen'}; probe file ${created ? 'CREATED' : 'absent'}`)
if (created) {
  console.error('pty-approval: FAIL — a read-only session wrote outside the workspace')
  process.exit(1)
}
console.log('pty-approval: OK — the read-only session did not write the probe file')
process.exit(0)
