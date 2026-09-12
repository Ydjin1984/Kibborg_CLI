/**
 * Package-owned invariant companion for `@kibborg/cli-bundle`.
 * @module @kibborg/cli-bundle/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@kibborg/cli-bundle'

/** Cordis companion plugin name. */
export const name = 'kibborg-cli-bundle-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

/**
 * No runtime invariant: the bundle is a composition — a patch file plus the
 * plugin entries that patch inserts. It owns no mutable relation of its own;
 * every row it mounts is audited by the invariant companion of the package
 * that owns that row.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
