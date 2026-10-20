/** Create a prompt/skill/MCP business agent and verify its real file output through the shipped app. */
import { mkdir, mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  captureStableAria, compareOrRefreshGolden, launchWebScaffold, watchConsole,
  webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOTS = fileURLToPath(new URL('./snapshots/agents-business', import.meta.url))
const BUSINESS_SERVER = fileURLToPath(new URL('../../../packages/business/workbench-agent/tests/business-mcp-server.mjs', import.meta.url))
const MODE = webSnapshotMode()

describe('web e2e: business agent construction', () => {
  let overlayRoot: string
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>
  beforeAll(async () => {
    if (MODE === 'record') throw new Error('Business-agent construction uses a scripted keyless model and real MCP tools.')
    overlayRoot = await mkdtemp(join(tmpdir(), 'dsh-agent-runtime-overlay-'))
    const runtimeOverlay = join(overlayRoot, 'overlay.json')
    await writeFile(runtimeOverlay, JSON.stringify([{ id: 'llm-cursor-cli', disabled: true }, { id: 'llm-codex-cli', disabled: true }]))
    scaffold = await launchWebScaffold({ extraOverlayPath: runtimeOverlay, replayFixture: join(SNAPSHOTS, 'session.jsonl'), toolsMode: 'native' })
    scaffold.ctx.llm.registerConfigurableProviders([{ provider: 'deepseek-official', displayName: 'Local scripted runtime', settingsNs: '', settingsPath: [], localCommand: process.execPath, defaultModel: 'deepseek-v4-flash' }])
    const project = join(scaffold.workspaceCwd, 'workspace')
    const skills = join(project, '.agents', 'skills', 'account-review')
    await mkdir(skills, { recursive: true })
    await writeFile(join(skills, 'SKILL.md'), '---\nname: account-review\ndescription: Calculate customer revenue from business records\n---\nUse customer_report to calculate the customer total from business records.\n')
    await writeFile(join(project, 'customers.json'), JSON.stringify([
      { customer: 'Northwind', revenue: 120 }, { customer: 'Northwind', revenue: 80 }, { customer: 'Other', revenue: 999 },
    ]))
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl)
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
  }, 120_000)
  afterAll(async () => {
    await browser?.close(); await scaffold?.close()
    if (overlayRoot) await rm(overlayRoot, { recursive: true, force: true })
  })

  it('saves capabilities, executes the task, and preserves its business result and transcript', async () => {
    onTestFailed(async () => {
      console.error('Business-agent browser errors:', tripwire.pageErrors)
      await saveFailureShot(page, 'agents-business')
    })
    await page.getByRole('button', { name: 'Agents', exact: true }).click()
    const main = page.getByRole('main', { name: 'Agents', exact: true })
    await main.getByRole('button', { name: 'New agent', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Create agent', exact: true })
    await dialog.getByRole('combobox', { name: 'Runtime', exact: true }).selectOption('deepseek-official')
    await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill('Account reviewer')
    await dialog.getByRole('textbox', { name: 'Instructions', exact: false }).fill('Prepare a revenue report for the requested business customer.')
    await dialog.getByRole('checkbox', { name: 'account-review Calculate customer revenue from business records', exact: true }).check()
    await dialog.getByRole('button', { name: 'Add MCP server', exact: true }).click()
    await dialog.getByRole('textbox', { name: 'Server name 1', exact: true }).fill('business')
    await dialog.getByRole('textbox', { name: 'Command 1', exact: true }).fill('node')
    await dialog.getByRole('textbox', { name: 'Arguments 1', exact: false }).fill(BUSINESS_SERVER)
    await dialog.getByRole('button', { name: 'Add variable 1', exact: true }).click()
    await dialog.getByRole('textbox', { name: 'Variable name 1.1', exact: true }).fill('REPORT_PREFIX')
    await dialog.getByLabel('Variable value 1.1', { exact: true }).fill('Customer revenue')
    await dialog.getByRole('navigation', { name: 'Configuration sections', exact: true }).getByRole('button', { name: 'Identity', exact: true }).click()
    const form = (await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd)).replaceAll(BUSINESS_SERVER, '{{businessServer}}')
    await compareOrRefreshGolden(join(SNAPSHOTS, 'create.expected.md'), form, MODE)
    for (const width of [375, 768]) {
      await page.setViewportSize({ width, height: 850 })
      await expect.poll(() => dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
      await expect.poll(async () => {
        const box = await dialog.getByRole('heading', { name: 'Create agent', exact: true }).boundingBox()
        return box !== null && box.y >= 0 && box.y + box.height <= 850
      }).toBe(true)
    }
    await page.setViewportSize({ width: 1680, height: 1000 })
    await dialog.getByRole('button', { name: 'Save', exact: true }).click()
    await dialog.waitFor({ state: 'detached' })
    const directory = await scaffold.ctx.workbenchAgents.snapshot()
    const saved = directory.agents.find(agent => agent.name === 'Account reviewer')!
    expect(saved.skills).toEqual(['account-review'])
    expect(saved.mcpServers).toMatchObject([{ name: 'business', transport: 'stdio', command: 'node', env: [{ name: 'REPORT_PREFIX', value: 'Customer revenue' }] }])
    await main.getByRole('textbox', { name: 'Task', exact: true }).fill('Review Northwind revenue.')
    await main.getByRole('button', { name: 'Start run', exact: true }).click()
    await main.getByRole('article').getByText('Completed', { exact: true }).waitFor()
    expect(await readFile(join(scaffold.workspaceCwd, 'workspace', 'customer-report.txt'), 'utf8')).toBe('Customer revenue: Northwind = 200\n')
    const run = (await scaffold.ctx.workbenchAgents.snapshot(saved.id)).runs[0]!
    const transcript = await scaffold.ctx.sessionPersistence.inspect(run.sessionId)
    const log = JSON.stringify(transcript.events)
    expect(log).toContain('Prepare a revenue report for the requested business customer.')
    expect(log).toContain('Use customer_report to calculate the customer total from business records.')
    expect(log).toContain('Base directory for this skill:')
    expect(log).toContain(join(scaffold.workspaceCwd, 'workspace', '.agents', 'skills', 'account-review'))
    expect(log).toContain('mcp__business__customer_report')
    expect(log).toContain('Customer revenue: Northwind = 200')
    await main.getByRole('article').locator('summary').click()
    await compareOrRefreshGolden(join(SNAPSHOTS, 'captured.expected.md'), await captureStableAria(page, 'main article details', scaffold.workspaceCwd), MODE)
    await main.getByRole('tab', { name: 'Overview', exact: true }).click()
    await main.getByRole('complementary', { name: 'Agent information', exact: true }).waitFor()
    await compareOrRefreshGolden(join(SNAPSHOTS, 'profile-header.expected.md'), await captureStableAria(page, 'main section > header', scaffold.workspaceCwd), MODE)
    await main.getByRole('tab', { name: 'Instructions', exact: true }).click()
    await main.getByRole('tabpanel').getByText('Prepare a revenue report for the requested business customer.', { exact: true }).waitFor()
    await main.getByRole('tab', { name: 'Skills 1', exact: true }).click()
    await main.getByRole('tabpanel').getByText('account-review', { exact: true }).waitFor()
    await main.getByRole('tab', { name: 'MCP servers 1', exact: true }).click()
    await main.getByRole('tabpanel').getByText('node', { exact: true }).waitFor()
    await compareOrRefreshGolden(join(SNAPSHOTS, 'mcp-panel.expected.md'), await captureStableAria(page, 'main [role="tabpanel"]', scaffold.workspaceCwd), MODE)
    await main.getByRole('tab', { name: 'Settings', exact: true }).focus()
    await page.keyboard.press('Home')
    await expect.poll(() => main.getByRole('tab', { name: 'Overview', exact: true }).getAttribute('aria-selected')).toBe('true')
    for (const width of [375, 768]) {
      await page.setViewportSize({ width, height: 850 })
      await expect.poll(() => main.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    }
    await page.setViewportSize({ width: 1680, height: 1000 })
    await page.emulateMedia({ colorScheme: 'dark' })
    await expect.poll(() => page.locator('body').getAttribute('data-ds-dark-theme')).toBe('')
    await page.emulateMedia({ colorScheme: 'light' })
    await main.getByRole('tab', { name: 'Run history', exact: true }).click()
    await main.getByRole('button', { name: 'View conversation', exact: true }).click()
    await page.getByText('Customer report saved.', { exact: true }).waitFor()
    expect(tripwire.pageErrors).toEqual([])
  })

  it('renders the profile and grouped creation form in Chinese', async () => {
    const chinese = await browser.newPage({ viewport: { width: 1680, height: 1000 }, locale: 'zh-CN' })
    try {
      await chinese.goto(scaffold.baseUrl)
      await chinese.getByRole('button', { name: '智能体', exact: true }).click()
      const main = chinese.getByRole('main', { name: '智能体', exact: true })
      await main.getByRole('button', { name: 'Account reviewer', exact: true }).click()
      await main.getByRole('tab', { name: '指令', exact: true }).click()
      await main.getByRole('tabpanel').getByText('Prepare a revenue report for the requested business customer.', { exact: true }).waitFor()
      await main.getByRole('tab', { name: '概览', exact: true }).click()
      await main.getByRole('complementary', { name: '智能体信息', exact: true }).waitFor()
      await main.getByRole('button', { name: '新建智能体', exact: true }).click()
      const dialog = chinese.getByRole('dialog', { name: '创建智能体', exact: true })
      await dialog.getByRole('navigation', { name: '配置章节', exact: true }).waitFor()
      await dialog.getByRole('textbox', { name: '名称', exact: true }).fill('即时零售经营助手')
      expect(await dialog.getByRole('button', { name: '保存', exact: true }).isVisible()).toBe(true)
    } finally {
      await chinese.close()
    }
  })

})
