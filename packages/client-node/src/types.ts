/**
 * The invocation intent shared by the launcher and the client half.
 *
 * The type lives here because the client is its consumer: the binary parses
 * argv and serializes one of these onto `KIBBORG_INTENT`, and the client reads
 * it back. Keeping it in the client package avoids a dependency from the client
 * onto the launcher.
 * @module @kibborg/client-node/types
 */

/** What the client half should do. */
export interface ClientIntent {
  /** The operation; `task` also covers a bare interactive start. */
  readonly kind: 'task' | 'sessions' | 'resume' | 'search' | 'rename' | 'fork' | 'archive' | 'agents' | 'jobs' | 'commands'
    | 'models' | 'mcp' | 'skills' | 'export' | 'tools' | 'stats' | 'settings' | 'auth' | 'attach'
  /** Sub-operation for a registry command, for example `mcp add`; absent means "list". */
  readonly sub?: string
  /** Settings namespace a `settings` command addresses. */
  readonly ns?: string
  /** Dot-separated field path inside {@link ns}, empty for the section root. */
  readonly path?: string
  /** Value a `settings set` writes; parsed from JSON when it parses. */
  readonly value?: unknown
  /** Credential reference an `auth` command addresses. */
  readonly ref?: string
  /** Skill, MCP server, or other named resource a subcommand addresses. */
  readonly name?: string
  /** Storage scope a `skills save` writes to. */
  readonly scope?: string
  /** Version a `skills rollback` returns to. */
  readonly version?: string
  /** Benchmark run a `skills benchmark-*` command addresses. */
  readonly runId?: string
  /** Benchmark evaluator route, as `provider/model`. */
  readonly evaluator?: string
  /** Benchmark case count. */
  readonly cases?: number
  /** Replace an existing managed skill on save. */
  readonly replace?: boolean
  /** Save despite a blocked security verdict. */
  readonly force?: boolean
  /** Executable or endpoint an `mcp add` declares. */
  readonly command?: string
  /** Arguments passed to an `mcp add` stdio server without shell interpolation. */
  readonly args?: readonly string[]
  /** Streamable-HTTP endpoint an `mcp add` declares; also the origin an `attach` invocation connects to. */
  readonly url?: string
  /** Extra environment variables for a stdio server, as `K=V`. */
  readonly env?: readonly string[]
  /** Working directory for a stdio server. */
  readonly cwd?: string
  /** Declare the server disabled. */
  readonly disabled?: boolean
  /** Destination file for `export`. */
  readonly output?: string
  /** Include subagent descendant logs in an `export`. */
  readonly includeDescendants?: boolean
  /** Task text for `task`. */
  readonly task?: string
  /** Target session for `resume`, `rename`, and `fork`; absent means "continue the newest". */
  readonly sessionId?: string
  /** New title for `rename`. */
  readonly title?: string
  /** Query text for `search`. */
  readonly query?: string
  /** Machine-readable output where the operation supports it. */
  readonly json?: boolean
  /** Continue the most recent session of this directory instead of creating one. */
  readonly continue?: boolean
  /** Fork the resolved session before running. */
  readonly fork?: boolean
  /** Model for this invocation, as `provider/model` or a bare model id. */
  readonly model?: string
  /** Reasoning effort applied together with {@link model}. */
  readonly effort?: string
  /** Permission mode the launcher applies before the tree mounts. */
  readonly permissionMode?: string
  /**
   * Create a git worktree for this invocation and run inside it; an empty string
   * asks the launcher to generate the branch name.
   */
  readonly worktree?: string
  /** Files to attach to the task, as paths; they ride the prompt's content parts. */
  readonly files?: readonly string[]
  /** How many history messages `resume` prints before it continues. */
  readonly historyLimit?: number
  /** Path to a JSON document answering the model's questions in a headless run. */
  readonly questionAnswers?: string
  /** Refuse rather than guess when a question arrives without an interactive terminal. */
  readonly failOnQuestion?: boolean
  /** Headless run: answer once, print machine-readable output, exit. */
  readonly print?: boolean
  /** Output shape of a headless run: `text`, `json`, or `stream-json`. */
  readonly outputFormat?: string
  /** Emit one line per streamed chunk instead of per finished message. */
  readonly includePartial?: boolean
  /** Parsed JSON Schema the headless answer must satisfy. */
  readonly jsonSchema?: unknown
  /** File the task text is read from, instead of argv. */
  readonly promptFile?: string
  /** Hard cap on turns this invocation may run. */
  readonly maxTurns?: number
  /** Discard the session from the lists when the run finishes. */
  readonly persistSession?: boolean
  /** Screen mode for an interactive start: `inline`, `fullscreen`, or `minimal`. */
  readonly screen?: string
  /** Tool names to keep; when present, every other tool row is disabled. */
  readonly tools?: readonly string[]
  /** Tool names to disable, applied after {@link tools}. */
  readonly deny?: readonly string[]
}
