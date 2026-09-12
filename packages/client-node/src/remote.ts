/**
 * Remote calls the terminal surface makes directly against the host gateway.
 *
 * The CLI runs in the same process as the host, so a Remote domain is reachable
 * through the documented `ctx.typertGateway.invoke` dispatcher instead of a
 * carrier: the descriptor, argument validation, business invocation, and result
 * validation all still run on the host side, which is what keeps this path
 * honest rather than a shortcut around the contract.
 *
 * Slash commands are the first consumer: they live in the host command registry
 * and are reached as the `commands` Remote namespace — a prompt never dispatches
 * them.
 * @module @kibborg/client-node/remote
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Namespace and methods of the host command registry. */
const COMMANDS_NAMESPACE = 'commands'
const EXECUTE_METHOD = 'execute'
const LIST_METHOD = 'list'

/** What one slash command did. */
export interface CommandOutcome {
  /** Whether the host found and ran a handler. */
  readonly ok: boolean
  /** The handler's success text, when it produced one. */
  readonly text?: string
  /** The refusal or failure text. */
  readonly error?: string
}

/** One command the host registry offers. */
export interface CommandEntry {
  /** Name without the leading slash. */
  readonly name: string
  /** Human-readable description, when the registry provides one. */
  readonly description?: string
  /** Aliases the same handler answers to. */
  readonly aliases?: readonly string[]
}

/** Shape of the host's command execution result this client reads. */
interface ExecutionResult {
  readonly commandId?: string
  readonly result?: { readonly kind?: string; readonly text?: string }
}

/** Shape of one registry descriptor this client reads. */
interface CommandDescriptorLike {
  readonly name?: unknown
  readonly description?: unknown
  readonly aliases?: unknown
}

/** Read the host gateway, or report that the composition lacks it. */
function gatewayOf(ctx: Context): { invoke(request: {
  namespace: string
  method: string
  args: Readonly<Record<string, unknown>>
  signal?: AbortSignal
}): Promise<unknown> } | undefined {
  return ctx.get('typertGateway')
}

/** One Remote-domain call, as the gateway dispatcher expects it. */
export interface RemoteCall {
  /** Remote namespace, for example `llm` or `skills`. */
  readonly namespace: string
  /** Method name inside that namespace. */
  readonly method: string
  /** Validated arguments; the domain descriptor checks them host-side. */
  readonly args: Readonly<Record<string, unknown>>
  /** Optional caller cancellation. */
  readonly signal?: AbortSignal
}

/**
 * Invoke one Remote method through the host gateway.
 *
 * The gateway resolves and validates the business result itself, so the value
 * this returns is already unwrapped; a `{ ok, value }` envelope is accepted too,
 * for compositions whose descriptor wraps its result.
 * @param ctx - host context carrying the Typert gateway.
 * @param call - namespace, method, and arguments.
 * @returns the business result, or `undefined` when the call reported failure.
 * @throws when the composition provides no gateway, or the invocation fails.
 */
export async function invokeRemote(ctx: Context, call: RemoteCall): Promise<unknown> {
  const gateway = gatewayOf(ctx)
  if (gateway === undefined) throw new Error('the composition provides no typert gateway')
  const raw = await gateway.invoke({
    namespace: call.namespace,
    method: call.method,
    args: call.args,
    ...(call.signal === undefined ? {} : { signal: call.signal }),
  })
  return unwrap(raw)
}

/**
 * Run one slash command in a session.
 * @param ctx - host context carrying the Typert gateway.
 * @param sessionId - the session the command addresses.
 * @param line - the full command line, including its leading slash.
 * @param signal - optional caller cancellation.
 * @returns what the command did, or a refusal when the gateway is absent.
 */
export async function executeCommand(
  ctx: Context,
  sessionId: SessionId,
  line: string,
  signal?: AbortSignal,
): Promise<CommandOutcome> {
  const gateway = gatewayOf(ctx)
  if (gateway === undefined) return { ok: false, error: 'the composition provides no typert gateway' }
  const request = {
    namespace: COMMANDS_NAMESPACE,
    method: EXECUTE_METHOD,
    args: { agentId: sessionId, line, images: [] },
    ...(signal === undefined ? {} : { signal }),
  }
  let raw: unknown
  try {
    raw = await gateway.invoke(request)
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
  // The gateway dispatcher resolves and validates the business result itself, so
  // the value arrives unwrapped; a `{ ok, value }` envelope is accepted too, for
  // compositions whose descriptor wraps its result.
  const unwrapped = unwrap(raw)
  if (unwrapped === undefined) return { ok: false, error: `unknown command: ${line}` }
  const value = unwrapped as ExecutionResult
  const text = value.result?.text
  const failed = value.result?.kind === 'error'
  return failed
    ? { ok: false, ...(text === undefined ? {} : { error: text }) }
    : { ok: true, ...(text === undefined ? {} : { text }) }
}

/**
 * Unwrap a business result.
 * @param raw - what the gateway returned.
 * @returns the business value, or `undefined` when the call reported failure.
 */
function unwrap(raw: unknown): unknown {
  if (raw === null || raw === undefined) return undefined
  if (Array.isArray(raw)) return raw
  if (typeof raw !== 'object') return raw
  const envelope = raw as { ok?: unknown; value?: unknown }
  if (envelope.ok === false) return undefined
  if (envelope.ok === true) return envelope.value
  return raw
}

/**
 * List the commands the host registry offers for a session.
 * @param ctx - host context carrying the Typert gateway.
 * @param sessionId - the session whose composition decides the catalog.
 * @returns the commands, or an empty list when the gateway is absent.
 */
export async function listCommands(ctx: Context, sessionId: SessionId): Promise<readonly CommandEntry[]> {
  const gateway = gatewayOf(ctx)
  if (gateway === undefined) return []
  const raw = await gateway.invoke({
    namespace: COMMANDS_NAMESPACE,
    method: LIST_METHOD,
    args: { agentId: sessionId },
  })
  const unwrapped = unwrap(raw)
  if (process.env['KIBBORG_TRACE'] === '1') {
    process.stderr.write(`kibborg[trace]: commands/list → ${JSON.stringify(unwrapped)?.slice(0, 200) ?? 'undefined'}\n`)
  }
  if (!Array.isArray(unwrapped)) return []
  return unwrapped.map((entry: CommandDescriptorLike) => ({
    name: typeof entry.name === 'string' ? entry.name : '',
    ...(typeof entry.description === 'string' ? { description: entry.description } : {}),
    ...(Array.isArray(entry.aliases) ? { aliases: entry.aliases.map(String) } : {}),
  })).filter(entry => entry.name !== '')
}
