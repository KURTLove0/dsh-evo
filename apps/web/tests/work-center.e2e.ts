/** Keyless P0 journey through the shipped Work Center composition and execution owners. */
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { MockAdapter, textResponse, toolCallResponse } from '../../../packages/core/agent-loop/tests/mock-adapter.ts'
import { launchWebScaffold, watchConsole, captureStableAria, compareOrRefreshGolden, webSnapshotMode, type WebScaffold } from './scaffold.ts'
import { newEnglishPage } from './support.ts'

const SNAPSHOTS = fileURLToPath(new URL('./snapshots/work-center', import.meta.url))
describe('web e2e: work center intake and delivery acceptance', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    const adapter = new MockAdapter([textResponse('Report inspected. Source references are missing.'), textResponse('Report revised with source references.'), textResponse('Newer background task done.'), toolCallResponse('work-question', 'ask_user_question', { questions: [{ id: 'confirm', question: 'Which report should be reviewed?', header: 'Report', options: [{ label: 'Current', description: 'Review the current report' }, { label: 'Previous', description: 'Review the previous report' }], multi_select: false }] })])
    scaffold.ctx.llm.registerAdapter(['work-center-test'], adapter)
    scaffold.ctx.llm.registerConfigurableProviders([{ provider: 'work-center-test', displayName: 'Scripted work executor', settingsNs: '', settingsPath: [], localCommand: process.execPath, defaultModel: 'mock' }])
    await scaffold.ctx.workspaceRegistry.create(scaffold.workspaceCwd)
    await scaffold.ctx.workbenchAgents.command({ kind: 'create', definition: { name: 'Report reviewer', avatar: '', description: '', instructions: 'Inspect the requested report and its references.', runtime: 'work-center-test', skills: [], mcpServers: [], starters: [], concurrency: 1 } })
    await writeFile(join(scaffold.workspaceCwd, 'report.txt'), 'Report with source data')
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    await page.goto(scaffold.baseUrl)
  }, 120_000)
  afterAll(async () => { await browser?.close(); await scaffold?.close() })

  it('previews an exact task, saves feedback without execution, and accepts the explicitly submitted revision', async () => {
    const console = watchConsole(page)
    onTestFailed(async () => { globalThis.console.error(await page.locator('main').ariaSnapshot(), console.pageErrors); await page.screenshot({ path: '/tmp/dsh-work-center-failure.png' }) })
    await page.getByRole('button', { name: 'Work Center', exact: true }).click()
    const main = page.getByRole('main', { name: 'Work Center', exact: true })
    await main.getByRole('button', { name: 'New task', exact: true }).click()
    const form = main.locator('form')
    await form.getByRole('combobox', { name: 'Executor', exact: true }).selectOption({ label: 'Report reviewer' })
    await form.getByRole('combobox', { name: 'Workspace', exact: true }).selectOption({ index: 1 })
    await form.getByLabel('Task goal', { exact: true }).fill('Inspect report.txt')
    await form.getByLabel('Acceptance criteria (one per line, optional)', { exact: true }).fill('Include source references')
    await form.getByLabel('Expected file paths (one per line, optional)', { exact: true }).fill('report.txt')
    await form.getByRole('button', { name: 'Check and preview', exact: true }).click()
    await form.getByText('Basic dependency checks passed', { exact: true }).waitFor()
    expect(await form.locator('pre').textContent()).toContain('Acceptance criteria:\nInclude source references')
    const aria = (await captureStableAria(page, 'main form', scaffold.workspaceCwd)).replace(/(heading "Checked at )[^"]+(" \[level=3\])/g, '$1{{time}}$2')
    await compareOrRefreshGolden(join(SNAPSHOTS, 'intake.expected.md'), aria, webSnapshotMode())
    await form.getByRole('button', { name: 'Confirm task submission', exact: true }).click()
    await form.waitFor({ state: 'detached' })
    const delivery = main.getByRole('region', { name: 'Delivery inspection', exact: true })
    await delivery.getByText('Report inspected. Source references are missing.', { exact: true }).waitFor()
    await delivery.getByLabel('Review feedback (required for changes)', { exact: true }).fill('Add source references')
    await delivery.getByRole('button', { name: 'Save requested changes', exact: true }).click()
    await delivery.getByRole('button', { name: 'Create revision task', exact: true }).waitFor()
    expect((await scaffold.ctx.workbenchAgents.queryRuns({ limit: 10 })).items).toHaveLength(1)
    await delivery.getByRole('button', { name: 'Create revision task', exact: true }).click()
    await form.getByText('Configuration captured by the original run', { exact: true }).waitFor()
    await form.getByRole('button', { name: 'Check and preview', exact: true }).click()
    await expect.poll(() => form.locator('details pre').textContent()).toContain('Review feedback:\nAdd source references')
    await form.getByRole('button', { name: 'Confirm task submission', exact: true }).click()
    await form.waitFor({ state: 'detached' })
    await delivery.getByText('Report revised with source references.', { exact: true }).waitFor()
    await delivery.getByRole('button', { name: 'Accept delivery', exact: true }).click()
    await delivery.getByText('Accepted', { exact: true }).waitFor()
    await expect.poll(() => delivery.getByRole('button', { name: 'Accept delivery', exact: true }).isEnabled()).toBe(true)
    const reviewAria = await delivery.getByRole('heading', { name: 'Human review', exact: true }).locator('..').ariaSnapshot()
    await compareOrRefreshGolden(join(SNAPSHOTS, 'review.expected.md'), reviewAria, webSnapshotMode())
    const runs = (await scaffold.ctx.workbenchAgents.queryRuns({ limit: 10 })).items
    expect(runs).toHaveLength(2)
    const revised = runs.find(run => run.revisionOf !== undefined)!
    expect((await scaffold.ctx.workCenter.detail({ kind: 'agent', id: revised.id })).review?.decision).toBe('accepted')
    for (const width of [320, 375, 414, 768, 1680]) {
      await page.setViewportSize({ width, height: 1000 })
      await expect.poll(() => main.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    }
    await page.emulateMedia({ colorScheme: 'dark' })
    await expect.poll(() => page.locator('body').getAttribute('data-ds-dark-theme')).toBe('')
    await page.screenshot({ path: '/tmp/dsh-work-center.png', fullPage: true })
    expect(console.pageErrors).toEqual([])
  })
  it('handles workflow waiting attempts from the unified inbox', async () => {
    const workspace = (await scaffold.ctx.workspaceRegistry.create(scaffold.workspaceCwd)).id
    const receipt = await scaffold.ctx.workflowWorkbench.command({ kind: 'create', workspaceId: workspace, name: 'Approval delivery', description: 'Confirm a delivery' })
    const definition = {
      requirement: { summary: 'Confirm delivery', objectives: [{ id: 'confirm', statement: 'Operator confirms the input' }], inputs: [{ name: 'report', description: 'Report' }], outputs: [{ name: 'confirmed', description: 'Confirmed report' }], constraints: [], acceptanceCases: [{ name: 'report', given: { report: 'Ready' }, expect: { kind: 'nonEmpty' as const } }] },
      nodes: [{ id: 'confirm', kind: 'approval' as const, title: 'Confirm report', instruction: 'Check this report', preset: 'standard', dependsOn: [], inputs: [{ name: 'report', source: { kind: 'requirement' as const, field: 'report' } }], objectives: ['confirm'] }],
      finalOutputs: [{ name: 'confirmed', source: { kind: 'step' as const, step: 'confirm' } }], positions: {},
    }
    await scaffold.ctx.workflowWorkbench.command({ kind: 'save', id: receipt.workflowId, expectedRevision: 1, name: 'Approval delivery', definition })
    await scaffold.ctx.workflowWorkbench.command({ kind: 'publish', id: receipt.workflowId, expectedRevision: 2 })
    const version = (await scaffold.ctx.workflowWorkbench.snapshot(receipt.workflowId)).workflows[0]!.versions[0]!
    const started = await scaffold.ctx.workflowWorkbench.command({ kind: 'start', id: receipt.workflowId, versionId: version.id, inputs: { report: 'Ready for inspection' } })
    const runId = started.runIds![0]!
    await expect.poll(async () => (await scaffold.ctx.workflowWorkbench.inspectRun(runId)).status).toBe('waiting')
    const agent = (await scaffold.ctx.workbenchAgents.snapshot()).agents[0]!
    const later = await scaffold.ctx.workbenchAgents.command({ kind: 'run', id: agent.id, workspaceId: workspace, prompt: 'Complete a newer independent task' })
    await expect.poll(async () => (await scaffold.ctx.workbenchAgents.inspectRun(later.runId!)).status).toBe('completed')
    const main = page.getByRole('main', { name: 'Work Center', exact: true })
    const runList = main.getByRole('region', { name: 'Runs', exact: true })
    const firstRow = runList.locator('ul > li').first()
    await expect.poll(() => firstRow.innerText()).toContain('Approval delivery')
    const paused = await scaffold.ctx.workflowWorkbench.inspectRun(runId)
    const timestamps = await firstRow.locator('time').evaluateAll(elements => elements.map(element => element.getAttribute('datetime')))
    expect(timestamps).toEqual([new Date(paused.createdAt).toISOString(), new Date(paused.updatedAt).toISOString()])
    const directoryAria = (await captureStableAria(page, 'section[aria-label="Runs"] ul > li:first-child', scaffold.workspaceCwd))
      .replace(/\d{1,2}\/\d{1,2}\/\d{4}, \{\{clock\}\}/g, '{{timestamp}}')
    await compareOrRefreshGolden(join(SNAPSHOTS, 'directory.expected.md'), directoryAria, webSnapshotMode())
    const inbox = main.getByRole('region', { name: 'Needs my attention', exact: true })
    await inbox.getByRole('button', { name: 'View details', exact: true }).click()
    const delivery = main.getByRole('region', { name: 'Delivery inspection', exact: true })
    await delivery.getByRole('button', { name: 'Approve this node', exact: true }).click()
    await expect.poll(async () => (await scaffold.ctx.workflowWorkbench.inspectRun(runId)).status).toBe('succeeded')
    await delivery.getByText('Execution succeeded', { exact: true }).waitFor()
    await delivery.getByRole('button', { name: 'Accept delivery', exact: true }).click()
    await expect.poll(async () => (await scaffold.ctx.workCenter.detail({ kind: 'workflow', id: runId })).review?.decision).toBe('accepted')
    await delivery.getByLabel('Review feedback (required for changes)', { exact: true }).fill('Repeat the operator confirmation')
    await delivery.getByRole('button', { name: 'Save requested changes', exact: true }).click()
    await delivery.getByRole('button', { name: 'Rerun the original publication with feedback', exact: true }).click()
    expect((await scaffold.ctx.workflowWorkbench.queryRuns({ limit: 10 })).items).toHaveLength(1)
    await delivery.getByRole('button', { name: 'Confirm workflow rerun', exact: true }).click()
    await delivery.getByRole('button', { name: 'Approve this node', exact: true }).waitFor()
    const rerun = (await scaffold.ctx.workflowWorkbench.queryRuns({ limit: 10 })).items.find(run => run.id !== runId)!
    const stored = await scaffold.ctx.workflowWorkbench.inspectRun(rerun.id)
    expect(stored.rerunOf).toBe(runId)
    expect(stored.version.id).toBe(version.id)
    expect(stored.feedback).toContain('Repeat the operator confirmation')
    await delivery.getByRole('button', { name: 'Approve this node', exact: true }).click()
    await delivery.getByText('Execution succeeded', { exact: true }).waitFor()
    await delivery.getByRole('button', { name: 'Accept delivery', exact: true }).click()
    await expect.poll(async () => (await scaffold.ctx.workCenter.detail({ kind: 'workflow', id: rerun.id })).review?.decision).toBe('accepted')
    await page.reload()
    await page.getByRole('button', { name: 'Work Center', exact: true }).click()
    await main.getByRole('button', { name: /Approval delivery/ }).first().click()
    await delivery.getByText('Accepted', { exact: true }).waitFor()
    await main.evaluate((element) => { element.scrollTop = 0 })
    await page.screenshot({ path: '/tmp/dsh-work-center.png', fullPage: true })
  })

  it('renders the work center in Chinese with a retained review', async () => {
    const chinese = await browser.newPage({ viewport: { width: 1680, height: 1000 }, locale: 'zh-CN' })
    try {
      await chinese.emulateMedia({ colorScheme: 'dark' })
      await chinese.goto(scaffold.baseUrl)
      await chinese.getByRole('button', { name: '工作中心', exact: true }).click()
      const main = chinese.getByRole('main', { name: '工作中心', exact: true })
      await main.getByRole('heading', { name: '待我处理', exact: true }).waitFor()
      await main.getByRole('button', { name: /Approval delivery/ }).first().click()
      await main.getByText(/验收通过 · 当前宿主操作者/).waitFor()
      await chinese.screenshot({ path: '/tmp/dsh-work-center-zh.png', fullPage: true })
    } finally { await chinese.close() }
  })

  it('prioritizes a real pending task question and refreshes the waiting filter when cancellation resolves it', async () => {
    const agent = (await scaffold.ctx.workbenchAgents.snapshot()).agents[0]!
    const workspace = await scaffold.ctx.workspaceRegistry.create(scaffold.workspaceCwd)
    const task = await scaffold.ctx.workbenchAgents.command({ kind: 'run', id: agent.id, workspaceId: workspace.id, prompt: 'Ask which report to inspect' })
    const main = page.getByRole('main', { name: 'Work Center', exact: true })
    const runList = main.getByRole('region', { name: 'Runs', exact: true })
    await runList.getByText('Waiting for answer', { exact: true }).waitFor()
    await main.getByRole('button', { name: 'Needs attention', exact: true }).click()
    await expect.poll(() => runList.locator('ul > li').count()).toBe(1)
    expect(await runList.locator('ul > li').first().innerText()).toContain('Ask which report to inspect')
    await scaffold.ctx.workbenchAgents.command({ kind: 'stop', runId: task.runId! })
    await expect.poll(() => runList.locator('ul > li').count()).toBe(0)
    await runList.getByText('No runs match these filters.', { exact: true }).waitFor()
    await main.getByRole('button', { name: 'Clear filters', exact: true }).click()
  })

})
