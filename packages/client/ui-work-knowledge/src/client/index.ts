/** Optional knowledge page; metadata reconnects never repeat explicit file reads or commands. */
import { KnowledgeManager, type ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { KnowledgePage, KnowledgeNavigation, type KnowledgeInjected } from './KnowledgeView.tsx'
import { createKnowledgeViewStore } from './store.ts'
import { en, zh } from './locales.ts'
/** Typed gateway, connection, shared workspace projection, and page/navigation owners. */
export const inject = ['slots', 'locale', 'layout', 'workspaces', 'connection', 'remote', 'remote.workKnowledgeGateway']
/**
 * Register a source-management page and its retained drafts/uncertain commands.
 * @param ctx - browser plugin context with the generated knowledge gateway.
 */
export function apply(ctx: ClientContext): void {
  const unwrap = <T>(result: { ok: true; value: T } | { ok: false; error: { message: string } }): T => {
    if (!result.ok) throw new Error(result.error.message)
    return result.value
  }
  const manager = new KnowledgeManager({
    options: async () => unwrap(await ctx.remote.workKnowledgeGateway.options({})),
    sources: async request => unwrap(await ctx.remote.workKnowledgeGateway.sources(request)),
    register: async request => unwrap(await ctx.remote.workKnowledgeGateway.register(request)),
    index: async request => unwrap(await ctx.remote.workKnowledgeGateway.index(request)),
    setEnabled: async request => unwrap(await ctx.remote.workKnowledgeGateway.setEnabled(request)),
    search: async request => unwrap(await ctx.remote.workKnowledgeGateway.search(request)),
    read: async request => unwrap(await ctx.remote.workKnowledgeGateway.read(request)),
  })
  const store = createKnowledgeViewStore(), connection = ctx.get('connection') as ConnectionHandle
  const refresh = () => { manager.invalidate(); void manager.refresh() }
  const injectView = (): KnowledgeInjected => ({
    hooks: { knowledge: manager, hostDescription: connection.hostDescription },
    select: id => manager.select(id), refresh: () => manager.refresh(), search: (text, limit) => manager.search(text, limit),
    read: citation => manager.read(citation), clearPreview: () => { manager.clearPreview() }, command: command => manager.command(command),
    discard: () => { manager.discard() }, copy: async (text) => { await navigator.clipboard.writeText(text) },
  })
  ctx.effect(() => ctx.locale.register('workKnowledge', { zh, en }), 'knowledge dictionaries')
  ctx.on('connection/reset', refresh)
  ctx.effect(() => connection.hostDescription.subscribe(() => {
    manager.invalidate()
    if (connection.hostDescription.getSnapshot() !== undefined) void manager.refresh()
  }), 'knowledge connection observations')
  ctx.effect(() => () => { manager.dispose() }, 'knowledge manager disposal')
  ctx.slots.inject('shell.page', () => ctx.slots.register({ name: 'shell.page', key: 'work-knowledge', locale: 'workKnowledge', store, inject: injectView }, KnowledgePage))
  ctx.slots.inject('sidebar.session.action', () => ctx.slots.register({ name: 'sidebar.session.action', id: 'work-knowledge', order: 17, locale: 'workKnowledge',
    inject: () => ({ open: () => { ctx.layout.openPage('work-knowledge'); void manager.refresh() } }),
  }, KnowledgeNavigation))
  void manager.refresh()
}
