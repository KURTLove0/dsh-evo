/** Keyless assembled smoke for the desktop shell's host-subprocess vector. */

import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { buildDshWebLaunch, parseWebUrlLine, stopHost } from '../src/launcher.ts'

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const frontendIndex = join(repoRoot, 'apps/web/dist/index.html')
/** A source boot of the web composition serves the built frontend dist, so the smoke needs it present. */
const builtArtifactsExist = existsSync(frontendIndex)
const tempRoots: string[] = []
let host: ChildProcess | undefined

afterEach(() => {
  if (host !== undefined) {
    host.kill('SIGKILL')
    host = undefined
  }
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/**
 * Boot the real source `dsh web` with the desktop shell's exact launch vector,
 * resolve the settled-ready URL, and stop through {@link stopHost}.
 * @returns the ready URL and the host's exit code after the stop.
 */
async function bootAndStopHost(): Promise<{ url: string; code: number | null }> {
  const root = mkdtempSync(join(tmpdir(), 'dsh-desktop-web-launch-'))
  tempRoots.push(root)
  const launch = buildDshWebLaunch(repoRoot)
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DEEPSEEK_API_KEY: 'keyless-desktop-web-launch-no-call',
    DSH_HOME: join(root, '.dsh'),
    DSH_TELEMETRY_DISABLED: '1',
    NODE_NO_WARNINGS: '1',
    SSH_CONNECTION: '',
    SSH_TTY: '',
    ...launch.env,
  }
  delete env.NODE_OPTIONS
  const child = spawn(launch.command, launch.args, { cwd: launch.cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
  host = child
  let stderr = ''
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => { stderr += chunk })
  const url = await new Promise<string>((resolve, reject) => {
    let stdout = ''
    child.stdout.setEncoding('utf8')
    const onStdout = (chunk: string): void => {
      stdout += chunk
      const found = parseWebUrlLine(stdout)
      if (found !== undefined) {
        child.stdout.off('data', onStdout)
        child.off('close', onClose)
        clearTimeout(timer)
        resolve(found)
      }
    }
    const onClose = (code: number | null): void => {
      clearTimeout(timer)
      reject(new Error(`dsh web exited before its ready URL (code ${String(code)})\nstderr:\n${stderr}`))
    }
    const timer = setTimeout(() => {
      child.stdout.off('data', onStdout)
      child.off('close', onClose)
      child.kill('SIGKILL')
      reject(new Error(`dsh web did not print its ready URL within 60s\nstdout:\n${stdout}\nstderr:\n${stderr}`))
    }, 60_000)
    child.stdout.on('data', onStdout)
    child.once('close', onClose)
  })
  const response = await fetch(url)
  expect(response.status).toBe(200)
  const page = await response.text()
  expect(page).toContain('__DSH_BOOT__')
  await stopHost(child, { graceMs: 30_000 })
  host = undefined
  // close has fired inside stopHost, so the final status is already readable.
  return { url, code: child.exitCode }
}

describe.skipIf(!builtArtifactsExist)('desktop shell web-launch vector', () => {
  it('boots the real composition, serves the page, and stops with a quiescent exit', async () => {
    const { url, code } = await bootAndStopHost()
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/u)
    expect(code).toBe(0)
  }, 120_000)
})
