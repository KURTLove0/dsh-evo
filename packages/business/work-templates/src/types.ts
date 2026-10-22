/** Versioned private templates and explicit copy requests. */
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { TaskBrief } from '@deepseek-ai/dsh-workbench-agent/types'
import type { WorkflowId, WorkflowVersionId, WorkflowDefinition, WorkflowRequestId } from '@deepseek-ai/dsh-business-workflow/workbench-types'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'

/** Durable private template identity. */
export type WorkTemplateId = Branded<'WorkTemplateId'>
/** Idempotent template mutation identity. */
export type TemplateRequestId = Branded<'TemplateRequestId'>
/** Task content or a complete immutable workflow publication, without executor credentials. */
export type TemplateContent =
  | { kind: 'task'; brief: TaskBrief }
  | { kind: 'workflow'; workflowId: WorkflowId; versionId: WorkflowVersionId; definition: WorkflowDefinition }
/** One immutable saved name and content snapshot. */
export interface TemplateVersion {
  version: number
  createdAt: number
  name: string
  content: TemplateContent
}
/** A bounded version history; revision includes archive and restore decisions. */
export interface TemplateRecord {
  id: WorkTemplateId
  revision: number
  archived: boolean
  versions: TemplateVersion[]
}
/** Directory rows omit complete task text and workflow graphs. */
export interface TemplateSummary {
  id: WorkTemplateId
  revision: number
  archived: boolean
  name: string
  kind: TemplateContent['kind']
  version: number
}
/** Revisioned writes do not submit or run any task. */
export type TemplateMutation =
  | { kind: 'save-task'; id?: WorkTemplateId; expectedRevision: number; requestId: TemplateRequestId; name: string; brief: TaskBrief }
  | { kind: 'save-workflow'; id?: WorkTemplateId; expectedRevision: number; requestId: TemplateRequestId; name: string; workflowId: WorkflowId; versionId: WorkflowVersionId }
  | { kind: 'archive'; id: WorkTemplateId; expectedRevision: number; requestId: TemplateRequestId; archived: boolean }
/** A receipt identifies the committed edit and content version. */
export interface TemplateReceipt { id: WorkTemplateId; revision: number; version: number }
/** Explicitly create a draft copy; publication and execution remain separate workflow commands. */
export interface TemplateCopyRequest {
  id: WorkTemplateId
  version: number
  workspaceId: WorkspaceId
  name: string
  requestId: WorkflowRequestId
}
/** Editable starter content without an executor assignment. */
export interface TemplateExample { id: 'code-review' | 'documents' | 'data-report'; brief: TaskBrief }
/** Published workflow choices contain no execution inputs, secrets, or live runs. */
export interface TemplateWorkflowSource {
  id: WorkflowId
  name: string
  versions: { id: WorkflowVersionId; number: number }[]
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * A template mutation has committed.
     * @mode emit
     * @param id - template whose content or archive state changed.
     */
    'work-template/changed'(id: WorkTemplateId): void
  }
}
