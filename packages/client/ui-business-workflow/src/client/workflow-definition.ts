/**
 * The durable business-workflow Conversation Definition: folds the four
 * `tool-business-workflow/*` session events into one keyed Chat node per
 * workflow record. The node's data is the projection the panel renders —
 * summary, current stage, revision, latest gaps/issues/verification — and
 * replay rebuilds it from the log alone.
 */
import type {
  ChatConversationViewNode, ConversationNodeDefinition,
} from '@deepseek-ai/dsh-client-runtime/client'
import type {
  BusinessWorkflowStage, CaseResult, ClarificationGap, CompositionIssue,
} from '@deepseek-ai/dsh-business-workflow/types'
// Declaration merge only: adds the four tool-business-workflow session events
// this Definition matches on to the client-side SessionEventMap union.
import type {} from '@deepseek-ai/dsh-tool-business-workflow/types'

/** Stage names a node carries, shared with the panel's status vocabulary. */
export type BusinessWorkflowNodeStatus = Extract<BusinessWorkflowStage, 'clarifying' | 'composed' | 'verified'>

/** Final renderer data for one business-workflow record. */
export interface BusinessWorkflowChatData {
  readonly workflowId: string
  readonly summary: string
  /** The record's exact stage; the header action switches the next click step on it. */
  readonly stage: BusinessWorkflowStage
  readonly status: BusinessWorkflowNodeStatus
  /** The latest judged submission's 1-based revision. */
  readonly revision: number
  /** The latest clarification gaps; empty once the requirement is complete. */
  readonly gaps: readonly ClarificationGap[]
  /** The latest composition verdict's issues; empty when accepted or none yet. */
  readonly issues: readonly CompositionIssue[]
  /** The accepted composition's step count; `0` before one is accepted. */
  readonly stepCount: number
  /** The latest verification report; absent before one ran. */
  readonly verification?: {
    readonly passed: boolean
    readonly caseCount: number
    readonly dryRun: boolean
    readonly cases: readonly CaseResult[]
  }
}

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ChatNodeDataMap {
    /** Durable business-workflow record: requirement, stage, and verification. */
    'business-workflow': BusinessWorkflowChatData
  }
}

/** Incremental fold state for one workflow record. */
interface WorkflowState {
  readonly workflowId: string
  readonly summary: string
  readonly stage: BusinessWorkflowStage
  readonly status: BusinessWorkflowNodeStatus
  readonly revision: number
  readonly gaps: readonly ClarificationGap[]
  readonly issues: readonly CompositionIssue[]
  readonly stepCount: number
  readonly verification?: BusinessWorkflowChatData['verification']
}

/** Map a record's stage onto the three node statuses (`ready` reads as composed-eligible). */
function nodeStatus(stage: BusinessWorkflowStage): BusinessWorkflowNodeStatus {
  return stage === 'ready' ? 'composed' : stage
}

/** Durable business-workflow event family folded into one keyed Chat node. */
export const businessWorkflowDefinition: ConversationNodeDefinition<WorkflowState> = {
  kind: 'business-workflow',
  target: 'chat',
  match: (event) => {
    if (event.type === 'tool-business-workflow/start') return { id: String(event.data.workflowId), role: 'start' }
    if (event.type === 'tool-business-workflow/clarified'
      || event.type === 'tool-business-workflow/composed'
      || event.type === 'tool-business-workflow/verified') {
      return { id: String(event.data.workflowId), role: 'update' }
    }
    return null
  },
  start: (_context, match) => {
    if (match.event.type !== 'tool-business-workflow/start') {
      throw new Error('business-workflow start requires tool-business-workflow/start')
    }
    const data = match.event.data
    return {
      workflowId: String(data.workflowId),
      summary: data.summary,
      stage: data.stage,
      status: nodeStatus(data.stage),
      revision: data.revision,
      gaps: [],
      issues: [],
      stepCount: 0,
    }
  },
  update: (context, match) => {
    const state = context.state
    if (match.event.type === 'tool-business-workflow/clarified') {
      const data = match.event.data
      return { ...state, stage: data.stage, status: nodeStatus(data.stage), revision: data.revision, gaps: data.gaps }
    }
    if (match.event.type === 'tool-business-workflow/composed') {
      const data = match.event.data
      return {
        ...state,
        stage: data.stage,
        status: nodeStatus(data.stage),
        issues: data.issues,
        stepCount: data.stepCount,
        // A re-composition after a requirement revision invalidates the prior report.
        verification: data.stepCount > 0 ? undefined : state.verification,
      }
    }
    if (match.event.type === 'tool-business-workflow/verified') {
      const data = match.event.data
      return {
        ...state,
        stage: data.stage,
        status: nodeStatus(data.stage),
        verification: {
          passed: data.summary.passed,
          caseCount: data.summary.caseCount,
          dryRun: data.summary.dryRun,
          cases: data.cases,
        },
      }
    }
    return state
  },
  buildViewNode: (context): ChatConversationViewNode | null => {
    const state = context.state
    if (context.start === undefined || state === undefined) return null
    const data: BusinessWorkflowChatData = {
      workflowId: state.workflowId,
      summary: state.summary,
      stage: state.stage,
      status: state.status,
      revision: state.revision,
      gaps: state.gaps,
      issues: state.issues,
      stepCount: state.stepCount,
      ...state.verification !== undefined ? { verification: state.verification } : {},
    }
    return {
      key: context.key,
      kind: 'business-workflow',
      id: context.id,
      target: 'chat',
      anchorSeq: context.start.event.seq,
      location: context.start.location,
      visibility: 'visible',
      data,
    }
  },
}
