/** Statistics module assembly: whole-host sessions and an optional execution-cohort child. */
import { WorkStatisticsManager, type ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the shell's SlotMap merge (the 'settings.section' entry).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { StatsSection } from './StatsSection.tsx'
import type { StatsSectionInjected } from './StatsSection.tsx'
import { StatsSettingsStore } from './store.ts'
import { RunStatisticsPanel, type RunStatisticsInjected } from './RunStatisticsPanel.tsx'
import { createRunStatisticsViewStore } from './run-view-store.ts'
import { en, zh, type StatsKey } from './locales.ts'

export type { StatsSectionInjected, StatsSectionProps } from './StatsSection.tsx'
export { createRunStatisticsViewStore } from './run-view-store.ts'
export type { RunStatisticsInjected, RunStatisticsProps } from './RunStatisticsPanel.tsx'
export type { StatsKey } from './locales.ts'
export type { StatsSettingsState } from './store.ts'
export { StatsSettingsStore, sumUsage } from './store.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Filterable source-owned execution metrics, separate from whole-host session totals. */
    'settings.stats.runs': { kind: 'single'; scope: 'root' }
  }
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
  const view = createRunStatisticsViewStore()
  ctx.inject(['remote', 'remote.workCenterGateway', 'sessions'], (scope) => {
    const unwrap = <T>(result: { ok: true; value: T } | { ok: false; error: { message: string } }): T => {
      if (!result.ok) throw new Error(result.error.message)
      return result.value
    }
    const pending = () => Object.values(scope.sessions.list.getSnapshot().byId)
      .filter(session => session.pendingInteraction !== undefined).map(session => session.id).sort()
    const manager = new WorkStatisticsManager({
      choices: async () => unwrap(await scope.remote.workCenterGateway.statisticsChoices({})),
      read: async query => unwrap(await scope.remote.workCenterGateway.statistics({ ...query, attentionSessionIds: pending() })),
    })
    for (const event of ['workbench-agent/changed', 'business-workflow/changed'] as const)
      scope.effect(() => scope.remote.$on(event, () => { manager.invalidate() }), `run statistics invalidate: ${event}`)
    let attention = JSON.stringify(pending())
    scope.effect(() => scope.sessions.list.subscribe(() => {
      const next = JSON.stringify(pending())
      if (next !== attention) { attention = next; manager.invalidate() }
    }), 'run statistics connection attention')
    scope.on('connection/reset', () => { manager.invalidate() })
    scope.effect(() => () => { manager.dispose() }, 'run statistics observation disposal')
    scope.slots.inject('settings.stats.runs', () => scope.slots.register({
      name: 'settings.stats.runs', locale: NS, store: view,
      inject: (): RunStatisticsInjected => ({ hooks: { work: manager, hostDescription: connection.hostDescription },
        choices: () => manager.loadChoices(), read: query => manager.read(query), invalidate: () => { manager.invalidate() } }),
    }, RunStatisticsPanel))
  })
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
    children: { 'settings.stats.runs': { kind: 'single', scope: 'root' } },
    // Order 16, right after Runtimes (15): the two model-adjacent pages stay
    // adjacent, and a distinct order keeps the flat nav deterministic
    // against parallel registration.
    order: 16,
    label: () => t('nav'),
    inject: injected,
  }, StatsSection))
}
