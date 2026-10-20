/** Business-workflow page navigation and durable conversation rendering. */
import { WorkflowManager } from '@deepseek-ai/dsh-client-runtime/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { BusinessWorkflowPanel } from './BusinessWorkflowPanel.tsx'
import { WorkbenchPage, type WorkbenchPageInjected } from './WorkbenchPage.tsx'
import { createWorkflowViewStore } from './workbench-store.ts'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { SidebarWorkflowAction, type SidebarWorkflowActionInjected } from './SidebarWorkflowAction.tsx'
import { en, NS, zh, type BusinessWorkflowKey } from './locales.ts'
import { businessWorkflowDefinition } from './workflow-definition.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Business-workflow node copy. */
    businessWorkflow: BusinessWorkflowKey
  }
}

/** Required services for the Definition, renderer, page, sidebar entry, and copy. */
export const inject = [
  'conversationEvents',
  'slots',
  'locale',
  'sessions',
  'workspaces',
  'layout',
  'remote',
  'remote.workflowGateway',
]

/**
 * Client plugin body: register the Definition, dictionary, keyed renderer,
 * standalone page, and sidebar navigation.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.conversationEvents.register(businessWorkflowDefinition)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-business-workflow: dictionaries')
  ctx.slots.inject('conversation.chat.node', () =>
    ctx.slots.register(
      {
        name: 'conversation.chat.node',
        key: 'business-workflow',
        locale: NS,
      },
      BusinessWorkflowPanel,
    ),
  )
  const openWorkflows = (): void => {
    ctx.layout.openPage('business-workflow')
    void workflows.refresh()
  }
  const unwrap = <T>(result: { ok: true; value: T } | { ok: false; error: { message: string } }): T => {
    if (!result.ok) throw new Error(result.error.message)
    return result.value
  }
  const workflows = new WorkflowManager({
    snapshot: async id => unwrap(await ctx.remote.workflowGateway.snapshot(id === undefined ? {} : { id })),
    command: async request => unwrap(await ctx.remote.workflowGateway.command(request)),
    validate: async definition => unwrap(await ctx.remote.workflowGateway.validate(definition)),
  })
  ctx.effect(
    () =>
      ctx.remote.$on('business-workflow/changed', () => {
        void workflows.refresh()
      }),
    'workflow refresh notifications',
  )
  ctx.on('connection/reset', () => {
    void workflows.refresh()
  })
  ctx.effect(() => () =>{  workflows.dispose() }, 'workflow client disposal')
  const editorStore = createWorkflowViewStore()
  ctx.slots.inject('shell.page', () =>
    ctx.slots.register(
      {
        name: 'shell.page',
        key: 'business-workflow',
        locale: NS,
        store: editorStore,
        inject: (): WorkbenchPageInjected => ({
          command: request => workflows.command(request),
          selectWorkflow: id => workflows.select(id),
          validate: definition => workflows.validate(definition),
          closePage: () => {
            ctx.layout.closePage()
          },
          openSession: (id) => {
            ctx.sessions.open(id as import('@deepseek-ai/dsh-client-runtime/client').SessionId)
            ctx.layout.closePage()
          },
          openExecution: (parentId, childId) => {
            ctx.sessions.openSubagent({
              mode: 'one-shot',
              parentSessionId: parentId as import('@deepseek-ai/dsh-client-runtime/client').SessionId,
              childSessionId: childId as import('@deepseek-ai/dsh-client-runtime/client').SessionId,
            })
            ctx.layout.closePage()
          },
          hooks: { workflows },
        }),
      },
      WorkbenchPage,
    ),
  )
  ctx.slots.inject('sidebar.session.action', () =>
    ctx.slots.register(
      {
        name: 'sidebar.session.action',
        id: 'business-workflow',
        order: 10,
        locale: NS,
        inject: (): SidebarWorkflowActionInjected => ({ openWorkflows }),
      },
      SidebarWorkflowAction,
    ),
  )
}
