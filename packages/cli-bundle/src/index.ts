/**
 * `@kibborg/cli-bundle` — the terminal-surface bundle over the `dsh-base`
 * layer. The bundle's identity is its patch file; this module registers the
 * settings section the terminal surface reads its own behaviour from.
 *
 * The section lives here rather than in the client half because a settings
 * namespace is a host-plane registration: the Web Settings pages list it from
 * the same registry, so an operator can change the terminal's theme from either
 * surface. The client reads the resolved value through the settings domain
 * before it builds a palette, and re-reads it when the document changes.
 * @module @kibborg/cli-bundle
 */

import z from '@deepseek-ai/schemastery'
import type { Context } from '@deepseek-ai/cordis'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'

/** Stable Cordis plugin name. */
export const name = 'kibborg-cli'

/** Services required before the bundle's own rows can mount. */
export const inject: string[] = ['settings']

/** Theme presets the terminal surface ships (`UI.md` §13). */
export const KIBBORG_THEMES = ['ice', 'terminal', 'mono'] as const

/** Screen modes the terminal surface ships. */
export const KIBBORG_SCREENS = ['inline', 'fullscreen', 'minimal'] as const

/** Behaviour the terminal surface reads from its settings section. */
export interface KibborgCliSettings {
  /** Color preset: `ice` is the design palette, `terminal` keeps the profile's, `mono` prints without color. */
  readonly theme: (typeof KIBBORG_THEMES)[number]
  /** Print the time a message was written beside it. */
  readonly timestamps: boolean
  /** Swap Enter and Ctrl+J: Enter breaks the line, Ctrl+J submits. */
  readonly multiline: boolean
  /**
   * Screen mode. `inline` appends to the scrollback, `fullscreen` repaints one
   * frame on the alternate screen, and `minimal` keeps the inline layout while
   * suppressing animation — it is also the fallback when a terminal cannot
   * enter the alternate screen.
   */
  readonly screen: (typeof KIBBORG_SCREENS)[number]
}

/** Resolved defaults: the composition's own values, below any user layer. */
export const KIBBORG_CLI_DEFAULTS: KibborgCliSettings = {
  theme: 'ice',
  timestamps: true,
  multiline: false,
  screen: 'fullscreen',
}

/** Namespace key behind the terminal surface's settings section. */
export const KIBBORG_CLI_NAMESPACE = settingsNamespace('kibborg-cli')

/** Serialized schema the Settings page renders this section's form from. */
const kibborgCliSchema: z<KibborgCliSettings> = z.object({
  theme: z.union([...KIBBORG_THEMES]).default('ice'),
  timestamps: z.boolean().default(true),
  multiline: z.boolean().default(false),
  screen: z.union([...KIBBORG_SCREENS]).default('fullscreen'),
})

/**
 * Mount the CLI bundle's node-half glue.
 * @param ctx - Cordis context of the booted profile tree.
 */
export function apply(ctx: Context): void {
  installSettingsSection(ctx, KIBBORG_CLI_NAMESPACE, kibborgCliSchema, KIBBORG_CLI_DEFAULTS, {
    // The client reads the resolved section from the settings domain on every
    // invocation, so this plugin keeps no second copy of the value.
    setSource: () => {},
    onChange: () => {},
  })
}
