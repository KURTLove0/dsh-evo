// @vitest-environment jsdom
/** Fixed remote authority, retained uncertain input and original native workflow decisions. */
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createSnapshotStore, type RemoteWorkSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import type { RemoteCallRequest, RemoteCatalog, RemotePeer, RemoteWorkResult } from '@deepseek-ai/dsh-api-remotes/client'
import { RemotePage, RemoteNavigation } from '../src/client/RemoteView.tsx'
import { createRemoteViewStore } from '../src/client/store.ts'
import { en } from '../src/client/locales.ts'
afterEach(cleanup)
const peer = { id: 'peer', name: 'Remote', hostId: 'remote-host', principalId: 'principal', origin: 'http://127.0.0.1',
  authorization: { reference: 'KEY', configured: true, owner: 'local-host' }, executionCredentialOwner: 'remote-host' } as RemotePeer
const catalog: RemoteCatalog = { credentialOwner: 'remote-host', controls: { stop: true, workflowDecisions: true }, workspaces: [{ id: 'workspace' as never,
  path: '/remote', title: 'Remote workspace', agents: [{ id: 'agent' as never, name: 'Reporter', revision: 3, runtime: 'remote', skills: ['review'], mcpServerNames: ['tools'], archived: false }],
  workflows: [{ id: 'workflow' as never, name: 'Approval flow', archived: false, versions: [{ id: 'publication' as never, number: 1, inputs: [{ name: 'report', description: 'Source report' }] }] }] }] }
function mount(connected = true) {
  const ready = { loading: false, stale: false, error: null }
  const data = createSnapshotStore<RemoteWorkSnapshot>({ peers: { ...ready, value: [peer] }, peer: peer.id,
    catalog: { ...ready, value: { kind: 'catalog', catalog, observedAt: 1 } }, history: { ...ready, value: { kind: 'list', items: [], observedAt: 1 } },
    detail: { ...ready }, mutating: false })
  const view = createRemoteViewStore().create(), command = vi.fn(async (_request: RemoteCallRequest): Promise<unknown> => undefined)
  const props = { t: (key: keyof typeof en) => en[key], actions: view.actions, useStore: bindSnapshotSelector(view.store),
    useRemoteWork: bindSnapshotSelector(data),
    useHostDescription: (selector: (value: unknown) => unknown) => selector(connected ? {} : undefined),
    command, refresh: vi.fn(async () => {}), choose: vi.fn(async () => {}), select: vi.fn(async () => {}) }
  const element = () => <RemotePage {...props as Parameters<typeof RemotePage>[0]} />
  let rendered = render(element())
  const chooseAgent = () => {
    fireEvent.change(screen.getByRole('combobox', { name: en.workspace }), { target: { value: 'workspace' } })
    fireEvent.change(screen.getByRole('combobox', { name: en.executor }), { target: { value: 'agent' } })
    fireEvent.change(screen.getByRole('textbox', { name: en.goal }), { target: { value: 'Remote original task' } })
  }
  const inspect = (patch: Partial<Extract<RemoteWorkResult, { kind: 'inspection' }>> = {}) => {
    data.update((state) => { state.detail = { ...ready, id: 'submission' as never, value: { kind: 'inspection', observedAt: 2, submission: {
      id: 'submission' as never, hostId: peer.hostId, principalId: peer.principalId, createdAt: 1, attempts: 2,
      target: { kind: 'workflow', id: 'workflow' as never, workspaceId: 'workspace' as never, versionId: 'publication' as never, inputs: { report: 'Original' } },
      admission: { state: 'admitted', ref: { kind: 'workflow', id: 'native-run' as never } } },
    source: { ref: { kind: 'workflow', id: 'native-run' as never }, name: 'Flow', workspaceId: 'workspace' as never, sessionId: 'session' as never, status: 'waiting' }, ...patch } } })
  }
  return { data, view, props, command, chooseAgent, inspect, remount: () => { rendered.unmount(); rendered = render(element()) } }
}
it('retains the exact task and authority across remount and only explicitly resubmits the original identity', async () => {
  const ui = mount(); ui.chooseAgent(); ui.command.mockRejectedValueOnce(new Error('Lost acknowledgment'))
  fireEvent.click(screen.getByRole('button', { name: en.submit })); await screen.findByText('Lost acknowledgment')
  const original = ui.command.mock.calls[0]![0]
  expect(original).toMatchObject({ expected: { hostId: 'remote-host', principalId: 'principal' }, operation: { kind: 'submit', target: { expectedRevision: 3, brief: { goal: 'Remote original task' } } } })
  ui.remount(); expect(ui.command).toHaveBeenCalledOnce(); expect(screen.getByRole('button', { name: en.submit }).hasAttribute('disabled')).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: en.inspect })); expect(ui.props.select).toHaveBeenCalledWith(original.operation.kind === 'submit' && original.operation.id)
  fireEvent.click(screen.getByRole('button', { name: en.retry })); await waitFor(() => { expect(ui.command).toHaveBeenCalledTimes(2) })
  expect(ui.command.mock.calls[1]![0]).toEqual(original); await waitFor(() => { expect(ui.view.store.getSnapshot().pending).toBeNull() })
})
it('prepares only a selected formal publication and reads exact native approval context before confirming a decision', async () => {
  const ui = mount(); fireEvent.change(screen.getByRole('combobox', { name: en.workspace }), { target: { value: 'workspace' } })
  fireEvent.change(screen.getByRole('combobox', { name: en.kind }), { target: { value: 'workflow' } })
  fireEvent.change(screen.getByRole('combobox', { name: en.executor }), { target: { value: 'workflow' } })
  fireEvent.change(screen.getByRole('combobox', { name: en.publication }), { target: { value: 'publication' } })
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', en.invalidInputs)
  fireEvent.change(screen.getByRole('textbox', { name: en.inputs }), { target: { value: '{"report":"Original"}' } })
  fireEvent.click(screen.getByRole('button', { name: en.submit })); await waitFor(() => { expect(ui.command).toHaveBeenCalledOnce() })
  expect(ui.command.mock.calls[0]![0].operation).toMatchObject({ target: { versionId: 'publication', inputs: { report: 'Original' } } })
  await waitFor(() => { expect(ui.view.store.getSnapshot().pending).toBeNull() })
  ui.inspect({ decisions: [{ attemptId: 'waiting' as never, title: 'Human check', instruction: 'Review actual input', inputs: { report: 'Original' } }],
    delivery: { outputs: [{ name: 'report', text: 'Recorded result' }], evidence: 'recorded-workflow-output' } })
  await screen.findByText('Review actual input'); fireEvent.click(screen.getByRole('button', { name: en.approve }))
  expect(ui.command).toHaveBeenCalledOnce(); fireEvent.click(screen.getByRole('button', { name: en.cancel }))
  fireEvent.click(screen.getByRole('button', { name: en.reject })); fireEvent.click(screen.getByRole('button', { name: en.confirm }))
  await waitFor(() => { expect(ui.command).toHaveBeenCalledTimes(2) }); expect(ui.command.mock.calls[1]![0].operation).toEqual({ kind: 'decide', id: 'submission', attemptId: 'waiting', approve: false })
  await waitFor(() => { expect(ui.view.store.getSnapshot().pending).toBeNull() })
  fireEvent.click(screen.getByRole('button', { name: en.stop })); fireEvent.click(screen.getByRole('button', { name: en.confirm }))
  await waitFor(() => { expect(ui.command.mock.calls[2]![0].operation.kind).toBe('stop') })
})
it('keeps original-admission recovery explicit and never retries uncertain controls automatically', async () => {
  const ui = mount(); ui.inspect(); const value = ui.data.getSnapshot().detail.value!
  ui.inspect({ submission: { ...value.submission, admission: { state: 'unconfirmed' } }, source: undefined, unavailable: true, decisionsUnavailable: true } as never)
  fireEvent.click(await screen.findByRole('button', { name: en.recover })); ui.command.mockRejectedValueOnce('Recovery acknowledgment lost')
  fireEvent.click(screen.getByRole('button', { name: en.confirm })); await screen.findByText('Recovery acknowledgment lost')
  expect(ui.command.mock.calls[0]![0].operation).toEqual({ kind: 'recover', id: 'submission', expectedAttempt: 2 })
  ui.remount(); expect(screen.queryByRole('button', { name: en.retry })).toBeNull(); expect(ui.command).toHaveBeenCalledOnce()
  fireEvent.click(screen.getByRole('button', { name: en.clear })); expect(ui.view.store.getSnapshot().pending).toBeNull()
})
it('blocks writes when disconnected or the configured remote authority changes and exposes read errors separately', async () => {
  const ui = mount(false); ui.chooseAgent(); expect(screen.getByRole('button', { name: en.submit }).hasAttribute('disabled')).toBe(true)
  ui.view.actions.stage({ peer: peer.id, expected: { hostId: 'previous-host' as never, principalId: peer.principalId }, operation: { kind: 'submit', id: 'id' as never, target: { kind: 'agent' } as never } })
  expect(await screen.findByText(en.authorityChanged)).toBeTruthy()
  expect(screen.getByRole('button', { name: en.retry }).hasAttribute('disabled')).toBe(true)
  ui.data.update((state) => { state.peers = { loading: false, stale: true, error: 'Peer read failed', value: [] }; state.catalog.stale = true })
  expect(await screen.findByText(/Peer read failed/)).toBeTruthy(); expect(screen.getByText(en.emptyPeers)).toBeTruthy()
})
it('changes the machine without implicitly dispatching and labels navigation in collapsed layouts', async () => {
  const ui = mount(); fireEvent.change(screen.getByRole('combobox', { name: en.machine }), { target: { value: 'peer' } })
  expect(ui.props.choose).toHaveBeenCalledWith('peer'); expect(ui.command).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: en.refresh })); expect(ui.props.refresh).toHaveBeenCalled()
  ui.data.update((state) => { state.peers.loading = true; state.history.loading = true; state.history.value = { kind: 'list', observedAt: 1,
    items: [{ id: 'submission', target: { kind: 'agent' }, admission: { state: 'unconfirmed' } }] } as never })
  fireEvent.click((await screen.findByRole('button', { name: /Agent task.*Native admission/ }))); expect(ui.props.select).toHaveBeenCalledWith('submission')
  cleanup(); const open = vi.fn(), props = { wide: false, t: (key: keyof typeof en) => en[key], open }
  render(<RemoteNavigation {...props as Parameters<typeof RemoteNavigation>[0]} />); fireEvent.click(screen.getByRole('button', { name: en.title })); expect(open).toHaveBeenCalledOnce()
})

it('keeps unavailable and stale evidence visible while refusing incomplete forms and missing credentials', async () => {
  const ui = mount(); fireEvent.submit(document.querySelector('form')!); expect(ui.command).not.toHaveBeenCalled()
  for (const key of ['background', 'deliverables', 'criteria', 'constraints'] as const)
    fireEvent.change(screen.getByRole('textbox', { name: en[key] }), { target: { value: 'Explicit input' } })
  ui.inspect({ source: undefined } as never)
  ui.data.update((state) => { state.detail.stale = true; state.catalog.stale = true; state.mutating = true
    state.peers.value = [{ ...peer, authorization: { ...peer.authorization, configured: false } }] })
  expect(await screen.findByText(en.stale)).toBeTruthy(); expect(screen.getByText(new RegExp(en.missing))).toBeTruthy()
  ui.data.update((state) => { delete state.peer; delete state.peers.value; delete state.catalog.value; delete state.history.value })
  expect(await screen.findByText(en.select)).toBeTruthy()
  cleanup()
  render(<RemoteNavigation {...{ wide: true, t: (key: keyof typeof en) => en[key],
    open: () => {} } as Parameters<typeof RemoteNavigation>[0]} />)
  expect(screen.getByRole('button', { name: en.title })).toBeTruthy()
})
