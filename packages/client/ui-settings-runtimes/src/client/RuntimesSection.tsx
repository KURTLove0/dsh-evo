/**
 * Runtimes settings section: the model runtimes this deployment can call,
 * rendered as read-only rows joined from the configurable-provider directory
 * and the host model catalog. Every row is a live runtime showing its loaded
 * models inline — a dormant route is a configuration candidate that belongs
 * to the Models page, and a local CLI the host cannot find is no runtime
 * here. Model selection itself stays with the composer's picker — this page
 * reports and links, it never routes.
 */

import type { ReactNode } from 'react'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { RuntimesSettingsStore, RuntimeRow } from './store.ts'
import type { en } from './locales.ts'
import styles from './RuntimesSection.module.css'

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
      {state.rows.length === 0 && state.status === 'ready'
        ? <p className={styles['empty']}>{t('empty')}</p>
        : (
          <ul className={styles['rows']}>
            {state.rows.map(row => <RuntimeCard key={row.provider} row={row} t={t} />)}
          </ul>
        )}
    </div>
  )
}

/** One runtime row: identity, liveness, and the models it currently loads. */
function RuntimeCard({ row, t }: { row: RuntimeRow; t: (key: keyof typeof en) => string }): ReactNode {
  return (
    <li className={styles['rowCard']}>
      <div className={styles['rowHead']}>
        <span className={styles['rowIdentity']}>
          <span
            className={`${styles['stateDot']} ${styles['stateDotActive']}`}
            role="img"
            aria-label={t('statusActive')}
            title={t('statusActive')}
          />
          <span className={styles['rowName']}>{row.displayName}</span>
          <span className={styles['rowRoute']}>{row.provider}</span>
        </span>
        <span className={styles['rowStatus']}>{t('statusActive')}</span>
      </div>
      <div className={styles['runtimeBody']}>
        {row.failure !== undefined
          ? <p className={styles['failure']} role="alert">{`${t('modelsFailure')}: ${row.failure}`}</p>
          : (
            <div className={styles['models']}>
              <span className={styles['modelsHeading']}>{t('modelsHeading')}</span>
              {row.models === undefined || row.models.length === 0
                ? <span className={styles['modelsEmpty']}>{t('modelsEmpty')}</span>
                : (
                  <ul className={styles['modelList']}>
                    {row.models.map(model => (
                      <li key={model.id} className={styles['modelItem']}>
                        <span className={styles['modelChip']} title={model.name}>{model.id}</span>
                      </li>
                    ))}
                  </ul>
                )}
              {row.models !== undefined && row.models.length > 0
                ? <span className={styles['modelsCount']}>{modelsCountCopy(t('modelsCount'), row.models.length)}</span>
                : null}
            </div>
          )}
      </div>
    </li>
  )
}
