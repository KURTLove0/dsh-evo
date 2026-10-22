/** Real failure evidence, full retry identity recovery, and preserved verification semantics. */
import { chromium, type Browser, type Page } from 'playwright'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { LlmError } from '@deepseek-ai/dsh-llm'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { MockAdapter, textResponse, toolCallResponse } from '../../../packages/core/agent-loop/tests/mock-adapter.ts'
import { launchWebScaffold, watchConsole, captureStableAria, compareOrRefreshGolden, webSnapshotMode, type WebScaffold } from './scaffold.ts'
import { newEnglishPage } from './support.ts'

const snapshots = fileURLToPath(new URL('./snapshots/work-diagnosis', import.meta.url))
describe('web e2e: evidenced diagnosis and explicit full retry', () => {
  let scaffold: WebScaffold, browser: Browser, page: Page
  let tripwire: ReturnType<typeof watchConsole>
  let agentId: Awaited<ReturnType<WebScaffold['ctx']['workbenchAgents']['command']>>['agentId']
  let workspaceId: Awaited<ReturnType<WebScaffold['ctx']['workspaceRegistry']['create']>>['id']
  let failureId: NonNullable<Awaited<ReturnType<WebScaffold['ctx']['workbenchAgents']['command']>>['runId']>
  const adapter = new MockAdapter([
    () => { throw new LlmError('Fixture authentication rejected', 'AUTH', { status: 401 }) },
    textResponse('Recovered task output'),
    toolCallResponse('denied-call', 'diagnostic_echo', { text: 'private-tool-argument' }),
    textResponse('Finished without the denied tool'),
  ])
  const workflowAdapter = new MockAdapter([textResponse('Incomplete acceptance output'), textResponse('EXPECTED ACCEPTANCE')])
  let toolBodies = 0
  beforeAll(async () => {
    scaffold = await launchWebScaffold({ toolsMode: 'native' })
    workspaceId = (await scaffold.ctx.workspaceRegistry.create(scaffold.workspaceCwd)).id
    scaffold.ctx.llm.registerAdapter(['diagnostic-test'], adapter)
    scaffold.ctx.llm.registerAdapter(['diagnostic-workflow'], workflowAdapter)
    scaffold.ctx.llm.registerConfigurableProviders([{ provider: 'diagnostic-test', displayName: 'Diagnostic runtime',
      settingsNs: '', settingsPath: [], localCommand: process.execPath, defaultModel: 'mock' }])
    scaffold.ctx.tools.register({ name: 'diagnostic_echo', description: 'An observable fixture tool.',
      parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
      execute: async () => { toolBodies++; return 'Tool body ran' } })
    scaffold.ctx.on('tools/pre-execute', async (execution, next) => execution.name === 'diagnostic_echo'
      ? { kind: 'deny', reason: 'Fixture tool access refused' } : next())
    agentId = (await scaffold.ctx.workbenchAgents.command({ kind: 'create', definition: { name: 'Diagnostic reviewer', avatar: '',
      description: '', instructions: 'Follow the requested task.', runtime: 'diagnostic-test', skills: [], mcpServers: [], starters: [], concurrency: 1 } })).agentId
    failureId = (await scaffold.ctx.workbenchAgents.command({ kind: 'run', id: agentId, workspaceId, prompt: 'Inspect an authentication failure' })).runId!
    browser = await chromium.launch(); page = await newEnglishPage(browser)
    tripwire = watchConsole(page); page.setDefaultTimeout(15000)
    await page.emulateMedia({ colorScheme: 'dark' }); await page.goto(scaffold.baseUrl)
  }, 120000)
  afterAll(async () => { await browser?.close(); await scaffold?.close() })
  const main = () => page.getByRole('main', { name: 'Work Center', exact: true })
  const diagnosis = () => main().getByRole('region', { name: 'Result and failure diagnosis', exact: true })
  async function select(prompt: string, status?: string) {
    const rows = main().getByRole('region', { name: 'Runs', exact: true }).getByRole('button').filter({ hasText: prompt })
    await (status === undefined ? rows : rows.filter({ hasText: status })).click()
    await diagnosis().getByRole('button', { name: 'Read diagnostic evidence', exact: true }).click()
    await diagnosis().getByText('Observed at:', { exact: false }).waitFor()
  }
  async function golden(name: string) {
    const aria = (await captureStableAria(page, '[aria-label="Result and failure diagnosis"]', scaffold.workspaceCwd))
      .replace(/\d{1,2}\/\d{1,2}\/\d{4}, \{\{clock\}\}/g, '{{timestamp}}')
    await compareOrRefreshGolden(join(snapshots, name), aria, webSnapshotMode())
  }
  it('reads original authentication evidence and recovers one committed retry after its response is lost and the page remounts', async () => {
    await expect.poll(async () => (await scaffold.ctx.workbenchAgents.inspectRun(failureId)).status).toBe('failed')
    onTestFailed(async () => { console.error(await page.locator('body').ariaSnapshot(), tripwire.pageErrors) })
    await page.getByRole('button', { name: 'Work Center', exact: true }).click()
    await select('Inspect an authentication failure')
    await diagnosis().getByRole('heading', { name: 'Authentication failure · Session turn', exact: true }).waitFor()
    await diagnosis().getByText('HTTP 401', { exact: true }).waitFor()
    expect(adapter.requests).toHaveLength(1)
    await golden('authentication.expected.md')
    await diagnosis().getByRole('button', { name: 'Open model settings', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
    await diagnosis().getByRole('button', { name: 'Prepare full retry', exact: true }).click()
    const confirmation = () => diagnosis().getByRole('region', { name: 'Confirm full retry', exact: true })
    let admissions = 0, loseResponse = true
    await page.route('**/api/workCenterGateway/command', async (route) => {
      admissions++
      if (loseResponse) { loseResponse = false; await route.fetch(); await route.abort('failed') }
      else await route.continue()
    })
    await confirmation().getByRole('button', { name: 'Confirm full retry', exact: true }).click()
    await confirmation().getByRole('alert').waitFor()
    await expect.poll(async () => (await scaffold.ctx.workbenchAgents.queryRuns({ limit: 10 })).items.length).toBe(2)
    await page.getByRole('button', { name: 'Configure agents', exact: true }).click()
    await page.getByRole('button', { name: 'Work Center', exact: true }).click()
    await confirmation().getByText(/This request was submitted before/).waitFor()
    await confirmation().getByRole('button', { name: 'Recover original retry request', exact: true }).click()
    await confirmation().waitFor({ state: 'detached' })
    await main().getByText('Recovered task output', { exact: true }).waitFor()
    expect(admissions).toBe(2)
    expect(adapter.requests).toHaveLength(2)
    const retried = (await scaffold.ctx.workbenchAgents.queryRuns({ limit: 10 })).items.find(run => run.retryOf === failureId)!
    expect(retried.retryRequest).toBeDefined()
    expect((await scaffold.ctx.workbenchAgents.inspectRun(failureId)).status).toBe('failed')
    await page.unroute('**/api/workCenterGateway/command')
  })
  it('keeps a denied tool as observed evidence when the execution succeeds and never shows its arguments as diagnostic text', async () => {
    const runId = (await scaffold.ctx.workbenchAgents.command({ kind: 'run', id: agentId, workspaceId, prompt: 'Observe a denied tool' })).runId!
    await expect.poll(async () => (await scaffold.ctx.workbenchAgents.inspectRun(runId)).status).toBe('completed')
    await select('Observe a denied tool')
    await diagnosis().getByRole('heading', { name: 'Permission or policy denial · Tool result', exact: true }).waitFor()
    await diagnosis().getByText('Observed evidence; not an independent root-cause claim', { exact: true }).waitFor()
    expect(await diagnosis().getByRole('button', { name: 'Prepare full retry', exact: true }).isEnabled()).toBe(false)
    expect(await diagnosis().innerText()).not.toContain('private-tool-argument')
    expect(toolBodies).toBe(0)
    expect(adapter.requests).toHaveLength(4)
    await golden('denied-tool.expected.md')
  })
  it('retries a failed acceptance case as a new verification run with its original publication, inputs, and assertion', async () => {
    await scaffold.ctx.settings.update(settingsNamespace('agent-default-model'), { provider: 'diagnostic-workflow', model: 'mock' })
    const source = await scaffold.ctx.workflowWorkbench.command({ kind: 'create', workspaceId, name: 'Diagnostic verification', description: 'Validate one case' })
    const definition = { requirement: { summary: 'Verify output', objectives: [{ id: 'verify', statement: 'Return the acceptance phrase' }],
      inputs: [{ name: 'input', description: 'Case input' }], outputs: [{ name: 'result', description: 'Case result' }], constraints: [],
      acceptanceCases: [{ name: 'sample', given: { input: 'Original input' }, expect: { kind: 'contains' as const, value: 'EXPECTED ACCEPTANCE' } }] },
    nodes: [{ id: 'verify', kind: 'agent' as const, title: 'Verify output', instruction: 'Return the requested output.', preset: 'standard', dependsOn: [],
      inputs: [{ name: 'input', source: { kind: 'requirement' as const, field: 'input' } }], objectives: ['verify'] }],
    finalOutputs: [{ name: 'result', source: { kind: 'step' as const, step: 'verify' } }], positions: {} }
    await scaffold.ctx.workflowWorkbench.command({ kind: 'save', id: source.workflowId, expectedRevision: 1, name: 'Diagnostic verification', definition })
    await scaffold.ctx.workflowWorkbench.command({ kind: 'publish', id: source.workflowId, expectedRevision: 2 })
    const publication = (await scaffold.ctx.workflowWorkbench.snapshot(source.workflowId)).workflows[0]!.versions[0]!
    const originalId = (await scaffold.ctx.workflowWorkbench.command({ kind: 'verify', id: source.workflowId, versionId: publication.id })).runIds![0]!
    await expect.poll(async () => (await scaffold.ctx.workflowWorkbench.inspectRun(originalId)).assertion?.passed).toBe(false)
    await select('Diagnostic verification')
    await diagnosis().getByRole('heading', { name: 'Acceptance assertion failed · Acceptance check', exact: true }).waitFor()
    await diagnosis().getByRole('button', { name: 'Prepare full retry', exact: true }).click()
    await diagnosis().getByRole('region', { name: 'Confirm full retry', exact: true }).getByRole('button', { name: 'Confirm full retry', exact: true }).click()
    await expect.poll(async () => (await scaffold.ctx.workflowWorkbench.queryRuns({ limit: 10 })).items.length).toBe(2)
    const next = (await scaffold.ctx.workflowWorkbench.queryRuns({ limit: 10 })).items.find(run => run.id !== originalId)!
    await expect.poll(async () => (await scaffold.ctx.workflowWorkbench.inspectRun(next.id)).assertion?.passed).toBe(true)
    const retried = await scaffold.ctx.workflowWorkbench.inspectRun(next.id)
    expect(retried).toMatchObject({ rerunOf: originalId, mode: 'verification', caseName: 'sample', inputs: { input: 'Original input' }, version: { id: publication.id } })
    expect(workflowAdapter.requests).toHaveLength(2)
    expect(tripwire.pageErrors).toEqual([])
  })
  it('marks held evidence stale on refresh and keeps diagnostic controls readable at narrow widths and in Chinese', async () => {
    await select('Inspect an authentication failure', 'Failed')
    const calls = adapter.requests.length + workflowAdapter.requests.length
    await main().getByRole('button', { name: 'Refresh', exact: true }).click()
    await diagnosis().getByText('These are last-known diagnostic results and may be stale. Reconnect or read again.', { exact: true }).waitFor()
    expect(adapter.requests.length + workflowAdapter.requests.length).toBe(calls)
    await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click()
    for (const width of [320, 375, 414, 768, 1680]) {
      await page.setViewportSize({ width, height: 1000 })
      await expect.poll(() => main().evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    }
    const chinese = await browser.newPage({ viewport: { width: 1680, height: 1000 }, locale: 'zh-CN' })
    try {
      await chinese.emulateMedia({ colorScheme: 'dark' }); await chinese.goto(scaffold.baseUrl)
      await chinese.getByRole('button', { name: '工作中心', exact: true }).click()
      const work = chinese.getByRole('main', { name: '工作中心', exact: true })
      await work.getByRole('region', { name: '运行记录', exact: true }).getByRole('button').filter({ hasText: 'Inspect an authentication failure' }).filter({ hasText: '失败' }).click()
      const report = work.getByRole('region', { name: '结果与失败诊断', exact: true })
      await report.getByRole('button', { name: '读取诊断证据', exact: true }).click()
      await report.getByRole('heading', { name: '认证失败 · 会话轮次', exact: true }).waitFor()
      await report.scrollIntoViewIfNeeded()
      await chinese.screenshot({ path: '/tmp/dsh-work-diagnosis-zh.png', fullPage: true })
      await chinese.getByRole('button', { name: '收起侧边栏', exact: true }).click()
      await chinese.setViewportSize({ width: 375, height: 1000 })
      await expect.poll(() => work.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    } finally { await chinese.close() }
    expect(tripwire.pageErrors).toEqual([])
  })
})
