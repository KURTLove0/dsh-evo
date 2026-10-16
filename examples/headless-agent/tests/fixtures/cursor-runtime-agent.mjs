#!/usr/bin/env node

import { readFileSync } from 'node:fs'

const args = process.argv.slice(2)
if (args.includes('models')) {
  process.stdout.write('Available models\ncursor-fixture - Cursor Fixture (current/default)\n')
  process.exit(0)
}

readFileSync(0, 'utf8')
for (const frame of [
  {
    type: 'tool_call',
    subtype: 'started',
    call_id: 'cursor-tool-1',
    tool_call: { shellToolCall: { args: { command: 'printf CURSOR_RUNTIME' } } },
    timestamp_ms: 10,
  },
  {
    type: 'tool_call',
    subtype: 'completed',
    call_id: 'cursor-tool-1',
    tool_call: { shellToolCall: { args: { command: 'printf CURSOR_RUNTIME' }, result: { success: { stdout: 'CURSOR_RUNTIME' } } } },
    timestamp_ms: 11,
  },
  {
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'text', text: 'Cursor runtime completed.' }] },
    timestamp_ms: 12,
  },
  {
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: 'Cursor runtime completed.',
    usage: { inputTokens: 7, outputTokens: 3 },
  },
]) process.stdout.write(`${JSON.stringify(frame)}\n`)
