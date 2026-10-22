/** Notifications must identify a retained record with complete settlement facts. */
import { Context } from '@deepseek-ai/cordis'
import { expect, it } from 'vitest'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as Companion from '../src/invariant.ts'
import type { HealthProbeRecord } from '../src/types.ts'
it('rejects missing identities and incomplete settlement while permitting owned live observations', async () => {
  const ctx = new Context()
  let record: HealthProbeRecord | null = null
  ctx.provide('capabilityHealth', { readProbe: () => record } as never)
  try {
    await ctx.plugin(InvariantRegistry, { package_allowlist: ['^@deepseek-ai/dsh-capability-health$'] })
    const fiber = ctx.plugin(Companion); await fiber.await()
    const notify = () => { ctx.emit('capability-health/probe-changed', 'probe' as never) }
    expect(notify).toThrow('no matching')
    const value: HealthProbeRecord = { id: 'other' as never, agentId: 'agent' as never, expectedRevision: 1, workspaceId: 'workspace' as never, serverName: 'crm', startedAt: 10, status: 'running' }
    record = value; expect(notify).toThrow('no matching')
    record = { ...value, id: 'probe' as never }; expect(notify).not.toThrow()
    record = { ...record, status: 'connected', cleanup: 'closed', checkedAt: 9 }; expect(notify).toThrow('completion precedes')
    record = { ...record, checkedAt: 20 }; expect(notify).not.toThrow()
    await fiber.dispose()
    record = null; expect(notify).not.toThrow()
  } finally { await ctx.fiber.dispose() }
})
