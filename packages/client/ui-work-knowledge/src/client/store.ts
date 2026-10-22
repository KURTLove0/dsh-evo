/** Page drafts survive slot remounts without persisting project text in browser storage. */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'
import type { KnowledgeSource } from '@deepseek-ai/dsh-api-remotes/client'
/** Search, registration, and exact captured-line selection. */
export interface KnowledgeView {
  path: string
  text: string
  limit: string
  sourceId: string
  version: number
  startLine: number
  endLine: number
}
type Actions = {
  edit: (state: KnowledgeView, patch: Partial<KnowledgeView>) => void
  select: (state: KnowledgeView, source: KnowledgeSource) => void
}
/**
 * Allocate plugin-lifetime controlled drafts without retaining file content.
 * @returns the view store and selection actions.
 */
export function createKnowledgeViewStore(): EngineStoreHandle<KnowledgeView, Actions> {
  return defineStore({ init: (): KnowledgeView => ({ path: '', text: '', limit: '', sourceId: '', version: 0, startLine: 1, endLine: 1 }),
    actions: {
      edit: (state: KnowledgeView, patch: Partial<KnowledgeView>) => { Object.assign(state, patch) },
      select: (state: KnowledgeView, source: KnowledgeSource) => {
        const version = source.versions.at(-1)
        state.sourceId = source.id; state.version = version?.version ?? 0
        state.startLine = 1; state.endLine = version?.lines ?? 1
      },
    } })
}
