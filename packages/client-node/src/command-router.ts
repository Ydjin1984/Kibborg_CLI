/**
 * Slash commands the terminal surface owns itself.
 *
 * A leading slash normally belongs to the host command registry, and this
 * router only intercepts the lines whose answer depends on the terminal: which
 * model and effort this invocation runs with, what the surface is attached to,
 * and which registries the host serves. Everything else is handed back to the
 * registry through the caller's `host` callback, so the surface never seeds a
 * second command catalog.
 * @module @kibborg/client-node/command-router
 */

import { executeCommand, listCommands, type CommandOutcome } from './remote.ts'
import { formatMcpServers, formatSkills, readMcpServers, readSkills } from './registries.ts'
import { readHistoryEvents } from './sessions.ts'
import { copyToClipboard, findInHistory, lastAssistantText, writeTranscript } from './transcript.ts'
import { formatPanelSnapshot, PANEL_NAMES, readPanelSnapshot, type PanelName } from './panels.ts'
import type { Context } from '@deepseek-ai/cordis'
import type { IApiClient } from '@deepseek-ai/dsh-host-apiproxy/client'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session/types'

/** Live state of the surface, as the local commands read and update it. */
export interface SurfaceState {
  /** Current model, as `provider/model`; `/model` rewrites it. */
  model: string
  /** Reasoning effort in force, when one was selected. */
  effort: string | undefined
  /** Permission-mode badge. */
  mode: string
  /** Share of the context window in use, as the last turn reported it. */
  contextPercent: number
  /** Current git branch, when the working directory is a repository. */
  branch: string | undefined
  /** Whether the worktree has uncommitted changes, when it is a repository. */
  dirty: boolean | undefined
}

/** What the local commands need from the surface. */
export interface LocalCommandContext {
  /** Host context carrying the Typert gateway. */
  readonly ctx: Context
  /** The in-process client. */
  readonly client: IApiClient
  /** The session every command addresses. */
  readonly sessionId: SessionId
  /** Writes one already-formatted line to the terminal. */
  readonly write: (chunk: string) => void
  /** Mutable surface state. */
  readonly state: SurfaceState
}

/** The local commands, in the order `/help` lists them. */
export const LOCAL_COMMANDS: readonly { readonly name: string; readonly description: string }[] = [
  { name: 'new', description: 'start a new session in this directory' },
  { name: 'resume', description: 'switch to another session' },
  { name: 'sessions', description: 'switch to another session (same as /resume)' },
  { name: 'help', description: 'list the commands this surface and the host offer' },
  { name: 'status', description: 'show the session, model, effort, and permission mode' },
  { name: 'model', description: 'pick the model from a list, or switch with /model <provider/model>' },
  { name: 'effort', description: 'pick the reasoning effort: /effort low|medium|high' },
  { name: 'permission', description: 'pick the permission preset' },
  { name: 'quit', description: 'leave kibborg' },
  { name: 'mcp', description: 'list the declared MCP servers and their state' },
  { name: 'skills', description: 'list the skills this project offers' },
  { name: 'copy', description: 'copy the last answer to the clipboard' },
  { name: 'find', description: 'search this conversation: /find <text>' },
  { name: 'transcript', description: 'write this conversation to markdown: /transcript [file]' },
  { name: 'panel', description: 'open the tabs modal: skills, MCP, hooks, plugins, permissions' },
  { name: 'panels', description: 'show a live panel: sessions, subagents, jobs, queue, context, goals, todos' },
]

/** How much of the log the reading commands walk. */
const READING_HISTORY_LIMIT = 400

/** Names this router answers; the rest fall through to the host registry. */
const LOCAL_NAMES = new Set(LOCAL_COMMANDS.map(command => command.name))

/**
 * Find the registered command a mistyped line most likely meant.
 *
 * A slash line that is not a command is a prompt — the host expands `/name` as
 * a skill invocation — so only a near miss is treated as a typo. The distance
 * bound is tight (one edit for short names, two for longer ones) so that a skill
 * name is never mistaken for a typo of a command.
 * @param line - the typed line, with or without its leading slash.
 * @param names - every registered command name, without slashes.
 * @returns the suggested command name, or `undefined` when nothing is close.
 */
export function nearestCommand(line: string, names: readonly string[]): string | undefined {
  const typed = splitCommand(line).name.toLowerCase()
  if (typed.length < 3) return undefined
  const bound = typed.length <= 6 ? 1 : 2
  let best: string | undefined
  let bestDistance = bound + 1
  for (const name of names) {
    const candidate = name.replace(/^\//u, '').toLowerCase()
    if (candidate === typed) continue
    const distance = editDistance(typed, candidate)
    if (distance < bestDistance) {
      bestDistance = distance
      best = candidate
    }
  }
  return bestDistance <= bound ? best : undefined
}

/**
 * Damerau-Levenshtein distance between two short strings.
 *
 * Transposition counts as one edit, because `quti` for `quit` is the mistake a
 * fast typist makes and it should still be recognized as a typo.
 */
function editDistance(left: string, right: string): number {
  const rows = left.length + 1
  const columns = right.length + 1
  let before = new Array<number>(columns).fill(0)
  let previous = Array.from({ length: columns }, (_, index) => index)
  for (let row = 1; row < rows; row += 1) {
    const current = new Array<number>(columns).fill(0)
    current[0] = row
    for (let column = 1; column < columns; column += 1) {
      const substitution = (previous[column - 1] ?? 0) + (left[row - 1] === right[column - 1] ? 0 : 1)
      let best = Math.min(substitution, (previous[column] ?? 0) + 1, (current[column - 1] ?? 0) + 1)
      const swapped = row > 1 && column > 1
        && left[row - 1] === right[column - 2]
        && left[row - 2] === right[column - 1]
      if (swapped) best = Math.min(best, (before[column - 2] ?? 0) + 1)
      current[column] = best
    }
    before = previous
    previous = current
  }
  return previous[columns - 1] ?? 0
}

/** Trace one step of a local command when `KIBBORG_TRACE=1` asks for it. */
function trace(message: string): void {
  if (process.env['KIBBORG_TRACE'] === '1') process.stderr.write(`kibborg[trace]: ${message}\n`)
}

/**
 * Split one command line into its name and its argument text.
 * @param line - the full line, including the leading slash.
 * @returns the name without the slash and the trimmed remainder.
 */
export function splitCommand(line: string): { readonly name: string; readonly argument: string } {
  const body = line.startsWith('/') ? line.slice(1) : line
  const space = body.search(/\s/)
  if (space === -1) return { name: body, argument: '' }
  return { name: body.slice(0, space), argument: body.slice(space + 1).trim() }
}

/**
 * Decide whether this router owns a line.
 * @param line - the full command line.
 * @returns whether {@link runLocalCommand} will handle it.
 */
export function isLocalCommand(line: string): boolean {
  return LOCAL_NAMES.has(splitCommand(line).name)
}

/** Print the local commands beside the host ones, so one list answers `/help`. */
async function help(context: LocalCommandContext): Promise<CommandOutcome> {
  const lines: string[] = ['surface']
  for (const command of LOCAL_COMMANDS) lines.push(`  /${command.name}   ${command.description}`)
  const host = await listCommands(context.ctx, context.sessionId)
  lines.push('host')
  if (host.length === 0) lines.push('  (none)')
  for (const command of host) lines.push(`  /${command.name}   ${command.description ?? ''}`)
  context.write(`${lines.join('\n')}\n`)
  return { ok: true }
}

/** Report what this invocation is attached to and how it runs. */
function status(context: LocalCommandContext): CommandOutcome {
  const { state } = context
  const lines = [
    `  session    ${context.sessionId}`,
    `  cwd        ${process.cwd()}`,
    `  model      ${state.model}`,
    `  effort     ${state.effort ?? '(provider default)'}`,
    `  permission ${state.mode}`,
    `  context    ${state.contextPercent}%`,
    ...(state.branch === undefined ? [] : [`  branch     ${state.branch}`]),
  ]
  context.write(`${lines.join('\n')}\n`)
  return { ok: true }
}

/** Switch the session's model, or report the one in force. */
async function model(context: LocalCommandContext, argument: string): Promise<CommandOutcome> {
  if (argument === '') {
    const current = await context.client.sessions.models({ sessionId: context.sessionId })
    const lines = [`  current  ${context.state.model}`]
    if (!current.result.ok) {
      lines.push(`  (catalog unavailable: ${current.result.error.message})`)
    } else {
      for (const group of current.result.value.groups) {
        lines.push(`  ${group.id}   ${group.models.map(entry => entry.id).join(', ')}`)
      }
    }
    context.write(`${lines.join('\n')}\n`)
    return { ok: true }
  }
  return await selectRoute(context, argument, undefined)
}

/** Set the reasoning effort on the model in force. */
async function effort(context: LocalCommandContext, argument: string): Promise<CommandOutcome> {
  if (argument === '') {
    context.write(`  effort   ${context.state.effort ?? '(provider default)'}\n`)
    return { ok: true }
  }
  return await selectRoute(context, undefined, argument)
}

/** Apply a model and effort change through one selection call. */
async function selectRoute(
  context: LocalCommandContext,
  model: string | undefined,
  effort: string | undefined,
): Promise<CommandOutcome> {
  const slash = model?.indexOf('/') ?? -1
  const provider = model === undefined
    ? context.state.model.split('/')[0] ?? ''
    : slash > 0
      ? model.slice(0, slash)
      : context.state.model.split('/')[0] ?? ''
  const name = model === undefined
    ? context.state.model.split('/')[1] ?? ''
    : slash > 0
      ? model.slice(slash + 1)
      : model
  if (provider === '' || name === '') {
    return { ok: false, error: 'a model is required, for example /model deepseek-official/deepseek-chat' }
  }
  const selected = await context.client.sessions.selectModel({
    sessionId: context.sessionId,
    provider,
    model: name,
    ...(effort === undefined ? {} : { reasoningEffort: effort }),
  })
  if (!selected.result.ok) return { ok: false, error: selected.result.error.message }
  context.state.model = `${provider}/${name}`
  if (effort !== undefined) context.state.effort = effort
  return { ok: true, text: `model ${provider}/${name}${effort === undefined ? '' : ` (effort ${effort})`}` }
}

/** Read the conversation window the reading commands work on. */
async function conversation(context: LocalCommandContext): Promise<{ readonly events: readonly SessionEvent[]; readonly title: string | undefined } | undefined> {
  const read = await readHistoryEvents(context.client, context.sessionId, READING_HISTORY_LIMIT)
  if (read === undefined) return undefined
  return { events: read.events, title: read.title }
}

/** Put the last answer on the clipboard. */
async function copy(context: LocalCommandContext): Promise<CommandOutcome> {
  const read = await conversation(context)
  if (read === undefined) return { ok: false, error: 'could not read this session' }
  const text = lastAssistantText(read.events)
  if (text === undefined) return { ok: false, error: 'this session has no answer to copy' }
  const copied = await copyToClipboard(text)
  return copied
    ? { ok: true, text: `copied ${String(text.length)} characters` }
    : { ok: false, error: 'no clipboard helper is available on this platform' }
}

/** Search the conversation for a phrase. */
async function find(context: LocalCommandContext, argument: string): Promise<CommandOutcome> {
  if (argument.trim() === '') return { ok: false, error: '/find needs text, for example /find sandbox' }
  const read = await conversation(context)
  if (read === undefined) return { ok: false, error: 'could not read this session' }
  const matches = findInHistory(read.events, argument)
  if (matches.length === 0) return { ok: true, text: 'no matches in this conversation' }
  const lines = matches.map(match => `  #${String(match.seq)} ${match.role === 'you' ? 'You' : 'Assistant'}: ${match.snippet}`)
  context.write(`${lines.join('\n')}\n`)
  return { ok: true, text: `${String(matches.length)} match(es)` }
}

/** Write the conversation beside the working directory as markdown. */
async function transcript(context: LocalCommandContext, argument: string): Promise<CommandOutcome> {
  const read = await conversation(context)
  if (read === undefined) return { ok: false, error: 'could not read this session' }
  const written = await writeTranscript(read.events, {
    ...(read.title === undefined ? {} : { title: read.title }),
    sessionId: context.sessionId,
    ...(argument === '' ? {} : { output: argument }),
  })
  return { ok: true, text: `wrote ${written}` }
}

/**
 * Print one live panel.
 *
 * The fullscreen layout draws the same data into its own cells; this path is what
 * an inline session and a script get, and it is the reason the panel data lives
 * outside the renderer.
 * @param context - the surface state and the host services.
 * @param argument - panel name; empty means the session list.
 * @returns what the command did.
 */
async function panels(context: LocalCommandContext, argument: string): Promise<CommandOutcome> {
  const requested = argument.trim() === '' ? 'sessions' : argument.trim()
  if (!(PANEL_NAMES as readonly string[]).includes(requested)) {
    return { ok: false, error: `unknown panel ${requested}; expected ${PANEL_NAMES.join(', ')}` }
  }
  const name = requested as PanelName
  const snapshot = await readPanelSnapshot(context.client, context.sessionId)
  context.write(`${formatPanelSnapshot(snapshot, name).map(line => `  ${line}\n`).join('')}`)
  return { ok: true, text: `${name}${snapshot.complete ? '' : ' (no live baseline for jobs and queue)'}` }
}

/**
 * Run one local command.
 * @param line - the full command line, including the leading slash.
 * @param context - the surface state and the host gateway.
 * @returns what the command did, or a refusal for an unknown local name.
 */
export async function runLocalCommand(line: string, context: LocalCommandContext): Promise<CommandOutcome | undefined> {
  const { name, argument } = splitCommand(line)
  trace(`local /${name}`)
  switch (name) {
    case 'help': return await help(context)
    case 'status': return status(context)
    case 'model': return await model(context, argument)
    case 'effort': return await effort(context, argument)
    case 'mcp': {
      trace('mcp: reading')
      const servers = await readMcpServers(context.client)
      trace(`mcp: read ${String(servers.length)}`)
      context.write(formatMcpServers(servers).join(''))
      return { ok: true }
    }
    case 'skills': {
      trace('skills: reading')
      const view = await readSkills(context.client, context.sessionId)
      trace(`skills: read ${String(view.user.length)}`)
      context.write(formatSkills(view).join(''))
      return { ok: true }
    }
    case 'copy': return await copy(context)
    case 'find': return await find(context, argument)
    case 'transcript': return await transcript(context, argument)
    case 'panel': return { ok: false, error: 'the tabs modal needs an interactive terminal' }
    case 'panels': return await panels(context, argument)
    // A command that is listed for the palette but answered elsewhere (by the
    // surface or by the host) is not an error here: the router passes it on.
    default: return undefined
  }
}

/**
 * Route a line: the local commands answer it, everything else goes to the host.
 * @param line - the full command line, including the leading slash.
 * @param context - the surface state and the host gateway.
 * @param host - the host invocation the caller configured.
 * @returns what the command did.
 */
export async function routeCommand(
  line: string,
  context: LocalCommandContext,
  host: (line: string) => Promise<CommandOutcome>,
): Promise<CommandOutcome> {
  if (isLocalCommand(line)) {
    const local = await runLocalCommand(line, context)
    if (local !== undefined) return local
  }
  return await host(line)
}

/** Bind the host command registry for a session, for callers wiring the loop. */
export function hostCommandRunner(context: { readonly ctx: Context; readonly sessionId: SessionId }): (line: string) => Promise<CommandOutcome> {
  return async (line: string) => await executeCommand(context.ctx, context.sessionId, line)
}
