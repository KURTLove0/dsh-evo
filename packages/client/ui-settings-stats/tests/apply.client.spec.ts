/** Stats section registration: slot declaration injection and the locale-following label thunk. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '@deepseek-ai/dsh-client-ui-settings-stats/client'
import { StatsSection } from '../src/client/StatsSection.tsx'

// These specs assert the shipped Chinese copy. The lane has no jsdom `window`,
// so browser-language detection never runs and a fresh LocaleRuntime opens on
// FALLBACK_LOCALE (en); bench stages zh explicitly on the locale instead.

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('zh')
  ctx.provide('locale', locale)
  ctx.provide('connection', { api: {}, isLoopback: true, hostDescription: { getSnapshot: () => undefined, subscribe: () => () => {} } } as never)
  const byId: Record<string, { id: string; pendingInteraction?: string }> = {}
  let changed = () => {}
  ctx.provide('sessions', { list: { getSnapshot: () => ({ byId }), subscribe: (listener: () => void) => { changed = listener; return () => {} } } } as never)
  const remote = { $on: vi.fn((_event: string, _listener: () => void) => () => {}), workCenterGateway: {
    statisticsChoices: vi.fn(async () => ({ ok: true, value: { executors: [], failures: [] } })),
    statistics: vi.fn(async (query: unknown) => ({ ok: true, value: { query, observedAt: 1 } })),
  } }
  ctx.provide('remote', remote as never)
  ctx.provide('remote.workCenterGateway', {} as never)
  return { ctx, slots: ctx.get('slots') as SlotRegistry, locale, remote, byId, changed: () => { changed() } }
}

function declare(slots: SlotRegistry): () => void {
  return slots.register(
    {
      name: 'root',
      children: {
        'settings.section': { kind: 'list', scope: 'root' },
      },
    } as never,
    () => null,
  )
}

describe('ui-settings-stats apply', () => {
  it('declares the services it uses', () => {
    expect(inject).toEqual(['slots', 'locale', 'connection'])
  })

  it('registers the stats nav entry for declarations before or after apply', async () => {
    const before = await bench()
    declare(before.slots)
    await before.ctx.plugin({ inject: [...inject], apply }).await()
    const entry = before.slots.entries('settings.section')[0]!
    expect(entry.component).toBe(StatsSection)
    expect(entry.options).toMatchObject({ id: 'stats', order: 16 })
    // The nav label is a locale-following thunk; owners resolve at read time.
    expect(resolveSlotLabel(entry.options.label)).toBe('统计')
    const injected = (entry.inject as unknown as () => import('../src/client/StatsSection.tsx').StatsSectionInjected)()
    expect(injected.t('nav')).toBe('统计')
    expect(injected.t('title')).toBe('统计')
    expect(typeof injected.controller.load).toBe('function')
    expect(injected.hooks.snapshot).toBe(injected.controller.store)
    const runEntry = before.slots.entries('settings.stats.runs')[0]!
    const runFace = (runEntry.inject as unknown as () => import('../src/client/RunStatisticsPanel.tsx').RunStatisticsInjected)()
    await runFace.choices()
    await runFace.read({ from: 0, to: 1, timeZone: 'UTC', usage: 'skip' })
    expect(runFace.hooks.work.getSnapshot().report?.observedAt).toBe(1)
    runFace.invalidate()
    expect(runFace.hooks.work.getSnapshot().stale).toBe(true)
    before.byId['attention'] = { id: 'attention', pendingInteraction: 'approval' }
    before.byId['quiet'] = { id: 'quiet' }
    before.changed(); before.changed()
    await runFace.read({ from: 0, to: 1, timeZone: 'UTC', usage: 'skip' })
    for (const [, listener] of before.remote.$on.mock.calls) listener()
    before.ctx.emit('connection/reset')
    before.remote.workCenterGateway.statistics.mockResolvedValueOnce({ ok: false, error: { message: 'Query refused' } } as never)
    await runFace.read({ from: 0, to: 1, timeZone: 'UTC', usage: 'skip' })
    expect(runFace.hooks.work.getSnapshot().error).toBe('Query refused')

    const after = await bench()
    await after.ctx.plugin({ inject: [...inject], apply }).await()
    expect(after.slots.entries('settings.section')).toHaveLength(0)
    declare(after.slots)
    await Promise.resolve()
    expect(after.slots.entries('settings.section')[0]!.component).toBe(StatsSection)
    // The self-inflicted ledger notifications hit the duplicate guard.
    expect(after.slots.entries('settings.section')).toHaveLength(1)
  })

  it('the label thunk follows the active locale without re-registration', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    b.locale.setLocale('en')
    expect(resolveSlotLabel(b.slots.entries('settings.section')[0]!.options.label)).toBe('Statistics')
    const injected = b.slots.entries('settings.section')[0]!.inject as unknown as () => import('../src/client/StatsSection.tsx').StatsSectionInjected
    expect(injected().t('title')).toBe('Statistics')
    b.locale.setLocale('zh')
    expect(resolveSlotLabel(b.slots.entries('settings.section')[0]!.options.label)).toBe('统计')
  })

  it('registers the zh/en nav dictionaries and disposes everything with the fiber', async () => {
    const b = await bench()
    declare(b.slots)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.locale.bind('settings.stats')('nav')).toBe('统计')
    await fiber.dispose()
    expect(b.slots.entries('settings.section')).toHaveLength(0)
    // The (ns, locale) seats are free again — the dictionary disposers ran.
    expect(() => b.locale.register('settings.stats', 'zh', {})).not.toThrow()
    expect(() => b.locale.register('settings.stats', 'en', {})).not.toThrow()
  })
})

it('keeps the session summary registered without the optional work statistics service', async () => {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx); ctx.provide('locale', locale)
  ctx.provide('connection', { api: {} } as never)
  const slots = ctx.get('slots') as SlotRegistry
  declare(slots)
  const fiber = ctx.plugin({ inject: [...inject], apply }); await fiber.await()
  expect(slots.entries('settings.section')).toHaveLength(1)
  expect(slots.entries('settings.stats.runs')).toHaveLength(0)
  await fiber.dispose()
  expect(slots.entries('settings.section')).toHaveLength(0)
  await ctx.fiber.dispose()
})
