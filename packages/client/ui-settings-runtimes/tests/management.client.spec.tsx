// @vitest-environment jsdom
/** Host-backed management gestures and machine selection through the real page store. */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import type { IApiClient, RpcResponse } from '@deepseek-ai/dsh-api-remotes/client'
import { RuntimesSection } from '../src/client/RuntimesSection.tsx'
import { RuntimesSettingsStore } from '../src/client/store.ts'
import { en } from '../src/client/locales.ts'

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open')
  }
})
afterEach(cleanup)
const ok = <T,>(value: T): RpcResponse<T> => ({ rpcId: 'runtime-test' as never, result: { ok: true, value } })
const remote = {
  url: 'http://localhost:4096',
  name: 'Build machine',
  version: 'test',
  cwd: '/remote',
  providers: [{ provider: 'remote-cli', displayName: 'Remote CLI', active: true, settingsNs: '', settingsPath: [] }],
  groups: [{ id: 'remote-cli', name: 'Remote CLI', models: [{ id: 'remote-model', name: 'Remote model' }] }],
  failures: [],
}

async function mount() {
  let revision = 4
  let profiles: Record<string, unknown> = {}
  const mutate = vi.fn(
    async (request: { expectedRevision?: number; ops: Array<{ op: string; path: string[]; value?: unknown }> }) => {
      if (request.expectedRevision !== revision) throw new Error('settings conflict')
      for (const op of request.ops) {
        if (op.path[0] !== 'profiles') continue
        if (op.op === 'unset')
          profiles = Object.fromEntries(Object.entries(profiles).filter(([id]) => id !== op.path[1]))
        else profiles = { ...profiles, [op.path[1]!]: op.value }
      }
      ++revision
      return ok(view())
    },
  )
  const view = () => ({
    ns: 'runtime-management',
    value: { peers: {}, profiles },
    revision,
    schema: {},
    applies: 'live',
    secrets: [],
  })
  const runtimePeers = vi.fn(async (_request: { url?: string }) => ok({ peers: [remote] }))
  const api = {
    settings: {
      describe: async () => ok({ writable: true, hasDocument: true, namespaces: [view()] }),
      mutate,
    },
    llm: {
      providers: async () => ok({ providers: [], daemonRunning: true }),
      models: async () => ok({ groups: [], failures: [] }),
      runtimePeers,
    },
  } as unknown as Pick<IApiClient, 'settings' | 'llm'>
  const controller = new RuntimesSettingsStore(api)
  await controller.load()
  render(
    <RuntimesSection
      load={() => controller.load()}
      connect={(name, url) => controller.connect(name, url)}
      saveProfile={(id, profile) => controller.saveProfile(id, profile)}
      remove={(kind, id) => controller.remove(kind, id)}
      useSnapshot={bindSnapshotSelector(controller.store)}
      t={key => en[key]}
    />,
  )
  return { controller, runtimePeers, mutate }
}

describe('runtime management page', () => {
  it('searches remote model IDs and selects a machine without losing its catalog', async () => {
    await mount()
    fireEvent.change(screen.getByLabelText(en.searchMachines), { target: { value: 'REMOTE-MODEL' } })
    expect(screen.queryByRole('button', { name: /Local machine/ })).toBeNull()
    expect(screen.getByRole('heading', { name: 'Build machine' })).toBeTruthy()
    expect(screen.getByText('remote-model')).toBeTruthy()
    expect(screen.getByRole('link', { name: en.openRemote }).getAttribute('href')).toBe(remote.url)
    fireEvent.click(screen.getByRole('button', { name: /^Issues/ }))
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.getAllByText(en.noMatches).length).toBeGreaterThan(0)
  })

  it('clears a search and restores the directory after an empty status filter', async () => {
    await mount()
    const search = screen.getByLabelText(en.searchMachines)
    fireEvent.change(search, { target: { value: 'no-such-machine' } })
    expect(screen.queryByRole('table')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: en.clearSearch }))
    expect(search).toHaveProperty('value', '')
    expect(screen.getByRole('button', { name: /Build machine/ })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /^Issues/ }))
    fireEvent.click(screen.getByRole('button', { name: en.resetFilters }))
    expect(screen.getByRole('button', { name: /^All/ }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: /Local machine/ }).getAttribute('aria-pressed')).toBe('true')
  })

  it('creates, edits, and deletes an executable profile using current settings revisions', async () => {
    const { mutate } = await mount()
    fireEvent.click(screen.getByRole('button', { name: en.manageRuntimes }))
    fireEvent.click(screen.getByRole('button', { name: en.addRuntime }))
    fireEvent.change(screen.getByLabelText(en.runtimeName), { target: { value: 'Custom Cursor' } })
    fireEvent.change(screen.getByLabelText(en.runtimeId), { target: { value: 'runtime-custom' } })
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    await screen.findByRole('dialog', { name: en.manageRuntimes })
    expect(mutate.mock.calls[0]![0]).toMatchObject({
      expectedRevision: 4,
      ops: [{ path: ['profiles', 'runtime-custom'], value: { command: 'cursor-agent', enabled: true } }],
    })
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: en.edit }))
    fireEvent.click(screen.getByLabelText(en.enabled))
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    await screen.findByRole('dialog', { name: en.manageRuntimes })
    expect(mutate.mock.calls[1]![0]).toMatchObject({ expectedRevision: 5, ops: [{ value: { enabled: false } }] })
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: en.delete }))
    expect(mutate).toHaveBeenCalledTimes(2)
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: en.delete }))
    await act(async () => {})
    expect(mutate.mock.calls[2]![0]).toMatchObject({
      expectedRevision: 6,
      ops: [{ op: 'unset', path: ['profiles', 'runtime-custom'] }],
    })
  })

  it('keeps a refused remote connection unsaved and confirms a successful retry', async () => {
    const { runtimePeers, mutate } = await mount()
    runtimePeers.mockResolvedValueOnce(ok({ peers: [{ ...remote, error: 'Connection refused' } as typeof remote] }))
    fireEvent.click(screen.getByRole('button', { name: en.connectRemote }))
    fireEvent.change(screen.getByLabelText(en.machineName), { target: { value: 'New machine' } })
    fireEvent.change(screen.getByLabelText(en.machineUrl), { target: { value: remote.url } })
    fireEvent.click(screen.getByRole('button', { name: en.connect }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Connection refused')
    expect(mutate).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: en.connect }))
    await screen.findByRole('dialog', { name: en.connected })
    expect(mutate.mock.calls[0]![0]).toMatchObject({
      ops: [{ path: ['peers', encodeURIComponent(remote.url)], value: { name: 'New machine', url: remote.url } }],
    })
  })

  it('leaves the connection intact when disconnect confirmation is cancelled', async () => {
    const { mutate } = await mount()
    fireEvent.click(screen.getByRole('button', { name: /Build machine/ }))
    fireEvent.click(screen.getByRole('button', { name: en.disconnect }))
    fireEvent.click(screen.getByRole('button', { name: en.cancel }))
    expect(mutate).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
