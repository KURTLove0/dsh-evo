/** Pure grouping and filtering over the host-owned runtime directory. */
import type { RuntimesSettingsState, RuntimeRow } from './store.ts'

interface RuntimeMachine {
  id: string
  name: string
  kind: 'local' | 'remote'
  online: boolean
  rows: readonly RuntimeRow[]
  error?: string
  version?: string
  cwd?: string
}

/**
 * Build one local machine and the saved remote deployments.
 * @param state - latest directory and settings snapshot.
 * @param localName - localized local-machine label.
 * @returns machines in local-first order, including disconnected remote hosts.
 */
export function runtimeMachines(state: RuntimesSettingsState, localName: string): RuntimeMachine[] {
  return [
    {
      id: 'local',
      name: localName,
      kind: 'local',
      online: state.status === 'ready' && !state.rows.some(row => row.failure !== undefined),
      rows: state.rows,
    },
    ...state.peers.map((peer): RuntimeMachine => ({
      id: peer.url,
      name: peer.name,
      kind: 'remote',
      online: peer.error === undefined && peer.failures.length === 0,
      ...(peer.error === undefined ? {} : { error: peer.error }),
      ...(peer.version === undefined ? {} : { version: peer.version }),
      ...(peer.cwd === undefined ? {} : { cwd: peer.cwd }),
      rows: peer.providers
        .filter(provider => provider.active && provider.present !== false)
        .map(provider => ({
          provider: provider.provider,
          displayName: provider.displayName,
          settingsNs: provider.settingsNs,
          active: provider.active,
          declared: provider.declared,
          localCommand: provider.localCommand,
          models: peer.groups.find(group => group.id === provider.provider)?.models,
          failure: peer.failures.find(failure => failure.id === provider.provider)?.message,
        })),
    })),
  ]
}

/**
 * Search machine labels, origins, runtime names, commands, and model IDs.
 * @param machines - grouped directory.
 * @param search - case-insensitive query.
 * @param filter - connection/catalog status filter.
 * @returns matching complete machines, retaining their runtime context.
 */
export function filterMachines(
  machines: RuntimeMachine[],
  search: string,
  filter: 'all' | 'online' | 'issues',
): RuntimeMachine[] {
  const query = search.trim().toLowerCase()
  return machines.filter(
    machine =>
      (filter === 'all' || (filter === 'online' ? machine.online : !machine.online)) &&
      [
        machine.name,
        machine.id,
        ...machine.rows.flatMap(row => [
          row.displayName,
          row.provider,
          row.localCommand ?? '',
          ...(row.models?.map(model => model.id) ?? []),
        ]),
      ].some(value => value.toLowerCase().includes(query)),
  )
}
