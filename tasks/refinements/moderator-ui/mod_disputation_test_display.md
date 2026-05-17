# Moderator diagnostic flow disputation-test display (data vs. claim indicator)

**TaskJuggler entry**: [tasks/30-moderator-ui.tji](../../30-moderator-ui.tji) — task `moderator_ui.mod_diagnostic_flow.mod_disputation_test_display` (see `mod_diagnostic_flow` group at line 436 and this leaf at line 447).

```tji
task mod_disputation_test_display "Disputation-test indicator (data vs. claim)" {
  effort 0.5d
  allocate team
}
```

## Effort estimate

**0.5d.** Confirmed.

The disputation test is — per [`docs/methodology.md` § "Disputation test"](../../../docs/methodology.md#L128) — a *read* of a node's existing `substance` facet, not a new methodology rule. The facet projection (`computeFacetStatuses`), the per-facet pill (`<FacetPill>`), and the per-facet hover-popover row already render `substance: agreed | disputed | meta-disagreement | proposed | committed | withdrawn` verbatim. The work this task ships is the **diagnostic-vocabulary overlay** on top of those existing seams:

- a small derivation helper that maps `substance` facet status → `'data' | 'claim' | 'unsettled' | null` per the methodology's data-vs-claim contract,
- a localized inline indicator chip mounted on the node card that surfaces the derived role in methodology terms ("Data", "Claim", "Unsettled"),
- a companion row in `<HoverPopover>` so the methodology label is also surfaced in the detail surface,
- i18n keys + tests.

No new methodology engine, no new wire envelope, no new diagnostic kind, no new facet, no `captureStore.mode` change.

## Inherited dependencies (settled/pending)

Settled (this task plugs into existing seams without changing their contracts):

- `moderator_ui.mod_capture_flow` is complete (parent `mod_diagnostic_flow` group depends on it). The capture-mode substrate is the same one the sibling [`mod_is_ought_prompt`](mod_is_ought_prompt.md) reuses; this task does **not** mount inside a mode and therefore does not need a new `CaptureMode` value.
- `moderator_ui.mod_graph_rendering.mod_node_rendering` (done — `StatementNode` + `projectNodes` populate `data` from the WS event log).
- `moderator_ui.mod_graph_rendering.mod_per_facet_state_visualization` (done — pinned the `<FacetPill>` row inside the node card, including a per-facet pill for `substance`; the `data-facet-name="substance"` + `data-facet-status="..."` seams are stable).
- `moderator_ui.mod_graph_rendering.mod_disputed_state_styling` / `mod_agreed_state_styling` / `mod_meta_disagreement_split_render` / `mod_proposed_state_styling` (all done — the per-facet status vocabulary that drives this task's derivation is settled).
- `moderator_ui.mod_graph_rendering.mod_diagnostic_highlighting` (done — landed the "diagnostic surfaces compose on top of the per-facet state layer, they don't overwrite it" pattern this task mirrors. The amber halo is a *separate* visual layer from the facet pills; the disputation-test chip is similarly a *separate* methodology-label layer atop the existing substance pill).
- `moderator_ui.mod_graph_rendering.mod_hover_details` (done — `<HoverPopover>` renders a per-facet rows section; this task adds one methodology-label row alongside it).
- `frontend_i18n.i18n_diagnostic_descriptions` (done — `moderator.diagnostic.*` and `methodology.facetState.*` namespaces are established in en-US / pt-BR / es-419; this task adds a sibling `moderator.diagnostic.disputationTest.*` subtree).
- The internal facet projection helper `computeFacetStatuses` in [apps/moderator/src/graph/facetStatus.ts](../../../apps/moderator/src/graph/facetStatus.ts) already produces `facetStatuses.substance` per node from the WS event log; this task imports its output verbatim.

Pending (this task feeds these, but does NOT depend on them):

- `moderator_ui.mod_diagnostic_flow.mod_operationalization_mode` — the entry point that *invokes* operationalization. Disputation-test display is decoupled: it reads the facet, which is always present once any `set-node-substance` proposal lands. The display does not need operationalization mode to be entered.
- `moderator_ui.mod_diagnostic_flow.mod_warrant_elicitation_mode` — sibling diagnostic mode; copy must remain consistent with this task's vocabulary.
- `moderator_ui.mod_diagnostic_flow.mod_diagnostic_methodology_suggestions` — consumes the same diagnostic semantics. The methodology-label vocabulary this task pins ("Data" / "Claim" / "Unsettled") will be reused by the suggestion copy.
- `moderator_ui.mod_tests.mod_e2e_playwright.mod_pw_diagnostic_flow` — full F3 Playwright (this task contributes a scoped per-component assertion; see Acceptance criteria for the e2e deferral rationale).

## What this task is

Surface the **methodology meaning** of a node's `substance` facet on the moderator canvas: when `substance === 'agreed'` the node functions as **data** (a building block carrying support to a claim); when `substance === 'disputed'` or `meta-disagreement` the node functions as a **claim** (the substance is itself contested and needs its own support); when `substance === 'proposed'` the node is **unsettled** (the disputation test has not produced a result yet). The chip is an **information overlay** that lifts the substance pill's wire-status vocabulary into the methodology's narrative vocabulary so the moderator does not have to mentally translate `disputed` → "this node is a claim" in real time.

Concretely, this task lands:

1. **A pure derivation helper** `disputationOutcome(substanceStatus: FacetStatus | undefined): DisputationOutcome | null` exported from `apps/moderator/src/graph/disputationOutcome.ts`. The output is the discriminated union:
   ```ts
   export type DisputationOutcome = 'data' | 'claim' | 'unsettled';
   ```
   Mapping (load-bearing — pinned by tests):
   - `'agreed'`        → `'data'`
   - `'disputed'`      → `'claim'`
   - `'meta-disagreement'` → `'claim'` (the methodology treats meta-disagreement as a stronger form of contestation; same data-vs-claim outcome as disputed)
   - `'proposed'`      → `'unsettled'`
   - `'committed'`     → `'data'` (closed-state committed mirrors the post-agreement reading; the node has served as data and that record persists)
   - `'withdrawn'`     → `'unsettled'` (the prior agreement was retracted; the disputation test is open again)
   - `undefined`       → `null` (no substance facet activity ever — no methodology reading to surface)

2. **A small chip component** `<DisputationTestChip>` mounted inside the node card's per-facet pill row, **immediately following the `substance` pill**. The chip stamps `data-disputation-outcome="data" | "claim" | "unsettled"` and renders one of the three localized labels via i18n. When `disputationOutcome` returns `null` the chip is omitted entirely from the DOM (mirrors the empty-row omission rule used by the annotation / axiom-mark badges + the vote-indicator dot row).

3. **A row in `<HoverPopover>`** for the node target. When `disputationOutcome(substanceStatus) !== null`, the popover gains a row stamped `data-hover-popover-section="disputation"` carrying the localized label, sitting between the per-facet section and the axiom-marks / diagnostic sections.

4. **Three new i18n keys** under `moderator.diagnostic.disputationTest.outcome.*` in en-US, pt-BR, es-419:
   - `data`       → "Data" / "Dado" / "Dato"
   - `claim`      → "Claim" / "Afirmação" / "Afirmación"
   - `unsettled`  → "Unsettled" / "Em disputa" / "En disputa"
   Plus `moderator.diagnostic.disputationTest.chipAriaLabel` for the chip's `aria-label` ICU template.

This task is rendering only. It does NOT capture or invoke the disputation test (the test is a passive read of an existing facet — there is no invocation), does NOT add a `CaptureMode`, does NOT modify the substance facet projection, does NOT change the per-facet pill styling, does NOT extend the WS envelope.

## Why it needs to be done

The methodology's data-vs-claim distinction is the **operational consequence** of the substance facet:

> If every participant votes `agree` on the content's truth and the moderator commits → the substance facet is `agreed`. The node functions as `data` and can carry a `supports` edge to a claim. If anyone disputes the content → the substance facet is `disputed`. The node is itself a claim that needs its own support.
> ([docs/methodology.md L130–133](../../../docs/methodology.md#L130))

Today the moderator sees the substance pill carrying the **wire vocabulary** (`agreed` / `disputed`) and must mentally translate to the methodology vocabulary (`data` / `claim`) every time. The translation is one-to-one in principle but the moderator has to remember the mapping in real-time debate, and the mapping is also what the moderator's *next-action* choice keys off of:

- If the node is functioning as data → no diagnostic action needed; the node is doing its job.
- If the node is functioning as a claim → the moderator should consider running operationalization, eliciting a warrant, or capturing a defeater.
- If unsettled → the moderator should wait for votes to land before deciding.

Surfacing the methodology label inline removes the translation step. The chip is also the seam future tasks consume: `mod_diagnostic_methodology_suggestions` will read `disputationOutcome` from the same helper to decide which suggestion list to render; `mod_operationalization_mode` will gate its entry affordance on `disputationOutcome === 'claim'`.

Without this task, the moderator's diagnostic flow has a silent gap — the substance pill is correct but is not *speaking the methodology's language*. The cost compounds: the F3 sibling tasks (operationalization, warrant elicitation, methodology suggestions) would each have to re-derive the same translation, creating drift risk. Landing the helper + the label first means the rest of F3 calls the same function and surfaces the same vocabulary.

## Inputs / context

Code seams the implementation plugs into:

- [apps/moderator/src/graph/facetStatus.ts L43–49](../../../apps/moderator/src/graph/facetStatus.ts#L43) — the `FacetStatus` discriminated union (`'proposed' | 'agreed' | 'disputed' | 'committed' | 'withdrawn' | 'meta-disagreement'`) the derivation helper narrows on.
- [apps/moderator/src/graph/facetStatus.ts L179](../../../apps/moderator/src/graph/facetStatus.ts#L179) — `computeFacetStatuses(events)` (already in use by `projectNodes` in `GraphCanvasPane`); this task's chip reads `facetStatuses.substance` off the projected node `data`.
- [apps/moderator/src/graph/StatementNode.tsx L113](../../../apps/moderator/src/graph/StatementNode.tsx#L113) — `StatementNodeData.facetStatuses`; the chip reads `data.facetStatuses.substance`.
- [apps/moderator/src/graph/StatementNode.tsx L82](../../../apps/moderator/src/graph/StatementNode.tsx#L82) — `FACET_RENDER_ORDER` = `['wording', 'classification', 'substance']`; the chip mounts **after** the substance pill in the same row.
- [apps/moderator/src/graph/StatementNode.tsx L362–369](../../../apps/moderator/src/graph/StatementNode.tsx#L362) — the `.flatMap((facet) => ...)` block that emits `<FacetPill>` instances. The chip insertion is a new line in the JSX after the pill-row map, conditional on `disputationOutcome(data.facetStatuses.substance) !== null`.
- [apps/moderator/src/graph/FacetPill.tsx L73–81](../../../apps/moderator/src/graph/FacetPill.tsx#L73) — `PILL_STATUS_CLASSNAME`; the chip's per-outcome Tailwind classes mirror this vocabulary (rounded chip, small text, border) but use a methodology-distinct color palette (sky for data, rose for claim, slate for unsettled — see Decisions).
- [apps/moderator/src/graph/HoverPopover.tsx L147–164](../../../apps/moderator/src/graph/HoverPopover.tsx#L147) — the node-target popover's per-facet rows; the new disputation row appends here (after facets, before axiom-marks).
- [apps/moderator/src/graph/HoverPopover.tsx L78](../../../apps/moderator/src/graph/HoverPopover.tsx#L78) — `FACET_RENDER_ORDER` mirror; the popover already iterates facets in the same order the card does.

Wire / type surface:

- No new wire types; this task consumes the existing `FacetStatus` projection output.

Predecessor refinements that establish the seams this task reuses:

- [`mod_per_facet_state_visualization`](mod_per_facet_state_visualization.md) — per-facet pill row architecture.
- [`mod_diagnostic_highlighting`](mod_diagnostic_highlighting.md) — the "diagnostic overlay composes atop the methodology-state layer, never overwrites" pattern.
- [`mod_hover_details`](mod_hover_details.md) — the per-target popover the new disputation row mounts inside.
- [`mod_is_ought_prompt`](mod_is_ought_prompt.md) — the first F3 sibling to land; pins `moderator.diagnostic.*` i18n namespace, the "diagnostic surface in moderator chrome, not engine logic" framing, and the "defer Playwright e2e to `mod_pw_diagnostic_flow` when full flow is unreachable" precedent this task inherits.

ADRs the implementation cites:

- [ADR 0004](../../../docs/adr/0004-graph-libraries-reactflow-and-cytoscape.md) — ReactFlow on the moderator surface; node custom component is the extension point.
- [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md) — every empirical check ships as a committed Vitest case.
- [ADR 0024](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md) — `useTranslation` for the localized chip + popover row.
- [ADR 0027](../../../docs/adr/0027-entity-and-facet-layers-are-strictly-separate.md) — entity and facet layers stay separate; the chip is a *read* of the facet layer and emits no facet-layer event.

No new ADR is required: the task reuses ReactFlow (no new graph-rendering dependency), Tailwind utilities already in the moderator bundle, projection types already in `facetStatus.ts`, the established `moderator.diagnostic.*` i18n namespace. The architectural seams (the derivation helper + the chip + the popover row) are local to the moderator workspace and don't change any cross-workspace contract.

## Constraints / requirements

### Derivation helper (pure, no React, no Zustand)

- **File**: `apps/moderator/src/graph/disputationOutcome.ts`. Mirrors the `facetStatus.ts` / `diagnosticHighlights.ts` pure-module pattern.
- **Public API**:
  ```ts
  export type DisputationOutcome = 'data' | 'claim' | 'unsettled';
  export function disputationOutcome(
    substanceStatus: FacetStatus | undefined,
  ): DisputationOutcome | null;
  ```
- **Exhaustive narrow** on `FacetStatus`; an `undefined` input (no substance facet activity has ever touched the node) returns `null`. The function is referentially transparent so consumers can memoize trivially.
- **Module-level comment** cites `docs/methodology.md` § "Disputation test" (L128) as the canonical mapping reference and notes that a drift between this helper's mapping and the methodology doc is a methodology-engine-level discrepancy.

### Chip component (`<DisputationTestChip>`)

- **File**: `apps/moderator/src/graph/DisputationTestChip.tsx`.
- **Props**: `{ readonly outcome: DisputationOutcome }`. The component does NOT take `undefined` — the call site (`StatementNode`) gates rendering on `disputationOutcome(...) !== null`. This mirrors the `<FacetPill>` convention of "render only present statuses."
- **Render shape**: a `<span>` with:
  - `data-disputation-chip=""` (stable test seam, mirrors `data-facet-pill=""`).
  - `data-disputation-outcome={outcome}` (per-outcome seam, mirrors `data-facet-status={status}`).
  - `aria-label` driven by `t('moderator.diagnostic.disputationTest.chipAriaLabel', { outcome })`.
  - Localized label text via `t(`moderator.diagnostic.disputationTest.outcome.${outcome}`)`.
- **Per-outcome Tailwind classes** (see Decisions for the palette rationale):
  - `'data'`       → `'inline-flex items-center rounded-full border border-solid border-sky-600 bg-sky-50 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-sky-800'`
  - `'claim'`      → `'inline-flex items-center rounded-full border border-solid border-rose-600 bg-rose-50 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-rose-800'`
  - `'unsettled'`  → `'inline-flex items-center rounded-full border border-dashed border-slate-400 bg-slate-50 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-600'`
- **Memoized** (`React.memo`) — same rationale as `<FacetPill>` (the canvas re-renders on every pan/zoom; the chip only changes when `outcome` or locale changes).

### Card mount

- **`<StatementNode>`** mounts the chip inside the same row that hosts the per-facet pills, immediately **after** the substance pill. The chip is conditional on `disputationOutcome(data.facetStatuses.substance) !== null`. When `facetStatuses` is empty or carries no `substance` entry, the chip is omitted (no DOM presence).
- The chip MUST sit inside a `data-disputation-chip-slot=""` wrapper so the test suite can assert the chip's position relative to the pill row without scanning sibling text content.

### Hover-popover row

- **`<HoverPopover>`** for the `kind: 'node'` branch gains a section:
  ```tsx
  {disputationOutcome(facetStatuses.substance) !== null ? (
    <div
      data-hover-popover-section="disputation"
      data-hover-popover-disputation-outcome={outcome}
      className="text-xs text-slate-700"
    >
      <span className="font-medium text-slate-500">
        {t('moderator.diagnostic.disputationTest.label')}{': '}
      </span>
      <span>{t(`moderator.diagnostic.disputationTest.outcome.${outcome}`)}</span>
    </div>
  ) : null}
  ```
  Placement: after the per-facet rows, before the axiom-marks section. Edge target does NOT get the row — the disputation test is defined per-node by the methodology; edges have their own substance facet but the data-vs-claim vocabulary is a node-scoped methodology concept.

### i18n

- **New catalog keys** under `moderator.diagnostic.disputationTest`:
  - `label`                     → "Disputation test" / "Teste de disputação" / "Prueba de disputación"
  - `outcome.data`              → "Data" / "Dado" / "Dato"
  - `outcome.claim`             → "Claim" / "Afirmação" / "Afirmación"
  - `outcome.unsettled`         → "Unsettled" / "Em disputa" / "En disputa"
  - `chipAriaLabel` (ICU)       → "Disputation test outcome: {outcome}" / "Resultado do teste de disputação: {outcome}" / "Resultado de la prueba de disputación: {outcome}"
  - Catalog parity must hold across all three locales (the `i18n-catalogs` parity test fails CI if any key is missing in any locale).
- **`{outcome}` substitution** in the ICU `chipAriaLabel` uses the localized outcome label (the call site resolves `outcome.<outcome>` first and passes the resolved string into the ICU template), so the aria label reads naturally in each locale rather than carrying the wire identifier.

### Tests (committed, per ADR 0022)

All listed tests are pre-decided to be the Acceptance bar.

New file `apps/moderator/src/graph/disputationOutcome.test.ts`:

- `disputationOutcome('agreed')` returns `'data'`.
- `disputationOutcome('disputed')` returns `'claim'`.
- `disputationOutcome('meta-disagreement')` returns `'claim'`.
- `disputationOutcome('proposed')` returns `'unsettled'`.
- `disputationOutcome('committed')` returns `'data'`.
- `disputationOutcome('withdrawn')` returns `'unsettled'`.
- `disputationOutcome(undefined)` returns `null`.
- An exhaustive-narrow guard test: every value of `FacetStatus` (sourced from the type's constant tuple) maps to a non-undefined output, so a future `FacetStatus` enum addition trips this test.

New file `apps/moderator/src/graph/DisputationTestChip.test.tsx`:

- Renders `'data'` → label resolves to en-US "Data"; chip carries `data-disputation-outcome="data"` and the sky-palette classes.
- Renders `'claim'` → label resolves to en-US "Claim"; chip carries `data-disputation-outcome="claim"` and the rose-palette classes.
- Renders `'unsettled'` → label resolves to en-US "Unsettled"; chip carries `data-disputation-outcome="unsettled"` and the slate-dashed classes.
- aria-label resolves the ICU template with the localized outcome string substituted.
- Three cross-locale label cases: `'data'` → en-US "Data" / pt-BR "Dado" / es-419 "Dato".

Extension to `apps/moderator/src/graph/StatementNode.test.tsx`:

- A node with `facetStatuses.substance: 'agreed'` renders the chip with `data-disputation-outcome="data"` immediately after the substance pill (the test asserts the chip's slot wrapper follows the pill's `data-facet-pill` element in DOM order).
- A node with `facetStatuses.substance: 'disputed'` renders the chip with `data-disputation-outcome="claim"`.
- A node with `facetStatuses.substance: 'meta-disagreement'` renders the chip with `data-disputation-outcome="claim"` AND the substance pill keeps its violet meta-disagreement border (the chip and the pill layer composes; neither overwrites the other).
- A node with `facetStatuses` empty / no substance entry has no chip in the DOM (no `data-disputation-chip` element).
- A node with `facetStatuses.substance: 'agreed'` AND `diagnosticHighlight: { severity: 'blocking', kinds: ['cycle'] }` renders BOTH the chip AND the amber diagnostic halo — the two diagnostic surfaces are independent layers and neither overwrites the other.

Extension to `apps/moderator/src/graph/HoverPopover.test.tsx`:

- A node popover with `facetStatuses.substance: 'agreed'` renders a `data-hover-popover-section="disputation"` row containing the localized "Data" label.
- A node popover with `facetStatuses.substance: 'disputed'` renders the row with "Claim".
- A node popover with `facetStatuses.substance: 'proposed'` renders the row with "Unsettled".
- A node popover with no substance facet does NOT render the row.
- An edge popover (any substance status) does NOT render the row — the disputation-test vocabulary is node-only.
- Locale parity: the en-US / pt-BR / es-419 catalog keys all resolve to non-key strings.

No new tests are added to `wsStore.test.ts`, `selectors.test.ts`, `GraphCanvasPane.test.tsx`, or `facetStatus.test.ts` — this task is purely a render-layer overlay; the projection contracts are unchanged.

## Acceptance criteria

1. `apps/moderator/src/graph/disputationOutcome.ts` exists, exports `DisputationOutcome` and `disputationOutcome(substanceStatus)`. Module-level comment cites `docs/methodology.md` § "Disputation test" as the canonical mapping reference.
2. `apps/moderator/src/graph/DisputationTestChip.tsx` exists, exports `DisputationTestChip`, and renders per Constraints / requirements above.
3. `apps/moderator/src/graph/StatementNode.tsx` mounts the chip in the per-facet pill row, after the substance pill, gated on `disputationOutcome(...) !== null`.
4. `apps/moderator/src/graph/HoverPopover.tsx` for node targets renders the `data-hover-popover-section="disputation"` row when `disputationOutcome(...) !== null`. Edge targets are unchanged.
5. Catalog keys exist in all three locales under `moderator.diagnostic.disputationTest.*` with the values listed in Constraints / requirements; catalog parity test passes.
6. All Vitest cases listed under "Tests" above are committed and pass.
7. **Playwright e2e**: explicitly deferred to `moderator_ui.mod_tests.mod_e2e_playwright.mod_pw_diagnostic_flow` (per the sibling [`mod_is_ought_prompt`](mod_is_ought_prompt.md) precedent). **Rationale**: the chip is reachable today *only* through the substance facet's status, which is driven by `set-node-substance` proposals + their votes / commits. There is no UI surface in the moderator app that captures a `set-node-substance` proposal yet (the propose flow today builds `classify-node` + `set-edge-substance` for newly-created nodes via F1; the standalone `set-node-substance` propose path is part of the broader F3 / F7 capture work, not landed). Driving the chip from Playwright would require either a backdoor WS-store seed or the still-pending operationalization-mode wiring, both of which are out of scope. Per-component DOM coverage (the Vitest cases listed above) is the load-bearing test contract that takes the e2e's place for this task.
8. **Deferred-e2e debt inheritance**: the future Playwright spec under `mod_pw_diagnostic_flow` MUST assert that an end-to-end disputation scenario (a node with an agreed substance facet renders the "Data" chip; a node with a disputed substance facet renders the "Claim" chip) is covered. The chip and popover-row test ids (`data-disputation-chip`, `data-disputation-outcome`, `data-hover-popover-section="disputation"`) are stable seams for that future spec.
9. `pnpm run check` clean.
10. `pnpm run test:smoke` green; the test count rises by the new Vitest cases.
11. `pnpm -F @a-conversa/moderator build` succeeds.
12. `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.
13. `tasks/30-moderator-ui.tji` gets `complete 100` on `mod_disputation_test_display` plus a `note "Refinement: tasks/refinements/moderator-ui/mod_disputation_test_display.md"` line.

## Decisions

- **D1: Render the disputation-test result as an inline chip on the node card, not as a separate mode banner or modal.** Three alternatives considered:
  1. *Mode banner copy* (e.g. expand the `<ModeBanner>` to surface "disputation test in progress")  — but the disputation test is a *passive read*, not a mode the moderator enters. There is no operationalization-style narrative arc; the test result is always-available the moment the substance facet has a status. A mode banner would imply the moderator must enter a mode to "see" the result, contradicting the methodology's "the test reads the facet" framing.
  2. *Modal / dialog on demand* — adds a click + dismiss; obstructs the canvas; the result is information the moderator wants at-a-glance, not on-demand. Rejected as friction.
  3. *Inline chip beside the substance pill* — zero friction, always visible when a substance facet is present, composes cleanly with the existing per-facet pill row. **Chosen.** Mirrors the per-facet pill idiom but with methodology-vocabulary labels.

- **D2: Map `'meta-disagreement'` → `'claim'`, not a separate fourth outcome.** Meta-disagreement is the methodology's escalation of a dispute — the dispute is itself contested. Operationally the moderator's next action is the same as for `disputed` (consider operationalization / warrant elicitation / decomposition). A separate outcome label would either invent vocabulary the methodology doc doesn't carry, or force the moderator to remember a fourth term. The substance pill's existing violet/double-border meta-disagreement styling already communicates the escalation at the facet-status level; this layer only needs the binary data-vs-claim signal.

- **D3: Map `'committed'` → `'data'`, `'withdrawn'` → `'unsettled'`.** The committed status is the closed-state record of a prior `agreed` substance — the node served as data and that record is now durable. The methodology's "the node functions as data" claim survives the closure. For `'withdrawn'`, a participant retracted prior agreement; the substance is now open again; the disputation test is back to unsettled until the new votes resolve. This keeps the helper exhaustive over `FacetStatus` without inventing closed-state-specific outcomes.

- **D4: Color palette — sky (data) / rose (claim) / slate (unsettled).** Four considerations drove the picks:
  - *Sky for data*: a calm, neutral "things are settled" blue. Distinct from the sky-500 selection ring (which uses `ring-*`, not chip border/background — the visual shape difference is the primary seam, color is secondary). Stays away from amber (diagnostic highlight) and emerald (typically "success").
  - *Rose for claim*: matches the existing `disputed` substance pill's rose family (per `mod_disputed_state_styling`). The chip's claim outcome IS the methodology-language reading of the disputed status, so palette continuity reinforces the connection.
  - *Slate for unsettled*: matches the proposed-pill's slate family — the unsettled outcome IS the methodology reading of the proposed status, same continuity rationale.
  - Each chip's background is a `-50` shade with a darker text and matching border, sitting visually atop but distinct from the pill row.

- **D5: Chip is omitted (no DOM presence) when `disputationOutcome` returns `null`.** Mirrors the established "no empty container" pattern used by the annotation / axiom-mark rows + the vote-indicator dots. A node with no substance facet activity surfaces no methodology label, no aria-labelled element. Tests assert the absence by querying for `data-disputation-chip` and expecting `null`.

- **D6: Hover-popover row sits between facets and axiom-marks; edge popover does not get the row.** The popover already has a per-facet section that includes substance status — the disputation row is the *methodology label* layer above that. Placing it immediately after facets keeps the substance pill → methodology-label reading order consistent between the card and the popover. The edge popover is excluded because the methodology's data-vs-claim distinction is defined per-node (edges have substance but the methodology vocabulary doesn't carry an edge analog); rendering the row on edges would invent vocabulary the methodology doesn't pin.

- **D7: Pure derivation helper exported separately, not inlined in the chip component.** Three forward consumers will reuse the function: `mod_diagnostic_methodology_suggestions` (to pick which suggestion list to render), `mod_operationalization_mode` (to gate the entry affordance on `'claim'`), and the popover (to compute the row's content). Extracting once means the methodology mapping is the function's testable surface; the chip is then a thin presentational shell. Mirrors the `facetStatus.ts` + `diagnosticHighlights.ts` pure-module pattern.

- **D8: No new `CaptureMode`.** The disputation test is a *read*, not a mode the moderator enters. Adding a `'disputation-test'` mode value would either (a) require a corresponding setMode caller (which there isn't one — the test runs implicitly), or (b) sit unused in the type union. Both rejected. The display is reactive to facet status, not mode.

- **D9: No new wire envelope.** The substance facet status already flows over the wire via the existing `proposal-status` broadcast + the per-session event log. The chip reads `data.facetStatuses.substance` off the projected node; the projection already runs. Adding a wire envelope would duplicate signal with worse latency.

- **D10: e2e deferral to `mod_pw_diagnostic_flow` per the `mod_is_ought_prompt` precedent.** The chip's surface is reachable only after a `set-node-substance` proposal lands and accumulates votes / a commit — the moderator-UI substrate to drive that proposal end-to-end does not exist yet (it's the operationalization-mode + standalone-substance-propose tasks under F3 / F7). Per ORCHESTRATOR.md UI-stream e2e policy, a deferred e2e MUST identify the future WBS task that inherits the debt; that's `mod_pw_diagnostic_flow` (the F3 Playwright owner). The chip's test ids are stable seams the future spec will assert against.

- **D11: No new ADR.** The task reuses ReactFlow, Tailwind utilities, projection types, and i18n catalog conventions already pinned. The methodology mapping is documented in the helper's module comment + the Decisions block above; the mapping is data, not architecture.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-17.

- Landed the pure derivation helper [`apps/moderator/src/graph/disputationOutcome.ts`](../../../apps/moderator/src/graph/disputationOutcome.ts) (and exhaustive-narrow test [`apps/moderator/src/graph/disputationOutcome.test.ts`](../../../apps/moderator/src/graph/disputationOutcome.test.ts)) implementing the `FacetStatus` → `'data' | 'claim' | 'unsettled' | null` mapping per `docs/methodology.md` § "Disputation test".
- Inline chip [`apps/moderator/src/graph/DisputationTestChip.tsx`](../../../apps/moderator/src/graph/DisputationTestChip.tsx) (+ tests [`DisputationTestChip.test.tsx`](../../../apps/moderator/src/graph/DisputationTestChip.test.tsx)) renders the methodology-vocabulary label with the sky / rose / slate-dashed palette pinned in D4 and stamps `data-disputation-chip` + `data-disputation-outcome` seams.
- Mounted the chip inside the per-facet pill row of [`apps/moderator/src/graph/StatementNode.tsx`](../../../apps/moderator/src/graph/StatementNode.tsx) immediately after the substance pill (gated on `disputationOutcome(...) !== null`); StatementNode test cases extended in [`StatementNode.test.tsx`](../../../apps/moderator/src/graph/StatementNode.test.tsx) to cover the agreed/disputed/meta-disagreement/empty/halo-compose combinations.
- Added the `data-hover-popover-section="disputation"` row to the node-target branch of [`apps/moderator/src/graph/HoverPopover.tsx`](../../../apps/moderator/src/graph/HoverPopover.tsx) (six new cases in [`HoverPopover.test.tsx`](../../../apps/moderator/src/graph/HoverPopover.test.tsx), including the edge-popover exclusion and locale parity); the row sits between facets and axiom-marks as Decisions D6 specifies.
- Added nine new i18n keys (per locale) under `moderator.diagnostic.disputationTest.*` in [`packages/i18n-catalogs/src/catalogs/en-US.json`](../../../packages/i18n-catalogs/src/catalogs/en-US.json), [`es-419.json`](../../../packages/i18n-catalogs/src/catalogs/es-419.json), and [`pt-BR.json`](../../../packages/i18n-catalogs/src/catalogs/pt-BR.json); catalog-parity test stays green.
- Verification: `pnpm run check` clean; `pnpm run test:smoke` 3606 passing (+35 over the 3571 baseline); `pnpm -F @a-conversa/moderator build` succeeds; the Playwright canvas-visibility regression (4/4 chromium) is unaffected.
- Playwright e2e is deferred per Acceptance #7 and #8 to `moderator_ui.mod_tests.mod_e2e_playwright.mod_pw_diagnostic_flow`; the stable test seams (`data-disputation-chip`, `data-disputation-outcome`, `data-hover-popover-section="disputation"`) are the contract that future spec inherits.
