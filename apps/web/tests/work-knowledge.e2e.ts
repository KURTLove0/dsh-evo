/** Explicit knowledge grants through the real Web Loader, native agent loop, and session log. */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright'
import { MockAdapter, textResponse, toolCallResponse } from '../../../packages/core/agent-loop/tests/mock-adapter.ts'
import type {} from '@deepseek-ai/dsh-work-knowledge'
import type { KnowledgeCitation } from '@deepseek-ai/dsh-work-knowledge/types'
import { launchWebScaffold, captureStableAria, compareOrRefreshGolden, webSnapshotMode, watchConsole, type WebScaffold } from './scaffold.ts'
import { newEnglishPage } from './support.ts'
const snapshots = fileURLToPath(new URL('./snapshots/work-knowledge', import.meta.url))
const text = '# Project material\n中文资料：原始版本\nconst answer = 42;\n<script>globalThis.knowledgeExecuted=true</script>\n'
describe('web e2e: explicit project knowledge', () => {
  let scaffold: WebScaffold, root: string, adapter: MockAdapter, browser: Browser, page: Page
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-knowledge-web-'))
    scaffold = await launchWebScaffold({})
    await mkdir(snapshots, { recursive: true })
  }, 120000)
  afterAll(async () => { await browser?.close(); await scaffold?.close(); await rm(root, { recursive: true, force: true }) })
  it('logs exact captured search/read results and enforces revocation in a later native execution', async () => {
    const workspace = await scaffold.ctx.workspaceRegistry.create(scaffold.workspaceCwd)
    await writeFile(join(scaffold.workspaceCwd, 'source.md'), text)
    const service = scaffold.ctx.workKnowledge
    const source = await service.register({ id: 'project-material' as never, workspaceId: workspace.id, path: 'source.md' })
    const indexed = await service.index({ id: source.id, expectedRevision: source.revision, requestId: 'index-original' as never })
    const capture = indexed.source.versions[0]!
    const citation: KnowledgeCitation = { sourceId: source.id, version: 1, textSha256: capture.textSha256, startLine: 2, endLine: 3 }
    await writeFile(join(scaffold.workspaceCwd, 'source.md'), 'Changed current file')
    adapter = new MockAdapter([
      toolCallResponse('search-material', 'knowledge_search', { text: '中文资料', limit: 2 }),
      toolCallResponse('read-material', 'knowledge_read', citation),
      textResponse('Delivery cites source.md v1 L2–L3.'),
      toolCallResponse('read-revoked', 'knowledge_read', citation),
      textResponse('The knowledge source is disabled; request explicit access.'),
    ])
    scaffold.ctx.llm.registerAdapter(['knowledge-test'], adapter)
    scaffold.ctx.llm.registerConfigurableProviders([{ provider: 'knowledge-test', displayName: 'Knowledge executor', settingsNs: '', settingsPath: [], localCommand: process.execPath, defaultModel: 'mock' }])
    const agent = await scaffold.ctx.workbenchAgents.command({ kind: 'create', definition: { name: 'Knowledge reader', avatar: '', description: '', instructions: 'Use explicit project materials and cite captured lines.', runtime: 'knowledge-test', skills: [], mcpServers: [], starters: [], concurrency: 1 } })
    const execute = async (prompt: string) => {
      const receipt = await scaffold.ctx.workbenchAgents.command({ kind: 'run', id: agent.agentId, workspaceId: workspace.id, prompt })
      if (receipt.runId === undefined) throw new Error('Expected native run')
      await expect.poll(async () => (await scaffold.ctx.workbenchAgents.queryRuns({ limit: 10 })).items.find(run => run.id === receipt.runId)?.status, { timeout: 15000 }).toBe('completed')
      const run = (await scaffold.ctx.workbenchAgents.queryRuns({ limit: 10 })).items.find(value => value.id === receipt.runId)!
      const session = await scaffold.ctx.sessionPersistence.inspect(run.sessionId)
      return session.events.filter(event => event.type === 'tool/result').map((event) => {
        const data = event.data.message.content[0]
        const content = data.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
        if (data.isError) return { isError: true, content }
        return { isError: false, value: JSON.parse(content) as Record<string, unknown> }
      })
    }
    const first = await execute('Find project material, read the original lines, and cite them.')
    expect(first).toHaveLength(2)
    expect(JSON.stringify(first)).toContain('中文资料：原始版本')
    expect(JSON.stringify(first)).toContain('different')
    expect(JSON.stringify(adapter.requests[2]?.messages)).toContain('const answer = 42;')
    await service.setEnabled({ id: source.id, expectedRevision: indexed.source.revision, enabled: false })
    const denied = await execute('Read the same material after access is disabled.')
    expect(denied).toHaveLength(1); expect(denied[0]?.isError).toBe(true)
    expect(JSON.stringify(denied)).toContain('disabled')
    expect(JSON.stringify(adapter.requests.at(-1)?.messages)).not.toContain('中文资料：原始版本')
    expect(adapter.requests).toHaveLength(5)
    const stable = JSON.stringify({ first, denied }, (key, value: unknown) => key === 'observedAt' ? 0 : value, 2)
    await compareOrRefreshGolden(join(snapshots, 'native-tools.expected.json'), stable, webSnapshotMode())
  }, 60000)
  it('manages real source grants and captured versions through the shipped page with inert previews', async () => {
    const material = '// Project material\nconst launch = "已确认范围";\n<script>globalThis.knowledgeExecuted=true</script>\n'
    await writeFile(join(scaffold.workspaceCwd, 'project-notes.ts'), material)
    const workspace = await scaffold.ctx.workspaceRegistry.resolveByPath(scaffold.workspaceCwd)
    if (workspace === undefined) throw new Error('Missing scenario workspace')
    browser = await chromium.launch(); page = await newEnglishPage(browser); page.setDefaultTimeout(15000)
    const console = watchConsole(page)
    await page.goto(scaffold.baseUrl)
    await page.getByRole('button', { name: 'Knowledge directory', exact: true }).click()
    const main = page.getByRole('main', { name: 'Knowledge directory', exact: true })
    await main.getByRole('combobox', { name: 'Workspace', exact: true }).selectOption(workspace.id)
    await main.getByRole('textbox', { name: 'Project file path', exact: true }).fill('project-notes.ts')
    await main.getByRole('button', { name: 'Add and enable source', exact: true }).click()
    await main.getByRole('button', { name: /^project-notes.ts/ }).click()
    await main.getByRole('button', { name: 'Index current file', exact: true }).click()
    await expect.poll(async () => (await scaffold.ctx.workKnowledge.sources(workspace.id)).find(source => source.path === 'project-notes.ts')?.versions.length).toBe(1)
    await main.getByRole('searchbox', { name: 'Literal substring', exact: true }).fill('已确认')
    await main.getByRole('button', { name: 'Search materials', exact: true }).click()
    const results = main.getByRole('region', { name: 'Search results', exact: true })
    await results.locator('pre').getByText('const launch = "已确认范围";', { exact: true }).waitFor()
    await results.getByRole('button', { name: 'Read captured text', exact: true }).click()
    const preview = main.getByRole('region', { name: 'Exact citation preview', exact: true })
    await preview.locator('pre').getByText('const launch = "已确认范围";', { exact: true }).waitFor()
    await main.getByRole('button', { name: /^project-notes.ts/ }).click()
    const form = main.getByRole('form', { name: 'Exact citation preview', exact: true })
    await form.getByRole('button', { name: 'Read captured text', exact: true }).click()
    await preview.locator('pre').getByText(material, { exact: true }).waitFor()
    expect(await page.evaluate(() => Reflect.get(globalThis, 'knowledgeExecuted') as unknown)).toBeUndefined()
    await writeFile(join(scaffold.workspaceCwd, 'project-notes.ts'), '// New material\nconst launch = "新版本";\n')
    await main.getByRole('button', { name: 'Index current file', exact: true }).click()
    await expect.poll(async () => (await scaffold.ctx.workKnowledge.sources(workspace.id)).find(source => source.path === 'project-notes.ts')?.versions.length).toBe(2)
    await form.getByRole('combobox', { name: 'Capture version', exact: true }).selectOption('2')
    await form.getByRole('combobox', { name: 'Capture version', exact: true }).selectOption('1')
    await form.getByRole('button', { name: 'Read captured text', exact: true }).click()
    await preview.locator('pre').getByText(material, { exact: true }).waitFor()
    await preview.getByText('Current file observation: Differs from indexed capture', { exact: true }).waitFor()
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
    await preview.getByRole('button', { name: 'Copy citation', exact: true }).click()
    await preview.getByText('Citation copied', { exact: true }).waitFor()
    const copied = JSON.parse(await page.evaluate(() => navigator.clipboard.readText())) as KnowledgeCitation & { path: string }
    const source = (await scaffold.ctx.workKnowledge.sources(workspace.id)).find(source => source.path === 'project-notes.ts')!
    expect(copied).toEqual({ path: source.path, sourceId: source.id, version: 1, textSha256: source.versions[0]!.textSha256,
      startLine: 1, endLine: 4 })
    await main.getByRole('button', { name: 'Disable source', exact: true }).click()
    await main.getByRole('button', { name: 'Enable source', exact: true }).waitFor()
    expect(await preview.locator('pre').count()).toBe(0)
    expect(await form.getByRole('button', { name: 'Read captured text', exact: true }).isDisabled()).toBe(true)
    await expect(scaffold.ctx.workKnowledge.read(workspace.id, copied)).rejects.toThrow('disabled')
    await main.getByRole('button', { name: 'Enable source', exact: true }).focus(); await page.keyboard.press('Enter')
    await main.getByRole('button', { name: 'Disable source', exact: true }).waitFor()
    await form.getByRole('button', { name: 'Read captured text', exact: true }).click()
    await preview.locator('pre').getByText(material, { exact: true }).waitFor()
    expect(console.pageErrors).toEqual([]); expect(adapter.requests).toHaveLength(5)
    await compareOrRefreshGolden(join(snapshots, 'browser-citation.expected.json'), `${JSON.stringify({ path: copied.path, version: copied.version,
      textSha256: copied.textSha256, startLine: copied.startLine, endLine: copied.endLine, retainedOriginal: true,
      versions: source.versions.length,
      scriptExecuted: false, revokedReadDenied: true, keyboardReenabled: true, modelRequests: adapter.requests.length }, null, 2)}`, webSnapshotMode())
  }, 60000)
  it('recovers a lost registration acknowledgment across page remounts with one fixed source identity', async () => {
    const workspace = (await scaffold.ctx.workspaceRegistry.resolveByPath(scaffold.workspaceCwd))!
    await writeFile(join(scaffold.workspaceCwd, 'uncertain.md'), 'Explicit recoverable material')
    const main = page.getByRole('main', { name: 'Knowledge directory', exact: true }), requests: string[] = []
    const endpoint = '**/api/workKnowledgeGateway/register'; let drop = true
    await page.route(endpoint, async (route) => {
      requests.push(route.request().postData() ?? '')
      if (!drop) { await route.continue(); return }
      drop = false; await route.fetch(); await route.abort('failed')
    })
    try {
      await main.getByRole('textbox', { name: 'Project file path', exact: true }).fill('uncertain.md')
      await main.getByRole('button', { name: 'Add and enable source', exact: true }).click()
      await main.getByRole('alert').waitFor()
      await expect.poll(async () => (await scaffold.ctx.workKnowledge.sources(workspace.id)).filter(source => source.path === 'uncertain.md').length).toBe(1)
      await page.getByRole('button', { name: 'Work Center', exact: true }).click()
      await page.getByRole('button', { name: 'Knowledge directory', exact: true }).click()
      await main.getByRole('region', { name: 'Unconfirmed operation', exact: true }).waitFor()
      expect(requests).toHaveLength(1)
      await main.getByRole('button', { name: 'Retry the same operation', exact: true }).click()
      await main.getByRole('region', { name: 'Unconfirmed operation', exact: true }).waitFor({ state: 'detached' })
      expect(requests).toHaveLength(2)
      const first = JSON.parse(requests[0]!) as { payload: unknown }, second = JSON.parse(requests[1]!) as { payload: unknown }
      expect(second.payload).toEqual(first.payload)
      expect((await scaffold.ctx.workKnowledge.sources(workspace.id)).filter(source => source.path === 'uncertain.md')).toHaveLength(1)
      const indexing = '**/api/workKnowledgeGateway/index'; let loseIndex = true
      const indexRequests: string[] = []
      await page.route(indexing, async (route) => {
        indexRequests.push(route.request().postData() ?? '')
        if (!loseIndex) { await route.continue(); return }
        loseIndex = false; await route.fetch(); await route.abort('failed')
      })
      try {
        await main.getByRole('button', { name: /^uncertain.md/ }).click()
        await main.getByRole('button', { name: 'Index current file', exact: true }).click()
        await main.getByRole('alert').waitFor()
        await writeFile(join(scaffold.workspaceCwd, 'uncertain.md'), 'Changed after a lost indexing acknowledgment')
        await page.getByRole('button', { name: 'Work Center', exact: true }).click()
        await page.getByRole('button', { name: 'Knowledge directory', exact: true }).click()
        expect(indexRequests).toHaveLength(1)
        await main.getByRole('button', { name: 'Retry the same operation', exact: true }).click()
        await main.getByRole('region', { name: 'Unconfirmed operation', exact: true }).waitFor({ state: 'detached' })
        expect(indexRequests).toHaveLength(2)
        const original = JSON.parse(indexRequests[0]!) as { payload: unknown }
        const recovered = JSON.parse(indexRequests[1]!) as { payload: unknown }
        expect(recovered.payload).toEqual(original.payload)
        await main.getByRole('region', { name: 'Operation receipt', exact: true }).getByText('Capture saved · v1', { exact: true }).waitFor()
        const source = (await scaffold.ctx.workKnowledge.sources(workspace.id)).find(source => source.path === 'uncertain.md')!
        expect(source.versions).toHaveLength(1)
        await main.getByRole('button', { name: /^uncertain.md/ }).click()
        await main.getByRole('button', { name: 'Read captured text', exact: true }).click()
        await main.getByRole('region', { name: 'Exact citation preview', exact: true }).locator('pre').getByText('Explicit recoverable material', { exact: true }).waitFor()
      } finally { await page.unroute(indexing) }
      await page.reload(); await page.getByRole('button', { name: 'Knowledge directory', exact: true }).click()
      await main.getByRole('combobox', { name: 'Workspace', exact: true }).selectOption(workspace.id)
      await main.getByRole('button', { name: /^uncertain.md/ }).waitFor()
      expect(requests).toHaveLength(2); expect(adapter.requests).toHaveLength(5)
    } finally { await page.unroute(endpoint) }
  }, 60000)
  it('keeps the directory usable in Chinese, both themes, and narrow layouts without extra model requests', async () => {
    const main = page.getByRole('main', { name: 'Knowledge directory', exact: true })
    const aria = await captureStableAria(page, 'aside[aria-label="Material sources"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(join(snapshots, 'directory.expected.md'), aria, webSnapshotMode())
    for (const width of [320, 375, 414, 768, 1680]) {
      await page.setViewportSize({ width, height: 1000 })
      await expect.poll(() => main.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    }
    const chinese = await browser.newPage({ viewport: { width: 1680, height: 1500 }, locale: 'zh-CN' })
    try {
      await chinese.goto(scaffold.baseUrl); await chinese.getByRole('button', { name: '知识目录', exact: true }).click()
      const directory = chinese.getByRole('main', { name: '知识目录', exact: true })
      const workspace = (await scaffold.ctx.workspaceRegistry.resolveByPath(scaffold.workspaceCwd))!
      await directory.getByRole('combobox', { name: '工作空间', exact: true }).selectOption(workspace.id)
      await directory.getByRole('button', { name: /^project-notes.ts/ }).click()
      await directory.getByRole('combobox', { name: '捕获版本', exact: true }).selectOption('1')
      await directory.getByRole('button', { name: '读取捕获原文', exact: true }).click()
      await directory.getByText('// Project material', { exact: false }).waitFor()
      for (const theme of ['dark', 'light'] as const) {
        await chinese.emulateMedia({ colorScheme: theme })
        await expect.poll(() => chinese.locator('body').getAttribute('data-ds-dark-theme')).toBe(theme === 'dark' ? '' : null)
        await chinese.screenshot({ path: `/tmp/dsh-work-knowledge-${theme}-zh.png`, fullPage: true, animations: 'disabled' })
      }
    } finally { await chinese.close() }
    expect(adapter.requests).toHaveLength(5)
  }, 60000)
})
