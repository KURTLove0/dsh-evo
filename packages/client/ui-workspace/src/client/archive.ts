/** Metadata-only archive filtering; membership stays with the workspace registry. */
import { defineStore, type EngineStoreHandle, type SessionId, type SessionListState, type WorkspaceListState, type WorkspaceView } from '@deepseek-ai/dsh-client-runtime/client'

/** Unsent archive filters survive page remounts within one plugin lifetime. */
export interface ArchiveView { query: string; workspace: string }
type ArchiveActions = {
  query: (state: ArchiveView, value: string) => void
  workspace: (state: ArchiveView, value: string) => void
}
/** One archived identity remains visible even when its session metadata is unavailable. */
export interface ArchivedRow { id: SessionId; title?: string; workspace?: WorkspaceView }
/**
 * Create archive controls without persisting session content or observations.
 * @returns the declared view state and field actions.
 */
export function createArchiveViewStore(): EngineStoreHandle<ArchiveView, ArchiveActions> {
  return defineStore({ init: (): ArchiveView => ({ query: '', workspace: '' }), actions: {
    query: (state: ArchiveView, value: string) => { state.query = value },
    workspace: (state: ArchiveView, value: string) => { state.workspace = value },
  } })
}
/**
 * Filter archived IDs using existing metadata, keeping newest archive membership first.
 * @param sessions - most recently observed session metadata.
 * @param workspaces - authoritative archive set and workspace accounting.
 * @param view - title/ID and workspace filters; @ungrouped selects unaccounted IDs.
 * @param limit - deployment-selected visible row bound.
 * @returns a bounded prefix and the full matching metadata count.
 */
export function deriveArchivedRows(sessions: Pick<SessionListState, 'byId'>, workspaces: Pick<WorkspaceListState, 'items' | 'archivedSessionIds'>,
  view: ArchiveView, limit: number): { items: ArchivedRow[]; total: number } {
  const owners = new Map<SessionId, WorkspaceView>()
  for (const workspace of workspaces.items) for (const id of workspace.sessionIds) owners.set(id, workspace)
  const query = view.query.trim().toLocaleLowerCase()
  const rows: ArchivedRow[] = []
  for (const id of [...workspaces.archivedSessionIds].reverse()) {
    const session = sessions.byId[id], workspace = owners.get(id)
    if (view.workspace === '@ungrouped' ? workspace !== undefined : view.workspace !== '' && workspace?.workspaceId !== view.workspace) continue
    if (!`${session?.displayTitle ?? ''} ${id}`.toLocaleLowerCase().includes(query)) continue
    rows.push({ id, ...(session === undefined ? {} : { title: session.displayTitle }), ...(workspace === undefined ? {} : { workspace }) })
  }
  return { items: rows.slice(0, limit), total: rows.length }
}
