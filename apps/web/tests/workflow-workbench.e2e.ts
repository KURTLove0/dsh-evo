/** Keyless workspace workflow journey through the real Web composition and Remote API. */
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type {} from '@deepseek-ai/dsh-workspace'
import { launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { newEnglishPage } from './support.ts'

describe('web e2e: independent workspace workflow workbench', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    await scaffold.ctx.workspaceRegistry.create(scaffold.workspaceCwd)
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    await page.goto(scaffold.baseUrl)
  }, 120_000)
  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('creates, edits, publishes, confirms a run, and reopens its fixed history without a chat session', async () => {
    const tripwire = watchConsole(page)
    await page.getByRole('button', { name: 'Business workflow', exact: true }).click()
    const main = page.getByRole('main', { name: 'Business workflow', exact: true })
    const create = main.getByRole('form', { name: 'New workflow', exact: true })
    await create.getByLabel('Workspace', { exact: true }).selectOption({ index: 1 })
    await create.getByLabel('Workflow name', { exact: true }).fill('Lead review')
    await create.getByLabel('Business requirements and clarification', { exact: true }).fill('Review incoming leads.')
    await create.getByRole('button', { name: 'Create draft', exact: true }).click()
    const detail = main.locator('[data-business-workflow-id]')
    await detail.getByRole('heading', { name: 'Lead review', exact: true }).waitFor()
    expect(await create.count()).toBe(0)
    const designTab = detail.getByRole('tab', { name: 'Flow design', exact: true })
    await designTab.focus()
    await designTab.press('End')
    await detail.getByRole('tabpanel', { name: 'Verification results', exact: true }).waitFor()
    await detail.getByRole('tab', { name: 'Verification results', exact: true }).press('Home')
    await detail.getByRole('tabpanel', { name: 'Flow design', exact: true }).waitFor()
    expect(await detail.getByRole('tablist').getByRole('tab').evaluateAll(tabs => tabs.map(tab => ({
      label: tab.textContent,
      selected: tab.getAttribute('aria-selected'),
      tabIndex: tab.getAttribute('tabindex'),
      focused: tab === document.activeElement,
    })))).toMatchInlineSnapshot(`
      [
        {
          "focused": true,
          "label": "Flow design",
          "selected": "true",
          "tabIndex": "0",
        },
        {
          "focused": false,
          "label": "Run history",
          "selected": "false",
          "tabIndex": "-1",
        },
        {
          "focused": false,
          "label": "Verification results",
          "selected": "false",
          "tabIndex": "-1",
        },
      ]
    `)
    await main.getByRole('button', { name: 'New workflow', exact: true }).click()
    await create.getByLabel('Workflow name', { exact: true }).fill('Unfinished draft')
    await create.getByRole('button', { name: 'Close creation form', exact: true }).click()
    expect(await main.getByRole('button', { name: 'New workflow', exact: true }).evaluate(button => button === document.activeElement)).toBe(true)
    await main.getByLabel('Search workflows', { exact: true }).fill('No match')
    await main.getByText('No matching workflows.', { exact: true }).waitFor()
    await main.getByRole('button', { name: 'Clear filters', exact: true }).click()
    await main.getByRole('button', { name: /Lead review/ }).waitFor()
    await detail.getByRole('button', { name: 'Add confirmation node', exact: true }).click()
    await detail.getByRole('button', { name: 'Zoom in', exact: true }).click()
    expect(await detail.getByLabel('Canvas zoom level', { exact: true }).textContent()).toBe('125%')
    await detail.getByRole('button', { name: 'Fit to canvas', exact: true }).click()
    await detail.getByLabel('Node title', { exact: true }).fill('Human review')
    await detail.getByText('Business requirement', { exact: true }).click()
    await detail.getByText('Advanced data editor', { exact: true }).first().click()
    await detail
      .getByLabel('Objectives (JSON)', { exact: true })
      .fill('[{"id":"review","statement":"Review the submitted leads"}]')
    await detail
      .getByLabel('Input fields (JSON)', { exact: true })
      .fill('[{"name":"leads","description":"Incoming leads"}]')
    await detail
      .getByLabel('Output fields (JSON)', { exact: true })
      .fill('[{"name":"reviewed","description":"Approved leads"}]')
    await detail.getByRole('button', { name: 'Add acceptance case', exact: true }).click()
    await detail.getByLabel('Case name', { exact: true }).fill('sample')
    await detail.getByLabel('Case 1 inputs (JSON)', { exact: true }).fill('{"leads":"Alice"}')
    await detail.getByLabel('Acceptance condition', { exact: true }).selectOption('nonEmpty')
    const nodeId = await detail.locator('code').first().textContent()
    if (nodeId === null) throw new Error('Node id missing')
    await detail
      .getByLabel('Final output bindings (JSON)', { exact: true })
      .fill(JSON.stringify([{ name: 'reviewed', source: { kind: 'step', step: nodeId } }]))
    await detail.getByText('Advanced data editor', { exact: true }).last().click()
    await detail
      .getByLabel('Node input sources (JSON)', { exact: true })
      .fill('[{"name":"leads","source":{"kind":"requirement","field":"leads"}}]')
    await detail.getByLabel('Objective IDs (JSON)', { exact: true }).fill('["review"]')
    await detail.getByRole('button', { name: 'Save draft', exact: true }).click()
    await expect.poll(() => detail.getByRole('button', { name: 'Publish version', exact: true }).isEnabled()).toBe(true)
    await detail.getByRole('button', { name: 'Publish version', exact: true }).click()
    await detail.getByLabel('Published version', { exact: true }).locator('option', { hasText: 'v1' }).waitFor()
    await detail.getByLabel('Run inputs (JSON)', { exact: true }).fill('{"leads":"Alice"}')
    await detail.getByRole('button', { name: 'Run workflow', exact: true }).click()
    await detail.getByRole('button', { name: /Human review .*Awaiting confirmation/ }).waitFor()
    await detail.getByRole('button', { name: 'Approve and continue', exact: true }).click()
    await detail.getByRole('button', { name: /Human review .*Succeeded/ }).waitFor()
    expect({
      node: (await detail.locator('svg [role="button"]').getAttribute('aria-label'))?.replace(nodeId, 'NODE'),
      inputs: JSON.parse(
        (await detail.locator('[data-business-workflow-step-detail] pre').first().textContent()) ?? '{}',
      ) as unknown,
      hasContext: await detail.getByRole('heading', { name: 'Actual execution context', exact: true }).count(),
    }).toMatchInlineSnapshot(`
      {
        "hasContext": 1,
        "inputs": {
          "leads": "Alice",
        },
        "node": "Human review (NODE), Succeeded",
      }
    `)
    await page.reload()
    await page.getByRole('button', { name: 'Business workflow', exact: true }).click()
    await main.getByRole('button', { name: /Lead review/ }).click()
    await detail.getByRole('tab', { name: 'Run history', exact: true }).click()
    await detail.getByRole('button', { name: /v1 · Succeeded/ }).click()
    await detail.getByRole('button', { name: /Human review .*Succeeded/ }).waitFor()
    await page.setViewportSize({ width: 600, height: 900 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)
})
