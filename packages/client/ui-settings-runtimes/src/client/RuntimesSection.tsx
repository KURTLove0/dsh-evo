/** Machine directory with runtime catalogs and host-backed management dialogs. */
import { useEffect, useId, useState, type ReactNode } from 'react'
import clsx from 'clsx'
import {
  IconRuntimeOutline16,
  IconSearchOutline16,
  IconRefreshOutline16,
  IconPlusOutline16,
  IconLinkOutline16,
  IconCloseOutline16,
  IconChevronDownOutline14,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { RuntimesSettingsStore, RuntimeRow, RuntimeProfile } from './store.ts'
import type { en } from './locales.ts'
import styles from './RuntimesSection.module.css'
import { RuntimeDialogs } from './RuntimeDialogs.tsx'
import type { RuntimeDialogState } from './RuntimeDialogs.tsx'
import { runtimeMachines, filterMachines } from './machines.ts'

/** The command installing the dsh CLI; an npm literal, never localized. */
export const DAEMON_INSTALL_COMMAND = 'npm install -g @deepseek-ai/dsh'

/** The command the hint asks the user to run; a CLI literal, never localized. */
export const DAEMON_START_COMMAND = 'dsh daemon start'

/** Injected dependencies of {@link RuntimesSection} (slot `inject`). */
export interface RuntimesSectionInjected {
  /** The page store (loaded on mount, refreshed on pushed invalidations). */
  load: () => Promise<void>
  connect: RuntimesSettingsStore['connect']
  saveProfile: (id: string, profile: RuntimeProfile) => Promise<void>
  remove: RuntimesSettingsStore['remove']
  hooks: {
    /** Page snapshot bound by the UI renderer as useSnapshot. */
    snapshot: RuntimesSettingsStore['store']
  }
  /** Section copy. */
  t: (key: keyof typeof en) => string
}

/**
 * Props delivered by the settings slot outlet.
 */
export type RuntimesSectionProps = Partial<InjectFace<RuntimesSectionInjected>>

type RuntimesSectionFace = InjectFace<RuntimesSectionInjected>

const MODEL_PREVIEW_COUNT = 3

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
  const { load, connect, saveProfile, remove, useSnapshot, t } = props
  if (
    load === undefined ||
    connect === undefined ||
    saveProfile === undefined ||
    remove === undefined ||
    useSnapshot === undefined ||
    t === undefined
  )
    return null
  return <Loaded injected={{ load, connect, saveProfile, remove, useSnapshot, t }} />
}

function Loaded({ injected }: { injected: RuntimesSectionFace }): ReactNode {
  const { load, t } = injected
  const state = injected.useSnapshot(snapshot => snapshot)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'online' | 'issues'>('all')
  const [selection, setSelection] = useState('local')
  const [dialog, setDialog] = useState<RuntimeDialogState | null>(null)
  useEffect(() => {
    if (state.status === 'idle') void load()
  }, [load, state.status])
  const machines = runtimeMachines(state, t('localMachine'))
  const visible = filterMachines(machines, search, filter)
  const selected = visible.find(machine => machine.id === selection) ?? visible[0]
  return (
    <div className={styles['section']}>
      <header className={styles['header']}>
        <div className={styles['pageIdentity']}>
          <span aria-hidden="true"><IconRuntimeOutline16 /></span>
          <h2 className={styles['title']}>
            {t('title')}{' '}
            <span className={styles['count']}>{machines.reduce((sum, machine) => sum + machine.rows.length, 0)}</span>
          </h2>
        </div>
        <div className={styles['actions']}>
          <button
            type="button"
            className={styles['headerButton']}
            aria-label={t('refresh')}
            title={t('refresh')}
            disabled={state.status === 'loading'}
            onClick={() => {
              void load()
            }}
          >
            <span aria-hidden="true"><IconRefreshOutline16 /></span>
          </button>
          <button
            type="button"
            className={styles['headerButton']}
            aria-label={t('manageRuntimes')}
            title={t('manageRuntimes')}
            disabled={!state.writable || state.saving}
            onClick={() => {
              setDialog({ kind: 'profiles' })
            }}
          >
            <span aria-hidden="true"><IconPlusOutline16 /></span>
            <span className={styles['actionLabel']}>{t('manageRuntimes')}</span>
          </button>
          <button
            type="button"
            className={styles['headerButton']}
            aria-label={t('connectRemote')}
            title={t('connectRemote')}
            disabled={!state.writable || state.saving}
            onClick={() => {
              setDialog({ kind: 'connect' })
            }}
          >
            <span aria-hidden="true"><IconLinkOutline16 /></span>
            <span className={styles['actionLabel']}>{t('connectRemote')}</span>
          </button>
        </div>
      </header>
      {state.status === 'error' ? (
        <div role="alert" className={styles['error']}>
          {t('loadFailed')}: {state.error}{' '}
          <button
            type="button"
            onClick={() => {
              void load()
            }}
          >
            {t('retry')}
          </button>
        </div>
      ) : null}
      {state.status === 'loading' || state.status === 'idle' ? (
        <p role="status" className={styles['empty']}>
          {t('loading')}
        </p>
      ) : null}
      {state.managementError ? (
        <p role="status" className={styles['intro']}>
          {t('managementUnavailable')}: {state.managementError}
        </p>
      ) : null}
      {state.status !== 'idle' && machines.length > 0 ? (
        <div className={styles['workbench']}>
          <aside className={styles['machines']} aria-label={t('machines')}>
            <div className={styles['machineTools']}>
              <div className={styles['directoryHeading']}>
                <h3>{t('machines')}</h3>
                <span>{machines.length}</span>
              </div>
              <div className={styles['searchField']}>
                <span className={styles['searchIcon']} aria-hidden="true"><IconSearchOutline16 /></span>
                <input
                  className={styles['search']}
                  aria-label={t('searchMachines')}
                  placeholder={t('searchMachines')}
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value)
                  }}
                />
                {search ? (
                  <button
                    type="button"
                    className={styles['clearSearch']}
                    aria-label={t('clearSearch')}
                    onClick={() => { setSearch('') }}
                  >
                    <span aria-hidden="true"><IconCloseOutline16 /></span>
                  </button>
                ) : null}
              </div>
              <div className={styles['filters']} aria-label={t('filterMachines')}>
                {(['all', 'online', 'issues'] as const).map(key => (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={filter === key}
                    onClick={() => {
                      setFilter(key)
                    }}
                  >
                    {key !== 'all' ? (
                      <span
                        aria-hidden="true"
                        className={clsx(styles['filterDot'], key === 'online' ? styles['stateDotActive'] : styles['stateDotFailed'])}
                      />
                    ) : null}
                    {t(key)}{' '}
                    <span>
                      {key === 'all'
                        ? machines.length
                        : machines.filter(machine => (key === 'online' ? machine.online : !machine.online)).length}
                    </span>
                  </button>
                ))}
              </div>
            </div>
            {(['local', 'remote'] as const).map((kind) => {
              const group = visible.filter(machine => machine.kind === kind)
              return group.length ? (
                <div key={kind} className={styles['machineGroup']}>
                  <h3>
                    <span>{t(kind === 'local' ? 'localGroup' : 'remoteGroup')}</span>
                    <span className={styles['groupLine']} />
                    <span>{group.length}</span>
                  </h3>
                  {group.map(machine => (
                    <button
                      key={machine.id}
                      type="button"
                      className={styles['machineRow']}
                      aria-pressed={selected?.id === machine.id}
                      onClick={() => {
                        setSelection(machine.id)
                      }}
                    >
                      <span className={styles['machineIcon']} aria-hidden="true">
                        <IconRuntimeOutline16 />
                        <span
                          className={clsx(styles['machineDot'], machine.online ? styles['stateDotActive'] : styles['stateDotFailed'])}
                        />
                      </span>
                      <span className={styles['machineContent']}>
                        <span className={styles['machineName']} title={machine.name}>{machine.name}</span>
                        <span className={styles['machineOrigin']} title={machine.kind === 'local' ? t('thisMachine') : machine.id}>
                          {machine.kind === 'local' ? t('thisMachine') : machine.id}
                        </span>
                        <span className={styles['machineMeta']}>
                          <span className={machine.online ? styles['healthOnline'] : styles['healthFailed']}>
                            {machine.online ? t('statusActive') : t('issues')}
                          </span>
                          <span>{machine.rows.length} {t('runtimeUnit')}</span>
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              ) : null
            })}
            {visible.length === 0 ? <p className={styles['empty']}>{t('noMatches')}</p> : null}
          </aside>
          <div className={styles['machineDetail']}>
            {selected ? (
              <>
                <div className={styles['detailHeader']}>
                  <div className={styles['detailIdentity']}>
                    <div className={styles['detailTitleRow']}>
                      <h3 className={styles['machineTitle']}>{selected.name}</h3>
                      <span className={styles['statusBadge']}>
                        <span
                          aria-hidden="true"
                          className={clsx(styles['filterDot'], selected.online ? styles['stateDotActive'] : styles['stateDotFailed'])}
                        />
                        {selected.online ? t('statusActive') : t('issues')}
                      </span>
                      {selected.kind === 'local' ? <span className={styles['localBadge']}>{t('localGroup')}</span> : null}
                    </div>
                    <SummaryStrip
                      rows={selected.rows}
                      daemonRunning={selected.kind === 'local' ? state.daemonRunning : undefined}
                      t={t}
                    />
                    {selected.kind === 'remote' ? <p className={styles['machineOrigin']}>{selected.id}</p> : null}
                    {selected.version ? (
                      <p className={styles['machineOrigin']}>{t('version')}: {selected.version} · {selected.cwd}</p>
                    ) : null}
                  </div>
                  {selected.kind === 'remote' ? (
                    <div className={styles['actions']}>
                      <a className={styles['secondaryButton']} href={selected.id} target="_blank" rel="noreferrer">
                        {t('openRemote')}
                      </a>
                      <button
                        type="button"
                        className={styles['secondaryButton']}
                        disabled={!state.writable || state.saving}
                        onClick={() => {
                          setDialog({ kind: 'disconnect', url: selected.id, name: selected.name })
                        }}
                      >
                        {t('disconnect')}
                      </button>
                    </div>
                  ) : null}
                </div>
                {selected.error ? (
                  <p role="alert" className={styles['error']}>
                    {selected.error}
                  </p>
                ) : null}
                {selected.rows.length ? (
                  <div className={styles['tableScroll']}>
                    <table className={styles['table']} aria-label={t('title')}>
                      <colgroup>
                        <col className={styles['colService']} />
                        <col className={styles['colHealth']} />
                        <col />
                        <col className={styles['colCommand']} />
                      </colgroup>
                      <thead>
                        <tr>
                          <th scope="col">{t('colService')}</th>
                          <th scope="col">{t('colHealth')}</th>
                          <th scope="col">{t('colModels')}</th>
                          <th scope="col">{t('colCommand')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selected.rows.map(row => (
                          <RuntimeRowView key={`${selected.id}:${row.provider}`} row={row} t={t} />
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className={styles['empty']}>{t('empty')}</p>
                )}
                {selected.kind === 'local' && !state.daemonRunning && state.status === 'ready' ? (
                  <DaemonHint t={t} />
                ) : null}
                {selected.kind === 'local' && Object.keys(state.profiles).length > 0 ? (
                  <div className={styles['profileList']}>
                    <h3>{t('customRuntimes')}</h3>
                    {Object.entries(state.profiles).map(([id, profile]) => (
                      <div key={id} className={styles['profileRow']}>
                        <div>
                          <strong>{profile.name}</strong>
                          <code>{profile.command}</code>
                          <span>
                            {!profile.enabled
                              ? t('disabled')
                              : selected.rows.some(row => row.provider === id)
                                ? t('statusActive')
                                : t('pending')}
                          </span>
                        </div>
                        <button
                          type="button"
                          className={styles['secondaryButton']}
                          disabled={!state.writable || state.saving}
                          onClick={() => {
                            setDialog({ kind: 'edit', id, profile })
                          }}
                        >
                          {t('edit')}
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
              </>
            ) : (
              <div className={styles['emptyState']}>
                <span aria-hidden="true"><IconSearchOutline16 size={28} /></span>
                <p>{t('noMatches')}</p>
                <button
                  type="button"
                  className={styles['secondaryButton']}
                  onClick={() => { setSearch(''); setFilter('all') }}
                >
                  {t('resetFilters')}
                </button>
              </div>
            )}
          </div>
        </div>
      ) : null}
      {dialog ? (
        <RuntimeDialogs
          dialog={dialog}
          state={state}
          injected={injected}
          onChange={setDialog}
          onClose={() => {
            setDialog(null)
          }}
        />
      ) : null}
    </div>
  )
}

/** Selected machine's catalog counts and optional local daemon status. */
function SummaryStrip({
  rows,
  daemonRunning,
  t,
}: {
  rows: readonly RuntimeRow[]
  daemonRunning: boolean | undefined
  t: (key: keyof typeof en) => string
}): ReactNode {
  const online = rows.filter(row => row.failure === undefined).length
  return (
    <div className={styles['summary']} role="status">
      <span className={styles['summaryCounts']}>{summaryCountsCopy(t('summaryCounts'), rows.length, online)}</span>
      {daemonRunning !== undefined ? (
        <span className={clsx(styles['daemonChip'], daemonRunning ? styles['daemonChipOn'] : styles['daemonChipOff'])}>
          {daemonRunning ? t('daemonChipRunning') : t('daemonChipStopped')}
        </span>
      ) : null}
    </div>
  )
}

/** One runtime table row: identity, health, the models it loads, its command. */
function RuntimeRowView({ row, t }: { row: RuntimeRow; t: (key: keyof typeof en) => string }): ReactNode {
  const [modelsExpanded, setModelsExpanded] = useState(false)
  const modelListId = useId()
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
        {row.failure === undefined ? (
          <span className={styles['healthOnline']}>
            <span
              className={clsx(styles['stateDot'], styles['stateDotActive'])}
              role="img"
              aria-label={t('statusActive')}
              title={t('statusActive')}
            />
            {t('statusActive')}
          </span>
        ) : (
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
        {row.failure !== undefined ? (
          <span className={styles['absent']}>—</span>
        ) : row.models === undefined || row.models.length === 0 ? (
          <span className={styles['modelsEmpty']}>{t('modelsEmpty')}</span>
        ) : (
          <div className={styles['models']}>
            <ul id={modelListId} className={styles['modelList']}>
              {(modelsExpanded ? row.models : row.models.slice(0, MODEL_PREVIEW_COUNT)).map(model => (
                <li key={model.id} className={styles['modelItem']}>
                  <span className={styles['modelChip']} title={model.name}>
                    {model.id}
                  </span>
                </li>
              ))}
            </ul>
            <div className={styles['modelsFooter']}>
              <span className={styles['modelsCount']}>{modelsCountCopy(t('modelsCount'), row.models.length)}</span>
              {row.models.length > MODEL_PREVIEW_COUNT ? (
                <button
                  type="button"
                  className={styles['modelsToggle']}
                  aria-expanded={modelsExpanded}
                  aria-controls={modelListId}
                  onClick={() => {
                    setModelsExpanded(expanded => !expanded)
                  }}
                >
                  {modelsExpanded ? t('collapseModels') : t('expandModels')}
                  <span aria-hidden="true"><IconChevronDownOutline14 /></span>
                </button>
              ) : null}
            </div>
          </div>
        )}
      </td>
      <td className={styles['commandCell']}>
        {row.localCommand === undefined ? (
          <span className={styles['absent']}>—</span>
        ) : (
          <code className={styles['commandName']} title={row.localCommand}>
            {row.localCommand}
          </code>
        )}
      </td>
    </tr>
  )
}

/** Expandable setup instructions for the local runtime sensing daemon. */
function DaemonHint({ t }: { t: (key: keyof typeof en) => string }): ReactNode {
  return (
    <details className={styles['daemonHint']}>
      <summary className={styles['daemonHintTitle']}>
        <span aria-hidden="true"><IconRuntimeOutline16 /></span>
        <span>{t('daemonHintTitle')}</span>
        <span className={styles['disclosureIcon']} aria-hidden="true"><IconChevronDownOutline14 /></span>
      </summary>
      <div className={styles['daemonHintContent']}>
        <span className={styles['daemonHintBody']}>{t('daemonHintBody')}</span>
        <HintCommandRow label={t('daemonHintInstall')} command={DAEMON_INSTALL_COMMAND} t={t} />
        <HintCommandRow label={t('daemonHintStart')} command={DAEMON_START_COMMAND} t={t} />
        <span className={styles['daemonHintBody']}>{t('daemonHintStatus')}</span>
      </div>
    </details>
  )
}

/** One hint step: a caption, the command chip, and its own copy button. */
function HintCommandRow({
  label,
  command,
  t,
}: {
  label: string
  command: string
  t: (key: keyof typeof en) => string
}): ReactNode {
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState(false)
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
            void navigator.clipboard.writeText(command).then(
              () => {
                setCopied(true)
                setCopyError(false)
              },
              () => {
                setCopyError(true)
              },
            )
          }}
        >
          {copyError ? t('copyFailed') : copied ? t('daemonHintCopied') : t('daemonHintCopy')}
        </button>
      </span>
    </span>
  )
}
