/**
 * Settings shell and ownerless-copy plugin, browser half: renders the
 * `sidebar.settings` occupant — panel chrome, section navigation, and the
 * onboarding stage — the `sidebar.config` occupant (the sidebar's
 * configuration module nav), and registers everything on the Settings pages
 * that belongs to no single feature: the trigger/header chrome content,
 * local-document action, General section, and `settings` dictionaries.
 * Feature-owned rows and sections stay with their features.
 * Export discipline: packages/client/AGENTS.md.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: the settings slot declarations plus the ctx.settingsScope Context
// merge. Cross-plugin collaboration goes through the service, never a value
// import (client bundle purity gate).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls ctx.locale into this program.
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls ui-sidebar's SlotMap merge (the 'sidebar.config' entry).
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {
  SettingsOnboardingStep, SettingsRootInjected, SettingsSectionRow,
} from './shell-contract.ts'
import { SettingsRoot } from './SettingsRoot.tsx'
import { ConfigNav } from './ConfigNav.tsx'
import { SettingsPanel } from './navigation.ts'
export type { SettingsPanel } from './navigation.ts'
import type { ConfigNavInjected } from './ConfigNav.tsx'
import { CloseLabel, HeaderContent } from './chrome.tsx'
import { GeneralSection } from './GeneralSection.tsx'
import { SettingsDocumentAction } from './SettingsDocumentAction.tsx'
import type { SettingsDocumentActionInjected } from './SettingsDocumentAction.tsx'
import { SettingsDocumentStore } from './settings-document-store.ts'
import { en, zh, type SettingsKey } from './locales.ts'

export type {
  CloseLabelProps, HeaderContentProps,
} from './chrome.tsx'
export type { ConfigNavInjected, ConfigNavProps, SectionsObservable } from './ConfigNav.tsx'
export type {
  GeneralSectionComponentProps,
} from './GeneralSection.tsx'
export type { SettingsDocumentActionInjected, SettingsDocumentActionProps } from './SettingsDocumentAction.tsx'
export type { SettingsDocumentState } from './settings-document-store.ts'
export { SettingsDocumentStore } from './settings-document-store.ts'
export type { SettingsKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Shell chrome + shell-owned General section copy. */
    settings: SettingsKey
  }
}

/** Dictionary namespace owned by this plugin (shell chrome + General copy). */
const NS = 'settings'

/**
 * Required services (cordis fiber inject). The target slots are declared by
 * ui-settings' apply, whose activation order relative to this one is NOT
 * constrained; registrations depend on their slots through `slots.inject()`.
 */
export const inject = ['slots', 'locale', 'connection', 'settingsScope']

/**
 * Register the `settings` dictionaries, the panel chrome content, the General
 * section, and the sidebar's configuration module nav, each once its slot
 * declaration is on the ledger.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-general: dictionaries')

  // Copy freshness is framework-owned: components read the standard `t`
  // seat, and the nav label is a thunk the owner resolves per render — no
  // locale/change re-registration wiring.
  const t = ctx.locale.bind(NS)
  const connection = ctx.get('connection') as ConnectionHandle
  // The action follows the shared describe mirror, whose owning plugin
  // already refreshes it on document commits and reconnects.
  const documentController = connection.isLoopback
    ? new SettingsDocumentStore(connection.api, ctx.settingsScope.describe())
    : undefined
  const documentInjected = documentController === undefined
    ? undefined
    : (): SettingsDocumentActionInjected => ({
      controller: documentController,
      hooks: { snapshot: documentController.store },
    })
  ctx.effect(() => () => { documentController?.dispose() }, 'ui-settings-general: document action directory')
  // The settings shell: this package occupies the sidebar-owned holes and
  // declares the settings slots. Ledger → nav-row projection as an observable
  // source (uSES contract: getSnapshot returns the cached rows until the
  // ledger version moves). Labels may be locale-following thunks, so the cache
  // key includes the locale revision and subscribers ride both sources. One
  // instance serves both the panel shell and the sidebar config nav.
  let rowsVersion = -1
  let rowsRevision = -1
  let rows: readonly SettingsSectionRow[] = []
  let onboardingVersion = -1
  let onboardingSteps: readonly SettingsOnboardingStep[] = []
  const sectionsSource = {
    getSnapshot: (): readonly SettingsSectionRow[] => {
      const version = ctx.slots.getVersion('settings.section')
      const revision = ctx.locale.getSnapshot().revision
      if (version !== rowsVersion || revision !== rowsRevision) {
        rowsVersion = version
        rowsRevision = revision
        rows = ctx.slots.entries('settings.section')
          .map(e => ({
            /* v8 ignore next -- list-slot registration requires id (SlotCore rejects an entry without one) */
            id: e.options.id ?? '',
            order: e.options.order ?? 0,
            label: resolveSlotLabel(e.options.label) ?? '',
          }))
          .sort((a, b) => a.order - b.order)
      }
      return rows
    },
    subscribe: (listener: () => void): (() => void) => {
      const offLedger = ctx.slots.subscribe('settings.section', listener)
      const offLocale = ctx.locale.subscribe(listener)
      return () => {
        offLedger()
        offLocale()
      }
    },
  }
  // Sidebar config nav → panel: one pending section per request; the panel
  // consumes it on the render that acts, so a re-open never rides a stale one.
  const panelRequests = createSnapshotStore<{ section: string | null }>({ section: null })
  const navigation = new SettingsPanel(ctx, (section) => {
    if (!sectionsSource.getSnapshot().some(row => row.id === section)) throw new Error(`Settings section ${section} is unavailable.`)
    panelRequests.update((state) => { state.section = section })
  })
  const shellInjected = (): SettingsRootInjected => ({
    hooks: {
      sections: sectionsSource,
      onboardingSteps: {
        getSnapshot: () => {
          const version = ctx.slots.getVersion('settings.onboarding')
          if (version !== onboardingVersion) {
            onboardingVersion = version
            onboardingSteps = ctx.slots.entries('settings.onboarding')
              .map(e => ({
                /* v8 ignore next -- list-slot registration requires id */
                id: e.options.id ?? '',
                order: e.options.order ?? 0,
              }))
              .sort((a, b) => a.order - b.order)
          }
          return onboardingSteps
        },
        subscribe: listener => ctx.slots.subscribe('settings.onboarding', listener),
      },
      panelRequests: {
        getSnapshot: () => panelRequests.getSnapshot().section,
        subscribe: listener => panelRequests.subscribe(listener),
      },
    },
    consumePanelRequest: () => { panelRequests.update((s) => { s.section = null }) },
  })
  ctx.slots.inject('sidebar.settings', () => ctx.slots.register({
    name: 'sidebar.settings',
    children: {
      'settings.header': { kind: 'single', scope: 'root' },
      'settings.action': { kind: 'list', scope: 'root' },
      'settings.close': { kind: 'single', scope: 'root' },
      'settings.section': { kind: 'list', scope: 'root' },
      'settings.onboarding': { kind: 'list', scope: 'root' },
    },
    inject: shellInjected,
    // The panel's own copy seats (group chrome, General section copy) read
    // this plugin's dictionary through the framework-synthesized `t` seat.
    locale: NS,
  }, SettingsRoot))

  // The sidebar's configuration module nav: one "配置" title over the
  // Runtimes / Statistics / Settings module rows, above the foot's trigger.
  const configInjected = (): ConfigNavInjected => ({
    hooks: { sections: sectionsSource },
    request: (section: string) => { navigation.open(section) },
    t,
  })
  ctx.slots.inject('sidebar.config', () => ctx.slots.register({
    name: 'sidebar.config',
    inject: configInjected,
  }, ConfigNav))

  ctx.slots.inject('settings.header', () =>
    ctx.slots.register({ name: 'settings.header', locale: NS }, HeaderContent))
  if (documentInjected !== undefined) {
    ctx.slots.inject('settings.action', () => ctx.slots.register({
      name: 'settings.action',
      id: 'open-document',
      order: 0,
      locale: NS,
      inject: documentInjected,
    }, SettingsDocumentAction))
  }
  ctx.slots.inject('settings.close', () =>
    ctx.slots.register({ name: 'settings.close', locale: NS }, CloseLabel))
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'general',
    order: 0,
    label: () => t('general.nav'),
    locale: NS,
    children: { 'settings.general.item': { kind: 'list', scope: 'root' } },
  }, GeneralSection))
}
