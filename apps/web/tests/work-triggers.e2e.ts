/** Durable trigger UI and provider through real HTTP, native owners, approval UI, and session logs. */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { WorkTrigger, WorkTriggerId, TriggerCommand, TriggerReceipt } from '@deepseek-ai/dsh-work-triggers/types'
import type {} from '@deepseek-ai/dsh-work-triggers'
import type { TriggerTarget } from '@deepseek-ai/dsh-work-triggers/types'
import { MockAdapter, textResponse } from '../../../packages/core/agent-loop/tests/mock-adapter.ts'
import { compareOrRefreshGolden, launchWebScaffold, webSnapshotMode, type WebScaffold } from './scaffold.ts'
import { newEnglishPage } from './support.ts'
const snapshots = fileURLToPath(new URL('./snapshots/work-triggers', import.meta.url))
describe('web e2e: durable native trigger admissions', () => {
  let cutStreams: () => Promise<void>
  let scaffold: WebScaffold, browser: Browser, page: Page, root: string
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-trigger-web-'))
    const overlay = join(root, 'trigger.patch.yml')
    await writeFile(overlay, '- id: work-triggers\n  config:\n    pollIntervalMs: 20\n    minIntervalMs: 100\n')
    scaffold = await launchWebScaffold({ extraOverlayPath: overlay })
    browser = await chromium.launch(); page = await newEnglishPage(browser); await page.goto(scaffold.baseUrl)
    await page.getByRole('button', { name: 'Work Center', exact: true }).waitFor()
  }, 120000)
  afterAll(async () => { await browser?.close(); await scaffold?.close(); await rm(root, { recursive: true, force: true }) })
  async function invoke<T>(method: string, request: unknown): Promise<T> {
    const endpoint = `workTriggerGateway/${method}`
    const response = await page.request.post(`${scaffold.baseUrl}/api/${endpoint}`, { headers: { origin: scaffold.baseUrl },
      data: { type: 'client-request', rpcId: randomUUID(), method: endpoint, payload: { args: { request } } } })
    expect(response.ok()).toBe(true)
    const body = await response.json() as { result: { ok: boolean; value: T; error?: { code: string; message: string } } }
    if (!body.result.ok) throw new Error(`${body.result.error?.code}: ${body.result.error?.message}`)
    return body.result.value
  }
  const read = (id: WorkTriggerId) => invoke<WorkTrigger>('read', { id })
  const command = (request: TriggerCommand) => invoke<TriggerReceipt>('command', request)
  it('survives a closed browser, retains native approval, recovers one lost receipt, and records notices without another model request', async () => {
    const workspace = await scaffold.ctx.workspaceRegistry.create(scaffold.workspaceCwd)
    const adapter = new MockAdapter([textResponse('Scheduled report produced.'), textResponse('Dependent report produced after human approval.')])
    scaffold.ctx.llm.registerAdapter(['trigger-test'], adapter)
    scaffold.ctx.llm.registerConfigurableProviders([{ provider: 'trigger-test', displayName: 'Trigger executor', settingsNs: '', settingsPath: [], localCommand: process.execPath, defaultModel: 'mock' }])
    const executor = await scaffold.ctx.workbenchAgents.command({ kind: 'create', definition: { name: 'Trigger reporter', avatar: '',
      description: '', instructions: 'Review the requested input.', runtime: 'trigger-test', skills: [], mcpServers: [], starters: [], concurrency: 1 } })
    const target = (goal: string): TriggerTarget => ({ kind: 'agent', id: executor.agentId, workspaceId: workspace.id, expectedRevision: 1,
      brief: { version: 1, goal, background: '', deliverables: [], acceptanceCriteria: ['Include evidence'], constraints: '' } })
    const workflow = await scaffold.ctx.workflowWorkbench.command({ kind: 'create', workspaceId: workspace.id, name: 'Triggered approval', description: 'Approve the report' })
    const definition = { requirement: { summary: 'Approve report', objectives: [{ id: 'approve', statement: 'Confirm input' }],
      inputs: [{ name: 'report', description: 'Report' }], outputs: [{ name: 'approved', description: 'Confirmed report' }], constraints: [],
      acceptanceCases: [{ name: 'sample', given: { report: 'Original input' }, expect: { kind: 'nonEmpty' as const } }] },
    nodes: [{ id: 'approve', kind: 'approval' as const, title: 'Human approval', instruction: 'Confirm this report', preset: 'standard', dependsOn: [],
      inputs: [{ name: 'report', source: { kind: 'requirement' as const, field: 'report' } }], objectives: ['approve'] }],
    finalOutputs: [{ name: 'approved', source: { kind: 'step' as const, step: 'approve' } }], positions: {} }
    await scaffold.ctx.workflowWorkbench.command({ kind: 'save', id: workflow.workflowId, expectedRevision: 1, name: 'Triggered approval', definition })
    await scaffold.ctx.workflowWorkbench.command({ kind: 'publish', id: workflow.workflowId, expectedRevision: 2 })
    const publication = (await scaffold.ctx.workflowWorkbench.snapshot(workflow.workflowId)).workflows[0]!.versions[0]!
    const original = scaffold.ctx.workbenchAgents.command.bind(scaffold.ctx.workbenchAgents)
    const admitted = vi.spyOn(scaffold.ctx.workbenchAgents, 'command').mockImplementationOnce(async (request) => {
      const receipt = await original(request); throw new Error(`Lost acknowledgment for ${receipt.agentId}`)
    })
    const onceId = randomUUID() as WorkTriggerId, everyId = randomUUID() as WorkTriggerId, eventId = randomUUID() as WorkTriggerId
    const at = Date.now() + 1500
    const once: TriggerCommand = { kind: 'create', id: onceId, enabled: true,
      definition: { name: 'Timed report', rule: { kind: 'at', at }, target: target('Review the scheduled report') } }
    await command(once)
    await command({ kind: 'create', id: everyId, enabled: true, definition: { name: 'Approval interval',
      rule: { kind: 'every', firstAt: at, intervalMs: 60000 },
      target: { kind: 'workflow', id: workflow.workflowId, versionId: publication.id, workspaceId: workspace.id, inputs: { report: 'Original input' } } } })
    await expect(invoke('command', { ...once, kind: 'unsupported' })).rejects.toThrow('boundary validation')
    expect((await read(onceId)).occurrences).toEqual([])
    await page.close()
    await expect.poll(async () => (await scaffold.ctx.workTriggers.read(onceId)).occurrences[0]?.admission.state, { timeout: 15000 }).toBe('unconfirmed')
    await expect.poll(async () => (await scaffold.ctx.workflowWorkbench.queryRuns({ limit: 10 })).items[0]?.status, { timeout: 15000 }).toBe('waiting')
    const waiting = (await scaffold.ctx.workflowWorkbench.queryRuns({ limit: 10 })).items[0]!
    const interval = await scaffold.ctx.workTriggers.read(everyId)
    await scaffold.ctx.workTriggers.command({ kind: 'set-enabled', id: everyId, expectedRevision: interval.revision, enabled: false })
    page = await newEnglishPage(browser)
    await page.routeWebSocket('**/api/events.host', (socket) => {
      const server = socket.connectToServer()
      cutStreams = async () => { await Promise.all([socket.close(), server.close()]) }
    })
    await page.goto(scaffold.baseUrl)
    await page.getByRole('button', { name: 'Work Center', exact: true }).click()
    const uncertain = (await read(onceId)).occurrences[0]!
    await command({ kind: 'recover', id: onceId, occurrenceId: uncertain.id, expectedAttempt: uncertain.attempts })
    await expect.poll(async () => (await read(onceId)).occurrences[0]?.admission.state).toBe('settled')
    expect((await scaffold.ctx.workbenchAgents.queryRuns({ limit: 10 })).items).toHaveLength(1)
    expect(admitted).toHaveBeenCalledTimes(2); admitted.mockRestore()
    await command({ kind: 'create', id: eventId, enabled: true, definition: { name: 'After approval',
      rule: { kind: 'on-settled', source: { kind: 'workflow', id: waiting.id } }, target: target('Review the dependent report') } })
    const center = page.getByRole('main', { name: 'Work Center', exact: true })
    await center.getByRole('region', { name: 'Runs', exact: true }).getByRole('button', { name: /Triggered approval/ }).click()
    await center.getByRole('button', { name: 'Approve this node', exact: true }).click()
    await expect.poll(async () => (await read(eventId)).occurrences[0]?.admission.state).toBe('settled')
    await expect.poll(async () => (await read(everyId)).occurrences[0]?.admission.state).toBe('settled')
    const time = await read(onceId), recurring = await read(everyId), event = await read(eventId)
    for (const notice of time.occurrences[0]!.notices) await command({ kind: 'acknowledge', id: onceId, noticeId: notice.id })
    const finalTime = await read(onceId), workflowRun = await scaffold.ctx.workflowWorkbench.inspectRun(waiting.id)
    expect(workflowRun.version.id).toBe(publication.id); expect(workflowRun.inputs).toEqual({ report: 'Original input' })
    expect(workflowRun.requestId).toBeDefined()
    const runs = (await scaffold.ctx.workbenchAgents.queryRuns({ limit: 10 })).items
    expect(runs).toHaveLength(2); expect(adapter.requests).toHaveLength(2)
    for (const run of runs) {
      const transcript = await scaffold.ctx.sessionPersistence.inspect(run.sessionId)
      const input = JSON.stringify(transcript.events.filter(value => value.type === 'user/message'))
      expect(input).toContain(run.submission!.brief.goal)
    }
    await page.reload(); await page.getByRole('button', { name: 'Work Center', exact: true }).waitFor()
    expect((await read(onceId)).occurrences[0]!.notices.every(value => value.readAt !== undefined)).toBe(true)
    const report = { time: { phase: time.occurrences[0]!.admission.state, attempts: time.occurrences[0]!.attempts,
      notices: time.occurrences[0]!.notices.map(value => value.kind),
      acknowledged: finalTime.occurrences[0]!.notices.every(value => value.readAt !== undefined) },
    interval: { enabled: recurring.enabled, occurrences: recurring.occurrences.length, phase: recurring.occurrences[0]!.admission.state,
      workflowStatus: workflowRun.status, publicationPinned: workflowRun.version.id === publication.id, inputs: workflowRun.inputs },
    event: { rule: event.definition.rule.kind, occurrences: event.occurrences.length, phase: event.occurrences[0]!.admission.state },
    nativeAgentRuns: runs.length, modelRequests: adapter.requests.length }
    await mkdir(snapshots, { recursive: true })
    await compareOrRefreshGolden(join(snapshots, 'admissions.expected.json'), `${JSON.stringify(report, null, 2)}`, webSnapshotMode())
  })
  it('recovers fixed creation and lost control acknowledgments through the real trigger interface', async () => {
    const workspace = await scaffold.ctx.workspaceRegistry.create(scaffold.workspaceCwd)
    const adapter = new MockAdapter([textResponse('Original UI report.'), textResponse('Scheduled UI report.')])
    scaffold.ctx.llm.registerAdapter(['trigger-ui'], adapter)
    scaffold.ctx.llm.registerConfigurableProviders([{ provider: 'trigger-ui', displayName: 'Trigger UI executor', settingsNs: '', settingsPath: [], localCommand: process.execPath, defaultModel: 'mock' }])
    const executor = await scaffold.ctx.workbenchAgents.command({ kind: 'create', definition: { name: 'UI reporter', avatar: '', description: '', instructions: 'Review input.', runtime: 'trigger-ui', skills: [], mcpServers: [], starters: [], concurrency: 1 } })
    const brief = { version: 1 as const, goal: 'Review original UI input', background: 'Fixed background', deliverables: ['Report'], acceptanceCriteria: ['Include evidence'], constraints: 'Preserve inputs' }
    const originalRun = await scaffold.ctx.workbenchAgents.command({ kind: 'submit-task', id: executor.agentId, workspaceId: workspace.id, expectedRevision: 1, requestId: randomUUID() as never, brief })
    await expect.poll(async () => (await scaffold.ctx.workbenchAgents.inspectRun(originalRun.runId!)).status).toBe('completed')
    await page.getByRole('button', { name: 'Work Center', exact: true }).click()
    const center = page.getByRole('main', { name: 'Work Center', exact: true })
    await center.getByRole('region', { name: 'Runs', exact: true }).getByRole('button', { name: /UI reporter/ }).click()
    await center.getByRole('button', { name: 'Create trigger from this execution', exact: true }).click()
    const main = page.getByRole('main', { name: 'Work triggers', exact: true })
    await main.getByRole('button', { name: 'Use this fixed target', exact: true }).click()
    await main.getByRole('textbox', { name: 'Name', exact: true }).fill('UI once')
    await main.getByRole('textbox', { name: 'First target time (ISO with Z or offset)', exact: true }).fill(new Date(Date.now() + 1500).toISOString())
    await page.route('**/api/workTriggerGateway/command', async (route) => { await route.fetch(); await route.abort('failed') }, { times: 1 })
    await main.getByRole('button', { name: 'Save paused', exact: true }).click()
    await main.getByRole('region', { name: 'Unconfirmed command', exact: true }).getByRole('alert').waitFor()
    const saved = (await scaffold.ctx.workTriggers.query({ text: 'UI once' })).items
    expect(saved).toHaveLength(1); const triggerId = saved[0]!.id
    await page.getByRole('button', { name: 'Work Center', exact: true }).click()
    await page.getByRole('button', { name: 'Work triggers', exact: true }).click()
    await main.getByRole('button', { name: 'Recover original creation', exact: true }).click()
    await main.getByRole('region', { name: 'Unconfirmed command', exact: true }).waitFor({ state: 'detached' })
    const detail = main.getByRole('region', { name: 'Rule detail', exact: true })
    await detail.getByRole('heading', { name: 'UI once', exact: true }).waitFor()
    expect((await scaffold.ctx.workTriggers.read(triggerId)).definition.target).toMatchObject({ expectedRevision: 1, brief })
    const native = scaffold.ctx.workbenchAgents.command.bind(scaffold.ctx.workbenchAgents)
    const lostNative = vi.spyOn(scaffold.ctx.workbenchAgents, 'command').mockImplementationOnce(async (request) => { await native(request); throw new Error('Lost native acknowledgment') })
    await page.route('**/api/workTriggerGateway/command', async (route) => { await route.fetch(); await route.abort('failed') }, { times: 1 })
    await detail.getByRole('button', { name: 'Enable future triggers', exact: true }).click()
    await main.getByRole('region', { name: 'Unconfirmed command', exact: true }).getByRole('alert').waitFor()
    await expect.poll(async () => (await scaffold.ctx.workTriggers.read(triggerId)).occurrences[0]?.admission.state, { timeout: 15000 }).toBe('unconfirmed')
    await main.getByRole('button', { name: 'Refresh state', exact: true }).click()
    await detail.getByRole('button', { name: 'Pause future triggers', exact: true }).waitFor()
    await main.getByRole('button', { name: 'Clear local command record', exact: true }).click()
    await detail.getByRole('button', { name: 'Recover original admission', exact: true }).click()
    await expect.poll(async () => (await scaffold.ctx.workTriggers.read(triggerId)).occurrences[0]?.admission.state).toBe('settled')
    await detail.getByRole('heading', { name: 'Execution settlement observed', exact: true }).waitFor()
    lostNative.mockRestore()
    expect((await scaffold.ctx.workbenchAgents.snapshot(executor.agentId)).runs).toHaveLength(2)
    expect(adapter.requests).toHaveLength(2)
    for (let index = 0; index < 2; index++) {
      await detail.getByRole('button', { name: 'Mark read', exact: true }).first().click()
      await expect.poll(async () => (await scaffold.ctx.workTriggers.read(triggerId)).occurrences[0]!.notices
        .filter(notice => notice.readAt === undefined).length).toBe(1 - index)
    }
    const retained = await scaffold.ctx.workTriggers.read(triggerId)
    expect(retained.occurrences[0]?.attempts).toBe(2)
    expect((await scaffold.ctx.workTriggers.query({ text: 'UI once' })).items).toHaveLength(1)
    await compareOrRefreshGolden(join(snapshots, 'ui-recovery.expected.json'), `${JSON.stringify({ name: retained.definition.name, enabled: retained.enabled, rule: retained.definition.rule.kind, fixedTarget: retained.definition.target.kind === 'agent' && retained.definition.target.brief, occurrences: retained.occurrences.length, attempts: retained.occurrences[0]!.attempts, phase: retained.occurrences[0]!.admission.state, noticesRead: retained.occurrences[0]!.notices.every(value => value.readAt !== undefined), nativeRuns: 2, modelRequests: adapter.requests.length }, null, 2)}`, webSnapshotMode())
    await main.getByRole('searchbox', { name: 'Rule name', exact: true }).fill('UI once')
    await main.getByRole('button', { name: 'Apply filters', exact: true }).click()
    await main.getByRole('region', { name: 'Trigger rules', exact: true }).getByRole('button', { name: /^UI once/ }).waitFor()
    for (const width of [320, 375, 414, 768, 1680]) {
      await page.setViewportSize({ width, height: 1000 })
      await expect.poll(() => main.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
      expect(await main.locator('button').evaluateAll(elements => elements.every(element => element.scrollWidth <= element.clientWidth))).toBe(true)
    }
    await main.getByRole('button', { name: 'Refresh state', exact: true }).focus(); await page.keyboard.press('Enter')
    await expect.poll(() => main.getByRole('button', { name: 'Refresh state', exact: true }).isEnabled()).toBe(true)
    await page.context().setOffline(true); await cutStreams()
    await main.getByText('Disconnected. Retaining the last read. Reconnection never automatically resends commands.', { exact: true }).waitFor()
    expect(await detail.getByRole('button', { name: 'Pause future triggers', exact: true }).isDisabled()).toBe(true)
    await scaffold.ctx.workTriggers.command({ kind: 'set-enabled', id: triggerId, expectedRevision: retained.revision, enabled: false })
    await page.context().setOffline(false)
    await detail.getByRole('button', { name: 'Enable future triggers', exact: true }).waitFor({ timeout: 15000 })
    expect((await scaffold.ctx.workTriggers.read(triggerId)).occurrences).toHaveLength(1)
    expect(adapter.requests).toHaveLength(2)
    const chinese = await browser.newPage({ viewport: { width: 1680, height: 1000 }, locale: 'zh-CN' })
    try {
      await chinese.goto(scaffold.baseUrl); await chinese.getByRole('button', { name: '工作触发', exact: true }).click()
      const translated = chinese.getByRole('main', { name: '工作触发', exact: true })
      await translated.getByRole('region', { name: '触发规则', exact: true }).getByRole('button', { name: /^UI once/ }).click()
      await translated.getByRole('heading', { name: '已观察到执行结束', exact: true }).waitFor()
      for (const width of [320, 375, 414, 768]) {
        await chinese.setViewportSize({ width, height: 1000 })
        await expect.poll(() => translated.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
      }
      await chinese.setViewportSize({ width: 1680, height: 1000 })
      for (const theme of ['dark', 'light'] as const) {
        await chinese.emulateMedia({ colorScheme: theme })
        await expect.poll(() => chinese.locator('body').getAttribute('data-ds-dark-theme')).toBe(theme === 'dark' ? '' : null)
        await chinese.screenshot({ path: `/tmp/dsh-work-triggers-${theme}-zh.png`, fullPage: true })
      }
    } finally { await chinese.close() }
    await detail.getByRole('button', { name: 'Inspect original execution', exact: true }).click()
    await expect.poll(() => page.getByRole('main', { name: 'Work triggers', exact: true }).count()).toBe(0)
  }, 60000)

  it('prepares formal workflow publications and original inputs while retaining native approvals', async () => {
    await page.getByRole('button', { name: 'Work Center', exact: true }).click()
    const center = page.getByRole('main', { name: 'Work Center', exact: true })
    await center.getByRole('region', { name: 'Runs', exact: true }).getByRole('button', { name: /Triggered approval/ }).click()
    await center.getByRole('button', { name: 'Create trigger from this execution', exact: true }).click()
    const main = page.getByRole('main', { name: 'Work triggers', exact: true })
    await main.getByRole('button', { name: 'Use this fixed target', exact: true }).click()
    await main.getByRole('textbox', { name: 'Name', exact: true }).fill('UI workflow event')
    await main.getByRole('combobox', { name: 'Condition', exact: true }).selectOption('on-settled')
    await main.getByRole('button', { name: 'Create and enable', exact: true }).click()
    const detail = main.getByRole('region', { name: 'Rule detail', exact: true })
    await detail.getByRole('heading', { name: 'UI workflow event', exact: true }).waitFor()
    const triggerId = (await scaffold.ctx.workTriggers.query({ text: 'UI workflow event' })).items[0]!.id
    await expect.poll(async () => (await scaffold.ctx.workTriggers.read(triggerId)).occurrences[0]?.admission.state).toBe('admitted')
    const record = await scaffold.ctx.workTriggers.read(triggerId), occurrence = record.occurrences[0]!
    if (occurrence.admission.state !== 'admitted' || occurrence.admission.ref.kind !== 'workflow') throw new Error('Missing workflow admission')
    const run = await scaffold.ctx.workflowWorkbench.inspectRun(occurrence.admission.ref.id)
    expect(run.inputs).toEqual({ report: 'Original input' })
    expect(record.definition.target).toMatchObject({ kind: 'workflow', versionId: run.version.id, inputs: run.inputs })
    await expect.poll(async () => (await scaffold.ctx.workflowWorkbench.inspectRun(run.id)).status).toBe('waiting')
    await detail.getByRole('button', { name: 'Pause future triggers', exact: true }).click()
    await detail.getByRole('button', { name: 'Enable future triggers', exact: true }).waitFor()
    expect((await scaffold.ctx.workflowWorkbench.inspectRun(run.id)).status).toBe('waiting')
    await page.getByRole('button', { name: 'Work Center', exact: true }).click()
    await center.getByRole('region', { name: 'Runs', exact: true }).getByRole('button', { name: /Triggered approval/ }).first().click()
    await center.getByRole('button', { name: 'Approve this node', exact: true }).click()
    await expect.poll(async () => (await scaffold.ctx.workTriggers.read(triggerId)).occurrences[0]?.admission.state).toBe('settled')
    await page.getByRole('button', { name: 'Work triggers', exact: true }).click()
    await main.getByRole('searchbox', { name: 'Rule name', exact: true }).fill('UI workflow event')
    await main.getByRole('button', { name: 'Apply filters', exact: true }).click()
    await main.getByRole('region', { name: 'Trigger rules', exact: true }).getByRole('button', { name: /^UI workflow event/ }).click()
    await detail.getByRole('heading', { name: 'Execution settlement observed', exact: true }).waitFor()
    const complete = await scaffold.ctx.workTriggers.read(triggerId)
    await compareOrRefreshGolden(join(snapshots, 'ui-workflow.expected.json'), `${JSON.stringify({ target: complete.definition.target.kind, rule: complete.definition.rule.kind, inputs: run.inputs, paused: !complete.enabled, admittedRuns: complete.occurrences.length, nativeStatus: (await scaffold.ctx.workflowWorkbench.inspectRun(run.id)).status }, null, 2)}`, webSnapshotMode())
  })

})
