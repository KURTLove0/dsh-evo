/**
 * Commander adapter for the `dsh` command line.
 *
 * The launcher parses only what it owns — which profile to boot, which extra
 * patch overlays to apply, and the config dumps — and hands **everything after
 * its own flags** to the booted tree verbatim, where injected app plugins parse
 * their own flag families and print their own `--help` (see
 * `@deepseek-ai/dsh-cmdline`). Launcher flags therefore come first: the first
 * token this parser does not recognize starts the inner arguments, so
 * `dsh --profile tui --resume abc` boots the tui profile with `--resume abc`,
 * and `dsh --profile web -h` prints the web app's help, not this one's.
 *
 * `web` is a hardcoded alias for `--profile web`; `plugin` manages a profile's
 * plugin dependencies by forwarding to pnpm.
 * @module @deepseek-ai/dsh/args
 */

import { readFileSync } from 'node:fs'
import { Command, CommanderError } from 'commander'

/**
 * This app's version, read from its checked-in package.json. Both the source
 * tree (apps/cli/src) and the bundled bin (apps/cli/lib) sit one directory
 * under apps/cli, so the manifest resolves with the same relative hop from
 * either artifact — shared by `--version` and the daemon's health identity.
 * @returns the version string, or `0.0.0` when the manifest carries none.
 */
export function readDshVersion(): string {
  const manifest = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  ) as { version?: unknown }
  return typeof manifest.version === 'string' ? manifest.version : '0.0.0'
}

/** Boot a named profile and hand it the invocation's inner arguments. */
interface ProfileInvocation {
  mode: 'profile'
  profile: string
  /** Extra patch-list overlays applied after the profile's own layer, in argv order. */
  patches: string[]
  /** Everything after the launcher's own flags, verbatim, for injected app plugins. */
  args: string[]
}

/** Print a composed profile tree and exit without booting. */
interface DumpConfigInvocation {
  mode: 'dump-config'
  profile: string
  /** Omit the profile's user layer and --patch overlays; print bundle layers only. */
  defaultOnly: boolean
  patches: string[]
}

/** Manage a profile's plugins: forward `args` to pnpm inside the profile directory. */
interface PluginInvocation {
  mode: 'plugin'
  profile: string
  /** Raw pnpm arguments, verbatim. */
  args: string[]
}

/** Control the local runtime-sensing daemon. */
export interface DaemonInvocation {
  mode: 'daemon'
  /** Lifecycle operation to run. */
  command: 'start' | 'stop' | 'restart' | 'status' | 'logs'
  /** start/restart: run in the foreground instead of spawning a background child. */
  foreground: boolean
  /** start/restart: loopback port override (`0` picks a free port). */
  port?: number
  /** start/restart: probe interval override in seconds. */
  intervalSeconds?: number
  /** status: output format. */
  output: 'table' | 'json'
  /** logs: keep printing appended content. */
  follow: boolean
  /** logs: trailing line count. */
  lines: number
}

/** The resolved `dsh` invocation. Help, version, and errors exit inside {@link parseDshArgs}. */
export type DshInvocation = ProfileInvocation | DumpConfigInvocation | PluginInvocation | DaemonInvocation

/** Launcher flags shared by the default command and the `web` alias. */
interface BootOptions {
  patch?: string[]
  dumpConfig?: boolean
  dumpDefaultConfig?: boolean
}

/**
 * Repeatable single-value collector: `--patch a.yml --patch b.yml`. Never
 * variadic — a variadic `--patch` would swallow the inner arguments.
 */
const collect = (value: string, previous: string[] = []): string[] => [...previous, value]

/** The launcher's own help text; each app prints its own. */
const HELP_EXAMPLES = `
Examples:
  dsh --profile web                          boot the web profile (same as: dsh web)
  dsh --profile headless "run the tests"     answer one task, print the result, and exit
  dsh --profile tui --patch ./extra.yml      boot a custom profile with one extra overlay
  dsh --profile tui --resume <session>       arguments after the launcher flags reach the app
  dsh --profile web --help                   the web app's own flags and help
  dsh plugin --profile tui add <package>     install a plugin into the tui profile
  dsh daemon start                           start the runtime-sensing daemon in the background
  dsh daemon status                          show what the daemon has sensed on this machine
`

/**
 * Resolve a boot or dump invocation from the launcher flags and the leftover
 * inner arguments.
 * @param program - the command whose options were parsed (the root, or the `web` alias).
 * @param profile - the profile these flags boot.
 * @param options - the launcher flags commander collected.
 * @param args - the leftover arguments, in argv order.
 * @returns the resolved invocation.
 */
function resolveBoot(program: Command, profile: string, options: BootOptions, args: string[]): DshInvocation {
  const patches = options.patch ?? []
  if (patches.includes('')) program.error('error: --patch needs a path')
  if (options.dumpConfig !== true && options.dumpDefaultConfig !== true) {
    return { mode: 'profile', profile, patches, args }
  }
  if (options.dumpConfig === true && options.dumpDefaultConfig === true) {
    program.error('error: --dump-config and --dump-default-config are mutually exclusive')
  }
  // The dump is boot-free: it never runs app command-line providers, so it
  // cannot show what those flags would decide, and printing a tree that differs
  // from the same invocation's boot would mislead.
  if (args.length > 0) {
    program.error(`error: config dumps take no app arguments, got ${args.map(argument => JSON.stringify(argument)).join(' ')}`)
  }
  const defaultOnly = options.dumpDefaultConfig === true
  if (defaultOnly && patches.length > 0) {
    program.error('error: --dump-default-config prints the bundle layers and takes no --patch')
  }
  return { mode: 'dump-config', profile, defaultOnly, patches }
}

/**
 * Resolve argv into one invocation, or print and exit for help, version, or an
 * error.
 * @param argv - arguments after the Node binary and script.
 * @param version - version string printed by `--version`.
 * @returns the resolved invocation.
 */
export function parseDshArgs(argv: readonly string[], version: string): DshInvocation {
  let resolved: DshInvocation | undefined
  // Annotated, not inferred: the actions below call back into `program`, and an
  // inferred type would be circular through its own chain.
  const program: Command = new Command()
  program
    .name('dsh')
    .version(version, '-V, --version', 'output the version number')
    .description('dsh: boot a DeepSeek Harness profile — an ordered stack of plugin-bundle patch layers under your own overrides.')
    .addHelpText('after', HELP_EXAMPLES)
    .exitOverride()
    // The launcher's flags come first and end at the first token it does not
    // know; everything from there on belongs to the booted app, including
    // its -h. `dsh -h` with no profile still prints this help, below.
    .helpOption(false)
    .allowUnknownOption()
    .passThroughOptions()
    .enablePositionalOptions()
    .argument('[args...]', 'arguments for the booted profile\'s app (see: dsh --profile <name> --help)')
    .option('--profile <name>', 'the profile under $DSH_HOME/profiles to boot')
    .option('--patch <path>', 'extra patch-list overlay applied after the profile layer (repeatable)', collect)
    .option('--dump-config', 'print the composed profile tree and exit')
    .option('--dump-default-config', 'print the profile tree without its user layer or --patch overlays and exit')
    .action((args: string[], options: BootOptions & { profile?: string }) => {
      // With the app owning -h, the launcher's own help is what a bare
      // `dsh -h` (no profile to hand it to) must print.
      if (options.profile === undefined) {
        if (args.some(argument => argument === '-h' || argument === '--help')) program.help()
        program.error('error: --profile <name> is required')
      }
      const profile = options.profile
      if (profile === '') program.error('error: --profile needs a name')
      resolved = resolveBoot(program, profile, options, args)
    })

  /** Reject parent options supplied before a subcommand. */
  const rejectParentOptions = (command: string): void => {
    const parent = program.opts<BootOptions & { profile?: string }>()
    if (parent.profile !== undefined || parent.patch !== undefined
      || parent.dumpConfig !== undefined || parent.dumpDefaultConfig !== undefined) {
      program.error(`error: ${command} takes none of parent --profile, --patch, --dump-config, or --dump-default-config`)
    }
  }

  const web = program.command('web').description('boot the web profile (alias of --profile web); the web app\'s own flags follow')
  web
    .helpOption(false)
    .allowUnknownOption()
    .passThroughOptions()
    .enablePositionalOptions()
    .argument('[args...]', 'arguments for the web app (see: dsh web --help)')
    .option('--patch <path>', 'extra patch-list overlay applied after the profile layer (repeatable)', collect)
    .option('--dump-config', 'print the composed web-profile tree (with the user layer and any --patch) and exit')
    .option('--dump-default-config', 'print the web profile\'s bundle layers (no user layer) and exit')
    .action((args: string[], options: BootOptions) => {
      rejectParentOptions('web')
      resolved = resolveBoot(web, 'web', options, args)
    })

  const plugin = program.command('plugin').description('manage a profile\'s plugins by forwarding the remaining arguments to pnpm in the profile directory')
  plugin
    .requiredOption('--profile <name>', 'the profile whose plugins to manage (initialized on first use)')
    .allowUnknownOption()
    .argument('[args...]', 'pnpm arguments, forwarded verbatim (add <pkg>, remove <pkg>, why <pkg>, ...)')
    .action((args: string[], options: { profile: string }) => {
      rejectParentOptions('plugin')
      if (options.profile === '') program.error('error: --profile needs a name')
      if (args.length === 0) program.error('error: plugin needs pnpm arguments to forward (e.g. add <package>)')
      resolved = { mode: 'plugin', profile: options.profile, args }
    })

  const daemon = program.command('daemon').description('control the local runtime-sensing daemon (multica-style): start, stop, status, logs')

  /** Validate one `--port` value: an integer 0-65535, where 0 picks a free port. */
  const parsePort = (raw: string): number => {
    const port = Number(raw)
    if (!Number.isInteger(port) || port < 0 || port > 65_535) {
      program.error(`error: --port needs an integer 0-65535, got ${JSON.stringify(raw)}`)
    }
    return port
  }

  /** Validate one `--interval` value: a positive number of seconds. */
  const parseInterval = (raw: string): number => {
    const seconds = Number(raw)
    if (!Number.isFinite(seconds) || seconds <= 0) {
      program.error(`error: --interval needs a positive number of seconds, got ${JSON.stringify(raw)}`)
    }
    return seconds
  }

  /** Start/restart flag set, shared so both commands parse identically. */
  interface DaemonStartFlags {
    foreground: boolean
    port?: number
    interval?: number
  }
  const addStartFlags = (leaf: Command): Command => leaf
    .option('--foreground', 'run in the foreground instead of background', false)
    .option('--port <port>', 'loopback port for the health endpoint; 0 picks a free port (env: DSH_DAEMON_PORT)', parsePort)
    .option('--interval <seconds>', 'probe interval in seconds (env: DSH_DAEMON_INTERVAL_MS, in milliseconds)', parseInterval)

  const resolveStart = (options: DaemonStartFlags, command: 'start' | 'restart'): DaemonInvocation => ({
    mode: 'daemon',
    command,
    foreground: options.foreground,
    ...options.port === undefined ? {} : { port: options.port },
    ...options.interval === undefined ? {} : { intervalSeconds: options.interval },
    output: 'table',
    follow: false,
    lines: 50,
  })

  addStartFlags(daemon.command('start').description('start the daemon in the background (see --foreground)'))
    .action((options: DaemonStartFlags) => {
      rejectParentOptions('daemon')
      resolved = resolveStart(options, 'start')
    })

  daemon.command('stop').description('stop the running daemon')
    .action(() => {
      rejectParentOptions('daemon')
      resolved = { mode: 'daemon', command: 'stop', foreground: false, output: 'table', follow: false, lines: 50 }
    })

  addStartFlags(daemon.command('restart').description('restart the running daemon (stop + start)'))
    .action((options: DaemonStartFlags) => {
      rejectParentOptions('daemon')
      resolved = resolveStart(options, 'restart')
    })

  daemon.command('status').description('show daemon status and the sensed runtimes')
    .option('--output <format>', 'output format: table or json', 'table')
    .action((options: { output: string }) => {
      rejectParentOptions('daemon')
      if (options.output !== 'table' && options.output !== 'json') {
        program.error(`error: --output needs table or json, got ${JSON.stringify(options.output)}`)
      }
      resolved = { mode: 'daemon', command: 'status', foreground: false, output: options.output, follow: false, lines: 50 }
    })

  daemon.command('logs').description('show daemon logs')
    .option('-f, --follow', 'follow log output', false)
    .option('-n, --lines <count>', 'number of trailing lines to show', (raw: string) => {
      const lines = Number(raw)
      if (!Number.isInteger(lines) || lines < 0) {
        program.error(`error: --lines needs a non-negative integer, got ${JSON.stringify(raw)}`)
      }
      return lines
    }, 50)
    .action((options: { follow: boolean; lines: number }) => {
      rejectParentOptions('daemon')
      resolved = { mode: 'daemon', command: 'logs', foreground: false, output: 'table', follow: options.follow, lines: options.lines }
    })

  daemon.action(() => {
    // Bare `dsh daemon`: the group's own help is the useful answer.
    daemon.help()
  })

  try {
    program.parse(argv, { from: 'user' })
  } catch (error) {
    return process.exit(error instanceof CommanderError ? error.exitCode : 1)
  }
  /* v8 ignore next -- an action resolves or Commander throws */
  if (resolved === undefined) throw new Error('dsh: no invocation resolved')
  return resolved
}
