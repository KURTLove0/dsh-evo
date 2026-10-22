/** Explicit configuration checks and recoverable, tool-free temporary MCP probes in the shipped composition. */
import { chromium, type Browser, type Page } from 'playwright'
import { access, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import z from '@deepseek-ai/schemastery'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { MockAdapter } from '../../../packages/core/agent-loop/tests/mock-adapter.ts'
import { launchWebScaffold, watchConsole, captureStableAria, compareOrRefreshGolden, webSnapshotMode, type WebScaffold } from './scaffold.ts'
import { newEnglishPage } from './support.ts'

const snapshots = fileURLToPath(new URL('./snapshots/capability-health', import.meta.url))
const server = fileURLToPath(new URL('../../../packages/mcp/mcp-client/tests/probe-server.mjs', import.meta.url))
describe('web e2e: capability configuration and temporary connection checks', () => {
  let scaffold: WebScaffold, browser: Browser, page: Page
  let agent: Awaited<ReturnType<WebScaffold['ctx']['workbenchAgents']['snapshot']>>['agents'][number]
  const adapter = new MockAdapter([])
  let tripwire: ReturnType<typeof watchConsole>
  const pidFile = (name: string) => join(scaffold.workspaceCwd, `${name}.pid`)
  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    await scaffold.ctx.workspaceRegistry.create(scaffold.workspaceCwd)
    scaffold.ctx.llm.registerAdapter(['health-test'], adapter)
    const ns = settingsNamespace('health-test')
    scaffold.ctx.settings.register(ns, z.object({ apiKeyEnv: z.string().default('HEALTH_TEST_KEY') }))
    await scaffold.ctx.credentials.set(credentialRef('HEALTH_TEST_KEY'), 'credential-secret-never-visible')
    scaffold.ctx.llm.registerConfigurableProviders([
      { provider: 'health-test', displayName: 'Health executor', settingsNs: ns, settingsPath: [], localCommand: process.execPath, defaultModel: 'mock' },
      { provider: 'missing-health-command', displayName: 'Missing test runtime', settingsNs: '', settingsPath: [], localCommand: 'dsh-command-that-does-not-exist' },
    ])
    const result = await scaffold.ctx.workbenchAgents.command({ kind: 'create', definition: { name: 'Health reviewer', avatar: '', description: '', instructions: 'Review input.', runtime: 'health-test', skills: ['missing-health-skill'], starters: [], concurrency: 1,
      mcpServers: ['ok', 'reject', 'hang'].map(name => ({ name, transport: 'stdio', command: process.execPath, args: [server, name],
        env: [{ name: 'DSH_PROBE_PID_FILE', value: pidFile(name) }, { name: 'PROBE_SECRET', value: 'probe-secret-never-visible' }] })) } })
    agent = (await scaffold.ctx.workbenchAgents.snapshot(result.agentId)).agents[0]!
    browser = await chromium.launch(); page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    page.setDefaultTimeout(15000); await page.goto(scaffold.baseUrl)
  }, 120000)
  afterAll(async () => { await browser?.close(); await scaffold?.close() })
  const main = () => page.getByRole('main', { name: 'Capability checks', exact: true })
  const connections = () => main().getByRole('region', { name: 'MCP connection checks', exact: true })
  const history = () => main().getByRole('region', { name: 'Connection probes started by this app', exact: true })
  const card = (name: string) => connections().getByRole('listitem').filter({ has: page.getByRole('heading', { name, exact: true }) })
  async function check() {
    await expect.poll(() => main().getByRole('button', { name: 'Refresh executor list', exact: true }).isEnabled()).toBe(true)
    await main().getByRole('combobox', { name: 'Executor', exact: true }).selectOption({ label: 'Health reviewer' })
    await main().getByRole('combobox', { name: 'Workspace', exact: true }).selectOption({ index: 1 })
    await main().getByRole('button', { name: 'Check selected executor', exact: true }).click()
    await card('ok').getByRole('button', { name: /Probe connection/ }).waitFor()
    await expect.poll(() => card('ok').getByRole('button', { name: /Probe connection/ }).isEnabled(), { timeout: 15000 }).toBe(true)
  }
  async function exited(name: string) {
    const pid = Number(await readFile(pidFile(name), 'utf8'))
    expect(() => process.kill(pid, 0)).toThrow()
  }
  it('separates configuration, missing dependencies, credentials, and untested connections without executing a task', async () => {
    onTestFailed(async () => { console.error(await page.locator('body').ariaSnapshot(), tripwire.pageErrors, tripwire.warnings) })
    await page.getByRole('button', { name: 'Capability checks', exact: true }).click()
    await main().getByText('No configuration check has run.', { exact: true }).waitFor()
    for (const name of ['ok', 'reject', 'hang']) await expect(access(pidFile(name))).rejects.toThrow()
    await check()
    await main().getByText('Credential is configured; validity is unverified.', { exact: true }).waitFor()
    await main().getByText('Selected skill availability could not be confirmed. Inspect skill and agent configuration.', { exact: true }).waitFor()
    await main().getByText('The executable does not resolve on this host.', { exact: true }).waitFor()
    expect(await main().innerText()).not.toContain('credential-secret')
    expect(await main().innerText()).not.toContain('probe-secret')
    expect(adapter.requests).toEqual([])
    expect((await scaffold.ctx.workbenchAgents.queryRuns({ limit: 1 })).items).toEqual([])
    for (const name of ['ok', 'reject', 'hang']) await expect(access(pidFile(name))).rejects.toThrow()
    await compareOrRefreshGolden(join(snapshots, 'untested.expected.md'), await connections().ariaSnapshot(), webSnapshotMode())
    await card('ok').getByRole('button', { name: 'Probe connection', exact: true }).click()
    await history().getByText('Connection responded', { exact: true }).waitFor()
    await history().getByText('Temporary connection closed', { exact: true }).waitFor()
    await exited('ok')
    await card('reject').getByRole('button', { name: 'Probe connection', exact: true }).click()
    await history().getByText('Failed', { exact: true }).waitFor()
    await expect.poll(() => history().getByText('Temporary connection closed', { exact: true }).count()).toBe(2)
    await exited('reject')
    const aria = (await captureStableAria(page, '[aria-label="Connection probes started by this app"]', scaffold.workspaceCwd))
      .replace(/\d{1,2}\/\d{1,2}\/\d{4}, \{\{clock\}\}/g, '{{timestamp}}')
    await compareOrRefreshGolden(join(snapshots, 'completed.expected.md'), aria, webSnapshotMode())
    expect(tripwire.pageErrors).toEqual([])
  })
  it('recovers a lost admission response after remount and cancels the same host-owned probe without resubmission', async () => {
    let admissions = 0
    await page.route('**/api/capabilityHealthGateway/startProbe', async (route) => {
      admissions++
      await route.fetch(); await route.abort('failed')
    })
    await card('hang').getByRole('button', { name: 'Probe connection', exact: true }).click()
    await expect.poll(async () => { try { await access(pidFile('hang')); return true } catch { return false } }).toBe(true)
    await main().getByRole('button', { name: 'Configure agents', exact: true }).click()
    await page.getByRole('button', { name: 'Capability checks', exact: true }).click()
    await history().getByRole('button', { name: 'Refresh existing probe results', exact: true }).click()
    await history().getByRole('button', { name: 'Cancel probe', exact: true }).click()
    await history().getByText('Cancelled', { exact: true }).waitFor()
    await expect.poll(() => history().getByText('Temporary connection closed', { exact: true }).count()).toBe(3)
    await exited('hang')
    expect(admissions).toBe(1)
    expect(adapter.requests).toEqual([])
    expect(await main().innerText()).not.toContain('probe-secret')
    await page.unroute('**/api/capabilityHealthGateway/startProbe')
  })
  it('invalidates held observations after a saved edit, opens existing settings, and fits narrow screens', async () => {
    onTestFailed(async () => { console.error(await page.locator('body').ariaSnapshot(), tripwire.pageErrors) })
    const { id: _id, revision: _revision, archived: _archived, createdAt: _createdAt, updatedAt: _updatedAt, ...definition } = agent
    await scaffold.ctx.workbenchAgents.command({ kind: 'save', id: agent.id, revision: agent.revision, definition: { ...definition, description: 'Changed configuration' } })
    await main().getByText('Configuration or selection changed. These are last-known results; check again.', { exact: true }).waitFor()
    expect(await card('ok').getByRole('button', { name: 'Probe connection again', exact: true }).isEnabled()).toBe(false)
    await check()
    await main().getByRole('button', { name: 'Open runtime settings', exact: true }).first().click()
    await page.getByRole('dialog').waitFor()
    await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
    for (const width of [320, 375, 414, 768, 1680]) {
      await page.setViewportSize({ width, height: 1000 })
      await expect.poll(() => main().evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    }
    await page.screenshot({ path: '/tmp/dsh-capability-health.png', fullPage: true })
    const chinese = await browser.newPage({ viewport: { width: 1680, height: 1000 }, locale: 'zh-CN' })
    try {
      await chinese.emulateMedia({ colorScheme: 'dark' })
      await chinese.goto(scaffold.baseUrl)
      await chinese.getByRole('button', { name: '能力检查', exact: true }).click()
      const health = chinese.getByRole('main', { name: '能力检查', exact: true })
      await health.getByRole('combobox', { name: '执行者', exact: true }).selectOption({ label: 'Health reviewer' })
      await health.getByRole('combobox', { name: '工作区', exact: true }).selectOption({ index: 1 })
      await health.getByRole('button', { name: '检查所选执行者', exact: true }).click()
      await health.getByText('凭证已配置；未验证有效性。', { exact: true }).waitFor()
      await chinese.screenshot({ path: '/tmp/dsh-capability-health-zh.png', fullPage: true })
    } finally { await chinese.close() }
    expect(adapter.requests).toEqual([])
  })
})
