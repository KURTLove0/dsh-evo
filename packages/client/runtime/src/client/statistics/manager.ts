/** Explicit run-cohort observations, independent of the statistics page lifecycle. */
import type { WorkStatisticsChoices, WorkStatisticsQuery, WorkStatisticsReport } from '@deepseek-ai/dsh-work-center/types'
import type { ObservableSnapshot } from '../contract/store.ts'
import { Notifier } from '../sessions/notifier.ts'

/** Generated Remote operations, unwrapped by the owning browser entry. */
export interface WorkStatisticsPort {
  choices(this: void): Promise<WorkStatisticsChoices>
  read(this: void, query: WorkStatisticsQuery): Promise<WorkStatisticsReport>
}
/** Failed reads preserve the last report with its original submitted filters. */
export interface WorkStatisticsSnapshot {
  choices: WorkStatisticsChoices | undefined
  choicesLoading: boolean
  choicesError: string | null
  loading: boolean
  stale: boolean
  error: string | null
  report: WorkStatisticsReport | undefined
}
const message = (error: unknown) => error instanceof Error ? error.message : String(error)
/** Source changes invalidate observations without automatically inspecting usage logs. */
export class WorkStatisticsManager implements ObservableSnapshot<WorkStatisticsSnapshot> {
  private value: WorkStatisticsSnapshot = { choices: undefined, choicesLoading: false, choicesError: null,
    loading: false, stale: false, error: null, report: undefined }
  private readonly notifier = new Notifier(() => {})
  private choiceEpoch = 0
  private readEpoch = 0
  private disposed = false
  constructor(private readonly port: WorkStatisticsPort) {}
  /**
   * Read the stable current observation snapshot.
   * @returns last submitted filters, observed counts, choices, and errors.
   */
  getSnapshot = (): WorkStatisticsSnapshot => this.value
  /**
   * Subscribe to changed observations.
   * @param listener - invalidation callback.
   * @returns its disposer.
   */
  subscribe = (listener: () => void): (() => void) => this.notifier.subscribe(listener)
  private publish(patch: Partial<WorkStatisticsSnapshot>): void {
    if (this.disposed) return
    this.value = { ...this.value, ...patch }; this.notifier.markDirty()
  }
  /**
   * Refresh safe filter choices, ignoring superseded reads.
   * @returns settlement; errors remain separate from report-read errors.
   */
  async loadChoices(): Promise<void> {
    if (this.disposed) return
    const epoch = ++this.choiceEpoch
    this.publish({ choicesLoading: true })
    try {
      const choices = await this.port.choices()
      if (epoch === this.choiceEpoch) this.publish({ choices, choicesError: null })
    } catch (error) { if (epoch === this.choiceEpoch) this.publish({ choicesError: message(error) }) }
    finally { if (epoch === this.choiceEpoch) this.publish({ choicesLoading: false }) }
  }
  /**
   * Read one explicit cohort; a later query, invalidation, or disposal wins over a late result.
   * @param query - complete submitted filters and usage-read choice.
   * @returns settlement, retaining the previous report on failure.
   */
  async read(query: WorkStatisticsQuery): Promise<void> {
    if (this.disposed) return
    const epoch = ++this.readEpoch
    this.publish({ loading: true, stale: true, error: null })
    try {
      const report = await this.port.read(query)
      if (epoch === this.readEpoch) this.publish({ report, stale: false })
    } catch (error) { if (epoch === this.readEpoch) this.publish({ error: message(error) }) }
    finally { if (epoch === this.readEpoch) this.publish({ loading: false }) }
  }
  /** Preserve last-known evidence after filters, source records, or the connection change. */
  invalidate(): void { this.readEpoch++; this.publish({ stale: true, loading: false }) }
  /** Stop publishing from every pending operation. */
  dispose(): void { this.disposed = true; this.choiceEpoch++; this.readEpoch++ }
}
