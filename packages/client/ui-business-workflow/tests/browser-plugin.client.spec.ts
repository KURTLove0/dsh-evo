/**
 * ui-business-workflow plugin halves: the browser entry's Definition, keyed
 * renderer, and dictionary registrations against the real SlotRegistry (with
 * fiber teardown proving removal — HMR safety), the inert node entry, and the
 * invariant companion's ownership reservation.
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import type { ChatConversationViewNode, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { ConversationEventRegistry, SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import { apply as applyLocale, inject as localeInject } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '../src/client/index.ts'
import { apply as applyNode } from '../src/index.ts'
import * as BusinessWorkflowInvariant from '../src/invariant.ts'
import { en, NS, zh } from '../src/client/locales.ts'
import { nextAction, sameWorkflowRows, workflowRows } from '../src/client/BusinessWorkflowAction.tsx'
import { createPromptSender } from '../src/client/prompt-sender.ts'
import { createMaybeConversation, createWorkflowStarter } from '../src/client/workflow-starter.ts'
import type { BusinessWorkflowChatData } from '../src/client/workflow-definition.ts'

const SID = 'session-bw-action' as SessionId

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
    },
  } as never, () => null)
  // The locale plugin binds a settings scope, which reads the connection handle
  // and the forwarded-event port.
  ctx.provide('connection', { api: { settings: {} }, isLoopback: false } as never)
  ctx.provide('remote', { $on: () => () => {} } as never)
  ctx.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
  // The header entry's sender and the sidebar starter resolve through these.
  ctx.provide('sessions', {
    scope: () => undefined,
    sessionOf: () => undefined,
    list: { getSnapshot: () => ({ current: undefined, byId: {} }), subscribe: () => () => {} },
    currentProvideInfo: { getSnapshot: () => ({ sessionId: undefined, hooks: {}, props: {} }), subscribe: () => () => {} },
  } as never)
  ctx.provide('workspaces', { startSession: () => {} } as never)
  await ctx.plugin({ inject: localeInject, apply: applyLocale }).await()
  ctx.locale.setLocale('zh')
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { ctx, fiber }
}

describe('ui-business-workflow browser half', () => {
  it('declares the services it binds', () => {
    expect(inject).toEqual(['conversationEvents', 'slots', 'locale', 'sessions', 'workspaces'])
  })

  it('registers the sidebar module entry with starter and conversation feed, and fiber teardown removes it', async () => {
    const { ctx, fiber } = await bench()
    const entry = ctx.slots.entries('sidebar.session.action')
      .find(candidate => candidate.options.id === 'business-workflow')
    expect(entry).toBeDefined()
    expect(entry?.locale).toBe(NS)
    const injected = (entry?.inject as (() => { startWorkflow: unknown; hooks: { conversation: unknown } }) | undefined)?.()
    expect(typeof injected?.startWorkflow).toBe('function')
    expect(injected?.hooks.conversation).toBeDefined()
    await fiber.dispose()
    const after = ctx.slots.entries('sidebar.session.action')
      .find(candidate => candidate.options.id === 'business-workflow')
    expect(after).toBeUndefined()
  })

  it('registers the header module entry with its sender, and fiber teardown removes it', async () => {
    const { ctx, fiber } = await bench()
    const entry = ctx.slots.entries('conversation.session.header.actions')
      .find(candidate => candidate.options.id === 'business-workflow')
    expect(entry).toBeDefined()
    expect(entry?.options).toMatchObject({ id: 'business-workflow', order: 30 })
    expect(entry?.locale).toBe(NS)
    const injected = (entry?.inject as (() => { sendPrompt: unknown }) | undefined)?.()
    expect(typeof injected?.sendPrompt).toBe('function')
    await fiber.dispose()
    const after = ctx.slots.entries('conversation.session.header.actions')
      .find(candidate => candidate.options.id === 'business-workflow')
    expect(after).toBeUndefined()
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

describe('prompt sender', () => {
  /** Sessions double whose face records prompts; toggles script the failure paths. */
  function sessionsDouble(opts: { scope: boolean; ok: boolean }) {
    const prompts: { content: unknown; mode: string }[] = []
    const scope = {}
    const face = {
      prompt: (content: unknown, mode: string) => {
        prompts.push({ content, mode })
        return Promise.resolve(opts.ok
          ? { ok: true as const, value: { accepted: true as const } }
          : { ok: false as const, error: { code: 'agent-busy', message: 'busy', details: {} } })
      },
    }
    const sessions = {
      scope: (id: SessionId) => (opts.scope && id === SID ? scope : undefined),
      sessionOf: (candidate: unknown) => (candidate === scope ? face : undefined),
    }
    return { sessions, prompts }
  }

  it('sends the text through the resolved session face in queue mode', async () => {
    const { sessions, prompts } = sessionsDouble({ scope: true, ok: true })
    const send = createPromptSender(sessions as never)
    await expect(send(SID, '请继续')).resolves.toBe(true)
    expect(prompts).toEqual([{ content: [{ type: 'text', text: '请继续' }], mode: 'queue' }])
  })

  it('returns false without a session scope, and false on host rejection', async () => {
    const missing = sessionsDouble({ scope: false, ok: true })
    await expect(createPromptSender(missing.sessions as never)(SID, 'x')).resolves.toBe(false)
    expect(missing.prompts).toEqual([])
    const rejected = sessionsDouble({ scope: true, ok: false })
    await expect(createPromptSender(rejected.sessions as never)(SID, 'x')).resolves.toBe(false)
  })
})

describe('workflow rows projection', () => {
  // Shared empty lists mirror the real fold: an untouched row keeps the same
  // event-payload references across flushes, so reference equality holds.
  const NO_GAPS: BusinessWorkflowChatData['gaps'] = []
  const NO_ISSUES: BusinessWorkflowChatData['issues'] = []

  /** Minimal card data; fields the equality reads default to one record at one stage. */
  function row(over: Partial<BusinessWorkflowChatData> = {}): BusinessWorkflowChatData {
    return {
      workflowId: 'bw-1',
      summary: '汇总销售数据',
      stage: 'ready',
      status: 'composed',
      revision: 2,
      gaps: NO_GAPS,
      issues: NO_ISSUES,
      stepCount: 0,
      steps: [],
      ...over,
    }
  }

  /** Minimal Chat node double; only `kind` and `data` participate in the projection. */
  function node(kind: string, data: unknown): ChatConversationViewNode {
    return { kind, data } as ChatConversationViewNode
  }

  it('selects only business-workflow nodes, in order', () => {
    const first = row({ workflowId: 'bw-1' })
    const second = row({ workflowId: 'bw-2', stage: 'verified', status: 'verified' })
    const rows = workflowRows([
      node('message', {}),
      node('business-workflow', first),
      node('tool-call', {}),
      node('business-workflow', second),
    ])
    expect(rows).toEqual([first, second])
  })

  it('selector equality ignores unrelated reshuffles but tracks real row movement', () => {
    const base = row()
    expect(sameWorkflowRows([base], [row()])).toBe(true)
    expect(sameWorkflowRows([base], [base, row({ workflowId: 'bw-2' })])).toBe(false)
    expect(sameWorkflowRows([base], [row({ stage: 'composed' })])).toBe(false)
    expect(sameWorkflowRows([base], [row({ verification: { passed: true, caseCount: 1, dryRun: true, cases: [] } })])).toBe(false)
  })

  it('maps every stage to its click label and guided prompt', () => {
    expect(nextAction('clarifying')).toEqual({ labelKey: 'action.continue', promptKey: 'prompt.continue' })
    expect(nextAction('ready')).toEqual({ labelKey: 'action.compose', promptKey: 'prompt.compose' })
    expect(nextAction('composed')).toEqual({ labelKey: 'action.verify', promptKey: 'prompt.verify' })
    expect(nextAction('verified')).toEqual({ labelKey: 'action.reverify', promptKey: 'prompt.verify' })
  })
})

describe('workflow starter', () => {
  /** List-feed double with a scriptable current selection. */
  function starterBench(current: SessionId | undefined) {
    const sent: [SessionId, string][] = []
    const send = (id: SessionId, text: string): Promise<boolean> => {
      sent.push([id, text])
      return Promise.resolve(true)
    }
    const starts: number[] = []
    const sessions = { list: { getSnapshot: () => ({ current, byId: {} }) } }
    const workspaces = { startSession: () => { starts.push(1) } }
    const starter = createWorkflowStarter(sessions as never, workspaces, send)
    return { starter, sent, starts }
  }

  it('sends straight into the current session when one is open', async () => {
    const { starter, sent, starts } = starterBench(SID)
    await expect(starter.start('请开始')).resolves.toBe(true)
    expect(sent).toEqual([[SID, '请开始']])
    expect(starts).toEqual([])
    expect(starter.staged()).toBeUndefined()
  })

  it('stages the prompt and starts a New Session when none is open', async () => {
    const bench = starterBench(undefined)
    await expect(bench.starter.start('请开始')).resolves.toBe(true)
    expect(bench.sent).toEqual([])
    expect(bench.starts).toEqual([1])
    expect(bench.starter.staged()).toBe('请开始')
  })

  it('flush is a no-op without a stage or without a current session', async () => {
    const empty = starterBench(undefined)
    empty.starter.flush()
    expect(empty.sent).toEqual([])

    const stagedNoSession = starterBench(undefined)
    await stagedNoSession.starter.start('请开始')
    stagedNoSession.starter.flush()
    expect(stagedNoSession.sent).toEqual([])
    expect(stagedNoSession.starter.staged()).toBe('请开始')

    // Stage, then the session arrives: flush sends and clears the stage.
    const sentLater: [SessionId, string][] = []
    const box: { current: SessionId | undefined } = { current: undefined }
    const sessions = { list: { getSnapshot: () => ({ current: box.current, byId: {} }) } }
    const starter = createWorkflowStarter(sessions as never, { startSession: () => {} }, (id, text) => {
      sentLater.push([id, text])
      return Promise.resolve(true)
    })
    await starter.start('请开始')
    box.current = SID
    starter.flush()
    expect(sentLater).toEqual([[SID, '请开始']])
    expect(starter.staged()).toBeUndefined()
    starter.flush()
    expect(sentLater).toHaveLength(1)
  })
})

describe('maybe-conversation feed', () => {
  /** Two-level double: the outer projection carries a scriptable inner source. */
  function feedBench() {
    const outerSubs = new Set<() => void>()
    const innerSubs = new Set<() => void>()
    const inner = {
      value: { marker: 'v1' } as unknown,
      subscribe(fn: () => void) {
        innerSubs.add(fn)
        return () => { innerSubs.delete(fn) }
      },
      getSnapshot: () => inner.value,
    }
    const state: { hooks: Record<string, typeof inner | undefined> } = { hooks: { session: inner } }
    const provideInfo = {
      subscribe(fn: () => void) {
        outerSubs.add(fn)
        return () => { outerSubs.delete(fn) }
      },
      getSnapshot: () => ({ sessionId: SID as string | undefined, hooks: state.hooks, props: {} }),
    }
    return { provideInfo, inner, state, outerSubs, innerSubs }
  }

  it('publishes the inner snapshot, forwards inner and outer notifications, and reattaches on swap', () => {
    const bench = feedBench()
    const feed = createMaybeConversation({ currentProvideInfo: bench.provideInfo })
    expect(feed.getSnapshot()).toEqual({ marker: 'v1' })

    let calls = 0
    const stop = feed.subscribe(() => { calls += 1 })
    expect(bench.innerSubs.size).toBe(1)

    // Inner flush: forwarded without re-subscribing.
    bench.inner.value = { marker: 'v2' }
    bench.innerSubs.forEach((fn) => { fn() })
    expect(calls).toBe(1)
    expect(feed.getSnapshot()).toEqual({ marker: 'v2' })

    // Outer flush with the SAME source: notified, no re-subscribe.
    bench.outerSubs.forEach((fn) => { fn() })
    expect(calls).toBe(2)
    expect(bench.innerSubs.size).toBe(1)

    // Session gone: the source is dropped and the snapshot reads undefined.
    bench.state.hooks.session = undefined
    bench.outerSubs.forEach((fn) => { fn() })
    expect(calls).toBe(3)
    expect(bench.innerSubs.size).toBe(0)
    expect(feed.getSnapshot()).toBeUndefined()

    stop()
    expect(bench.outerSubs.size).toBe(0)
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
