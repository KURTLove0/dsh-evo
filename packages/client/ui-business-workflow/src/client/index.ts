/**
 * Business-workflow plugin, browser half: registers the durable
 * business-workflow Conversation Definition, its keyed Chat renderer, and the
 * session-header module entry whose clicks send guided prompts into the
 * session (the model keeps driving the tools; the card keeps projecting them).
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { BusinessWorkflowAction, type BusinessWorkflowActionInjected } from './BusinessWorkflowAction.tsx'
import { BusinessWorkflowPanel } from './BusinessWorkflowPanel.tsx'
import { SidebarWorkflowAction, type SidebarWorkflowActionInjected } from './SidebarWorkflowAction.tsx'
import { en, NS, zh, type BusinessWorkflowKey } from './locales.ts'
import { createPromptSender } from './prompt-sender.ts'
import { createMaybeConversation, createWorkflowStarter } from './workflow-starter.ts'
import { businessWorkflowDefinition } from './workflow-definition.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Business-workflow node copy. */
    businessWorkflow: BusinessWorkflowKey
  }
}

/** Required services for the Definition, renderer, header + sidebar entries, and copy. */
export const inject = ['conversationEvents', 'slots', 'locale', 'sessions', 'workspaces']

/**
 * Client plugin body: register the Definition, dictionary, keyed renderer,
 * and the session-header module entry.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.conversationEvents.register(businessWorkflowDefinition)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-business-workflow: dictionaries')
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: 'business-workflow',
    locale: NS,
  }, BusinessWorkflowPanel))
  const sendPrompt = createPromptSender(ctx.sessions)
  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions',
    id: 'business-workflow',
    // After the job list: process state reads before guided composition work.
    order: 30,
    locale: NS,
    inject: (): BusinessWorkflowActionInjected => ({ sendPrompt }),
  }, BusinessWorkflowAction))
  const starter = createWorkflowStarter(ctx.sessions, ctx.workspaces, sendPrompt)
  ctx.effect(
    () => ctx.sessions.list.subscribe(() => { starter.flush() }),
    'ui-business-workflow: staged prompt flush',
  )
  const conversation = createMaybeConversation(ctx.sessions)
  ctx.slots.inject('sidebar.session.action', () => ctx.slots.register({
    name: 'sidebar.session.action',
    id: 'business-workflow',
    locale: NS,
    inject: (): SidebarWorkflowActionInjected => ({
      startWorkflow: starter.start,
      hooks: { conversation },
    }),
  }, SidebarWorkflowAction))
}
