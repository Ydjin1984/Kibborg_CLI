/**
 * `@kibborg/client-node` — the terminal surface's client half.
 *
 * It builds the isomorphic in-process API client over `ctx.apiProxy`, so the
 * CLI reaches the same Remote contract the browser uses without a server, a
 * socket, or a port, and it drives the three ways a task arrives:
 *
 * - a task argument — answer it once and exit;
 * - no argument on a terminal — the interactive loop (`repl.ts`);
 * - no argument with piped stdin — read the whole stream as the task.
 *
 * Model and effort come from this invocation's environment (`KIBBORG_MODEL`,
 * `KIBBORG_EFFORT`) until the argument-service phase moves them onto a service;
 * the permission mode is applied by the launcher before the tree mounts, through
 * `DSH_PERMISSION_MODE`.
 * @module @kibborg/client-node
 */

import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-cmdline'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { InProcessApiClient, toFetchHandler } from '@deepseek-ai/dsh-host-apiproxy'
import type { IApiClient } from '@deepseek-ai/dsh-host-apiproxy/client'
import { paletteForTheme, statusLine } from '@kibborg/tui'
import { LOCAL_COMMANDS, nearestCommand, routeCommand, splitCommand, type SurfaceState } from './command-router.ts'
import { emptyCompletionSources, fillCompletionSources } from './completion-sources.ts'
import { exportSessionLog } from './export-session.ts'
import { readIntent } from './intent.ts'
import { createHeadlessWriter, parseStructured, type OutputFormat } from './headless.ts'
import { runFullscreen } from './fullscreen.ts'
import { openPanel, type PanelSession, type PanelState } from './panel.ts'
import { runRegistryCommand } from './registry-command.ts'
import { runMcpCommand } from './mcp-command.ts'
import { runSkillsCommand } from './skills-command.ts'
import { executeCommand, listCommands, type CommandOutcome } from './remote.ts'
import { parseAttachTarget, RemoteApiClient } from './remote-client.ts'
import { runInteractive } from './repl.ts'
import { printHistory, resolveSession, runSessionCommand } from './sessions.ts'
import { runSettingsCommand } from './settings-command.ts'
import { readSurfaceSettings } from './surface-settings.ts'
import { formatTools, listTools } from './tools-command.ts'
import { runTurn, type TurnOutcome } from './turn.ts'
import type { ClientIntent } from './types.ts'

/** Stable Cordis plugin name. */
export const name = 'kibborg-client-node'

/** Services required before the client transport can be built. */
export const inject = ['apiProxy', 'cmdlineArgs']

export type { ClientIntent } from './types.ts'

/** What the status line shows about the invocation. */
interface InvocationBadge {
  readonly model: string
  readonly mode: string
}

/** Map the launcher's permission mode onto the status badge. */
function modeBadge(mode: string | undefined): string {
  switch (mode) {
    case 'read-only': return 'Ask'
    case 'plan': return 'Plan'
    case 'danger-full-access': return 'YOLO'
    case 'workspace-write': return 'Agent'
    case undefined: return 'Agent'
    default: return mode
  }
}

/** The Harness home, honouring `DSH_HOME` before the platform default. */
function dshHome(): string {
  const configured = process.env['DSH_HOME']
  return configured === undefined || configured === '' ? join(homedir(), '.dsh') : configured
}

/** Current branch and dirty flag, or `undefined` outside a repository. */
function gitState(cwd: string): { branch: string; dirty: boolean } | undefined {
  const head = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, encoding: 'utf8' })
  if (head.status !== 0) return undefined
  const branch = String(head.stdout).trim()
  if (branch === '') return undefined
  const status = spawnSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf8' })
  return { branch, dirty: status.status === 0 && String(status.stdout).trim() !== '' }
}

/** Report one failure on stderr and request the matching exit code. */
function fail(ctx: Context, message: string, code: number): void {
  process.stderr.write(`kibborg: ${message}\n`)
  ctx.appExit?.(code)
}

/** Read all of stdin as one task. */
async function readStdin(): Promise<string> {
  const chunks: string[] = []
  for await (const chunk of process.stdin) chunks.push(String(chunk))
  return chunks.join('').trim()
}

/**
 * Resolve the task text of this invocation.
 *
 * A prompt file is read before stdin is considered: a CI job that passed
 * `--prompt-file` still has stdin connected to something, and reading it would
 * answer a different question than the one asked.
 * @param task - the argv-provided task text, empty when none was given.
 * @param intent - the resolved intent, which may name a prompt file.
 * @returns the task text, or an empty string when the invocation named none.
 */
async function taskText(task: string, intent: ClientIntent | undefined): Promise<string> {
  const file = intent?.promptFile
  if (file !== undefined && file !== '') {
    try {
      return (await readFile(file, 'utf8')).trim()
    } catch (error) {
      process.stderr.write(`kibborg: could not read --prompt-file ${file}: ${error instanceof Error ? error.message : String(error)}\n`)
      return ''
    }
  }
  return task === '' ? await readStdin() : task
}

/** Read the screen mode the launcher asked for, defaulting to inline. */
function screenModeOf(value: string | undefined): 'inline' | 'fullscreen' | 'minimal' {
  return value === 'fullscreen' || value === 'minimal' ? value : 'inline'
}

/** The live surface state both the loop and a one-shot command read. */
function surfaceStateOf(
  badge: InvocationBadge,
  git: { branch: string; dirty: boolean } | undefined,
): SurfaceState {
  const effort = process.env['KIBBORG_EFFORT']
  return {
    model: badge.model,
    effort: effort === undefined || effort === '' ? undefined : effort,
    mode: badge.mode,
    contextPercent: 0,
    branch: git?.branch,
    dirty: git?.dirty,
  }
}

/**
 * Apply the permission preset this invocation asked for.
 *
 * `DSH_PERMISSION_MODE` alone is not enough: a session's sandbox mode is pinned
 * from the stored preset, which outranks the environment, so `--safe` on a
 * deployment whose saved preset is `danger-full-access` would otherwise run
 * unrestricted. `/permission` is the one write path that decision has, and it
 * records the choice in the session log where the next reader can see it.
 * @param ctx - host context carrying the command gateway.
 * @param sessionId - the session the preset applies to.
 * @param mode - the preset name the launcher resolved.
 * @returns whether the preset was accepted.
 */
async function applyPermissionMode(ctx: Context, sessionId: SessionId, mode: string): Promise<boolean> {
  const outcome = await executeCommand(ctx, sessionId, `/permission ${mode}`)
  if (outcome.ok) return true
  // A refused preset must not be shrugged off: the caller asked for a
  // restriction, and continuing would run the session unrestricted.
  process.stderr.write(`kibborg: could not apply permission mode ${mode}: ${outcome.error ?? 'command failed'}\n`)
  return false
}

/**
 * Build the client this invocation talks through and dispatch it.
 *
 * An `attach` invocation reaches a running server over the network; every other
 * shape reaches the host in this process. The difference stops here: the rest of
 * this module works against the client interface alone.
 * @param ctx - Cordis context carrying the API proxy and the command line.
 */
export function apply(ctx: Context): void {
  let intent: ClientIntent | undefined
  try {
    intent = readIntent()
  } catch (error) {
    fail(ctx, error instanceof Error ? error.message : String(error), 2)
    return
  }
  let client: IApiClient
  if (intent?.kind === 'attach') {
    try {
      client = new RemoteApiClient(parseAttachTarget(intent.url ?? ''))
    } catch (error) {
      fail(ctx, error instanceof Error ? error.message : String(error), 2)
      return
    }
  } else {
    client = new InProcessApiClient(toFetchHandler(ctx.apiProxy))
  }
  const task = (ctx.cmdlineArgs?.get() ?? []).join(' ').trim()
  void run(ctx, client, task, intent)
}

/**
 * Resolve the session, then answer the task in the mode this invocation asked for.
 * @param ctx - Cordis context owning the process exit request.
 * @param client - the API client this invocation talks through.
 * @param task - the task text, empty when the caller starts an interactive session.
 * @param intent - the resolved invocation intent.
 */
async function run(ctx: Context, client: IApiClient, task: string, intent: ClientIntent | undefined): Promise<void> {
  // Host commands live in the host that owns the session. An attached client is
  // not that host, so its slash lines resolve to local commands only.
  const attached = intent?.kind === 'attach'

  // The command catalog is a property of a session's composition, so it needs a
  // session to ask; nothing else about this invocation needs one.
  if (intent?.kind === 'commands') {
    const created = await client.sessions.create({ cwd: process.cwd() })
    if (!created.result.ok) {
      fail(ctx, `session.create failed: ${created.result.error.message}`, 1)
      return
    }
    const entries = await listCommands(ctx, created.result.value.sessionId)
    if (intent.json === true) {
      process.stdout.write(`${JSON.stringify(entries, undefined, 2)}\n`)
    } else if (entries.length === 0) {
      process.stdout.write('  no commands\n')
    } else {
      for (const entry of entries) {
        const aliases = entry.aliases === undefined || entry.aliases.length === 0 ? '' : `  (${entry.aliases.join(', ')})`
        process.stdout.write(`  /${entry.name}${aliases}   ${entry.description ?? ''}\n`)
      }
    }
    ctx.appExit?.(0)
    return
  }

  // Configuration reads and writes go through the same settings and credential
  // domains the Web Settings pages use, so both surfaces share one document.
  if (intent?.kind === 'settings' || intent?.kind === 'auth') {
    ctx.appExit?.(await runSettingsCommand(client, intent))
    return
  }

  // The mounted tool set is a property of this composition, not of a session.
  if (intent?.kind === 'tools') {
    const tools = listTools(ctx)
    process.stdout.write(intent.json === true
      ? `${JSON.stringify(tools, undefined, 2)}\n`
      : formatTools(tools).join(''))
    ctx.appExit?.(0)
    return
  }

  // Registry commands answer from the host's own catalogs and never open a turn.
  if (intent?.kind === 'mcp') {
    ctx.appExit?.(await runMcpCommand(client, intent))
    return
  }
  if (intent?.kind === 'skills') {
    const created = await client.sessions.create({ cwd: process.cwd() })
    if (!created.result.ok) {
      fail(ctx, `session.create failed: ${created.result.error.message}`, 1)
      return
    }
    ctx.appExit?.(await runSkillsCommand(client, intent, created.result.value.sessionId))
    return
  }
  if (intent?.kind === 'models' || intent?.kind === 'stats') {
    ctx.appExit?.(await runRegistryCommand(client, intent))
    return
  }

  // The export surface streams the same archive the browser saves, so it needs
  // neither a session of its own nor a turn.
  if (intent?.kind === 'export') {
    ctx.appExit?.(await exportSessionLog(ctx, client, {
      ...(intent.sessionId === undefined ? {} : { sessionId: intent.sessionId }),
      ...(intent.output === undefined ? {} : { output: intent.output }),
      ...(intent.includeDescendants === true ? { includeDescendants: true } : {}),
    }))
    return
  }

  // Session-shaped commands answer themselves and never open a turn; `resume`
  // is not one of them — it resolves a session and then behaves like a task.
  if (intent !== undefined && intent.kind !== 'task' && intent.kind !== 'resume' && intent.kind !== 'attach') {
    const result = await runSessionCommand(client, intent)
    ctx.appExit?.(result.code)
    return
  }

  const wantsExisting = intent?.kind === 'resume'
    || intent?.continue === true
    || (intent?.sessionId !== undefined && intent.sessionId !== '')
  let sessionId: SessionId
  if (wantsExisting) {
    const resolved = await resolveSession(client, intent?.sessionId)
    if (resolved === undefined) {
      fail(ctx, 'no session found to continue; run a task first or pass a session id', 1)
      return
    }
    sessionId = resolved.sessionId
    // Another process already has this session attached: the mux stream belongs
    // to one consumer, so say so instead of silently competing for it.
    if (resolved.running === true && intent?.fork !== true) {
      process.stderr.write(`kibborg: ${sessionId} is already running in another process; this run attaches a second consumer\n`)
    }
    if (intent?.fork === true) {
      const forked = await client.sessions.fork({ sessionId })
      if (!forked.result.ok) {
        fail(ctx, `session.fork failed: ${forked.result.error.message}`, 1)
        return
      }
      sessionId = forked.result.value.sessionId
    }
  } else {
    const created = await client.sessions.create({ cwd: process.cwd() })
    if (!created.result.ok) {
      fail(ctx, `session.create failed: ${created.result.error.message}`, 1)
      return
    }
    sessionId = created.result.value.sessionId
  }

  const badge = await resolveBadge(client, sessionId)
  const git = gitState(process.cwd())

  // The launcher's explicit mode wins over the stored preset for this session.
  const requestedMode = intent?.permissionMode
  if (requestedMode !== undefined && requestedMode !== '') {
    if (!await applyPermissionMode(ctx, sessionId, requestedMode)) {
      ctx.appExit?.(1)
      return
    }
  }

  // Resuming shows where the conversation stands before it continues.
  if (intent?.kind === 'resume') {
    const shown = await printHistory(client, sessionId, intent.historyLimit)
    if (shown !== 0) {
      ctx.appExit?.(shown)
      return
    }
    if (task === '' && process.stdin.isTTY !== true) {
      ctx.appExit?.(0)
      return
    }
  }

  if (task === '' && process.stdin.isTTY === true) {
    const surface = await readSurfaceSettings(client)
    const state = surfaceStateOf(badge, git)
    const hostEntries = attached ? [] : await listCommands(ctx, sessionId)
    // Only the command names are needed to open the surface; the candidate scan
    // waits for the first Tab, so a large working directory and a long session
    // history do not delay the first frame.
    const sources = emptyCompletionSources([
      ...LOCAL_COMMANDS.map(command => command.name),
      ...hostEntries.map(entry => entry.name),
    ])
    const fillSources = async (): Promise<void> => {
      await fillCompletionSources(client, { cwd: process.cwd(), sources })
    }
    const panel: { open(): Promise<PanelState>; readonly session: PanelSession } = {
      open: () => openPanel({ ctx, client, sessionId, write: chunk => void process.stdout.write(chunk) }),
      session: { ctx, client, sessionId, write: chunk => void process.stdout.write(chunk) },
    }
    const surfaceSettings = intent?.screen === undefined ? surface : { ...surface, screen: screenModeOf(intent.screen) }
    if (surfaceSettings.screen === 'fullscreen') {
      const fullscreen = await runFullscreen({
        client,
        sessionId,
        state,
        settings: surfaceSettings,
        home: dshHome(),
        sources,
        fillSources,
        panel,
        onCommand: (line, write) => routeCommand(line, {
          ctx,
          client,
          sessionId,
          write,
          state,
        }, hostLine => hostCommand(ctx, attached, sessionId, hostLine)),
      })
      // A terminal that cannot enter the alternate buffer keeps working: the
      // inline loop is the fallback, never a failure.
      if (fullscreen !== 'unsupported') {
        ctx.appExit?.(fullscreen)
        return
      }
      process.stderr.write('kibborg: this terminal cannot enter the alternate screen; staying inline\n')
    }
    const code = await runInteractive({
      client,
      sessionId,
      state,
      home: dshHome(),
      settings: surfaceSettings,
      sources,
      fillSources,
      panel,
      onCommand: (line, write) => routeCommand(line, {
        ctx,
        client,
        sessionId,
        write,
        state,
      }, hostLine => hostCommand(ctx, attached, sessionId, hostLine)),
    })
    ctx.appExit?.(code)
    return
  }

  const text = await taskText(task, intent)
  if (text === '') {
    process.stderr.write('kibborg: a task is required, for example: kibborg "hello"\n')
    ctx.appExit?.(2)
    return
  }
  // A line that opens with a slash is a command only when one is registered
  // under that name; anything else — a skill invocation, most of all — is a
  // prompt the host's pre-step boundary expands.
  if (text.startsWith('/')) {
    const registered = attached ? [] : await listCommands(ctx, sessionId)
    const names = new Set([...LOCAL_COMMANDS.map(command => command.name), ...registered.map(entry => entry.name)])
    const typed = splitCommand(text).name
    // Commands that exist only where a terminal owns the session cannot run here:
    // a one-shot run has nothing to switch, so it says so instead of prompting.
    const interactiveOnly = new Set(['new', 'resume', 'sessions', 'quit'])
    if (interactiveOnly.has(typed)) {
      process.stderr.write(`kibborg: /${typed} works in an interactive session; start kibborg without -p\n`)
      ctx.appExit?.(2)
      return
    }
    if (names.has(typed)) {
      // The surface's own commands answer themselves here too: a one-shot
      // `/status` is the same request as the one typed at the composer.
      const state = surfaceStateOf(badge, git)
      const outcome = await routeCommand(text, {
        ctx,
        client,
        sessionId,
        write: chunk => void process.stdout.write(chunk),
        state,
      }, hostLine => hostCommand(ctx, attached, sessionId, hostLine))
      if (!outcome.ok) process.stderr.write(`kibborg: ${outcome.error ?? 'command failed'}\n`)
      else if (outcome.text !== undefined) process.stdout.write(`  ${outcome.text}\n`)
      ctx.appExit?.(outcome.ok ? 0 : 1)
      return
    }
    // A near miss is a typo, not a prompt: sending `/statuss` to the model would
    // start a paid turn the user never asked for.
    const suggestion = nearestCommand(text, [...names])
    if (suggestion !== undefined) {
      process.stderr.write(`kibborg: unknown command /${typed} — did you mean /${suggestion}?\n`)
      ctx.appExit?.(2)
      return
    }
  }
  await answerOnce(ctx, client, sessionId, badge, git, text, intent)
}

/**
 * Run one host-registry command, or refuse when the host is another process.
 * @param ctx - host context carrying the command gateway.
 * @param attached - whether this invocation talks to a remote server.
 * @param sessionId - the session the command addresses.
 * @param line - the full command line.
 * @returns what the command did, or the refusal.
 */
async function hostCommand(ctx: Context, attached: boolean, sessionId: SessionId, line: string): Promise<CommandOutcome> {
  if (attached) {
    return { ok: false, error: 'host commands run in the host process, which this attached session does not own' }
  }
  return await executeCommand(ctx, sessionId, line)
}

/** Answer one task, print the footer and status line, and request the exit code. */
async function answerOnce(
  ctx: Context,
  client: IApiClient,
  sessionId: SessionId,
  badge: InvocationBadge,
  git: { branch: string; dirty: boolean } | undefined,
  task: string,
  intent: ClientIntent | undefined,
): Promise<void> {
  const surface = await readSurfaceSettings(client)
  const palette = paletteForTheme(surface.theme, process.env, process.stdout.isTTY === true)
  const cols = process.stdout.columns ?? 88
  const controller = new AbortController()
  const files = intent?.files
  const headless = intent?.questionAnswers === undefined
    ? { policy: 'fail' as const }
    : { policy: 'answers-file' as const, answersFile: intent.questionAnswers }
  // A machine contract moves every human-oriented line to stderr, so stdout
  // carries the answer and nothing else.
  const machine = machineOutputOf(intent)
  const writer = machine === undefined
    ? undefined
    : createHeadlessWriter({
      format: machine.format,
      includePartial: intent?.includePartial === true,
      sessionId,
      model: badge.model,
      startedAt: Date.now(),
    })
  const outcome: TurnOutcome = await runTurn({
    client,
    sessionId,
    task,
    palette,
    sink: writer === undefined
      ? { write: chunk => void process.stdout.write(chunk) }
      : { write: chunk => void process.stderr.write(chunk) },
    cols,
    signal: controller.signal,
    questions: headless,
    ...(files === undefined ? {} : { files }),
    ...(surface.timestamps ? { timestamps: true } : {}),
    ...(writer === undefined ? {} : { onEvent: writer.onEvent }),
    ...(intent?.maxTurns === undefined ? {} : { maxTurns: intent.maxTurns }),
  })
  // A run that asked not to be persisted leaves the session lists after it
  // finishes: the log stays on disk, but nothing lists it as a conversation.
  if (intent?.persistSession === false) {
    const archived = await client.workspace.archiveSession({ sessionId })
    if (!archived.result.ok) {
      process.stderr.write(`kibborg: session.archive failed: ${archived.result.error.message}\n`)
    }
  }
  if (writer !== undefined) {
    const schema = await resolveSchema(intent?.jsonSchema)
    // A schema the launcher cannot read is a configuration error, not a warning:
    // silently skipping the check would report success for an unvalidated answer.
    if (schema === null) {
      ctx.appExit?.(2)
      return
    }
    const code = writer.finish(outcome)
    const structured = schema === undefined ? undefined : parseStructured(outcome.answer, schema)
    if (structured?.error !== undefined) {
      process.stderr.write(`kibborg: ${structured.error}\n`)
      ctx.appExit?.(1)
      return
    }
    ctx.appExit?.(code)
    return
  }
  process.stdout.write(`${statusLine({
    model: badge.model,
    contextPercent: outcome.contextPercent,
    turnSeconds: outcome.seconds,
    mode: badge.mode,
    cols,
    ...(git === undefined ? {} : { branch: git.branch, dirty: git.dirty }),
  }, palette)}\n`)
  ctx.appExit?.(outcome.kind === 'error' || outcome.kind === 'max-turns'
    ? 1
    : outcome.kind === 'aborted'
      ? 130
      : outcome.kind === 'needs-input'
        ? 3
        : 0)
}

/** The output shape a print-shaped invocation asked for, or `undefined`. */
function machineOutputOf(intent: ClientIntent | undefined): { readonly format: OutputFormat } | undefined {
  const requested = intent?.outputFormat
  const print = intent?.print === true
  if (requested === undefined && !print) return undefined
  const format = requested ?? 'text'
  if (format !== 'text' && format !== 'json' && format !== 'stream-json') {
    process.stderr.write(`kibborg: unknown output format ${JSON.stringify(format)}; expected text | json | stream-json\n`)
    return { format: 'text' }
  }
  return { format }
}

/**
 * Read a schema the launcher left as a path, or pass an inline one through.
 * @param schema - the inline schema, or `{ file }` pointing at one.
 * @returns the parsed schema, `undefined` when there is none, or `null` when the
 * file exists in the request but cannot be read — the caller then fails the run.
 */
async function resolveSchema(schema: unknown): Promise<unknown> {
  if (schema === null || typeof schema !== 'object') return undefined
  const file = (schema as { file?: unknown }).file
  if (typeof file !== 'string') return schema
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch (error) {
    process.stderr.write(`kibborg: could not read --json-schema ${file}: ${error instanceof Error ? error.message : String(error)}\n`)
    return null
  }
}

/** Resolve the model name the status line shows, honouring `KIBBORG_MODEL`. */
async function resolveBadge(client: IApiClient, sessionId: SessionId): Promise<InvocationBadge> {
  const requested = process.env['KIBBORG_MODEL']
  const effort = process.env['KIBBORG_EFFORT']
  const models = await client.sessions.models({ sessionId })
  const current = models.result.ok ? models.result.value.current : undefined
  let model = current === undefined ? 'unknown' : `${current.provider}/${current.model}`
  if (requested !== undefined && requested !== '') {
    const slash = requested.indexOf('/')
    const provider = slash > 0 ? requested.slice(0, slash) : current?.provider
    const name = slash > 0 ? requested.slice(slash + 1) : requested
    if (provider !== undefined && provider !== '' && name !== '') {
      const selected = effort === undefined || effort === ''
        ? await client.sessions.selectModel({ sessionId, provider, model: name })
        : await client.sessions.selectModel({ sessionId, provider, model: name, reasoningEffort: effort })
      if (selected.result.ok) model = `${provider}/${name}`
    }
  }
  return { model, mode: modeBadge(process.env['DSH_PERMISSION_MODE']) }
}
