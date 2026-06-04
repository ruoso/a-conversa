# Refinement — `landing_page.walkthrough_demo_narration`

## TaskJuggler entry

Defined at `tasks/47-landing-page.tji:133-143`
(`task landing_page.walkthrough_demo_narration` under `task landing_page`).
Back-link maintained by the closer.

```
task walkthrough_demo_narration "Per-step captions wired into the demo, localized" {
  effort 1d
  allocate team
  depends !walkthrough_demo_stepper, !walkthrough_narration_script
}
```

This task feeds milestone **M8-landing**: its only direct downstream is the
terminal `landing_e2e` leaf (`tasks/47-landing-page.tji:171-181`), which asserts
"stepping the demo advances the graph through to the final state with the
matching caption."

## Effort estimate

`1d` (from the `.tji` block). The script and the stepper seam already exist; the
work is a small caption component + a typed beat→anchor table + the i18n catalog
strings (9 beats × 3 fields × 3 locales) + tests. No new architecture.

## Inherited dependencies

`depends !walkthrough_demo_stepper, !walkthrough_narration_script`. Both
predecessors are **Done (2026-06-03)**; everything this task consumes is on disk
and green.

**Settled by `walkthrough_narration_script`**
(`tasks/refinements/landing_page/walkthrough_narration_script.md`):

- **The script is authored** — nine ordered beats, each with a slug, a verified
  1-based position anchor, a named methodology concept, and en-US caption copy
  (eyebrow + title + body). The anchors (`§ The script`):

  | beat | slug | anchor (pos) | concept |
  |-----:|------|-------------:|---------|
  | 1 | `opening` | 6 | one shared graph |
  | 2 | `decompose` | 27 | decomposition |
  | 3 | `consensus` | 42 | consensus-gated structure |
  | 4 | `counter` | 56 | same map, both sides |
  | 5 | `contradiction` | 86 | internal contradiction |
  | 6 | `classification` | 100 | category mismatch |
  | 7 | `axiom` | 147 | bedrock axiom |
  | 8 | `interpretive_split` | 196 | talking past each other |
  | 9 | `finale` | 266 | the finished map |

- **The activation rule (the script's behavioral contract, constraint 7 /
  Decision D3):** the active beat is **the last beat whose anchor ≤ current
  `position`**; below the first anchor (pos < 6) there is **no** active caption.
  Beat 1's anchor (6) equals the stepper's `DEFAULT_INITIAL_POSITION`, so the
  first caption is active on load.
- **i18n key convention (Decision D1/D4):** the *copy* lives in the i18n
  catalogs, not a parallel data file. Suggested key:
  `landing.demo.caption.<slug>.{eyebrow,title,body}`, extending the existing
  `landing.demo.*` namespace. en-US is authored from the script; the consumer
  (this task) adds machine pt-BR/es-419 + PENDING trackers.
- The script is provisional pending editorial reconciliation with the (pending)
  `landing_hero_and_method` hero wording — **no code dependency**; if the hero
  diverges the strings are reconciled in the catalog later.

**Settled by `walkthrough_demo_stepper`**
(`tasks/refinements/landing_page/walkthrough_demo_stepper.md`):

- **The narration seam exists and is shaped for exactly this consumer.**
  `WalkthroughDemo` (`apps/root/src/walkthrough/WalkthroughDemo.tsx`) is the
  full interactive stepper. It exposes:
  - `onPositionChange?: (position: number, event: Event | undefined) => void`
    (`WalkthroughDemo.tsx:91-108`), fired on **every** position change including
    a synchronous mount-time fire (`WalkthroughDemo.tsx:151-154`). Default no-op.
  - `data-testid="walkthrough-step-status"` carrying `data-position` /
    `data-total` (`WalkthroughDemo.tsx:241-250`) — the machine-readable position
    seam.
  - `initialPosition?: number` override (`WalkthroughDemo.tsx:106-107,117-119`),
    defaulting to `DEFAULT_INITIAL_POSITION = 6` (`WalkthroughDemo.tsx:54`).
- **The stepper renders graph + control chrome only — captions are explicitly
  out of its scope** (`WalkthroughDemo.tsx:13-19`, stepper Decision D4):
  "baking beat indices in here would couple this component to content it must not
  own. Narration can drive the existing position seam." This task is that
  narration; it must **not** modify the stepper's stepping model.
- **The demo is mounted on `/` today** (stepper Decision D7):
  `apps/root/src/routes/LandingRoute.tsx:79-92` lazy-loads `<WalkthroughDemo />`
  in a `<Suspense>` inside the anonymous-facing `<main data-testid="route-landing">`.
  So the caption surface this task adds is **reachable now** (see Acceptance —
  e2e is inline, not deferred).
- **i18n is wired app-wide** — `apps/root/src/main.tsx` binds the full shared
  catalog; `useTranslation()` resolves the new keys for free. The control-chrome
  `landing.demo.*` keys already ship (`en-US.json:11-21`), and the PENDING
  trackers already carry the `landing.demo.*` control keys
  (`pt-BR.review.json:390-396`, `es-419.review.json`).

**Pending:** none — both predecessors are complete.

## What this task is

Implement the narration: render the per-step caption (eyebrow + title + body)
beside the graph as the visitor advances the stepper, driven by the
`walkthrough_narration_script` beats. The caption tracks the stepper's position
through the existing `onPositionChange` seam, computes the **active beat** via the
script's activation rule (last beat with anchor ≤ position), and resolves its copy
from the i18n catalog. The en-US strings are authored from the script; pt-BR and
es-419 are machine-translated with PENDING review-tracker entries per the catalog
workflow.

Scope boundaries with the siblings:

- **The stepper itself is untouched.** This task consumes
  `WalkthroughDemo`'s `onPositionChange` / position seam; it does not change the
  stepper's controls, projection, or stepping granularity (stepper Decision D4).
- **Small-screen caption layout** is `landing_demo_mobile_fallback`
  (`tasks/47-landing-page.tji:145-156`); this task ships the desktop-first
  caption layout those tasks compose around.
- **Whole-page responsive + a11y polish** (focus order, contrast,
  reduced-motion, live-region politeness audit) is `landing_responsive_a11y`
  (`tasks/47-landing-page.tji:158-169`); this task ships a sensible accessible
  baseline (labelled region, semantic heading), not the page-wide audit.
- **The full final-state-with-matching-caption journey** stays owned by
  `landing_e2e` (`tasks/47-landing-page.tji:171-181`); this task lands a thin
  inline caption assertion (see Acceptance, e2e).

## Why it needs to be done

The landing page exists to **sell the methodology** (`tasks/47-landing-page.tji:1-12`):
a bare scrubber over 266 events teaches nothing without the voice-over that ties
each visible graph change to the concept it illustrates. The stepper is the
projector and the script is the screenplay; this task is the voice-over actually
rendered on screen. It is the last content piece before the page's narrative /
polish leaves and the terminal `landing_e2e` can assert the complete demo
experience, and M8-landing gates M9 (Deployment) — the public surface must not
ship the developer placeholder (`tasks/47-landing-page.tji:9-12`).

## Inputs / context

- **WBS block:** `tasks/47-landing-page.tji:133-143` (this task); architecture
  note `tasks/47-landing-page.tji:14-20`.
- **The script (the content this task implements):**
  `tasks/refinements/landing_page/walkthrough_narration_script.md` — the nine
  beats (`§ The script`, lines 184-249), the anchor index table (lines 128-146),
  the activation rule (constraint 7, lines 179-182), and the i18n key convention
  (Decision D1/D4, lines 287-317).
- **The stepper seam (what this task hangs off):**
  - `apps/root/src/walkthrough/WalkthroughDemo.tsx:91-108` — `WalkthroughDemoProps`
    (`onPositionChange`, `cyRef`, `initialPosition`).
  - `apps/root/src/walkthrough/WalkthroughDemo.tsx:151-154` — `onPositionChange`
    fires on every position change (incl. mount).
  - `apps/root/src/walkthrough/WalkthroughDemo.tsx:241-250` — the
    `walkthrough-step-status` element + `data-position` / `data-total`.
  - `apps/root/src/walkthrough/WalkthroughDemo.tsx:54` —
    `DEFAULT_INITIAL_POSITION = 6` (= beat 1's anchor).
- **The embed site:** `apps/root/src/routes/LandingRoute.tsx:79-92` — the
  `<section data-testid="landing-walkthrough">` `<Suspense>` block that today
  lazy-loads `<WalkthroughDemo />`. This is where the narrated composition mounts.
- **The seed (anchors resolve into this):**
  `apps/root/src/walkthrough/index.ts:71-84` — `walkthroughEvents:
  readonly Event[]` (266 events). The script's anchors are 1-based prefix lengths
  into this array.
- **i18n catalogs (where caption copy lands):**
  - en-US: `packages/i18n-catalogs/src/catalogs/en-US.json:11-21`
    (`landing.demo.*` namespace — extend with `landing.demo.caption.*`).
  - pt-BR / es-419: `packages/i18n-catalogs/src/catalogs/{pt-BR,es-419}.json`
    (machine translations).
  - PENDING trackers: `packages/i18n-catalogs/src/catalogs/{pt-BR,es-419}.review.json`
    (`pending` array of dotted keys; `pt-BR.review.json:390-396` already lists the
    `landing.demo.*` control keys — append the new caption keys here).
  - Parity gate: `scripts/check-parity.ts` enforces key-set parity across the
    three primary catalogs (ignores `*.review.json` by filename).
  - Workflow doc: `tasks/refinements/frontend-i18n/i18n_catalog_workflow.md`.
- **Test conventions:**
  - Vitest component pattern: `apps/root/src/walkthrough/WalkthroughDemo.test.tsx`
    (uses `renderWithProviders` / `getTestI18n` from
    `apps/root/src/testing/renderWithProviders.tsx`).
  - Playwright: `tests/e2e/landing-demo.spec.ts` (the stepper's inline spec, the
    natural place to extend with a thin caption assertion).
- **ADRs:** 0024 (react-i18next + ICU — the i18n workflow); 0008 (Playwright);
  0022 (no throwaway verifications); 0026 (root-app micro-frontend); 0027
  (propose-time rendering, why anchors sit at commit positions — already resolved
  by the script).
- **Predecessor refinements:**
  `tasks/refinements/landing_page/walkthrough_narration_script.md`,
  `tasks/refinements/landing_page/walkthrough_demo_stepper.md`.

## Constraints / requirements

1. **Drive the caption from the existing position seam — do not modify the
   stepper.** The caption tracks `WalkthroughDemo`'s position via its
   `onPositionChange` callback (`WalkthroughDemo.tsx:91-108,151-154`). This task
   adds no prop to and changes no behavior of `WalkthroughDemo`; in particular it
   does **not** make the stepper snap to beats (stepper Decision D4).
2. **Implement the script's activation rule exactly.** Active beat = the last
   beat whose anchor ≤ current position. Below the first anchor (pos < 6) there is
   **no** active beat and no caption body is shown. On load (pos = 6) beat 1 is
   active. The rule is a pure function of position over the beat table and must be
   independently unit-testable (constraint: it is the thing the Vitest pins).
3. **The beat→anchor table is typed code; the copy is i18n.** The ordered beat
   list (slug + anchor) is a typed module in `apps/root/src/walkthrough/`. The
   caption strings are **not** duplicated there — they resolve from the catalog
   via `landing.demo.caption.<slug>.{eyebrow,title,body}` (script Decision D1:
   one source of truth for copy, the catalog). Anchors must match the script
   table exactly (6, 27, 42, 56, 86, 100, 147, 196, 266) and be strictly
   increasing.
4. **Render eyebrow + title + body, accessibly.** The caption is a labelled
   region with a semantic heading for the title; eyebrow and body are text. It
   carries a stable DOM seam — `data-testid="walkthrough-caption"` plus a
   `data-beat="<slug>"` attribute (empty when no beat is active) — so tests can
   assert the active beat without scraping rendered copy. Keep the desktop-first
   layout beside the graph; cross-breakpoint layout is
   `landing_demo_mobile_fallback` / `landing_responsive_a11y`.
5. **All caption strings localized via the catalog workflow.** New
   `landing.demo.caption.*` keys authored en-US from the script copy, with
   machine pt-BR / es-419 translations and **PENDING** entries appended to the
   `*.review.json` trackers (alongside the existing `landing.demo.*` control
   keys). `scripts/check-parity.ts` must pass with the new keys present in all
   three primary catalogs. Native-speaker sign-off stays on the parked
   translation-review item — **not** a WBS leaf.
6. **No `.tji` edits, no commit, no ADR.** The implementer lands code + strings +
   tests; the closer updates the WBS. This task reuses existing seams only
   (Decision D5).

## Acceptance criteria

Per **ADR 0022** (no throwaway verifications) every check below is a durable,
committed test artifact.

**Vitest (component — `apps/root`):** a new test (e.g.
`apps/root/src/walkthrough/WalkthroughCaption.test.tsx` and/or a
`narration.test.ts` for the pure activation function) pins:

1. **Activation rule.** `activeBeatFor(position)` returns: `undefined` for
   pos < 6; beat `opening` for pos ∈ [6, 26]; beat `decompose` at pos 27;
   advancing through each anchor returns the correct beat; at pos 266 returns
   `finale`. (Pins the script's activation contract, constraint 2.) Every one of
   the nine anchors (6, 27, 42, 56, 86, 100, 147, 196, 266) resolves to its beat,
   and a position just below an anchor resolves to the **previous** beat (proving
   "last beat ≤ position", not "nearest").
2. **Anchor/script integrity.** The beat table has nine beats, anchors strictly
   increasing and equal to the script values; each beat's slug has matching
   `landing.demo.caption.<slug>.{eyebrow,title,body}` keys present in the en-US
   catalog (guards against a slug/key drift between the table and the catalog).
3. **Caption render + position coupling.** Mounting the narrated composition
   (the wrapper that owns position and renders `WalkthroughDemo` + caption):
   on load the caption shows beat 1 (`data-beat="opening"`, the en-US eyebrow /
   title / body resolve and render); driving the stepper forward past a later
   anchor (via the existing `walkthrough-next` / scrubber controls) updates
   `data-beat` to the new active beat. Scrubbing back below pos 6 clears the
   caption (`data-beat=""`, no body).

**Playwright (e2e — inline in `tests/e2e/landing-demo.spec.ts`, NOT deferred):**
the caption surface is **reachable today** (mounted on the anonymous `/` via
`LandingRoute`), and the terminal `landing_e2e` leaf already inherits coverage
from several landing leaves (hero, open-source, mobile, responsive). Per the
e2e-policy "catch-all inheriting 2+ refinements → pay debt down, scope a small
spec inline" guidance, this task extends the stepper's spec with a thin caption
assertion rather than pushing everything to `landing_e2e`:

4. An anonymous visit to `/` shows the walkthrough caption
   (`walkthrough-caption` visible with a non-empty `data-beat` on load).
5. Stepping/scrubbing the demo to a later beat anchor changes the caption's
   `data-beat` (proves the caption tracks position end-to-end through the real
   renderer, not just in jsdom).

The **fuller** assertion — stepping the demo *through to the final graph state
with the matching localized caption text* — remains owned by `landing_e2e`
(`tasks/47-landing-page.tji:171-181`), which depends on this task plus the
narrative / mobile / responsive leaves and is the proper home for the
full-journey + final-state assertion. **No new e2e task is registered**
(`landing_e2e` already exists and already depends on this task).

**Full-suite gate (per the global build/test rule):** the workspace build
succeeds; `apps/root`'s existing Vitest suite plus the new caption/narration
tests stay green; lint / typecheck clean; `scripts/check-parity.ts` passes with
the new `landing.demo.caption.*` keys present in all three primary catalogs.

**No Cucumber scenario is in scope:** this task changes no wire behavior,
broadcast shape, or projector output — it is a pure client consumer of the frozen
seed and the stepper's position seam, rendering localized strings.

No new follow-up WBS tasks are spawned by this refinement.

## Decisions

**D1 — A small narrated-composition wrapper owns position; the stepper and the
caption stay separate components.** Add a co-located wrapper (e.g.
`apps/root/src/walkthrough/WalkthroughDemoNarrated.tsx`) that holds `position`
state, passes `onPositionChange={setPosition}` to `<WalkthroughDemo />`, computes
the active beat, and renders a sibling `<WalkthroughCaption beat={…} />`.
`LandingRoute` lazy-loads this wrapper instead of the bare demo.
*Rationale:* the stepper deliberately shipped `onPositionChange` as the narration
seam "shaped now, consumed later" (stepper Decision D4 / `WalkthroughDemo.tsx:13-19`);
consuming it from a parent keeps the stepper pure (no caption knowledge) and gives
a clean Vitest target. The demo fires `onPositionChange` synchronously on mount
(`WalkthroughDemo.tsx:151-154`), so the wrapper's caption syncs on first commit.
*Rejected:* rendering the caption **inside** `WalkthroughDemo` — directly violates
the stepper's scope boundary ("renders the graph + the control chrome only";
"content it must not own"); it would also re-open the coupling the stepper's
Decision D4 explicitly closed.

**D2 — The beat table is typed code; caption copy lives only in the catalog.** A
`narration.ts` module exports `WALKTHROUGH_BEATS: readonly { slug; position }[]`
(the nine anchors) and a pure `activeBeatFor(position)` helper; `WalkthroughCaption`
resolves copy via `t('landing.demo.caption.<slug>.<field>')`.
*Rationale:* the script's Decision D1 fixes the catalog as the single source of
truth for copy; a parallel strings-by-position file would duplicate the en-US text
and drift from the catalog. The table holds only design (slug + anchor) — the
machine-checkable part — and the catalog holds the shipped, localized strings.
*Rejected:* a `narration-script.json` carrying the copy (the alternative the
script's D1 already rejected) — duplicates strings, breaks the ADR-0024 i18n
workflow, and gives parity nothing to enforce against.

**D3 — Activation = "last beat with anchor ≤ position"; below the first anchor
the caption is cleared, not hidden-from-DOM.** The caption container always
renders with `data-testid="walkthrough-caption"`; when there is no active beat its
`data-beat=""` and the body is empty.
*Rationale:* this is the script's behavioral contract (constraint 7); keeping a
stable container in the DOM (rather than conditionally unmounting) gives tests and
the e2e a constant seam and avoids layout jump as the caption appears/disappears.
*Rejected:* snapping the stepper to beats so a caption is always present —
re-opens the stepper-owns-content coupling (stepper D4); the activation rule
already handles the sub-anchor gap cleanly.

**D4 — Caption strings extend the existing `landing.demo.*` namespace as
`landing.demo.caption.<slug>.{eyebrow,title,body}`; en-US authored, machine
pt-BR/es-419 + PENDING trackers.** Append the new keys beside the control-chrome
keys already there (`en-US.json:11-21`), and append them to the existing
`landing.demo.*` block in each `*.review.json` `pending` array
(`pt-BR.review.json:390-396` shows the established shape).
*Rationale:* the script's Decision D4 picked exactly this key shape; it keeps the
demo's strings together and satisfies the ADR-0024 catalog-parity + PENDING-tracker
workflow the stepper already followed (stepper Decision D8).
*Rejected:* a new top-level `narration.*` namespace — needless fragmentation;
these are demo chrome and belong with the rest of the demo's keys.

**D5 — No ADR.** This task reuses existing seams only: the stepper's
`onPositionChange` position seam, the authored script, the `landing.demo.*` i18n
namespace + catalog workflow (ADR 0024), and the `LandingRoute` mount point
(ADR 0026). No new dependency, no new architectural boundary, no security
trade-off. *Rationale:* the same bar the predecessors applied
(`walkthrough_demo_stepper` D9, `walkthrough_narration_script` D5,
`landing_walkthrough_seed` D5) — a consumer built on existing seams does not
clear the ADR threshold. Task-scope decisions are recorded here.

## Open questions

(none — all decided)

## Status

**Done** — 2026-06-03.

- **`apps/root/src/walkthrough/narration.ts`** — typed `WALKTHROUGH_BEATS` table (9 beats, slugs + anchors 6/27/42/56/86/100/147/196/266) and pure `activeBeatFor(position)` function implementing the "last beat with anchor ≤ position" activation rule.
- **`apps/root/src/walkthrough/WalkthroughCaption.tsx`** — labelled-region caption component with `data-testid="walkthrough-caption"` and `data-beat="<slug>"` seam; resolves copy from `landing.demo.caption.<slug>.{eyebrow,title,body}` catalog keys.
- **`apps/root/src/walkthrough/WalkthroughDemoNarrated.tsx`** — wrapper owning `position` state via `onPositionChange`, renders `<WalkthroughDemo />` + sibling `<WalkthroughCaption />`.
- **`apps/root/src/routes/LandingRoute.tsx`** — rewired to lazy-load `WalkthroughDemoNarrated` instead of the bare `WalkthroughDemo`.
- **`apps/root/src/walkthrough/WalkthroughDemo.tsx`** — added `export DEFAULT_INITIAL_POSITION` only; no behavior change.
- **`packages/i18n-catalogs/src/catalogs/en-US.json`**, **`pt-BR.json`**, **`es-419.json`** — 27 new `landing.demo.caption.*` keys per catalog (9 beats × eyebrow + title + body); en-US authored from script, pt-BR/es-419 machine-translated; parity gate passes.
- **`packages/i18n-catalogs/src/catalogs/pt-BR.review.json`**, **`es-419.review.json`** — PENDING tracker entries appended for the new caption keys.
- **`tests/e2e/landing-demo.spec.ts`** — inline caption-visible + tracks-position Playwright assertions added.
- **`apps/root/src/walkthrough/narration.test.ts`** — Vitest pins activation rule (all 9 anchors + below-first-anchor clear), anchor/script integrity (count, strictly-increasing, slug↔catalog key parity).
- **`apps/root/src/walkthrough/WalkthroughCaption.test.tsx`** — Vitest pins beat-1 on load, scrubber-past-anchor updates `data-beat`, below-pos-6 clears caption.
