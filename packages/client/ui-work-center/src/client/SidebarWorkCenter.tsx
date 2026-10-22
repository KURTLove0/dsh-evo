/** Sidebar navigation to the unified work directory. */
import { IconAgentPresetOutline16, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import css from './WorkCenterPage.module.css'

type Props = PropsRuntime<'sidebar.session.action'> & PropsLocale<'workCenter'> & { openWorkCenter: () => void }
/**
 * Render the work-center entry at either sidebar width.
 * @param props - sidebar layout, localized copy, and navigation.
 * @returns the navigation button.
 */
export function SidebarWorkCenter({ wide, t, openWorkCenter }: Props) {
  const button = <button type="button" className={css.nav} aria-label={t('title')} onClick={openWorkCenter}>
    <IconAgentPresetOutline16 /><span hidden={!wide}>{t('title')}</span>
  </button>
  return wide ? button : <Tooltip label={t('title')}>{button}</Tooltip>
}
