# Audience stylesheet state-color extraction (hoist per-state hex literals into a `STATE_COLORS` named-export constant inside `stylesheet.ts`)

**TaskJuggler entry**: [tasks/50-audience-and-broadcast.tji](../../50-audience-and-broadcast.tji) — task `audience.aud_graph_rendering.aud_stylesheet_state_color_extraction` (lines 184-195).
**Effort estimate**: 0.25d (per the `.tji` budget; pure symbol-level refactor with no behavioural change — six hex literals collapse to two named references).

**Inherited dependencies**:

- `!audience.aud_graph_rendering.aud_disputed_styling` (settled — shipped 2026-05-27, `complete 100` at [`tasks/50-audience-and-broadcast.tji:155`](../../50-audience-and-broadcast.tji#L155)). This is the third per-state sibling — the leaf that fires the "three per-state callers, extract" trigger named by [`aud_agreed_styling.md`](aud_agreed_styling.md) Decision §3. With proposed + agreed + disputed selector pairs all layered on `STYLESHEET`, two of the per-state pairs (`agreed`, `disputed`) carry color literals on three style fields each (agreed: `border-color` on the node entry, `line-color` + `target-arrow-color` on the edge entry; disputed: identical shape). The trigger condition the predecessor refinements named — "the third per-state sibling lands" — is met.
- Prose-only context (NOT a `.tji` edge): `audience.aud_graph_rendering.aud_stylesheet_module_extraction` (settled — shipped 2026-05-27, [`tasks/refinements/audience/aud_stylesheet_module_extraction.md`](aud_stylesheet_module_extraction.md), commit `70026f0`). The file-level extraction sibling. Its [Decision §2](aud_stylesheet_module_extraction.md) kept the constants-set extraction split from the file-level extraction; this leaf executes the deferred half. Because that leaf already shipped, the per-state hex literals now live in `apps/audience/src/graph/stylesheet.ts` (at [`L145`, `L151-152`, `L172`, `L179-180`](../../../apps/audience/src/graph/stylesheet.ts#L145)) rather than in `GraphView.tsx`; this leaf hoists them inside that same module — `STATE_COLORS` becomes a sibling named export to `STYLESHEET`.
- Prose-only context (NOT a `.tji` edge): `audience.aud_graph_rendering.aud_agreed_styling` (settled — shipped 2026-05-27, [`tasks/refinements/audience/aud_agreed_styling.md`](aud_agreed_styling.md)). [Decision §3](aud_agreed_styling.md) is the explicit named-future-task registration this leaf executes: "hoist a `STATE_COLORS = { agreed: '#334155', proposed: '#94a3b8', disputed: '#dc2626', … } as const` record once a third per-state sibling lands." The disputed-state task subsequently revised the disputed hex to `#e11d48` (rose-600) per `aud_disputed_styling.md` Decision §2; the constant this leaf creates uses the as-shipped value, not the speculative hex in the predecessor refinement's prose.
- Prose-only context (NOT a `.tji` edge): `audience.aud_graph_rendering.aud_disputed_styling` (settled — see above). [Decision §6](aud_disputed_styling.md) names this leaf as one of two stylesheet extractions registered at the third-sibling trigger; the other (`aud_stylesheet_module_extraction`) has already shipped. The same Decision §6 allowed the closer to fold the two extractions into one task; the closer chose to keep them split (separate `complete 100` ritual on the module-extraction commit, with this task remaining open). This refinement honours that split.
- Prose-only context (NOT a `.tji` edge): `audience.aud_graph_rendering.aud_proposed_styling` (settled — shipped 2026-05-27, [`tasks/refinements/audience/aud_proposed_styling.md`](aud_proposed_styling.md)). The proposed-state selector pair carries NO color literal (it differentiates via `border-style: 'dashed'` + `opacity: 0.6` on nodes, `line-style: 'dashed'` + `opacity: 0.6` on edges; see [`stylesheet.ts:155-167`](../../../apps/audience/src/graph/stylesheet.ts#L155)). The `STATE_COLORS` constant therefore covers two of the three per-state pairs, not three; Decision §2 below documents why the third slot is omitted rather than left as `undefined` or filled with a speculative neutral.
- Prose-only context (NOT a `.tji` edge): `audience.aud_graph_rendering.aud_cytoscape_init` (settled — shipped 2026-05-27, [`tasks/refinements/audience/aud_cytoscape_init.md`](aud_cytoscape_init.md)). [Decision §2](aud_cytoscape_init.md) established `STYLESHEET` as a module-scope constant whose reference identity must be stable across renders. The extraction this leaf does is symbol-internal: the `STATE_COLORS` constant resolves at module-evaluation time and is interpolated into the literal `STYLESHEET` array; the resulting array is byte-identical to the pre-extraction form, and remains module-scope-and-reference-stable.

## What this task is

A pure symbol-level refactor inside `apps/audience/src/graph/stylesheet.ts`. The per-state hex literals currently inline in the `STYLESHEET` selector entries — `#334155` (slate-700; agreed) at [`stylesheet.ts:145`](../../../apps/audience/src/graph/stylesheet.ts#L145), [`L151-152`](../../../apps/audience/src/graph/stylesheet.ts#L151), and `#e11d48` (rose-600; disputed) at [`L172`](../../../apps/audience/src/graph/stylesheet.ts#L172), [`L179-180`](../../../apps/audience/src/graph/stylesheet.ts#L179) — get hoisted into a single module-scope `STATE_COLORS` named export. The six occurrences of those two strings inside the array literal become six references to `STATE_COLORS.agreed` / `STATE_COLORS.disputed`.

After this leaf:

- A new named export at module scope in `stylesheet.ts`:
  ```ts
  export const STATE_COLORS = {
    agreed: '#334155',
    disputed: '#e11d48',
  } as const;
  ```
  Placed above `STYLESHEET` (so the `STYLESHEET` array can reference it), below the `BROADCAST_*` typography exports (so the existing "constants → typography → stylesheet" reading order is preserved), with a short JSDoc explaining the per-state-color convention and the cross-surface palette match against the moderator's `mod_*_state_styling` refinements.
- The `STYLESHEET` array's six color-literal sites swap to `STATE_COLORS.agreed` / `STATE_COLORS.disputed` references. The selector keys, style field keys, the `border-width: 3` numeric on the disputed node entry, the `'dashed'` / `0.6` values on the proposed entries, all baseline colors (`#ffffff`, `#cbd5e1`, `#0f172a` on the baseline node; `#94a3b8`, `#ffffff`, `#475569` on the baseline edge) — UNCHANGED. The selector entry ORDER is unchanged. The number of selector entries (eight) is unchanged.
- The `STYLESHEET` array's runtime-evaluated VALUES are byte-identical post-extraction: `STATE_COLORS.agreed` resolves to `'#334155'` and is interpolated into the literal at module-evaluation time; readers iterating the array see the same hex strings they saw before.
- The module's header refinement-trail comment block gains an entry for this refinement, in the same one-line-per-decision style established by the existing entry.
- `GraphView.test.tsx`'s existing structural assertions against `'#334155'` / `'#e11d48'` (cases (w), (x), (ee), (ff)) continue to pass unchanged — they assert on the resolved values inside the array, not on which symbol the source quoted. Decision §4 below documents why the test file does NOT switch to asserting against `STATE_COLORS.agreed` / `STATE_COLORS.disputed`.

Out of scope (deferred to existing or future leaves):

- **Hoisting baseline colors.** The five baseline-color literals (`#ffffff`, `#cbd5e1`, `#0f172a` on the baseline `node`; `#94a3b8`, `#475569` on the baseline `edge`; and `#ffffff` on `text-background-color`) describe the canvas surface and node/edge defaults — they are NOT per-state colors. They live a different categorical axis from `STATE_COLORS` and do not belong in the same constant. If a future "extract baseline palette" task fires (the trigger would be ADR 0005's `packages/ui-tokens` workspace materializing, OR a sibling task wanting to compose against `BASELINE_NODE_BACKGROUND` arithmetically), it gets its own refinement and its own constant (`BASELINE_COLORS` or whatever name the predecessor refinement assigns). This leaf does NOT pre-empt that scope.
- **A slot for `proposed`.** The proposed-state selector pair differentiates via `border-style` / `line-style` (`'dashed'`) + `opacity` (`0.6`), with no color override. Adding `STATE_COLORS.proposed` would require either a speculative color value (rejected — invents a contract that no existing selector consumes) or a `null` / `undefined` slot (rejected — `as const` typing would either widen the object to `{ agreed: string; proposed: null; disputed: string }` and break the "every entry is a usable color" invariant, or force callers to handle the absence). Decision §2 below documents the omission.
- **Slots for `meta-disagreement`, `committed`, `withdrawn`, `awaiting-proposal`.** These four agreement-layer states exist in `ROLLUP_PRIORITY` at [`apps/audience/src/graph/facetStatus.ts:526-534`](../../../apps/audience/src/graph/facetStatus.ts#L526) but no `STYLESHEET` selector pair has shipped for them yet (their leaves — `aud_meta_disagreement_split` (1d), and closer/maintainer-registered future leaves for the others — are still open). Adding speculative entries now would invent visual contracts that the responsible refinements should own. Future per-state styling leaves grow the constant one entry at a time as they decide their color (or skip it if they differentiate on a non-color axis). Decision §3 below codifies the "grow-as-needed" posture.
- **Renaming the constant to `ROLLUP_STATE_COLORS` or `STATE_PALETTE`.** Considered and rejected at Decision §3 below; `STATE_COLORS` is the name the predecessor refinements ([`aud_agreed_styling.md`](aud_agreed_styling.md) Decision §3, [`aud_disputed_styling.md`](aud_disputed_styling.md) Decision §6) used in their named-future-task registration, and matching that name keeps the refinement-trail discoverable via grep.
- **Token workspace materialization.** Per ADR 0005's "Workspace realization deferred" consequence and the standing posture across all per-state-styling refinements, `packages/ui-tokens` has not yet materialized; the hex literals stay inline inside `STATE_COLORS` and migrate whenever the workspace ships. The extraction this leaf executes is below the token-workspace layer — module-scope inside one workspace, not package-level.
- **Updating `GraphView.test.tsx` to import `STATE_COLORS`.** Decision §4 keeps the structural assertions on the hex-literal values, so the test file does NOT gain a `STATE_COLORS` import. The test pins observable values (what the array looks like to Cytoscape after evaluation), not source-code shape.
- **Re-exporting `STATE_COLORS` from `GraphView.tsx`.** No consumer outside `stylesheet.ts` itself needs `STATE_COLORS` today (the `STYLESHEET` array is the only reader). Decision §5 keeps the export single-source — anyone needing the constant in a future task imports it directly from `'./stylesheet'`.
- **Component-level visual changes.** This is a pure refactor; no selector entry changes, no hex value changes, no opacity / border-width changes, no JSDoc rewording beyond adding one paragraph explaining `STATE_COLORS`. Behavioural surface — what Cytoscape paints — is byte-identical post-extraction.
- **A Playwright spec for the audience canvas.** The audience surface is still not reachable through any user-flow route ([`apps/audience/src/App.tsx`](../../../apps/audience/src/App.tsx) still maps every path to the placeholder). Per the deferred-e2e exception in `ORCHESTRATOR.md`, pixel coverage continues to defer to `aud_visual_regression` (2d, [`tasks/50-audience-and-broadcast.tji:340-380`](../../50-audience-and-broadcast.tji#L340)). This leaf adds no new visible behaviour, so no new deferral debt is incurred against `aud_visual_regression`.

## Why it needs to be done

Three forces converge on the extraction:

1. **The "three siblings, extract" trigger fires (color variant).** [`aud_agreed_styling.md`](aud_agreed_styling.md) Decision §3 named THIS exact task with the trigger condition: "three per-state selectors layer on the file." With `aud_disputed_styling` shipping the third per-state pair (proposed + agreed + disputed), the condition is met. The trigger is the same threshold the predecessor refinements applied to other extractions — `aud_clean_typography.md` Decision §3 for named-export typography constants, `aud_cytoscape_init.md` Decision §4 for the test-env helper extraction, and `aud_clean_typography.md` Decision §4 for the file-level extraction that just shipped. Honouring the trigger pre-emptively means the next per-state-styling task (`aud_meta_disagreement_split`, then committed / withdrawn / awaiting-proposal) does NOT have to scope "and hoist the constant too" inline — they grow `STATE_COLORS` by one entry as a one-line edit.
2. **Cross-surface palette consistency is easier to verify when the colors are named.** The audience palette intentionally matches the moderator's (`#334155` = slate-700 = agreed on both surfaces; `#e11d48` = rose-600 = disputed on both surfaces; see [`aud_agreed_styling.md`](aud_agreed_styling.md) Decision §2 and [`aud_disputed_styling.md`](aud_disputed_styling.md) Decision §2). Today a reader confirming the match has to scan three selector entries in `stylesheet.ts` and compare hex literals across six sites; after the extraction the reader sees one `STATE_COLORS` object whose JSDoc names the cross-surface match and points at the moderator's `mod_*_state_styling` refinements. The refactor turns "verify by grep" into "verify by reading one constant" — same kind of clarity win the typography exports got when `aud_clean_typography` named them rather than leaving them inline.
3. **The named-future-task registration was explicit.** [`aud_agreed_styling.md`](aud_agreed_styling.md) Decision §3 and [`aud_disputed_styling.md`](aud_disputed_styling.md) Decision §6 both named this leaf by name (`aud_stylesheet_state_color_extraction`), at the same effort (0.25d), with the same trigger condition. The `.tji` block at [`tasks/50-audience-and-broadcast.tji:184-195`](../../50-audience-and-broadcast.tji#L184) carries the registered task with the matching note. Skipping the extraction now would erode the convention — the project's WBS-discipline pattern is "named-future-task at trigger N fires when the trigger condition is met"; not firing it here would weaken every other named-future-task registration.

Downstream consumers this leaf unblocks:

- **`aud_meta_disagreement_split`** (1d, [`tasks/50-audience-and-broadcast.tji:196-200`](../../50-audience-and-broadcast.tji#L196)). The fourth agreement-layer state. Its selector pair likely needs a new color (the visual spec for meta-disagreement is a "split node" axis, which composes against the existing palette). Adding `STATE_COLORS['meta-disagreement']` becomes a one-line edit to the constant + reference in the new selector entries.
- **Future `aud_committed_styling`, `aud_withdrawn_styling`, `aud_awaiting_proposal_styling`** (not yet WBS-registered; closer- or maintainer-registered when scoped). Each grows `STATE_COLORS` by one entry. The committed-state visual likely keys on a darker slate (slate-900 = `#0f172a`) or an ink-blue; withdrawn likely keys on opacity + a muted slate; awaiting-proposal likely keys on the lightest baseline slate already in use. All become one-line additions to `STATE_COLORS` once the responsible refinements pick the colors.
- **`aud_per_facet_visualization`** (2d, [`tasks/50-audience-and-broadcast.tji:211-215`](../../50-audience-and-broadcast.tji#L211)). May render per-facet sub-states inside subdivided node slices. Reading from `STATE_COLORS.<state>` rather than copy-pasting hex literals into a new selector group keeps the palette single-source.
- **`aud_visual_regression`** (2d, [`tasks/50-audience-and-broadcast.tji:340-380`](../../50-audience-and-broadcast.tji#L340)). The pixel-comparison task already inherits per-state styling deferrals. A consolidated `STATE_COLORS` constant makes the per-state pixel-fixture mapping (state name → expected color) trivially readable; the pixel test can import `STATE_COLORS` and assert against rendered pixel RGB-equivalents per state.
- **Future `packages/ui-tokens` workspace** (deferred per ADR 0005). When the token workspace ships, `STATE_COLORS` is the migration target: each entry moves to `tokens.color.facet.<state>.*` and `STATE_COLORS` becomes a thin re-export of the token values. The single-constant shape makes the migration mechanical.

No new ADR is required (Decision §6). The extraction follows the project convention documented across [`aud_clean_typography.md`](aud_clean_typography.md) Decision §3 (named-export constants once a sibling task wants to key off them), [`aud_agreed_styling.md`](aud_agreed_styling.md) Decision §3 (the named-future-task registration this leaf executes), and [`aud_cytoscape_init.md`](aud_cytoscape_init.md) Decision §4 ("two callers is YAGNI; extract when the third caller materializes").

## Inputs / context

### Live code the leaf touches

- [`apps/audience/src/graph/stylesheet.ts:1-33`](../../../apps/audience/src/graph/stylesheet.ts#L1) — the header refinement-trail comment block. Extended with one new `Refinement: tasks/refinements/audience/aud_stylesheet_state_color_extraction.md` entry summarizing this refinement's chosen decisions in the same one-line-per-decision style used by the existing entry. Inserted between the existing `Refinement:` block (lines 3-13) and the `History:` block (lines 15-19) so the order is "newest refinement last," matching the established convention.
- [`apps/audience/src/graph/stylesheet.ts:39-55`](../../../apps/audience/src/graph/stylesheet.ts#L39) — the four `BROADCAST_*` named exports + their JSDoc. UNCHANGED. The new `STATE_COLORS` named export lands AFTER this block (so the "constants" region of the file groups: typography constants, then state-color constants, then the stylesheet that composes against both).
- [`apps/audience/src/graph/stylesheet.ts`](../../../apps/audience/src/graph/stylesheet.ts) — new named export inserted between the typography block (currently ending at L55) and the `STYLESHEET` JSDoc (currently starting at L57):
  ```ts
  /**
   * Per-state color pins for the audience's Cytoscape `STYLESHEET`.
   *
   * One entry per agreement-layer state that differentiates on color
   * (proposed differentiates on `border-style: 'dashed'` + `opacity: 0.6`
   * — no color override — and therefore has no `STATE_COLORS.proposed`
   * slot; see `aud_stylesheet_state_color_extraction.md` Decision §2).
   *
   * Cross-surface palette match: the moderator surface uses the same
   * hex values on its ReactFlow custom-node Tailwind classes — slate-700
   * (`#334155`) for agreed, rose-600 (`#e11d48`) for disputed (see
   * `tasks/refinements/moderator-ui/mod_agreed_state_styling.md` Decision §2
   * and `tasks/refinements/moderator-ui/mod_disputed_state_styling.md`
   * Decision §2). The cross-surface match means broadcast composites
   * (audience canvas + future picture-in-picture moderator view) read as
   * one show.
   *
   * `as const` so the type is the literal-string union (not `string`),
   * which keeps the typing useful at consumer sites — Cytoscape's
   * stylesheet color fields accept any string but the narrowed type
   * surfaces typos at the call site.
   *
   * Migration target: when `packages/ui-tokens` materializes (deferred
   * per ADR 0005), each entry moves to `tokens.color.facet.<state>.*`
   * and this object becomes a thin re-export.
   */
  export const STATE_COLORS = {
    agreed: '#334155',
    disputed: '#e11d48',
  } as const;
  ```
- [`apps/audience/src/graph/stylesheet.ts:143-147`](../../../apps/audience/src/graph/stylesheet.ts#L143) — the `node[rollupStatus = 'agreed']` selector entry. The `border-color` value at L145 swaps from the literal `'#334155'` to `STATE_COLORS.agreed`. UNCHANGED otherwise.
- [`apps/audience/src/graph/stylesheet.ts:148-154`](../../../apps/audience/src/graph/stylesheet.ts#L148) — the `edge[rollupStatus = 'agreed']` selector entry. The `line-color` (L151) and `target-arrow-color` (L152) values swap from the literal `'#334155'` to `STATE_COLORS.agreed`. UNCHANGED otherwise.
- [`apps/audience/src/graph/stylesheet.ts:169-175`](../../../apps/audience/src/graph/stylesheet.ts#L169) — the `node[rollupStatus = 'disputed']` selector entry. The `border-color` value at L172 swaps from the literal `'#e11d48'` to `STATE_COLORS.disputed`. The `border-width: 3` numeric (L173) is UNCHANGED — `border-width` is not a color; it lives a different axis.
- [`apps/audience/src/graph/stylesheet.ts:176-182`](../../../apps/audience/src/graph/stylesheet.ts#L176) — the `edge[rollupStatus = 'disputed']` selector entry. The `line-color` (L179) and `target-arrow-color` (L180) values swap from the literal `'#e11d48'` to `STATE_COLORS.disputed`. UNCHANGED otherwise.
- [`apps/audience/src/graph/stylesheet.ts:104-141`](../../../apps/audience/src/graph/stylesheet.ts#L104) — the baseline `node` and `edge` selector entries. UNCHANGED. None of the baseline color literals are pulled into `STATE_COLORS` (Decision §2 below — baseline colors are a different categorical axis from per-state colors).
- [`apps/audience/src/graph/stylesheet.ts:155-167`](../../../apps/audience/src/graph/stylesheet.ts#L155) — the `node[rollupStatus = 'proposed']` and `edge[rollupStatus = 'proposed']` selector entries. UNCHANGED. They differentiate on `border-style` / `line-style` + `opacity` and carry no color override; no `STATE_COLORS.proposed` slot is created (Decision §2).
- [`apps/audience/src/graph/GraphView.tsx`](../../../apps/audience/src/graph/GraphView.tsx) — UNCHANGED. The component imports `STYLESHEET` from `'./stylesheet.js'`; that import resolves the same symbol post-extraction. No new import of `STATE_COLORS` is needed in `GraphView.tsx` (the component never references color literals directly; everything composes through `STYLESHEET`).
- [`apps/audience/src/graph/GraphView.test.tsx`](../../../apps/audience/src/graph/GraphView.test.tsx) — UNCHANGED. The existing structural assertions at L665, L670-671, L798, L804-805 assert against the LITERAL `'#334155'` / `'#e11d48'` values inside the `STYLESHEET` array entries — those values resolve to the same strings post-extraction. The mount-time assertions at L756, L785, L832, L861-862 assert against `'rgb(51,65,85)'` / `'rgb(225,29,72)'` (Cytoscape's normalized RGB form) which is unaffected by the source-side symbolic naming. No test changes; the header refinement-trail block is also left unchanged for this leaf (Decision §4 below documents why).

### ADRs

- [ADR 0004 — Graph libraries: ReactFlow + Cytoscape.js](../../../docs/adr/0004-graph-libraries-reactflow-and-cytoscape.md) — the audience uses Cytoscape's stylesheet for all rendering; per-state colors must be expressed as string values inside selector-entry style objects (Cytoscape's per-element resolver reads the array directly, so the `STATE_COLORS` constant must resolve to literal strings at module-evaluation time, which `as const` + interpolation guarantees).
- [ADR 0005 — Styling: Tailwind v4 + shared tokens](../../../docs/adr/0005-styling-tailwind-with-shared-tokens.md) — the per-facet state visual contract documented at L19 stays implemented in `STYLESHEET`'s selector entries; the extraction does not regress the contract. The "Workspace realization deferred" consequence still applies: hex literals stay inline inside `STATE_COLORS` and migrate when the token workspace ships. The smoke-test example at L47 (`--color-facet-agreed: #1f7a3a`) is illustrative; the audience uses slate-700 (per the cross-surface palette match — `aud_agreed_styling.md` Decision §2).
- [ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md) — Vitest is the regression coverage for the refactor. The existing 34 cases re-run unchanged and pass; that IS the pin. No "I diffed the bundled output" smoke, no scratch verification scripts. The structural assertions on `'#334155'` / `'#e11d48'` are exactly the right granularity for this refactor — they assert that the resolved values inside `STYLESHEET` match the cross-surface palette, regardless of how the source-side constant is named.
- [ADR 0026 — Micro-frontend root app](../../../docs/adr/0026-micro-frontend-root-app.md) — the new `STATE_COLORS` constant ships inside the audience workspace's compiled artifact; no cross-surface export. Module-internal-only; not surfaced through the audience package's public API.
- [ADR 0027 — Entity and facet layers are strictly separate](../../../docs/adr/0027-entity-and-facet-layers-strict-separation.md) — orthogonal; the agreement-layer state names (`agreed`, `disputed`) that `STATE_COLORS` keys on continue to come from the agreement-layer rollup (`data.rollupStatus`), not from entity-layer fields.

### Sibling refinements

- [`tasks/refinements/audience/aud_stylesheet_module_extraction.md`](aud_stylesheet_module_extraction.md) — the file-level sibling that just shipped. [Decision §2](aud_stylesheet_module_extraction.md) kept the constants-set extraction split; this refinement executes that deferred half. [Decision §5](aud_stylesheet_module_extraction.md) (JSDoc travels with the constants) is the precedent this leaf follows — the new `STATE_COLORS` JSDoc lives in `stylesheet.ts` next to the constant, not in `GraphView.tsx`.
- [`tasks/refinements/audience/aud_agreed_styling.md`](aud_agreed_styling.md) [Decision §3](aud_agreed_styling.md) — the named-future-task registration this leaf executes. The Decision §3 rationale (a sibling task wanting to key off the value is the trigger) is satisfied: `aud_meta_disagreement_split` will plausibly key off the existing entries to compose against, and the cross-surface palette match is more discoverable once named.
- [`tasks/refinements/audience/aud_disputed_styling.md`](aud_disputed_styling.md) [Decision §6](aud_disputed_styling.md) — the third-sibling trigger; named both this leaf and the parallel `aud_stylesheet_module_extraction`, and explicitly allowed the closer to fold them. The closer kept them split (the module-extraction shipped 2026-05-27 in commit `70026f0` with `aud_stylesheet_state_color_extraction` remaining open); this refinement honours that split.
- [`tasks/refinements/audience/aud_clean_typography.md`](aud_clean_typography.md) [Decision §3](aud_clean_typography.md) — the named-export-constants pattern (`BROADCAST_NODE_FONT_SIZE_PX` and siblings) this leaf mirrors for state colors. Same shape: `as const` for narrow typing, JSDoc explaining the why, sited alongside the symbol it composes for, no re-export shim from a parent module.
- [`tasks/refinements/audience/aud_proposed_styling.md`](aud_proposed_styling.md) — the first per-state pair. Differentiates on `border-style` / `line-style` + `opacity`, NOT on color (Decision §2 documents the proposed-state-omission from `STATE_COLORS`).
- [`tasks/refinements/moderator-ui/mod_agreed_state_styling.md`](../moderator-ui/mod_agreed_state_styling.md) and [`tasks/refinements/moderator-ui/mod_disputed_state_styling.md`](../moderator-ui/mod_disputed_state_styling.md) — the cross-surface palette source. Same hex values; the JSDoc on `STATE_COLORS` names this match so future readers see why the audience cannot freely change a hex without coordinating with the moderator surface.

### What the surface MUST NOT do

- **No selector-entry change.** No new selector, no removed selector, no field reordering inside a selector entry, no field key change, no field value change beyond the source-side rewrite from literal `'#334155'` / `'#e11d48'` to `STATE_COLORS.agreed` / `STATE_COLORS.disputed`. The runtime-evaluated array is byte-identical post-extraction.
- **No baseline-color hoist.** The five baseline-color hex literals (`#ffffff`, `#cbd5e1`, `#0f172a`, `#94a3b8`, `#475569`) do NOT move into `STATE_COLORS` or any sibling constant. They stay inline in the baseline `node` / `edge` selector entries; a future task (when one fires) owns their hoist.
- **No speculative state entries.** `STATE_COLORS` carries exactly two entries today (`agreed`, `disputed`). Adding `meta-disagreement`, `committed`, `withdrawn`, `awaiting-proposal`, or `proposed` slots would invent visual contracts the responsible refinements should own.
- **No symbol-rename of `STYLESHEET` or the `BROADCAST_*` constants.** Other than the inserted `STATE_COLORS` block, the file's existing exports stay byte-for-byte identical.
- **No edit to `GraphView.tsx`.** The component never sees color literals directly; all rendering composes through the imported `STYLESHEET` reference.
- **No edit to `GraphView.test.tsx`.** Existing assertions are correct against the resolved values; Decision §4 below documents why the tests do NOT switch to importing `STATE_COLORS`.
- **No edit to `apps/audience/src/graph/projectGraph.ts` / `.test.ts`, `facetStatus.ts` / `.test.ts`, `layoutOptions.ts` / `.test.ts`, `cytoscapeTestEnv.ts` / `.test.ts`.** None of these modules import the per-state color literals; the extraction is transparent to them.
- **No edit to `apps/audience/src/App.tsx`, `apps/audience/src/index.css`, `apps/audience/src/main.tsx`, `apps/audience/src/state/**`, `apps/audience/src/ws/**`.**
- **No edit to `apps/audience/package.json`.** No new dependency; `STATE_COLORS` references only inline string literals.
- **No edit to `apps/participant`, `apps/moderator`, `apps/root`, `apps/server`.** The extraction is audience-workspace-internal.
- **No edit to `packages/**`.** The `BROADCAST_FONT_STACK` import from `@a-conversa/i18n-catalogs` stays as-is; no token-workspace materialization.
- **No edit to `tasks/50-audience-and-broadcast.tji` or other `.tji` files beyond the `complete 100` marker on the `aud_stylesheet_state_color_extraction` block** (the closer's ritual per [`README.md`](../README.md)).
- **No new ADR.** The extraction is mechanical; the pattern is documented across the predecessor refinements.
- **No bundle-size optimization, no tree-shaking rework, no `as const` proliferation beyond the new constant.** The existing `as const` annotations on the typography constants stay as they are.

## Constraints / requirements

### Files this task touches (explicit allowlist)

- `apps/audience/src/graph/stylesheet.ts` — MODIFIED:
  - Header refinement-trail block: insert a new `Refinement: tasks/refinements/audience/aud_stylesheet_state_color_extraction.md` entry summarizing this refinement's decisions in the one-line-per-decision style used by the existing entry. Inserted between the existing `Refinement:` block and the `History:` block (so refinements stay in chronological order).
  - Insert the new `STATE_COLORS` named export (with JSDoc as shown in Inputs / context) between the typography block (currently ending at L55) and the `STYLESHEET` JSDoc (currently starting at L57).
  - Rewrite the six color-literal sites inside `STYLESHEET`:
    - `'border-color': '#334155',` (L145) → `'border-color': STATE_COLORS.agreed,`
    - `'line-color': '#334155',` (L151) → `'line-color': STATE_COLORS.agreed,`
    - `'target-arrow-color': '#334155',` (L152) → `'target-arrow-color': STATE_COLORS.agreed,`
    - `'border-color': '#e11d48',` (L172) → `'border-color': STATE_COLORS.disputed,`
    - `'line-color': '#e11d48',` (L179) → `'line-color': STATE_COLORS.disputed,`
    - `'target-arrow-color': '#e11d48',` (L180) → `'target-arrow-color': STATE_COLORS.disputed,`
  - Update the `STYLESHEET` JSDoc one-line cross-reference: the per-state-extension-pattern paragraph at [`L76-93`](../../../apps/audience/src/graph/stylesheet.ts#L76) gains a one-sentence pointer noting that per-state colors are sourced from the `STATE_COLORS` constant declared above (so readers tracing the contract see both halves). No substantive rewording beyond that sentence.
  - No other edits to this file.

### Files this task does NOT touch

- `apps/audience/src/graph/GraphView.tsx`, `apps/audience/src/graph/GraphView.test.tsx`, `apps/audience/src/graph/projectGraph.ts`, `apps/audience/src/graph/projectGraph.test.ts`, `apps/audience/src/graph/facetStatus.ts`, `apps/audience/src/graph/facetStatus.test.ts`, `apps/audience/src/graph/layoutOptions.ts`, `apps/audience/src/graph/layoutOptions.test.ts`, `apps/audience/src/graph/cytoscapeTestEnv.ts`, `apps/audience/src/graph/cytoscapeTestEnv.test.ts` — UNCHANGED.
- `apps/audience/src/App.tsx`, `apps/audience/src/main.tsx`, `apps/audience/src/index.css` — UNCHANGED.
- `apps/audience/src/state/**`, `apps/audience/src/ws/**`, `apps/audience/package.json`, `apps/audience/tsconfig.json` — UNCHANGED.
- `apps/participant/**`, `apps/moderator/**`, `apps/root/**`, `apps/server/**` — UNCHANGED.
- `packages/**` — UNCHANGED.
- `docs/adr/**` — UNCHANGED. No new ADR (Decision §6).
- `playwright.config.ts`, `tests/e2e/**` — UNCHANGED. Playwright continues to defer to `aud_visual_regression`.
- `tasks/50-audience-and-broadcast.tji` — only `complete 100` lands on the `aud_stylesheet_state_color_extraction` block as the closer's ritual.
- `tasks/99-milestones.tji` — UNCHANGED. The extraction task is not on any milestone's critical path.

## Acceptance criteria

The check that says "done":

- `apps/audience/src/graph/stylesheet.ts` carries a new module-scope named export `STATE_COLORS` with shape `{ agreed: '#334155', disputed: '#e11d48' } as const`, JSDoc explaining the per-state-color convention, the proposed-state omission, the cross-surface palette match against the moderator's `mod_*_state_styling` refinements, and the deferred `packages/ui-tokens` migration target.
- The `STYLESHEET` array's six color-literal sites have been rewritten to reference `STATE_COLORS.agreed` / `STATE_COLORS.disputed`. No raw hex literals matching `#334155` / `#e11d48` remain in the file outside `STATE_COLORS` itself (verifiable with `grep -n "#334155\|#e11d48" apps/audience/src/graph/stylesheet.ts` — exactly two matches expected, both inside `STATE_COLORS`).
- The header refinement-trail block in `stylesheet.ts` has a new `Refinement:` entry for this task; the `STYLESHEET` JSDoc has a one-sentence cross-reference to `STATE_COLORS`.
- `pnpm run check` is clean (strict TS pass; `as const` narrows correctly; the `Record<string, unknown>` shape Cytoscape consumes is unaffected).
- `pnpm run test:smoke` is green; the Vitest case count in `GraphView.test.tsx` stays at 34 (no new cases added, none removed). The four structural assertions at L665 / L670-671 / L798 / L804-805 — which assert against literal `'#334155'` / `'#e11d48'` — continue to pass byte-for-byte: `findStylesheetEntry('selector')` returns the same style object regardless of how the source-side hex string is named. Per the memory rule on test output handling, the implementer runs `pnpm run test:smoke > /tmp/aud-state-color-extraction-test.log 2>&1` and dispatches an Explore sub-agent to summarize the pass/fail surface (the implementer does NOT pipe to tail or read the raw log inline).
- `pnpm -F @a-conversa/audience build` succeeds. Bundle-size delta is essentially zero (a single named export added; the array literal is otherwise byte-identical post-evaluation).
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent (pre-commit hook enforces this) once the closer adds `complete 100` to the `aud_stylesheet_state_color_extraction` block.
- `tasks/50-audience-and-broadcast.tji` gets `complete 100` on `aud_stylesheet_state_color_extraction` in the closer's ritual commit.
- Per the deferred-e2e exception in `ORCHESTRATOR.md`: Playwright coverage continues to defer to `aud_visual_regression` (2d, [`tasks/50-audience-and-broadcast.tji:340-380`](../../50-audience-and-broadcast.tji#L340)). No new note extension on `aud_visual_regression` is required — this leaf adds no new visible behaviour, so no new pixel-stability deferral is incurred (the existing per-state styling deferrals already cover the rendered output, which is byte-identical post-extraction).
- Per ADR 0022, no throwaway smoke scripts. The Vitest layer's 34 unchanged cases pin both the structural assertions (the hex values inside the array stay correct) and the mount-time computed-style resolution (Cytoscape still resolves `border-color` / `line-color` / `target-arrow-color` to the agreed and disputed RGB tuples).

## Decisions

### §1 — `STATE_COLORS` lives in `stylesheet.ts`, not in `GraphView.tsx` or a new file

After [`aud_stylesheet_module_extraction.md`](aud_stylesheet_module_extraction.md) shipped, `STYLESHEET` and the typography constants live in `apps/audience/src/graph/stylesheet.ts`. The new `STATE_COLORS` constant goes in the same file, sited above `STYLESHEET` so the array can reference it.

Three approaches considered:

- **(A — chosen)** `STATE_COLORS` inside `stylesheet.ts`, between the typography exports and the `STYLESHEET` JSDoc. Cost: zero — adds ~25 lines (constant + JSDoc) to a file that already groups visual-contract data; the file stays under ~210 lines including all JSDoc. Benefit: the "visual contract" module owns both the per-state palette and the stylesheet that consumes it; the import graph stays single-edge (`GraphView.tsx → stylesheet.ts`); future readers tracing a `STYLESHEET` selector entry's color back to its definition stay inside one file. Mirrors the `aud_stylesheet_module_extraction.md` Decision §5 posture (JSDoc travels with the data, not the consumer).
- **(B)** New file `apps/audience/src/graph/stateColors.ts` exporting `STATE_COLORS`. Cost: one more module boundary; `stylesheet.ts` would need an extra import line; future readers tracing a color literal back to its definition now cross a module boundary. Rejected — the constants-set extraction's whole purpose is to keep the palette discoverable; splitting it into a sibling file works against that purpose. The file-level extraction (`aud_stylesheet_module_extraction`) was the file-boundary decision; this leaf is a SYMBOL-level extraction inside that already-extracted file.
- **(C)** Define `STATE_COLORS` back inside `GraphView.tsx` and re-import from `stylesheet.ts`. Cost: circular-import smell (`stylesheet.ts` imports from the consumer it's been extracted out of); the `aud_stylesheet_module_extraction` extraction would partially unravel. Rejected — directly contradicts the purpose of the file-level extraction.

The invariant pinned by [`aud_cytoscape_init.md`](aud_cytoscape_init.md) Decision §2 ("module-scope `STYLESHEET` + reference-stable across renders") is honoured: `STATE_COLORS` is itself module-scope and resolves at module-evaluation time; the `STYLESHEET` array's evaluated references are stable across renders because the constants they read are immutable.

### §2 — `STATE_COLORS` covers only the two states with color overrides today (`agreed`, `disputed`); no `proposed` slot, no speculative slots for future states

`STATE_COLORS` has exactly two entries: `agreed: '#334155'` and `disputed: '#e11d48'`. The proposed-state pair differentiates on `border-style` + `opacity` with no color override — there is no proposed color literal in `STYLESHEET` to extract. Future states (`meta-disagreement`, `committed`, `withdrawn`, `awaiting-proposal`) grow the constant by one entry each, as their refinements ship.

Three approaches considered:

- **(A — chosen)** Grow-as-needed: two entries today, one new entry per future per-state-styling task. Cost: future refinements include "and add an entry to `STATE_COLORS`" as a one-line acceptance criterion. Benefit: every entry in the constant has a real consumer; the type stays narrow (`as const` gives literal-string keys); no speculative contracts.
- **(B)** Pre-allocate all eight `FacetStatus` values with placeholder colors (or `null`). Cost: invents visual contracts (`meta-disagreement = #???`) that the responsible refinements should own; weakens the `as const` typing (either widens to `string | null` or commits to colors no consumer has audited); the placeholder values would either need a follow-up audit (bad) or stay as the canonical answer (worse — backed into the codebase without an architectural decision). Rejected.
- **(C)** Include `proposed: null` (or `proposed: undefined`) to signal "this state intentionally has no color". Cost: complicates the `as const` typing; forces every caller to handle the absence; adds documentation overhead to explain why `null` is meaningful for `proposed` but not for the four states not yet listed. Rejected — the cleaner posture is "states with color overrides have entries; states without color overrides don't". The proposed-state's deliberate-no-color is documented in `STATE_COLORS`'s JSDoc and in `aud_proposed_styling.md` Decision §2; that documentation is the right place for the explanation, not the constant's shape.

The growth pattern is consistent with how `ROLLUP_PRIORITY` at [`apps/audience/src/graph/facetStatus.ts:526-534`](../../../apps/audience/src/graph/facetStatus.ts#L526) declares all eight values up-front: the priority array is itself derived data (not a visual contract) and every state has a priority slot by definition. `STATE_COLORS` is the opposite kind of data — visual contracts that are only valid when authored by their responsible refinement. The two constants follow different patterns because they serve different roles.

### §3 — Constant name is `STATE_COLORS` (not `ROLLUP_STATE_COLORS`, `STATE_PALETTE`, or `ROLLUP_COLORS`)

Three approaches considered:

- **(A — chosen)** `STATE_COLORS`. Cost: zero — short, scans cleanly, matches the name the predecessor refinements used in their named-future-task registration ([`aud_agreed_styling.md`](aud_agreed_styling.md) Decision §3, [`aud_disputed_styling.md`](aud_disputed_styling.md) Decision §6). Benefit: grep-discoverability for any future reader tracing the historical record — "the constant is called what the refinements said it would be called" reduces the cognitive load of cross-referencing.
- **(B)** `ROLLUP_STATE_COLORS`. The keys are agreement-layer ROLLUP states (the `cardRollupStatus` derivation's output) rather than individual `FacetStatus` values. Cost: longer name; introduces an asymmetry vs the typography constants (`BROADCAST_NODE_FONT_SIZE_PX` not `BROADCAST_NODE_ROLLUP_FONT_SIZE_PX`). Benefit: more precise — the keys ARE rollup-state names, not raw facet-status values. Rejected on the grep-discoverability ground (the predecessor refinements named `STATE_COLORS`) and the "consistency with typography exports" ground.
- **(C)** `STATE_PALETTE` or `ROLLUP_COLORS`. Same downsides as (B) without the precision benefit. Rejected.

The grep-discoverability is a real consideration here: this leaf executes a named-future-task registered in two predecessor refinements; a future reader confirming the registration ↔ implementation match wants `grep -r "STATE_COLORS" .` to find both the refinement and the constant. Naming the constant anything else would silently break that lookup.

### §4 — `GraphView.test.tsx` keeps asserting against hex literals; no `STATE_COLORS` import in the test file

The existing structural assertions at L665 (`expect(style['border-color']).toBe('#334155')`), L670-671 (the agreed edge case), L798 (the disputed node case), and L804-805 (the disputed edge case) pin the CONCRETE hex values inside the array, not the source-side symbol name. After extraction those same assertions hold because `STATE_COLORS.agreed` resolves to `'#334155'` at module-evaluation time.

Three approaches considered:

- **(A — chosen)** Leave the test file unchanged. Cost: zero. Benefit: the test continues to pin the cross-surface palette value (which IS what matters — the audience and moderator must use the same hex for the same state) without coupling to the implementation detail of how the audience source-side names the constant. If a future refactor accidentally renames `STATE_COLORS` to something else, the test catches the breakage by failing on the still-correct hex assertion at the still-correct selector entry; it does NOT fail because the test file's import of `STATE_COLORS` broke (which would be a less informative failure mode — "the import path changed" vs "the rendered color changed").
- **(B)** Update the test file to `import { STATE_COLORS } from './stylesheet';` and switch assertions to `expect(style['border-color']).toBe(STATE_COLORS.agreed)`. Cost: couples the test to the constant's symbol name; the assertion now passes by construction (the source and the test agree on the constant by tautology). Benefit: if someone deliberately changes the agreed color, only one place in the codebase needs editing. Rejected on tautology-risk grounds and on the "tests pin observable behaviour, not implementation detail" principle.
- **(C)** Add an additional test that asserts `STATE_COLORS.agreed === '#334155'` and `STATE_COLORS.disputed === '#e11d48'`. Cost: extra Vitest case for no extra coverage — the existing structural assertions already pin the values; an explicit `STATE_COLORS` assertion is redundant. Rejected.

ADR 0022's no-throwaway-verifications principle reinforces (A): the existing test cases ARE the regression coverage; adding tests that pass by construction is the kind of throwaway smoke ADR 0022 rejects.

### §5 — No re-export from `GraphView.tsx`; `STATE_COLORS` is module-internal to `stylesheet.ts`'s reader graph

`STATE_COLORS` is a new named export from `stylesheet.ts`. No code today consumes it outside `stylesheet.ts` itself (the only reader is the `STYLESHEET` array, in the same file). The export is named (not module-private `const`) because it's reasonable for a future task to import it (a Playwright spec asserting `STATE_COLORS.disputed` matches the rendered pixel; a moderator-side audit script verifying the palette match; a future token-workspace migration tool); but no current consumer exists.

Three approaches considered:

- **(A — chosen)** `export const STATE_COLORS = …`; no re-export from `GraphView.tsx`. Cost: zero. Benefit: the constant is reachable from any future consumer via `import { STATE_COLORS } from 'apps/audience/src/graph/stylesheet'`; module boundary stays honest.
- **(B)** Make `STATE_COLORS` module-private (`const STATE_COLORS = …` without `export`). Cost: future tasks wanting to import the constant must first promote it to exported; small friction. Benefit: the surface area of `stylesheet.ts`'s exports stays smaller. Rejected — the trigger condition (a sibling task wanting to key off the value) is the same trigger that fired for the typography exports; `BROADCAST_NODE_FONT_SIZE_PX` is also named-exported with only `STYLESHEET` as its current consumer, and that posture has worked.
- **(C)** Re-export from `GraphView.tsx` for compat with code that might import from there. Cost: drift risk — same kind of "which file owns this symbol" footgun that `aud_stylesheet_module_extraction.md` Decision §3 rejected. Rejected for the same reasons.

### §6 — No new ADR

The extraction is a mechanical refactor with no architectural choice. The "extract at the third caller" pattern is documented as project convention by multiple predecessor refinements ([`aud_clean_typography.md`](aud_clean_typography.md) Decision §3, [`aud_agreed_styling.md`](aud_agreed_styling.md) Decision §3, [`aud_cytoscape_init.md`](aud_cytoscape_init.md) Decision §4, [`aud_stylesheet_module_extraction.md`](aud_stylesheet_module_extraction.md) Decision §4). The "as-const for narrow typing on named constants" pattern is established by the typography exports. The cross-surface palette match is documented across the moderator's `mod_agreed_state_styling.md` Decision §2 and `mod_disputed_state_styling.md` Decision §2. No new dependency, no new module-boundary contract, no security or test-shape consideration that surfaces a question.

An ADR would be process overhead with no decision content. Mirrors the no-new-ADR posture of every predecessor styling refinement (none of `aud_proposed_styling`, `aud_agreed_styling`, `aud_disputed_styling`, `aud_stylesheet_module_extraction` introduced a new ADR; each cited existing ones).

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-27.

- `apps/audience/src/graph/stylesheet.ts` — new `STATE_COLORS = { agreed: '#334155', disputed: '#e11d48' } as const` named export with JSDoc explaining the per-state-color convention, the proposed-state omission, the cross-surface palette match against the moderator's `mod_*_state_styling` refinements, and the deferred `packages/ui-tokens` migration target.
- Six color-literal sites in `STYLESHEET` rewritten: three `STATE_COLORS.agreed` references (`border-color` on agreed node, `line-color` + `target-arrow-color` on agreed edge) and three `STATE_COLORS.disputed` references (`border-color` on disputed node, `line-color` + `target-arrow-color` on disputed edge). No raw `#334155` / `#e11d48` literals remain outside `STATE_COLORS` itself.
- Header refinement-trail block in `stylesheet.ts` extended with a new `Refinement: tasks/refinements/audience/aud_stylesheet_state_color_extraction.md` entry in the one-line-per-decision style.
- `STYLESHEET` JSDoc gains a one-sentence cross-reference noting that per-state colors are sourced from `STATE_COLORS`.
- `GraphView.test.tsx` unchanged — existing structural assertions against `'#334155'` / `'#e11d48'` continue to pass byte-for-byte (Decision §4).
- No tech-debt follow-up; no new deferral against `aud_visual_regression` (leaf adds no new visible behaviour).
