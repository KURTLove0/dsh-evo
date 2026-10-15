import { describe, expect, it, vi } from 'vitest'
import type { ModelSelection, SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import { ModelDirectory } from '../src/client/directory.ts'

const initial: ModelSelection = { provider: 'deepseek-official', model: 'deepseek-v4-flash' }
const requested: ModelSelection = { provider: 'codex-cli', model: 'gpt-6.1-sol' }

describe('ModelDirectory selection state', () => {
  it('echoes a pending selection immediately and rolls it back when the Host rejects it', async () => {
    let settle: ((response: unknown) => void) | undefined
    const selectModel = vi.fn(() => new Promise((resolve) => { settle = resolve }))
    const directory = new ModelDirectory({
      models: vi.fn(() => Promise.resolve({
        result: { ok: true as const, value: { current: initial, routable: true, groups: [], failures: [] } },
      })),
      selectModel,
    } as never, 'session' as SessionId, () => true)
    await directory.load()

    const pending = directory.select(requested)
    expect(directory.store.getSnapshot()).toMatchObject({ current: requested, routable: true, status: 'selecting' })

    settle?.({ result: { ok: false, error: { code: 'model-unavailable', message: 'runtime offline', details: {} } } })
    await expect(pending).rejects.toThrow('model-unavailable: runtime offline')
    expect(directory.store.getSnapshot()).toMatchObject({
      current: initial,
      routable: true,
      status: 'error',
      error: 'model-unavailable: runtime offline',
    })
  })

  it('reconciles the optimistic selection with the Host-resolved effort', async () => {
    let settle: ((response: unknown) => void) | undefined
    const directory = new ModelDirectory({
      models: vi.fn(() => Promise.resolve({
        result: { ok: true as const, value: { current: initial, routable: true, groups: [], failures: [] } },
      })),
      selectModel: vi.fn(() => new Promise((resolve) => { settle = resolve })),
    } as never, 'session' as SessionId, () => true)
    await directory.load()

    const pending = directory.select(requested)
    settle?.({
      result: {
        ok: true,
        value: { selected: { ...requested, reasoningEffort: 'low' } },
      },
    })
    await pending
    expect(directory.store.getSnapshot()).toMatchObject({
      current: { ...requested, reasoningEffort: 'low' },
      routable: true,
      status: 'ready',
      error: null,
    })
  })
})
