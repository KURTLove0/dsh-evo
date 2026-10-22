// @vitest-environment jsdom
/** Metadata-only archive filtering, mutation feedback, and preserved recovery controls. */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore, type SessionListState, type WorkspaceListState } from '@deepseek-ai/dsh-client-runtime/client'
import { ArchivePage, ArchiveNavigation, type ArchivePageProps } from '../src/client/ArchivePage.tsx'
import { createArchiveViewStore, deriveArchivedRows } from '../src/client/archive.ts'
import { en } from '../src/client/locales.ts'
afterEach(cleanup)
const sid = (id: string) => id as never
const t: ArchivePageProps['t'] = (key, values) => Object.entries(values ?? {}).reduce((text, [name, value]) => text.replace(`{${name}}`, String(value)), en[key as keyof typeof en])
function mount(connected = true, patch: Partial<WorkspaceListState> = {}, limit = 20) {
  const sessions = createSnapshotStore<SessionListState>({ byId: {
    [sid('first')]: { id: sid('first'), displayTitle: 'First report', blank: false, running: false, updatedAt: 1 },
    [sid('other')]: { id: sid('other'), displayTitle: 'Other report', blank: false, running: false, updatedAt: 2 },
  }, ids: [sid('first'), sid('other')], phase: 'ready', current: undefined, currentAddress: undefined, subagentsByParent: {}, jobsBySession: {} })
  const workspaces = createSnapshotStore<WorkspaceListState>({ items: [{ workspaceId: sid('project'), title: 'Project', path: '/project', sessionIds: [sid('first')], createdAt: '', updatedAt: '' }],
    archivedSessionIds: [sid('first'), sid('other'), sid('missing')], state: 'idle', phase: 'ready', baselinesReady: true, error: null, recentWorkspaceId: undefined, ...patch })
  const view = createArchiveViewStore().create(), restore = vi.fn(async (_id: unknown) => {}), refresh = vi.fn(async () => {})
  const props: ArchivePageProps = { t, useSessions: bindSnapshotSelector(sessions), useWorkspaces: bindSnapshotSelector(workspaces),
    useHostDescription: select => select(connected ? {} as never : undefined),
    useStore: bindSnapshotSelector(view.store), actions: view.actions,
    restore, refresh, limit }
  const rendered = render(<ArchivePage {...props} />)
  return { sessions, workspaces, view, restore, refresh, props, rendered }
}
it('keeps missing metadata, filters title and ID within actual accounting, and bounds the visible prefix', () => {
  const ui = mount(true, {}, 1)
  expect(screen.getByText(en['archive.unknown'])).toBeTruthy()
  expect(screen.getByText(en['archive.missing'])).toBeTruthy()
  expect(screen.getByText(t('search.hasMore', { n: 1 }))).toBeTruthy()
  fireEvent.change(screen.getByLabelText(en['archive.search']), { target: { value: ' FIRST ' } })
  expect(screen.getByRole('heading', { name: 'First report' })).toBeTruthy()
  fireEvent.change(screen.getByLabelText(en['archive.workspace']), { target: { value: '@ungrouped' } })
  expect(screen.getByText(en['empty.noMatches'])).toBeTruthy()
  fireEvent.change(screen.getByLabelText(en['archive.search']), { target: { value: '' } })
  expect(screen.getByText(en['archive.unknown'])).toBeTruthy()
  act(() => { ui.view.actions.workspace('project') })
  expect(screen.getByRole('heading', { name: 'First report' })).toBeTruthy()
  const result = deriveArchivedRows(ui.sessions.getSnapshot(), ui.workspaces.getSnapshot(), { query: 'other', workspace: '' }, 20)
  expect(result).toMatchObject({ total: 1, items: [{ id: 'other', title: 'Other report' }] })
  ui.rendered.unmount(); render(<ArchivePage {...ui.props} />)
  expect(screen.getByLabelText<HTMLSelectElement>(en['archive.workspace']).value).toBe('project')
})
it('waits for a committed restoration, removes the row through the shared feed, and moves focus to feedback', async () => {
  const ui = mount()
  let finish!: () => void
  ui.restore.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve }))
  const button = screen.getByRole('button', { name: 'Restore “First report”' })
  fireEvent.click(button)
  expect(button.hasAttribute('disabled')).toBe(true)
  expect(screen.getByRole('button', { name: 'Restore “Other report”' }).hasAttribute('disabled')).toBe(true)
  await act(async () => { ui.workspaces.update((state) => { state.archivedSessionIds = [sid('other')] }); finish() })
  expect(ui.restore).toHaveBeenCalledWith('first')
  expect(screen.queryByRole('heading', { name: 'First report' })).toBeNull()
  expect(document.activeElement?.textContent).toBe(en['archive.restored'])
})
it('retains recoverable rows on failed writes and handles refresh failures without erasing metadata', async () => {
  const ui = mount()
  ui.restore.mockRejectedValueOnce(new Error('Storage down')).mockRejectedValueOnce('Connection lost')
  fireEvent.click(screen.getByRole('button', { name: 'Restore “First report”' }))
  await screen.findByText('Storage down')
  fireEvent.click(screen.getByRole('button', { name: 'Restore “First report”' }))
  await screen.findByText('Connection lost')
  expect(screen.getByRole('heading', { name: 'First report' })).toBeTruthy()
  ui.refresh.mockRejectedValueOnce(new Error('Read failed')).mockRejectedValueOnce('Wire failed')
  fireEvent.click(screen.getByRole('button', { name: en['archive.refresh'] })); await screen.findByText('Read failed')
  fireEvent.click(screen.getByRole('button', { name: en['archive.refresh'] })); await screen.findByText('Wire failed')
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: en['archive.refresh'] })) })
  expect(screen.queryByRole('alert')).toBeNull()
})
it('labels disconnection and baseline failure and never turns an unready list into an empty archive', async () => {
  const ui = mount(false)
  expect(screen.getByText(en['archive.disconnected'])).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Restore “missing”' }).hasAttribute('disabled')).toBe(true)
  ui.rendered.unmount()
  const loading = mount(true, { state: 'error', error: { code: 'internal', message: 'Archive unavailable', details: {} }, archivedSessionIds: [] })
  expect(screen.getByText(en['archive.unready'])).toBeTruthy()
  expect(screen.getByRole('alert').textContent).toBe('Archive unavailable')
  expect(screen.queryByText(en['archive.empty'])).toBeNull()
  await act(async () => { loading.workspaces.update((state) => { state.state = 'idle'; state.error = null }) })
  expect(screen.getByText(en['archive.empty'])).toBeTruthy()
  await act(async () => { loading.sessions.update((state) => { state.phase = 'pending' }) })
  expect(screen.getByText(en['archive.unready'])).toBeTruthy()
  await act(async () => { loading.workspaces.update((state) => { state.baselinesReady = false }) })
  expect(screen.queryByText('Matching archived sessions: 0')).toBeNull()
})
it('opens archive navigation with the same accessible name in wide and collapsed sidebars', () => {
  const open = vi.fn(), props = { t, open, wide: true } as Parameters<typeof ArchiveNavigation>[0]
  const ui = render(<ArchiveNavigation {...props} />)
  fireEvent.click(screen.getByRole('button', { name: en['archive.title'] }))
  expect(open).toHaveBeenCalledOnce()
  ui.rerender(<ArchiveNavigation {...props} wide={false} />)
  expect(screen.getByRole('button', { name: en['archive.title'] })).toBeTruthy()
})
