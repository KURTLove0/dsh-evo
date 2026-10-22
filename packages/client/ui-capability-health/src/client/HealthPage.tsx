/** Configuration and connection evidence rendered only from framework props. */
import { useEffect, useState } from 'react'
import { Button, IconRuntimeOutline16, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime, PropsStore, InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { ObservableSnapshot, HealthSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import type { HostDescriptionSource } from '@deepseek-ai/dsh-client-connection/client'
import type { HealthCheckRequest, HealthItem, HealthProbeId, HealthProbeRequest } from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { createHealthViewStore } from './store.ts'
import css from './HealthPage.module.css'

/** Plain callbacks and bare sources bound into framework hooks. */
export interface HealthInjected {
  hooks: { health: ObservableSnapshot<HealthSnapshot>; hostDescription: HostDescriptionSource }
  load: () => Promise<void>
  check: (request: HealthCheckRequest) => Promise<void>
  start: (request: HealthProbeRequest) => Promise<void>
  recover: (id?: HealthProbeId) => Promise<void>
  cancel: (id: HealthProbeId) => Promise<void>
  invalidate: () => void
  repair: (destination: HealthItem['repair']) => void
}
/** Page props derive all four shares from the shell slot, store, locale, and injected sources. */
export type HealthPageProps = PropsRuntime<'shell.page'> & PropsLocale<'capabilityHealth'> &
  PropsStore<ReturnType<typeof createHealthViewStore>> & InjectFace<HealthInjected>

function Time({ value }: { value: number }) {
  return <time dateTime={new Date(value).toISOString()}>{new Date(value).toLocaleString()}</time>
}

/**
 * Render timestamped configuration facts and explicitly requested temporary probes.
 * @param props - framework shares and host-backed callbacks.
 * @returns the independent capability inspection page.
 */
export function HealthPage(props: HealthPageProps) {
  const { t, actions } = props
  const data = props.useHealth(value => value)
  const connected = props.useHostDescription(value => value !== undefined)
  const view = props.useStore(value => value)
  const workspaces = props.useWorkspaces(value => value)
  const [navigationError, setNavigationError] = useState('')
  useEffect(() => { void props.load() }, [props.load])
  const agent = data.agents.find(value => value.id === view.agent)
  const workspace = workspaces.items.find(value => value.workspaceId === view.workspace)
  const report = data.report
  const selected = report?.selection
  const canProbe = connected && !data.stale && selected !== undefined && selected.id === agent?.id &&
    selected.revision === agent.revision && selected.workspaceId === workspace?.workspaceId && !agent.archived
  const servers = report?.items.filter(item => item.kind === 'mcp') ?? []
  const rows = report?.items.filter(item => item.kind !== 'mcp' && (view.filter === 'all' || item.state !== 'ready')) ?? []
  const repair = (target: HealthItem['repair']) => {
    setNavigationError('')
    try { props.repair(target) }
    catch (error) { setNavigationError(error instanceof Error ? error.message : String(error)) }
  }
  const repairCopy = { agents: 'repairAgents', runtimes: 'repairRuntimes', models: 'repairModels', settings: 'repairSettings', workspace: 'repairWorkspace' } as const
  return <main className={css.page} aria-label={t('title')}>
    <header><p className={css.eyebrow}>WORK / CAPABILITIES</p><h1>{t('title')}</h1><p>{t('intro')}</p><p className={css.hint}>{t('scopeHint')}</p>
      <div className={css.actions}><Button disabled={!connected || data.checking} onClick={() => { void props.check({ kind: 'global' }) }}>{t('globalCheck')}</Button><Button variant="outline" disabled={!connected || data.loading} onClick={() => { void props.load() }}>{t('refresh')}</Button><Button variant="outline" onClick={() => { repair('agents') }}>{t('configure')}</Button></div>
    </header>
    {!connected ? <p role="alert" className={css.error}>{t('disconnected')}</p> : null}
    {data.error === null ? null : <p role="alert" className={css.error}>{data.error}</p>}
    {data.probeErrors.map(error => <p key={error.id} role="alert" className={css.error}>{data.probes.find(value => value.id === error.id)?.serverName ?? data.pending.find(value => value.id === error.id)?.serverName} {error.message}</p>)}
    {navigationError === '' ? null : <p role="alert" className={css.error}>{navigationError}</p>}
    <p role="status">{data.checking ? t('checking') : data.loading ? t('loading') : ''}</p>
    <section className={css.panel} aria-label={t('selectedCheck')}><h2>{t('selectedCheck')}</h2><div className={css.fields}>
      <label>{t('agent')}<select value={view.agent} disabled={!connected} onChange={(event) => { props.invalidate(); actions.field('agent', event.target.value) }}><option value="">{t('choose')}</option>{data.agents.map(value => <option key={value.id} value={value.id}>{value.name}{value.archived ? ` · ${t('archived')}` : ''}</option>)}</select></label>
      <label>{t('workspace')}<select value={view.workspace} disabled={!connected} onChange={(event) => { props.invalidate(); actions.field('workspace', event.target.value) }}><option value="">{t('choose')}</option>{workspaces.items.map(value => <option key={value.workspaceId} value={value.workspaceId}>{value.title}</option>)}</select></label>
    </div><Button disabled={!connected || data.checking || agent === undefined || workspace === undefined} onClick={agent === undefined || workspace === undefined ? undefined : () => { void props.check({ kind: 'agent', id: agent.id, expectedRevision: agent.revision, workspaceId: workspace.workspaceId }) }}>{t('selectedCheck')}</Button>
    {data.loaded && data.agents.length === 0 && !data.loading && data.error === null ? <p>{t('noAgents')}</p> : null}
    </section>
    <section className={css.panel} aria-label={t('observations')}><h2>{t('observations')}</h2>{report === undefined ? <p>{t('noReport')}</p> : <>
      <p>{t('checkedAt')}: <Time value={report.checkedAt} /></p>{selected === undefined ? null : <p>{t('scope')}: {data.agents.find(value => value.id === selected.id)?.name ?? selected.id} · v{selected.revision} · {workspaces.items.find(value => value.workspaceId === selected.workspaceId)?.title ?? selected.workspaceId}</p>}
      {data.stale ? <p role="status" className={css.hint}>{t('stale')}</p> : null}
      <label>{t('all')}<select value={view.filter} onChange={(event) => { actions.filter(event.target.value as typeof view.filter) }}><option value="all">{t('all')}</option><option value="attention">{t('attention')}</option></select></label>
      <ul className={css.grid}>{rows.map(item => <li className={css.card} key={item.key}><p className={css.hint}>{t(item.kind)}</p><div className={css.cardTitle}><strong>{item.kind === 'workspace' ? workspaces.items.find(value => value.workspaceId === item.label)?.title ?? item.label : item.label || (item.kind === 'skills' ? t('noSkills') : t(item.kind))}</strong><span className={css.state} data-state={item.state}>{t(item.state)}</span></div><p>{t(item.code)}</p>{item.count === undefined ? null : <p>{t('count')}: {item.count}</p>}{item.source === undefined ? null : <p>{t('source')}: {item.source}</p>}<Button variant="outline" onClick={() => { repair(item.repair) }}>{t(repairCopy[item.repair])}</Button></li>)}</ul>
      {rows.length === 0 ? <p>{t('noMatch')}</p> : null}
    </>}</section>
    <section className={css.panel} aria-label={t('connections')}><h2>{t('connections')}</h2>{selected === undefined ? <p>{t('inspectFirst')}</p> : servers.length === 0 ? <p>{t('noMcp')}</p> : <ul className={css.grid}>{servers.map((server) => {
      const sameScope = (value: HealthProbeRequest) => value.agentId === selected.id &&
        value.expectedRevision === selected.revision && value.workspaceId === selected.workspaceId && value.serverName === server.label
      const last = data.probes.filter(sameScope).sort((a, b) => b.startedAt - a.startedAt)[0]
      const pending = data.pending.find(sameScope)
      return <li key={server.key} className={css.card}><h3>{server.label}</h3><p>{last === undefined ? t('mcp-not-checked') : t(last.status)}</p>{last?.cleanup === 'failed' ? <p role="alert" className={css.error}>{t('cleanupFailed')}</p> : null}
        <Button disabled={!canProbe || last?.status === 'running' || pending !== undefined || data.probes.some(value => value.cleanup === 'failed' && !data.unavailable.includes(value.id))} onClick={() => {
          void props.start({ id: crypto.randomUUID() as HealthProbeId, agentId: selected.id, expectedRevision: selected.revision,
            workspaceId: selected.workspaceId, serverName: server.label })
        }}>{t(last === undefined ? 'probe' : 'probeAgain')}</Button></li>
    })}</ul>}</section>
    <section className={css.panel} aria-label={t('history')}><h2>{t('history')}</h2><p className={css.hint}>{t('transient')}</p><Button variant="outline" disabled={!connected || (data.probes.length === 0 && data.pending.length === 0)} onClick={() => { void props.recover() }}>{t('recoverAll')}</Button>
      {data.probes.length + data.pending.length === 0 ? <p>{t('noProbes')}</p> : null}<ul className={css.history}>
        {data.probes.map(record => <li className={css.card} key={record.id}><div className={css.cardTitle}>
          <strong>{record.serverName} · {data.agents.find(value => value.id === record.agentId)?.name ?? record.agentId}</strong>
          <span className={css.state}>{t(record.status)}</span></div>
        <p>{workspaces.items.find(value => value.workspaceId === record.workspaceId)?.title ?? record.workspaceId} · v{record.expectedRevision}</p><p>{t('startedAt')}: <Time value={record.startedAt} /></p>{record.checkedAt === undefined ? null : <><p>{t('checkedAt')}: <Time value={record.checkedAt} /></p><p>{t('duration')}: {record.checkedAt - record.startedAt} ms</p></>}
        {record.cleanup === undefined ? null : <p className={record.cleanup === 'failed' ? css.error : undefined}>{t(record.cleanup === 'closed' ? 'closed' : 'cleanupFailed')}</p>}{data.unavailable.includes(record.id) ? <p role="status">{t('unavailable')} {t('lastKnown')}</p> : null}
        <div className={css.actions}>{record.status === 'running' ? <Button variant="outline" disabled={!connected || data.unavailable.includes(record.id)} onClick={() => { void props.cancel(record.id) }}>{t('cancel')}</Button> : null}<Button variant="outline" disabled={!connected} onClick={() => { void props.recover(record.id) }}>{t('recover')}</Button></div>
        </li>)}
        {data.pending.map(request => <li className={css.card} key={request.id}><h3>{request.serverName}</h3><p role="status">{t('pending')}</p>{data.unavailable.includes(request.id) ? <p>{t('unavailable')}</p> : null}<Button variant="outline" disabled={!connected} onClick={() => { void props.recover(request.id) }}>{t('recover')}</Button></li>)}
      </ul>
    </section>
  </main>
}

type NavigationProps = PropsRuntime<'sidebar.footer.action'> & PropsLocale<'capabilityHealth'> & { open: () => void }
/**
 * Render a navigation control in the existing configuration footer.
 * @param props - framework sidebar width, locale, and navigation callback.
 * @returns a labeled capability-check entry at either sidebar width.
 */
export function HealthNavigation({ wide, t, open }: NavigationProps) {
  const button = <button type="button" className={css.nav} aria-label={t('title')} onClick={open}><IconRuntimeOutline16 /><span hidden={!wide}>{t('title')}</span></button>
  return wide ? button : <Tooltip label={t('title')}>{button}</Tooltip>
}
