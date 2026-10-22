/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-workspace`.
 * @module @deepseek-ai/dsh-client-ui-workspace/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-workspace'

/** Cordis companion plugin name. */
export const name = 'client-ui-workspace-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: workspace browser, picker, and archive entries consume
 * Host observations and submit owner-validated RPCs. Durable membership and
 * accounting relationships belong to the workspace registry.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
