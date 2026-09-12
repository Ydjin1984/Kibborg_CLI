/**
 * Transcript operations on a stored session log: markdown export, searching the
 * conversation, and lifting the last answer for the clipboard.
 *
 * All three read the same history window the resume path prints, so the file a
 * user exports and the lines they saw on screen come from one source. Reasoning
 * blocks stay out of every one of them (R10).
 * @module @kibborg/client-node/transcript
 */

import { spawnSync } from 'node:child_process'
import { rmSync, writeFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { visibleText } from './history-render.ts'

/** One conversation match found by a transcript search. */
export interface TranscriptMatch {
  /** Seq of the event the match came from. */
  readonly seq: number
  /** Which side of the conversation it was. */
  readonly role: 'you' | 'assistant'
  /** The surrounding text, trimmed to one line. */
  readonly snippet: string
}

/** How many matches one search reports. */
export const MATCH_LIMIT = 20

/** Characters of context a match snippet keeps. */
const SNIPPET_WIDTH = 120

/** The text one message event contributes, or empty when it contributes none. */
function messageText(event: SessionEvent): string {
  if (event.type === 'user/message') return visibleText(event.data.content)
  if (event.type === 'assistant/message') return visibleText(event.data.message.content)
  return ''
}

/** The side a message event belongs to, or `undefined` for any other event. */
function roleOf(event: SessionEvent): TranscriptMatch['role'] | undefined {
  if (event.type === 'user/message') return 'you'
  if (event.type === 'assistant/message') return 'assistant'
  return undefined
}

/**
 * Render a session log as a markdown transcript.
 * @param events - the log, oldest first.
 * @param options - the session title and id, both used in the heading.
 * @returns the document, ending in one newline.
 */
export function markdownOfHistory(
  events: readonly SessionEvent[],
  options: { readonly title?: string; readonly sessionId: string; readonly now?: number },
): string {
  const heading = options.title === undefined || options.title === '' ? options.sessionId : options.title
  const lines: string[] = [`# ${heading}`, '']
  lines.push(`- session: \`${options.sessionId}\``)
  lines.push(`- exported: ${new Date(options.now ?? Date.now()).toISOString()}`)
  lines.push('')
  let tools: string[] = []
  const flushTools = (): void => {
    if (tools.length === 0) return
    lines.push('## Tools', '', ...tools, '')
    tools = []
  }
  for (const event of events) {
    const role = roleOf(event)
    if (role !== undefined) {
      const text = messageText(event).trim()
      if (text === '') continue
      flushTools()
      lines.push(role === 'you' ? '## You' : '## Assistant', '', text, '')
      continue
    }
    if (event.type === 'tool/call') tools.push(`- \`${event.data.name}\``)
    else if (event.type === 'tool/result' && event.data.error !== undefined) tools.push(`- failed: ${event.data.error.name}`)
  }
  flushTools()
  return `${lines.join('\n').trimEnd()}\n`
}

/**
 * Search the conversation text of a session log.
 * @param events - the log, oldest first.
 * @param needle - the text to look for, matched case-insensitively.
 * @param limit - how many matches to return.
 * @returns the matches in conversation order.
 */
export function findInHistory(
  events: readonly SessionEvent[],
  needle: string,
  limit = MATCH_LIMIT,
): readonly TranscriptMatch[] {
  const wanted = needle.trim().toLowerCase()
  if (wanted === '') return []
  const matches: TranscriptMatch[] = []
  for (const event of events) {
    if (matches.length >= limit) break
    const role = roleOf(event)
    if (role === undefined) continue
    const text = messageText(event)
    const at = text.toLowerCase().indexOf(wanted)
    if (at === -1) continue
    const start = Math.max(0, at - 40)
    matches.push({
      seq: event.seq,
      role,
      snippet: text.slice(start, start + SNIPPET_WIDTH).replace(/\s+/g, ' ').trim(),
    })
  }
  return matches
}

/**
 * The last answer the assistant produced.
 * @param events - the log, oldest first.
 * @returns the answer text, or `undefined` when the log holds none.
 */
export function lastAssistantText(events: readonly SessionEvent[]): string | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event === undefined || event.type !== 'assistant/message') continue
    const text = visibleText(event.data.message.content).trim()
    if (text !== '') return text
  }
  return undefined
}

/** Default destination for a transcript export. */
export function defaultTranscriptPath(sessionId: string): string {
  return `kibborg-transcript-${sessionId}.md`
}

/**
 * Write a markdown transcript beside the working directory.
 * @param events - the log, oldest first.
 * @param options - title, session id, and destination path.
 * @returns the absolute path written.
 */
export async function writeTranscript(
  events: readonly SessionEvent[],
  options: { readonly title?: string; readonly sessionId: string; readonly output?: string },
): Promise<string> {
  const output = resolve(options.output ?? defaultTranscriptPath(options.sessionId))
  const markdown = markdownOfHistory(events, {
    ...(options.title === undefined ? {} : { title: options.title }),
    sessionId: options.sessionId,
  })
  await writeFile(output, markdown, 'utf8')
  return output
}

/**
 * Copy text to the platform clipboard.
 *
 * Each platform ships its own helper and none of them is guaranteed present, so
 * an unavailable one is reported rather than silently dropping the text.
 * @param text - the text to place on the clipboard.
 * @returns whether a clipboard helper accepted the text.
 */
export function copyToClipboard(text: string): boolean {
  if (process.platform === 'win32') return copyOnWindows(text)
  const candidates: readonly (readonly string[])[] = process.platform === 'darwin'
    ? [['pbcopy']]
    : [['wl-copy'], ['xclip', '-selection', 'clipboard'], ['xsel', '--clipboard', '--input']]
  for (const command of candidates) {
    const [file, ...rest] = command
    if (file === undefined) continue
    const result = spawnSync(file, rest, { input: text, encoding: 'utf8' })
    if (!result.error && result.status === 0) return true
  }
  return false
}

/**
 * Copy text on Windows.
 *
 * `clip.exe` reads its standard input in the console code page, so UTF-8 text
 * arrives as mojibake — Cyrillic turns into question marks and stray bytes.
 * PowerShell's `Set-Clipboard` reads a UTF-8 file correctly, so the text goes
 * through a temporary file and the clipboard keeps the exact characters.
 * @param text - the text to place on the clipboard.
 * @returns whether the clipboard took the text.
 */
function copyOnWindows(text: string): boolean {
  const file = join(tmpdir(), `kibborg-clip-${String(process.pid)}-${String(Date.now())}.txt`)
  try {
    writeFileSync(file, text, 'utf8')
    const quoted = file.replace(/'/gu, "''")
    const script = `Set-Clipboard -Value (Get-Content -LiteralPath '${quoted}' -Raw -Encoding UTF8)`
    const result = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8' })
    if (!result.error && result.status === 0) return true
    // A machine without PowerShell still gets the best effort the old helper can
    // give, which is readable for ASCII and wrong only for non-Latin text.
    const fallback = spawnSync('clip', [], { input: text, encoding: 'utf8' })
    return !fallback.error && fallback.status === 0
  } catch {
    return false
  } finally {
    try {
      rmSync(file, { force: true })
    } catch {
      // A leftover temporary file is harmless: the OS cleans its temp directory.
    }
  }
}
