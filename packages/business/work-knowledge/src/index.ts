/** Explicit source grants and immutable local text indexing over filesystem/storage providers. */
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import type { FsTarget } from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-workspace'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import { WorkKnowledge } from './service.ts'
import { WorkKnowledgeGateway } from './gateway.ts'
import { knowledgeDomain, textDigest, type StoredKnowledgeSource, type StoredKnowledgeVersion } from './schema.ts'
import { retrieveLines, type SearchCapture } from './retrieval.ts'
import type { KnowledgeCitation, KnowledgeExcerpt, KnowledgeFreshness, KnowledgeIndexRequest, KnowledgeIndexResult, KnowledgeRegistration, KnowledgeSearch, KnowledgeSearchResult, KnowledgeSource, KnowledgeSourceId, KnowledgeVersion } from './types.ts'
export type * from './types.ts'
export { WorkKnowledge } from './service.ts'
/** Complete retained and emitted values reject at deployment-selected limits. */
export interface Config {
  /** Maximum registered file grants across all workspaces. */
  maxSources: number
  /** Maximum successful immutable captures per source; no automatic eviction. */
  maxVersions: number
  /** Inclusive decoded-text UTF-8 bound per complete file read. */
  maxFileBytes: number
  /** Inclusive UTF-8 bound on one complete retained source. */
  maxRecordBytes: number
  /** Inclusive UTF-8 bound on all complete retained sources. */
  maxTotalBytes: number
  /** Inclusive UTF-8 bound on each complete response. */
  maxResponseBytes: number
  /** Inclusive UTF-8 bound on one literal query. */
  maxQueryBytes: number
  /** Maximum exact line hits in one response. */
  maxHits: number
}
/** One filesystem execution world, workspace authority, and durable source owner. */
export const inject = ['fs', 'workspaceRegistry', 'storageDomain']
/** Bounds keep explicit per-file indexing and complete corpus responses finite. */
export const Config: z<Config> = z.object({
  maxSources: z.number().step(1).min(1).default(64), maxVersions: z.number().step(1).min(1).default(20),
  maxFileBytes: z.number().step(1).min(1).default(131072), maxRecordBytes: z.number().step(1).min(1).default(4194304),
  maxTotalBytes: z.number().step(1).min(1).default(16777216), maxResponseBytes: z.number().step(1).min(1).default(1048576),
  maxQueryBytes: z.number().step(1).min(1).default(512), maxHits: z.number().step(1).min(1).default(50),
})
const message = (error: unknown) => error instanceof Error ? error.message : String(error)
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value))
const versionInfo = (
  { text: _text, requestId: _requestId, expectedRevision: _revision, ...value }: StoredKnowledgeVersion,
): KnowledgeVersion => value
function metadata(source: StoredKnowledgeSource): KnowledgeSource {
  const { rootKey: _root, targetKey: _target, lastAttempt, versions, ...value } = source
  return { ...value, versions: versions.map(versionInfo), ...(lastAttempt === undefined ? {} : { lastAttempt: lastAttempt.state === 'ready'
    ? { state: 'ready', completedAt: lastAttempt.completedAt, version: lastAttempt.version }
    : { state: 'failed', completedAt: lastAttempt.completedAt, message: lastAttempt.message } }) }
}
/** Serialized operations linearize grant changes and drain before their storage domain closes. */
export class LocalWorkKnowledge extends WorkKnowledge {
  static inject = inject
  static Config = Config
  private domain!: Domain<typeof knowledgeDomain>
  private tail: Promise<void> = Promise.resolve()
  private closing = false
  private readonly owner: Context
  constructor(ctx: Context, private readonly config: Config) { super(ctx); this.owner = ctx }
  protected async [Service.init](): Promise<void> {
    this.domain = await this.owner.storageDomain.open(knowledgeDomain)
    this.owner.effect(() => async () => { this.closing = true; await this.tail; await this.domain.close() }, 'knowledge: drain file reads and close storage')
  }
  private queue<T>(action: () => Promise<T> | T): Promise<T> {
    if (this.closing) return Promise.reject(new Error('Knowledge service is unloading.'))
    const result = this.tail.then(action)
    this.tail = result.then(() => {}, () => {})
    return result
  }
  private checked<T>(result: T): T {
    if (bytes(result) > this.config.maxResponseBytes) throw new Error('Knowledge response exceeds maxResponseBytes. Select fewer hits or lines.')
    return structuredClone(result)
  }
  private all(): StoredKnowledgeSource[] { return [...this.domain.table('sources').entries()].map(([, value]) => value) }
  private source(id: KnowledgeSourceId): StoredKnowledgeSource {
    const source = this.domain.table('sources').get(id)
    if (source === undefined) throw new Error('Unknown knowledge source.')
    return source
  }
  private revision(source: StoredKnowledgeSource, expected: number): void {
    if (source.revision !== expected) throw new Error('Knowledge source revision changed. Refresh before continuing.')
  }
  private async commit(source: StoredKnowledgeSource): Promise<KnowledgeSource> {
    if (bytes(source) > this.config.maxRecordBytes) throw new Error('Knowledge history exceeds maxRecordBytes.')
    const total = this.all().filter(value => value.id !== source.id).reduce((size, value) => size + bytes(value), bytes(source))
    if (total > this.config.maxTotalBytes) throw new Error('Knowledge corpus exceeds maxTotalBytes.')
    const result = this.checked(metadata(source))
    await this.domain.table('sources').put(source.id, source)
    return result
  }
  options() { return this.checked({ maxSources: this.config.maxSources, maxVersions: this.config.maxVersions,
    maxFileBytes: this.config.maxFileBytes, maxQueryBytes: this.config.maxQueryBytes, maxHits: this.config.maxHits }) }
  sources(workspaceId: WorkspaceId): Promise<KnowledgeSource[]> {
    return this.queue(() => this.checked(this.all().filter(value => value.workspaceId === workspaceId)
      .sort((a, b) => a.id.localeCompare(b.id)).map(metadata)))
  }
  register(request: KnowledgeRegistration): Promise<KnowledgeSource> {
    const owned = structuredClone(request)
    return this.queue(async () => {
      const existing = this.domain.table('sources').get(owned.id)
      if (existing !== undefined) {
        if (existing.workspaceId !== owned.workspaceId || existing.path !== owned.path) throw new Error('Knowledge source identity belongs to another file grant.')
        return this.checked(metadata(existing))
      }
      if (this.all().length >= this.config.maxSources) throw new Error('Knowledge source capacity reached.')
      if (owned.path.trim() === '' || /^[\\/]|^[a-z]:/i.test(owned.path)) throw new Error('Select a nonempty workspace-relative knowledge path.')
      const workspace = this.owner.workspaceRegistry.get(owned.workspaceId)
      if (workspace === undefined) throw new Error('Knowledge workspace is unavailable.')
      const { root, target } = await this.resolve(workspace.path, owned.path)
      const stat = await this.owner.fs.stat(target)
      if (stat?.type !== 'file') throw new Error('Knowledge source must be an existing regular file.')
      if (this.all().some(value => value.workspaceId === owned.workspaceId && value.targetKey === target.targetKey))
        throw new Error('This knowledge target is already registered in the workspace.')
      return this.commit({ ...owned, workspacePath: workspace.path, rootKey: root.targetKey, targetKey: target.targetKey,
        enabled: true, revision: 1, versions: [] })
    })
  }
  setEnabled(request: { id: KnowledgeSourceId; expectedRevision: number; enabled: boolean }): Promise<KnowledgeSource> {
    const owned = { ...request }
    return this.queue(async () => {
      const source = this.source(owned.id)
      this.revision(source, owned.expectedRevision)
      if (source.enabled === owned.enabled) return this.checked(metadata(source))
      return this.commit({ ...source, enabled: owned.enabled, revision: source.revision + 1 })
    })
  }
  private async resolve(cwd: string, path: string): Promise<{ root: FsTarget; target: FsTarget }> {
    const root = await this.owner.fs.resolve('.', { cwd }), target = await this.owner.fs.resolve(path, { cwd })
    if (!this.owner.fs.contains(root, target)) throw new Error('Knowledge path is outside the original workspace.')
    return { root, target }
  }
  private async currentText(source: StoredKnowledgeSource): Promise<string> {
    if (!source.enabled) throw new Error('Knowledge source is disabled.')
    const workspace = this.owner.workspaceRegistry.get(source.workspaceId)
    if (workspace?.path !== source.workspacePath) throw new Error('Original knowledge workspace is unavailable.')
    const { root, target } = await this.resolve(workspace.path, source.path)
    if (root.targetKey !== source.rootKey || target.targetKey !== source.targetKey) throw new Error('Knowledge filesystem target changed. Register the new target explicitly.')
    const before = await this.owner.fs.stat(target)
    if (before?.type !== 'file') throw new Error('Knowledge file is missing or is not a regular file.')
    if (before.size !== undefined && before.size > this.config.maxFileBytes) throw new Error('Knowledge file exceeds maxFileBytes.')
    let text = '', size = 0
    for await (const chunk of await this.owner.fs.streamText(target)) {
      size += Buffer.byteLength(chunk)
      if (size > this.config.maxFileBytes) throw new Error('Knowledge text exceeds maxFileBytes.')
      text += chunk
    }
    const after = await this.owner.fs.stat(target)
    if (after?.version !== before.version) throw new Error('Knowledge file changed during the read. Retry explicitly.')
    return text
  }
  index(request: KnowledgeIndexRequest): Promise<KnowledgeIndexResult> {
    const owned = { ...request }
    return this.queue(async () => {
      const source = this.source(owned.id)
      // A revoked grant cannot be bypassed by replaying a previous successful attempt.
      if (!source.enabled) throw new Error('Knowledge source is disabled.')
      const prior = source.versions.find(value => value.requestId === owned.requestId)
      if (prior !== undefined) {
        if (prior.expectedRevision !== owned.expectedRevision) throw new Error('Knowledge indexing identity belongs to another revision.')
        return this.checked({ source: metadata(source), attempt: { state: 'ready', completedAt: prior.capturedAt, version: prior.version } })
      }
      const last = source.lastAttempt
      if (last?.state === 'failed' && last.requestId === owned.requestId) {
        if (last.expectedRevision !== owned.expectedRevision) throw new Error('Knowledge indexing identity belongs to another revision.')
        return this.checked({ source: metadata(source), attempt: { state: 'failed', completedAt: last.completedAt, message: last.message } })
      }
      this.revision(source, owned.expectedRevision)
      if (source.versions.length >= this.config.maxVersions) throw new Error('Knowledge version capacity reached.')
      const next = { ...source, revision: source.revision + 1 }
      let text: string
      try { text = await this.currentText(source) }
      catch (error) {
        const attempt = { state: 'failed' as const, message: message(error), completedAt: Date.now() }
        const record = { ...next, lastAttempt: { ...attempt, requestId: owned.requestId, expectedRevision: owned.expectedRevision } }
        const result = this.checked({ source: metadata(record), attempt })
        await this.commit(record)
        return result
      }
      const version = source.versions.length + 1, completedAt = Date.now()
      const record: StoredKnowledgeSource = { ...next, versions: [...source.versions, { version, capturedAt: completedAt,
        textSha256: textDigest(text), bytes: Buffer.byteLength(text), lines: text.split('\n').length, text,
        requestId: owned.requestId, expectedRevision: owned.expectedRevision }],
      lastAttempt: { state: 'ready', version, completedAt, requestId: owned.requestId, expectedRevision: owned.expectedRevision } }
      const result = this.checked({ source: metadata(record), attempt: { state: 'ready' as const, version, completedAt } })
      await this.commit(record)
      return result
    })
  }
  private freshness(source: StoredKnowledgeSource, capture: StoredKnowledgeVersion, text: string): KnowledgeFreshness {
    const textSha256 = textDigest(text)
    return { sourceId: source.id, state: textSha256 === capture.textSha256 ? 'matching' : 'different', textSha256, observedAt: Date.now() }
  }
  search(request: KnowledgeSearch): Promise<KnowledgeSearchResult> {
    const owned = { ...request }
    return this.queue(async () => {
      if (!Number.isSafeInteger(owned.limit) || owned.limit < 1 || owned.limit > this.config.maxHits) throw new Error('Knowledge hit limit is outside maxHits.')
      const query = owned.text.trim().toLowerCase()
      if (query === '' || query.includes('\0') || Buffer.byteLength(owned.text) > this.config.maxQueryBytes || Buffer.byteLength(query) > this.config.maxQueryBytes) throw new Error('Knowledge query must be nonempty, contain no NUL, and fit maxQueryBytes.')
      const ready: SearchCapture[] = [], current: KnowledgeFreshness[] = [], excluded: KnowledgeSearchResult['excluded'] = []
      for (const source of this.all().filter(value => value.workspaceId === owned.workspaceId && value.enabled)) {
        const capture = source.versions.at(-1)
        if (capture === undefined) { excluded.push({ sourceId: source.id, message: 'Knowledge source has no successful capture.' }); continue }
        try { current.push(this.freshness(source, capture, await this.currentText(source))); ready.push({ source, capture }) }
        catch (error) { excluded.push({ sourceId: source.id, message: message(error) }) }
      }
      const result = ready.length === 0 ? { hits: [], more: false } : await retrieveLines(ready, query, owned.limit)
      return this.checked({ ...result, current, excluded, observedAt: Date.now() })
    })
  }
  read(workspaceId: WorkspaceId, citation: KnowledgeCitation): Promise<KnowledgeExcerpt> {
    const owned = { ...citation }
    return this.queue(async () => {
      const source = this.source(owned.sourceId)
      if (source.workspaceId !== workspaceId) throw new Error('Knowledge citation belongs to another workspace.')
      const capture = source.versions.find(value => value.version === owned.version)
      if (capture === undefined || capture.textSha256 !== owned.textSha256) throw new Error('Knowledge citation version or text digest is invalid.')
      if (!Number.isSafeInteger(owned.startLine) || !Number.isSafeInteger(owned.endLine) || owned.startLine < 1
        || owned.endLine < owned.startLine || owned.endLine > capture.lines) throw new Error('Knowledge citation line range is invalid.')
      const current = this.freshness(source, capture, await this.currentText(source))
      return this.checked({ citation: owned, path: source.path, text: capture.text.split('\n').slice(owned.startLine - 1, owned.endLine).join('\n'), current })
    })
  }
}
/**
 * Mount explicit text sources and the typed knowledge gateway; no files are indexed at startup.
 * @param ctx - host filesystem, workspace, and storage owners.
 * @param config - deployment bounds for complete records and responses.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  await ctx.plugin(LocalWorkKnowledge, config).await()
  await ctx.plugin(WorkKnowledgeGateway).await()
}
