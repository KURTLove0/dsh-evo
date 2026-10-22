/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-work-triggers`.
 * @module @deepseek-ai/dsh-client-ui-work-triggers/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-work-triggers'

/** Cordis companion plugin name. */
export const name = 'client-ui-work-triggers-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this is a browser-side surface plugin whose node half owns no event stream
 * or mutable runtime data; durable trigger and native admission consistency belongs to the host work-triggers service.
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
