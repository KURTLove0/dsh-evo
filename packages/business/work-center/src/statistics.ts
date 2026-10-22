/** Bounded source reads and execution-attributed statistics, without another history store. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-workbench-agent'
import type {} from '@deepseek-ai/dsh-business-workflow/workbench'
import type {} from '@deepseek-ai/dsh-session-persistence'
import { measureReportedUsage } from '@deepseek-ai/dsh-token-meter'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session/types'
import type { AgentRunSummary, AgentRunPosition } from '@deepseek-ai/dsh-workbench-agent/types'
import type { WorkflowRunSummary, WorkflowRunPosition } from '@deepseek-ai/dsh-business-workflow/workbench-types'
import type { Config } from './index.ts'
import type { WorkStatisticsChoices, WorkStatisticsCounts, WorkStatisticsGroup, WorkStatisticsQuery, WorkStatisticsReport, WorkUsageCoverage } from './statistics-types.ts'

type Row = { kind: 'agent'; run: AgentRunSummary } | { kind: 'workflow'; run: WorkflowRunSummary }
const message = (error: unknown) => error instanceof Error ? error.message : String(error)
const counts = (): WorkStatisticsCounts => ({ runs: 0, queued: 0, active: 0, waiting: 0, settled: 0, succeeded: 0,
  failed: 0, cancelled: 0, interrupted: 0, taskRuns: 0, designRuns: 0, executionRuns: 0, verificationRuns: 0,
  elapsed: { count: 0, totalMs: 0 }, queue: { count: 0, totalMs: 0 },
  tokens: { usage: { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    requests: 0, reportedSteps: 0, checkedRuns: 0, unavailableRuns: 0, uncheckedRuns: 0 } })
const key = (row: Row) => `${row.kind}:${row.kind === 'agent' ? row.run.agentId : row.run.workflowId}`

async function pages<T, C>(read: (cursor?: C) => Promise<{ items: T[]; next?: C }>, limit: number): Promise<T[]> {
  const rows: T[] = []
  let cursor: C | undefined
  do {
    const page = await read(cursor)
    rows.push(...page.items)
    if (rows.length > limit) throw new Error('Statistics exceed maxStatisticsRuns. Narrow the date, workspace, or executor filters.')
    cursor = page.next
  } while (cursor !== undefined)
  return rows
}
function accumulate(target: WorkUsageCoverage, source: WorkUsageCoverage): void {
  for (const field of ['uncachedInputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens'] as const)
    target.usage[field] += source.usage[field]
  target.requests += source.requests; target.reportedSteps += source.reportedSteps
  target.checkedRuns += source.checkedRuns; target.unavailableRuns += source.unavailableRuns; target.uncheckedRuns += source.uncheckedRuns
}
function add(target: WorkStatisticsCounts, row: Row, usage: WorkUsageCoverage, pending: ReadonlySet<SessionId>): void {
  const run = row.run
  target.runs++
  if (row.kind === 'agent') target[row.run.purpose === 'design' ? 'designRuns' : 'taskRuns']++
  else target[row.run.mode === 'verification' ? 'verificationRuns' : 'executionRuns']++
  const settled = ['completed', 'succeeded', 'failed', 'cancelled', 'interrupted'].includes(run.status)
  if (run.status === 'queued') target.queued++
  else if (!settled) {
    target.active++
    if (run.status === 'waiting' || (row.kind === 'agent' && pending.has(run.sessionId))) target.waiting++
  } else {
    target.settled++
    if (run.status === 'completed' || run.status === 'succeeded') target.succeeded++
    else if (run.status === 'failed') target.failed++
    else if (run.status === 'cancelled') target.cancelled++
    else target.interrupted++
    if (run.endedAt !== undefined && run.endedAt >= run.createdAt) {
      target.elapsed.count++; target.elapsed.totalMs += run.endedAt - run.createdAt
    }
  }
  if (run.startedAt !== undefined && run.startedAt >= run.createdAt) {
    target.queue.count++; target.queue.totalMs += run.startedAt - run.createdAt
  }
  accumulate(target.tokens, usage)
}

/**
 * Read safe executor choices without publishing configuration or execution history.
 * @param ctx - execution owners declared by the Work Center provider.
 * @returns independently available source directories and failures.
 */
export async function readStatisticsChoices(ctx: Context): Promise<WorkStatisticsChoices> {
  const [agents, workflows] = await Promise.allSettled([ctx.workbenchAgents.snapshot(), ctx.workflowWorkbench.catalog()])
  const result: WorkStatisticsChoices = { executors: [], failures: [] }
  if (agents.status === 'fulfilled') result.executors.push(...agents.value.agents.map(({ id, name, archived }) =>
    ({ ref: { kind: 'agent' as const, id }, name, archived })))
  else result.failures.push({ source: 'agent', message: message(agents.reason) })
  if (workflows.status === 'fulfilled') result.executors.push(...workflows.value.map(({ id, name, archived, workspaceId }) =>
    ({ ref: { kind: 'workflow' as const, id }, name, archived, workspaceId })))
  else result.failures.push({ source: 'workflow', message: message(workflows.reason) })
  return result
}

/**
 * Aggregate a complete bounded cohort from independently observed execution directories.
 * @param ctx - declared source owners and original durable session reader.
 * @param config - deployment bounds on paging, groups, log reads, and emitted bytes.
 * @param request - submission-time filters and explicit usage-read choice.
 * @returns source-local completeness, counts, and execution-attributed reported usage.
 */
export async function readStatistics(ctx: Context, config: Config, request: WorkStatisticsQuery): Promise<WorkStatisticsReport> {
  if (!Number.isSafeInteger(request.from) || !Number.isSafeInteger(request.to) || request.from >= request.to ||
    !Number.isFinite(new Date(request.from).getTime()) || !Number.isFinite(new Date(request.to).getTime()))
    throw new Error('Statistics require increasing valid millisecond date bounds.')
  if (request.executor !== undefined && request.source !== undefined && request.executor.kind !== request.source)
    throw new Error('Statistics source and executor filters disagree.')
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: request.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
  const filter = { ...(request.workspaceId === undefined ? {} : { workspaceId: request.workspaceId }),
    createdFrom: request.from, createdBefore: request.to, limit: config.pageSize }
  const source = request.executor?.kind ?? request.source
  const [agents, workflows] = await Promise.allSettled([
    source === 'workflow' ? Promise.resolve(undefined) : pages<AgentRunSummary, AgentRunPosition>(cursor => ctx.workbenchAgents.queryRuns({ ...filter,
      ...(request.executor?.kind === 'agent' ? { agentId: request.executor.id } : {}),
      ...(request.attentionSessionIds === undefined ? {} : { attentionSessionIds: request.attentionSessionIds }),
      ...(cursor === undefined ? {} : { before: cursor }) }), config.maxStatisticsRuns),
    source === 'agent' ? Promise.resolve(undefined) : pages<WorkflowRunSummary, WorkflowRunPosition>(cursor => ctx.workflowWorkbench.queryRuns({ ...filter,
      ...(request.executor?.kind === 'workflow' ? { workflowId: request.executor.id } : {}),
      ...(cursor === undefined ? {} : { before: cursor }) }), config.maxStatisticsRuns),
  ])
  const report: WorkStatisticsReport = { query: structuredClone(request), observedAt: 0,
    usageSessions: { attempted: 0, limit: config.maxStatisticsSessions },
    sources: [], counts: counts(), days: [], workspaces: [], executors: [] }
  const rows: Row[] = []
  if (agents.status === 'rejected') report.sources.push({ source: 'agent', state: 'unavailable', message: message(agents.reason), runs: 0 })
  else {
    report.sources.push({ source: 'agent', state: agents.value === undefined ? 'excluded' : 'available', runs: agents.value?.length ?? 0 })
    if (agents.value !== undefined) rows.push(...agents.value.map(run => ({ kind: 'agent' as const, run })))
  }
  if (workflows.status === 'rejected') report.sources.push({ source: 'workflow', state: 'unavailable', message: message(workflows.reason), runs: 0 })
  else {
    report.sources.push({ source: 'workflow', state: workflows.value === undefined ? 'excluded' : 'available', runs: workflows.value?.length ?? 0 })
    if (workflows.value !== undefined) rows.push(...workflows.value.map(run => ({ kind: 'workflow' as const, run })))
  }
  rows.sort((a, b) => b.run.createdAt - a.run.createdAt || key(a).localeCompare(key(b)) || a.run.id.localeCompare(b.run.id))
  const groups = { days: new Map<string, WorkStatisticsGroup>(), workspaces: new Map<string, WorkStatisticsGroup>(),
    executors: new Map<string, WorkStatisticsGroup>() }
  const pending = new Set(request.attentionSessionIds)
  let remaining = config.maxStatisticsSessions
  const observe = async (row: Row): Promise<WorkUsageCoverage> => {
    const result = counts().tokens
    if (request.usage === 'skip' || remaining === 0) { result.uncheckedRuns = 1; return result }
    const states: ('read' | 'unavailable' | 'unchecked')[] = []
    const inspect = async (id: SessionId, select: (events: readonly SessionEvent[]) => readonly SessionEvent[] | undefined) => {
      if (remaining === 0) { states.push('unchecked'); return }
      remaining--
      try {
        const events = select((await ctx.sessionPersistence.inspect(id)).events)
        if (events === undefined) { states.push('unavailable'); return }
        const observed = measureReportedUsage(events)
        for (const field of ['uncachedInputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens'] as const)
          result.usage[field] += observed.usage[field]
        result.requests += observed.requests; result.reportedSteps += observed.reportedSteps
        states.push('read')
      } catch { states.push('unavailable') }
    }
    if (row.kind === 'agent') {
      const end = row.run.settledSeq
      if (end === undefined) states.push('unavailable')
      else await inspect(row.run.sessionId, events => events.some(event => event.seq === end && event.type === 'turn/end')
        ? events.filter(event => event.seq <= end) : undefined)
    } else {
      try {
        const run = await ctx.workflowWorkbench.inspectRun(row.run.id)
        for (const attempt of run.attempts) {
          if (attempt.childSessionId === undefined) {
            if (attempt.provider !== undefined) states.push('unavailable')
            continue
          }
          const from = attempt.startedAt, to = attempt.endedAt
          if (from === undefined || to === undefined) { states.push('unavailable'); continue }
          await inspect(attempt.childSessionId, events => events.filter(event => event.time >= from && event.time <= to))
        }
      } catch { states.push('unavailable') }
    }
    if (states.includes('unavailable')) result.unavailableRuns = 1
    else if (states.includes('unchecked')) result.uncheckedRuns = 1
    else result.checkedRuns = 1
    return result
  }
  for (const row of rows) {
    const usage = await observe(row)
    add(report.counts, row, usage, pending)
    const parts = formatter.formatToParts(row.run.createdAt)
    const order = ['year', 'month', 'day']
    const day = parts.filter(part => order.includes(part.type))
      .sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type)).map(part => part.value).join('-')
    for (const [axis, id, label] of [
      ['days', day, day], ['workspaces', row.run.workspaceId, row.run.workspaceId],
      ['executors', key(row), row.kind === 'agent' ? row.run.agentName : row.run.workflowName],
    ] as const) {
      let group = groups[axis].get(id)
      if (group === undefined) {
        group = { key: id, label, counts: counts(), ...(axis === 'executors' ? { source: row.kind } : {}) }; groups[axis].set(id, group)
        if (Object.values(groups).reduce((total, values) => total + values.size, 0) > config.maxStatisticsGroups)
          throw new Error('Statistics exceed maxStatisticsGroups. Narrow the selected cohort.')
      }
      add(group.counts, row, usage, pending)
    }
  }
  report.days = [...groups.days.values()].sort((a, b) => a.key.localeCompare(b.key))
  report.workspaces = [...groups.workspaces.values()].sort((a, b) => a.key.localeCompare(b.key))
  report.executors = [...groups.executors.values()].sort((a, b) => a.label.localeCompare(b.label) || a.key.localeCompare(b.key))
  report.usageSessions.attempted = config.maxStatisticsSessions - remaining
  report.observedAt = Date.now()
  if (Buffer.byteLength(JSON.stringify(report)) > config.maxStatisticsBytes)
    throw new Error('Statistics exceed maxStatisticsBytes. Narrow the selected cohort.')
  return report
}
