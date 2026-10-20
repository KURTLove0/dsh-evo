/** Shared preset copy, composition-viewer, and delete-confirmation dialogs. */
import type { ReactNode } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { draftBlocker, type AgentPresetSectionState } from './section-store.ts'
import type { AgentPresetSectionInjected } from './AgentPresetSection.tsx'
import { presetDisplayText, type AgentPresetSettingsKey } from './locales.ts'
import css from './AgentPresetSection.module.css'

/** Copy-dialog sub-view props: the draft plus the actions that mutate it. */
interface CopyDialogProps {
  state: AgentPresetSectionState
  t: (key: AgentPresetSettingsKey) => string
  actions: Pick<AgentPresetSectionInjected,
    'cancelCopy' | 'confirmCopy' | 'setCopyId' | 'setCopyName'>
}

function CopyDialog({ state, t, actions }: CopyDialogProps): ReactNode {
  const draft = state.copy
  const blocker = draft === null ? undefined : draftBlocker(draft, state.rows)
  const message = draft === null ? null : draft.error ?? (blocker === undefined ? null : t(blocker))
  const source = draft === null ? undefined : state.rows.find(row => row.id === draft.from)
  const sourceTitle = source === undefined ? draft?.fromTitle : presetDisplayText(source, t).name
  return (
    <Modal
      open={draft !== null}
      onClose={() => { actions.cancelCopy() }}
      title={draft === null ? t('copyTitle') : `${t('copyTitle')} · ${t('copyOf')} ${sourceTitle}`}
      closeLabel={t('close')}
      description={t('copyIntro')}
      className={css.dialog as string}
      footer={(
        <>
          <Button
            variant="outline"
            disabled={draft?.saving === true}
            onClick={() => { actions.cancelCopy() }}
          >
            {t('cancel')}
          </Button>
          <Button
            disabled={draft === null || draft.saving || blocker !== undefined}
            onClick={() => { void actions.confirmCopy() }}
          >
            {draft?.saving === true ? t('creating') : t('create')}
          </Button>
        </>
      )}
    >
      {draft === null
        ? null
        : (
          <div className={css.dialogFields}>
            <label className={css.field}>
              <span className={css.fieldLabel}>{t('presetId')}</span>
              <input
                className={css.input}
                value={draft.id}
                autoFocus
                spellCheck={false}
                placeholder={t('presetIdPlaceholder')}
                onChange={(event) => { actions.setCopyId(event.target.value) }}
              />
            </label>
            <label className={css.field}>
              <span className={css.fieldLabel}>{t('displayName')}</span>
              <input
                className={css.input}
                value={draft.name}
                spellCheck={false}
                placeholder={t('displayNamePlaceholder')}
                onChange={(event) => { actions.setCopyName(event.target.value) }}
              />
            </label>
            {message === null ? null : <p className={css.error} role="alert">{message}</p>}
          </div>
        )}
    </Modal>
  )
}

interface DialogProps {
  state: AgentPresetSectionState
  t: (key: AgentPresetSettingsKey) => string
  actions: Omit<AgentPresetSectionInjected, 'hooks'>
}

/**
 * Render the dialogs shared by both management entries.
 * @param props - current host-backed state, copy, and mutation callbacks.
 * @returns copy, viewer, and delete dialogs.
 */
export function AgentPresetDialogs({ state, t, actions }: DialogProps): ReactNode {
  const viewedId = state.view?.id
  const viewedRow = viewedId === undefined ? undefined : state.rows.find(row => row.id === viewedId)
  const viewedTitle = state.view === null
    ? ''
    : viewedRow === undefined ? state.view.title : presetDisplayText(viewedRow, t).name
  return <>
    <CopyDialog state={state} t={t} actions={actions} />
    <Modal
      open={state.view !== null}
      onClose={() => { actions.closeView() }}
      title={state.view === null ? '' : `${t('view')} · ${viewedTitle}`}
      closeLabel={t('close')}
      description={t('composition')}
      className={css.dialog as string}
      footer={(
        <Button variant="outline" autoFocus onClick={() => { actions.closeView() }}>
          {t('close')}
        </Button>
      )}
    >
      {state.view === null
        ? null
        : <pre className={css.viewerCode}>{state.view.content}</pre>}
    </Modal>
    <Modal
      open={state.pendingDelete !== null}
      onClose={() => { actions.confirmDelete(null) }}
      title={t('deleteTitle')}
      closeLabel={t('close')}
      description={t('deleteDescription')}
      className={css.deleteDialog as string}
      footer={(
        <>
          <Button
            variant="outline"
            autoFocus
            disabled={state.deleting}
            onClick={() => { actions.confirmDelete(null) }}
          >
            {t('cancel')}
          </Button>
          <Button
            variant="outline"
            className={css.deleteConfirm}
            disabled={state.deleting}
            onClick={() => { void actions.remove() }}
          >
            {state.deleting ? t('deleting') : t('deleteConfirm')}
          </Button>
        </>
      )}
    />
  </>
}
