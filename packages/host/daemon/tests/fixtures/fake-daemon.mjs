/**
 * Process-bound fixture: a stand-in daemon the lifecycle helpers can really
 * spawn. It binds 127.0.0.1 on the port from DSH_DAEMON_PORT (0 picks a free
 * one), publishes the state document under DSH_HOME like the real daemon,
 * answers /health with the wire shape, and exits 0 on POST /shutdown.
 */

import { createServer } from 'node:http'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const stateDir = join(process.env.DSH_HOME, 'daemon')
const statePath = join(stateDir, 'daemon.json')
const startedAt = new Date().toISOString()

const server = createServer((request, response) => {
  if (request.url === '/health' && request.method === 'GET') {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({
      status: 'running',
      pid: process.pid,
      version: 'fixture',
      startedAt,
      uptimeSeconds: 0,
      runtimes: [{ command: 'claude', label: 'Claude CLI', present: true, checkedAt: startedAt }],
    }))
    return
  }
  if (request.url === '/shutdown' && request.method === 'POST') {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ status: 'stopping' }))
    setImmediate(() => {
      server.close(() => {
        rmSync(statePath, { force: true })
        process.exit(0)
      })
    })
    return
  }
  response.writeHead(404, { 'content-type': 'application/json' })
  response.end(JSON.stringify({ error: 'not-found' }))
})
server.listen(Number(process.env.DSH_DAEMON_PORT ?? '0'), '127.0.0.1', () => {
  mkdirSync(stateDir, { recursive: true })
  writeFileSync(statePath, JSON.stringify({
    pid: process.pid,
    port: server.address().port,
    version: 'fixture',
    startedAt,
  }))
})
