/** Workspace-scoped knowledge observations and explicit recoverable commands; reconnects never write. */
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import type { KnowledgeAttempt, KnowledgeCitation, KnowledgeExcerpt, KnowledgeIndexRequest, KnowledgeIndexResult, KnowledgeOptions, KnowledgeRegistration, KnowledgeSearch, KnowledgeSearchResult, KnowledgeSource, KnowledgeSourceId } from '@deepseek-ai/dsh-work-knowledge/types'
import type { ObservableSnapshot } from '../contract/store.ts'
import { Notifier } from '../sessions/notifier.ts'
/** Unwrapped typed gateway; file content is read only by explicit search/read commands. */
export interface KnowledgePort {
  options(this: void): Promise<KnowledgeOptions>
  sources(this: void, request: { workspaceId: WorkspaceId }): Promise<KnowledgeSource[]>
  register(this: void, request: KnowledgeRegistration): Promise<KnowledgeSource>
  index(this: void, request: KnowledgeIndexRequest): Promise<KnowledgeIndexResult>
  setEnabled(this: void, request: { id: KnowledgeSourceId; expectedRevision: number; enabled: boolean }): Promise<KnowledgeSource>
  search(this: void, request: KnowledgeSearch): Promise<KnowledgeSearchResult>
  read(this: void, request: { workspaceId: WorkspaceId; citation: KnowledgeCitation }): Promise<KnowledgeExcerpt>
}
/** A pending command retains exact input and identity across page remounts. */
export type KnowledgeWrite =
  | { kind: 'register'; request: KnowledgeRegistration }
  | { kind: 'index'; request: KnowledgeIndexRequest }
  | { kind: 'setEnabled'; request: Parameters<KnowledgePort['setEnabled']>[0] }
/** Acknowledged operation target and original indexing outcome, separate from current source metadata. */
export type KnowledgeAcknowledgment = { sourceId: KnowledgeSourceId; path: string; workspaceId: WorkspaceId } & (
  | { kind: 'register' | 'setEnabled' }
  | { kind: 'index'; attempt: KnowledgeAttempt }
)
/** Metadata may remain stale; content is cleared on grant, connection, or workspace changes. */
export interface KnowledgeSnapshot {
  workspace?: WorkspaceId | undefined
  options?: KnowledgeOptions
  sources: KnowledgeSource[]
  loading: boolean
  stale: boolean
  error: string | null
  result?: { query: KnowledgeSearch; value: KnowledgeSearchResult } | undefined
  searching: boolean
  searchError: string | null
  excerpt?: KnowledgeExcerpt | undefined
  reading: boolean
  readError: string | null
  pending?: KnowledgeWrite | undefined
  writing: boolean
  writeError: string | null
  acknowledged?: KnowledgeAcknowledgment | undefined
}
function assertNever(value: never): never { throw new Error(`Unexpected knowledge command: ${String(value)}`) }
const ordered = (sources: KnowledgeSource[]) => [...sources].sort((a, b) => a.path.localeCompare(b.path) || a.id.localeCompare(b.id))
const message = (error: unknown) => error instanceof Error ? error.message : String(error)
/** Read generations prevent superseded workspace/connection responses from repopulating content. */
export class KnowledgeManager implements ObservableSnapshot<KnowledgeSnapshot> {
  private value: KnowledgeSnapshot = { sources: [], loading: false, stale: true, error: null,
    searching: false, searchError: null, reading: false, readError: null, writing: false, writeError: null }
  private readonly notifier = new Notifier(() => {})
  private epochs = { metadata: 0, search: 0, read: 0 }
  private disposed = false
  private mutation: { signature: string; task: Promise<void> } | undefined
  constructor(private readonly port: KnowledgePort) {}
  /** @returns the stable observation snapshot. */
  getSnapshot = (): KnowledgeSnapshot => this.value
  /**
   * Subscribe to metadata, content, and command settlement.
   * @param listener - snapshot invalidation callback.
   * @returns subscription disposer.
   */
  subscribe = (listener: () => void): (() => void) => this.notifier.subscribe(listener)
  private publish(patch: Partial<KnowledgeSnapshot>): void {
    if (this.disposed) return
    this.value = { ...this.value, ...patch }; this.notifier.markDirty()
  }
  private clearContent(): void {
    this.epochs.search++; this.epochs.read++
    this.publish({ result: undefined, excerpt: undefined, searching: false, reading: false, searchError: null, readError: null })
  }
  /**
   * Select one workspace and refresh only source metadata.
   * @param workspace - explicit registered workspace, or no selection.
   * @returns read settlement; previous-workspace material is cleared immediately.
   */
  select(workspace: WorkspaceId | undefined): Promise<void> {
    this.invalidate()
    this.publish({ workspace, sources: [] })
    return this.refresh()
  }
  /**
   * Mark metadata stale and clear content without repeating file reads or writes.
   */
  invalidate(): void {
    this.epochs.metadata++; this.clearContent()
    this.publish({ stale: true, loading: false })
  }
  /**
   * Refresh limits and selected source metadata; never re-run searches, citation reads, or writes.
   * @returns completion with a retained read diagnostic on failure.
   */
  async refresh(): Promise<void> {
    if (this.disposed) return
    const epoch = ++this.epochs.metadata, workspace = this.value.workspace
    this.publish({ loading: true, stale: true, error: null })
    try {
      const options = await this.port.options()
      if (epoch !== this.epochs.metadata) return
      const sources = workspace === undefined ? [] : await this.port.sources({ workspaceId: workspace })
      if (epoch !== this.epochs.metadata) return
      // A refreshed grant may revoke material observed before the refresh.
      this.clearContent()
      this.publish({ options, sources: ordered(sources), loading: false, stale: false })
    } catch (error) {
      if (epoch === this.epochs.metadata) this.publish({ loading: false, error: message(error) })
    }
  }
  /**
   * Execute a literal query in the selected workspace; failures clear old hit content.
   * @param text - literal query draft.
   * @param limit - explicit hit limit from advertised options.
   * @returns settlement with independent search diagnostics.
   */
  async search(text: string, limit: number): Promise<void> {
    if (this.disposed || this.value.workspace === undefined) return
    const epoch = ++this.epochs.search, query = { workspaceId: this.value.workspace, text, limit }
    this.publish({ searching: true, result: undefined, searchError: null })
    try {
      const value = await this.port.search(query)
      if (epoch === this.epochs.search) this.publish({ result: { query, value }, searching: false })
    } catch (error) {
      if (epoch === this.epochs.search) this.publish({ searching: false, searchError: message(error) })
    }
  }
  /**
   * Read an exact citation using the selected workspace's authority.
   * @param citation - fixed source/version/digest and inclusive line range.
   * @returns settlement; inaccessible content is cleared instead of retained as a current preview.
   */
  async read(citation: KnowledgeCitation): Promise<void> {
    if (this.disposed || this.value.workspace === undefined) return
    const epoch = ++this.epochs.read, workspaceId = this.value.workspace
    this.publish({ reading: true, excerpt: undefined, readError: null })
    try {
      const excerpt = await this.port.read({ workspaceId, citation: structuredClone(citation) })
      if (epoch === this.epochs.read) this.publish({ excerpt, reading: false })
    } catch (error) {
      if (epoch === this.epochs.read) this.publish({ reading: false, readError: message(error) })
    }
  }
  /** Clear a superseded citation selection without repeating a file read. */
  clearPreview(): void {
    this.epochs.read++
    this.publish({ excerpt: undefined, reading: false, readError: null })
  }
  /**
   * Explicitly submit or retry one fixed command. Lost acknowledgments retain its exact input.
   * @param command - caller-owned registration/index identity or revision-checked grant change.
   * @returns settlement with acknowledged metadata or retained uncertainty; errors live in the snapshot.
   */
  command(command: KnowledgeWrite): Promise<void> {
    if (this.disposed) return Promise.resolve()
    const owned = structuredClone(command), signature = JSON.stringify(owned)
    if (this.mutation !== undefined) {
      if (this.mutation.signature === signature) return this.mutation.task
      this.publish({ writeError: 'Wait for the admitted knowledge command to settle.' }); return Promise.resolve()
    }
    if (this.value.pending !== undefined && JSON.stringify(this.value.pending) !== signature) {
      this.publish({ writeError: 'Resolve or discard the unconfirmed knowledge command first.' }); return Promise.resolve()
    }
    this.clearContent()
    this.publish({ pending: owned, writing: true, writeError: null, acknowledged: undefined })
    const task = this.execute(owned).finally(() => { this.mutation = undefined; this.publish({ writing: false }) })
    this.mutation = { signature, task }
    return task
  }
  private async execute(command: KnowledgeWrite): Promise<void> {
    try {
      let source: KnowledgeSource, acknowledged: KnowledgeAcknowledgment
      switch (command.kind) {
        case 'register':
          source = await this.port.register(command.request)
          acknowledged = { kind: 'register', sourceId: source.id, path: source.path, workspaceId: source.workspaceId }; break
        case 'index': {
          const result = await this.port.index(command.request); source = result.source
          acknowledged = { kind: 'index', sourceId: source.id, path: source.path, workspaceId: source.workspaceId, attempt: result.attempt }; break
        }
        case 'setEnabled':
          source = await this.port.setEnabled(command.request)
          acknowledged = { kind: 'setEnabled', sourceId: source.id, path: source.path, workspaceId: source.workspaceId }; break
        default: return assertNever(command)
      }
      this.publish({ pending: undefined, writeError: null, acknowledged })
      if (source.workspaceId === this.value.workspace) {
        this.publish({ sources: ordered([...this.value.sources.filter(value => value.id !== source.id), source]) })
        await this.refresh()
      }
    } catch (error) { this.publish({ writeError: message(error) }) }
  }
  /** Clear local uncertainty only; no grant or capture is revoked on the server. */
  discard(): void {
    if (!this.value.writing) this.publish({ pending: undefined, writeError: null })
  }
  /** Invalidate pending observations; subscription callers retain their own disposers. */
  dispose(): void { this.disposed = true; this.epochs.metadata++; this.epochs.search++; this.epochs.read++ }
}
