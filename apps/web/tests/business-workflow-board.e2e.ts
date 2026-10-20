import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { createMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { BusinessWorkflowId } from '@deepseek-ai/dsh-business-workflow/types'
import type {} from '@deepseek-ai/dsh-tool-business-workflow/types'
import { SESSION_FORMAT_VERSION, Session, SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-title'
import {
  launchWebScaffold, seedSession, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const MODE = webSnapshotMode()
const SEED_ID = 'business-workflow-board-web-e2e'

/** One completed tool round with the accepted step data and verification trace. */
function workflowFixture(): string {
  const session = Session.create(SessionId('business-workflow-board-source'))
  const workflowId = BusinessWorkflowId('bw-board')
  const eventTimeOrigin = new Date().setHours(12, 0, 0, 0)
  session.append('turn/start', { turn: 1 })
  const user = session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'Create a lead ranking workflow.' }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('session/title', {
    title: 'Lead ranking workflow', messageSeqs: [user.seq], source: { kind: 'fallback' },
  })
  session.append('step/start', { turn: 1, step: 1 })
  session.append('tool-business-workflow/start', {
    workflowId, summary: 'Rank inbound leads', stage: 'ready', revision: 1,
  })
  session.append('tool-business-workflow/clarified', {
    workflowId, stage: 'ready', revision: 1, gaps: [],
  })
  session.append('tool-business-workflow/composed', {
    workflowId, stage: 'composed', stepCount: 2, issues: [], steps: [
      {
        id: 'collect', title: 'Collect leads', dependsOn: [],
        instruction: 'Load lead records from the weekly intake.',
        inputs: [{ name: 'leads', source: { kind: 'requirement', field: 'weekly_leads' } }],
        objectives: ['collect-leads'],
      },
      {
        id: 'score', title: 'Score leads', dependsOn: ['collect'],
        instruction: 'Score each lead and return a ranking.',
        inputs: [{ name: 'records', source: { kind: 'step', step: 'collect' } }],
        objectives: ['rank-leads'],
      },
    ],
  })
  session.append('tool-business-workflow/verified', {
    workflowId, stage: 'verified',
    summary: { passed: true, caseCount: 1, dryRun: true },
    cases: [{ name: 'sample', status: 'passed', steps: [
      { stepId: 'collect', status: 'completed', detail: 'Two records loaded' },
      { stepId: 'score', status: 'completed', detail: 'Ranked two leads' },
    ] }],
  })
  session.append('assistant/message', {
    turn: 1, step: 1,
    message: createMessage({
      role: 'assistant',
      content: [{ type: 'text', text: 'The lead ranking workflow is verified.' }],
      source: { kind: 'model', provider: 'fixture', model: 'fixture' },
    }),
  }, { surfaceOp: 'append' })
  session.append('step/end', { turn: 1, step: 1 })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  return [
    JSON.stringify({
      type: 'session', version: SESSION_FORMAT_VERSION, id: '{{sessionId}}',
      createdAt: 0, cwd: '{{cwd}}',
    }),
    ...session.events.map(event => JSON.stringify({
      ...event, time: eventTimeOrigin + event.seq * 1_000,
    })),
    '',
  ].join('\n')
}

describe('web e2e: business workflow node context', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    await seedSession(scaffold, workflowFixture(), SEED_ID)
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it.skipIf(MODE === 'record')('replays the node graph and opens each step context', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-business-workflow-board'))
    const groupRow = page.locator('[role="treeitem"]').first()
    await groupRow.waitFor({ timeout: 15_000 })
    if (await groupRow.getAttribute('aria-expanded') !== 'true') await groupRow.click()
    await page.locator('[role="treeitem"]').nth(1).click()

    expect(await page.getByRole('button', { name: 'Business workflow', exact: true }).count()).toBe(1)
    await page.getByRole('button', { name: 'Business workflow', exact: true }).click()
    const workflowPage = page.getByRole('main', { name: 'Business workflow', exact: true })
    await workflowPage.waitFor()
    expect(await page.getByRole('dialog', { name: 'Business workflow', exact: true }).count()).toBe(0)
    await workflowPage.getByText('Legacy session records', { exact: true }).click()
    await workflowPage.getByRole('button', { name: 'Lead ranking workflow', exact: true }).click()
    const card = page.locator('[data-business-workflow-id="bw-board"]')
    await card.getByRole('button', { name: /Business workflow/ }).click()
    const selectedDetail = async () => {
      const detail = card.locator('[data-business-workflow-step-detail]')
      return {
        instruction: await detail.locator('p').first().textContent(),
        source: await detail.locator('li').first().locator('span').nth(1).textContent(),
        objective: await detail.locator('p').nth(1).textContent(),
        trace: await detail.locator('li').last().locator('span').last().textContent(),
      }
    }
    const collect = card.getByRole('button', { name: 'Collect leads (collect), Completed' })
    await collect.waitFor()
    expect(await collect.getAttribute('aria-pressed')).toBe('true')
    expect(await card.getByText('Load lead records from the weekly intake.').count()).toBe(1)
    expect(await card.getByText(/Requirement input: weekly_leads/).count()).toBe(1)
    const boardNodes = card.locator('svg[role="group"] [role="button"]')
    expect(await boardNodes.evaluateAll(nodes => nodes.map(node => ({
      name: node.getAttribute('aria-label'), selected: node.getAttribute('aria-pressed'),
    })))).toMatchInlineSnapshot(`
      [
        {
          "name": "Collect leads (collect), Completed",
          "selected": "true",
        },
        {
          "name": "Score leads (score), Completed",
          "selected": "false",
        },
      ]
    `)
    expect(await selectedDetail()).toMatchInlineSnapshot(`
      {
        "instruction": "Load lead records from the weekly intake.",
        "objective": "Objectives: collect-leads",
        "source": "← Requirement input: weekly_leads",
        "trace": "Two records loaded",
      }
    `)

    const score = card.getByRole('button', { name: 'Score leads (score), Completed' })
    await score.focus()
    await page.keyboard.press('Enter')
    expect(await score.getAttribute('aria-pressed')).toBe('true')
    expect(await card.getByText('Score each lead and return a ranking.').count()).toBe(1)
    expect(await card.getByText(/Step output: collect/).count()).toBe(1)
    expect(await card.getByText('Ranked two leads').count()).toBe(1)
    expect(await selectedDetail()).toMatchInlineSnapshot(`
      {
        "instruction": "Score each lead and return a ranking.",
        "objective": "Objectives: rank-leads",
        "source": "← Step output: collect",
        "trace": "Ranked two leads",
      }
    `)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 60_000)
})
