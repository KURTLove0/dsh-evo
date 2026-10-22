/** Browser draft parsing fixes one remote target before a request identity is minted. */
import type { RemoteCatalog, RemoteTarget } from '@deepseek-ai/dsh-api-remotes/client'
import type { RemoteView } from './store.ts'
const lines = (value: string) => value.split('\n').map(value => value.trim()).filter(Boolean)
/**
 * Resolve current catalog choices and JSON input without changing their meaning.
 * @param view - user-edited draft.
 * @param catalog - current authorized remote choices.
 * @returns fixed target, or undefined for incomplete, unavailable or invalid input.
 */
export function remoteTarget(view: RemoteView, catalog: RemoteCatalog | undefined): RemoteTarget | undefined {
  const workspace = catalog?.workspaces.find(value => value.id === view.workspace)
  if (workspace === undefined) return undefined
  if (view.kind === 'agent') {
    const agent = workspace.agents.find(value => value.id === view.executor && !value.archived)
    if (agent === undefined || view.goal.trim() === '') return undefined
    return { kind: 'agent', id: agent.id, workspaceId: workspace.id, expectedRevision: agent.revision,
      brief: { version: 1, goal: view.goal, background: view.background, deliverables: lines(view.deliverables),
        acceptanceCriteria: lines(view.criteria), constraints: view.constraints } }
  }
  const workflow = workspace.workflows.find(value => value.id === view.executor && !value.archived)
  const publication = workflow?.versions.find(value => value.id === view.publication)
  if (workflow === undefined || publication === undefined) return undefined
  try {
    const inputs: unknown = JSON.parse(view.inputs, (_key, value: unknown) => {
      if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Nonfinite JSON input.')
      return value
    })
    if (inputs === null || typeof inputs !== 'object' || Array.isArray(inputs)
      || !publication.inputs.every(input => Object.hasOwn(inputs, input.name))) return undefined
    return { kind: 'workflow', id: workflow.id, workspaceId: workspace.id, versionId: publication.id,
      inputs: inputs as Extract<RemoteTarget, { kind: 'workflow' }>['inputs'] }
  } catch { return undefined }
}
