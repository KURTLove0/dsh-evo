/** Bounded private template histories; execution remains with source owners. */
import { createHash, randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import { taskBriefSchema } from '@deepseek-ai/dsh-workbench-agent/brief'
import type {} from '@deepseek-ai/dsh-business-workflow/workbench'
import { WorkTemplates } from './service.ts'
import { WorkTemplateGateway } from './gateway.ts'
import { templateDomain, type StoredTemplate } from './schema.ts'
import type { TemplateContent, TemplateCopyRequest, TemplateMutation, TemplateReceipt, TemplateRecord, TemplateSummary, TemplateVersion, WorkTemplateId } from './types.ts'

export type * from './types.ts'
export { WorkTemplates } from './service.ts'
/** Deployment bounds for retained template content. */
export interface Config {
  /** Inclusive directory record cap. */
  maxTemplates: number
  /** Inclusive immutable content version cap per template. */
  maxVersions: number
  /** Inclusive serialized record byte cap, including idempotency receipts. */
  maxRecordBytes: number
}
/** Required storage and immutable workflow owner. */
export const inject = ['storageDomain', 'workflowWorkbench']
/** Template history capacities. */
export const Config: z<Config> = z.object({
  maxTemplates: z.number().step(1).min(1).default(200),
  maxVersions: z.number().step(1).min(1).default(50),
  maxRecordBytes: z.number().step(1).min(1024).default(1_048_576),
})
/** Serializes compare-and-set edits and drains them before closing storage. */
export class NativeWorkTemplates extends WorkTemplates {
  static inject = inject
  static Config = Config
  private domain!: Domain<typeof templateDomain>
  private tail: Promise<void> = Promise.resolve()
  private closing = false
  private readonly owner: Context
  constructor(ctx: Context, private readonly config: Config) { super(ctx); this.owner = ctx }
  protected async [Service.init](): Promise<void> {
    this.domain = await this.owner.storageDomain.open(templateDomain)
    this.owner.effect(() => async () => { this.closing = true; await this.tail; await this.domain.close() }, 'templates: drain edits and close storage')
  }
  private queue<T>(action: () => T | Promise<T>): Promise<T> {
    if (this.closing) return Promise.reject(new Error('Template service is unloading.'))
    const result = this.tail.then(action)
    this.tail = result.then(() => {}, () => {})
    return result
  }
  private record(id: WorkTemplateId): StoredTemplate {
    const value = this.domain.table('templates').get(id)
    if (value === undefined) throw new Error('Unknown template.')
    return value
  }
  list(): Promise<TemplateSummary[]> {
    return this.queue(() => [...this.domain.table('templates').entries()].map(([, record]) => {
      const current = record.versions[record.versions.length - 1] as TemplateVersion
      return { id: record.id, revision: record.revision, archived: record.archived, name: current.name,
        kind: current.content.kind, version: current.version }
    }))
  }
  read(id: WorkTemplateId): Promise<TemplateRecord> {
    return this.queue(() => { const { requests: _requests, ...record } = this.record(id); return structuredClone(record) })
  }
  sources() {
    return this.queue(async () => (await this.owner.workflowWorkbench.snapshot()).workflows.filter(item => item.versions.length > 0)
      .map(({ id, name, versions }) => ({ id, name, versions: versions.map(version => ({ id: version.id, number: version.number })) })))
  }
  examples(): ReturnType<WorkTemplates['examples']> {
    return [
      { id: 'code-review', brief: { version: 1, goal: '审查指定代码改动，按风险列出问题与证据。', background: '填写代码路径或差异范围。', deliverables: [],
        acceptanceCriteria: ['每个问题包含文件位置、触发条件和影响', '区分已验证问题与待确认风险'], constraints: '只读审查，不修改代码，不提交或推送。' } },
      { id: 'documents', brief: { version: 1, goal: '根据指定资料整理说明文档。', background: '填写资料路径、读者和需要回答的问题。', deliverables: [],
        acceptanceCriteria: ['说明依据并标注资料来源', '列出缺失或相互矛盾的信息'], constraints: '只使用指定资料，不发布或发送文档。' } },
      { id: 'data-report', brief: { version: 1, goal: '分析指定 CSV 或 JSON 文件并形成报告。', background: '填写文件路径、字段说明及分析问题。', deliverables: [],
        acceptanceCriteria: ['说明数据范围、缺失值和计算方法', '给出可复核的结果及限制'], constraints: '只读本地数据，不修改源文件，不连接外部数据源。' } },
    ]
  }
  command(request: TemplateMutation): Promise<TemplateReceipt> {
    return this.queue(async () => {
      if (request.requestId === '') throw new Error('Template request ID must be nonempty.')
      const intent = request.kind === 'save-task'
        ? { kind: request.kind, id: request.id, expectedRevision: request.expectedRevision, name: request.name.trim(),
          brief: taskBriefSchema.parse(request.brief) }
        : request.kind === 'save-workflow'
          ? { kind: request.kind, id: request.id, expectedRevision: request.expectedRevision, name: request.name.trim(),
            workflowId: request.workflowId, versionId: request.versionId }
          : { kind: request.kind, id: request.id, expectedRevision: request.expectedRevision, archived: request.archived }
      const hash = createHash('sha256').update(JSON.stringify(intent)).digest('hex')
      for (const [, record] of this.domain.table('templates').entries()) {
        const repeated = record.requests.find(value => value.id === request.requestId)
        if (repeated !== undefined) {
          if (repeated.hash !== hash) throw new Error('This request ID belongs to another template edit.')
          return { id: record.id, revision: repeated.revision, version: repeated.version }
        }
      }
      const current = request.id === undefined ? undefined : this.record(request.id)
      if ((current?.revision ?? 0) !== request.expectedRevision) throw new Error('Template changed. Reload before editing.')
      if (current === undefined && this.domain.table('templates').size >= this.config.maxTemplates) throw new Error('Template capacity reached.')
      if (current?.archived && request.kind !== 'archive') throw new Error('Restore the template before saving a new version.')
      let content: TemplateContent | undefined
      if (request.kind === 'save-task') content = { kind: 'task', brief: taskBriefSchema.parse(request.brief) }
      if (request.kind === 'save-workflow') {
        const snapshot = await this.owner.workflowWorkbench.snapshot(request.workflowId)
        const source = snapshot.workflows.find(value => value.id === request.workflowId)
        const version = source?.versions.find(value => value.id === request.versionId)
        if (version === undefined) throw new Error('Unknown workflow publication.')
        content = { kind: 'workflow', workflowId: request.workflowId, versionId: version.id,
          definition: structuredClone(version.definition) }
      }
      const versions = current === undefined ? [] : [...current.versions]
      if (content !== undefined && request.kind !== 'archive') {
        if (request.name.trim() === '') throw new Error('A template name is required.')
        if (versions.length >= this.config.maxVersions) throw new Error('Template version capacity reached.')
        if (versions.length > 0 && versions[0]?.content.kind !== content.kind) throw new Error('Template kind cannot change.')
        versions.push({ version: versions.length + 1, createdAt: Date.now(), name: request.name.trim(), content })
      }
      const id = current?.id ?? randomUUID() as WorkTemplateId
      const version = versions.length
      const revision = (current?.revision ?? 0) + 1
      const record: StoredTemplate = { id, revision, archived: request.kind === 'archive' ? request.archived : false, versions,
        requests: [...(current?.requests ?? []), { id: request.requestId, hash, revision, version }] }
      if (Buffer.byteLength(JSON.stringify(record)) > this.config.maxRecordBytes) throw new Error('Template history exceeds maxRecordBytes.')
      await this.domain.table('templates').put(id, record)
      for (const listener of this.owner.events.dispatch('emit', ['work-template/changed', id])) {
        try { void Promise.resolve(listener(id)).catch((error: unknown) => { this.owner.logger.warn('Template listener failed: %s', error) }) }
        catch (error) { this.owner.logger.warn('Template listener failed: %s', error) }
      }
      return { id, revision, version }
    })
  }
  copyWorkflow(request: TemplateCopyRequest) {
    return this.queue(async () => {
      const record = this.record(request.id)
      const version = record.versions.find(value => value.version === request.version)
      if (record.archived) throw new Error('Restore the template before creating a copy.')
      if (version?.content.kind !== 'workflow') throw new Error('Select a saved workflow template version.')
      return this.owner.workflowWorkbench.command({ kind: 'copy', id: version.content.workflowId, versionId: version.content.versionId,
        workspaceId: request.workspaceId, name: request.name, requestId: request.requestId,
        template: { id: record.id, version: version.version } })
    })
  }
}
/**
 * Mount private template storage and its generated Remote consumer.
 * @param ctx - host composition context.
 * @param config - deployment content and history capacities.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  await ctx.plugin(NativeWorkTemplates, config).await()
  await ctx.plugin(WorkTemplateGateway).await()
}
