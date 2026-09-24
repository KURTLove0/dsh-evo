/**
 * Runtimes settings page store: one snapshot joining the configurable-provider
 * directory (`llm.providers` — which model runtimes this deployment declares,
 * and whether each route is live) with the host-scoped model catalog
 * (`llm.models` — the models each live runtime currently loads). The host
 * stays the single fact source; the page is read-only, so every refresh is a
 * whole re-read rather than a write-back join.
 */

import type {
  IApiClient, ModelProviderGroup,
} from '@deepseek-ai/dsh-api-remotes/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'

/** One model as the host catalog reports it, for the runtime's loaded-models view. */
export type RuntimeModel = ModelProviderGroup['models'][number]

/** One runtime row: a declared provider route with its live model catalog. */
export interface RuntimeRow {
  /** Provider route key (`claude-cli`, `deepseek-official`, …). */
  provider: string
  /** Human-readable runtime name. */
  displayName: string
  /** Settings namespace owning this route's configuration. */
  settingsNs: string
  /** Whether the route is registered and its models are requestable. */
  active: boolean
  /** Models the live runtime currently loads; absent until a load succeeds. */
  models: RuntimeModel[] | undefined
  /** Catalog failure text when the live runtime failed to list its models. */
  failure: string | undefined
}

/** Page snapshot. */
export interface RuntimesSettingsState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  /** Whole-load failure text. */
  error: string | null
  /** Runtime rows in directory declaration order. */
  rows: readonly RuntimeRow[]
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
    status: 'idle', error: null, rows: [],
  })

  /** Latest load wins; an older response never overwrites a newer one. */
  private generation = 0

  /**
   * @param api - the wire face (llm domain).
   */
  constructor(
    private readonly api: Pick<IApiClient, 'llm'>,
  ) {}

  /**
   * Refresh the whole page snapshot: the provider directory and the host model
   * catalog answer in parallel, then join by route id. A dormant route carries
   * no catalog entry; a live route carries its models, or the failure text
   * from the catalog's per-provider failures.
   * @returns nothing; the snapshot carries the outcome.
   */
  async load(): Promise<void> {
    const generation = ++this.generation
    this.store.update((s) => { s.status = 'loading'; s.error = null })
    try {
      const [providersResponse, modelsResponse] = await Promise.all([
        this.api.llm.providers({}),
        this.api.llm.models({}),
      ])
      if (!providersResponse.result.ok) throw new Error(providersResponse.result.error.message)
      if (!modelsResponse.result.ok) throw new Error(modelsResponse.result.error.message)
      if (generation !== this.generation) return
      const { providers } = providersResponse.result.value
      const { groups, failures } = modelsResponse.result.value
      const catalog = new Map(groups.map(group => [group.id, group]))
      const failed = new Map(failures.map(failure => [failure.id, failure.message]))
      this.store.update((s) => {
        s.status = 'ready'
        s.error = null
        s.rows = providers.map((entry): RuntimeRow => {
          const group = entry.active ? catalog.get(entry.provider) : undefined
          const models = group === undefined ? undefined : group.models.map(model => ({ ...model }))
          return {
            provider: entry.provider,
            displayName: entry.displayName,
            settingsNs: entry.settingsNs,
            active: entry.active,
            models,
            failure: entry.active
              ? group === undefined ? failed.get(entry.provider) : undefined
              : undefined,
          }
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
}
