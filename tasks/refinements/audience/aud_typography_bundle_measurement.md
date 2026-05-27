# Measure bundle-size impact of Inter (Google Fonts vs self-hosted woff2)

**TaskJuggler entry**: [tasks/50-audience-and-broadcast.tji](../../50-audience-and-broadcast.tji) — task `audience.aud_obs_integration.aud_typography_bundle_measurement`
**Effort estimate**: 0.25d
**Inherited dependencies**:

- `audience.aud_graph_rendering.aud_clean_typography` (settled — shipped 2026-05-27, `complete 100` at [`tasks/50-audience-and-broadcast.tji`](../../50-audience-and-broadcast.tji). That leaf wired Inter into the audience surface via the runtime Google Fonts `@import` path at [`apps/audience/src/index.css:19`](../../../apps/audience/src/index.css#L19) and registered `--font-broadcast` as `BROADCAST_FONT_STACK` under Tailwind v4's `@theme` block at [`apps/audience/src/index.css:32-36`](../../../apps/audience/src/index.css#L32). Decision §2 of that refinement explicitly named the bundle-size measurement as a follow-up so the runtime cost of Google Fonts can be quantified against a hypothetical self-hosted woff2 alternative.)
- Prose-only context (NOT a `.tji` edge): `frontend_i18n.i18n_audience_typography` shipped 2026-05-11 (refinement [`tasks/refinements/frontend-i18n/i18n_audience_typography.md`](../frontend-i18n/i18n_audience_typography.md)). Its Status block deferred three items; item (b) — pre-i18n / post-i18n / active-locale catalog / total bundle-size measurement — was re-deferred through `aud_clean_typography` to this leaf. Decision §3 of that refinement set the **~50 KB gzipped i18n cost budget** as a soft target; the same budget framing applies to the Inter delta examined here.
- Prose-only context (NOT a `.tji` edge): `audience.aud_graph_rendering.aud_app_skeleton` shipped earlier in May 2026 (refinement [`tasks/refinements/audience/aud_app_skeleton.md`](aud_app_skeleton.md)). Without a real Vite build the bundle measurement was not meaningful; that constraint is now satisfied — running `pnpm -F @a-conversa/audience build` produces real hashed `audience-*.js` / `audience-*.css` artifacts under [`apps/audience/dist/`](../../../apps/audience/dist/).

## What this task is

A one-shot measurement leaf — no source code changes — that quantifies the bundle-cost trade-off between the **current runtime path** (Google Fonts `@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap')` at [`apps/audience/src/index.css:19`](../../../apps/audience/src/index.css#L19); Inter is fetched from `fonts.googleapis.com` on first audience-surface load per browser cache) and a **hypothetical self-hosted path** (woff2 files committed under `apps/audience/public/fonts/`, served from the audience origin via `@font-face` rules).

The deliverable is a documented measurement that lands entirely in this refinement's `## Status` block — no Vitest case, no committed measurement script, no code change. The numbers inform two downstream consumers:

1. The acceptance question on `aud_clean_typography` Decision §2: *"is the current Google Fonts `@import` choice bundle-acceptable for the v1 broadcast?"* The Status block records the answer with the data behind it.
2. The cost half of a future `aud_self_host_inter` task. If production evidence (Sentry errors from `fonts.googleapis.com`, OBS-host complaints about latency or availability) ever surfaces, the implementer of that task starts with a quantified baseline — they do not have to re-measure.

In scope:

- **Build the audience surface** (`pnpm -F @a-conversa/audience build`) and record the raw + gzipped size of `audience-*.js` and `audience-*.css` under [`apps/audience/dist/`](../../../apps/audience/dist/). This is the build-artifact baseline; the Google Fonts `@import` URL adds a single CSS string (~85 bytes uncompressed) and triggers a runtime fetch, NOT a build-time fetch.
- **Estimate the woff2 delta** for a hypothetical self-hosted path. Google Fonts serves Inter as a subsetted set of woff2 files keyed on `unicode-range`; the audience surface uses Latin Basic + Latin-1 Supplement + Latin Extended-A + General Punctuation (per [`packages/i18n-catalogs/src/typography.ts:V1_LOCALE_CODEPOINT_RANGES`](../../../packages/i18n-catalogs/src/typography.ts)). Inspect the CSS that `fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap` returns (`curl` with a UA header so it returns woff2 URLs, not woff fallbacks) and record (i) which woff2 URLs the latin / latin-ext ranges resolve to, (ii) their `Content-Length` per weight. Sum the four weights' latin + latin-ext woff2 sizes — that is the self-host delta the audience artifact would commit.
- **Compare** the two paths against the ~50 KB gzipped soft budget inherited from `i18n_audience_typography` Decision §3, plus the at-runtime-vs-at-build cost framing (the woff2 fetch happens either way — only the origin and the cache-hit behaviour change).
- **Record the recommendation** in `## Status`: either (A) stay on Google Fonts (this leaf's expected outcome; the build artifact is unaffected, and the runtime fetch has `display=swap` resilience) or (B) flag that self-hosting is preferable enough to schedule `aud_self_host_inter` immediately.

Out of scope (deferred to existing or future leaves):

- **Actually self-hosting Inter.** Decision §2 of `aud_clean_typography` already named `aud_self_host_inter` (~0.5d) as the future task that commits woff2 binaries under `apps/audience/public/fonts/` and replaces the Google Fonts `@import` with `@font-face` rules. This leaf does NOT touch any code; it only produces the numbers that task would consume.
- **A committed bundle-size CI check.** Introducing `size-limit`, `rollup-plugin-visualizer`, or any other bundle-budget tool is a larger, separately-scoped decision (would warrant an ADR + a recurring CI gate). Per Decision §2 below, the one-shot recording satisfies the task; a future bundle-budget infrastructure task (named `aud_bundle_size_budget` in Decision §2) is registered for if/when a tighter regression pin is wanted.
- **Lazy-locale verification.** `i18n_audience_typography` Status block item (c) — confirming the audience bundle ships only the active locale's catalog — is bundle-adjacent but orthogonal: it's about the `i18next` resource-loading wiring, not about the typography font. That deferral travels through the frontend-i18n area, not through this leaf. If incidental evidence surfaces during the measurement (e.g., the `audience-*.js` build clearly bundles all three locale catalogs), record it as a finding pointing back to the i18n-area follow-up; do NOT expand scope to fix it here.
- **Visual-regression coverage.** Out of scope per the existing deferral chain — `aud_visual_regression` owns pixel-stability. This is a build-artifact measurement, not a rendered-output check.
- **A Playwright spec.** Inapplicable. This is not a UI-stream task; nothing observable to the audience viewer changes.

## Why it needs to be done

Three concrete reasons:

1. **`aud_clean_typography` Decision §2 named the open follow-up explicitly.** The decision chose Google Fonts `@import` *for the 1d budget* of that leaf but flagged that self-hosting may be the right answer for v1 broadcast if production evidence surfaces. Without quantifying the actual cost of each path, the next time a maintainer revisits the question they have to re-derive the numbers. This leaf retires that re-derivation cost permanently.
2. **`i18n_audience_typography` Status block (b) is still open.** That task shipped early (before the audience surface had a real bundle) and deferred bundle measurement until a Vite build existed. The Vite build now exists. Closing the deferred (b) keeps the i18n catalog work fully accounted for — the Status block of that refinement was structured precisely so a future closer could pick up the deferred items by reference.
3. **OBS broadcast hosts often run in network-restricted environments.** The audience surface's *reason to exist* (per `aud_clean_typography` Why-block) is broadcast-output to OBS. Production OBS hosts may sit behind corporate firewalls, regional networks blocking US-hosted CDNs, or simply on flaky internet. If the typography depends on a successful `fonts.googleapis.com` fetch and that fails, the fallback chain (`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, ...`) renders instead — visibly different. Quantifying the self-host alternative now means a future producer complaint can be acted on in ~0.5d instead of being a research-and-implement cycle.

Downstream concretely:

- The recommendation written into `## Status` is what `aud_self_host_inter`'s eventual refinement (if it gets scheduled) cites as its Why-block. The numbers measured here are its Inputs / context.
- Sibling tasks under `aud_obs_integration` (`aud_obs_sizing_defaults`, `aud_obs_transparency`, `aud_obs_no_input_required`, `aud_obs_setup_docs`) all share the OBS broadcast-host context. The "what's in the bundle the OBS host loads" question this leaf answers feeds the eventual `aud_obs_setup_docs` write-up: producers reading that doc want to know what their browser-source will fetch on first load.

## Inputs / context

### ADRs

- [ADR 0003 — Frontend framework: React](../../../docs/adr/0003-frontend-framework-react.md) — Consequences explicitly name the audience surface as bundle-sensitive ("Bundle size is an accepted tradeoff", mitigated by build tooling). This leaf produces the data that informs whether that tradeoff is being held in practice.
- [ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md) — Decision §2 below explains why a one-shot measurement landed only in the Status block is the right fit here (not a violation): the artifact this leaf produces is a *historical record of a decision*, not a regression check; the regression value would be in a `size-limit`-style CI gate, which is separately scoped as `aud_bundle_size_budget`.
- [ADR 0024 — Frontend i18n: react-i18next + ICU](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md) — Consequences name lazy locale loading as the mitigation for the i18n bundle delta. The ~50 KB gzipped soft budget the measurement compares the Inter cost against was set in `i18n_audience_typography` Decision §3, anchored on this ADR's Consequences.

### Sibling refinements

- [`tasks/refinements/audience/aud_clean_typography.md`](aud_clean_typography.md) — Decision §2 is the parent decision this leaf measures. Lines 155-163 enumerate the three alternatives (Google Fonts `@import`, self-hosted woff2, no font load at all) and pick Google Fonts for the 1d budget with the explicit deferral.
- [`tasks/refinements/frontend-i18n/i18n_audience_typography.md`](../frontend-i18n/i18n_audience_typography.md) — Status block enumerates the deferred items; line 66 is the bundle-measurement deferral pointer. Decision §3 (line 41) is the ~50 KB gzipped budget.
- [`tasks/refinements/audience/aud_app_skeleton.md`](aud_app_skeleton.md) — the leaf that made a real Vite bundle exist. Without that, the measurement could not run.

### Live state the measurement reads

- [`apps/audience/src/index.css:19`](../../../apps/audience/src/index.css#L19) — the live Google Fonts `@import` line whose runtime cost the measurement quantifies.
- [`apps/audience/src/index.css:32-36`](../../../apps/audience/src/index.css#L32) — the `@theme` block registering `--font-broadcast`. No measurement consequence; quoted only because the next sibling reading this refinement (or the future `aud_self_host_inter` implementer) wants the full token-registration locus in one place.
- [`apps/audience/vite.config.ts`](../../../apps/audience/vite.config.ts) — the library-mode build that produces the artifact under measurement. Notable: `cssCodeSplit: false` (single CSS sidecar) and `inlineDynamicImports: true` (single ESM bundle), so the measurement reads exactly two files.
- [`apps/audience/package.json`](../../../apps/audience/package.json) — `build: "tsc -b && vite build"`; no bundle-analysis dependency declared. The measurement uses plain `wc -c` and `gzip -kc`, no new tooling.
- [`packages/i18n-catalogs/src/typography.ts`](../../../packages/i18n-catalogs/src/typography.ts) — the policy module. `V1_LOCALE_CODEPOINT_RANGES` (Basic Latin + Latin-1 Supplement + Latin Extended-A + General Punctuation) is the codepoint envelope the latin / latin-ext woff2 subsets must cover; line 105 is `BROADCAST_FONT_STACK` itself.

### What the measurement MUST NOT do

- **No edit to any source file under `apps/`, `packages/`, `docs/`, or `scripts/`.** This leaf is observation-only. The closer adds `complete 100` to the matching `.tji` entry, but no other file changes.
- **No new dependency in any `package.json`** (no `size-limit`, no `rollup-plugin-visualizer`). If a future task wants those, that task takes the ADR-level decision; this leaf only reports plain `wc`/`gzip` numbers.
- **No new committed asset** under `apps/audience/public/fonts/`. The self-host scenario is *projected* from Google Fonts' served woff2 sizes, not realized. The actual woff2 commit is `aud_self_host_inter`'s job.
- **No `.tji` edit beyond the `complete 100` marker** on this task. In particular, do NOT register `aud_self_host_inter` in the WBS unless the measurement's findings argue for it (Decision §3 below; the default is *do not register today*).
- **No new test (Vitest, Cucumber, Playwright).** Per ADR 0022 and Decision §2 below, the deliverable is a recorded measurement; a regression-gating test would be `aud_bundle_size_budget`'s scope.

## Constraints / requirements

### Measurement procedure (must be reproducible)

1. **Audience build artifact size (current Google Fonts path).** Run `pnpm -F @a-conversa/audience build`. Locate the produced `apps/audience/dist/audience-*.js` and `apps/audience/dist/assets/audience-*.css` files. Record raw size (`wc -c`) and gzipped size (`gzip -kc <file> | wc -c`) for each. Both numbers are recorded in `## Status` so a future re-measurement (under `aud_self_host_inter` or under whatever bundle-budget task lands) has a fixed comparison point.
2. **Confirm the Google Fonts `@import` is the only Inter-loading artifact in the build.** Grep the produced CSS for the `fonts.googleapis.com` URL. Confirm no woff2 bytes are in the JS bundle (the `@import` mechanism keeps font assets out of the JS path entirely — this is the architectural reason Google Fonts produces ~0 build-artifact cost). Record the line count and the matched URL in `## Status`.
3. **Hypothetical self-host woff2 sizes.** Fetch the CSS Google Fonts serves: `curl -A 'Mozilla/5.0' 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap' > /tmp/inter-css.txt`. The response contains multiple `@font-face` blocks keyed on `unicode-range` (cyrillic, cyrillic-ext, greek, greek-ext, vietnamese, latin-ext, latin). For each of the four weights (400/500/600/700), record the woff2 URL of the **latin** and **latin-ext** subsets — those two subsets together cover Basic Latin + Latin-1 Supplement + Latin Extended-A, which is the audience surface's required envelope per `V1_LOCALE_CODEPOINT_RANGES`. `HEAD`-request each woff2 URL (`curl -sI <url> | grep -i content-length`) to get the woff2 file size. Sum the eight values (4 weights × 2 subsets) — that sum is the projected committed-asset cost if `aud_self_host_inter` ever lands.
4. **Compare to the soft budget.** Record (a) the audience JS+CSS gzipped baseline, (b) the runtime Google Fonts woff2 fetch cost (sum from step 3 — same bytes, fetched from a different origin), (c) the projected build-artifact cost increase if self-hosting were adopted (the sum from step 3, added to the served-from-origin assets but NOT to the gzipped JS/CSS). Frame against the ~50 KB gzipped i18n budget (`i18n_audience_typography` Decision §3) for context.
5. **Sanity-check the recorded values reconcile.** The audience JS/CSS gzipped numbers should match the current `apps/audience/dist/` output (per the baseline already in this refinement's Inputs context: ~125 KB gzipped JS + ~3.8 KB gzipped CSS as of 2026-05-27 — implementer must re-build and confirm). Each Inter weight's latin subset should be in the ~5-10 KB range; latin-ext in the ~10-15 KB range. Sums outside these envelopes by more than 2x get flagged as an anomaly worth investigating before recording.

### Files this task touches (explicit allowlist)

- `tasks/refinements/audience/aud_typography_bundle_measurement.md` (THIS FILE) — the closer appends the `## Status` block with the recorded measurement, recommendation, and date.
- `tasks/50-audience-and-broadcast.tji` — the closer appends `complete 100` immediately after the `allocate team` line of the `aud_typography_bundle_measurement` block at [line 263](../../50-audience-and-broadcast.tji#L263), per the [README ritual](../README.md).
- No other files.

### Files this task does NOT touch

- `apps/audience/**` — UNCHANGED. The build is run for measurement; no source-tree edits.
- `apps/audience/public/fonts/` — NOT CREATED. The self-host path stays hypothetical until `aud_self_host_inter`.
- `packages/i18n-catalogs/**` — UNCHANGED. Typography policy module is the canonical source; no change.
- `docs/adr/**` — UNCHANGED. Per Decision §1 below, no new ADR is required.
- `package.json` (anywhere) — UNCHANGED. No new tooling dependency.
- `scripts/**` — UNCHANGED. No committed measurement script (Decision §2 below).
- Any other refinement — UNCHANGED. In particular, do NOT extend `aud_clean_typography.md`'s Status block or `i18n_audience_typography.md`'s Status block; those are historical records of their own tasks. The cross-link is one-way: this leaf's Status block points back to them, not the other way around.

## Acceptance criteria

The check that says "done":

- This refinement's `## Status` block records the five numbers from the measurement procedure (current JS gzipped, current CSS gzipped, current Google Fonts `@import` URL presence, projected woff2 self-host sum, and the comparison against the ~50 KB i18n budget context).
- The Status block records an explicit recommendation: **either** (A) "keep the Google Fonts `@import` for v1 broadcast; revisit only if production evidence (Sentry errors from `fonts.googleapis.com`, OBS-host complaints) surfaces" — this is the expected outcome per Decision §3 below — **or** (B) "schedule `aud_self_host_inter` immediately because [specific finding]." If (B), the Status block names the trigger finding crisply.
- The Status block records the named-future-task posture for `aud_self_host_inter` (~0.5d): retained as an *un-registered, evidence-gated* follow-up under recommendation (A); promoted to a real WBS leaf with a `note "Refinement: tasks/refinements/audience/aud_self_host_inter.md (to be authored)"` and the closer scheduling its addition to `tasks/50-audience-and-broadcast.tji` under recommendation (B).
- The Status block records the named-future-task posture for `aud_bundle_size_budget` (~1d) — separately registrable if the team later decides recurring CI bundle-budget enforcement is wanted; this leaf does NOT register it today (Decision §2).
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent (pre-commit hook enforces this; the only WBS edit is `complete 100` on this task's entry).
- Per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md), no throwaway smoke scripts and no uncommitted ad-hoc check. Decision §2 below documents why a recorded-measurement deliverable is the right fit (not a violation) here: the regression artifact a CI gate would be is `aud_bundle_size_budget`'s scope, separately registered if wanted.
- No deferred-e2e debt incurred. This is not a UI-stream task (no component change, no observable rendering difference, no new route); the deferred-e2e policy does not apply.
- No Cucumber scenario required. This is not a backend / WS / projector / methodology-engine task; nothing crosses the protocol or replay boundary.

## Decisions

### §1 — One-shot recorded measurement in the Status block; no new ADR

The task's deliverable is two numbers (current bundle, projected self-host delta) and a recommendation. Three approaches to landing it:

- **(A — chosen)** Record numbers + recommendation in this refinement's `## Status` block. Cost: a few lines of prose. Benefit: the numbers live next to the question they answer (`aud_clean_typography` Decision §2's open follow-up), the recommendation lives next to the data behind it, and a future maintainer reading this refinement gets the full picture in one place. Matches the pattern `i18n_audience_typography` Status block established for *deferred-measurement-now-completed* outcomes.
- **(B)** Open a new ADR (`docs/adr/0040-broadcast-font-loading-strategy.md` or similar) recording the Google Fonts vs self-host trade-off with the numbers. Cost: a full ADR with alternatives and consequences. Benefit: discoverable from `docs/adr/`. Rejected — this is NOT an architectural decision; the architectural decision (use Google Fonts `@import`) was already settled by `aud_clean_typography` Decision §2. This task only *measures* whether that decision held empirically. ADRs record decisions among architectural alternatives, not the post-hoc validation of a previously-settled decision. If the measurement instead overturned the decision (recommended (B) — self-host now), an ADR would be warranted; the expected outcome per Decision §3 is recommendation (A), under which no ADR-level alternative is being weighed.
- **(C)** Commit a measurement output file (e.g., `apps/audience/docs/bundle-baseline.md` or `tasks/refinements/audience/aud_typography_bundle_measurement.data.md`). Cost: a new docs file in an inconsistent location. Benefit: machine-readable. Rejected — the numbers are read by humans, not by tools; the Status block of the owning refinement is the canonical location per the [README ritual](../README.md).

No new ADR is written. If the measurement *does* recommend (B), the implementer authoring `aud_self_host_inter`'s refinement writes that ADR (or escalates to one) as part of that task's scope.

### §2 — No committed measurement script; no bundle-budget tooling adopted

Three approaches to durability of the measurement:

- **(A — chosen)** Run the measurement once, by hand, against the current build; record the numbers; do NOT commit a script. Cost: a one-time set of commands documented in the measurement procedure above. Benefit: matches the 0.25d budget; nothing to maintain. ADR 0022's "no throwaway verifications" rule targets *cases where the empirical question recurs* — does the v1 catalog stay inside Latin Extended-A? does the agreed-state node still render in slate-700? Those are forever-CI questions. The question this leaf answers — *what does the current bundle weigh as of 2026-05-27, and what would self-hosting cost?* — is a snapshot question. The future bundle-budget concern (does the bundle stay under N KB on every CI run?) is a different question, separately scoped.
- **(B)** Commit `scripts/measure-audience-bundle.ts` that prints raw + gzipped sizes for the current dist. Cost: a new script, plus a decision about whether `make` invokes it, whether CI prints it on every run, where the historical record of the numbers is stored. Benefit: future re-measurements are one command. Rejected as out-of-scope for 0.25d — this is the kernel of the `aud_bundle_size_budget` task below, but it has multiple subsidiary decisions (output format, baseline storage, drift threshold) that are too consequential for an incidental piece of a measurement leaf.
- **(C)** Adopt `size-limit` or `rollup-plugin-visualizer` and configure a budget. Cost: a new dev dependency in `apps/audience/package.json`, a new config file, a CI hook, a baseline-management policy, and an ADR (per the standing convention that adding a new dev dependency with a CI gate is an architectural decision). Benefit: the bundle is regression-gated forever after. Rejected — this is the entire scope of the named-future-task `aud_bundle_size_budget` below; folding it into a 0.25d measurement leaf would balloon the task by 4-6x.

The named-future-task (if recurring bundle-budget enforcement is wanted): `aud_bundle_size_budget` (~1d) — would adopt `size-limit` (smaller surface than `rollup-plugin-visualizer`, simpler CI integration) under `apps/audience/`, configure budgets for `audience-*.js` and `audience-*.css` gzipped, add a `pnpm -F @a-conversa/audience check:size` script, and wire it into the CI's `make check` bundle. Authoring an ADR documenting the budget policy is part of that task's scope. The closer does NOT register this in the WBS today; trigger is a felt need for recurring enforcement (e.g., a PR that doubles the audience bundle and only the reviewer's eye catches it).

ADR 0022 compliance: the measurement IS captured as a historical record (in `## Status`), per the ADR's spirit — "if you ran the check, commit the artifact." The artifact here is the recorded numbers + recommendation, not a smoke script. The committed record is sufficient because the question is snapshot-shaped, not ongoing-shaped.

### §3 — Expected outcome: keep Google Fonts; the measurement validates this rather than re-opening it

Three possible recommendations the measurement could land on:

- **(A — chosen, expected outcome)** Keep the Google Fonts `@import`. Rationale: the build-artifact cost is essentially zero (the `@import` URL string + a handful of bytes), so the audience bundle stays within whatever soft budget exists; the runtime woff2 fetch is bytes-equivalent to what self-hosting would serve (subset woff2 files are subset woff2 files regardless of origin); the only differentiator is the *origin* (Google CDN vs the audience surface's own origin) and the *availability dependency* (one extra DNS / TLS / fetch path). Until production evidence shows the extra path is failing for real producers, the simpler choice wins. This is the recommendation `aud_clean_typography` Decision §2 expected the measurement to confirm.
- **(B)** Recommend self-hosting now. Rationale would be one of: (i) the measurement reveals an unexpected build-time inclusion (the `@import` URL somehow pulled woff2 bytes into the JS or CSS bundle — would be a Vite plugin / Tailwind v4 quirk worth diagnosing); (ii) the served woff2 sum is far larger than projected (>200 KB across all weights, suggesting Google Fonts no longer subsets the way the v1 codepoint envelope expects); (iii) compliance / availability concern: Google Fonts is reachable from the dev machine but a stated production deployment target (named in `aud_obs_setup_docs`'s eventual scope) cannot reach `fonts.googleapis.com`. None of these are expected.
- **(C)** Recommend dropping Inter entirely and using only the fallback chain. Rationale would be: the woff2 cost is unacceptable AND the rendered-output difference between Inter and the first fallback (`-apple-system` on macOS, `Segoe UI` on Windows) is small enough. Rejected categorically — `i18n_audience_typography` shipped the codepoint-coverage tests specifically to pin Inter as the broadcast face; this measurement is not the right venue to re-open that decision. If a future task wants to revisit the font choice, it does so on its own refinement, not on an incidental finding here.

The recommendation that lands in `## Status` is whichever of (A) or (B) the measurement actually supports. The refinement's expectation per `aud_clean_typography` is (A); (B) would be a surprise finding worth a paragraph of context in the Status block explaining what the measurement saw that the parent decision did not anticipate.

The named-future-task posture under (A): `aud_self_host_inter` (~0.5d) remains un-registered but documented. It surfaces only if production evidence (Sentry errors from `fonts.googleapis.com`, OBS-host complaints about font swap-in flicker or unavailability) reaches the team — at which point the closer registers it in the WBS with a fresh refinement.

The named-future-task posture under (B): `aud_self_host_inter` is registered in `tasks/50-audience-and-broadcast.tji` under `aud_obs_integration` with `effort 0.5d` and `depends audience.aud_graph_rendering.aud_clean_typography`; the closer authors its skeletal refinement at the same time. The numbers from this leaf's Status block become that refinement's Inputs.

### §4 — Latin + latin-ext subsets only; no full-Unicode Inter sum

Google Fonts serves Inter as multiple woff2 subsets keyed on `unicode-range`: cyrillic, cyrillic-ext, greek, greek-ext, vietnamese, latin-ext, latin. The audience surface's `V1_LOCALE_CODEPOINT_RANGES` (Basic Latin + Latin-1 Supplement + Latin Extended-A + General Punctuation) is fully covered by the latin + latin-ext subsets:

- Basic Latin (U+0000-007F) and Latin-1 Supplement (U+0080-00FF) → latin subset.
- Latin Extended-A (U+0100-017F) → latin-ext subset.
- General Punctuation (U+2000-206F) → latin subset (`unicode-range: ... U+2000-206F ...`).

Summing all seven subsets would overstate the self-host cost by ~4-5× because the audience never serves codepoints from cyrillic / greek / vietnamese. The measurement records only latin + latin-ext × four weights = 8 woff2 files; sums outside that envelope are out-of-scope.

Alternative — sum all served subsets. Rejected as inflating the projected cost for codepoints the v1 audience never renders. The browser only fetches the woff2 subsets whose `unicode-range` includes a glyph the page actually uses, so the projection should mirror that runtime behaviour.

Alternative — sum only the latin subset (skip latin-ext). Rejected — `V1_LOCALE_CODEPOINT_RANGES` explicitly includes Latin Extended-A, which covers diacritics for pt-BR and es-419 (`c-cedilla`, tilde-a, n-tilde, etc.) — the v1 audience renders those codepoints whenever the methodology glossary uses them, so latin-ext is fetched in real production. The measurement must include it.

### §5 — Sentry / OBS-host evidence as the gate for `aud_self_host_inter` scheduling

The named-future-task `aud_self_host_inter` was identified in `aud_clean_typography` Decision §2; this leaf re-affirms the trigger and pins it crisply so a future closer can register the task mechanically when the trigger fires:

- **Sentry trigger**: any non-zero rate of `fonts.googleapis.com` fetch errors observed from the audience surface in the Sentry log over a calendar week. The audience surface ships under ADR 0026's micro-frontend split, so font-fetch errors from the audience artifact will be tagged distinctly from root-app errors and will be visible to whoever monitors Sentry per the eventual production-observability task.
- **OBS-host complaint trigger**: any producer report mentioning font-rendering issues during a broadcast (font fails to load, fallback chain visibly renders for an extended period, text appears in the wrong face). One credible report is enough — the bar is intentionally low because broadcast-output appearance is the audience surface's reason to exist.

Under either trigger, the closer registers `aud_self_host_inter` in `tasks/50-audience-and-broadcast.tji` and authors `tasks/refinements/audience/aud_self_host_inter.md`. The refinement's Inputs cite this leaf's Status block for the measured woff2 sum and the projected build-artifact delta. The refinement's scope is: download the four Inter weights × latin + latin-ext subsets as woff2 binaries from Google Fonts (or the upstream Inter project's own woff2 release), commit them under `apps/audience/public/fonts/`, replace the Google Fonts `@import` line at `apps/audience/src/index.css:19` with four `@font-face` rules, and update `--font-broadcast`'s registration unchanged (the fallback chain is untouched).

Until a trigger fires, `aud_self_host_inter` stays un-registered. The closer does NOT add it to the WBS as a speculative open leaf.

Alternative — register `aud_self_host_inter` proactively today. Rejected — speculative leaves clutter the WBS and risk being acted on before the evidence justifies them; the team's pattern (per the recent OBS / typography work) has been to wait for empirical evidence before scheduling.

Alternative — gate on a stricter Sentry threshold (e.g., >1% error rate). Rejected — the audience surface has a small enough user base that a stricter threshold would require waiting for many broadcasts to fail before action; one observed error is enough signal at v1 scale.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-27.

- **Build artifact baseline (Google Fonts path, fresh `pnpm -F @a-conversa/audience build` output, 2026-05-27):**
  - `apps/audience/dist/audience-BFg5G8Au.js`: raw 482,307 B (471 KiB); gzipped 125,641 B (123 KiB).
  - `apps/audience/dist/assets/audience-cDpi6nlN.css`: raw 13,951 B (13.6 KiB); gzipped 3,778 B (3.7 KiB).
  - Total audience gzipped JS+CSS: ~126 KiB.
- **Surprise finding — Google Fonts `@import` is DROPPED from the build.** `grep -c 'fonts.googleapis'` on both `audience-*.js` and `assets/audience-*.css` returns **0**. The `@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap')` at `apps/audience/src/index.css:19` does not survive the Tailwind v4 + Vite library-mode build: `@import 'tailwindcss';` (line 18) is inlined by `@tailwindcss/vite` into emitted CSS layers, pushing the Inter `@import url(...)` past the CSS-spec position requirement (`@import` must precede all other rules); PostCSS/Vite then drops the now-invalid import. **Consequence: the audience surface in production loads NO Inter and silently falls back to `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, …` — the parent decision in `aud_clean_typography` Decision §2 is empirically not in effect in shipping builds.**
- **Hypothetical self-host woff2 cost (Inter v20 variable font).** Google Fonts now serves Inter as a single variable-font woff2 per subset (the `wght` axis covers 400/500/600/700 from one file). The CSS returned by `fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap` enumerates 4 weights × 7 subsets = 28 `@font-face` rules; the latin and latin-ext `src: url(...)` are identical across all four weights. Measured file sizes: latin (47.1 KiB, 48,256 B) and latin-ext (83.1 KiB, 85,068 B). **Browser-cached runtime fetch sum (browser dedupes by URL): 48,256 + 85,068 = 133,324 B (~130 KiB).**
- **Anomaly note re. refinement sanity-check envelope.** Refinement §"Measurement procedure" item 5 expected latin ≈ 5–10 KB, latin-ext ≈ 10–15 KB. Observed 47.1 KiB and 83.1 KiB respectively (~5–6× over). Cause: Google Fonts switched to serving Inter v20 as variable-font woff2 (one file per subset, full `wght 100–900` axis) since the refinement was authored; the envelope assumed four static per-weight files.
- **Budget comparison.** The woff2 runtime fetch (~130 KiB, already Brotli-compressed internally so further gzip yields ~no gain) is ~2.6× the ~50 KB gzipped i18n catalog soft budget from `i18n_audience_typography` Decision §3. The audience JS+CSS gzipped baseline (~126 KiB) is independent and unaffected. Committed-asset cost of self-hosting: +133,324 B of woff2 binary assets + ~400–500 B of `@font-face` CSS replacing the dropped `@import` line.
- **Recommendation: (B) Schedule `aud_self_host_inter` immediately.** Trigger: the Google Fonts `@import` is silently dropped by the build pipeline (Decision §3(B-i): unexpected build-time exclusion). Self-hosting via `@font-face` rules pointing at `apps/audience/public/fonts/inter-latin.woff2` and `inter-latin-ext.woff2` survives the pipeline because `@font-face` is not an `@import` and is not subject to CSS-spec position rules. Projected committed-asset cost: 133,324 B (two variable-font files covering 400/500/600/700 across latin and latin-ext). Closer registered `aud_self_host_inter` in `tasks/50-audience-and-broadcast.tji` with `effort 0.5d` and `depends audience.aud_graph_rendering.aud_clean_typography`; skeletal refinement at `tasks/refinements/audience/aud_self_host_inter.md` authored in the same commit.
- **`aud_bundle_size_budget` (~1d): NOT registered.** Per Decision §2, recurring bundle-budget CI enforcement is separately scoped; no felt need triggered today.
