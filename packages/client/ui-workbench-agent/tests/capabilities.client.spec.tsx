// @vitest-environment jsdom
/** Capability selection, failed discovery, and transport edits before a definition is saved. */
import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentCapabilities, AgentMcpServer, AgentRun } from '@deepseek-ai/dsh-api-remotes/client'
import { AgentSkillPicker } from '../src/client/AgentSkillPicker.tsx'
import { AgentMcpEditor } from '../src/client/AgentMcpEditor.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)
const t = (key: keyof typeof en) => en[key]
const workspaces = [{ workspaceId: 'project' as AgentRun['workspaceId'], title: 'Project' }, { workspaceId: 'other' as AgentRun['workspaceId'], title: 'Other' }]
const catalog: AgentCapabilities = { skills: [
  { name: 'review', description: 'Check changes', source: 'project-agents' },
  { name: 'report', description: 'Summarize revenue', source: 'project-agents' },
] }

function skillPicker(load: (workspaceId: AgentRun['workspaceId']) => Promise<AgentCapabilities>, selected = ['review', 'obsolete', '']) {
  const changed = vi.fn()
  function Harness() {
    const [skills, setSkills] = useState(selected)
    return <AgentSkillPicker selected={skills} workspaces={workspaces} load={load} t={t}
      change={(value) => { changed(value); setSkills(value) }} />
  }
  const ui = render(<Harness />)
  return { ...ui, changed }
}

describe('workspace skill selection', () => {
  it('searches descriptions, removes unavailable names, and changes selected capabilities', async () => {
    const load = vi.fn(async () => catalog)
    const ui = skillPicker(load)
    await screen.findByRole('checkbox', { name: /review/ })
    fireEvent.click(screen.getByRole('checkbox', { name: /obsolete/ }))
    expect(ui.changed).toHaveBeenLastCalledWith(['review', ''])
    fireEvent.click(screen.getByRole('checkbox', { name: /review/ }))
    expect(ui.changed).toHaveBeenLastCalledWith([''])
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: ' REVENUE ' } })
    expect(screen.queryByRole('checkbox', { name: /review/ })).toBeNull()
    fireEvent.click(screen.getByRole('checkbox', { name: /report/ }))
    expect(ui.changed).toHaveBeenLastCalledWith(['', 'report'])
  })

  it('shows discovery failures and supports retry without changing the selected definition', async () => {
    const load = vi.fn<() => Promise<AgentCapabilities>>()
      .mockRejectedValueOnce(new Error('Discovery unavailable'))
      .mockRejectedValueOnce('Provider offline')
      .mockResolvedValueOnce({ skills: [] })
    skillPicker(load, [])
    expect((await screen.findByRole('alert')).textContent).toBe('Discovery unavailable')
    fireEvent.click(screen.getByRole('button', { name: en.refreshSkills }))
    await screen.findByText('Provider offline')
    fireEvent.click(screen.getByRole('button', { name: en.refreshSkills }))
    await screen.findByText(en.noSkills)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it.each(['resolve', 'reject'] as const)('ignores a stale %s after changing the discovery workspace', async (outcome) => {
    const first = Promise.withResolvers<AgentCapabilities>()
    const load = vi.fn<() => Promise<AgentCapabilities>>().mockReturnValueOnce(first.promise).mockResolvedValue(catalog)
    skillPicker(load, [])
    expect(screen.getByRole('status').textContent).toBe(en.loadingSkills)
    fireEvent.change(screen.getByRole('combobox', { name: en.skillWorkspace }), { target: { value: 'other' } })
    await screen.findByRole('checkbox', { name: /report/ })
    await act(async () => {
      if (outcome === 'resolve') first.resolve({ skills: [] })
      else first.reject(new Error('Old workspace disappeared'))
    })
    expect(screen.getByRole('checkbox', { name: /report/ })).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(load).toHaveBeenLastCalledWith('other')
  })

  it('does not discover skills before a workspace exists', () => {
    const load = vi.fn()
    render(<AgentSkillPicker selected={[]} workspaces={[]} load={load} change={vi.fn()} t={t} />)
    expect(screen.getByRole('option').textContent).toBe(en.noWorkspace)
    expect(screen.queryByRole('searchbox')).toBeNull()
    expect(load).not.toHaveBeenCalled()
  })
})

it('edits and removes MCP variables and services, and resets transport-specific fields', async () => {
  const changed = vi.fn()
  function Harness() {
    const [servers, setServers] = useState<AgentMcpServer[]>([
      { name: 'local', transport: 'stdio', command: 'node', args: ['server.mjs'], env: [{ name: 'ONE', value: 'first' }, { name: 'TWO', value: 'second' }] },
      { name: 'remote', transport: 'streamable-http', url: 'https://example.com/mcp', headers: [{ name: 'Authorization', value: 'Bearer token' }] },
    ])
    return <AgentMcpEditor servers={servers} t={t} change={(value) => { changed(value); setServers(value) }} />
  }
  render(<Harness />)
  expect(screen.getByLabelText<HTMLInputElement>(`${en.variableValue} 1.1`).type).toBe('password')
  fireEvent.change(screen.getByLabelText(`${en.variableName} 1.1`), { target: { value: 'RENAMED' } })
  fireEvent.change(screen.getByLabelText(`${en.variableValue} 1.1`), { target: { value: 'updated' } })
  fireEvent.click(screen.getByRole('button', { name: `${en.removeVariable} 1.2` }))
  expect(screen.queryByLabelText(`${en.variableName} 1.2`)).toBeNull()
  fireEvent.change(screen.getByLabelText(`${en.mcpArgs} 1`, { exact: false }), { target: { value: '' } })
  fireEvent.click(screen.getByRole('button', { name: `${en.removeServer} 1` }))
  fireEvent.change(screen.getByLabelText(`${en.mcpTransport} 1`), { target: { value: 'stdio' } })
  await waitFor(() => { expect(changed).toHaveBeenLastCalledWith([{ name: 'remote', transport: 'stdio', command: '', args: [], env: [] }]) })
  expect(screen.queryByLabelText(`${en.mcpUrl} 1`)).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: `${en.removeServer} 1` }))
  expect(changed).toHaveBeenLastCalledWith([])
})

describe('local runtime selection', () => {
  it('changes service and model together without retaining an override from another provider', async () => {
    const { AgentRuntimePicker } = await import('../src/client/AgentRuntimePicker.tsx')
    const load = vi.fn(async () => [
      { id: 'codex-cli', name: 'Codex CLI', command: 'codex', available: true, defaultModel: 'default', models: [{ id: 'codex-model', name: 'Codex model' }] },
      { id: 'other-cli', name: 'Other CLI', command: 'other', available: true, models: [{ id: 'other-model', name: 'Other model' }] },
      { id: 'offline', name: 'Offline CLI', command: 'missing', available: false, models: [], error: 'Binary unavailable' },
    ])
    const changed = vi.fn<(value: import('@deepseek-ai/dsh-api-remotes/client').AgentDefinition) => void>()
    function Harness() {
      const [value, setValue] = useState<import('@deepseek-ai/dsh-api-remotes/client').AgentDefinition>({ name: 'Agent', runtime: 'removed-cli', avatar: '', description: '', instructions: '', skills: [], mcpServers: [], starters: [], concurrency: 1, model: { provider: 'removed-cli', model: 'old-model', reasoningEffort: 'high' } })
      return <AgentRuntimePicker value={value} load={load} t={t} change={(next) => { changed(next); setValue(next) }} />
    }
    render(<Harness />)
    await screen.findByRole('option', { name: 'Codex CLI' })
    fireEvent.change(screen.getByRole('combobox', { name: en.runtime }), { target: { value: 'codex-cli' } })
    expect(changed.mock.lastCall?.[0].model).toBeUndefined()
    fireEvent.change(screen.getByRole('combobox', { name: en.model }), { target: { value: 'codex-model' } })
    expect(changed.mock.lastCall?.[0].model).toEqual({ provider: 'codex-cli', model: 'codex-model' })
    fireEvent.change(screen.getByLabelText(en.effort), { target: { value: 'high' } })
    fireEvent.change(screen.getByLabelText(en.effort), { target: { value: '' } })
    fireEvent.change(screen.getByRole('combobox', { name: en.runtime }), { target: { value: 'other-cli' } })
    expect(screen.queryByRole('option', { name: 'Codex model' })).toBeNull()
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: en.model }).required).toBe(true)
    fireEvent.change(screen.getByRole('combobox', { name: en.runtime }), { target: { value: 'offline' } })
    expect(screen.getByRole('alert').textContent).toBe('Binary unavailable')
  })

  it.each([new Error('Directory failed'), 'Directory failed'])('reports discovery failures and supports an empty retry result (%s)', async (failure) => {
    const { AgentRuntimePicker } = await import('../src/client/AgentRuntimePicker.tsx')
    const load = vi.fn().mockRejectedValueOnce(failure).mockResolvedValueOnce([])
    const value = { name: '', runtime: '', avatar: '', description: '', instructions: '', skills: [], mcpServers: [], starters: [], concurrency: 1 }
    render(<AgentRuntimePicker value={value} load={load} t={t} change={vi.fn()} />)
    await screen.findByRole('alert')
    fireEvent.click(screen.getByRole('button', { name: en.refreshRuntimes }))
    await screen.findByText(en.noLocalRuntimes)
  })

  it.each([true, false])('ignores a catalog response after unmount (%s)', async (success) => {
    const { AgentRuntimePicker } = await import('../src/client/AgentRuntimePicker.tsx')
    const pending = Promise.withResolvers<import('@deepseek-ai/dsh-api-remotes/client').AgentRuntime[]>()
    const load = () => pending.promise
    const ui = render(<AgentRuntimePicker value={{ name: '', runtime: '', avatar: '', description: '', instructions: '', skills: [], mcpServers: [], starters: [], concurrency: 1 }} load={load} t={t} change={vi.fn()} />)
    ui.unmount()
    await act(async () => { if (success) pending.resolve([]); else pending.reject(new Error('Late failure')) })
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
