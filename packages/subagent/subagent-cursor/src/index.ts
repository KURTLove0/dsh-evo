/**
 * Cursor CLI Profile Bundle. Its plugin entry resolves the shared ACP provider
 * from this package's dependencies, while the Bundle patch selects the Cursor
 * command and provider name.
 * @module @deepseek-ai/dsh-subagent-cursor
 */

import { apply as applyAcp, Config as AcpConfig, inject as acpInject } from '@deepseek-ai/dsh-subagent-acp'

/** Cordis plugin name for the Cursor Bundle entry. */
export const name = 'subagent-cursor'

/** Services required by the shared ACP provider. */
export const inject = acpInject

/** Shared ACP provider configuration, with Cursor defaults supplied by the Bundle patch. */
export const Config = AcpConfig

/** Register the configured Cursor ACP provider. */
export const apply = applyAcp
