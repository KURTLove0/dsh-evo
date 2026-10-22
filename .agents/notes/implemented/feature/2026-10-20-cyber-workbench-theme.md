# Agent Note: Cyber workbench theme

Status: implemented

English | [中文](2026-10-20-cyber-workbench-theme.zh.md)

## Problem

A cyber technology interface needs consistent surfaces and interaction emphasis across independently loaded UI plugins. Component-local dark palettes would diverge during theme changes and plugin reloads.

## Decision

The theme plugin owns the ice-blue and navy static palettes, cyan semantic accents, focus halo, artwork tile, elevation, and shared radii. Existing theme preferences and plugin composition remain authoritative. Feature CSS uses these variables; it does not select a theme or fetch fonts.

The stationary grid belongs only to the empty-session canvas. Active transcripts use a plain surface so code, tool output, and long responses remain readable. Controls retain visible keyboard focus, coarse-pointer targets, and reduced-motion behavior. Dark application artwork uses a light tile rather than a theme-dependent image replacement.

The [styling-system note](../process/2026-07-19-web-styling-system.md) retains ownership of CSS Modules, token-only colors, and component isolation. This decision changes its Chat-aligned visual baseline for the application workbench; its engineering constraints remain active.

Module navigation has an independent bounded scroll region so optional entries do not consume the session browser in short windows. Keyboard focus reveals offscreen entries; session rows retain their own reserved scrollbar gutter.

## Consequences

Shared primitives and plugin pages change together through semantic aliases. Third-party theme overrides must verify the added visual tokens and their own contrast. The system preference continues to resolve from the operating system.

## Verification

Theme contrast tests measure text, filled actions, and focus colors. The assembled keyless browser scenario checks both schemes and narrow viewports, preserving a reproducible snapshot of the rendered palette and layout. GUI regressions cover the existing interactions.

## Alternatives considered

- Component-specific dark styles: duplicate palette ownership and can disagree with the resolved theme.
- Animated scan lines or flicker: add continuous distraction to reading and tool inspection.
- A dark-only application: removes the existing light and system preferences.
