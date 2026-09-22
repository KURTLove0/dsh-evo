import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import LocalBusinessWorkflowRuntime from '@deepseek-ai/dsh-business-workflow-local'
import type { RequirementSubmission } from '@deepseek-ai/dsh-business-workflow'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

describe('business-workflow-local through a real Loader composition', () => {
  it('applies the provider-owned capacity config from a Cordis row', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-business-workflow-local-loader-'))
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      "- name: '@deepseek-ai/dsh-business-workflow-local'",
      '  config:',
      '    maxWorkflows: 1',
      '',
    ].join('\n'))

    context = new Context()
    context.baseUrl = pathToFileURL(root).href + '/'
    await context.plugin(Loader)
    context.loader.builtins.include = Include
    context.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (specifier === '@deepseek-ai/dsh-business-workflow-local') return LocalBusinessWorkflowRuntime
        throw new Error(`unexpected Loader import: ${specifier}`)
      },
    } as unknown as NonNullable<typeof context.loader.internal>
    await context.loader.create({
      name: 'cordis:include',
      config: { path: pathToFileURL(configPath).href },
    })
    await context.loader.await()

    expect(context.businessWorkflows).toBeInstanceOf(LocalBusinessWorkflowRuntime)
    const submission: RequirementSubmission = {
      summary: 'Rank inbound leads',
      objectives: [{ id: 'rank', statement: 'Score every lead' }],
      inputs: [{ name: 'leads', description: 'Raw lead records' }],
      outputs: [{ name: 'ranking', description: 'Scored ranking' }],
      acceptanceCases: [{ name: 'sample', given: { leads: ['a'] }, expect: { kind: 'nonEmpty' } }],
    }
    context.businessWorkflows.submitRequirement({ submission })
    expect(() => context!.businessWorkflows.submitRequirement({ submission }))
      .toThrow('(1)')
  })
})
