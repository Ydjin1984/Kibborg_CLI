/**
 * The terminal surface's own settings section.
 *
 * The section is registered by `@kibborg/cli-bundle` in the host plane, so the
 * Web Settings pages list it too; this module reads the resolved value through
 * the settings domain before the surface builds a palette or decides how Enter
 * behaves. A missing or partly written section falls back to the composition
 * defaults rather than failing the invocation.
 * @module @kibborg/client-node/surface-settings
 */

import type { IApiClient } from '@deepseek-ai/dsh-host-apiproxy/client'

/** Namespace key of the section the CLI bundle registers. */
export const SURFACE_NAMESPACE = 'kibborg-cli'

/** Behaviour the surface reads before it draws anything. */
export interface SurfaceSettings {
  /** Color preset: `ice` is the design palette, `terminal` keeps the profile's colors, `mono` prints without color. */
  readonly theme: 'ice' | 'terminal' | 'mono'
  /** Print the time a message was written beside it. */
  readonly timestamps: boolean
  /** Enter breaks the line and Ctrl+J submits, instead of the reverse. */
  readonly multiline: boolean
  /** Screen mode: `inline` keeps the scrollback, `fullscreen` repaints a frame. */
  readonly screen: 'inline' | 'fullscreen' | 'minimal'
}

/** Defaults matching the composition's own section base. */
export const SURFACE_DEFAULTS: SurfaceSettings = {
  theme: 'ice',
  // The reference CLIs stamp every message, so a session reads as a timeline.
  timestamps: true,
  multiline: false,
  screen: 'fullscreen',
}

/** Read one field out of a resolved section, tolerating a foreign type. */
function pick<T>(value: Record<string, unknown>, key: string, fallback: T, accepts: (candidate: unknown) => boolean): T {
  const candidate = value[key]
  return accepts(candidate) ? candidate as T : fallback
}

/**
 * Read this surface's settings section.
 * @param client - the in-process API client.
 * @returns the resolved section, or the defaults when it is absent or unreadable.
 */
export async function readSurfaceSettings(client: IApiClient): Promise<SurfaceSettings> {
  const described = await client.settings.describe({})
  if (!described.result.ok) return SURFACE_DEFAULTS
  const section = described.result.value.namespaces.find(entry => entry.ns === SURFACE_NAMESPACE)
  if (section === undefined || typeof section.value !== 'object' || section.value === null) return SURFACE_DEFAULTS
  const value = section.value as Record<string, unknown>
  return {
    theme: pick(value, 'theme', SURFACE_DEFAULTS.theme, candidate => candidate === 'ice' || candidate === 'terminal' || candidate === 'mono'),
    timestamps: pick(value, 'timestamps', SURFACE_DEFAULTS.timestamps, candidate => typeof candidate === 'boolean'),
    multiline: pick(value, 'multiline', SURFACE_DEFAULTS.multiline, candidate => typeof candidate === 'boolean'),
    screen: pick(value, 'screen', SURFACE_DEFAULTS.screen,
      candidate => candidate === 'inline' || candidate === 'fullscreen' || candidate === 'minimal'),
  }
}
