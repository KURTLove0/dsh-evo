import { useState } from 'react'
import { DisclosureRow, StateDot, type StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { NS, type BusinessWorkflowKey } from './locales.ts'
import { WorkflowDetails } from './WorkflowDetails.tsx'
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
    || workflow.steps.length > 0
    || workflow.verification !== undefined
  return (
    <div className={css.root} data-business-workflow-id={workflow.workflowId}>
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
        <WorkflowDetails workflow={workflow} t={t} />
      </DisclosureRow>
    </div>
  )
}
