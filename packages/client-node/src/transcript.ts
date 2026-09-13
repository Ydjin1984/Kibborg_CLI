/**
 * Transcript operations on a stored session log: markdown export, searching the
 * conversation, and lifting the last answer for the clipboard.
 *
 * All three read the same history window the resume path prints, so the file a
 * user exports and the lines they saw on screen come from one source. Reasoning
 * blocks stay out of every one of them (R10).
 * @module @kibborg/client-node/transcript
 */

import { spawn } from 'node:child_process'
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

/** How long a clipboard helper may run before it is dropped as stuck. */
const HELPER_TIMEOUT_MS = 5000

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
export async function copyToClipboard(text: string): Promise<boolean> {
  if (process.platform === 'win32') return await copyOnWindows(text)
  const candidates: readonly (readonly string[])[] = process.platform === 'darwin'
    ? [['pbcopy']]
    : [['wl-copy'], ['xclip', '-selection', 'clipboard'], ['xsel', '--clipboard', '--input']]
  for (const command of candidates) {
    const [file, ...rest] = command
    if (file === undefined) continue
    if (await runHelper(file, rest, text) === 0) return true
  }
  return false
}

/**
 * Start a clipboard helper and wait for it to exit.
 *
 * The helper runs as a child process so the terminal keeps repainting while the
 * clipboard is written; a synchronous spawn would freeze the frame on every
 * copy of a long answer.
 * @param command - the helper executable.
 * @param args - its arguments.
 * @param input - text for the helper's standard input, or `undefined` to close it.
 * @returns the exit code, or `-1` when the helper could not be started.
 */
function runHelper(command: string, args: readonly string[], input?: string): Promise<number> {
  return new Promise(resolve => {
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(command, [...args], { stdio: ['pipe', 'ignore', 'ignore'] })
    } catch {
      resolve(-1)
      return
    }
    // A helper that never exits — a stuck clipboard daemon, a locked display — must
    // not hold `/copy` or the process open, so the wait is bounded.
    const timer = setTimeout(() => {
      child.kill()
      resolve(-1)
    }, HELPER_TIMEOUT_MS)
    timer.unref()
    child.on('error', () => {
      clearTimeout(timer)
      resolve(-1)
    })
    child.on('close', code => {
      clearTimeout(timer)
      resolve(code ?? -1)
    })
    const stdin = child.stdin
    if (stdin !== null) {
      // A helper that exits without reading its input closes the pipe first; that
      // EPIPE is the helper's own answer and the exit code already reports it.
      stdin.on('error', () => undefined)
      stdin.end(input, 'utf8')
    }
  })
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
async function copyOnWindows(text: string): Promise<boolean> {
  const file = join(tmpdir(), `kibborg-clip-${String(process.pid)}-${String(Date.now())}.txt`)
  try {
    writeFileSync(file, text, 'utf8')
    const quoted = file.replace(/'/gu, "''")
    const script = `Set-Clipboard -Value (Get-Content -LiteralPath '${quoted}' -Raw -Encoding UTF8)`
    // The copy must not freeze the frame: the helper runs in the background while
    // the terminal keeps scrolling and selecting.
    const status = await runHelper('powershell', ['-NoProfile', '-NonInteractive', '-Command', script])
    if (status === 0) return true
    // A machine without PowerShell still gets the best effort the old helper can
    // give, which is readable for ASCII and wrong only for non-Latin text.
    return await runHelper('clip', [], text) === 0
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
