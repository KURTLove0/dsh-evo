/** React-free workflow directory and history owner; refreshes serialize across notifications. */
import type {
  WorkflowCommand,
  WorkflowDefinition,
  WorkflowId,
  WorkflowReceipt,
  WorkflowValidation,
  WorkflowWorkbenchSnapshot,
} from '@deepseek-ai/dsh-business-workflow/workbench-types'
import type { ObservableSnapshot } from '../contract/store.ts'
import { Notifier } from '../sessions/notifier.ts'

/** Transport methods selected by the application Remote assembly. */
export interface WorkflowPort {
  /**
   * Read authoritative records.
   * @param id - optional selected workflow.
   * @returns directory and selected workflow history.
   */
  snapshot(id?: WorkflowId): Promise<WorkflowWorkbenchSnapshot>
  /**
   * Persist a management operation.
   * @param command - full operation.
   * @returns affected identities.
   */
  command(command: WorkflowCommand): Promise<WorkflowReceipt>
  /**
   * Validate a candidate without saving.
   * @param definition - current definition.
   * @returns publish diagnostics.
   */
  validate(definition: WorkflowDefinition): Promise<WorkflowValidation>
}
/** Cached data and transport state exposed to the framework's selector binding. */
export interface WorkflowClientSnapshot extends WorkflowWorkbenchSnapshot {
  /** Selected directory record. */
  selectedId?: WorkflowId
  /** Initial or explicit refresh in progress. */
  loading: boolean
  /** Last command or refresh error. */
  error: string | null
}
/** One persistent object owner for directory, history, and generation status. */
export class WorkflowManager implements ObservableSnapshot<WorkflowClientSnapshot> {
  private snapshotCache: WorkflowClientSnapshot = {
    workflows: [],
    runs: [],
    operations: [],
    presets: [],
    latestRuns: [],
    loading: false,
    error: null,
  }
  private readonly notifier = new Notifier(() => {})
  private inflight: Promise<void> | undefined
  private dirty = false
  private disposed = false

  /** @param port - typed application operations, independent of React and conversation selection. */
  constructor(private readonly port: WorkflowPort) {}
  /** @returns the stable snapshot until the next publication. */
  getSnapshot = (): WorkflowClientSnapshot => this.snapshotCache
  /**
   * Observe authoritative data changes.
   * @param listener - framework notification callback.
   * @returns subscription disposer.
   */
  subscribe = (listener: () => void): (() => void) => this.notifier.subscribe(listener)

  private publish(patch: Partial<WorkflowClientSnapshot>): void {
    if (this.disposed) return
    this.snapshotCache = { ...this.snapshotCache, ...patch }
    this.notifier.markDirty()
  }

  /**
   * Select one workflow; older requests settle before the new snapshot publishes.
   * @param id - workflow identity.
   * @returns settlement of the resulting refresh.
   */
  async select(id: WorkflowId): Promise<void> {
    this.publish({ selectedId: id, runs: [], operations: [] })
    await this.refresh()
  }

  /**
   * Coalesce notifications and fetch again if state changed during a request.
   * @returns settlement after all refreshes requested in this interval.
   */
  refresh(): Promise<void> {
    if (this.disposed) return Promise.resolve()
    this.dirty = true
    if (this.inflight !== undefined) return this.inflight
    this.inflight = this.drain().then(async () => {
      this.inflight = undefined
      if (this.dirty && !this.disposed) await this.refresh()
    })
    return this.inflight
  }

  private async drain(): Promise<void> {
    this.publish({ loading: true })
    try {
      while (this.dirty && !this.disposed) {
        this.dirty = false
        const selection = this.snapshotCache.selectedId
        const data = await this.port.snapshot(selection)
        if (selection === this.snapshotCache.selectedId) this.publish({ ...data, error: null })
        else this.dirty = true
      }
    } catch (error) {
      this.publish({ error: String(error) })
    } finally {
      this.publish({ loading: false })
    }
  }

  /**
   * Apply a command, then fetch its committed result.
   * @param command - versioned edit or execution action.
   * @returns the persisted identities; failures retain existing data and reject.
   */
  async command(command: WorkflowCommand): Promise<WorkflowReceipt> {
    try {
      const receipt = await this.port.command(command)
      if (command.kind === 'create') await this.select(receipt.workflowId)
      else await this.refresh()
      if (this.snapshotCache.error !== null)
        throw new Error(`Operation was committed, but refreshing its result failed: ${this.snapshotCache.error}`)
      return receipt
    } catch (error) {
      this.publish({ error: String(error) })
      throw error
    }
  }

  /**
   * Validate without mutating the saved draft.
   * @param definition - current editor content.
   * @returns diagnostics for the exact submitted value.
   */
  validate(definition: WorkflowDefinition): Promise<WorkflowValidation> {
    return this.port.validate(definition)
  }

  /** Stop publishing when the owning plugin unloads. */
  dispose(): void {
    this.disposed = true
  }
}
