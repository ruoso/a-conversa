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
- `apps/audience/src/index.css:18-36` — line 19 is the `@import` to replace; lines 32–36 are the `@theme` block (`--font-broadcast`) that must remain unchanged. The header comment at lines 4–8 cites `aud_clean_typography` Decision §2's Google Fonts choice; that comment should be amended to point at this refinement's `## Status` block once landed.
- `apps/audience/vite.config.ts:30-61` — library-mode build; `cssCodeSplit: false` (single CSS sidecar); `assetFileNames` rewrites `style.css` → `audience-[hash].css` and other emitted assets to `assets/[name]-[hash][extname]`. The `@font-face` rules will appear in the emitted `audience-*.css`. No `publicDir` override and no `build.copyPublicDir: false` — Vite's default copies `apps/audience/public/**` to `apps/audience/dist/**` even in library mode.
- `apps/server/src/routes/static-frontends.ts:620-635` — registers `@fastify/static` for each surface with `root: surface.entry.distDir`, `prefix: '/_surfaces/audience/'`, `maxAge: '1y'`, `immutable: true`. Anything in `apps/audience/dist/` is served at `/_surfaces/audience/...` and aggressively cached forever; replacement requires a filename change to bust client caches.
- `packages/i18n-catalogs/src/typography.ts` — `V1_LOCALE_CODEPOINT_RANGES` and `BROADCAST_FONT_STACK` define the required codepoint envelope (Basic Latin + Latin-1 Supplement + Latin Extended-A + General Punctuation); the latin + latin-ext woff2 subsets together cover this envelope.
- Existing Vitest typography assertions (`aud_clean_typography` suite under `apps/audience/src/**/__tests__/`) pin `STYLESHEET` values — `BROADCAST_FONT_STACK` includes Inter as the first family. Those tests continue to pass unchanged; they assert the stack, not whether Inter actually renders.

## Constraints / requirements

- Download `inter-latin.woff2` and `inter-latin-ext.woff2` from Google Fonts (the exact woff2 URLs the bundle-measurement Status block enumerated — see Decision §5) and commit them under `apps/audience/public/fonts/`. Record the source URLs and SHA-256 of each committed binary in this refinement's `## Status` block so a future re-measurement or upgrade has a fixed reference point.
- Replace `apps/audience/src/index.css:19` (the `@import url('https://fonts.googleapis.com/...')` line) with two `@font-face` blocks — one per subset (latin, latin-ext) — each declaring a variable-font weight axis (`font-weight: 400 700`), `font-style: normal`, `font-display: swap`, the appropriate `unicode-range`, and `src: url('../fonts/inter-latin.woff2') format('woff2')` (relative path — see Decision §2). The exact `unicode-range` values come from Google Fonts' served CSS for Inter and must be transcribed verbatim so the browser's subset-selection mirrors what `aud_typography_bundle_measurement` projected.
- Use a **relative** `url('../fonts/...')` form in each `src` declaration. Absolute `url('/fonts/...')` resolves against the page origin (the root host's URL space), which has no `/fonts/` directory — see Decision §2.
- Preserve `font-display: swap` on every `@font-face` rule. This mirrors what Google Fonts' served CSS sets and is what `aud_clean_typography` Decision §2 cited as the runtime-resilience rationale: the fallback chain renders immediately while Inter loads, instead of flashing blank text (FOIT).
- Update the header comment at `apps/audience/src/index.css:4-8` so the citation reflects the new self-hosted mechanism (point at this refinement; keep the existing reference to `aud_clean_typography` Decision §1 for the `BROADCAST_FONT_STACK` consumption).
- After the change, confirm `grep -c 'fonts.googleapis.com'` on the built `audience-*.js` and `audience-*.css` returns 0 (was 0 before — the import was dropped; remains 0 because the import is now gone entirely).
- Confirm `grep -c 'inter-latin'` on the built `audience-*.css` is > 0 (the `@font-face` rules' `url(...)` references survived the build).
- Confirm `apps/audience/dist/fonts/inter-latin.woff2` and `apps/audience/dist/fonts/inter-latin-ext.woff2` exist after a fresh `pnpm -F @a-conversa/audience build` (Vite's default `copyPublicDir` copies the `public/` tree to `dist/`). If they don't, the implementer must set `build.copyPublicDir: true` explicitly in `apps/audience/vite.config.ts` and re-build — this is the canonical fix, not a workaround.
- No changes to `BROADCAST_FONT_STACK`, `BROADCAST_FONT_SIZE_PX`, `BROADCAST_FONT_WEIGHT`, or to any Vitest/Cucumber/Playwright test files. The existing `aud_clean_typography` Vitest cases (which assert `STYLESHEET` values and the `BROADCAST_FONT_STACK` string) must remain green without modification — they pin the stack token, not the font-loading mechanism, and the token is unchanged.

## Acceptance criteria

- `apps/audience/public/fonts/inter-latin.woff2` (~47.1 KiB, 48,256 B per the measurement) and `apps/audience/public/fonts/inter-latin-ext.woff2` (~83.1 KiB, 85,068 B) committed; total ~133 KiB woff2 binary asset cost.
- `apps/audience/src/index.css:19` (the Google Fonts `@import` line) replaced by two `@font-face` blocks (one per subset) with `font-weight: 400 700`, `font-display: swap`, the verbatim `unicode-range` Google Fonts serves, and `src: url('../fonts/inter-<subset>.woff2') format('woff2')`. The `@import 'tailwindcss';` on line 18 and the `@theme` block at lines 32–36 are unchanged.
- Header comment at `apps/audience/src/index.css:4-8` amended to cite this refinement's mechanism alongside (not replacing) the existing `aud_clean_typography` Decision §1 reference for `BROADCAST_FONT_STACK`.
- Fresh `pnpm -F @a-conversa/audience build` produces:
  - `apps/audience/dist/audience-*.css` referencing `inter-latin` (grep > 0) and containing no `fonts.googleapis.com` reference (grep == 0).
  - `apps/audience/dist/fonts/inter-latin.woff2` and `apps/audience/dist/fonts/inter-latin-ext.woff2` (copied by Vite's `copyPublicDir`).
- This refinement's `## Status` block records: source URLs of the two woff2 files (Google Fonts CDN URLs the measurement captured), SHA-256 of each committed binary, fresh-build artifact sizes (audience JS+CSS raw + gzipped, before vs after — should be unchanged save for ~400–500 B of replaced CSS), and the date the change landed.
- Existing Vitest typography cases (the `aud_clean_typography` suite) remain green without modification — `BROADCAST_FONT_STACK` value is unchanged, and the tests pin the stack string not the font-loading mechanism.
- `pnpm run check` and `pnpm run test:smoke` pass per the global pre-commit gate.
- Per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md), no throwaway smoke scripts — the verification is the committed `grep` constraints captured in the Status block on completion. The regression artifact (the `@font-face` rules referencing the committed woff2 files) is in the repo permanently.
- **Playwright spec deferred** *because the surface is not yet reachable*. The audience surface is currently unreached by any production route; `aud_clean_typography` (the parent typography decision) likewise deferred its e2e to a future audience-wiring task. Until the audience renders in a real route, the build-artifact grep checks above plus the existing Vitest typography assertions are the right pin (per Decision §6). The named-future-task that picks up the deferred e2e debt is `aud_pw_typography_smoke` (~0.5d) — a Playwright spec asserting that, once the audience surface is reachable, `document.fonts.check('1em Inter')` returns true after `document.fonts.ready` resolves on the audience route. The closer registers this in `tasks/50-audience-and-broadcast.tji` only when the audience surface acquires a reachable route (no such route in the current WBS; trigger fires when `aud_obs_setup_docs` or a moderator-side audience-preview task adds one).
- No Cucumber scenario required. This task does not change wire behavior, broadcast shape, or projector output observable at the system seam — it changes only the bytes the browser fetches for typography.

## Decisions

### §1 — Self-host via `apps/audience/public/fonts/` (parent-decision-aligned), not via Vite's asset-pipeline (`src/assets/fonts/`)

The two woff2 files have to live somewhere in the audience-surface source tree. Two viable layouts:

- **(A — chosen)** `apps/audience/public/fonts/inter-latin.woff2` and `inter-latin-ext.woff2`. Vite's default `copyPublicDir: true` copies the tree wholesale to `apps/audience/dist/fonts/`. The served path is `/_surfaces/audience/fonts/inter-latin.woff2`. Filenames are stable across builds (no content-hash injection in the public-dir path). Cost: a future Inter version upgrade must either rename the file (e.g., `inter-latin-v21.woff2`) or accept that clients holding the immutable 1y cache will see the old bytes until their cache evicts naturally. Matches the language of `aud_typography_bundle_measurement` Decision §3(B) (which named `apps/audience/public/fonts/` as the projected layout) and of the `.tji` note that scheduled this task.
- **(B)** `apps/audience/src/assets/fonts/inter-latin.woff2`, referenced from `src/index.css` via `url('./assets/fonts/inter-latin.woff2')`. Vite's CSS-asset pipeline hashes the emitted woff2 (`audience/dist/assets/inter-latin-<hash>.woff2`) and rewrites the URL in the emitted CSS. Cache-busting is automatic on content change. Rejected — overturns the parent decision's named path without strong justification at this task's scope; Inter v20 is a stable upstream release and the manual-rename cost on an eventual upgrade is small (a future `aud_inter_v21_upgrade`-shaped task would handle the renaming as part of its own scope). The cache-busting argument for (B) presumes a stream of font upgrades that doesn't match the project's typography pin (one face, one upstream version per multi-quarter cadence).
- **(C)** Inline as base64 data URLs inside `index.css`. Rejected — would bloat the CSS bundle by ~133 KiB raw (~the woff2 sum) and defeat browser caching of the font asset across page loads.

The `static-frontends` plugin's `maxAge: '1y' / immutable: true` cache headers (`apps/server/src/routes/static-frontends.ts:629-631`) apply to anything served under the `/_surfaces/audience/` prefix, including `fonts/`. Under (A), bursting that cache on Inter upgrade is a deliberate rename; under (B), it would be automatic but at the cost of overturning the parent path.

### §2 — Relative `url('../fonts/...')` in the `@font-face` `src`, not absolute `url('/fonts/...')`

The audience CSS is emitted to `apps/audience/dist/audience-<hash>.css` (per `vite.config.ts` `assetFileNames` rule for `style.css`) and served at `/_surfaces/audience/audience-<hash>.css`. The woff2 files (per §1) live at `apps/audience/dist/fonts/inter-<subset>.woff2`, served at `/_surfaces/audience/fonts/inter-<subset>.woff2`.

- **(A — chosen)** `src: url('../fonts/inter-latin.woff2') format('woff2')`. The browser resolves the relative URL against the served CSS location: `/_surfaces/audience/audience-<hash>.css` + `../fonts/inter-latin.woff2` = `/_surfaces/audience/fonts/inter-latin.woff2`. Correct.
- **(B)** `src: url('/fonts/inter-latin.woff2') format('woff2')`. The browser resolves the leading `/` against the page origin (the root host at `http://host:3000/`), giving `http://host:3000/fonts/inter-latin.woff2` — which has no static-route serving it (the root host's `dist/` has no `fonts/` directory). Rejected — would 404 in production. The error would be silent: the browser logs a console warning, the `@font-face` declaration drops the failed source, and the fallback chain renders. This is exactly the failure mode that motivated the parent task to ship self-hosting in the first place; (A) is the only correct choice.
- **(C)** `src: url('https://host.example.com/fonts/inter-latin.woff2') format('woff2')`. Rejected — hard-coding a host name into the bundled CSS defeats the micro-frontend pattern (ADR 0026) where surfaces are origin-agnostic and the bundle is reused across deployments.

The relative form survives Vite's CSS processing without modification (Vite only rewrites relative URLs whose target lives inside the build graph; `../fonts/...` targets a sibling of the emitted CSS, not a Vite-tracked asset, and is emitted verbatim).

### §3 — Single variable-font `@font-face` block per subset (`font-weight: 400 700`), not four per-weight blocks per subset

The Inter v20 woff2 files Google Fonts now serves are variable-font format with the `wght` axis covering 100–900 from a single file (this is the surprise finding the bundle measurement surfaced). Two ways to declare them:

- **(A — chosen)** Two `@font-face` blocks total (one per subset), each declaring `font-weight: 400 700` (the range the audience surface actually uses — `BROADCAST_FONT_WEIGHT` is 400, with up to 700 used incidentally for emphasis). Compact (~10 lines of CSS replacing the dropped `@import`), accurately describes what the woff2 file contains, and lets the browser interpolate any weight in the range. The range matches what `aud_clean_typography` settled (weights 400/500/600/700 referenced in the Google Fonts URL).
- **(B)** Eight `@font-face` blocks (4 weights × 2 subsets), each declaring `font-weight: 400` (or 500/600/700) and pointing at the same per-subset woff2 file. Rejected — redundant (each block points at the same variable-font file); 4× more CSS to maintain; identical runtime behavior to (A) because the woff2 IS a variable font. The form mirrors what Google Fonts' served CSS does, but Google's CSS is machine-generated for compatibility with older browsers that may not handle variable-font weight ranges; the audience surface targets modern browsers only (OBS browser source + recent Chromium / Firefox), so the variable-font shorthand is safe.
- **(C)** `font-weight: 100 900` (the full axis the woff2 contains) per subset. Rejected — overstates what the audience surface uses; the narrower `400 700` range is more honest about the rendered envelope and gives the browser a tighter hint about what to load.

### §4 — `font-display: swap` preserved verbatim from the parent decision

The dropped Google Fonts `@import` URL had `&display=swap` baked into the query string, which made every emitted `@font-face` block include `font-display: swap`. The replacement `@font-face` rules must carry the same directive:

- **(A — chosen)** `font-display: swap` on both blocks. The fallback chain (`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, ...`) renders immediately on first paint while Inter loads from the same origin; once Inter is available the browser re-rasterizes glyphs. `aud_clean_typography` Decision §2 named this exact resilience pattern as the runtime justification for choosing Google Fonts over a no-network-fetch alternative; self-hosting inherits the same need (the fonts still load asynchronously, just from the audience origin instead of `fonts.googleapis.com`).
- **(B)** `font-display: block` (FOIT — flash of invisible text). Rejected — would briefly hide all rendered text on the audience surface, which is exactly the broadcast-quality issue `aud_clean_typography` Decision §2 was avoiding.
- **(C)** No `font-display` directive (browser default, currently `auto` ≈ `block` in most browsers). Rejected for the same reason as (B).

### §5 — Source the woff2 binaries from Google Fonts CDN (the exact URLs the measurement captured)

The measurement Status block enumerated two specific woff2 URLs from `fonts.googleapis.com`'s CSS response (the latin and latin-ext subsets, 48,256 B and 85,068 B respectively). Three viable sources for the committed binaries:

- **(A — chosen)** Download the exact two URLs the measurement captured (`https://fonts.gstatic.com/s/inter/v20/...` for latin and latin-ext) and commit those bytes verbatim. The total committed-asset cost matches the measurement's projection (133,324 B) exactly. The committed Status block records the source URL and SHA-256 of each binary so a future maintainer can re-verify provenance. Google Fonts' subsetting is well-tested (millions of sites consume these same files) and the subset boundaries match what `V1_LOCALE_CODEPOINT_RANGES` requires.
- **(B)** Download Inter from the upstream `rsms/inter` GitHub releases. Rejected — upstream Inter ships a single full-Unicode variable woff2 (~300+ KiB) covering every supported codepoint range; using it would mean shipping ~2× the bytes for codepoints the audience never renders (cyrillic, greek, vietnamese — out of `V1_LOCALE_CODEPOINT_RANGES`). The audit-trail value of upstream provenance is real but is mitigated by recording the Google Fonts source URL + SHA-256 in this refinement's Status block.
- **(C)** Download upstream Inter and subset it locally with `fonttools pyftsubset`. Rejected — adds a new tooling dependency (Python + fonttools), requires an ADR-level decision about whether subsetting is committed to the source tree or run at build time, and risks the locally-subsetted file diverging from what `aud_typography_bundle_measurement` projected. For a 0.5d task, (A) is right-sized.

The Status block must record the source URLs and SHA-256s; this is the audit trail that substitutes for upstream provenance.

### §6 — Build-artifact grep + existing Vitest pins; no new test infrastructure

The change is observable at three layers: (i) two woff2 files exist under `apps/audience/public/fonts/`; (ii) the `index.css` source contains `@font-face` blocks instead of the `@import`; (iii) the built `audience-*.css` contains `inter-latin` references and no `fonts.googleapis.com`. Layer (iii) is the only layer that proves the fix held through the build pipeline — and proving that is the entire reason this task exists (the Google Fonts `@import` survived layers (i) and (ii) and only failed at (iii)).

- **(A — chosen)** Verify via `grep` on the build artifact, captured in this refinement's Status block on completion. Plus: the existing Vitest typography cases (`aud_clean_typography` suite) continue to pin `BROADCAST_FONT_STACK` — no test changes. Matches the pattern `aud_typography_bundle_measurement` established (verification recorded in a Status block as a historical record).
- **(B)** Add a new Vitest case that asserts the built `audience-*.css` exists, reads its contents, and asserts the `@font-face` reference is present. Rejected — would require pointing a Vitest spec at `apps/audience/dist/`, which only exists after a build; the test would either run in a stale state (read a build from a prior CI run) or require orchestrating a build inside the Vitest run (slow, brittle). The grep-on-build-artifact is what `aud_typography_bundle_measurement` already used as its closing check.
- **(C)** Add a Playwright spec that loads the audience surface in a real browser and asserts `document.fonts.check('1em Inter')` returns true. Rejected for this task per the deferred-e2e exception — the audience surface is not yet reachable in any route. The named-future-task `aud_pw_typography_smoke` (registered in Acceptance criteria) picks this up when the surface acquires a real route.

The build-artifact grep is run by the implementer at task close; the captured numbers go into Status. No CI gate is added (a recurring CI grep would be `aud_bundle_size_budget`'s scope per `aud_typography_bundle_measurement` Decision §2).

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-30 (re-opened and completed; supersedes the 2026-05-27 blocked close below).

- Implemented per Decisions §1, §2, §5(A). The two Inter v20 woff2 subsets were downloaded (operator-approved network fetch) and committed under `apps/audience/public/fonts/`, alongside the SIL Open Font License text required by OFL-1.1 redistribution terms:
  - `inter-latin.woff2` — 48,256 B — SHA-256 `3100e775e8616cd2611beecfa23a4263d7037586789b43f035236a2e6fbd4c62` — source `https://fonts.gstatic.com/s/inter/v20/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa1ZL7.woff2`.
  - `inter-latin-ext.woff2` — 85,068 B — SHA-256 `34b9c504cab7a73e37b746343a449132e56cf7b5481af2cb81dc74dcff25c956` — source `https://fonts.gstatic.com/s/inter/v20/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa25L7SUc.woff2`.
  - `OFL.txt` — 4,380 B — SIL Open Font License 1.1, verbatim from `rsms/inter` `LICENSE.txt` ("Copyright (c) 2016 The Inter Project Authors"). Total committed asset cost ~137 KiB.
- `apps/audience/src/index.css`: the Google Fonts `@import` (was line 19) is replaced by two `@font-face` blocks (one per subset), `font-weight: 400 700`, `font-display: swap`, `src: url('../fonts/inter-<subset>.woff2')`, with the `unicode-range` values transcribed verbatim from Google Fonts' served Inter CSS. The header comment (lines 4–8) is amended to cite this refinement. `@import 'tailwindcss';` and the `@theme` `--font-broadcast` block are unchanged.
- Build verification (fresh `pnpm -F @a-conversa/audience build`, per Decision §6 + Acceptance criteria):
  - Built `dist/assets/audience-*.css` references `inter-latin` (grep > 0) and contains zero `fonts.googleapis.com` refs (grep == 0).
  - `dist/fonts/inter-latin.woff2`, `dist/fonts/inter-latin-ext.woff2` (and `OFL.txt`) are present — Vite's default `copyPublicDir` copied them; no `build.copyPublicDir` override was needed.
  - The build log emits the expected `"../fonts/...woff2 ... didn't resolve at build time, it will remain unchanged to be resolved at runtime"` notice — confirming the literal relative URL survives the pipeline (the CSS lands at `dist/assets/`, so `../fonts/` resolves correctly against the served `/_surfaces/audience/assets/` stylesheet).
- Existing Vitest typography cases (`aud_clean_typography` suite) remain green without modification — they pin `BROADCAST_FONT_STACK`, not the font-loading mechanism.
- Note on the global gate: at completion time the repo working tree contained unrelated in-flight coherency work (`apps/participant/src/graph/projectGraph.ts` extending `ParticipantNodeData`) that left `pnpm run check` / `pnpm run test:smoke` red for reasons independent of this change; the `@a-conversa/audience` package build is green. The build+test gate must be re-run green (with that WIP finished) before the commit lands.
- Tech-debt `aud_pw_typography_smoke` (~0.5d, deferred Playwright spec) still not registered: the trigger condition (audience surface acquires a reachable route) remains unmet in the current WBS.

### Superseded — original blocked close (2026-05-27)

- Implementation blocked before any edit: the Inter v20 woff2 binaries required by Decision §5(A) could not be downloaded — the auto-mode classifier denied `curl` requests to `fonts.googleapis.com` / `fonts.gstatic.com`, and the operator dismissed the `AskUserQuestion` confirmation prompt. Decision §5(B)/(C) were already rejected in-refinement, so no in-scope alternative was available at that time. The task was marked `complete 100` while its acceptance criteria were unmet — a false completion corrected by the 2026-05-30 re-open above.
