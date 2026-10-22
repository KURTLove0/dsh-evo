/** Source grants beside explicit literal retrieval and inert versioned line citations. */
import { useState } from 'react'
import { IconSearchOutline16, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkspaceId, KnowledgeIndexId, KnowledgeCitation, KnowledgeExcerpt, KnowledgeSource } from '@deepseek-ai/dsh-api-remotes/client'
import type { KnowledgeSnapshot, KnowledgeWrite, ObservableSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import type { HostDescriptionSource } from '@deepseek-ai/dsh-client-connection/client'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { createKnowledgeViewStore } from './store.ts'
import type {} from './locales.ts'
import css from './KnowledgeView.module.css'
/** Explicit operations supplied by the browser plugin; no content reads occur on navigation. */
export interface KnowledgeInjected {
  hooks: { knowledge: ObservableSnapshot<KnowledgeSnapshot>; hostDescription: HostDescriptionSource }
  select: (id: WorkspaceId | undefined) => Promise<void>
  refresh: () => Promise<void>
  search: (text: string, limit: number) => Promise<void>
  read: (citation: KnowledgeCitation) => Promise<void>
  clearPreview: () => void
  command: (command: KnowledgeWrite) => Promise<void>
  discard: () => void
  copy: (text: string) => Promise<void>
}
/** Four slot shares for source management and exact captured-text inspection. */
export type KnowledgePageProps = PropsRuntime<'shell.page'> & PropsLocale<'workKnowledge'>
  & PropsStore<ReturnType<typeof createKnowledgeViewStore>> & InjectFace<KnowledgeInjected>
/**
 * Serialize every citation field needed by a later explicit knowledge_read call.
 * @param excerpt - authorized captured text with source path and exact citation.
 * @returns inert JSON identifying the source, version, digest, and line range.
 */
export function citationText(excerpt: KnowledgeExcerpt): string {
  return JSON.stringify({ path: excerpt.path, ...excerpt.citation }, null, 2)
}
/**
 * Render private file grants and explicit reads with distinct metadata, content, and command states.
 * @param props - workspace projection, retained drafts, knowledge observations, and operations.
 * @returns the bilingual responsive knowledge directory using the existing cyber theme.
 */
export function KnowledgePage(props: KnowledgePageProps) {
  const { t, actions } = props, view = props.useStore(value => value), data = props.useKnowledge(value => value)
  const workspaces = props.useWorkspaces(value => value), connected = props.useHostDescription(value => value !== undefined)
  const [copied, setCopied] = useState<{ text: string; success: boolean } | null>(null)
  const selected = data.sources.find(source => source.id === view.sourceId)
  const version = selected?.versions.find(value => value.version === view.version) ?? selected?.versions.at(-1)
  const blocked = !connected || data.writing || data.pending !== undefined || data.stale
  const result = data.result, excerpt = data.excerpt, citation = excerpt === undefined ? '' : citationText(excerpt)
  const choose = (source: KnowledgeSource) => { props.clearPreview(); actions.select(source) }
  const pending = data.pending
  const pendingPath = pending === undefined ? '' : pending.kind === 'register' ? pending.request.path
    : data.sources.find(source => source.id === pending.request.id)?.path ?? pending.request.id
  const commands = { register: 'registerCommand', index: 'indexCommand', setEnabled: 'grantCommand' } as const
  return <main className={css.page} aria-label={t('title')}>
    <header className={css.heading}><div><p className={css.eyebrow}>KNOWLEDGE / SOURCES</p><h1>{t('title')}</h1><p className={css.hint}>{t('intro')}</p></div>
      <button type="button" disabled={!connected || data.loading} onClick={() => { void props.refresh() }}>{t('refresh')}</button></header>
    {!connected ? <p role="status">{t('offline')}</p> : null}
    <label className={css.workspace}>{t('workspace')}<select value={data.workspace ?? ''} disabled={data.writing || pending !== undefined} onChange={(event) => { actions.edit({ sourceId: '', version: 0 }); void props.select(event.target.value === '' ? undefined : event.target.value as WorkspaceId) }}>
      <option value="">{t('selectWorkspace')}</option>{workspaces.items.map(item => <option key={item.workspaceId} value={item.workspaceId}>{item.title}</option>)}</select></label>
    {data.loading ? <p role="status">{t('loading')}</p> : null}{data.stale && connected ? <p role="status">{t('stale')}</p> : null}
    {data.error === null ? null : <p role="alert" className={css.error}>{data.error}</p>}
    {pending === undefined ? null : <section className={css.pending} aria-label={t('pending')}><h2>{t('pending')}</h2><p>{t(commands[pending.kind])} · <strong>{pendingPath}</strong></p><code>{pending.request.id}</code>
      <p className={css.hint}>{t('uncertain')}</p><div className={css.actions}><button type="button" disabled={!connected || data.writing} onClick={() => { void props.command(pending) }}>{t('retry')}</button><button type="button" disabled={data.writing} onClick={props.discard}>{t('discard')}</button></div></section>}
    {data.writeError === null ? null : <p role="alert" className={css.error}>{data.writeError}</p>}
    {data.writing ? <p role="status">{t('writing')}</p> : data.acknowledged === undefined ? null : <section aria-label={t('receipt')}>
      <p role="status">{t('acknowledged')} {data.acknowledged.path} · {t(commands[data.acknowledged.kind])}</p>
      {data.acknowledged.kind !== 'index' ? null : <p className={data.acknowledged.attempt.state === 'failed' ? css.error : css.state}>{t(data.acknowledged.attempt.state === 'ready' ? 'ready' : 'failed')}
        {data.acknowledged.attempt.state === 'ready' ? ` · v${data.acknowledged.attempt.version}` : ` · ${data.acknowledged.attempt.message}`}</p>}
    </section>}
    <div className={css.columns}><aside className={css.panel} aria-label={t('sources')}>
      <h2>{t('sources')}</h2><form aria-label={t('register')} onSubmit={(event) => { event.preventDefault(); if (data.workspace !== undefined) void props.command({ kind: 'register', request: { id: crypto.randomUUID() as KnowledgeSource['id'], workspaceId: data.workspace, path: view.path } }) }}>
        <label>{t('path')}<input required disabled={blocked || data.workspace === undefined} value={view.path} onChange={(event) => { actions.edit({ path: event.target.value }) }} /></label>
        <p className={css.hint}>{t('pathHint')}</p><button type="submit" className={css.primary} disabled={blocked || data.workspace === undefined || view.path.trim() === ''}>{t('register')}</button>
      </form>
      {data.sources.length === 0 && data.workspace !== undefined && !data.stale ? <p>{t('empty')}</p> : null}
      <ul className={css.list}>{data.sources.map(source => <li key={source.id}><button type="button" aria-pressed={selected?.id === source.id} onClick={() => { choose(source) }}>
        <strong>{source.path}</strong><span>{t(source.enabled ? 'enabled' : 'disabled')} · {source.versions.length === 0 ? t('unindexed') : `${t('captured')} ${source.versions.length}`}</span></button></li>)}</ul>
      {data.options === undefined ? null : <p className={css.hint}>{t('limit', { n: data.options.maxFileBytes, s: data.options.maxSources, v: data.options.maxVersions })}</p>}
    </aside><div className={css.content}>
      <section className={css.panel} aria-label={t('versions')}>
        {selected === undefined ? <p>{t('choose')}</p> : <><div className={css.heading}><div><h2>{selected.path}</h2><p className={css.hint}>{selected.workspacePath}</p><p className={css.state}>{t(selected.enabled ? 'enabled' : 'disabled')}</p></div>
          <div className={css.actions}><button type="button" disabled={blocked} onClick={() => { void props.command({ kind: 'setEnabled', request: { id: selected.id, expectedRevision: selected.revision, enabled: !selected.enabled } }) }}>{t(selected.enabled ? 'disable' : 'enable')}</button>
            <button type="button" disabled={blocked || !selected.enabled} onClick={() => { void props.command({ kind: 'index', request: { id: selected.id, expectedRevision: selected.revision, requestId: crypto.randomUUID() as KnowledgeIndexId } }) }}>{t('index')}</button></div></div>
        <p className={css.hint}>{t('grantHint')}</p>
        {selected.lastAttempt === undefined ? <p>{t('unindexed')}</p> : <div><h3>{t('attempt')}</h3><p>{t(selected.lastAttempt.state === 'ready' ? 'ready' : 'failed')} · {new Date(selected.lastAttempt.completedAt).toLocaleString()}</p>
          {selected.lastAttempt.state === 'failed' ? <p className={css.error}>{selected.lastAttempt.message}</p> : null}</div>}
        {version === undefined ? null : <form aria-label={t('preview')} onSubmit={(event) => { event.preventDefault(); void props.read({ sourceId: selected.id, version: version.version, textSha256: version.textSha256, startLine: view.startLine, endLine: view.endLine }) }}>
          <div className={css.fields}><label>{t('version')}<select value={version.version} onChange={(event) => { props.clearPreview(); const chosen = selected.versions.find(value => value.version === Number(event.target.value)); if (chosen !== undefined) actions.edit({ version: chosen.version, startLine: 1, endLine: chosen.lines }) }}>
            {selected.versions.map(value => <option key={value.version} value={value.version}>v{value.version} · {value.lines} {t('lines')} · {value.bytes} {t('bytes')}</option>)}</select></label>
          <label>{t('start')}<input type="number" required min={1} max={version.lines} value={view.startLine} onChange={(event) => { actions.edit({ startLine: Number(event.target.value) }) }} /></label>
          <label>{t('end')}<input type="number" required min={view.startLine} max={version.lines} value={view.endLine} onChange={(event) => { actions.edit({ endLine: Number(event.target.value) }) }} /></label></div>
          <button type="submit" disabled={blocked || data.reading || !selected.enabled}>{t('read')}</button></form>}
        </>}
      </section>
      <section className={css.panel} aria-label={t('search')}><h2>{t('search')}</h2><p className={css.hint}>{t('queryHint')}</p>
        <form onSubmit={(event) => { event.preventDefault(); if (data.options !== undefined) void props.search(view.text, view.limit === '' ? data.options.maxHits : Number(view.limit)) }}>
          <div className={css.searchFields}><label>{t('query')}<input required type="search" value={view.text} onChange={(event) => { actions.edit({ text: event.target.value }) }} /></label>
            <label>{t('hitLimit')}<input type="number" min={1} max={data.options?.maxHits} value={view.limit} placeholder={String(data.options?.maxHits ?? '')} onChange={(event) => { actions.edit({ limit: event.target.value }) }} /></label></div>
          <button type="submit" className={css.primary} disabled={blocked || data.searching || data.workspace === undefined || data.options === undefined || view.text.trim() === ''}>{data.searching ? t('loading') : t('search')}</button>
        </form>
        {data.searchError === null ? null : <p role="alert" className={css.error}>{data.searchError}</p>}
        {result === undefined ? null : <section aria-label={t('results')}><h3>{t('results')}</h3><p>{t('submitted')}: <code>{result.query.text}</code></p>
          {result.value.hits.length === 0 ? <p>{t('noResults')}</p> : <ul className={css.hits}>{result.value.hits.map(hit => <li key={JSON.stringify(hit.citation)}><div className={css.actions}><code>{hit.path} · v{hit.citation.version} · L{hit.citation.startLine}</code><button type="button" disabled={blocked || data.reading} onClick={() => { void props.read(hit.citation) }}>{t('read')}</button></div><pre tabIndex={0}>{hit.text}</pre></li>)}</ul>}
          {result.value.more ? <p role="status">{t('more')}</p> : null}
          {result.value.excluded.length === 0 ? null : <div><h3>{t('exclusions')}</h3>{result.value.excluded.map(item => <p key={item.sourceId}>{data.sources.find(source => source.id === item.sourceId)?.path ?? item.sourceId}: {item.message}</p>)}</div>}
          {result.value.current.map(item => <p className={css.hint} key={item.sourceId}>{data.sources.find(source => source.id === item.sourceId)?.path ?? item.sourceId} · {t(item.state)} · {t('observed')} {new Date(item.observedAt).toLocaleString()}</p>)}
        </section>}
      </section>
      <section className={css.panel} aria-label={t('preview')}><h2>{t('preview')}</h2><p className={css.hint}>{t('inert')}</p>
        {data.reading ? <p role="status">{t('loading')}</p> : null}{data.readError === null ? null : <p role="alert" className={css.error}>{data.readError}</p>}
        {excerpt === undefined ? null : <>
          <p><code>{excerpt.path} · v{excerpt.citation.version} · L{excerpt.citation.startLine}–L{excerpt.citation.endLine}</code></p>
          <pre className={css.preview} tabIndex={0}>{excerpt.text}</pre><p>{t('current')}: {t(excerpt.current.state)}</p><p className={css.hint}>{t('observed')}: {new Date(excerpt.current.observedAt).toLocaleString()}</p>
          <h3>{t('citation')}</h3><pre tabIndex={0}>{citation}</pre><button type="button" onClick={() => { void props.copy(citation).then(() => { setCopied({ text: citation, success: true }) }, () => { setCopied({ text: citation, success: false }) }) }}>{t('copy')}</button>
          {copied?.text === citation ? <p role="status">{t(copied.success ? 'copied' : 'copyFailed')}</p> : null}</>}
      </section>
    </div></div>
  </main>
}
/**
 * Open the knowledge directory from wide or collapsed application navigation.
 * @param props - sidebar width, localized label, and navigation callback.
 * @returns a labelled keyboard-focusable navigation control.
 */
export function KnowledgeNavigation({ wide, t, open }: PropsRuntime<'sidebar.session.action'> & PropsLocale<'workKnowledge'> & { open: () => void }) {
  const button = <button type="button" className={css.nav} aria-label={t('title')} onClick={open}><IconSearchOutline16 size={16} /><span hidden={!wide}>{t('title')}</span></button>
  return wide ? button : <Tooltip label={t('title')}>{button}</Tooltip>
}
