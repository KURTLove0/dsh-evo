/** Real archived-session recovery over durable workspace membership and Host streams. */
import { mkdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Workspace } from '@deepseek-ai/dsh-workspace'
import { captureStableAria, compareOrRefreshGolden, launchWebScaffold, seedSession, watchConsole, webSnapshotMode, type WebScaffold } from './scaffold.ts'

const snapshots = fileURLToPath(new URL('./snapshots/session-archive', import.meta.url))
const seed = fileURLToPath(new URL('./snapshots/seeded-history/seed.jsonl', import.meta.url))
const ids = ['archive-first', 'archive-second', 'archive-ungrouped'].map(SessionId)
describe('web e2e: archived-session recovery', () => {
  let scaffold: WebScaffold, browser: Browser, page: Page, peer: Page, workspace: Workspace
  let tripwire: ReturnType<typeof watchConsole>, order: readonly SessionId[]
  let cutStreams: () => Promise<void>
  beforeAll(async () => {
    await mkdir(snapshots, { recursive: true })
    scaffold = await launchWebScaffold()
    const text = await readFile(seed, 'utf8')
    for (const [index, id] of ids.entries()) {
      await seedSession(scaffold, text.replaceAll('Use the read tool twice', `Archived report ${index + 1}`), id)
      await scaffold.ctx.sessionProjectionCache.coldSnapshot(id)
    }
    workspace = await scaffold.ctx.workspaceRegistry.create(scaffold.workspaceCwd)
    await workspace.setTitle('Archive project')
    await workspace.attachSession(ids[0]!); await workspace.attachSession(ids[1]!)
    order = [...workspace.sessionIds]
    for (const id of ids) await scaffold.ctx.workspaceRegistry.archiveSession(id)
    browser = await chromium.launch()
    page = await browser.newPage({ locale: 'en-US', viewport: { width: 1680, height: 1100 } })
    peer = await browser.newPage({ locale: 'en-US' })
    await page.routeWebSocket('**/api/events.host', (socket) => {
      const server = socket.connectToServer()
      cutStreams = async () => { await Promise.all([socket.close(), server.close()]) }
    })
    tripwire = watchConsole(page)
    for (const tab of [page, peer]) {
      await tab.goto(scaffold.baseUrl)
      await tab.getByRole('button', { name: 'Archived sessions', exact: true }).click()
      await tab.getByRole('heading', { name: 'Archived report 1', exact: true }).waitFor({ timeout: 8000 }).catch(async (error: unknown) => { console.error(await tab.locator('body').ariaSnapshot()); throw error })
    }
    order = [...workspace.sessionIds]
  }, 120000)
  afterAll(async () => { await browser?.close(); await scaffold?.close() })
  const archive = (tab = page) => tab.getByRole('region', { name: 'Archived sessions', exact: true })
  it('browses and filters actual archive metadata without reading transcripts or running work', async () => {
    onTestFailed(async () => { console.error(await page.locator('body').ariaSnapshot(), tripwire.pageErrors) })
    const panel = archive()
    const aria = await captureStableAria(page, '[aria-label="Archived sessions"][aria-busy]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(join(snapshots, 'page.expected.md'), aria, webSnapshotMode())
    await panel.getByLabel('Search archived titles or IDs', { exact: true }).fill('archive-first')
    expect(await panel.getByRole('listitem').count()).toBe(1)
    await panel.getByLabel('Search archived titles or IDs', { exact: true }).fill('REPORT')
    await panel.getByRole('combobox', { name: 'Workspace', exact: true }).selectOption('@ungrouped')
    expect(await panel.getByRole('heading', { level: 2 }).allTextContents()).toEqual(['Archived report 3'])
    await panel.getByRole('combobox', { name: 'Workspace', exact: true }).selectOption(workspace.id)
    expect(await panel.getByRole('heading', { level: 2 }).allTextContents()).toEqual(['Archived report 2', 'Archived report 1'])
    await panel.getByLabel('Search archived titles or IDs', { exact: true }).fill('no-such-report')
    await panel.getByText('No matches', { exact: true }).waitFor()
    await panel.getByLabel('Search archived titles or IDs', { exact: true }).fill('')
    await panel.getByRole('combobox', { name: 'Workspace', exact: true }).selectOption('')
  })
  it('restores through the real RPC, updates another connected page, and preserves original accounting and logs', async () => {
    const before = (await scaffold.ctx.sessionPersistence.inspect(ids[0]!)).events
    const agents = scaffold.ctx.agents.list().length
    const response = page.waitForResponse(value => value.url().endsWith('/api/workspace.restoreSession'))
    await archive().getByRole('button', { name: 'Restore “Archived report 1”', exact: true }).click()
    expect(await (await response).json()).toMatchObject({ result: { ok: true } })
    await archive().getByText('Session restored. Find it in its original workspace or Ungrouped.', { exact: true }).waitFor()
    await expect.poll(() => archive(peer).getByRole('heading', { name: 'Archived report 1', exact: true }).count()).toBe(0)
    expect(workspace.sessionIds).toEqual(order)
    expect((await scaffold.ctx.sessionPersistence.inspect(ids[0]!)).events).toEqual(before)
    expect(scaffold.ctx.agents.list().length).toBe(agents)
    expect(await page.evaluate(() => document.activeElement?.textContent)).toBe('Session restored. Find it in its original workspace or Ungrouped.')
    await scaffold.ctx.workspaceRegistry.restoreSession(ids[0]!)
    expect(workspace.sessionIds).toEqual(order)
  })
  it('converges on reconnect and keeps restored membership after a page reload', async () => {
    await page.context().setOffline(true)
    await cutStreams()
    await archive().getByText('Disconnected. Showing the last known archive; reconnect before restoring.', { exact: true }).waitFor()
    expect(await archive().getByRole('button', { name: 'Restore “Archived report 2”', exact: true }).isDisabled()).toBe(true)
    await archive(peer).getByRole('button', { name: 'Restore “Archived report 2”', exact: true }).click()
    await expect.poll(() => scaffold.ctx.workspaceRegistry.archivedSessionIds.includes(ids[1]!)).toBe(false)
    await page.context().setOffline(false)
    await expect.poll(() => archive().getByRole('heading', { name: 'Archived report 2', exact: true }).count(), { timeout: 15000 }).toBe(0)
    await page.reload()
    await page.getByRole('button', { name: 'Archived sessions', exact: true }).click()
    await archive().getByRole('heading', { name: 'Archived report 3', exact: true }).waitFor()
    expect(await archive().getByRole('listitem').count()).toBe(1)
    expect(workspace.sessionIds).toEqual(order)
  })
  it('keeps committed restoration after a lost acknowledgment and permits idempotent recovery', async () => {
    await page.route('**/api/workspace.restoreSession', async (route) => {
      await route.fetch()
      await route.abort()
    })
    try {
      await archive().getByRole('button', { name: 'Restore “Archived report 3”', exact: true }).click()
      await expect.poll(() => scaffold.ctx.workspaceRegistry.archivedSessionIds.includes(ids[2]!)).toBe(false)
      await archive().getByRole('alert').waitFor()
      await expect.poll(() => archive(peer).getByRole('listitem').count()).toBe(0)
      await scaffold.ctx.workspaceRegistry.restoreSession(ids[2]!)
      expect(workspace.sessionIds).toEqual(order)
    } finally { await page.unroute('**/api/workspace.restoreSession') }
    await archive().getByRole('button', { name: 'Refresh archive', exact: true }).click()
    await archive().getByText('No archived sessions.', { exact: true }).waitFor()
  })
  it('renders Chinese recovery controls with keyboard focus in both schemes and narrow viewports', async () => {
    for (const id of ids) await scaffold.ctx.workspaceRegistry.archiveSession(id)
    const chinese = await browser.newPage({ locale: 'zh-CN', viewport: { width: 1680, height: 1100 } })
    try {
      onTestFailed(async () => { console.error(await chinese.locator('body').ariaSnapshot()) })
      await chinese.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' }); await chinese.goto(scaffold.baseUrl)
      await chinese.getByRole('button', { name: '归档会话', exact: true }).click()
      const panel = chinese.getByRole('region', { name: '归档会话', exact: true })
      await panel.getByRole('heading', { name: 'Archived report 1', exact: true }).waitFor()
      expect(await panel.getByRole('searchbox').evaluate(element => getComputedStyle(element).borderTopStyle)).toBe('solid')
      await panel.getByLabel('搜索归档标题或标识', { exact: true }).focus()
      await panel.getByLabel('搜索归档标题或标识', { exact: true }).press('Tab')
      expect(await panel.getByRole('combobox', { name: '工作空间', exact: true }).evaluate(element => element === document.activeElement)).toBe(true)
      for (const scheme of ['dark', 'light'] as const) {
        await chinese.emulateMedia({ colorScheme: scheme })
        await chinese.screenshot({ path: `/tmp/dsh-session-archive-${scheme}-zh.png`, fullPage: true })
        for (const width of [320, 375, 414, 768, 1680]) {
          await chinese.setViewportSize({ width, height: 1100 })
          await expect.poll(() => panel.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
        }
      }
    } finally { await chinese.close() }
    expect(tripwire.pageErrors).toEqual([])
  })
})
