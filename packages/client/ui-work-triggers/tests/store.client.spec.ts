/** Local draft state never replaces committed host records or another pending command. */
import { expect, it } from 'vitest'
import { createTriggerViewStore } from '../src/client/store.ts'
import type { TriggerCommand } from '@deepseek-ai/dsh-api-remotes/client'
it('keeps exact request ownership across draft edits and late acknowledgments', () => {
  const { actions, store } = createTriggerViewStore().create()
  const request: TriggerCommand = { kind: 'acknowledge', id: 'trigger' as never, noticeId: 'notice' as never }
  actions.enabled('false'); actions.rule('every'); actions.field('name', 'Draft')
  actions.stage(request); actions.stage({ ...request, noticeId: 'different' as never })
  const draft = { name: 'Target', target: { kind: 'workflow' as const, id: 'workflow' as never, versionId: 'publication' as never, workspaceId: 'workspace' as never, inputs: {} } }
  actions.draft(draft, { kind: 'agent', id: 'source' as never }); actions.resetDraft()
  expect(store.getSnapshot().pending).toEqual(request); expect(store.getSnapshot().draft).toBeNull()
  actions.settled({ ...request, noticeId: 'different' as never }, null)
  expect(store.getSnapshot().pending).toEqual(request)
  actions.settled(request, 'Uncertain'); expect(store.getSnapshot().error).toBe('Uncertain')
  actions.settled(request, null); expect(store.getSnapshot().pending).toBeNull()
  actions.draft(draft, { kind: 'workflow', id: 'source' as never }); actions.resetDraft()
  expect(store.getSnapshot().draft).toBeNull()
})
