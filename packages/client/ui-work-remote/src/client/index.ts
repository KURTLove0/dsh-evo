/** Remote execution is composed through existing sidebar and page slots; no receiver is enabled here. */
import { RemoteWorkManager, type ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { RemotePage, RemoteNavigation, type RemoteInjected } from './RemoteView.tsx'
import { createRemoteViewStore } from './store.ts'
import { en, zh } from './locales.ts'
/** Only authenticated execution peers are selectable; ordinary runtime catalogs remain independent. */
export const inject = ['slots', 'locale', 'layout', 'connection', 'remote', 'remote.remoteWorkGateway']
/**
 * Mount the remote page and retain drafts for this plugin lifetime.
 * @param ctx - browser plugin context with the selected Host's generated gateway.
 */
export function apply(ctx: ClientContext): void {
  const unwrap = <T>(result: { ok: true; value: T } | { ok: false; error: { message: string } }): T => {
    if (!result.ok) throw new Error(result.error.message)
    return result.value
  }
  const manager = new RemoteWorkManager({ peers: async () => unwrap(await ctx.remote.remoteWorkGateway.peers({})),
    call: async request => unwrap(await ctx.remote.remoteWorkGateway.call(request)) })
  const connection = ctx.get('connection') as ConnectionHandle, store = createRemoteViewStore()
  const refresh = () => { manager.invalidate(); void manager.sync() }
  const injectView = (): RemoteInjected => ({ hooks: { remoteWork: manager, hostDescription: connection.hostDescription },
    refresh: () => manager.sync(), choose: peer => manager.choose(peer), select: id => manager.select(id),
    command: request => manager.command(request) })
  ctx.effect(() => ctx.locale.register('remoteWork', { zh, en }), 'remote execution dictionaries')
  ctx.on('connection/reset', refresh)
  ctx.effect(() => connection.hostDescription.subscribe(() => {
    manager.invalidate()
    if (connection.hostDescription.getSnapshot() !== undefined) void manager.sync()
  }), 'remote work connection observations')
  ctx.effect(() => () => { manager.dispose() }, 'remote work manager disposal')
  ctx.slots.inject('shell.page', () => ctx.slots.register({ name: 'shell.page', key: 'work-remote', locale: 'remoteWork', store,
    inject: injectView }, RemotePage))
  ctx.slots.inject('sidebar.session.action', () => ctx.slots.register({ name: 'sidebar.session.action', id: 'work-remote', order: 16,
    locale: 'remoteWork', inject: () => ({ open: () => { ctx.layout.openPage('work-remote'); void manager.sync() } }) }, RemoteNavigation))
  void manager.peers()
}
