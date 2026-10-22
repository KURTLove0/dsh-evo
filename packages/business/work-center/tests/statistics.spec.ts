/** Complete cohorts, independent sources, and attributed usage evidence rather than whole-session totals. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { Config } from '../src/index.ts'
import { readStatistics, readStatisticsChoices } from '../src/statistics.ts'
import type { WorkStatisticsQuery } from '../src/statistics-types.ts'
import type { AgentRunSummary } from '@deepseek-ai/dsh-workbench-agent/types'
import type { WorkflowRun, WorkflowRunSummary } from '@deepseek-ai/dsh-business-workflow/workbench-types'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'

const query: WorkStatisticsQuery = { from: 0, to: 86400000, timeZone: 'UTC', usage: 'skip' }
const agent = (id = 'run', patch: { [K in keyof AgentRunSummary]?: AgentRunSummary[K] | undefined } = {}): AgentRunSummary => ({
  id: id as never, agentId: 'same' as never, agentName: 'Reviewer', workspaceId: 'workspace' as never,
  sessionId: id as never, createdAt: 1, updatedAt: 11, status: 'completed', prompt: 'Private task', startedAt: 3, endedAt: 11, settledSeq: 3, ...patch,
} as AgentRunSummary)
const workflow = (patch: { [K in keyof WorkflowRunSummary]?: WorkflowRunSummary[K] | undefined } = {}): WorkflowRunSummary => ({
  id: 'run' as never, workflowId: 'same' as never, workflowName: 'Review process', workspaceId: 'workspace' as never,
  sessionId: 'audit' as never, mode: 'verification', createdAt: 1, updatedAt: 21, endedAt: 21, status: 'succeeded', ...patch,
} as WorkflowRunSummary)
function boot(patch: Partial<Config> = {}) {
  const ctx = new Context()
  const agentQuery = vi.fn(async (_query: unknown) => ({ items: [agent()] }))
  const workflowQuery = vi.fn(async (_query: unknown) => ({ items: [workflow()] }))
  const detail = vi.fn(async () => ({ attempts: [] } as unknown as WorkflowRun))
  const inspect = vi.fn(async () => ({ events: [
    { seq: 0, time: 1, type: 'request/header', data: {} },
    { seq: 1, time: 2, type: 'assistant/chunk', data: { turn: 1, step: 0, chunk: { type: 'usage', usage: { inputTokens: 4, outputTokens: 2 } } } },
    { seq: 2, time: 3, type: 'assistant/message', data: { turn: 1, step: 0, usage: { inputTokens: 6, outputTokens: 3 }, message: { content: [{ type: 'text', text: 'Private response' }] } } },
    { seq: 3, time: 4, type: 'turn/end', data: {} },
    { seq: 4, time: 99, type: 'assistant/message', data: { turn: 2, step: 0, usage: { inputTokens: 10000, outputTokens: 10000 } } },
  ] as unknown as SessionEvent[] }))
  const snapshot = vi.fn(async () => ({ agents: [{ id: 'same', name: 'Reviewer', archived: false, mcpServers: [{ env: [{ value: 'secret' }] }] }] }))
  const catalog = vi.fn(async () => [{ id: 'same', workspaceId: 'workspace', name: 'Review process', archived: true }])
  ctx.provide('workbenchAgents', { queryRuns: agentQuery, snapshot } as never)
  ctx.provide('workflowWorkbench', { queryRuns: workflowQuery, inspectRun: detail, catalog } as never)
  ctx.provide('sessionPersistence', { inspect } as never)
  const config = Config({} as never)
  Object.assign(config, patch)
  return { ctx, config, agentQuery, workflowQuery, detail, inspect, snapshot, catalog,
    read: (request: WorkStatisticsQuery = query) => readStatistics(ctx, config, request) }
}

describe('work statistics observations', () => {
  it('aggregates complete pages, keeps executor IDs qualified, and never reads logs for counts', async () => {
    const source = boot()
    source.agentQuery.mockResolvedValueOnce({ items: [agent()], next: { id: 'cursor' } } as never)
    source.agentQuery.mockResolvedValueOnce({ items: [agent('older', { status: 'failed', endedAt: undefined })] })
    const report = await source.read()
    expect(report.counts).toMatchObject({ runs: 3, settled: 3, succeeded: 2, failed: 1,
      taskRuns: 2, verificationRuns: 1, elapsed: { count: 2, totalMs: 30 }, queue: { count: 2, totalMs: 4 },
      tokens: { checkedRuns: 0, uncheckedRuns: 3 } })
    expect(report.executors.map(item => item.key)).toEqual(['workflow:same', 'agent:same'])
    expect(report.days[0]).toMatchObject({ key: '1970-01-01', counts: { runs: 3 } })
    expect(report.workspaces[0]?.counts.runs).toBe(3)
    expect(source.agentQuery.mock.calls[1]?.[0]).toMatchObject({ before: { id: 'cursor' } })
    expect(source.inspect).not.toHaveBeenCalled(); expect(source.detail).not.toHaveBeenCalled()
    expect(JSON.stringify(report)).not.toContain('Private task')
  })
  it('orders executor groups by observed names and keeps equal-name source identities distinct', async () => {
    const source = boot()
    source.agentQuery.mockResolvedValueOnce({ items: [agent('first', { agentId: 'z' as never, agentName: 'Alpha' }),
      agent('second', { agentId: 'a' as never, agentName: 'Zulu' })] })
    source.workflowQuery.mockResolvedValueOnce({ items: [workflow({ workflowName: 'Alpha' })] })
    expect((await source.read()).executors.map(item => item.key)).toEqual(['agent:z', 'workflow:same', 'agent:a'])
  })
  it('separates waiting from active, execution success from verification type, and absent or inconsistent timing from zero', async () => {
    const source = boot()
    source.agentQuery.mockResolvedValueOnce({ items: [agent('queued', { status: 'queued', purpose: 'design', startedAt: undefined, endedAt: undefined }),
      agent('running', { status: 'running', endedAt: undefined }), agent('quiet', { status: 'running', endedAt: undefined }), agent('cancelled', { status: 'cancelled' }),
      agent('interrupted', { status: 'interrupted', createdAt: 20, startedAt: 1, endedAt: 1 })] })
    source.workflowQuery.mockResolvedValueOnce({ items: [workflow({ mode: 'execution', status: 'waiting', endedAt: undefined })] })
    const report = await source.read({ ...query, attentionSessionIds: ['running' as never] })
    expect(report.counts).toMatchObject({ runs: 6, queued: 1, active: 3, waiting: 2, settled: 2,
      cancelled: 1, interrupted: 1, designRuns: 1, taskRuns: 4, executionRuns: 1, elapsed: { count: 1, totalMs: 10 } })
  })
  it('forwards date, workspace, and executor filters before pagination and excludes the other source', async () => {
    const source = boot()
    const report = await source.read({ ...query, workspaceId: 'workspace' as never, executor: { kind: 'agent', id: 'same' as never } })
    expect(source.agentQuery).toHaveBeenCalledWith(expect.objectContaining({ agentId: 'same', workspaceId: 'workspace', createdFrom: 0, createdBefore: 86400000 }))
    expect(source.workflowQuery).not.toHaveBeenCalled()
    expect(report.sources[1]?.state).toBe('excluded')
    await source.read({ ...query, source: 'workflow', executor: { kind: 'workflow', id: 'same' as never }, attentionSessionIds: [] })
    expect(source.workflowQuery).toHaveBeenCalledWith(expect.objectContaining({ workflowId: 'same' }))
  })
  it('does not turn a missing or changed source into an empty complete cohort and rejects whole-report capacity overflow', async () => {
    const source = boot({ maxStatisticsRuns: 1 })
    source.agentQuery.mockResolvedValueOnce({ items: [agent('first'), agent('second')] })
    let report = await source.read()
    expect(report.sources[0]?.state).toBe('unavailable')
    expect(report.sources[0]?.message).toContain('maxStatisticsRuns')
    expect(report.counts.runs).toBe(1)
    source.agentQuery.mockRejectedValueOnce(new Error('Changed directory')); source.workflowQuery.mockRejectedValueOnce('Workflow unavailable')
    report = await source.read()
    expect(report.counts.runs).toBe(0)
    expect(report.sources.map(item => item.state)).toEqual(['unavailable', 'unavailable'])
    source.config.maxStatisticsGroups = 1
    await expect(source.read()).rejects.toThrow('maxStatisticsGroups')
    source.config.maxStatisticsGroups = 100; source.config.maxStatisticsBytes = 1
    await expect(source.read()).rejects.toThrow('maxStatisticsBytes')
  })
  it('measures only known agent and direct-child intervals, retains failed-stream samples, and excludes later conversation usage', async () => {
    const source = boot()
    source.detail.mockResolvedValueOnce({ attempts: [{ childSessionId: 'child', startedAt: 1, endedAt: 4 }] } as never)
    const report = await source.read({ ...query, usage: 'recorded' })
    expect(report.counts.tokens).toEqual({ usage: { uncachedInputTokens: 12, outputTokens: 6, cacheReadTokens: 0, cacheWriteTokens: 0 },
      requests: 2, reportedSteps: 2, checkedRuns: 2, unavailableRuns: 0, uncheckedRuns: 0 })
    expect(JSON.stringify(report)).not.toContain('Private response')
  })
  it('preserves unavailable evidence and limits original log reads without truncating run counts', async () => {
    const source = boot({ maxStatisticsSessions: 1 })
    source.agentQuery.mockResolvedValueOnce({ items: [agent('old', { settledSeq: undefined, createdAt: 1 }), agent('newer', { createdAt: 2 })] })
    const report = await source.read({ ...query, usage: 'recorded' })
    expect(report.counts.runs).toBe(3)
    expect(report.counts.tokens).toMatchObject({ checkedRuns: 1, uncheckedRuns: 2 })
    expect(source.inspect).toHaveBeenCalledTimes(1)
    expect(source.detail).not.toHaveBeenCalled()
    source.config.maxStatisticsSessions = 10
    source.agentQuery.mockResolvedValueOnce({ items: [agent('missing-seq', { settledSeq: undefined })] })
    source.detail.mockResolvedValueOnce({ attempts: [{ provider: 'spawn' }, { childSessionId: 'unknown' },
      { childSessionId: 'child', startedAt: 1, endedAt: 4 }] } as never)
    source.inspect.mockRejectedValueOnce(new Error('Unreadable original'))
    expect((await source.read({ ...query, usage: 'recorded' })).counts.tokens.unavailableRuns).toBe(2)
    source.inspect.mockResolvedValueOnce({ events: [] })
    source.detail.mockRejectedValueOnce('Unreadable workflow')
    expect((await source.read({ ...query, usage: 'recorded' })).counts.tokens.unavailableRuns).toBe(2)
  })
  it('marks a partially read multi-node run unchecked when its log budget is exhausted', async () => {
    const source = boot({ maxStatisticsSessions: 1 })
    source.agentQuery.mockResolvedValueOnce({ items: [] })
    source.detail.mockResolvedValueOnce({ attempts: [{ childSessionId: 'first', startedAt: 1, endedAt: 4 },
      { childSessionId: 'second', startedAt: 1, endedAt: 4 }, {}] } as never)
    const report = await source.read({ ...query, usage: 'recorded' })
    expect(report.counts.tokens).toMatchObject({ uncheckedRuns: 1, reportedSteps: 1 })
  })
  it('groups submission dates in the requested time zone and validates requests before source reads', async () => {
    const source = boot()
    expect((await source.read({ ...query, timeZone: 'America/Los_Angeles' })).days[0]?.key).toBe('1969-12-31')
    for (const request of [{ ...query, from: NaN }, { ...query, to: Infinity }, { ...query, from: query.to },
      { ...query, to: 8640000000000001 }, { ...query, executor: { kind: 'agent', id: 'same' }, source: 'workflow' }])
      await expect(source.read(request as WorkStatisticsQuery)).rejects.toThrow()
    await expect(source.read({ ...query, timeZone: 'Not/AZone' })).rejects.toThrow()
  })
  it('reads only safe choice fields and preserves independent choice-source failures', async () => {
    const source = boot()
    let choices = await readStatisticsChoices(source.ctx)
    expect(choices.executors).toHaveLength(2)
    expect(JSON.stringify(choices)).not.toContain('secret')
    source.snapshot.mockRejectedValueOnce(new Error('Agent directory unavailable')); source.catalog.mockRejectedValueOnce('Workflow directory unavailable')
    choices = await readStatisticsChoices(source.ctx)
    expect(choices.failures.map(item => item.source)).toEqual(['agent', 'workflow'])
  })
})

it('retains deterministic grouping across multiple workspaces and submission dates', async () => {
  const source = boot()
  source.agentQuery.mockResolvedValueOnce({ items: [agent('first', { createdAt: 1 }), agent('second', { createdAt: 86400001, workspaceId: 'other' as never })] })
  source.workflowQuery.mockResolvedValueOnce({ items: [workflow()], next: { id: 'cursor' } } as never)
  source.workflowQuery.mockResolvedValueOnce({ items: [] })
  const report = await source.read({ ...query, to: 172800000 })
  expect(report.days.map(item => item.key)).toEqual(['1970-01-01', '1970-01-02'])
  expect(report.workspaces.map(item => item.key)).toEqual(['other', 'workspace'])
})

it('enforces exact group and UTF-8 response bounds without truncating multibyte names', async () => {
  const source = boot({ maxStatisticsGroups: 3 })
  source.agentQuery.mockResolvedValue({ items: [agent('unicode', { agentName: '审阅者' })] })
  const clock = vi.spyOn(Date, 'now').mockReturnValue(10)
  try {
    const request = { ...query, source: 'agent' as const }
    const report = await source.read(request)
    source.config.maxStatisticsBytes = Buffer.byteLength(JSON.stringify(report))
    expect(await source.read(request)).toEqual(report)
    source.config.maxStatisticsBytes--
    await expect(source.read(request)).rejects.toThrow('maxStatisticsBytes')
    source.config.maxStatisticsBytes = 100000; source.config.maxStatisticsGroups = 2
    await expect(source.read(request)).rejects.toThrow('maxStatisticsGroups')
  } finally { clock.mockRestore() }
})
