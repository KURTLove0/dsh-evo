/** Rendered theme and responsive composer coverage through the shipped web composition. */
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  compareOrRefreshGolden, launchWebScaffold, watchConsole,
  webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage } from './support.ts'

const SNAPSHOTS = fileURLToPath(new URL('./snapshots/cyber-theme', import.meta.url))
const SHOTS = fileURLToPath(new URL('../../../.playwright-mcp/cyber-theme', import.meta.url))
const MODE = webSnapshotMode()

describe('web e2e: cyber workbench theme', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl)
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
    await mkdir(SHOTS, { recursive: true })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('keeps the composer usable across both schemes and narrow viewports', async () => {
    const composer = page.locator('textarea:enabled[placeholder="Describe what you want to build"]')
    const observations: string[] = []
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' })
      await expect.poll(() => page.locator('body').getAttribute('data-ds-dark-theme'))
        .toBe(scheme === 'dark' ? '' : null)
      await composer.fill('Inspect the workspace')
      await composer.focus()
      for (const width of [320, 375, 414, 768, 1440]) {
        await page.setViewportSize({ width, height: 900 })
        await expect.poll(() => composer.evaluate((element) => {
          const rect = element.getBoundingClientRect()
          return rect.left >= 0 && rect.right <= window.innerWidth && rect.width > 100
        })).toBe(true)
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
        const send = page.getByRole('button', { name: 'Send message', exact: true })
        expect(await send.isEnabled()).toBe(true)
        expect(await send.evaluate((element) => {
          const rect = element.getBoundingClientRect()
          return rect.left >= 0 && rect.right <= window.innerWidth && rect.bottom <= window.innerHeight
        })).toBe(true)
        expect(await page.locator('[class*="heroWorkspaceRow"] button').evaluateAll(elements => elements.every((element) => {
          const rect = element.getBoundingClientRect()
          return rect.left >= 0 && rect.right <= window.innerWidth
        }))).toBe(true)
        observations.push(`${scheme} ${width}px: composer visible; send enabled; no page overflow`)
        if (width === 320) await page.screenshot({ path: join(SHOTS, `${scheme}-mobile.png`) })
      }
      const palette = await page.locator('body').evaluate((element) => {
        const style = getComputedStyle(element)
        return ['--dsw-alias-bg-base', '--dsw-alias-label-primary', '--dsw-alias-state-business-primary']
          .map(name => `${name}: ${style.getPropertyValue(name).trim()}`).join('\n')
      })
      observations.push(palette)
      await page.screenshot({ path: join(SHOTS, `${scheme}-home.png`) })
    }
    await compareOrRefreshGolden(join(SNAPSHOTS, 'responsive.expected.md'), observations.join('\n'), MODE)
    await page.getByRole('button', { name: 'Agents', exact: true }).click()
    await page.getByRole('main', { name: 'Agents', exact: true }).waitFor()
    await page.screenshot({ path: join(SHOTS, 'dark-agents.png') })
    expect(tripwire.pageErrors).toEqual([])
  })
})
