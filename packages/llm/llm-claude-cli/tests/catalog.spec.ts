import { describe, expect, it } from 'vitest'
import type { LlmModelInfo } from '@deepseek-ai/dsh-llm'
import { CodexCliAdapter, resolveCodexAdapterOptions } from '@deepseek-ai/dsh-llm-claude-cli'

/** Build one adapter whose native catalog probe is pinned, config models real. */
function adapterWithNative(
  native: readonly unknown[],
  config: object = {},
): { adapter: CodexCliAdapter; probes: () => number } {
  const resolved = resolveCodexAdapterOptions(config)
  let probeCount = 0
  const adapter = new CodexCliAdapter({ options: () => resolved.connection })
  // The probe is the process boundary the unit test pins in place of a spawn.
  ;(adapter as unknown as { probeNativeCatalog: () => Promise<unknown[]> }).probeNativeCatalog
    = async () => {
      probeCount += 1
      return [...native]
    }
  return { adapter, probes: () => probeCount }
}

describe('codex directory merges configured models', () => {
  it('appends a configured model the native catalog does not advertise', async () => {
    const { adapter } = adapterWithNative(
      [{ model: 'gpt-native', displayName: 'GPT Native' }],
      { models: [{ id: 'gpt-hidden', name: 'GPT Hidden' }] },
    )
    await expect(adapter.listModels('codex-cli')).resolves.toEqual([{
      provider: 'codex-cli',
      id: 'gpt-native',
      name: 'GPT Native',
      inputModalities: ['text'],
    }, {
      provider: 'codex-cli',
      id: 'gpt-hidden',
      name: 'GPT Hidden',
      inputModalities: ['text'],
    }])
  })

  it('keeps the native entry when both sides list the same id', async () => {
    const { adapter } = adapterWithNative(
      [{ model: 'gpt-native', displayName: 'Native Name', description: 'from the CLI' }],
      { models: [{ id: 'gpt-native', name: 'Configured Name' }] },
    )
    const models: readonly LlmModelInfo[] = await adapter.listModels('codex-cli')
    expect(models).toHaveLength(1)
    expect(models[0]).toMatchObject({ id: 'gpt-native', name: 'Native Name', description: 'from the CLI' })
  })

  it('keeps serving the driver default catalog model next to the native entries', async () => {
    const { adapter } = adapterWithNative([{ model: 'gpt-native', displayName: 'GPT Native' }])
    await expect(adapter.listModels('codex-cli')).resolves.toEqual([{
      provider: 'codex-cli',
      id: 'gpt-native',
      name: 'GPT Native',
      inputModalities: ['text'],
    }, {
      provider: 'codex-cli',
      id: 'gpt-5-codex',
      name: 'GPT-5 Codex',
      inputModalities: ['text'],
    }])
  })

  it('carries a configured-only model name and description into its directory row', async () => {
    const { adapter } = adapterWithNative(
      [],
      { models: [{ id: 'gpt-configured', description: 'declared, not advertised' }] },
    )
    await expect(adapter.listModels('codex-cli')).resolves.toEqual([{
      provider: 'codex-cli',
      id: 'gpt-configured',
      name: 'gpt-configured',
      description: 'declared, not advertised',
      inputModalities: ['text'],
    }])
  })
})

describe('codex native catalog caching', () => {
  it('serves the cached snapshot within the cache lifetime', async () => {
    const { adapter, probes } = adapterWithNative([{ model: 'gpt-native' }])
    await adapter.listModels('codex-cli')
    await adapter.listModels('codex-cli')
    await adapter.resolveModel('codex-cli', 'gpt-native')
    expect(probes()).toBe(1)
  })

  it('shares one in-flight probe across concurrent callers', async () => {
    const { adapter, probes } = adapterWithNative([{ model: 'gpt-native' }])
    const nativeModelsOf = (adapter as unknown as { nativeModels: () => Promise<unknown[]> }).nativeModels
    await Promise.all([
      adapter.listModels('codex-cli'),
      nativeModelsOf.call(adapter),
      adapter.resolveModel('codex-cli', 'gpt-native'),
    ])
    expect(probes()).toBe(1)
  })

  it('re-probes after the cache lifetime expires', async () => {
    const { adapter, probes } = adapterWithNative([{ model: 'gpt-native' }], { catalogCacheMs: 5 })
    await adapter.listModels('codex-cli')
    await new Promise(resolve => setTimeout(resolve, 10))
    await adapter.listModels('codex-cli')
    expect(probes()).toBe(2)
  })

  it('re-probes on every call when the cache lifetime is zero', async () => {
    const { adapter, probes } = adapterWithNative([{ model: 'gpt-native' }], { catalogCacheMs: 0 })
    await adapter.listModels('codex-cli')
    await adapter.listModels('codex-cli')
    expect(probes()).toBe(2)
  })

  it('never caches a failed probe', async () => {
    const resolved = resolveCodexAdapterOptions({})
    let probeCount = 0
    const adapter = new CodexCliAdapter({ options: () => resolved.connection })
    ;(adapter as unknown as { probeNativeCatalog: () => Promise<unknown[]> }).probeNativeCatalog
      = async () => {
        probeCount += 1
        throw new Error('probe refused')
      }
    await expect(adapter.listModels('codex-cli')).rejects.toThrow('probe refused')
    await expect(adapter.listModels('codex-cli')).rejects.toThrow('probe refused')
    expect(probeCount).toBe(2)
  })

  it('keeps probing for the next caller when one caller aborts', async () => {
    const resolved = resolveCodexAdapterOptions({})
    let release: (value: unknown[]) => void = () => {}
    const probe = new Promise<unknown[]>((resolve0) => { release = resolve0 })
    const adapter = new CodexCliAdapter({ options: () => resolved.connection })
    ;(adapter as unknown as { probeNativeCatalog: () => Promise<unknown[]> }).probeNativeCatalog
      = () => probe
    const controller = new AbortController()
    const aborted = (adapter as unknown as { nativeModels: (signal: AbortSignal) => Promise<unknown[]> })
      .nativeModels(controller.signal)
    controller.abort()
    await expect(aborted).rejects.toMatchObject({ code: 'ABORTED' })
    release([{ model: 'gpt-native' }])
    // The probe settled after the abort; the next caller reads the snapshot.
    await expect(adapter.listModels('codex-cli')).resolves.toHaveLength(2)
  })
})
