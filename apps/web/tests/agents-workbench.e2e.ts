/** Keyless real-workbench coverage for independent agent identity and configuration. */
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage } from './support.ts'

describe('web e2e: independent agents workbench', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>
  beforeAll(async () => {
    scaffold = await launchWebScaffold()
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl)
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
  }, 120_000)
  afterAll(async () => { await browser?.close(); await scaffold?.close() })

  it('creates an identity independently of presets and edits configuration in place', async () => {
    await page.getByRole('button', { name: 'Agents', exact: true }).click()
    const main = page.getByRole('main', { name: 'Agents', exact: true })
    await main.getByText('No agents yet. Create one and define its responsibilities and working style.', { exact: true }).waitFor()
    const presets = (await scaffold.ctx.agentPresets.list()).map(row => row.id)
    await main.getByRole('button', { name: 'New agent', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Create agent', exact: true })
    await dialog.getByLabel('Name', { exact: true }).fill('Code reviewer')
    await dialog.getByLabel('Description', { exact: false }).fill('Reviews source changes')
    await dialog.getByLabel('Instructions', { exact: false }).fill('Read the diff and check authorization.')
    await dialog.getByRole('button', { name: 'Add starter', exact: true }).click()
    await dialog.getByLabel('Starter label 1', { exact: true }).fill('Review changes')
    await dialog.getByLabel('Starter prompt 1', { exact: true }).fill('Review this repository.')
    await dialog.getByRole('button', { name: 'Save', exact: true }).click()
    await dialog.waitFor({ state: 'detached' })
    const detail = main.getByRole('region', { name: 'Code reviewer', exact: true })
    await detail.getByRole('heading', { name: 'Code reviewer', exact: true }).waitFor()
    await detail.getByRole('button', { name: 'Review changes', exact: true }).click()
    expect(await detail.getByLabel('Task', { exact: true }).inputValue()).toBe('Review this repository.')
    const snapshot = await scaffold.ctx.workbenchAgents.snapshot()
    expect(snapshot.agents.map(({ name, instructions, starters, runtime }) => ({ name, instructions, starters, runtime }))).toMatchInlineSnapshot(`
      [
        {
          "instructions": "Read the diff and check authorization.",
          "name": "Code reviewer",
          "runtime": "harness",
          "starters": [
            {
              "label": "Review changes",
              "prompt": "Review this repository.",
            },
          ],
        },
      ]
    `)
    expect(snapshot.runs).toEqual([])
    expect((await scaffold.ctx.agentPresets.list()).map(row => row.id)).toEqual(presets)
    await detail.getByRole('button', { name: 'Edit', exact: true }).click()
    const edit = page.getByRole('dialog', { name: 'Edit agent', exact: true })
    await edit.getByLabel('Name', { exact: true }).fill('Security reviewer')
    await edit.getByRole('button', { name: 'Save', exact: true }).click()
    await edit.waitFor({ state: 'detached' })
    expect((await scaffold.ctx.workbenchAgents.snapshot()).agents[0]?.id).toBe(snapshot.agents[0]?.id)
    await page.reload()
    await page.getByRole('button', { name: 'Agents', exact: true }).click()
    await main.getByRole('button', { name: 'Security reviewer', exact: true }).waitFor()
    expect(tripwire.pageErrors).toEqual([])
  })

  it('archives and restores with history intact and supports narrow layouts', async () => {
    const main = page.getByRole('main', { name: 'Agents', exact: true })
    await main.getByRole('button', { name: 'Security reviewer', exact: true }).click()
    await main.getByRole('button', { name: 'Archive', exact: true }).click()
    await page.getByRole('button', { name: 'Confirm archive', exact: true }).click()
    await main.getByRole('button', { name: 'Archived', exact: true }).click()
    await main.getByRole('button', { name: 'Security reviewer', exact: true }).waitFor()
    await main.getByRole('button', { name: 'Restore', exact: true }).click()
    await main.getByRole('button', { name: 'Available', exact: true }).click()
    for (const width of [375, 768]) {
      await page.setViewportSize({ width, height: 850 })
      await expect.poll(() => main.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    }
  })
})
