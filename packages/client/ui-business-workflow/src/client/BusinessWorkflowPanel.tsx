import { useState } from 'react'
import { DisclosureRow, StateDot, type StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { NS, type BusinessWorkflowKey } from './locales.ts'
import type { BusinessWorkflowNodeStatus } from './workflow-definition.ts'
import css from './BusinessWorkflowPanel.module.css'

/** Complete keyed Chat renderer props. */
export type BusinessWorkflowPanelProps =
  PropsRuntime<'conversation.chat.node', 'business-workflow'>
  & PropsLocale<typeof NS>

const STATUS_KEYS = {
  clarifying: 'status.clarifying',
  composed: 'status.composed',
  verified: 'status.verified',
} as const satisfies Record<BusinessWorkflowNodeStatus, BusinessWorkflowKey>

function dotState(status: BusinessWorkflowNodeStatus): StateDotState {
  switch (status) {
    case 'clarifying': return 'ongoing'
    case 'composed': return 'warning'
    case 'verified': return 'done'
  }
}

/** The keyed Chat renderer for one durable business-workflow record. */
export function BusinessWorkflowPanel({ node, t }: BusinessWorkflowPanelProps) {
  const [open, setOpen] = useState(false)
  const workflow = node.data
  const expandable = workflow.gaps.length > 0
    || workflow.issues.length > 0
    || workflow.verification !== undefined
  const verification = workflow.verification
  return (
    <div className={css.root}>
      <DisclosureRow
        icon={<StateDot state={dotState(workflow.status)} />}
        title={t('node.title')}
        open={open}
        expandable={expandable}
        onToggle={() => { setOpen(current => !current) }}
        className={css.row}
        titleClassName={css.title}
        collapsedContent={(
          <>
            <span className={css.summary} title={workflow.summary}>{workflow.summary}</span>
            <span className={css.status}>{t(STATUS_KEYS[workflow.status])}</span>
            {workflow.stepCount > 0
              ? <span className={css.steps}>{t('section.steps', { count: workflow.stepCount })}</span>
              : null}
          </>
        )}
      >
        <dl className={css.body}>
          <div className={css.meta}>
            <dt className={css.metaLabel}>{t('node.revision', { revision: workflow.revision })}</dt>
            <dd className={css.metaValue}>{workflow.workflowId}</dd>
          </div>
          {workflow.gaps.length > 0
            ? (
              <section className={css.section}>
                <dt className={css.sectionLabel}>{t('section.gaps')}</dt>
                {workflow.gaps.map((gap, index) => (
                  <dd className={css.entry} key={`${gap.topic}:${index}`}>
                    <span className={css.entryTag}>{gap.topic}</span>
                    <span className={css.entryText}>{gap.question}</span>
                  </dd>
                ))}
              </section>
            )
            : null}
          {workflow.issues.length > 0
            ? (
              <section className={css.section}>
                <dt className={css.sectionLabel}>{t('section.issues')}</dt>
                {workflow.issues.map((issue, index) => (
                  <dd className={css.entry} key={`${issue.code}:${issue.ref ?? ''}:${index}`}>
                    <span className={css.entryTag}>{issue.code}</span>
                    <span className={css.entryText} title={issue.remedy}>{issue.message}</span>
                  </dd>
                ))}
              </section>
            )
            : null}
          {verification !== undefined
            ? (
              <section className={css.section}>
                <dt className={css.sectionLabel}>{t('section.verification')}</dt>
                <dd className={css.entry}>
                  <span className={css.entryTag}>{verification.passed ? 'pass' : 'fail'}</span>
                  <span className={css.entryText}>
                    {verification.dryRun
                      ? t(verification.passed
                        ? 'verification.passed'
                        : 'verification.failed', { count: verification.caseCount })
                      : t('verification.skipped')}
                  </span>
                </dd>
                {verification.cases.map((caseResult, index) => (
                  <dd className={css.entry} key={`${caseResult.name}:${index}`}>
                    <span className={css.entryTag}>{t(`case.${caseResult.status}`)}</span>
                    <span
                      className={css.entryText}
                      title={caseResult.detail ?? undefined}
                    >
                      {caseResult.name}
                    </span>
                  </dd>
                ))}
              </section>
            )
            : null}
        </dl>
      </DisclosureRow>
    </div>
  )
}
