/** Archived session recovery over the existing session and workspace feeds. */
import { useRef, useState } from 'react'
import { IconArchiveOutline20, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { HostDescriptionSource } from '@deepseek-ai/dsh-client-connection/client'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { createArchiveViewStore, deriveArchivedRows } from './archive.ts'
import css from './ArchivePage.module.css'

/** Host mutation callbacks and connection facts; content reads remain with sessions. */
export interface ArchiveInjected {
  hooks: { hostDescription: HostDescriptionSource }
  restore: (id: SessionId) => Promise<void>
  refresh: () => Promise<void>
  limit: number
}
/** Framework prop shares for the archive page. */
export type ArchivePageProps = PropsRuntime<'shell.page'> & PropsLocale<'workspace'> & PropsStore<ReturnType<typeof createArchiveViewStore>> & InjectFace<ArchiveInjected>
/**
 * Display archive membership and explicitly restore a session without opening or running it.
 * @param props - framework feeds, retained filters, and Host callbacks.
 * @returns searchable bounded metadata rows, freshness, and mutation feedback.
 */
export function ArchivePage(props: ArchivePageProps) {
  const { t, actions } = props
  const sessions = props.useSessions(value => value), workspaces = props.useWorkspaces(value => value)
  const view = props.useStore(value => value)
  const connected = props.useHostDescription(value => value !== undefined)
  const ready = connected && workspaces.baselinesReady && workspaces.state === 'idle' && sessions.phase === 'ready'
  const rows = deriveArchivedRows(sessions, workspaces, view, props.limit)
  const [busy, setBusy] = useState<SessionId | 'refresh' | null>(null)
  const [error, setError] = useState<string | null>(null), [done, setDone] = useState(false)
  const status = useRef<HTMLParagraphElement>(null)
  const restore = async (id: SessionId) => {
    setBusy(id); setError(null); setDone(false)
    try { await props.restore(id); setDone(true); status.current?.focus() }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(null) }
  }
  const refresh = async () => {
    setBusy('refresh'); setError(null)
    try { await props.refresh() }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(null) }
  }
  return <section className={css.page} aria-label={t('archive.title')} aria-busy={busy !== null}>
    <header className={css.header}><div><p className={css.eyebrow}>WORK / ARCHIVE</p><h1>{t('archive.title')}</h1></div><button type="button" disabled={!connected || busy !== null} onClick={() => { void refresh() }}>{t('archive.refresh')}</button></header>
    <p className={css.hint}>{t('archive.intro')}</p>
    {!connected ? <p role="status">{t('archive.disconnected')}</p> : !ready ? <p role="status">{t('archive.unready')}</p> : null}
    {workspaces.error === null ? null : <p role="alert" className={css.error}>{workspaces.error.message}</p>}
    {error === null ? null : <p role="alert" className={css.error}>{error}</p>}
    <p role="status" tabIndex={-1} ref={status} className={css.feedback}>{done ? t('archive.restored') : ''}</p>
    <div className={css.filters}>
      <label>{t('archive.search')}<input type="search" value={view.query} onChange={(event) => { actions.query(event.target.value) }} /></label>
      <label>{t('archive.workspace')}<select value={view.workspace} onChange={(event) => { actions.workspace(event.target.value) }}><option value="">{t('archive.all')}</option><option value="@ungrouped">{t('group.ungrouped')}</option>{workspaces.items.map(item => <option key={item.workspaceId} value={item.workspaceId}>{item.title}</option>)}</select></label>
    </div>
    {workspaces.baselinesReady ? <p className={css.hint}>{t('archive.count', { n: rows.total })}</p> : null}
    {rows.total > props.limit ? <p role="status">{t('search.hasMore', { n: props.limit })}</p> : null}
    {rows.total === 0 && ready ? <p>{view.query !== '' || view.workspace !== '' ? t('empty.noMatches') : t('archive.empty')}</p> : null}
    <ul className={css.list}>{rows.items.map(item => <li key={item.id} className={css.row}>
      <div><h2>{item.title ?? t('archive.unknown')}</h2><p>{item.workspace?.title ?? t('group.ungrouped')}</p><code>{item.id}</code>{item.title === undefined ? <p>{t('archive.missing')}</p> : null}</div>
      <button type="button" disabled={!ready || busy !== null} aria-label={t('archive.restoreLabel', { name: item.title ?? item.id })} onClick={() => { void restore(item.id) }}>{busy === item.id ? t('archive.restoring') : t('archive.restore')}</button>
    </li>)}</ul>
  </section>
}
/**
 * Open archive recovery at either sidebar width.
 * @param props - sidebar width, dictionary, and navigation callback.
 * @returns an accessible archive navigation control.
 */
export function ArchiveNavigation({ wide, t, open }: PropsRuntime<'sidebar.session.action'> & PropsLocale<'workspace'> & { open: () => void }) {
  const button = <button type="button" className={css.nav} aria-label={t('archive.title')} onClick={open}><IconArchiveOutline20 size={16} /><span hidden={!wide}>{t('archive.title')}</span></button>
  return wide ? button : <Tooltip label={t('archive.title')}>{button}</Tooltip>
}
