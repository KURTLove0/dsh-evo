// @vitest-environment jsdom
/** User-visible identity editing and task management, independent of preset management. */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore, type AgentDirectorySnapshot, type SessionListState } from '@deepseek-ai/dsh-client-runtime/client'
import type { AgentCommand, AgentReceipt, WorkbenchAgent, WorkbenchAgentId } from '@deepseek-ai/dsh-api-remotes/client'
import { AgentPage, type AgentPageProps } from '../src/client/AgentPage.tsx'
import { createAgentViewStore } from '../src/client/view-store.ts'
import { SidebarAgentsAction } from '../src/client/SidebarAgentsAction.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)
const id = 'reviewer' as WorkbenchAgentId
const agent: WorkbenchAgent = { id, revision: 2, name: 'Reviewer', avatar: 'R', description: 'Reviews changes', instructions: 'Review thoroughly', runtime: 'harness', concurrency: 2, skills: ['review'], starters: [{ label: 'Review a patch', prompt: 'Review this patch carefully.' }], archived: false, createdAt: 1, updatedAt: 2 }
function mount(patch: Partial<AgentDirectorySnapshot> = {}, noWorkspace = false) {
  const directory = createSnapshotStore<AgentDirectorySnapshot>({ agents: [agent], selectedId: id, runs: [], workloads: [{ agentId: id, running: 0, queued: 0 }], runtime: { id: 'harness', available: true }, defaultConcurrency: 2, maxConcurrency: 8, loading: false, error: null, ...patch })
  const view = createAgentViewStore().create()
  const commands: AgentCommand[] = []
  const command = vi.fn(async (value: AgentCommand): Promise<AgentReceipt> => { commands.push(value); return { agentId: id } })
  const closePage = vi.fn(), openSession = vi.fn(), select = vi.fn(async () => {}), refresh = vi.fn(async () => {})
  const sessions = createSnapshotStore<SessionListState>({ ids: [], byId: {}, phase: 'ready', current: undefined, currentAddress: undefined, subagentsByParent: {}, jobsBySession: {} })
  const props: AgentPageProps = {
    useAgentDirectory: bindSnapshotSelector(directory), useStore: bindSnapshotSelector(view.store), actions: view.actions,
    useSessions: bindSnapshotSelector(sessions), useWorkspaces: selector => selector({ items: noWorkspace ? [] : [{ workspaceId: 'workspace', title: 'Project', path: '/project', sessionIds: [] }, { workspaceId: 'other', title: 'Other project', path: '/other', sessionIds: [] }] } as never),
    t: key => en[key as keyof typeof en], command, closePage, openSession, select, refresh,
  }
  render(<AgentPage {...props} />)
  return { directory, view, commands, command, closePage, openSession, select, refresh, sessions }
}
const detail = () => within(screen.getByRole('region', { name: 'Reviewer' }))

describe('independent agent workbench', () => {
  it.each(['copy', 'archive'] as const)('keeps a pending %s confirmation open and allows dismissal while idle', async (operation) => {
    const ui = mount()
    let resolve!: (value: AgentReceipt) => void
    ui.command.mockImplementationOnce(() => new Promise((done) => { resolve = done }))
    fireEvent.click(detail().getByRole('button', { name: en[operation] }))
    const title = operation === 'copy' ? en.copy : en.archive
    let dialog = within(screen.getByRole('dialog', { name: title }))
    fireEvent.click(dialog.getByRole('button', { name: operation === 'copy' ? en.confirmCopy : en.confirmArchive }))
    fireEvent.click(dialog.getByRole('button', { name: en.cancel }))
    expect(screen.getByRole('dialog', { name: title })).toBeTruthy()
    await act(async () => { resolve({ agentId: id }) })
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(detail().getByRole('button', { name: en[operation] }))
    dialog = within(screen.getByRole('dialog', { name: title }))
    fireEvent.click(dialog.getByRole('button', { name: en.cancel }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('renders loading, missing workload, and models without reasoning overrides', () => {
    const ui = mount({ loading: true, workloads: [], agents: [{ ...agent, model: { provider: 'mock', model: 'custom' } }] })
    expect(screen.getByText(en.loading)).toBeTruthy()
    expect(detail().getByText('mock / custom')).toBeTruthy()
    act(() => { ui.directory.set({ ...ui.directory.getSnapshot(), loading: false }) })
    fireEvent.click(screen.getByRole('button', { name: en.working }))
    expect(screen.getByText(en.noMatches)).toBeTruthy()
  })

  it('generates an editable candidate, clears model overrides, and requires an explicit save', async () => {
    const ui = mount({ agents: [{ ...agent, model: { provider: 'mock', model: 'custom', reasoningEffort: 'high' } }] })
    fireEvent.change(detail().getByLabelText(en.prompt), { target: { value: 'Design a writer' } })
    fireEvent.click(detail().getByRole('button', { name: en.design }))
    await waitFor(() => { expect(ui.commands[0]).toEqual({ kind: 'design', id, workspaceId: 'workspace', prompt: 'Design a writer' }) })
    const candidate = { name: 'Writer', avatar: 'W', description: '', instructions: 'Write reports.', runtime: 'harness' as const, skills: [], starters: [{ label: 'Write', prompt: 'Write a report.' }], concurrency: 2, model: { provider: 'mock', model: 'custom', reasoningEffort: 'high' } }
    act(() => { ui.directory.set({ ...ui.directory.getSnapshot(), runs: [{ id: 'design' as never, agentId: id, workspaceId: 'workspace' as never, sessionId: 'session' as never, prompt: 'Design a writer', createdAt: 1, status: 'completed', purpose: 'design', candidate }] }) })
    fireEvent.click(screen.getByRole('button', { name: en.reviewCandidate }))
    expect(ui.commands).toHaveLength(1)
    const dialog = within(screen.getByRole('dialog', { name: en.editTitle }))
    for (const label of [en.effort, en.model, en.provider]) fireEvent.change(dialog.getByLabelText(label), { target: { value: '' } })
    fireEvent.change(dialog.getByLabelText(en.description, { exact: false }), { target: { value: 'Report writer' } })
    fireEvent.click(dialog.getByRole('button', { name: `${en.remove} 1` }))
    fireEvent.click(dialog.getByRole('button', { name: en.save }))
    await waitFor(() => { expect(ui.commands[1]).toMatchObject({ kind: 'save', revision: 2, definition: { name: 'Writer', description: 'Report writer', starters: [] } }) })
    expect(ui.commands[1]).toHaveProperty('definition.model', undefined)
  })

  it('selects a workspace, opens transcripts, and exposes navigation and refresh', async () => {
    const ui = mount({ agents: [{ ...agent, avatar: '', description: '', instructions: '', skills: [] }], workloads: [{ agentId: id, running: 1, queued: 2 }], runs: [{ id: 'run' as never, agentId: id, workspaceId: 'workspace' as never, sessionId: 'session' as never, prompt: 'Task', createdAt: 1, status: 'completed' }] })
    fireEvent.click(screen.getByRole('button', { name: 'Reviewer' }))
    expect(ui.select).toHaveBeenCalledWith(id)
    fireEvent.click(screen.getByRole('button', { name: en.working }))
    fireEvent.change(detail().getByLabelText(en.workspace), { target: { value: 'other' } })
    expect(ui.view.store.getSnapshot().workspace).toBe('other')
    fireEvent.click(screen.getByRole('button', { name: en.refresh }))
    expect(ui.refresh).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByRole('button', { name: en.back }))
    expect(ui.closePage).toHaveBeenCalledOnce()
    act(() => { ui.sessions.set({ ...ui.sessions.getSnapshot(), byId: { session: { id: 'session', displayTitle: 'Task', running: false, blank: false, updatedAt: 1 } } as never }) })
    fireEvent.click(detail().getByRole('button', { name: en.runs }))
    fireEvent.click(screen.getByRole('button', { name: en.transcript }))
    expect(ui.openSession).toHaveBeenCalledWith('session')
  })

  it('disables task submission without a workspace or available runtime', () => {
    const ui = mount({ runtime: { id: 'harness', available: false } }, true)
    expect(screen.getByText(en.noWorkspace)).toBeTruthy()
    expect(detail().getByRole<HTMLButtonElement>('button', { name: en.run }).disabled).toBe(true)
    expect(ui.commands).toEqual([])
  })

  it('retains a busy editor during pending save and shows non-Error failures', async () => {
    const ui = mount()
    let reject!: (value: unknown) => void
    ui.command.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail }))
    fireEvent.click(detail().getByRole('button', { name: en.edit }))
    const dialog = within(screen.getByRole('dialog', { name: en.editTitle }))
    fireEvent.click(dialog.getByRole('button', { name: en.save }))
    fireEvent.click(dialog.getAllByRole('button', { name: en.cancel })[0]!)
    expect(screen.getByRole('dialog', { name: en.editTitle })).toBeTruthy()
    await act(async () => { reject('Save refused') })
    expect(dialog.getByRole('alert').textContent).toBe('Save refused')
    fireEvent.click(dialog.getAllByRole('button', { name: en.cancel })[1]!)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('starts with a genuinely empty directory and creates a blank editable identity', async () => {
    const ui = mount({ agents: [], selectedId: undefined })
    expect(screen.getByText(en.noAgents)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.newAgent }))
    const dialog = within(screen.getByRole('dialog', { name: en.newTitle }))
    fireEvent.click(dialog.getByRole('button', { name: en.save }))
    expect(ui.commands).toEqual([])
    expect(dialog.getByLabelText<HTMLInputElement>(en.name).validity.valueMissing).toBe(true)
    fireEvent.change(dialog.getByLabelText(en.name), { target: { value: 'Writer' } })
    fireEvent.change(dialog.getByLabelText(en.instructions, { exact: false }), { target: { value: 'Write concise reports.' } })
    fireEvent.click(dialog.getByRole('button', { name: en.save }))
    await waitFor(() => { expect(ui.commands).toHaveLength(1) })
    expect(ui.commands[0]).toMatchObject({ kind: 'create', definition: { name: 'Writer', instructions: 'Write concise reports.', concurrency: 2, runtime: 'harness' } })
    expect(ui.commands[0]).not.toHaveProperty('preset')
  })

  it('keeps starters as unsent composer suggestions, then submits explicit work', async () => {
    const ui = mount()
    fireEvent.click(detail().getByRole('button', { name: 'Review a patch' }))
    expect(ui.command).not.toHaveBeenCalled()
    expect(detail().getByLabelText<HTMLTextAreaElement>(en.prompt).value).toBe('Review this patch carefully.')
    fireEvent.click(detail().getByRole('button', { name: en.run }))
    await waitFor(() => { expect(ui.commands[0]).toEqual({ kind: 'run', id, workspaceId: 'workspace', prompt: 'Review this patch carefully.' }) })
    await waitFor(() => { expect(screen.getByText(en.noRuns)).toBeTruthy() })
  })

  it('edits the captured revision and preserves a rejected draft', async () => {
    const ui = mount()
    ui.command.mockRejectedValueOnce(new Error('Changed in another window'))
    fireEvent.click(detail().getByRole('button', { name: en.edit }))
    const dialog = within(screen.getByRole('dialog', { name: en.editTitle }))
    fireEvent.change(dialog.getByLabelText(en.name), { target: { value: 'New name' } })
    fireEvent.click(dialog.getByRole('button', { name: en.save }))
    await dialog.findByText('Changed in another window')
    expect(dialog.getByLabelText<HTMLInputElement>(en.name).value).toBe('New name')
    expect(ui.view.store.getSnapshot().draft?.revision).toBe(2)
    fireEvent.click(dialog.getAllByRole('button', { name: en.cancel })[0]!)
  })

  it('edits models, skills, concurrency, and at most three starters', async () => {
    const ui = mount()
    fireEvent.click(detail().getByRole('button', { name: en.edit }))
    const dialog = within(screen.getByRole('dialog', { name: en.editTitle }))
    for (const [key, value] of [[en.provider, 'deepseek'], [en.model, 'deepseek-chat'], [en.effort, 'high'], [en.avatar, 'QA']] as const) fireEvent.change(dialog.getByLabelText(key), { target: { value } })
    fireEvent.change(dialog.getByLabelText(en.skills, { exact: false }), { target: { value: 'review\n audit\n' } })
    fireEvent.change(dialog.getByLabelText(en.concurrency), { target: { value: '3' } })
    fireEvent.click(dialog.getByRole('button', { name: en.addStarter }))
    fireEvent.click(dialog.getByRole('button', { name: en.addStarter }))
    expect(dialog.getByRole<HTMLButtonElement>('button', { name: en.addStarter }).disabled).toBe(true)
    fireEvent.click(dialog.getByRole('button', { name: `${en.remove} 3` }))
    fireEvent.change(dialog.getByLabelText(`${en.starterLabel} 2`), { target: { value: 'Audit' } })
    fireEvent.change(dialog.getByLabelText(`${en.starterPrompt} 2`), { target: { value: 'Audit permissions.' } })
    fireEvent.click(dialog.getByRole('button', { name: en.save }))
    await waitFor(() => { expect(ui.commands[0]).toMatchObject({ kind: 'save', id, revision: 2, definition: { model: { provider: 'deepseek', model: 'deepseek-chat', reasoningEffort: 'high' }, skills: ['review', 'audit'], concurrency: 3 } }) })
  })

  it('duplicates with a fresh name and confirms archival before cancelling unfinished work', async () => {
    const ui = mount()
    fireEvent.click(detail().getByRole('button', { name: en.copy }))
    const copy = within(screen.getByRole('dialog', { name: en.copy }))
    fireEvent.change(copy.getByLabelText(en.copyName), { target: { value: 'Copy reviewer' } })
    fireEvent.click(copy.getByRole('button', { name: en.confirmCopy }))
    await waitFor(() => { expect(ui.commands[0]).toEqual({ kind: 'copy', id, name: 'Copy reviewer' }) })
    fireEvent.click(detail().getByRole('button', { name: en.archive }))
    expect(ui.commands).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: en.confirmArchive }))
    await waitFor(() => { expect(ui.commands[1]).toEqual({ kind: 'archive', id, revision: 2, archived: true }) })
  })

  it('filters independently of presets and restores archived identities', async () => {
    const ui = mount({ agents: [agent, { ...agent, id: 'archived' as WorkbenchAgentId, name: 'Retired', archived: true }], selectedId: 'archived' as WorkbenchAgentId })
    fireEvent.click(screen.getByRole('button', { name: en.archived }))
    expect(screen.getByRole('button', { name: 'Retired' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Reviewer' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: en.restore }))
    await waitFor(() => { expect(ui.commands[0]).toMatchObject({ kind: 'archive', archived: false }) })
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'absent' } })
    expect(screen.getByText(en.noMatches)).toBeTruthy()
  })

  it('shows authoritative run status, errors, cancellation and retry operations', async () => {
    const ui = mount({ runs: [
      { id: 'running' as never, agentId: id, workspaceId: 'workspace' as never, sessionId: 'session' as never, prompt: 'Live task', createdAt: 1, status: 'running' },
      { id: 'failed' as never, agentId: id, workspaceId: 'workspace' as never, sessionId: 'session2' as never, prompt: 'Failed task', createdAt: 2, status: 'failed', error: 'Runtime failed', definition: agent },
    ] })
    fireEvent.click(detail().getByRole('button', { name: en.runs }))
    expect(screen.getByText('Runtime failed')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.stop }))
    await waitFor(() => { expect(ui.commands[0]).toEqual({ kind: 'stop', runId: 'running' }) })
    fireEvent.click(screen.getByRole('button', { name: en.retry }))
    await waitFor(() => { expect(ui.commands[1]).toEqual({ kind: 'retry', runId: 'failed' }) })
    act(() => { ui.directory.set({ ...ui.directory.getSnapshot(), error: 'Offline' }) })
    expect(screen.getByText('Offline')).toBeTruthy()
  })
})

it('renders agents navigation at both sidebar widths', () => {
  const openAgents = vi.fn()
  const ui = render(<SidebarAgentsAction
    wide t={key => en[key as keyof typeof en]}
    openAgents={openAgents} useSessions={() => undefined as never} useWorkspaces={() => undefined as never} />)
  fireEvent.click(screen.getByRole('button', { name: en.agents }))
  expect(openAgents).toHaveBeenCalledOnce()
  ui.rerender(<SidebarAgentsAction
    wide={false} t={key => en[key as keyof typeof en]}
    openAgents={openAgents} useSessions={() => undefined as never} useWorkspaces={() => undefined as never} />)
  expect(screen.getByRole('button', { name: en.agents })).toBeTruthy()
})
