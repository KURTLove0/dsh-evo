/** Optional template library and intake contributions composed through declared slots. */
import { TemplateManager, type ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-work-center/client'
import { TemplateIntake, TemplatePage, type TemplateInjected } from './TemplateView.tsx'
import { TemplateNavigation } from './navigation.tsx'
import { createTemplateViewStore } from './store.ts'
import { zh, en } from './locales.ts'
/** Required Remote, navigation, locale, and template-intake declaration owners. */
export const inject = ['slots', 'locale', 'layout', 'connection', 'remote', 'remote.workTemplateGateway']
/**
 * Register independently disposable template page and intake controls.
 * @param ctx - browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  const unwrap = <T>(result: { ok: true; value: T } | { ok: false; error: { message: string } }): T => {
    if (!result.ok) throw new Error(result.error.message)
    return result.value
  }
  const manager = new TemplateManager({
    list: async () => unwrap(await ctx.remote.workTemplateGateway.list({})),
    read: async id => unwrap(await ctx.remote.workTemplateGateway.read({ id })),
    sources: async () => unwrap(await ctx.remote.workTemplateGateway.sources({})),
    examples: async () => unwrap(await ctx.remote.workTemplateGateway.examples({})),
    command: async request => unwrap(await ctx.remote.workTemplateGateway.command(request)),
    copyWorkflow: async request => unwrap(await ctx.remote.workTemplateGateway.copyWorkflow(request)),
  })
  const connection = ctx.get('connection') as ConnectionHandle
  const store = createTemplateViewStore()
  const injectView = (): TemplateInjected => ({
    hooks: { templates: manager, hostDescription: connection.hostDescription },
    refresh: () => manager.refresh(), select: id => manager.select(id), command: request => manager.command(request),
    copy: request => manager.copyWorkflow(request), openWork: () => { ctx.layout.openPage('work-center') },
    openWorkflow: () => { ctx.layout.openPage('business-workflow') },
  })
  ctx.effect(() => ctx.locale.register('workTemplates', { zh, en }), 'template dictionaries')
  ctx.effect(() => ctx.remote.$on('work-template/changed', () => { void manager.refresh() }), 'template mutation refresh')
  ctx.effect(() => ctx.remote.$on('business-workflow/changed', () => { void manager.refresh() }), 'template publication refresh')
  ctx.on('connection/reset', () => { void manager.refresh() })
  ctx.effect(() => () => { manager.dispose() }, 'template manager disposal')
  ctx.slots.inject('shell.page', () => ctx.slots.register({ name: 'shell.page', key: 'work-templates', locale: 'workTemplates', store, inject: injectView }, TemplatePage))
  ctx.slots.inject('work-center.intake.templates', () => ctx.slots.register({ name: 'work-center.intake.templates', id: 'private-templates', locale: 'workTemplates', store, inject: injectView }, TemplateIntake))
  ctx.slots.inject('sidebar.session.action', () => ctx.slots.register({ name: 'sidebar.session.action', id: 'work-templates', order: 0, locale: 'workTemplates',
    inject: () => ({ open: () => { ctx.layout.openPage('work-templates'); void manager.refresh() } }),
  }, TemplateNavigation))
  void manager.refresh()
}
