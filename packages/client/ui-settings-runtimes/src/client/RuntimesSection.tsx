/**
 * Runtimes settings section: the model runtimes this deployment can call,
 * rendered as a read-only table joined from the configurable-provider
 * directory and the host model catalog. A summary strip above the table
 * carries the whole-deployment figures the rows already prove (runtime and
 * online counts, daemon presence); every row is a live runtime showing its
 * loaded models inline — a dormant route is a configuration candidate that
 * belongs to the Models page, and a local CLI the host cannot find is no
 * runtime here. Model selection itself stays with the composer's picker —
 * this page reports and links, it never routes.
 */

import { useState, type ReactNode } from 'react'
import clsx from 'clsx'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { RuntimesSettingsStore, RuntimeRow } from './store.ts'
import type { en } from './locales.ts'
import styles from './RuntimesSection.module.css'

/** The command installing the dsh CLI; an npm literal, never localized. */
export const DAEMON_INSTALL_COMMAND = 'npm install -g @deepseek-ai/dsh'

/** The command the hint asks the user to run; a CLI literal, never localized. */
export const DAEMON_START_COMMAND = 'dsh daemon start'

/** Injected dependencies of {@link RuntimesSection} (slot `inject`). */
export interface RuntimesSectionInjected {
  /** The page store (loaded on mount, refreshed on pushed invalidations). */
  controller: RuntimesSettingsStore
  hooks: {
    /** Page snapshot bound by the UI renderer as useSnapshot. */
    snapshot: RuntimesSettingsStore['store']
  }
  /** Section copy. */
  t: (key: keyof typeof en) => string
}

/**
 * Props delivered by the slot outlet: the inject face spread flat (the
 * renderer erases the share boundary at the render call).
 */
export type RuntimesSectionProps = Partial<InjectFace<RuntimesSectionInjected>>

type RuntimesSectionFace = InjectFace<RuntimesSectionInjected>

/** Replace the one count placeholder in the models-count caption. */
export function modelsCountCopy(template: string, count: number): string {
  return template.replace('{count}', () => String(count))
}

/** Replace the total and online placeholders in the summary caption. */
export function summaryCountsCopy(template: string, total: number, online: number): string {
  return template.replace('{total}', () => String(total)).replace('{online}', () => String(online))
}

/**
 * Render the Runtimes section content column.
 * @param props - slot-delivered injected dependencies.
 * @returns the section, or null while the shell has not injected yet.
 */
export function RuntimesSection(props: RuntimesSectionProps): ReactNode {
  const { controller, useSnapshot, t } = props
  if (controller === undefined || useSnapshot === undefined || t === undefined) return null
  return <Loaded injected={{ controller, useSnapshot, t }} />
}

function Loaded({ injected }: { injected: RuntimesSectionFace }): ReactNode {
  const { controller, t } = injected
  const state = injected.useSnapshot(snapshot => snapshot)

  if (state.status === 'idle') void controller.load()
  if (state.status === 'error') {
    /* v8 ignore next -- an error status always carries text; the fallback satisfies the nullable type */
    const errorText = state.error ?? ''
    return (
      <div className={styles['section']}>
        <h2 className={styles['title']}>{t('title')}</h2>
        <p className={styles['error']}>{`${t('loadFailed')}: ${errorText}`}</p>
        <button type="button" className={styles['secondaryButton']} onClick={() => { void controller.load() }}>
          {t('retry')}
        </button>
      </div>
    )
  }

  return (
    <div className={styles['section']}>
      <h2 className={styles['title']}>{t('title')}</h2>
      <p className={styles['intro']}>{t('intro')}</p>
      {state.status === 'idle' || state.status === 'loading'
        ? <p className={styles['empty']} role="status">{t('loading')}</p>
        : null}
      {state.status === 'ready' && !state.daemonRunning ? <DaemonHint t={t} /> : null}
      {state.status === 'ready' && state.rows.length === 0
        ? <p className={styles['empty']}>{t('empty')}</p>
        : null}
      {state.status === 'ready' && state.rows.length > 0
        ? (
          <>
            <SummaryStrip rows={state.rows} daemonRunning={state.daemonRunning} t={t} />
            <table className={styles['table']}>
              <thead>
                <tr>
                  <th className={styles['colService']} scope="col">{t('colService')}</th>
                  <th className={styles['colHealth']} scope="col">{t('colHealth')}</th>
                  <th className={styles['colModels']} scope="col">{t('colModels')}</th>
                  <th className={styles['colCommand']} scope="col">{t('colCommand')}</th>
                </tr>
              </thead>
              <tbody>
                {state.rows.map(row => <RuntimeRowView key={row.provider} row={row} t={t} />)}
              </tbody>
            </table>
          </>
        )
        : null}
    </div>
  )
}

/** Whole-deployment figures the rows already prove, plus daemon presence. */
function SummaryStrip({ rows, daemonRunning, t }: {
  rows: readonly RuntimeRow[]
  daemonRunning: boolean
  t: (key: keyof typeof en) => string
}): ReactNode {
  // A row carries failure text exactly when its listing failed, so the
  // failure-free rows are the online ones — no second health fact exists.
  const online = rows.filter(row => row.failure === undefined).length
  return (
    <div className={styles['summary']} role="status">
      <span className={styles['summaryCounts']}>{summaryCountsCopy(t('summaryCounts'), rows.length, online)}</span>
      <span
        className={clsx(
          styles['daemonChip'],
          daemonRunning ? styles['daemonChipOn'] : styles['daemonChipOff'],
        )}
      >
        {daemonRunning ? t('daemonChipRunning') : t('daemonChipStopped')}
      </span>
    </div>
  )
}

/** One runtime table row: identity, health, the models it loads, its command. */
function RuntimeRowView({ row, t }: { row: RuntimeRow; t: (key: keyof typeof en) => string }): ReactNode {
  return (
    <tr className={styles['row']}>
      <td className={styles['serviceCell']}>
        <span className={styles['serviceIdentity']}>
          <span className={styles['serviceName']}>{row.displayName}</span>
          <span className={styles['serviceRoute']}>{row.provider}</span>
        </span>
        {row.declared === true ? <span className={styles['tagCustom']}>{t('tagCustom')}</span> : null}
        {row.declared === false ? <span className={styles['tagBuiltin']}>{t('tagBuiltin')}</span> : null}
      </td>
      <td className={styles['healthCell']}>
        {row.failure === undefined
          ? (
            <span className={styles['healthOnline']}>
              <span
                className={clsx(styles['stateDot'], styles['stateDotActive'])}
                role="img"
                aria-label={t('statusActive')}
                title={t('statusActive')}
              />
              {t('statusActive')}
            </span>
          )
          : (
            <span className={styles['healthFailed']} role="alert">
              <span
                className={clsx(styles['stateDot'], styles['stateDotFailed'])}
                role="img"
                aria-label={t('statusFailed')}
                title={t('statusFailed')}
              />
              {t('statusFailed')}
              <span className={styles['healthDetail']}>{row.failure}</span>
            </span>
          )}
      </td>
      <td className={styles['modelsCell']}>
        {row.failure !== undefined
          ? <span className={styles['absent']}>—</span>
          : row.models === undefined || row.models.length === 0
            ? <span className={styles['modelsEmpty']}>{t('modelsEmpty')}</span>
            : (
              <div className={styles['models']}>
                <ul className={styles['modelList']}>
                  {row.models.map(model => (
                    <li key={model.id} className={styles['modelItem']}>
                      <span className={styles['modelChip']} title={model.name}>{model.id}</span>
                    </li>
                  ))}
                </ul>
                <span className={styles['modelsCount']}>{modelsCountCopy(t('modelsCount'), row.models.length)}</span>
              </div>
            )}
      </td>
      <td className={styles['commandCell']}>
        {row.localCommand === undefined
          ? <span className={styles['absent']}>—</span>
          : <code className={styles['commandName']} title={row.localCommand}>{row.localCommand}</code>}
      </td>
    </tr>
  )
}

/**
 * The daemon hint: an instruction card shown while no sensing daemon runs on
 * this host. The page reports presence inline until then; starting the daemon
 * moves presence to its report. Two steps cover the whole path: install the
 * CLI when it is not on PATH yet, then start the daemon.
 */
function DaemonHint({ t }: { t: (key: keyof typeof en) => string }): ReactNode {
  return (
    <div className={styles['daemonHint']} role="note">
      <span className={styles['daemonHintTitle']}>{t('daemonHintTitle')}</span>
      <span className={styles['daemonHintBody']}>{t('daemonHintBody')}</span>
      <HintCommandRow label={t('daemonHintInstall')} command={DAEMON_INSTALL_COMMAND} t={t} />
      <HintCommandRow label={t('daemonHintStart')} command={DAEMON_START_COMMAND} t={t} />
      <span className={styles['daemonHintBody']}>{t('daemonHintStatus')}</span>
    </div>
  )
}

/** One hint step: a caption, the command chip, and its own copy button. */
function HintCommandRow({ label, command, t }: { label: string; command: string; t: (key: keyof typeof en) => string }): ReactNode {
  const [copied, setCopied] = useState(false)
  return (
    <span className={styles['daemonHintStep']}>
      <span className={styles['daemonHintStepLabel']}>{label}</span>
      <span className={styles['daemonHintCommand']}>
        <code className={styles['daemonHintCommandText']}>{command}</code>
        <button
          type="button"
          className={styles['daemonHintCopy']}
          onClick={() => {
            // The web UI is a secure-context loopback page, so the typed
            // clipboard API is present; no absence branch belongs here.
            void navigator.clipboard.writeText(command)
            setCopied(true)
          }}
        >
          {copied ? t('daemonHintCopied') : t('daemonHintCopy')}
        </button>
      </span>
    </span>
  )
}
