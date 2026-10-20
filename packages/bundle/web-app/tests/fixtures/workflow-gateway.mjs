/** Built Web composition probe using the real RPC carrier without binding a port. */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = fileURLToPath(new URL('../../../../..', import.meta.url))
const home = await mkdtemp(join(tmpdir(), 'dsh-workflow-gateway-'))
process.env.DSH_HOME = home

const load = path => import(pathToFileURL(join(repo, path)).href)
const { Context } = await load('vendor/cordis/lib/index.js')
const { default: Loader } = await load('vendor/loader/lib/index.js')
const { default: Include } = await load('vendor/include/lib/index.js')
const { default: Group } = await load('vendor/group/lib/index.js')
const { healProfilesModuleFallback, loadOverlayPatches, assertEntriesLoaded } = await load('packages/boot/app-boot/lib/index.js')
const { dshHomePath } = await load('packages/util/home-paths/lib/index.js')
const { provideCmdline } = await load('packages/boot/cmdline/lib/index.js')
const ctx = new Context()

try {
  healProfilesModuleFallback(join(repo, 'apps/cli/package.json'), home)
  const profile = join(home, 'profiles', 'test')
  await mkdir(profile, { recursive: true })
  const config = join(profile, 'cordis.yml')
  await writeFile(config, '[]\n')
  ctx.baseUrl = pathToFileURL(profile).href + '/'
  ctx.provide('dshHomePath', dshHomePath)
  provideCmdline(ctx, { args: ['--no-open'], exit: code => { throw new Error(`unexpected exit ${code}`) } })
  // Only the network listener is replaced; Connection and its Fetch handler stay real.
  ctx.provide('webServer', {
    host: '127.0.0.1', port: 3080,
    register: () => () => {}, registerUpgrade: () => () => {},
    tapIndex: () => () => {}, registerFallback: () => () => {}, renderIndex: html => html,
  })
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  ctx.loader.builtins.group = Group
  await ctx.loader.create({
    name: 'cordis:include',
    config: {
      path: pathToFileURL(config).href,
      patches: [
        ...loadOverlayPatches('workflow gateway test', join(repo, 'packages/bundle/base/cordis.patch.yml')),
        ...loadOverlayPatches('workflow gateway test', join(repo, 'packages/bundle/web-app/cordis.patch.yml')),
        { id: 'webserver', disabled: true },
        { id: 'web-runtime', config: { openBrowser: false, printUrl: false, surfaceContext: false } },
        { id: 'agent-presets', config: {
          default: 'standard',
          roots: [{ path: join(repo, 'apps/cli/config/agent-presets'), trust: 'system' }],
          includeUserRoot: false,
        } },
      ],
    },
  })
  await ctx.loader.await()
  assertEntriesLoaded(ctx, 'workflow gateway test')

  const descriptors = ['snapshot', 'command', 'validate'].map(method =>
    ctx.typert.local.get(`workflowGateway/${method}`)?.id ?? null)
  const handler = ctx.connection.createSharedFetchHandler('/api', {
    fetch: async () => new Response('unclaimed endpoint', { status: 404 }),
  })
  let sequence = 0
  const request = async (method, args) => {
    const endpoint = `workflowGateway/${method}`
    const response = await handler.fetch(new Request(`http://127.0.0.1:3080/api/${endpoint}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: `test-${++sequence}`, method: endpoint, payload: { args } }),
    }))
    return { status: response.status, body: await response.json() }
  }
  const empty = await request('snapshot', { request: {} })
  const invalid = await request('snapshot', { request: { id: 123 } })
  const workspace = await ctx.workspaceRegistry.create(home)
  const created = await request('command', { request: {
    kind: 'create', workspaceId: workspace.id, name: 'Gateway workflow', description: 'Review leads.',
  } })
  const snapshot = await request('snapshot', { request: { id: created.body.result.value.workflowId } })
  const validation = await request('validate', { definition: snapshot.body.result.value.workflows[0].draft })
  console.log(JSON.stringify({ descriptors, empty, invalid, created, snapshot, validation }))
} finally {
  await ctx.fiber.dispose()
  await rm(home, { recursive: true, force: true })
}
