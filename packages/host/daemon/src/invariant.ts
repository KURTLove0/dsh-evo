/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-daemon`.
 * @module @deepseek-ai/dsh-daemon/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-daemon'

/** Cordis companion plugin name. */
export const name = 'daemon-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the daemon process is not a cordis application and
 * owns no event sequence or mutable data relation beyond the health
 * endpoint's answer, which every consumer re-validates per call.
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
