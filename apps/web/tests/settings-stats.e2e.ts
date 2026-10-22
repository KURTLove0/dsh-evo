// Web e2e scenario: the Statistics settings page — whole-host usage figures
// aggregated over one session.list call. Two cold sessions are seeded through
// the REAL persistence API (one closed turn carrying provider usage, one
// blank); the page must count both sessions, count only the started
// conversation, and sum the four usage buckets — with the cost card holding
// its explicit no-billing-source placeholder. Zero model calls; the seed is
// generated, not recorded, because no line of it is model output.
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden,
  launchWebScaffold, seedBlankSession, seedSession, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { ZH_BROWSER_LOCALE, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/settings-stats', import.meta.url))
const PAGE_EXPECTED = fileURLToPath(new URL('./snapshots/settings-stats/page.expected.md', import.meta.url))
const MODE = webSnapshotMode()
const SEED_USAGE = 'settings-stats-usage-web-e2e'
const SEED_BLANK = 'settings-stats-blank-web-e2e'

/** The one usage sample the seeded turn reports (the four provider buckets). */
const USAGE = { inputTokens: 1_200, outputTokens: 800, cacheReadTokens: 40_000, cacheWriteTokens: 300 }

/** Token display figures the sample must produce (the stats strip's vocabulary). */
const TOKENS_TOTAL = '42.3K'
const TOKENS_DETAIL = '输入 41.5K · 输出 800 · 缓存读 40K'

/**
 * Generate the usage seed: one closed single-step turn whose assistant
 * message carries the provider usage sample. Times are fixed so the fixture
 * is byte-deterministic; the message id is a synthetic uuid (aria normalizes
 * it in the sidebar).
 * @returns session.jsonl text for {@link seedSession}.
 */
function buildUsageSeed(): string {
  const lines = [JSON.stringify({
    type: 'session', version: 0, id: '{{sessionId}}', createdAt: 1784974100000, cwd: '{{cwd}}/workspace',
  })]
  let seq = 0
  let time = 1784974100000
  const at = (event: Record<string, unknown>): void => {
    lines.push(JSON.stringify({ ...event, seq: seq++, time: time++ }))
  }
  at({ type: 'turn/start', data: { turn: 1 } })
  at({
    type: 'user/message',
    data: { content: [{ type: 'text', text: 'count my tokens' }], source: { kind: 'user' } },
    surfaceOp: 'append',
  })
  at({ type: 'step/start', data: { turn: 1, step: 1 } })
  at({
    type: 'assistant/message',
    data: {
      turn: 1,
      step: 1,
      message: {
        id: '00000000-0000-4000-8000-000000000001',
        role: 'assistant',
        content: [{ type: 'text', text: 'counted' }],
        source: { kind: 'model', provider: 'snapshot', model: 'snapshot-replier' },
      },
      usage: USAGE,
    },
    sourceEventSeqs: [],
    surfaceOp: 'append',
  })
  at({ type: 'step/end', data: { turn: 1, step: 1 } })
  at({ type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
  return `${lines.join('\n')}\n`
}

describe('web e2e: the Statistics settings page', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    if (MODE === 'record') throw new Error('settings-stats is a keyless assembled snapshot')
    scaffold = await launchWebScaffold({})
    await seedSession(scaffold, buildUsageSeed(), SEED_USAGE)
    await seedBlankSession(scaffold, SEED_BLANK, scaffold.workspaceCwd)
    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 1680, height: 1000 }, locale: ZH_BROWSER_LOCALE })
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('aggregates the seeded sessions into the three metric cards', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-settings-stats'))
    // Open the seeded usage session first: an attached Session serves its
    // tokenUsage projection from the live registry watermark, and the listing
    // row's baseline carries that value. A never-opened cold seed has no
    // projection-cache row, so its usage would legitimately stay absent.
    const groupRow = page.locator('[role="treeitem"]').first()
    await groupRow.waitFor({ timeout: 15_000 })
    await groupRow.click()
    const sessionRow = page.locator('[role="treeitem"]').nth(1)
    await sessionRow.waitFor({ timeout: 10_000 })
    await sessionRow.click()
    await expect.poll(() => page.getByText('counted', { exact: true }).count(), { timeout: 15_000 }).toBe(1)
    // The sidebar's configuration module nav opens the panel straight on the
    // Statistics section — the module-level entry the product asked for.
    await page.getByRole('navigation', { name: '配置' }).getByRole('button', { name: '统计' }).click()
    const dialog = page.getByRole('dialog', { name: '配置' })
    await dialog.waitFor({ timeout: 10_000 })
    // Sessions card: two persisted sessions, one started conversation.
    await expect.poll(() => dialog.getByText('1 个已开始对话').count(), { timeout: 10_000 }).toBe(1)
    // Token card: the billed-input + output total with the bucket breakdown.
    await expect.poll(() => dialog.getByText(TOKENS_TOTAL, { exact: true }).count(), { timeout: 10_000 }).toBe(1)
    expect(await dialog.getByText(TOKENS_DETAIL).count()).toBe(1)
    // Cost card: the explicit no-billing-source placeholder, never a number.
    expect(await dialog.getByText('暂无计费数据源，暂无法统计费用。').count()).toBe(1)
    // The page stays on its own wire call; the refresh control reloads it.
    expect(await dialog.getByRole('button', { name: '刷新统计' }).count()).toBe(1)
  }, 60_000)

  it('matches the stats page aria golden', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-settings-stats-aria'))
    const snapshot = (await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd)).replace(/\d{4}-\d{2}-\d{2}/g, '{{date}}')
    await compareOrRefreshGolden(PAGE_EXPECTED, snapshot, MODE)
  }, 60_000)

  it('issued zero model calls and stayed clean', async () => {
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
    await assertFixtureInventory(SNAPSHOT_DIR, ['page.expected.md'])
  }, 60_000)
})
