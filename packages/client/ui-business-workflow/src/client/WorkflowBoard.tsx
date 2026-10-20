/** Selectable workflow graph with saved editor positions and per-execution state labels. */
import { useId, useRef, useState } from 'react'
import type { ToolBusinessWorkflowBoardStep } from '@deepseek-ai/dsh-tool-business-workflow/types'
import {
  BOARD_GAP_X,
  BOARD_NODE_HEIGHT,
  BOARD_NODE_WIDTH,
  WORKBENCH_NODE_SIZE,
  layoutBoard,
  type BoardLayoutNode,
  type BoardNodeStatus,
} from './board-layout.ts'
import css from './WorkflowBoard.module.css'

/** Board inputs: the accepted composition's projection plus derived per-node standing. */
export interface WorkflowBoardProps {
  readonly steps: readonly ToolBusinessWorkflowBoardStep[]
  readonly statuses: ReadonlyMap<string, BoardNodeStatus>
  readonly selectedId: string
  readonly onSelect: (id: string) => void
  readonly label: string
  readonly statusLabels: Record<BoardNodeStatus, string>
  /** Saved editor positions; omitted for transcript cards. */
  readonly positions?: Readonly<Record<string, { x: number; y: number }>>
  /** Authoritative execution status labels for a selected run. */
  readonly nodeLabels?: Readonly<Record<string, string>>
  /** Selected execution's state, independent of legacy verification colors. */
  readonly executionStatuses?: Readonly<Record<string, string>>
  /** Persist one drag or keyboard move in editor metadata. */
  /** Expanded cards display node kind and ordering in the workbench. */
  readonly cards?: Readonly<Record<string, { kind: string; index: number }>>
  readonly onMove?: (id: string, position: { x: number; y: number }) => void
}

/** Cubic edge path from the source's right edge midpoint to the target's left edge midpoint. */
function edgePath(x1: number, y1: number, x2: number, y2: number): string {
  const dx = Math.max(BOARD_GAP_X / 2, (x2 - x1) / 2)
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`
}

/** Fit the display title to the node box; SVG text has no ellipsis, so cut by units. */
function fitTitle(title: string, max = 18): string {
  return title.length <= max ? title : `${title.slice(0, max - 1)}…`
}

/** One placed, keyboard-selectable node with its displayed status. */
function BoardNode({
  node,
  status,
  selected,
  onSelect,
  statusLabel,
  onMove,
  onDrag,
  executionStatus,
  card,
  size,
}: {
  node: BoardLayoutNode
  status: BoardNodeStatus
  selected: boolean
  onSelect: (id: string) => void
  statusLabel: string
  onMove?: WorkflowBoardProps['onMove']
  onDrag?: (id: string, x: number, y: number, end: boolean) => void
  executionStatus?: string | undefined
  card: { kind: string; index: number } | undefined
  size: { width: number; height: number }
}) {
  const drag = useRef<{ x: number; y: number; scaleX: number; scaleY: number }>()
  const centerY = node.y + size.height / 2
  return (
    <g
      className={css.node}
      data-status={executionStatus ?? status}
      data-selected={selected}
      data-expanded={card !== undefined}
      role="button"
      tabIndex={0}
      aria-label={`${node.title} (${node.id}), ${statusLabel}`}
      aria-pressed={selected}
      onClick={() => {
        onSelect(node.id)
      }}
      onPointerDown={
        onMove === undefined
          ? undefined
          : (event) => {
            const matrix = event.currentTarget.ownerSVGElement?.getScreenCTM()
            if (matrix === null || matrix === undefined) return
            drag.current = {
              x: event.clientX - node.x * matrix.a,
              y: event.clientY - node.y * matrix.d,
              scaleX: matrix.a,
              scaleY: matrix.d,
            }
            event.currentTarget.setPointerCapture(event.pointerId)
          }
      }
      onPointerMove={(event) => {
        const start = drag.current
        if (start !== undefined)
          onDrag?.(
            node.id,
            Math.max(0, (event.clientX - start.x) / start.scaleX),
            Math.max(0, (event.clientY - start.y) / start.scaleY),
            false,
          )
      }}
      onPointerUp={(event) => {
        const start = drag.current
        if (start !== undefined)
          onDrag?.(
            node.id,
            Math.max(0, (event.clientX - start.x) / start.scaleX),
            Math.max(0, (event.clientY - start.y) / start.scaleY),
            true,
          )
        drag.current = undefined
      }}
      onPointerCancel={() => {
        drag.current = undefined
      }}
      onKeyDown={(event) => {
        if (onMove !== undefined && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
          event.preventDefault()
          onMove(node.id, {
            x: Math.max(0, node.x + (event.key === 'ArrowLeft' ? -24 : event.key === 'ArrowRight' ? 24 : 0)),
            y: Math.max(0, node.y + (event.key === 'ArrowUp' ? -24 : event.key === 'ArrowDown' ? 24 : 0)),
          })
        }
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onSelect(node.id)
        }
      }}
    >
      <rect className={css.nodeBox} x={node.x} y={node.y} width={size.width} height={size.height} rx={10} />
      {card !== undefined ? <text className={css.nodeKind} x={node.x + 16} y={node.y + 23}>{String(card.index + 1).padStart(2, '0')} · {card.kind}</text> : null}
      <circle className={css.nodeDot} data-status={executionStatus ?? status}
        cx={card === undefined ? node.x + 14 : node.x + size.width - 18}
        cy={card === undefined ? centerY : node.y + 20} r={4} />
      <text className={css.nodeTitle} x={node.x + (card === undefined ? 26 : 16)} y={node.y + (card === undefined ? 20 : 47)}>
        {fitTitle(node.title, card === undefined ? 18 : 14)}
      </text>
      <text className={css.nodeId} x={node.x + (card === undefined ? 26 : 16)} y={node.y + (card === undefined ? 36 : 68)}>
        {card === undefined && executionStatus === undefined ? node.id : fitTitle(statusLabel)}
      </text>
      <title>{`${node.title} (${node.id})`}</title>
    </g>
  )
}

/**
 * Render the board. The canvas sizes itself from the layout; the surrounding
 * scrollport (CSS max-height) handles tall boards.
 * @param props - steps, statuses, selection, and translated accessible labels.
 * @returns the SVG canvas.
 */
export function WorkflowBoard({
  steps,
  statuses,
  selectedId,
  onSelect,
  label,
  statusLabels,
  positions,
  nodeLabels,
  executionStatuses,
  onMove,
  cards,
}: WorkflowBoardProps) {
  const markerId = useId()
  const [dragged, setDragged] = useState<{ id: string; x: number; y: number }>()
  const size = cards === undefined ? { width: BOARD_NODE_WIDTH, height: BOARD_NODE_HEIGHT } : WORKBENCH_NODE_SIZE
  const baseLayout = layoutBoard(steps, size)
  const nodes = baseLayout.nodes.map(node => ({
    ...node,
    ...(positions?.[node.id] ?? {}),
    ...(dragged?.id === node.id ? { x: dragged.x, y: dragged.y } : {}),
  }))
  const layout = {
    ...baseLayout,
    nodes,
    width: Math.max(baseLayout.width, ...nodes.map(node => node.x + size.width + 8)),
    height: Math.max(baseLayout.height, ...nodes.map(node => node.y + size.height + 8)),
  }
  const positionById = new Map(layout.nodes.map(node => [node.id, node]))
  return (
    <svg
      className={css.canvas}
      width={layout.width}
      height={layout.height}
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      role="group"
      aria-label={label}
    >
      <defs>
        <marker
          id={markerId}
          viewBox="0 0 8 8"
          refX={7}
          refY={4}
          markerWidth={7}
          markerHeight={7}
          orient="auto-start-reverse"
        >
          <path className={css.arrowHead} d="M 0 0.5 L 7.5 4 L 0 7.5 Z" />
        </marker>
      </defs>
      {layout.edges.map((edge) => {
        const from = positionById.get(edge.from)
        const to = positionById.get(edge.to)
        if (from === undefined || to === undefined) return null
        return (
          <path
            key={`${edge.from}->${edge.to}`}
            className={css.edge}
            d={edgePath(from.x + size.width, from.y + size.height / 2, to.x, to.y + size.height / 2)}
            markerEnd={`url(#${markerId})`}
          />
        )
      })}
      {layout.nodes.map(node => (
        <BoardNode
          key={node.id}
          node={node}
          card={cards?.[node.id]}
          size={size}
          status={statuses.get(node.id) ?? 'pending'}
          executionStatus={executionStatuses?.[node.id]}
          statusLabel={nodeLabels?.[node.id] ?? statusLabels[statuses.get(node.id) ?? 'pending']}
          selected={selectedId === node.id}
          onSelect={onSelect}
          onMove={onMove}
          onDrag={(id, x, y, end) => {
            if (end) {
              setDragged(undefined)
              onMove?.(id, { x, y })
            } else setDragged({ id, x, y })
          }}
        />
      ))}
    </svg>
  )
}
