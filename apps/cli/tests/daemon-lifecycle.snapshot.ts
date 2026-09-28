/** Assembled keyless snapshot for the `dsh daemon` lifecycle surface. */

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { afterEach, describe, expect, it, vi } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const builtBin = join(repoRoot, 'apps/cli/lib/bin.js')
const tempRoots: string[] = []
const builtArtifactsExist = existsSync(builtBin)

if (process.env.DSH_EXAMPLE_MODE === 'lib' && !builtArtifactsExist) {
  throw new Error('dsh daemon lifecycle snapshot requires built CLI artifacts in lib mode')
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** Run one `dsh daemon` invocation against an isolated harness home. */
function daemon(root: string, args: string[]) {
  return execa(process.execPath, [builtBin, 'daemon', ...args], {
    cwd: root,
    env: {
      ...process.env,
      DSH_AGENTS_HOME: join(root, '.agents'),
      DSH_HOME: join(root, '.dsh'),
      DSH_TELEMETRY_DISABLED: '1',
      NODE_NO_WARNINGS: '1',
    },
    timeout: 30_000,
    killSignal: 'SIGKILL',
    reject: false,
  })
}

/** Normalize the per-run facts (pid, port, harness home) out of daemon output. */
function normalize(text: string, root: string): string {
  return text
    .replaceAll(root, '{{root}}')
    .replace(/pid \d+/u, 'pid {{pid}}')
    .replace(/127\.0\.0\.1:\d+/u, '127.0.0.1:{{port}}')
}

describe.skipIf(!builtArtifactsExist)('dsh daemon lifecycle assembled snapshot', () => {
  it('reports the stopped posture, runs the start-status-stop round trip, and refuses a second start', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-daemon-snapshot-'))
    tempRoots.push(root)

    const stoppedTable = await daemon(root, ['status'])
    const stoppedJson = await daemon(root, ['status', '--output', 'json'])
    const started = await daemon(root, ['start'])
    const again = await daemon(root, ['start'])
    const stopped = await daemon(root, ['stop'])
    const stoppedAgain = await daemon(root, ['stop'])

    expect({
      stoppedTable: { exitCode: stoppedTable.exitCode, stdout: stoppedTable.stdout, stderr: stoppedTable.stderr },
      stoppedJson: { exitCode: stoppedJson.exitCode, stdout: stoppedJson.stdout },
      started: { exitCode: started.exitCode, stderr: normalize(started.stderr, root) },
      again: { exitCode: again.exitCode, stderr: normalize(again.stderr, root) },
      stopped: { exitCode: stopped.exitCode, stderr: stopped.stderr },
      stoppedAgain: { exitCode: stoppedAgain.exitCode, stderr: stoppedAgain.stderr },
    }).toMatchInlineSnapshot(`
      {
        "again": {
          "exitCode": 1,
          "stderr": "Daemon is already running (pid {{pid}}). Use 'dsh daemon restart' to restart it.",
        },
        "started": {
          "exitCode": 0,
          "stderr": "Daemon started (pid {{pid}})
      Logs: {{root}}/.dsh/daemon/daemon.log",
        },
        "stopped": {
          "exitCode": 0,
          "stderr": "Daemon stopped.",
        },
        "stoppedAgain": {
          "exitCode": 0,
          "stderr": "Daemon is not running.",
        },
        "stoppedJson": {
          "exitCode": 0,
          "stdout": "{
        "status": "stopped"
      }",
        },
        "stoppedTable": {
          "exitCode": 0,
          "stderr": "",
          "stdout": "Daemon: stopped
      Start it with: dsh daemon start",
        },
      }
    `)
  }, 60_000)

  it('records the daemon startup line in its log', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-daemon-log-snapshot-'))
    tempRoots.push(root)

    const started = await daemon(root, ['start'])
    expect(started.exitCode).toBe(0)
    // The health answer races the startup line's flush into the log file;
    // wait for the line before tailing.
    const logFile = join(root, '.dsh', 'daemon', 'daemon.log')
    await vi.waitFor(() => {
      expect(existsSync(logFile) && readFileSync(logFile, 'utf8').includes('sensing')).toBe(true)
    })
    const logs = await daemon(root, ['logs', '-n', '1'])
    const stopped = await daemon(root, ['stop'])
    expect(stopped.exitCode).toBe(0)

    expect({
      exitCode: logs.exitCode,
      stdout: normalize(logs.stdout, root),
    }).toMatchInlineSnapshot(`
      {
        "exitCode": 0,
        "stdout": "dsh daemon: pid {{pid}}, sensing claude, codex every 15000ms, health on http://127.0.0.1:{{port}}/health",
      }
    `)
  }, 60_000)
})
