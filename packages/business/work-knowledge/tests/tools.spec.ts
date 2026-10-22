/** Workspace authority, exact model output, and disposal through the real tool registry. */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, expect, it, vi } from 'vitest'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { type JsonValue, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import * as Tools from '../src/tools.ts'
const contexts: Context[] = []
afterEach(async () => { await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose())) })
async function boot(config: Partial<Tools.Config> = {}) {
  const ctx = new Context(); contexts.push(ctx)
  await ctx.plugin(SystemPrompt); await ctx.plugin(ToolRuntime)
  const search = vi.fn(async () => ({ hits: [], more: false, current: [], excluded: [], observedAt: 1 }))
  const read = vi.fn(async () => ({ text: 'Captured line', path: 'source.md' }))
  const resolve = vi.fn(async () => ({ id: 'owned' }))
  ctx.provide('workKnowledge', { search, read } as never)
  ctx.provide('workspaceRegistry', { resolveByPath: resolve } as never)
  const fiber = await ctx.plugin(Tools, { maxOutputBytes: 1048576, ...config })
  const exec = { agent: { session: { header: { cwd: '/owned' } } } } as ToolRunContext
  return { ctx, fiber, search, read, resolve, exec }
}
it('binds both tools to the executing session workspace and renders exact inert JSON', async () => {
  const ui = await boot(), search = ui.ctx.tools.get('knowledge_search')!, read = ui.ctx.tools.get('knowledge_read')!
  const found = await search.execute({ text: '材料', limit: 2, workspaceId: 'attacker' }, ui.exec)
  expect(ui.search).toHaveBeenCalledWith({ workspaceId: 'owned', text: '材料', limit: 2 })
  expect(ui.resolve).toHaveBeenCalledWith('/owned')
  expect(search.output.render({}, found as JsonValue)).toEqual([{ type: 'text', text: JSON.stringify(found) }])
  const citation = { sourceId: 'source', version: 1, textSha256: 'sha', startLine: 1, endLine: 2 }
  const excerpt = await read.execute(citation, ui.exec)
  expect(ui.read).toHaveBeenCalledWith('owned', citation)
  expect(read.output.render({}, excerpt as JsonValue)).toEqual([{ type: 'text', text: JSON.stringify(excerpt) }])
  expect(search.isConcurrencySafe?.({ text: '材料', limit: 1 })).toBe(true); expect(read.isConcurrencySafe?.(citation)).toBe(true)
  await ui.fiber.dispose()
  expect(ui.ctx.tools.get('knowledge_search')).toBeUndefined(); expect(ui.ctx.tools.get('knowledge_read')).toBeUndefined()
})
it('rejects agentless and unregistered workspaces before querying and bounds complete rendered output', async () => {
  const ui = await boot({ maxOutputBytes: 1 }), tool = ui.ctx.tools.get('knowledge_search')!
  await expect(tool.execute({ text: '材料', limit: 1 }, {} as ToolRunContext)).rejects.toThrow('agent session')
  await expect(tool.execute({ text: '材料', limit: 1 }, { agent: { session: { header: {} } } } as ToolRunContext)).rejects.toThrow('agent session')
  ui.resolve.mockResolvedValueOnce(undefined as never)
  await expect(tool.execute({ text: '材料', limit: 1 }, ui.exec)).rejects.toThrow('no registered')
  expect(ui.search).not.toHaveBeenCalled()
  const result = await tool.execute({ text: '材料', limit: 1 }, ui.exec)
  expect(() => tool.output.render({}, result as JsonValue)).toThrow('maxOutputBytes')
})
