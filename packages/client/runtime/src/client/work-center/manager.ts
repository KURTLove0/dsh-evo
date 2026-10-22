/** React-free owner of bounded work pages, selected evidence, and executor readiness. */
import type { WorkCommand, WorkDetail, WorkExecutor, WorkItem, WorkPage, WorkQuery, WorkReceipt, WorkReference, WorkDiagnosis } from '@deepseek-ai/dsh-work-center/types'
import type { AgentCommand, AgentReceipt, TaskBrief, TaskPreflight, WorkbenchAgentId } from '@deepseek-ai/dsh-workbench-agent/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import type { ObservableSnapshot } from '../contract/store.ts'
import { Notifier } from '../sessions/notifier.ts'

/** Transport operations selected by the application's Remote assembly. */
export interface WorkCenterPort {
  options(this: void): Promise<{ pageSize: number }>
  query(this: void, request: WorkQuery): Promise<WorkPage>
  detail(this: void, ref: WorkReference): Promise<WorkDetail>
  diagnose(this: void, ref: WorkReference): Promise<WorkDiagnosis>
  executors(this: void): Promise<WorkExecutor[]>
  command(this: void, request: WorkCommand): Promise<WorkReceipt>
  preflight(this: void, request: { id: WorkbenchAgentId; workspaceId: WorkspaceId; brief?: TaskBrief }): Promise<TaskPreflight>
  submit(this: void, request: Extract<AgentCommand, { kind: 'submit-task' }>): Promise<AgentReceipt>
  revisionBrief(this: void, request: Pick<Extract<WorkCommand, { kind: 'revise-agent' }>, 'ref' | 'reviewRevision' | 'brief'>): Promise<TaskBrief>
}
/** Stable data snapshot; page and attention counts describe loaded rows only. */
export interface WorkCenterSnapshot extends Omit<WorkPage, 'next'> {
  next: WorkPage['next']
  loading: boolean
  error: string | null
  executors: WorkExecutor[]
  executorError: string | null
  attention: WorkItem[]
  attentionNext: WorkPage['next']
  attentionFailures: WorkPage['failures']
  diagnosis: WorkDiagnosis | undefined
  diagnosisError: string | null
  diagnosing: boolean
  diagnosisStale: boolean
  selected: WorkReference | undefined
  detail: WorkDetail | undefined
  readiness: TaskPreflight | undefined
  readinessFor: { id: WorkbenchAgentId; workspaceId: WorkspaceId } | undefined
  pageSize: number | undefined
}
const renderError = (error: unknown) => error instanceof Error ? error.message : String(error)
const referenceKey = (ref: WorkReference | undefined) => ref === undefined ? '' : `${ref.kind}:${ref.id}`

/** Coalesces invalidations and prevents old selection/query reads from replacing new data. */
export class WorkCenterManager implements ObservableSnapshot<WorkCenterSnapshot> {
  private value: WorkCenterSnapshot = { items: [], next: undefined, failures: [], observedAt: 0, loading: false, error: null,
    executors: [], executorError: null, attention: [], attentionNext: undefined, attentionFailures: [],
    diagnosis: undefined, diagnosisError: null, diagnosing: false, diagnosisStale: false,
    selected: undefined, detail: undefined, readiness: undefined, readinessFor: undefined, pageSize: undefined }
  private readonly notifier = new Notifier(() => {})
  private query: Pick<WorkQuery, 'workspaceId' | 'source' | 'state'>
  private generation = 0
  private pending: Promise<void> | undefined
  private dirty = false
  private disposed = false
  private diagnosisGeneration = 0
  private checkGeneration = 0
  private attentionSessionIds: SessionId[] = []
  constructor(private readonly port: WorkCenterPort, initialQuery: Pick<WorkQuery, 'workspaceId' | 'source' | 'state'>) { this.query = initialQuery }
  /** @returns stable committed browser data until the next publication. */
  getSnapshot = (): WorkCenterSnapshot => this.value
  /**
   * Observe publications through the framework hook binding.
   * @param listener - snapshot invalidation callback.
   * @returns the subscription disposer.
   */
  subscribe = (listener: () => void): (() => void) => this.notifier.subscribe(listener)
  private publish(patch: Partial<WorkCenterSnapshot>): void {
    if (this.disposed) return
    this.value = { ...this.value, ...patch }; this.notifier.markDirty()
  }
  /**
   * Replace the directory filter and discard prior pagination.
   * @param request - initial query without a continuation.
   * @returns refresh settlement.
   */
  setQuery(request: Pick<WorkQuery, 'workspaceId' | 'source' | 'state'>): Promise<void> {
    if (JSON.stringify(this.query) !== JSON.stringify(request)) {
      this.query = request; this.generation += 1
      this.publish({ items: [], next: undefined })
    }
    return this.refresh()
  }
  /**
   * Reset pagination when the connection's known pending sessions change.
   * @param ids - sessions with answerable approvals, questions, or plan reviews.
   * @returns refresh settlement; an unchanged set performs no reads.
   */
  setAttention(ids: SessionId[]): Promise<void> {
    const next = [...new Set(ids)].sort()
    if (JSON.stringify(next) === JSON.stringify(this.attentionSessionIds)) return Promise.resolve()
    this.attentionSessionIds = next; this.generation += 1
    this.publish({ next: undefined })
    return this.refresh()
  }
  /**
   * Select a source execution and clear the prior evidence immediately.
   * @param ref - original typed execution identity.
   * @returns refresh settlement.
   */
  select(ref: WorkReference): Promise<void> {
    this.generation += 1
    this.publish({ selected: ref, detail: undefined, diagnosis: undefined, diagnosisError: null, diagnosisStale: false })
    return this.refresh()
  }
  /**
   * Consume invalidations until the current query and selection are observed.
   * @returns settlement of coalesced authoritative reads.
   */
  refresh(): Promise<void> {
    if (this.disposed) return Promise.resolve()
    this.diagnosisGeneration += 1
    this.publish({ diagnosisStale: this.value.diagnosis !== undefined, diagnosing: false })
    this.dirty = true
    if (this.pending !== undefined) return this.pending
    this.pending = this.drain().finally(() => {
      this.pending = undefined
      if (this.dirty && !this.disposed) void this.refresh()
    })
    return this.pending
  }
  private async drain(): Promise<void> {
    this.publish({ loading: true })
    try {
      while (this.dirty && !this.disposed) {
        this.dirty = false
        const generation = this.generation
        const selected = this.value.selected
        const { pageSize } = await this.port.options()
        const [page, attention, executors, detail] = await Promise.allSettled([
          this.port.query({ ...this.query, limit: pageSize, attentionSessionIds: this.attentionSessionIds }),
          this.port.query({ limit: pageSize, source: 'workflow', state: 'waiting',
            ...(this.query.workspaceId === undefined ? {} : { workspaceId: this.query.workspaceId }) }),
          this.port.executors(),
          selected === undefined ? Promise.resolve(undefined) : this.port.detail(selected),
        ])
        if (generation !== this.generation) { this.dirty = true; continue }
        this.publish({
          pageSize,
          ...(page.status === 'fulfilled' ? { ...page.value, next: page.value.next, error: null } : { error: renderError(page.reason) }),
          ...(attention.status === 'fulfilled' ? { attention: attention.value.items, attentionNext: attention.value.next, attentionFailures: attention.value.failures }
            : { attentionFailures: [{ source: 'workflow', message: renderError(attention.reason) }] }),
          ...(executors.status === 'fulfilled' ? { executors: executors.value, executorError: null } : { executorError: renderError(executors.reason) }),
          ...(detail.status === 'fulfilled' ? { detail: detail.value } : { detail: undefined, error: renderError(detail.reason) }),
        })
      }
    } catch (error) { this.publish({ error: renderError(error) }) }
    finally { this.publish({ loading: false }) }
  }
  /**
   * Read diagnostic evidence only for the current selected execution.
   * @returns read settlement; late, invalidated, or superseded evidence is discarded.
   */
  async diagnose(): Promise<void> {
    const selected = this.value.selected
    if (this.disposed || selected === undefined || this.value.diagnosing) return
    const generation = ++this.diagnosisGeneration
    this.publish({ diagnosing: true, diagnosisError: null, diagnosisStale: this.value.diagnosis !== undefined })
    try {
      const diagnosis = await this.port.diagnose(selected)
      if (generation === this.diagnosisGeneration) this.publish({ diagnosis, diagnosisStale: false })
    } catch (error) {
      if (generation === this.diagnosisGeneration) this.publish({ diagnosisError: renderError(error) })
    } finally { if (generation === this.diagnosisGeneration) this.publish({ diagnosing: false }) }
  }
  /**
   * Append the next directory page without replacing its first page.
   * @returns completion; stale responses are discarded.
   */
  more(): Promise<void> {
    if (this.value.loading || this.value.next === undefined || this.value.pageSize === undefined || this.disposed) return Promise.resolve()
    const generation = this.generation
    const request = { ...this.query, limit: this.value.pageSize, cursor: this.value.next, attentionSessionIds: this.attentionSessionIds }
    this.publish({ loading: true })
    this.pending = this.port.query(request).then((page) => {
      if (generation !== this.generation) return
      const existing = new Set(this.value.items.map(item => `${item.kind}:${item.run.id}`))
      this.publish({ ...page, next: page.next, items: [...this.value.items, ...page.items.filter(item => !existing.has(`${item.kind}:${item.run.id}`))], error: null })
    }, (error: unknown) => {
      if (generation === this.generation) this.publish({ error: renderError(error) })
    }).then(async () => {
      if (this.dirty && !this.disposed) await this.drain()
      else this.publish({ loading: false })
      this.pending = undefined
      if (this.dirty && !this.disposed) void this.refresh()
    })
    return this.pending
  }
  /**
   * Observe readiness for a selected executor without submitting work.
   * @param request - explicit executor and workspace.
   * @param revision - optional committed review used to prepare revision feedback.
   * @returns timestamped check results.
   */
  async check(
    request: { id: WorkbenchAgentId; workspaceId: WorkspaceId; brief: TaskBrief },
    revision?: { ref: Extract<WorkReference, { kind: 'agent' }>; reviewRevision: number },
  ): Promise<TaskPreflight> {
    const generation = ++this.checkGeneration
    const brief = revision === undefined ? request.brief : await this.port.revisionBrief({ ...revision, brief: request.brief })
    const result = await this.port.preflight({ ...request, brief })
    if (generation === this.checkGeneration)
      this.publish({ readiness: result, readinessFor: { id: request.id, workspaceId: request.workspaceId } })
    return result
  }
  /** Invalidate a preview when its user-editable inputs change. */
  invalidateCheck(): void { this.checkGeneration += 1; this.publish({ readiness: undefined, readinessFor: undefined }) }
  /**
   * Submit an idempotent structured task, then inspect its acknowledged run.
   * @param request - complete task brief with the checked executor revision.
   * @returns the authoritative submission receipt.
   */
  async submit(request: Extract<AgentCommand, { kind: 'submit-task' }>): Promise<AgentReceipt> {
    const selected = referenceKey(this.value.selected)
    const receipt = await this.port.submit(request)
    if (receipt.runId !== undefined && selected === referenceKey(this.value.selected))
      await this.select({ kind: 'agent', id: receipt.runId })
    else await this.refresh()
    return receipt
  }
  /**
   * Commit an operator decision, refreshing only the current selection afterward.
   * @param request - review or explicit subsequent source action.
   * @returns the authoritative command receipt.
   */
  async command(request: WorkCommand): Promise<WorkReceipt> {
    const selected = referenceKey(this.value.selected)
    const receipt = await this.port.command(request)
    if (selected === referenceKey(this.value.selected) && referenceKey(receipt.ref) !== selected) await this.select(receipt.ref)
    else await this.refresh()
    return receipt
  }
  /** Release the owning plugin's data source without publishing late reads. */
  dispose(): void { this.disposed = true }
}
