/** Host-qualified remote admission vocabulary; native execution remains owned by the receiving deployment. */
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials/types'
import type { AgentCommand } from '@deepseek-ai/dsh-workbench-agent/types'
import type { WorkflowCommand, WorkflowAttemptId, WorkflowId, WorkflowVersionId } from '@deepseek-ai/dsh-business-workflow/workbench-types'
import type { WorkReference, WorkSource } from '@deepseek-ai/dsh-work-center/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
/** Configured local peer identity, independent of a machine-directory entry. */
export type RemotePeerId = Branded<'RemotePeerId'>
/** Receiver identity fixed in its configuration and durable domain. */
export type RemoteHostId = Branded<'RemoteHostId'>
/** Receiver-owned authorization principal. */
export type RemotePrincipalId = Branded<'RemotePrincipalId'>
/** Caller-owned UUID scoped by the receiving Host and principal. */
export type RemoteSubmissionId = Branded<'RemoteSubmissionId'>
/** Fixed native input, excluding credentials, generation, and verification operations. */
export type RemoteTarget =
  | ({ kind: 'agent' } & Pick<Extract<AgentCommand, { kind: 'submit-task' }>, 'id' | 'workspaceId' | 'expectedRevision' | 'brief'>)
  | ({ kind: 'workflow'; workspaceId: WorkspaceId } & Pick<Extract<WorkflowCommand, { kind: 'start' }>, 'id' | 'versionId' | 'inputs'>)
/** Explicit machine operations; uncertain controls require a fresh read before another decision. */
export type RemoteOperation =
  | { kind: 'catalog' }
  | { kind: 'list'; workspaceId?: WorkspaceId }
  | { kind: 'submit'; id: RemoteSubmissionId; target: RemoteTarget }
  | { kind: 'inspect'; id: RemoteSubmissionId }
  | { kind: 'recover'; id: RemoteSubmissionId; expectedAttempt: number }
  | { kind: 'stop'; id: RemoteSubmissionId }
  | { kind: 'decide'; id: RemoteSubmissionId; attemptId: WorkflowAttemptId; approve: boolean }
/** Calling input freezes remote authority even if a configured peer id is reassigned. */
export interface RemoteCallRequest {
  peer: RemotePeerId
  expected: { hostId: RemoteHostId; principalId: RemotePrincipalId }
  operation: RemoteOperation
}
/** Native identity and admission do not establish execution success or human acceptance. */
export interface RemoteSubmission {
  id: RemoteSubmissionId
  hostId: RemoteHostId
  principalId: RemotePrincipalId
  createdAt: number
  attempts: number
  target: RemoteTarget
  admission: { state: 'unconfirmed' } | { state: 'admitted'; ref: WorkReference }
}
/** Directory rows omit task content and workflow inputs. */
export type RemoteSubmissionSummary = Omit<RemoteSubmission, 'target'> & { target: Pick<RemoteTarget, 'kind' | 'id' | 'workspaceId'> }
/** Only explicitly authorized workspace/executor combinations are advertised. */
export interface RemoteCatalog {
  credentialOwner: 'remote-host'
  controls: { stop: boolean; workflowDecisions: boolean }
  workspaces: {
    id: WorkspaceId
    title: string
    path: string
    agents: {
      id: Extract<RemoteTarget, { kind: 'agent' }>['id']
      name: string
      revision: number
      runtime: string
      skills: string[]
      mcpServerNames: string[]
      archived: boolean
    }[]
    workflows: {
      id: WorkflowId
      name: string
      archived: boolean
      versions: { id: WorkflowVersionId; number: number; inputs: { name: string; description: string }[] }[]
    }[]
  }[]
}
/** Recorded text may cross the protocol; paths and file bytes remain remote. */
export type RemoteWorkResult =
  | { kind: 'catalog'; catalog: RemoteCatalog; observedAt: number }
  | { kind: 'list'; items: RemoteSubmissionSummary[]; observedAt: number }
  | { kind: 'submission'; submission: RemoteSubmissionSummary }
  | {
    kind: 'inspection'
    submission: RemoteSubmission
    observedAt: number
    source?: WorkSource
    delivery?: { outputs: { name: string; text: string }[]; evidence: 'recorded-response' | 'recorded-workflow-output' }
    decisions?: {
      attemptId: WorkflowAttemptId
      title: string
      instruction: string
      inputs: Extract<RemoteTarget, { kind: 'workflow' }>['inputs']
    }[]
    decisionsUnavailable?: true
    unavailable?: true
  }
  | { kind: 'controlled'; id: RemoteSubmissionId }
/** A machine must verify both intended receiver and intended principal before mutation. */
export interface RemoteEnvelope { version: 1; hostId: RemoteHostId; principalId: RemotePrincipalId; operation: RemoteOperation }
/** Successful responses repeat authenticated identity as well as their discriminated result. */
export interface RemoteReply { version: 1; hostId: RemoteHostId; principalId: RemotePrincipalId; result: RemoteWorkResult }
/** Browser-safe peer configuration and transport-credential presence only. */
export interface RemotePeer {
  id: RemotePeerId
  name: string
  origin: string
  hostId: RemoteHostId
  principalId: RemotePrincipalId
  authorization: { reference: CredentialRef; configured: boolean; owner: 'local-host' }
  executionCredentialOwner: 'remote-host'
}
