import { EventEmitter } from 'node:events'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildDshWebLaunch, parseWebUrlLine, resolveRepoRoot, stopHost,
  type RepoRootResolution, type StoppableChild,
} from '../src/launcher.ts'

/**
 * Stub child for {@link stopHost}: records signals and answers closes on the
 * caller's schedule, so the escalation decisions run without the vitest
 * worker's grandchild-signal environment. The real signal chain is covered by
 * the web-launch e2e.
 */
class StubChild extends EventEmitter implements StoppableChild {
  exitCode: number | null = null
  signalCode: NodeJS.Signals | null = null
  readonly signals: NodeJS.Signals[] = []

  kill(signal: NodeJS.Signals): boolean {
    this.signals.push(signal)
    // SIGKILL cannot be caught: the kernel ends the process and close fires.
    if (signal === 'SIGKILL') {
      this.signalCode = 'SIGKILL'
      this.emit('close')
    }
    return true
  }

  /** Simulate the terminal close of an orderly SIGTERM stop. */
  closeOrderly(): void {
    this.exitCode = 0
    this.emit('close')
  }

  /** Simulate a close that already happened before stopHost ran. */
  static alreadyExited(): StubChild {
    const child = new StubChild()
    child.exitCode = 0
    return child
  }
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
    const child = new StubChild()
    const pending = stopHost(child, { graceMs: 10_000 })
    await Promise.resolve()
    child.closeOrderly()
    await pending
    expect(child.signals).toStrictEqual(['SIGTERM'])
  })

  it('escalates to SIGKILL after the grace period against a stuck child', async () => {
    const child = new StubChild()
    const pending = stopHost(child, { graceMs: 50 })
    await pending
    expect(child.signals).toStrictEqual(['SIGTERM', 'SIGKILL'])
  })

  it('returns at once for an already-exited child', async () => {
    const child = StubChild.alreadyExited()
    await stopHost(child, { graceMs: 10_000 })
    expect(child.signals).toStrictEqual([])
  })
})

describe('resolveRepoRoot', () => {
  const tempRoots: string[] = []

  /** One directory tree that satisfies the checkout validation. */
  function fakeCheckout(): string {
    const root = mkdtempSync(join(tmpdir(), 'dsh-desktop-repo-root-'))
    tempRoots.push(root)
    mkdirSync(join(root, 'apps/cli/src'), { recursive: true })
    writeFileSync(join(root, 'apps/cli/src/bin.ts'), '')
    return root
  }

  /** Assert one resolution failed with the given fragment in its message. */
  function expectError(resolution: RepoRootResolution, fragment: string): void {
    if (!('error' in resolution)) throw new Error(`expected an error containing ${JSON.stringify(fragment)}`)
    expect(resolution.error).toContain(fragment)
  }

  afterEach(() => {
    for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true })
  })

  it('accepts a valid DSH_REPO_ROOT override', () => {
    const root = fakeCheckout()
    const resolved: RepoRootResolution = resolveRepoRoot({ envRoot: root, packaged: false, resourcesPath: undefined, moduleUrl: 'file:///nonexistent/main.js' })
    expect(resolved).toStrictEqual({ root })
  })

  it('rejects a relative DSH_REPO_ROOT and a non-checkout absolute path', () => {
    expectError(resolveRepoRoot({ envRoot: 'relative/path', packaged: false, resourcesPath: undefined, moduleUrl: 'file:///x/main.js' }), 'DSH_REPO_ROOT must be an absolute path')
    expectError(resolveRepoRoot({ envRoot: tmpdir(), packaged: false, resourcesPath: undefined, moduleUrl: 'file:///x/main.js' }), 'does not name a deepseek-harness checkout')
  })

  it('reads the packaged marker and rejects a bundle packed without one', () => {
    const root = fakeCheckout()
    const resources = mkdtempSync(join(tmpdir(), 'dsh-desktop-resources-'))
    tempRoots.push(resources)
    writeFileSync(join(resources, 'repo-root'), `${root}\n`)
    expect(resolveRepoRoot({ envRoot: undefined, packaged: true, resourcesPath: resources, moduleUrl: 'file:///x/main.js' }))
      .toStrictEqual({ root })
    expectError(resolveRepoRoot({ envRoot: undefined, packaged: true, resourcesPath: undefined, moduleUrl: 'file:///x/main.js' }), 'set DSH_REPO_ROOT')
    const empty = mkdtempSync(join(tmpdir(), 'dsh-desktop-resources-empty-'))
    tempRoots.push(empty)
    expectError(resolveRepoRoot({ envRoot: undefined, packaged: true, resourcesPath: empty, moduleUrl: 'file:///x/main.js' }), 'packed without a repository marker')
  })

  it('derives the checkout from the module URL in a repository run', () => {
    // This spec sits at apps/desktop/tests/, three directories under the root.
    const resolved: RepoRootResolution = resolveRepoRoot({
      envRoot: undefined,
      packaged: false,
      resourcesPath: undefined,
      moduleUrl: import.meta.url,
    })
    expect(resolved).toStrictEqual({ root: fileURLToPath(new URL('../../../', import.meta.url)) })
  })
})
