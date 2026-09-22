/**
 * Sidebar first-level business-workflow entry: the module seat beside New
 * Session. The trigger mirrors the New Session button's geometry (full row
 * when wide, one rail icon when collapsed); its right-flying panel starts a
 * workflow from one requirement sentence — staged across a New Session start
 * when none is open — and lists the current session's records with their next
 * click step. Every click sends one guided prompt through the starter.
 */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import type { ConversationSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import { IconBranchOutline16, StateDot, Tooltip, type StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import type { HostObservable, PropsLocale, PropsRuntime, SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import type { BusinessWorkflowStage } from '@deepseek-ai/dsh-business-workflow/types'
// Type-only: pulls ui-sidebar's SlotMap merge ('sidebar.session.action') in.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { NS, type BusinessWorkflowKey } from './locales.ts'
import { nextAction, sameWorkflowRows, workflowRows } from './BusinessWorkflowAction.tsx'
import type { BusinessWorkflowChatData } from './workflow-definition.ts'
import css from './SidebarWorkflowAction.module.css'

/** Actions and feeds the plugin injects into the sidebar entry. */
export interface SidebarWorkflowActionInjected {
  /** Deliver one guided prompt now, or stage it across a New Session start. */
  readonly startWorkflow: (text: string) => Promise<boolean>
  readonly hooks: {
    /** Current session's conversation feed (undefined while none is open). */
    readonly conversation: HostObservable<ConversationSnapshot | undefined>
  }
}

/** Full props for the sidebar business-workflow entry. */
export type SidebarWorkflowActionProps =
  PropsRuntime<'sidebar.session.action'>
  & PropsLocale<typeof NS>
  & Omit<SidebarWorkflowActionInjected, 'hooks'>
  & { readonly useConversation: SnapshotSelectorHook<ConversationSnapshot | undefined> }

/** Row status copy per exact stage (shared with the header panel). */
const STAGE_STATUS_KEYS = {
  clarifying: 'status.clarifying',
  ready: 'status.ready',
  composed: 'status.composed',
  verified: 'status.verified',
} as const satisfies Record<BusinessWorkflowStage, BusinessWorkflowKey>

/** Row status marker semantics (mirrors the header panel's). */
function stageDotState(stage: BusinessWorkflowStage): StateDotState {
  switch (stage) {
    case 'clarifying': return 'ongoing'
    case 'ready': return 'warning'
    case 'composed': return 'warning'
    case 'verified': return 'done'
  }
}

/** Stable empty projection for the no-session state (one identity, no churn). */
const NO_ROWS: readonly BusinessWorkflowChatData[] = []

/** Stable module-level selector over the maybe-conversation feed. */
const selectWorkflowRows = (state: ConversationSnapshot | undefined): readonly BusinessWorkflowChatData[] =>
  state === undefined ? NO_ROWS : workflowRows(state.chat.nodes.values())

/**
 * The sidebar trigger and its right-flying panel.
 * @param props - runtime slot currency (wide, useSessions), translator, and the injected starter/feed.
 * @returns the trigger and popover.
 */
export function SidebarWorkflowAction({ wide, useSessions, useConversation, startWorkflow, t }: SidebarWorkflowActionProps) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [position, setPosition] = useState<CSSProperties | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const hasSession = useSessions(state => state.current !== undefined)
  const currentTitle = useSessions(state =>
    state.current === undefined ? undefined : state.byId[state.current]?.displayTitle ?? state.byId[state.current]?.title)
  const rows = useConversation(selectWorkflowRows, sameWorkflowRows)

  // The panel portals to <body>: the sidebar column clips absolute descendants
  // (overflow hidden), so the right-flying panel positions itself from the
  // trigger's viewport rect instead.
  useLayoutEffect(() => {
    if (!open) {
      setPosition(null)
      return
    }
    const place = (): void => {
      const rect = triggerRef.current?.getBoundingClientRect()
      if (rect === undefined) return
      const panel = panelRef.current
      const width = panel?.offsetWidth ?? 0
      const height = panel?.offsetHeight ?? 0
      let left = rect.right + 8
      let top = rect.top
      if (width > 0) left = Math.min(left, window.innerWidth - width - 8)
      if (height > 0) top = Math.min(Math.max(top, 8), window.innerHeight - height - 8)
      setPosition({ left, top })
    }
    place()
    window.addEventListener('resize', place)
    return () => { window.removeEventListener('resize', place) }
  }, [open])

  // Outside-dismiss spans both the inline trigger and the portaled panel.
  useEffect(() => {
    if (!open) return
    const closeOutside = (event: PointerEvent): void => {
      if (!(event.target instanceof Node)) return
      if (rootRef.current?.contains(event.target) === true) return
      if (panelRef.current?.contains(event.target) === true) return
      setOpen(false)
    }
    document.addEventListener('pointerdown', closeOutside)
    return () => { document.removeEventListener('pointerdown', closeOutside) }
  }, [open])

  const run = (text: string, after?: () => void): void => {
    setSending(true)
    void startWorkflow(text).then(
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

  const trigger = (
    <button
      ref={triggerRef}
      type="button"
      className={css.trigger}
      aria-expanded={open}
      aria-label={t('action.entry')}
      onClick={() => { setOpen(current => !current) }}
    >
      <IconBranchOutline16 size={wide ? 14 : 18} />
      {wide ? <span className={css.triggerLabel}>{t('action.entry')}</span> : null}
    </button>
  )

  return (
    <div ref={rootRef} className={css.root} onKeyDown={onKeyDown}>
      {wide ? trigger : <Tooltip label={t('action.entry')} delayMs={500}>{trigger}</Tooltip>}
      {open
        ? createPortal(
          <div
            ref={panelRef}
            className={css.menu}
            role="dialog"
            aria-label={t('action.entry')}
            style={position === null ? { visibility: 'hidden' } : position}
          >
            <section className={css.form}>
              <span className={css.formLabel}>{t('action.new')}</span>
              <textarea
                className={css.textarea}
                rows={3}
                value={draft}
                placeholder={t('action.placeholder')}
                onChange={(event) => { setDraft(event.target.value) }}
              />
              <span className={css.hint}>
                {hasSession && currentTitle !== undefined ? t('sidebar.hint.current', { title: currentTitle }) : t('sidebar.hint.new')}
              </span>
              <button
                type="button"
                className={css.primary}
                disabled={sending || draft.trim() === ''}
                onClick={onStart}
              >
                {t('action.start')}
              </button>
            </section>
            {rows.length > 0
              ? (
                <section className={css.listSection}>
                  <span className={css.listLabel}>{t('action.list')}</span>
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
                </section>
              )
              : null}
            {error !== null ? <span className={css.error} role="alert">{error}</span> : null}
          </div>,
          document.body,
        )
        : null}
    </div>
  )
}
