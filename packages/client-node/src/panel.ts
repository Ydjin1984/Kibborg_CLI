/**
 * Data and actions behind the tabs modal (`UI.md` §4.9).
 *
 * The modal is a view over registries the host already owns — the managed skill
 * catalog, the declared MCP servers, the permission presets, and the Loader's
 * plugin entries — so nothing here caches: every tab is read when it is shown,
 * and an action goes through the same domain a command-line caller would use.
 * @module @kibborg/client-node/panel
 */

import type { Context } from '@deepseek-ai/cordis'
import type { IApiClient } from '@deepseek-ai/dsh-host-apiproxy/client'
import type { ManagedSkillSummaryView } from '@deepseek-ai/dsh-host-apiproxy/api'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { columns, moveSelection, moveTab, type PanelTab, type PanelView } from '@kibborg/tui'
import { readMcpServers, readSkills } from './registries.ts'
import { executeCommand } from './remote.ts'

/** One plugin entry the inventory reports. */
interface PluginEntry {
  readonly moduleName?: string
  readonly enabled?: boolean
  readonly fiberPhase?: string | null
}

/** The service slice the Plugins tab reads, kept structural on purpose. */
interface PluginInventory {
  /** Current non-group Loader entries. */
  list(): { readonly entries: readonly PluginEntry[] }
}

/** The service slice the Permissions tab reads. */
interface PermissionPresets {
  /** Preset names the composition declares. */
  readonly names: readonly string[]
}

/** Everything the modal needs to render and to act. */
export interface PanelSession {
  /** Host context carrying the services the tabs read. */
  readonly ctx: Context
  /** The in-process API client. */
  readonly client: IApiClient
  /** The session whose project owns the skills and the permission preset. */
  readonly sessionId: SessionId
  /** Writes command output that does not belong to the modal. */
  readonly write: (chunk: string) => void
}

/** Rows the modal keeps beside the view so an action knows what it addresses. */
export interface PanelData {
  /** Managed skill rows, in catalog order. */
  readonly skills: readonly ManagedSkillSummaryView[]
  /** MCP server names, in registry order. */
  readonly mcp: readonly { readonly name: string; readonly state: string }[]
  /** Hook-bridge module names, in Loader order. */
  readonly hooks: readonly string[]
  /** Permission preset names, in declaration order. */
  readonly permissions: readonly string[]
  /** Plugin module names, in Loader order. */
  readonly plugins: readonly string[]
}

/** The modal's state: what to draw, and what the rows mean. */
export interface PanelState {
  /** Tabs and selection. */
  readonly view: PanelView
  /** Rows behind the active tabs. */
  readonly data: PanelData
}

/** Read the plugin inventory if the composition mounts it. */
function pluginEntries(ctx: Context): readonly PluginEntry[] {
  const inventory = ctx.get('pluginInventory') as unknown as PluginInventory | undefined
  if (inventory === undefined) return []
  try {
    return inventory.list().entries
  } catch {
    // The Loader is mid-reload; the tab then shows nothing rather than failing
    // the keystroke that opened it.
    return []
  }
}

/** Read the permission presets if the composition mounts them. */
function permissionNames(ctx: Context): readonly string[] {
  const presets = ctx.get('permissionPresets') as unknown as PermissionPresets | undefined
  return presets?.names ?? []
}

/** Whether a Loader entry is a hook bridge (the Codex or Claude Code dialect). */
function isHookBridge(entry: PluginEntry): boolean {
  return entry.moduleName?.includes('dsh-hooks-') === true
}

/**
 * The permission presets this composition offers.
 *
 * The surface lists and cycles them, so the names come from the host rather than
 * from a guess in the client: a preset the deployment does not mount would
 * otherwise be offered and refused.
 * @param ctx - host context carrying the permission service.
 * @returns the preset names, in the order the service declares them.
 */
export function permissionModes(ctx: Context): readonly string[] {
  return permissionNames(ctx)
}

/** Build every tab from the registries; the renderer draws only the active one. */
function tabsOf(data: PanelData): readonly PanelTab[] {
  const skillRows = columns(data.skills.map(skill => ({
    mark: skill.enabled ? '✔️' : '·',
    name: skill.name,
    detail: `${skill.scope} · ${skill.status} · v${String(skill.versionsCount)}${skill.invocation.modelInvocable ? '' : ' · user-only'}`,
  })))
  const mcpRows = columns(data.mcp.map(server => ({
    mark: server.state === 'connected' ? '✔️' : '·',
    name: server.name,
    detail: server.state,
  })))
  const permissionRows = data.permissions.map(name => `  ${name}`)
  const hookRows = data.hooks.map(name => `  ${name}`)
  const pluginRows = data.plugins.map(name => `  ${name}`)
  return [
    {
      name: 'Skills',
      rows: ['name  scope · status · version', ...skillRows],
      hint: '[enter] show  [space] enable/disable  [v] versions  [tab] next  [esc] close',
    },
    { name: 'MCP', rows: ['name  state', ...mcpRows], hint: '[tab] next  [esc] close' },
    {
      name: 'Hooks',
      rows: data.hooks.length === 0 ? ['  no hook bridges are mounted in this profile'] : ['  bridge  state', ...hookRows],
      hint: '[tab] next  [esc] close',
    },
    {
      name: 'Plugins',
      rows: ['  module', ...pluginRows],
      hint: '[tab] next  [esc] close',
    },
    {
      name: 'Permissions',
      rows: ['  preset', ...permissionRows],
      hint: '[enter] apply preset  [tab] next  [esc] close',
    },
  ]
}

/**
 * Read every registry the modal shows and return its opening state.
 * @param session - the host services and the session the modal belongs to.
 * @returns the modal state, with the first tab active.
 */
export async function openPanel(session: PanelSession): Promise<PanelState> {
  const [skills, servers] = await Promise.all([
    readSkills(session.client, session.sessionId),
    readMcpServers(session.client),
  ])
  const data: PanelData = {
    skills: skills.managed,
    mcp: servers.map(server => ({ name: server.name, state: server.state })),
    hooks: pluginEntries(session.ctx)
      .filter(isHookBridge)
      .map(entry => `${entry.moduleName ?? '(unnamed)'}  ${entry.enabled === true ? 'enabled' : 'disabled'}  ${entry.fiberPhase ?? ''}`.trimEnd()),
    permissions: permissionNames(session.ctx),
    plugins: pluginEntries(session.ctx).map(entry => `${entry.moduleName ?? '(unnamed)'}  ${entry.enabled === true ? 'enabled' : 'disabled'}  ${entry.fiberPhase ?? ''}`.trimEnd()),
  }
  return { view: { tabs: tabsOf(data), active: 0, selected: 1 }, data }
}

/**
 * Move the selection inside the active tab.
 * @param state - the current modal state.
 * @param delta - rows to move; negative moves up.
 * @returns the state to draw next.
 */
export function movePanelSelection(state: PanelState, delta: number): PanelState {
  return { view: { ...moveSelection(state.view, delta), tabs: state.view.tabs }, data: state.data }
}

/**
 * Switch tabs, keeping every tab's rows current.
 * @param state - the current modal state.
 * @param delta - tabs to move; negative moves backwards.
 * @returns the state to draw next.
 */
export function switchPanelTab(state: PanelState, delta: number): PanelState {
  const moved = moveTab(state.view, delta)
  return { view: { ...moved, tabs: tabsOf(state.data) }, data: state.data }
}

/** The name of the row the selection points at on the active tab. */
export function selectedName(state: PanelState): string | undefined {
  const tab = state.view.tabs[state.view.active]?.name
  const row = state.view.selected - 1
  if (tab === 'Skills') return state.data.skills[row]?.name
  if (tab === 'Permissions') return state.data.permissions[row]
  return undefined
}

/**
 * Run the action bound to the selected row.
 * @param state - the current modal state.
 * @param action - the key that was pressed: `enter`, `space`, or `v`.
 * @param session - the host services the action writes through.
 * @returns a status line to show, or `undefined` when the row has no action.
 */
export async function actOnPanel(state: PanelState, action: 'enter' | 'space' | 'v', session: PanelSession): Promise<string | undefined> {
  const tab = state.view.tabs[state.view.active]?.name
  const name = selectedName(state)
  if (name === undefined) return undefined
  if (tab === 'Permissions' && action === 'enter') {
    const outcome = await executeCommand(session.ctx, session.sessionId, `/permission ${name}`)
    return outcome.ok ? outcome.text ?? `preset ${name}` : outcome.error ?? 'preset refused'
  }
  if (tab !== 'Skills') return undefined
  const skill = state.data.skills.find(entry => entry.name === name)
  if (skill === undefined) return undefined
  if (action === 'space') {
    const changed = await session.client.skills.setEnabled({ sessionId: session.sessionId, name, enabled: !skill.enabled })
    return changed.result.ok ? `${name} ${skill.enabled ? 'disabled' : 'enabled'}` : changed.result.error.message
  }
  if (action === 'v') {
    const listed = await session.client.skills.versions({ sessionId: session.sessionId, name })
    if (!listed.result.ok) return listed.result.error.message
    for (const version of listed.result.value.versions) {
      session.write(`  ${version.id}  ${version.createdAt}  ${version.reason}\n`)
    }
    return `${String(listed.result.value.versions.length)} version(s) printed below`
  }
  const read = await session.client.skills.read({ sessionId: session.sessionId, name })
  if (!read.result.ok) return read.result.error.message
  const body = read.result.value.skill
  if (body === undefined) return `no skill named ${name}`
  session.write(`${body.content}\n`)
  return `${name} printed below`
}
