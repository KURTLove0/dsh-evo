/** Real stdio MCP business-data provider used by workbench composition tests. */
import { readFile, writeFile } from 'node:fs/promises'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const server = new McpServer({ name: 'business-fixture', version: '1.0.0' })
server.registerTool('customer_report', {
  description: 'Calculate revenue for one customer from customers.json and save customer-report.txt.',
  inputSchema: { customer: z.string() },
}, async ({ customer }) => {
  const records = JSON.parse(await readFile('customers.json', 'utf8'))
  const total = records.filter(record => record.customer === customer).reduce((sum, record) => sum + record.revenue, 0)
  const report = `${process.env.REPORT_PREFIX}: ${customer} = ${total}\n`
  await writeFile('customer-report.txt', report)
  return { content: [{ type: 'text', text: report }] }
})

const transport = new StdioServerTransport()
await server.connect(transport)
process.stdin.once('end', () => {
  void server.close().then(() => writeFile('mcp-closed.txt', 'closed\n'))
})
