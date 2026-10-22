/** Work Center page assembly over existing execution owners and framework slots. */
import { WorkCenterManager, type ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-general/client'
import { WorkCenterPage, type WorkCenterInjected } from './WorkCenterPage.tsx'
import { SidebarWorkCenter } from './SidebarWorkCenter.tsx'
import { createWorkCenterViewStore } from './view-store.ts'
export type {} from './template-slot.ts'
import { zh, en } from './locales.ts'

/** Required execution gateways, presentation, and connection capabilities. */
export const inject = ['slots', 'locale', 'layout', 'sessions', 'connection', 'remote', 'remote.workCenterGateway', 'remote.workbenchAgentGateway', 'settingsPanel']
/**
 * Register the work directory and remount-surviving intake draft.
 * @param ctx - browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  const unwrap = <T>(result: { ok: true; value: T } | { ok: false; error: { message: string } }): T => {
    if (!result.ok) throw new Error(result.error.message)
    return result.value
  }
  const connection = ctx.get('connection') as ConnectionHandle
  const manager = new WorkCenterManager({
    options: async () => unwrap(await ctx.remote.workCenterGateway.options({})),
    query: async request => unwrap(await ctx.remote.workCenterGateway.query(request)),
    diagnose: async request => unwrap(await ctx.remote.workCenterGateway.diagnose(request)),
    detail: async request => unwrap(await ctx.remote.workCenterGateway.detail(request)),
    executors: async () => unwrap(await ctx.remote.workCenterGateway.executors({})),
    command: async request => unwrap(await ctx.remote.workCenterGateway.command(request)),
    preflight: async request => unwrap(await ctx.remote.workbenchAgentGateway.preflight(request)),
    submit: async request => unwrap(await ctx.remote.workbenchAgentGateway.command(request)),
    revisionBrief: async request => unwrap(await ctx.remote.workCenterGateway.revisionBrief(request)),
  }, {})
  const syncAttention = () => {
    void manager.setAttention(Object.values(ctx.sessions.list.getSnapshot().byId)
      .filter(session => session.pendingInteraction !== undefined).map(session => session.id))
  }
  ctx.effect(() => ctx.sessions.list.subscribe(syncAttention), 'work center pending sessions')
  syncAttention()
  ctx.effect(() => ctx.locale.register('workCenter', { zh, en }), 'work center dictionaries')
  for (const event of ['work-center/changed', 'workbench-agent/changed', 'business-workflow/changed'] as const)
    ctx.effect(() => ctx.remote.$on(event, () => { void manager.refresh() }), `work center refresh: ${event}`)
  ctx.on('connection/reset', () => { manager.invalidateCheck(); void manager.refresh() })
  ctx.effect(() => () => { manager.dispose() }, 'work center manager disposal')
  const store = createWorkCenterViewStore()
  ctx.slots.inject('shell.page', () => ctx.slots.register({
    name: 'shell.page', key: 'work-center', locale: 'workCenter', store,
    children: { 'work-center.delivery.triggers': { kind: 'list', scope: 'root' }, 'work-center.intake.templates': { kind: 'list', scope: 'root' }, 'work-center.delivery.artifacts': { kind: 'list', scope: 'root' } },
    inject: (): WorkCenterInjected => ({
      hooks: { work: manager, hostDescription: connection.hostDescription },
      diagnose: () => manager.diagnose(),
      repair: (target) => {
        if (target === 'health') ctx.layout.openPage('capability-health')
        else if (target === 'workflow') ctx.layout.openPage('business-workflow')
        else ctx.settingsPanel.open(target)
      },
      refresh: () => manager.refresh(), query: request => manager.setQuery(request), more: () => manager.more(),
      select: ref => manager.select(ref), command: request => manager.command(request),
      check: (request, revision) => manager.check(request, revision), submit: request => manager.submit(request),
      invalidateCheck: () =>{  manager.invalidateCheck() },
      configure: () => { ctx.layout.openPage('agents') },
      openSession: (id) => { ctx.sessions.open(id); ctx.layout.closePage() },
    }),
  }, WorkCenterPage))
  ctx.slots.inject('sidebar.session.action', () => ctx.slots.register({
    name: 'sidebar.session.action', id: 'work-center', order: -1, locale: 'workCenter',
    inject: () => ({ openWorkCenter: () => { ctx.layout.openPage('work-center') } }),
  }, SidebarWorkCenter))
}
