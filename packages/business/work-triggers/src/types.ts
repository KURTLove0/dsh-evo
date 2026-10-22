/** Durable host triggers keep admission, execution observations, and notification read state independent. */
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { TaskBrief, WorkbenchAgentId } from '@deepseek-ai/dsh-workbench-agent/types'
import type { WorkflowId, WorkflowVersionId } from '@deepseek-ai/dsh-business-workflow/workbench-types'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import type { JsonValue } from '@deepseek-ai/dsh-session/types'
import type { WorkReference, WorkSource } from '@deepseek-ai/dsh-work-center/types'
/** Caller-owned UUID makes creation recoverable independently of control edits. */
export type WorkTriggerId = Branded<'WorkTriggerId'>
/** One reserved native submission, including explicit acknowledgment recovery attempts. */
export type TriggerOccurrenceId = Branded<'TriggerOccurrenceId'>
/** A retained in-app notice has its own idempotent read acknowledgment. */
export type TriggerNoticeId = Branded<'TriggerNoticeId'>
/** Time values are UTC epoch milliseconds; settlement watches one exact original execution. */
export type TriggerRule =
  | { kind: 'at'; at: number }
  | { kind: 'every'; firstAt: number; intervalMs: number }
  | { kind: 'on-settled'; source: WorkReference }
/** Targets contain task content and native revision/publication references, never captured executor credentials. */
export type TriggerTarget =
  | { kind: 'agent'; id: WorkbenchAgentId; workspaceId: WorkspaceId; expectedRevision: number; brief: TaskBrief }
  | { kind: 'workflow'; id: WorkflowId; workspaceId: WorkspaceId; versionId: WorkflowVersionId; inputs: Record<string, JsonValue> }
/** A definition is immutable; changing its rule or target requires a new trigger. */
export interface TriggerDefinition { name: string; rule: TriggerRule; target: TriggerTarget }
/** Terminal outcomes remain distinct; success does not imply human acceptance. */
export type TriggerTerminalStatus = Extract<WorkSource['status'], 'completed' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted'>
/** Last durably retained source read; this is not the source execution's settlement timestamp. */
export interface TriggerObservation { status: WorkSource['status']; observedAt: number }
/** Handoff uncertainty does not establish whether a native run exists. */
export type TriggerAdmission =
  | { state: 'pending'; lastAttemptAt?: number }
  | { state: 'unconfirmed'; lastAttemptAt: number }
  | { state: 'admitted'; ref: WorkReference; acceptedAt: number; observation?: TriggerObservation; unavailableAt?: number }
  | { state: 'settled'; ref: WorkReference; acceptedAt: number; observation: { status: TriggerTerminalStatus; observedAt: number } }
/** Notices retain historical facts even after an uncertain admission is recovered. */
export type TriggerNotice = { id: TriggerNoticeId; createdAt: number; readAt?: number } & (
  | { kind: 'admission-unconfirmed' }
  | { kind: 'settled'; status: TriggerTerminalStatus }
)
/** One reserved occurrence retains its nominal due time, coalescing, attempts, and notices. */
export interface TriggerOccurrence {
  id: TriggerOccurrenceId
  /** Nominal clock target; settlement rules use the first observed eligible time. */
  dueAt: number
  claimedAt: number
  skippedIntervals: number
  attempts: number
  admission: TriggerAdmission
  notices: TriggerNotice[]
}
/** Pause controls future admissions; admitted native work remains owned by its execution service. */
export interface WorkTrigger {
  id: WorkTriggerId
  revision: number
  definition: TriggerDefinition
  enabled: boolean
  createdAt: number
  updatedAt: number
  nextAt?: number
  occurrences: TriggerOccurrence[]
}
/** Directory metadata excludes task text, workflow inputs, and complete histories. */
export interface TriggerSummary {
  id: WorkTriggerId
  revision: number
  name: string
  workspaceId: WorkspaceId
  target: TriggerTarget['kind']
  enabled: boolean
  status: 'paused' | 'armed' | 'consumed' | 'capacity'
  nextAt?: number
  latest?: Omit<TriggerOccurrence, 'notices'>
  unread: number
}
/** Filter before applying complete-response bounds. */
export interface TriggerQuery { text: string; workspaceId?: WorkspaceId; enabled?: boolean }
/** Worker failures are current process observations, separate from retained execution outcomes. */
export interface TriggerDirectory {
  items: TriggerSummary[]
  observedAt: number
  failures: { id: WorkTriggerId; observedAt: number; code: 'worker-step-failed' }[]
}
/** Explicit deployment limits advertised to the browser. */
export interface TriggerOptions { minIntervalMs: number; pollIntervalMs: number; maxOccurrences: number }
/** Configuration controls and handoff recovery use their own compare-and-set values. */
export type TriggerCommand =
  | { kind: 'create'; id: WorkTriggerId; definition: TriggerDefinition; enabled: boolean }
  | { kind: 'set-enabled'; id: WorkTriggerId; expectedRevision: number; enabled: boolean }
  | { kind: 'recover'; id: WorkTriggerId; occurrenceId: TriggerOccurrenceId; expectedAttempt: number }
  | { kind: 'acknowledge'; id: WorkTriggerId; noticeId: TriggerNoticeId }
/** Creation retries return revision 1 even after later pause/resume edits. */
export interface TriggerReceipt { id: WorkTriggerId; revision: number }
declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * A trigger, occurrence, or notice has committed.
     * @mode emit
     * @param id - trigger whose retained data changed.
     */
    'work-trigger/changed'(id: WorkTriggerId): void
  }
}
