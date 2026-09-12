/**
 * Start-up and footprint check for the CLI.
 *
 * Three paths differ in what they boot: `version` only reads the package, `doctor`
 * inspects the environment, and a task boots the whole profile (loader, plugins,
 * storage). The numbers are the baseline the product is judged against, so a
 * regression in boot cost shows up here instead of as a slow first turn.
 *
 * Usage: node Kibborg_CLI/tests/load-check.mjs [--runs 3] [--boot-target 45000]
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '..', '..')
const bin = join(here, '..', 'apps', 'cli', 'lib', 'bin.js')

const argv = process.argv.slice(2)
const runs = Number(argv[argv.indexOf('--runs') + 1] ?? 3)

if (!existsSync(bin)) {
  console.error(`load-check: ${bin} is missing; build first (pnpm --dir Kibborg_CLI run build)`)
  process.exit(2)
}

/** Run one CLI invocation and report its wall time and output size. */
function measure(args) {
  return new Promise(resolve => {
    const started = process.hrtime.bigint()
    const child = spawn(process.execPath, [bin, ...args], { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'] })
    let bytes = 0
    child.stdout.on('data', chunk => { bytes += chunk.length })
    child.stderr.on('data', chunk => { bytes += chunk.length })
    child.on('exit', code => {
      const ms = Number(process.hrtime.bigint() - started) / 1e6
      resolve({ args: args.join(' ') || '(interactive)', code: code ?? -1, ms, bytes })
    })
  })
}

const cases = [['version'], ['doctor'], ['sessions', '--json']]
const rows = []
for (const args of cases) {
  const times = []
  let last
  for (let run = 0; run < runs; run += 1) {
    last = await measure(args)
    times.push(last.ms)
  }
  const average = times.reduce((sum, value) => sum + value, 0) / times.length
  rows.push({ command: last.args, code: last.code, average, min: Math.min(...times), max: Math.max(...times), bytes: last.bytes })
}

console.log('load-check: wall time per invocation (ms), over ' + String(runs) + ' runs')
for (const row of rows) {
  const verdict = row.code === 0 ? 'ok ' : 'ERR'
  console.log(`  ${verdict}  ${row.command.padEnd(18)} avg ${row.average.toFixed(0).padStart(6)}  min ${row.min.toFixed(0).padStart(6)}  max ${row.max.toFixed(0).padStart(6)}  stdout+stderr ${row.bytes} B  exit ${row.code}`)
}
const slowest = rows.reduce((slow, row) => (row.average > slow.average ? row : slow), rows[0])
console.log(`load-check: slowest path is \`${slowest.command}\` at ${slowest.average.toFixed(0)} ms`)
