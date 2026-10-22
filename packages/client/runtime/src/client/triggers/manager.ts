/** React-free trigger reads and explicit commands; reconnect never repeats mutations. */
import type { TriggerCommand, TriggerDefinition, TriggerDirectory, TriggerOptions, TriggerQuery, TriggerReceipt, WorkTrigger, WorkTriggerId } from '@deepseek-ai/dsh-work-triggers/types'
import type { WorkReference } from '@deepseek-ai/dsh-work-center/types'
import type { ObservableSnapshot } from '../contract/store.ts'
import { Notifier } from '../sessions/notifier.ts'
/** Unwrapped Remote operations owned by the application assembly. */
export interface TriggerPort {
  options(this: void): Promise<TriggerOptions>
  query(this: void, request: TriggerQuery): Promise<TriggerDirectory>
  read(this: void, request: { id: WorkTriggerId }): Promise<WorkTrigger>
  prepare(this: void, request: { source: WorkReference }): Promise<Pick<TriggerDefinition, 'name' | 'target'>>
  command(this: void, request: TriggerCommand): Promise<TriggerReceipt>
}
/** Retained results have independent generations for directory, detail, and preparation. */
export interface TriggerSnapshot {
  directory: {
    value?: TriggerDirectory
    options?: TriggerOptions
    submitted?: TriggerQuery
    loading: boolean
    stale: boolean
    error: string | null
  }
  detail: { id?: WorkTriggerId; value?: WorkTrigger; loading: boolean; stale: boolean; error: string | null }
  preparation: { value?: Pick<TriggerDefinition, 'name' | 'target'> & { source: WorkReference }; loading: boolean; error: string | null }
  mutating: boolean
}
const message = (error: unknown) => error instanceof Error ? error.message : String(error)
/** Late reads cannot replace another selection or restore a disconnected generation. */
export class TriggerManager implements ObservableSnapshot<TriggerSnapshot> {
  private value: TriggerSnapshot = { directory: { loading: false, stale: true, error: null },
    detail: { loading: false, stale: true, error: null }, preparation: { loading: false, error: null }, mutating: false }
  private readonly notifier = new Notifier(() => {})
  private directoryEpoch = 0
  private detailEpoch = 0
  private prepareEpoch = 0
  private query: TriggerQuery = { text: '' }
  private disposed = false
  private mutation: { signature: string; task: Promise<TriggerReceipt> } | undefined
  constructor(private readonly port: TriggerPort) {}
  /** @returns stable observations until a published change. */
  getSnapshot = (): TriggerSnapshot => this.value
  /**
   * Observe read lifecycle changes.
   * @param listener - invalidation callback.
   * @returns its disposer.
   */
  subscribe = (listener: () => void): (() => void) => this.notifier.subscribe(listener)
  private publish(patch: Partial<TriggerSnapshot>): void {
    if (this.disposed) return
    this.value = { ...this.value, ...patch }; this.notifier.markDirty()
  }
  /**
   * Refresh explicit directory dimensions.
   * @param query - omitted to retain the submitted filter intent.
   * @returns settlement with failures retained beside last-known results.
   */
  async refresh(query?: TriggerQuery): Promise<void> {
    if (this.disposed) return
    if (query !== undefined) this.query = structuredClone(query)
    const epoch = ++this.directoryEpoch, submitted = structuredClone(this.query)
    this.publish({ directory: { ...this.value.directory, loading: true, stale: true, error: null } })
    try {
      const options = await this.port.options()
      if (epoch !== this.directoryEpoch) return
      const value = await this.port.query(submitted)
      if (epoch === this.directoryEpoch) this.publish({ directory: { options, value, submitted,
        loading: false, stale: false, error: null } })
    } catch (error) {
      if (epoch === this.directoryEpoch) this.publish({ directory: { ...this.value.directory, loading: false, error: message(error) } })
    }
  }
  /**
   * Read one exact trigger; a failed refresh retains only that trigger's previous detail.
   * @param id - trigger to inspect.
   * @returns settlement with independent detail errors.
   */
  async select(id: WorkTriggerId): Promise<void> {
    if (this.disposed) return
    const epoch = ++this.detailEpoch
    const previous = this.value.detail.id === id ? this.value.detail.value : undefined
    this.publish({ detail: { id, ...(previous === undefined ? {} : { value: previous }), loading: true, stale: true, error: null } })
    try {
      const value = await this.port.read({ id })
      if (epoch === this.detailEpoch) this.publish({ detail: { id, value, loading: false, stale: false, error: null } })
    } catch (error) {
      if (epoch === this.detailEpoch) this.publish({ detail: { ...this.value.detail, loading: false, error: message(error) } })
    }
  }
  /**
   * Explicitly prepare original content; no connection callback invokes this operation.
   * @param source - selected original execution.
   * @returns settlement; superseded responses cannot change the prepared target.
   */
  async prepare(source: WorkReference): Promise<void> {
    if (this.disposed) return
    const epoch = ++this.prepareEpoch, owned = structuredClone(source)
    this.publish({ preparation: { loading: true, error: null } })
    try {
      const value = await this.port.prepare({ source: owned })
      if (epoch === this.prepareEpoch) this.publish({ preparation: { value: { ...value, source: owned }, loading: false, error: null } })
    } catch (error) {
      if (epoch === this.prepareEpoch) this.publish({ preparation: { loading: false, error: message(error) } })
    }
  }
  /** Retain last reads as stale and invalidate unresolved source preparation. */
  invalidate(): void {
    this.directoryEpoch++; this.detailEpoch++; this.prepareEpoch++
    this.publish({ directory: { ...this.value.directory, loading: false, stale: true },
      detail: { ...this.value.detail, loading: false, stale: true }, preparation: { loading: false, error: null } })
  }
  /**
   * Refresh metadata and the current selection without repeating any command.
   * @returns completion of both independent reads.
   */
  async sync(): Promise<void> {
    const id = this.value.detail.id
    await Promise.all([this.refresh(), ...(id === undefined ? [] : [this.select(id)])])
  }
  /**
   * Submit one caller-pinned command, coalescing only identical in-flight inputs.
   * @param request - explicit creation, control, recovery, or read acknowledgment.
   * @returns committed receipt independently of subsequent read failures.
   */
  command(request: TriggerCommand): Promise<TriggerReceipt> {
    if (this.disposed) return Promise.reject(new Error('Trigger manager is disposed.'))
    const owned = structuredClone(request), signature = JSON.stringify(owned)
    if (this.mutation !== undefined) return signature === this.mutation.signature ? this.mutation.task : Promise.reject(new Error('Another trigger command is pending.'))
    const task = Promise.resolve().then(() => {
      if (this.disposed) throw new Error('Trigger manager is disposed.')
      return this.port.command(owned)
    }).then((receipt) => { void this.sync(); return receipt }).catch((error: unknown) => {
      this.invalidate(); void this.sync(); throw error
    }).finally(() => {
      this.mutation = undefined; this.publish({ mutating: false })
    })
    this.mutation = { signature, task }; this.publish({ mutating: true }); return task
  }
  /** Retire every read generation; already admitted writes retain their caller-owned outcome. */
  dispose(): void { this.disposed = true; this.directoryEpoch++; this.detailEpoch++; this.prepareEpoch++ }
}
