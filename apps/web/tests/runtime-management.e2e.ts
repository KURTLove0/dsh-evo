/** Keyless runtime management through the shipped Web composition and HTTP RPC. */
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { LlmAdapter, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { newEnglishPage } from './support.ts'

class ModelPreviewAdapter extends LlmAdapter {
  override listModels(provider: string) {
    return Promise.resolve(Array.from({ length: 5 }, (_, index) => ({
      provider, id: `preview-model-${index}`, name: `Preview model ${index}`,
    })))
  }

  override async *stream(): AsyncIterable<StreamChunk> {
    throw new Error('Model preview scenario does not issue model requests')
  }
}

describe('web e2e: runtime machines and profiles', () => {
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
    await page
      .getByRole('navigation', { name: 'Config', exact: true })
      .getByRole('button', { name: 'Runtimes', exact: true })
      .click()
    await page.getByRole('button', { name: 'Manage runtimes', exact: true }).waitFor()
  }, 120_000)
  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('fits the runtime panel to desktop and small viewports without the configuration-file action', async () => {
    const viewport = page.viewportSize()!
    try {
      for (const size of [{ width: 1440, height: 900 }, { width: 375, height: 667 }, { width: 844, height: 390 }]) {
        await page.setViewportSize(size)
        const panel = page.getByRole('dialog')
        const bounds = (await panel.boundingBox())!
        expect(bounds.x).toBeGreaterThanOrEqual(12)
        expect(bounds.y).toBeGreaterThanOrEqual(12)
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(size.width - 12)
        expect(bounds.y + bounds.height).toBeLessThanOrEqual(size.height - 12)
        if (size.width === 1440) expect(bounds.width).toBe(1120)
        expect(await panel.getByRole('button', { name: 'Open configuration file', exact: true }).count()).toBe(0)
        expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
      }
    } finally {
      await page.setViewportSize(viewport)
    }
  })

  it('expands and collapses runtime models with the keyboard while retaining the total', async () => {
    const release = scaffold.ctx.llm.registerAdapter(['runtime-model-preview'], new ModelPreviewAdapter())
    try {
      await page.getByRole('button', { name: 'Refresh', exact: true }).click()
      const row = page.getByRole('row').filter({ has: page.getByText('runtime-model-preview', { exact: true }).first() })
      await row.waitFor()
      const snapshot = async () => ({
        models: await row.getByRole('listitem').allTextContents(),
        count: await row.getByText('5 model(s)', { exact: true }).textContent(),
        toggle: await row.getByRole('button').textContent(),
        expanded: await row.getByRole('button').getAttribute('aria-expanded'),
      })
      expect(await snapshot()).toMatchInlineSnapshot(`
        {
          "count": "5 model(s)",
          "expanded": "false",
          "models": [
            "preview-model-0",
            "preview-model-1",
            "preview-model-2",
          ],
          "toggle": "Expand",
        }
      `)
      await row.getByRole('button', { name: 'Expand', exact: true }).focus()
      await page.keyboard.press('Enter')
      expect(await snapshot()).toMatchInlineSnapshot(`
        {
          "count": "5 model(s)",
          "expanded": "true",
          "models": [
            "preview-model-0",
            "preview-model-1",
            "preview-model-2",
            "preview-model-3",
            "preview-model-4",
          ],
          "toggle": "Collapse",
        }
      `)
      await page.keyboard.press('Space')
      expect(await row.getByRole('listitem').count()).toBe(3)
      expect(await row.getByRole('button', { name: 'Expand', exact: true }).getAttribute('aria-expanded')).toBe('false')
    } finally {
      release()
    }
  })

  it('persists a custom runtime, keeps missing commands editable, and removes it after confirmation', async () => {
    await page.getByRole('button', { name: 'Manage runtimes', exact: true }).click()
    await page.getByRole('button', { name: 'Add runtime', exact: true }).click()
    const editor = page.getByRole('dialog', { name: 'Add runtime', exact: true })
    expect(
      await editor.getByText('Protocol: Cursor CLI (stream-json).', { exact: false }).textContent(),
    ).toMatchInlineSnapshot(
      '"Protocol: Cursor CLI (stream-json). Use an installed Cursor executable or a compatible wrapper. Profiles apply to this host; remote runtimes are managed on their own deployment."',
    )
    await editor.getByLabel('Display name', { exact: true }).fill('Custom unavailable runtime')
    await editor.getByLabel('Runtime ID', { exact: true }).fill('runtime-web-test')
    // A bare missing command is portable and cannot activate an installed native runtime.
    await editor.getByLabel('Command', { exact: true }).fill('dsh-nonexistent-runtime-web-test')
    await editor.getByRole('button', { name: 'Save', exact: true }).click()
    const manager = page.getByRole('dialog', { name: 'Manage runtimes', exact: true })
    await manager.getByText('runtime-web-test', { exact: true }).waitFor()
    await manager.getByRole('button', { name: 'Close', exact: true }).click()
    await page.reload({ waitUntil: 'load' })
    await page
      .getByRole('navigation', { name: 'Config', exact: true })
      .getByRole('button', { name: 'Runtimes', exact: true })
      .click()
    await page.getByText('Custom unavailable runtime', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Manage runtimes', exact: true }).click()
    await manager.getByRole('button', { name: 'Delete', exact: true }).click()
    const confirmation = page.getByRole('dialog', { name: 'Delete runtime', exact: true })
    await confirmation.getByRole('button', { name: 'Delete', exact: true }).click()
    await confirmation.waitFor({ state: 'detached' })
    expect(await page.getByText('Custom unavailable runtime', { exact: true }).count()).toBe(0)
  })

  it('resets an empty machine search and expands local setup instructions with the keyboard', async () => {
    const search = page.getByRole('textbox', { name: 'Search machines or runtimes…', exact: true })
    await search.fill('no-such-machine')
    const reset = page.getByRole('button', { name: 'Reset filters', exact: true })
    await reset.waitFor()
    expect(await reset.textContent()).toMatchInlineSnapshot('"Reset filters"')
    expect(await page.getByRole('heading', { name: 'Local machine', exact: true }).count()).toBe(0)
    await page.getByRole('button', { name: 'Clear search', exact: true }).click()
    await page.getByRole('heading', { name: 'Local machine', exact: true }).waitFor()
    expect(await search.inputValue()).toBe('')
    await search.fill('no-such-machine')
    await reset.click()
    expect(await search.inputValue()).toBe('')
    const instructions = page.locator('details').filter({ hasText: 'Runtime sensing daemon is not running' })
    await instructions.waitFor()
    expect(await instructions.getAttribute('open')).toBeNull()
    await instructions.locator('summary').focus()
    await page.keyboard.press('Enter')
    await instructions.getByRole('button', { name: 'Copy', exact: true }).first().waitFor({ state: 'visible' })
    expect(await instructions.getAttribute('open')).not.toBeNull()
    await page.keyboard.press('Enter')
    expect(await instructions.getAttribute('open')).toBeNull()
  })

  it('checks a real remote directory and returns focus to the runtime page on Escape', async () => {
    await page.getByRole('button', { name: 'Connect remote', exact: true }).click()
    const connect = page.getByRole('dialog', { name: 'Connect remote', exact: true })
    expect(
      await connect
        .getByText('Connect an existing dsh web deployment. The connection is checked before it is saved.', {
          exact: true,
        })
        .textContent(),
    ).toMatchInlineSnapshot('"Connect an existing dsh web deployment. The connection is checked before it is saved."')
    await page.keyboard.press('Escape')
    await connect.waitFor({ state: 'detached' })
    await page.getByRole('button', { name: 'Connect remote', exact: true }).waitFor()
    await page.getByRole('button', { name: 'Connect remote', exact: true }).click()
    await connect.getByLabel('Machine name', { exact: true }).fill('Loopback deployment')
    await connect.getByLabel('dsh origin', { exact: true }).fill(scaffold.baseUrl)
    await connect.getByRole('button', { name: 'Check and connect', exact: true }).click()
    const success = page.getByRole('dialog', { name: 'Machine connected', exact: true })
    await success.getByRole('button', { name: 'Done', exact: true }).click()
    const machine = page.getByRole('button', { name: /^Loopback deployment/ })
    await machine.click()
    await page.getByRole('link', { name: 'Open remote', exact: true }).waitFor()
    for (const width of [375, 768, 1280]) {
      await page.setViewportSize({ width, height: 800 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    }
    await page.getByRole('button', { name: 'Disconnect', exact: true }).click()
    await page
      .getByRole('dialog', { name: 'Disconnect', exact: true })
      .getByRole('button', { name: 'Disconnect', exact: true })
      .click()
    await machine.waitFor({ state: 'detached' })
    expect(tripwire.pageErrors).toEqual([])
  })
})
