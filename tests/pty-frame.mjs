/**
 * PTY frame check of the fullscreen surface.
 *
 * A unit test cannot prove that the surface takes over a real terminal, paints
 * its static regions, and restores the terminal on the way out. This script runs
 * the built CLI inside a pseudo-terminal, captures what the terminal received,
 * and asserts exactly that.
 *
 * Windows note: node-pty drives ConPTY, which consumes the mode-setting
 * sequences (`?1049h`, `?1006h`, `?25l`) into its own screen buffer and forwards
 * a painted screen instead. Mode switches are therefore asserted by unit tests
 * (`packages/tui/tests/surface.spec.ts`); this script asserts the painted frame
 * and the terminal restoration.
 *
 * Usage: node Kibborg_CLI/tests/pty-frame.mjs [--hold-ms 30000]
 */

import { readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '..', '..')
const bin = join(repo, 'Kibborg_CLI', 'apps', 'cli', 'lib', 'bin.js')

const args = process.argv.slice(2)
const holdIndex = args.indexOf('--hold-ms')
const holdMs = holdIndex >= 0 ? Number(args[holdIndex + 1] ?? 4000) : 4000

/** Resolve node-pty from the pnpm store: it is a transitive dependency. */
function resolveNodePty() {
  const store = join(repo, 'node_modules', '.pnpm')
  const entry = readdirSync(store).find(name => name.startsWith('node-pty@'))
  if (entry === undefined) throw new Error('node-pty is not installed in the pnpm store')
  return join(store, entry, 'node_modules', 'node-pty', 'lib', 'index.js')
}

const pty = await import(pathToFileURL(resolveNodePty()).href)

const term = pty.spawn(process.execPath, [bin], {
  name: 'xterm-256color',
  cols: 100,
  rows: 30,
  cwd: join(repo, 'Kibborg_CLI'),
  env: { ...process.env, COLORTERM: 'truecolor', TERM: 'xterm-256color' },
})

let out = ''
term.onData(chunk => {
  out += chunk
})
let exited = null
if (typeof term.onExit === 'function') term.onExit(event => {
  exited = event
})

await new Promise(resolveWait => setTimeout(resolveWait, holdMs))
console.log(`captured ${String(out.length)} bytes; exited=${JSON.stringify(exited)}`)

console.log('--- screen: welcome ---')
console.log(emulate(out, 100, 30).join('\n'))

// Type one character to leave the welcome screen and move into the session.
term.write('x')
await new Promise(resolveWait => setTimeout(resolveWait, 2500))
console.log('--- screen: session ---')
console.log(emulate(out, 100, 30).join('\n'))

// Open the slash palette and filter it, which is the menu the user navigates.
term.write('\u007F/mo')
await new Promise(resolveWait => setTimeout(resolveWait, 1500))
console.log('--- screen: palette ---')
console.log(emulate(out, 100, 30).join('\n'))

term.write('\u0004')
await new Promise(resolveWait => setTimeout(resolveWait, 1500))
try {
  term.kill()
} catch {
  // The surface may already have exited on Ctrl+D.
}

const checks = {
  screenCleared: out.includes('\u001B[2J') || out.includes('\u001B[H'),
  // The location row is the frame's top line: the mark and the directory. The
  // context share joins it only after a turn has measured it.
  brandHeader: out.includes('≡ ') && out.includes('Kibborg_CLI'),
  composerPrompt: out.includes('>'),
  // The model and the mode live in the composer's bottom border.
  statusBar: out.includes('╰─ ') && out.includes(' · Agent'),
  cursorRestored: out.includes('\u001B[?25h'),
  linesErased: out.includes('\u001B[K') || out.includes('\u001B[2K'),
  noLineFeedFrames: !/\u001B\[2K[^\u001B]*\n/u.test(out),
}

/** Strip escape sequences so the captured frame can be read as text. */
const plain = out.replace(/\u001B\][^\u0007]*\u0007/gu, '').replace(/\u001B\[[0-9;?]*[A-Za-z]/gu, '')

const sequences = [...new Set(out.match(/\u001B\[[0-9;?]*[A-Za-z]/gu) ?? [])]
console.log(`escape sequences seen (${String(sequences.length)}):`)
console.log(sequences.join(' '))

/**
 * Replay captured output through a minimal terminal emulator so the frame can be
 * read as text: cursor positioning, line and screen erasing, and printing.
 * @param text - the captured PTY stream.
 * @param cols - terminal width.
 * @param rows - terminal height.
 * @returns the screen rows, trailing blanks trimmed.
 */
function emulate(text, cols, rows) {
  const grid = Array.from({ length: rows }, () => Array(cols).fill(' '))
  let x = 0
  let y = 0
  let index = 0
  while (index < text.length) {
    const char = text[index]
    if (char === '\u001B') {
      const rest = text.slice(index)
      const csi = /^\u001B\[([0-9;?]*)([A-Za-z])/u.exec(rest)
      if (csi !== null) {
        const params = csi[1].split(';').map(value => (value === '' ? 0 : Number(value)))
        const final = csi[2]
        const first = params[0] ?? 0
        if (final === 'H' || final === 'f') {
          y = Math.min(rows - 1, Math.max(0, (first || 1) - 1))
          x = Math.min(cols - 1, Math.max(0, ((params[1] ?? 0) || 1) - 1))
        } else if (final === 'A') y = Math.max(0, y - (first || 1))
        else if (final === 'B') y = Math.min(rows - 1, y + (first || 1))
        else if (final === 'C') x = Math.min(cols - 1, x + (first || 1))
        else if (final === 'D') x = Math.max(0, x - (first || 1))
        else if (final === 'G') x = Math.max(0, (first || 1) - 1)
        else if (final === 'K') {
          if ((first || 0) === 0) for (let k = x; k < cols; k++) grid[y][k] = ' '
          else if (first === 1) for (let k = 0; k <= x; k++) grid[y][k] = ' '
          else grid[y].fill(' ')
        } else if (final === 'J') {
          if ((first || 0) === 2) for (const row of grid) row.fill(' ')
        }
        index += csi[0].length
        continue
      }
      const osc = /^\u001B\][^\u0007]*(\u0007|\u001B\\)/u.exec(rest)
      index += osc === null ? 1 : osc[0].length
      continue
    }
    if (char === '\n') {
      y = Math.min(rows - 1, y + 1)
      index += 1
      continue
    }
    if (char === '\r') {
      x = 0
      index += 1
      continue
    }
    if (char === '\b') {
      x = Math.max(0, x - 1)
      index += 1
      continue
    }
    if (char >= ' ') {
      if (y < rows && x < cols) {
        grid[y][x] = char
        x += 1
      }
      index += 1
      continue
    }
    index += 1
  }
  return grid.map(row => row.join('').replace(/\s+$/u, ''))
}

console.log('checks:')
for (const [name, ok] of Object.entries(checks)) console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}`)
console.log('frame tail:')
console.log(plain.slice(-700))
process.exit(Object.values(checks).every(Boolean) ? 0 : 1)
