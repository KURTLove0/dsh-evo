/** React-free metadata, immutable preview, and explicit current-file observations. */
import type { ArtifactDetail, ArtifactObservation, ArtifactOptions, ArtifactPage, ArtifactQuery, ArtifactReceipt, ArtifactRegistration, WorkArtifactId } from '@deepseek-ai/dsh-work-artifacts/types'
import type { ObservableSnapshot } from '../contract/store.ts'
import { Notifier } from '../sessions/notifier.ts'
/** User-selected directory dimensions; page bounds come from the provider. */
export type ArtifactSelection = Pick<ArtifactQuery, 'text' | 'workspaceId' | 'source' | 'origin'>
/** Generated Remote calls are unwrapped by the feature entry. */
export interface ArtifactPort {
  options(this: void): Promise<ArtifactOptions>
  query(this: void, request: ArtifactQuery): Promise<ArtifactPage>
  read(this: void, request: { id: WorkArtifactId; version: number }): Promise<ArtifactDetail>
  register(this: void, request: ArtifactRegistration): Promise<ArtifactReceipt>
  inspectCurrent(this: void, request: { id: WorkArtifactId; version: number }): Promise<ArtifactObservation>
}
/** Independent read lifecycles retain their own source selection and errors. */
export interface ArtifactSnapshot {
  directory: {
    options?: ArtifactOptions
    page?: ArtifactPage
    submitted?: ArtifactSelection
    loading: boolean
    stale: boolean
    error: string | null
  }
  preview: { target?: { id: WorkArtifactId; version: number }; detail?: ArtifactDetail; loading: boolean; error: string | null }
  current: { observation?: ArtifactObservation; loading: boolean; stale: boolean; error: string | null }
  mutating: boolean
}
const message = (error: unknown) => error instanceof Error ? error.message : String(error)
/** File checks are explicit; metadata refresh never reads a live workspace file. */
export class ArtifactManager implements ObservableSnapshot<ArtifactSnapshot> {
  private value: ArtifactSnapshot = { directory: { loading: false, stale: true, error: null },
    preview: { loading: false, error: null }, current: { loading: false, stale: false, error: null }, mutating: false }
  private readonly notifier = new Notifier(() => {})
  private selection: ArtifactSelection
  private directoryEpoch = 0
  private previewEpoch = 0
  private observationEpoch = 0
  private disposed = false
  private mutation: { signature: string; task: Promise<ArtifactReceipt> } | undefined
  constructor(private readonly port: ArtifactPort, selection: ArtifactSelection) { this.selection = structuredClone(selection) }
  /**
   * Read stable observations for the current directory and selected capture.
   * @returns the immutable UI snapshot.
   */
  getSnapshot = (): ArtifactSnapshot => this.value
  /**
   * Subscribe to changed observations.
   * @param listener - snapshot invalidation callback.
   * @returns its disposer.
   */
  subscribe = (listener: () => void): (() => void) => this.notifier.subscribe(listener)
  private publish(patch: Partial<ArtifactSnapshot>): void {
    if (this.disposed) return
    this.value = { ...this.value, ...patch }; this.notifier.markDirty()
  }
  /**
   * Submit explicit directory filters without reading source files.
   * @param selection - text, workspace, source kind, and latest-version origin.
   * @returns completion with read errors retained alongside the previous submitted scope.
   */
  setQuery(selection: ArtifactSelection): Promise<void> { this.selection = structuredClone(selection); return this.refresh() }
  /**
   * Refresh the first metadata page, ignoring superseded replies.
   * @returns settlement; unavailable directories retain their last known page.
   */
  async refresh(): Promise<void> {
    if (this.disposed) return
    const epoch = ++this.directoryEpoch, selection = structuredClone(this.selection)
    this.publish({ directory: { ...this.value.directory, loading: true, stale: true, error: null } })
    try {
      const options = await this.port.options()
      if (epoch !== this.directoryEpoch) return
      const page = await this.port.query({ ...selection, limit: options.pageSize })
      if (epoch === this.directoryEpoch) this.publish({
        directory: { options, page, submitted: selection, loading: false, stale: false, error: null },
      })
    } catch (error) {
      if (epoch === this.directoryEpoch) this.publish({ directory: { ...this.value.directory, loading: false, error: message(error) } })
    }
  }
  /**
   * Append a continuation from the same submitted generation and dimensions.
   * @returns completion; a stale continuation preserves old rows and requires refresh.
   */
  async more(): Promise<void> {
    const { page, submitted, options, loading, stale } = this.value.directory
    if (this.disposed || loading || stale || page?.next === undefined || submitted === undefined || options === undefined) return
    const epoch = ++this.directoryEpoch
    this.publish({ directory: { ...this.value.directory, loading: true, error: null } })
    try {
      const next = await this.port.query({ ...submitted, limit: options.pageSize, cursor: page.next })
      if (epoch === this.directoryEpoch) this.publish({
        directory: { ...this.value.directory, page: { ...next, items: [...page.items, ...next.items] }, loading: false },
      })
    } catch (error) {
      if (epoch === this.directoryEpoch) this.publish({
        directory: { ...this.value.directory, loading: false, stale: true, error: message(error) },
      })
    }
  }
  /**
   * Read one exact stored capture; a changed target cannot receive a late preview.
   * @param id - registered file identity.
   * @param version - immutable capture number.
   * @returns settlement with the selected source's own error.
   */
  async select(id: WorkArtifactId, version: number): Promise<void> {
    if (this.disposed) return
    const epoch = ++this.previewEpoch, target = { id, version }
    this.observationEpoch++
    this.publish({ preview: { target, loading: true, error: null }, current: { loading: false, stale: false, error: null } })
    try {
      const detail = await this.port.read(target)
      if (epoch === this.previewEpoch) this.publish({ preview: { target, detail, loading: false, error: null } })
    } catch (error) { if (epoch === this.previewEpoch) this.publish({ preview: { target, loading: false, error: message(error) } }) }
  }
  /**
   * Explicitly inspect the live file corresponding to the selected historical version.
   * @returns settlement without replacing retained bytes or human acceptance evidence.
   */
  async inspectCurrent(): Promise<void> {
    const target = this.value.preview.target
    if (this.disposed || target === undefined || this.value.preview.detail === undefined || this.value.current.loading) return
    const epoch = ++this.observationEpoch
    this.publish({ current: { ...this.value.current, loading: true, stale: true, error: null } })
    try {
      const observation = await this.port.inspectCurrent(target)
      if (epoch === this.observationEpoch) this.publish({ current: { observation, loading: false, stale: false, error: null } })
    } catch (error) {
      if (epoch === this.observationEpoch) this.publish({ current: { ...this.value.current, loading: false, error: message(error) } })
    }
  }
  /** Preserve live-file observations as last-known evidence after a change or reconnect. */
  invalidate(): void {
    this.directoryEpoch++; this.observationEpoch++
    this.publish({ directory: { ...this.value.directory, loading: false, stale: true },
      current: { ...this.value.current, loading: false, stale: true } })
  }
  /**
   * Register caller-pinned inputs, single-flighting only identical in-flight requests.
   * @param request - source and expected capture version with a retained request identity.
   * @returns the committed receipt; failures leave retry ownership with the caller.
   */
  register(request: ArtifactRegistration): Promise<ArtifactReceipt> {
    if (this.disposed) return Promise.reject(new Error('Artifact manager is disposed.'))
    const owned = structuredClone(request), signature = JSON.stringify(owned)
    if (this.mutation !== undefined) return signature === this.mutation.signature ? this.mutation.task : Promise.reject(new Error('Another artifact registration is pending.'))
    const epoch = this.previewEpoch
    const task = Promise.resolve().then(() => {
      if (this.disposed) throw new Error('Artifact manager is disposed.')
      return this.port.register(owned)
    }).then((receipt) => {
      this.invalidate(); void this.refresh()
      if (epoch === this.previewEpoch && this.value.preview.target?.id === receipt.id) void this.select(receipt.id, receipt.version)
      return receipt
    }).finally(() => { this.mutation = undefined; this.publish({ mutating: false }) })
    this.mutation = { signature, task }; this.publish({ mutating: true })
    return task
  }
  /** Ignore every late read and keep admitted write results from publishing into a retired UI. */
  dispose(): void { this.disposed = true; this.directoryEpoch++; this.previewEpoch++; this.observationEpoch++ }
}
