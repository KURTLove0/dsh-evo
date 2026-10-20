/** Independent workbench-agent page and navigation, composed through slots. */
import { AgentDirectoryManager, type ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { AgentPage, type AgentPageInjected } from './AgentPage.tsx'
import { SidebarAgentsAction } from './SidebarAgentsAction.tsx'
import { createAgentViewStore } from './view-store.ts'
import { zh, en } from './locales.ts'

/** Required page, data, and navigation capabilities. */
export const inject = ['slots', 'locale', 'layout', 'remote', 'remote.workbenchAgentGateway', 'sessions']
/**
 * Mount directory refresh, page, and navigation independently of preset settings.
 * @param ctx - browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  const unwrap = <T>(result: { ok: true; value: T } | { ok: false; error: { message: string } }): T => {
    if (!result.ok) throw new Error(result.error.message)
    return result.value
  }
  const directory = new AgentDirectoryManager({
    snapshot: async id => unwrap(await ctx.remote.workbenchAgentGateway.snapshot(id === undefined ? {} : { id })),
    command: async command => unwrap(await ctx.remote.workbenchAgentGateway.command(command)),
  })
  ctx.effect(() => ctx.locale.register('workbenchAgent', { zh, en }), 'workbench agent dictionaries')
  ctx.effect(() => ctx.remote.$on('workbench-agent/changed', () => { void directory.refresh() }), 'workbench agent refresh')
  ctx.on('connection/reset', () => { void directory.refresh() })
  ctx.effect(() => () => { directory.dispose() }, 'workbench agent directory disposal')
  const refresh = () => directory.refresh()
  const viewStore = createAgentViewStore()
  ctx.slots.inject('shell.page', () => ctx.slots.register({
    name: 'shell.page', key: 'agents', locale: 'workbenchAgent', store: viewStore,
    inject: (): AgentPageInjected => ({
      hooks: { agentDirectory: directory }, refresh,
      command: command => directory.command(command), select: id => directory.select(id),
      closePage: () => { ctx.layout.closePage() },
      openSession: (id) => { ctx.sessions.open(id); ctx.layout.closePage() },
    }),
  }, AgentPage))
  ctx.slots.inject('sidebar.session.action', () => ctx.slots.register({
    name: 'sidebar.session.action', id: 'agents', order: 0, locale: 'workbenchAgent',
    inject: () => ({ openAgents: () => { ctx.layout.openPage('agents') } }),
  }, SidebarAgentsAction))
}
