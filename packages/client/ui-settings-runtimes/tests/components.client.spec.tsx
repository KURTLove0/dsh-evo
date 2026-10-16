// @vitest-environment jsdom
/** Section rendering over a scripted wire face: summary strip, table rows, liveness, and the loaded-models view. */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import type { RpcResponse } from '@deepseek-ai/dsh-api-remotes/client'
import {
  DAEMON_INSTALL_COMMAND, DAEMON_START_COMMAND, RuntimesSection, modelsCountCopy, summaryCountsCopy,
} from '../src/client/RuntimesSection.tsx'
import type { RuntimesSectionInjected } from '../src/client/RuntimesSection.tsx'
import { RuntimesSettingsStore } from '../src/client/store.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const t: RuntimesSectionInjected['t'] = key => en[key]

let nextRpc = 0
function ok<T>(value: T): RpcResponse<T> {
  return { rpcId: `r-${nextRpc++}` as never, result: { ok: true, value } }
}
function fail<T>(message: string): RpcResponse<T> {
  return { rpcId: `r-${nextRpc++}` as never, result: { ok: false, error: { code: 'internal', message, details: {} } } }
}

const DIRECTORY = [
  { provider: 'claude-cli', displayName: 'Claude CLI', settingsNs: 'llm-claude-cli', settingsPath: ['claude'], active: true, declared: false, localCommand: 'claude' },
  { provider: 'codex-cli', displayName: 'Codex CLI', settingsNs: 'llm-claude-cli', settingsPath: ['codex'], active: false, declared: true, localCommand: 'codex' },
]

/** One provider-group entry of the host model catalog. */
interface CatalogAnswer {
  groups: { id: string; name: string; models: { id: string; name: string }[] }[]
  failures: { id: string; name: string; message: string }[]
}

function scriptedFace(overrides: {
  providers?: () => Promise<RpcResponse<{ providers: typeof DIRECTORY; daemonRunning: boolean }>>
  models?: () => Promise<RpcResponse<CatalogAnswer>>
} = {}) {
  return {
    llm: {
      providers: overrides.providers ?? (() => Promise.resolve(ok({ providers: DIRECTORY, daemonRunning: true }))),
      models: overrides.models ?? (() => Promise.resolve(ok({
        groups: [
          { id: 'claude-cli', name: 'Claude CLI', models: [{ id: 'sonnet-4-5', name: 'Sonnet 4.5' }, { id: 'opus-4-6', name: 'Opus 4.6' }] },
        ],
        failures: [],
      }))),
    },
  } as never
}

async function mountSection(overrides: Parameters<typeof scriptedFace>[0] = {}) {
  const face = scriptedFace(overrides)
  const controller = new RuntimesSettingsStore(face)
  await controller.load()
  const view = render(<RuntimesSection
    controller={controller}
    useSnapshot={bindSnapshotSelector(controller.store)}
    t={t}
  />)
  return { view, face, controller }
}

describe('RuntimesSection', () => {
  it('renders nothing before the slot injects its dependencies', () => {
    const uninjected = {}
    render(<RuntimesSection {...uninjected} />)
    expect(document.body.textContent).toBe('')
  })

  it('renders the summary strip with whole-deployment counts and daemon presence', async () => {
    await mountSection()
    // One live row whose listing succeeded: one runtime, one online, daemon up.
    expect(screen.getByText(summaryCountsCopy(en.summaryCounts, 1, 1))).toBeTruthy()
    expect(screen.getByText(en.daemonChipRunning)).toBeTruthy()
    expect(screen.queryByText(en.daemonChipStopped)).toBeNull()
  })

  it('counts a failed listing as not online and flips the daemon chip when no daemon runs', async () => {
    await mountSection({
      models: () => Promise.resolve(ok({
        groups: [],
        failures: [{ id: 'claude-cli', name: 'Claude CLI', message: 'the CLI is not installed' }],
      })),
      providers: () => Promise.resolve(ok({ providers: DIRECTORY, daemonRunning: false })),
    })
    expect(screen.getByText(summaryCountsCopy(en.summaryCounts, 1, 0))).toBeTruthy()
    expect(screen.getByText(en.daemonChipStopped)).toBeTruthy()
    expect(screen.queryByText(en.daemonChipRunning)).toBeNull()
  })

  it('renders the table with its column heads', async () => {
    await mountSection()
    expect(screen.getByRole('table')).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: en.colService })).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: en.colHealth })).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: en.colModels })).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: en.colCommand })).toBeTruthy()
  })

  it('renders each live runtime row with identity, origin tag, health, models, and command', async () => {
    await mountSection()
    // Live runtime: name, route id, origin tag, both loaded models, the count
    // caption, the local command, and the online health word.
    expect(screen.getByText('Claude CLI')).toBeTruthy()
    expect(screen.getByText('claude-cli')).toBeTruthy()
    expect(screen.getByText(en.tagBuiltin)).toBeTruthy()
    expect(screen.getByText('sonnet-4-5')).toBeTruthy()
    expect(screen.getByText('opus-4-6')).toBeTruthy()
    expect(screen.getByText(modelsCountCopy(en.modelsCount, 2))).toBeTruthy()
    expect(screen.getByText('claude')).toBeTruthy()
    expect(screen.getByRole('img', { name: en.statusActive })).toBeTruthy()
    // The dormant codex route renders nowhere: it is a configuration
    // candidate for the Models page, not a runtime this deployment can call.
    expect(screen.queryByText('Codex CLI')).toBeNull()
    expect(screen.queryByText(en.tagCustom)).toBeNull()
  })

  it('renders the empty-catalog caption for a live runtime with no models', async () => {
    await mountSection({
      models: () => Promise.resolve(ok({ groups: [{ id: 'claude-cli', name: 'Claude CLI', models: [] }], failures: [] })),
    })
    expect(screen.getByText(en.modelsEmpty)).toBeTruthy()
    expect(screen.queryByText(modelsCountCopy(en.modelsCount, 0))).toBeNull()
  })

  it('renders the catalog failure on the failing live row as its health', async () => {
    await mountSection({
      models: () => Promise.resolve(ok({
        groups: [],
        failures: [{ id: 'claude-cli', name: 'Claude CLI', message: 'the CLI is not installed' }],
      })),
    })
    expect(screen.getByRole('alert').textContent).toContain('the CLI is not installed')
    expect(screen.getByRole('img', { name: en.statusFailed })).toBeTruthy()
    expect(screen.queryByRole('img', { name: en.statusActive })).toBeNull()
  })

  it('renders the empty-deployment notice when the directory declares nothing', async () => {
    await mountSection({ providers: () => Promise.resolve(ok({ providers: [] as never, daemonRunning: true })) })
    expect(screen.getByText(en.empty)).toBeTruthy()
    expect(screen.queryByText(en.statusActive)).toBeNull()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('renders the daemon hint while no sensing daemon runs, with install and start steps', async () => {
    await mountSection({ providers: () => Promise.resolve(ok({ providers: DIRECTORY, daemonRunning: false })) })
    expect(screen.getByText(en.daemonHintTitle)).toBeTruthy()
    expect(screen.getByText(en.daemonHintInstall)).toBeTruthy()
    expect(screen.getByText(en.daemonHintStart)).toBeTruthy()
    expect(screen.getByText(DAEMON_INSTALL_COMMAND)).toBeTruthy()
    expect(screen.getByText(DAEMON_START_COMMAND)).toBeTruthy()
    // Rows still render — the inline probe answers while no daemon runs.
    expect(screen.getByText('Claude CLI')).toBeTruthy()
  })

  it('copies each hint command through its own button', async () => {
    const writeText = vi.fn(() => Promise.resolve())
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    await mountSection({ providers: () => Promise.resolve(ok({ providers: DIRECTORY, daemonRunning: false })) })
    const [installCopy, startCopy] = screen.getAllByText(en.daemonHintCopy)
    fireEvent.click(startCopy!)
    expect(writeText).toHaveBeenCalledWith(DAEMON_START_COMMAND)
    fireEvent.click(installCopy!)
    expect(writeText).toHaveBeenCalledWith(DAEMON_INSTALL_COMMAND)
    // Each row confirms independently of the other.
    expect(screen.getAllByText(en.daemonHintCopied)).toHaveLength(2)
    delete (navigator as { clipboard?: unknown }).clipboard
  })

  it('renders no daemon hint while the daemon runs', async () => {
    await mountSection()
    expect(screen.queryByText(en.daemonHintTitle)).toBeNull()
  })

  it('renders the load failure with a retry control that reloads', async () => {
    let call = 0
    const providers = vi.fn((): Promise<RpcResponse<{ providers: typeof DIRECTORY; daemonRunning: boolean }>> => {
      call += 1
      return call === 1
        ? Promise.resolve(fail('directory down'))
        : Promise.resolve(ok({ providers: DIRECTORY, daemonRunning: true }))
    })
    const face = scriptedFace({ providers })
    const controller = new RuntimesSettingsStore(face)
    await controller.load()
    render(<RuntimesSection
      controller={controller}
      useSnapshot={bindSnapshotSelector(controller.store)}
      t={t}
    />)
    expect(screen.getByRole('heading', { name: en.title })).toBeTruthy()
    expect(screen.getByText(/directory down/)).toBeTruthy()
    fireEvent.click(screen.getByText(en.retry))
    await screen.findByText('Claude CLI')
    expect(screen.queryByText(/directory down/)).toBeNull()
  })

  it('loads on first render of an idle controller', async () => {
    const face = scriptedFace()
    const controller = new RuntimesSettingsStore(face)
    render(<RuntimesSection
      controller={controller}
      useSnapshot={bindSnapshotSelector(controller.store)}
      t={t}
    />)
    await screen.findByText('Claude CLI')
  })
})

describe('copy templating', () => {
  it('spells the one count placeholder', () => {
    expect(modelsCountCopy('{count} model(s)', 3)).toBe('3 model(s)')
    expect(modelsCountCopy('{count} 个模型', 12)).toBe('12 个模型')
  })

  it('spells the total and online placeholders', () => {
    expect(summaryCountsCopy('{total} runtime(s) · {online} online', 8, 7)).toBe('8 runtime(s) · 7 online')
    expect(summaryCountsCopy('{total} 个运行时 · {online} 个在线', 8, 7)).toBe('8 个运行时 · 7 个在线')
  })
})
