/** Runtime directory, remote connection checks, and revision-checked profile writes. */
import type {
  IApiClient,
  ModelProviderGroup,
  RuntimePeerView,
  SettingsNamespaceView,
  SettingsPathOpView,
} from '@deepseek-ai/dsh-api-remotes/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'

/** One model as the host catalog reports it, for the runtime's loaded-models view. */
export type RuntimeModel = ModelProviderGroup['models'][number]

/** One runtime row: a live provider route with its current model catalog. */
export interface RuntimeRow {
  /** Provider route key (`claude-cli`, `deepseek-official`, …). */
  provider: string
  /** Human-readable runtime name. */
  displayName: string
  /** Settings namespace owning this route's configuration. */
  settingsNs: string
  /** Whether the route is registered and its models are requestable (always true here). */
  active: boolean
  /**
   * Whether the owning adapter knows this route only because configuration declared it; absent
   * when the adapter draws no such distinction.
   */
  declared: boolean | undefined
  /** The executable a local-CLI runtime shells out to; absent for remote API providers. */
  localCommand: string | undefined
  /** Models the live runtime currently loads; absent until a load succeeds. */
  models: RuntimeModel[] | undefined
  /** Catalog failure text when the live runtime failed to list its models. */
  failure: string | undefined
}

/** A user-owned Cursor protocol executable profile. */
export interface RuntimeProfile {
  name: string
  command: string
  args: string[]
  enabled: boolean
}

/** Settings persisted by the host runtime manager. */
interface ManagementConfiguration {
  profiles: Record<string, RuntimeProfile>
  peers: Record<string, { name: string; url: string }>
}

/** Page snapshot. */
export interface RuntimesSettingsState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  writable: boolean
  saving: boolean
  managementError: string | null
  profiles: Record<string, RuntimeProfile>
  peers: RuntimePeerView[]
  revision: number
  /** Whole-load failure text. */
  error: string | null
  /** Runtime rows in directory declaration order. */
  rows: readonly RuntimeRow[]
  /**
   * Whether the host's runtime-sensing daemon answered while the directory
   * loaded; `false` points the page at `dsh daemon start`. Initialized true
   * so the hint never flashes before the first answer.
   */
  daemonRunning: boolean
}

/**
 * Human text for a rejected wire call. A transport failure rejects with an
 * Error; a host or a runtime can reject with anything, and the page still has
 * to say something.
 * @param error - the rejection value.
 * @returns the message to show.
 */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** The runtimes settings page controller (one per settings surface). */
export class RuntimesSettingsStore {
  /** The snapshot the section renders from (uSES-safe store). */
  readonly store: SnapshotStore<RuntimesSettingsState> = createSnapshotStore<RuntimesSettingsState>({
    status: 'idle',
    error: null,
    rows: [],
    daemonRunning: true,
    writable: false,
    saving: false,
    managementError: null,
    profiles: {},
    peers: [],
    revision: 0,
  })

  /** Latest load wins; an older response never overwrites a newer one. */
  private generation = 0

  /**
   * @param api - the wire face (llm domain).
   */
  constructor(private readonly api: Pick<IApiClient, 'llm' | 'settings'>) {}

  /**
   * Refresh the whole page snapshot: the provider directory and the host model
   * catalog answer in parallel, then join by route id over the live routes
   * only. A live route carries its models, or the failure text from the
   * catalog's per-provider failures.
   * @returns nothing; the snapshot carries the outcome.
   */
  async load(): Promise<void> {
    const generation = ++this.generation
    this.store.update((s) => {
      s.status = 'loading'
      s.error = null
    })
    try {
      const [providersResponse, modelsResponse, management] = await Promise.all([
        this.api.llm.providers({}),
        this.api.llm.models({}),
        this.loadManagement().then((management) => {
          if (generation === this.generation)
            this.store.update((s) => {
              Object.assign(s, management)
            })
          return management
        }),
      ])
      if (!providersResponse.result.ok) throw new Error(providersResponse.result.error.message)
      if (!modelsResponse.result.ok) throw new Error(modelsResponse.result.error.message)
      if (generation !== this.generation) return
      const { providers, daemonRunning } = providersResponse.result.value
      const { groups, failures } = modelsResponse.result.value
      const catalog = new Map(groups.map(group => [group.id, group]))
      const failed = new Map(failures.map(failure => [failure.id, failure.message]))
      this.store.update((s) => {
        Object.assign(s, management)
        s.status = 'ready'
        s.error = null
        s.daemonRunning = daemonRunning
        s.rows = providers.flatMap((entry): RuntimeRow[] => {
          // Dormant routes are configuration candidates for the Models page;
          // a local CLI the host could not find can never serve from here.
          if (!entry.active || entry.present === false) return []
          const group = catalog.get(entry.provider)
          const models = group === undefined ? undefined : group.models.map(model => ({ ...model }))
          return [
            {
              provider: entry.provider,
              displayName: management.profiles[entry.provider]?.name ?? entry.displayName,
              settingsNs: entry.settingsNs,
              active: entry.active,
              declared: management.profiles[entry.provider] === undefined ? entry.declared : true,
              localCommand: entry.localCommand,
              models,
              failure: group === undefined ? failed.get(entry.provider) : undefined,
            },
          ]
        })
      })
    } catch (error) {
      if (generation !== this.generation) return
      this.store.update((s) => {
        s.status = 'error'
        s.error = messageOf(error)
      })
    }
  }

  private async loadManagement(): Promise<
    Pick<RuntimesSettingsState, 'writable' | 'revision' | 'profiles' | 'peers' | 'managementError'>
  > {
    try {
      const [settings, peers] = await Promise.all([this.api.settings.describe({}), this.api.llm.runtimePeers({})])
      if (!settings.result.ok) throw new Error(settings.result.error.message)
      if (!peers.result.ok) throw new Error(peers.result.error.message)
      const view = settings.result.value.namespaces.find(entry => entry.ns === 'runtime-management')
      if (view === undefined) throw new Error('Runtime management is unavailable on this host.')
      const config = view.value as ManagementConfiguration
      return {
        writable: settings.result.value.writable,
        revision: view.revision,
        profiles: config.profiles,
        peers: peers.result.value.peers,
        managementError: null,
      }
    } catch (error) {
      const held = this.store.getSnapshot()
      return {
        writable: false,
        revision: held.revision,
        profiles: { ...held.profiles },
        peers: [...held.peers],
        managementError: messageOf(error),
      }
    }
  }

  private async mutate(ops: SettingsPathOpView[]): Promise<void> {
    const state = this.store.getSnapshot()
    if (!state.writable) throw new Error('Runtime settings are read-only.')
    if (state.saving) throw new Error('A runtime change is already being saved.')
    this.store.update((s) => {
      s.saving = true
    })
    try {
      const response = await this.api.settings.mutate({
        ns: 'runtime-management',
        ops,
        expectedRevision: state.revision,
      })
      if (!response.result.ok) throw new Error(response.result.error.message)
      this.acceptManagement(response.result.value)
      await this.load()
    } finally {
      this.store.update((s) => {
        s.saving = false
      })
    }
  }

  private acceptManagement(view: SettingsNamespaceView): void {
    ++this.generation
    const config = view.value as ManagementConfiguration
    this.store.update((s) => {
      s.revision = view.revision
      s.profiles = config.profiles
    })
  }

  /**
   * Validate a remote dsh host before saving its connection.
   * @param name - machine label.
   * @param url - HTTP origin, normally a local SSH tunnel.
   * @returns the connected machine; failed checks never persist a peer.
   */
  async connect(name: string, url: string): Promise<RuntimePeerView> {
    const checked = await this.api.llm.runtimePeers({ url })
    if (!checked.result.ok) throw new Error(checked.result.error.message)
    const peer = checked.result.value.peers[0]
    if (peer === undefined) throw new Error('No runtime machine answered.')
    if (peer.error !== undefined) throw new Error(peer.error)
    await this.mutate([{ op: 'set', path: ['peers', encodeURIComponent(peer.url)], value: { name, url: peer.url } }])
    return { ...peer, name }
  }

  /**
   * Save a custom executable profile through host validation and adapter mounting.
   * @param id - provider route, prefixed with runtime-.
   * @param profile - Cursor-compatible executable and arguments.
   * @returns settlement after reloading the committed directory.
   */
  saveProfile(id: string, profile: RuntimeProfile): Promise<void> {
    return this.mutate([{ op: 'set', path: ['profiles', id], value: profile }])
  }

  /**
   * Remove a user profile or disconnect a remote machine; native runtimes are never removed.
   * @param kind - persisted settings collection.
   * @param id - provider route or canonical remote origin.
   * @returns settlement after the committed removal is reloaded.
   */
  remove(kind: 'profiles' | 'peers', id: string): Promise<void> {
    return this.mutate([{ op: 'unset', path: [kind, kind === 'peers' ? encodeURIComponent(id) : id] }])
  }
}
