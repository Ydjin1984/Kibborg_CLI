/**
 * Who is working: the agent behind every session this run touches.
 *
 * A turn is not always one model. Orchestrator mode splits the session's chat
 * model (the head that plans and reviews) from a local executor that does the
 * tool-driven work, and that executor runs as a subagent with its own session.
 * The mux carries every session's events, including those children, so the
 * transcript can show which model produced which line instead of one
 * undifferentiated stream.
 *
 * Only facts the host already publishes are used: the session list carries each
 * session's parent and origin, a child's own log carries its `subagent/descriptor`
 * and `request/header`, and the `subagent`/`subagentActivity` projections carry
 * its identity and what it is doing. Roles are derived from those facts — a
 * child pinned to the configured executor route is an executor, the session the
 * user typed into is the head — and never invented for an unknown agent.
 * @module @kibborg/client-node/agents
 */

import type { MuxFrame } from '@deepseek-ai/dsh-host-apiproxy/api'
import type { IApiClient } from '@deepseek-ai/dsh-host-apiproxy/client'
import type { AgentBadge } from '@kibborg/tui'
import { agentToken } from '@kibborg/tui'

/** Where the root agent's route is configured, when the deployment splits roles. */
export interface OrchestratorRoute {
  /** Whether the head/executor split is on. */
  readonly enabled: boolean
  /** Provider of the local executor route. */
  readonly executorProvider: string
  /** Model id the executor tool pins. */
  readonly executorModel: string
}

/** One agent this run can name, with the session it works in. */
export interface AgentIdentity extends AgentBadge {
  /** Session the agent works in. */
  readonly sessionId: string
}

/** What one observed frame said about an agent. */
export interface AgentObservation {
  /** The agent the frame belongs to. */
  readonly agent: AgentIdentity
  /** Newest reported activity, when the frame carried one. */
  readonly detail?: string
  /** The agent ended its turn in this frame. */
  readonly finished?: boolean
  /**
   * The agent's name became known in this frame.
   *
   * A child is first seen through an event that carries no label, so the surface
   * is told to redraw the heading it already opened instead of leaving the
   * session id there.
   */
  readonly renamed?: boolean
}

/** Settings namespace the orchestrator plugin owns. */
const ORCHESTRATOR_NAMESPACE = 'orchestrator'

/** The agent tracker of one turn. */
export interface AgentTracker {
  /** Read the session tree and the orchestrator route before the turn starts. */
  load(): Promise<void>
  /** Fold one mux frame, when it belongs to an agent of this run. */
  observe(frame: MuxFrame): AgentObservation | undefined
  /** The agent of the session the user typed into. */
  root(): AgentIdentity
  /** Whether a session belongs to this run's tree. */
  owns(sessionId: string): boolean
  /** The agent that owns a session, when it is known. */
  of(sessionId: string): AgentIdentity | undefined
  /**
   * Remember the task a delegation just named.
   *
   * A one-shot child writes no descriptor of its own, so the call that started it
   * is the only place its label appears: the next child this run sees takes it.
   * @param label - the task text the delegation carried.
   */
  hint(label: string): void
}

/** Read a string field out of an unknown value. */
function textOf(value: unknown, key: string): string | undefined {
  const field = (value as Record<string, unknown> | null | undefined)?.[key]
  return typeof field === 'string' ? field : undefined
}

/** Render a `provider/model` route, or the model alone when the provider is unknown. */
function route(provider: string | undefined, model: string | undefined): string | undefined {
  if (model === undefined || model === '') return undefined
  return provider === undefined || provider === '' ? model : `${provider}/${model}`
}

/**
 * Build the tracker of one run.
 * @param client - the API client that reads the session tree and settings.
 * @param options - the session the user typed into and its own route.
 * @returns the tracker the turn feeds frames into.
 */
export function createAgentTracker(
  client: IApiClient,
  options: {
    readonly sessionId: string
    readonly model?: string
    readonly label?: string
  },
): AgentTracker {
  /** Direct parent of each session, as the host last reported it. */
  let parents = new Map<string, string>()
  /** Origin and preset per session, as the host last reported it. */
  let presets = new Map<string, { readonly origin?: string; readonly preset?: string }>()
  let orchestrator: OrchestratorRoute = { enabled: false, executorProvider: '', executorModel: '' }
  let loading: Promise<void> | undefined
  /** Identities learned so far, keyed by session id. */
  const known = new Map<string, AgentIdentity>()
  /** Model route reported by each session's own `request/header`. */
  const models = new Map<string, string>()
  /** Labels the delegation carried, from the child's descriptor or projection. */
  const labels = new Map<string, string>()
  /** Whether a session was ever seen doing work in this run. */
  const seen = new Set<string>()
  /** Sessions already reported as finished. */
  const done = new Set<string>()
  /** Sessions whose placement was asked for, so one frame asks once. */
  const asked = new Set<string>()
  /** Task a delegation just named, waiting for the child it started. */
  let pendingLabel: string | undefined

  const rootLabel = options.label ?? 'KIBORG'

  const rootBadge = (): AgentIdentity => ({
    sessionId: options.sessionId,
    label: rootLabel,
    ...(options.model === undefined || options.model === '' ? {} : { model: options.model }),
    ...orchestrator.enabled ? { role: 'ORCHESTRATOR' } : {},
    depth: 0,
    token: agentToken(rootLabel),
  })

  /** Whether a session descends from the session the user typed into. */
  const owns = (sessionId: string): boolean => {
    let current: string | undefined = sessionId
    for (let hop = 0; hop < 16 && current !== undefined; hop += 1) {
      if (current === options.sessionId) return true
      current = parents.get(current)
    }
    return false
  }

  /** Depth of a session in this run's tree. */
  const depthOf = (sessionId: string): number => {
    let depth = 0
    let current: string | undefined = parents.get(sessionId)
    while (current !== undefined && depth < 16) {
      depth += 1
      if (current === options.sessionId) break
      current = parents.get(current)
    }
    return depth
  }

  /** The name of one child: its own descriptor, the delegation that started it, or its id. */
  const labelOf = (sessionId: string): string => {
    const own = labels.get(sessionId)
    if (own !== undefined) return own
    if (pendingLabel !== undefined) {
      const taken = pendingLabel
      pendingLabel = undefined
      labels.set(sessionId, taken)
      return taken
    }
    return `subagent ${sessionId.slice(0, 6)}`
  }

  const identityOf = (sessionId: string): AgentIdentity => {
    const cached = known.get(sessionId)
    if (cached !== undefined) return cached
    const label = labelOf(sessionId)
    const model = models.get(sessionId)
    const short = model === undefined ? undefined : model.split('/').pop()
    const executor = orchestrator.enabled
      && orchestrator.executorModel !== ''
      && (models.get(sessionId)?.endsWith(`/${orchestrator.executorModel}`) === true || short === orchestrator.executorModel)
    const preset = presets.get(sessionId)?.preset
    const badge: AgentIdentity = {
      sessionId,
      label,
      ...model === undefined ? {} : { model },
      role: executor ? 'EXECUTOR' : preset === undefined ? 'SUBAGENT' : preset.toUpperCase(),
      depth: depthOf(sessionId),
      token: agentToken(label),
    }
    known.set(sessionId, badge)
    return badge
  }

  /** Read the session tree and the orchestrator route from the host. */
  const load = async (): Promise<void> => {
    if (loading !== undefined) return await loading
    loading = (async () => {
      try {
        const listed = await client.sessions.list({})
        if (listed.result.ok) {
          const nextParents = new Map<string, string>()
          const nextPresets = new Map<string, { readonly origin?: string; readonly preset?: string }>()
          for (const item of listed.result.value.items) {
            const parent = (item as { readonly parentSessionId?: string }).parentSessionId
            if (parent !== undefined) nextParents.set(item.sessionId, parent)
            nextPresets.set(item.sessionId, {
              ...(item.origin === undefined ? {} : { origin: item.origin }),
              ...(item.agentPreset === undefined ? {} : { preset: item.agentPreset }),
            })
          }
          parents = nextParents
          presets = nextPresets
        }
      } catch {
        // A failed listing only costs the run its agent labels: the turn itself
        // keeps streaming, and the next refresh tries again.
      }
      try {
        const described = await client.settings.describe({})
        if (described.result.ok) {
          const section = described.result.value.namespaces.find(entry => entry.ns === ORCHESTRATOR_NAMESPACE)
          const value = section?.value as Record<string, unknown> | undefined
          if (value !== undefined && typeof value === 'object') {
            orchestrator = {
              enabled: value['enabled'] === true,
              executorProvider: textOf(value, 'executorProvider') ?? '',
              executorModel: textOf(value, 'executorModel') ?? '',
            }
          }
        }
      } catch {
        // Without the settings the run reports no role for the head; the labels
        // and models of the agents themselves are unaffected.
      }
    })()
    try {
      await loading
    } finally {
      loading = undefined
    }
  }

  /**
   * Fold the facts one frame carries about a session.
   *
   * They are recorded for every session the host names, before this run decides
   * whether it owns one: a child's model and label arrive on the first frames of
   * its life, which is when the tree read that places that child may still be in
   * flight. Dropping them there would leave its heading nameless forever.
   */
  const record = (frame: MuxFrame, sessionId: string): { readonly renamed?: boolean; readonly detail?: string } => {
    if (frame.type === 'session/projection') {
      if (frame.key === 'subagentActivity') {
        const detail = textOf(frame.value, 'detail')
        return detail === undefined || detail === '' ? {} : { detail }
      }
      if (frame.key !== 'subagent') return {}
      const label = textOf(frame.value, 'label')
      if (label === undefined || label === '' || labels.get(sessionId) === label) return {}
      labels.set(sessionId, label)
      known.delete(sessionId)
      return { renamed: true }
    }
    if (frame.type !== 'session/event') return {}
    const event = frame.event
    if (event.type === 'request/header') {
      const config = (event.data as { readonly header?: { readonly config?: { readonly provider?: string; readonly model?: string } } }).header?.config
      const model = route(config?.provider, config?.model)
      // A child pinned to the executor route is the executor, so its heading is
      // redrawn once its own request named that route.
      if (model === undefined || models.get(sessionId) === model) return {}
      models.set(sessionId, model)
      known.delete(sessionId)
      return { renamed: true }
    }
    // The descriptor is written by the subagent plugin, whose event type this
    // client does not depend on, so the log carries it while the event union here
    // does not name it.
    if ((event as { readonly type: string }).type !== 'subagent/descriptor') return {}
    const data = (event as { readonly data?: unknown }).data
    let renamed = false
    const label = textOf(data, 'label')
    if (label !== undefined && label !== '' && labels.get(sessionId) !== label) {
      labels.set(sessionId, label)
      renamed = true
    }
    const model = route(textOf(data, 'agentProvider'), textOf(data, 'agentModel'))
    if (model !== undefined && models.get(sessionId) !== model) {
      models.set(sessionId, model)
      renamed = true
    }
    if (renamed) known.delete(sessionId)
    return renamed ? { renamed: true } : {}
  }

  const observe = (frame: MuxFrame): AgentObservation | undefined => {
    const sessionId = 'sessionId' in frame ? frame.sessionId : undefined
    if (sessionId === undefined || sessionId === options.sessionId) return undefined
    const facts = record(frame, sessionId)
    if (!owns(sessionId)) {
      // A session this run has never placed. The listing is read at once rather
      // than on the next stale check: a child starts working the moment it is
      // spawned, and a run shorter than the check window would never see it. The
      // set keeps one unplaced session from asking once per frame.
      if (!asked.has(sessionId)) {
        asked.add(sessionId)
        void load()
      }
      return undefined
    }
    seen.add(sessionId)
    if (facts.renamed === true) return { agent: identityOf(sessionId), renamed: true }
    if (facts.detail !== undefined) return { agent: identityOf(sessionId), detail: facts.detail }
    if (frame.type === 'session/projection') return undefined
    if (frame.type !== 'session/event') return undefined
    const event = frame.event
    if (event.type === 'turn/end') {
      if (done.has(sessionId)) return undefined
      done.add(sessionId)
      return { agent: identityOf(sessionId), finished: true }
    }
    if (event.type === 'request/header' || (event as { readonly type: string }).type === 'subagent/descriptor') return undefined
    return { agent: identityOf(sessionId) }
  }

  return {
    load,
    observe,
    root: rootBadge,
    owns,
    of(sessionId) {
      return sessionId === options.sessionId ? rootBadge() : owns(sessionId) ? identityOf(sessionId) : undefined
    },
    hint(label) {
      const text = label.trim()
      if (text !== '') pendingLabel = text
    },
  }
}
