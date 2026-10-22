/** Real stdio probe fixture: records process ownership and refuses tool execution. */
import { writeFile } from 'node:fs/promises'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { PingRequestSchema } from '@modelcontextprotocol/sdk/types.js'

await writeFile(process.env.DSH_PROBE_PID_FILE, String(process.pid))
const server = new Server({ name: 'probe-fixture', version: '1' }, { capabilities: {} })
const mode = process.argv[2]
if (mode === 'stubborn') {
  process.on('SIGTERM', () => {})
  setInterval(() => {}, 1000)
}
server.setRequestHandler(PingRequestSchema, () => {
  if (mode === 'reject') throw new Error(process.env.PROBE_SECRET)
  if (mode === 'hang' || mode === 'stubborn') return new Promise(() => {})
  return {}
})
await server.connect(new StdioServerTransport())
