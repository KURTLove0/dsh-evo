/** Workbench navigation to the agent roster at either sidebar width. */
import { IconAgentPresetOutline16, IconChevronRightOutline14, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import css from './AgentPage.module.css'

/** Navigation supplied by the layout owner. */
export interface SidebarAgentsInjected {
  /** Open the agent roster in the main column. */
  openAgents: () => void
}

type SidebarAgentsProps = PropsRuntime<'sidebar.session.action'> & PropsLocale<'workbenchAgent'> & SidebarAgentsInjected

/**
 * Render the Agents workbench entry.
 * @param props - sidebar width, navigation, and locale.
 * @returns the sidebar button or its compact tooltip.
 */
export function SidebarAgentsAction({ wide, openAgents, t }: SidebarAgentsProps) {
  const button = <button type="button" className={wide ? css.nav : css.navRail} aria-label={t('agents')} onClick={openAgents}>
    <IconAgentPresetOutline16 size={wide ? 16 : 18} />
    {wide ? <><span>{t('agents')}</span><IconChevronRightOutline14 /></> : null}
  </button>
  return wide ? button : <Tooltip label={t('agents')}>{button}</Tooltip>
}
