/**
 * Pack the desktop shell into a platform application bundle: `DSH Desktop.app`
 * on macOS (a directory tree on Windows/Linux). The bundle carries only the
 * Electron main-process build — the shell has no runtime dependencies — plus
 * one extra resource recording the repository checkout this app hosts, which
 * the main process reads at launch (`resolveRepoRoot`). Re-run after moving
 * the checkout, or point `DSH_REPO_ROOT` at the new location.
 *
 * Run: `pnpm --filter @deepseek-ai/dsh-desktop run pack` (build included).
 * @module @deepseek-ai/dsh-desktop/pack
 */

import { createRequire } from 'node:module'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { packager } from '@electron/packager'

/** Repository root: this script sits three directories under it. */
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))

/** Application display name (the DSH abbreviation per the brand guidelines). */
const APP_NAME = 'DSH Desktop'
/** Reverse-DNS bundle identifier. */
const APP_BUNDLE_ID = 'com.deepseek-ai.dsh-desktop'
/** Executable name inside the bundle; spaces would leak into ps listings. */
const EXECUTABLE_NAME = 'dsh-desktop'

/**
 * Everything under apps/desktop the bundle must NOT carry: sources, tests,
 * build scaffolding, local artifacts, and every node_modules tree (the main
 * process imports only `electron` and Node builtins; Electron's own copy
 * ships as the bundle runtime). The brand icon rides through the `icon`
 * option, so build/ stays out of the payload too.
 */
const IGNORE_DIRS = /^\/(?:node_modules|src|tests|scripts|build|dist|lib\/types)(?:\/|$)/
const IGNORE_FILES = /^\/(?:tsdown\.config\.ts|tsconfig\.json|tsconfig\.tsbuildinfo|electron-builder\.yml|README\..*)$/

/** The exact Electron version this checkout pins, read from the installed package. */
function electronVersion(): string {
  const require = createRequire(import.meta.url)
  const manifest = JSON.parse(readFileSync(require.resolve('electron/package.json'), 'utf8')) as { version?: unknown }
  if (typeof manifest.version !== 'string') throw new Error('pack: electron package carries no version')
  return manifest.version
}

/** Write the repo-root marker into a temp file packager copies beside the bundle. */
function repoRootMarker(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-desktop-pack-'))
  writeFileSync(join(dir, 'repo-root'), `${repoRoot}\n`)
  return join(dir, 'repo-root')
}

const marker = repoRootMarker()
try {
  const appPaths = await packager({
    dir: '.',
    name: APP_NAME,
    executableName: EXECUTABLE_NAME,
    appBundleId: APP_BUNDLE_ID,
    platform: process.platform,
    arch: process.arch,
    out: 'dist',
    overwrite: true,
    ignore: (path: string) => IGNORE_DIRS.test(path) || IGNORE_FILES.test(path),
    extraResource: [marker],
    // Same brand icon as the dist build, extension-less so packager appends
    // the platform suffix (.icns on darwin, .png elsewhere).
    icon: 'build/icon',
    electronVersion: electronVersion(),
  })
  for (const path of appPaths) console.log(`pack: ${path}`)
} finally {
  rmSync(marker, { force: true })
}
