/** Independent workflow directory, definition editor, and immutable run inspection. */
import { useId, useRef, useEffect, useState, useCallback, type FormEvent } from 'react'
import {
  IconBranchOutline16, IconPlusOutline16, IconChevronLeftOutline14,
  IconSearchOutline16, IconPlayOutline16, IconEnhanceOutline16,
  IconCheckOutline16, IconArchiveOutline20,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkflowClientSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  HostObservable,
  InjectFace,
  PropsLocale,
  PropsRuntime,
  PropsStore,
} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {
  WorkflowCommand,
  WorkflowDefinition,
  WorkflowId,
  WorkflowReceipt,
  WorkflowValidation,
  WorkflowNode,
  WorkflowRun,
  WorkflowRunStatus,
} from '@deepseek-ai/dsh-business-workflow/workbench-types'
import { definitionSchema } from '@deepseek-ai/dsh-business-workflow/definition'
import { NS, type BusinessWorkflowKey } from './locales.ts'
import { createWorkflowViewStore, type WorkflowEditorDraft } from './workbench-store.ts'
import { JsonField } from './JsonField.tsx'
import { WorkflowGraph } from './WorkflowGraph.tsx'
import { RequirementFields, NodeFields } from './DefinitionFields.tsx'
import { layoutBoard, WORKBENCH_NODE_SIZE, type BoardNodeStatus } from './board-layout.ts'
import css from './BusinessWorkflowPage.module.css'

/** Pure page operations; records arrive only through the bound runtime source. */
export interface WorkbenchPageInjected {
  /** Persist one management command. */
  command: (request: WorkflowCommand) => Promise<WorkflowReceipt>
  /** Read a selected workflow's history. */
  selectWorkflow: (id: WorkflowId) => Promise<void>
  /** Validate the exact editor definition. */
  validate: (definition: WorkflowDefinition) => Promise<WorkflowValidation>
  /** Return to conversation view. */
  closePage: () => void
  /** Open a legacy conversation or node execution session. */
  openSession: (id: string) => void
  /** Inspect a one-shot child through its durable parent/child address. */
  openExecution: (parentId: string, childId: string) => void
  readonly hooks: {
    /** Stable object-layer directory and history owner. */
    workflows: HostObservable<WorkflowClientSnapshot>
  }
}
/** Complete props derived by the slot renderer. */
export type WorkbenchPageProps = PropsRuntime<'shell.page'> &
  PropsLocale<typeof NS> &
  PropsStore<ReturnType<typeof createWorkflowViewStore>> &
  InjectFace<WorkbenchPageInjected>
const statusKey = (status: WorkflowRunStatus | 'pending' | 'skipped'): BusinessWorkflowKey => `wb.${status}`
function startedRun(receipt: WorkflowReceipt): string {
  const id = receipt.runIds?.[0]
  if (id === undefined) throw new Error('The start operation returned no run identity.')
  return id
}
const finished = (run: WorkflowRun): boolean => ['succeeded', 'failed', 'cancelled', 'interrupted'].includes(run.status)
const emptyInputs = {}
const tabs = ['design', 'runs', 'verification'] as const

/**
 * Render workspace workflow management without requiring a chat session.
 * @param props - runtime snapshot, editor store, operations, and locale.
 * @returns inline creation, graph editor, and selected execution history.
 */
export function WorkbenchPage({
  useWorkflows,
  useWorkspaces,
  useSessions,
  useStore,
  actions,
  command,
  selectWorkflow,
  validate,
  closePage,
  openSession,
  openExecution,
  t,
}: WorkbenchPageProps) {
  const data = useWorkflows(state => state)
  const view = useStore(state => state)
  const workspaces = useWorkspaces(state => state.items)
  const sessions = useSessions(state => state.byId)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('')
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [failure, setFailure] = useState('')
  const [invalid, setInvalid] = useState<Record<string, boolean>>({})
  const [inputDrafts, setInputDrafts] = useState<Record<string, Record<string, import('@deepseek-ai/dsh-session/types').JsonValue>>>({})
  const [versionId, setVersionId] = useState('')
  const [creating, setCreating] = useState(false)
  const createForm = useRef<HTMLFormElement>(null)
  const createTrigger = useRef<HTMLButtonElement>(null)
  const createId = useId()
  const selected = data.workflows.find(item => item.id === data.selectedId)
  const draft =
    selected === undefined
      ? undefined
      : (view.drafts[selected.id] ?? {
        id: selected.id,
        name: selected.name,
        revision: selected.revision,
        definition: selected.draft,
      })
  const selectedRun = data.runs.find(run => run.id === view.runId)
  const runView = view.tab !== 'design'
  const definition = runView ? selectedRun?.version.definition : draft?.definition
  const node = definition?.nodes.find(item => item.id === view.nodeId) ?? definition?.nodes[0]
  const attempt = selectedRun?.attempts.find(item => item.nodeId === node?.id)
  const version = selected?.versions.find(item => item.id === versionId) ?? selected?.versions.at(-1)
  const inputs = inputDrafts[version?.id ?? ''] ?? emptyInputs
  const error = failure || data.failure || data.error
  const visibleWorkflows = data.workflows.filter(item =>
    (filter === '' || filter === item.workspaceId) &&
    item.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
  )
  const visibleRuns = data.runs.filter(run => run.mode === (view.tab === 'verification' ? 'verification' : 'execution'))
  const showCreate = creating || data.workflows.length === 0
  const beginCreate = (): void => {
    setCreating(true)
  }
  useEffect(() => {
    if (creating) {
      createForm.current?.querySelector<HTMLInputElement>('input')?.focus()
    }
  }, [creating])
  const hasInvalid = Object.values(invalid).some(Boolean)
  const changed = selected !== undefined && view.drafts[selected.id] !== undefined
  const validity = useCallback((label: string, valid: boolean): void => {
    setInvalid(current => current[label] === !valid ? current : { ...current, [label]: !valid })
  }, [])
  const edit = (next: WorkflowEditorDraft): void => {
    actions.edit(next)
    setFeedback('')
  }
  const changeDefinition = (next: WorkflowDefinition): void => {
    if (draft !== undefined) edit({ ...draft, definition: next })
  }
  const editNode = (patch: Partial<WorkflowNode>): void => {
    if (definition !== undefined && node !== undefined)
      changeDefinition({
        ...definition,
        nodes: definition.nodes.map(item => (item.id === node.id ? { ...item, ...patch } : item)),
      })
  }
  const perform = async (action: () => Promise<unknown>): Promise<void> => {
    if (busy) return
    setBusy(true)
    setFeedback('')
    setFailure('')
    try {
      await action()
    } catch (failure) {
      setFailure(String(failure))
    } finally {
      setBusy(false)
    }
  }
  const create = (event: FormEvent): void => {
    event.preventDefault()
    const workspace = workspaces.find(item => item.workspaceId === view.workspaceId)
    if (workspace === undefined) return
    void perform(async () => {
      await command({
        kind: 'create',
        workspaceId: workspace.workspaceId,
        name: view.newName,
        description: view.description,
      })
      actions.newName('')
      actions.description('')
      actions.tab('design')
      setCreating(false)
    })
  }
  const save = async (): Promise<void> => {
    if (draft === undefined) return
    await command({
      kind: 'save',
      id: draft.id,
      expectedRevision: draft.revision,
      name: draft.name,
      definition: draft.definition,
    })
    if (selected !== undefined) actions.reset(selected)
    setFeedback(t('wb.saved'))
  }
  const addNode = (kind: WorkflowNode['kind']): void => {
    if (definition === undefined || data.presets[0] === undefined) return
    const id = crypto.randomUUID()
    changeDefinition({
      ...definition,
      nodes: [
        ...definition.nodes,
        {
          id,
          title: kind === 'agent' ? t('wb.addAgent') : t('wb.addApproval'),
          kind,
          instruction: kind === 'agent' ? definition.requirement.summary : t('wb.approve'),
          preset: data.presets[0],
          dependsOn: [],
          inputs: [],
          objectives: [],
        },
      ],
    })
    actions.node(id)
  }
  const statuses = new Map<string, BoardNodeStatus>(
    (definition?.nodes ?? []).map((item) => {
      const state = selectedRun?.attempts.find(entry => entry.nodeId === item.id)?.status
      return [item.id, state === 'succeeded' ? 'completed' : state === 'failed' ? 'failed' : 'pending']
    }),
  )
  return (
    <main className={css.page} data-business-workflow-page aria-label={t('action.entry')}>
      <header className={css.header}>
        <div className={css.pageHeading}>
          <span className={css.pageIcon} aria-hidden="true"><IconBranchOutline16 size={24} /></span>
          <div><h1>{t('action.entry')}</h1>
            <p>{t('page.description')}</p></div>
        </div>
        <div className={css.headerActions}>
          <button className={css.quiet} type="button" onClick={closePage}>
            <span aria-hidden="true"><IconChevronLeftOutline14 /></span>{t('page.back')}
          </button>
          <button ref={createTrigger} className={selected === undefined && !showCreate ? css.primary : undefined} type="button" aria-expanded={showCreate} aria-controls={`${createId}-form`} onClick={beginCreate}>
            <span aria-hidden="true"><IconPlusOutline16 /></span>{t('action.new')}
          </button>
        </div>
      </header>
      {showCreate ? <form ref={createForm} id={`${createId}-form`} className={css.create} onSubmit={create} aria-label={t('action.new')}>
        <div className={css.sectionHeading}><div><span className={css.eyebrow}>{t('wb.startHere')}</span><h2>{t('action.new')}</h2></div>
          {data.workflows.length > 0 ? <button className={css.quiet} type="button" onClick={() => { setCreating(false); createTrigger.current?.focus() }}>{t('wb.closeCreate')}</button> : null}
        </div>
        <div className={css.formGrid}>
          <label htmlFor={`${createId}-workspace`}>
            {t('wb.workspace')}
            <select
              id={`${createId}-workspace`}
              value={view.workspaceId}
              required
              onChange={(event) => {
                actions.workspace(event.target.value)
              }}
            >
              <option value="">—</option>
              {workspaces.map(item => (
                <option key={item.workspaceId} value={item.workspaceId}>
                  {item.title}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor={`${createId}-name`}>
            {t('wb.name')}
            <input
              id={`${createId}-name`}
              value={view.newName}
              required
              onChange={(event) => {
                actions.newName(event.target.value)
              }}
            />
          </label>
        </div>
        <label htmlFor={`${createId}-description`}>
          {t('wb.description')}
          <textarea
            id={`${createId}-description`}
            rows={2}
            required
            value={view.description}
            onChange={(event) => {
              actions.description(event.target.value)
            }}
          />
        </label>
        <div className={css.formFooter}>
          <span>{t('wb.candidateHint')}</span>
          <button
            type="submit"
            className={css.primary}
            disabled={busy || view.workspaceId === '' || view.newName.trim() === '' || view.description.trim() === ''}
          >
            {t('wb.create')}
          </button>
        </div>
      </form> : null}
      {error ? (
        <p role="alert" className={css.error}>
          {error}
        </p>
      ) : null}
      {feedback ? <p role="status" className={css.feedback}>{feedback}</p> : null}
      {data.loading ? <span role="status">{t('wb.loading')}</span> : null}
      <div className={css.workspace}>
        <aside className={css.records} aria-label={t('wb.directory')}>
          <div className={css.sectionHeading}><h2>{t('wb.directory')}</h2><span className={css.count}>{visibleWorkflows.length}</span></div>
          <label>
            {t('wb.search')}
            <span className={css.searchField}><span aria-hidden="true"><IconSearchOutline16 /></span><input
              type="search"
              value={search}
              placeholder={t('wb.searchHint')}
              onChange={(event) => {
                setSearch(event.target.value)
              }}
            /></span>
          </label>
          <label>
            {t('wb.workspace')}
            <select
              value={filter}
              onChange={(event) => {
                setFilter(event.target.value)
              }}
            >
              <option value="">{t('wb.all')}</option>
              {workspaces.map(item => (
                <option key={item.workspaceId} value={item.workspaceId}>
                  {item.title}
                </option>
              ))}
            </select>
          </label>
          {data.workflows.length === 0 ? <p>{t('wb.empty')}</p> : null}
          {data.workflows.length > 0 && visibleWorkflows.length === 0 ? <div className={css.emptySearch}><p>{t('wb.noMatches')}</p><button onClick={() => { setSearch(''); setFilter('') }}>{t('wb.clearFilters')}</button></div> : null}
          <ul className={css.recordList}>
            {visibleWorkflows.map(item => (
              <li key={item.id}>
                <button
                  type="button"
                  className={css.record}
                  disabled={busy}
                  aria-pressed={selected?.id === item.id}
                  onClick={() => {
                    void perform(async () => {
                      await selectWorkflow(item.id)
                      actions.tab('design')
                      actions.node('')
                      setFeedback('')
                    })
                  }}
                >
                  <span className={css.recordTitle}><span aria-hidden="true"><IconBranchOutline16 /></span><strong>{item.name}</strong></span>
                  <span>
                    {workspaces.find(workspace => workspace.workspaceId === item.workspaceId)?.title} ·{' '}
                    {item.archived
                      ? t('wb.archived')
                      : item.versions.length === 0
                        ? t('wb.unpublished')
                        : `v${item.versions.length}`}
                  </span>
                  {data.latestRuns.filter(run => run.workflowId === item.id).map(run => (
                    <span className={css.runMeta} key={run.id}>
                      <span className={css.status} data-status={run.status}>{t(statusKey(run.status))}</span>
                      <time dateTime={new Date(run.createdAt).toISOString()}>{new Date(run.createdAt).toLocaleDateString()}</time>
                    </span>
                  ))}
                </button>
              </li>
            ))}
          </ul>
          <details>
            <summary>{t('wb.history')}</summary>
            {Object.values(sessions).map(session => (
              <button
                type="button"
                key={session.id}
                onClick={() => {
                  openSession(session.id)
                }}
              >
                {session.displayTitle}
              </button>
            ))}
          </details>
        </aside>
        <section className={css.detail} aria-label={t('page.detail')} data-business-workflow-id={selected?.id}>
          {selected === undefined || draft === undefined ? (
            <div className={css.emptyDetail}><span className={css.emptyIcon} aria-hidden="true"><IconBranchOutline16 size={36} /></span><h2>{t('wb.selectWorkflow')}</h2><p>{t('wb.selectHint')}</p><button className={css.primary} onClick={beginCreate}><span aria-hidden="true"><IconPlusOutline16 /></span>{t('action.new')}</button></div>
          ) : (
            <>
              <header className={css.detailHeader}>
                <div>
                  <span className={css.eyebrow}>{workspaces.find(item => item.workspaceId === selected.workspaceId)?.title}</span>
                  <h2>{selected.name}</h2>
                  <div className={css.detailMeta}><span className={css.status} data-status={changed ? 'unsaved' : 'saved'}>{changed ? t('wb.unsaved') : t('wb.savedDraft')}</span><span>{selected.archived ? t('wb.archived') : selected.versions.length === 0 ? t('wb.unpublished') : `v${selected.versions.at(-1)?.number}`}</span><span>{t('section.steps', { count: draft.definition.nodes.length })}</span></div>
                </div>
                <div className={css.toolbar}>
                  <button
                    className={css.quiet}
                    disabled={busy}
                    onClick={() => {
                      void perform(async () => {
                        await command({
                          kind: 'archive',
                          id: selected.id,
                          expectedRevision: selected.revision,
                          archived: !selected.archived,
                        })
                      })
                    }}
                  >
                    <span aria-hidden="true"><IconArchiveOutline20 size={16} /></span>{t(selected.archived ? 'wb.restore' : 'wb.archive')}
                  </button>
                </div>
              </header>
              {changed && selected.revision !== draft.revision ? <p role="alert">{t('wb.conflict')}</p> : null}
              <div className={css.viewBar}>
                <div className={css.tabs} role="tablist" aria-label={t('page.detail')}>
                  {tabs.map((tab, index) => (
                    <button
                      type="button"
                      key={tab}
                      role="tab"
                      id={`${createId}-${tab}`}
                      aria-selected={view.tab === tab}
                      aria-controls={`${createId}-panel`}
                      tabIndex={view.tab === tab ? 0 : -1}
                      onKeyDown={(event) => {
                        let next = index
                        switch (event.key) {
                          case 'ArrowRight': next = (index + 1) % tabs.length; break
                          case 'ArrowLeft': next = (index + tabs.length - 1) % tabs.length; break
                          case 'Home': next = 0; break
                          case 'End': next = tabs.length - 1; break
                          default: return
                        }
                        event.preventDefault()
                        actions.tab(tabs[next] as (typeof tabs)[number])
                        actions.node('')
                        event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus()
                      }}
                      onClick={() => {
                        actions.tab(tab)
                        actions.node('')
                      }}
                    >
                      {t(`wb.${tab}`)}
                    </button>
                  ))}
                </div>
                <span className={css.hint} role="status">{busy ? t('wb.working') : ''}</span>
              </div>
              <div id={`${createId}-panel`} role="tabpanel" aria-labelledby={`${createId}-${view.tab}`} tabIndex={0} className={css.tabPanel}>
                {!runView ? (
                  <>
                    <div className={css.toolbar}>
                      <button
                        className={changed ? css.primary : undefined}
                        disabled={busy || !changed || hasInvalid || selected.archived}
                        onClick={() => {
                          void perform(save)
                        }}
                      >
                        {t('wb.save')}
                      </button>
                      <button
                        disabled={busy || hasInvalid}
                        onClick={() => {
                          void perform(async () => {
                            const result = await validate(draft.definition)
                            if (result.valid) setFeedback(t('wb.valid'))
                            else setFailure(result.issues.join('\n'))
                          })
                        }}
                      >
                        <span aria-hidden="true"><IconCheckOutline16 /></span>{t('wb.validate')}
                      </button>
                      <button
                        className={!changed ? css.primary : undefined}
                        disabled={busy || changed || hasInvalid || selected.archived}
                        onClick={() => {
                          void perform(async () => {
                            await command({ kind: 'publish', id: selected.id, expectedRevision: selected.revision })
                          })
                        }}
                      >
                        <span aria-hidden="true"><IconPlayOutline16 /></span>{t('wb.publish')}
                      </button>
                      {changed ? (
                        <button
                          onClick={() => {
                            actions.reset(selected)
                          }}
                        >
                          {t('wb.reload')}
                        </button>
                      ) : null}
                    </div>
                    <fieldset
                      disabled={busy || selected.archived}
                      className={css.editor}
                      key={`${selected.id}:${draft.revision}`}
                    >
                      <details className={css.requirement}><summary><span>{t('wb.requirement')}</span><span className={css.summaryHint}>{draft.definition.requirement.summary}</span></summary><div className={css.requirementBody}>
                        <label>
                          {t('wb.name')}
                          <input
                            value={draft.name}
                            onChange={(event) => {
                              edit({ ...draft, name: event.target.value })
                            }}
                          />
                        </label>
                        <label>
                          {t('wb.description')}
                          <textarea
                            value={draft.definition.requirement.summary}
                            rows={4}
                            onChange={(event) => {
                              changeDefinition({
                                ...draft.definition,
                                requirement: { ...draft.definition.requirement, summary: event.target.value },
                              })
                            }}
                          />
                        </label>
                        <button
                          disabled={busy || changed || hasInvalid || selected.archived}
                          onClick={() => {
                            void perform(async () => {
                              await command({
                                kind: 'generate',
                                id: selected.id,
                                expectedRevision: selected.revision,
                                description: draft.definition.requirement.summary,
                              })
                            })
                          }}
                        >
                          <span aria-hidden="true"><IconEnhanceOutline16 /></span>{t('wb.generate')}
                        </button>
                        {changed ? <small>{t('wb.saveBeforeGenerate')}</small> : null}
                        <div>
                          <RequirementFields definition={draft.definition} onChange={changeDefinition} onValidity={validity} t={t} />
                          <details><summary>{t('wb.advanced')}</summary>
                            {(
                              [
                                ['objectives', 'wb.goals'],
                                ['inputs', 'wb.fieldsIn'],
                                ['outputs', 'wb.fieldsOut'],
                                ['constraints', 'wb.constraints'],
                                ['acceptanceCases', 'wb.cases'],
                              ] as const
                            ).map(([key, label]) => (
                              <JsonField
                                key={`${key}:${selected.id}`}
                                label={t(label)}
                                value={draft.definition.requirement[key]}
                                parse={value => definitionSchema.shape.requirement.shape[key].parse(value)}
                                onValidity={validity}
                                onChange={(value) => {
                                  changeDefinition({
                                    ...draft.definition,
                                    requirement: { ...draft.definition.requirement, [key]: value },
                                  })
                                }}
                              />
                            ))}
                            <JsonField
                              label={t('wb.bindings')}
                              value={draft.definition.finalOutputs}
                              parse={value => definitionSchema.shape.finalOutputs.parse(value)}
                              onValidity={validity}
                              onChange={(value) => {
                                changeDefinition({ ...draft.definition, finalOutputs: value })
                              }}
                            />
                          </details>
                        </div>
                      </div></details>
                      <div className={css.canvasPane}>
                        <div className={css.toolbar}>
                          <button
                            disabled={data.presets.length === 0}
                            onClick={() => {
                              addNode('agent')
                            }}
                          >
                            <span aria-hidden="true"><IconPlusOutline16 /></span>{t('wb.addAgent')}
                          </button>
                          <button
                            onClick={() => {
                              addNode('approval')
                            }}
                          >
                            <span aria-hidden="true"><IconPlusOutline16 /></span>{t('wb.addApproval')}
                          </button>
                        </div>
                        {definition !== undefined ? (
                          <WorkflowGraph
                            definition={definition}
                            statuses={statuses}
                            selectedId={node?.id ?? ''}
                            onSelect={actions.node}
                            t={t}
                            editable={!busy && !selected.archived}
                            onMove={(id, position) => {
                              changeDefinition({ ...definition, positions: { ...definition.positions, [id]: position } })
                            }}
                            onLayout={() => { changeDefinition({ ...draft.definition, positions: {} }) }}
                          />
                        ) : null}
                        <p className={css.dataFlow}>
                          {definition?.requirement.inputs.map(item => item.name).join(', ')} →{' '}
                          {definition?.requirement.outputs.map(item => item.name).join(', ')}
                        </p>
                      </div>
                      {node !== undefined ? (
                        <div className={css.inspector} role="region" aria-label={t('wb.node')} key={`${selected.id}:${node.id}`}>
                          <div className={css.inspectorHeading}><span className={css.eyebrow}>{t('wb.node')}</span><h3>{node.title}</h3></div>
                          <details className={css.nodeIdentity}><summary>{t('wb.nodeId')}</summary><code>{node.id}</code></details>
                          <label>
                            {t('wb.nodeName')}
                            <input
                              value={node.title}
                              onChange={(event) => {
                                editNode({ title: event.target.value })
                              }}
                            />
                          </label>
                          <label>
                            {t('wb.kind')}
                            <select
                              value={node.kind}
                              onChange={(event) => {
                                editNode({ kind: event.target.value as WorkflowNode['kind'] })
                              }}
                            >
                              <option value="agent">Agent</option>
                              <option value="approval">{t('wb.addApproval')}</option>
                            </select>
                          </label>
                          <label>
                            {t('wb.instruction')}
                            <textarea
                              rows={5}
                              value={node.instruction}
                              onChange={(event) => {
                                editNode({ instruction: event.target.value })
                              }}
                            />
                          </label>
                          {node.kind === 'agent' ? <label>
                            {t('wb.preset')}
                            <select
                              value={node.preset}
                              onChange={(event) => {
                                editNode({ preset: event.target.value })
                              }}
                            >
                              {data.presets.map(preset => (
                                <option key={preset}>{preset}</option>
                              ))}
                            </select>
                          </label> : <p className={css.hint}>{t('wb.approvalHint')}</p>}
                          <fieldset>
                            <legend>{t('wb.dependencies')}</legend>
                            {definition?.nodes
                              .filter(item => item.id !== node.id)
                              .map(item => (
                                <label key={item.id} className={css.check}>
                                  <input
                                    type="checkbox"
                                    checked={node.dependsOn.includes(item.id)}
                                    onChange={(event) => {
                                      editNode({
                                        dependsOn: event.target.checked
                                          ? [...node.dependsOn, item.id]
                                          : node.dependsOn.filter(id => id !== item.id),
                                      })
                                    }}
                                  />
                                  {item.title}
                                </label>
                              ))}
                          </fieldset>
                          <NodeFields definition={draft.definition} node={node} onChange={changeDefinition} t={t} />
                          <details><summary>{t('wb.advanced')}</summary>
                            <JsonField
                              label={t('wb.inputs')}
                              value={node.inputs}
                              parse={value => definitionSchema.shape.nodes.element.shape.inputs.parse(value)}
                              onValidity={validity}
                              onChange={(value) => {
                                editNode({ inputs: value })
                              }}
                            />
                            <JsonField
                              label={t('wb.objectives')}
                              value={node.objectives}
                              parse={value => definitionSchema.shape.nodes.element.shape.objectives.parse(value)}
                              onValidity={validity}
                              onChange={(value) => {
                                editNode({ objectives: value })
                              }}
                            />
                          </details>
                          <details className={css.nodePosition}><summary>{t('wb.position')}</summary>
                            <div className={css.toolbar}>
                              {(
                                [
                                  ['wb.moveLeft', -24, 0],
                                  ['wb.moveRight', 24, 0],
                                  ['wb.moveUp', 0, -24],
                                  ['wb.moveDown', 0, 24],
                                ] as const
                              ).map(([key, x, y]) => (
                                <button
                                  key={key}
                                  onClick={() => {
                                    const pos =
                                      definition?.positions[node.id] ??
                                  layoutBoard(definition?.nodes ?? [], WORKBENCH_NODE_SIZE).nodes.find(item => item.id === node.id)
                                    if (definition !== undefined && pos !== undefined)
                                      changeDefinition({
                                        ...definition,
                                        positions: {
                                          ...definition.positions,
                                          [node.id]: { x: Math.max(0, pos.x + x), y: Math.max(0, pos.y + y) },
                                        },
                                      })
                                  }}
                                >
                                  {t(key)}
                                </button>
                              ))}
                            </div>
                          </details>
                          <button
                            className={css.destructive}
                            onClick={() => {
                              changeDefinition({
                                ...draft.definition,
                                nodes: draft.definition.nodes.filter(item => item.id !== node.id),
                                positions: Object.fromEntries(
                                  Object.entries(draft.definition.positions).filter(([id]) => id !== node.id),
                                ),
                              })
                              actions.node('')
                            }}
                          >
                            {t('wb.delete')}
                          </button>
                          <small>{t('wb.deleteHint')}</small>
                          <ul aria-label={t('wb.affected')}>
                            {draft.definition.nodes.filter(item => item.dependsOn.includes(node.id)).map(item => (
                              <li key={item.id}>{item.title}: {item.inputs.filter(input => input.source.kind === 'step' && input.source.step === node.id).map(input => input.name).join(', ')}</li>
                            ))}
                            {draft.definition.finalOutputs.filter(binding => binding.source.kind === 'step' && binding.source.step === node.id).map(binding => (
                              <li key={binding.name}>{t('wb.output')}: {binding.name}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </fieldset>
                    <details open={data.operations.some(item => item.status === 'running')}>
                      <summary>{t('wb.generation')}</summary>
                      {data.operations.map(operation => (
                        <div key={operation.id} className={css.operation}>
                          <strong>{t(statusKey(operation.status))}</strong>
                          <span>
                            {t('wb.candidateRevision')}: r{operation.revision}
                          </span>
                          {operation.error ? <pre>{operation.error}</pre> : null}
                          {operation.candidate ? (
                            <>
                              <p>{operation.candidate.requirement.summary}</p>
                              <ol>{operation.candidate.nodes.map(item => <li key={item.id}>{item.title}: {item.instruction}</li>)}</ol>
                              <button
                                disabled={busy || selected.archived}
                                onClick={() => {
                                  if (operation.candidate !== undefined)
                                    edit({ ...draft, definition: operation.candidate })
                                }}
                              >
                                {t('wb.candidate')}
                              </button>
                              <p>{t('wb.candidateHint')}</p>
                            </>
                          ) : null}
                        </div>
                      ))}
                    </details>
                  </>
                ) : (
                  <>
                    <div className={css.runWorkspace}><aside className={css.runHistory}><h3>{t(view.tab === 'verification' ? 'wb.verification' : 'wb.runs')} <span className={css.count}>{visibleRuns.length}</span></h3><ul className={css.runList}>
                      {visibleRuns.map(run => (
                        <li key={run.id}>
                          <button
                            className={css.record}
                            aria-pressed={selectedRun?.id === run.id}
                            onClick={() => {
                              actions.run(run.id)
                              actions.node('')
                            }}
                          >
                            <strong>
                              {`v${run.version.number} · ${t(statusKey(run.status))}`}
                              {run.caseName ? ` · ${run.caseName}` : ''}
                            </strong>
                            <span>
                              <time dateTime={new Date(run.createdAt).toISOString()}>{new Date(run.createdAt).toLocaleString()}</time>
                            </span>
                            <span>{t('wb.duration', { seconds: Math.max(0, (run.updatedAt - run.createdAt) / 1000).toFixed(1) })}</span>
                            {run.assertion ? <span>{t(run.assertion.passed ? 'wb.pass' : 'wb.fail')}</span> : null}
                          </button>
                        </li>
                      ))}
                    </ul>
                    {visibleRuns.length === 0 ? <p className={css.hint}>{t('wb.noRuns')}</p> : null}</aside><div className={css.runDetail}>
                      {selectedRun === undefined && visibleRuns.length > 0 ? <div className={css.emptyDetail}><h3>{t('wb.selectRun')}</h3><p>{t('wb.selectRunHint')}</p></div> : null}
                      {selectedRun && definition ? (
                        <>
                          <div className={css.toolbar}>
                            <strong className={css.status} data-status={selectedRun.status}>{t(statusKey(selectedRun.status))}</strong>
                            <span>
                              {`v${selectedRun.version.number} · ${new Date(selectedRun.createdAt).toLocaleString()}`}
                            </span>
                            {!finished(selectedRun) ? (
                              <button
                                disabled={busy || selectedRun.status === 'stopping'}
                                onClick={() => {
                                  void perform(async () => {
                                    await command({ kind: 'cancel', runId: selectedRun.id })
                                  })
                                }}
                              >
                                {t('wb.stop')}
                              </button>
                            ) : (
                              <button
                                disabled={busy || selected.archived}
                                onClick={() => {
                                  void perform(async () => {
                                    const receipt = await command({
                                      kind: 'start',
                                      id: selected.id,
                                      versionId: selectedRun.version.id,
                                      inputs: selectedRun.inputs,
                                      rerunOf: selectedRun.id,
                                    })
                                    actions.tab('runs')
                                    actions.run(startedRun(receipt))
                                  })
                                }}
                              >
                                {t('wb.rerun')}
                              </button>
                            )}
                          </div>
                          <small>{t('wb.rerunHint')}</small>
                          <WorkflowGraph
                            definition={definition}
                            statuses={statuses}
                            selectedId={node?.id ?? ''}
                            onSelect={actions.node}
                            run={selectedRun}
                            t={t}
                          />
                          {attempt ? (
                            <section data-business-workflow-step-detail className={css.execution}>
                              <h3>
                                {node?.title} · {t(statusKey(attempt.status))}
                              </h3>
                              <p>{node?.instruction}</p>
                              <h4>{t('wb.context')}</h4>
                              <dl>
                                <dt>{t('wb.workspace')}</dt>
                                <dd>{attempt.cwd}</dd>
                                <dt>{t('wb.preset')}</dt>
                                <dd>{attempt.preset}</dd>
                                <dt>Provider / Model</dt>
                                <dd>
                                  {attempt.provider ?? '—'} / {attempt.model ?? '—'}
                                </dd>
                                <dt>{t('wb.tools')}</dt>
                                <dd>{attempt.tools?.join(', ') ?? '—'}</dd>
                                <dt>{t('wb.time')}</dt>
                                <dd>
                                  {attempt.startedAt === undefined ? '—' : new Date(attempt.startedAt).toLocaleString()} /{' '}
                                  {attempt.endedAt === undefined ? '—' : new Date(attempt.endedAt).toLocaleString()}
                                </dd>
                              </dl>
                              {attempt.childSessionId && attempt.parentSessionId ? (
                                <button
                                  onClick={() => {
                                    if (attempt.parentSessionId !== undefined && attempt.childSessionId !== undefined)
                                      openExecution(attempt.parentSessionId, attempt.childSessionId)
                                  }}
                                >
                                  {t('wb.source')}
                                </button>
                              ) : null}
                              <h4>{t('wb.actualInput')}</h4>
                              <pre>{JSON.stringify(attempt.inputs, null, 2)}</pre>
                              <h4>{t('wb.inputs')}</h4>
                              <pre>{JSON.stringify(attempt.sources, null, 2)}</pre>
                              {attempt.prompt ? (
                                <details>
                                  <summary>{t('wb.instruction')}</summary>
                                  <pre>{attempt.prompt}</pre>
                                </details>
                              ) : null}
                              {attempt.output !== undefined ? (
                                <>
                                  <h4>{t('wb.output')}</h4>
                                  <pre>{attempt.output}</pre>
                                </>
                              ) : null}
                              {attempt.error ? <p role="alert">{attempt.error}</p> : null}
                              {attempt.status === 'waiting' ? (
                                <div className={css.toolbar}>
                                  {[true, false].map(approve => (
                                    <button
                                      key={String(approve)}
                                      className={approve ? css.primary : css.destructive}
                                      disabled={busy}
                                      onClick={() => {
                                        void perform(async () => {
                                          await command({
                                            kind: 'decide',
                                            runId: selectedRun.id,
                                            attemptId: attempt.id,
                                            approve,
                                          })
                                        })
                                      }}
                                    >
                                      {t(approve ? 'wb.approve' : 'wb.reject')}
                                    </button>
                                  ))}
                                </div>
                              ) : null}
                            </section>
                          ) : null}
                          {selectedRun.error ? <pre role="alert">{selectedRun.error}</pre> : null}
                          {selectedRun.assertion?.detail ? <pre>{selectedRun.assertion.detail}</pre> : null}
                          <h3>{t('wb.output')}</h3>
                          <pre>{JSON.stringify(selectedRun.outputs, null, 2)}</pre>
                        </>
                      ) : null}
                    </div></div>
                  </>
                )}
                <section className={css.start}>
                  <div className={css.sectionHeading}><div><span className={css.eyebrow}>{t('wb.execute')}</span><h3>{t('wb.run')}</h3></div><span className={css.hint}>{version === undefined ? t('wb.publishFirst') : `v${version.number}`}</span></div>
                  <label>
                    {t('wb.version')}
                    <select
                      value={version?.id ?? ''}
                      onChange={(event) => {
                        setVersionId(event.target.value)
                      }}
                    >
                      {selected.versions.length === 0 ? (
                        <option>{t('wb.unpublished')}</option>
                      ) : (
                        selected.versions.map(item => (
                          <option key={item.id} value={item.id}>
                            {`v${item.number}`}
                          </option>
                        ))
                      )}
                    </select>
                  </label>
                  <JsonField
                    key={`${selected.id}:${version?.id ?? ''}`}
                    label={t('wb.input')}
                    value={inputs}
                    onValidity={validity}
                    onChange={(value) => { if (version !== undefined) setInputDrafts(current => ({ ...current, [version.id]: value })) }}
                  />
                  <p>{t('wb.executeHint')}</p>
                  <div className={css.toolbar}>
                    <button
                      className={css.primary}
                      disabled={busy || hasInvalid || version === undefined || selected.archived}
                      onClick={() => {
                        if (version)
                          void perform(async () => {
                            const receipt = await command({
                              kind: 'start',
                              id: selected.id,
                              versionId: version.id,
                              inputs,
                            })
                            actions.tab('runs')
                            actions.run(startedRun(receipt))
                          })
                      }}
                    >
                      <span aria-hidden="true"><IconPlayOutline16 /></span>{t('wb.run')}
                    </button>
                    <button
                      disabled={busy || version === undefined || selected.archived}
                      onClick={() => {
                        if (version)
                          void perform(async () => {
                            const receipt = await command({ kind: 'verify', id: selected.id, versionId: version.id })
                            actions.tab('verification')
                            actions.run(startedRun(receipt))
                          })
                      }}
                    >
                      {t('wb.verify')}
                    </button>
                  </div>
                </section>
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  )
}
