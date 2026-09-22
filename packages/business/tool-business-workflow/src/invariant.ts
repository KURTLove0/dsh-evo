/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-tool-business-workflow`.
 * @module @deepseek-ai/dsh-tool-business-workflow/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-tool-business-workflow'

/** Cordis companion plugin name. */
export const name = 'tool-business-workflow-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this consumer holds no state of its own — it converts model
 * arguments to seam requests and renders returned reports, both bounded by the tool
 * registry's validation and the Service Definition's own invariants. The subagent
 * delegation's start/result/dispose pairing is owned by the subagent seam's
 * invariants, and step-runner failures settle into the verification report by the
 * provider's contract.
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
