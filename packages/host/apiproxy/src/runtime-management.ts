/** Persisted runtime machines and Cursor-compatible executable profiles. */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import * as cursor from '@deepseek-ai/dsh-llm-cursor-cli'
import { AbstractApiClient } from './fetch/client.ts'
import type { RuntimePeerView } from './api/llm.ts'

/** Local settings document section owned by runtime management. */
export const RUNTIME_SETTINGS_NS = 'runtime-management'

interface RuntimeConfiguration {
  peers: Record<string, { name: string; url: string }>
  profiles: Record<string, { name: string; command: string; args: string[]; enabled: boolean }>
}

/**
 * Validate an origin before any remote request, including stored settings.
 * @param value - configured machine origin.
 * @returns the canonical origin; rejects paths, credentials, and non-HTTP URLs.
 */
export function runtimeOrigin(value: string): string {
  const url = new URL(value)
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  ) {
    throw new Error('Use an HTTP or HTTPS origin without credentials, path, query, or fragment.')
  }
  return url.origin
}

const schema: z<RuntimeConfiguration> = z.object({
  peers: z.dict(z.object({ name: z.string().min(1).required(), url: z.string().required() })).default({}),
  profiles: z
    .dict(
      z.object({
        name: z.string().min(1).required(),
        command: z.string().min(1).required(),
        args: z.array(z.string()).default([]),
        enabled: z.boolean().default(true),
      }),
    )
    .default({}),
})

function validateRuntimeConfiguration(config: RuntimeConfiguration): void {
  const origins = new Set<string>()
  for (const peer of Object.values(config.peers)) {
    const origin = runtimeOrigin(peer.url)
    if (origins.has(origin)) throw new Error('This machine is already connected.')
    origins.add(origin)
  }
  for (const [provider, profile] of Object.entries(config.profiles)) {
    if (!/^runtime-[a-z0-9][a-z0-9-]*$/.test(provider))
      throw new Error('Custom runtime IDs must start with runtime- and contain lowercase letters, digits, or hyphens.')
    cursor.resolveConfig({ command: profile.command, provider, extraArgs: profile.args })
  }
}

class PeerClient extends AbstractApiClient {
  constructor(
    private readonly origin: string,
    timeoutMs: number,
  ) {
    super(timeoutMs)
  }
  protected override resolveBase(): string {
    return this.origin
  }
  protected doFetch(input: URL, init?: RequestInit): Promise<Response> {
    return fetch(input, { ...init, redirect: 'error' })
  }
}

/**
 * Read a remote directory through the regular validated dsh carrier.
 * @param ctx - settings owner.
 * @param draft - optional unsaved origin for the connection dialog.
 * @param timeoutMs - per-request deadline.
 * @param signal - caller cancellation.
 * @returns remote machines; one failure cannot hide another machine.
 */
export async function readRuntimePeers(
  ctx: Context,
  draft: string | undefined,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<RuntimePeerView[]> {
  const config = ctx.get('settings')?.get(settingsNamespace(RUNTIME_SETTINGS_NS)) as RuntimeConfiguration | undefined
  const peers =
    draft === undefined
      ? Object.values(config?.peers ?? {})
      : [{ name: runtimeOrigin(draft), url: runtimeOrigin(draft) }]
  return Promise.all(
    peers.map(async (peer): Promise<RuntimePeerView> => {
      const url = runtimeOrigin(peer.url)
      try {
        const client = new PeerClient(url, timeoutMs)
        const [host, providers, models] = await Promise.all([
          client.host.describe({}, signal),
          client.llm.providers({}, signal),
          client.llm.models({}, signal),
        ])
        if (!host.result.ok) throw new Error(host.result.error.message)
        if (!providers.result.ok) throw new Error(providers.result.error.message)
        if (!models.result.ok) throw new Error(models.result.error.message)
        return {
          url,
          name: peer.name,
          version: host.result.value.version,
          cwd: host.result.value.cwd,
          providers: providers.result.value.providers,
          groups: models.result.value.groups,
          failures: models.result.value.failures,
        }
      } catch (error) {
        if (signal?.aborted) throw error
        return {
          url,
          name: peer.name,
          providers: [],
          groups: [],
          failures: [],
          error: error instanceof Error ? error.message : String(error),
        }
      }
    }),
  )
}

/**
 * Mount configured executable profiles; settings watchers and reads share one
 * serial reconciliation so directory reads observe the committed settings.
 * @param ctx - gateway's plugin context.
 * @returns readiness callback used before provider and model reads.
 */
export function installRuntimeManagement(ctx: Context): () => Promise<void> {
  const idle = (): Promise<void> => Promise.resolve()
  let ready = idle
  const bridge = ctx.inject(['settings', 'llm'], async (child) => {
    const next = installRuntimeProfiles(child)
    ready = next
    child.effect(
      () => () => {
        if (ready === next) ready = idle
      },
      'runtime management readiness',
    )
    await next()
  })
  return async () => {
    if (ctx.get('settings') === undefined) return
    await bridge.await()
    await ready()
  }
}

function installRuntimeProfiles(ctx: Context): () => Promise<void> {
  const settings = ctx.settings
  const mounted = new Map<string, { signature: string; dispose: () => Promise<void> }>()
  const scope = settings.register(settingsNamespace(RUNTIME_SETTINGS_NS), schema, {
    applies: 'live',
    base: { peers: {}, profiles: {} },
    validate: (config) => {
      validateRuntimeConfiguration(config)
      if (Object.values(config.profiles).some(profile => profile.enabled) && ctx.get('subprocess') === undefined) {
        throw new Error('Custom runtimes require a subprocess provider on this host.')
      }
      for (const id of Object.keys(config.profiles)) {
        const reserved =
          ctx.llm.listProviders().some(provider => provider.id === id) ||
          ctx.llm.listConfigurableProviders().some(provider => provider.provider === id)
        if (!mounted.has(id) && reserved) {
          throw new Error(`Provider ${id} is already registered by another plugin.`)
        }
      }
    },
  })
  let pending = Promise.resolve()
  const lifetime = new AbortController()
  const reconcile = async (): Promise<void> => {
    if (lifetime.signal.aborted) return
    const { profiles } = scope.get()
    for (const [id, entry] of mounted) {
      if (profiles[id]?.enabled && entry.signature === JSON.stringify(profiles[id])) continue
      await entry.dispose()
      mounted.delete(id)
    }
    for (const [id, profile] of Object.entries(profiles)) {
      if (!profile.enabled || mounted.has(id)) continue
      lifetime.signal.throwIfAborted()
      const fiber = ctx.plugin({
        inject: ['llm', 'subprocess'],
        apply: (child: Context) =>
          cursor.apply(child, { command: profile.command, provider: id, extraArgs: profile.args }),
      })
      mounted.set(id, {
        signature: JSON.stringify(profile),
        dispose: async () => {
          await fiber.dispose()
        },
      })
      try {
        await fiber.await()
      } catch (error) {
        mounted.delete(id)
        await fiber.dispose()
        throw error
      }
    }
  }
  const ready = (): Promise<void> => {
    pending = pending
      .catch(() => {
        // A failed reconciliation is reported to its caller; a corrected profile can retry.
      })
      .then(reconcile)
    return pending
  }
  ctx.effect(() => scope.watch(ready), 'runtime settings watcher')
  ctx.effect(
    () => async () => {
      lifetime.abort()
      await pending.catch(() => {
        // The read or watcher already reports this mount failure; disposal still drains adapters.
      })
      for (const entry of mounted.values()) await entry.dispose()
      mounted.clear()
    },
    'runtime profile adapters',
  )
  return ready
}
