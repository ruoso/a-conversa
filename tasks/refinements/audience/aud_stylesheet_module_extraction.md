# Audience stylesheet module extraction (lift `STYLESHEET` + typography exports out of `GraphView.tsx` into a sibling `stylesheet.ts` module)

**TaskJuggler entry**: [tasks/50-audience-and-broadcast.tji](../../50-audience-and-broadcast.tji) — task `audience.aud_graph_rendering.aud_stylesheet_module_extraction` (lines 170-182).
**Effort estimate**: 0.25d (per the `.tji` budget; pure structural refactor with no behavioural change).

**Inherited dependencies**:

- `!audience.aud_graph_rendering.aud_disputed_styling` (settled — shipped 2026-05-27, `complete 100` at [`tasks/50-audience-and-broadcast.tji:155`](../../50-audience-and-broadcast.tji#L155)). This is the third per-state sibling — the leaf that fires the "three callers, extract" trigger named by [`aud_clean_typography.md`](aud_clean_typography.md) Decision §4. With proposed + agreed + disputed selector pairs all layered on `STYLESHEET`, the module-scope constant now carries eight selector entries (baseline node + baseline edge + three per-state pairs) plus the four `BROADCAST_*` typography exports it composes against, and the JSDoc explaining the per-state extension pattern. The empirical "the file gets unwieldy" condition is met.
- Prose-only context (NOT a `.tji` edge): `audience.aud_graph_rendering.aud_proposed_styling` (settled — shipped 2026-05-27, [`tasks/refinements/audience/aud_proposed_styling.md`](aud_proposed_styling.md)). The first per-state pair landed here; its [Decision §4](aud_proposed_styling.md) (`'none'` sentinel for empty per-facet records) is part of the contract `STYLESHEET` consumes via the attribute-equality selectors.
- Prose-only context (NOT a `.tji` edge): `audience.aud_graph_rendering.aud_agreed_styling` (settled — shipped 2026-05-27, [`tasks/refinements/audience/aud_agreed_styling.md`](aud_agreed_styling.md)). Second per-state pair; [Decision §3](aud_agreed_styling.md) named the parallel `aud_stylesheet_state_color_extraction` constants-set extraction (~0.25d) which is independent of this file-level extraction (see Decision §2 below).
- Prose-only context (NOT a `.tji` edge): `audience.aud_graph_rendering.aud_clean_typography` (settled — shipped 2026-05-27, [`tasks/refinements/audience/aud_clean_typography.md`](aud_clean_typography.md)). Decision §4 of that refinement is the explicit named-future-task registration this leaf executes: "extract `STYLESHEET` (and the typography exports that live alongside it) into a `stylesheet.ts` module once three sibling tasks have layered per-state selectors on the file." The four `BROADCAST_NODE_FONT_SIZE_PX` / `BROADCAST_EDGE_FONT_SIZE_PX` / `BROADCAST_NODE_FONT_WEIGHT` / `BROADCAST_EDGE_FONT_WEIGHT` named exports introduced there move alongside `STYLESHEET`.
- Prose-only context (NOT a `.tji` edge): `audience.aud_graph_rendering.aud_cytoscape_init` (settled — shipped 2026-05-27). [Decision §2](aud_cytoscape_init.md) of that refinement established `STYLESHEET` as a module-scope constant whose reference identity must be stable across renders (Cytoscape diffs by reference). The extraction preserves that invariant: the constant is still module-scope; only its file changes.

## What this task is

A pure structural refactor inside `apps/audience/src/graph/`. Extract the module-scope `STYLESHEET: StylesheetJson` constant — currently 80 lines at [`apps/audience/src/graph/GraphView.tsx:191-270`](../../../apps/audience/src/graph/GraphView.tsx#L191) — into a new sibling module `apps/audience/src/graph/stylesheet.ts`. The four `BROADCAST_*` typography named exports at [`GraphView.tsx:139-142`](../../../apps/audience/src/graph/GraphView.tsx#L139) move with it (they are `STYLESHEET`'s composition inputs; the `aud_clean_typography` named-future-task registration explicitly grouped them under the same extraction). The JSDoc block at [`GraphView.tsx:126-190`](../../../apps/audience/src/graph/GraphView.tsx#L126) documenting `STYLESHEET`'s purpose, the per-state extension pattern, Cytoscape's per-selector resolution semantics, and the typography duplication rationale travels verbatim with the constant — historical-record discipline (the JSDoc explains why `STYLESHEET` is shaped the way it is; that prose belongs with the data, not with the consumer).

After this leaf:

- A new file `apps/audience/src/graph/stylesheet.ts` exists, exporting (with full JSDoc preserved):
  - Four `BROADCAST_*` typography constants (named exports, unchanged values: 14 / 11 / 600 / 500).
  - `STYLESHEET: StylesheetJson` (named export, eight selector entries — byte-identical content to the pre-extraction state).
- `apps/audience/src/graph/GraphView.tsx` no longer defines `STYLESHEET` or the typography constants at module scope. It imports `STYLESHEET` from `./stylesheet.js` for the one use site at [`L325`](../../../apps/audience/src/graph/GraphView.tsx#L325) (`style: STYLESHEET` inside the `cytoscape({ ... })` mount). The `BROADCAST_*` constants are not used elsewhere in `GraphView.tsx` and are NOT re-exported from it (Decision §3 — no compat shim).
- `apps/audience/src/graph/GraphView.test.tsx` updates its top-of-file imports: `STYLESHEET` and the four `BROADCAST_*` constants are now pulled from `./stylesheet` (the test file currently pulls them from `./GraphView` at [`L98-105`](../../../apps/audience/src/graph/GraphView.test.tsx#L98)). No new tests, no test-case removal; the existing 34 cases (baseline `aud_cytoscape_init` 12 + `aud_layout_engine` 4 + `aud_clean_typography` 6 + `aud_agreed_styling` 2 + `aud_proposed_styling` 4 + `aud_agreed_styling_mount_assertions` 2 + `aud_disputed_styling` 4) continue unchanged and pass — same assertions, same fixtures, only the import source differs.
- The `BROADCAST_FONT_STACK` import from `@a-conversa/i18n-catalogs` at [`GraphView.tsx:120`](../../../apps/audience/src/graph/GraphView.tsx#L120) moves into `stylesheet.ts` (it is `STYLESHEET`'s dependency, not `GraphView`'s); `GraphView.tsx` drops the import.

Out of scope (deferred to existing or future leaves):

- **`aud_stylesheet_state_color_extraction`** (~0.25d, [`tasks/50-audience-and-broadcast.tji:183-194`](../../50-audience-and-broadcast.tji#L183)). The sibling extraction that hoists per-state hex literals (`#334155` for agreed, `#e11d48` for disputed) into a `STATE_COLORS` named-export constant. The `.tji` note for that task already anticipates this leaf landing first ("once `aud_stylesheet_module_extraction` lands [the constant lives] in `stylesheet.ts`"). Decision §2 below documents why the two extractions stay split rather than folding into one commit.
- **Component-level visual changes.** This is a pure refactor; no selector entry changes, no hex literal changes, no opacity / border-width changes, no JSDoc rewording beyond mechanically updating cross-file references. Behavioural surface is byte-identical post-extraction.
- **Playwright spec for the audience canvas.** The audience surface is still not reachable through any user-flow route ([`apps/audience/src/App.tsx`](../../../apps/audience/src/App.tsx) still maps every path to the placeholder). Per the deferred-e2e exception in `ORCHESTRATOR.md`, pixel coverage continues to defer to `aud_visual_regression` (2d, [`tasks/50-audience-and-broadcast.tji:340-380`](../../50-audience-and-broadcast.tji#L340)) — which already inherits per-state styling deferrals. This leaf adds no new visible behaviour, so no new deferral debt is incurred against `aud_visual_regression` either.
- **Splitting `STYLESHEET` into per-state files** (e.g. `stylesheet/agreed.ts`, `stylesheet/disputed.ts`). Rejected as premature; the module-scope constant must remain stable-by-reference for Cytoscape's diffing, and the single-file source is well under any "this is too big" threshold post-extraction (~120 lines including JSDoc). The aggregator pattern is the next step IF a future state-styling task makes the single file unwieldy AGAIN; not pre-empted here. Same posture as `aud_cytoscape_init.md` Decision §4 ("two callers is YAGNI; extract when the third caller materializes").
- **Moving `layoutOptions.ts` constants into `stylesheet.ts`.** Layout is a different axis (geometric input to the `breadthfirst` algorithm) from stylesheet (rendering output the Cytoscape painter consumes). They share no symbols today; conflating them would muddle the per-axis separation `aud_layout_engine` carved out.
- **Token workspace materialization.** Per ADR 0005's "Workspace realization deferred" consequence and the standing posture across all per-state-styling refinements, `packages/ui-tokens` has not yet materialized; the hex literals stay inline in `stylesheet.ts` and migrate whenever the workspace ships. The extraction this leaf executes is below the token-workspace layer — file-level, not package-level.

## Why it needs to be done

Three forces converge on the extraction:

1. **The "three siblings, extract" trigger fires.** [`aud_clean_typography.md`](aud_clean_typography.md) Decision §4 named this exact task with the trigger condition: "three sibling tasks have layered per-state selectors on `GraphView.tsx`." With `aud_disputed_styling` shipping the third pair (proposed + agreed + disputed), the condition is met. Honouring the trigger pre-emptively prevents the file from absorbing the next several per-state-styling, axiom-mark, and annotation tasks at the same outsized scope — the per-state extension pattern documented in the JSDoc at [`GraphView.tsx:163-172`](../../../apps/audience/src/graph/GraphView.tsx#L163) explicitly expects more selectors to layer on top of `STYLESHEET` (committed, withdrawn, awaiting-proposal, meta-disagreement split, plus axiom-mark / annotation overlays). Each additional selector adds 4-10 lines; without extraction the file grows past the readability threshold quickly.
2. **`GraphView.tsx`'s cognitive scope is "the React mount + element-sync + cyRef seam," not "the visual contract."** Today the file mixes both: the JSDoc at [`L126-190`](../../../apps/audience/src/graph/GraphView.tsx#L126) (Cytoscape's per-selector resolution semantics, typography duplication rationale, per-state extension pattern) and the data (the 80-line `STYLESHEET` constant) coexist with the component (`AudienceGraphView` + props interface + the `useEffect` mount lifecycle + the `useMemo` projection + the layout effect). After extraction, `GraphView.tsx` reads as "the component" and `stylesheet.ts` reads as "the visual contract" — each module is the obvious next-edit destination for its own kind of work. The header refinement-trail in `GraphView.tsx` keeps the decision history; the extracted file gets its own short trail naming the extraction itself.
3. **Test imports already concentrate the constants in one place.** `GraphView.test.tsx` imports `STYLESHEET` + all four `BROADCAST_*` constants from `./GraphView` ([`L98-105`](../../../apps/audience/src/graph/GraphView.test.tsx#L98)). Post-extraction the same import block points at `./stylesheet` — the *test* doesn't gain or lose a single symbol; the only thing that changes is the source path. This is the cleanest possible extraction signal: the test file already treats the constants as a coherent group (it imports them next to each other in a single block), and the source structure is just catching up.

Downstream consumers this leaf unblocks:

- **`aud_stylesheet_state_color_extraction`** (~0.25d, [`tasks/50-audience-and-broadcast.tji:183-194`](../../50-audience-and-broadcast.tji#L183)) has prose anticipating this leaf landing first ("once `aud_stylesheet_module_extraction` lands [the constant lives] in `stylesheet.ts`"). Either ordering is acceptable per the `.tji` notes; this refinement does not assume the ordering but does NOT pre-empt the constant extraction inline (Decision §2).
- **`aud_meta_disagreement_split`** (1d, [`tasks/50-audience-and-broadcast.tji:195-199`](../../50-audience-and-broadcast.tji#L195)). The fourth agreement-layer state. Its selector pair will land in `stylesheet.ts` post-extraction. The cleaner module boundary means that leaf's diff stays surgical (touches one file, not two).
- **`aud_axiom_mark_decoration`** (1d, [`tasks/50-audience-and-broadcast.tji:200-204`](../../50-audience-and-broadcast.tji#L200)) and **`aud_annotation_rendering`** (1d, [`tasks/50-audience-and-broadcast.tji:205-209`](../../50-audience-and-broadcast.tji#L205)). These add additional Cytoscape selectors (overlay-paint primitives, badge selectors) that compose against the same `BROADCAST_FONT_STACK` + typography constants. With the typography exports co-located with `STYLESHEET` in `stylesheet.ts`, these tasks consume a single import block, not two.
- **`aud_per_facet_visualization`** (2d, [`tasks/50-audience-and-broadcast.tji:210-214`](../../50-audience-and-broadcast.tji#L210)). May introduce per-slice color overrides keyed off `data.facetStatuses`. The clean `stylesheet.ts` boundary is where those land.

No new ADR is required (Decision §4). The extraction follows the project convention documented across [`aud_clean_typography.md`](aud_clean_typography.md) Decision §4, [`aud_agreed_styling.md`](aud_agreed_styling.md) Decision §3, and [`aud_cytoscape_init.md`](aud_cytoscape_init.md) Decision §4 ("two callers is YAGNI; extract when the third caller materializes").

## Inputs / context

### Live code the leaf touches

- [`apps/audience/src/graph/GraphView.tsx:1-115`](../../../apps/audience/src/graph/GraphView.tsx#L1) — the header refinement-trail comment block. Extended with a seventh `Refinement:` entry for this task, summarizing the chosen decisions in the same one-line-per-decision style used by the existing six entries.
- [`apps/audience/src/graph/GraphView.tsx:117`](../../../apps/audience/src/graph/GraphView.tsx#L117) — the `cytoscape` import. Stays unchanged in `GraphView.tsx` (the component still calls `cytoscape({ ... })` directly at [`L323`](../../../apps/audience/src/graph/GraphView.tsx#L323)); the `type StylesheetJson` re-export from `'cytoscape'` is no longer needed here (only `stylesheet.ts` uses it). The implementer may narrow the import to drop `StylesheetJson` if no other code in the file references it.
- [`apps/audience/src/graph/GraphView.tsx:120`](../../../apps/audience/src/graph/GraphView.tsx#L120) — the `BROADCAST_FONT_STACK` import from `@a-conversa/i18n-catalogs`. REMOVED from `GraphView.tsx` (the only consumer was `STYLESHEET`'s `node` / `edge` selector entries; both move out). MOVED to `stylesheet.ts`.
- [`apps/audience/src/graph/GraphView.tsx:126-142`](../../../apps/audience/src/graph/GraphView.tsx#L126) — the typography-constants JSDoc and the four `BROADCAST_*` named exports. REMOVED from `GraphView.tsx`. MOVED verbatim to `stylesheet.ts`.
- [`apps/audience/src/graph/GraphView.tsx:144-270`](../../../apps/audience/src/graph/GraphView.tsx#L144) — the `STYLESHEET` JSDoc and the `STYLESHEET: StylesheetJson` named export with eight selector entries. REMOVED from `GraphView.tsx`. MOVED verbatim to `stylesheet.ts`.
- [`apps/audience/src/graph/GraphView.tsx`](../../../apps/audience/src/graph/GraphView.tsx) — new import at the top of the file (after the `cytoscape` import, following the established import-grouping pattern: external deps → workspace deps → relative deps):
  ```ts
  import { STYLESHEET } from './stylesheet.js';
  ```
  No re-export of `STYLESHEET` or the `BROADCAST_*` constants from `GraphView.tsx`; consumers update their import paths (Decision §3).
- [`apps/audience/src/graph/GraphView.tsx:325`](../../../apps/audience/src/graph/GraphView.tsx#L325) — the consumption site `style: STYLESHEET,` inside the `cytoscape({ ... })` mount. UNCHANGED — the symbol now resolves via the new import.
- [`apps/audience/src/graph/GraphView.test.tsx:98-105`](../../../apps/audience/src/graph/GraphView.test.tsx#L98) — the import block pulling `STYLESHEET` + the four `BROADCAST_*` constants from `'./GraphView'`. MODIFIED: source changes to `'./stylesheet'`. The `AudienceGraphView` import stays in its own block from `'./GraphView'`.
- [`apps/audience/src/graph/GraphView.test.tsx:60-71`](../../../apps/audience/src/graph/GraphView.test.tsx#L60) — the header refinement-trail entry block. Extended with a new `Refinement: tasks/refinements/audience/aud_stylesheet_module_extraction.md` entry noting the import-source rewrite and that the existing 34 cases are unchanged.

### New file the leaf creates

- `apps/audience/src/graph/stylesheet.ts` (created). Shape:
  ```ts
  // Audience-side Cytoscape stylesheet + broadcast typography pins.
  //
  // Refinement: tasks/refinements/audience/aud_stylesheet_module_extraction.md
  //   (Decision §1 — module-scope `STYLESHEET` reference-stable across
  //   renders, mirrors `aud_cytoscape_init.md` Decision §2. Decision §2 —
  //   constants-set extraction (`aud_stylesheet_state_color_extraction`)
  //   stays a separate task. Decision §3 — no re-export shim from
  //   `GraphView.tsx`. Decision §4 — no new ADR; mechanical refactor.)
  //
  // History: this module collects the per-state selector decisions
  // landed across `aud_proposed_styling`, `aud_agreed_styling`,
  // `aud_disputed_styling`, and the typography pins from
  // `aud_clean_typography`. See those refinements for the per-decision
  // rationale; this file is the data, GraphView.tsx is the consumer.

  import type { StylesheetJson } from 'cytoscape';

  import { BROADCAST_FONT_STACK } from '@a-conversa/i18n-catalogs';

  /**
   * Broadcast-typography size and weight pins consumed by `STYLESHEET`
   * below. […verbatim JSDoc moved from GraphView.tsx:126-138…]
   */
  export const BROADCAST_NODE_FONT_SIZE_PX = 14 as const;
  export const BROADCAST_EDGE_FONT_SIZE_PX = 11 as const;
  export const BROADCAST_NODE_FONT_WEIGHT = 600 as const;
  export const BROADCAST_EDGE_FONT_WEIGHT = 500 as const;

  /**
   * Cytoscape stylesheet for the audience broadcast surface. […verbatim
   * JSDoc moved from GraphView.tsx:144-190…]
   */
  export const STYLESHEET: StylesheetJson = [
    /* …verbatim eight selector entries… */
  ];
  ```
  Header trail format mirrors the pattern established by `cytoscapeTestEnv.ts`, `facetStatus.ts`, `layoutOptions.ts`, `projectGraph.ts` (each starts with a brief module-purpose comment + one `Refinement:` entry per refinement that materially shaped the file). For this leaf the trail has a single entry (this refinement). The JSDoc on the constants stays verbatim.

### ADRs

- [ADR 0004 — Graph libraries: ReactFlow + Cytoscape.js](../../../docs/adr/0004-graph-libraries-reactflow-and-cytoscape.md) — the audience uses Cytoscape's stylesheet for all rendering; module-scope is required for reference-stability under Cytoscape's diff-by-reference posture. The extraction preserves the invariant: the constant is still module-scope; only its file location changes.
- [ADR 0005 — Styling: Tailwind v4 + shared tokens](../../../docs/adr/0005-styling-tailwind-with-shared-tokens.md) — the per-facet state visual contract documented at L19 stays implemented in `STYLESHEET`'s selector entries; the extraction does not regress the contract. The "Workspace realization deferred" consequence still applies: hex literals stay inline and migrate when the token workspace ships.
- [ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md) — Vitest is the regression coverage for the refactor. The existing 34 cases re-run unchanged and pass; that IS the pin. No "I diffed the bundled output by hand" smoke; no scratch verification scripts.
- [ADR 0026 — Micro-frontend root app](../../../docs/adr/0026-micro-frontend-root-app.md) — the new `stylesheet.ts` ships inside the audience workspace's compiled artifact; no cross-surface export. Module-internal-only; not surfaced through the audience package's public API.
- [ADR 0027 — Entity and facet layers are strictly separate](../../../docs/adr/0027-entity-and-facet-layers-strict-separation.md) — orthogonal; the agreement-layer selector entries in `STYLESHEET` continue to key on the per-element `data.rollupStatus` field (the agreement-layer rollup) without entity-layer contamination.

### Sibling refinements

- [`tasks/refinements/audience/aud_cytoscape_init.md`](aud_cytoscape_init.md) Decision §2 — module-scope stylesheet + reference-stable invariant. Decision §4 — "two callers is YAGNI; extract when the third caller materializes." Both invariants honoured.
- [`tasks/refinements/audience/aud_proposed_styling.md`](aud_proposed_styling.md) — the first per-state selector pair shipped here; `'none'` sentinel posture at Decision §4 is the contract attribute-equality selectors consume.
- [`tasks/refinements/audience/aud_agreed_styling.md`](aud_agreed_styling.md) — second per-state pair. Decision §3 named the parallel constants-set extraction (`aud_stylesheet_state_color_extraction`); see Decision §2 below for the split rationale.
- [`tasks/refinements/audience/aud_clean_typography.md`](aud_clean_typography.md) Decision §4 — the named-future-task registration this leaf executes. Decision §3 — typography sizes / weights that travel with `STYLESHEET`. Decision §5 — `font-family` on both `node` and `edge` selectors (the per-selector duplication that the JSDoc paragraph at [`L182-189`](../../../apps/audience/src/graph/GraphView.tsx#L182) documents; travels with the constant).
- [`tasks/refinements/audience/aud_disputed_styling.md`](aud_disputed_styling.md) Decision §6 — the third-sibling trigger; named both this leaf and the parallel `aud_stylesheet_state_color_extraction`, and explicitly allowed the closer to fold them into a single task. This refinement does not fold them (Decision §2); closer may revise.

### What the surface MUST NOT do

- **No selector-entry change.** No new selector, no removed selector, no field reordering inside a selector entry, no value change. The eight selector entries in `STYLESHEET` move byte-for-byte: same string keys, same hex literals, same numeric widths, same `BROADCAST_*` constant references. If a fixer pass during implementation surfaces an unrelated style improvement (e.g. consistent quote style across keys, ordering of fields inside a selector), the implementer DEFERS it to a separate commit per ADR 0022's no-throwaway discipline and the "one task = one diff" posture.
- **No re-export from `GraphView.tsx`.** Decision §3 — consumers update their import path; no `export { STYLESHEET, BROADCAST_NODE_FONT_SIZE_PX, … } from './stylesheet.js'` compat shim.
- **No edit to `apps/audience/src/graph/projectGraph.ts` / `.test.ts`, `facetStatus.ts` / `.test.ts`, `layoutOptions.ts` / `.test.ts`, `cytoscapeTestEnv.ts` / `.test.ts`.** None of these modules import the typography constants or `STYLESHEET` today; the extraction is transparent to them.
- **No edit to `apps/audience/src/App.tsx`, `apps/audience/src/index.css`, `apps/audience/src/main.tsx`, `apps/audience/src/state/**`, `apps/audience/src/ws/**`.**
- **No edit to `apps/audience/package.json`.** No new dependency; the new file imports the same `cytoscape` types and `@a-conversa/i18n-catalogs` symbol that `GraphView.tsx` already imports today.
- **No edit to `apps/participant`, `apps/moderator`, `apps/root`, `apps/server`.** The extraction is audience-workspace-internal.
- **No edit to `packages/**`.** No `BROADCAST_FONT_STACK` re-shape; the import path on `@a-conversa/i18n-catalogs` stays as-is.
- **No edit to `tasks/50-audience-and-broadcast.tji` or other `.tji` files beyond the `complete 100` marker on the `aud_stylesheet_module_extraction` block** (the closer's ritual per [`README.md`](../README.md)). The two named-future-task entries (`aud_stylesheet_module_extraction` itself + the sibling `aud_stylesheet_state_color_extraction`) already exist; they were registered during the `aud_disputed_styling` closer ritual.
- **No new ADR.** The extraction is mechanical; the pattern is documented across the predecessor refinements.
- **No bundle-size optimization, no tree-shaking rework, no `as const` proliferation.** The current `as const` annotations on the typography constants travel verbatim; no additional const-narrowing.

## Constraints / requirements

### Files this task touches (explicit allowlist)

- `apps/audience/src/graph/stylesheet.ts` — CREATED. New file, ~140 lines including JSDoc:
  - Short header comment (module purpose + single `Refinement:` entry).
  - Two imports: `type StylesheetJson` from `'cytoscape'`, `BROADCAST_FONT_STACK` from `'@a-conversa/i18n-catalogs'`.
  - Typography JSDoc block (verbatim from `GraphView.tsx:126-138`).
  - Four `BROADCAST_*` named exports (verbatim).
  - `STYLESHEET` JSDoc block (verbatim from `GraphView.tsx:144-190`).
  - `STYLESHEET: StylesheetJson` named export with the eight existing selector entries (verbatim).
- `apps/audience/src/graph/GraphView.tsx` — MODIFIED:
  - Header refinement-trail block: insert seventh `Refinement: tasks/refinements/audience/aud_stylesheet_module_extraction.md` entry summarizing this refinement's decisions in the same one-line-per-decision style used by entries 1–6 (immediately before the existing `ADRs:` block at [`L93`](../../../apps/audience/src/graph/GraphView.tsx#L93)).
  - Remove the `BROADCAST_FONT_STACK` import line (currently [`L120`](../../../apps/audience/src/graph/GraphView.tsx#L120)).
  - Add new import: `import { STYLESHEET } from './stylesheet.js';` in the relative-imports group (alongside `./layoutOptions.js` and `./projectGraph.js`).
  - Narrow the `cytoscape` import if `StylesheetJson` is no longer referenced anywhere else in the file: drop `type StylesheetJson` from the type-import list, keeping `Core` and `ElementDefinition`.
  - Remove the typography JSDoc block + four `BROADCAST_*` named exports ([`L126-142`](../../../apps/audience/src/graph/GraphView.tsx#L126)).
  - Remove the `STYLESHEET` JSDoc block + the eight-entry array ([`L144-270`](../../../apps/audience/src/graph/GraphView.tsx#L144)).
  - The component's consumption of `STYLESHEET` at [`L325`](../../../apps/audience/src/graph/GraphView.tsx#L325) is unchanged — same symbol, new source.
- `apps/audience/src/graph/GraphView.test.tsx` — MODIFIED:
  - Header refinement-trail block: insert a new `Refinement:` entry noting that the import source for `STYLESHEET` + the four `BROADCAST_*` constants moved from `./GraphView` to `./stylesheet`, that no test cases change, and that the existing 34 cases (a–hh) re-run unchanged.
  - Replace the single combined import block at [`L98-105`](../../../apps/audience/src/graph/GraphView.test.tsx#L98) with two import blocks:
    ```ts
    import { AudienceGraphView } from './GraphView';
    import {
      BROADCAST_EDGE_FONT_SIZE_PX,
      BROADCAST_EDGE_FONT_WEIGHT,
      BROADCAST_NODE_FONT_SIZE_PX,
      BROADCAST_NODE_FONT_WEIGHT,
      STYLESHEET,
    } from './stylesheet';
    ```
  - Body of the test cases — UNCHANGED. `findStylesheetEntry` helper, all 34 cases, all fixtures, all assertions, all describe-block titles — all verbatim. The only thing the test file's source code knows about this leaf is one import-line rewrite.

### Files this task does NOT touch

- `apps/audience/src/graph/projectGraph.ts`, `apps/audience/src/graph/projectGraph.test.ts`, `apps/audience/src/graph/facetStatus.ts`, `apps/audience/src/graph/facetStatus.test.ts`, `apps/audience/src/graph/layoutOptions.ts`, `apps/audience/src/graph/layoutOptions.test.ts`, `apps/audience/src/graph/cytoscapeTestEnv.ts`, `apps/audience/src/graph/cytoscapeTestEnv.test.ts` — UNCHANGED.
- `apps/audience/src/App.tsx`, `apps/audience/src/main.tsx`, `apps/audience/src/index.css` — UNCHANGED.
- `apps/audience/src/state/**`, `apps/audience/src/ws/**`, `apps/audience/package.json`, `apps/audience/tsconfig.json` — UNCHANGED.
- `apps/participant/**`, `apps/moderator/**`, `apps/root/**`, `apps/server/**` — UNCHANGED.
- `packages/**` — UNCHANGED.
- `docs/adr/**` — UNCHANGED. No new ADR (Decision §4).
- `playwright.config.ts`, `tests/e2e/**` — UNCHANGED. Playwright continues to defer to `aud_visual_regression` (Decision §5 in the predecessor styling refinements; not re-litigated here).
- `tasks/50-audience-and-broadcast.tji` — only `complete 100` lands on the `aud_stylesheet_module_extraction` block as the closer's ritual. The parallel sibling task `aud_stylesheet_state_color_extraction` is NOT marked complete (it is a separate task — see Decision §2).
- `tasks/99-milestones.tji` — UNCHANGED. The two extraction tasks were not on any milestone's critical path.

## Acceptance criteria

The check that says "done":

- A new file `apps/audience/src/graph/stylesheet.ts` exists with the shape outlined in Inputs / context. It exports `STYLESHEET: StylesheetJson` (eight selector entries, byte-identical content to the pre-extraction `GraphView.tsx` definition), the four `BROADCAST_*` named-export constants with their existing values + `as const` annotations, and carries the JSDoc blocks for both groups verbatim from `GraphView.tsx`.
- `apps/audience/src/graph/GraphView.tsx` no longer defines `STYLESHEET`, the four `BROADCAST_*` constants, or their JSDoc blocks at module scope. It imports `STYLESHEET` from `./stylesheet.js`. The `cytoscape` import drops `type StylesheetJson` (keeps `Core`, `ElementDefinition`). The `BROADCAST_FONT_STACK` import from `@a-conversa/i18n-catalogs` is removed (moved to `stylesheet.ts`).
- `apps/audience/src/graph/GraphView.test.tsx` imports `STYLESHEET` + the four `BROADCAST_*` constants from `./stylesheet` (not `./GraphView`). The `AudienceGraphView` import continues to come from `./GraphView`. All 34 existing cases (a–hh) re-run unchanged.
- The header refinement-trail block in `GraphView.tsx` gains a seventh `Refinement:` entry for this task. The header refinement-trail block in `GraphView.test.tsx` gains an entry for this task. The new `stylesheet.ts` has its own short refinement-trail entry.
- `pnpm run check` is clean (strict TS pass; no new dep declared; type imports narrow correctly).
- `pnpm run test:smoke` is green; the Vitest case count is exactly 34 in `GraphView.test.tsx` (no new cases added, none removed). Per the memory rule on test output handling, the implementer runs `pnpm run test:smoke > /tmp/aud-stylesheet-extraction-test.log 2>&1` and dispatches an Explore sub-agent to summarize the pass/fail surface.
- `pnpm -F @a-conversa/audience build` succeeds. Bundle-size delta is essentially zero (a single module-boundary insertion with the same exported symbols; Vite's tree-shaking continues to inline `STYLESHEET` at the use site).
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent (pre-commit hook enforces this) once the closer adds `complete 100` to the `aud_stylesheet_module_extraction` block.
- `tasks/50-audience-and-broadcast.tji` gets `complete 100` on `aud_stylesheet_module_extraction` in the closer's ritual commit.
- Per the deferred-e2e exception in `ORCHESTRATOR.md`: Playwright coverage continues to defer to `aud_visual_regression` (2d, [`tasks/50-audience-and-broadcast.tji:340-380`](../../50-audience-and-broadcast.tji#L340)). No new note extension on `aud_visual_regression` is required — this leaf adds no new visible behaviour, so no new pixel-stability deferral is incurred (the existing layout / typography / per-state deferrals already cover the rendered output, which is byte-identical post-extraction).
- Per ADR 0022, no throwaway smoke scripts. The Vitest layer's 34 unchanged cases pin the structural and mount-time behaviour; the build's TypeScript pass pins the module-graph correctness; the test-file import path rewrite pins the new module boundary.

## Decisions

### §1 — Module-scope `STYLESHEET` in the new file (preserve reference-stability invariant)

`STYLESHEET` MUST remain a module-scope `const` in `stylesheet.ts`. Cytoscape's stylesheet diff is reference-identity-based: passing a fresh array literal on each render causes Cytoscape to re-evaluate the entire stylesheet, which both wastes work and (per the JSDoc at [`GraphView.tsx:146-148`](../../../apps/audience/src/graph/GraphView.tsx#L146)) can flash the canvas. The extraction is purely a "which file does the symbol live in" change; the symbol-identity contract carries over.

Three approaches considered:

- **(A — chosen)** Module-scope `const` in `stylesheet.ts`, single named export. Cost: zero — same posture as the current `GraphView.tsx` definition. Benefit: reference-stable across every render that imports it (modules are evaluated once per program lifetime); identical to the pre-extraction invariant.
- **(B)** Factory function (`buildStylesheet(): StylesheetJson`) that returns a fresh array. Rejected — would regress the reference-stability invariant; Cytoscape would diff against a different array each call. The only reason to introduce a factory would be parameterization (e.g. broadcast vs in-room mode), and no parameterization is in scope today. YAGNI.
- **(C)** Class-style wrapper (`new AudienceStylesheet()` with cached internal state). Rejected — no behavioural advantage over the const; introduces lifecycle questions (when to instantiate, where to cache the instance) that the current pattern sidesteps. The constant is the simpler abstraction with one call site today.

The invariant pinned by `aud_cytoscape_init.md` Decision §2 ("module-scope stylesheet + numeric width/height") is honoured.

### §2 — Keep the constants-set extraction (`aud_stylesheet_state_color_extraction`) as a separate task

The `.tji` registers TWO extraction tasks at the same trigger:

- `aud_stylesheet_module_extraction` (this task, 0.25d) — file-level: move `STYLESHEET` + typography exports into a sibling module.
- `aud_stylesheet_state_color_extraction` (sibling, 0.25d) — symbol-level: hoist `#334155` (agreed) and `#e11d48` (disputed) into a `STATE_COLORS = { agreed: '#334155', disputed: '#e11d48' } as const` named-export constant inside the new module.

Three approaches:

- **(A — chosen)** Land only the file-level extraction in this commit. Cost: the per-state hex literals stay inline in `STYLESHEET`'s selector entries until the sibling task lands. Benefit: surgical diff — one file created, two files modified (`GraphView.tsx`, `GraphView.test.tsx`), no symbol-level reshape mixed in. The two extractions exercise different reviewer focus areas (file-boundary vs constant-grouping); keeping them split lets each diff be reviewed for its own merit.
- **(B)** Land both extractions in one commit (the closer's option per [`aud_disputed_styling.md`](aud_disputed_styling.md) Decision §6). Cost: triples the diff size — adds the `STATE_COLORS` constant + JSDoc + four new in-selector references + four new test imports + the symbol-naming decision (`STATE_COLORS` vs `ROLLUP_STATE_COLORS` vs `STATE_PALETTE` is a non-obvious choice the sibling task's refinement should own). Rejected on the same scope-creep principle that kept `aud_disputed_styling`'s mount-time cases inline while deferring the constants extraction: each task should ship one decision per diff.
- **(C)** Skip both extractions and let `STYLESHEET` keep growing inline in `GraphView.tsx`. Rejected — the trigger has fired; the named-future-task registration was explicit; skipping would erode the convention.

The closer's discretion to fold the two extractions into a single commit (per `aud_disputed_styling.md` Decision §6's last paragraph) remains valid; this refinement does not pre-empt that discretion but recommends against it (Option (B) above). If the closer DOES fold them, `aud_stylesheet_state_color_extraction` also gets `complete 100` and its refinement document is also written / Status-blocked in the same commit cluster. This refinement does not assume the folding.

### §3 — No backward-compatibility re-export from `GraphView.tsx`

`GraphView.tsx` does NOT re-export `STYLESHEET` or the four `BROADCAST_*` constants. Consumers (today: `GraphView.test.tsx`) update their import path to `./stylesheet`.

Three approaches:

- **(A — chosen)** Clean cut. Consumers update their import path; no compat shim. Cost: one test-file import-line rewrite (a single change in a single file, since `GraphView.test.tsx` is the only consumer today). Benefit: the module boundary is honest — `stylesheet.ts` owns the visual contract; `GraphView.tsx` owns the React mount. No "this is technically also exported from over there" footgun for future readers.
- **(B)** Re-export everything from `GraphView.tsx` (`export { STYLESHEET, BROADCAST_NODE_FONT_SIZE_PX, … } from './stylesheet.js';`). Cost: drift risk — future readers searching for `STYLESHEET`'s definition would find `GraphView.tsx`'s re-export and have to chase one more hop before reaching the actual source. Rejected — the entire point of the extraction is to make `GraphView.tsx` smaller and clearer; re-exporting the symbols defeats the purpose.
- **(C)** Re-export only `STYLESHEET` (not the typography constants), on the rationale that `STYLESHEET` is the most-imported symbol. Rejected — same drift-risk concern as (B), and the test file's existing import block already groups all five symbols together; splitting the import source by symbol would muddle the consumer's mental model.

Searched the workspace for any consumer outside the test file: none. `apps/audience/src/main.tsx`, `apps/audience/src/App.tsx`, `apps/audience/src/state/**`, `apps/audience/src/ws/**`, the other modules in `apps/audience/src/graph/**`, the moderator / participant / root / server workspaces, the shared packages — none import `STYLESHEET` or any of the `BROADCAST_*` constants from `GraphView.tsx`. The clean cut is genuinely cheap.

### §4 — No new ADR

The extraction is a mechanical refactor with no architectural choice. The "extract at the third caller" pattern is documented as project convention by multiple predecessor refinements ([`aud_clean_typography.md`](aud_clean_typography.md) Decision §4, [`aud_agreed_styling.md`](aud_agreed_styling.md) Decision §3, [`aud_cytoscape_init.md`](aud_cytoscape_init.md) Decision §4). No new dependency, no new module-boundary contract that isn't already implicit in the existing import graph, no security or test-shape consideration that surfaces a question. An ADR would be process overhead with no decision content.

Mirrors the no-new-ADR posture of the predecessor styling refinements (none of `aud_proposed_styling`, `aud_agreed_styling`, `aud_disputed_styling` introduced a new ADR; each cited existing ones).

### §5 — JSDoc travels with the constants, not with the consumer

The 65-line JSDoc block at [`GraphView.tsx:144-190`](../../../apps/audience/src/graph/GraphView.tsx#L144) (covering Cytoscape's per-selector resolution, the per-state extension pattern, the `'none'` sentinel posture, typography duplication rationale) describes WHY `STYLESHEET` is shaped the way it is. The 12-line typography JSDoc at [`GraphView.tsx:126-138`](../../../apps/audience/src/graph/GraphView.tsx#L126) does the same for the `BROADCAST_*` constants. Both blocks MUST move verbatim into `stylesheet.ts` alongside the constants they describe.

Three approaches:

- **(A — chosen)** Move both JSDoc blocks verbatim into `stylesheet.ts`. Cost: ~80 lines move with the data. Benefit: the historical-record discipline ([`README.md`](../README.md) "Prior content stays untouched") matches the data's new location. A reader navigating from a `STYLESHEET` selector mismatch into `stylesheet.ts` immediately sees the per-selector resolution semantics; a reader staying in `GraphView.tsx` (now smaller, easier to read) does not have to scroll past 80 lines of stylesheet rationale to reach the component definition.
- **(B)** Move only the constants; leave the JSDoc behind in `GraphView.tsx` as a documentation pointer. Rejected — the JSDoc would be orphaned: it explains a constant that no longer lives in `GraphView.tsx`. Future edits to the JSDoc would target the wrong file.
- **(C)** Move the JSDoc but trim / paraphrase it in transit. Rejected — the JSDoc is the historical record (it documents which sibling tasks contributed each selector, the typography-duplication rationale `aud_clean_typography.md` Decision §5 set down, etc.); trimming during the extraction would silently change the documented contract. ADR 0022's no-throwaway discipline applies to documentation too — the JSDoc was written deliberately; it stays.

The implementer may make purely mechanical adjustments to the JSDoc (e.g. updating a `@see GraphView.tsx:171` cross-reference to `@see stylesheet.ts`); no substantive rewording.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-27.

- Created `apps/audience/src/graph/stylesheet.ts`: new sibling module exporting `STYLESHEET: StylesheetJson` (eight selector entries, byte-identical) and four `BROADCAST_*` typography constants with full verbatim JSDoc from `GraphView.tsx`.
- Modified `apps/audience/src/graph/GraphView.tsx`: removed `STYLESHEET`, four `BROADCAST_*` constants, their JSDoc, and the `BROADCAST_FONT_STACK` import; added `import { STYLESHEET } from './stylesheet.js'`; narrowed `cytoscape` import to drop `type StylesheetJson`; added seventh `Refinement:` entry to header trail.
- Modified `apps/audience/src/graph/GraphView.test.tsx`: updated import block at L98-105 to pull `STYLESHEET` + four `BROADCAST_*` constants from `'./stylesheet'` instead of `'./GraphView'`; added `Refinement:` entry to header trail. All 34 cases (a–hh) re-run unchanged.
- Pure structural refactor — no selector-entry change, no behavioural delta, no new ADR; `aud_stylesheet_state_color_extraction` remains open as the sibling task (already registered in `tasks/50-audience-and-broadcast.tji:183-194`).
