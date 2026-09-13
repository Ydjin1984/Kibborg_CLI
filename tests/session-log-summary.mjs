/**
 * Summarize a stored session journal.
 *
 * The journal is a sequence of zstd frames, one per appended batch, and a long
 * session is far too large to hold in memory: each frame is decompressed on its own
 * and released, while the counters keep the totals. It answers "how big is this
 * session and did anything go wrong" for a journal of any size.
 *
 * Usage: node Kibborg_CLI/tests/session-log-summary.mjs <session.jsonl.zstd> [--errors]
 */
import { readFileSync } from 'node:fs'
import { zstdDecompressSync } from 'node:zlib'

const argv = process.argv.slice(2)
const file = argv.find(value => !value.startsWith('--'))
if (file === undefined) {
  console.error('usage: node tests/session-log-summary.mjs <session.jsonl.zstd> [--errors]')
  process.exit(2)
}

/** Zstandard frame magic, which separates the frames of one journal. */
const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

/** Offsets where a new zstd frame starts. */
function frameOffsets(buffer) {
  const offsets = [0]
  let index = buffer.indexOf(MAGIC, MAGIC.length)
  while (index !== -1) {
    offsets.push(index)
    index = buffer.indexOf(MAGIC, index + MAGIC.length)
  }
  return offsets
}

const file_ = readFileSync(file)
const offsets = frameOffsets(file_)
const kinds = new Map()
const tools = new Map()
const endings = new Map()
const failures = new Map()
const problems = []
let events = 0
let firstTime
let lastTime

for (const [position, start] of offsets.entries()) {
  const end = offsets[position + 1] ?? file_.length
  let text
  try {
    text = zstdDecompressSync(file_.subarray(start, end)).toString('utf8')
  } catch {
    // A frame that fails to decode is a fact about the journal, not a reason to
    // stop reading the rest of it.
    problems.push(`frame at ${String(start)} did not decode`)
    continue
  }
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    let event
    try {
      event = JSON.parse(line)
    } catch {
      problems.push(`unparseable record: ${line.slice(0, 120)}`)
      continue
    }
    events += 1
    const type = String(event.type ?? 'unknown')
    kinds.set(type, (kinds.get(type) ?? 0) + 1)
    if (typeof event.time === 'number') {
      firstTime ??= event.time
      lastTime = event.time
    }
    if (event.type === 'tool/call') {
      const name = String(event.data?.name ?? '?')
      tools.set(name, (tools.get(name) ?? 0) + 1)
    }
    if (event.type === 'turn/end' && event.data?.reason?.kind !== 'completed') {
      endings.set(String(event.data?.reason?.kind), (endings.get(String(event.data?.reason?.kind)) ?? 0) + 1)
    }
    // Only the error fields count: the words "error" and "failed" appear in ordinary
    // answers, tool output, and reasoning text, so matching the raw record reports
    // noise instead of failures. A tool result that carries an error is a tool's own
    // answer, counted separately, not a broken transport.
    const failure = event.data?.error
    if (event.type === 'error') {
      problems.push(`error @${String(event.seq ?? '?')}: ${JSON.stringify(event.data).slice(0, 160)}`)
    } else if (event.type === 'tool/result' && failure !== undefined) {
      const name = String(event.data?.name ?? '?')
      failures.set(name, (failures.get(name) ?? 0) + 1)
    }
  }
}

console.log(`file: ${file}`)
console.log(`frames: ${String(offsets.length)}, events: ${String(events)}`)
if (firstTime !== undefined && lastTime !== undefined) {
  console.log(`span: ${((lastTime - firstTime) / 60_000).toFixed(1)} min`)
}
console.log('kinds:')
for (const [type, count] of [...kinds].sort((left, right) => right[1] - left[1]).slice(0, 15)) {
  console.log(`  ${String(count).padStart(7)}  ${type}`)
}
if (tools.size > 0) {
  console.log('tools:')
  for (const [name, count] of [...tools].sort((left, right) => right[1] - left[1]).slice(0, 10)) {
    console.log(`  ${String(count).padStart(7)}  ${name}`)
  }
}
console.log(`suspicious records: ${String(problems.length)}`)
if (endings.size > 0) {
  console.log('turn endings:')
  for (const [kind, count] of [...endings].sort((left, right) => right[1] - left[1])) {
    console.log(`  ${String(count).padStart(7)}  ${kind}`)
  }
}
if (failures.size > 0) {
  console.log('tool results that reported an error:')
  for (const [name, count] of [...failures].sort((left, right) => right[1] - left[1])) {
    console.log(`  ${String(count).padStart(7)}  ${name}`)
  }
}
if (argv.includes('--errors')) for (const problem of problems.slice(0, 30)) console.log(`  ${problem}`)
