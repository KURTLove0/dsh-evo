/** Explicit project-file snapshots over source-owned executions and retained reviews. */
import { createHash, randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import type {} from '@deepseek-ai/dsh-work-center'
import type {} from '@deepseek-ai/dsh-workspace'
import type {} from '@deepseek-ai/dsh-fs'
import { WorkArtifacts } from './service.ts'
import { WorkArtifactGateway } from './gateway.ts'
import { artifactDomain, type StoredArtifact, type StoredArtifactVersion } from './schema.ts'
import { decodeArtifact, encodeArtifact, type ArtifactBytes } from './bytes.ts'
import type { ArtifactDetail, ArtifactGeneration, ArtifactObservation, ArtifactOrigin, ArtifactPage, ArtifactQuery, ArtifactReceipt, ArtifactRegistration, ArtifactSummary, ArtifactVersion, WorkArtifactId } from './types.ts'
export type * from './types.ts'
export { WorkArtifacts } from './service.ts'
/** Deployment bounds apply to complete retained records and emitted responses. */
export interface Config {
  /** Explicit page size advertised to browser consumers. */
  pageSize: number
  /** Maximum metadata rows in one query. */
  maxPageSize: number
  /** Maximum file registrations retained across workspaces. */
  maxArtifacts: number
  /** Maximum immutable captures retained per registered path. */
  maxVersions: number
  /** Inclusive raw-file byte bound enforced by the filesystem provider. */
  maxFileBytes: number
  /** Inclusive UTF-8 bound on one complete stored history, including request receipts. */
  maxRecordBytes: number
  /** Inclusive UTF-8 bound on each complete response, including metadata. */
  maxResponseBytes: number
}
/** Source facts, persistence, and one filesystem execution world. */
export const inject = ['workCenter', 'storageDomain', 'workspaceRegistry', 'fs']
/** Deployment-selected query, capture, and retained-history bounds. */
export const Config: z<Config> = z.object({
  pageSize: z.number().step(1).min(1).default(25), maxPageSize: z.number().step(1).min(1).default(100),
  maxArtifacts: z.number().step(1).min(1).default(1000), maxVersions: z.number().step(1).min(1).default(20),
  maxFileBytes: z.number().step(1).min(1).default(131072), maxRecordBytes: z.number().step(1).min(1).default(4194304),
  maxResponseBytes: z.number().step(1).min(1).default(1048576) })
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const message = (error: unknown) => error instanceof Error ? error.message : String(error)
const info = ({ content: _content, requestId: _request, intentHash: _hash, ...value }: StoredArtifactVersion): ArtifactVersion => value
const summary = (value: StoredArtifact): ArtifactSummary => ({ id: value.id, workspaceId: value.workspaceId,
  workspacePath: value.workspacePath,
  path: value.path, latest: info(value.versions[value.versions.length - 1] as StoredArtifactVersion) })
/** Serialization owns capture/version comparisons and drains before domain teardown. */
export class NativeWorkArtifacts extends WorkArtifacts {
  static inject = inject
  static Config = Config
  private domain!: Domain<typeof artifactDomain>
  private generation = randomUUID() as ArtifactGeneration
  private tail: Promise<void> = Promise.resolve()
  private closing = false
  private readonly owner: Context
  constructor(ctx: Context, private readonly config: Config) { super(ctx); this.owner = ctx }
  protected async [Service.init](): Promise<void> {
    if (this.config.pageSize > this.config.maxPageSize) throw new Error('Artifact pageSize must not exceed maxPageSize.')
    this.domain = await this.owner.storageDomain.open(artifactDomain)
    this.owner.effect(() => async () => { this.closing = true; await this.tail; await this.domain.close() }, 'artifacts: drain captures and close storage')
  }
  private queue<T>(action: () => Promise<T> | T): Promise<T> {
    if (this.closing) return Promise.reject(new Error('Artifact service is unloading.'))
    const result = this.tail.then(action)
    this.tail = result.then(() => {}, () => {})
    return result
  }
  private checked<T>(result: T): T {
    if (Buffer.byteLength(JSON.stringify(result)) > this.config.maxResponseBytes) throw new Error('Artifact response exceeds maxResponseBytes. Narrow the directory or inspect the source.')
    return structuredClone(result)
  }
  private record(id: WorkArtifactId): StoredArtifact {
    const value = this.domain.table('artifacts').get(id)
    if (value === undefined) throw new Error('Unknown project artifact.')
    return value
  }
  private capture(record: StoredArtifact, version: number): StoredArtifactVersion {
    const captured = record.versions.find(value => value.version === version)
    if (captured === undefined) throw new Error('Unknown artifact capture version.')
    return captured
  }
  options() { return this.checked({ pageSize: this.config.pageSize, maxFileBytes: this.config.maxFileBytes }) }
  query(request: ArtifactQuery): Promise<ArtifactPage> {
    const selected = structuredClone(request)
    return this.queue(() => {
      if (!Number.isSafeInteger(selected.limit) || selected.limit < 1 || selected.limit > this.config.maxPageSize)
        throw new Error('Artifact query limit is outside maxPageSize.')
      const text = selected.text.trim().toLowerCase()
      const query = hash(JSON.stringify([text, selected.limit, selected.workspaceId, selected.source, selected.origin]))
      if (selected.cursor !== undefined && (selected.cursor.generation !== this.generation || selected.cursor.query !== query))
        throw new Error('Artifact directory or selection changed. Refresh before continuing.')
      const rows = [...this.domain.table('artifacts').entries()].map(([, value]) => summary(value)).filter(value =>
        (selected.workspaceId === undefined || value.workspaceId === selected.workspaceId) &&
        (selected.source === undefined || value.latest.origin.source.ref.kind === selected.source) &&
        (selected.origin === undefined || value.latest.origin.kind === selected.origin) &&
        `${value.path} ${value.latest.origin.source.name} ${value.latest.origin.source.ref.id}`.toLowerCase().includes(text))
        .sort((a, b) => b.latest.capturedAt - a.latest.capturedAt || a.id.localeCompare(b.id))
      const at = selected.cursor === undefined ? 0 : rows.findIndex(value => value.id === selected.cursor?.after) + 1
      if (selected.cursor !== undefined && at === 0) throw new Error('Artifact continuation does not name a selected record.')
      const items = rows.slice(at, at + selected.limit), last = items.at(-1)
      return this.checked({ items, observedAt: Date.now(), ...(last !== undefined && at + items.length < rows.length
        ? { next: { generation: this.generation, query, after: last.id } } : {}) })
    })
  }
  read(id: WorkArtifactId, version: number): Promise<ArtifactDetail> {
    return this.queue(() => {
      const record = this.record(id), capture = this.capture(record, version)
      return this.checked({ entry: summary(record), versions: record.versions.map(info),
        snapshot: { ...info(capture), content: capture.content } })
    })
  }
  register(request: ArtifactRegistration): Promise<ArtifactReceipt> {
    const owned = structuredClone(request)
    return this.queue(async () => {
      if (owned.requestId === '' || owned.path.trim() === '') throw new Error('Artifact request identity and path must be nonempty.')
      const sourceIntent = { kind: owned.source.kind, ref: { kind: owned.source.ref.kind, id: owned.source.ref.id },
        ...(owned.source.kind === 'accepted-review' ? { reviewRevision: owned.source.reviewRevision } : {}) }
      const intentHash = hash(JSON.stringify([owned.id, owned.expectedVersion, owned.path, sourceIntent]))
      const all = [...this.domain.table('artifacts').entries()].map(([, value]) => value)
      for (const record of all) {
        const repeated = record.versions.find(value => value.requestId === owned.requestId)
        if (repeated !== undefined) {
          if (repeated.intentHash !== intentHash) throw new Error('Artifact request identity belongs to another registration.')
          return this.checked({ id: record.id, version: repeated.version })
        }
      }
      const current = owned.id === undefined ? undefined : this.record(owned.id)
      if ((current?.versions.length ?? 0) !== owned.expectedVersion) throw new Error('Artifact version changed. Reload before registering.')
      if (current === undefined && all.length >= this.config.maxArtifacts) throw new Error('Artifact registration capacity reached.')
      if (current !== undefined && current.versions.length >= this.config.maxVersions) throw new Error('Artifact version capacity reached.')
      const source = await this.owner.workCenter.source(owned.source.ref)
      if (['queued', 'running', 'waiting', 'stopping'].includes(source.status)) throw new Error('Wait for the source execution to settle before registering files.')
      const workspace = this.owner.workspaceRegistry.get(source.workspaceId)
      if (workspace === undefined) throw new Error('Artifact workspace is unavailable.')
      if (current !== undefined && (current.workspaceId !== source.workspaceId
        || current.workspacePath !== workspace.path || current.path !== owned.path))
        throw new Error('Artifact registration workspace and path cannot change.')
      if (current === undefined && all.some(value => value.workspaceId === source.workspaceId && value.path === owned.path))
        throw new Error('This workspace path is already registered. Select its entry and append a version.')
      let bytes: ArtifactBytes, origin: ArtifactOrigin
      if (owned.source.kind === 'accepted-review') {
        const review = await this.owner.workCenter.review(owned.source.ref, owned.source.reviewRevision)
        if (review.decision !== 'accepted') throw new Error('Select an accepted review to promote its retained file.')
        const file = review.delivery.artifacts.find(value => value.path === owned.path)
        if (file?.state !== 'captured') throw new Error('Accepted review has no retained capture for this exact path.')
        const retained = decodeArtifact(file)
        if (retained.byteLength > this.config.maxFileBytes) throw new Error('Reviewed file exceeds maxFileBytes.')
        bytes = encodeArtifact(retained)
        origin = { kind: 'accepted-review', source, reviewRevision: review.revision, deliveryVersion: review.version, reviewedAt: review.reviewedAt }
      } else {
        bytes = encodeArtifact(await this.currentBytes(workspace.path, owned.path))
        origin = { kind: 'current-file', source }
      }
      const id = current?.id ?? randomUUID() as WorkArtifactId
      const version = (current?.versions.length ?? 0) + 1
      const record: StoredArtifact = { id, path: owned.path, workspaceId: source.workspaceId, workspacePath: workspace.path,
        versions: [...(current?.versions ?? []), { ...bytes, version, capturedAt: Date.now(), origin,
          requestId: owned.requestId, intentHash }] }
      if (Buffer.byteLength(JSON.stringify(record)) > this.config.maxRecordBytes) throw new Error('Artifact history exceeds maxRecordBytes.')
      const receipt = this.checked({ id, version })
      await this.domain.table('artifacts').put(id, record)
      this.generation = randomUUID() as ArtifactGeneration
      for (const listener of this.owner.events.dispatch('emit', ['work-artifact/changed', id])) {
        try { void Promise.resolve(listener(id)).catch((error: unknown) => { this.owner.logger.warn('Artifact listener failed: %s', message(error)) }) }
        catch (error) { this.owner.logger.warn('Artifact listener failed: %s', message(error)) }
      }
      return receipt
    })
  }
  private async currentBytes(workspacePath: string, path: string): Promise<Uint8Array> {
    const parent = await this.owner.fs.resolve('.', { cwd: workspacePath })
    const target = await this.owner.fs.resolve(path, { cwd: workspacePath })
    if (!this.owner.fs.contains(parent, target)) throw new Error('Artifact path is outside the selected workspace.')
    return this.owner.fs.readBytes(target, undefined, this.config.maxFileBytes)
  }
  inspectCurrent(id: WorkArtifactId, version: number): Promise<ArtifactObservation> {
    return this.queue(async () => {
      const record = this.record(id), capture = this.capture(record, version)
      let observation: ArtifactObservation
      try {
        const workspace = this.owner.workspaceRegistry.get(record.workspaceId)
        if (workspace?.path !== record.workspacePath) throw new Error('Original artifact workspace is unavailable.')
        const parent = await this.owner.fs.resolve('.', { cwd: workspace.path })
        const target = await this.owner.fs.resolve(record.path, { cwd: workspace.path })
        if (!this.owner.fs.contains(parent, target)) throw new Error('Artifact path is outside its original workspace.')
        if (await this.owner.fs.stat(target) === undefined) observation = { id, version, observedAt: Date.now(), state: 'missing' }
        else {
          const bytes = await this.owner.fs.readBytes(target, undefined, this.config.maxFileBytes)
          const sha256 = createHash('sha256').update(bytes).digest('hex')
          observation = { id, version, observedAt: Date.now(), state: sha256 === capture.sha256 ? 'matching' : 'different', sha256, bytes: bytes.byteLength }
        }
      } catch (error) { observation = { id, version, observedAt: Date.now(), state: 'unavailable', message: message(error) } }
      return this.checked(observation)
    })
  }
}
/**
 * Mount durable file registrations and their typed Remote consumer.
 * @param ctx - host context carrying source, filesystem, and storage owners.
 * @param config - explicit capture and complete-response bounds.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  await ctx.plugin(NativeWorkArtifacts, config).await()
  await ctx.plugin(WorkArtifactGateway).await()
}
