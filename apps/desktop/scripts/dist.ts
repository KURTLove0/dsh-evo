/**
 * Build the distribution artifact for the desktop shell: one DMG installer
 * image per run (macOS; other platforms fail loud until a release asks for
 * them), produced by electron-builder over `electron-builder.yml`. The script
 * owns what static configuration cannot: it records the hosted-checkout
 * marker the same way `pack.ts` does, then removes the transient marker and
 * verifies the installer landed.
 *
 * Run: `pnpm --filter @deepseek-ai/dsh-desktop run dist` (build included).
 * @module @deepseek-ai/dsh-desktop/dist
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** This package's root, from which every artifact path resolves. */
const packageRoot = fileURLToPath(new URL('..', import.meta.url))

/** Repository root: this package sits two directories under it. */
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))

/** The marker file the main process reads through resolveRepoRoot. */
const markerPath = join(packageRoot, 'build/repo-root')

/** This app's version, read from its checked-in package.json. */
function appVersion(): string {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version?: unknown }
  if (typeof manifest.version !== 'string') throw new Error('dist: package.json carries no version')
  return manifest.version
}

if (process.platform !== 'darwin') {
  throw new Error(`dist: the DMG distribution target is macOS-only; run pack.ts for a plain ${process.platform} bundle`)
}

const version = appVersion()
writeFileSync(markerPath, `${repoRoot}\n`)
try {
  // The package-local electron-builder bin; cwd anchors the yml's relative
  // build/ and dist/ paths.
  const result = spawnSync(join(packageRoot, 'node_modules/.bin/electron-builder'), ['--config', 'electron-builder.yml'], {
    cwd: packageRoot,
    stdio: 'inherit',
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(`dist: electron-builder exited with ${String(result.status ?? result.signal)}`)
} finally {
  rmSync(markerPath, { force: true })
}

const artifact = join(packageRoot, `dist/dsh-desktop-${version}-${process.arch}.dmg`)
if (!existsSync(artifact)) {
  throw new Error(`dist: expected installer at ${artifact}, but it is missing`)
}
console.log(`dist: ${artifact}`)
