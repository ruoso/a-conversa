# Pick component-explorer tool (or skip)

**TaskJuggler entry**: [tasks/00-foundation.tji](../../00-foundation.tji) — task `foundation.stack_decisions.storybook_or_equivalent_decision`
**Effort estimate**: 0.5d
**Inherited dependencies**: `foundation.stack_decisions.frontend_framework_decision` (settled — React)

## What this task is

Decide whether to set up a component-explorer tool (Storybook or similar) for the four frontend workspaces, and if so, which one.

## Why it needs to be done

A component explorer accelerates UI iteration: you can render components in isolation with mocked props/state, see all variations side by side, and document them. Particularly useful for the moderator UI's complex state machines (per-facet states, vote indicators, diagnostic flags, etc.) and for visual regression. But it adds a workspace, a build step, and another tool to maintain.

## Inputs / context

Candidates:

- **Storybook** — the established standard. Massive feature set (a11y, viewport, interactions, screenshot tests via Chromatic). Heavyweight install and config.
- **Ladle** — much lighter, Vite-based, mostly Storybook-compatible story format. Great DX for the basics; smaller addon ecosystem.
- **Histoire** — similar to Ladle in spirit; Vue-first historically.
- **Skip it** — develop components by composing them in the running app and watching the result.

Project context:

- The four frontend surfaces have many distinct visual states (per-facet rendering, vote indicators, diagnostic flags, animation transitions, etc.). A component explorer would be valuable for designing these in isolation.
- Visual regression tests are already in the WBS (`mod_vr_*`, `part_vr_*`, `aud_visual_regression`). A component explorer would feed those naturally.
- Small team — Storybook's full feature set may be overkill.

## Constraints / requirements

- TypeScript / React-native.
- Compatible with the chosen styling approach (`style_tooling_decision`).
- Compatible with the chosen unit-test framework (so test stories can run as visual-regression specs).
- Reasonable build time.

## Acceptance criteria

- Decision made (use a tool / skip).
- If used: tool chosen and "hello story" runs.
- If skipped: rationale recorded so we revisit when components multiply.

## Decisions

- **Skip in v1** (R18). No component explorer installed; develop components in the running dev compose stack. The running app with a real seeded session is the most authentic preview.
- **Revisit when the moderator's per-facet state matrix gets unwieldy** in the running app. At that point, lean toward **Ladle** for low overhead — Vite-based, mostly Storybook-compatible story format, minimal install / config burden.

## Open questions

(none — all decided)

## Status

**Done** (2026-05-10). Recorded in [docs/adr/0009-skip-component-explorer-in-v1.md](../../../docs/adr/0009-skip-component-explorer-in-v1.md). No tooling was added: no Storybook / Ladle / Histoire install, no `package.json` changes, no story files, no scripts. Components are developed in the running dev compose stack with seeded sessions; revisit (leaning Ladle) when the moderator's per-facet state matrix becomes unwieldy in the running app.
