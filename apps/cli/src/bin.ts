#!/usr/bin/env node
/**
 * dsh — command-line entry. Dynamic imports per mode keep unrelated modes out
 * of each dispatch path; the adapter prints and exits for
 * `--help`/`--version`/a parse error, so only a valid mode reaches the switch.
 * @module @deepseek-ai/dsh/bin
 */

/* v8 ignore file -- built-bin acceptance exercises this self-executing dispatch. */

import { loadLayeredEnv } from '@deepseek-ai/dsh-app-boot'
import { parseDshArgs, readDshVersion } from './args.ts'

const invocation = parseDshArgs(process.argv.slice(2), readDshVersion())

switch (invocation.mode) {
  case 'profile': {
    const { runProfile } = await import('./profile-boot.ts')
    await runProfile({
      environment: loadLayeredEnv('dsh'),
      profile: invocation.profile,
      patchFiles: invocation.patches,
      args: invocation.args,
    })
    break
  }
  case 'plugin': {
    const { runPlugin } = await import('./plugin.ts')
    process.exit(runPlugin(invocation.profile, invocation.args))
    break
  }
  case 'dump-config': {
    const { runDumpConfig } = await import('./dump-config.ts')
    runDumpConfig(invocation.profile, invocation.defaultOnly, invocation.patches)
    break
  }
  case 'daemon': {
    const { runDaemonCommand } = await import('./daemon.ts')
    process.exitCode = await runDaemonCommand(invocation)
    break
  }
  default:
    invocation satisfies never
    throw new Error(`dsh: unhandled invocation mode ${JSON.stringify(invocation)}`)
}
