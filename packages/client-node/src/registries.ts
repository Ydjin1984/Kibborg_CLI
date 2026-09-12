/**
 * Read-only registry views: the model catalog, the MCP server list, and the
 * skill catalog.
 *
 * All three are API-proxy domains rather than Typert Remote namespaces, so they
 * are reached through the in-process API client — the same face the browser's
 * transport exposes, minus the carrier. The skill domain resolves its project
 * from the session header, so that one needs a session and the other two do not.
 * @module @kibborg/client-node/registries
 */

import type {
  ConfigurableProviderView,
  ManagedSkillSummaryView,
  McpServerView,
  ModelCatalogFailure,
  ModelProviderGroup,
  SkillEntry,
} from '@deepseek-ai/dsh-host-apiproxy/api'
import type { IApiClient } from '@deepseek-ai/dsh-host-apiproxy/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { padRight } from '@kibborg/tui'

/** Host-scoped provider and model topology. */
export interface ModelRegistryView {
  /** Every configurable provider, in directory order. */
  readonly providers: readonly ConfigurableProviderView[]
  /** Providers that advertised models successfully. */
  readonly groups: readonly ModelProviderGroup[]
  /** Providers whose catalog lookup failed. */
  readonly failures: readonly ModelCatalogFailure[]
}

/** The user-invocable skill catalog beside the managed rows that carry its state. */
export interface SkillRegistryView {
  /** Skills `/name` resolves in the composer. */
  readonly user: readonly SkillEntry[]
  /** Managed rows: filesystem skills plus built-ins, with enabled state. */
  readonly managed: readonly ManagedSkillSummaryView[]
}

/**
 * Read the provider directory and the model catalog.
 * @param client - the in-process API client.
 * @returns the provider list, the model groups, and the per-provider failures.
 */
export async function readModelRegistry(client: IApiClient): Promise<ModelRegistryView> {
  const providers = await client.llm.providers({})
  const models = await client.llm.models({})
  return {
    providers: providers.result.ok ? providers.result.value.providers : [],
    groups: models.result.ok ? models.result.value.groups : [],
    failures: models.result.ok ? models.result.value.failures : [],
  }
}

/**
 * Read the declared MCP servers with their live deployment state.
 * @param client - the in-process API client.
 * @returns one row per declared server.
 */
export async function readMcpServers(client: IApiClient): Promise<readonly McpServerView[]> {
  const servers = await client.mcp.list({})
  return servers.result.ok ? servers.result.value.servers : []
}

/**
 * Read the skill catalog for the session's project.
 * @param client - the in-process API client.
 * @param sessionId - the session whose project decides the catalog.
 * @returns the user-invocable skills and the managed rows behind them.
 */
export async function readSkills(client: IApiClient, sessionId: SessionId): Promise<SkillRegistryView> {
  const user = await client.skills.list({ sessionId })
  const managed = await client.skills.listManaged({ sessionId })
  return {
    user: user.result.ok ? user.result.value.skills : [],
    managed: managed.result.ok ? managed.result.value.skills : [],
  }
}

/** Render a two-column row with the name padded to the widest entry. */
function row(name: string, width: number, rest: string, indent = '  '): string {
  return `${indent}${padRight(name, width)}  ${rest}\n`
}

/** Width of the widest name, so one column lines up. */
function widest(names: readonly string[]): number {
  return names.reduce((max, name) => Math.max(max, name.length), 0)
}

/**
 * Render the model registry as aligned text lines.
 * @param view - the provider directory and model catalog.
 * @returns one line per provider, with its models beneath it.
 */
export function formatModelRegistry(view: ModelRegistryView): string[] {
  const lines: string[] = []
  const groups = new Map(view.groups.map(group => [group.id, group]))
  const state = (provider: ConfigurableProviderView): string => {
    if (!provider.active) return 'dormant'
    const count = groups.get(provider.provider)?.models.length ?? 0
    return `active, ${count} model(s)`
  }
  const providerWidth = widest(view.providers.map(provider => provider.provider))
  lines.push('  providers\n')
  if (view.providers.length === 0) lines.push('    (none)\n')
  for (const provider of view.providers) {
    const settings = provider.settingsNs === '' ? '' : `  settings: ${provider.settingsNs}`
    lines.push(row(provider.provider, providerWidth, `${provider.displayName}  ${state(provider)}${settings}`, '    '))
  }
  lines.push('\n  models\n')
  if (view.groups.length === 0) lines.push('    (none)\n')
  for (const group of view.groups) {
    lines.push(`    ${group.id}  ${group.name}\n`)
    const modelWidth = widest(group.models.map(model => model.id))
    for (const model of group.models) {
      const efforts = model.reasoning === undefined || model.reasoning.efforts.length === 0
        ? ''
        : `  [${model.reasoning.efforts.join(', ')}]`
      lines.push(row(model.id, modelWidth, `${model.name}${efforts}`, '      '))
    }
  }
  for (const failure of view.failures) lines.push(`    ${failure.id}: ${failure.message}\n`)
  return lines
}

/**
 * Render the MCP server list as aligned text lines.
 * @param servers - the declared servers.
 * @returns one line per server, with its target and failure text.
 */
export function formatMcpServers(servers: readonly McpServerView[]): string[] {
  if (servers.length === 0) return ['  no MCP servers declared\n']
  const nameWidth = widest(servers.map(server => server.name))
  const lines: string[] = []
  lines.push(row('name', nameWidth, 'source    kind            state       tools  target'))
  for (const server of servers) {
    const kind = server.kind ?? 'invalid'
    const target = server.kind === 'streamable-http' ? server.url ?? '' : server.command ?? ''
    const flags = server.enabled ? '' : ' (disabled)'
    lines.push(row(server.name, nameWidth, `${padRight(server.source, 9)} ${padRight(kind, 15)} ${padRight(server.state, 11)} ${padRight(String(server.toolCount), 6)} ${target}${flags}`))
    if (server.error !== undefined) lines.push(`  ${padRight('', nameWidth)}  error: ${server.error}\n`)
  }
  return lines
}

/**
 * Render the skill catalog as aligned text lines.
 * @param view - the user-invocable catalog and the managed rows.
 * @param limit - how many rows to print before eliding the rest.
 * @returns one line per user-invocable skill.
 */
export function formatSkills(view: SkillRegistryView, limit = 60): string[] {
  if (view.user.length === 0) return ['  no skills in this project\n']
  const status = new Map(view.managed.map(skill => [skill.name, skill.status]))
  const shown = view.user.slice(0, limit)
  const nameWidth = widest(shown.map(skill => skill.name))
  const lines: string[] = []
  lines.push(row('name', nameWidth, 'status         model  description'))
  for (const skill of shown) {
    const state = status.get(skill.name) ?? 'unmanaged'
    lines.push(row(skill.name, nameWidth, `${padRight(state, 14)} ${padRight(skill.modelInvocable ? 'yes' : 'no', 6)} ${skill.description}`))
  }
  if (view.user.length > shown.length) lines.push(`  (+${view.user.length - shown.length} more)\n`)
  return lines
}
