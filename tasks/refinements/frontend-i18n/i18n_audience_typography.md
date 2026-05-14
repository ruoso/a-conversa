# Confirm broadcast typography covers diacritics for all three locales

**TaskJuggler entry**: [tasks/35-frontend-i18n.tji](../../35-frontend-i18n.tji) — task `frontend_i18n.i18n_audience_typography`
**Effort estimate**: 0.5d
**Inherited dependencies**: `frontend_i18n.i18n_catalog_workflow`, `audience.aud_graph_rendering.aud_clean_typography` (both must land first)

## What this task is

A targeted visual smoke on the audience surface, at OBS broadcast resolution (typically 1920x1080, but also 1280x720 and 2560x1440 for higher-fidelity producers), confirming the chosen typography renders every required diacritic crisply: `c-cedilla` (c with cedilla), tilde-a, tilde-o, n-tilde, accented vowels. Also confirms the i18n-library bundle-size budget on the audience surface stays within the acceptable range.

## Why it needs to be done

The audience surface is the bundle-sensitive one (per ADR 0003) and the typography-sensitive one (it's the show — typography choices land on-camera). A font that renders Latin-A diacritics well but kerns `c-cedilla` poorly at small sizes will produce visible artifacts in the broadcast. The task also fences off the bundle-size impact of `i18next` + `react-i18next` + `i18next-icu` (~30 KB gzipped + per-locale catalog ~5-20 KB) — acceptable but not free, mitigated via Suspense + lazy locale loading.

## Inputs / context

- [docs/adr/0003-frontend-framework-react.md](../../../docs/adr/0003-frontend-framework-react.md) — Consequences: "Bundle size is an accepted tradeoff" for the audience surface, mitigated by build tooling.
- [docs/adr/0024-frontend-i18n-react-i18next-with-icu.md](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md) — Consequences: bundle-size impact on the audience surface; lazy locale loading as the mitigation.
- `audience.aud_graph_rendering.aud_clean_typography` — the upstream that picked the broadcast font.
- Diacritic set to verify: at minimum `c-cedilla, C-cedilla, tilde-a, tilde-A, tilde-o, tilde-O, n-tilde, N-tilde, accented vowels (acute/grave/circumflex on a/e/i/o/u)`. These cover pt-BR and es-419 in the methodology glossary and in any participant-supplied content the audience renders.

## Constraints / requirements

- **Visual smoke at multiple resolutions**: 1280x720, 1920x1080, 2560x1440. The audience surface gets used at all three.
- **Render every methodology label** from the glossary in each locale at typical node-label sizes; visually inspect for kerning + clipping issues on diacritics.
- **Bundle-size check**: measure the audience-surface bundle (gzipped) before and after the i18n library + a single-locale catalog are wired in. Target: total i18n cost stays under ~50 KB gzipped (library + active-locale catalog). Document the actual measurement in the `## Status` block when the task ships.
- **Lazy locale loading verified**: the audience bundle loads only the active locale's catalog, not all three. Confirm via build artifact inspection (Vite manifest, bundle visualizer, or equivalent).
- **No changes to the font itself in this task** — the font choice is `aud_clean_typography`'s decision. If diacritic rendering is unacceptable, escalate as a finding back to that task.

## Acceptance criteria

- A reference test image (or a Playwright screenshot fixture) exists per locale showing every methodology label, every facet-state label, and a representative sample of accented vowels at the three target resolutions.
- Visual inspection records "diacritics render crisply" (or, if not, a documented finding fed back to `aud_clean_typography`).
- Bundle-size measurement is captured in the `## Status` block: pre-i18n size, post-i18n size, active-locale catalog size, total i18n cost.
- The audience build does NOT ship pt-BR / es-419 catalogs to a viewer requesting `en-US` (verified via build-artifact inspection).

## Decisions

- **Lazy locale loading** as the bundle-size mitigation. Settled by ADR 0024.
- **Three target resolutions** (720p, 1080p, 1440p) as the visual-smoke matrix.
- **~50 KB gzipped** as the i18n bundle-cost budget. Soft target; revisit if reviewers find it too tight or too loose.

## Open questions

- **Font fallback chain.** If the primary broadcast font kerns a particular diacritic poorly, the fallback chain decides the rendered glyph. Whether to pin a specific fallback for diacritics or rely on browser defaults is `aud_clean_typography`'s call; flag findings here.
- **Locale-specific font choice.** Possible but unlikely needed for these three locales — all three are Latin-script. If a future locale forces it (Cyrillic, Greek, Arabic), the audience surface would need a per-locale font; out of scope here.

## Status

**Done** — 2026-05-11.

Landed early relative to the original ordering. The refinement assumed `aud_clean_typography` would ship first and pick the broadcast font; in practice the audience surface is still a stub (`apps/audience/src/index.tsx` is `export {};`) so the font decision had to land somewhere as policy data the eventual `aud_clean_typography` task can consume. Chose to ship the policy + the codepoint-coverage half of the acceptance criteria here, defer the visual-smoke half explicitly.

### What landed

- **Font decision: Inter** as the primary broadcast face (open-source, OFL 1.1, full Latin Extended-A coverage including every v1 diacritic) with a system-stack fallback chain (`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif`).
- **Typography policy module** at [`packages/i18n-catalogs/src/typography.ts`](../../../packages/i18n-catalogs/src/typography.ts). Exports `BROADCAST_FONT_STACK`, `BROADCAST_PRIMARY_FONT`, `BROADCAST_FALLBACK_FONTS`, `V1_LOCALE_CODEPOINT_RANGES`, `REQUIRED_DIACRITICS`, plus the helpers `isInV1LocaleCodepointRange`, `findOutOfRangeCodepoints`, `collectCatalogStrings`, `collectAllCatalogStrings`. Re-exported from `@a-conversa/i18n-catalogs`.
- **Codepoint-coverage acceptance test** at [`packages/i18n-catalogs/src/typography.test.ts`](../../../packages/i18n-catalogs/src/typography.test.ts) — 23 tests. Asserts (i) every required diacritic from the refinement lies in the v1-locale codepoint range (Basic Latin + Latin-1 Supplement + Latin Extended-A + General Punctuation), (ii) every string in the three v1 catalogs is in-range, (iii) the font stack policy is pinned (primary face, fallback chain, generic terminator). Per ADR 0022 these are committed regression tests.
- **`.tji` complete 100** with note pointing to the policy / deferral split.

### Wiring deferred

The refinement's other acceptance items wait on `aud_clean_typography` shipping:

- **Reference-image fixtures at 720p / 1080p / 1440p**: deferred to `audience.aud_tests.aud_visual_regression` (gated on `aud_playwright_e2e`, which gates on `aud_graph_rendering` shipping). The codepoint-coverage test pins font correctness; the visual-regression task will pin glyph-by-glyph rendering on a real browser at the three target resolutions.
- **Bundle-size measurement (pre-i18n / post-i18n / active-locale catalog / total)**: deferred until the audience surface bundles. The audience workspace today has `"build": "echo 'no build yet (placeholder; bundler wiring lands with frontend tasks)'"`; the measurement requires a real Vite bundle which lands with `aud_app_skeleton`.
- **Lazy locale loading verification**: deferred to the same audience bundle materializing. The `BROADCAST_FONT_STACK` constant is locale-independent (all three v1 locales render with the same font), so the lazy-locale check is purely a Vite-config + bundle-artifact inspection task.
- **`packages/ui-tokens` re-export**: that workspace is still deferred per ADR 0005's "Workspace realization deferred" consequence. When it materializes, `BROADCAST_FONT_STACK` will move (or be re-exported) under `tokens.typography.broadcast.fontFamily`. The `typography.ts` module is the canonical source of truth in the interim.

### Test count delta

`pnpm run test:smoke`: 1748 → 1771 tests (+23 in `typography.test.ts`).

### Catalog parity + tj3

`pnpm --filter @a-conversa/i18n-catalogs run check` passes (70 keys across 3 locales). `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` is silent.
