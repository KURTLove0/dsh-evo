/**
 * Runtimes settings plugin, browser half: registers the Runtimes page — the
 * model runtimes this deployment can call, each with the models it currently
 * loads. The page is read-only: configuration stays with the Models page, and
 * model selection stays with the composer's picker.
 * Export discipline: packages/client/AGENTS.md.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the shell's SlotMap merge (the 'settings.section' entry).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the ctx.remote merge and the forwarded-event key face
// (settings/provider topology invalidations ride the allowlist).
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { RuntimesSection } from './RuntimesSection.tsx'
import type { RuntimesSectionInjected } from './RuntimesSection.tsx'
import { RuntimesSettingsStore } from './store.ts'
import { en, zh, type RuntimesKey } from './locales.ts'

export type { RuntimesSectionInjected, RuntimesSectionProps } from './RuntimesSection.tsx'
export type { RuntimesKey } from './locales.ts'
export type { RuntimesSettingsState, RuntimeRow } from './store.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The Runtimes page copy. */
    'settings.runtimes': RuntimesKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'settings.runtimes'

/**
 * Refetch the page snapshot only after its first load: an unopened Runtimes
 * page must not fetch on background invalidations.
 * @param controller - the page store.
 */
export function refreshIfLoaded(controller: RuntimesSettingsStore): void {
  if (controller.store.getSnapshot().status === 'idle') return
  void controller.load()
}

/**
 * Required services (cordis fiber inject). The target slot is declared by
 * ui-settings' apply, whose activation order relative to this one is NOT
 * constrained; registration depends on each slot through `slots.inject()`.
 */
export const inject = ['slots', 'locale', 'connection', 'remote']

/**
 * Register the Runtimes section once the `settings.section` declaration is on
 * the ledger, wire its store to the connection, and keep it fresh on every
 * pushed invalidation (settings or provider topology).
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-runtimes: copy dictionaries')

  const connection = ctx.get('connection') as ConnectionHandle
  const controller = new RuntimesSettingsStore(connection.api)
  // Registration-time text (the nav label thunk) and the inject faces share
  // one bound translate; copy freshness rides the locale revision.
  const t = ctx.locale.bind(NS) as RuntimesSectionInjected['t']
  const injected = (): RuntimesSectionInjected => ({
    controller,
    hooks: { snapshot: controller.store },
    t,
  })

  // Pushed invalidations converge an open page without polling: settings
  // documents that activate or deactivate routes, and registry topology
  // commits (a settings-born route coming or going).
  ctx.effect(() => {
    const refreshRuntimes = (): void => { refreshIfLoaded(controller) }
    const disposers = [
      ctx.remote.$on('settings/document-updated', () => { refreshRuntimes() }),
      ctx.remote.$on('llm/adapters-updated', refreshRuntimes),
      ctx.on('connection/reset', refreshRuntimes),
    ]
    return () => {
      for (const dispose of disposers) dispose()
    }
  }, 'ui-settings-runtimes: pushed invalidations')

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'runtimes',
    order: 15,
    label: () => t('nav'),
    inject: injected,
  }, RuntimesSection))
}
