/**
 * ui-business-workflow plugin halves: the browser entry's Definition, keyed
 * renderer, and dictionary registrations against the real SlotRegistry (with
 * fiber teardown proving removal — HMR safety), the inert node entry, and the
 * invariant companion's ownership reservation.
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { ConversationEventRegistry, SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import { apply as applyLocale, inject as localeInject } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '../src/client/index.ts'
import { apply as applyNode } from '../src/index.ts'
import * as BusinessWorkflowInvariant from '../src/invariant.ts'
import { en, NS, zh } from '../src/client/locales.ts'
import { businessWorkflowDefinition } from '../src/client/workflow-definition.ts'


/** Boot the browser half over a real slot tree declaring the keyed chat node. */
async function bench(): Promise<{ ctx: Context; fiber: ReturnType<Context['plugin']> }> {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  await ctx.plugin(ConversationEventRegistry).await()
  ctx.slots.register({
    name: 'root',
    children: {
      'conversation.chat.node': { kind: 'keyed', scope: 'session' },
      'conversation.session.header.actions': { kind: 'list', scope: 'session' },
      'sidebar.session.action': { kind: 'list', scope: 'root' },
      'shell.page': { kind: 'keyed', scope: 'root' },
    },
  } as never, () => null)
  // The locale plugin binds a settings scope, which reads the connection handle
  // and the forwarded-event port.
  ctx.provide('connection', { api: { settings: {} }, isLoopback: false } as never)
  ctx.provide('remote', { $on: () => () => {}, workflowGateway: { snapshot: async () => ({ ok: true, value: { workflows: [], runs: [], operations: [], latestRuns: [], presets: [] } }) } } as never)
  ctx.provide('remote.workflowGateway', {} as never)
  ctx.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
  // Workflow creation resolves through the session and workspace services.
  ctx.provide('sessions', {
    scope: () => undefined,
    sessionOf: () => undefined,
    list: { getSnapshot: () => ({ current: undefined, byId: {} }), subscribe: () => () => {} },
    currentProvideInfo: { getSnapshot: () => ({ sessionId: undefined, hooks: {}, props: {} }), subscribe: () => () => {} },
  } as never)
  ctx.provide('layout', { openPage: () => {}, closePage: () => {} } as never)
  ctx.provide('workspaces', { startSession: () => {} } as never)
  await ctx.plugin({ inject: localeInject, apply: applyLocale }).await()
  ctx.locale.setLocale('zh')
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { ctx, fiber }
}

describe('ui-business-workflow browser half', () => {
  it('declares the services it binds', () => {
    expect(inject).toEqual(['conversationEvents', 'slots', 'locale', 'sessions', 'workspaces', 'layout', 'remote', 'remote.workflowGateway'])
  })

  it('registers the sidebar module entry as page navigation, and fiber teardown removes it', async () => {
    const { ctx, fiber } = await bench()
    const entry = ctx.slots.entries('sidebar.session.action')
      .find(candidate => candidate.options.id === 'business-workflow')
    expect(entry).toBeDefined()
    expect(entry?.locale).toBe(NS)
    const injected = (entry?.inject as (() => { openWorkflows: unknown }) | undefined)?.()
    expect(typeof injected?.openWorkflows).toBe('function')
    await fiber.dispose()
    const after = ctx.slots.entries('sidebar.session.action')
      .find(candidate => candidate.options.id === 'business-workflow')
    expect(after).toBeUndefined()
  })

  it('registers the standalone page with the live feed and removes it on disposal', async () => {
    const { ctx, fiber } = await bench()
    const entry = ctx.slots.entries('shell.page').find(candidate => candidate.options.key === 'business-workflow')
    expect(entry).toBeDefined()
    const face = (entry!.inject as () => { command: unknown; closePage: unknown; hooks: { workflows: unknown } })()
    expect(typeof face.command).toBe('function')
    expect(typeof face.closePage).toBe('function')
    expect(face.hooks.workflows).toBeDefined()
    await fiber.dispose()
    expect(ctx.slots.entries('shell.page')).toEqual([])
  })

  it('leaves the conversation header free of workflow navigation', async () => {
    const { ctx, fiber } = await bench()
    expect(ctx.slots.entries('conversation.session.header.actions')).toEqual([])
    await fiber.dispose()
  })

  it('registers the Definition and keyed renderer, and fiber teardown removes both (HMR safety)', async () => {
    const { ctx, fiber } = await bench()
    expect(ctx.conversationEvents.entries().map(entry => entry.kind)).toEqual(['business-workflow'])
    const entry = ctx.slots.entries('conversation.chat.node')
      .find(candidate => candidate.options.key === 'business-workflow')
    expect(entry).toBeDefined()
    await fiber.dispose()
    expect(ctx.conversationEvents.entries()).toEqual([])
    const after = ctx.slots.entries('conversation.chat.node')
      .find(candidate => candidate.options.key === 'business-workflow')
    expect(after).toBeUndefined()
  })

  it('registers both dictionaries under its own namespace and releases them with the fiber', async () => {
    const { ctx, fiber } = await bench()
    const translate = ctx.locale.bind(NS)
    expect(translate('node.title')).toBe(zh['node.title'])
    ctx.locale.setLocale('en')
    expect(translate('node.title')).toBe(en['node.title'])

    // Withdrawn dictionaries leave the key unresolved rather than translated.
    await fiber.dispose()
    expect(translate('node.title')).not.toBe(en['node.title'])
  })

  it('keeps the English dictionary key-identical to the Chinese source of truth', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })
})

describe('ui-business-workflow node half', () => {
  it('contributes no host behavior', () => {
    // The node half exists only so the plugin appears in the Loader tree.
    expect(applyNode).not.toThrow()
  })
})

describe('business-workflow durable card', () => {
  it('keeps the accepted graph after a rejected draft and clears it on requirement revision', () => {
    const workflowId = 'bw-1'
    const start = businessWorkflowDefinition.start({} as never, {
      event: { type: 'tool-business-workflow/start', data: {
        workflowId, summary: 'Rank leads', stage: 'ready', revision: 1,
      } },
    } as never, {} as never)
    const composed = businessWorkflowDefinition.update({ state: start } as never, {
      event: { type: 'tool-business-workflow/composed', data: {
        workflowId, stage: 'composed', stepCount: 1, issues: [],
        steps: [{ id: 'score', title: 'Score leads', dependsOn: [], instruction: 'Rank.', inputs: [], objectives: [] }],
      } },
    } as never)
    const rejected = businessWorkflowDefinition.update({ state: composed } as never, {
      event: { type: 'tool-business-workflow/composed', data: {
        workflowId, stage: 'composed', stepCount: 0, steps: [],
        issues: [{ code: 'STEPS_EMPTY', message: 'Missing steps', remedy: 'Add a step' }],
      } },
    } as never)
    expect(rejected.steps).toEqual(composed.steps)
    expect(rejected.stepCount).toBe(1)
    expect(rejected.issues).toHaveLength(1)
    const revised = businessWorkflowDefinition.update({ state: rejected } as never, {
      event: { type: 'tool-business-workflow/clarified', data: {
        workflowId, stage: 'ready', revision: 2, gaps: [],
      } },
    } as never)
    expect(revised.steps).toEqual([])
    expect(revised.stepCount).toBe(0)
    expect(revised.issues).toEqual([])
  })
})

describe('ui-business-workflow invariant companion', () => {
  it('reserves package ownership under its declared companion name', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    const fiber = ctx.plugin(BusinessWorkflowInvariant)
    await fiber.await()
    expect(BusinessWorkflowInvariant.name).toBe('client-ui-business-workflow-invariant')
    expect(BusinessWorkflowInvariant.inject).toEqual(['invariants'])
    // Emitting an unrelated event proves the companion installed no audit.
    expect(() => { (ctx.emit as (event: string) => void)('slots/changed') }).not.toThrow()
    await fiber.dispose()
  })
})
