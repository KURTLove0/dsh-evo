/** Remount-surviving filters and unsubmitted task fields; execution data stays in the manager. */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'
import type { WorkDetail, WorkReference, TaskBrief, WorkCommand } from '@deepseek-ai/dsh-api-remotes/client'

interface TaskFields {
  goal: string
  background: string
  deliverables: string
  criteria: string
  constraints: string
  executorId: string
  workspaceId: string
}
interface RevisionDraft {
  ref: Extract<WorkReference, { kind: 'agent' }>
  reviewRevision: number
  configuration: WorkDetail['configuration']
}
/** One explicit retry intent survives page remounts until acknowledgment or discard. */
export interface WorkRetryDraft { request: Extract<WorkCommand, { kind: 'retry-agent' | 'retry-workflow' }>; submitted: boolean }
interface ViewState {
  retry: WorkRetryDraft | null
  workspace: string
  source: 'all' | 'agent' | 'workflow'
  state: 'all' | 'active' | 'finished' | 'waiting'
  formOpen: boolean
  fields: TaskFields
  revision: RevisionDraft | null
  requestId: string | null
  template: NonNullable<TaskBrief['template']> | null
}
type ViewActions = {
  retry: (state: ViewState, request: Extract<WorkCommand, { kind: 'retry-agent' | 'retry-workflow' }>) => void
  retrySubmitted: (state: ViewState) => void
  retryClear: (state: ViewState, id?: string) => void
  filter: (state: ViewState, filters: Pick<ViewState, 'workspace' | 'source' | 'state'>) => void
  form: (state: ViewState, open: boolean) => void
  field: (state: ViewState, key: keyof TaskFields, value: string) => void
  prepare: (state: ViewState, requestId: string) => void
  clear: (state: ViewState) => void
  submitted: (state: ViewState, requestId: string) => void
  loadTemplate: (state: ViewState, brief: TaskBrief) => void
  revise: (state: ViewState, detail: WorkDetail) => void
}
const emptyFields = (): TaskFields => ({ goal: '', background: '', deliverables: '', criteria: '', constraints: '', executorId: '', workspaceId: '' })

/**
 * Declare viewing state without persisting unsubmitted material to disk.
 * @returns the framework store declaration and complete mutation actions.
 */
export function createWorkCenterViewStore(): EngineStoreHandle<ViewState, ViewActions> {
  return defineStore({
    init: (): ViewState => ({ retry: null, workspace: '', source: 'all', state: 'all', formOpen: false, fields: emptyFields(), revision: null, requestId: null, template: null }),
    actions: {
      retry: (state: ViewState, request: Extract<WorkCommand, { kind: 'retry-agent' | 'retry-workflow' }>) => { state.retry ??= { request, submitted: false } },
      retrySubmitted: (state: ViewState) => { if (state.retry !== null) state.retry.submitted = true },
      retryClear: (state: ViewState, id?: string) => { if (id === undefined || state.retry?.request.requestId === id) state.retry = null },
      filter: (state: ViewState, filters: Pick<ViewState, 'workspace' | 'source' | 'state'>) => { Object.assign(state, filters) },
      form: (state: ViewState, open: boolean) => { state.formOpen = open },
      field: (state: ViewState, key: keyof TaskFields, value: string) => { state.fields[key] = value; state.requestId = null },
      prepare: (state: ViewState, requestId: string) => { state.requestId = requestId },
      clear: (state: ViewState) => { state.fields = emptyFields(); state.template = null; state.revision = null; state.requestId = null },
      submitted: (state: ViewState, requestId: string) => {
        if (state.requestId !== requestId) return
        state.fields = emptyFields(); state.template = null; state.revision = null; state.requestId = null; state.formOpen = false; state.state = 'all'; state.source = 'all'
      },
      loadTemplate: (state: ViewState, brief: TaskBrief) => {
        state.fields = { ...state.fields, goal: brief.goal, background: brief.background,
          deliverables: brief.deliverables.join('\n'), criteria: brief.acceptanceCriteria.join('\n'), constraints: brief.constraints }
        state.template = brief.template ?? null; state.requestId = null
      },
      revise: (state: ViewState, detail: WorkDetail) => {
        if (detail.ref.kind !== 'agent' || detail.agentId === undefined || detail.review === undefined) return
        state.fields = { executorId: detail.agentId, workspaceId: detail.workspaceId, goal: detail.brief?.goal ?? detail.name,
          background: detail.brief?.background ?? '', deliverables: detail.brief?.deliverables.join('\n') ?? '',
          criteria: detail.brief?.acceptanceCriteria.join('\n') ?? '', constraints: detail.brief?.constraints ?? '' }
        state.template = detail.brief?.template ?? null
        state.revision = { ref: detail.ref, reviewRevision: detail.review.revision, configuration: detail.configuration }
        state.formOpen = true; state.requestId = null
      },
    },
  })
}
