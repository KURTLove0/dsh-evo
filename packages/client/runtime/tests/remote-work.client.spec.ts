/** Host-qualified generations, reconnect reads and explicit command ownership. */
import { expect, it, vi } from 'vitest'
import { RemoteWorkManager, type RemoteWorkPort } from '../src/client/remote-work/manager.ts'
import type { RemoteCallRequest, RemotePeer, RemoteWorkResult } from '@deepseek-ai/dsh-work-remote/types'
const peer = { id: 'peer', name: 'Remote', hostId: 'host', principalId: 'principal', origin: 'http://127.0.0.1',
  authorization: { reference: 'KEY', configured: true, owner: 'local-host' }, executionCredentialOwner: 'remote-host' } as RemotePeer
const request: RemoteCallRequest = { peer: peer.id, expected: { hostId: peer.hostId, principalId: peer.principalId },
  operation: { kind: 'stop', id: 'submission' as never } }
function setup() {
  const port: RemoteWorkPort = { peers: vi.fn(async () => [peer]), call: vi.fn(async (request: RemoteCallRequest): Promise<RemoteWorkResult> => request.operation.kind === 'catalog'
    ? { kind: 'catalog', observedAt: 1, catalog: { credentialOwner: 'remote-host', controls: { stop: true, workflowDecisions: true }, workspaces: [] } }
    : request.operation.kind === 'list' ? { kind: 'list', observedAt: 1, items: [] }
      : request.operation.kind === 'inspect' ? { kind: 'inspection', observedAt: 1, submission: {} } as RemoteWorkResult : { kind: 'controlled', id: 'submission' as never }) }
  return { port, manager: new RemoteWorkManager(port) }
}
it('keeps stale reads independent and never resends a command on reconnect', async () => {
  const { port, manager } = setup(), listener = vi.fn(), stop = manager.subscribe(listener)
  await manager.sync(); expect(port.call).not.toHaveBeenCalled(); await manager.choose(peer.id); await manager.select('submission' as never)
  vi.mocked(port.peers).mockRejectedValueOnce(new Error('Offline')); await manager.sync()
  expect(manager.getSnapshot().peers).toMatchObject({ stale: true, error: 'Offline' })
  expect(manager.getSnapshot().detail).toMatchObject({ stale: true })
  manager.invalidate(); await manager.sync(); expect(manager.getSnapshot().detail.stale).toBe(false)
  expect(vi.mocked(port.call).mock.calls.every(([request]) => ['catalog', 'list', 'inspect'].includes(request.operation.kind))).toBe(true)
  vi.mocked(port.call).mockResolvedValueOnce({ kind: 'controlled', id: 'other' as never }); await manager.select('other' as never)
  expect(manager.getSnapshot().detail.error).toBe('Unexpected remote read result.')
  await vi.waitFor(() => { expect(listener).toHaveBeenCalled() }); stop(); manager.dispose()
})
it('retires superseded connection and machine reads and clears results when authority changes', async () => {
  const { port, manager } = setup(); await manager.peers()
  const delayed = Promise.withResolvers<RemoteWorkResult>(); vi.mocked(port.call).mockReturnValueOnce(delayed.promise)
  const choosing = manager.choose(peer.id); manager.invalidate(); delayed.resolve({ kind: 'catalog' } as RemoteWorkResult); await choosing
  expect(manager.getSnapshot().catalog.value).toBeUndefined()
  await manager.sync(); expect(manager.getSnapshot().catalog.value).toBeDefined()
  vi.mocked(port.peers).mockResolvedValueOnce([{ ...peer, hostId: 'different-host' as never }]); await manager.peers()
  expect(manager.getSnapshot().catalog.value).toBeUndefined(); expect(manager.getSnapshot().detail.value).toBeUndefined()
  const peers = Promise.withResolvers<RemotePeer[]>(); vi.mocked(port.peers).mockReturnValueOnce(peers.promise)
  const old = manager.peers(); await manager.peers(); peers.resolve([]); await old
  expect(manager.getSnapshot().peers.value).toEqual([peer]); manager.dispose()
})
it('coalesces exact in-flight commands, retains failures and stops queued mutations after disposal', async () => {
  const { port, manager } = setup(); await manager.peers(); await manager.choose(peer.id)
  const pending = Promise.withResolvers<RemoteWorkResult>(); vi.mocked(port.call).mockReturnValueOnce(pending.promise)
  const first = manager.command(request); expect(manager.command(structuredClone(request))).toBe(first)
  await expect(manager.command({ ...request, operation: { kind: 'list' } })).rejects.toThrow('pending')
  pending.reject(new Error('Lost acknowledgment')); await expect(first).rejects.toThrow('Lost acknowledgment')
  await vi.waitFor(() => { expect(manager.getSnapshot().mutating).toBe(false) })
  const task = manager.command(request); manager.dispose(); await expect(task).rejects.toThrow('disposed')
  await expect(manager.command(request)).rejects.toThrow('disposed'); await manager.sync(); await manager.choose(peer.id); await manager.select('id' as never)
})
