/** Assembled work statistics from real agent, design, workflow, and verification executions. */
import { chromium, type Browser, type Page } from 'playwright'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { MockAdapter, textResponse } from '../../../packages/core/agent-loop/tests/mock-adapter.ts'
import type { AgentDefinition } from '@deepseek-ai/dsh-workbench-agent/types'
import type { WorkflowDefinition } from '@deepseek-ai/dsh-business-workflow/workbench-types'
import { launchWebScaffold, captureStableAria, compareOrRefreshGolden, webSnapshotMode, watchConsole, type WebScaffold } from './scaffold.ts'

const snapshots = fileURLToPath(new URL('./snapshots/run-statistics', import.meta.url))
describe('web e2e: filterable execution statistics', () => {
  let scaffold: WebScaffold, browser: Browser, page: Page, workspace: string, other: string
  let tripwire: ReturnType<typeof watchConsole>
  const definition: AgentDefinition = { name: 'Metrics reviewer', avatar: '', description: '', instructions: 'Produce the requested text.',
    runtime: 'metrics-test', skills: [], mcpServers: [], starters: [], concurrency: 1 }
  const adapter = new MockAdapter([textResponse('First report'), textResponse('Second report'), textResponse('Other project report'), textResponse(JSON.stringify(definition))])
  const workflowAdapter = new MockAdapter([textResponse('VERIFIED')])
  beforeAll(async () => {
    scaffold = await launchWebScaffold({ toolsMode: 'native' })
    workspace = (await scaffold.ctx.workspaceRegistry.create(scaffold.workspaceCwd)).id
    await mkdir(join(scaffold.workspaceCwd, 'other'))
    other = (await scaffold.ctx.workspaceRegistry.create(join(scaffold.workspaceCwd, 'other'))).id
    scaffold.ctx.llm.registerAdapter(['metrics-test'], adapter)
    scaffold.ctx.llm.registerAdapter(['metrics-workflow'], workflowAdapter)
    scaffold.ctx.llm.registerConfigurableProviders([{ provider: 'metrics-test', displayName: 'Metrics runtime', settingsNs: '',
      settingsPath: [], localCommand: process.execPath, defaultModel: 'mock' }])
    await scaffold.ctx.settings.update(settingsNamespace('agent-default-model'), { provider: 'metrics-workflow', model: 'mock' })
    browser = await chromium.launch(); page = await browser.newPage({ viewport: { width: 1680, height: 1100 }, locale: 'en-US', timezoneId: 'UTC' })
    tripwire = watchConsole(page); await page.emulateMedia({ colorScheme: 'dark' }); await page.goto(scaffold.baseUrl)
  }, 120000)
  afterAll(async () => { await browser?.close(); await scaffold?.close() })
  const panel = () => page.getByRole('region', { name: 'Run statistics', exact: true })
  async function read(usage = false) {
    const response = page.waitForResponse(value => value.url().endsWith('/api/workCenterGateway/statistics'))
    await panel().getByRole('button', { name: usage ? 'Read recorded token evidence' : 'Read run statistics', exact: true }).click()
    await (await response).finished()
    await expect.poll(() => panel().getByText('Reading run statistics…', { exact: true }).count(), { timeout: 15000 }).toBe(0)
    await panel().getByText('Observed at:', { exact: false }).waitFor()
  }
  it('separates work types and waiting state and reads reported usage without another model call', async () => {
    onTestFailed(async () => { console.error(await page.locator('body').ariaSnapshot(), tripwire.pageErrors) })
    const agent = (await scaffold.ctx.workbenchAgents.command({ kind: 'create', definition })).agentId
    const writer = (await scaffold.ctx.workbenchAgents.command({ kind: 'create', definition: { ...definition, name: 'Metrics writer' } })).agentId
    for (const [id, cwd, prompt, kind] of [[agent, workspace, 'Inspect first report', 'run'], [writer, workspace, 'Write second report', 'run'],
      [agent, other, 'Inspect another project', 'run'], [writer, workspace, 'Design a configuration', 'design']] as const) {
      const run = (await scaffold.ctx.workbenchAgents.command({ kind, id, workspaceId: cwd as never, prompt })).runId!
      await expect.poll(async () => (await scaffold.ctx.workbenchAgents.inspectRun(run)).status).toBe('completed')
    }
    for (const approval of [false, true]) {
      const created = await scaffold.ctx.workflowWorkbench.command({ kind: 'create', workspaceId: workspace as never,
        name: approval ? 'Metrics approval' : 'Metrics verification', description: 'Measure a real workflow' })
      const flow: WorkflowDefinition = { requirement: { summary: 'Verify the output', objectives: [{ id: 'verify', statement: 'Return expected content' }],
        inputs: [{ name: 'input', description: 'Supplied input' }], outputs: [{ name: 'result', description: 'Delivery' }], constraints: [],
        acceptanceCases: [{ name: 'sample', given: { input: 'Source' }, expect: { kind: 'contains', value: 'VERIFIED' } }] },
      nodes: [{ id: 'verify', title: 'Verify', kind: approval ? 'approval' : 'agent', instruction: 'Return VERIFIED.', preset: 'standard',
        dependsOn: [], inputs: [{ name: 'input', source: { kind: 'requirement', field: 'input' } }], objectives: ['verify'] }],
      finalOutputs: [{ name: 'result', source: { kind: 'step', step: 'verify' } }], positions: {} }
      await scaffold.ctx.workflowWorkbench.command({ kind: 'save', id: created.workflowId, expectedRevision: 1,
        name: approval ? 'Metrics approval' : 'Metrics verification', definition: flow })
      await scaffold.ctx.workflowWorkbench.command({ kind: 'publish', id: created.workflowId, expectedRevision: 2 })
      const saved = await scaffold.ctx.workflowWorkbench.snapshot(created.workflowId)
      const version = saved.workflows.find(item => item.id === created.workflowId)!.versions[0]!
      const request = approval ? { kind: 'start' as const, id: created.workflowId, versionId: version.id, inputs: { input: 'Source' } }
        : { kind: 'verify' as const, id: created.workflowId, versionId: version.id }
      const run = (await scaffold.ctx.workflowWorkbench.command(request)).runIds![0]!
      await expect.poll(async () => (await scaffold.ctx.workflowWorkbench.inspectRun(run)).status).toBe(approval ? 'waiting' : 'succeeded')
    }
    await page.getByRole('navigation', { name: 'Config', exact: true }).getByRole('button', { name: 'Statistics', exact: true }).click()
    await read()
    const request = { from: 0, to: Date.now() + 86400000, timeZone: 'UTC', usage: 'skip' as const }
    const report = await scaffold.ctx.workCenter.statistics(request)
    expect(report.counts).toMatchObject({ runs: 6, active: 1, waiting: 1, settled: 5, succeeded: 5,
      taskRuns: 3, designRuns: 1, executionRuns: 1, verificationRuns: 1, tokens: { uncheckedRuns: 6 } })
    expect(await panel().getByRole('table').getByRole('rowheader').allTextContents()).toEqual(expect.arrayContaining(['Agent · Metrics reviewer', 'Agent · Metrics writer', 'Workflow · Metrics approval', 'Workflow · Metrics verification']))
    await read(true)
    const metered = await scaffold.ctx.workCenter.statistics({ ...request, usage: 'recorded' })
    expect(metered.counts.tokens).toMatchObject({ checkedRuns: 6, unavailableRuns: 0, uncheckedRuns: 0, reportedSteps: 5, requests: 5 })
    expect(metered.counts.tokens.usage.uncachedInputTokens).toBe(50)
    expect(adapter.requests).toHaveLength(4); expect(workflowAdapter.requests).toHaveLength(1)
    const aria = (await captureStableAria(page, '[aria-label="Run statistics"]', scaffold.workspaceCwd))
      .replace(/\d{1,2}\/\d{1,2}\/\d{4}, \{\{clock\}\}/g, '{{timestamp}}').replace(/\d{4}-\d{2}-\d{2}/g, '{{date}}').replace(/\b\d+(?:\.\d+)? (?:ms|s)\b/g, '{{duration}}')
    await compareOrRefreshGolden(join(snapshots, 'cohort.expected.md'), aria, webSnapshotMode())
  })
  it('applies workspace, source, executor, and dates; changed filters retain labelled last-known results', async () => {
    await panel().getByRole('combobox', { name: 'Workspace', exact: true }).selectOption({ index: 1 })
    await panel().getByText(/Filters, execution records, or the connection changed/).waitFor()
    await panel().getByRole('combobox', { name: 'Execution source', exact: true }).selectOption('agent')
    await panel().getByRole('combobox', { name: 'Executor', exact: true }).selectOption({ label: 'Agent · Metrics reviewer' })
    await read()
    await expect.poll(() => panel().getByRole('table').getByRole('rowheader').allTextContents()).toEqual(['Agent · Metrics reviewer'])
    expect(await panel().getByRole('table').getByRole('cell').first().innerText()).toBe('1')
    await panel().getByRole('combobox', { name: 'Group by', exact: true }).selectOption('days')
    expect(await panel().getByRole('table').getByRole('row').count()).toBe(2)
    await panel().getByLabel('Submitted from', { exact: true }).fill('2099-01-01')
    await panel().getByLabel('Submitted through', { exact: true }).fill('2099-01-02')
    await read()
    await panel().getByText('No runs in the available sources match this cohort.', { exact: true }).waitFor()
    const request = page.waitForRequest(value => value.url().endsWith('/api/workCenterGateway/statistics'), { timeout: 300 }).then(() => true, () => false)
    const saved = (await scaffold.ctx.workbenchAgents.snapshot()).agents.find(item => item.name === 'Metrics writer')!
    const { id, revision, archived: _archived, createdAt: _createdAt, updatedAt: _updatedAt, ...definition } = saved
    await scaffold.ctx.workbenchAgents.command({ kind: 'save', id, revision, definition: { ...definition, description: 'Changed configuration' } })
    await panel().getByText(/Filters, execution records, or the connection changed/).waitFor()
    expect(await request).toBe(false)
    expect(adapter.requests).toHaveLength(4)
  })
  it('renders Chinese controls, preserves drafts across page remounts, and contains narrow-screen table overflow', async () => {
    const chinese = await browser.newPage({ viewport: { width: 1680, height: 1100 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' })
    try {
      await chinese.emulateMedia({ colorScheme: 'dark' }); await chinese.goto(scaffold.baseUrl)
      await chinese.getByRole('navigation', { name: '配置', exact: true }).getByRole('button', { name: '统计', exact: true }).click()
      const stats = chinese.getByRole('region', { name: '运行统计', exact: true })
      await stats.getByRole('button', { name: '读取运行统计', exact: true }).click()
      await stats.getByText('本次观察时间：', { exact: false }).waitFor()
      await stats.getByRole('button', { name: '读取已记录的用量证据', exact: true }).click()
      await expect.poll(() => stats.getByText('正在读取运行统计…', { exact: true }).count()).toBe(0)
      await stats.getByRole('table').scrollIntoViewIfNeeded()
      await chinese.screenshot({ path: '/tmp/dsh-run-statistics-zh.png', fullPage: true })
      for (const width of [320, 375, 414, 768, 1680]) {
        await chinese.setViewportSize({ width, height: 1100 })
        await expect.poll(() => stats.evaluate(element => element.scrollWidth <= element.clientWidth), { timeout: 10000 }).toBe(true)
      }
      await chinese.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click()
      await chinese.getByRole('navigation', { name: '配置', exact: true }).getByRole('button', { name: '统计', exact: true }).click()
      await stats.getByText('本次观察时间：', { exact: false }).waitFor()
    } finally { await chinese.close() }
    expect(tripwire.pageErrors).toEqual([])
  })
})
