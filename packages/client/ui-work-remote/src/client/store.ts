/** Remount-surviving drafts and exact uncertain requests contain no authoritative execution results. */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'
import type { RemoteCallRequest } from '@deepseek-ai/dsh-api-remotes/client'
/** Only native mutations retain uncertain operation identity. */
export type RemoteWrite = RemoteCallRequest & { operation: Exclude<RemoteCallRequest['operation'], { kind: 'catalog' | 'list' | 'inspect' }> }
/** Every field is user input; remote reads remain with the runtime manager. */
export interface RemoteView {
  workspace: string
  kind: 'agent' | 'workflow'
  executor: string
  publication: string
  goal: string
  background: string
  deliverables: string
  criteria: string
  constraints: string
  inputs: string
  pending: RemoteWrite | null
  error: string | null
}
type Field = Exclude<keyof RemoteView, 'pending' | 'error' | 'kind'>
type Actions = {
  field: (state: RemoteView, field: Field, value: string) => void
  kind: (state: RemoteView, kind: RemoteView['kind']) => void
  target: (state: RemoteView) => void
  stage: (state: RemoteView, request: RemoteWrite) => void
  settled: (state: RemoteView, request: RemoteWrite, error: string | null) => void
  clear: (state: RemoteView) => void
}
/**
 * Declare one plugin-owned draft and uncertain-command store.
 * @returns handle with explicit draft and acknowledgment actions.
 */
export function createRemoteViewStore(): EngineStoreHandle<RemoteView, Actions> {
  return defineStore({ init: (): RemoteView => ({ workspace: '', kind: 'agent', executor: '', publication: '', goal: '', background: '',
    deliverables: '', criteria: '', constraints: '', inputs: '{}', pending: null, error: null }), actions: {
    field: (state: RemoteView, field: Field, value: string) => { state[field] = value },
    kind: (state: RemoteView, kind: RemoteView['kind']) => { state.kind = kind; state.executor = ''; state.publication = '' },
    target: (state: RemoteView) => { state.workspace = ''; state.executor = ''; state.publication = '' },
    stage: (state: RemoteView, request: RemoteWrite) => { if (state.pending === null) { state.pending = request; state.error = null } },
    settled: (state: RemoteView, request: RemoteWrite, error: string | null) => {
      if (JSON.stringify(state.pending) !== JSON.stringify(request)) return
      state.error = error; if (error === null) state.pending = null
    },
    clear: (state: RemoteView) => { state.pending = null; state.error = null },
  } })
}
