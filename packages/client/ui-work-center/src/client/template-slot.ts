/** Optional task-template and selected-execution controls contributed by a separately mounted UI plugin. */
import type { TaskBrief, WorkDetail } from '@deepseek-ai/dsh-api-remotes/client'
/** Plain task fields and a draft-only application callback. */
export interface IntakeTemplateOwner {
  brief: TaskBrief
  disabled: boolean
  load: (brief: TaskBrief) => void
}
/** Selected execution and the owner's mutation availability. */
export interface ExecutionControlOwner {
  detail: WorkDetail
  disabled: boolean
}
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /**
     * Add task-template controls to intake. Registrants receive the current brief, a disabled flag,
     * and a draft-only load callback that invalidates preflight. Contributions coexist; absence leaves intake unchanged.
     */
    'work-center.intake.templates': { kind: 'list'; scope: 'root'; owner: IntakeTemplateOwner }
    /** Fixed-target trigger preparation for the selected original execution. */
    'work-center.delivery.triggers': { kind: 'list'; scope: 'root'; owner: ExecutionControlOwner }
    /**
     * Add file registration beside delivery. Registrants receive the selected execution and committed reviews
     * plus the owner's disabled flag. Contributions coexist; absence leaves delivery inspection unchanged.
     */
    'work-center.delivery.artifacts': { kind: 'list'; scope: 'root'; owner: ExecutionControlOwner }
  }
}
