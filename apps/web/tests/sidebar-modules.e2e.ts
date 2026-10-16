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

  it('shows the workbench module and opens its panel from the sidebar', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-sidebar-modules'))
    const nav = page.getByRole('navigation', { name: 'Workbench' })
    const workflow = nav.getByRole('button', { name: 'Business workflow' })
    await workflow.waitFor()
    // The Workbench carries the business-workflow module alone: the runtimes
    // module row lives under the sidebar's config nav, not here.
    expect(await nav.getByRole('button').count()).toBe(1)
    const snapshot = await captureStableAria(page, 'nav[aria-label="Workbench"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(NAV_EXPECTED, snapshot, MODE)

    await workflow.click()
    const workflowPanel = page.getByRole('dialog', { name: 'Business workflow' })
    await workflowPanel.waitFor()
    await workflowPanel.getByRole('heading', { name: 'Business workflow' }).waitFor()
    const requirement = workflowPanel.getByRole('textbox', { name: 'New workflow' })
    await expect.poll(() => requirement.evaluate(element => element === document.activeElement)).toBe(true)
    await workflowPanel.getByText('No business workflow in this session yet — start one above.').waitFor()
    await requirement.press('Escape')
    await workflowPanel.waitFor({ state: 'detached' })
    await expect.poll(() => workflow.evaluate(element => element === document.activeElement)).toBe(true)

    await workflow.click()
    await workflowPanel.getByRole('button', { name: 'Close business workflow' }).click()
    await workflowPanel.waitFor({ state: 'detached' })
    await expect.poll(() => workflow.evaluate(element => element === document.activeElement)).toBe(true)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('keeps the module panel inside narrow viewports without horizontal overflow', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-sidebar-modules-narrow'))
    for (const width of [320, 375, 414, 768]) {
      await page.setViewportSize({ width, height: 760 })
      const nav = page.getByRole('navigation', { name: 'Workbench' })
      const workflow = nav.getByRole('button', { name: 'Business workflow' })
      await workflow.click()
      const panel = page.getByRole('dialog', { name: 'Business workflow' })
      await panel.waitFor()
      const bounds = await panel.boundingBox()
      expect(bounds).not.toBeNull()
      expect(bounds!.x).toBeGreaterThanOrEqual(0)
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width)
      expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
      await page.keyboard.press('Escape')
      await panel.waitFor({ state: 'detached' })
    }
  }, 60_000)
})
