/** Draft validation pins published inputs and avoids silently rewriting nonfinite JSON. */
import { expect, it } from 'vitest'
import type { RemoteCatalog } from '@deepseek-ai/dsh-api-remotes/client'
import { remoteTarget } from '../src/client/target.ts'
import { createRemoteViewStore } from '../src/client/store.ts'
const catalog: RemoteCatalog = { credentialOwner: 'remote-host', controls: { stop: true, workflowDecisions: true }, workspaces: [{
  id: 'workspace' as never, path: '/remote', title: 'Remote', agents: [{ id: 'agent' as never, name: 'Agent', revision: 3, runtime: 'remote', skills: [], mcpServerNames: [], archived: false }],
  workflows: [{ id: 'workflow' as never, name: 'Workflow', archived: false, versions: [{ id: 'version' as never, number: 1, inputs: [{ name: 'report', description: '' }] }] }] }] }
it('pins explicit remote identities and retains the first uncertain request across draft edits', () => {
  const { store, actions } = createRemoteViewStore().create()
  expect(remoteTarget(store.getSnapshot(), catalog)).toBeUndefined()
  actions.field('workspace', 'workspace'); actions.field('executor', 'agent'); expect(remoteTarget(store.getSnapshot(), catalog)).toBeUndefined()
  actions.field('goal', 'Report'); actions.field('deliverables', 'one\n\ntwo'); actions.field('criteria', 'Check')
  expect(remoteTarget(store.getSnapshot(), catalog)).toMatchObject({ expectedRevision: 3, brief: { deliverables: ['one', 'two'] } })
  actions.kind('workflow'); actions.field('executor', 'workflow'); actions.field('publication', 'version')
  for (const value of ['[]', 'null', '4', '{', '{}', '{"report":1e400}']) { actions.field('inputs', value); expect(remoteTarget(store.getSnapshot(), catalog)).toBeUndefined() }
  actions.field('inputs', '{"report":{"version":1}}'); expect(remoteTarget(store.getSnapshot(), catalog)).toMatchObject({ versionId: 'version', inputs: { report: { version: 1 } } })
  const request = { peer: 'peer' as never, expected: { hostId: 'host' as never, principalId: 'principal' as never }, operation: { kind: 'stop' as const, id: 'submission' as never } }
  actions.stage(request); actions.stage({ ...request, peer: 'other' as never }); actions.settled({ ...request, peer: 'other' as never }, null)
  expect(store.getSnapshot().pending).toEqual(request); actions.settled(request, 'Lost'); expect(store.getSnapshot().error).toBe('Lost')
  actions.settled(request, null); expect(store.getSnapshot().pending).toBeNull(); actions.target(); actions.clear()
  expect(remoteTarget(store.getSnapshot(), undefined)).toBeUndefined()
})
