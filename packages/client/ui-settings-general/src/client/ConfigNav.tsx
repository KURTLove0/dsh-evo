/**
 * The configuration module nav in the sidebar: one "配置" title over three
 * module rows — Runtimes, Statistics, Settings — placed between the browsing
 * region and the sidebar foot. A row exists only while its section is on the
 * settings ledger, and each click asks the settings panel to open on that
 * section; the panel (the `sidebar.settings` occupant) owns the modal, this
 * nav never renders it.
 */

import type { ReactNode } from 'react'
import clsx from 'clsx'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import {
  IconRuntimeOutline16, IconSettingsOutline16, IconStatsOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { HostObservable, InjectFace, PropsRuntime, SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import type { SettingsSectionRow } from './shell-contract.ts'
import type { en } from './locales.ts'
import css from './ConfigNav.module.css'

/** The observable the section ledger projects into ordered nav rows. */
export type SectionsObservable = HostObservable<readonly SettingsSectionRow[]>

/** Injected dependencies of {@link ConfigNav} (slot `inject`). */
export interface ConfigNavInjected {
  hooks: {
    /** The settings-section ledger projected into ordered nav rows. */
    sections: SectionsObservable
  }
  /** Ask the settings panel to open on one section. */
  request: (section: string) => void
  /** Nav copy. */
  t: (key: keyof typeof en) => string
}

/**
 * Props delivered by the slot outlet: the sidebar column state plus the
 * inject face spread flat.
 */
export type ConfigNavProps = PropsRuntime<'sidebar.config'> & Partial<InjectFace<ConfigNavInjected>>

/**
 * Render the configuration module nav.
 * @param props - sidebar column state and slot-delivered dependencies.
 * @returns the nav, or null while the shell has not injected yet.
 */
export function ConfigNav(props: ConfigNavProps): ReactNode {
  const { wide, useSections, request, t } = props
  if (useSections === undefined || request === undefined || t === undefined) return null
  return <Loaded wide={wide} useSections={useSections} request={request} t={t} />
}

function Loaded({ wide, useSections, request, t }: {
  wide: boolean
  useSections: SnapshotSelectorHook<readonly SettingsSectionRow[]>
  request: (section: string) => void
  t: (key: keyof typeof en) => string
}): ReactNode {
  const rows = useSections(s => s)
  // Module rows exist only while their sections are on the ledger; the
  // Settings row stands in for the first section the shell does not claim.
  const runtimes = rows.find(row => row.id === 'runtimes')
  const stats = rows.find(row => row.id === 'stats')
  const settingsFirst = rows.find(row => row.id !== 'runtimes' && row.id !== 'stats')
  if (runtimes === undefined && stats === undefined && settingsFirst === undefined) return null

  return (
    <nav className={css.config} aria-label={t('sidebar.group')}>
      {wide ? <h2 className={css.configTitle}>{t('sidebar.group')}</h2> : null}
      <div className={wide ? css.configItems : `${css.configItems} ${css.rail}`}>
        {runtimes !== undefined ? (
          <ConfigRow
            wide={wide}
            label={runtimes.label}
            icon={<IconRuntimeOutline16 size={wide ? 16 : 18} />}
            onClick={() => { request('runtimes') }}
          />
        ) : null}
        {stats !== undefined ? (
          <ConfigRow
            wide={wide}
            label={stats.label}
            icon={<IconStatsOutline16 size={wide ? 16 : 18} />}
            onClick={() => { request('stats') }}
          />
        ) : null}
        {settingsFirst !== undefined ? (
          <ConfigRow
            wide={wide}
            label={t('sidebar.settings')}
            icon={<IconSettingsOutline16 size={wide ? 16 : 18} />}
            onClick={() => { request(settingsFirst.id) }}
          />
        ) : null}
      </div>
    </nav>
  )
}

/** One module row: the glyph, the label (wide only), and the open request. */
function ConfigRow({ wide, label, icon, onClick }: {
  wide: boolean
  label: string
  icon: ReactNode
  onClick: () => void
}): ReactNode {
  const button = (
    <button type="button" className={clsx(css.configRow, !wide && css.rowRail)} onClick={onClick}>
      {icon}
      {wide ? <span className={css.configRowLabel}>{label}</span> : null}
    </button>
  )
  return wide ? button : <Tooltip label={label} delayMs={500}>{button}</Tooltip>
}
