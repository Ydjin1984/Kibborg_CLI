/**
 * Profile boot for the `kibborg` CLI: resolve the profile, stack its patch
 * layers (bundle layers in `dsh.profile.bundles` order, the profile's own
 * `cordis.patch.yml`, the home layer, `--patch` overlays, the telemetry
 * switch), mount the tree over the profile's empty root config, keep the user
 * layers live, and wire fail-loud plus bounded shutdown.
 *
 * The profile is created on first use with this app's own bundle list, and the
 * flat module fallback under `$DSH_HOME/profiles/node_modules` is healed from
 * this app's dependency closure — the same contract `dsh` uses for its
 * profiles. App arguments reach the tree as an immutable snapshot through
 * `ctx.cmdlineArgs`; this module parses nothing.
 * @module @kibborg/cli/profile-boot
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FiberState, type Context } from '@deepseek-ai/cordis'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import type { EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import {
  boot,
  composeEntries,
  healProfilesModuleFallback,
  initProfile,
  installFailLoud,
  loadOptionalPatches,
  loadOverlayPatches,
  loadProfile,
  PROFILE_PATCH_FILENAME,
  PROFILES_DIR,
  watchUserPatches,
  type Profile,
} from '@deepseek-ai/dsh-app-boot'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import {
  DSH_LAUNCH_ENVIRONMENT_KEY,
  type LaunchEnvironmentSnapshot,
} from '@deepseek-ai/dsh-launch-environment'
import { provideCmdline } from '@deepseek-ai/dsh-cmdline'

/** Diagnostic program name for every message this boot prints. */
const NAME = 'kibborg'

/** The profile every invocation of this CLI boots. */
export const PROFILE_NAME = 'kibborg'

/** Absolute path of this app's package.json (src/ and lib/ sit one level under apps/cli). */
export const INSTALL_ANCHOR = fileURLToPath(new URL('../package.json', import.meta.url))

/** The bundle stack this app owns, in application order: the shared core, then this surface. */
export const PROFILE_BUNDLES: readonly string[] = [
  '@deepseek-ai/dsh-base',
  '@kibborg/cli-bundle',
]

/** The session-telemetry row id the DSH_TELEMETRY_DISABLED switch targets. */
const TELEMETRY_ROW_ID = 'session-telemetry-otel'

/** Root config filename inside a profile directory. */
export const PROFILE_ROOT_FILENAME = 'cordis.yml'

/** The empty root entry list every profile tree patches over. */
const PROFILE_ROOT_CONFIG = `# kibborg profile root — an empty entry list. The tree is composed as patches:
# each bundle in package.json's dsh.profile.bundles, then cordis.patch.yml, then any
# --patch overlays. Edit cordis.patch.yml, not this file.
[]
`

/** The home-level user patch layer (`$DSH_HOME/cordis.patch.yml`), applied over every profile. */
export function homePatchPath(): string {
  return join(resolveDshHome(), PROFILE_PATCH_FILENAME)
}

/** This app's profile directory under the Harness home. */
export function profileDir(): string {
  return join(resolveDshHome(), PROFILES_DIR, PROFILE_NAME)
}

/**
 * Resolve the telemetry opt-out switch into its boot patch. ANY non-empty value
 * (including `'0'`/`'false'`) disables: a privacy switch prefers
 * off-by-mistake over on-by-mistake.
 * @param disabledEnv - the raw `DSH_TELEMETRY_DISABLED` value (`undefined` when unset).
 * @param hasRow - whether the composition carries the telemetry row.
 * @returns the disable patch, or `undefined` when no hard-disable patch is required.
 */
export function resolveTelemetryPatch(disabledEnv: string | undefined, hasRow: boolean): PatchOptions | undefined {
  if ((disabledEnv ?? '') === '' || !hasRow) return undefined
  return { id: TELEMETRY_ROW_ID, disabled: true }
}

/**
 * Load the `kibborg` profile: create it on first use, heal the shared module
 * fallback, then (re)write the empty root config. The root is always rewritten
 * because the whole composition is patch layers and the Loader's tree
 * write-back can otherwise bake composed rows into it.
 * @param userLayer - `false` skips parsing `cordis.patch.yml` (the default dump).
 * @returns the loaded profile.
 */
export function prepareProfile(userLayer = true): Profile {
  const dir = profileDir()
  mkdirSync(dir, { recursive: true })
  initProfile(dir, PROFILE_BUNDLES)
  healProfilesModuleFallback(INSTALL_ANCHOR)
  const profile = loadProfile(NAME, PROFILE_NAME, INSTALL_ANCHOR, undefined, { userLayer })
  writeFileSync(join(profile.dir, PROFILE_ROOT_FILENAME), PROFILE_ROOT_CONFIG)
  return profile
}

/** One profile's patch layers (application order) and its composed row index. */
interface ComposedProfile {
  profile: Profile
  /** Bundle layers concatenated — the part below the user layers on a live reload. */
  bundlePatches: PatchOptions[]
  /** Layers above the user layers on a live reload: `--patch` overlays and the telemetry switch. */
  overlays: PatchOptions[]
  /** id → row of the composed tree, for the launcher's own row checks. */
  rows: ReadonlyMap<string, EntryOptions>
}

/**
 * Load the profile and compose its effective patch stack.
 * @param patchFiles - `--patch` overlay paths, in argv order.
 * @returns the profile, its patch layers, and the composed row index.
 */
function composeProfile(patchFiles: readonly string[]): ComposedProfile {
  const profile = prepareProfile()
  const homePatches = loadOptionalPatches(NAME, homePatchPath()) ?? []
  const overlays = patchFiles.flatMap(file => loadOverlayPatches(NAME, resolve(file)))
  const bundlePatches = profile.layers.flatMap(layer => layer.patches)
  const rows = new Map<string, EntryOptions>()
  for (const row of composeEntries([bundlePatches, profile.patches, homePatches, overlays])) {
    if (typeof row.id === 'string') rows.set(row.id, row)
  }
  const composedOverlays = [...overlays]
  const telemetryPatch = resolveTelemetryPatch(process.env.DSH_TELEMETRY_DISABLED, rows.has(TELEMETRY_ROW_ID))
  if (telemetryPatch !== undefined) composedOverlays.push(telemetryPatch)
  return { profile, bundlePatches, overlays: composedOverlays, rows }
}

/** The full patch stack of one composed profile, in application order. */
function allPatches(composed: ComposedProfile, homePatches: PatchOptions[]): PatchOptions[] {
  return [...composed.bundlePatches, ...composed.profile.patches, ...homePatches, ...composed.overlays]
}

/** Options for {@link runProfile}. */
export interface RunProfileOptions {
  /** This run's frozen environment snapshot, provided before any entry mounts. */
  environment: LaunchEnvironmentSnapshot
  /** `--patch` overlay paths, in argv order. */
  patchFiles: readonly string[]
  /** The invocation's inner arguments, handed to the tree through `ctx.cmdlineArgs`. */
  args: readonly string[]
}

/** Re-throw a watcher-setup failure unless a shutdown already owns the tree. */
function suppressShutdownError(ctx: Context, signal: AbortSignal, error: unknown): void {
  if (signal.aborted) return
  if (ctx.fiber.state !== FiberState.ACTIVE || ctx.get('loader') === undefined) return
  throw error
}

/**
 * Boot the `kibborg` profile end to end and leave process lifetime to the
 * mounted plugins (or to a one-shot runner a later phase mounts).
 * @param options - environment snapshot, overlays, and the booted app's own arguments.
 * @returns the settled root context.
 */
export async function runProfile(options: RunProfileOptions): Promise<Context> {
  const trace = (message: string): void => {
    if (process.env.KIBBORG_TRACE === '1') console.log(`kibborg[trace]: ${message}`)
  }
  trace('composing profile')
  const composed = composeProfile(options.patchFiles)
  trace(`profile ready: ${composed.profile.dir}; rows=${String(composed.rows.size)}`)
  const homePatches = loadOptionalPatches(NAME, homePatchPath()) ?? []
  const app: { current?: Context } = {}
  const signalShutdown = new AbortController()
  const shutdown = async (code: number): Promise<void> => {
    await app.current?.fiber.dispose()
    process.exit(code)
  }
  const interrupt = (code: number): void => {
    signalShutdown.abort()
    void shutdown(code)
  }
  process.on('SIGTERM', () => { interrupt(0) })
  process.on('SIGINT', () => { interrupt(130) })
  installFailLoud(NAME, process, async () => {
    await app.current?.fiber.dispose()
  })

  const rootConfig = join(composed.profile.dir, PROFILE_ROOT_FILENAME)
  // Fresh clones per generation: the include pushes `insert` rows into the
  // mounted tree BY REFERENCE, so reusing one parsed patch object would bake a
  // user override into the bundle's in-memory insert row.
  const composeLive = (): PatchOptions[] => structuredClone([
    ...composed.bundlePatches,
    ...loadOptionalPatches(NAME, composed.profile.patchPath) ?? [],
    ...loadOptionalPatches(NAME, homePatchPath()) ?? [],
    ...composed.overlays,
  ])
  const ctx = await boot(NAME, rootConfig, structuredClone(allPatches(composed, homePatches)), (hostCtx) => {
    app.current = hostCtx
    hostCtx.provide(DSH_LAUNCH_ENVIRONMENT_KEY, options.environment)
    provideCmdline(hostCtx, {
      args: options.args,
      exit: code => void shutdown(code),
    })
  })
  app.current = ctx
  if (!signalShutdown.signal.aborted
    && ctx.fiber.state === FiberState.ACTIVE
    && ctx.get('loader') !== undefined) {
    try {
      if (ctx.get('hmr') === undefined) {
        if (ctx.get('timer') === undefined) {
          await ctx.loader.create({ name: '@deepseek-ai/cordis-plugin-timer' })
        }
        await ctx.loader.create({ name: '@deepseek-ai/cordis-plugin-hmr', config: { root: [] } })
      }
      await watchUserPatches(ctx, {
        binName: NAME,
        filename: composed.profile.patchPath,
        compose: composeLive,
      })
      await watchUserPatches(ctx, {
        binName: NAME,
        filename: homePatchPath(),
        compose: composeLive,
      })
    } catch (error) {
      suppressShutdownError(ctx, signalShutdown.signal, error)
    }
  }
  return ctx
}
