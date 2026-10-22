/** Text and filled-action contrast measured from the shipped built-in theme sheets. */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../src/styles/design-platform.css', import.meta.url), 'utf8')

function palette(dark: boolean): Map<string, string> {
  const tokens = new Map<string, string>()
  for (const [, selector = '', body = ''] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!dark && selector.includes('[data-ds-dark-theme]')) continue
    for (const [, name = '', value = ''] of body.matchAll(/(--[\w-]+):\s*([^;]+);/g)) {
      tokens.set(name, value.trim())
    }
  }
  return tokens
}

function luminance(tokens: Map<string, string>, name: string): number {
  const value = tokens.get(name)
  if (value === undefined) throw new Error(`Missing theme token: ${name}`)
  const alias = /^var\((--[\w-]+)\)$/.exec(value)
  if (alias?.[1]) return luminance(tokens, alias[1])
  const rgb = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(value)
  if (rgb === null) throw new Error(`Expected an opaque sRGB color for ${name}: ${value}`)
  const [red = 0, green = 0, blue = 0] = rgb.slice(1).map((channel) => {
    const srgb = Number(channel) / 255
    return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4
  })
  return red * 0.2126 + green * 0.7152 + blue * 0.0722
}

function contrast(tokens: Map<string, string>, foreground: string, background: string): number {
  const first = luminance(tokens, foreground)
  const second = luminance(tokens, background)
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
}

describe.each([false, true])('built-in theme contrast (dark: %s)', (dark) => {
  const tokens = palette(dark)

  it('keeps primary, secondary, tertiary and caption text readable on opaque UI surfaces', () => {
    for (const label of ['primary', 'secondary', 'tertiary', 'caption']) {
      for (const surface of [
        '--dsw-alias-bg-base',
        '--dsw-alias-bg-layer-1',
        '--dsw-alias-bg-layer-2',
        '--dsw-alias-bg-layer-3',
        '--dsw-specific-sidebar-fill',
        '--dsw-specific-input-major',
      ]) {
        expect(contrast(tokens, `--dsw-alias-label-${label}`, surface), `${label} on ${surface}`)
          .toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it('keeps filled-action foreground readable at rest and during interaction', () => {
    for (const family of ['primary', 'info']) {
      for (const state of ['fill', 'hover']) {
        expect(contrast(tokens, '--dsw-alias-label-primary-foreground', `--dsw-alias-button-${family}-${state}`))
          .toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it('keeps keyboard focus distinguishable from adjacent UI surfaces', () => {
    for (const surface of ['--dsw-alias-bg-base', '--dsw-specific-sidebar-fill', '--dsw-specific-input-major']) {
      expect(contrast(tokens, '--dsw-alias-state-business-primary', surface))
        .toBeGreaterThanOrEqual(3)
    }
  })
})
