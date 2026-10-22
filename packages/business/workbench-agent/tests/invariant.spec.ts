/** Negative cases for persisted execution identity and generated-candidate ownership. */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, expect, it } from 'vitest'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as Companion from '../src/invariant.ts'

const contexts: Context[] = []
afterEach(async () => { await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose())) })
it('rejects run keys, configuration owners, and incomplete design candidates that disagree', async () => {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(InvariantRegistry, { package_allowlist: ['^@deepseek-ai/dsh-workbench-agent$'] })
  await ctx.plugin(Companion).await()
  const changed = (value: object) => { ctx.emit('domain/changed', { domain: 'workbench_agents', table: 'runs', key: 'run', operation: 'put', value }) }
  expect(() => { changed({ id: 'other' }) }).toThrow('key differs')
  expect(() => { changed({ id: 'run', agentId: 'agent', definition: { id: 'other' } }) }).toThrow('another identity')
  expect(() => { changed({ id: 'run', purpose: 'design', status: 'running', candidate: {} }) }).toThrow('incomplete')
  expect(() => { changed({ id: 'run', purpose: undefined, status: 'completed', candidate: {} }) }).toThrow('non-design')
  expect(() => { changed({ id: 'run', purpose: 'design', status: 'completed', candidate: {} }) }).not.toThrow()
  const retry = { id: 'run', agentId: 'agent', retryOf: 'source', definition: { id: 'agent', revision: 2 }, retryRequest: { id: 'request', agentRevision: 2 } }
  expect(() => { changed(retry) }).not.toThrow()
  expect(() => { changed({ ...retry, retryOf: undefined }) }).toThrow('another execution')
  expect(() => { changed({ ...retry, retryOf: 'run' }) }).toThrow('another execution')
  expect(() => { changed({ ...retry, definition: undefined }) }).toThrow('captured configuration')
  expect(() => { changed({ ...retry, definition: { id: 'agent', revision: 3 } }) }).toThrow('captured configuration')
  expect(() => { changed({ ...retry, submission: { id: 'other', agentRevision: 2 } }) }).toThrow('submission identities')
  expect(() => { changed({ ...retry, submission: { id: 'request', agentRevision: 3 } }) }).toThrow('submission identities')
  expect(() => { changed({ ...retry, submission: { id: 'request', agentRevision: 2 } }) }).not.toThrow()
  expect(() => { ctx.emit('domain/changed', { domain: 'workbench_agents', table: 'runs', key: 'run', operation: 'deleted' }) }).not.toThrow()
  expect(() => { ctx.emit('domain/changed', { domain: 'other', table: 'runs', key: 'run', operation: 'put', value: {} }) }).not.toThrow()
})
