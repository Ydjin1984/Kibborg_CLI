/**
 * Message feedback (Like/Dislike) of the terminal surface.
 *
 * The host owns the feedback sidecar behind the `messageFeedback` Remote domain;
 * the terminal has no Like/Dislike buttons, so `/like` and `/dislike` answer the
 * same `put` the browser's buttons call. The client Remote aggregate does not
 * mount `messageFeedback` yet, so this module reaches the host gateway directly
 * (`ctx.get('typertGateway')`) — the same dispatcher the slash-command path uses,
 * which keeps argument validation and result validation on the host side.
 *
 * The attached (remote) client has no gateway of its own, so feedback answers
 * only for the local host; an attached invocation reports that instead of
 * pretending the write happened.
 * @module @kibborg/client-node/message-feedback
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session/types'

/** Remote namespace the message-feedback service publishes under. */
const NAMESPACE = 'messageFeedback'

/** The host gateway dispatcher shape this module needs. */
interface Gateway {
  readonly invoke: (request: {
    readonly namespace: string
    readonly method: string
    readonly args: Readonly<Record<string, unknown>>
  }) => Promise<unknown>
}

/** One stored feedback item, as the `list` value carries it. */
interface FeedbackItem {
  readonly messageId: string
  readonly version: string
}

/** The unwrapped `list` value: current items in first-creation order. */
interface FeedbackListValue {
  readonly items: readonly FeedbackItem[]
}

/** A `put` failure, reduced to the facts the caller needs. */
interface FeedbackError {
  readonly code?: string
  readonly current?: FeedbackItem | null
}

/** Result of one feedback write. */
export type FeedbackOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string }

/**
 * The stable id of the most recent assistant answer in a log.
 * @param events - the log, oldest first.
 * @returns the message id, or `undefined` when the log holds no answer.
 */
export function lastAssistantMessageId(events: readonly SessionEvent[]): string | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event === undefined || event.type !== 'assistant/message') continue
    const id = (event.data.message as { readonly id?: unknown }).id
    if (typeof id === 'string' && id !== '') return id
  }
  return undefined
}

/** Read the host gateway, or `undefined` when this process has none (attached). */
function gatewayOf(ctx: Context): Gateway | undefined {
  return ctx.get('typertGateway')
}

/** Unwrap a gateway result envelope: the value on success, the raw error on failure. */
function readEnvelope(raw: unknown): { readonly ok: boolean; readonly value?: unknown; readonly error?: FeedbackError } {
  if (raw === null || typeof raw !== 'object') return { ok: false }
  const envelope = raw as { readonly ok?: unknown; readonly value?: unknown; readonly error?: unknown }
  if (envelope.ok === true) return { ok: true, value: envelope.value }
  if (envelope.ok === false) {
    const error = envelope.error as FeedbackError | undefined
    return error === undefined ? { ok: false } : { ok: false, error }
  }
  return { ok: true, value: raw }
}

/**
 * Write a Like/Dislike rating for one assistant message.
 *
 * The `put` contract is compare-and-set: the current item version (or `null`
 * for creation) is observed first through `list`, then passed as `ifVersion`.
 * A version conflict retries once with the authoritative current version, which
 * covers a concurrent update; a second conflict is reported rather than looped.
 * @param ctx - host context carrying the Typert gateway.
 * @param sessionId - the owning session.
 * @param messageId - the target assistant message.
 * @param rating - `positive` (like) or `negative` (dislike).
 * @param note - optional explanation; whitespace-only is treated as absent.
 * @returns success, or a failure the caller prints.
 */
export async function putMessageFeedback(
  ctx: Context,
  sessionId: SessionId,
  messageId: string,
  rating: 'positive' | 'negative',
  note: string | undefined,
): Promise<FeedbackOutcome> {
  const gateway = gatewayOf(ctx)
  if (gateway === undefined) {
    return { ok: false, reason: 'message feedback is only available for the local host, not an attached server' }
  }
  const listed = await gateway.invoke({ namespace: NAMESPACE, method: 'list', args: { sessionId } })
  const list = readEnvelope(listed)
  const items = (list.ok ? (list.value as FeedbackListValue | undefined)?.items : undefined) ?? []
  const current = items.find(item => item.messageId === messageId)
  let ifVersion: string | null = current?.version ?? null

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const args: Record<string, unknown> = { sessionId, messageId, rating, ifVersion }
    if (note !== undefined && note.trim() !== '') args['note'] = note
    const raw = await gateway.invoke({ namespace: NAMESPACE, method: 'put', args })
    const result = readEnvelope(raw)
    if (result.ok) return { ok: true }
    const error = result.error
    if (attempt === 0 && error?.code === 'version-conflict' && error.current != null) {
      ifVersion = error.current.version
      continue
    }
    return { ok: false, reason: error?.code ?? 'messageFeedback.put failed' }
  }
  return { ok: false, reason: 'messageFeedback.put failed' }
}
