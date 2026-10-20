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
    expect(await nav.getByRole('button').count()).toBe(2)
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
    await agentsPage.getByRole('button', { name: 'Back to conversation', exact: true }).click()
    await agentsPage.waitFor({ state: 'detached' })

    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

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
      expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
      await panel.getByRole('button', { name: 'Back to conversation', exact: true }).click()
      await panel.waitFor({ state: 'detached' })
    }
  }, 60_000)
})
