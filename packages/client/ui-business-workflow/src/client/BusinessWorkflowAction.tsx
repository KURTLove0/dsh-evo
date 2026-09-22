/**
 * Session-header business-workflow entry: the always-visible module seat. The
 * popover starts a workflow from a requirement sentence and lists this
 * session's records with their next click step; every click sends one guided
 * prompt into the session, so the model keeps driving the tools and the
 * durable card keeps projecting the outcome.
 */
import { useState, useRef, type KeyboardEvent } from 'react'
import type { ConversationSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import type { ChatConversationViewNode } from '@deepseek-ai/dsh-client-runtime/client'
import { IconChevronDownOutline14, StateDot, useDismissOnOutsidePointer, type StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { BusinessWorkflowStage } from '@deepseek-ai/dsh-business-workflow/types'
import { NS, type BusinessWorkflowKey } from './locales.ts'
import type { BusinessWorkflowChatData } from './workflow-definition.ts'
import type { PromptSender } from './prompt-sender.ts'
import css from './BusinessWorkflowAction.module.css'

/** Actions the plugin injects into the header entry. */
export interface BusinessWorkflowActionInjected {
  /** Send one guided prompt; resolves to host acceptance. */
  readonly sendPrompt: PromptSender
}

/** Full props for the session-header business-workflow entry. */
export type BusinessWorkflowActionProps =
  PropsRuntime<'conversation.session.header.actions'>
  & PropsLocale<typeof NS>
  & BusinessWorkflowActionInjected

/** Closed-union exhaustiveness fence for the record stage. */
/* v8 ignore next 3 -- closed-union backstop; only reached if a stage is forged */
function assertNever(value: never): never {
  throw new Error(`unhandled workflow stage: ${JSON.stringify(value)}`)
}

/**
 * Project the Chat node membership into this session's workflow rows.
 * @param nodes - every materialized Chat node.
 * @returns the durable business-workflow card data, in node order.
 */
export function workflowRows(nodes: readonly ChatConversationViewNode[]): BusinessWorkflowChatData[] {
  const rows: BusinessWorkflowChatData[] = []
  for (const node of nodes) {
    if (node.kind === 'business-workflow') rows.push(node.data as BusinessWorkflowChatData)
  }
  return rows
}

/** One row's rendered identity: every field the panel reads, compared by reference/value. */
function sameRow(a: BusinessWorkflowChatData, b: BusinessWorkflowChatData): boolean {
  return a.workflowId === b.workflowId
    && a.stage === b.stage
    && a.status === b.status
    && a.revision === b.revision
    && a.stepCount === b.stepCount
    && a.gaps === b.gaps
    && a.issues === b.issues
    && a.verification === b.verification
}

/**
 * Selector equality over the row projection: re-render only when a workflow
 * row actually moves, not on every unrelated conversation event.
 */
export function sameWorkflowRows(a: readonly BusinessWorkflowChatData[], b: readonly BusinessWorkflowChatData[]): boolean {
  if (a.length !== b.length) return false
  for (const [index, rowA] of a.entries()) {
    const rowB = b[index]
    // The length fence above keeps this defined; the guard satisfies indexed access.
    if (rowB === undefined || !sameRow(rowA, rowB)) return false
  }
  return true
}

/** The click step a stage offers next, with the guided prompt that drives it. */
export function nextAction(stage: BusinessWorkflowStage): {
  readonly labelKey: BusinessWorkflowKey
  readonly promptKey: 'prompt.continue' | 'prompt.compose' | 'prompt.verify'
} {
  switch (stage) {
    case 'clarifying': return { labelKey: 'action.continue', promptKey: 'prompt.continue' }
    case 'ready': return { labelKey: 'action.compose', promptKey: 'prompt.compose' }
    case 'composed': return { labelKey: 'action.verify', promptKey: 'prompt.verify' }
    case 'verified': return { labelKey: 'action.reverify', promptKey: 'prompt.verify' }
    /* v8 ignore next -- closed stage union */
    default: return assertNever(stage)
  }
}

/** Row status copy per exact stage (`ready` is its own word here, unlike the card). */
const STAGE_STATUS_KEYS = {
  clarifying: 'status.clarifying',
  ready: 'status.ready',
  composed: 'status.composed',
  verified: 'status.verified',
} as const satisfies Record<BusinessWorkflowStage, BusinessWorkflowKey>

/** Row status marker semantics: open work ongoing, awaiting a click warning, settled done. */
function stageDotState(stage: BusinessWorkflowStage): StateDotState {
  switch (stage) {
    case 'clarifying': return 'ongoing'
    case 'ready': return 'warning'
    case 'composed': return 'warning'
    case 'verified': return 'done'
    /* v8 ignore next -- closed stage union */
    default: return assertNever(stage)
  }
}

/** Stable module-level selector so the hook never re-subscribes. */
const selectWorkflowRows = (state: ConversationSnapshot): BusinessWorkflowChatData[] =>
  workflowRows(state.chat.nodes.values())

/**
 * The header trigger and its popover. The seat is always rendered — the module
 * is a general capability, not a badge that appears with use.
 * @param props - runtime slot currency, the namespace translator, and the injected sender.
 * @returns the trigger and popover.
 */
export function BusinessWorkflowAction({ sessionId, useSession, sendPrompt, t }: BusinessWorkflowActionProps) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  const rows = useSession(selectWorkflowRows, sameWorkflowRows)

  useDismissOnOutsidePointer(rootRef, open, setOpen)

  const run = (text: string, after?: () => void): void => {
    setSending(true)
    void sendPrompt(sessionId, text).then(
      (ok) => {
        setSending(false)
        setError(ok ? null : t('send.failed'))
        if (ok) after?.()
      },
      () => {
        setSending(false)
        setError(t('send.failed'))
      },
    )
  }

  const onStart = (): void => {
    const requirement = draft.trim()
    if (requirement === '' || sending) return
    run(t('prompt.start', { requirement }), () => { setDraft('') })
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Escape' || !open) return
    event.preventDefault()
    setOpen(false)
    triggerRef.current?.focus()
  }

  return (
    <div ref={rootRef} className={css.root} onKeyDown={onKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        className={css.trigger}
        aria-expanded={open}
        aria-label={t('action.entry')}
        onClick={() => { setOpen(current => !current) }}
      >
        <span className={css.entry}>{t('action.entry')}</span>
        <IconChevronDownOutline14 className={open ? css.triggerOpen : undefined} />
      </button>
      {open
        ? (
          <div className={css.menu} role="dialog" aria-label={t('action.entry')}>
            <section className={css.form}>
              <span className={css.formLabel}>{t('action.new')}</span>
              <textarea
                className={css.textarea}
                rows={3}
                value={draft}
                placeholder={t('action.placeholder')}
                onChange={(event) => { setDraft(event.target.value) }}
              />
              <button
                type="button"
                className={css.primary}
                disabled={sending || draft.trim() === ''}
                onClick={onStart}
              >
                {t('action.start')}
              </button>
            </section>
            <section className={css.listSection}>
              <span className={css.listLabel}>{t('action.list')}</span>
              {rows.length === 0
                ? <span className={css.empty}>{t('action.empty')}</span>
                : (
                  <ul className={css.list}>
                    {rows.map((workflow) => {
                      const action = nextAction(workflow.stage)
                      return (
                        <li key={workflow.workflowId} className={css.row}>
                          <StateDot state={stageDotState(workflow.stage)} className={css.rowDot} />
                          <span className={css.rowSummary} title={workflow.summary}>{workflow.summary}</span>
                          <span className={css.rowStatus}>{t(STAGE_STATUS_KEYS[workflow.stage])}</span>
                          <button
                            type="button"
                            className={css.rowAction}
                            disabled={sending}
                            onClick={() => { run(t(action.promptKey, { id: workflow.workflowId })) }}
                          >
                            {t(action.labelKey)}
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                )}
            </section>
            {error !== null ? <span className={css.error} role="alert">{error}</span> : null}
          </div>
        )
        : null}
    </div>
  )
}
