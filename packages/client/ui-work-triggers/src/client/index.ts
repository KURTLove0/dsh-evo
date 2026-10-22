/** Optional trigger controls composed through the sidebar, page, and selected-execution slots. */
import { TriggerManager, type ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-work-center/client'
import { TriggerCapture, TriggerNavigation, TriggerPage, type TriggerInjected } from './TriggerView.tsx'
import { createTriggerViewStore } from './store.ts'
import { en, zh } from './locales.ts'
/** Required capabilities for explicit host operations and optional UI composition. */
export const inject = ['slots', 'locale', 'layout', 'sessions', 'connection', 'remote', 'remote.workTriggerGateway', 'remote.workCenterGateway']
/**
 * Mount trigger views without tying worker lifetime to a browser page.
 * @param ctx - client plugin context.
 */
export function apply(ctx: ClientContext): void {
  const unwrap = <T>(result: { ok: true; value: T } | { ok: false; error: { message: string } }): T => {
    if (!result.ok) throw new Error(result.error.message)
    return result.value
  }
  const manager = new TriggerManager({
    options: async () => unwrap(await ctx.remote.workTriggerGateway.options({})),
    query: async request => unwrap(await ctx.remote.workTriggerGateway.query(request)),
    read: async request => unwrap(await ctx.remote.workTriggerGateway.read(request)),
    prepare: async request => unwrap(await ctx.remote.workTriggerGateway.prepare(request)),
    command: async request => unwrap(await ctx.remote.workTriggerGateway.command(request)),
  })
  const connection = ctx.get('connection') as ConnectionHandle, store = createTriggerViewStore()
  const open = () => { ctx.layout.openPage('work-triggers'); void manager.sync() }
  const refresh = () => { void manager.sync() }
  const injectView = (): TriggerInjected => ({
    hooks: { triggers: manager, hostDescription: connection.hostDescription },
    refresh: () => manager.sync(), query: query => manager.refresh(query), select: id => manager.select(id),
    command: request => manager.command(request),
    prepare: (source) => { ctx.layout.openPage('work-triggers'); void manager.prepare(source) },
    openWork: () => { ctx.layout.openPage('work-center') },
    openRun: async (ref) => {
      const detail = unwrap(await ctx.remote.workCenterGateway.detail(ref))
      ctx.sessions.open(detail.sessionId); ctx.layout.closePage()
    },
    openSession: (id) => { ctx.sessions.open(id); ctx.layout.closePage() },
  })
  ctx.effect(() => ctx.locale.register('workTriggers', { zh, en }), 'trigger dictionaries')
  ctx.effect(() => ctx.remote.$on('work-trigger/changed', refresh), 'trigger committed observations')
  ctx.on('connection/reset', () => { manager.invalidate(); refresh() })
  ctx.effect(() => connection.hostDescription.subscribe(() => {
    manager.invalidate()
    if (connection.hostDescription.getSnapshot() !== undefined) void manager.sync()
  }), 'trigger connection generations')
  ctx.effect(() => () => { manager.dispose() }, 'trigger manager disposal')
  ctx.slots.inject('shell.page', () => ctx.slots.register({ name: 'shell.page', key: 'work-triggers', locale: 'workTriggers', store, inject: injectView }, TriggerPage))
  ctx.slots.inject('work-center.delivery.triggers', () => ctx.slots.register({ name: 'work-center.delivery.triggers', id: 'native-triggers', locale: 'workTriggers', store, inject: injectView }, TriggerCapture))
  ctx.slots.inject('sidebar.session.action', () => ctx.slots.register({ name: 'sidebar.session.action', id: 'work-triggers', order: 15, locale: 'workTriggers',
    inject: () => ({ open }),
  }, TriggerNavigation))
  void manager.refresh()
}
