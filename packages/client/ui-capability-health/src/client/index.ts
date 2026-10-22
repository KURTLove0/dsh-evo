/** Capability health page assembled from existing navigation and host observation services. */
import { HealthManager, type ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-general/client'
import { HealthPage, HealthNavigation, type HealthInjected } from './HealthPage.tsx'
import { createHealthViewStore } from './store.ts'
import { zh, en } from './locales.ts'

/** Existing shell owners and generated observation/probe operations. */
export const inject = ['slots', 'locale', 'layout', 'settingsPanel', 'connection', 'remote', 'remote.capabilityHealthGateway']
/**
 * Register the independent inspection page without automatically checking configuration or connecting servers.
 * @param ctx - browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  const unwrap = <T>(result: { ok: true; value: T } | { ok: false; error: { message: string } }): T => {
    if (!result.ok) throw new Error(result.error.message)
    return result.value
  }
  const manager = new HealthManager({
    choices: async () => unwrap(await ctx.remote.capabilityHealthGateway.choices({})),
    check: async request => unwrap(await ctx.remote.capabilityHealthGateway.check(request)),
    startProbe: request => ctx.remote.capabilityHealthGateway.startProbe(request),
    readProbe: async id => unwrap(await ctx.remote.capabilityHealthGateway.readProbe({ id })),
    cancelProbe: async id => unwrap(await ctx.remote.capabilityHealthGateway.cancelProbe({ id })),
  })
  const connection = ctx.get('connection') as ConnectionHandle
  ctx.effect(() => ctx.locale.register('capabilityHealth', { zh, en }), 'capability health dictionaries')
  const invalidate = () => {
    manager.invalidate()
    if (manager.getSnapshot().loaded || manager.getSnapshot().loading) void manager.load()
  }
  for (const event of ['workbench-agent/changed', 'settings/document-updated', 'credentials/reference-updated', 'credentials/record-updated', 'llm/adapters-updated'] as const)
    ctx.effect(() => ctx.remote.$on(event, invalidate), `health configuration invalidation: ${event}`)
  ctx.effect(() => ctx.remote.$on('capability-health/probe-changed', (id) => { void manager.recover(id) }), 'health probe observations')
  ctx.on('connection/reset', () => { invalidate(); void manager.recover() })
  ctx.effect(() => () => { manager.dispose() }, 'health browser manager disposal')
  const view = createHealthViewStore()
  ctx.slots.inject('shell.page', () => ctx.slots.register({ name: 'shell.page', key: 'capability-health', locale: 'capabilityHealth', store: view,
    inject: (): HealthInjected => ({
      hooks: { health: manager, hostDescription: connection.hostDescription },
      load: () => manager.load(), check: request => manager.check(request),
      start: request => manager.start(request), recover: id => manager.recover(id), cancel: id => manager.cancel(id),
      invalidate: () => { manager.invalidate() },
      repair: (target) => {
        if (target === 'agents') ctx.layout.openPage('agents')
        else if (target === 'workspace') ctx.layout.closePage()
        else ctx.settingsPanel.open(target === 'settings' ? 'general' : target)
      },
    }),
  }, HealthPage))
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({ name: 'sidebar.footer.action', id: 'capability-health', order: -1, locale: 'capabilityHealth',
    inject: () => ({ open: () => { ctx.layout.openPage('capability-health') } }),
  }, HealthNavigation))
}
