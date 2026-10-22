/** Real SDK handshake, failure, timeout, and process-exit evidence for temporary probes. */
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { createServer } from 'node:http'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, it } from 'vitest'
import { probeMcp } from '../src/probe.ts'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function run(mode: string, timeoutMs = 2000) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-mcp-probe-')); roots.push(root)
  const file = join(root, 'pid')
  const result = await probeMcp({ transport: 'stdio', serverName: 'probe', command: process.execPath,
    args: [fileURLToPath(new URL('./probe-server.mjs', import.meta.url)), mode], cwd: root,
    env: { DSH_PROBE_PID_FILE: file, PROBE_SECRET: 'probe-secret-never-returned' },
    toolCallTimeoutMs: 1000, failOnStartupError: true }, { timeoutMs, closeTimeoutMs: 1000 })
  const pid = Number(await readFile(file, 'utf8'))
  expect(() => process.kill(pid, 0)).toThrow()
  expect(JSON.stringify(result)).not.toContain('probe-secret')
  return result
}
it('handshakes and pings a server without invoking tools, then waits for process exit', async () => {
  expect(await run('ok')).toMatchObject({ status: 'connected', cleanup: 'closed' })
})
it('contains real server errors and closes timed-out connections', async () => {
  expect(await run('reject')).toMatchObject({ status: 'failed', cleanup: 'closed' })
  expect(await run('hang')).toMatchObject({ status: 'timed-out', cleanup: 'closed' })
})
it('waits for SDK escalation and actual exit when a server ignores stdin closure and SIGTERM', async () => {
  expect(await run('stubborn', 500)).toMatchObject({ status: 'timed-out', cleanup: 'closed' })
}, 10000)
it('initializes and pings a real HTTP endpoint with saved headers and without discovering or calling tools', async () => {
  const methods: string[] = [], headers: (string | undefined)[] = []
  const http = createServer((request, response) => {
    headers.push(request.headers.authorization)
    void (async () => {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk as Uint8Array))
      const body = chunks.length === 0 ? undefined : JSON.parse(Buffer.concat(chunks).toString()) as { method?: string }
      if (body?.method !== undefined) methods.push(body.method)
      const server = new McpServer({ name: 'http-probe', version: '1' }, { capabilities: {} })
      const transport = new StreamableHTTPServerTransport({})
      response.on('close', () => { void transport.close(); void server.close() })
      // The SDK transport instance has optional callbacks whose declarations omit explicit undefined.
      await server.connect(transport as Transport)
      await transport.handleRequest(request, response, body)
    })().catch(() => { response.writeHead(500).end() })
  })
  await new Promise<void>((resolve) => { http.listen(0, '127.0.0.1', resolve) })
  try {
    const address = http.address()
    if (address === null || typeof address === 'string') throw new Error('Expected a bound HTTP probe port.')
    const result = await probeMcp({ transport: 'streamable-http', serverName: 'http', url: `http://127.0.0.1:${address.port}/mcp`,
      headers: { Authorization: 'Bearer http-secret' }, toolCallTimeoutMs: 1000, failOnStartupError: true }, { timeoutMs: 2000, closeTimeoutMs: 1000 })
    expect(result).toMatchObject({ status: 'connected', cleanup: 'closed' })
    expect(methods).toEqual(['initialize', 'notifications/initialized', 'ping'])
    expect(headers.every(value => value === 'Bearer http-secret')).toBe(true)
    expect(JSON.stringify(result)).not.toContain('http-secret')
  } finally {
    http.closeAllConnections()
    await new Promise<void>((resolve, reject) => { http.close((error) => { if (error === undefined) resolve(); else reject(error) }) })
  }
})
