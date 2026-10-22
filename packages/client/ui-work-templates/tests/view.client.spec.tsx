// @vitest-environment jsdom
/** Visible template copying, explicit version application, and transport retry behavior. */
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import type { TemplateSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import type { TemplateRecord, TaskBrief } from '@deepseek-ai/dsh-api-remotes/client'
import { TemplateIntake, TemplatePage } from '../src/client/TemplateView.tsx'
import { TemplateNavigation } from '../src/client/navigation.tsx'
import { createTemplateViewStore } from '../src/client/store.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)
const brief: TaskBrief = { version: 1, goal: 'Review report', background: '', deliverables: [], acceptanceCriteria: ['Cite sources'], constraints: 'Read only' }
const record = (): TemplateRecord => ({ id: 'template' as never, revision: 2, archived: false, versions: [
  { version: 1, name: 'Original', createdAt: 1, content: { kind: 'task', brief } },
  { version: 2, name: 'Current', createdAt: 2, content: { kind: 'task', brief: { ...brief, goal: 'Review revised report' } } },
] })
function mount(intake = true, patch: Partial<TemplateSnapshot> = {}, connected = true, task: TaskBrief = brief) {
  const current = record()
  const data = createSnapshotStore<TemplateSnapshot>({ items: [{ id: current.id, name: 'Current', version: 2, revision: 2, archived: false, kind: 'task' }],
    record: current, selected: current.id, examples: [{ id: 'documents', brief }], sources: [], loading: false, error: null, ...patch })
  const view = createTemplateViewStore().create()
  const command = vi.fn(async (_request: unknown) => ({ id: current.id, version: 3, revision: 3 }))
  const copy = vi.fn(async (_request: unknown) => ({ workflowId: 'copy' as never }))
  const load = vi.fn(), select = vi.fn(async () => {}), refresh = vi.fn(async () => {}), openWork = vi.fn(), openWorkflow = vi.fn()
  const props = { t: (key: keyof typeof en) => en[key], useTemplates: bindSnapshotSelector(data),
    useHostDescription: (selector: (value: unknown) => unknown) => selector(connected ? {} : undefined),
    useWorkspaces: (selector: (value: unknown) => unknown) =>
      selector({ items: [{ workspaceId: 'workspace', title: 'Project' }] }),
    useSessions: () => ({}), useStore: bindSnapshotSelector(view.store), actions: view.actions,
    command, copy, select, refresh, openWork, openWorkflow, brief: task, load, disabled: false }
  const element = () => intake
    ? <TemplateIntake {...props as Parameters<typeof TemplateIntake>[0]} />
    : <TemplatePage {...props as Parameters<typeof TemplatePage>[0]} />
  let rendered = render(element())
  const remount = () => { rendered.unmount(); rendered = render(element()) }
  return { data, view, command, copy, load, select, refresh, openWork, openWorkflow, remount }
}
it('loads an explicit old version and examples, and reuses failed save IDs', async () => {
  const ui = mount()
  fireEvent.change(screen.getByRole<HTMLSelectElement>('combobox', { name: en.version }), { target: { value: '1' } })
  fireEvent.click(screen.getByRole<HTMLButtonElement>('button', { name: en.load }))
  expect(ui.load).toHaveBeenCalledWith({ ...brief, template: { id: 'template', version: 1 } })
  fireEvent.click(screen.getByRole<HTMLButtonElement>('button', { name: en.documents }))
  expect(ui.load).toHaveBeenLastCalledWith(brief)
  fireEvent.change(screen.getByLabelText(en.name), { target: { value: 'Saved review' } })
  ui.command.mockRejectedValueOnce(new Error('Offline'))
  fireEvent.click(screen.getByRole<HTMLButtonElement>('button', { name: en.save }))
  await screen.findByText('Offline')
  const first = ui.command.mock.calls[0]![0] as { requestId: string }
  fireEvent.click(screen.getByRole<HTMLButtonElement>('button', { name: en.save }))
  await screen.findByText(en.saved)
  expect(ui.command.mock.calls[1]![0]).toEqual(first)
  fireEvent.click(screen.getByRole<HTMLButtonElement>('button', { name: en.update }))
  await waitFor(() => { expect(ui.command).toHaveBeenCalledWith(expect.objectContaining({ id: 'template', expectedRevision: 2 })) })
  fireEvent.change(screen.getByRole<HTMLSelectElement>('combobox', { name: en.select }), { target: { value: 'template' } })
  expect(ui.select).toHaveBeenCalledWith('template')
})
it('disables unavailable task sources and exposes read failures', () => {
  const ui = mount(true, { error: 'Read failed', record: undefined, items: [] }, false)
  expect(screen.getByRole('alert').textContent).toBe('Read failed')
  expect((screen.getByRole<HTMLButtonElement>('button', { name: en.load })).disabled).toBe(true)
  ui.data.update((state) => { state.record = { ...record(), archived: true } })
})
it('keeps an empty disconnected directory explicit', () => {
  mount(false, { items: [], record: undefined }, false)
  expect(screen.queryByText(en.empty)).toBeNull()
  expect(screen.getByText(en.disconnected)).toBeTruthy()
})
it('saves workflow versions, archives, restores, and copies only with an explicit destination', async () => {
  const workflow: TemplateRecord = { ...record(), versions: [{ version: 1, name: 'Approval', createdAt: 1,
    content: { kind: 'workflow', workflowId: 'source' as never, versionId: 'publication' as never,
      definition: { requirement: { summary: 'Approval', objectives: [{ id: 'review', statement: 'Confirm evidence' }], inputs: [{ name: 'report', description: 'Source report' }], outputs: [], constraints: [], acceptanceCases: [] },
        nodes: [{ id: 'review', kind: 'approval', title: 'Review', preset: 'standard', instruction: 'Confirm', dependsOn: [], inputs: [], objectives: [] },
          { id: 'write', kind: 'agent', title: 'Write', preset: 'standard', instruction: 'Write', dependsOn: ['review'], inputs: [], objectives: [] }],
        finalOutputs: [], positions: {} } } }] }
  const ui = mount(false, { record: workflow, sources: [{ id: 'source' as never, name: 'Source', versions: [{ id: 'publication' as never, number: 1 }] }] })
  fireEvent.click(screen.getByRole<HTMLButtonElement>('button', { name: /Current/ }))
  expect(ui.select).toHaveBeenCalled()
  fireEvent.change(screen.getByRole<HTMLSelectElement>('combobox', { name: en.source }), { target: { value: 'source' } })
  fireEvent.change(screen.getByRole<HTMLSelectElement>('combobox', { name: en.publication }), { target: { value: 'publication' } })
  fireEvent.change(screen.getByLabelText(en.name), { target: { value: 'New approval' } })
  fireEvent.click(screen.getByRole<HTMLButtonElement>('button', { name: en.saveWorkflow }))
  await waitFor(() => { expect(ui.command).toHaveBeenCalledWith(expect.objectContaining({ kind: 'save-workflow', expectedRevision: 0 })) })
  await waitFor(() => { expect((screen.getByRole<HTMLButtonElement>('button', { name: en.update })).disabled).toBe(false) })
  fireEvent.click(screen.getByRole<HTMLButtonElement>('button', { name: en.update }))
  await waitFor(() => { expect(ui.command).toHaveBeenCalledWith(expect.objectContaining({ kind: 'save-workflow', id: 'template', expectedRevision: 2 })) })
  fireEvent.change(screen.getByRole<HTMLSelectElement>('combobox', { name: en.workspace }), { target: { value: 'workspace' } })
  fireEvent.change(screen.getByLabelText(en.copyName), { target: { value: 'Copied approval' } })
  await waitFor(() => { expect((screen.getByRole<HTMLButtonElement>('button', { name: en.copy })).disabled).toBe(false) })
  ui.copy.mockRejectedValueOnce('Connection lost')
  fireEvent.click(screen.getByRole<HTMLButtonElement>('button', { name: en.copy }))
  await screen.findByText('Connection lost')
  ui.remount()
  fireEvent.click(screen.getByRole<HTMLButtonElement>('button', { name: en.copy }))
  await screen.findByText(en.copied)
  expect(ui.copy.mock.calls[1]).toEqual(ui.copy.mock.calls[0])
  fireEvent.click(screen.getByRole<HTMLButtonElement>('button', { name: en.archive }))
  await waitFor(() => { expect(ui.command).toHaveBeenCalledWith(expect.objectContaining({ kind: 'archive', archived: true })) })
  ui.data.update((state) => { state.record = { ...workflow, archived: true, revision: 3 } })
  await screen.findByText(en.archivedHint)
  await waitFor(() => { expect((screen.getByRole<HTMLButtonElement>('button', { name: en.restore })).disabled).toBe(false) })
  ui.command.mockRejectedValueOnce(new Error('Stale revision'))
  fireEvent.click(screen.getByRole<HTMLButtonElement>('button', { name: en.restore }))
  await screen.findByText('Stale revision')
  const failedRestore = ui.command.mock.calls.at(-1)
  fireEvent.click(screen.getByRole<HTMLButtonElement>('button', { name: en.restore }))
  await waitFor(() => { expect(ui.command.mock.calls.at(-1)).toEqual(failedRestore) })
  fireEvent.click(screen.getByRole<HTMLButtonElement>('button', { name: en.openWorkflow })); expect(ui.openWorkflow).toHaveBeenCalled()
  fireEvent.click(screen.getByRole<HTMLButtonElement>('button', { name: en.openWork })); expect(ui.openWork).toHaveBeenCalled()
  fireEvent.click(screen.getByRole<HTMLButtonElement>('button', { name: en.refresh })); expect(ui.refresh).toHaveBeenCalled()
})
it('explains task reuse and supports sidebar navigation at both widths', () => {
  mount(false)
  expect(screen.getByText(en.taskHint)).toBeTruthy()
  cleanup()
  const open = vi.fn()
  const props = { wide: true, t: (key: keyof typeof en) => en[key], open } as Parameters<typeof TemplateNavigation>[0]
  const rendered = render(<TemplateNavigation {...props} />)
  fireEvent.click(screen.getByRole<HTMLButtonElement>('button', { name: en.title })); expect(open).toHaveBeenCalled()
  rendered.rerender(<TemplateNavigation {...props} wide={false} />)
  expect(screen.getByRole<HTMLButtonElement>('button', { name: en.title })).toBeTruthy()
})

it('retains provenance, reports string failures, and resolves a stale selected version against a new history', async () => {
  const ui = mount(true, {}, true, { ...brief, template: { id: 'source-template' as never, version: 1 } })
  expect(screen.getByText('source-template')).toBeTruthy()
  fireEvent.change(screen.getByLabelText(en.name), { target: { value: 'New template' } })
  fireEvent.change(screen.getByRole<HTMLSelectElement>('combobox', { name: en.version }), { target: { value: '2' } })
  ui.command.mockRejectedValueOnce('Transport unavailable')
  fireEvent.click(screen.getByRole<HTMLButtonElement>('button', { name: en.save }))
  await screen.findByText('Transport unavailable')
  ui.data.update((state) => { state.record = { ...record(), versions: [record().versions[0]!] } })
  await waitFor(() => { expect((screen.getByRole<HTMLSelectElement>('combobox', { name: en.version })).value).toBe('1') })
})
it('shows archived summaries and host read errors, and switches content versions in the library', async () => {
  const ui = mount(false, { error: 'Host read failed', items: [{ id: 'template' as never, revision: 3, archived: true, kind: 'task', name: 'Archived task', version: 2 }] })
  expect(screen.getByRole('alert').textContent).toBe('Host read failed')
  expect(screen.getByRole<HTMLButtonElement>('button', { name: /Archived task/ }).textContent).toContain(en.archived)
  fireEvent.change(screen.getByRole<HTMLSelectElement>('combobox', { name: en.version }), { target: { value: '1' } })
  expect(ui.view.store.getSnapshot().version).toBe(1)
})

it('retries the original version write after its commit event and a page remount arrive before its lost acknowledgment', async () => {
  const ui = mount()
  fireEvent.change(screen.getByLabelText(en.name), { target: { value: 'Reviewed template' } })
  ui.command.mockRejectedValueOnce(new Error('Acknowledgment lost'))
  fireEvent.click(screen.getByRole<HTMLButtonElement>('button', { name: en.update }))
  await screen.findByText('Acknowledgment lost')
  const original = ui.command.mock.calls[0]![0]
  ui.data.update((state) => { state.record = { ...record(), revision: 3 } })
  ui.remount()
  fireEvent.click(screen.getByRole<HTMLButtonElement>('button', { name: en.update }))
  await screen.findByText(en.saved)
  expect(ui.command.mock.calls[1]![0]).toEqual(original)
})

it('lets an operator discard a failed request before starting an edit at a newer revision', async () => {
  const ui = mount()
  fireEvent.change(screen.getByLabelText(en.name), { target: { value: 'Rechecked template' } })
  ui.command.mockRejectedValueOnce(new Error('Another editor saved'))
  fireEvent.click(screen.getByRole<HTMLButtonElement>('button', { name: en.update }))
  await screen.findByText('Another editor saved')
  const original = ui.command.mock.calls[0]![0]
  ui.data.update((state) => { state.record = { ...record(), revision: 3 } })
  fireEvent.click(screen.getByRole<HTMLButtonElement>('button', { name: en.discardRetry }))
  expect(ui.refresh).toHaveBeenCalled()
  fireEvent.click(screen.getByRole<HTMLButtonElement>('button', { name: en.update }))
  await screen.findByText(en.saved)
  expect(ui.command.mock.calls[1]![0]).toMatchObject({ expectedRevision: 3 })
  expect(ui.command.mock.calls[1]![0]).not.toEqual(original)
})
it('discards a failed library mutation without removing template history', async () => {
  const ui = mount(false)
  ui.command.mockRejectedValueOnce('Request failed')
  fireEvent.click(screen.getByRole<HTMLButtonElement>('button', { name: en.archive }))
  await screen.findByText('Request failed')
  fireEvent.click(screen.getByRole<HTMLButtonElement>('button', { name: en.discardRetry }))
  expect(ui.view.store.getSnapshot().mutationRequest).toBeNull()
  expect(ui.data.getSnapshot().record?.versions).toHaveLength(2)
})
it('does not discard a newer draft request when an earlier response arrives', () => {
  const view = createTemplateViewStore().create()
  const request = { kind: 'save-task' as const, expectedRevision: 0, requestId: 'new' as never, name: 'Draft', brief }
  view.actions.stageMutation({ signature: 'new', request })
  view.actions.acknowledged('mutationRequest', 'old' as never)
  expect(view.store.getSnapshot().mutationRequest?.request).toEqual(request)
  view.actions.discardRequests(['mutationRequest', 'copyRequest'])
  view.actions.acknowledged('mutationRequest', 'new' as never)
  expect(view.store.getSnapshot().mutationRequest).toBeNull()
})

it('shows task content as readable fields with optional advanced definition inspection', () => {
  const value = record()
  value.versions[1]!.content = { kind: 'task', brief: { ...brief, background: 'Read the project sources', constraints: '', deliverables: ['report.md'], acceptanceCriteria: [] } }
  mount(false, { record: value })
  expect(screen.getByText('Read the project sources')).toBeTruthy()
  expect(screen.getByText('report.md')).toBeTruthy()
  expect(screen.getAllByText(en.notSpecified)).toHaveLength(2)
  fireEvent.click(screen.getByText(en.advanced))
  expect(screen.getByText(/"kind": "task"/)).toBeTruthy()
})

it('shows an empty directory only after a successful read, and keeps loading and failure distinct', async () => {
  const ui = mount(false, { items: [], record: undefined })
  expect(screen.getByText(en.empty)).toBeTruthy()
  ui.data.update((state) => { state.loading = true })
  await waitFor(() => { expect(screen.queryByText(en.empty)).toBeNull() })
  ui.data.update((state) => { state.loading = false; state.error = 'Template read failed' })
  await screen.findByText('Template read failed')
  expect(screen.queryByText(en.empty)).toBeNull()
})
