// @vitest-environment jsdom
/** Explicit registration, retained retry inputs, and inert historical rendering. */
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createSnapshotStore, type ArtifactSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import type { ArtifactDetail, WorkDetail } from '@deepseek-ai/dsh-api-remotes/client'
import { ArtifactCapture, ArtifactPage } from '../src/client/ArtifactView.tsx'
import { createArtifactViewStore } from '../src/client/store.ts'
import { en } from '../src/client/locales.ts'
afterEach(cleanup)
const ref = { kind: 'agent' as const, id: 'run' as never }
function mount(capture = true, connected = true) {
  const data = createSnapshotStore<ArtifactSnapshot>({ directory: { loading: false, stale: false, error: null },
    preview: { loading: false, error: null }, current: { loading: false, stale: false, error: null }, mutating: false })
  const view = createArtifactViewStore().create()
  const register = vi.fn(async (_request: unknown) => ({ id: 'artifact' as never, version: 1 }))
  const inspect = vi.fn(async () => {}), query = vi.fn(async () => {}), select = vi.fn(async () => {})
  const props = { t: (key: keyof typeof en) => en[key], useArtifacts: bindSnapshotSelector(data),
    useStore: bindSnapshotSelector(view.store),
    actions: view.actions,
    useHostDescription: (selector: (value: unknown) => unknown) => selector(connected ? {} : undefined),
    useWorkspaces: (selector: (value: unknown) => unknown) => selector({ items: [] }),
    useSessions: (selector: (value: unknown) => unknown) => selector({ byId: {} }),
    register, inspect, query, select, more: vi.fn(async () => {}),
    refresh: vi.fn(async () => {}), openRegistered: vi.fn(), openWork: vi.fn(), openSession: vi.fn(),
    detail: { ref, status: 'completed', name: 'Writer',
      sessionId: 'session' as never, workspaceId: 'workspace' as never } satisfies WorkDetail, disabled: false }
  const element = () => capture
    ? <ArtifactCapture {...props as Parameters<typeof ArtifactCapture>[0]} />
    : <ArtifactPage {...props as Parameters<typeof ArtifactPage>[0]} />
  let rendered = render(element())
  return { data, view, props, register, inspect, query, select, remount: () => { rendered.unmount(); rendered = render(element()) } }
}
it('retains the exact uncertain registration across remounts and retries explicitly', async () => {
  const ui = mount()
  ui.register.mockRejectedValueOnce(new Error('Acknowledgment lost'))
  fireEvent.click(screen.getByRole('button', { name: 'Register project artifact' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Registered file path' }), { target: { value: 'report.html' } })
  fireEvent.click(screen.getByRole('button', { name: 'Register file snapshot' }))
  await waitFor(() => { expect(screen.getByRole('alert').textContent).toBe('Acknowledgment lost') })
  const original = ui.register.mock.calls[0]?.[0]
  ui.remount(); expect(ui.register).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: 'Recover original registration' }))
  await waitFor(() => { expect(screen.getByRole('button', { name: 'View registered version' })).toBeTruthy() })
  expect(ui.register.mock.calls[1]?.[0]).toEqual(original)
  expect(ui.view.store.getSnapshot().pending).toBeNull()
})
it('renders retained HTML as text and performs current-file checks only on explicit clicks', async () => {
  const ui = mount(false)
  const origin = { kind: 'current-file', source: { ref, name: 'Writer', sessionId: 'missing', workspaceId: 'workspace', status: 'completed' } }
  const version = { version: 1, capturedAt: 1, bytes: 29, sha256: 'digest', encoding: 'utf-8', origin }
  const detail = { entry: { id: 'artifact', workspaceId: 'workspace', workspacePath: '/project', path: 'report.html', latest: version },
    versions: [version], snapshot: { ...version, content: '<script>executed=true</script>' } } as unknown as ArtifactDetail
  ui.data.set({ ...ui.data.getSnapshot(), preview: { target: { id: detail.entry.id, version: 1 }, detail, loading: false, error: null } })
  await waitFor(() => { expect(screen.getByText('<script>executed=true</script>')).toBeTruthy() })
  expect(document.querySelector('script')).toBeNull(); expect(ui.inspect).not.toHaveBeenCalled()
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Open original session' }).disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Inspect current file' })); expect(ui.inspect).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: 'Register current file as a new version' }))
  await waitFor(() => { expect(ui.register).toHaveBeenCalledWith(expect.objectContaining({ id: 'artifact', expectedVersion: 1, source: { kind: 'current-file', ref } })) })
})
it('disables mutations when disconnected and submits explicit dimension controls', () => {
  const ui = mount(false, false)
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Apply filters' }).disabled).toBe(true)
  expect(screen.getByRole('status').textContent).toContain('Disconnected')
  expect(ui.register).not.toHaveBeenCalled(); expect(ui.query).not.toHaveBeenCalled()
})
