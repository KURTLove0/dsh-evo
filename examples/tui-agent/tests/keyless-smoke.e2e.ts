import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { describe, expect, it } from 'vitest'

const tuiScript = fileURLToPath(new URL('../src/tui.ts', import.meta.url))
const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))

function waitFor(
  stdout: () => string,
  text: string,
  stderr: () => string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 30_000
    const poll = (): void => {
      if (stdout().includes(text)) {
        resolve()
        return
      }
      if (Date.now() >= deadline) {
        reject(new Error(
          `timed out waiting for ${JSON.stringify(text)}; stdout=${stdout()}; stderr=${stderr()}`,
        ))
        return
      }
      setTimeout(poll, 25)
    }
    poll()
  })
}

describe('tui-agent keyless smoke', () => {
  it('renders a live turn and exits cleanly', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-tui-agent-smoke-'))
    const modelRequests: Record<string, unknown>[] = []
    const modelServer = createServer((request, response) => {
      let body = ''
      request.setEncoding('utf8')
      request.on('data', (chunk: string) => { body += chunk })
      request.on('end', () => {
        modelRequests.push(JSON.parse(body) as Record<string, unknown>)
        response.writeHead(200, { 'content-type': 'text/event-stream' })
        response.write('data: {"choices":[{"delta":{"role":"assistant","content":null}}]}\n\n')
        response.write('data: {"choices":[{"delta":{"content":"TUI smoke reply"}}]}\n\n')
        response.write('data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":2}}\n\n')
        response.end('data: [DONE]\n\n')
      })
    })
    await new Promise<void>(resolve => modelServer.listen(0, '127.0.0.1', resolve))
    const address = modelServer.address()
    if (address === null || typeof address === 'string') throw new Error('model server did not bind a TCP port')
    // The TUI render loop is the genuinely custom part here; execa owns
    // spawn, the deadline, and exit settlement around it.
    const child = execa(process.execPath, ['--import', 'tsx', tuiScript], {
      cwd: repoRoot,
      env: {
        DEEPSEEK_API_KEY: 'tui-smoke-no-call',
        DEEPSEEK_BASE_URL: `http://127.0.0.1:${address.port}`,
        DSH_CWD: root,
        DSH_SESSION_ROOT: join(root, '.sessions'),
        DSH_TUI_SESSION_ID: 'tui-smoke',
        NO_COLOR: '1',
      },
      timeout: 60_000,
      killSignal: 'SIGKILL',
      reject: false,
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8') })
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })

    try {
      await waitFor(() => stdout, 'session  tui-smoke', () => stderr)
      child.stdin.write('hello from the smoke test\n')
      await waitFor(() => stdout, 'hello from the smoke test', () => stderr)
      await waitFor(() => stdout, 'TUI smoke reply', () => stderr)
      await waitFor(() => stdout, 'completed', () => stderr)
      child.stdin.write('/exit\n')
      const exit = await child
      expect(exit.exitCode, `signal=${String(exit.signal)}; stderr=${stderr}`).toBe(0)
      expect(stdout).toContain('DeepSeek Harness TUI')
      expect(stdout).toContain('model    deepseek-v4-flash')
      const request = modelRequests[0]
      const tools = request?.tools as { function?: { name?: string } }[]
      expect(request?.model).toBe('deepseek-v4-flash')
      expect(tools.map(tool => tool.function?.name)).toContain('bash')
      expect(tools.map(tool => tool.function?.name)).toContain('todo_write')
    } finally {
      // No-op after exit; reject: false settles on every outcome, so cleanup never races teardown.
      child.kill('SIGKILL')
      await child
      await new Promise<void>(resolve => modelServer.close(() => { resolve() }))
      await rm(root, { recursive: true, force: true })
    }
  }, 70_000)
})
