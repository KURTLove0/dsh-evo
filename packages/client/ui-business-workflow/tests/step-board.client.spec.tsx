// @vitest-environment jsdom
/**
 * Step board: the layering geometry (chains, fan-out, diamonds, defensive
 * guards), the dry-run status aggregation, and the SVG canvas's rendered
 * nodes, edges, and status markers.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import type { CaseResult } from '@deepseek-ai/dsh-business-workflow/types'
import type { ToolBusinessWorkflowBoardStep } from '@deepseek-ai/dsh-tool-business-workflow/types'
import {
  BOARD_GAP_X, BOARD_GAP_Y, BOARD_NODE_HEIGHT, BOARD_NODE_WIDTH, BOARD_PADDING,
  deriveNodeStatuses, layoutBoard,
} from '../src/client/board-layout.ts'
import { WorkflowBoard } from '../src/client/WorkflowBoard.tsx'

afterEach(() => { cleanup() })

/** One step fixture; dependencies arrive as the only varying member. */
function step(id: string, dependsOn: readonly string[] = [], title = `Step ${id}`): ToolBusinessWorkflowBoardStep {
  return { id, title, dependsOn }
}

describe('layoutBoard', () => {
  it('lays out an empty board as zero geometry', () => {
    expect(layoutBoard([])).toEqual({ nodes: [], edges: [], width: 0, height: 0 })
  })

  it('layers a chain left to right', () => {
    const layout = layoutBoard([step('a'), step('b', ['a']), step('c', ['b'])])
    expect(layout.nodes.map(node => [node.id, node.layer])).toEqual([['a', 0], ['b', 1], ['c', 2]])
    expect(layout.nodes[0]).toMatchObject({ x: BOARD_PADDING, y: BOARD_PADDING })
    expect(layout.nodes[1]).toMatchObject({ x: BOARD_PADDING + BOARD_NODE_WIDTH + BOARD_GAP_X, y: BOARD_PADDING })
    expect(layout.edges).toEqual([{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }])
    expect(layout.width).toBe(BOARD_PADDING * 2 + 3 * BOARD_NODE_WIDTH + 2 * BOARD_GAP_X)
    expect(layout.height).toBe(BOARD_PADDING * 2 + BOARD_NODE_HEIGHT)
  })

  it('stacks fan-out siblings in declaration order inside one layer', () => {
    const layout = layoutBoard([step('a'), step('b', ['a']), step('c', ['a'])])
    expect(layout.nodes.map(node => [node.id, node.layer, node.y])).toEqual([
      ['a', 0, BOARD_PADDING],
      ['b', 1, BOARD_PADDING],
      ['c', 1, BOARD_PADDING + BOARD_NODE_HEIGHT + BOARD_GAP_Y],
    ])
    expect(layout.height).toBe(BOARD_PADDING * 2 + 2 * BOARD_NODE_HEIGHT + BOARD_GAP_Y)
  })

  it('places a diamond join after both parents', () => {
    const layout = layoutBoard([step('a'), step('b', ['a']), step('c', ['a']), step('d', ['b', 'c'])])
    expect(layout.nodes.find(node => node.id === 'd')?.layer).toBe(2)
    expect(layout.edges).toHaveLength(4)
  })

  it('ignores unknown dependencies defensively (a forged log cannot throw)', () => {
    const layout = layoutBoard([step('a', ['ghost']), step('b', ['a'])])
    expect(layout.nodes[0]?.layer).toBe(0)
    expect(layout.nodes[1]?.layer).toBe(1)
    expect(layout.edges).toEqual([{ from: 'a', to: 'b' }])
  })
})

describe('deriveNodeStatuses', () => {
  it('marks every node pending without a verification', () => {
    const statuses = deriveNodeStatuses([step('a'), step('b')], undefined)
    expect([...statuses.values()]).toEqual(['pending', 'pending'])
  })

  it('aggregates traces with failed sticky over completed, and ignores unknown step ids', () => {
    const cases: CaseResult[] = [
      { name: 'c1', status: 'passed', steps: [
        { stepId: 'a', status: 'completed', detail: 'ok' },
        { stepId: 'ghost', status: 'failed', detail: 'x' },
      ] },
      { name: 'c2', status: 'failed', steps: [{ stepId: 'a', status: 'failed', detail: 'boom' }] },
    ]
    const statuses = deriveNodeStatuses([step('a'), step('b')], cases)
    expect(statuses.get('a')).toBe('failed')
    expect(statuses.get('b')).toBe('pending')
  })

  it('marks completed only from a completed trace, and keeps a missing trace pending', () => {
    const cases: CaseResult[] = [
      { name: 'c1', status: 'passed', steps: [{ stepId: 'a', status: 'completed', detail: 'ok' }] },
    ]
    const statuses = deriveNodeStatuses([step('a'), step('b')], cases)
    expect(statuses.get('a')).toBe('completed')
    expect(statuses.get('b')).toBe('pending')
  })
})

describe('WorkflowBoard', () => {
  it('renders one node per step, one edge per dependency, and per-node status dots', () => {
    const steps = [step('collect', [], 'Collect leads'), step('score', ['collect'], 'Score leads')]
    const statuses = deriveNodeStatuses(steps, [
      { name: 'c1', status: 'passed', steps: [{ stepId: 'collect', status: 'completed', detail: 'ok' }] },
    ])
    const view = render(<WorkflowBoard steps={steps} statuses={statuses} />)
    const svg = view.container.querySelector('svg')!
    expect(svg.querySelectorAll('g[data-status]')).toHaveLength(2)
    expect(svg.querySelectorAll('path[marker-end]')).toHaveLength(1)
    expect(svg.querySelector('g[data-status="completed"] text')?.textContent).toBe('Collect leads')
    expect(svg.querySelector('g[data-status="pending"] text')?.textContent).toBe('Score leads')
    expect(svg.textContent).toContain('collect')
    expect(svg.textContent).toContain('score')
  })

  it('ellipsizes overlong titles while the SVG title keeps the full text', () => {
    const longTitle = 'Aggregate weekly sales data from every region'
    const steps = [step('aggregate', [], longTitle)]
    const view = render(<WorkflowBoard steps={steps} statuses={deriveNodeStatuses(steps, undefined)} />)
    const titleText = view.container.querySelector('.nodeTitle, [class*="nodeTitle"]')
    expect(titleText?.textContent).toHaveLength(18)
    expect(titleText?.textContent?.endsWith('…')).toBe(true)
    expect(view.container.querySelector('title')?.textContent).toBe(`${longTitle} (aggregate)`)
  })
})
