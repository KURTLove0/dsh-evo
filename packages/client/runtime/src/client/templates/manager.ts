/** React-free private template reads and revisioned mutations. */
import type { WorkTemplates } from '@deepseek-ai/dsh-work-templates'
import type { TemplateCopyRequest, TemplateMutation, TemplateReceipt, TemplateRecord, TemplateSummary, TemplateWorkflowSource, WorkTemplateId } from '@deepseek-ai/dsh-work-templates/types'
import type { WorkflowReceipt } from '@deepseek-ai/dsh-business-workflow/workbench-types'
import type { ObservableSnapshot } from '../contract/store.ts'
import { Notifier } from '../sessions/notifier.ts'

/** Async Remote operations consumed by the template data owner. */
export interface TemplatePort {
  list(this: void): ReturnType<WorkTemplates['list']>
  read(this: void, id: WorkTemplateId): ReturnType<WorkTemplates['read']>
  sources(this: void): ReturnType<WorkTemplates['sources']>
  examples(this: void): Promise<ReturnType<WorkTemplates['examples']>>
  command(this: void, request: TemplateMutation): ReturnType<WorkTemplates['command']>
  copyWorkflow(this: void, request: TemplateCopyRequest): ReturnType<WorkTemplates['copyWorkflow']>
}
/** Immutable published browser state, excluding view drafts. */
export interface TemplateSnapshot {
  items: TemplateSummary[]
  sources: TemplateWorkflowSource[]
  examples: ReturnType<WorkTemplates['examples']>
  selected: WorkTemplateId | undefined
  record: TemplateRecord | undefined
  loading: boolean
  error: string | null
}
/** Coalesces host changes and discards reads for superseded selections. */
export class TemplateManager implements ObservableSnapshot<TemplateSnapshot> {
  private value: TemplateSnapshot = { items: [], sources: [], examples: [],
    selected: undefined, record: undefined, loading: false, error: null }
  private readonly notifier = new Notifier(() => {})
  private pending: Promise<void> | undefined
  private dirty = false
  private disposed = false
  private generation = 0
  constructor(private readonly port: TemplatePort) {}
  /** @returns the stable current publication. */
  getSnapshot = (): TemplateSnapshot => this.value
  /**
   * Observe data publications through the framework binding.
   * @param listener - invalidation callback.
   * @returns the subscription disposer.
   */
  subscribe = (listener: () => void): (() => void) => this.notifier.subscribe(listener)
  private publish(patch: Partial<TemplateSnapshot>): void {
    if (this.disposed) return
    this.value = { ...this.value, ...patch }; this.notifier.markDirty()
  }
  /**
   * Read one authoritative template history.
   * @param id - selected private template identity.
   * @returns refresh settlement.
   */
  select(id: WorkTemplateId): Promise<void> {
    this.generation += 1; this.publish({ selected: id, record: undefined }); return this.refresh()
  }
  /**
   * Read the committed directory and selected history until pending invalidations settle.
   * @returns settlement after current invalidations and selection reads are consumed.
   */
  refresh(): Promise<void> {
    if (this.disposed) return Promise.resolve()
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
        const results = await Promise.allSettled([
          Promise.resolve().then(() => this.port.list()),
          Promise.resolve().then(() => this.port.sources()),
          Promise.resolve().then(() => this.port.examples()),
          Promise.resolve().then(() => selected === undefined ? undefined : this.port.read(selected)),
        ])
        if (generation !== this.generation) { this.dirty = true; continue }
        const [items, sources, examples, record] = results
        const errors = results.filter(result => result.status === 'rejected')
          .map(result => result.reason instanceof Error ? result.reason.message : String(result.reason))
        this.publish({
          ...(items.status === 'fulfilled' ? { items: items.value } : {}),
          ...(sources.status === 'fulfilled' ? { sources: sources.value } : {}),
          ...(examples.status === 'fulfilled' ? { examples: examples.value } : {}),
          ...(record.status === 'fulfilled' ? { record: record.value } : {}),
          error: errors.length === 0 ? null : errors.join(' · '),
        })
      }
    } finally { this.publish({ loading: false }) }
  }
  /**
   * Save a revisioned template mutation without executing work.
   * @param request - idempotent content or archive mutation.
   * @returns the committed receipt, including when a subsequent refresh fails.
   */
  async command(request: TemplateMutation): Promise<TemplateReceipt> {
    const receipt = await this.port.command(request)
    if (this.value.selected === undefined || this.value.selected === request.id) await this.select(receipt.id)
    else await this.refresh()
    return receipt
  }
  /**
   * Create an independent workflow draft from a pinned content version.
   * @param request - destination and idempotent copy identity.
   * @returns the acknowledged draft identity; no publication or execution occurs.
   */
  copyWorkflow(request: TemplateCopyRequest): Promise<WorkflowReceipt> { return this.port.copyWorkflow(request) }
  /** Discard late publications after plugin disposal. */
  dispose(): void { this.disposed = true }
}
