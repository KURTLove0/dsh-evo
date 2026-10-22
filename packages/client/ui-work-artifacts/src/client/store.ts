/** Filter drafts and uncertain file-registration requests retained across page remounts. */
import { defineStore, type ArtifactSelection, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'
import type { ArtifactReceipt, ArtifactRegistration, ArtifactRequestId } from '@deepseek-ai/dsh-api-remotes/client'
/** Shared directory controls and one explicitly pinned registration request. */
export interface ArtifactView {
  text: string
  workspace: string
  source: 'all' | 'agent' | 'workflow'
  origin: 'all' | 'current-file' | 'accepted-review'
  path: string
  mode: 'current-file' | 'accepted-review'
  review: string
  pending: ArtifactRegistration | null
  receipt: (ArtifactReceipt & { path: string; ref: ArtifactRegistration['source']['ref'] }) | null
  error: string | null
}
type Actions = {
  text: (state: ArtifactView, value: string) => void
  workspace: (state: ArtifactView, value: string) => void
  source: (state: ArtifactView, value: ArtifactView['source']) => void
  origin: (state: ArtifactView, value: ArtifactView['origin']) => void
  path: (state: ArtifactView, value: string) => void
  mode: (state: ArtifactView, value: ArtifactView['mode']) => void
  review: (state: ArtifactView, value: string) => void
  stage: (state: ArtifactView, request: ArtifactRegistration) => void
  acknowledged: (state: ArtifactView, requestId: ArtifactRequestId, receipt: ArtifactReceipt) => void
  failed: (state: ArtifactView, requestId: ArtifactRequestId, message: string) => void
  discard: (state: ArtifactView) => void
}
/**
 * Declare filters and retry inputs without storing file content in browser persistence.
 * @returns the shared view state and complete draft action API.
 */
export function createArtifactViewStore(): EngineStoreHandle<ArtifactView, Actions> {
  return defineStore({ init: (): ArtifactView => ({ text: '', workspace: '', source: 'all', origin: 'all', path: '', mode: 'current-file',
    review: '', pending: null, receipt: null, error: null }), actions: {
    text: (state: ArtifactView, value: string) => { state.text = value },
    workspace: (state: ArtifactView, value: string) => { state.workspace = value },
    source: (state: ArtifactView, value: ArtifactView['source']) => { state.source = value },
    origin: (state: ArtifactView, value: ArtifactView['origin']) => { state.origin = value },
    path: (state: ArtifactView, value: string) => { state.path = value },
    mode: (state: ArtifactView, value: ArtifactView['mode']) => { state.mode = value; state.review = '' },
    review: (state: ArtifactView, value: string) => { state.review = value },
    stage: (state: ArtifactView, request: ArtifactRegistration) => {
      if (state.pending === null) { state.pending = request; state.error = null }
    },
    acknowledged: (state: ArtifactView, requestId: ArtifactRequestId, receipt: ArtifactReceipt) => {
      if (state.pending?.requestId !== requestId) return
      state.receipt = { ...receipt, path: state.pending.path, ref: state.pending.source.ref }; state.pending = null; state.error = null
    },
    failed: (state: ArtifactView, requestId: ArtifactRequestId, message: string) => {
      if (state.pending?.requestId === requestId) state.error = message
    },
    discard: (state: ArtifactView) => { state.pending = null; state.error = null },
  } })
}
/**
 * Resolve retained controls to the directory's explicit dimensions.
 * @param view - current text and dimension drafts.
 * @returns the submitted filters, with no hidden page-size default.
 */
export function artifactSelection(view: ArtifactView): ArtifactSelection {
  return { text: view.text, ...(view.workspace === '' ? {} : { workspaceId: view.workspace as NonNullable<ArtifactSelection['workspaceId']> }),
    ...(view.source === 'all' ? {} : { source: view.source }), ...(view.origin === 'all' ? {} : { origin: view.origin }) }
}
