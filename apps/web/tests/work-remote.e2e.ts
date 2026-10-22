/** Two independently booted Hosts dispatch through authenticated HTTP and native durable owners. */
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { chromium } from 'playwright'
import { newEnglishPage } from './support.ts'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { RemoteCallRequest, RemoteWorkResult, RemoteSubmissionId, RemoteTarget } from '@deepseek-ai/dsh-work-remote/types'
import { MockAdapter, textResponse, toolCallResponse } from '../../../packages/core/agent-loop/tests/mock-adapter.ts'
import { launchWebScaffold, compareOrRefreshGolden, webSnapshotMode, type WebScaffold } from './scaffold.ts'
const snapshots = fileURLToPath(new URL('./snapshots/work-remote', import.meta.url))
const hostId = '8511e804-cf4b-4c78-a213-eaf480b56f8f', principalId = 'test-laptop'
const token = 'keyless-remote-authentication-0123456789abcdef'
describe('web e2e: authenticated native remote work', () => {
  let remote: WebScaffold, local: WebScaffold, root: string, adapter: MockAdapter, target: RemoteTarget, workflowTarget: RemoteTarget
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-remote-composition-'))
    remote = await launchWebScaffold()
    const workspace = await remote.ctx.workspaceRegistry.create(remote.workspaceCwd)
    await remote.ctx.credentials.set(credentialRef('DSH_REMOTE_TEST_GATEWAY_KEY'), token)
    adapter = new MockAdapter([toolCallResponse('remote-file', 'bash', { command: "printf '%s' 'Created by the remote native executor' > remote-result.txt", description: 'Write the remote task result' }), textResponse('Remote report recorded.'),
      toolCallResponse('remote-ui-file', 'bash', { command: "printf '%s' 'Remote browser delivery' > remote-ui-result.txt", description: 'Write browser-submitted remote file' }),
      textResponse('Remote browser report recorded.')])
    remote.ctx.llm.registerAdapter(['remote-native-test'], adapter)
    remote.ctx.llm.registerConfigurableProviders([{ provider: 'remote-native-test', displayName: 'Remote native executor', settingsNs: '', settingsPath: [], localCommand: process.execPath, defaultModel: 'mock' }])
    const agent = await remote.ctx.workbenchAgents.command({ kind: 'create', definition: { name: 'Remote reporter', avatar: '', description: '', instructions: 'Write the requested remote result.', runtime: 'remote-native-test', skills: [], mcpServers: [], starters: [], concurrency: 1 } })
    target = { kind: 'agent', id: agent.agentId, workspaceId: workspace.id, expectedRevision: 1, brief: { version: 1,
      goal: 'Write remote-result.txt on the selected remote workspace', background: 'Remote task material', deliverables: ['remote-result.txt'], acceptanceCriteria: ['Use the remote workspace'], constraints: 'Keep credentials on their owning Host' } }
    const workflow = await remote.ctx.workflowWorkbench.command({ kind: 'create', workspaceId: workspace.id, name: 'Remote approval', description: 'Native confirmation' })
    const definition = { requirement: { summary: 'Approve a remote report', objectives: [{ id: 'approve', statement: 'Confirm original input' }],
      inputs: [{ name: 'report', description: 'Remote report' }], outputs: [{ name: 'approved', description: 'Confirmed report' }], constraints: [],
      acceptanceCases: [{ name: 'sample', given: { report: 'Remote original input' }, expect: { kind: 'nonEmpty' as const } }] },
    nodes: [{ id: 'approve', kind: 'approval' as const, title: 'Remote human approval', instruction: 'Confirm this report', preset: 'standard', dependsOn: [],
      inputs: [{ name: 'report', source: { kind: 'requirement' as const, field: 'report' } }], objectives: ['approve'] }],
    finalOutputs: [{ name: 'approved', source: { kind: 'step' as const, step: 'approve' } }], positions: {} }
    await remote.ctx.workflowWorkbench.command({ kind: 'save', id: workflow.workflowId, expectedRevision: 1, name: 'Remote approval', definition })
    await remote.ctx.workflowWorkbench.command({ kind: 'publish', id: workflow.workflowId, expectedRevision: 2 })
    const publication = (await remote.ctx.workflowWorkbench.snapshot(workflow.workflowId)).workflows[0]!.versions[0]!
    workflowTarget = { kind: 'workflow', id: workflow.workflowId, workspaceId: workspace.id, versionId: publication.id, inputs: { report: 'Remote original input' } }
    const receiverPath = join(root, 'receiver.cordis.yml')
    await writeFile(receiverPath, `- id: machine-receiver\n  name: ${pathToFileURL(fileURLToPath(new URL('../../../packages/business/work-remote/lib/types/receiver.js', import.meta.url))).href}\n  config:\n    hostId: ${hostId}\n    principals:\n      - id: ${principalId}\n        credentialRef: DSH_REMOTE_TEST_GATEWAY_KEY\n        allowStop: true\n        allowWorkflowDecisions: true\n        grants:\n          - workspaceId: ${workspace.id}\n            agents: ['${agent.agentId}']\n            workflows: ['${workflow.workflowId}']\n`)
    await remote.ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(receiverPath).href } })
    await remote.ctx.loader.await()
    const overlay = join(root, 'client.patch.yml')
    await writeFile(overlay, `- id: work-remote\n  config:\n    peers:\n      - id: remote-test\n        name: Remote test machine\n        origin: ${remote.baseUrl}\n        hostId: ${hostId}\n        principalId: ${principalId}\n        credentialRef: DSH_REMOTE_TEST_GATEWAY_KEY\n`)
    local = await launchWebScaffold({ extraOverlayPath: overlay })
    await local.ctx.credentials.set(credentialRef('DSH_REMOTE_TEST_GATEWAY_KEY'), token)
    await mkdir(snapshots, { recursive: true })
  }, 120000)
  afterAll(async () => { await local?.close(); await remote?.close(); await rm(root, { recursive: true, force: true }) })
  async function invoke(operation: object): Promise<RemoteWorkResult> {
    const method = 'remoteWorkGateway/call'
    const response = await fetch(`${local.baseUrl}/api/${method}`, { method: 'POST', headers: { origin: local.baseUrl, 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: randomUUID(), method, payload: { args: { request: { peer: 'remote-test', expected: { hostId, principalId }, operation } } } }) })
    expect(response.ok).toBe(true)
    const body = await response.json() as { result: { ok: boolean; value: RemoteWorkResult; error?: { message: string } } }
    if (!body.result.ok) throw new Error(body.result.error?.message)
    return body.result.value
  }
  it('recovers one remote admission after a lost native response and records output only on the remote Host', async () => {
    const catalog = await invoke({ kind: 'catalog' })
    expect(catalog).toMatchObject({ kind: 'catalog', catalog: { credentialOwner: 'remote-host', workspaces: [{ path: remote.workspaceCwd }] } })
    const id = randomUUID() as RemoteSubmissionId, native = remote.ctx.workbenchAgents.command.bind(remote.ctx.workbenchAgents)
    const lost = vi.spyOn(remote.ctx.workbenchAgents, 'command').mockImplementationOnce(async (command) => { await native(command); throw new Error('Lost native admission response') })
    expect(await invoke({ kind: 'submit', id, target })).toMatchObject({ kind: 'submission', submission: { admission: { state: 'unconfirmed' } } })
    await expect.poll(async () => (await remote.ctx.workbenchAgents.queryRuns({ limit: 10 })).items[0]?.status, { timeout: 15000 }).toBe('completed')
    const admitted = await invoke({ kind: 'recover', id, expectedAttempt: 1 })
    expect(admitted).toMatchObject({ kind: 'submission', submission: { attempts: 2, admission: { state: 'admitted' } } })
    lost.mockRestore()
    const inspected = await invoke({ kind: 'inspect', id })
    expect(inspected).toMatchObject({ kind: 'inspection', source: { status: 'completed' }, delivery: { outputs: [{ text: 'Remote report recorded.' }] } })
    expect(JSON.stringify(inspected)).not.toContain(token); expect(JSON.stringify(adapter.requests)).not.toContain(token)
    expect(await readFile(join(remote.workspaceCwd, 'remote-result.txt'), 'utf8')).toBe('Created by the remote native executor')
    await expect(readFile(join(local.workspaceCwd, 'remote-result.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
    const runs = (await remote.ctx.workbenchAgents.queryRuns({ limit: 10 })).items
    expect(runs).toHaveLength(1); expect((await local.ctx.workbenchAgents.queryRuns({ limit: 10 })).items).toHaveLength(0)
    const transcript = await remote.ctx.sessionPersistence.inspect(runs[0]!.sessionId)
    expect(JSON.stringify(transcript.events.filter(event => event.type === 'user/message'))).toContain('Write remote-result.txt on the selected remote workspace')
    await compareOrRefreshGolden(join(snapshots, 'remote-agent.expected.json'), `${JSON.stringify({ phase: 'admitted', attempts: 2, remoteNativeRuns: runs.length, localNativeRuns: 0, modelRequests: adapter.requests.length, output: inspected.kind === 'inspection' ? inspected.delivery?.outputs : undefined, remoteFile: await readFile(join(remote.workspaceCwd, 'remote-result.txt'), 'utf8'), privateRecoveryFieldsExposed: JSON.stringify(inspected).includes('inputHash') }, null, 2)}`, webSnapshotMode())
  })
  it('preserves native workflow confirmation and fixed publication inputs through the authenticated route', async () => {
    const id = randomUUID() as RemoteSubmissionId
    const admitted = await invoke({ kind: 'submit', id, target: workflowTarget })
    if (admitted.kind !== 'submission' || admitted.submission.admission.state !== 'admitted' || admitted.submission.admission.ref.kind !== 'workflow') throw new Error('Missing workflow admission')
    const runId = admitted.submission.admission.ref.id
    await expect.poll(async () => (await remote.ctx.workflowWorkbench.inspectRun(runId)).status, { timeout: 15000 }).toBe('waiting')
    const waiting = await invoke({ kind: 'inspect', id })
    if (waiting.kind !== 'inspection' || waiting.decisions?.[0] === undefined) throw new Error('Missing native decision context')
    expect(waiting.decisions[0].inputs).toEqual({ report: 'Remote original input' })
    await invoke({ kind: 'decide', id, attemptId: waiting.decisions[0].attemptId, approve: true })
    await expect.poll(async () => (await remote.ctx.workflowWorkbench.inspectRun(runId)).status).toBe('succeeded')
    const inspected = await invoke({ kind: 'inspect', id })
    expect(inspected).toMatchObject({ source: { status: 'succeeded' } })
    const complete = await remote.ctx.workflowWorkbench.inspectRun(runId)
    expect(complete.inputs).toEqual({ report: 'Remote original input' })
    expect(workflowTarget.kind === 'workflow' && complete.version.id).toBe(workflowTarget.kind === 'workflow' && workflowTarget.versionId)
    expect((await local.ctx.workflowWorkbench.queryRuns({ limit: 10 })).items).toHaveLength(0)
    await compareOrRefreshGolden(join(snapshots, 'remote-workflow.expected.json'), `${JSON.stringify({ remoteStatus: complete.status, mode: complete.mode, inputs: complete.inputs, nativeApproval: true, publicationPinned: true, localNativeRuns: 0, textOnlyDelivery: inspected.kind === 'inspection' && inspected.delivery?.evidence }, null, 2)}`, webSnapshotMode())
  })
  it('submits and recovers from the real remote page and confirms original workflow inputs across both themes and narrow layouts', async () => {
    const browser = await chromium.launch(), page = await newEnglishPage(browser)
    let cutStreams: (() => Promise<void>) | undefined
    await page.routeWebSocket('**/api/events.host', (socket) => {
      const server = socket.connectToServer()
      cutStreams = async () => { await Promise.all([socket.close(), server.close()]) }
    })
    const calls: RemoteCallRequest[] = [], submittedIds = new Set<string>(), native = local.ctx.remoteWork.call.bind(local.ctx.remoteWork)
    let lose = true
    const lost = vi.spyOn(local.ctx.remoteWork, 'call').mockImplementation(async (request) => {
      const result = await native(request)
      if (request.operation.kind === 'submit') {
        calls.push(structuredClone(request)); submittedIds.add(request.operation.id)
        if (lose) { lose = false; throw new Error('Remote browser acknowledgment lost') }
      }
      return result
    })
    try {
      await page.goto(local.baseUrl)
      await page.getByRole('button', { name: 'Remote execution', exact: true }).click()
      const main = page.getByRole('main', { name: 'Remote execution', exact: true })
      await main.getByRole('combobox', { name: 'Execution machine', exact: true }).selectOption('remote-test')
      await main.getByRole('combobox', { name: 'Remote workspace', exact: true }).selectOption(target.workspaceId)
      await main.getByRole('combobox', { name: 'Executor', exact: true }).selectOption(target.id)
      await main.getByRole('textbox', { name: 'Task goal', exact: true }).fill('Write remote-ui-result.txt in the selected remote workspace')
      await main.getByRole('button', { name: 'Submit remotely', exact: true }).click()
      await main.getByText('Remote browser acknowledgment lost', { exact: true }).waitFor()
      await page.getByRole('button', { name: 'Work Center', exact: true }).click()
      await page.getByRole('button', { name: 'Remote execution', exact: true }).click()
      await main.getByRole('region', { name: 'Unconfirmed operation', exact: true }).waitFor()
      expect(calls).toHaveLength(1)
      await main.getByRole('button', { name: 'Resubmit original identity', exact: true }).click()
      await expect.poll(() => calls.length).toBe(2); expect(calls[1]).toEqual(calls[0])
      await expect.poll(async () => (await remote.ctx.workbenchAgents.queryRuns({ limit: 10 })).items.filter(value => value.status === 'completed').length).toBe(2)
      await main.getByRole('button', { name: 'Refresh state', exact: true }).click()
      await main.getByText('Remote browser report recorded.', { exact: true }).waitFor()
      expect(await readFile(join(remote.workspaceCwd, 'remote-ui-result.txt'), 'utf8')).toBe('Remote browser delivery')
      await expect(readFile(join(local.workspaceCwd, 'remote-ui-result.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
      await main.getByRole('combobox', { name: 'Task type', exact: true }).selectOption('workflow')
      await main.getByRole('combobox', { name: 'Executor', exact: true }).selectOption(workflowTarget.id)
      if (workflowTarget.kind !== 'workflow') throw new Error('Missing workflow target')
      await main.getByRole('combobox', { name: 'Published version', exact: true }).selectOption(workflowTarget.versionId)
      await main.getByRole('textbox', { name: 'Original inputs (JSON object)', exact: true }).fill('{"report":"Browser original input"}')
      await main.getByRole('button', { name: 'Submit remotely', exact: true }).click()
      const decision = main.getByRole('region', { name: 'Remote human approval', exact: true })
      await expect.poll(async () => { await main.getByRole('button', { name: 'Refresh state', exact: true }).click(); return await decision.count() }).toBe(1)
      expect(await decision.textContent()).toContain('Browser original input')
      for (const width of [320, 375, 414, 768, 1680]) {
        await page.setViewportSize({ width, height: 1000 })
        await expect.poll(() => main.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
        expect(await main.locator('button').evaluateAll(elements => elements.every(element => element.scrollWidth <= element.clientWidth))).toBe(true)
      }
      await main.getByRole('button', { name: 'Refresh state', exact: true }).focus(); await page.keyboard.press('Enter')
      await decision.getByRole('button', { name: 'Approve', exact: true }).click()
      expect((await remote.ctx.workflowWorkbench.queryRuns({ limit: 10 })).items.filter(value => value.status === 'waiting')).toHaveLength(1)
      await main.getByRole('button', { name: 'Confirm operation', exact: true }).focus()
      await page.keyboard.press('Enter')
      await expect.poll(async () => (await remote.ctx.workflowWorkbench.queryRuns({ limit: 10 })).items.filter(value => value.status === 'succeeded').length).toBe(2)
      await main.getByRole('button', { name: 'Refresh state', exact: true }).click()
      const beforeReconnect = calls.length
      await page.context().setOffline(true)
      if (cutStreams === undefined) throw new Error('Missing browser event stream')
      await cutStreams()
      await main.getByText('Disconnected. Keeping the last read; reconnect never repeats a submission.', { exact: true }).waitFor()
      expect(await main.getByRole('button', { name: 'Submit remotely', exact: true }).isDisabled()).toBe(true)
      await page.context().setOffline(false)
      await expect.poll(() => main.getByRole('button', { name: 'Refresh state', exact: true }).isEnabled(), { timeout: 15000 }).toBe(true)
      expect(calls).toHaveLength(beforeReconnect)
      const chinese = await browser.newPage({ viewport: { width: 1680, height: 1000 }, locale: 'zh-CN' })
      try {
        await chinese.goto(local.baseUrl); await chinese.getByRole('button', { name: '远程执行', exact: true }).click()
        const translated = chinese.getByRole('main', { name: '远程执行', exact: true })
        await translated.getByRole('combobox', { name: '执行机器', exact: true }).selectOption('remote-test')
        await translated.getByRole('complementary', { name: '目标与权限', exact: true }).getByRole('button').first().click()
        for (const width of [320, 375, 414, 768]) {
          await chinese.setViewportSize({ width, height: 1000 })
          await expect.poll(() => translated.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
        }
        await chinese.setViewportSize({ width: 1680, height: 1000 })
        for (const theme of ['dark', 'light'] as const) {
          await chinese.emulateMedia({ colorScheme: theme })
          await expect.poll(() => chinese.locator('body').getAttribute('data-ds-dark-theme')).toBe(theme === 'dark' ? '' : null)
          await chinese.screenshot({ path: `/tmp/dsh-work-remote-${theme}-zh.png`, fullPage: true, animations: 'disabled' })
        }
      } finally { await chinese.close() }
      expect((await local.ctx.workbenchAgents.queryRuns({ limit: 10 })).items).toHaveLength(0)
      expect((await local.ctx.workflowWorkbench.queryRuns({ limit: 10 })).items).toHaveLength(0)
      await compareOrRefreshGolden(join(snapshots, 'remote-browser.expected.json'), `${JSON.stringify({ page: 'Remote execution', fixedAuthority: true, explicitResubmissions: calls.length - submittedIds.size,
        remoteAgentRuns: (await remote.ctx.workbenchAgents.queryRuns({ limit: 10 })).items.length,
        modelRequests: adapter.requests.length, remoteFile: await readFile(join(remote.workspaceCwd, 'remote-ui-result.txt'), 'utf8'),
        workflowStatus: 'succeeded', approvalInputs: 'Browser original input', localNativeRuns: 0 }, null, 2)}`, webSnapshotMode())
    } finally { lost.mockRestore(); await browser.close() }
  })

})
