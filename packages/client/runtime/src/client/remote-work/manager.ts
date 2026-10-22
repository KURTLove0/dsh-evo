/** React-free authority-qualified remote observations; reconnects only read and never repeat writes. */
import type { RemoteCallRequest, RemotePeer, RemotePeerId, RemoteWorkResult, RemoteSubmissionId } from '@deepseek-ai/dsh-work-remote/types'
import type { ObservableSnapshot } from '../contract/store.ts'
import { Notifier } from '../sessions/notifier.ts'
/** Unwrapped application gateway consumed by the remote-work manager. */
export interface RemoteWorkPort {
  peers(this: void): Promise<RemotePeer[]>
  call(this: void, request: RemoteCallRequest): Promise<RemoteWorkResult>
}
/** Last-known values retain independent read errors and freshness. */
export interface RemoteObservation<T> { value?: T; loading: boolean; stale: boolean; error: string | null }
/** Read selections and native results belong to the object layer. */
export interface RemoteWorkSnapshot {
  peers: RemoteObservation<RemotePeer[]>
  peer?: RemotePeerId
  catalog: RemoteObservation<Extract<RemoteWorkResult, { kind: 'catalog' }>>
  history: RemoteObservation<Extract<RemoteWorkResult, { kind: 'list' }>>
  detail: RemoteObservation<Extract<RemoteWorkResult, { kind: 'inspection' }>> & { id?: RemoteSubmissionId }
  mutating: boolean
}
const empty = () => ({ loading: false, stale: true, error: null })
const message = (error: unknown) => error instanceof Error ? error.message : String(error)
/** A selection generation prevents results from another machine or connection replacing current reads. */
export class RemoteWorkManager implements ObservableSnapshot<RemoteWorkSnapshot> {
  private value: RemoteWorkSnapshot = { peers: empty(), catalog: empty(), history: empty(), detail: empty(), mutating: false }
  private readonly notifier = new Notifier(() => {})
  private epochs = { peers: 0, catalog: 0, history: 0, detail: 0 }
  private disposed = false
  private mutation: { signature: string; task: Promise<RemoteWorkResult> } | undefined
  constructor(private readonly port: RemoteWorkPort) {}
  /** @returns stable observations until publication. */
  getSnapshot = (): RemoteWorkSnapshot => this.value
  /**
   * Observe read and command settlement.
   * @param listener - invalidation callback.
   * @returns subscription disposer.
   */
  subscribe = (listener: () => void): (() => void) => this.notifier.subscribe(listener)
  private publish(patch: Partial<RemoteWorkSnapshot>): void {
    if (this.disposed) return
    this.value = { ...this.value, ...patch }; this.notifier.markDirty()
  }
  /**
   * Read configured authority without probing any remote machine.
   * @returns settlement; errors retain stale metadata.
   */
  async peers(): Promise<void> {
    if (this.disposed) return
    const epoch = ++this.epochs.peers
    this.publish({ peers: { ...this.value.peers, loading: true, stale: true, error: null } })
    try {
      const value = await this.port.peers()
      if (epoch === this.epochs.peers) {
        const previous = this.value.peers.value?.find(peer => peer.id === this.value.peer)
        const next = value.find(peer => peer.id === this.value.peer)
        if (previous?.hostId !== next?.hostId || previous?.principalId !== next?.principalId) {
          this.invalidate(); this.publish({ catalog: empty(), history: empty(), detail: empty() })
        }
        this.publish({ peers: { value, loading: false, stale: false, error: null } })
      }
    } catch (error) {
      if (epoch === this.epochs.peers) this.publish({ peers: { ...this.value.peers, loading: false, error: message(error) } })
    }
  }
  /**
   * Select a configured machine, discarding observations owned by another authority.
   * @param peer - explicitly chosen local peer id.
   * @returns settlement of its catalog and retained history.
   */
  async choose(peer: RemotePeerId): Promise<void> {
    if (this.disposed) return
    const peers = this.value.peers
    this.invalidate()
    this.publish({ peers, peer, catalog: empty(), history: empty(), detail: empty() })
    await Promise.all([this.read('catalog', { kind: 'catalog' }), this.read('history', { kind: 'list' })])
  }
  private request(operation: RemoteCallRequest['operation']): RemoteCallRequest {
    const peer = this.value.peers.value?.find(value => value.id === this.value.peer)
    if (peer === undefined || this.value.peers.stale) throw new Error('Remote authority must be refreshed before an operation.')
    return { peer: peer.id, expected: { hostId: peer.hostId, principalId: peer.principalId }, operation }
  }
  private async read(key: 'catalog' | 'history' | 'detail', operation: RemoteCallRequest['operation']): Promise<void> {
    if (this.disposed) return
    const epoch = ++this.epochs[key]
    this.publish({ [key]: { ...this.value[key], loading: true, stale: true, error: null } })
    try {
      const result = await this.port.call(this.request(operation))
      if (result.kind !== (key === 'catalog' ? 'catalog' : key === 'history' ? 'list' : 'inspection'))
        throw new Error('Unexpected remote read result.')
      if (epoch === this.epochs[key]) this.publish({ [key]: { ...this.value[key], value: result,
        loading: false, stale: false, error: null } })
    } catch (error) {
      if (epoch === this.epochs[key]) this.publish({ [key]: { ...this.value[key], loading: false, error: message(error) } })
    }
  }
  /**
   * Inspect one original submission without changing its execution.
   * @param id - identity within the selected receiving Host and principal.
   * @returns independently retained detail observation.
   */
  async select(id: RemoteSubmissionId): Promise<void> {
    if (this.disposed) return
    this.epochs.detail++
    if (this.value.detail.id !== id) this.publish({ detail: { ...empty(), id } })
    await this.read('detail', { kind: 'inspect', id })
  }
  /** Retain observations as stale and retire every unresolved read. */
  invalidate(): void {
    for (const key of ['peers', 'catalog', 'history', 'detail'] as const) this.epochs[key]++
    this.publish({ peers: { ...this.value.peers, loading: false, stale: true },
      catalog: { ...this.value.catalog, loading: false, stale: true }, history: { ...this.value.history, loading: false, stale: true },
      detail: { ...this.value.detail, loading: false, stale: true } })
  }
  /**
   * Refresh current reads after connection changes; no mutation is repeated.
   * @returns completion of independent reads.
   */
  async sync(): Promise<void> {
    await this.peers()
    if (this.value.peer === undefined || this.disposed) return
    await Promise.all([this.read('catalog', { kind: 'catalog' }), this.read('history', { kind: 'list' }),
      ...(this.value.detail.id === undefined ? [] : [this.select(this.value.detail.id)])])
  }
  /**
   * Send one explicit authority-pinned operation, coalescing equal in-flight input only.
   * @param request - immutable caller-owned command and receiving authority.
   * @returns remote receipt independently of refresh failures.
   */
  command(request: RemoteCallRequest): Promise<RemoteWorkResult> {
    if (this.disposed) return Promise.reject(new Error('Remote work manager is disposed.'))
    const owned = structuredClone(request), signature = JSON.stringify(owned)
    if (this.mutation !== undefined) return signature === this.mutation.signature
      ? this.mutation.task : Promise.reject(new Error('Another remote command is pending.'))
    const task = Promise.resolve().then(() => {
      if (this.disposed) throw new Error('Remote work manager is disposed.')
      return this.port.call(owned)
    }).then((result) => {
      void this.sync(); return result
    }).catch((error: unknown) => { this.invalidate(); void this.sync(); throw error }).finally(() => {
      this.mutation = undefined; this.publish({ mutating: false })
    })
    this.mutation = { signature, task }; this.publish({ mutating: true }); return task
  }
  /** Stop publication; already sent commands retain their original authority and native ownership. */
  dispose(): void { this.invalidate(); this.disposed = true }
}
