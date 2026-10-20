/** Remount-surviving viewing state and unsaved drafts; records belong to the directory manager. */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'
import type { AgentDefinition, WorkbenchAgentId } from '@deepseek-ai/dsh-api-remotes/client'

/** An edit preserves the revision it started from, including across refreshes. */
export type AgentDraft = { definition: AgentDefinition } & (
  | { id: WorkbenchAgentId; revision: number }
  | { id?: undefined; revision?: undefined }
)
interface ViewState {
  query: string
  filter: 'active' | 'working' | 'archived'
  draft: AgentDraft | null
  tab: 'overview' | 'runs'
  prompt: string
  workspace: string
}
type ViewActions = {
  search: (state: ViewState, query: string) => void
  filter: (state: ViewState, filter: ViewState['filter']) => void
  edit: (state: ViewState, draft: AgentDraft | null) => void
  tab: (state: ViewState, tab: ViewState['tab']) => void
  prompt: (state: ViewState, prompt: string) => void
  workspace: (state: ViewState, workspace: string) => void
}
/**
 * Create the independent page's viewing state.
 * @returns the store declaration and complete action API.
 */
export function createAgentViewStore(): EngineStoreHandle<ViewState, ViewActions> {
  return defineStore({
    init: (): ViewState => ({ query: '', filter: 'active', draft: null, tab: 'overview', prompt: '', workspace: '' }),
    actions: {
      search: (state: ViewState, query: string) => { state.query = query },
      filter: (state: ViewState, filter: ViewState['filter']) => { state.filter = filter },
      edit: (state: ViewState, draft: AgentDraft | null) => { state.draft = draft },
      tab: (state: ViewState, tab: ViewState['tab']) => { state.tab = tab },
      prompt: (state: ViewState, prompt: string) => { state.prompt = prompt },
      workspace: (state: ViewState, workspace: string) => { state.workspace = workspace },
    },
  })
}
