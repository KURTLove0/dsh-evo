/** Only unsubmitted scope and display filters belong in the declared page store. */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'
interface HealthView { agent: string; workspace: string; filter: 'all' | 'attention' }
type Actions = {
  field: (state: HealthView, field: 'agent' | 'workspace', value: string) => void
  filter: (state: HealthView, filter: HealthView['filter']) => void
}
/**
 * Declare the page viewing state independently of host observations.
 * @returns remount-surviving scope controls, without persisting host observations as browser drafts.
 */
export function createHealthViewStore(): EngineStoreHandle<HealthView, Actions> {
  return defineStore({
    init: (): HealthView => ({ agent: '', workspace: '', filter: 'all' }),
    actions: {
      field: (state: HealthView, field: 'agent' | 'workspace', value: string) => { state[field] = value },
      filter: (state: HealthView, filter: HealthView['filter']) => { state.filter = filter },
    },
  })
}
