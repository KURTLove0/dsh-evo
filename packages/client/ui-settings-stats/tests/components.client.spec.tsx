// @vitest-environment jsdom
/** Section rendering over a scripted wire face: the three metric cards, the cost placeholder, and refresh. */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import type { RpcResponse } from '@deepseek-ai/dsh-api-remotes/client'
import type { TokenUsageProjection } from '@deepseek-ai/dsh-token-meter/client'
import {
  billedInputTokens, formatTokens, startedCopy, tokensDetailCopy, StatsSection,
} from '../src/client/StatsSection.tsx'
import type { StatsSectionInjected } from '../src/client/StatsSection.tsx'
import { StatsSettingsStore } from '../src/client/store.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const t: StatsSectionInjected['t'] = key => en[key]

let nextRpc = 0
function ok<T>(value: T): RpcResponse<T> {
  return { rpcId: `r-${nextRpc++}` as never, result: { ok: true, value } }
}
function fail<T>(message: string): RpcResponse<T> {
  return { rpcId: `r-${nextRpc++}` as never, result: { ok: false, error: { code: 'internal', message, details: {} } } }
}

const USAGE: TokenUsageProjection = {
  uncachedInputTokens: 1_200,
  outputTokens: 800,
  cacheReadTokens: 40_000,
  cacheWriteTokens: 300,
}

function itemsOf(sessions: { blank: boolean; usage?: TokenUsageProjection }[]) {
  return sessions.map((session, index) => ({
    sessionId: `s-${index}` as never,
    updatedAt: 0,
    running: false,
    blank: session.blank,
    projections: { asOfSeq: 0, values: session.usage === undefined ? {} : { tokenUsage: session.usage } },
  }))
}

function scriptedFace(items: { blank: boolean; usage?: TokenUsageProjection }[] = [
  { blank: false, usage: USAGE },
  { blank: true },
]) {
  return {
    sessions: { list: () => Promise.resolve(ok({ items: itemsOf(items) })) },
  } as never
}

async function mountSection(items?: Parameters<typeof scriptedFace>[0]) {
  const face = scriptedFace(items)
  const controller = new StatsSettingsStore(face)
  await controller.load()
  const view = render(<StatsSection
    controller={controller}
    useSnapshot={bindSnapshotSelector(controller.store)}
    t={t}
  />)
  return { view, face, controller }
}

describe('StatsSection', () => {
  it('renders nothing before the slot injects its dependencies', () => {
    const uninjected = {}
    render(<StatsSection {...uninjected} />)
    expect(document.body.textContent).toBe('')
  })

  it('renders the three metric cards with the aggregated figures', async () => {
    await mountSection()
    // Sessions card: total plus the started-conversations caption.
    expect(screen.getByText(en.sessionsCard)).toBeTruthy()
    expect(screen.getByText('2')).toBeTruthy()
    expect(screen.getByText(startedCopy(en.sessionsStarted, 1))).toBeTruthy()
    // Token card: the billed-input + output total with the bucket breakdown.
    expect(screen.getByText(en.tokensCard)).toBeTruthy()
    const total = formatTokens(billedInputTokens(USAGE) + USAGE.outputTokens)
    expect(screen.getByText(total)).toBeTruthy()
    expect(screen.getByText(tokensDetailCopy(
      en.tokensDetail,
      formatTokens(billedInputTokens(USAGE)),
      formatTokens(USAGE.outputTokens),
      formatTokens(USAGE.cacheReadTokens),
    ))).toBeTruthy()
    // Cost card: the explicit no-billing-source placeholder.
    expect(screen.getByText(en.costCard)).toBeTruthy()
    expect(screen.getByText('—')).toBeTruthy()
    expect(screen.getByText(en.costUnavailable)).toBeTruthy()
  })

  it('renders zeroed figures when no session ever reported usage', async () => {
    await mountSection([{ blank: false }, { blank: true }])
    expect(screen.getByText('2')).toBeTruthy()
    expect(screen.getByText(formatTokens(0))).toBeTruthy()
  })

  it('reloads through the refresh control', async () => {
    const list = vi.fn(() => Promise.resolve(ok({ items: itemsOf([{ blank: false, usage: USAGE }]) })))
    const face = { sessions: { list } } as never
    const controller = new StatsSettingsStore(face)
    await controller.load()
    render(<StatsSection
      controller={controller}
      useSnapshot={bindSnapshotSelector(controller.store)}
      t={t}
    />)
    expect(list).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByText(en.refresh))
    expect(list).toHaveBeenCalledTimes(2)
  })

  it('renders the load failure with a retry control that reloads', async () => {
    let call = 0
    const list = vi.fn((): Promise<RpcResponse<{ items: ReturnType<typeof itemsOf> }>> => {
      call += 1
      return call === 1
        ? Promise.resolve(fail('listing down'))
        : Promise.resolve(ok({ items: itemsOf([{ blank: false, usage: USAGE }]) }))
    })
    const face = { sessions: { list } } as never
    const controller = new StatsSettingsStore(face)
    await controller.load()
    render(<StatsSection
      controller={controller}
      useSnapshot={bindSnapshotSelector(controller.store)}
      t={t}
    />)
    expect(screen.getByRole('heading', { name: en.title })).toBeTruthy()
    expect(screen.getByText(/listing down/)).toBeTruthy()
    fireEvent.click(screen.getByText(en.retry))
    await screen.findByText(en.sessionsCard)
    expect(screen.queryByText(/listing down/)).toBeNull()
  })

  it('loads on first render of an idle controller', async () => {
    const face = scriptedFace()
    const controller = new StatsSettingsStore(face)
    render(<StatsSection
      controller={controller}
      useSnapshot={bindSnapshotSelector(controller.store)}
      t={t}
    />)
    await screen.findByText(en.sessionsCard)
  })
})

describe('copy templating', () => {
  it('spells the one count placeholder', () => {
    expect(startedCopy('{count} conversation(s) started', 3)).toBe('3 conversation(s) started')
    expect(startedCopy('{count} 个已开始对话', 12)).toBe('12 个已开始对话')
  })

  it('spells the three bucket placeholders', () => {
    expect(tokensDetailCopy('Input {input} · Output {output} · Cache read {cacheRead}', '1.2K', '800', '40K'))
      .toBe('Input 1.2K · Output 800 · Cache read 40K')
    expect(tokensDetailCopy('输入 {input} · 输出 {output} · 缓存读 {cacheRead}', '1.2K', '800', '40K'))
      .toBe('输入 1.2K · 输出 800 · 缓存读 40K')
  })
})

describe('formatTokens', () => {
  it('compacts plain, K, and M magnitudes', () => {
    expect(formatTokens(517)).toBe('517')
    expect(formatTokens(999)).toBe('999')
    expect(formatTokens(1_200)).toBe('1.2K')
    expect(formatTokens(12_200)).toBe('12.2K')
    expect(formatTokens(517_000)).toBe('517K')
    expect(formatTokens(1_200_000)).toBe('1.2M')
  })
})
