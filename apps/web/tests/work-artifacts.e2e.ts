/** Immutable project captures through the real Web composition, execution loop, and filesystem. */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { MockAdapter, textResponse, toolCallResponse } from '../../../packages/core/agent-loop/tests/mock-adapter.ts'
import { launchWebScaffold, watchConsole, captureStableAria, compareOrRefreshGolden, webSnapshotMode, type WebScaffold } from './scaffold.ts'
import { newEnglishPage } from './support.ts'
const snapshots = fileURLToPath(new URL('./snapshots/work-artifacts', import.meta.url))
const original = '<script>globalThis.artifactExecuted=true</script>\nRetained report A'
describe('web e2e: explicit project artifacts', () => {
  let scaffold: WebScaffold, browser: Browser, page: Page, adapter: MockAdapter
  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    await scaffold.ctx.workspaceRegistry.create(scaffold.workspaceCwd)
    adapter = new MockAdapter([toolCallResponse('create-artifacts', 'bash', { command: `printf '%s' '${original}' > report.html\nprintf '%s' 'Terminal output retained' > terminal.txt`, description: 'Create report and terminal output' }), textResponse('Report files created through the terminal.')])
    scaffold.ctx.llm.registerAdapter(['artifact-test'], adapter)
    scaffold.ctx.llm.registerConfigurableProviders([{ provider: 'artifact-test', displayName: 'Artifact executor', settingsNs: '', settingsPath: [], localCommand: process.execPath, defaultModel: 'mock' }])
    await scaffold.ctx.workbenchAgents.command({ kind: 'create', definition: { name: 'Artifact producer', avatar: '', description: '', instructions: 'Create the requested files.', runtime: 'artifact-test', skills: [], mcpServers: [], starters: [], concurrency: 1 } })
    await mkdir(snapshots, { recursive: true })
    browser = await chromium.launch(); page = await newEnglishPage(browser); page.setDefaultTimeout(15000)
    page.on('pageerror', (error) => { console.error('Browser error:', error.message) })
    page.on('console', (event) => { if (event.type() === 'error') console.error('Browser console:', event.text()) })
    await page.goto(scaffold.baseUrl)
  }, 120000)
  afterAll(async () => { await browser?.close(); await scaffold?.close() })
  it('captures real terminal output and promotes retained accepted bytes after the current file is removed', async () => {
    const console = watchConsole(page)
    onTestFailed(async () => { globalThis.console.error(await page.locator('body').ariaSnapshot(), console.pageErrors) })
    await page.getByRole('button', { name: 'Work Center', exact: true }).click()
    const main = page.getByRole('main', { name: 'Work Center', exact: true })
    await main.getByRole('button', { name: 'New task', exact: true }).click()
    const form = main.locator('form')
    await form.getByRole('combobox', { name: 'Executor', exact: true }).selectOption({ label: 'Artifact producer' })
    await form.getByRole('combobox', { name: 'Workspace', exact: true }).selectOption({ index: 1 })
    await form.getByLabel('Task goal', { exact: true }).fill('Create report.html and terminal.txt')
    await form.getByLabel('Expected file paths (one per line, optional)', { exact: true }).fill('report.html')
    await form.getByRole('button', { name: 'Check and preview', exact: true }).click()
    await form.getByText('Basic dependency checks passed', { exact: true }).waitFor()
    await form.getByRole('button', { name: 'Confirm task submission', exact: true }).click()
    await form.waitFor({ state: 'detached' })
    await main.getByText('Report files created through the terminal.', { exact: true }).waitFor()
    expect(await readFile(join(scaffold.workspaceCwd, 'report.html'), 'utf8')).toBe(original)
    await main.getByRole('button', { name: 'Accept delivery', exact: true }).click()
    await expect.poll(async () => (await scaffold.ctx.workCenter.detail({ kind: 'agent', id: (await scaffold.ctx.workbenchAgents.queryRuns({ limit: 1 })).items[0]!.id })).review?.decision).toBe('accepted')
    await rm(join(scaffold.workspaceCwd, 'report.html'))
    await main.getByRole('button', { name: 'Register project artifact', exact: true }).click()
    const capture = main.getByRole('form', { name: 'Register project artifact', exact: true })
    await capture.getByRole('combobox', { name: 'Capture origin', exact: true }).selectOption('accepted-review')
    await capture.getByRole('combobox', { name: 'Accepted review file', exact: true }).selectOption({ index: 1 })
    await capture.getByRole('button', { name: 'Register file snapshot', exact: true }).click()
    await main.getByRole('button', { name: 'View registered version', exact: true }).click()
    const directory = page.getByRole('main', { name: 'Project artifacts', exact: true })
    await directory.locator('pre').getByText(original, { exact: true }).waitFor()
    await directory.getByRole('button', { name: 'Inspect current file', exact: true }).click()
    await directory.getByRole('heading', { name: 'Current file is missing', exact: true }).waitFor()
    expect(await page.evaluate(() => Reflect.get(globalThis, 'artifactExecuted') as unknown)).toBeUndefined()
    expect(console.pageErrors).toEqual([]); expect(adapter.requests).toHaveLength(2)
  })
  it('retains accepted history while a new current-file version has independent provenance', async () => {
    const directory = page.getByRole('main', { name: 'Project artifacts', exact: true })
    await writeFile(join(scaffold.workspaceCwd, 'report.html'), 'Current report B')
    await directory.getByRole('button', { name: 'Inspect current file', exact: true }).click()
    await directory.getByRole('heading', { name: 'This read differs from the selected snapshot', exact: true }).waitFor()
    await directory.getByRole('button', { name: 'Register current file as a new version', exact: true }).click()
    await directory.getByText('Current report B', { exact: true }).waitFor()
    const versions = directory.getByRole('combobox', { name: 'Immutable capture version', exact: true })
    expect(await versions.inputValue()).toBe('2')
    await versions.selectOption('1'); await directory.locator('pre').getByText(original, { exact: true }).waitFor()
    await page.reload(); await page.getByRole('button', { name: 'Project artifacts', exact: true }).click()
    await directory.getByRole('button', { name: /^report.html/ }).click()
    await directory.getByRole('combobox', { name: 'Immutable capture version', exact: true }).selectOption('1')
    await directory.locator('pre').getByText(original, { exact: true }).waitFor()
    const entry = (await scaffold.ctx.workArtifacts.query({ text: '', limit: 25 })).items[0]!
    expect((await scaffold.ctx.workArtifacts.read(entry.id, 1)).snapshot.origin.kind).toBe('accepted-review')
    expect((await scaffold.ctx.workArtifacts.read(entry.id, 2)).snapshot.origin.kind).toBe('current-file')
    expect(adapter.requests).toHaveLength(2)
  })
  it('recovers a committed registration with identical inputs after losing its response and remounting', async () => {
    await page.getByRole('button', { name: 'Work Center', exact: true }).click()
    const main = page.getByRole('main', { name: 'Work Center', exact: true })
    await main.getByRole('region', { name: 'Runs', exact: true }).getByRole('button', { name: /Artifact producer/ }).click()
    await main.getByRole('button', { name: 'Register project artifact', exact: true }).click()
    const form = main.getByRole('form', { name: 'Register project artifact', exact: true })
    await form.getByRole('combobox', { name: 'Capture origin', exact: true }).selectOption('current-file')
    await form.getByRole('textbox', { name: 'Registered file path', exact: true }).fill('terminal.txt')
    const endpoint = '**/api/workArtifactGateway/register'; let drop = true
    await page.route(endpoint, async (route) => { if (!drop) { await route.continue(); return }; drop = false; await route.fetch(); await route.abort('failed') })
    try {
      await form.getByRole('button', { name: 'Register file snapshot', exact: true }).click()
      await main.getByRole('alert').waitFor()
      await expect.poll(async () => (await scaffold.ctx.workArtifacts.query({ text: 'terminal.txt', limit: 25 })).items.length).toBe(1)
      await page.getByRole('button', { name: 'Project artifacts', exact: true }).click()
      const directory = page.getByRole('main', { name: 'Project artifacts', exact: true })
      await directory.getByRole('button', { name: 'Recover original registration', exact: true }).click()
      await directory.getByRole('region', { name: 'Unconfirmed registration request', exact: true }).waitFor({ state: 'detached' })
      const entry = (await scaffold.ctx.workArtifacts.query({ text: 'terminal.txt', limit: 25 })).items[0]!
      expect(entry.latest.version).toBe(1)
      expect((await scaffold.ctx.workArtifacts.read(entry.id, 1)).snapshot.content).toBe('Terminal output retained')
      expect(adapter.requests).toHaveLength(2)
    } finally { await page.unroute(endpoint) }
  })
  it('filters latest metadata, renders binary safely, and remains usable at narrow widths in both themes', async () => {
    const run = (await scaffold.ctx.workbenchAgents.queryRuns({ limit: 1 })).items[0]!
    await writeFile(join(scaffold.workspaceCwd, 'data.bin'), Buffer.from([0, 255, 1]))
    await scaffold.ctx.workArtifacts.register({ path: 'data.bin', expectedVersion: 0, requestId: 'binary' as never, source: { kind: 'current-file', ref: { kind: 'agent', id: run.id } } })
    const directory = page.getByRole('main', { name: 'Project artifacts', exact: true })
    await directory.getByRole('button', { name: /^data.bin/ }).click()
    await directory.getByText('Binary file: original bytes are retained without execution or rendering here.', { exact: true }).waitFor()
    const filters = directory.getByRole('form', { name: 'Project artifact filters', exact: true })
    await filters.getByRole('combobox', { name: 'Latest capture origin', exact: true }).selectOption('accepted-review')
    await filters.getByRole('button', { name: 'Apply filters', exact: true }).click()
    await directory.getByText('No registered artifacts match the submitted filters.', { exact: true }).waitFor()
    await filters.getByRole('combobox', { name: 'Latest capture origin', exact: true }).selectOption('all')
    await filters.getByRole('button', { name: 'Apply filters', exact: true }).click()
    await directory.getByRole('button', { name: /^data.bin/ }).waitFor()
    for (const width of [320, 375, 414, 768, 1680]) {
      await page.setViewportSize({ width, height: 1000 })
      await expect.poll(() => directory.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    }
    const aria = await captureStableAria(page, 'section[aria-label="Registered files"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(join(snapshots, 'directory.expected.md'), aria, webSnapshotMode())
    const chinese = await browser.newPage({ viewport: { width: 1680, height: 1000 }, locale: 'zh-CN' })
    try {
      await chinese.goto(scaffold.baseUrl); await chinese.getByRole('button', { name: '项目产物', exact: true }).click()
      const main = chinese.getByRole('main', { name: '项目产物', exact: true })
      await main.getByRole('button', { name: /^report.html/ }).click()
      await main.getByRole('combobox', { name: '不可变捕获版本', exact: true }).selectOption('1')
      await main.locator('pre').getByText(original, { exact: true }).waitFor()
      for (const theme of ['dark', 'light'] as const) {
        await chinese.emulateMedia({ colorScheme: theme })
        await expect.poll(() => chinese.locator('body').getAttribute('data-ds-dark-theme')).toBe(theme === 'dark' ? '' : null)
        await chinese.screenshot({ path: `/tmp/dsh-work-artifacts-${theme}-zh.png`, fullPage: true })
      }
    } finally { await chinese.close() }
    expect(adapter.requests).toHaveLength(2)
  })
})
