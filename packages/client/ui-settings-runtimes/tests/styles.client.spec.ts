/**
 * Runtimes section stylesheet contract, asserted against the CSS text on disk.
 * The sheet paints in both themes, and a `--dsw-*`/`--ds-*` name the theme
 * does not declare fails silently: the browser takes the `var()` fallback (or
 * inherits), so the sheet still renders and only the dark theme looks wrong.
 * Checking the names against the sheets that declare them turns that into a
 * test failure.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../src/client/RuntimesSection.module.css', import.meta.url)), 'utf8')
// The theme package maps `./styles/*` to `./src/styles/*`, so the declarations
// stay on the source plane rather than needing a build. Every theme sheet, not
// just the platform tokens: font and scrollbar variables are declared in
// siblings, and a gate reading one file would call their names undeclared.
const tokens = readdirSync(fileURLToPath(new URL('../../ui-theme/src/styles/', import.meta.url)))
  .filter(name => name.endsWith('.css'))
  .map(name => readFileSync(fileURLToPath(new URL(`../../ui-theme/src/styles/${name}`, import.meta.url)), 'utf8'))
  .join('\n')

/** The declarations of one top-level rule, by selector. */
function block(selector: string): string {
  const match = new RegExp(`^\\${selector} \\{([^}]*)\\}`, 'm').exec(css)
  if (match === null) throw new Error(`RuntimesSection.module.css has no \`${selector}\` rule`)
  return match[1] ?? ''
}

describe('RuntimesSection theme styles', () => {
  it('names only theme variables the token sheets define', () => {
    // Every theme-variable prefix the sheets actually use, not just `--dsw-`:
    // a `--ds-` font name reads as a plausible sibling and would otherwise
    // slip past this gate into a fallback or inherit.
    const named = [...css.matchAll(/var\((--(?:dsw|dsh|ds)-[a-z0-9-]+)/g)].map(match => match[1])
    const undeclared = [...new Set(named)].filter(name => !tokens.includes(`  ${String(name)}:`))
    expect(undeclared).toEqual([])
    expect(css).not.toMatch(/var\(--(?:surface|text-|border|accent-strong)/)
  })

  it('closes every block, so no rule is swallowed by the one above it', () => {
    // A missing `}` on an `@media` block is not a parse error: every rule after
    // it silently becomes conditional. Nothing downstream reports this — the
    // sheet loads and the classes still attach.
    const bare = css.replace(/\/\*[\s\S]*?\*\//g, '')
    expect((bare.match(/\}/g) ?? []).length).toBe((bare.match(/\{/g) ?? []).length)
  })

  it('keeps the runtime row outlined rather than filled', () => {
    // The model chips inside a row carry the module fill; filling the row too
    // would erase the chips' boundary against the panel background.
    expect(block('.rowCard')).toContain('border: 1px solid var(--dsw-alias-border-l2)')
    expect(block('.rowCard')).not.toMatch(/\bbackground\s*:/)
    expect(block('.modelChip')).toContain('background: var(--dsw-alias-bg-module-platform)')
  })

  it('never falls back to a literal colour', () => {
    // A token that resolves is never the problem; an undeclared one takes this
    // branch, and a literal here is a single colour for both themes.
    expect(css).not.toMatch(/var\(--dsw-[a-z0-9-]+\s*,\s*(?:#|rgb|rgba|hsl|hsla)/)
  })
})
