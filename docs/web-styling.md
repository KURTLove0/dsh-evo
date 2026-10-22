# Web UI style reference

English | [中文](web-styling.zh.md)

This reference defines styling ownership and component rules for browser client packages. The current token values live in [`packages/client/ui-theme/src/styles/`](../packages/client/ui-theme/src/styles/); this document does not duplicate that generated-by-source inventory.

## Ownership

[`ui-theme`](../packages/client/ui-theme/README.md) owns the `--dsw-*` static scale, semantic aliases, typography, motion, gradients, shadows, scrollbar styles, and light/dark preference. [`ui-layout`](../packages/client/ui-layout/README.md) applies the resolved theme snapshot to the document. Feature packages consume semantic aliases and do not define another global theme.

Global style sheets belong in `ui-theme/src/styles/`. Component styles live beside their component as CSS Modules. A component may define a local custom property when its value is part of that component's layout or presentation contract; shared colors, typography, elevation, and motion belong to the theme package.

## Component rules

- Use CSS Modules and `clsx`; do not add a component library or Tailwind.
- Use `--dsw-alias-*` semantic tokens in feature components. Do not copy static palette values or write literal colors there.
- Keep theme selectors out of feature component CSS. Light/dark overrides belong to the theme owner.
- Pair font sizes with line heights and use the theme typography variables when an existing role matches.
- Keep source text, terminal output, and diff lines unwrapped when their component contract requires column preservation; use the shared scrollbar styles rather than component-specific scrollbar selectors.
- Put presentation in CSS. Inline React styles may pass component-local custom-property values but must not encode theme branches.
- Preserve keyboard focus visibility and reduced-motion behavior when adding transitions or hover-only controls.

## Changing the system

The interface draws on [Apple HIG accessibility guidance](https://developer.apple.com/design/human-interface-guidelines/accessibility) for readable hierarchy and visible interaction feedback. Conversation content uses a plain background; session selection has a distinct fill and font weight; agent cards separate names from descriptions through type size and spacing. Shared buttons expose keyboard focus and pressed feedback. For coarse pointers, shared buttons, composer attach/send/select controls, sidebar icon/new-session buttons, and agent navigation/filter buttons have a 44px minimum target; shared inputs and agent search fields have a 44px minimum height. Desktop controls retain compact geometry.

Add or change a shared token in the owning `ui-theme` sheet, then consume its semantic alias from feature packages. Update the owning package reference when a public styling contract changes. Visual behavior follows the [testing policy](testing.md); the [styling-system Agent Note](../.agents/notes/implemented/process/2026-07-19-web-styling-system.md) records framework rationale.

The cyber technology presentation uses cyan actions, compact panel corners, and monospace metadata. A stationary grid appears only on the empty-session canvas; active transcripts retain a plain background. Shared palette, focus-halo, brand-artwork tile, elevation, and radius tokens belong to `ui-theme`. The [cyber theme decision](../.agents/notes/implemented/feature/2026-10-20-cyber-workbench-theme.md) records the visual scope and verification.
