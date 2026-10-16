/** Page-store aggregation: session listing rows folded into counts and usage buckets. */
import { describe, expect, it } from 'vitest'
import type { RpcResponse } from '@deepseek-ai/dsh-api-remotes/client'
import type { TokenUsageProjection } from '@deepseek-ai/dsh-token-meter/client'
import { messageOf, sumUsage, StatsSettingsStore } from '../src/client/store.ts'

let nextRpc = 0
function ok<T>(value: T): RpcResponse<T> {
  return { rpcId: `r-${nextRpc++}` as never, result: { ok: true, value } }
}
function fail<T>(message: string): RpcResponse<T> {
  return { rpcId: `r-${nextRpc++}` as never, result: { ok: false, error: { code: 'internal', message, details: {} } } }
}

const usage = (over: Partial<TokenUsageProjection> = {}): TokenUsageProjection => ({
  uncachedInputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  ...over,
})

/** One session.list row, trimmed to the fields the fold reads. */
function row(over: {
  blank?: boolean
  usage?: TokenUsageProjection
  projections?: boolean
} = {}) {
  return {
    sessionId: `s-${nextRpc}` as never,
    updatedAt: 0,
    running: false,
    blank: over.blank ?? false,
    ...(over.projections === false ? {} : {
      projections: { asOfSeq: 0, values: over.usage === undefined ? {} : { tokenUsage: over.usage } },
    }),
  }
}

function api(list: () => Promise<RpcResponse<{ items: ReturnType<typeof row>[] }>> = () => Promise.resolve(ok({ items: [] }))) {
  return { sessions: { list } } as never
}

describe('StatsSettingsStore', () => {
  it('counts sessions and started conversations from the listing rows', async () => {
    const store = new StatsSettingsStore(api(() => Promise.resolve(ok({
      items: [row({ blank: true }), row(), row()],
    }))))
    await store.load()
    expect(store.store.getSnapshot()).toMatchObject({ status: 'ready', sessions: 3, started: 2 })
  })

  it('sums the usage buckets of the rows that reported usage', async () => {
    const store = new StatsSettingsStore(api(() => Promise.resolve(ok({
      items: [
        row({ usage: usage({ uncachedInputTokens: 100, outputTokens: 40, cacheReadTokens: 500, cacheWriteTokens: 60 }) }),
        row({ usage: usage({ uncachedInputTokens: 25, outputTokens: 10, cacheReadTokens: 5 }) }),
        // A session with no usage projection contributes nothing.
        row(),
        row({ projections: false }),
      ],
    }))))
    await store.load()
    expect(store.store.getSnapshot().usage).toEqual({
      uncachedInputTokens: 125,
      outputTokens: 50,
      cacheReadTokens: 505,
      cacheWriteTokens: 60,
    })
  })

  it('serves zeroed buckets when no session reported usage', async () => {
    const store = new StatsSettingsStore(api(() => Promise.resolve(ok({ items: [row(), row()] }))))
    await store.load()
    expect(store.store.getSnapshot().usage).toEqual(usage())
  })

  it('surfaces a listing failure as the page error', async () => {
    const store = new StatsSettingsStore(api(() => Promise.resolve(fail('listing down'))))
    await store.load()
    expect(store.store.getSnapshot()).toMatchObject({ status: 'error', error: 'listing down' })
  })

  it('stringifies a non-Error load rejection', async () => {
    const store = new StatsSettingsStore(api(async () => { throw 'plain refusal' }))
    await store.load()
    expect(store.store.getSnapshot()).toMatchObject({ status: 'error', error: 'plain refusal' })
  })

  it('drops a stale successful response after a newer load finished', async () => {
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    let call = 0
    const store = new StatsSettingsStore(api(async () => {
      call += 1
      if (call === 1) {
        await gate
        return ok({ items: [row()] })
      }
      return ok({ items: [row(), row()] })
    }))
    const first = store.load()
    const second = store.load()
    await second
    release?.()
    await first
    // The stale one-session listing never overwrote the newer two-session one.
    expect(store.store.getSnapshot().sessions).toBe(2)
  })
})

describe('sumUsage', () => {
  it('skips absent usages and sums the rest bucket-wise', () => {
    expect(sumUsage([
      undefined,
      usage({ uncachedInputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 4 }),
      usage({ outputTokens: 5 }),
    ])).toEqual({ uncachedInputTokens: 1, outputTokens: 7, cacheReadTokens: 3, cacheWriteTokens: 4 })
  })

  it('returns zeroed buckets for an all-absent input', () => {
    expect(sumUsage([undefined, undefined])).toEqual(usage())
  })
})

describe('messageOf', () => {
  it('reads an Error message, and stringifies anything else a rejection may carry', () => {
    expect(messageOf(new Error('connection lost'))).toBe('connection lost')
    expect(messageOf('the host refused')).toBe('the host refused')
  })
})
