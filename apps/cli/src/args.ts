/**
 * Command line of the `kibborg` binary.
 *
 * The binary answers process-level commands itself (`version`, `help`,
 * `doctor`, the config dumps) and turns everything else into one
 * {@link ClientIntent}: a description of what the client half should do with
 * the harness — answer a task, list sessions, resume one, search, rename, or
 * fork. The intent travels to the tree as a launcher fact, so the client does
 * not re-parse argv.
 * @module @kibborg/cli/args
 */

import { Command, CommanderError } from 'commander'
import type { ClientIntent } from '@kibborg/client-node'

/** Extra patch-list overlays applied after the profile layer, in argv order. */
export type PatchList = readonly string[]

/** Boot the profile and hand it one intent. */
interface ClientInvocation {
  mode: 'client'
  patches: PatchList
  intent: ClientIntent
}

/** Print the composed profile tree and exit without booting. */
interface DumpConfigInvocation {
  mode: 'dump-config'
  /** Omit the profile's user layer and --patch overlays; print bundle layers only. */
  defaultOnly: boolean
  patches: PatchList
  /** Tool names to keep, so the dump shows the composition this invocation would boot. */
  readonly tools?: readonly string[]
  /** Tool names to disable. */
  readonly deny?: readonly string[]
}

/** Run the installation diagnostics. */
interface DoctorInvocation {
  mode: 'doctor'
  json: boolean
  fix: boolean
}

/** Print the version and exit. */
interface VersionInvocation {
  mode: 'version'
}

/** Find servers advertising themselves over mDNS and exit. */
export interface DiscoverInvocation {
  mode: 'discover'
  /** How long to listen for answers. */
  timeoutMs: number
  /** Print one JSON array instead of a table. */
  json: boolean
}

/** Serve the API gateway over HTTP for remote clients, until interrupted. */
export interface ServeInvocation {
  mode: 'serve'
  patches: PatchList
  /** Bind address; loopback unless the caller asked for more. */
  host: string
  /** TCP port to listen on. */
  port: number
  /**
   * Shared token every request must present. Absent means loopback-only
   * serving: a non-loopback bind without a token is refused before boot.
   */
  token?: string
  /** Authorities served beyond loopback, as `host:port` or a port-less `host`. */
  trustedHosts: readonly string[]
  /** Print one access-log line per request. */
  log: boolean
  /** Advertise this server over mDNS so `kibborg discover` finds it. */
  mdns: boolean
  /** Instance name for the mDNS record; empty derives one from the hostname. */
  instance?: string
}

/** The resolved `kibborg` invocation. Help and errors exit inside {@link parseKiborgArgs}. */
export type KiborgInvocation =
  | ClientInvocation
  | DumpConfigInvocation
  | DoctorInvocation
  | VersionInvocation
  | ServeInvocation
  | DiscoverInvocation

/**
 * Repeatable single-value collector: `--patch a.yml --patch b.yml`. Never
 * variadic — a variadic `--patch` would swallow the task text.
 */
const collect = (value: string, previous: string[] = []): string[] => [...previous, value]

/** Options shared by the task-shaped commands. */
interface SessionOptions {
  model?: string
  effort?: string
  permissionMode?: string
  safe?: boolean
  auto?: boolean
  yolo?: boolean
}

/**
 * Resolve the permission mode from the explicit flag and its shorthands.
 * @param command - the command that owns these options, for error reporting.
 * @param options - the parsed options.
 * @returns the resolved mode, or `undefined` when the deployment default applies.
 */
function permissionModeOf(command: Command, options: SessionOptions): string | undefined {
  // Commander stores a flag declared as `--yolo, --dangerously-skip-permissions`
  // under the LAST name it was given, so both spellings are read here.
  const yolo = options.yolo === true || (options as { dangerouslySkipPermissions?: boolean }).dangerouslySkipPermissions === true
  const shorthands = [options.safe === true, options.auto === true, yolo].filter(Boolean).length
  if (shorthands > 1) {
    command.error('error: --safe, --auto and --yolo are mutually exclusive')
  }
  const shorthand = yolo
    ? 'danger-full-access'
    : options.safe === true
      ? 'read-only'
      : options.auto === true
        ? 'workspace-write'
        : undefined
  if (options.permissionMode !== undefined && shorthand !== undefined) {
    command.error('error: --permission-mode conflicts with --safe/--auto/--yolo')
  }
  const mode = options.permissionMode ?? shorthand
  if (mode !== undefined && !SANDBOX_MODES.includes(mode)) {
    command.error(`error: unknown permission mode ${JSON.stringify(mode)}; expected ${SANDBOX_MODES.join(' | ')} (plan mode is a session mode: use the /plan command)`)
  }
  return mode
}

/** Attach the screen-mode flags the interactive start accepts. */
function withScreenFlags(command: Command): Command {
  return command
    .option('--fullscreen', 'repaint one frame on the alternate screen instead of using the scrollback')
    .option('--minimal', 'keep the inline layout and suppress animation')
}

/** Attach the headless/CI flags a print-shaped invocation accepts. */
function withHeadlessFlags(command: Command): Command {
  return command
    .option('-p, --print', 'headless: answer once and print machine-readable output')
    .option('--output-format <format>', 'output shape: text | json | stream-json')
    .option('--include-partial-messages', 'emit one line per streamed chunk (stream-json)')
    .option('--json-schema <path>', 'JSON Schema file the answer must satisfy')
    .option('--prompt-file <path>', 'read the task text from a file')
    .option('--max-turns <count>', 'stop after this many turns')
    .option('--no-session-persistence', 'hide the session from the lists when the run ends')
}

/** Read the screen-mode flags into the field they set on an intent. */
function screenOf(options: { fullscreen?: boolean; minimal?: boolean }): 'inline' | 'fullscreen' | 'minimal' | undefined {
  if (options.fullscreen === true && options.minimal === true) return 'inline'
  if (options.fullscreen === true) return 'fullscreen'
  if (options.minimal === true) return 'minimal'
  return undefined
}

/** Read the headless flags into the fields they set on an intent. */
function headlessFields(options: {
  print?: boolean
  outputFormat?: string
  includePartialMessages?: boolean
  jsonSchema?: string
  promptFile?: string
  maxTurns?: string
  sessionPersistence?: boolean
}): Partial<ClientIntent> {
  const fields: {
    print?: boolean
    outputFormat?: string
    includePartial?: boolean
    jsonSchema?: unknown
    promptFile?: string
    maxTurns?: number
    persistSession?: boolean
  } = {}
  if (options.print === true) fields.print = true
  if (options.outputFormat !== undefined) fields.outputFormat = options.outputFormat
  if (options.includePartialMessages === true) fields.includePartial = true
  if (options.jsonSchema !== undefined) fields.jsonSchema = readSchema(options.jsonSchema)
  if (options.promptFile !== undefined) fields.promptFile = options.promptFile
  const turns = options.maxTurns === undefined ? undefined : Number(options.maxTurns)
  if (turns !== undefined && !Number.isNaN(turns) && turns > 0) fields.maxTurns = turns
  if (options.sessionPersistence === false) fields.persistSession = false
  return fields
}

/** Read a schema argument: inline JSON when it parses, otherwise a file path. */
function readSchema(argument: string): unknown {
  try {
    return JSON.parse(argument)
  } catch {
    return { file: argument }
  }
}

/** The task-shaped intent both the bare form and `kibborg run` resolve to. */
function taskIntentOf(
  task: string[],
  options: {
    continue?: boolean
    worktree?: string | boolean
    file?: string[]
    questionAnswers?: string
    failOnQuestion?: boolean
    tools?: string
    allow?: string[]
    deny?: string[]
    model?: string
    effort?: string
  } & Parameters<typeof headlessFields>[0] & Parameters<typeof screenOf>[0],
  permissionMode: string | undefined,
): ClientIntent {
  return {
    kind: 'task',
    task: task.join(' ').trim(),
    ...(options.continue === true ? { continue: true } : {}),
    ...(options.worktree === undefined ? {} : { worktree: options.worktree === true ? '' : String(options.worktree) }),
    ...(options.file === undefined || options.file.length === 0 ? {} : { files: options.file }),
    ...(options.questionAnswers === undefined ? {} : { questionAnswers: options.questionAnswers }),
    ...(options.failOnQuestion === true ? { failOnQuestion: true } : {}),
    ...(options.tools === undefined && options.allow === undefined
      ? {}
      : {
        tools: [
          ...(options.tools ?? '').split(',').map(name => name.trim()).filter(name => name !== ''),
          ...(options.allow ?? []),
        ],
      }),
    ...(options.deny === undefined || options.deny.length === 0 ? {} : { deny: options.deny }),
    ...(options.model === undefined ? {} : { model: options.model }),
    ...(options.effort === undefined ? {} : { effort: options.effort }),
    ...(permissionMode === undefined ? {} : { permissionMode }),
    ...headlessFields(options),
    ...(screenOf(options) === undefined ? {} : { screen: screenOf(options) as string }),
  }
}

/** Sandbox modes the host accepts; `plan` is a session mode set by the `/plan` command. */
const SANDBOX_MODES: readonly string[] = ['read-only', 'workspace-write', 'danger-full-access']

/**
 * Read one command-line value as JSON when it parses, else as a string.
 * @param raw - the value exactly as the shell passed it.
 * @returns the parsed value, so `true`, `123`, and `{"a":1}` keep their types.
 */
function parseScalar(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

/** Attach the model, effort, and permission flags every session-shaped command accepts. */
function withSessionFlags(command: Command): Command {
  return command
    .option('--model <name>', 'model for this session, as provider/model or a bare model id')
    .option('--effort <level>', 'reasoning effort for the selected model')
    .option('--permission-mode <mode>', `sandbox mode: ${SANDBOX_MODES.join(' | ')}`)
    .option('--safe', 'shorthand for --permission-mode read-only')
    .option('--auto', 'shorthand for --permission-mode workspace-write')
    .option('--yolo, --dangerously-skip-permissions', 'shorthand for --permission-mode danger-full-access: no approvals')
}

const HELP_EXAMPLES = `
Examples:
  kibborg "проанализируй этот проект"     run one task and exit
  kibborg                                 start an interactive session
  echo "опиши проект" | kibborg           take the task from stdin
  kibborg --continue                      continue the newest session of this directory
  kibborg model --model deepseek-official/deepseek-v4-flash
                                          pin the model for this invocation
  kibborg --safe "review src/auth"        read-only, every write still asks
  kibborg sessions                        list recent sessions
  kibborg resume                          resume a session (picker when interactive)
  kibborg resume 8f31                     resume one session by id
  kibborg search "auth"                   search session content
  kibborg commands                        list the host's slash commands
  kibborg agents                          list the subagents of a session
  kibborg jobs                            list a session's background jobs
  kibborg rename 8f31 "auth review"       rename a session
  kibborg archive 8f31                    hide a session from the lists
  kibborg fork 8f31                       branch a session into a new one
  kibborg -w feat/auth "add token rotation"
                                          run the task in its own git worktree
  kibborg --file src/auth/jwt.ts "review this file"
                                          attach files to the task
  kibborg --tools "read,grep" "summarize the repo"
                                          keep only those tools for this run
  kibborg --deny web_search "work offline" disable one tool
  kibborg doctor                          diagnose the installation (read-only)
  kibborg doctor --fix                    repair what can be repaired, printing changes
  kibborg --dump-config                   print the composed profile tree
  kibborg version                         print the version
`

/**
 * Resolve argv into one invocation, or print and exit for help and errors.
 * @param argv - arguments after the Node binary and script.
 * @param version - version string printed by `version` and `--version`.
 * @returns the resolved invocation.
 */
export function parseKiborgArgs(argv: readonly string[], version: string): KiborgInvocation {
  let resolved: KiborgInvocation | undefined
  const program: Command = new Command()
  program
    .name('kibborg')
    .description('kibborg: the terminal surface of DeepSeek_Kibborg_Harness — the same agent core, tools, sessions and settings as the web GUI.')
    .version(version, '-v, --version', 'output the version number')
    .addHelpText('after', HELP_EXAMPLES)
    .exitOverride()
    // Flags after a subcommand's name belong to that subcommand: without this,
    // a `--print` declared on both the program and `attach` was claimed by the
    // program, and the subcommand saw no headless flags at all.
    .enablePositionalOptions()
    .option('--patch <path>', 'extra patch-list overlay applied after the profile layer (repeatable)', collect)
    .option('--dump-config', 'print the composed profile tree and exit')
    .option('--dump-default-config', 'print the profile tree without its user layer or --patch overlays and exit')
    .option('-c, --continue', 'continue the newest session of this directory')
    .option('-w, --worktree [name]', 'create a git worktree for this invocation and run inside it')
    .option('--file <path>', 'attach a file to the task (repeatable)', collect)
    .option('--question-answers <path>', 'answer the model\'s questions from a JSON document (headless)')
    .option('--fail-on-question', 'refuse instead of guessing when a question arrives without a terminal')
    .option('--tools <names>', 'comma-separated tool names to keep; every other tool is disabled')
    .option('--allow <tool>', 'additional tool to keep (repeatable)', collect)
    .option('--deny <tool>', 'tool to disable (repeatable)', collect)
    .argument('[task...]', 'the task text; every word is joined by spaces')
    .action((task: string[], options: {
      patch?: string[]
      dumpConfig?: boolean
      dumpDefaultConfig?: boolean
      continue?: boolean
      worktree?: string | boolean
      file?: string[]
      questionAnswers?: string
      failOnQuestion?: boolean
      tools?: string
      allow?: string[]
      deny?: string[]
      print?: boolean
      outputFormat?: string
      includePartialMessages?: boolean
      jsonSchema?: string
      promptFile?: string
      maxTurns?: string
      sessionPersistence?: boolean
    } & SessionOptions) => {
      const patches = options.patch ?? []
      if (patches.includes('')) program.error('error: --patch needs a path')
      if (options.dumpConfig === true && options.dumpDefaultConfig === true) {
        program.error('error: --dump-config and --dump-default-config are mutually exclusive')
      }
      if (options.dumpConfig === true || options.dumpDefaultConfig === true) {
        if (task.length > 0) {
          program.error(`error: config dumps take no task, got ${task.map(part => JSON.stringify(part)).join(' ')}`)
        }
        const defaultOnly = options.dumpDefaultConfig === true
        if (defaultOnly && patches.length > 0) {
          program.error('error: --dump-default-config prints the bundle layers and takes no --patch')
        }
        const toolNames = [
          ...(options.tools ?? '').split(',').map(name => name.trim()).filter(name => name !== ''),
          ...(options.allow ?? []),
        ]
        resolved = {
          mode: 'dump-config',
          defaultOnly,
          patches,
          ...(toolNames.length === 0 ? {} : { tools: toolNames }),
          ...(options.deny === undefined || options.deny.length === 0 ? {} : { deny: options.deny }),
        }
        return
      }
      const permissionMode = permissionModeOf(program, options)
      resolved = {
        mode: 'client',
        patches,
        intent: taskIntentOf(task, options, permissionMode),
      }
    })

  // The task-shaped root command accepts the same session flags as `resume`,
  // `fork`, and the rest: model, effort, and the permission presets — plus the
  // headless/CI flags, since `kibborg -p "task"` is the same run with a machine
  // contract on stdout.
  withScreenFlags(withHeadlessFlags(withSessionFlags(program)))

  // `run` is the same invocation as a bare task, not a command of its own: a
  // subcommand would re-declare every flag, and a repeated `-p`/`--output-format`
  // would be claimed by the parent parser before the subcommand saw it.
  const argvWithoutRun = argv[0] === 'run' ? argv.slice(1) : argv

  program
    .command('serve')
    .description('serve the API gateway over HTTP for remote kibborg clients')
    .option('--host <address>', 'bind address (default 127.0.0.1)', '127.0.0.1')
    .option('--port <port>', 'TCP port to listen on', '7317')
    .option('--token <secret>', 'shared token every request must present (or KIBBORG_SERVER_TOKEN)')
    .option('--trusted-host <authority>', 'authority served beyond loopback (repeatable)', collect)
    .option('--no-log', 'do not print an access log line per request')
    .option('--mdns', 'advertise this server on the local link so `kibborg discover` finds it')
    .option('--instance <name>', 'mDNS instance name (default kibborg-<hostname>)')
    .option('--patch <path>', 'additional overlay patch file (repeatable)', collect)
    .action((options: {
      host: string
      port: string
      token?: string
      trustedHost?: string[]
      log?: boolean
      mdns?: boolean
      instance?: string
      patch?: string[]
    }) => {
      const port = Number(options.port)
      if (!Number.isInteger(port) || port <= 0 || port > 65535) {
        program.error(`error: --port needs a TCP port, got ${JSON.stringify(options.port)}`)
      }
      resolved = {
        mode: 'serve',
        patches: options.patch ?? [],
        host: options.host,
        port,
        ...(options.token === undefined ? {} : { token: options.token }),
        trustedHosts: options.trustedHost ?? [],
        log: options.log !== false,
        mdns: options.mdns === true,
        ...(options.instance === undefined ? {} : { instance: options.instance }),
      }
    })

  program
    .command('discover')
    .description('find kibborg servers advertising themselves on the local link')
    .option('--timeout <seconds>', 'how long to listen for answers', '3')
    .option('--json', 'print one JSON array instead of a table')
    .action((options: { timeout: string; json?: boolean }) => {
      const seconds = Number(options.timeout)
      if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 60) {
        program.error(`error: --timeout needs seconds greater than 0 and at most 60, got ${JSON.stringify(options.timeout)}`)
      }
      resolved = { mode: 'discover', timeoutMs: Math.round(seconds * 1000), json: options.json === true }
    })

  withScreenFlags(withHeadlessFlags(withSessionFlags(program
    .command('attach <url> [task...]')
    .description('drive a running `kibborg serve` host from this terminal')
    .option('--token <secret>', 'token the server requires, when the URL does not carry it')
    .option('--patch <path>', 'additional overlay patch file (repeatable)', collect))))
    .action((url: string, task: string[] | undefined, options: {
      token?: string
      patch?: string[]
    } & Parameters<typeof headlessFields>[0] & Parameters<typeof screenOf>[0] & SessionOptions) => {
      const withToken = options.token === undefined || options.token === ''
        ? url
        : (() => {
          let parsed: URL
          try {
            parsed = new URL(url)
          } catch {
            program.error(`error: attach needs an http(s) URL, got ${JSON.stringify(url)}`)
            throw new Error('unreachable: program.error exits')
          }
          parsed.searchParams.set('token', options.token)
          return parsed.toString()
        })()
      const permissionMode = permissionModeOf(program, options)
      resolved = {
        mode: 'client',
        patches: options.patch ?? [],
        intent: {
          kind: 'attach',
          url: withToken,
          task: (task ?? []).join(' ').trim(),
          ...(options.model === undefined ? {} : { model: options.model }),
          ...(options.effort === undefined ? {} : { effort: options.effort }),
          ...(permissionMode === undefined ? {} : { permissionMode }),
          ...headlessFields(options),
          ...(screenOf(options) === undefined ? {} : { screen: screenOf(options) as string }),
        },
      }
    })

  program
    .command('version')
    .description('print the version')
    .action(() => { resolved = { mode: 'version' } })

  program
    .command('doctor')
    .description('diagnose the installation: runtime, built artifacts, profile, links, credentials, optional integrations')
    .option('--json', 'print one JSON report instead of readable lines')
    .option('--fix', 'apply the safe repairs and print what changed')
    .action((options: { json?: boolean; fix?: boolean }) => {
      resolved = { mode: 'doctor', json: options.json === true, fix: options.fix === true }
    })

  program
    .command('sessions')
    .description('list recent sessions')
    .option('--json', 'print one JSON array instead of a table')
    .addOption(new (program.constructor as typeof Command)().createOption('--patch <path>', 'extra patch-list overlay (repeatable)').argParser(collect))
    .action((options: { json?: boolean }) => {
      resolved = { mode: 'client', patches: [], intent: { kind: 'sessions', ...(options.json === true ? { json: true } : {}) } }
    })

  withSessionFlags(program
    .command('resume [sessionId]')
    .description('resume a session; without an id, continue the newest session of this directory')
    .option('--fork', 'branch the resumed session into a new one')
    .option('--history <messages>', 'how many history messages to print (default 200)')
    .option('-w, --worktree [name]', 'create a git worktree for this invocation and run inside it'))
    .action((sessionId: string | undefined, options: SessionOptions & { fork?: boolean; history?: string; worktree?: string | boolean }) => {
      const permissionMode = permissionModeOf(program, options)
      const historyLimit = options.history === undefined ? undefined : Number.parseInt(options.history, 10)
      resolved = {
        mode: 'client',
        patches: [],
        intent: {
          kind: 'resume',
          ...(sessionId === undefined ? { continue: true } : { sessionId }),
          ...(options.fork === true ? { fork: true } : {}),
          ...(historyLimit === undefined || Number.isNaN(historyLimit) ? {} : { historyLimit }),
          ...(options.worktree === undefined ? {} : { worktree: options.worktree === true ? '' : String(options.worktree) }),
          ...(options.model === undefined ? {} : { model: options.model }),
          ...(options.effort === undefined ? {} : { effort: options.effort }),
          ...(permissionMode === undefined ? {} : { permissionMode }),
        },
      }
    })

  program
    .command('archive <sessionId>')
    .description('hide a session from the session lists without deleting its log')
    .action((sessionId: string) => {
      resolved = { mode: 'client', patches: [], intent: { kind: 'archive', sessionId } }
    })

  program
    .command('agents [sessionId]')
    .description('list the subagents a session spawned')
    .option('--json', 'print one JSON array instead of a list')
    .action((sessionId: string | undefined, options: { json?: boolean }) => {
      resolved = {
        mode: 'client',
        patches: [],
        intent: {
          kind: 'agents',
          ...(sessionId === undefined ? {} : { sessionId }),
          ...(options.json === true ? { json: true } : {}),
        },
      }
    })

  program
    .command('jobs [sessionId]')
    .description('list the background jobs a session can see')
    .option('--json', 'print one JSON array instead of a list')
    .action((sessionId: string | undefined, options: { json?: boolean }) => {
      resolved = {
        mode: 'client',
        patches: [],
        intent: {
          kind: 'jobs',
          ...(sessionId === undefined ? {} : { sessionId }),
          ...(options.json === true ? { json: true } : {}),
        },
      }
    })

  program
    .command('commands')
    .description('list the slash commands the host registry offers')
    .option('--json', 'print one JSON array instead of a list')
    .action((options: { json?: boolean }) => {
      resolved = { mode: 'client', patches: [], intent: { kind: 'commands', ...(options.json === true ? { json: true } : {}) } }
    })

  program
    .command('stats [sessionId]')
    .description('summarize the tokens, turns, and tools of one session')
    .option('--json', 'print one JSON object instead of a table')
    .action((sessionId: string | undefined, options: { json?: boolean }) => {
      resolved = {
        mode: 'client',
        patches: [],
        intent: {
          kind: 'stats',
          ...(sessionId === undefined ? {} : { sessionId }),
          ...(options.json === true ? { json: true } : {}),
        },
      }
    })

  program
    .command('settings [sub] [ns] [path] [value]')
    .description('read and edit settings namespaces: list, show, set, unset')
    .option('--json', 'print JSON instead of a table')
    .action((sub: string | undefined, ns: string | undefined, path: string | undefined, value: string | undefined, options: { json?: boolean }) => {
      resolved = {
        mode: 'client',
        patches: [],
        intent: {
          kind: 'settings',
          ...(sub === undefined ? {} : { sub }),
          ...(ns === undefined ? {} : { ns }),
          ...(path === undefined ? {} : { path }),
          ...(value === undefined ? {} : { value: parseScalar(value) }),
          ...(options.json === true ? { json: true } : {}),
        },
      }
    })

  program
    .command('auth [sub] [ref]')
    .description('show credential state; set or unset reads the value from stdin')
    .option('--json', 'print JSON instead of a table')
    .action((sub: string | undefined, ref: string | undefined, options: { json?: boolean }) => {
      resolved = {
        mode: 'client',
        patches: [],
        intent: {
          kind: 'auth',
          ...(sub === undefined ? {} : { sub }),
          ...(ref === undefined ? {} : { ref }),
          ...(options.json === true ? { json: true } : {}),
        },
      }
    })

  program
    .command('tools')
    .description('list the tools this composition mounts')
    .option('--json', 'print one JSON array instead of a table')
    .action((options: { json?: boolean }) => {
      resolved = { mode: 'client', patches: [], intent: { kind: 'tools', ...(options.json === true ? { json: true } : {}) } }
    })

  program
    .command('models')
    .description('list configured model providers and their models')
    .option('--json', 'print one JSON document instead of a table')
    .action((options: { json?: boolean }) => {
      resolved = { mode: 'client', patches: [], intent: { kind: 'models', ...(options.json === true ? { json: true } : {}) } }
    })

  program
    .command('mcp [sub] [name]')
    .description('list, add, or remove MCP servers')
    .option('--command <executable>', 'stdio server executable (mcp add)')
    .option('--arg <value...>', 'arguments for the stdio server')
    .option('--url <endpoint>', 'streamable-HTTP endpoint (mcp add)')
    .option('--env <pair...>', 'extra environment variables, as K=V')
    .option('--cwd <dir>', 'working directory for the stdio server')
    .option('--disabled', 'declare the server disabled')
    .option('--json', 'print JSON instead of a table')
    .action((sub: string | undefined, name: string | undefined, options: {
      command?: string
      arg?: string[]
      url?: string
      env?: string[]
      cwd?: string
      disabled?: boolean
      json?: boolean
    }) => {
      resolved = {
        mode: 'client',
        patches: [],
        intent: {
          kind: 'mcp',
          ...(sub === undefined ? {} : { sub }),
          ...(name === undefined ? {} : { name }),
          ...(options.command === undefined ? {} : { command: options.command }),
          ...(options.arg === undefined ? {} : { args: options.arg }),
          ...(options.url === undefined ? {} : { url: options.url }),
          ...(options.env === undefined ? {} : { env: options.env }),
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          ...(options.disabled === true ? { disabled: true } : {}),
          ...(options.json === true ? { json: true } : {}),
        },
      }
    })

  program
    .command('skills [sub] [name] [version]')
    .description('list, inspect, edit, and benchmark the managed skills')
    .option('--scope <scope>', 'save scope: user | project | agents')
    .option('--replace', 'replace an existing managed skill')
    .option('--force', 'save despite a blocked security verdict')
    .option('--model <route>', 'benchmark task model, as provider/model')
    .option('--evaluator <route>', 'benchmark evaluator model, as provider/model')
    .option('--cases <count>', 'benchmark case count')
    .option('--run <runId>', 'benchmark run id for status and cancel')
    .option('--json', 'print JSON instead of a table')
    .action((sub: string | undefined, name: string | undefined, version: string | undefined, options: {
      scope?: string
      replace?: boolean
      force?: boolean
      model?: string
      evaluator?: string
      cases?: string
      run?: string
      json?: boolean
    }) => {
      const cases = options.cases === undefined ? undefined : Number(options.cases)
      resolved = {
        mode: 'client',
        patches: [],
        intent: {
          kind: 'skills',
          ...(sub === undefined ? {} : { sub }),
          ...(name === undefined ? {} : { name }),
          ...(version === undefined ? {} : { version }),
          ...(options.scope === undefined ? {} : { scope: options.scope }),
          ...(options.model === undefined ? {} : { model: options.model }),
          ...(options.evaluator === undefined ? {} : { evaluator: options.evaluator }),
          ...(cases === undefined || Number.isNaN(cases) ? {} : { cases }),
          ...(options.run === undefined ? {} : { runId: options.run }),
          ...(options.replace === true ? { replace: true } : {}),
          ...(options.force === true ? { force: true } : {}),
          ...(options.json === true ? { json: true } : {}),
        },
      }
    })

  program
    .command('export [sessionId]')
    .description('write one session log to a ZIP file')
    .option('-o, --output <path>', 'destination file')
    .option('--with-descendants', 'include subagent descendant logs')
    .action((sessionId: string | undefined, options: { output?: string; withDescendants?: boolean }) => {
      resolved = {
        mode: 'client',
        patches: [],
        intent: {
          kind: 'export',
          ...(sessionId === undefined ? {} : { sessionId }),
          ...(options.output === undefined ? {} : { output: options.output }),
          ...(options.withDescendants === true ? { includeDescendants: true } : {}),
        },
      }
    })

  program
    .command('search <query>')
    .description('search session content')
    .option('--json', 'print one JSON array instead of a table')
    .action((query: string, options: { json?: boolean }) => {
      resolved = { mode: 'client', patches: [], intent: { kind: 'search', query, ...(options.json === true ? { json: true } : {}) } }
    })

  program
    .command('rename <sessionId> <title>')
    .description('rename a session')
    .action((sessionId: string, title: string) => {
      resolved = { mode: 'client', patches: [], intent: { kind: 'rename', sessionId, title } }
    })

  withSessionFlags(program
    .command('fork [sessionId]')
    .description('branch a session into a new one'))
    .action((sessionId: string | undefined, options: SessionOptions) => {
      const permissionMode = permissionModeOf(program, options)
      resolved = {
        mode: 'client',
        patches: [],
        intent: {
          kind: 'fork',
          ...(sessionId === undefined ? { continue: true } : { sessionId }),
          ...(options.model === undefined ? {} : { model: options.model }),
          ...(options.effort === undefined ? {} : { effort: options.effort }),
          ...(permissionMode === undefined ? {} : { permissionMode }),
        },
      }
    })

  try {
    program.parse([...argvWithoutRun], { from: 'user' })
  } catch (error) {
    return process.exit(error instanceof CommanderError ? error.exitCode : 1)
  }
  /* v8 ignore next -- an action resolves or Commander throws */
  if (resolved === undefined) throw new Error('kibborg: no invocation resolved')
  return resolved
}
