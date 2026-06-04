# walkthrough_narration_script — Design the walkthrough narration: step beats + en-US caption copy

## TaskJuggler entry

`tasks/47-landing-page.tji:103-115` — `task walkthrough_narration_script` under
`task landing_page`. Back-link maintained by the closer.

```
task walkthrough_narration_script "Design the walkthrough narration: step beats + en-US caption copy" {
  effort 0.5d
  allocate team
  depends !landing_walkthrough_seed
}
```

## Effort estimate

0.5d. This is a **content-design task, not coding.** The deliverable is the
narration *script* — the ordered beats and en-US caption copy embedded in this
refinement (see **The script** below). No source, schema, or catalog files are
written here; the strings land in the i18n catalogs when
`walkthrough_demo_narration` implements them.

## Inherited dependencies

**Settled (shipped predecessors):**

- `landing_walkthrough_seed` (complete) — the 266-event "Should zoos exist?"
  log is shipped as a typed prod asset at
  `apps/root/src/walkthrough/walkthrough-events.json`, exposed as
  `readonly Event[]` via `apps/root/src/walkthrough/index.ts:71-82`. The beat
  anchors in this script are 1-based prefix lengths into that array.
- `walkthrough_demo_stepper` (complete) — the embedded stepper
  `apps/root/src/walkthrough/WalkthroughDemo.tsx` already renders the graph and
  exposes the narration seam this script is written against:
  - `onPositionChange?: (position, event) => void` prop
    (`WalkthroughDemo.tsx:91-108`), fired on every position change
    (`WalkthroughDemo.tsx:151-154`).
  - `data-testid="walkthrough-step-status"` carrying `data-position` /
    `data-total` (`WalkthroughDemo.tsx:241-250`).
  - `DEFAULT_INITIAL_POSITION = 6` (`WalkthroughDemo.tsx:54`) and an
    `initialPosition` prop override (`WalkthroughDemo.tsx:106-107`).
  - The stepper is deliberately **event-granular**, not beat-granular
    (its Decision D4): "baking beat indices in here would couple this component
    to content it must not own. Narration can drive the existing position seam
    to jump between beats." This script supplies exactly those beat indices.

**Pending (downstream consumer + sibling coordination):**

- `walkthrough_demo_narration` (`tasks/47-landing-page.tji:132-142`,
  effort 1d, depends on this task + the stepper) — *implements* this script:
  renders the per-step caption alongside the graph, keyed to the position seam,
  and localizes (en-US authored here → machine pt-BR/es-419 + PENDING review
  trackers).
- `landing_hero_and_method` (`tasks/47-landing-page.tji:73-89`, pending) — the
  hero/methodology narrative. The caption copy here uses the **same three
  diagnostic-goal vocabulary** that task is built around (internal
  contradictions, category mismatches, bedrock axioms) and the same one-line
  hypothesis; if the hero's final wording diverges, the captions are reconciled
  editorially (no code dependency).

## What this task is

Choose which positions of the zoos walkthrough the demo pauses/narrates on, and
write — in en-US — what each pause *teaches*, tying the visible graph change to
the methodology concept it illustrates (a decomposition, a classification, a
surfaced contradiction, an axiom-mark, an interpretive split). The output is the
**script** (`## The script` section): an ordered list of beats, each with a real
event-position anchor, the methodology concept it surfaces, and the caption copy.

This is where the "sell the methodology" story is actually written. The stepper
is the projector; the narration is the voice-over; this refinement is the
voice-over's screenplay.

## Why it needs to be done

`walkthrough_demo_narration` cannot start without a script — it needs to know
*which* positions carry a teachable moment and *what* the caption says. The
landing page's whole purpose (`tasks/47-landing-page.tji:1-12`) is to sell the
*methodology*; a bare scrubber over 266 events teaches nothing without this
narration. The beats authored here also become the test fixtures the narration
task pins (see Acceptance criteria), so getting the anchors right and verifiable
matters downstream.

## Inputs / context

- **This task + its consumers** — `tasks/47-landing-page.tji:103-142`.
- **Seed event log (the raw material)** —
  `apps/root/src/walkthrough/walkthrough-events.json` (266 events), loaded as
  `readonly Event[]` by `apps/root/src/walkthrough/index.ts:71-82`. Canonical
  copy: `packages/test-fixtures/src/fixtures/walkthrough/events.json`.
- **Stepper seam** — `apps/root/src/walkthrough/WalkthroughDemo.tsx:91-108`
  (props), `:151-154` (`onPositionChange` fire), `:241-250` (`data-position`
  status), `:54` (`DEFAULT_INITIAL_POSITION = 6`).
- **Projector (how an event becomes a graph change)** —
  `packages/graph-view/src/projectGraph.ts`. Nodes land on canvas at
  `node-created` (propose) time, not at commit time, consistent with the
  entity/facet separation in **ADR 0027**
  (`docs/adr/0027-entity-and-facet-layers-strict-separation.md`); a
  `classify-node` commit flips a node's `kind` (`null` →
  `normative|predictive|fact|definitional`); a `decompose` commit stamps the
  parent `decomposed: true` (faded); `set-edge-substance` marks an edge
  `agreed`; `axiom-mark` populates a node's `axiomMarks`; `interpretive-split`
  splits a claim into distinct readings.
- **i18n** — existing `landing.demo.*` namespace at
  `packages/i18n-catalogs/src/catalogs/en-US.json:11-21` (control chrome:
  `next`, `play`, `stepStatus`, …). Caption keys extend this namespace per
  **ADR 0024** (`0024-frontend-i18n-react-i18next-with-icu.md`).
- **Sibling refinements** —
  `tasks/refinements/landing_page/walkthrough_demo_stepper.md` (Decision D4 =
  event-granular stepping; the position seam),
  `tasks/refinements/landing_page/landing_walkthrough_seed.md` (the asset).
- **Structural-event index of the seed log** (verified against the JSON; the
  spine the beats are anchored to). `pos = arrayIndex + 1` is the 1-based prefix
  length at which the event is fully applied.

  **Propose-time vs. commit-time (load-bearing for anchor choice).** Per the
  projector (`projectGraph.ts`, ADR 0027), an *entity* lands on the canvas at its
  `node-created` / `edge-created` event — propose time. But a *facet/structural*
  change — a `classify-node` kind flip, a `decompose` / `interpretive-split`
  parent fade, an `axiom-mark` badge, a `set-edge-substance` "agreed" — only
  becomes visible when its proposal **commits**, several events after the
  proposal. So beats narrating a commit-gated change must anchor on the **commit
  position**, not the proposal position. The `pos`/`commit` columns below give
  both; the verified commit positions were confirmed against the JSON by matching
  each `commit.proposal_id` back to its proposal envelope id.

  | pos | commit | event | graph change |
  |----:|-------:|-------|--------------|
  | 5 | — | node-created | Anna's opening: "AZA-accredited zoos do more good than harm" |
  | 7–11 | — | node-created ×5 | umbrella claim + scope + 3 support legs (conservation / understanding / welfare) |
  | 17–19 | — | edge-created ×3 | the 3 support legs link to the umbrella claim |
  | 23 | **27** | proposal → commit `decompose` | Anna's opening decomposed into its 5 components; parent fades at the commit (27) |
  | 28/33/38 | **32/37/42** | proposal → commit `set-edge-substance` ×3 | each support leg marked **agreed** at its commit; all three agreed by 42 |
  | 43 | — | annotation-created `scope-change` | accredited/unaccredited boundary staked |
  | 50 | — | node-created | Ben's counter: confinement imposes a morally significant cost |
  | 56 | — | edge-created `qualifies` | "independent of welfare" qualifies the umbrella; the counter attaches to the shared map |
  | 58 | 62 | proposal → commit `decompose` | Ben's counter split into cost-as-such + welfare-independence (fades at 62) |
  | 75 | 79 | proposal → commit `classify-node` | welfare-convergence claim classified **predictive** (kind flips at 79) |
  | 80 | — | edge-created `rebuts` | welfare-convergence **rebuts** cost-as-such; substance proposed at 82, **agreed** at commit **86** |
  | 91 | 95 | proposal → commit `classify-node` | "frustration of constitutive capacities" classified **normative** (kind flips at 95) |
  | 96 | **100** | proposal → commit `classify-node` | "species cognitive profiles" classified **fact** (kind flips at 100) |
  | 101,108 | — | edge-created `bridges-from`/`bridges-to` | capability frame bridges the normative claim to the empirical fact |
  | 143 | **147** | proposal → commit `axiom-mark` | "a life has a shape it is owed" marked an **axiom** (Ben); badge appears at the commit (147) |
  | 192 | **196** | proposal → commit `interpretive-split` | "capability-frustration reduces to welfare" split into **epistemic vs. metaphysical** readings; parent fades at 196 |
  | 266 | — | — | final state: the full map |

## Constraints / requirements

1. **Anchor every beat to a real position** in the 266-event log where the
   relevant graph change is *visible* (use the index above). An anchor is a
   1-based prefix length (`position` = events applied), matching the stepper's
   `data-position` / `onPositionChange` contract. For a commit-gated change
   (classify / decompose / interpretive-split / axiom-mark / set-edge-substance)
   the visible-change position is the **commit**, not the proposal — anchor there
   (see the propose-vs-commit note in Inputs).
2. **Tie each beat to a named methodology concept.** A caption that narrates the
   *content* ("now they discuss welfare science") without naming the *method*
   ("a claim gets tagged with what KIND of statement it is") fails the task's
   purpose. Each beat names one of: shared single graph, decomposition,
   consensus-gated structure, internal contradiction, category mismatch
   (classification), bedrock axiom, interpretive split.
3. **Cover the three diagnostic goals** the page sells (internal contradictions,
   category mismatches, bedrock axioms) and the core hypothesis (people contradict
   themselves, or talk past each other by treating the same statement as a
   different KIND of thing). The interpretive-split beat is the headline
   illustration of the hypothesis.
4. **Copy is short and screen-friendly.** Each beat is an eyebrow (the concept
   label) + a one-line title + a one-or-two-sentence body. The caption renders
   beside a live graph on a marketing page, not a wall of text.
5. **en-US authored; localization deferred to the consumer.** Per the i18n
   workflow (ADR 0024), en-US is authored here. `walkthrough_demo_narration`
   adds machine pt-BR/es-419 with PENDING review trackers; native-speaker
   sign-off stays on the parked translation-review item (not a WBS leaf).
6. **Do not couple the stepper to beats.** The script drives the *existing*
   event-granular position seam (stepper Decision D4); narration computes the
   active beat from `position`. This task adds no requirement that the stepper
   snap to beats.
7. **Activation rule (the script's behavioral contract for the consumer):** the
   active beat is the last beat whose anchor ≤ current `position`. Below the
   first anchor there is no active caption. Beat 1's anchor (6) equals
   `DEFAULT_INITIAL_POSITION`, so the first caption is active on load.

## The script

Beats are ordered; `pos` is the anchor (1-based prefix length). Suggested i18n
key: `landing.demo.caption.<slug>.{eyebrow,title,body}` (consumer owns the
actual catalog edits).

### Beat 1 — `opening` · pos 6
- **Eyebrow:** One shared graph
- **Title:** Every debate starts as a single claim.
- **Body:** Two debaters and a moderator work on one shared map — not parallel
  monologues. Here's the opening position, visible to everyone.

### Beat 2 — `decompose` · pos 27
- **Eyebrow:** Decomposition
- **Title:** Break a claim into the parts it rests on.
- **Body:** You can't agree or disagree with a slogan. The opening claim is
  pulled apart into the specific sub-claims that actually carry it.

### Beat 3 — `consensus` · pos 42
- **Eyebrow:** Consensus-gated
- **Title:** Nothing lands until everyone agrees.
- **Body:** A link turns "agreed" only when both debaters *and* the moderator
  accept it. Structure on this map is earned, never just asserted.

### Beat 4 — `counter` · pos 56
- **Eyebrow:** Same map, both sides
- **Title:** The other side builds on the same structure.
- **Body:** The counter-argument doesn't open a new thread — it attaches exactly
  where it bears on the claim, so the disagreement stays in full view.

### Beat 5 — `contradiction` · pos 86
- **Eyebrow:** Internal contradictions
- **Title:** Pinpoint where two claims actually collide.
- **Body:** A rebuttal links one claim to the precise claim it contradicts. Both
  sides first agree on *where* they disagree — the step most arguments skip.

### Beat 6 — `classification` · pos 100
- **Eyebrow:** Category mismatches
- **Title:** The same words can be a different KIND of claim.
- **Body:** Is this a value, a prediction, or a fact? Tagging each claim's kind
  exposes the most common way debates derail: treating one kind of statement as
  another.

### Beat 7 — `axiom` · pos 147
- **Eyebrow:** Bedrock axioms
- **Title:** Follow the "why" until it hits bedrock.
- **Body:** Some claims can't be argued further — they're where a worldview
  rests. The map marks these axioms instead of pretending the gap is about
  evidence.

### Beat 8 — `interpretive_split` · pos 196
- **Eyebrow:** Talking past each other
- **Title:** Sometimes the fight is over what a sentence even means.
- **Body:** One claim is split into its distinct readings — one epistemic, one
  metaphysical — so each is argued on its own terms instead of past each other.

### Beat 9 — `finale` · pos 266
- **Eyebrow:** The finished map
- **Title:** A debate you can actually see.
- **Body:** What's agreed, what's still contested, and the axioms underneath — a
  shared structure, not a transcript of two people talking past each other.

> Copy above is an en-US draft. It is provisional pending consistency with the
> final `landing_hero_and_method` hero wording (editorial reconciliation, no code
> dependency) and native-speaker review for pt-BR/es-419 (parked human-review
> item, not a WBS leaf).

## Acceptance criteria

This is a content-design task; the artifact is the script above, not runtime
code. Per **ADR 0022** (no throwaway verifications), this task writes **no**
test script and **no** throwaway harness — there is nothing executable to pin
here. Verification is editorial + downstream:

1. The script contains an ordered set of beats (9), each anchored to a position
   that resolves to a real structural event in
   `apps/root/src/walkthrough/walkthrough-events.json` — checkable against the
   index table in Inputs (the implementer confirms exact landing indices when
   wiring, since the seam is event-granular).
2. Each beat names a distinct methodology concept and ties it to the visible
   graph change at its anchor (constraint 2).
3. The three diagnostic goals and the core hypothesis are all covered
   (constraint 3): contradiction (Beat 5), category mismatch (Beat 6),
   bedrock axiom (Beat 7), hypothesis/interpretive-split (Beat 8).
4. Caption copy is complete en-US for every beat (eyebrow + title + body).

**Where the real test coverage lands.** The beat anchors and en-US copy are
*pinned* by `walkthrough_demo_narration`'s Vitest (asserting the active beat
computed from `data-position`/`onPositionChange` matches the script at each
anchor) and exercised end-to-end by the `landing_e2e` Playwright spec
(`tasks/47-landing-page.tji:170-180` — "stepping the demo advances the graph
through to the final state with the matching caption"). No Playwright/Cucumber
is scoped *here* because this task ships no surface — the caption-rendering
behavior becomes reachable only when `walkthrough_demo_narration` mounts it.
This is **not** deferred-e2e debt this task incurs (the e2e policy binds
`moderator_ui.*`/`participant_ui.*`/`audience.*`/`replay_test.*`, not
`landing_page.*`); it is coverage that naturally belongs to the consumer task,
which already scopes it.

No new follow-up WBS tasks are spawned by this refinement.

## Decisions

- **D1 — The script lives in this refinement, not a separate data file.** The
  task note calls this "where the … story is actually written," and the README
  treats the refinement as the source of truth for task scope. *Alternative
  rejected:* a parallel `narration-script.json` keyed by position — rejected
  because the *copy* belongs in the i18n catalogs (ADR 0024), and a second data
  file would duplicate the en-US strings and drift from the catalog. The
  refinement holds the design (beats + concept + anchors); the catalog holds the
  shipped strings; the narration component binds anchor → key.

- **D2 — Nine beats, anchored to structural milestones.** Chosen to cover the
  three diagnostic goals + the hypothesis + the mechanics (shared graph,
  decompose, consensus, counter) with a satisfying open and close, without
  burying the visitor. *Alternative rejected:* one caption per event (266) — far
  too noisy; or 3–4 beats — too sparse to land all three diagnostic goals. Each
  anchor sits where the graph *visibly* changed (a commit/edge/split), not on a
  vote or housekeeping event.

- **D3 — Activation = "last beat with anchor ≤ position"; stepper stays
  event-granular.** Captions follow free stepping/scrubbing; the demo does not
  snap to beats. *Alternative rejected:* beat-granular stepping (snap Next/Prev
  to beat anchors) — rejected to honor stepper Decision D4 (the component must
  not own narration content). A "jump to next beat" affordance, if wanted, is a
  narration-side UX choice driven through the existing position seam, out of
  scope here.

- **D4 — Caption strings extend the existing `landing.demo.*` i18n namespace
  (`landing.demo.caption.<slug>.{eyebrow,title,body}`), authored en-US; the
  consumer adds machine pt-BR/es-419 + PENDING trackers.** Consistent with the
  shipped `landing.demo.*` keys (`en-US.json:11-21`) and the ADR 0024 workflow.
  *Alternative rejected:* a new top-level `narration.*` namespace — needless;
  these strings are demo chrome and belong with the rest of the demo's keys.

- **D5 — No new ADR.** This is content design over existing seams (the position
  seam, the i18n workflow, the shipped seed asset). No new dependency, no new
  architectural boundary, no security-relevant trade-off — the same threshold
  `landing_walkthrough_seed` (its Decision 5) and `walkthrough_demo_stepper`
  (its Decision D9) applied.

- **D6 — Author against the established three-diagnostic-goal vocabulary.** The
  hypothesis and the three goals are already fixed in
  `tasks/47-landing-page.tji:80-87` and DESIGN; the captions reuse that framing
  so the demo and the hero tell one story. *Alternative rejected:* inventing
  fresh demo-only terminology — would fragment the page's message and create a
  reconciliation burden against the (pending) hero copy.

## Open questions

(none — all decided)

## Status

**Done** — 2026-06-03.

- Script artifact lives in this refinement (`tasks/refinements/landing_page/walkthrough_narration_script.md`), per D1/D5; no source, schema, or catalog files touched.
- Nine beats authored with en-US copy (eyebrow + title + body), covering all three diagnostic goals (contradiction Beat 5, category mismatch Beat 6, bedrock axiom Beat 7) and the core hypothesis/interpretive-split (Beat 8).
- All beat anchors verified against `apps/root/src/walkthrough/walkthrough-events.json` (266 events) and re-anchored to commit/visible positions per the propose-vs-commit rule: Beat 2 → pos 27, Beat 3 → pos 42, Beat 4 → pos 56 (`qualifies` edge), Beat 5 → pos 86, Beat 6 → pos 100, Beat 7 → pos 147, Beat 8 → pos 196; Beats 1 (pos 6 = `DEFAULT_INITIAL_POSITION`) and 9 (pos 266) unchanged.
- Structural-event index table corrected with explicit proposal/commit columns and an introductory propose-vs-commit note.
- Constraint 1 tightened to make the propose-vs-commit anchor rule explicit.
- Anchors are strictly increasing; activation rule (constraint 7) satisfied.
- No Vitest/Playwright/Cucumber coverage scoped here (ADR 0022); test coverage belongs to downstream `walkthrough_demo_narration` (Vitest) and `landing_e2e` (Playwright), which already scope it.
- No new WBS tasks registered; no parking-lot entries.
