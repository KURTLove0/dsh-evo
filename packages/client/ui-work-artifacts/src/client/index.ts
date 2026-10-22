/** Optional artifact directory and source-pinned Work Center capture controls. */
import { ArtifactManager, type ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-work-center/client'
import { ArtifactCapture, ArtifactNavigation, ArtifactPage, type ArtifactInjected } from './ArtifactView.tsx'
import { createArtifactViewStore } from './store.ts'
import { en, zh } from './locales.ts'
/** Required Remote, locale, navigation, session, and optional capture-slot owners. */
export const inject = ['slots', 'locale', 'layout', 'sessions', 'connection', 'remote', 'remote.workArtifactGateway']
/**
 * Register a directory whose metadata refresh never inspects current workspace files.
 * @param ctx - browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  const unwrap = <T>(result: { ok: true; value: T } | { ok: false; error: { message: string } }): T => {
    if (!result.ok) throw new Error(result.error.message)
    return result.value
  }
  const manager = new ArtifactManager({
    options: async () => unwrap(await ctx.remote.workArtifactGateway.options({})),
    query: async request => unwrap(await ctx.remote.workArtifactGateway.query(request)),
    read: async request => unwrap(await ctx.remote.workArtifactGateway.read(request)),
    register: async request => unwrap(await ctx.remote.workArtifactGateway.register(request)),
    inspectCurrent: async request => unwrap(await ctx.remote.workArtifactGateway.inspectCurrent(request)),
  }, { text: '' })
  const connection = ctx.get('connection') as ConnectionHandle
  const store = createArtifactViewStore()
  const refresh = () => { manager.invalidate(); void manager.refresh() }
  const injectView = (): ArtifactInjected => ({
    hooks: { artifacts: manager, hostDescription: connection.hostDescription },
    refresh: () => manager.refresh(), query: selection => manager.setQuery(selection),
    more: () => manager.more(),
    select: (id, version) => manager.select(id, version),
    inspect: () => manager.inspectCurrent(), register: request => manager.register(request),
    openRegistered: (receipt) => { ctx.layout.openPage('work-artifacts'); void manager.select(receipt.id, receipt.version) },
    openWork: () => { ctx.layout.openPage('work-center') },
    openSession: (id) => { ctx.sessions.open(id); ctx.layout.closePage() },
  })
  ctx.effect(() => ctx.locale.register('workArtifacts', { zh, en }), 'artifact dictionaries')
  ctx.effect(() => ctx.remote.$on('work-artifact/changed', refresh), 'artifact metadata refresh')
  for (const event of ['work-center/changed', 'workbench-agent/changed', 'business-workflow/changed'] as const)
    ctx.effect(() => ctx.remote.$on(event, refresh), 'artifact source observation invalidation')
  ctx.on('connection/reset', refresh)
  ctx.effect(() => connection.hostDescription.subscribe(() => {
    manager.invalidate()
    if (connection.hostDescription.getSnapshot() !== undefined) void manager.refresh()
  }), 'artifact connection observations')
  ctx.effect(() => () => { manager.dispose() }, 'artifact manager disposal')
  ctx.slots.inject('shell.page', () => ctx.slots.register({ name: 'shell.page', key: 'work-artifacts', locale: 'workArtifacts', store, inject: injectView }, ArtifactPage))
  ctx.slots.inject('work-center.delivery.artifacts', () => ctx.slots.register({ name: 'work-center.delivery.artifacts', id: 'project-artifacts', locale: 'workArtifacts', store, inject: injectView }, ArtifactCapture))
  ctx.slots.inject('sidebar.session.action', () => ctx.slots.register({ name: 'sidebar.session.action', id: 'work-artifacts', order: 10, locale: 'workArtifacts',
    inject: () => ({ open: () => { ctx.layout.openPage('work-artifacts'); void manager.refresh() } }),
  }, ArtifactNavigation))
  void manager.refresh()
}
