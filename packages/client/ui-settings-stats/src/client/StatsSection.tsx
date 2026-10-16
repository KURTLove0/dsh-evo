/**
 * Statistics settings section: whole-host usage figures aggregated from one
 * `session.list` call — three read-only metric cards (sessions, token usage,
 * cost). Session and started counts come from the listing rows; token usage
 * sums each row's `tokenUsage` projection baseline, the same durable
 * four-bucket accounting the conversation stats strip shows per session. The
 * cost card is an explicit no-fact placeholder: the host records no pricing,
 * so no number is invented. The page never writes; session listing carries
 * no push event, so it loads on mount and refreshes on the user's gesture.
 */

import type { ReactNode } from 'react'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { TokenUsageProjection } from '@deepseek-ai/dsh-token-meter/client'
import type { StatsSettingsStore } from './store.ts'
import type { en } from './locales.ts'
import styles from './StatsSection.module.css'

/** The no-fact dash: an em dash for the one metric the host cannot answer. */
const NO_FACT = '—'

/** Injected dependencies of {@link StatsSection} (slot `inject`). */
export interface StatsSectionInjected {
  /** The page store (loaded on mount, refreshed on the user's gesture). */
  controller: StatsSettingsStore
  hooks: {
    /** Page snapshot bound by the UI renderer as useSnapshot. */
    snapshot: StatsSettingsStore['store']
  }
  /** Section copy. */
  t: (key: keyof typeof en) => string
}

/**
 * Props delivered by the slot outlet: the inject face spread flat (the
 * renderer erases the share boundary at the render call).
 */
export type StatsSectionProps = Partial<InjectFace<StatsSectionInjected>>

type StatsSectionFace = InjectFace<StatsSectionInjected>

/**
 * Compact token count: 517 / 12.2K / 517K / 1.2M (one decimal under three
 * digits) — the conversation stats strip's display vocabulary.
 * @param n - token count.
 * @returns display string.
 */
export function formatTokens(n: number): string {
  const scaled = (v: number): string =>
    v >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10)
  if (n < 1_000) return String(n)
  if (n < 1_000_000) return `${scaled(n / 1_000)}K`
  return `${scaled(n / 1_000_000)}M`
}

/**
 * Sum the three disjoint prompt-side billing buckets.
 * @param usage - the aggregated token-usage value.
 * @returns billed input tokens.
 */
export function billedInputTokens(usage: TokenUsageProjection): number {
  return usage.uncachedInputTokens + usage.cacheReadTokens + usage.cacheWriteTokens
}

/** Replace the one count placeholder in the started-conversations caption. */
export function startedCopy(template: string, count: number): string {
  return template.replace('{count}', () => String(count))
}

/** Replace the three bucket placeholders in the token detail caption. */
export function tokensDetailCopy(template: string, input: string, output: string, cacheRead: string): string {
  return template.replace('{input}', () => input).replace('{output}', () => output).replace('{cacheRead}', () => cacheRead)
}

/**
 * Render the Statistics section content column.
 * @param props - slot-delivered injected dependencies.
 * @returns the section, or null while the shell has not injected yet.
 */
export function StatsSection(props: StatsSectionProps): ReactNode {
  const { controller, useSnapshot, t } = props
  if (controller === undefined || useSnapshot === undefined || t === undefined) return null
  return <Loaded injected={{ controller, useSnapshot, t }} />
}

function Loaded({ injected }: { injected: StatsSectionFace }): ReactNode {
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
      {state.status === 'ready'
        ? (
          <>
            <div className={styles['cards']}>
              <div className={styles['card']}>
                <span className={styles['cardLabel']}>{t('sessionsCard')}</span>
                <span className={styles['cardValue']}>{String(state.sessions)}</span>
                <span className={styles['cardDetail']}>{startedCopy(t('sessionsStarted'), state.started)}</span>
              </div>
              <div className={styles['card']}>
                <span className={styles['cardLabel']}>{t('tokensCard')}</span>
                <span className={styles['cardValue']}>{formatTokens(billedInputTokens(state.usage) + state.usage.outputTokens)}</span>
                <span className={styles['cardDetail']}>{tokensDetailCopy(
                  t('tokensDetail'),
                  formatTokens(billedInputTokens(state.usage)),
                  formatTokens(state.usage.outputTokens),
                  formatTokens(state.usage.cacheReadTokens),
                )}</span>
              </div>
              <div className={styles['card']}>
                <span className={styles['cardLabel']}>{t('costCard')}</span>
                <span className={styles['cardValue']}>{NO_FACT}</span>
                <span className={styles['cardDetail']}>{t('costUnavailable')}</span>
              </div>
            </div>
            <button type="button" className={styles['secondaryButton']} onClick={() => { void controller.load() }}>
              {t('refresh')}
            </button>
          </>
        )
        : null}
    </div>
  )
}
