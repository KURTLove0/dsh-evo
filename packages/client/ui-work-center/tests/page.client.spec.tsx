// @vitest-environment jsdom
/** Intake, attention routing, and review controls reflect authoritative facts and preserve failed drafts. */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore, type SessionListState, type WorkCenterSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import type { WorkDetail, WorkCommand, WorkReference, WorkDiagnosis, TaskBrief, TaskPreflight } from '@deepseek-ai/dsh-api-remotes/client'
import { WorkCenterPage, type WorkCenterProps } from '../src/client/WorkCenterPage.tsx'
import { SidebarWorkCenter } from '../src/client/SidebarWorkCenter.tsx'
import type { IntakeTemplateOwner } from '../src/client/template-slot.ts'
import { createWorkCenterViewStore } from '../src/client/view-store.ts'
import { en } from '../src/client/locales.ts'

const ref: Extract<WorkReference, { kind: 'agent' }> = { kind: 'agent', id: 'run' as never }
const brief: TaskBrief = { version: 1, goal: 'Review a report', background: 'Source records', deliverables: ['report.txt'], acceptanceCriteria: ['Cite sources'], constraints: 'Keep records' }
const delivery = { version: 'version' as never, outputs: [{ name: 'Response', text: 'Report ready' }], criteria: ['Cite sources'], evidence: 'recorded-response' as const, artifacts: [] }
const detail = (): WorkDetail => ({ ref, name: 'Reviewer', agentId: 'agent' as never, workspaceId: 'workspace' as never, sessionId: 'session' as never, status: 'completed', brief, delivery })
const review = () => ({ ref, version: delivery.version, revision: 1, decisionId: 'decision' as never, decision: 'changes-requested' as const, reason: 'Add citations', reviewedAt: 1, actor: 'local-operator' as const, delivery })
const ready: TaskPreflight = { checkedAt: 1, agentRevision: 2, issues: [], mcp: [], prompt: 'Exact prompt' }
const initial = (): WorkCenterSnapshot => ({ items: [], failures: [], diagnosis: undefined, diagnosisError: null, diagnosisStale: false, diagnosing: false, next: undefined, observedAt: 1, loading: false, error: null, executors: [{ id: 'agent' as never, name: 'Reviewer', revision: 2, archived: false, runtime: 'mock', instructions: 'Review', skills: [], mcpServerNames: [] }], executorError: null, attention: [], attentionNext: undefined, attentionFailures: [], selected: undefined, detail: undefined, readiness: undefined, readinessFor: undefined, pageSize: 2 })
afterEach(cleanup)
function mount(patch: Partial<WorkCenterSnapshot> = {}, connected = true, workspace = true) {
  const data = createSnapshotStore({ ...initial(), ...patch })
  const view = createWorkCenterViewStore().create()
  const sessions = createSnapshotStore<SessionListState>({ ids: [], byId: {}, phase: 'ready', current: undefined, currentAddress: undefined, subagentsByParent: {}, jobsBySession: {} })
  const query = vi.fn(async () => {})
  const diagnose = vi.fn(async () => {}), repair = vi.fn()
  const command = vi.fn(async (request: WorkCommand) => ({ ref: request.ref }))
  const submit = vi.fn(async () => ({ agentId: 'agent' as never, runId: ref.id }))
  const openSession = vi.fn(), select = vi.fn(async () => {}), more = vi.fn(async () => {})
  const refresh = vi.fn(async () => {}), configure = vi.fn(), invalidateCheck = vi.fn()
  const check = vi.fn(async (request: Parameters<WorkCenterProps['check']>[0]) => {
    data.update((state) => { state.readiness = ready; state.readinessFor = { id: request.id, workspaceId: request.workspaceId } })
    return ready
  })
  const props: WorkCenterProps = {
    renderSlot: (_name, owner) => {
      const intakeOwner = owner as unknown as IntakeTemplateOwner
      return <button type="button" onClick={() => { intakeOwner.load(brief) }}>Fixture template</button>
    },
    useWork: bindSnapshotSelector(data), useHostDescription: selector => selector(connected ? {} as never : undefined),
    useStore: bindSnapshotSelector(view.store), actions: view.actions, useSessions: bindSnapshotSelector(sessions),
    useWorkspaces: selector => selector({ items: workspace ? [{ workspaceId: 'workspace', title: 'Project', path: '/project', sessionIds: ['session'] }] : [] } as never),
    diagnose, repair, t: key => en[key as keyof typeof en], query, command, submit, openSession, select, more,
    refresh, configure, invalidateCheck, check,
  }
  render(<WorkCenterPage {...props} />)
  return { diagnose, repair, data, view, sessions, query, command, submit, openSession, select, more,
    refresh, configure, check, invalidateCheck }
}
const body = () => within(screen.getByRole('main', { name: en.title }))
const intake = () => within(screen.getByRole('region', { name: en.newTask }))
const inspection = () => within(screen.getByRole('region', { name: en.delivery }))
function fill() {
  fireEvent.click(body().getByRole('button', { name: en.newTask }))
  fireEvent.change(intake().getByRole('combobox', { name: en.executor }), { target: { value: 'agent' } })
  fireEvent.change(intake().getByRole('combobox', { name: en.workspace }), { target: { value: 'workspace' } })
  fireEvent.change(intake().getByLabelText(en.goal), { target: { value: 'Prepare report' } })
}

describe('work center presentation', () => {
  it('preserves intake fields and request identity after a failed submission, then clears only acknowledged drafts', async () => {
    const ui = mount()
    fill()
    fireEvent.change(intake().getByLabelText(en.deliverables), { target: { value: 'report.txt\n\n notes.md ' } })
    fireEvent.change(intake().getByLabelText(en.criteria), { target: { value: 'Cite sources\nInclude totals' } })
    fireEvent.change(intake().getByLabelText(en.background), { target: { value: 'Records' } })
    fireEvent.change(intake().getByLabelText(en.constraints), { target: { value: 'Read only' } })
    fireEvent.click(intake().getByRole('button', { name: en.check }))
    await intake().findByText('Exact prompt')
    ui.submit.mockRejectedValueOnce(new Error('Offline'))
    fireEvent.click(intake().getByRole('button', { name: en.submit }))
    await screen.findByText('Offline')
    const requestId = ui.view.store.getSnapshot().requestId
    expect(requestId).toBeTruthy()
    expect(intake().getByLabelText<HTMLTextAreaElement>(en.goal).value).toBe('Prepare report')
    fireEvent.click(intake().getByRole('button', { name: en.submit }))
    await waitFor(() => { expect(screen.queryByRole('region', { name: en.newTask })).toBeNull() })
    expect(ui.submit).toHaveBeenLastCalledWith(expect.objectContaining({ requestId, brief: { version: 1, goal: 'Prepare report', background: 'Records', deliverables: ['report.txt', 'notes.md'], acceptanceCriteria: ['Cite sources', 'Include totals'], constraints: 'Read only' } }))
    expect(ui.invalidateCheck).toHaveBeenCalled()
  })
  it('closes without losing a draft, clears explicitly, and reports preflight issues and unchecked MCP', async () => {
    const ui = mount({ readiness: { ...ready, issues: [{ code: 'skills', message: 'Install report skill' }], mcp: [{ name: 'CRM', status: 'not-checked' }] }, executorError: 'Catalog unavailable' })
    fill()
    expect(intake().getByText('Install report skill')).toBeTruthy()
    expect(intake().getByText(/MCP not checked/)).toBeTruthy()
    fireEvent.click(intake().getByRole('button', { name: en.closeDraft }))
    fireEvent.click(body().getByRole('button', { name: en.newTask }))
    expect(intake().getByLabelText<HTMLTextAreaElement>(en.goal).value).toBe('Prepare report')
    fireEvent.click(intake().getByRole('button', { name: en.clearDraft }))
    expect(ui.view.store.getSnapshot().fields.goal).toBe('')
    expect(intake().getByRole('button', { name: en.submit }).hasAttribute('disabled')).toBe(true)
  })
  it('filters and routes existing pending interactions without declaring a failed source complete', async () => {
    const workflowRef: Extract<WorkReference, { kind: 'workflow' }> = { kind: 'workflow', id: 'flow' as never }
    const row = { kind: 'workflow' as const, needsAttention: true, run: { id: workflowRef.id, workflowId: 'definition' as never, workflowName: 'Review leads', workspaceId: 'workspace' as never, sessionId: 'flow-session' as never, mode: 'execution' as const, status: 'waiting' as const, createdAt: 1, updatedAt: 2 } }
    const ui = mount({ items: [row], attention: [row], next: { query: 'page' }, attentionNext: { query: 'more' }, failures: [{ source: 'agent', message: 'Agent read unavailable' }], attentionFailures: [{ source: 'workflow', message: 'Workflow partial' }] })
    await act(async () => { ui.sessions.update((state) => { state.byId['session' as never] = { id: 'session' as never, displayTitle: 'Answer requested', title: 'Answer requested', pendingInteraction: 'question', running: true, blank: false, updatedAt: 1 } }) })
    const inbox = within(screen.getByRole('region', { name: en.attention }))
    fireEvent.click(inbox.getByRole('button', { name: en.transcript }))
    expect(ui.openSession).toHaveBeenCalledWith('session')
    fireEvent.click(inbox.getByRole('button', { name: en.open }))
    expect(ui.select).toHaveBeenCalledWith(workflowRef)
    fireEvent.change(inbox.getByRole('combobox', { name: en.attentionType }), { target: { value: 'approval' } })
    expect(inbox.queryByText(en.noAttentionMatch)).toBeNull()
    fireEvent.click(inbox.getByRole('button', { name: en.attentionMore }))
    await waitFor(() => { expect(ui.query).toHaveBeenLastCalledWith({ source: 'workflow', state: 'waiting' }) })
    fireEvent.change(body().getByRole('combobox', { name: en.workspace }), { target: { value: 'workspace' } })
    await waitFor(() => { expect(ui.query).toHaveBeenLastCalledWith({ source: 'workflow', state: 'waiting', workspaceId: 'workspace' }) })
    fireEvent.click(body().getByRole('button', { name: en.reset }))
    await waitFor(() => { expect(ui.query).toHaveBeenLastCalledWith({}) })
    fireEvent.click(body().getByRole('button', { name: en.more }))
    fireEvent.click(body().getByRole('button', { name: en.refresh }))
    fireEvent.click(body().getByRole('button', { name: en.agents }))
    expect(ui.more).toHaveBeenCalledOnce(); expect(ui.refresh).toHaveBeenCalledOnce(); expect(ui.configure).toHaveBeenCalledOnce()
    expect(screen.getByText(/Agent read unavailable/)).toBeTruthy()
  })
  it('disables execution offline and exposes unavailable executor and workspace setup', () => {
    mount({ executors: [], error: 'Host read failed', loading: true }, false, false)
    fireEvent.click(body().getByRole('button', { name: en.newTask }))
    expect(screen.getByText(en.disconnected)).toBeTruthy()
    expect(screen.getByText(en.configureFirst)).toBeTruthy()
    expect(intake().getByRole('button', { name: en.check }).hasAttribute('disabled')).toBe(true)
    expect(screen.queryByText(en.noAttention)).toBeNull()
  })
  it('distinguishes current, unavailable, binary, and saved evidence and requires feedback for changes', async () => {
    const saved = review()
    const current = detail()
    current.delivery = { ...delivery, version: 'changed' as never, assertion: { passed: false, detail: 'Missing references' }, artifacts: [{ path: 'missing', state: 'unavailable', error: 'Not found' }, { path: 'file.bin', state: 'captured', content: 'AA==', sha256: 'hash', bytes: 1, encoding: 'base64' }] }
    const ui = mount({ detail: { ...current, review: saved, priorReviews: [{ ...saved, decision: 'accepted', revision: 0 }], deliveryError: 'Inspection incomplete', error: 'Source error' }, selected: ref })
    expect(screen.getByText(en.changedDelivery)).toBeTruthy()
    expect(screen.getByText(en.binary)).toBeTruthy()
    expect(screen.getByText('Not found')).toBeTruthy()
    expect(inspection().getByRole('button', { name: en.accept }).hasAttribute('disabled')).toBe(true)
    expect(inspection().getByRole('button', { name: en.requestChanges }).hasAttribute('disabled')).toBe(true)
    fireEvent.change(inspection().getByLabelText(en.reason), { target: { value: 'Fix references' } })
    fireEvent.click(inspection().getByRole('button', { name: en.requestChanges }))
    await waitFor(() => { expect(ui.command).toHaveBeenCalledWith(expect.objectContaining({ kind: 'review', decision: 'changes-requested', expectedRevision: 1, reason: 'Fix references', version: 'changed' })) })
    await act(async () => { ui.data.update((state) => { state.detail = { ...detail(), revisionOf: { kind: 'agent', id: 'original' as never }, delivery: { ...delivery, assertion: { passed: true }, artifacts: [{ path: 'report.txt', state: 'captured', content: 'Report body', sha256: 'hash', bytes: 11, encoding: 'utf-8' }] } } }) })
    expect(screen.getByText('Report body')).toBeTruthy()
    fireEvent.click(inspection().getByRole('button', { name: en.revisionOrigin }))
    expect(ui.select).toHaveBeenLastCalledWith({ kind: 'agent', id: 'original' })
    fireEvent.click(inspection().getByRole('button', { name: en.transcript }))
    expect(ui.openSession).toHaveBeenLastCalledWith('session')
    fireEvent.click(inspection().getByRole('button', { name: en.accept }))
    await waitFor(() => { expect(ui.command).toHaveBeenLastCalledWith(expect.objectContaining({ decision: 'accepted', expectedRevision: 0 })) })
  })
  it('prepares an agent revision without execution and submits its checked current configuration', async () => {
    const ui = mount({ detail: { ...detail(), review: review(), configuration: { revision: 1, runtime: 'old', instructions: 'Old', skills: [], mcpServerNames: [] } } })
    fireEvent.click(inspection().getByRole('button', { name: en.revisionTask }))
    expect(ui.command).not.toHaveBeenCalled()
    expect(intake().getByText(en.originalConfig)).toBeTruthy()
    fireEvent.click(intake().getByRole('button', { name: en.check }))
    await intake().findByText('Exact prompt')
    expect(ui.check).toHaveBeenCalledWith(expect.objectContaining({ brief }), expect.objectContaining({ ref, reviewRevision: 1 }))
    fireEvent.click(intake().getByRole('button', { name: en.submit }))
    await waitFor(() => { expect(ui.command).toHaveBeenCalledWith(expect.objectContaining({ kind: 'revise-agent', ref, reviewRevision: 1, agentRevision: 2, brief })) })
  })
  it('forwards exact workflow attempts and separates revision confirmation from feedback', async () => {
    const workflowRef: Extract<WorkReference, { kind: 'workflow' }> = { kind: 'workflow', id: 'flow' as never }
    const waiting = { ...detail(), ref: workflowRef, status: 'waiting' as const, waitingAttemptId: 'attempt' as never }
    delete waiting.delivery
    const ui = mount({ detail: waiting })
    expect(screen.getByText(en.noDelivery)).toBeTruthy()
    fireEvent.click(inspection().getByRole('button', { name: en.approve }))
    await waitFor(() => { expect(ui.command).toHaveBeenCalledWith({ kind: 'decide-workflow', ref: workflowRef, attemptId: 'attempt', approve: true }) })
    fireEvent.click(inspection().getByRole('button', { name: en.reject }))
    await waitFor(() => { expect(ui.command).toHaveBeenLastCalledWith(expect.objectContaining({ approve: false })) })
    await act(async () => {
      ui.data.update((state) => { state.detail = { ...detail(), ref: workflowRef, review: { ...review(), ref: workflowRef } } })
    })
    fireEvent.click(inspection().getByRole('button', { name: en.createWorkflowRevision }))
    fireEvent.click(inspection().getByRole('button', { name: en.cancelRevision }))
    expect(ui.command).toHaveBeenCalledTimes(2)
    fireEvent.click(inspection().getByRole('button', { name: en.createWorkflowRevision }))
    ui.command.mockRejectedValueOnce('Rejected')
    fireEvent.click(inspection().getByRole('button', { name: en.confirmWorkflowRevision }))
    await screen.findByText('Rejected')
    fireEvent.click(inspection().getByRole('button', { name: en.confirmWorkflowRevision }))
    await waitFor(() => { expect(ui.command).toHaveBeenCalledTimes(4) })
    expect(ui.command.mock.calls[2]?.[0]).toEqual(ui.command.mock.calls[3]?.[0])
  })
  it('queries source and status filters and selects both structured and free-text task summaries', async () => {
    const structured = { kind: 'agent' as const, needsAttention: true, run: { id: ref.id, agentId: 'agent' as never, agentName: 'Reviewer', workspaceId: 'workspace' as never, sessionId: 'session' as never, createdAt: 1, updatedAt: 2, status: 'completed' as const, prompt: 'Raw prompt', submission: { id: 'request' as never, agentRevision: 1, brief } } }
    const legacy = { kind: 'agent' as const, needsAttention: false, run: { id: 'legacy' as never, agentId: 'other' as never, agentName: 'Legacy executor', workspaceId: 'removed' as never, sessionId: 'legacy-session' as never, createdAt: 1, updatedAt: 2, status: 'failed' as const, prompt: 'Legacy task' } }
    const ui = mount({ items: [structured, legacy], selected: ref, attention: [legacy], observedAt: 0 })
    expect(screen.getByText('Review a report')).toBeTruthy()
    expect(screen.getByText('Legacy task')).toBeTruthy()
    expect(screen.getByText('removed')).toBeTruthy()
    const runs = within(screen.getByRole('region', { name: en.runs }))
    fireEvent.click(runs.getByRole('button', { name: /Legacy executor/ }))
    expect(ui.select).toHaveBeenCalledWith({ kind: 'agent', id: 'legacy' })
    expect(screen.getAllByText(/^Created:/)).toHaveLength(2)
    expect(screen.getAllByText(/^Execution updated:/)).toHaveLength(2)
    expect(screen.getAllByText(en.ordering)).toHaveLength(1)
    fireEvent.change(body().getByRole('combobox', { name: en.source }), { target: { value: 'agent' } })
    fireEvent.click(within(body().getByRole('group', { name: en.state })).getByRole('button', { name: en.finished }))
    await waitFor(() => { expect(ui.query).toHaveBeenLastCalledWith({ source: 'agent', state: 'finished' }) })
    await act(async () => { ui.sessions.update((state) => { state.byId['session' as never] = { id: 'session' as never, displayTitle: 'Question', pendingInteraction: 'question', running: true, blank: false, updatedAt: 1 } }) })
    expect(screen.getByText('session')).toBeTruthy()
    const inbox = within(screen.getByRole('region', { name: en.attention }))
    fireEvent.change(inbox.getByRole('combobox', { name: en.attentionType }), { target: { value: 'approval' } })
    expect(await inbox.findByText(en.noAttentionMatch)).toBeTruthy()
    fireEvent.change(inbox.getByRole('combobox', { name: en.attentionType }), { target: { value: 'question' } })
    await act(async () => { ui.view.actions.filter({ source: 'all', state: 'all', workspace: 'workspace' }) })
    expect(inbox.getByRole('button', { name: en.transcript })).toBeTruthy()
    await act(async () => { ui.view.actions.filter({ source: 'all', state: 'all', workspace: 'removed' }) })
    expect(inbox.queryByRole('button', { name: en.transcript })).toBeNull()
  })
  it('keeps invalid preflight from submitting through the form and handles a preview with no prompt', async () => {
    const ui = mount({ readiness: { checkedAt: 1, agentRevision: 2, issues: [{ code: 'model', message: 'Choose a compatible model' }], mcp: [] } })
    fill()
    fireEvent.submit(screen.getByRole('region', { name: en.newTask }).querySelector('form')!)
    expect(ui.submit).not.toHaveBeenCalled()
    expect(intake().queryByText(en.preview)).toBeNull()
    await act(async () => { ui.data.update((state) => { state.executors = [] }) })
    expect(intake().getByRole('button', { name: en.check }).hasAttribute('disabled')).toBe(true)
  })
  it('keeps review request IDs stable on retry and presents an accepted unstructured response without criteria', async () => {
    const current = detail()
    delete current.brief
    current.delivery = { ...delivery, criteria: [] }
    current.review = { ...review(), decision: 'accepted' }
    const ui = mount({ detail: current })
    expect(inspection().queryByText(en.taskBrief)).toBeNull()
    expect(inspection().queryByRole('button', { name: en.revisionTask })).toBeNull()
    expect(inspection().queryByText(en.criteriaTitle)).toBeTruthy()
    ui.command.mockRejectedValueOnce(new Error('Connection interrupted'))
    fireEvent.click(inspection().getByRole('button', { name: en.accept }))
    await screen.findByText('Connection interrupted')
    fireEvent.click(inspection().getByRole('button', { name: en.accept }))
    await waitFor(() => { expect(ui.command).toHaveBeenCalledTimes(2) })
    expect(ui.command.mock.calls[0]?.[0]).toEqual(ui.command.mock.calls[1]?.[0])
  })
  it.each([true, false])('keeps sidebar navigation usable at either width (%s)', (wide) => {
    const openWorkCenter = vi.fn()
    render(<SidebarWorkCenter wide={wide} openWorkCenter={openWorkCenter}
      useSessions={selector => selector({} as never)} useWorkspaces={selector => selector({} as never)}
      t={key => en[key as keyof typeof en]} />)
    fireEvent.click(screen.getByRole('button', { name: en.title }))
    expect(openWorkCenter).toHaveBeenCalledOnce()
  })
})

it('reuses a recorded brief with pinned template provenance and keeps the source choices explicit', () => {
  const original = { ...detail(), brief: { ...brief, template: { id: 'saved-template' as never, version: 1 } } }
  const ui = mount({ detail: original, selected: original.ref })
  expect(inspection().getByText('saved-template')).toBeTruthy()
  fireEvent.click(inspection().getByRole('button', { name: en.reuseBrief }))
  expect(intake().getByRole('textbox', { name: en.goal })).toBeTruthy()
  expect(ui.view.store.getSnapshot()).toMatchObject({ fields: { goal: brief.goal, executorId: 'agent', workspaceId: 'workspace' }, template: { id: 'saved-template', version: 1 }, revision: null })
  expect(ui.invalidateCheck).toHaveBeenCalled()
  ui.view.actions.prepare('pending')
  fireEvent.click(intake().getByRole('button', { name: 'Fixture template' }))
  expect(ui.view.store.getSnapshot()).toMatchObject({ template: null, requestId: null, fields: { executorId: 'agent', workspaceId: 'workspace' } })
})

it('keeps a recorded brief inspectable when its executor is unavailable for reuse', () => {
  const original = detail(); delete original.agentId
  mount({ detail: original, selected: original.ref })
  expect(inspection().getByText(brief.goal, { exact: false })).toBeTruthy()
  expect(inspection().queryByRole('button', { name: en.reuseBrief })).toBeNull()
})

const diagnosis = (patch: Partial<WorkDiagnosis> = {}): WorkDiagnosis => ({ ref, observedAt: 1, status: 'failed',
  sources: [{ kind: 'run', sessionId: 'session' as never, state: 'available' },
    { kind: 'session', sessionId: 'child' as never, nodeId: 'review-node', state: 'available', throughSeq: 4, interval: { from: 1, to: 4 } }],
  findings: [{ source: 0, category: 'unknown', scope: 'run', terminal: true, message: 'Original run error' },
    { source: 1, category: 'timeout', scope: 'tool', terminal: false, message: 'Original tool error', code: 'TOOL_TIMEOUT', toolName: 'read', event: { seq: 4, time: 4, type: 'tool/result' } },
    { source: 1, category: 'model', scope: 'model-attempt', terminal: false, message: 'Model attempt failed', provider: 'mock',
      modelFailure: { message: 'Model attempt failed', code: 'RATE_LIMIT', status: 429, requestId: 'provider-request' as never } }],
  retry: { kind: 'agent', agentId: 'agent' as never, task: 'Original task' }, ...patch })

describe('result and failure diagnostics', () => {
  it('requires an explicit read and opens existing repair destinations without starting work', () => {
    const ui = mount({ selected: ref, detail: detail() })
    const panel = within(screen.getByRole('region', { name: en.diagnosis }))
    expect(ui.diagnose).not.toHaveBeenCalled()
    fireEvent.click(panel.getByRole('button', { name: en.readDiagnosis }))
    expect(ui.diagnose).toHaveBeenCalledOnce()
    for (const [name, target] of [[en.inspectCapabilities, 'health'], [en.inspectModels, 'models'], [en.inspectRuntimes, 'runtimes']] as const) {
      fireEvent.click(panel.getByRole('button', { name })); expect(ui.repair).toHaveBeenLastCalledWith(target)
    }
    expect(ui.command).not.toHaveBeenCalled(); expect(ui.submit).not.toHaveBeenCalled()
  })
  it('separates source errors, recorded observations, provider facts, and last-known freshness', () => {
    const report = diagnosis()
    report.sources.push({ kind: 'session', sessionId: 'unread' as never, state: 'unavailable' },
      { kind: 'session', sessionId: 'oversized' as never, state: 'capacity' },
      { kind: 'session', sessionId: 'missing-interval' as never, state: 'interval-unknown' })
    report.findings.push({ source: 0, category: 'unknown', scope: 'node', terminal: false, message: '', nodeId: 'missing-time' })
    const ui = mount({ selected: ref, detail: detail(), diagnosis: report, diagnosisStale: true, diagnosisError: 'Source failed', diagnosing: true }, false)
    const panel = within(screen.getByRole('region', { name: en.diagnosis }))
    expect(panel.getByText('Source failed')).toBeTruthy(); expect(panel.getByText(en.diagnosisStale)).toBeTruthy()
    expect(panel.getByText('HTTP 429')).toBeTruthy(); expect(panel.getByText('provider-request')).toBeTruthy()
    expect(panel.getByText(en.noErrorText)).toBeTruthy()
    expect(panel.getByText(text => text.includes(en['source-unavailable']))).toBeTruthy(); expect(panel.getByText(text => text.includes(en['source-capacity']))).toBeTruthy()
    expect(panel.getByText(text => text.includes(en['source-interval-unknown']))).toBeTruthy()
    expect(panel.getByRole('button', { name: en.diagnosing }).hasAttribute('disabled')).toBe(true)
    expect(panel.getByRole('button', { name: en.prepareRetry }).hasAttribute('disabled')).toBe(true)
    expect(ui.command).not.toHaveBeenCalled()
  })
  it('retains a submitted retry across selection changes and manually recovers the exact original request', async () => {
    const ui = mount({ selected: ref, detail: detail(), diagnosis: diagnosis() })
    const panel = within(screen.getByRole('region', { name: en.diagnosis }))
    fireEvent.click(panel.getAllByRole('button', { name: en.transcript })[1]!)
    expect(ui.openSession).toHaveBeenCalled()
    fireEvent.click(panel.getByRole('button', { name: en.prepareRetry }))
    const confirmation = () => within(screen.getByRole('region', { name: en.confirmRetry }))
    expect(ui.command).not.toHaveBeenCalled()
    ui.command.mockRejectedValueOnce(new Error('Acknowledgment lost'))
    fireEvent.click(confirmation().getByRole('button', { name: en.confirmRetry }))
    await waitFor(() => { expect(confirmation().getByText('Acknowledgment lost')).toBeTruthy() })
    const original = ui.command.mock.calls[0]![0]
    expect(original).toMatchObject({ kind: 'retry-agent', expectedRevision: 2, ref })
    await act(async () => { ui.data.update((state) => { state.selected = { kind: 'workflow', id: 'other' as never }; state.diagnosis = undefined }) })
    expect(confirmation().getByText(en.uncertainRetry)).toBeTruthy()
    fireEvent.click(confirmation().getByRole('button', { name: en.retrySource }))
    expect(ui.select).toHaveBeenLastCalledWith(ref)
    fireEvent.click(confirmation().getByRole('button', { name: en.recoverRetry }))
    await waitFor(() => { expect(screen.queryByRole('region', { name: en.confirmRetry })).toBeNull() })
    expect(ui.command.mock.calls[1]?.[0]).toEqual(original)
  })
  it('blocks an unsubmitted stale retry and allows an explicit discard without executing it', async () => {
    const ui = mount({ selected: ref, detail: detail(), diagnosis: diagnosis() })
    const panel = within(screen.getByRole('region', { name: en.diagnosis }))
    fireEvent.click(panel.getByRole('button', { name: en.prepareRetry }))
    await act(async () => { ui.data.update((state) => { state.executors[0]!.revision = 3 }) })
    const confirmation = within(screen.getByRole('region', { name: en.confirmRetry }))
    expect(confirmation.getByRole('button', { name: en.confirmRetry }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(confirmation.getByRole('button', { name: en.discardRetry }))
    expect(screen.queryByRole('region', { name: en.confirmRetry })).toBeNull()
    expect(ui.command).not.toHaveBeenCalled()
  })
  it('keeps verification semantics and prepares one explicit workflow retry after failed acceptance', async () => {
    const flow: WorkReference = { kind: 'workflow', id: 'flow' as never }
    const report = diagnosis({ ref: flow, status: 'succeeded', findings: [], retry: { kind: 'workflow', mode: 'verification', workflowId: 'workflow' as never,
      versionId: 'publication' as never, version: 1, inputs: { report: 'Original input' }, execution: { provider: 'model', model: 'model', subagentProvider: 'local' },
      assertion: { passed: false }, feedback: 'Original feedback' } })
    const ui = mount({ selected: flow, detail: { ...detail(), ref: flow }, diagnosis: report })
    const panel = within(screen.getByRole('region', { name: en.diagnosis }))
    expect(panel.getByText(en.noFailureEvidence)).toBeTruthy()
    expect(panel.getByText('Original feedback')).toBeTruthy()
    fireEvent.click(panel.getByRole('button', { name: en.openVerification })); expect(ui.repair).toHaveBeenCalledWith('workflow')
    fireEvent.click(panel.getByRole('button', { name: en.prepareRetry }))
    fireEvent.click(within(screen.getByRole('region', { name: en.confirmRetry })).getByRole('button', { name: en.confirmRetry }))
    await waitFor(() => { expect(ui.command).toHaveBeenCalledWith(expect.objectContaining({ kind: 'retry-workflow', ref: flow })) })
  })
})
it('shows captured design configuration and keeps a successful observed run separate from retry eligibility', async () => {
  const report = diagnosis({ status: 'completed', retry: { kind: 'agent', agentId: 'agent' as never, task: 'Design a candidate', purpose: 'design',
    configuration: { revision: 1, instructions: 'Original instructions', runtime: 'mock', skills: [], mcpServerNames: [] } } })
  const ui = mount({ selected: ref, detail: detail(), diagnosis: report })
  const panel = within(screen.getByRole('region', { name: en.diagnosis }))
  expect(panel.getByText(en.designRetry)).toBeTruthy()
  expect(panel.getByRole('button', { name: en.prepareRetry }).hasAttribute('disabled')).toBe(true)
  expect(panel.getByText(/Original instructions/)).toBeTruthy()
  await act(async () => { ui.data.update((state) => { state.executors = [] }) })
  expect(panel.getByText(en.noConfiguration)).toBeTruthy()
})
it('retains a workflow retry after an unstructured transport error and explicitly discards it', async () => {
  const flow: WorkReference = { kind: 'workflow', id: 'flow' as never }
  const ui = mount({ selected: flow, detail: { ...detail(), ref: flow }, diagnosis: diagnosis({ ref: flow, status: 'interrupted',
    retry: { kind: 'workflow', mode: 'execution', workflowId: 'workflow' as never, versionId: 'publication' as never,
      version: 1, inputs: {}, execution: { provider: 'mock', model: 'mock', subagentProvider: 'local' } } }) })
  const panel = within(screen.getByRole('region', { name: en.diagnosis }))
  expect(panel.getByText(text => text.endsWith(`· ${en.executionRun}`))).toBeTruthy()
  fireEvent.click(panel.getByRole('button', { name: en.prepareRetry }))
  ui.command.mockRejectedValueOnce('Network response missing')
  const confirmation = within(screen.getByRole('region', { name: en.confirmRetry }))
  fireEvent.click(confirmation.getByRole('button', { name: en.confirmRetry }))
  await waitFor(() => { expect(confirmation.getByText('Network response missing')).toBeTruthy() })
  fireEvent.click(confirmation.getByRole('button', { name: en.discardRetry }))
  expect(screen.queryByRole('region', { name: en.confirmRetry })).toBeNull()
})
