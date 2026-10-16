/**
 * Statistics settings page store: one snapshot aggregated from `session.list`
 * — every persisted session contributes its `tokenUsage` projection baseline
 * (the four provider-reported buckets the listing already carries, zero log
 * loads), and the rows themselves count sessions and started conversations.
 * The host stays the single fact source; the page is read-only, so every
 * refresh is a whole re-read rather than a write-back join. Session listing
 * has no push event, so the page loads on mount and refreshes only on the
 * user's own gesture.
 */

import type { IApiClient } from '@deepseek-ai/dsh-api-remotes/client'
import type { TokenUsageProjection } from '@deepseek-ai/dsh-token-meter/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'

/** Zeroed usage buckets — the aggregate before any session contributes. */
const zeroUsage = (): TokenUsageProjection => ({
  uncachedInputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
})

/** Page snapshot. */
export interface StatsSettingsState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  /** Whole-load failure text. */
  error: string | null
  /** Persisted sessions the listing answered with. */
  sessions: number
  /** Sessions whose conversation has started (`blank: false`). */
  started: number
  /** Provider-reported token usage summed over every listed session. */
  usage: TokenUsageProjection
}

/**
 * Sum the usage buckets of every session that reported any.
 * @param usages - per-session usage projections (absent when a session never
 * reported usage or its projection baseline was unavailable).
 * @returns the four-bucket aggregate.
 */
export function sumUsage(usages: readonly (TokenUsageProjection | undefined)[]): TokenUsageProjection {
  const total = zeroUsage()
  for (const usage of usages) {
    if (usage === undefined) continue
    total.uncachedInputTokens += usage.uncachedInputTokens
    total.outputTokens += usage.outputTokens
    total.cacheReadTokens += usage.cacheReadTokens
    total.cacheWriteTokens += usage.cacheWriteTokens
  }
  return total
}

/**
 * Human text for a rejected wire call. A transport failure rejects with an
 * Error; a host can reject with anything, and the page still has to say
 * something.
 * @param error - the rejection value.
 * @returns the message to show.
 */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** The statistics settings page controller (one per settings surface). */
export class StatsSettingsStore {
  /** The snapshot the section renders from (uSES-safe store). */
  readonly store: SnapshotStore<StatsSettingsState> = createSnapshotStore<StatsSettingsState>({
    status: 'idle', error: null, sessions: 0, started: 0, usage: zeroUsage(),
  })

  /** Latest load wins; an older response never overwrites a newer one. */
  private generation = 0

  /**
   * @param api - the wire face (sessions domain).
   */
  constructor(
    private readonly api: Pick<IApiClient, 'sessions'>,
  ) {}

  /**
   * Refresh the whole page snapshot: one session listing, aggregated on the
   * client — session and started counts from the rows, usage buckets from
   * each row's `tokenUsage` projection baseline.
   * @returns nothing; the snapshot carries the outcome.
   */
  async load(): Promise<void> {
    const generation = ++this.generation
    this.store.update((s) => { s.status = 'loading'; s.error = null })
    try {
      const response = await this.api.sessions.list({})
      if (!response.result.ok) throw new Error(response.result.error.message)
      if (generation !== this.generation) return
      const items = response.result.value.items
      this.store.update((s) => {
        s.status = 'ready'
        s.error = null
        s.sessions = items.length
        s.started = items.filter(item => item.blank === false).length
        s.usage = sumUsage(items.map(item => item.projections?.values.tokenUsage))
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
