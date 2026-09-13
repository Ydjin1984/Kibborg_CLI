/**
 * Render a captured raw terminal stream into a readable frame.
 *
 * The probe writes the bytes one CLI actually sent; this replays them through a
 * small screen model so the interface can be read. Usage:
 *   node tests/ref-render.mjs tests/ref-grok-work.txt [--cols 110] [--rows 34]
 */
import { readFileSync } from 'node:fs'

const argv = process.argv.slice(2)
const flag = (name, fallback) => {
  const at = argv.indexOf(name)
  return at === -1 ? fallback : Number(argv[at + 1])
}
const cols = flag('--cols', 110)
const rows = flag('--rows', 34)
const raw = readFileSync(argv[0], 'utf8')

const screen = Array.from({ length: rows }, () => Array.from({ length: cols }, () => ({ ch: ' ', bold: false })))
let row = 0
let col = 0
let bold = false
let index = 0

const put = ch => {
  if (ch === '\n') {
    row = Math.min(rows - 1, row + 1)
    return
  }
  if (ch === '\r') {
    col = 0
    return
  }
  if (col >= cols) {
    col = 0
    row = Math.min(rows - 1, row + 1)
  }
  screen[row][col] = { ch, bold }
  col += 1
}

while (index < raw.length) {
  const ch = raw[index]
  if (ch === '\u001B') {
    const rest = raw.slice(index)
    let match = /^\u001B\[([0-9;?]*)([A-Za-z])/u.exec(rest)
    if (match !== null) {
      const params = match[1]
      const final = match[2]
      const numbers = params.replace(/^\?/u, '').split(';').filter(part => part !== '').map(Number)
      if (final === 'H' || final === 'f') {
        row = Math.max(0, Math.min(rows - 1, (numbers[0] ?? 1) - 1))
        col = Math.max(0, Math.min(cols - 1, (numbers[1] ?? 1) - 1))
      } else if (final === 'A') {
        row = Math.max(0, row - (numbers[0] ?? 1))
      } else if (final === 'B') {
        row = Math.min(rows - 1, row + (numbers[0] ?? 1))
      } else if (final === 'C') {
        col = Math.min(cols - 1, col + (numbers[0] ?? 1))
      } else if (final === 'K') {
        const mode = numbers[0] ?? 0
        if (mode === 0) for (let x = col; x < cols; x += 1) screen[row][x] = { ch: ' ', bold: false }
        if (mode === 1) for (let x = 0; x <= col; x += 1) screen[row][x] = { ch: ' ', bold: false }
        if (mode === 2) for (let x = 0; x < cols; x += 1) screen[row][x] = { ch: ' ', bold: false }
      } else if (final === 'X') {
        const count = numbers[0] ?? 1
        for (let x = col; x < Math.min(cols, col + count); x += 1) screen[row][x] = { ch: ' ', bold: false }
      } else if (final === 'J') {
        const mode = numbers[0] ?? 0
        if (mode === 2) for (const line of screen) line.fill({ ch: ' ', bold: false })
      } else if (final === 'm') {
        if (numbers.includes(1)) bold = true
        if (numbers.includes(0) || numbers.includes(22)) bold = false
      }
      index += match[0].length
      continue
    }
    match = /^\u001B\][^\u0007\u001B]*(?:\u0007|\u001B\\)/u.exec(rest)
    if (match !== null) {
      index += match[0].length
      continue
    }
    index += 2
    continue
  }
  put(ch)
  index += 1
}

for (const line of screen) {
  const text = line.map(cell => cell.ch).join('').replace(/\s+$/u, '')
  console.log(text === '' ? '·' : text)
}
