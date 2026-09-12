/**
 * `kibborg tools` — the tool set this composition actually mounts.
 *
 * The list is read from the live tool registry rather than a static table, so
 * it answers the question a preset or `--tools` filter raises: which tools does
 * the agent of this invocation see right now. Descriptions are truncated to one
 * line, because the model-facing text is long by design.
 * @module @kibborg/client-node/tools-command
 */

import type { Context } from '@deepseek-ai/cordis'
import { padRight } from '@kibborg/tui'

/** The slice of the tool registry this command reads. */
interface ToolRegistry {
  /** Model-facing schemas of the tools the registry currently exposes. */
  schemas(): readonly { readonly name: string; readonly description: string }[]
}

/** Characters of description one row keeps. */
const DESCRIPTION_WIDTH = 90

/**
 * Read the mounted tool set.
 * @param ctx - host context carrying the tool registry.
 * @returns one row per tool, sorted by name; empty when the registry is absent.
 */
export function listTools(ctx: Context): readonly { readonly name: string; readonly description: string }[] {
  const registry = ctx.get('tools') as unknown as ToolRegistry | undefined
  if (registry === undefined) return []
  return [...registry.schemas()]
    .map(schema => ({ name: schema.name, description: schema.description.replace(/\s+/g, ' ').trim() }))
    .sort((left, right) => left.name.localeCompare(right.name))
}

/**
 * Render the tool list as aligned text lines.
 * @param tools - the rows to print.
 * @returns one line per tool.
 */
export function formatTools(tools: readonly { readonly name: string; readonly description: string }[]): string[] {
  if (tools.length === 0) return ['  no tools mounted\n']
  const width = tools.reduce((max, tool) => Math.max(max, tool.name.length), 0)
  return tools.map(tool => {
    const description = tool.description.length > DESCRIPTION_WIDTH
      ? `${tool.description.slice(0, DESCRIPTION_WIDTH - 1)}…`
      : tool.description
    return `  ${padRight(tool.name, width)}  ${description}\n`
  })
}
