/**
 * Package-owned invariant companion for `@kibborg/server`.
 * @module @kibborg/server/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@kibborg/server'

/** Cordis companion plugin name. */
export const name = 'kibborg-server-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

/**
 * No runtime invariant: this package is a carrier. Its routes and sockets are
 * registered through `ctx.webServer`, whose own invariant companion already
 * audits that every registration is disposed with its fiber; the carrier keeps
 * no registry, cache, or durable state of its own to relate.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
