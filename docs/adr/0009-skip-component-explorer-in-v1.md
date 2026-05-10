# 0009 — Skip component-explorer tool in v1

- **Date**: 2026-05-10
- **Status**: Accepted

## Context

`a-conversa` ships four React frontends — moderator console, participant tablet, audience broadcast view, and replay viewer — and several of them carry non-trivial visual state: per-facet rendering modes, vote indicators, diagnostic flags, animated transitions, and OBS-style overlays. A component explorer (Storybook and friends) is the conventional way to design and document such states in isolation. The refinement at [tasks/refinements/foundation/storybook_or_equivalent_decision.md](../../tasks/refinements/foundation/storybook_or_equivalent_decision.md) records the constraints in full; the load-bearing one is whether the value of an isolated render harness justifies a fourth toolchain alongside Vitest, Cucumber, and Playwright on a small team.

The candidates surveyed were:

- **Storybook** — the established standard. Massive feature set (a11y, viewport, interactions, Chromatic visual regression, MDX docs, addon ecosystem). Heavyweight install and config; non-trivial maintenance surface; its own build pipeline that has to track the app's bundler and styling setup.
- **Ladle** — Vite-native; mostly Storybook-compatible story format (CSF); minimal install and config; fast startup; smaller addon ecosystem but covers the basics.
- **Histoire** — similar in spirit to Ladle; Vue-first historically, with React support that lags Ladle's.
- **Skip it for v1** — develop components by composing them in the running dev compose stack with seeded sessions and observe behavior in the actual app.

The deciding consideration is that the dev compose stack (owned by `foundation.dev_env.compose_file`) plus seeded sessions (`foundation.dev_env.seed_data_script`) already give us the most authentic preview surface available: real WebSocket traffic, real auth, real graph data, real styling tokens. A component explorer's value over that baseline is mostly the matrix-of-states view, which is genuinely useful but not yet earning its keep at v1's component count.

## Decision

**No component-explorer tool is installed in v1.** Components are developed and reviewed by composing them in the running dev compose stack with seeded sessions. No Storybook, Ladle, or Histoire workspace is added; no `package.json` entries, no story files, no separate build pipeline.

The decision is **revisited when the moderator console's per-facet state matrix becomes unwieldy in the running app** — concretely, when a reviewer can no longer easily reach all facet states (and their vote / diagnostic / transition variants) by driving the seeded session, or when the round-trip cost of seeding a state to inspect it starts dominating UI iteration time.

If and when that revisit fires, the lean is toward **Ladle**: Vite-based (matches the rest of the frontend toolchain), Storybook-compatible CSF story format (so stories aren't locked to Ladle if we later outgrow it), minimal install and config burden. Storybook would be reconsidered only if a specific addon (Chromatic-style hosted visual regression, the a11y addon's depth) turns out to justify the heavier footprint.

This ADR settles only the v1 tooling choice. Visual regression coverage — `mod_vr_*`, `part_vr_*`, `aud_visual_regression` in the WBS — runs through Playwright's screenshot-and-diff against the real running app, not through a story-driven harness. Those tasks are unaffected by this decision.

## Consequences

- **One fewer toolchain to install, configure, and maintain.** No Storybook/Ladle/Histoire dependency tree, no separate dev server, no story-format learning curve, no parallel styling/bundler config to keep in sync with the apps.
- **Component review happens in the real app.** Seeded sessions in the dev compose stack are the canonical preview surface; this matches how reviewers will see the app in practice and avoids the "works in Storybook, breaks in app" failure mode.
- **The per-facet state matrix is reachable only through the running app.** That is the explicit revisit trigger; if reaching all states becomes painful, the cost shows up as slow UI iteration and is the signal to install Ladle.
- **Visual-regression tests run against the real app, not isolated stories.** Playwright drives the dev stack and snapshots actual rendered surfaces; this is already how the `*_vr_*` and `aud_visual_regression` tasks are scoped.
- **Story format stays portable if we later add Ladle.** No code is being written against a Storybook-incompatible API today; if Ladle (or Storybook) lands later, components don't need to be retrofitted.
- **No stack-validation smoke test for this ADR.** There is nothing installed to verify; the decision is to *not* add tooling. The acceptance signal is the absence of a component-explorer dependency in `package.json` when later foundation tasks land.
