/**
 * Package-owned invariant companion for the Cursor CLI Profile Bundle.
 * @module @deepseek-ai/dsh-subagent-cursor/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-subagent-cursor'

/** Cordis companion plugin name. */
export const name = 'subagent-cursor-invariant'
/** Service required before registering the package. */
export const inject = ['invariants']

// No runtime invariant: this package forwards ACP registration with Bundle
// configuration. The ACP provider owns run lifecycle and process teardown.
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - context carrying the invariant registry.
 * @returns the installed registration's disposer.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
