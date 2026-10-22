/** Empty presentation companions still reserve ownership for their plugin lifetime. */
import { Context } from '@deepseek-ai/cordis'
import Invariants from '@deepseek-ai/dsh-invariants'
import { expect, it } from 'vitest'
import * as Companion from '../src/invariant.ts'
it('registers the presentation package without claiming remote native invariants', async () => {
  const ctx = new Context(); await ctx.plugin(Invariants)
  const fiber = ctx.plugin(Companion); await fiber
  expect(() => ctx.invariants.register('@deepseek-ai/dsh-client-ui-work-remote', () => {})).toThrow('already registered')
  await fiber.dispose()
  expect(() => ctx.invariants.register('@deepseek-ai/dsh-client-ui-work-remote', () => {})).not.toThrow()
  await ctx.fiber.dispose()
})
