/**
 * Package-owned invariant companion for `@kibborg/client-node`.
 * @module @kibborg/client-node/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@kibborg/client-node'

/** Cordis companion plugin name. */
export const name = 'kibborg-client-node-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

/**
 * No runtime invariant: this package is a transport adapter. It owns no
 * registry and no durable state — every request it makes is validated by the
 * API proxy contract and every fact it renders comes from the mux stream, so
 * there is no mutable relation inside the tree to audit here.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
