/**
 * Probe one reference CLI in a PTY and report what its interface actually does.
 *
 * The reference CLIs are native binaries, so their behaviour is the source of
 * truth: this starts the program on a real terminal, captures the raw bytes, and
 * reports which terminal modes it turns on, which drawing primitives it uses, and
 * the frame it draws. Usage:
 *   node tests/ref-probe.mjs <program> [args...] --cols 100 --rows 30 --ms 8000 --out tests/ref-grok.txt
 */
import { readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')
const argv = process.argv.slice(2)
const flag = (name, fallback) => {
  const at = argv.indexOf(name)
  return at === -1 ? fallback : argv[at + 1]
}
const cols = Number(flag('--cols', '100'))
const rows = Number(flag('--rows', '30'))
const ms = Number(flag('--ms', '8000'))
const keysAfter = Number(flag('--keys-after', '0'))
const keys = flag('--keys', '')
const out = flag('--out', join(here, 'ref-probe.txt'))
const program = argv[0]
const args = argv.slice(1).filter((value, index, all) => !['--cols', '--rows', '--ms', '--out'].includes(all[index - 1] ?? '') && !value.startsWith('--'))

const store = join(root, 'node_modules', '.pnpm')
const ptyEntry = readdirSync(store).find(name => name.startsWith('node-pty@'))
if (ptyEntry === undefined) throw new Error('node-pty is not installed')
const { spawn } = await import(pathToFileURL(join(store, ptyEntry, 'node_modules', 'node-pty', 'lib', 'index.js')).href)

const term = spawn(program, args, {
  name: 'xterm-256color',
  cols,
  rows,
  cwd: process.cwd(),
  env: { ...process.env, NO_COLOR: undefined, CI: undefined, TERM: 'xterm-256color' },
})
let raw = ''
term.onData(chunk => { raw += chunk })
if (keys !== '' && keysAfter > 0) {
  await new Promise(resolve => setTimeout(resolve, keysAfter))
  term.write(JSON.parse(`"${keys}"`))
  await new Promise(resolve => setTimeout(resolve, Math.max(0, ms - keysAfter)))
} else {
  await new Promise(resolve => setTimeout(resolve, ms))
}
term.kill()

/** The eight ANSI colors the surface may use through SGR 30–37 and 90–97. */
const sequences = {
  'mouse: click 1000h': '1000h',
  'mouse: drag 1002h': '1002h',
  'mouse: any 1003h': '1003h',
  'mouse: SGR 1006h': '1006h',
  'alt screen 1049h': '1049h',
  'alt screen 47h': '?47h',
  'bracketed paste 2004h': '2004h',
  'win32 input 9001h': '9001h',
  'kitty keyboard >1u': '>1u',
  'cursor hide 25l': '?25l',
  'sync output 2026h': '2026h',
  'OSC 8 hyperlink': ']8;',
  'OSC 52 clipboard': ']52;',
  'OSC 22 title': ']2;',
  'truecolor 38;2': '38;2;',
  'erase line 2K': '[2K',
  'erase down 0J': '[0J',
  'cursor up A': '[1A',
  'DEC mode 2027': '2027',
}
const found = Object.entries(sequences).map(([label, needle]) => `${raw.includes(needle) ? 'YES' : ' - '} ${label}`)
const bytes = Buffer.byteLength(raw, 'utf8')
const lines = raw.split(/\r?\n/u).filter(line => line.trim() !== '').length
const sizes = { bytes, lines, 'CSI sequences': (raw.match(/\u001B\[[0-9;?]*[A-Za-z]/gu) ?? []).length, 'OSC sequences': (raw.match(/\u001B\]/gu) ?? []).length, 'colors used': [...new Set(raw.match(/\u001B\[[0-9;]*m/gu) ?? [])].slice(0, 12).join(' ') }
writeFileSync(out, raw.replace(/\u001B\][^\u0007\u001B]*(\u0007|\u001B\\)/gu, ''), 'utf8')
console.log(`# ${program} ${args.join(' ')} at ${String(cols)}x${String(rows)} for ${String(ms)}ms`)
for (const line of found) console.log(line)
console.log(JSON.stringify(sizes))
console.log(`frame written to ${out}`)
