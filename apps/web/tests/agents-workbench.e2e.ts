/** Keyless real-workbench coverage for independent agent identity and configuration. */
import { chromium, type Browser, type Page } from 'playwright'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterAll, beforeAll, beforeEach, describe, expect, it, onTestFailed } from 'vitest'
import { captureStableAria, compareOrRefreshGolden, launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOTS = fileURLToPath(new URL('./snapshots/agents-workbench', import.meta.url))
const MODE = webSnapshotMode()

describe('web e2e: independent agents workbench', () => {
  let overlayRoot: string
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>
  beforeAll(async () => {
    if (MODE === 'refresh') await mkdir(SNAPSHOTS, { recursive: true })
    overlayRoot = await mkdtemp(join(tmpdir(), 'dsh-agent-runtime-overlay-'))
    const runtimeOverlay = join(overlayRoot, 'overlay.json')
    await writeFile(runtimeOverlay, JSON.stringify([{ id: 'llm-cursor-cli', disabled: true }, { id: 'llm-codex-cli', disabled: true }]))
    scaffold = await launchWebScaffold({ extraOverlayPath: runtimeOverlay })
    scaffold.ctx.llm.registerConfigurableProviders([{ provider: 'deepseek-official', displayName: 'Local scripted runtime', settingsNs: '', settingsPath: [], localCommand: process.execPath, defaultModel: 'deepseek-v4-flash' }])
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
  beforeEach(() => {
    onTestFailed(async () => {
      console.error('Workbench browser errors:', tripwire.pageErrors)
      console.error(await page.locator('main').ariaSnapshot())
      await saveFailureShot(page, 'agents-workbench')
    })
  })

  const openAgent = async (name: string) => {
    const main = page.getByRole('main', { name: 'Agents', exact: true })
    const back = main.getByRole('button', { name: 'Agents', exact: true })
    if (await back.count() !== 0) await back.click()
    await main.getByRole('button', { name, exact: true }).click()
  }

  it('creates an identity independently of presets and edits configuration in place', async () => {
    await page.getByRole('button', { name: 'Agents', exact: true }).click()
    const main = page.getByRole('main', { name: 'Agents', exact: true })
    await main.getByText('No agents yet. Create one and define its responsibilities and working style.', { exact: true }).waitFor()
    const presets = (await scaffold.ctx.agentPresets.list()).map(row => row.id)
    await main.getByRole('button', { name: 'New agent', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Create agent', exact: true })
    await dialog.getByRole('combobox', { name: 'Runtime', exact: true }).selectOption('deepseek-official')
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
    expect(await detail.getByRole('textbox', { name: 'Task', exact: true }).inputValue()).toBe('Review this repository.')
    const snapshot = await scaffold.ctx.workbenchAgents.snapshot()
    expect(snapshot.agents.map(({ name, instructions, starters, runtime }) => ({ name, instructions, starters, runtime }))).toMatchInlineSnapshot(`
      [
        {
          "instructions": "Read the diff and check authorization.",
          "name": "Code reviewer",
          "runtime": "deepseek-official",
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

  it('isolates task drafts and inspects failed runs with their captured configuration', async () => {
    const main = page.getByRole('main', { name: 'Agents', exact: true })
    await openAgent('Security reviewer')
    await main.getByRole('button', { name: 'Edit', exact: true }).click()
    const edit = page.getByRole('dialog', { name: 'Edit agent', exact: true })
    await edit.getByRole('textbox', { name: 'Skills', exact: false }).fill('unavailable-workbench-skill')
    await edit.getByRole('button', { name: 'Save', exact: true }).click()
    await edit.waitFor({ state: 'detached' })
    await main.getByRole('button', { name: 'Duplicate', exact: true }).click()
    const copy = page.getByRole('dialog', { name: 'Duplicate', exact: true })
    await copy.getByLabel('Copy name', { exact: true }).fill('Writer')
    await copy.getByRole('button', { name: 'Create copy', exact: true }).click()
    await copy.waitFor({ state: 'detached' })
    await main.getByRole('textbox', { name: 'Task', exact: true }).fill('Write a release report.')
    await openAgent('Security reviewer')
    expect(await main.getByRole('textbox', { name: 'Task', exact: true }).inputValue()).toBe('')
    await main.getByRole('textbox', { name: 'Task', exact: true }).fill('Review authorization changes.')
    await openAgent('Writer')
    expect(await main.getByRole('textbox', { name: 'Task', exact: true }).inputValue()).toBe('Write a release report.')
    await openAgent('Security reviewer')
    await main.getByRole('button', { name: 'Agents', exact: true }).click()
    await main.getByRole('searchbox', { name: 'Search agents', exact: true }).fill('unavailable-workbench-skill')
    expect(await main.getByRole('region', { name: 'Agents', exact: true }).getByRole('button').count()).toBe(2)
    await main.getByRole('searchbox', { name: 'Search agents', exact: true }).fill('')
    await expect.poll(() => main.getByRole('button', { name: 'Refresh', exact: true }).isEnabled()).toBe(true)
    await compareOrRefreshGolden(join(SNAPSHOTS, 'directory.expected.md'), await captureStableAria(page, 'main', scaffold.workspaceCwd), MODE)

    await openAgent('Security reviewer')
    // An unavailable skill fails before any model call, through the real host scheduler.
    await main.getByRole('button', { name: 'Start run', exact: true }).click()
    await main.getByText('Skill unavailable-workbench-skill is unavailable in this runtime.', { exact: true }).waitFor()
    const article = main.getByRole('article')
    await article.getByText('Failed', { exact: true }).waitFor()
    expect(await article.locator('time').count()).toBe(3)
    await main.getByRole('tab', { name: 'Overview', exact: true }).click()
    await main.getByRole('button', { name: 'Edit', exact: true }).click()
    await edit.getByLabel('Instructions', { exact: false }).fill('Review only current changes.')
    await edit.getByRole('button', { name: 'Cancel', exact: true }).last().click()
    const discard = page.getByRole('dialog', { name: 'Discard unsaved changes?', exact: true })
    await discard.waitFor()
    await compareOrRefreshGolden(join(SNAPSHOTS, 'unsaved-draft.expected.md'), await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd), MODE)
    await discard.getByRole('button', { name: 'Keep editing', exact: true }).last().click()
    expect(await edit.getByRole('textbox', { name: 'Instructions', exact: false }).inputValue()).toBe('Review only current changes.')
    await edit.getByRole('button', { name: 'Save', exact: true }).click()
    await edit.waitFor({ state: 'detached' })
    await main.getByRole('tab', { name: 'Run history', exact: true }).click()
    await article.locator('summary').click()
    await article.getByText('Read the diff and check authorization.', { exact: true }).waitFor()
    await compareOrRefreshGolden(join(SNAPSHOTS, 'captured-configuration.expected.md'), await captureStableAria(page, 'main article details', scaffold.workspaceCwd), MODE)
    await main.getByRole('combobox', { name: 'Run status', exact: true }).selectOption('completed')
    await main.getByText('No matching runs', { exact: true }).waitFor()
    await compareOrRefreshGolden(join(SNAPSHOTS, 'filtered-history.expected.md'), await captureStableAria(page, 'main section[aria-label="Run history"]', scaffold.workspaceCwd), MODE)
    await main.getByRole('combobox', { name: 'Run status', exact: true }).selectOption('failed')
    await main.getByRole('searchbox', { name: 'Search tasks, errors, or workspaces', exact: true }).fill('authorization')
    await article.getByText('Review authorization changes.', { exact: true }).waitFor()
    await main.getByRole('searchbox', { name: 'Search tasks, errors, or workspaces', exact: true }).fill('')
    expect(tripwire.pageErrors).toEqual([])
  })

  it('archives and restores with history intact and supports narrow layouts', async () => {
    const main = page.getByRole('main', { name: 'Agents', exact: true })
    await openAgent('Security reviewer')
    await main.getByRole('button', { name: 'Archive', exact: true }).click()
    await page.getByRole('button', { name: 'Confirm archive', exact: true }).click()
    await main.getByRole('button', { name: 'Agents', exact: true }).click()
    await main.getByRole('button', { name: 'Archived', exact: true }).click()
    await main.getByRole('button', { name: 'Security reviewer', exact: true }).waitFor()
    await openAgent('Security reviewer')
    await main.getByRole('button', { name: 'Restore', exact: true }).click()
    await main.getByRole('button', { name: 'Agents', exact: true }).click()
    await main.getByRole('button', { name: 'Available', exact: true }).click()
    for (const width of [375, 768]) {
      await page.setViewportSize({ width, height: 850 })
      await expect.poll(() => main.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    }
  })
})
