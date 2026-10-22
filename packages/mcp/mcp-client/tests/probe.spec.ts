/** Isolated connection outcomes, cancellation, and awaited cleanup without secret diagnostics. */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { Config } from '../src/index.ts'

const mock = vi.hoisted(() => ({ create: vi.fn(), connect: vi.fn(), ping: vi.fn() }))
vi.mock('../src/transport.ts', () => ({ createTransport: mock.create }))
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({ Client: class {
  connect = mock.connect
  ping = mock.ping
} }))
import { probeMcp } from '../src/probe.ts'

const config: Config = { transport: 'stdio', serverName: 'test', command: 'test', args: [], env: {}, cwd: '.',
  toolCallTimeoutMs: 1000, failOnStartupError: true }
const options = { timeoutMs: 100, closeTimeoutMs: 20 }
function freshTransport(): Transport {
  const instance: Transport = { start: vi.fn(async () => {}), send: vi.fn(async () => {}),
    close: vi.fn(async () => { instance.onclose?.() }) }
  return instance
}
let transport: Transport
beforeEach(() => {
  vi.resetAllMocks()
  transport = freshTransport()
  mock.create.mockImplementation(freshTransport)
  mock.connect.mockResolvedValue(undefined); mock.ping.mockResolvedValue({})
})
afterEach(() => { vi.useRealTimers() })

it('initializes and pings once, waits for actual close, and suppresses stdio stderr', async () => {
  const stop = Promise.withResolvers<undefined>()
  const close = vi.fn(() => stop.promise)
  transport.close = close
  mock.create.mockReturnValueOnce(transport)
  let settled = false
  const pending = probeMcp(config, options).then((result) => { settled = true; return result })
  await vi.waitFor(() => { expect(close).toHaveBeenCalledOnce() })
  expect(settled).toBe(false)
  stop.resolve(undefined); await Promise.resolve()
  expect(settled).toBe(false)
  transport.onclose?.()
  const result = await pending
  expect(result).toMatchObject({ status: 'connected', cleanup: 'closed' })
  expect(result.checkedAt).toBeGreaterThanOrEqual(result.startedAt)
  expect(mock.create).toHaveBeenCalledWith(config, true)
  expect(mock.connect).toHaveBeenCalledOnce(); expect(mock.ping).toHaveBeenCalledOnce()
})

it('does not start a pre-cancelled connection and rejects invalid deadline bounds', async () => {
  const controller = new AbortController(); controller.abort()
  expect(await probeMcp(config, { ...options, signal: controller.signal })).toMatchObject({ status: 'cancelled', cleanup: 'closed' })
  expect(mock.create).not.toHaveBeenCalled()
  await expect(probeMcp(config, { ...options, timeoutMs: 0 })).rejects.toThrow('timeoutMs')
  await expect(probeMcp(config, { ...options, closeTimeoutMs: -1 })).rejects.toThrow('closeTimeoutMs')
})

it('contains transport creation, initialization, and ping failures without returning server text', async () => {
  mock.create.mockImplementationOnce(() => { throw new Error('secret endpoint') })
  expect(await probeMcp(config, options)).toMatchObject({ status: 'failed', cleanup: 'closed' })
  mock.connect.mockRejectedValueOnce(new Error('secret header'))
  expect(JSON.stringify(await probeMcp(config, options))).not.toContain('secret')
  mock.ping.mockRejectedValueOnce('secret token')
  expect(await probeMcp(config, options)).toMatchObject({ status: 'failed', cleanup: 'closed' })
})

it('closes an in-flight operation once on cancellation and reports timeout independently', async () => {
  mock.ping.mockImplementation((_request: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
    _request.signal.addEventListener('abort', () => { reject(new Error('Probe cancelled', { cause: _request.signal.reason })) }, { once: true })
  }))
  const close = vi.fn(async () => { transport.onclose?.() })
  transport.close = close
  mock.create.mockReturnValueOnce(transport)
  const controller = new AbortController()
  const pending = probeMcp(config, { ...options, signal: controller.signal })
  await vi.waitFor(() => { expect(mock.ping).toHaveBeenCalledOnce() })
  controller.abort()
  expect(await pending).toMatchObject({ status: 'cancelled', cleanup: 'closed' })
  expect(close).toHaveBeenCalledOnce()
  vi.useFakeTimers()
  const timed = probeMcp(config, { ...options, timeoutMs: 10 })
  await vi.advanceTimersByTimeAsync(10)
  expect(await timed).toMatchObject({ status: 'timed-out', cleanup: 'closed' })
})

it('keeps connection success separate from a missing close event or a failed SDK shutdown', async () => {
  vi.useFakeTimers()
  transport.close = vi.fn(async () => {})
  mock.create.mockReturnValueOnce(transport)
  const missing = probeMcp(config, options)
  await vi.advanceTimersByTimeAsync(20)
  expect(await missing).toMatchObject({ status: 'connected', cleanup: 'failed' })
  transport = freshTransport()
  transport.close = vi.fn(async () => { transport.onclose?.(); throw new Error('secret shutdown') })
  mock.create.mockReturnValueOnce(transport)
  expect(await probeMcp(config, options)).toMatchObject({ status: 'connected', cleanup: 'failed' })
})
