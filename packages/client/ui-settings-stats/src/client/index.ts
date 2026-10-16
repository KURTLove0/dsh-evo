/**
 * Statistics settings plugin, browser half: registers the Statistics page —
 * whole-host usage figures (sessions, token usage, cost placeholder)
 * aggregated from one `session.list` call. The page is read-only: session
 * listing carries no push event, so it loads on mount and refreshes on the
 * user's gesture.
 * Export discipline: packages/client/AGENTS.md.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the shell's SlotMap merge (the 'settings.section' entry).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { StatsSection } from './StatsSection.tsx'
import type { StatsSectionInjected } from './StatsSection.tsx'
import { StatsSettingsStore } from './store.ts'
import { en, zh, type StatsKey } from './locales.ts'

export type { StatsSectionInjected, StatsSectionProps } from './StatsSection.tsx'
export type { StatsKey } from './locales.ts'
export type { StatsSettingsState } from './store.ts'
export { StatsSettingsStore, sumUsage } from './store.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The Statistics page copy. */
    'settings.stats': StatsKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'settings.stats'

/**
 * Required services (cordis fiber inject). The target slot is declared by
 * ui-settings-general's shell registration; registration depends on the slot
 * through `slots.inject()`.
 */
export const inject = ['slots', 'locale', 'connection']

/**
 * Register the Statistics section once the `settings.section` declaration is
 * on the ledger and wire its store to the connection.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-stats: copy dictionaries')

  const connection = ctx.get('connection') as ConnectionHandle
  const controller = new StatsSettingsStore(connection.api)
  // Registration-time text (the nav label thunk) and the inject face share
  // one bound translate; copy freshness rides the locale revision.
  const t = ctx.locale.bind(NS) as StatsSectionInjected['t']
  const injected = (): StatsSectionInjected => ({
    controller,
    hooks: { snapshot: controller.store },
    t,
  })

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'stats',
    // Order 16, right after Runtimes (15): the two model-adjacent pages stay
    // adjacent, and a distinct order keeps the flat nav deterministic
    // against parallel registration.
    order: 16,
    label: () => t('nav'),
    inject: injected,
  }, StatsSection))
}
