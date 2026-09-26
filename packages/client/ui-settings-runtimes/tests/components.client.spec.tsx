// @vitest-environment jsdom
/** Section rendering over a scripted wire face: rows, liveness, and the loaded-models view. */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import type { RpcResponse } from '@deepseek-ai/dsh-api-remotes/client'
import { RuntimesSection, modelsCountCopy } from '../src/client/RuntimesSection.tsx'
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
  { provider: 'claude-cli', displayName: 'Claude CLI', settingsNs: 'llm-claude-cli', settingsPath: ['claude'], active: true },
  { provider: 'codex-cli', displayName: 'Codex CLI', settingsNs: 'llm-claude-cli', settingsPath: ['codex'], active: false },
]

/** One provider-group entry of the host model catalog. */
interface CatalogAnswer {
  groups: { id: string; name: string; models: { id: string; name: string }[] }[]
  failures: { id: string; name: string; message: string }[]
}

function scriptedFace(overrides: {
  providers?: () => Promise<RpcResponse<{ providers: typeof DIRECTORY }>>
  models?: () => Promise<RpcResponse<CatalogAnswer>>
} = {}) {
  return {
    llm: {
      providers: overrides.providers ?? (() => Promise.resolve(ok({ providers: DIRECTORY }))),
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

  it('renders each live runtime row with liveness, route id, and loaded models', async () => {
    await mountSection()
    // Live runtime: name, route id, both loaded models, and the count caption.
    expect(screen.getByText('Claude CLI')).toBeTruthy()
    expect(screen.getByText('claude-cli')).toBeTruthy()
    expect(screen.getByText('sonnet-4-5')).toBeTruthy()
    expect(screen.getByText('opus-4-6')).toBeTruthy()
    expect(screen.getByText(modelsCountCopy(en.modelsCount, 2))).toBeTruthy()
    expect(screen.getByRole('img', { name: en.statusActive })).toBeTruthy()
    // The dormant codex route renders nowhere: it is a configuration
    // candidate for the Models page, not a runtime this deployment can call.
    expect(screen.queryByText('Codex CLI')).toBeNull()
  })

  it('renders the empty-catalog caption for a live runtime with no models', async () => {
    await mountSection({
      models: () => Promise.resolve(ok({ groups: [{ id: 'claude-cli', name: 'Claude CLI', models: [] }], failures: [] })),
    })
    expect(screen.getByText(en.modelsEmpty)).toBeTruthy()
    expect(screen.queryByText(modelsCountCopy(en.modelsCount, 0))).toBeNull()
  })

  it('renders the catalog failure text on the failing live row', async () => {
    await mountSection({
      models: () => Promise.resolve(ok({
        groups: [],
        failures: [{ id: 'claude-cli', name: 'Claude CLI', message: 'the CLI is not installed' }],
      })),
    })
    expect(screen.getByRole('alert').textContent).toBe(`${en.modelsFailure}: the CLI is not installed`)
  })

  it('renders the empty-deployment notice when the directory declares nothing', async () => {
    await mountSection({ providers: () => Promise.resolve(ok({ providers: [] as never })) })
    expect(screen.getByText(en.empty)).toBeTruthy()
    expect(screen.queryByText(en.statusActive)).toBeNull()
  })

  it('renders the load failure with a retry control that reloads', async () => {
    let call = 0
    const providers = vi.fn((): Promise<RpcResponse<{ providers: typeof DIRECTORY }>> => {
      call += 1
      return call === 1
        ? Promise.resolve(fail('directory down'))
        : Promise.resolve(ok({ providers: DIRECTORY }))
    })
    const face = scriptedFace({ providers })
    const controller = new RuntimesSettingsStore(face)
    await controller.load()
    render(<RuntimesSection
      controller={controller}
      useSnapshot={bindSnapshotSelector(controller.store)}
      t={t}
    />)
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

describe('modelsCountCopy', () => {
  it('spells the one count placeholder', () => {
    expect(modelsCountCopy('{count} model(s)', 3)).toBe('3 model(s)')
    expect(modelsCountCopy('{count} 个模型', 12)).toBe('12 个模型')
  })
})
