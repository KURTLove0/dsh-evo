/** Shared creation drafts and exact uncertain command inputs survive page remounts. */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'
import type { TriggerCommand, TriggerDefinition } from '@deepseek-ai/dsh-api-remotes/client'
/** Viewing state contains draft inputs, never authoritative trigger results. */
export interface TriggerView {
  text: string
  workspace: string
  enabled: 'all' | 'true' | 'false'
  name: string
  rule: 'at' | 'every' | 'on-settled'
  at: string
  minutes: string
  draft: (Pick<TriggerDefinition, 'name' | 'target'> & { source: Extract<TriggerDefinition['rule'], { kind: 'on-settled' }>['source'] }) | null
  pending: TriggerCommand | null
  error: string | null
}
type Field = 'text' | 'workspace' | 'name' | 'at' | 'minutes'
type Actions = {
  field: (state: TriggerView, field: Field, value: string) => void
  enabled: (state: TriggerView, value: TriggerView['enabled']) => void
  rule: (state: TriggerView, value: TriggerView['rule']) => void
  draft: (state: TriggerView, value: Pick<TriggerDefinition, 'name' | 'target'>, source: NonNullable<TriggerView['draft']>['source']) => void
  stage: (state: TriggerView, value: TriggerCommand) => void
  settled: (state: TriggerView, value: TriggerCommand, error: string | null) => void
  resetDraft: (state: TriggerView) => void
  clear: (state: TriggerView) => void
}
/**
 * Declare shared drafts; clearing an uncertain request never undoes host work.
 * @returns viewing state and its complete mutation API.
 */
export function createTriggerViewStore(): EngineStoreHandle<TriggerView, Actions> {
  return defineStore({ init: (): TriggerView => ({ text: '', workspace: '', enabled: 'all', name: '', rule: 'at', at: '', minutes: '60',
    draft: null, pending: null, error: null }), actions: {
    field: (state: TriggerView, field: Field, value: string) => { state[field] = value },
    enabled: (state: TriggerView, value: TriggerView['enabled']) => { state.enabled = value },
    rule: (state: TriggerView, value: TriggerView['rule']) => { state.rule = value },
    draft: (state: TriggerView, value: Pick<TriggerDefinition, 'name' | 'target'>, source: NonNullable<TriggerView['draft']>['source']) => {
      if (state.pending !== null) return
      state.draft = { ...value, source }; state.name = value.name; state.error = null
    },
    stage: (state: TriggerView, value: TriggerCommand) => { if (state.pending === null) { state.pending = value; state.error = null } },
    settled: (state: TriggerView, value: TriggerCommand, error: string | null) => {
      if (JSON.stringify(state.pending) !== JSON.stringify(value)) return
      state.error = error
      if (error === null) { state.pending = null; if (value.kind === 'create') { state.draft = null } }
    },
    resetDraft: (state: TriggerView) => { if (state.pending === null) { state.draft = null } },
    clear: (state: TriggerView) => { state.pending = null; state.error = null },
  } })
}
