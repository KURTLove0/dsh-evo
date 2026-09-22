/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-business-workflow-local`.
 * @module @deepseek-ai/dsh-business-workflow-local/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-business-workflow-local'

/** Cordis companion plugin name. */
export const name = 'business-workflow-local-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: `@deepseek-ai/dsh-business-workflow/invariant` owns the stage-transition and
 * verification-consistency checks over the seam's events, which this provider emits through the
 * Service Definition's contained dispatcher. The provider's own guarantees — whole-value submissions,
 * transition legality, and report consistency — are enforced at the mutating operations themselves
 * and asserted by the behavior suite; repeating them after publication would observe the same events
 * the definition companion already checks.
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
