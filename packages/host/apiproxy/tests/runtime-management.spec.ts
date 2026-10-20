/** Persisted runtime configuration, adapter disposal, and validated remote directories. */
import { Context } from '@deepseek-ai/cordis'
import { SettingsProvider, settingsNamespace, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installRuntimeManagement, readRuntimePeers, runtimeOrigin } from '../src/runtime-management.ts'

class MemorySettings extends SettingsProvider {
  readonly writable = true
  constructor(
    ctx: Context,
    private readonly doc: Record<string, unknown>,
  ) {
    super(ctx)
  }
  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve(this.doc)
  }
  protected persist(_ns: SettingsNamespace, _section: Record<string, unknown>): Promise<void> {
    return Promise.resolve()
  }
}
const roots: Context[] = []
afterEach(async () => {
  vi.unstubAllGlobals()
  for (const root of roots.splice(0)) await root.fiber.dispose()
})

async function setup(doc: Record<string, unknown> = {}) {
  const ctx = new Context()
  roots.push(ctx)
  await ctx.plugin(MemorySettings, doc).await()
  await ctx.plugin(LlmRuntime).await()
  await ctx.plugin(LocalSubprocessRuntime).await()
  let ready!: () => Promise<void>
  const fiber = ctx.plugin({
    inject: ['settings', 'llm'],
    apply: (child) => {
      ready = installRuntimeManagement(child)
    },
  })
  await fiber.await()
  await ready()
  return { ctx, ready, fiber, ns: settingsNamespace('runtime-management') }
}

function remoteFetch() {
  return vi.fn(async (input: URL, init?: RequestInit) => {
    if (typeof init?.body !== 'string') throw new Error('expected JSON request')
    const request = JSON.parse(init.body) as { rpcId: string }
    const value = input.pathname.endsWith('host.describe')
      ? { version: 'test', cwd: '/remote', home: '/home/user', canOpenPath: false, attachedSessions: 0 }
      : input.pathname.endsWith('llm.providers')
        ? {
          providers: [
            { provider: 'remote', displayName: 'Remote CLI', active: true, settingsNs: '', settingsPath: [] },
          ],
          daemonRunning: true,
        }
        : {
          groups: [{ id: 'remote', name: 'Remote CLI', models: [{ id: 'model-one', name: 'Model One' }] }],
          failures: [],
        }
    return Response.json({ type: 'server-response', rpcId: request.rpcId, result: { ok: true, value } })
  })
}

describe('runtime management', () => {
  it('mounts saved executable profiles, unloads disabled routes, and removes registrations on disposal', async () => {
    const { ctx, ready, fiber, ns } = await setup()
    await ctx.settings.update(ns, {
      profiles: { 'runtime-test': { name: 'My runtime', command: process.execPath, args: [] } },
    })
    await ready()
    expect(ctx.llm.listProviders().map(row => row.id)).toContain('runtime-test')
    await ctx.settings.mutate(ns, [{ op: 'set', path: ['profiles', 'runtime-test', 'enabled'], value: false }])
    await ready()
    expect(ctx.llm.listProviders()).toEqual([])
    await ctx.settings.mutate(ns, [{ op: 'set', path: ['profiles', 'runtime-test', 'enabled'], value: true }])
    await ready()
    expect(ctx.llm.listProviders().map(row => row.id)).toContain('runtime-test')
    await fiber.dispose()
    expect(ctx.llm.listProviders()).toEqual([])
    expect(ctx.settings.describe().some(view => view.ns === ns)).toBe(false)
  })

  it('mounts persisted profiles when the optional settings service becomes ready', async () => {
    const { ctx } = await setup({
      'runtime-management': {
        profiles: { 'runtime-boot': { name: 'Boot runtime', command: process.execPath } },
      },
    })
    expect(ctx.llm.listProviders().map(row => row.id)).toContain('runtime-boot')
  })

  it('rejects a profile ID already owned by another plugin', async () => {
    const { ctx, ns } = await setup()
    ctx.llm.registerConfigurableProviders([
      {
        provider: 'runtime-reserved',
        displayName: 'Reserved',
        settingsNs: '',
        settingsPath: [],
        localCommand: 'cursor-agent',
      },
    ])
    await expect(
      ctx.settings.update(ns, {
        profiles: { 'runtime-reserved': { name: 'Collision', command: process.execPath } },
      }),
    ).rejects.toThrow('already registered')
  })

  it('keeps missing executables configured without registering a callable route', async () => {
    const { ctx, ready, ns } = await setup()
    await ctx.settings.update(ns, {
      profiles: { 'runtime-missing': { name: 'Missing', command: '/nonexistent/dsh-runtime' } },
    })
    await ready()
    expect(ctx.llm.listProviders()).toEqual([])
    expect(ctx.llm.listConfigurableProviders().map(row => row.provider)).toEqual(['runtime-missing'])
  })

  it('rejects invalid profile IDs, relative commands, and adapter-owned flags before committing', async () => {
    const { ctx, ns } = await setup()
    for (const profiles of [
      { custom: { name: 'Bad ID', command: 'cursor-agent' } },
      { 'runtime-bad': { name: 'Relative', command: './cursor-agent' } },
      { 'runtime-bad': { name: 'Flags', command: 'cursor-agent', args: ['--model=override'] } },
    ])
      await expect(ctx.settings.update(ns, { profiles })).rejects.toThrow()
    expect(ctx.settings.get(ns)).toEqual({ profiles: {}, peers: {} })
  })

  it('reads remote directories through the real RPC parser and preserves a peer connection error', async () => {
    const { ctx, ns } = await setup()
    await ctx.settings.update(ns, { peers: { remote: { name: 'Build machine', url: 'http://127.0.0.1:4096' } } })
    const fetch = remoteFetch()
    vi.stubGlobal('fetch', fetch)
    const peers = await readRuntimePeers(ctx, undefined, 500)
    expect(peers[0]).toMatchObject({
      name: 'Build machine',
      cwd: '/remote',
      groups: [{ models: [{ id: 'model-one' }] }],
    })
    expect(fetch).toHaveBeenCalledTimes(3)
    fetch.mockRejectedValue(new Error('connection refused'))
    expect(await readRuntimePeers(ctx, undefined, 500)).toMatchObject([
      { name: 'Build machine', error: 'connection refused', providers: [] },
    ])
    expect(ctx.settings.get(ns)).toMatchObject({ peers: { remote: { name: 'Build machine' } } })
  })

  it('refuses malformed remote responses, duplicate origins, credentials, and redirects', async () => {
    const { ctx, ns } = await setup()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ unrelated: true })),
    )
    expect(typeof (await readRuntimePeers(ctx, 'http://127.0.0.1:4096', 100))[0]?.error).toBe('string')
    await expect(
      ctx.settings.update(ns, {
        peers: { a: { name: 'a', url: 'http://localhost:4096' }, b: { name: 'b', url: 'http://localhost:4096/' } },
      }),
    ).rejects.toThrow('already connected')
    for (const url of [
      'file:///tmp/x',
      'http://user:pass@localhost',
      'http://localhost/path',
      'http://localhost/?token=secret',
    ]) {
      expect(() => runtimeOrigin(url)).toThrow()
    }
    expect(runtimeOrigin('HTTP://LOCALHOST:80/')).toBe('http://localhost')
  })
})
