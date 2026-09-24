/**
 * Step-board layout and node-status derivation. The layout is a left-to-right
 * longest-path layering over the composition's explicit dependencies (the
 * runtime already rejected cycles and unknown dependencies; the guards here
 * keep a malformed log from hanging the renderer); node statuses aggregate the
 * latest verification's dry-run trace per step.
 */
import type { CaseResult } from '@deepseek-ai/dsh-business-workflow/types'
import type { ToolBusinessWorkflowBoardStep } from '@deepseek-ai/dsh-tool-business-workflow/types'

/** Node box width in SVG units. */
export const BOARD_NODE_WIDTH = 168
/** Node box height in SVG units. */
export const BOARD_NODE_HEIGHT = 48
/** Horizontal distance between two adjacent layers' boxes. */
export const BOARD_GAP_X = 56
/** Vertical distance between two boxes in one layer. */
export const BOARD_GAP_Y = 14
/** Canvas inset on every side. */
export const BOARD_PADDING = 8

/** One placed node. */
export interface BoardLayoutNode {
  readonly id: string
  readonly title: string
  /** Zero-based dependency depth (roots are layer 0). */
  readonly layer: number
  readonly x: number
  readonly y: number
}

/** One dependency edge (`from` must complete before `to` starts). */
export interface BoardLayoutEdge {
  readonly from: string
  readonly to: string
}

/** The full board geometry: placed nodes, edges, and the canvas size. */
export interface BoardLayout {
  readonly nodes: readonly BoardLayoutNode[]
  readonly edges: readonly BoardLayoutEdge[]
  readonly width: number
  readonly height: number
}

/**
 * Lay out the accepted composition. Nodes keep the composition's declaration
 * order inside their layer, so the board is stable across reloads.
 * @param steps - the accepted composition's board projection.
 * @returns placed nodes, dependency edges, and the canvas dimensions.
 */
export function layoutBoard(steps: readonly ToolBusinessWorkflowBoardStep[]): BoardLayout {
  const byId = new Map(steps.map(step => [step.id, step]))
  const layers = new Map<string, number>()
  const visiting = new Set<string>()
  const layerOf = (id: string): number => {
    const known = layers.get(id)
    if (known !== undefined) return known
    const step = byId.get(id)
    // Unknown id (only reachable from a forged log) and the cycle guard both
    // collapse to a root placement; the runtime's own checks reject both.
    if (step === undefined || visiting.has(id)) return 0
    visiting.add(id)
    let layer = 0
    for (const dependency of step.dependsOn) {
      if (!byId.has(dependency)) continue
      layer = Math.max(layer, layerOf(dependency) + 1)
    }
    visiting.delete(id)
    layers.set(id, layer)
    return layer
  }
  const layerSizes = new Map<number, number>()
  const nodes: BoardLayoutNode[] = steps.map((step) => {
    const layer = layerOf(step.id)
    const index = layerSizes.get(layer) ?? 0
    layerSizes.set(layer, index + 1)
    return {
      id: step.id,
      title: step.title,
      layer,
      x: BOARD_PADDING + layer * (BOARD_NODE_WIDTH + BOARD_GAP_X),
      y: BOARD_PADDING + index * (BOARD_NODE_HEIGHT + BOARD_GAP_Y),
    }
  })
  const edges: BoardLayoutEdge[] = []
  for (const step of steps) {
    for (const dependency of step.dependsOn) {
      if (byId.has(dependency)) edges.push({ from: dependency, to: step.id })
    }
  }
  const maxLayer = nodes.reduce((depth, node) => Math.max(depth, node.layer), 0)
  const tallest = [...layerSizes.values()].reduce((size, count) => Math.max(size, count), 0)
  return {
    nodes,
    edges,
    width: nodes.length === 0
      ? 0
      : BOARD_PADDING * 2 + (maxLayer + 1) * BOARD_NODE_WIDTH + maxLayer * BOARD_GAP_X,
    height: nodes.length === 0
      ? 0
      : BOARD_PADDING * 2 + tallest * BOARD_NODE_HEIGHT + (tallest - 1) * BOARD_GAP_Y,
  }
}

/** One node's dry-run standing on the board. */
export type BoardNodeStatus = 'pending' | 'completed' | 'failed'

/**
 * Aggregate the latest verification's per-step trace: a step failed in any
 * case reads failed, otherwise completed in any case reads completed, and
 * everything else stays pending (including "no verification yet").
 * @param steps - the board's nodes.
 * @param cases - the latest verification's case results, when one ran.
 * @returns per-step-id status map covering every node.
 */
export function deriveNodeStatuses(
  steps: readonly ToolBusinessWorkflowBoardStep[],
  cases: readonly CaseResult[] | undefined,
): ReadonlyMap<string, BoardNodeStatus> {
  const statuses = new Map<string, BoardNodeStatus>()
  for (const step of steps) statuses.set(step.id, 'pending')
  if (cases === undefined) return statuses
  for (const caseResult of cases) {
    for (const trace of caseResult.steps ?? []) {
      const current = statuses.get(trace.stepId)
      if (current === undefined) continue
      if (trace.status === 'failed') statuses.set(trace.stepId, 'failed')
      else if (current === 'pending') statuses.set(trace.stepId, 'completed')
    }
  }
  return statuses
}
