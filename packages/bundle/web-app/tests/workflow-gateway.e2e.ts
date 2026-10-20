/** Keyless built-artifact regression for the shipped Web workflow Remote registration. */
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const built = [
  '../../base/lib/index.js',
  '../lib/index.js',
  '../../../business/business-workflow-local/lib/types/workbench.js',
  '../../../business/business-workflow-local/lib/typert.host.js',
  '../../../../apps/web/dist/index.html',
].every(path => existsSync(new URL(path, import.meta.url)))

describe.skipIf(!built)('Web workflow Gateway built composition', () => {
  it('registers strict endpoints and serves workflow requests without an active conversation', async () => {
    const output = await new Promise<string>((resolve, reject) => {
      execFile(process.execPath, [fileURLToPath(new URL('./fixtures/workflow-gateway.mjs', import.meta.url))], {
        cwd: fileURLToPath(new URL('../../../..', import.meta.url)),
        encoding: 'utf8',
        timeout: 55_000,
      }, (error, stdout, stderr) => {
        if (error !== null) reject(new Error(`${error.message}\n${stderr}`))
        else resolve(stdout)
      })
    })
    const result = JSON.parse(output.trim().split('\n').at(-1) ?? '{}') as unknown
    expect(result).toMatchObject({
      descriptors: ['snapshot', 'command', 'validate'].map(method =>
        `@deepseek-ai/dsh-business-workflow-local#workflowGateway/${method}`),
      empty: { status: 200, body: { result: { ok: true, value: { workflows: [], presets: ['standard'] } } } },
      invalid: { status: 200, body: { result: { ok: false } } },
      created: { status: 200, body: { result: { ok: true, value: { revision: 1 } } } },
      snapshot: { status: 200, body: { result: { ok: true, value: { workflows: [{ name: 'Gateway workflow' }] } } } },
      validation: { status: 200, body: { result: { ok: true, value: { valid: false } } } },
    })
  }, 60_000)
})
