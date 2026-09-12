/**
 * Input history of the interactive surface.
 *
 * The history is one line per entry in a plain text file under the Harness
 * home, so it survives restarts and stays readable and editable by hand. A
 * write is best-effort: a history file that cannot be written never fails the
 * session it belongs to.
 * @module @kibborg/tui/history
 */

import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** How many entries are recalled on load. */
export const HISTORY_LIMIT = 200

/**
 * Default history path under the Harness home.
 * @param home - the Harness home directory.
 * @returns the absolute path of the history file.
 */
export function historyPath(home: string): string {
  return join(home, 'kibborg-history.txt')
}

/**
 * Read the most recent history entries.
 * @param path - the history file's path.
 * @param limit - how many trailing entries to return.
 * @returns the entries, oldest first; an unreadable file yields an empty list.
 */
export function loadHistory(path: string, limit: number = HISTORY_LIMIT): readonly string[] {
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    return []
  }
  const lines = raw.split(/\r?\n/u).filter(line => line.trim() !== '')
  return lines.slice(Math.max(0, lines.length - limit))
}

/**
 * Append one entry, replacing a repeated previous entry instead of duplicating it.
 * @param path - the history file's path.
 * @param entry - the submitted text; a blank entry is ignored.
 * @returns whether the entry was written.
 */
export function appendHistory(path: string, entry: string): boolean {
  const text = entry.trim()
  if (text === '') return false
  try {
    mkdirSync(dirname(path), { recursive: true })
    const existing = loadHistory(path)
    const last = existing[existing.length - 1]
    if (last === text) return false
    appendFileSync(path, `${text.split(/\r?\n/u).join(' ')}\n`, 'utf8')
    return true
  } catch {
    return false
  }
}

/**
 * Replace the history with the given entries, keeping the newest entries.
 * @param path - the history file's path.
 * @param entries - the entries to store, oldest first.
 */
export function saveHistory(path: string, entries: readonly string[]): void {
  try {
    mkdirSync(dirname(path), { recursive: true })
    const kept = entries.slice(Math.max(0, entries.length - HISTORY_LIMIT))
    writeFileSync(path, kept.length === 0 ? '' : `${kept.join('\n')}\n`, 'utf8')
  } catch {
    // A history file that cannot be written must not fail the session.
  }
}
