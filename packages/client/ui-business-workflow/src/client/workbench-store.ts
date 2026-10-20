/** Remount-surviving editor drafts and selection; business records remain in the runtime owner. */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  WorkflowDefinition,
  WorkflowDocument,
  WorkflowId,
} from '@deepseek-ai/dsh-business-workflow/workbench-types'

/** An editor draft retains the revision it was originally based on. */
export interface WorkflowEditorDraft {
  /** Source identity. */
  id: WorkflowId
  /** Compare-and-set revision. */
  revision: number
  /** Editable name. */
  name: string
  /** Complete editable definition. */
  definition: WorkflowDefinition
}
/** Viewing and unsaved form state. */
interface ViewState {
  drafts: Record<string, WorkflowEditorDraft>
  tab: 'design' | 'runs' | 'verification'
  nodeId: string
  runId: string
  workspaceId: string
  newName: string
  description: string
}
type ViewActions = {
  edit: (state: ViewState, draft: WorkflowEditorDraft) => void
  reset: (state: ViewState, document: WorkflowDocument) => void
  tab: (state: ViewState, tab: ViewState['tab']) => void
  node: (state: ViewState, id: string) => void
  run: (state: ViewState, id: string) => void
  workspace: (state: ViewState, id: string) => void
  newName: (state: ViewState, value: string) => void
  description: (state: ViewState, value: string) => void
}
/**
 * Create one store handle shared by this page's registration.
 * @returns editor state and its complete mutation API.
 */
export function createWorkflowViewStore(): EngineStoreHandle<ViewState, ViewActions> {
  return defineStore({
    init: (): ViewState => ({
      drafts: {},
      tab: 'design',
      nodeId: '',
      runId: '',
      workspaceId: '',
      newName: '',
      description: '',
    }),
    actions: {
      edit: (state, draft: WorkflowEditorDraft) => {
        state.drafts[draft.id] = draft
      },
      reset: (state, document: WorkflowDocument) => {
        state.drafts = Object.fromEntries(Object.entries(state.drafts).filter(([id]) => id !== document.id))
      },
      tab: (state, tab: ViewState['tab']) => {
        state.tab = tab
        state.runId = ''
      },
      node: (state, id: string) => {
        state.nodeId = id
      },
      run: (state, id: string) => {
        state.runId = id
      },
      workspace: (state, id: string) => {
        state.workspaceId = id
      },
      newName: (state, value: string) => {
        state.newName = value
      },
      description: (state, value: string) => {
        state.description = value
      },
    },
  })
}
