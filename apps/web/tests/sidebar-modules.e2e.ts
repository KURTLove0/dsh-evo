/** Keyless assembled-Web coverage for the sidebar workbench shared by web and desktop. */
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  captureStableAria, compareOrRefreshGolden, launchWebScaffold, watchConsole,
  webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/sidebar-modules', import.meta.url))
const NAV_EXPECTED = join(SNAPSHOT_DIR, 'workbench.expected.md')
const MODE = webSnapshotMode()

describe('web e2e: sidebar workbench modules', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.getByRole('navigation', { name: 'Workbench' }).waitFor({ timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('opens workbench pages from the sidebar and returns to the conversation', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-sidebar-modules'))
    const nav = page.getByRole('navigation', { name: 'Workbench' })
    const workflow = nav.getByRole('button', { name: 'Business workflow' })
    await workflow.waitFor()
    // Runtime configuration remains separate from the workbench modules.
    expect(await nav.getByRole('button').allTextContents()).toEqual(['Work Center', 'Templates', 'Agents', 'Project artifacts', 'Business workflow', 'Work triggers', 'Remote execution', 'Knowledge directory', 'Archived sessions'])
    await nav.getByRole('button', { name: 'Agents', exact: true }).waitFor()
    const snapshot = await captureStableAria(page, 'nav[aria-label="Workbench"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(NAV_EXPECTED, snapshot, MODE)

    await workflow.click()
    const workflowPage = page.getByRole('main', { name: 'Business workflow', exact: true })
    await workflowPage.waitFor()
    await workflowPage.getByRole('heading', { name: 'Business workflow', exact: true }).waitFor()
    await nav.getByRole('button', { name: 'Agents', exact: true }).click()
    const agentsPage = page.getByRole('main', { name: 'Agents', exact: true })
    await agentsPage.getByRole('heading', { name: /^Agents/ }).waitFor()
    await workflowPage.waitFor({ state: 'detached' })
    await agentsPage.getByRole('button', { name: 'Back to chat', exact: true }).click()
    await agentsPage.waitFor({ state: 'detached' })

    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('scrolls module navigation while preserving a usable session list in short windows', async () => {
    await page.setViewportSize({ width: 1680, height: 800 })
    const nav = page.getByRole('navigation', { name: 'Workbench' })
    expect(await nav.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true)
    const sessions = page.getByRole('tree', { name: 'Sessions', exact: true })
    const bounds = await sessions.boundingBox()
    expect(bounds?.height).toBeGreaterThanOrEqual(100)
    const last = nav.getByRole('button', { name: 'Archived sessions', exact: true })
    await last.focus()
    expect(await last.evaluate(element => document.activeElement === element)).toBe(true)
    expect(await last.evaluate((element) => {
      const item = element.getBoundingClientRect(), area = element.closest('nav')!.getBoundingClientRect()
      return item.top >= area.top && item.bottom <= area.bottom
    })).toBe(true)
    await page.setViewportSize({ width: 1680, height: 1000 })
  })

  it('keeps the agent page inside narrow viewports without horizontal overflow', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-sidebar-modules-narrow'))
    for (const width of [320, 375, 414, 768]) {
      await page.setViewportSize({ width, height: 760 })
      const nav = page.getByRole('navigation', { name: 'Workbench' })
      const agents = nav.getByRole('button', { name: 'Agents', exact: true })
      await agents.click()
      const panel = page.getByRole('main', { name: 'Agents', exact: true })
      await panel.waitFor()
      const bounds = await panel.boundingBox()
      expect(bounds).not.toBeNull()
      expect(bounds!.x).toBeGreaterThanOrEqual(0)
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width)
      await expect.poll(() => panel.evaluate(element => element.scrollWidth <= element.clientWidth), { timeout: 10000 }).toBe(true)
      await panel.getByRole('button', { name: 'Back to chat', exact: true }).click()
      await panel.waitFor({ state: 'detached' })
    }
  }, 60_000)
})
