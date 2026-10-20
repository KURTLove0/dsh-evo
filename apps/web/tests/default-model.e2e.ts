// Web e2e scenario: switching models in an active conversation updates that
// session and chooses this deployment's default. The gesture writes the shared
// `agent-default-model` settings section, a session created afterwards starts
// from it, and unrelated sessions keep their logged routes — the tier order
// the gateway resolves on every read.
// Zero model calls: the switch is settings/llm-domain traffic only, so there
// is no fixture and a stray stream would fail loud because the adapter registry is empty. Both
// routes are declared host-side (not through the UI, which has its own
// scenario) through the pi-ai adapter the shipped tree already mounts: a
// fixture-less scaffold registers no adapter at all, so the routes the
// picker offers — and the one the composer must start on — have to come from
// somewhere, and settings profiles are the product's own way to add them.
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden,
  launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { ZH_BROWSER_LOCALE, connectFreshWorkspaceZh, saveFailureShot } from './support.ts'

/** Points the shipped shared Agent default at this scenario's own route. */
const OVERLAY = fileURLToPath(new URL('./default-model.overlay.yml', import.meta.url))
const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/default-model', import.meta.url))
const SEARCH_EXPECTED = join(SNAPSHOT_DIR, 'search.expected.md')
const SWITCHED_EXPECTED = join(SNAPSHOT_DIR, 'switched.expected.md')
const MODE = webSnapshotMode()

/** The route this scenario starts on, patched over the shipped default. */
const START_ROUTE = 'origin-gateway'
const START_MODEL = 'origin-large'
/** The route the switch lands on, which then becomes the saved default. */
const ROUTE = 'acme-gateway'
const MODEL = 'acme-large'

describe('web e2e: the composer model switch is the default for later sessions', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  /** Create one session and its agent through the same wire face the browser uses. */
  const createSession = async (sessionId: string): Promise<string> => {
    const response = await scaffold.ctx.apiProxy.sessions.create({
      rpcId: `default-model-create-${sessionId}` as never,
      payload: { sessionId: SessionId(sessionId), cwd: scaffold.workspaceCwd },
    })
    if (!response.result.ok) throw new Error(`session.create failed: ${response.result.error.message}`)
    return response.result.value.sessionId
  }

  /** The route the gateway reports for one session, through the real wire face. */
  const currentOf = async (sessionId: string): Promise<unknown> => {
    const response = await scaffold.ctx.apiProxy.sessions.models({
      rpcId: `default-model-${sessionId}` as never,
      payload: { sessionId: SessionId(sessionId) },
    })
    if (!response.result.ok) throw new Error(`session.models failed: ${response.result.error.message}`)
    return response.result.value.current
  }

  beforeAll(async () => {
    scaffold = await launchWebScaffold({ extraOverlayPath: OVERLAY })
    // Two routes so the picker has somewhere to start and somewhere to go.
    // Declared through the settings seam rather than the Models page: this
    // scenario is about the composer, and the declaring flow is covered by
    // models-settings.e2e.
    await scaffold.ctx.settings.update(settingsNamespace('llm-pi-ai'), {
      providers: {
        [START_ROUTE]: {
          displayName: 'Origin Gateway',
          api: 'openai-completions',
          baseURL: 'https://gateway.origin.example/v1',
          models: [{ id: START_MODEL, name: 'Origin Large' }],
        },
        [ROUTE]: {
          displayName: 'Acme Gateway',
          api: 'openai-completions',
          baseURL: 'https://gateway.acme.example/v1',
          models: [{ id: MODEL, name: 'Acme Large' }],
        },
      },
    })
    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 1680, height: 1000 }, locale: ZH_BROWSER_LOCALE })
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    // The composer's seats only exist once a workspace is connected: without
    // one the input is the locked placeholder and no session scope is open.
    await connectFreshWorkspaceZh(page, scaffold.workspaceCwd)
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('switches the active logged session, saves the default, and leaves other sessions alone', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-default-model'))
    const active = scaffold.ctx.agents.list().find(agent => agent.session.header.cwd === join(scaffold.workspaceCwd, 'workspace'))
    if (active === undefined) throw new Error('connected workspace did not publish its active session')
    active.session.append('request/header', {
      header: { config: { provider: START_ROUTE, model: START_MODEL } },
      reason: 'initial',
    })
    // An unrelated session has its own logged route and must not inherit a
    // switch made in the active conversation.
    const loggedId = await createSession('default-model-logged')
    scaffold.ctx.sessions.get(SessionId(loggedId))?.append('request/header', {
      header: { config: { provider: START_ROUTE, model: START_MODEL } },
      reason: 'initial',
    })

    const trigger = page.getByRole('button', { name: /^选择模型/ })
    await trigger.waitFor({ timeout: 15_000 })
    await trigger.click()
    await page.getByRole('menuitem', { name: /模型/ }).click()
    const search = page.getByRole('searchbox', { name: '搜索模型' })
    await search.fill(ROUTE)
    const searchSnapshot = await captureStableAria(page, '[role="menu"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(SEARCH_EXPECTED, searchSnapshot, MODE)
    await page.getByRole('menuitemradio', { name: 'Acme Large' }).click()

    await expect.poll(() => currentOf(active.id)).toEqual({ provider: ROUTE, model: MODEL })
    const snapshot = await captureStableAria(page, '[aria-label^="选择模型"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(SWITCHED_EXPECTED, snapshot, MODE)

    // The switch is what sets the default: the shared Agent-route settings section
    // now names it, beside the provider profiles the Models page writes.
    await expect.poll(
      async () => readFile(join(scaffold.harnessHome, 'settings.yaml'), 'utf8'),
      { timeout: 10_000 },
    ).toContain('agent-default-model:')
    const document = await readFile(join(scaffold.harnessHome, 'settings.yaml'), 'utf8')
    expect(document).toContain(`provider: ${ROUTE}`)
    expect(document).toContain(`model: ${MODEL}`)

    // A session created after the switch starts from it...
    expect(await currentOf(await createSession('default-model-after')))
      .toEqual({ provider: ROUTE, model: MODEL })
    // ...while the one holding a logged route keeps deriving from its log.
    expect(await currentOf(loggedId)).toEqual({ provider: START_ROUTE, model: START_MODEL })
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('goes inert when the route the default names stops being served', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-default-model-blocked'))
    const box = page.locator('textarea[data-input-phase], textarea').first()
    await expect.poll(async () => box.isEnabled(), { timeout: 10_000 }).toBe(true)

    // What removing the provider on the Models page leaves behind: the saved
    // default still names the route, and nothing serves it any more.
    // `replace`, not `update`: a merge patch of `{providers: {}}` leaves every
    // stored profile in place.
    await scaffold.ctx.settings.replace(settingsNamespace('llm-pi-ai'), { providers: {} })

    await expect.poll(async () => box.isEnabled(), { timeout: 15_000 }).toBe(false)
    expect(await box.getAttribute('placeholder')).toBe('当前模型不可用，请先选择模型')

    // The block is an affordance; the refusal is the Host's. A client that
    // never disabled anything still cannot start a turn on a dead route.
    const refused = await scaffold.ctx.apiProxy.sessions.prompt({
      rpcId: 'default-model-refused' as never,
      payload: {
        sessionId: SessionId(await createSession('default-model-refusal')),
        mode: 'queue' as const,
        content: [{ type: 'text' as const, text: 'hi' }],
      },
    })
    expect(refused.result).toMatchObject({ ok: false, error: { code: 'model-unavailable' } })

    // The way out stays open. Locking the model seat with everything else
    // would leave the composer asking for the one thing it prevents.
    const seat = page.getByRole('button', { name: /^选择模型/ })
    expect(await seat.isEnabled()).toBe(true)
    await seat.click()
    await page.getByRole('menuitem', { name: /模型/ }).click()
    await page.getByRole('menuitemradio').first().click()
    await expect.poll(async () => box.isEnabled(), { timeout: 15_000 }).toBe(true)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('keeps its snapshot inventory closed', async () => {
    await assertFixtureInventory(SNAPSHOT_DIR, ['switched.expected.md'])
  })
})
