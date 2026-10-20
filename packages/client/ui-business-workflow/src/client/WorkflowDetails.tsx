import { useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { deriveNodeStatuses, type BoardNodeStatus } from './board-layout.ts'
import { NS, type BusinessWorkflowKey } from './locales.ts'
import { WorkflowBoard } from './WorkflowBoard.tsx'
import type { BusinessWorkflowChatData } from './workflow-definition.ts'
import css from './BusinessWorkflowPanel.module.css'

type DetailProps = PropsLocale<typeof NS>

const STEP_STATUS_KEYS = { pending: 'step.pending', completed: 'step.completed', failed: 'step.failed' } as const satisfies Record<BoardNodeStatus, BusinessWorkflowKey>

/**
 * Shared read-only graph, execution context, and validation report.
 * @param props - selected durable record and translator.
 * @returns graph, selected node context, and verification results.
 */
export function WorkflowDetails({ workflow, t }: { workflow: BusinessWorkflowChatData; t: DetailProps['t'] }) {
  const [selectedStepId, setSelectedStepId] = useState<string | undefined>()
  const selectedStep = workflow.steps.find(step => step.id === selectedStepId) ?? workflow.steps[0]
  const statuses = deriveNodeStatuses(workflow.steps, workflow.verification?.cases)
  const stepTraces = selectedStep === undefined ? [] : (workflow.verification?.cases ?? []).flatMap(caseResult =>
    (caseResult.steps ?? [])
      .filter(trace => trace.stepId === selectedStep.id)
      .map(trace => ({ caseName: caseResult.name, trace })))
  const verification = workflow.verification
  return (
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
      {workflow.steps.length > 0
        ? (
          <section className={css.section}>
            <dt className={css.sectionLabel}>{t('section.board')}</dt>
            <dd className={css.board}>
              <WorkflowBoard
                steps={workflow.steps}
                statuses={statuses}
                selectedId={selectedStep?.id ?? ''}
                onSelect={setSelectedStepId}
                label={t('section.board')}
                statusLabels={{
                  pending: t('step.pending'),
                  completed: t('step.completed'),
                  failed: t('step.failed'),
                }}
              />
            </dd>
            {selectedStep !== undefined
              ? (
                <dd className={css.stepDetail} data-business-workflow-step-detail>
                  <div className={css.stepHeading}>
                    <strong>{selectedStep.title}</strong>
                    <span>{t(STEP_STATUS_KEYS[statuses.get(selectedStep.id) ?? 'pending'])}</span>
                  </div>
                  <div className={css.stepId}>{selectedStep.id}</div>
                  {selectedStep.instruction === undefined
                    ? <p className={css.stepEmpty}>{t('step.backgroundUnavailable')}</p>
                    : <p className={css.stepInstruction}>{selectedStep.instruction}</p>}
                  {selectedStep.inputs !== undefined && selectedStep.inputs.length > 0
                    ? (
                      <div className={css.stepGroup}>
                        <strong>{t('step.inputs')}</strong>
                        <ul>
                          {selectedStep.inputs.map(input => (
                            <li key={input.name}>
                              <span>{input.name}</span>
                              <span>← {input.source.kind === 'requirement'
                                ? t('step.requirementSource', { name: input.source.field })
                                : t('step.stepSource', { name: input.source.step })}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )
                    : null}
                  {selectedStep.objectives !== undefined && selectedStep.objectives.length > 0
                    ? <p className={css.stepObjectives}>{t('step.objectives')}: {selectedStep.objectives.join('、')}</p>
                    : null}
                  {stepTraces.length > 0
                    ? (
                      <div className={css.stepGroup}>
                        <strong>{t('step.traces')}</strong>
                        <ul>
                          {stepTraces.map(({ caseName, trace }, index) => (
                            <li key={`${caseName}:${index}`}>
                              <span>{caseName} · {t(STEP_STATUS_KEYS[trace.status])}</span>
                              <span className={css.traceDetail}>{trace.detail}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )
                    : null}
                </dd>
              )
              : null}
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
  )
}
