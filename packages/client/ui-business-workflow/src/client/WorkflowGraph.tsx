/** Workbench canvas viewport with shared design and run inspection controls. */
import { useRef, useState, type CSSProperties } from 'react'
import { IconFullscreenOutline16, IconRefreshOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkflowDefinition, WorkflowRun } from '@deepseek-ai/dsh-business-workflow/workbench-types'
import type { WorkbenchPageProps } from './WorkbenchPage.tsx'
import { WorkflowBoard, type WorkflowBoardProps } from './WorkflowBoard.tsx'
import { BOARD_PADDING, WORKBENCH_NODE_SIZE, layoutBoard } from './board-layout.ts'
import css from './BusinessWorkflowPage.module.css'

/**
 * Display the selected definition with a viewport independent of saved node positions.
 * @param props - definition, selection, optional editor operations, execution, and copy.
 * @returns graph, zoom controls, and keyboard guidance.
 */
export function WorkflowGraph({ definition, statuses, selectedId, onSelect, editable, onMove, onLayout, run, t }: {
  definition: WorkflowDefinition
  statuses: WorkflowBoardProps['statuses']
  selectedId: string
  onSelect: WorkflowBoardProps['onSelect']
  editable?: boolean
  onMove?: WorkflowBoardProps['onMove']
  onLayout?: () => void
  run?: WorkflowRun
  t: WorkbenchPageProps['t']
}) {
  const [zoom, setZoom] = useState(1)
  const viewport = useRef<HTMLDivElement>(null)
  const fit = (): void => {
    const layout = layoutBoard(definition.nodes, WORKBENCH_NODE_SIZE)
    const width = Math.max(layout.width, ...layout.nodes.map(node =>
      (definition.positions[node.id]?.x ?? node.x) + WORKBENCH_NODE_SIZE.width + BOARD_PADDING,
    ))
    const height = Math.max(layout.height, ...layout.nodes.map(node =>
      (definition.positions[node.id]?.y ?? node.y) + WORKBENCH_NODE_SIZE.height + BOARD_PADDING,
    ))
    const availableWidth = viewport.current?.clientWidth || width + 48
    const availableHeight = viewport.current?.clientHeight || height + 48
    setZoom(Math.min(1.5, Math.max(0.25, Math.min((availableWidth - 48) / Math.max(width, 1),
      (availableHeight - 48) / Math.max(height, 1)))))
    if (viewport.current !== null) {
      viewport.current.scrollTop = 0
      viewport.current.scrollLeft = 0
    }
  }
  return <section className={css.graph} aria-label={t('wb.graph')}>
    <div className={css.graphHeading}>
      <span className={css.eyebrow}>{t('wb.graph')} <span className={css.count}>{definition.nodes.length}</span></span>
      <div className={css.graphControls}>
        <button type="button" aria-label={t('wb.zoomOut')} disabled={zoom <= 0.25} onClick={() => { setZoom(value => Math.max(0.25, value - 0.25)) }}>−</button>
        <output aria-live="polite" aria-label={t('wb.zoomLevel')}>{Math.round(zoom * 100)}%</output>
        <button type="button" aria-label={t('wb.zoomIn')} disabled={zoom >= 2} onClick={() => { setZoom(value => Math.min(2, value + 0.25)) }}>+</button>
        <button type="button" aria-label={t('wb.fit')} title={t('wb.fit')} onClick={fit}><span aria-hidden="true"><IconFullscreenOutline16 /></span></button>
        {onLayout ? <button type="button" disabled={!editable} onClick={() => { onLayout(); setZoom(1) }}><span aria-hidden="true"><IconRefreshOutline16 /></span>{t('wb.layout')}</button> : null}
      </div>
    </div>
    <div className={css.graphScroll} ref={viewport} tabIndex={0} aria-label={t('wb.canvasViewport')}>
      {definition.nodes.length === 0 ? <div className={css.emptyCanvas}><h3>{t('wb.buildFlow')}</h3><p>{t('wb.noNodes')}</p></div> : <div className={css.scaledGraph} style={{ '--workflow-zoom': zoom } as CSSProperties}>
        <WorkflowBoard
          steps={definition.nodes}
          statuses={statuses}
          selectedId={selectedId}
          onSelect={onSelect}
          label={t('wb.graph')}
          positions={definition.positions}
          cards={Object.fromEntries(definition.nodes.map((node, index) => [node.id, { kind: t(node.kind === 'agent' ? 'wb.agentKind' : 'wb.approvalKind'), index }]))}
          {...(editable && onMove ? { onMove } : {})}
          {...(run ? {
            executionStatuses: Object.fromEntries(run.attempts.map(attempt => [attempt.nodeId, attempt.status])),
            nodeLabels: Object.fromEntries(run.attempts.map(attempt => [attempt.nodeId, t(`wb.${attempt.status}`)])),
          } : {})}
          statusLabels={{ pending: t('wb.pending'), completed: t('wb.succeeded'), failed: t('wb.failed') }}
        />
      </div>}
    </div>
    <p className={css.graphHint}>{t(editable ? 'wb.canvasHint' : 'wb.inspectHint')}</p>
  </section>
}
