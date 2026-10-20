// @vitest-environment jsdom
/** Workbench management uses direct commands and keeps history isolated from edited drafts. */
import { useSyncExternalStore } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import type { WorkflowClientSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import type { WorkflowDocument, WorkflowRun } from '@deepseek-ai/dsh-business-workflow/workbench-types'
import { WorkbenchPage, type WorkbenchPageProps } from '../src/client/WorkbenchPage.tsx'
import { createWorkflowViewStore } from '../src/client/workbench-store.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)
const t: WorkbenchPageProps['t'] = (key, vars) =>
  Object.entries(vars ?? {}).reduce(
    (copy, [name, value]) => copy.replaceAll(`{${name}}`, String(value)),
    (en as Record<string, string>)[key] ?? key,
  )
function document(): WorkflowDocument {
  const definition = {
    requirement: {
      summary: 'Rank leads',
      objectives: [{ id: 'rank', statement: 'Rank leads' }],
      inputs: [{ name: 'leads', description: 'Source' }],
      outputs: [{ name: 'ranking', description: 'Result' }],
      constraints: [],
      acceptanceCases: [{ name: 'sample', given: { leads: 'a' }, expect: { kind: 'nonEmpty' as const } }],
    },
    nodes: [
      {
        id: 'rank',
        title: 'Rank leads',
        kind: 'agent' as const,
        instruction: 'Rank the source.',
        preset: 'standard',
        dependsOn: [],
        inputs: [{ name: 'leads', source: { kind: 'requirement' as const, field: 'leads' } }],
        objectives: ['rank'],
      },
    ],
    finalOutputs: [{ name: 'ranking', source: { kind: 'step' as const, step: 'rank' } }],
    positions: {},
  }
  return {
    id: 'workflow-1' as WorkflowDocument['id'],
    workspaceId: 'workspace-1' as WorkflowDocument['workspaceId'],
    name: 'Customer ranking',
    revision: 3,
    createdAt: 1,
    updatedAt: 1,
    archived: false,
    draft: definition,
    versions: [{ id: 'v1' as WorkflowDocument['versions'][number]['id'], number: 1, revision: 2, createdAt: 1, definition: structuredClone(definition) }],
  }
}
function mount(
  data: WorkflowClientSnapshot = {
    workflows: [],
    runs: [],
    operations: [],
    latestRuns: [],
    presets: ['standard'],
    error: null,
    loading: false,
  },
) {
  const store = createWorkflowViewStore().create()
  const props: WorkbenchPageProps = {
    t,
    command: vi.fn().mockResolvedValue({ workflowId: 'workflow-1', revision: 4, runIds: ['run-1'] }),
    selectWorkflow: vi.fn().mockResolvedValue(undefined),
    validate: vi.fn().mockResolvedValue({ valid: true, issues: [] }),
    closePage: vi.fn(),
    openSession: vi.fn(),
    openExecution: vi.fn(),
    actions: store.actions,
    useStore: selector =>
      selector(
        useSyncExternalStore(
          listener => store.subscribe(listener),
          () => store.getSnapshot(),
        ),
      ),
    useWorkflows: selector => selector(data),
    useSessions: selector => selector({ byId: {} } as never),
    useWorkspaces: selector =>
      selector({ items: [{ workspaceId: 'workspace-1', title: 'Sales workspace' }] } as never),
  }
  return { ...render(<WorkbenchPage {...props} />), props, store }
}
describe('workspace workflow page', () => {
  const ready = (): WorkflowClientSnapshot => {
    const record = document()
    return { workflows: [record], selectedId: record.id, runs: [], operations: [], latestRuns: [], presets: ['standard'], error: null, loading: false }
  }

  it('opens creation within the page and retains unfinished fields when collapsed', () => {
    const ui = mount(ready())
    expect(ui.queryByRole('form', { name: 'New workflow' })).toBeNull()
    fireEvent.click(ui.getByRole('button', { name: 'New workflow' }))
    fireEvent.change(ui.getAllByLabelText('Workflow name')[0]!, { target: { value: 'New draft' } })
    fireEvent.click(ui.getByRole('button', { name: 'Close creation form' }))
    expect(ui.queryByRole('form', { name: 'New workflow' })).toBeNull()
    expect(ui.getByRole('button', { name: 'New workflow' })).toBe(globalThis.document.activeElement)
    fireEvent.click(ui.getByRole('button', { name: 'New workflow' }))
    expect(ui.getByRole('form', { name: 'New workflow' }).querySelector('input')?.value).toBe('New draft')
    expect(ui.queryByRole('dialog')).toBeNull()
  })

  it('switches the segmented views by keyboard and associates the selected tab with its panel', () => {
    const ui = mount(ready())
    const design = ui.getByRole('tab', { name: 'Flow design' })
    const runs = ui.getByRole('tab', { name: 'Run history' })
    const verification = ui.getByRole('tab', { name: 'Verification results' })
    design.focus()
    expect(design.getAttribute('aria-selected')).toBe('true')
    expect(runs.tabIndex).toBe(-1)
    fireEvent.keyDown(design, { key: 'ArrowRight' })
    expect(ui.getByRole('tabpanel', { name: 'Run history' }).id).toBe(runs.getAttribute('aria-controls'))
    expect(runs.getAttribute('aria-selected')).toBe('true')
    expect(runs).toBe(globalThis.document.activeElement)
    fireEvent.keyDown(runs, { key: 'End' })
    expect(verification).toBe(globalThis.document.activeElement)
    fireEvent.keyDown(verification, { key: 'ArrowRight' })
    expect(design).toBe(globalThis.document.activeElement)
    fireEvent.keyDown(design, { key: 'ArrowLeft' })
    expect(verification).toBe(globalThis.document.activeElement)
    fireEvent.keyDown(verification, { key: 'Home' })
    expect(design.getAttribute('aria-selected')).toBe('true')
    expect(design).toBe(globalThis.document.activeElement)
  })

  it('keeps the draft status distinct from execution success', () => {
    const ui = mount(ready())
    expect(ui.getByText('Draft saved').getAttribute('data-status')).toBe('saved')
    fireEvent.change(ui.getByLabelText('Node title'), { target: { value: 'Revised title' } })
    expect(ui.getByText('Unsaved changes').getAttribute('data-status')).toBe('unsaved')
    expect(ui.getByRole('region', { name: 'Node configuration' })).toBeTruthy()
  })

  it('explains an empty search and clears filters without losing the selected draft', () => {
    const ui = mount(ready())
    fireEvent.change(ui.getByLabelText('Search workflows'), { target: { value: 'missing' } })
    expect(ui.getByText('No matching workflows.')).toBeTruthy()
    fireEvent.click(ui.getByRole('button', { name: 'Clear filters' }))
    expect(ui.getByRole('button', { name: /Customer ranking/ })).toBeTruthy()
    fireEvent.change(ui.getByLabelText('Search workflows'), { target: { value: '  CUSTOMER  ' } })
    expect(ui.getByRole('button', { name: /Customer ranking/ })).toBeTruthy()
  })

  it('edits an acceptance condition through labeled form controls', () => {
    const data = ready()
    const ui = mount(data)
    fireEvent.change(ui.getByLabelText('Case name'), { target: { value: 'Named example' } })
    fireEvent.change(ui.getByLabelText('Acceptance condition'), { target: { value: 'contains' } })
    fireEvent.change(ui.getByLabelText('Expected text'), { target: { value: 'priority lead' } })
    expect(ui.store.getSnapshot().drafts[data.selectedId!]?.definition.requirement.acceptanceCases[0]).toMatchObject({
      name: 'Named example', expect: { kind: 'contains', value: 'priority lead' },
    })
  })

  it('keeps an invalid run input blocked across tab changes and restores it after repair', () => {
    const ui = mount(ready())
    const input = ui.getByLabelText('Run inputs (JSON)')
    fireEvent.change(input, { target: { value: '{' } })
    fireEvent.click(ui.getByRole('tab', { name: 'Run history' }))
    expect((ui.getByRole('button', { name: 'Run workflow' }) as HTMLButtonElement).disabled).toBe(true)
    expect(input.getAttribute('aria-invalid')).toBe('true')
    fireEvent.change(input, { target: { value: '{"leads":"customer"}' } })
    expect((ui.getByRole('button', { name: 'Run workflow' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('offers zoom and fit controls without changing the saved definition', () => {
    const ui = mount(ready())
    fireEvent.click(ui.getByRole('button', { name: 'Zoom in' }))
    expect(ui.getByLabelText('Canvas zoom level').textContent).toBe('125%')
    fireEvent.click(ui.getByRole('button', { name: 'Zoom out' }))
    expect(ui.getByLabelText('Canvas zoom level').textContent).toBe('100%')
    fireEvent.click(ui.getByRole('button', { name: 'Fit to canvas' }))
    expect(ui.store.getSnapshot().drafts).toEqual({})
  })

  it('releases an invalid acceptance input when that case is removed', () => {
    const ui = mount(ready())
    fireEvent.change(ui.getByLabelText('Case 1 inputs (JSON)'), { target: { value: '[' } })
    fireEvent.click(ui.getByRole('button', { name: 'Remove sample', hidden: true }))
    expect(ui.queryByRole('alert')).toBeNull()
    expect((ui.getByRole('button', { name: 'Save draft' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('moves expanded cards using their displayed positions', () => {
    const data = ready()
    const record = data.workflows[0]!
    record.draft.nodes.push({ ...record.draft.nodes[0]!, id: 'second', title: 'Second step', dependsOn: ['rank'] })
    const ui = mount(data)
    fireEvent.keyDown(ui.getByRole('button', { name: 'Second step (second), Pending' }), { key: 'ArrowRight' })
    expect(ui.store.getSnapshot().drafts[record.id]?.definition.positions.second).toEqual({ x: 324, y: 8 })
  })

  it('can bind an upstream output even when the workflow has no business input fields', () => {
    const data = ready()
    const record = data.workflows[0]!
    record.draft.requirement.inputs = []
    record.draft.nodes[0]!.inputs = []
    record.draft.nodes.push({ ...record.draft.nodes[0]!, id: 'second', title: 'Second step', dependsOn: [] })
    const ui = mount(data)
    fireEvent.click(ui.getByRole('button', { name: 'Second step (second), Pending' }))
    fireEvent.click(ui.getAllByRole('button', { name: 'Add input' }).at(-1)!)
    expect(ui.store.getSnapshot().drafts[record.id]?.definition.nodes[1]).toMatchObject({
      dependsOn: ['rank'], inputs: [{ name: 'Rank leads', source: { kind: 'step', step: 'rank' } }],
    })
  })

  it('presents a failed save as an error while retaining the edited node', async () => {
    const data = ready()
    const ui = mount(data)
    vi.mocked(ui.props.command).mockRejectedValueOnce(new Error('Revision conflict'))
    fireEvent.change(ui.getByLabelText('Instruction / confirmation description'), { target: { value: 'Retain these edits' } })
    fireEvent.click(ui.getByRole('button', { name: 'Save draft' }))
    await waitFor(() => { expect(ui.getByRole('alert').textContent).toContain('Revision conflict') })
    expect(ui.store.getSnapshot().drafts[data.selectedId!]?.definition.nodes[0]?.instruction).toBe('Retain these edits')
  })

  it('creates an inline draft in an explicit workspace without creating a conversation', async () => {
    const ui = mount()
    expect(ui.queryByRole('dialog')).toBeNull()
    fireEvent.change(ui.getByLabelText('Workflow name'), { target: { value: 'Lead ranking' } })
    fireEvent.change(ui.getByLabelText('Business requirements and clarification'), { target: { value: 'Rank leads' } })
    fireEvent.change(ui.getAllByLabelText('Workspace')[0]!, { target: { value: 'workspace-1' } })
    fireEvent.click(ui.getByRole('button', { name: 'Create draft' }))
    await waitFor(() => {
      expect(ui.props.command).toHaveBeenCalledWith({ kind: 'create', workspaceId: 'workspace-1', name: 'Lead ranking', description: 'Rank leads' })
    })
  })

  it('edits node instructions, saves with the base revision, and blocks publishing unsaved edits', async () => {
    const record = document()
    const ui = mount({
      workflows: [record],
      selectedId: record.id,
      runs: [],
      operations: [],
      latestRuns: [],
      presets: ['standard'],
      error: null,
      loading: false,
    })
    fireEvent.change(ui.getByLabelText('Instruction / confirmation description'), {
      target: { value: 'Score leads by revenue.' },
    })
    expect((ui.getByRole('button', { name: 'Publish version' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(ui.getByRole('button', { name: 'Save draft' }))
    await waitFor(() => {
      expect(ui.props.command).toHaveBeenCalledOnce()
      const request = vi.mocked(ui.props.command).mock.calls[0]?.[0]
      expect(request?.kind).toBe('save')
      if (request?.kind !== 'save') throw new Error('Expected save command')
      expect(request.expectedRevision).toBe(3)
      expect(request.definition.nodes[0]?.instruction).toBe('Score leads by revenue.')
    })
  })

  it('keeps invalid JSON out of editor data and prevents saving', () => {
    const record = document()
    const ui = mount({
      workflows: [record],
      selectedId: record.id,
      runs: [],
      operations: [],
      latestRuns: [],
      presets: ['standard'],
      error: null,
      loading: false,
    })
    fireEvent.change(ui.getByLabelText('Node input sources (JSON)'), { target: { value: '{"unexpected":true}' } })
    expect(ui.getByRole('alert')).toBeTruthy()
    expect((ui.getByRole('button', { name: 'Save draft' }) as HTMLButtonElement).disabled).toBe(true)
    expect(ui.store.getSnapshot().drafts[record.id]).toBeUndefined()
  })

  it('shows historical definitions and actual node inputs while a newer draft is edited', () => {
    const record = document()
    record.draft.nodes[0]!.title = 'Edited node'
    const run: WorkflowRun = {
      id: 'run-1' as WorkflowRun['id'],
      workflowId: record.id,
      workspaceId: record.workspaceId,
      version: record.versions[0]!,
      sessionId: 'audit' as WorkflowRun['sessionId'],
      mode: 'execution',
      inputs: { leads: 'actual customer' },
      execution: { provider: 'mock', model: 'mock', subagentProvider: 'spawn' },
      status: 'succeeded',
      seq: 4,
      createdAt: 1,
      updatedAt: 2,
      attempts: [
        {
          id: 'attempt-1' as WorkflowRun['attempts'][number]['id'],
          nodeId: 'rank',
          status: 'succeeded',
          inputs: { leads: 'actual customer' },
          sources: { leads: { kind: 'requirement', field: 'leads' } },
          cwd: '/sales',
          preset: 'standard',
          provider: 'mock',
          model: 'mock',
          output: 'ranked customer',
        },
      ],
      outputs: { ranking: 'ranked customer' },
    }
    const ui = mount({
      workflows: [record],
      selectedId: record.id,
      runs: [run],
      operations: [],
      latestRuns: [],
      presets: ['standard'],
      error: null,
      loading: false,
    })
    fireEvent.click(ui.getByRole('tab', { name: 'Run history' }))
    fireEvent.click(ui.getByRole('button', { name: /v1 · Succeeded/ }))
    expect(ui.getByRole('button', { name: 'Rank leads (rank), Succeeded' })).toBeTruthy()
    expect(ui.queryByText('Edited node')).toBeNull()
    expect(ui.getByText(/"actual customer"/)).toBeTruthy()
    expect(ui.getByText('ranked customer')).toBeTruthy()
  })
})
