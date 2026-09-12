/**
 * `kibborg mcp add` and `kibborg mcp remove` — the user MCP registry.
 *
 * The body follows the Claude Code `mcpServers` convention the Web MCP settings
 * page writes: `url` selects the streamable-HTTP transport, otherwise `command`
 * starts a stdio child. Project entries declared by a `.mcp.json` are read-only
 * here, exactly as they are in the browser.
 * @module @kibborg/client-node/mcp-command
 */

import type { IApiClient } from '@deepseek-ai/dsh-host-apiproxy/client'
import type { McpServerEntryView } from '@deepseek-ai/dsh-host-apiproxy/api'
import { formatMcpServers, readMcpServers } from './registries.ts'
import type { ClientIntent } from './types.ts'

/** Parse `K=V` pairs into an environment map. */
function envOf(pairs: readonly string[] | undefined): Record<string, string> | undefined {
  if (pairs === undefined || pairs.length === 0) return undefined
  const parsed: Record<string, string> = {}
  for (const pair of pairs) {
    const equals = pair.indexOf('=')
    if (equals <= 0) continue
    parsed[pair.slice(0, equals)] = pair.slice(equals + 1)
  }
  return Object.keys(parsed).length === 0 ? undefined : parsed
}

/**
 * Add or replace one server in the user registry.
 * @param client - the in-process API client.
 * @param intent - the resolved invocation intent.
 * @returns the process exit code.
 */
export async function addMcpServer(client: IApiClient, intent: ClientIntent): Promise<number> {
  const name = intent.name ?? ''
  if (name === '') {
    process.stderr.write('kibborg: mcp add needs a server name\n')
    return 2
  }
  const env = envOf(intent.env)
  const command = intent.command
  const url = intent.url
  if ((command === undefined || command === '') === (url === undefined || url === '')) {
    process.stderr.write('kibborg: mcp add takes exactly one of --command <executable> or --url <endpoint>\n')
    return 2
  }
  const entry: McpServerEntryView = {
    ...(command === undefined || command === '' ? {} : { command }),
    ...(intent.args === undefined || intent.args.length === 0 ? {} : { args: [...intent.args] }),
    ...(env === undefined ? {} : { env }),
    ...(intent.cwd === undefined ? {} : { cwd: intent.cwd }),
    ...(url === undefined || url === '' ? {} : { url }),
    ...(intent.disabled === true ? { enabled: false } : {}),
  }
  const saved = await client.mcp.save({ name, entry })
  if (!saved.result.ok) {
    process.stderr.write(`kibborg: mcp.save failed: ${saved.result.error.message}\n`)
    return 1
  }
  if (intent.json === true) {
    process.stdout.write(`${JSON.stringify(saved.result.value.server, undefined, 2)}\n`)
    return 0
  }
  process.stdout.write(formatMcpServers([saved.result.value.server]).join(''))
  return 0
}

/**
 * Remove one server from the user registry and undeploy it.
 * @param client - the in-process API client.
 * @param intent - the resolved invocation intent.
 * @returns the process exit code.
 */
export async function removeMcpServer(client: IApiClient, intent: ClientIntent): Promise<number> {
  const name = intent.name ?? ''
  if (name === '') {
    process.stderr.write('kibborg: mcp remove needs a server name\n')
    return 2
  }
  const removed = await client.mcp.remove({ name })
  if (!removed.result.ok) {
    process.stderr.write(`kibborg: mcp.remove failed: ${removed.result.error.message}\n`)
    return 1
  }
  process.stdout.write(`  ${name} removed\n`)
  return 0
}

/**
 * Run one MCP mutation, or list the servers when no subcommand was given.
 * @param client - the in-process API client.
 * @param intent - the resolved invocation intent.
 * @returns the process exit code.
 */
export async function runMcpCommand(client: IApiClient, intent: ClientIntent): Promise<number> {
  switch (intent.sub) {
    case 'add': return await addMcpServer(client, intent)
    case 'remove': return await removeMcpServer(client, intent)
    case undefined:
    case 'list': {
      const servers = await readMcpServers(client)
      process.stdout.write(intent.json === true
        ? `${JSON.stringify(servers, undefined, 2)}\n`
        : formatMcpServers(servers).join(''))
      return 0
    }
    default:
      process.stderr.write(`kibborg: unknown mcp subcommand: ${intent.sub}\n`)
      return 2
  }
}
