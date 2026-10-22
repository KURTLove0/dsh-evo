/** Saved task versions and independent workflow reuse through the shipped Web composition. */
import { chromium, type Browser, type Page } from 'playwright'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { MockAdapter, textResponse } from '../../../packages/core/agent-loop/tests/mock-adapter.ts'
import { launchWebScaffold, watchConsole, captureStableAria, compareOrRefreshGolden, webSnapshotMode, type WebScaffold } from './scaffold.ts'
import { newEnglishPage } from './support.ts'

const snapshots = fileURLToPath(new URL('./snapshots/work-templates', import.meta.url))
describe('web e2e: private versioned work templates', () => {
  let scaffold: WebScaffold, browser: Browser, page: Page
  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    const workspace = await scaffold.ctx.workspaceRegistry.create(scaffold.workspaceCwd)
    scaffold.ctx.llm.registerAdapter(['template-test'], new MockAdapter([textResponse('Template-based report ready')]))
    scaffold.ctx.llm.registerConfigurableProviders([{ provider: 'template-test', displayName: 'Template executor', settingsNs: '', settingsPath: [], localCommand: process.execPath, defaultModel: 'mock' }])
    await scaffold.ctx.workbenchAgents.command({ kind: 'create', definition: { name: 'Template reviewer', avatar: '', description: '', instructions: 'Review the task.', runtime: 'template-test', skills: [], mcpServers: [], starters: [], concurrency: 1 } })
    const flow = await scaffold.ctx.workflowWorkbench.command({ kind: 'create', workspaceId: workspace.id, name: 'Published source', description: 'Approve a report' })
    const definition = { requirement: { summary: 'Approve report', objectives: [{ id: 'approve', statement: 'Confirm input' }], inputs: [{ name: 'report', description: 'Input report' }], outputs: [{ name: 'approved', description: 'Confirmed input' }], constraints: [], acceptanceCases: [{ name: 'sample', given: { report: 'Ready' }, expect: { kind: 'nonEmpty' as const } }] }, nodes: [{ id: 'approve', kind: 'approval' as const, title: 'Human review', instruction: 'Confirm the input', preset: 'standard', dependsOn: [], inputs: [{ name: 'report', source: { kind: 'requirement' as const, field: 'report' } }], objectives: ['approve'] }], finalOutputs: [{ name: 'approved', source: { kind: 'step' as const, step: 'approve' } }], positions: {} }
    await scaffold.ctx.workflowWorkbench.command({ kind: 'save', id: flow.workflowId, expectedRevision: 1, name: 'Published source', definition })
    await scaffold.ctx.workflowWorkbench.command({ kind: 'publish', id: flow.workflowId, expectedRevision: 2 })
    browser = await chromium.launch(); page = await newEnglishPage(browser); await page.goto(scaffold.baseUrl)
  }, 120000)
  afterAll(async () => { await browser?.close(); await scaffold?.close() })
  it('saves task versions, loads a pinned old version, and submits with durable provenance', async () => {
    const tripwire = watchConsole(page)
    onTestFailed(async () => { console.error(await page.locator('main').ariaSnapshot(), tripwire.pageErrors) })
    page.setDefaultTimeout(15000)
    await page.getByRole('button', { name: 'Work Center', exact: true }).click()
    const main = page.getByRole('main', { name: 'Work Center', exact: true })
    await main.getByRole('button', { name: 'New task', exact: true }).click()
    const form = main.locator('form')
    await form.getByRole('combobox', { name: 'Executor', exact: true }).selectOption({ label: 'Template reviewer' })
    await form.getByRole('combobox', { name: 'Workspace', exact: true }).selectOption({ index: 1 })
    await form.getByRole('textbox', { name: 'Task goal', exact: true }).fill('Review the original report')
    await form.getByText('Task templates', { exact: true }).click()
    await form.getByLabel('Template name', { exact: true }).fill('Reusable review')
    await form.getByRole('button', { name: 'Save as new template', exact: true }).click()
    await expect.poll(async () => (await scaffold.ctx.workTemplates.list())[0]?.version).toBe(1)
    await form.getByRole('combobox', { name: 'Content version', exact: true }).locator('option').waitFor({ state: 'attached' })
    await form.getByRole('textbox', { name: 'Task goal', exact: true }).fill('Review the revised report')
    await form.getByRole('button', { name: 'Save new version', exact: true }).click()
    await expect.poll(async () => (await scaffold.ctx.workTemplates.list())[0]?.version).toBe(2)
    await form.getByRole('combobox', { name: 'Content version', exact: true }).selectOption('1')
    await form.getByRole('button', { name: 'Load selected version', exact: true }).click()
    expect(await form.getByRole('textbox', { name: 'Task goal', exact: true }).inputValue()).toBe('Review the original report')
    expect(await form.getByRole('combobox', { name: 'Executor', exact: true }).inputValue()).not.toBe('')
    await form.getByRole('button', { name: 'Check and preview', exact: true }).click()
    await form.getByText('Basic dependency checks passed', { exact: true }).waitFor()
    await form.getByRole('button', { name: 'Confirm task submission', exact: true }).click()
    await main.getByText('Template-based report ready', { exact: true }).waitFor()
    const run = (await scaffold.ctx.workbenchAgents.queryRuns({ limit: 1 })).items[0]!
    expect(run.submission?.brief.template).toEqual({ id: (await scaffold.ctx.workTemplates.list())[0]!.id, version: 1 })
    expect(run.submission?.brief.goal).toBe('Review the original report')
    const transcript = await scaffold.ctx.sessionPersistence.inspect(run.sessionId)
    expect(JSON.stringify(transcript.events.filter(event => event.type === 'user/message'))).toContain('Review the original report')
    await page.reload(); await page.getByRole('button', { name: 'Templates', exact: true }).click()
    const library = page.getByRole('main', { name: 'Templates', exact: true })
    await library.getByRole('button', { name: /Reusable review/ }).click()
    await library.getByRole('button', { name: 'Archive template', exact: true }).click()
    await library.getByText('Archived history remains inspectable. Restore before reusing or editing.', { exact: true }).waitFor()
    await library.getByRole('button', { name: 'Restore template', exact: true }).click()
    expect(tripwire.pageErrors).toEqual([])
  })
  it('copies a saved workflow into a draft and runs its independent publication after explicit approval', async () => {
    onTestFailed(async () => { console.error(await page.locator('main').ariaSnapshot()) })
    const main = page.getByRole('main', { name: 'Templates', exact: true })
    const save = main.getByRole('region', { name: 'Save workflow template', exact: true })
    await save.getByRole('combobox', { name: 'Published workflow', exact: true }).selectOption({ label: 'Published source' })
    await save.getByRole('combobox', { name: 'Published version', exact: true }).selectOption({ index: 1 })
    await save.getByLabel('Template name', { exact: true }).fill('Approval template')
    await save.getByRole('button', { name: 'Save workflow template', exact: true }).click()
    await main.getByRole('button', { name: /Approval template/ }).click()
    const detail = main.getByRole('region', { name: 'Template content', exact: true })
    await detail.getByRole('combobox', { name: 'Copy workspace', exact: true }).selectOption({ index: 1 })
    await detail.getByLabel('Workflow copy name', { exact: true }).fill('Independent review copy')
    await detail.getByRole('button', { name: 'Create independent workflow draft', exact: true }).click()
    await main.getByText('Independent draft created', { exact: true }).waitFor()
    const copy = (await scaffold.ctx.workflowWorkbench.snapshot()).workflows.find(item => item.name === 'Independent review copy')!
    expect(copy.versions).toEqual([])
    expect(copy.copiedFrom?.template?.version).toBe(1)
    expect((await scaffold.ctx.workflowWorkbench.queryRuns({ limit: 10 })).items).toEqual([])
    await detail.getByRole('button', { name: 'Open workflows', exact: true }).click()
    const workflows = page.getByRole('main', { name: 'Business workflow', exact: true })
    await workflows.getByRole('button', { name: /Independent review copy/ }).click()
    const flow = workflows.locator('[data-business-workflow-id]')
    await flow.getByRole('button', { name: 'Publish version', exact: true }).click()
    await flow.getByRole('combobox', { name: 'Published version', exact: true }).locator('option', { hasText: 'v1' }).waitFor({ state: 'attached' })
    await flow.getByLabel('Run inputs (JSON)', { exact: true }).fill('{"report":"Independent input"}')
    await flow.getByRole('button', { name: 'Run workflow', exact: true }).click()
    await flow.getByRole('button', { name: /Human review .*Awaiting confirmation/ }).waitFor()
    await flow.getByRole('button', { name: 'Approve and continue', exact: true }).click()
    await flow.getByRole('button', { name: /Human review .*Succeeded/ }).waitFor()
    await page.getByRole('button', { name: 'Templates', exact: true }).click()
    await main.getByRole('button', { name: /Approval template/ }).click()
    for (const width of [320, 375, 414, 768, 1680]) {
      await page.setViewportSize({ width, height: 1000 })
      await expect.poll(() => main.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    }
    const aria = await captureStableAria(page, 'main', scaffold.workspaceCwd)
    await compareOrRefreshGolden(join(snapshots, 'library.expected.md'), aria, webSnapshotMode())
    await page.screenshot({ path: '/tmp/dsh-work-templates.png', fullPage: true })
  })
  it('renders retained templates in Chinese and dark mode', async () => {
    const chinese = await browser.newPage({ viewport: { width: 1680, height: 1000 }, locale: 'zh-CN' })
    try {
      await chinese.emulateMedia({ colorScheme: 'dark' })
      await chinese.goto(scaffold.baseUrl)
      await chinese.getByRole('button', { name: '模板库', exact: true }).click()
      const library = chinese.getByRole('main', { name: '模板库', exact: true })
      await library.getByRole('button', { name: /Approval template/ }).click()
      await library.getByRole('button', { name: '创建独立工作流草稿', exact: true }).waitFor()
      await chinese.screenshot({ path: '/tmp/dsh-work-templates-zh.png', fullPage: true })
    } finally { await chinese.close() }
  })

  it('retries a committed template write exactly after a lost response and an intake remount', async () => {
    await page.getByRole('button', { name: 'Work Center', exact: true }).click()
    const main = page.getByRole('main', { name: 'Work Center', exact: true })
    await main.getByRole('button', { name: 'New task', exact: true }).click()
    const form = main.locator('form')
    await form.getByText('Task templates', { exact: true }).click()
    await form.getByRole('combobox', { name: 'Choose a template', exact: true }).selectOption({ label: 'Reusable review' })
    await form.getByRole('textbox', { name: 'Task goal', exact: true }).fill('Recover a saved review after a lost acknowledgment')
    await form.getByLabel('Template name', { exact: true }).fill('Recovered review')
    let dropResponse = true
    const endpoint = '**/api/workTemplateGateway/command'
    await page.route(endpoint, async (route) => {
      if (!dropResponse) { await route.continue(); return }
      dropResponse = false
      await route.fetch()
      await route.abort('failed')
    })
    try {
      await form.getByRole('button', { name: 'Save new version', exact: true }).click()
      await form.getByRole('alert').waitFor()
      await expect.poll(async () => (await scaffold.ctx.workTemplates.list()).find(item => item.name === 'Recovered review')?.version).toBe(3)
      const recovery = form.getByRole('button', { name: 'Discard retry and refresh', exact: true }).locator('..')
      await compareOrRefreshGolden(join(snapshots, 'retry.expected.md'), await recovery.ariaSnapshot(), webSnapshotMode())
      await form.getByRole('button', { name: 'Close and retain draft', exact: true }).click()
      await main.getByRole('button', { name: 'New task', exact: true }).click()
      await form.getByText('Task templates', { exact: true }).click()
      await form.getByRole('button', { name: 'Save new version', exact: true }).click()
      await form.getByText('Saved', { exact: true }).waitFor()
      expect((await scaffold.ctx.workTemplates.list()).find(item => item.name === 'Recovered review')?.version).toBe(3)
    } finally { await page.unroute(endpoint) }
  })

})
