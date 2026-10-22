/** Remount-surviving template view fields and captured operator requests. */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'
import type { TemplateMutation, TemplateCopyRequest } from '@deepseek-ai/dsh-api-remotes/client'
interface MutationDraft { signature: string; request: TemplateMutation }
interface CopyDraft { signature: string; request: TemplateCopyRequest }
interface ViewState {
  name: string
  version: number
  source: string
  publication: string
  workspace: string
  copyName: string
  mutationRequest: MutationDraft | null
  copyRequest: CopyDraft | null
}
type ViewActions = {
  field: (state: ViewState, key: 'name' | 'source' | 'publication' | 'workspace' | 'copyName', value: string) => void
  version: (state: ViewState, version: number) => void
  select: (state: ViewState) => void
  discardRequests: (state: ViewState, kinds: ('mutationRequest' | 'copyRequest')[]) => void
  stageMutation: (state: ViewState, draft: MutationDraft) => void
  stageCopy: (state: ViewState, draft: CopyDraft) => void
  acknowledged: (state: ViewState, kind: 'mutationRequest' | 'copyRequest', id: TemplateMutation['requestId'] | TemplateCopyRequest['requestId']) => void
}
/**
 * Declare template view fields and retry requests without writing user material to disk.
 * @returns the template page's declared view state and mutation actions.
 */
export function createTemplateViewStore(): EngineStoreHandle<ViewState, ViewActions> {
  return defineStore({
    init: (): ViewState => ({ name: '', version: 0, source: '', publication: '', workspace: '', copyName: '', mutationRequest: null, copyRequest: null }),
    actions: {
      field: (state: ViewState, key: 'name' | 'source' | 'publication' | 'workspace' | 'copyName', value: string) => { state[key] = value },
      version: (state: ViewState, version: number) => { state.version = version },
      select: (state: ViewState) => { state.version = 0; state.name = '' },
      discardRequests: (state: ViewState, kinds: ('mutationRequest' | 'copyRequest')[]) => {
        for (const kind of kinds) state[kind] = null
      },
      stageMutation: (state: ViewState, draft: MutationDraft) => { state.mutationRequest = draft },
      stageCopy: (state: ViewState, draft: CopyDraft) => { state.copyRequest = draft },
      acknowledged: (state: ViewState, kind: 'mutationRequest' | 'copyRequest', id: TemplateMutation['requestId'] | TemplateCopyRequest['requestId']) => {
        if (state[kind]?.request.requestId === id) state[kind] = null
      },
    },
  })
}
