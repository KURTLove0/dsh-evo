import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildDshWebLaunch, parseWebUrlLine, stopHost } from '../src/launcher.ts'

/**
 * Spawn one Node child whose script registers its signal behavior and prints
 * READY, then hold the test until that marker arrives: the `spawn` event alone
 * only proves the process exists, and a signal sent before the handler
 * registers takes the default disposition.
 * @param script - child program after the marker write.
 * @returns the spawned child once its script is running.
 */
function spawnedReady(script: string): Promise<ReturnType<typeof spawn>> {
  const child = spawn(process.execPath, ['-e', `process.stdout.write('READY'); ${script}`])
  return new Promise((resolve, reject) => {
    child.stdout.setEncoding('utf8')
    const onData = (chunk: string): void => {
      if (chunk.includes('READY')) {
        child.stdout.off('data', onData)
        child.off('close', onClose)
        resolve(child)
      }
    }
    const onClose = (code: number | null): void => {
      child.stdout.off('data', onData)
      reject(new Error(`helper child exited before READY (code ${String(code)})`))
    }
    child.stdout.once('data', onData)
    child.once('close', onClose)
  })
}

describe('buildDshWebLaunch', () => {
  it('builds the source-launch vector with the desktop-owned flags', () => {
    const root = '/repo/root'
    const launch = buildDshWebLaunch(root)
    expect(launch.command).toBe(process.execPath)
    expect(launch.args).toStrictEqual([
      '--expose-internals',
      '--import', 'tsx/esm',
      join(root, 'apps/cli/src/bin.ts'),
      'web', '--no-open', '--port', '0',
    ])
    expect(launch.cwd).toBe(root)
    expect(launch.env).toStrictEqual({ ELECTRON_RUN_AS_NODE: '1' })
  })
})

describe('parseWebUrlLine', () => {
  it('extracts the loopback URL from the settled-ready line', () => {
    expect(parseWebUrlLine('dsh web: http://127.0.0.1:3080\n')).toBe('http://127.0.0.1:3080')
  })

  it('drops the display-only LAN suffix of an all-interfaces bind', () => {
    const stdout = 'dsh web: http://127.0.0.1:3080 (LAN: http://192.168.1.4:3080)\n'
    expect(parseWebUrlLine(stdout)).toBe('http://127.0.0.1:3080')
  })

  it('finds the line among other output, tolerating CRLF', () => {
    const stdout = 'boot noise\r\nother: line\r\ndsh web: http://127.0.0.1:65530\r\nmore'
    expect(parseWebUrlLine(stdout)).toBe('http://127.0.0.1:65530')
  })

  it('returns undefined before the ready line and for non-loopback URLs', () => {
    expect(parseWebUrlLine('')).toBeUndefined()
    expect(parseWebUrlLine('booting...\n')).toBeUndefined()
    expect(parseWebUrlLine('dsh web: http://0.0.0.0:3080\n')).toBeUndefined()
    expect(parseWebUrlLine('echo dsh web: http://127.0.0.1:3080\n')).toBeUndefined()
  })
})

describe('stopHost', () => {
  it('stops a SIGTERM-responsive child without escalation', async () => {
    const child = await spawnedReady('process.on("SIGTERM", () => process.exit(0))')
    await stopHost(child, { graceMs: 10_000 })
    expect(child.exitCode).toBe(0)
  }, 15_000)

  it('escalates to SIGKILL after the grace period against an ignoring child', async () => {
    const child = await spawnedReady('process.on("SIGTERM", () => {})')
    await stopHost(child, { graceMs: 300 })
    expect(child.signalCode).toBe('SIGKILL')
  }, 15_000)

  it('returns at once for an already-exited child', async () => {
    const child = spawn(process.execPath, ['-e', ''])
    await new Promise<void>((resolve) => { child.once('close', resolve) })
    await stopHost(child, { graceMs: 10_000 })
    expect(child.exitCode).toBe(0)
  })
})
