// @vitest-environment jsdom
/** User-visible identity editing and task management, independent of preset management. */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore, type AgentDirectorySnapshot, type SessionListState } from '@deepseek-ai/dsh-client-runtime/client'
import type { AgentCommand, AgentReceipt, AgentRuntime, WorkbenchAgent, WorkbenchAgentId } from '@deepseek-ai/dsh-api-remotes/client'
import { AgentPage, type AgentPageProps } from '../src/client/AgentPage.tsx'
import { createAgentViewStore } from '../src/client/view-store.ts'
import { AgentStatistics } from '../src/client/AgentStatistics.tsx'
import { SidebarAgentsAction } from '../src/client/SidebarAgentsAction.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)
const id = 'reviewer' as WorkbenchAgentId
const agent: WorkbenchAgent = { id, revision: 2, name: 'Reviewer', avatar: 'R', description: 'Reviews changes', instructions: 'Review thoroughly', runtime: 'mock', concurrency: 2, mcpServers: [], skills: ['review'], starters: [{ label: 'Review a patch', prompt: 'Review this patch carefully.' }], archived: false, createdAt: 1, updatedAt: 2 }
function mount(
  patch: Partial<AgentDirectorySnapshot> = {}, noWorkspace = false, showDetail = true, runtimeLoad?: () => Promise<AgentRuntime[]>,
) {
  const directory = createSnapshotStore<AgentDirectorySnapshot>({ agents: [agent], selectedId: id, runs: [], workloads: [{ agentId: id, running: 0, queued: 0 }], runtime: { id: 'harness', available: true }, defaultConcurrency: 2, maxConcurrency: 8, loading: false, error: null, ...patch })
  const view = createAgentViewStore().create()
  view.actions.detail(showDetail)
  const commands: AgentCommand[] = []
  const command = vi.fn(async (value: AgentCommand): Promise<AgentReceipt> => { commands.push(value); return { agentId: id } })
  const closePage = vi.fn(), openSession = vi.fn(), select = vi.fn(async () => {}), refresh = vi.fn(async () => {})
  const capabilities = vi.fn(async () => ({ skills: [{ name: 'review', description: 'Review source and authorization', source: 'project-agents' }] }))
  const sessions = createSnapshotStore<SessionListState>({ ids: [], byId: {}, phase: 'ready', current: undefined, currentAddress: undefined, subagentsByParent: {}, jobsBySession: {} })
  const runtimes = runtimeLoad ?? vi.fn(async () => [{ id: 'mock', name: 'Codex CLI (test)', command: 'codex', available: true, defaultModel: 'custom', models: [{ id: 'custom', name: 'Custom model' }, { id: 'deepseek-chat', name: 'deepseek-chat' }] }])
  const props: AgentPageProps = {
    useAgentDirectory: bindSnapshotSelector(directory), useStore: bindSnapshotSelector(view.store), actions: view.actions,
    useSessions: bindSnapshotSelector(sessions), useWorkspaces: selector => selector({ items: noWorkspace ? [] : [{ workspaceId: 'workspace', title: 'Project', path: '/project', sessionIds: [] }, { workspaceId: 'other', title: 'Other project', path: '/other', sessionIds: [] }] } as never),
    t: key => en[key as keyof typeof en], command, closePage, openSession, select, refresh, capabilities, runtimes,
  }
  const rendered = render(<AgentPage {...props} />)
  return { directory, view, commands, command, closePage, openSession, select, refresh, sessions, capabilities, runtimes, props, rendered }
}
const detail = () => within(screen.getByRole('region', { name: 'Reviewer' }))

describe('independent agent workbench', () => {
  it.each([new Error('Runtime catalog failed'), 'Runtime catalog failed'])('reports runtime catalog failures on the profile (%s)', async (failure) => {
    mount({}, false, true, vi.fn().mockRejectedValue(failure))
    expect((await screen.findByRole('alert')).textContent).toBe('Runtime catalog failed')
  })

  it.each([true, false])('ignores a profile catalog response after unmount (%s)', async (success) => {
    const pending = Promise.withResolvers<AgentRuntime[]>()
    mount({}, false, true, () => pending.promise)
    cleanup()
    await act(async () => { if (success) pending.resolve([]); else pending.reject(new Error('Late failure')) })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('opens a full identity profile and navigates capability panels with the keyboard', () => {
    mount()
    const overview = detail().getByRole('tab', { name: en.overview })
    expect(overview.getAttribute('aria-selected')).toBe('true')
    expect(screen.queryByRole('region', { name: en.agents })).toBeNull()
    fireEvent.keyDown(overview, { key: 'ArrowLeft' })
    expect(detail().getByRole('tab', { name: en.settings }).getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' })
    expect(overview.getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(overview, { key: 'End' })
    fireEvent.keyDown(document.activeElement!, { key: 'Home' })
    fireEvent.keyDown(overview, { key: 'Enter' })
    expect(overview.getAttribute('aria-selected')).toBe('true')
    fireEvent.click(detail().getByRole('tab', { name: en.instructions }))
    expect(within(detail().getByRole('tabpanel')).getByText('Review thoroughly')).toBeTruthy()
    fireEvent.click(detail().getByRole('tab', { name: /^Skills/ }))
    expect(within(detail().getByRole('tabpanel')).getByText('review')).toBeTruthy()
    fireEvent.click(detail().getByRole('tab', { name: /^MCP/ }))
    expect(screen.getByText(en.noMcp)).toBeTruthy()
    fireEvent.click(detail().getByRole('button', { name: en.editCapabilities }))
    expect(screen.getByRole('dialog', { name: en.editTitle })).toBeTruthy()
  })

  it('presents live work and capability details without exposing connection credentials', () => {
    const configured = { ...agent, instructions: '', skills: [], mcpServers: [
      { name: 'crm', transport: 'stdio' as const, command: 'business-tool', args: [], env: [{ name: 'TOKEN', value: 'private-token' }] },
      { name: 'remote', transport: 'streamable-http' as const, url: 'https://example.com/business', headers: [{ name: 'Authorization', value: 'private-header' }] },
    ] }
    mount({ agents: [configured], workloads: [{ agentId: id, running: 1, queued: 1 }], runs: [
      { id: 'live' as never, agentId: id, workspaceId: 'workspace' as never, sessionId: 'session' as never, prompt: 'Current report', status: 'running', createdAt: 1 },
      { id: 'next' as never, agentId: id, workspaceId: 'workspace' as never, sessionId: 'session' as never, prompt: 'Queued report', status: 'queued', createdAt: 2 },
    ] })
    const current = within(screen.getByRole('region', { name: en.currentWork }))
    expect(current.getByText('Current report')).toBeTruthy()
    expect(current.getByText('Queued report')).toBeTruthy()
    fireEvent.click(detail().getByRole('tab', { name: en.instructions }))
    expect(screen.getByText(en.noInstructions)).toBeTruthy()
    fireEvent.click(detail().getByRole('tab', { name: /^Skills/ }))
    expect(within(screen.getByRole('tabpanel')).getByText(en.noSkills)).toBeTruthy()
    fireEvent.click(detail().getByRole('tab', { name: /^MCP/ }))
    expect(screen.getByText('business-tool')).toBeTruthy()
    expect(screen.getByText('https://example.com/business')).toBeTruthy()
    expect(screen.queryByText('private-token')).toBeNull()
    expect(screen.queryByText('private-header')).toBeNull()
  })

  it('shows host unavailability in the directory summary', () => {
    mount({ runtime: { id: 'harness', available: false } }, false, false)
    expect(within(screen.getByLabelText(en.workload)).getByText(en.offline)).toBeTruthy()
  })

  it('focuses task assignment from the profile header and navigates editor sections', async () => {
    const scroll = vi.fn()
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { value: scroll, configurable: true })
    try {
      mount()
      fireEvent.click(detail().getByRole('tab', { name: en.runs }))
      fireEvent.click(detail().getByRole('button', { name: en.task }))
      await waitFor(() => { expect(document.activeElement).toBe(detail().getByLabelText(en.prompt)) })
      expect(scroll).toHaveBeenCalled()
      fireEvent.click(detail().getByRole('button', { name: en.edit }))
      const dialog = within(screen.getByRole('dialog', { name: en.editTitle }))
      fireEvent.click(within(dialog.getByRole('navigation', { name: en.editorNavigation })).getByRole('button', { name: en.settings }))
      expect(scroll).toHaveBeenCalledTimes(2)
      expect(dialog.getByRole('heading', { name: en.identity })).toBeTruthy()
    } finally {
      Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
    }
  })

  it('filters task and configuration work independently of status and limits the overview to recent work', () => {
    mount({ runs: Array.from({ length: 12 }, (_, index) => ({ id: `run-${index}` as never, agentId: id, workspaceId: 'workspace' as never, sessionId: 'session' as never, prompt: `Work ${index}`, createdAt: index, status: 'completed' as const, ...(index === 0 ? { purpose: 'design' as const } : {}) })) })
    expect(screen.getAllByRole('article')).toHaveLength(10)
    fireEvent.click(detail().getByRole('button', { name: en.viewAll }))
    expect(screen.getAllByRole('article')).toHaveLength(12)
    fireEvent.click(within(screen.getByRole('group', { name: en.taskType })).getByRole('button', { name: en.designRun }))
    expect(screen.getAllByRole('article')).toHaveLength(1)
    expect(screen.getByText('Work 0')).toBeTruthy()
    fireEvent.click(within(screen.getByRole('group', { name: en.taskType })).getByRole('button', { name: en.taskRun }))
    expect(screen.getAllByRole('article')).toHaveLength(11)
  })

  it('displays configured MCP services in the current identity and captured history', () => {
    const configured = { ...agent, mcpServers: [{ name: 'crm', transport: 'streamable-http' as const, url: 'https://example.com/mcp', headers: [] }] }
    mount({ agents: [configured], runs: [{ id: 'run' as never, agentId: id, workspaceId: 'workspace' as never, sessionId: 'session' as never, prompt: 'Review CRM', createdAt: 1, status: 'completed', definition: configured }] })
    expect(detail().getAllByText('crm · streamable-http').length).toBeGreaterThan(0)
    fireEvent.click(detail().getByRole('tab', { name: en.runs }))
    expect(screen.getAllByText('crm · streamable-http').length).toBeGreaterThan(0)
  })

  it('creates a business agent with discovered skills and explicit MCP transports', async () => {
    const ui = mount({ agents: [], selectedId: undefined })
    fireEvent.click(screen.getByRole('button', { name: en.newAgent }))
    const dialog = within(screen.getByRole('dialog', { name: en.newTitle }))
    fireEvent.change(dialog.getByLabelText(en.name), { target: { value: 'Revenue analyst' } })
    fireEvent.change(dialog.getByLabelText(en.instructions, { exact: false }), { target: { value: 'Produce customer revenue summaries.' } })
    await dialog.findByRole('option', { name: 'Codex CLI (test)' })
    fireEvent.change(dialog.getByRole('combobox', { name: en.runtime }), { target: { value: 'mock' } })
    const skill = await dialog.findByRole('checkbox', { name: /review/ })
    fireEvent.click(skill)
    expect(ui.capabilities).toHaveBeenCalledWith('workspace')
    fireEvent.click(dialog.getByRole('button', { name: en.addServer }))
    fireEvent.change(dialog.getByLabelText(`${en.mcpName} 1`), { target: { value: 'crm' } })
    fireEvent.change(dialog.getByLabelText(`${en.mcpCommand} 1`), { target: { value: 'node' } })
    fireEvent.change(dialog.getByLabelText(`${en.mcpArgs} 1`, { exact: false }), { target: { value: '/workspace/crm.mjs\n--read-only' } })
    fireEvent.click(dialog.getByRole('button', { name: `${en.addVariable} 1` }))
    fireEvent.change(dialog.getByLabelText(`${en.variableName} 1.1`), { target: { value: 'CRM_TOKEN' } })
    fireEvent.change(dialog.getByLabelText(`${en.variableValue} 1.1`), { target: { value: 'local-token' } })
    fireEvent.click(dialog.getByRole('button', { name: en.addServer }))
    fireEvent.change(dialog.getByLabelText(`${en.mcpName} 2`), { target: { value: 'analytics' } })
    fireEvent.change(dialog.getByLabelText(`${en.mcpTransport} 2`), { target: { value: 'streamable-http' } })
    fireEvent.change(dialog.getByLabelText(`${en.mcpUrl} 2`), { target: { value: 'https://example.com/mcp' } })
    fireEvent.click(dialog.getByRole('button', { name: `${en.addVariable} 2` }))
    fireEvent.change(dialog.getByLabelText(`${en.variableName} 2.1`), { target: { value: 'Authorization' } })
    fireEvent.change(dialog.getByLabelText(`${en.variableValue} 2.1`), { target: { value: 'Bearer test' } })
    fireEvent.click(dialog.getByRole('button', { name: en.save }))
    await waitFor(() => { expect(ui.commands[0]).toMatchObject({ kind: 'create', definition: {
      name: 'Revenue analyst', instructions: 'Produce customer revenue summaries.', skills: ['review'],
      mcpServers: [
        { name: 'crm', transport: 'stdio', command: 'node', args: ['/workspace/crm.mjs', '--read-only'], env: [{ name: 'CRM_TOKEN', value: 'local-token' }] },
        { name: 'analytics', transport: 'streamable-http', url: 'https://example.com/mcp', headers: [{ name: 'Authorization', value: 'Bearer test' }] },
      ],
    } }) })
  })

  it('confirms discarding edited configuration and lets the user continue editing', async () => {
    const ui = mount()
    fireEvent.click(detail().getByRole('button', { name: en.edit }))
    let dialog = within(screen.getByRole('dialog', { name: en.editTitle }))
    fireEvent.change(dialog.getByLabelText(en.instructions, { exact: false }), { target: { value: 'Unsaved instructions' } })
    fireEvent.click(dialog.getAllByRole('button', { name: en.cancel })[0]!)
    let confirmation = within(screen.getByRole('dialog', { name: en.unsaved }))
    fireEvent.click(confirmation.getAllByRole('button', { name: en.keepEditing })[0]!)
    dialog = within(screen.getByRole('dialog', { name: en.editTitle }))
    fireEvent.click(dialog.getAllByRole('button', { name: en.cancel })[1]!)
    confirmation = within(screen.getByRole('dialog', { name: en.unsaved }))
    fireEvent.click(confirmation.getAllByRole('button', { name: en.keepEditing })[1]!)
    dialog = within(screen.getByRole('dialog', { name: en.editTitle }))
    expect(dialog.getByLabelText<HTMLTextAreaElement>(en.instructions, { exact: false }).value).toBe('Unsaved instructions')
    fireEvent.click(dialog.getAllByRole('button', { name: en.cancel })[1]!)
    confirmation = within(screen.getByRole('dialog', { name: en.unsaved }))
    fireEvent.click(confirmation.getByRole('button', { name: en.discard }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(ui.commands).toEqual([])
    fireEvent.click(detail().getByRole('button', { name: en.edit }))
    dialog = within(screen.getByRole('dialog', { name: en.editTitle }))
    expect(dialog.getByLabelText<HTMLTextAreaElement>(en.instructions, { exact: false }).value).toBe(agent.instructions)
    fireEvent.click(dialog.getAllByRole('button', { name: en.cancel })[0]!)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('finds agents by skill, sorts identities, and includes queued-only work', () => {
    const ui = mount({ agents: [agent, { ...agent, id: 'writer' as WorkbenchAgentId, name: 'Author', skills: ['reports'], updatedAt: 1 }], workloads: [{ agentId: id, running: 0, queued: 3 }] })
    fireEvent.click(screen.getByRole('button', { name: en.agents }))
    const roster = within(screen.getByRole('region', { name: en.agents }))
    expect(roster.getAllByRole('button').map(button => button.getAttribute('aria-label'))).toEqual(['Author', 'Reviewer'])
    fireEvent.change(screen.getByLabelText(en.sort), { target: { value: 'updated' } })
    expect(roster.getAllByRole('button').map(button => button.getAttribute('aria-label'))).toEqual(['Reviewer', 'Author'])
    act(() => {
      const snapshot = ui.directory.getSnapshot()
      ui.directory.set({ ...snapshot, agents: snapshot.agents.map(item => ({ ...item, updatedAt: 2 })) })
    })
    expect(roster.getAllByRole('button').map(button => button.getAttribute('aria-label'))).toEqual(['Author', 'Reviewer'])
    fireEvent.click(screen.getByRole('button', { name: en.waiting }))
    expect(roster.getAllByRole('button')).toHaveLength(1)
    expect(roster.getByText('Queued · Capacity 0/2 · Queued 3')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.active }))
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: ' REPORTS ' } })
    expect(roster.getByRole('button', { name: 'Author' })).toBeTruthy()
    expect(roster.queryByRole('button', { name: 'Reviewer' })).toBeNull()
    expect(within(screen.getByLabelText(en.workload)).getAllByRole('definition').map(node => node.textContent)).toEqual(['2', '0', '3', en.online])
  })

  it('keeps task and workspace drafts with their agent across selection and failed submission', async () => {
    const other = { ...agent, id: 'writer' as WorkbenchAgentId, name: 'Writer' }
    const ui = mount({ agents: [agent, other] })
    fireEvent.change(detail().getByLabelText(en.prompt), { target: { value: 'Review private changes' } })
    fireEvent.change(detail().getByLabelText(en.workspace), { target: { value: 'other' } })
    act(() => { ui.directory.set({ ...ui.directory.getSnapshot(), selectedId: other.id }) })
    const writer = within(screen.getByRole('region', { name: 'Writer' }))
    expect(writer.getByLabelText<HTMLTextAreaElement>(en.prompt).value).toBe('')
    expect(writer.getByLabelText<HTMLSelectElement>(en.workspace).value).toBe('workspace')
    fireEvent.change(writer.getByLabelText(en.prompt), { target: { value: 'Write a report' } })
    act(() => { ui.directory.set({ ...ui.directory.getSnapshot(), selectedId: id }) })
    expect(detail().getByLabelText<HTMLTextAreaElement>(en.prompt).value).toBe('Review private changes')
    expect(detail().getByLabelText<HTMLSelectElement>(en.workspace).value).toBe('other')
    act(() => { ui.view.actions.runKind('design') })
    ui.command.mockRejectedValueOnce(new Error('Assignment refused'))
    fireEvent.click(detail().getByRole('button', { name: en.run }))
    await screen.findByText('Assignment refused')
    expect(detail().getByLabelText<HTMLTextAreaElement>(en.prompt).value).toBe('Review private changes')
    fireEvent.click(detail().getByRole('button', { name: en.run }))
    await waitFor(() => { expect(ui.view.store.getSnapshot().composers[id]?.prompt).toBe('') })
    expect(ui.view.store.getSnapshot().composers[other.id]?.prompt).toBe('Write a report')
    expect(ui.view.store.getSnapshot().runKind).toBe('all')
  })

  it('filters recorded runs and displays captured instructions independently of current edits', () => {
    mount({ runs: [
      { id: 'old' as never, agentId: id, workspaceId: 'other' as never, sessionId: 'old-session' as never, prompt: 'Original task', createdAt: 1, status: 'completed', definition: { ...agent, revision: 1, instructions: 'Original instructions' }, startedAt: 2, endedAt: 3 },
      { id: 'new' as never, agentId: id, workspaceId: 'workspace' as never, sessionId: 'new-session' as never, prompt: 'Retry task', createdAt: 4, status: 'failed', error: 'Permission denied', retryOf: 'old' as never },
    ] })
    fireEvent.click(detail().getByRole('tab', { name: en.runs }))
    expect(screen.getAllByRole('article').map(row => within(row).getByText(/task$/).textContent)).toEqual(['Retry task', 'Original task'])
    fireEvent.change(screen.getByLabelText(en.runStatus), { target: { value: 'completed' } })
    expect(screen.queryByText('Retry task')).toBeNull()
    const captured = screen.getByText(`${en.capturedConfiguration} · ${en.revision} 1`).closest('details')!
    fireEvent.click(within(captured).getByText(`${en.capturedConfiguration} · ${en.revision} 1`))
    expect(within(captured).getByText('Original instructions')).toBeTruthy()
    expect(screen.getByText('Other project')).toBeTruthy()
    expect(screen.getByText(en.startedAt)).toBeTruthy()
    expect(screen.getByText(en.endedAt)).toBeTruthy()
    fireEvent.change(screen.getByLabelText(en.searchRuns), { target: { value: 'permission' } })
    expect(screen.getByText(en.noMatchingRuns)).toBeTruthy()
    fireEvent.change(screen.getByLabelText(en.runStatus), { target: { value: 'all' } })
    expect(screen.getByText('Retry task')).toBeTruthy()
    expect(screen.getByText(en.retryOf)).toBeTruthy()
    fireEvent.change(screen.getByLabelText(en.searchRuns), { target: { value: 'other project' } })
    expect(screen.queryByText('Retry task')).toBeNull()
    expect(screen.getByText('Original task')).toBeTruthy()
  })

  it('retains history for removed workspaces and displays captured model overrides', () => {
    mount({ runs: [
      { id: 'b' as never, agentId: id, workspaceId: 'removed-workspace' as never, sessionId: 'old-session' as never, prompt: 'Orphan task', createdAt: 1, status: 'completed', definition: { ...agent, instructions: '', skills: [], model: { provider: 'provider', model: 'model', reasoningEffort: 'high' } } },
      { id: 'a' as never, agentId: id, workspaceId: 'workspace' as never, sessionId: 'session' as never, prompt: 'Known task', createdAt: 1, status: 'completed', definition: { ...agent, model: { provider: 'provider', model: 'model' } } },
    ] })
    fireEvent.click(detail().getByRole('tab', { name: en.runs }))
    expect(screen.getAllByRole('article').map(row => within(row).getByText(/task$/).textContent)).toEqual(['Known task', 'Orphan task'])
    expect(screen.getByText('provider / model')).toBeTruthy()
    expect(screen.getByText('provider / model · high')).toBeTruthy()
    expect(screen.getByText('removed-workspace')).toBeTruthy()
    fireEvent.change(screen.getByLabelText(en.searchRuns), { target: { value: 'removed-workspace' } })
    expect(screen.queryByText('Known task')).toBeNull()
    expect(screen.getByText('Orphan task')).toBeTruthy()
  })

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
    expect(detail().getAllByText('mock / custom').length).toBeGreaterThan(0)
    act(() => { ui.directory.set({ ...ui.directory.getSnapshot(), loading: false }) })
    fireEvent.click(screen.getByRole('button', { name: en.agents }))
    fireEvent.click(screen.getByRole('button', { name: en.working }))
    expect(screen.getByText(en.noMatches)).toBeTruthy()
  })

  it('generates an editable candidate, clears model overrides, and requires an explicit save', async () => {
    const ui = mount({ agents: [{ ...agent, model: { provider: 'mock', model: 'custom', reasoningEffort: 'high' } }] })
    fireEvent.change(detail().getByLabelText(en.prompt), { target: { value: 'Design a writer' } })
    fireEvent.click(detail().getByRole('button', { name: en.design }))
    await waitFor(() => { expect(ui.commands[0]).toEqual({ kind: 'design', id, workspaceId: 'workspace', prompt: 'Design a writer' }) })
    const candidate = { name: 'Writer', avatar: 'W', description: '', instructions: 'Write reports.', runtime: 'mock' as const, skills: [], mcpServers: [], starters: [{ label: 'Write', prompt: 'Write a report.' }], concurrency: 2, model: { provider: 'mock', model: 'custom', reasoningEffort: 'high' } }
    act(() => { ui.directory.set({ ...ui.directory.getSnapshot(), runs: [{ id: 'design' as never, agentId: id, workspaceId: 'workspace' as never, sessionId: 'session' as never, prompt: 'Design a writer', createdAt: 1, status: 'completed', purpose: 'design', candidate }] }) })
    fireEvent.click(screen.getByRole('button', { name: en.reviewCandidate }))
    expect(ui.commands).toHaveLength(1)
    const dialog = within(screen.getByRole('dialog', { name: en.editTitle }))
    fireEvent.change(dialog.getByRole('combobox', { name: en.model }), { target: { value: '' } })
    fireEvent.change(dialog.getByLabelText(en.description, { exact: false }), { target: { value: 'Report writer' } })
    fireEvent.click(dialog.getByRole('button', { name: `${en.remove} 1` }))
    fireEvent.click(dialog.getByRole('button', { name: en.save }))
    await waitFor(() => { expect(ui.commands[1]).toMatchObject({ kind: 'save', revision: 2, definition: { name: 'Writer', description: 'Report writer', starters: [] } }) })
    expect(ui.commands[1]).toHaveProperty('definition.model', undefined)
  })

  it('selects a workspace, opens transcripts, and exposes navigation and refresh', async () => {
    const ui = mount({ agents: [{ ...agent, avatar: '', description: '', instructions: '', skills: [] }], workloads: [{ agentId: id, running: 1, queued: 2 }], runs: [{ id: 'run' as never, agentId: id, workspaceId: 'workspace' as never, sessionId: 'session' as never, prompt: 'Task', createdAt: 1, status: 'completed' }] })
    fireEvent.click(screen.getByRole('button', { name: en.agents }))
    fireEvent.click(screen.getByRole('button', { name: en.working }))
    fireEvent.click(screen.getByRole('button', { name: 'Reviewer' }))
    expect(ui.select).toHaveBeenCalledWith(id)
    fireEvent.change(detail().getByLabelText(en.workspace), { target: { value: 'other' } })
    expect(ui.view.store.getSnapshot().composers[id]?.workspace).toBe('other')
    fireEvent.click(screen.getByRole('button', { name: en.refresh }))
    expect(ui.refresh).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByRole('button', { name: en.back }))
    expect(ui.closePage).toHaveBeenCalledOnce()
    act(() => { ui.sessions.set({ ...ui.sessions.getSnapshot(), byId: { session: { id: 'session', displayTitle: 'Task', running: false, blank: false, updatedAt: 1 } } as never }) })
    fireEvent.click(detail().getByRole('tab', { name: en.runs }))
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
    await dialog.findByRole('option', { name: 'Codex CLI (test)' })
    fireEvent.change(dialog.getByRole('combobox', { name: en.runtime }), { target: { value: 'mock' } })
    fireEvent.change(dialog.getByLabelText(en.name), { target: { value: 'Writer' } })
    fireEvent.change(dialog.getByLabelText(en.instructions, { exact: false }), { target: { value: 'Write concise reports.' } })
    fireEvent.click(dialog.getByRole('button', { name: en.save }))
    await waitFor(() => { expect(ui.commands).toHaveLength(1) })
    expect(ui.commands[0]).toMatchObject({ kind: 'create', definition: { name: 'Writer', instructions: 'Write concise reports.', concurrency: 2, runtime: 'mock' } })
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
    await dialog.findByRole('option', { name: 'deepseek-chat' })
    fireEvent.change(dialog.getByRole('combobox', { name: en.model }), { target: { value: 'deepseek-chat' } })
    for (const [key, value] of [[en.effort, 'high'], [en.avatar, 'QA']] as const) fireEvent.change(dialog.getByLabelText(key), { target: { value } })
    fireEvent.change(dialog.getByRole('textbox', { name: en.skills }), { target: { value: 'review\n audit\n' } })
    fireEvent.change(dialog.getByLabelText(en.concurrency), { target: { value: '3' } })
    fireEvent.click(dialog.getByRole('button', { name: en.addStarter }))
    fireEvent.click(dialog.getByRole('button', { name: en.addStarter }))
    expect(dialog.getByRole<HTMLButtonElement>('button', { name: en.addStarter }).disabled).toBe(true)
    fireEvent.click(dialog.getByRole('button', { name: `${en.remove} 3` }))
    fireEvent.change(dialog.getByLabelText(`${en.starterLabel} 2`), { target: { value: 'Audit' } })
    fireEvent.change(dialog.getByLabelText(`${en.starterPrompt} 2`), { target: { value: 'Audit permissions.' } })
    fireEvent.click(dialog.getByRole('button', { name: en.save }))
    await waitFor(() => { expect(ui.commands[0]).toMatchObject({ kind: 'save', id, revision: 2, definition: { model: { provider: 'mock', model: 'deepseek-chat', reasoningEffort: 'high' }, skills: ['review', 'audit'], concurrency: 3 } }) })
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
    fireEvent.click(screen.getByRole('button', { name: en.agents }))
    fireEvent.click(screen.getByRole('button', { name: en.archived }))
    expect(screen.getByRole('button', { name: 'Retired' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Reviewer' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Retired' }))
    fireEvent.click(screen.getByRole('button', { name: en.restore }))
    await waitFor(() => { expect(ui.commands[0]).toMatchObject({ kind: 'archive', archived: false }) })
    fireEvent.click(screen.getByRole('button', { name: en.agents }))
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'absent' } })
    expect(screen.getByText(en.noMatches)).toBeTruthy()
  })

  it('shows authoritative run status, errors, cancellation and retry operations', async () => {
    const ui = mount({ runs: [
      { id: 'running' as never, agentId: id, workspaceId: 'workspace' as never, sessionId: 'session' as never, prompt: 'Live task', createdAt: 1, status: 'running' },
      { id: 'failed' as never, agentId: id, workspaceId: 'workspace' as never, sessionId: 'session2' as never, prompt: 'Failed task', createdAt: 2, status: 'failed', error: 'Runtime failed', definition: agent },
    ] })
    fireEvent.click(detail().getByRole('tab', { name: en.runs }))
    expect(screen.getByText('Runtime failed')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.stop }))
    await waitFor(() => { expect(ui.commands[0]).toEqual({ kind: 'stop', runId: 'running' }) })
    fireEvent.click(screen.getByRole('button', { name: en.retry }))
    expect(ui.commands).toHaveLength(1)
    expect(screen.getByText(en.retryWarning)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.confirmRetry }))
    await waitFor(() => { expect(ui.commands[1]).toMatchObject({ kind: 'retry', runId: 'failed', expectedRevision: agent.revision }) })
    const submitted = ui.commands[1]
    expect(submitted?.kind === 'retry' && typeof submitted.requestId).toBe('string')
    act(() => { ui.directory.set({ ...ui.directory.getSnapshot(), error: 'Offline' }) })
    expect(screen.getByText('Offline')).toBeTruthy()
  })
  it('retains a submitted retry across remounts and recovers its exact identity after configuration changes', async () => {
    const configured = { ...agent, mcpServers: [{ name: 'CRM', transport: 'streamable-http' as const, url: 'https://example.com', headers: [{ name: 'Token', value: 'secret' }] }] }
    const ui = mount({ agents: [configured], runs: [{ id: 'failed' as never, agentId: id, workspaceId: 'workspace' as never,
      sessionId: 'session' as never, prompt: 'Retry me', createdAt: 1, status: 'failed' }] })
    fireEvent.click(detail().getByRole('tab', { name: en.runs }))
    fireEvent.click(screen.getByRole('button', { name: en.retry }))
    expect(screen.getByText(en.retryNotCaptured)).toBeTruthy()
    expect(screen.getByRole('dialog').textContent).not.toContain('secret')
    const request = ui.view.store.getSnapshot().retry!.request
    ui.command.mockRejectedValueOnce(new Error('Response lost'))
    fireEvent.click(screen.getByRole('button', { name: en.confirmRetry }))
    fireEvent.click(screen.getAllByRole('button', { name: en.closeRetry })[0]!)
    await screen.findAllByText('Response lost')
    ui.rendered.unmount()
    act(() => { ui.directory.set({ ...ui.directory.getSnapshot(), agents: [] }) })
    render(<AgentPage {...ui.props} />)
    expect(screen.getAllByText(en.retryNotCaptured)).toHaveLength(2)
    expect(screen.getByText(en.retryChanged)).toBeTruthy()
    expect(screen.getByText(en.retryPending)).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: en.closeRetry })[1]!)
    fireEvent.click(screen.getByRole('button', { name: en.pendingRetry }))
    fireEvent.click(screen.getByRole('button', { name: en.recoverRetry }))
    await waitFor(() => { expect(ui.command).toHaveBeenLastCalledWith(request) })
    await waitFor(() => { expect(ui.view.store.getSnapshot().retry).toBeNull() })
  })
  it('requires a fresh configuration before first admission and retains a closed unsubmitted request', () => {
    const ui = mount({ runs: [{ id: 'failed' as never, agentId: id, workspaceId: 'workspace' as never,
      sessionId: 'session' as never, prompt: 'Retry me', createdAt: 1, status: 'failed' }] })
    fireEvent.click(detail().getByRole('tab', { name: en.runs }))
    fireEvent.click(screen.getByRole('button', { name: en.retry }))
    const original = ui.view.store.getSnapshot().retry!.request
    fireEvent.click(screen.getAllByRole('button', { name: en.closeRetry })[0]!)
    act(() => {
      ui.directory.set({ ...ui.directory.getSnapshot(), agents: [{ ...agent, revision: 3 }] })
    })
    fireEvent.click(screen.getByRole('button', { name: en.retry }))
    expect(ui.view.store.getSnapshot().retry!.request).toEqual(original)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: en.confirmRetry }).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: en.discardRetry }))
    expect(ui.view.store.getSnapshot().retry).toBeNull()
    act(() => { ui.view.actions.retryOpen(true); ui.view.actions.retrySubmitted(); ui.view.actions.retryClear('other') })
    expect(ui.view.store.getSnapshot().retry).toBeNull()
    act(() => { ui.view.actions.retry(original); ui.view.actions.retryClear('other') })
    expect(ui.view.store.getSnapshot().retry?.request).toEqual(original)
    act(() => { ui.view.actions.retryClear(original.requestId) })
    expect(ui.view.store.getSnapshot().retry).toBeNull()
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


describe('recorded agent statistics', () => {
  it('derives activity and settled-run metrics while excluding older and future executions', () => {
    const now = Date.now()
    const base = { agentId: id, workspaceId: 'workspace' as never, sessionId: 'session' as never, prompt: 'Work', createdAt: now - 1000 }
    render(<AgentStatistics t={key => en[key]} runs={[
      { ...base, id: 'done' as never, status: 'completed', startedAt: now - 65000, endedAt: now - 5000 },
      { ...base, id: 'failed' as never, status: 'failed', startedAt: now - 25000, endedAt: now - 5000 },
      { ...base, id: 'cancelled' as never, status: 'cancelled' },
      { ...base, id: 'queued' as never, status: 'queued' },
      { ...base, id: 'old' as never, status: 'completed', createdAt: now - 31 * 86400000 },
      { ...base, id: 'future' as never, status: 'completed', createdAt: now + 86400000 },
    ]} />)
    expect(screen.getAllByRole('definition').map(item => item.textContent)).toEqual(['4', '33%', '0m 40s', '1'])
    expect(screen.getByRole('img', { name: en.activity }).querySelectorAll('rect')).toHaveLength(30)
  })

  it('leaves unavailable rates and durations empty and never renders negative measurements', () => {
    const { rerender } = render(<AgentStatistics t={key => en[key]} runs={[]} />)
    expect(screen.getAllByRole('definition').map(item => item.textContent)).toEqual(['0', '—', '—', '0'])
    rerender(<AgentStatistics t={key => en[key]} runs={[
      { id: 'bad-clock' as never, agentId: id, workspaceId: 'workspace' as never, sessionId: 'session' as never, prompt: 'Interrupted work', createdAt: Date.now() - 1000, status: 'interrupted', startedAt: 2, endedAt: 1 },
    ]} />)
    expect(screen.getAllByRole('definition').map(item => item.textContent)).toEqual(['1', '0%', '—', '0'])
  })
})
