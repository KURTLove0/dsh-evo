/** Remount-surviving viewing state and unsaved drafts; records belong to the directory manager. */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'
import type { AgentDefinition, AgentRun, WorkbenchAgentId } from '@deepseek-ai/dsh-api-remotes/client'

/** An edit preserves the revision it started from, including across refreshes. */
export type AgentDraft = { definition: AgentDefinition } & (
  | { id: WorkbenchAgentId; revision: number }
  | { id?: undefined; revision?: undefined }
)
/** Supported detail panels share one revisioned identity. */
export type AgentDetailTab = 'overview' | 'runs' | 'instructions' | 'skills' | 'mcpServers' | 'settings'
interface ViewState {
  query: string
  filter: 'active' | 'working' | 'waiting' | 'archived'
  sort: 'name' | 'updated'
  draft: AgentDraft | null
  originalDefinition: AgentDefinition | null
  detailOpen: boolean
  tab: AgentDetailTab
  composers: Record<string, { prompt: string; workspace: string }>
  runKind: 'all' | 'task' | 'design'
  runQuery: string
  runStatus: 'all' | AgentRun['status']
}
type ViewActions = {
  detail: (state: ViewState, open: boolean) => void
  search: (state: ViewState, query: string) => void
  filter: (state: ViewState, filter: ViewState['filter']) => void
  sort: (state: ViewState, sort: ViewState['sort']) => void
  edit: (state: ViewState, draft: AgentDraft | null) => void
  tab: (state: ViewState, tab: ViewState['tab']) => void
  prompt: (state: ViewState, id: WorkbenchAgentId, prompt: string) => void
  workspace: (state: ViewState, id: WorkbenchAgentId, workspace: string) => void
  runKind: (state: ViewState, kind: ViewState['runKind']) => void
  runQuery: (state: ViewState, query: string) => void
  runStatus: (state: ViewState, status: ViewState['runStatus']) => void
}
/**
 * Create the independent page's viewing state.
 * @returns the store declaration and complete action API.
 */
export function createAgentViewStore(): EngineStoreHandle<ViewState, ViewActions> {
  return defineStore({
    init: (): ViewState => ({ query: '', filter: 'active', sort: 'name', detailOpen: false, draft: null, originalDefinition: null, tab: 'overview', composers: {}, runKind: 'all', runQuery: '', runStatus: 'all' }),
    actions: {
      detail: (state: ViewState, open: boolean) => { state.detailOpen = open },
      search: (state: ViewState, query: string) => { state.query = query },
      filter: (state: ViewState, filter: ViewState['filter']) => { state.filter = filter },
      sort: (state: ViewState, sort: ViewState['sort']) => { state.sort = sort },
      edit: (state: ViewState, draft: AgentDraft | null) => {
        if (draft === null) state.originalDefinition = null
        else if (state.draft === null) state.originalDefinition = draft.definition
        state.draft = draft
      },
      tab: (state: ViewState, tab: ViewState['tab']) => { state.tab = tab },
      prompt: (state: ViewState, id: WorkbenchAgentId, prompt: string) => { state.composers[id] = { workspace: '', ...state.composers[id], prompt } },
      workspace: (state: ViewState, id: WorkbenchAgentId, workspace: string) => { state.composers[id] = { prompt: '', ...state.composers[id], workspace } },
      runKind: (state: ViewState, kind: ViewState['runKind']) => { state.runKind = kind },
      runQuery: (state: ViewState, query: string) => { state.runQuery = query },
      runStatus: (state: ViewState, status: ViewState['runStatus']) => { state.runStatus = status },
    },
  })
}
