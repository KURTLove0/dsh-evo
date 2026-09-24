/**
 * Step board: the accepted composition rendered as a left-to-right node-edge
 * canvas (Archon-style DAG, theme-native colors). Nodes carry the latest
 * verification's dry-run standing as a status dot; edges are cubic curves with
 * arrowheads. Pure SVG over the layout module's geometry — no drag/zoom, the
 * board is a read-only projection of the durable record.
 */
import { useId } from 'react'
import type { ToolBusinessWorkflowBoardStep } from '@deepseek-ai/dsh-tool-business-workflow/types'
import {
  BOARD_GAP_X, BOARD_NODE_HEIGHT, BOARD_NODE_WIDTH, layoutBoard,
  type BoardLayoutNode, type BoardNodeStatus,
} from './board-layout.ts'
import css from './WorkflowBoard.module.css'

/** Board inputs: the accepted composition's projection plus derived per-node standing. */
export interface WorkflowBoardProps {
  readonly steps: readonly ToolBusinessWorkflowBoardStep[]
  readonly statuses: ReadonlyMap<string, BoardNodeStatus>
}

/** Cubic edge path from the source's right edge midpoint to the target's left edge midpoint. */
function edgePath(x1: number, y1: number, x2: number, y2: number): string {
  const dx = Math.max(BOARD_GAP_X / 2, (x2 - x1) / 2)
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`
}

/** Fit the display title to the node box; SVG text has no ellipsis, so cut by units. */
function fitTitle(title: string): string {
  const max = 18
  return title.length <= max ? title : `${title.slice(0, max - 1)}…`
}

/** One placed node: status dot, title, and step id. */
function BoardNode({ node, status }: { node: BoardLayoutNode; status: BoardNodeStatus }) {
  const centerY = node.y + BOARD_NODE_HEIGHT / 2
  return (
    <g className={css.node} data-status={status}>
      <rect
        className={css.nodeBox}
        x={node.x}
        y={node.y}
        width={BOARD_NODE_WIDTH}
        height={BOARD_NODE_HEIGHT}
        rx={10}
      />
      <circle className={css.nodeDot} data-status={status} cx={node.x + 14} cy={centerY} r={4} />
      <text className={css.nodeTitle} x={node.x + 26} y={node.y + 20}>{fitTitle(node.title)}</text>
      <text className={css.nodeId} x={node.x + 26} y={node.y + 36}>{node.id}</text>
      <title>{`${node.title} (${node.id})`}</title>
    </g>
  )
}

/**
 * Render the board. The canvas sizes itself from the layout; the surrounding
 * scrollport (CSS max-height) handles tall boards.
 * @param props - steps and per-node statuses.
 * @returns the SVG canvas.
 */
export function WorkflowBoard({ steps, statuses }: WorkflowBoardProps) {
  const markerId = useId()
  const layout = layoutBoard(steps)
  const positionById = new Map(layout.nodes.map(node => [node.id, node]))
  return (
    <svg
      className={css.canvas}
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      role="img"
      aria-label="workflow steps"
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
            d={edgePath(
              from.x + BOARD_NODE_WIDTH,
              from.y + BOARD_NODE_HEIGHT / 2,
              to.x,
              to.y + BOARD_NODE_HEIGHT / 2,
            )}
            markerEnd={`url(#${markerId})`}
          />
        )
      })}
      {layout.nodes.map(node => (
        <BoardNode key={node.id} node={node} status={statuses.get(node.id) ?? 'pending'} />
      ))}
    </svg>
  )
}
