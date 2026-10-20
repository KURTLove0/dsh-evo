/** React-free owner of the independent agent directory and selected run history. */
import type { AgentCommand, AgentDirectory, AgentReceipt, WorkbenchAgentId } from '@deepseek-ai/dsh-workbench-agent/types'
import type { ObservableSnapshot } from '../contract/store.ts'
import { Notifier } from '../sessions/notifier.ts'

/** Transport selected by the application Remote assembly. */
export interface AgentDirectoryPort {
  /**
   * Read committed records.
   * @param id - optional history selection.
   * @returns directory and selected history.
   */
  snapshot(id?: WorkbenchAgentId): Promise<AgentDirectory>
  /**
   * Persist one operation.
   * @param command - edit or task request.
   * @returns committed identities.
   */
  command(command: AgentCommand): Promise<AgentReceipt>
}
/** Stable observable directory cache. */
export interface AgentDirectorySnapshot extends AgentDirectory {
  selectedId?: WorkbenchAgentId | undefined
  loading: boolean
  error: string | null
}

/** Coalesces notifications and discards responses for superseded selections. */
export class AgentDirectoryManager implements ObservableSnapshot<AgentDirectorySnapshot> {
  private value: AgentDirectorySnapshot = {
    agents: [], runs: [], workloads: [], runtime: { id: 'harness', available: false }, defaultConcurrency: 1, maxConcurrency: 1, loading: false, error: null,
  }
  private readonly notifier = new Notifier(() => {})
  private pending: Promise<void> | undefined
  private dirty = false
  private disposed = false
  constructor(private readonly port: AgentDirectoryPort) {}
  /** @returns the stable snapshot until publication. */
  getSnapshot = (): AgentDirectorySnapshot => this.value
  /**
   * Observe changes through the framework selector binding.
   * @param listener - publication callback.
   * @returns subscription disposer.
   */
  subscribe = (listener: () => void): (() => void) => this.notifier.subscribe(listener)
  private publish(patch: Partial<AgentDirectorySnapshot>): void {
    if (this.disposed) return
    this.value = { ...this.value, ...patch }
    this.notifier.markDirty()
  }
  /**
   * Select a history and clear the prior history immediately.
   * @param id - stable identity.
   * @returns refresh settlement.
   */
  select(id: WorkbenchAgentId): Promise<void> {
    this.publish({ selectedId: id, runs: [] })
    return this.refresh()
  }
  /**
   * Refresh until notifications received during the request are consumed.
   * @returns settlement after coalesced reads.
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
        const id = this.value.selectedId
        const result = await this.port.snapshot(id)
        if (id === this.value.selectedId) this.publish({ ...result, error: null })
        else this.dirty = true
      }
    } catch (error) { this.publish({ error: error instanceof Error ? error.message : String(error) }) }
    finally { this.publish({ loading: false }) }
  }
  /**
   * Persist and refresh; a failed refresh keeps the returned receipt authoritative.
   * @param command - requested edit or task action.
   * @returns committed identities; write failures reject and appear in the snapshot.
   */
  async command(command: AgentCommand): Promise<AgentReceipt> {
    try {
      const receipt = await this.port.command(command)
      await this.select(receipt.agentId)
      return receipt
    } catch (error) {
      this.publish({ error: error instanceof Error ? error.message : String(error) })
      throw error
    }
  }
  /** Stop publishing after the owning plugin unloads. */
  dispose(): void { this.disposed = true }
}
