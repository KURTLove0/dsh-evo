/** First-level navigation to the standalone workflow page. */
import { IconBranchOutline16, IconChevronRightOutline14, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { NS } from './locales.ts'
import css from './SidebarWorkflowAction.module.css'

/** Navigation callback supplied by the plugin. */
export interface SidebarWorkflowActionInjected {
  /** Open the workflow page in the main column. */
  readonly openWorkflows: () => void
}

/** Full sidebar entry props. */
export type SidebarWorkflowActionProps = PropsRuntime<'sidebar.session.action'> & PropsLocale<typeof NS> & SidebarWorkflowActionInjected

/**
 * Render a page navigation button at either sidebar width.
 * @param props - slot parameters, navigation callback, and translator.
 * @returns sidebar navigation button.
 */
export function SidebarWorkflowAction({ wide, openWorkflows, t }: SidebarWorkflowActionProps) {
  const trigger = (
    <button type="button" className={css.trigger} aria-label={t('action.entry')} onClick={openWorkflows}>
      <IconBranchOutline16 size={wide ? 14 : 18} />
      {wide ? <span className={css.triggerLabel}>{t('action.entry')}</span> : null}
      {wide ? <IconChevronRightOutline14 className={css.chevron} size={14} /> : null}
    </button>
  )
  return <div className={wide ? css.root : `${css.root} ${css.rail}`}>
    {wide ? trigger : <Tooltip label={t('action.entry')} delayMs={500}>{trigger}</Tooltip>}
  </div>
}
