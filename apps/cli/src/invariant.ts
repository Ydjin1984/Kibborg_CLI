/**
 * Package-owned invariant companion for `@kibborg/cli`.
 * @module @kibborg/cli/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@kibborg/cli'

/** Cordis companion plugin name. */
export const name = 'kibborg-cli-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

/**
 * No runtime invariant: this package is the process entry point. It resolves a
 * profile and boots a Loader tree; the observable contract is process-level
 * (exit code, streamed output) and belongs to the launcher acceptance, while
 * every mounted row is audited by its own package companion.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
