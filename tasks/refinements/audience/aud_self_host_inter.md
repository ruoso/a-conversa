# Self-host Inter woff2 under apps/audience/public/fonts/

**TaskJuggler entry**: [tasks/50-audience-and-broadcast.tji](../../50-audience-and-broadcast.tji) — task `audience.aud_obs_integration.aud_self_host_inter`
**Effort estimate**: 0.5d
**Inherited dependencies**:

- `audience.aud_graph_rendering.aud_clean_typography` (settled — shipped 2026-05-27). That leaf wired Inter into the audience surface via the runtime Google Fonts `@import` path at `apps/audience/src/index.css:19` and registered `--font-broadcast` as `BROADCAST_FONT_STACK` under Tailwind v4's `@theme` block. The present task replaces that `@import` with self-hosted `@font-face` rules so that Inter actually loads in the Vite library-mode build.

## What this task is

Replace the Google Fonts runtime `@import` at `apps/audience/src/index.css:19` with self-hosted `@font-face` rules pointing at woff2 binary assets committed under `apps/audience/public/fonts/`. The two variable-font files to commit are:

- `apps/audience/public/fonts/inter-latin.woff2` — covers Basic Latin + Latin-1 Supplement + General Punctuation (unicode-range as served by Google Fonts for the latin subset).
- `apps/audience/public/fonts/inter-latin-ext.woff2` — covers Latin Extended-A and related (unicode-range as served by Google Fonts for the latin-ext subset).

Both files are the Inter v20 variable-font woff2 (the `wght` axis covers 400–900; weights 400/500/600/700 are handled by a single file per subset). The `@font-face` rules replace the single dropped `@import url(...)` line; the `--font-broadcast` `@theme` block and `BROADCAST_FONT_STACK` remain unchanged.

## Why it needs to be done

`aud_typography_bundle_measurement` (2026-05-27) confirmed that the Google Fonts `@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap')` at `apps/audience/src/index.css:19` **does not survive the Tailwind v4 + Vite library-mode build**. The mechanism: `@import 'tailwindcss';` (line 18) is inlined by `@tailwindcss/vite` into emitted CSS layers, pushing the Google Fonts `@import url(...)` past the CSS-spec position requirement (`@import` must precede all other rules); PostCSS/Vite then drops the now-invalid import. Consequence: the audience surface ships without Inter and renders the system-font fallback chain, violating `aud_clean_typography` Decision §2.

`@font-face` rules are not subject to the CSS-spec `@import` position constraint and survive the build pipeline. Self-hosting also addresses the OBS-host availability concern from `aud_clean_typography` Why-block §3 (corporate firewalls / regional networks blocking `fonts.googleapis.com`) in the same step.

## Inputs / context

- `tasks/refinements/audience/aud_typography_bundle_measurement.md` — Status block records the full measurement: artifact sizes, grep confirmation of the dropped import, woff2 file sizes (latin 48,256 B, latin-ext 85,068 B, total 133,324 B), and the Decision §3(B) recommendation. Read that Status block as the primary Inputs for this task.
- `apps/audience/src/index.css` — line 19 is the `@import` to replace; lines 32–36 are the `@theme` block (`--font-broadcast`) that must remain unchanged.
- `apps/audience/vite.config.ts` — library-mode build; `cssCodeSplit: false` (single CSS sidecar). The `@font-face` rules will appear in the emitted `audience-*.css`.
- `packages/i18n-catalogs/src/typography.ts` — `V1_LOCALE_CODEPOINT_RANGES` and `BROADCAST_FONT_STACK` define the required codepoint envelope (Basic Latin + Latin-1 Supplement + Latin Extended-A + General Punctuation); the latin + latin-ext woff2 subsets together cover this envelope.

## Constraints / requirements

- Download `inter-latin.woff2` and `inter-latin-ext.woff2` from Google Fonts (or the upstream Inter project's own woff2 release) and commit them under `apps/audience/public/fonts/`.
- Replace `apps/audience/src/index.css:19` (the `@import url('https://fonts.googleapis.com/...')` line) with four `@font-face` rules — one per weight (400/500/600/700), each citing `src: url('/fonts/inter-latin.woff2') format('woff2')` with the appropriate `font-weight` and `unicode-range` for the latin subset, plus a matching set for latin-ext. (Because the Inter v20 woff2 files are variable-font covering the full `wght` axis, four rules each citing the same file is technically redundant; a single `@font-face` block with `font-weight: 100 900` per subset is the compact form — implementer's discretion.)
- After the change, confirm `grep -c 'fonts.googleapis.com'` on the built `audience-*.js` and `audience-*.css` is still 0 (was 0 before — the import was dropped; after this change it should remain 0 because we removed the import entirely).
- Confirm `grep -c 'inter-latin.woff2'` on the built `audience-*.css` is > 0 (the `@font-face` rules survived the build).
- No changes to `BROADCAST_FONT_STACK`, `BROADCAST_FONT_SIZE_PX`, `BROADCAST_FONT_WEIGHT`, or any Vitest/Cucumber/Playwright test files beyond what is needed to reflect the new font-loading mechanism.

## Acceptance criteria

- `apps/audience/public/fonts/inter-latin.woff2` and `inter-latin-ext.woff2` committed (total ~133 KiB).
- `apps/audience/src/index.css:19` (the Google Fonts `@import` line) replaced by `@font-face` rules covering weights 400/500/600/700 for latin and latin-ext subsets.
- Fresh `pnpm -F @a-conversa/audience build` produces a `audience-*.css` that references `inter-latin.woff2` (grep > 0) and contains no `fonts.googleapis.com` reference (grep == 0).
- Existing Vitest typography cases (`aud_clean_typography` suite) remain green — `BROADCAST_FONT_STACK` value is unchanged.
- `pnpm run check` and `pnpm run test:smoke` pass.

## Decisions

(to be filled during refinement)

## Open questions

- Should the `@font-face` rules use a single variable-font block per subset (`font-weight: 100 900`) or four discrete weight blocks? The variable-font form is more compact; the four-block form mirrors what Google Fonts serves and is more readable alongside legacy CSS.
- Should the woff2 files be downloaded from Google Fonts' CDN URLs (the exact files the measurement captured) or from the upstream Inter project's GitHub releases? The upstream source is auditable and version-pinned; Google Fonts is simpler but ties the committed binary to Google's CDN snapshot.

## Status

_pending implementation_
