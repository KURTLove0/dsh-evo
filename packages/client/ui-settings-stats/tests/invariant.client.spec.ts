import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as StatsInvariant from '@deepseek-ai/dsh-client-ui-settings-stats/invariant'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { StatsSection } from '../src/client/StatsSection.tsx'

describe('invariant companion', () => {
  it('registers under the package name with an empty installer', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(StatsInvariant).await()).resolves.toBeDefined()
  })

  it('node-half apply is a no-op host placeholder', async () => {
    const { apply } = await import('@deepseek-ai/dsh-client-ui-settings-stats')
    apply()
    expect(true).toBe(true) // reaching here without throw is the contract
  })

  it('renders null until the shell injects the section dependencies', () => {
    expect(StatsSection({})).toBeNull()
  })
})
