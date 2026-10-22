// @vitest-environment jsdom
/** Explicit grants, immutable selections, inert content, and retained uncertainty through framework shares. */
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createSnapshotStore, type KnowledgeSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import type { KnowledgeExcerpt, KnowledgeSource } from '@deepseek-ai/dsh-api-remotes/client'
import { KnowledgePage, KnowledgeNavigation, citationText } from '../src/client/KnowledgeView.tsx'
import { createKnowledgeViewStore } from '../src/client/store.ts'
import { en, zh } from '../src/client/locales.ts'
afterEach(cleanup)
const source: KnowledgeSource = { id: 'source' as never, workspaceId: 'workspace' as never, workspacePath: '/project', path: 'source.md',
  enabled: true, revision: 2, versions: [{ version: 1, capturedAt: 1, textSha256: 'digest', bytes: 12, lines: 2 }],
  lastAttempt: { state: 'ready', version: 1, completedAt: 1 } }
const excerpt: KnowledgeExcerpt = { citation: { sourceId: source.id, version: 1, textSha256: 'digest', startLine: 1, endLine: 2 },
  path: source.path, text: '<script>globalThis.executed=true</script>\nCaptured text',
  current: { sourceId: source.id, state: 'different', textSha256: 'current-digest', observedAt: 1 } }
function mount(connected = true, chinese = false) {
  const data = createSnapshotStore<KnowledgeSnapshot>({ workspace: source.workspaceId, sources: [source],
    options: { maxSources: 64, maxVersions: 20, maxFileBytes: 100, maxQueryBytes: 512, maxHits: 5 },
    loading: false, stale: false, error: null, searching: false, searchError: null,
    reading: false, readError: null, writing: false, writeError: null })
  const view = createKnowledgeViewStore().create()
  const labels = chinese ? zh : en
  const props = { t: (key: keyof typeof en) => labels[key], useKnowledge: bindSnapshotSelector(data),
    useStore: bindSnapshotSelector(view.store),
    actions: view.actions, useHostDescription: (selector: (value: unknown) => unknown) => selector(connected ? {} : undefined),
    useWorkspaces: (selector: (value: unknown) => unknown) => selector({ items: [{ workspaceId: source.workspaceId, title: 'Project' }] }),
    refresh: vi.fn(async () => {}), select: vi.fn(async (_value: unknown) => {}), read: vi.fn(async (_value: unknown) => {}),
    search: vi.fn(async (_text: string, _limit: number) => {}), clearPreview: vi.fn(), command: vi.fn(async (_value: unknown) => {}),
    discard: vi.fn(), copy: vi.fn(async (_value: string) => {}) }
  const element = () => <KnowledgePage {...props as Parameters<typeof KnowledgePage>[0]} />
  let result = render(element())
  return { data, view, props, labels, remount: () => { result.unmount(); result = render(element()) } }
}
it('submits explicit registration/search input and keeps drafts through remounts', async () => {
  const ui = mount()
  fireEvent.change(screen.getByRole('textbox', { name: en.path }), { target: { value: 'notes.ts' } })
  fireEvent.click(screen.getByRole('button', { name: en.register }))
  expect(ui.props.command).toHaveBeenCalledWith(expect.objectContaining({ kind: 'register', request: expect.objectContaining({ workspaceId: source.workspaceId, path: 'notes.ts' }) as unknown }))
  fireEvent.change(screen.getByRole('searchbox', { name: en.query }), { target: { value: '中文材料' } })
  fireEvent.click(screen.getByRole('button', { name: en.search })); expect(ui.props.search).toHaveBeenCalledWith('中文材料', 5)
  fireEvent.change(screen.getByRole('spinbutton', { name: en.hitLimit }), { target: { value: '2' } })
  fireEvent.click(screen.getByRole('button', { name: en.search })); expect(ui.props.search).toHaveBeenLastCalledWith('中文材料', 2)
  ui.remount(); expect(screen.getByRole<HTMLInputElement>('textbox', { name: en.path }).value).toBe('notes.ts')
  fireEvent.click(screen.getByRole('button', { name: en.refresh })); expect(ui.props.refresh).toHaveBeenCalledOnce()
  fireEvent.change(screen.getByRole('combobox', { name: en.workspace }), { target: { value: '' } })
  expect(ui.props.select).toHaveBeenCalledWith(undefined)
  fireEvent.change(screen.getByRole('combobox', { name: en.workspace }), { target: { value: 'workspace' } })
  expect(ui.props.select).toHaveBeenLastCalledWith('workspace')
  await waitFor(() => { expect(ui.view.store.getSnapshot().text).toBe('中文材料') })
})
it('pins source/version/line inputs and never reads content on selecting a source', async () => {
  const ui = mount(), newer = { ...source, versions: [...source.versions, { ...source.versions[0]!, version: 2 }] }
  ui.data.set({ ...ui.data.getSnapshot(), sources: [newer] })
  await waitFor(() => { expect(screen.getByRole('button', { name: /source.md/ })).toBeTruthy() })
  fireEvent.click(screen.getByRole('button', { name: /source.md/ })); expect(ui.props.read).not.toHaveBeenCalled()
  await waitFor(() => { expect(screen.getByRole<HTMLSelectElement>('combobox', { name: en.version }).value).toBe('2') })
  fireEvent.change(screen.getByRole('combobox', { name: en.version }), { target: { value: '1' } })
  fireEvent.change(screen.getByRole('spinbutton', { name: en.start }), { target: { value: '2' } })
  fireEvent.change(screen.getByRole('spinbutton', { name: en.end }), { target: { value: '1' } })
  fireEvent.change(screen.getByRole('spinbutton', { name: en.end }), { target: { value: '2' } })
  fireEvent.submit(screen.getByRole('form', { name: en.preview }))
  expect(ui.props.read).toHaveBeenCalledWith({ ...excerpt.citation, startLine: 2, endLine: 2 })
  fireEvent.click(screen.getByRole('button', { name: en.disable }))
  expect(ui.props.command).toHaveBeenCalledWith({ kind: 'setEnabled', request: { id: source.id, expectedRevision: source.revision, enabled: false } })
  fireEvent.click(screen.getByRole('button', { name: en.index }))
  expect(ui.props.command).toHaveBeenCalledWith(expect.objectContaining({ kind: 'index' }))
  fireEvent.change(screen.getByRole('combobox', { name: en.version }), { target: { value: '' } })
  expect(ui.view.store.getSnapshot().version).toBe(1)
  expect(ui.props.clearPreview).toHaveBeenCalledTimes(3)
})
it('renders exact inert excerpts, independent freshness, and copied citation fields', async () => {
  const ui = mount()
  ui.data.set({ ...ui.data.getSnapshot(), excerpt, result: { query: { workspaceId: source.workspaceId, text: 'Captured', limit: 1 },
    value: { hits: [{ citation: excerpt.citation, text: 'Captured text', path: source.path }], more: true, observedAt: 1,
      current: [excerpt.current], excluded: [{ sourceId: source.id, message: 'Read denied' }, { sourceId: 'missing' as never, message: 'Unavailable' }] } } })
  await waitFor(() => { expect(screen.getByText(excerpt.text, { normalizer: value => value })).toBeTruthy() })
  expect(document.querySelector('script')).toBeNull()
  expect(JSON.parse(citationText(excerpt)) as unknown).toEqual({ path: source.path, ...excerpt.citation })
  fireEvent.click(screen.getByRole('button', { name: en.copy }))
  await waitFor(() => { expect(screen.getByText(en.copied)).toBeTruthy() })
  expect(ui.props.copy).toHaveBeenCalledWith(citationText(excerpt))
  ui.props.copy.mockRejectedValueOnce(new Error('Clipboard denied'))
  fireEvent.click(screen.getByRole('button', { name: en.copy }))
  await waitFor(() => { expect(screen.getByText(en.copyFailed)).toBeTruthy() })
  fireEvent.click(screen.getByRole('button', { name: en.read })); expect(ui.props.read).toHaveBeenCalledWith(excerpt.citation)
  expect(screen.getByText(en.more)).toBeTruthy(); expect(screen.getByText(/source.md: Read denied/)).toBeTruthy()
})
it('shows disabled grants, indexing failure and empty search separately, with explicit re-enable', async () => {
  const ui = mount(), disabled = { ...source, enabled: false, lastAttempt: { state: 'failed' as const, completedAt: 2, message: 'File missing' } }
  ui.data.set({ ...ui.data.getSnapshot(), sources: [disabled], result: { query: { workspaceId: source.workspaceId, text: 'other', limit: 1 }, value: { hits: [], more: false, current: [], excluded: [], observedAt: 1 } } })
  fireEvent.click(screen.getByRole('button', { name: /source.md/ }))
  await waitFor(() => { expect(screen.getByText('File missing')).toBeTruthy() })
  expect(screen.getByText(en.noResults)).toBeTruthy()
  expect(screen.getByRole<HTMLButtonElement>('button', { name: en.index }).disabled).toBe(true)
  expect(screen.getByRole<HTMLButtonElement>('button', { name: en.read }).disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: en.enable }))
  expect(ui.props.command).toHaveBeenCalledWith({ kind: 'setEnabled', request: { id: source.id, expectedRevision: source.revision, enabled: true } })
})
it('keeps unconfirmed commands visible through remounts and permits only explicit retry or local discard', async () => {
  const ui = mount(), pending = { kind: 'register' as const, request: { id: 'original' as never, workspaceId: source.workspaceId, path: 'notes.ts' } }
  ui.data.set({ ...ui.data.getSnapshot(), pending, writeError: 'Acknowledgment lost', stale: true, error: 'Offline' })
  await waitFor(() => { expect(screen.getByText('Acknowledgment lost')).toBeTruthy() })
  ui.remount(); expect(ui.props.command).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: en.retry })); expect(ui.props.command).toHaveBeenCalledWith(pending)
  fireEvent.click(screen.getByRole('button', { name: en.discard })); expect(ui.props.discard).toHaveBeenCalledOnce()
  ui.data.set({ ...ui.data.getSnapshot(), writing: true })
  await waitFor(() => { expect(screen.getByText(en.writing)).toBeTruthy() })
  expect(screen.getByRole<HTMLButtonElement>('button', { name: en.retry }).disabled).toBe(true)
  expect(screen.getByRole<HTMLButtonElement>('button', { name: en.discard }).disabled).toBe(true)
})
it('handles unindexed/empty workspaces, disconnected controls, loading and read diagnostics in Chinese', async () => {
  const ui = mount(false, true), unindexed = { ...source, versions: [], lastAttempt: undefined } as unknown as KnowledgeSource
  const { options: _options, ...withoutOptions } = ui.data.getSnapshot()
  ui.data.set({ ...withoutOptions, sources: [unindexed], loading: true, reading: true,
    searching: true, readError: 'Read denied', searchError: 'Query failed', acknowledged: { kind: 'register', sourceId: source.id, workspaceId: source.workspaceId, path: source.path } })
  await waitFor(() => { expect(screen.getByRole('main', { name: zh.title })).toBeTruthy() })
  fireEvent.click(screen.getByRole('button', { name: /source.md/ }))
  expect(screen.getByRole<HTMLButtonElement>('button', { name: zh.index }).disabled).toBe(true)
  expect(screen.getByText(zh.offline)).toBeTruthy(); expect(screen.getByText('Query failed')).toBeTruthy()
  ui.data.set({ ...ui.data.getSnapshot(), sources: [], loading: false, reading: false, searching: false, stale: false })
  await waitFor(() => { expect(screen.getByText(zh.empty)).toBeTruthy() })
  expect(ui.props.read).not.toHaveBeenCalled(); expect(ui.props.command).not.toHaveBeenCalled()
})
it('provides labelled wide and collapsed navigation', () => {
  const open = vi.fn(), t = (key: keyof typeof en) => en[key]
  const view = render(<KnowledgeNavigation {...{ wide: true, t, open } as Parameters<typeof KnowledgeNavigation>[0]} />)
  fireEvent.click(screen.getByRole('button', { name: en.title })); expect(open).toHaveBeenCalledOnce()
  view.rerender(<KnowledgeNavigation {...{ wide: false, t, open } as Parameters<typeof KnowledgeNavigation>[0]} />)
  expect(screen.getByRole('button', { name: en.title })).toBeTruthy()
})
it('keeps actions unavailable before a workspace or deployment limits are loaded', async () => {
  const ui = mount(), { workspace: _workspace, options: _options, ...loading } = ui.data.getSnapshot()
  ui.data.set({ ...loading, sources: [] })
  await waitFor(() => { expect(screen.getByRole<HTMLSelectElement>('combobox', { name: en.workspace }).value).toBe('') })
  fireEvent.submit(screen.getByRole('form', { name: en.register }))
  fireEvent.submit(screen.getByRole('searchbox', { name: en.query }).closest('form')!)
  expect(ui.props.command).not.toHaveBeenCalled(); expect(ui.props.search).not.toHaveBeenCalled()
  ui.data.set({ ...ui.data.getSnapshot(), result: { query: { workspaceId: source.workspaceId, text: 'old', limit: 1 },
    value: { hits: [], more: false, excluded: [], observedAt: 1, current: [{ ...excerpt.current, sourceId: 'missing' as never }] } } })
  await waitFor(() => { expect(screen.getByText(/missing · Differs/)).toBeTruthy() })
})
it('shows the original acknowledged index attempt independently of newer source metadata', async () => {
  const ui = mount()
  ui.data.set({ ...ui.data.getSnapshot(), sources: [{ ...source, versions: [...source.versions, { ...source.versions[0]!, version: 2 }] }],
    acknowledged: { kind: 'index', sourceId: source.id, path: source.path, workspaceId: source.workspaceId,
      attempt: { state: 'ready', version: 1, completedAt: 1 } } })
  const receipt = await screen.findByRole('region', { name: en.receipt })
  expect(receipt.textContent).toContain('Capture saved · v1')
  ui.data.set({ ...ui.data.getSnapshot(), acknowledged: { kind: 'index', sourceId: source.id, path: source.path, workspaceId: source.workspaceId,
    attempt: { state: 'failed', completedAt: 2, message: 'Original capture failed' } } })
  await waitFor(() => { expect(receipt.textContent).toContain('Original capture failed') })
  ui.data.set({ ...ui.data.getSnapshot(), pending: { kind: 'index', request: { id: source.id, expectedRevision: 1, requestId: 'original' as never } } })
  const pending = await screen.findByRole('region', { name: en.pending })
  expect(pending.textContent).toContain(source.path)
  ui.data.set({ ...ui.data.getSnapshot(), pending: { kind: 'setEnabled', request: { id: 'missing-source' as never, expectedRevision: 1, enabled: false } } })
  await waitFor(() => { expect(pending.textContent).toContain('missing-source') })
})
