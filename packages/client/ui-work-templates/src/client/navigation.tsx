/** Private template library navigation. */
import { IconAgentPresetOutline16, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import css from './TemplateView.module.css'
type Props = PropsRuntime<'sidebar.session.action'> & PropsLocale<'workTemplates'> & { open: () => void }
/**
 * Render template navigation at either sidebar width.
 * @param props - framework sidebar width, locale, and navigation callback.
 * @returns a labeled navigation control.
 */
export function TemplateNavigation({ wide, t, open }: Props) {
  const button = <button type="button" className={css.nav} aria-label={t('title')} onClick={open}><IconAgentPresetOutline16 /><span hidden={!wide}>{t('title')}</span></button>
  return wide ? button : <Tooltip label={t('title')}>{button}</Tooltip>
}
