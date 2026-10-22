// @vitest-environment jsdom
/** Explicit configuration reads, scoped probes, repair navigation, and last-known observations. */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { HealthSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import type { HealthItem, HealthProbeRecord, HealthProbeRequest, HealthReport } from '@deepseek-ai/dsh-api-remotes/client'
import { HealthPage, HealthNavigation, type HealthPageProps } from '../src/client/HealthPage.tsx'
import { createHealthViewStore } from '../src/client/store.ts'
import { en } from '../src/client/locales.ts'

const selection = { id: 'agent' as never, revision: 2, workspaceId: 'workspace' as never }
const request: HealthProbeRequest = { id: 'probe' as never, agentId: selection.id, expectedRevision: 2, workspaceId: selection.workspaceId, serverName: 'crm' }
const complete: HealthProbeRecord = { ...request, startedAt: 1, checkedAt: 2, status: 'connected', cleanup: 'closed' }
const item = (patch: Partial<HealthItem> = {}): HealthItem => ({ key: 'runtime', kind: 'runtime', label: 'Local runtime',
  state: 'ready', code: 'runtime-command-present', repair: 'runtimes', ...patch })
const report = (items: HealthItem[] = [item(), item({ key: 'mcp:crm', kind: 'mcp', label: 'crm', state: 'not-checked', code: 'mcp-not-checked', repair: 'agents' })]): HealthReport => ({ checkedAt: 1, selection, items })
function mount(patch: Partial<HealthSnapshot> = {}, connected = true) {
  const state: HealthSnapshot = { agents: [{ id: selection.id, revision: 2, name: 'Reviewer', archived: false }], loaded: true, loading: false,
    checking: false, stale: false, report: undefined, error: null, probeErrors: [], probes: [], pending: [], unavailable: [], ...patch }
  const data = createSnapshotStore(state)
  const view = createHealthViewStore().create()
  const load = vi.fn(async () => {}), check = vi.fn(async () => {}), start = vi.fn(async () => {})
  const recover = vi.fn(async () => {}), cancel = vi.fn(async () => {}), invalidate = vi.fn(), repair = vi.fn()
  const props: HealthPageProps = { useHealth: bindSnapshotSelector(data), useStore: bindSnapshotSelector(view.store), actions: view.actions,
    useHostDescription: selector => selector(connected ? {} as never : undefined), useSessions: selector => selector({} as never),
    useWorkspaces: selector => selector({ items: [{ workspaceId: selection.workspaceId, title: 'Project', path: '/project', sessionIds: [] }] } as never),
    t: key => en[key as keyof typeof en], load, check, start, recover, cancel, invalidate, repair }
  const rendered = render(<HealthPage {...props} />)
  return { data, view, load, check, start, recover, cancel, invalidate, repair, props, rendered }
}
afterEach(cleanup)
const region = (name: string) => within(screen.getByRole('region', { name }))
function choose() {
  fireEvent.change(screen.getByRole('combobox', { name: en.agent }), { target: { value: selection.id } })
  fireEvent.change(screen.getByRole('combobox', { name: en.workspace }), { target: { value: selection.workspaceId } })
}
it('loads choices only, requires explicit scope, and never starts checks or connections from a selection', () => {
  const ui = mount()
  expect(ui.load).toHaveBeenCalledOnce()
  expect(ui.check).not.toHaveBeenCalled(); expect(ui.start).not.toHaveBeenCalled()
  expect(screen.getByText(en.noReport)).toBeTruthy()
  const selected = region(en.selectedCheck).getByRole('button', { name: en.selectedCheck })
  expect(selected.hasAttribute('disabled')).toBe(true)
  choose()
  expect(ui.invalidate).toHaveBeenCalledTimes(2)
  expect(ui.check).not.toHaveBeenCalled()
  fireEvent.click(selected)
  expect(ui.check).toHaveBeenCalledWith({ kind: 'agent', id: selection.id, expectedRevision: 2, workspaceId: selection.workspaceId })
  fireEvent.click(screen.getByRole('button', { name: en.globalCheck }))
  expect(ui.check).toHaveBeenLastCalledWith({ kind: 'global' })
  fireEvent.click(screen.getByRole('button', { name: en.refresh }))
  expect(ui.load).toHaveBeenCalledTimes(2)
  fireEvent.click(screen.getByRole('button', { name: en.configure }))
  expect(ui.repair).toHaveBeenCalledWith('agents')
})
it('keeps MCP untested until an explicit probe with the checked revision and workspace', async () => {
  const ui = mount({ report: report() })
  const connections = region(en.connections)
  expect(connections.getByText(en['mcp-not-checked'])).toBeTruthy()
  const button = connections.getByRole('button', { name: en.probe })
  expect(button.hasAttribute('disabled')).toBe(true)
  choose(); fireEvent.click(button)
  expect(ui.start).toHaveBeenCalledWith(expect.objectContaining({ agentId: selection.id, expectedRevision: 2,
    workspaceId: selection.workspaceId, serverName: 'crm', id: expect.any(String) as unknown as string }))
  expect(region(en.observations).getByText(/Reviewer · v2 · Project/)).toBeTruthy()
  expect(screen.getByText(en.noProbes)).toBeTruthy()
  await act(async () => { ui.data.update((state) => { state.stale = true }) })
  expect(screen.getByText(en.stale)).toBeTruthy()
  expect(button.hasAttribute('disabled')).toBe(true)
})
it('renders source-local failures and credential facts and opens the existing repair destinations', () => {
  const rows = [item({ count: 2 }), item({ key: 'credential', kind: 'credential', label: 'API_KEY', state: 'unknown', code: 'credential-undeclared', repair: 'models', source: 'file' }),
    item({ key: 'workspace', kind: 'workspace', label: selection.workspaceId, state: 'missing', code: 'workspace-unavailable', repair: 'workspace' }),
    item({ key: 'skill', kind: 'skills', label: '', state: 'failed', code: 'skills-unavailable', repair: 'agents' }),
    item({ key: 'authorization', kind: 'credential', label: '', state: 'failed', code: 'credential-read-failed', repair: 'settings' })]
  const ui = mount({ report: report(rows) })
  const observations = region(en.observations)
  expect(observations.getByText('API_KEY')).toBeTruthy()
  expect(observations.getByText(en['credential-undeclared'])).toBeTruthy()
  expect(observations.getByText('Project')).toBeTruthy()
  expect(observations.getByText(en.noSkills)).toBeTruthy()
  expect(observations.getByText(/Configuration source: file/)).toBeTruthy()
  for (const [copy, target] of [[en.repairRuntimes, 'runtimes'], [en.repairModels, 'models'], [en.repairWorkspace, 'workspace'], [en.repairAgents, 'agents'], [en.repairSettings, 'settings']] as const) {
    fireEvent.click(observations.getByRole('button', { name: copy }))
    expect(ui.repair).toHaveBeenLastCalledWith(target)
  }
  fireEvent.change(observations.getByRole('combobox'), { target: { value: 'attention' } })
  expect(observations.queryByText('Local runtime')).toBeNull()
  expect(observations.getByText('API_KEY')).toBeTruthy()
})
it('preserves last-known results on disconnect and reports navigation failures without changing configuration', () => {
  const value = report([item({ kind: 'workspace', label: 'removed-workspace' })])
  value.selection = { ...selection, id: 'removed-agent' as never, workspaceId: 'removed-workspace' as never }
  const ui = mount({ report: value, stale: true, error: 'Source offline', checking: true }, false)
  expect(screen.getByText(en.disconnected)).toBeTruthy()
  expect(screen.getByText('Source offline')).toBeTruthy()
  expect(screen.getByText(en.checking)).toBeTruthy()
  expect(screen.getByText(/removed-agent · v2 · removed-workspace/)).toBeTruthy()
  expect((screen.getByRole('button', { name: en.globalCheck })).hasAttribute('disabled')).toBe(true)
  ui.repair.mockImplementationOnce(() => { throw new Error('Settings section unavailable') })
  fireEvent.click(screen.getByRole('button', { name: en.configure }))
  expect(screen.getByText('Settings section unavailable')).toBeTruthy()
  ui.repair.mockImplementationOnce(() => { throw 'Section retired' })
  fireEvent.click(screen.getByRole('button', { name: en.configure }))
  expect(screen.getByText('Section retired')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: en.configure }))
  expect(screen.queryByText('Section retired')).toBeNull()
})
it('retains cancellation and read-only recovery for running and unconfirmed operations across scope changes', () => {
  const pending = { ...request, id: 'unconfirmed' as never, serverName: 'pending-service' }
  const live: HealthProbeRecord = { ...request, status: 'running', startedAt: 1 }
  const ui = mount({ report: report(), probes: [live], pending: [pending], unavailable: [pending.id],
    probeErrors: [{ id: request.id, message: 'Read response lost' }, { id: pending.id, message: 'Admission response lost' }, { id: 'unknown' as never, message: 'Other probe failed' }] })
  choose()
  expect((region(en.connections).getByRole('button', { name: en.probeAgain })).hasAttribute('disabled')).toBe(true)
  const history = region(en.history)
  expect(history.getByText(en.pending)).toBeTruthy()
  expect(history.getByText(en.unavailable)).toBeTruthy()
  fireEvent.click(history.getByRole('button', { name: en.cancel }))
  expect(ui.cancel).toHaveBeenCalledWith(request.id)
  const recover = history.getAllByRole('button', { name: en.recover })
  recover.forEach((button) => { fireEvent.click(button) })
  expect(ui.recover).toHaveBeenCalledWith(request.id); expect(ui.recover).toHaveBeenCalledWith(pending.id)
  fireEvent.click(history.getByRole('button', { name: en.recoverAll }))
  expect(ui.recover).toHaveBeenLastCalledWith()
})
it('separates completed connections from cleanup failure and does not block a freshly checked host on missing old records', async () => {
  const ui = mount({ report: report(), probes: [{ ...complete, agentId: 'old-agent' as never, workspaceId: 'old-workspace' as never, cleanup: 'failed' }] })
  choose()
  const button = region(en.connections).getByRole('button', { name: en.probe })
  expect(button.hasAttribute('disabled')).toBe(true)
  expect(region(en.history).getByText(en.cleanupFailed)).toBeTruthy()
  await act(async () => { ui.data.update((state) => { state.unavailable = [request.id] }) })
  expect(button.hasAttribute('disabled')).toBe(false)
  expect(region(en.history).getByText(/Showing last-known record/)).toBeTruthy()
  await act(async () => { ui.data.update((state) => { state.probes = [{ ...complete, id: 'earlier' as never, startedAt: 0, status: 'failed' }, complete] }) })
  expect(region(en.connections).getByText(en.connected)).toBeTruthy()
  expect(region(en.history).getAllByText(en.closed)).toHaveLength(2)
  await act(async () => { ui.data.update((state) => { state.probes = [{ ...complete, cleanup: 'failed' }] }) })
  expect(region(en.connections).getByText(en.cleanupFailed)).toBeTruthy()
})
it('distinguishes unread, loading, successful empty choices, and explicit empty MCP scopes', async () => {
  const ui = mount({ agents: [], loaded: false, loading: true })
  expect(screen.getByText(en.loading)).toBeTruthy()
  expect(screen.queryByText(en.noAgents)).toBeNull()
  await act(async () => { ui.data.update((state) => { state.loaded = true; state.loading = false }) })
  expect(screen.getByText(en.noAgents)).toBeTruthy()
  await act(async () => { ui.data.update((state) => { state.report = report([]) }) })
  expect(screen.getByText(en.noMcp)).toBeTruthy()
  expect(screen.getByText(en.noMatch)).toBeTruthy()
  await act(async () => { ui.data.update((state) => { state.report = { checkedAt: 1, items: [] }; state.error = 'Directory failed' }) })
  expect(screen.queryByText(en.noAgents)).toBeNull()
  expect(screen.getByText(en.inspectFirst)).toBeTruthy()
})
it('marks archived choices and keeps probes disabled while another matching request is unconfirmed', () => {
  const ui = mount({ report: report(), agents: [{ id: selection.id, revision: 2, name: 'Archived reviewer', archived: true }], pending: [request] })
  choose()
  expect(screen.getByRole('option', { name: /Archived reviewer · Archived/ })).toBeTruthy()
  expect((region(en.connections).getByRole('button', { name: en.probe })).hasAttribute('disabled')).toBe(true)
  expect(ui.start).not.toHaveBeenCalled()
})
it('keeps navigation labeled at both sidebar widths', () => {
  const open = vi.fn()
  const props = { wide: true, t: (key: keyof typeof en) => en[key], open } as Parameters<typeof HealthNavigation>[0]
  const rendered = render(<HealthNavigation {...props} />)
  fireEvent.click(screen.getByRole('button', { name: en.title })); expect(open).toHaveBeenCalledOnce()
  rendered.rerender(<HealthNavigation {...props} wide={false} />)
  expect(screen.getByRole('button', { name: en.title })).toBeTruthy()
})
