/** React-free configuration observations and recovery of explicitly admitted probes. */
import type { HealthAgent, HealthCheckRequest, HealthProbeId, HealthProbeRecord, HealthProbeRequest, HealthReport } from '@deepseek-ai/dsh-capability-health/types'
import type { ObservableSnapshot } from '../contract/store.ts'
import { Notifier } from '../sessions/notifier.ts'

/** Host refusal differs from an unconfirmed transport failure that may have admitted work. */
export interface HealthPort {
  choices(this: void): Promise<HealthAgent[]>
  check(this: void, request: HealthCheckRequest): Promise<HealthReport>
  startProbe(this: void, request: HealthProbeRequest): Promise<
    { ok: true; value: HealthProbeRecord } | { ok: false; error: { message: string } }
  >
  readProbe(this: void, id: HealthProbeId): Promise<HealthProbeRecord | null>
  cancelProbe(this: void, id: HealthProbeId): Promise<HealthProbeRecord>
}
/** Read observations and submitted probe identities survive page remounts within this app. */
export interface HealthSnapshot {
  agents: HealthAgent[]
  loading: boolean
  loaded: boolean
  checking: boolean
  stale: boolean
  report: HealthReport | undefined
  error: string | null
  probeErrors: { id: HealthProbeId; message: string }[]
  probes: HealthProbeRecord[]
  pending: HealthProbeRequest[]
  unavailable: HealthProbeId[]
}
const message = (error: unknown) => error instanceof Error ? error.message : String(error)
/** Never automatically retries a side-effecting probe admission, including after reconnect. */
export class HealthManager implements ObservableSnapshot<HealthSnapshot> {
  private value: HealthSnapshot = { agents: [], loading: false, loaded: false, checking: false, stale: false, report: undefined,
    error: null, probeErrors: [], probes: [], pending: [], unavailable: [] }
  private readonly notifier = new Notifier(() => {})
  private choiceEpoch = 0
  private checkEpoch = 0
  private disposed = false
  constructor(private readonly port: HealthPort) {}
  /**
   * Read the current observations without starting host work.
   * @returns the stable current observation snapshot.
   */
  getSnapshot = (): HealthSnapshot => this.value
  /**
   * Subscribe to observation changes.
   * @param listener - observation invalidation callback.
   * @returns its subscription disposer.
   */
  subscribe = (listener: () => void): (() => void) => this.notifier.subscribe(listener)
  private publish(patch: Partial<HealthSnapshot>): void {
    if (this.disposed) return
    this.value = { ...this.value, ...patch }; this.notifier.markDirty()
  }
  /**
   * Refresh executor choices without checking configuration or connecting servers.
   * @returns directory-read settlement, discarding superseded responses.
   */
  async load(): Promise<void> {
    if (this.disposed) return
    const epoch = ++this.choiceEpoch
    this.publish({ loading: true })
    try {
      const agents = await this.port.choices()
      if (epoch === this.choiceEpoch) this.publish({ agents, loaded: true, error: null })
    } catch (error) { if (epoch === this.choiceEpoch) this.publish({ error: message(error) }) }
    finally { if (epoch === this.choiceEpoch) this.publish({ loading: false }) }
  }
  /** Configuration changes make observations stale without launching another check or probe. */
  invalidate(): void { this.checkEpoch += 1; this.publish({ stale: true }) }
  /**
   * Perform one explicit configuration read; simultaneous checks are ignored.
   * @param request - global scope or saved executor revision and workspace.
   * @returns settlement; failures preserve the stale last-known report.
   */
  async check(request: HealthCheckRequest): Promise<void> {
    if (this.disposed || this.value.checking) return
    const epoch = ++this.checkEpoch
    this.publish({ checking: true, stale: true, error: null })
    try {
      const report = await this.port.check(request)
      if (epoch === this.checkEpoch) this.publish({ report, stale: false })
    } catch (error) { if (epoch === this.checkEpoch) this.publish({ error: message(error) }) }
    finally { this.publish({ checking: false }) }
  }
  private accept(record: HealthProbeRecord): void {
    const prior = this.value.probes.find(value => value.id === record.id)
    const accepted = prior !== undefined && prior.status !== 'running' ? prior : record
    this.publish({ probes: [...this.value.probes.filter(value => value.id !== record.id), accepted],
      pending: this.value.pending.filter(value => value.id !== record.id),
      unavailable: this.value.unavailable.filter(id => id !== record.id),
      probeErrors: this.value.probeErrors.filter(value => value.id !== record.id) })
  }
  private probeError(id: HealthProbeId, error: unknown): void {
    this.publish({ probeErrors: [...this.value.probeErrors.filter(value => value.id !== id), { id, message: message(error) }] })
  }
  /**
   * Admit a user-requested probe once, retaining uncertain identities for read-only recovery.
   * @param request - fresh explicit action identity and saved server selection.
   * @returns admission settlement; a lost response never triggers resubmission.
   */
  async start(request: HealthProbeRequest): Promise<void> {
    if (this.disposed || this.value.pending.some(value => value.id === request.id) ||
      this.value.probes.some(value => value.id === request.id)) return
    this.publish({ pending: [...this.value.pending, request],
      probeErrors: this.value.probeErrors.filter(value => value.id !== request.id) })
    try {
      const result = await this.port.startProbe(request)
      if (!result.ok) {
        this.publish({ pending: this.value.pending.filter(value => value.id !== request.id) })
        this.probeError(request.id, new Error(result.error.message))
        return
      }
      this.accept(result.value)
    } catch (error) {
      if (!this.value.probes.some(value => value.id === request.id)) this.probeError(request.id, error)
    }
  }
  /**
   * Read only identities submitted by this app; a missing record never repeats admission.
   * @param id - optional event identity, or omit to recover all known operations after reconnect.
   * @returns read settlement, retaining last-known records on failure or host restart.
   */
  async recover(id?: HealthProbeId): Promise<void> {
    if (this.disposed) return
    const known = new Set([...this.value.pending.map(value => value.id), ...this.value.probes.map(value => value.id)])
    const ids = id === undefined ? [...known] : known.has(id) ? [id] : []
    await Promise.all(ids.map(async (key) => {
      try {
        const record = await this.port.readProbe(key)
        if (record === null) this.publish({ unavailable: [...new Set([...this.value.unavailable, key])] })
        else this.accept(record)
      } catch (error) { this.probeError(key, error) }
    }))
  }
  /**
   * Request cancellation of one retained operation and await its cleanup.
   * @param id - submitted probe identity.
   * @returns cancellation settlement; read recovery remains available after response loss.
   */
  async cancel(id: HealthProbeId): Promise<void> {
    if (this.disposed) return
    try { this.accept(await this.port.cancelProbe(id)) }
    catch (error) { this.probeError(id, error) }
  }
  /** Stop late publications; host-owned probes survive closing this page. */
  dispose(): void { this.disposed = true }
}
