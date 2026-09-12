/**
 * Package-owned invariant companion for `@kibborg/tui`.
 * @module @kibborg/tui/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@kibborg/tui'

/** Cordis companion plugin name. */
export const name = 'kibborg-tui-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

/**
 * No runtime invariant: the package renders strings from values its caller
 * supplies. It owns no registry, holds no durable state, and starts no
 * asynchronous work, so there is no relationship inside the tree to audit;
 * the rendering contract is pinned by the package's unit tests.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
