/** Page-store join: provider directory × model catalog, with rows in directory order. */
import { describe, expect, it } from 'vitest'
import type { RpcResponse } from '@deepseek-ai/dsh-api-remotes/client'
import { messageOf, RuntimesSettingsStore } from '../src/client/store.ts'

let nextRpc = 0
function ok<T>(value: T): RpcResponse<T> {
  return { rpcId: `r-${nextRpc++}` as never, result: { ok: true, value } }
}
function fail<T>(message: string): RpcResponse<T> {
  return { rpcId: `r-${nextRpc++}` as never, result: { ok: false, error: { code: 'internal', message, details: {} } } }
}

const DIRECTORY = [
  { provider: 'claude-cli', displayName: 'Claude CLI', settingsNs: 'llm-claude-cli', settingsPath: ['claude'], active: true },
  { provider: 'codex-cli', displayName: 'Codex CLI', settingsNs: 'llm-claude-cli', settingsPath: ['codex'], active: false },
  { provider: 'deepseek-official', displayName: 'DeepSeek', settingsNs: 'llm-deepseek', settingsPath: [], active: true },
]

const CATALOG = {
  groups: [
    { id: 'claude-cli', name: 'Claude CLI', models: [{ id: 'sonnet-4-5', name: 'Sonnet 4.5' }] },
    { id: 'deepseek-official', name: 'DeepSeek', models: [] },
  ] as { id: string; name: string; models: { id: string; name: string }[] }[],
  failures: [] as { id: string; name: string; message: string }[],
}

function api(overrides: {
  providers?: () => Promise<RpcResponse<{ providers: typeof DIRECTORY }>>
  models?: () => Promise<RpcResponse<typeof CATALOG>>
} = {}) {
  const face = {
    llm: {
      providers: overrides.providers ?? (() => Promise.resolve(ok({ providers: DIRECTORY }))),
      models: overrides.models ?? (() => Promise.resolve(ok(CATALOG))),
    },
  }
  return face as never
}

describe('RuntimesSettingsStore', () => {
  it('joins live rows with their models and leaves dormant routes out entirely', async () => {
    const store = new RuntimesSettingsStore(api())
    await store.load()
    const state = store.store.getSnapshot()
    expect(state.status).toBe('ready')
    expect(state.error).toBeNull()
    // The dormant codex route is a configuration candidate for the Models
    // page, not a runtime this deployment can call.
    expect(state.rows).toEqual([
      {
        provider: 'claude-cli',
        displayName: 'Claude CLI',
        settingsNs: 'llm-claude-cli',
        active: true,
        models: [{ id: 'sonnet-4-5', name: 'Sonnet 4.5' }],
        failure: undefined,
      },
      {
        provider: 'deepseek-official',
        displayName: 'DeepSeek',
        settingsNs: 'llm-deepseek',
        active: true,
        models: [],
        failure: undefined,
      },
    ])
  })

  it('omits a local-CLI runtime whose command the host could not find, even when its route is live', async () => {
    const store = new RuntimesSettingsStore(api({
      providers: () => Promise.resolve(ok({
        providers: [
          { provider: 'claude-cli', displayName: 'Claude CLI', settingsNs: 'llm-claude-cli', settingsPath: ['claude'], active: true, localCommand: 'claude', present: true },
          // Live but missing: the route registered, yet the CLI is gone.
          { provider: 'codex-cli', displayName: 'Codex CLI', settingsNs: 'llm-claude-cli', settingsPath: ['codex'], active: true, localCommand: 'codex', present: false },
          { provider: 'deepseek-official', displayName: 'DeepSeek', settingsNs: 'llm-deepseek', settingsPath: [], active: true },
        ] as never,
      })),
    }))
    await store.load()
    const state = store.store.getSnapshot()
    // The missing CLI leaves no row even though its route is live; the present
    // local runtime joins its catalog, and an API provider carries no presence.
    expect(state.rows.map(row => row.provider)).toEqual(['claude-cli', 'deepseek-official'])
    expect(state.rows[0]).toMatchObject({ active: true, models: [{ id: 'sonnet-4-5', name: 'Sonnet 4.5' }] })
  })

  it('carries the catalog failure text onto the failing live row', async () => {
    const store = new RuntimesSettingsStore(api({
      models: () => Promise.resolve(ok({
        groups: [],
        failures: [{ id: 'claude-cli', name: 'Claude CLI', message: 'the CLI is not installed' }],
      })),
    }))
    await store.load()
    const state = store.store.getSnapshot()
    expect(state.rows[0]).toMatchObject({ active: true, failure: 'the CLI is not installed' })
    // A live route with neither a group nor a failure entry carries neither.
    expect(state.rows[1]?.active).toBe(true)
    expect(state.rows[1]?.models).toBeUndefined()
    expect(state.rows[1]?.failure).toBeUndefined()
  })

  it('surfaces a directory failure as the page error', async () => {
    const store = new RuntimesSettingsStore(api({ providers: () => Promise.resolve(fail('directory down')) }))
    await store.load()
    expect(store.store.getSnapshot()).toMatchObject({ status: 'error', error: 'directory down' })
  })

  it('surfaces a catalog failure as the page error', async () => {
    const store = new RuntimesSettingsStore(api({ models: () => Promise.resolve(fail('catalog down')) }))
    await store.load()
    expect(store.store.getSnapshot()).toMatchObject({ status: 'error', error: 'catalog down' })
  })

  it('stringifies a non-Error load rejection', async () => {
    const store = new RuntimesSettingsStore(api({ providers: async () => { throw 'plain refusal' } }))
    await store.load()
    expect(store.store.getSnapshot()).toMatchObject({ status: 'error', error: 'plain refusal' })
  })

  it('lets the newest load win over a stale slow response', async () => {
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    let call = 0
    const store = new RuntimesSettingsStore(api({
      providers: async () => {
        call += 1
        if (call === 1) {
          await gate
          return fail('stale slow failure')
        }
        return ok({ providers: DIRECTORY })
      },
    }))
    const first = store.load()
    const second = store.load()
    release?.()
    await Promise.all([first, second])
    expect(store.store.getSnapshot().status).toBe('ready')
  })

  it('drops a stale successful response after a newer load finished', async () => {
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    let call = 0
    const store = new RuntimesSettingsStore(api({
      providers: async () => {
        call += 1
        if (call === 1) {
          await gate
          return ok({ providers: [] as never })
        }
        return ok({ providers: DIRECTORY })
      },
    }))
    const first = store.load()
    const second = store.load()
    await second
    release?.()
    await first
    // The stale empty directory never overwrote the newer join.
    expect(store.store.getSnapshot().rows).toHaveLength(2)
  })
})

describe('messageOf', () => {
  it('reads an Error message, and stringifies anything else a rejection may carry', () => {
    expect(messageOf(new Error('connection lost'))).toBe('connection lost')
    expect(messageOf('the host refused')).toBe('the host refused')
    expect(messageOf(undefined)).toBe('undefined')
  })
})
