/**
 * The daemon's loopback health endpoint: how the CLI and the API proxy ask
 * "is a daemon alive, and what has it sensed". Loopback-only and
 * unauthenticated — the same trust model as the multica daemon this mirrors;
 * the state directory's owner-only permissions are the boundary.
 * @module @deepseek-ai/dsh-daemon/server
 */

import { createServer, type Server } from 'node:http'
import type { DaemonReport } from './report.ts'

/** Wire shape of the daemon's health answer. */
export interface DaemonHealth {
  /** Liveness marker; always `running` while the endpoint serves. */
  status: 'running'
  /** Process id of the daemon. */
  pid: number
  /** CLI version that started the daemon. */
  version: string
  /** ISO timestamp of the daemon's start. */
  startedAt: string
  /** Whole seconds since the daemon started, never negative. */
  uptimeSeconds: number
  /** The latest sensing report rows, in catalog order. */
  runtimes: DaemonReport['runtimes']
}

/** Options for {@link createDaemonServer}. */
export interface DaemonServerOptions {
  /** Loopback port to bind; `0` picks a free port (tests). */
  port: number
  /** CLI version reported in health answers. */
  version: string
  /** ISO timestamp the daemon started at. */
  startedAt: string
  /** Latest sensing report supplier. */
  report: () => DaemonReport
  /** Called after a shutdown answer is sent, on the next tick. */
  onShutdown: () => void
  /** Daemon process id reported in health answers; defaults to this process. */
  pid?: number
  /** Uptime clock seam; defaults to {@link Date.now}. */
  now?: () => number
}

/** A bound health endpoint. */
export interface DaemonServer {
  /** The port actually bound. */
  readonly port: number
  /**
   * Close the listener.
   * @returns nothing after the listener releases the port.
   */
  close(): Promise<void>
}

/**
 * Bind the daemon's health endpoint on 127.0.0.1. `GET /health` answers the
 * sensing report with the daemon's identity; `POST /shutdown` answers a
 * stopping marker and then runs the shutdown callback; every other route is
 * a 404, every wrong method a 405.
 * @param options - port, identity, report supplier, and shutdown callback.
 * @returns the bound server.
 * @throws when the port cannot be bound (in use, or otherwise refused).
 */
export async function createDaemonServer(options: DaemonServerOptions): Promise<DaemonServer> {
  const pid = options.pid ?? process.pid
  const now = options.now ?? Date.now
  const server: Server = createServer((request, response) => {
    const send = (status: number, body: object): void => {
      response.writeHead(status, { 'content-type': 'application/json' })
      response.end(JSON.stringify(body))
    }
    if (request.url === '/health' && request.method === 'GET') {
      send(200, {
        status: 'running',
        pid,
        version: options.version,
        startedAt: options.startedAt,
        // A skewed clock reads the start as the future; uptime never goes
        // negative over the wire.
        uptimeSeconds: Math.max(0, Math.round((now() - Date.parse(options.startedAt)) / 1000)),
        runtimes: options.report().runtimes,
      } satisfies DaemonHealth)
      return
    }
    if (request.url === '/shutdown' && request.method === 'POST') {
      send(200, { status: 'stopping' })
      // The answer must flush before the process begins teardown.
      setImmediate(options.onShutdown)
      return
    }
    if (request.url === '/health' || request.url === '/shutdown') {
      send(405, { error: 'method-not-allowed' })
      return
    }
    send(404, { error: 'not-found' })
  })
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      reject(new Error(`dsh-daemon: cannot bind 127.0.0.1:${options.port}: ${error.message}`, { cause: error }))
    }
    server.once('error', onError)
    server.listen(options.port, '127.0.0.1', () => {
      server.off('error', onError)
      resolve()
    })
  })
  // A TCP server that just listened has an AddressInfo address; the string
  // case belongs to IPC sockets this server never creates.
  const address = server.address() as { port: number }
  return {
    port: address.port,
    close: () => new Promise((resolve) => { server.close(() => { resolve() }) }),
  }
}
