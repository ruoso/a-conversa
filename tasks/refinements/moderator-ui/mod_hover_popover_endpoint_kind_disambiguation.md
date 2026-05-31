# Disambiguate annotation vs node endpoint ids in the edge-hover popover

**TaskJuggler entry**: `moderator_ui.mod_annotation_ui.mod_hover_popover_endpoint_kind_disambiguation` — [tasks/30-moderator-ui.tji](../../30-moderator-ui.tji) (block at L736-L747). Embedded note: *"Source of debt: mod_render_annotation_endpoint_edges (2026-05-30) — the v1 edge-hover popover renders endpoint ids verbatim (Decision §10). A small '(annotation)' / '(node)' badge next to each endpoint id in the popover's endpoint-references row would disambiguate the two kinds. Belongs in moderator_ui.mod_annotation_ui.*. Source refinement: tasks/refinements/moderator-ui/mod_render_annotation_endpoint_edges.md (Decisions §10, §11)."*

## Effort estimate

**0.5d** (per the `.tji` allocation). Roughly:

- **`EdgeEndpointKind` type + `StatementEdgeData` widening** (~0.05d). New `EdgeEndpointKind = 'node' | 'annotation'`; two new non-optional carriage fields `sourceKind` / `targetKind` on `StatementEdgeData` ([`apps/moderator/src/graph/selectors.ts:55-142`](../../../apps/moderator/src/graph/selectors.ts#L55-L142)).
- **Selector population** (~0.05d). In `selectEdgesForSession` ([L373-L420](../../../apps/moderator/src/graph/selectors.ts#L373-L420)) derive `sourceKind` from "which payload field carried the source id" (`source_node_id` present → `'node'`, else `'annotation'`); symmetric for `targetKind`. Same one-shot per-event resolution as today's `sourceId ?? source_annotation_id` lookup.
- **ICU template update across three locales** (~0.05d). Replace the `moderator.hoverPopover.edgeEndpointsReference` body in [`packages/i18n-catalogs/src/catalogs/{en-US,pt-BR,es-419}.json:593`](../../../packages/i18n-catalogs/src/catalogs/en-US.json#L593) with an ICU template that consumes two new `sourceKind` / `targetKind` `select`-typed parameters and emits a localized parenthesized kind label after each id. Native labels per Decision §3.
- **`<HoverPopover>` wiring** (~0.05d). Pass `sourceKind` / `targetKind` to the `t()` call at [`HoverPopover.tsx:313-316`](../../../apps/moderator/src/graph/HoverPopover.tsx#L313-L316); stamp matching `data-hover-popover-source-kind` / `data-hover-popover-target-kind` attributes on the endpoints row at [L354-L361](../../../apps/moderator/src/graph/HoverPopover.tsx#L354-L361) (mirrors today's `data-hover-popover-source-id` / `data-hover-popover-target-id` seams).
- **Vitest cover** (~0.15d). Selector tests pinning the kind population branches; `<HoverPopover>` tests pinning the rendered kind labels per locale and the data-attribute seams.
- **Playwright cover** (~0.1d). Extend [`tests/e2e/annotation-endpoint-rendering.spec.ts`](../../../tests/e2e/annotation-endpoint-rendering.spec.ts) (the predecessor's spec — the only e2e in tree today that surfaces an annotation-endpoint edge) with a hover-and-assert pass over the annotation-endpoint edge label.
- **Build + scheduler closure** (~0.05d). `pnpm run check`, `pnpm run test:smoke`, `tj3` silent after `complete 100`.

## Inherited dependencies

**Settled:**

- [`moderator_ui.mod_annotation_ui.mod_render_annotation_endpoint_edges`](./mod_render_annotation_endpoint_edges.md) (done — 2026-05-30, named THIS task under Tech-debt §11 + Decision §10). Shipped:
  - The lift in [`selectors.ts:374-391`](../../../apps/moderator/src/graph/selectors.ts#L374-L391) — `selectEdgesForSession` now emits ReactFlow `Edge<StatementEdgeData>` records whose `sourceId` / `targetId` are EITHER a `node-created` node id OR a promoted annotation id (per the wire-schema XOR). THIS task adds a parallel `sourceKind` / `targetKind` discriminator carriage on the same record.
  - The `AnnotationNode` ReactFlow node-type + the annotation-endpoint Playwright surface ([`tests/e2e/annotation-endpoint-rendering.spec.ts`](../../../tests/e2e/annotation-endpoint-rendering.spec.ts)) that THIS task extends with the popover assertion. The wsStore seed pattern in [`tests/e2e/fixtures/wsStoreSeed.ts`](../../../tests/e2e/fixtures/wsStoreSeed.ts) is reused unchanged.
  - The popover-endpoint surface that motivated this task — the `endpointsLine` at [`HoverPopover.tsx:313-316`](../../../apps/moderator/src/graph/HoverPopover.tsx#L313-L316) renders ids verbatim today; THIS task adds the kind disambiguation that Decision §10 of the predecessor flagged as v1 debt.

- [`moderator_ui.mod_annotation_ui.mod_render_annotations`](./mod_annotation_rendering.md) (done — 2026-05-11). Established the `methodology.annotationKind.<kind>` i18n catalog convention reused for the per-kind palette. This task does NOT touch that catalog — the popover disambiguation is "annotation vs node" (a two-valued endpoint-kind enum), not "what kind of annotation" — so it introduces a fresh `moderator.hoverPopover.endpointKind.*` key family rather than re-keying onto the methodology catalog (Decision §3).

- [`moderator_ui.mod_hover_details`](./mod_hover_details.md) + [`moderator_ui.mod_edge_popover_full_target_wording`](./mod_edge_popover_full_target_wording.md) (done). Established the popover's section layout (role → conditional role-description → endpoint references → per-facet → diagnostic) and the per-section `data-hover-popover-section` test-seam vocabulary. THIS task does NOT add a new section — it widens the existing `data-hover-popover-section="endpoints"` row.

- [ADR 0024 — Frontend i18n: react-i18next with ICU](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md). ICU `select` is the canonical mechanism for value-driven plurals / variants; the widened template uses two `select` blocks to localize per-kind labels.

- [ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md). Every check ships as committed Vitest + Playwright.

- [ADR 0011 / 0013 — ESLint + TypeScript strict](../../../docs/adr/0011-eslint.md). `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess` are on; the new non-optional `sourceKind` / `targetKind` fields fit the existing pattern.

**Pending (none — every load-bearing input is settled on `main`):**

The future `mod_propose_annotation_endpoint_gestures` (gated separately) does not affect the popover surface — it adds new gestures for *minting* annotation-endpoint edges; the popover surface here reads whatever edges exist regardless of how they were minted.

## What this task is

Surface the endpoint kind ("annotation" / "node") on each side of the edge-hover popover's endpoint-references row so a moderator reading the popover for an annotation-endpoint edge can tell at a glance which endpoint is the annotation and which is the statement node.

Concretely:

1. **Type widening.** Add `EdgeEndpointKind = 'node' | 'annotation'` next to the `StatementEdgeData` definition in [`selectors.ts`](../../../apps/moderator/src/graph/selectors.ts); add non-optional `sourceKind: EdgeEndpointKind` and `targetKind: EdgeEndpointKind` carriage fields on `StatementEdgeData` mirroring the docblock style of `sourceId` / `targetId`.

2. **Selector population.** In `selectEdgesForSession` ([L373-L420](../../../apps/moderator/src/graph/selectors.ts#L373-L420)) compute `sourceKind = event.payload.source_node_id !== undefined ? 'node' : 'annotation'` and the symmetric `targetKind`. The check is order-aligned with today's `sourceId = event.payload.source_node_id ?? event.payload.source_annotation_id` resolution — the wire schema's per-endpoint XOR guarantees exactly one of the pair is set, so the kind discriminator is unambiguous.

3. **Catalog update.** Widen `moderator.hoverPopover.edgeEndpointsReference` across all three v1 locales:
   - en-US: `"{sourceId} ({sourceKind, select, annotation {annotation} node {node} other {?}}) -> {targetId} ({targetKind, select, annotation {annotation} node {node} other {?}})"`
   - pt-BR: parenthesized labels `anotação` / `nó`
   - es-419: parenthesized labels `anotación` / `nodo`

   The `other {?}` fallback keeps the renderer honest if a future endpoint-kind enum widening lands without a catalog update.

4. **Popover wiring.** Pass `sourceKind` / `targetKind` to the `t()` call at [`HoverPopover.tsx:313-316`](../../../apps/moderator/src/graph/HoverPopover.tsx#L313-L316). Stamp `data-hover-popover-source-kind={sourceKind}` and `data-hover-popover-target-kind={targetKind}` on the row at [L354-L361](../../../apps/moderator/src/graph/HoverPopover.tsx#L354-L361) for test-stable observation independent of the localized label text.

5. **Cover** — Vitest pinning the selector kind population per endpoint shape (node→node, node→annotation, annotation→node, annotation→annotation), the `<HoverPopover>` rendered label per locale, and the data-attribute seams; Playwright extending the existing annotation-endpoint spec with a hover-and-assert pass over the canvas's annotation-endpoint edge.

No structural refactor. No new component. No new section in the popover. No methodology / projection / schema change. This is a one-line-of-i18n + a one-prop-widening + a few render attributes deep, with the test cover earning its keep.

## Why it needs to be done

**The popover surface is information-poor for annotation-endpoint edges today.** Per [`mod_render_annotation_endpoint_edges` Decision §10](./mod_render_annotation_endpoint_edges.md), the v1 popover renders endpoint ids verbatim — UUIDs that don't visibly distinguish an annotation id from a node id. A moderator hovering an annotation-endpoint edge (e.g., E15 "N19 contradicts A2") sees `<uuid1> -> <uuid2>` and has to look at the canvas to figure out which one is the annotation. With the `AnnotationNode` rendering deliberately smaller (192×56 vs `StatementNode`'s 288×90 per `mod_render_annotation_endpoint_edges` Decision §5) this is doable but mildly annoying — the popover is supposed to be the textual handle for cross-referencing, not a "look back at the canvas" indirection.

**The walkthrough fixture refit will surface this debt routinely.** [`walkthrough_e15_annotation_endpoint_refit`](../data-and-methodology/walkthrough_e15_annotation_endpoint_refit.md) rewrites E15 as `(N19) -[contradicts]-> (A2)` against the canonical narrative. With the refit landing, every moderator-driven Playwright run of the walkthrough hovers the canonical annotation-endpoint edge. The popover endpoint-kind seam pays for itself as soon as the refit's spec uses `data-hover-popover-target-kind="annotation"` to pin the canonical encoding (a less brittle handle than asserting the rendered UUID string).

**The seam is also useful for `mod_pw_full_session_run` (the eventual end-to-end walkthrough rerun).** That spec will hover dozens of edges; per-edge kind assertion via a stable data attribute is the right pin shape there too.

**The fix is in the load-bearing place.** The popover is the canonical hover-detail surface in the moderator UI (per `mod_hover_details`); fixing it here propagates through every edge that reaches it. Surface-by-surface workarounds (e.g., rendering the kind on the edge label, or coloring the edge by endpoint kind) would scatter the disambiguation across multiple renderers without solving the popover problem directly.

## Inputs / context

### The lift sites

- [`apps/moderator/src/graph/selectors.ts:85-102`](../../../apps/moderator/src/graph/selectors.ts#L85-L102) — `StatementEdgeData.sourceId` / `targetId` docblock + type definitions. The new `sourceKind` / `targetKind` fields slot in alongside, with mirrored docblocks explaining the discriminator semantics + the renderer / popover consumers.
- [`apps/moderator/src/graph/selectors.ts:373-420`](../../../apps/moderator/src/graph/selectors.ts#L373-L420) — the `for (const event of session.events)` loop inside `selectEdgesForSession` that resolves `sourceId` / `targetId` from the polymorphic payload fields. The new kind discriminators are computed in the same scope.
- [`apps/moderator/src/graph/HoverPopover.tsx:307-316`](../../../apps/moderator/src/graph/HoverPopover.tsx#L307-L316) — the `endpointsLine` computation that invokes `t('moderator.hoverPopover.edgeEndpointsReference', { sourceId, targetId })`. Widens to pass `sourceKind` / `targetKind`.
- [`apps/moderator/src/graph/HoverPopover.tsx:354-361`](../../../apps/moderator/src/graph/HoverPopover.tsx#L354-L361) — the rendered `<p>` carrying the endpoint references row. Stamps `data-hover-popover-source-kind` / `data-hover-popover-target-kind` alongside the existing `-source-id` / `-target-id` seams.

### The i18n catalogs

- [`packages/i18n-catalogs/src/catalogs/en-US.json:592-594`](../../../packages/i18n-catalogs/src/catalogs/en-US.json#L592-L594) — `moderator.hoverPopover.edgeEndpointsReference` lives here. Widened body uses two ICU `select` blocks per Decision §3.
- [`packages/i18n-catalogs/src/catalogs/pt-BR.json:592-594`](../../../packages/i18n-catalogs/src/catalogs/pt-BR.json#L592-L594) — parallel widening with Portuguese kind labels (`anotação` / `nó`).
- [`packages/i18n-catalogs/src/catalogs/es-419.json:592-594`](../../../packages/i18n-catalogs/src/catalogs/es-419.json#L592-L594) — parallel widening with Spanish kind labels (`anotación` / `nodo`).

The three labels are short and not idiomatically tricky (they're nouns, not full sentences); the closer surfaces them on the parking lot for native-speaker sign-off the same way `mod_render_annotations` did for the `methodology.annotationKind.<kind>` family.

### The Vitest test files

- [`apps/moderator/src/graph/selectors.test.ts`](../../../apps/moderator/src/graph/selectors.test.ts) — already covers `selectEdgesForSession`'s lifted-guard branches per `mod_render_annotation_endpoint_edges` Acceptance criteria. New cases extend the same `describe('selectEdgesForSession')` block.
- [`apps/moderator/src/graph/HoverPopover.test.tsx:267-393`](../../../apps/moderator/src/graph/HoverPopover.test.tsx#L267-L393) — the `describe('HoverPopover — edge target rendering')` block already pins the endpoints row across locales + the data-attribute seams. New cases extend the same block.

### The Playwright surface

- [`tests/e2e/annotation-endpoint-rendering.spec.ts`](../../../tests/e2e/annotation-endpoint-rendering.spec.ts) — the predecessor's spec seeds a session with `node-created` (N1) + `annotation-created` (A1 targeting N1) + `edge-created` (annotation-endpoint, N1→A1). The annotation-endpoint statement edge label is already on the canvas; THIS task extends the spec with `edgeLabel.hover()` + popover assertions analogous to [`tests/e2e/moderator-hover-details.spec.ts:167-225`](../../../tests/e2e/moderator-hover-details.spec.ts#L167-L225) (which is the canonical edge-popover Playwright spec for node→node edges).
- [`tests/e2e/moderator-hover-details.spec.ts:200-207`](../../../tests/e2e/moderator-hover-details.spec.ts#L200-L207) — pattern reference: positive id assertions + stable `data-hover-popover-source-id` / `data-hover-popover-target-id` attribute pins. The new spec extension mirrors this shape adding `data-hover-popover-source-kind` / `data-hover-popover-target-kind` assertions for `'node'` / `'annotation'` respectively.

### Sibling precedent

- [`tasks/refinements/moderator-ui/mod_edge_popover_full_target_wording.md`](./mod_edge_popover_full_target_wording.md) — the refinement that reframed the edge popover from "show wordings" to "show ids" + introduced the `edgeEndpointsReference` template. This task is the next iteration on the same template: the ids stay, kind labels join them.
- [`tasks/refinements/moderator-ui/mod_render_annotation_endpoint_edges.md`](./mod_render_annotation_endpoint_edges.md) — Decision §10 + Tech-debt §11 of the source-of-debt refinement; the renderer changes there feed this task's pre-conditions.

## Constraints / requirements

1. **No breaking change for node-to-node edges.** Every existing edge already carries `sourceId` / `targetId` as node ids; THIS task adds `sourceKind: 'node', targetKind: 'node'` to those records (the kind always populates — there is no "kind-absent" branch). The visible popover for a node→node edge becomes `<src-id> (node) -> <tgt-id> (node)`. Existing edge-popover tests that match exact rendered text via `toContainText('->')` continue to pass; tests that match the full template body (none in tree today) would need a one-line update. The new kind suffix is visible and intentional — moderators reading any edge popover always see what each endpoint is.

2. **Non-optional fields, no fallback `undefined`.** `sourceKind` / `targetKind` are required `EdgeEndpointKind` values. Per the wire schema's per-endpoint XOR, exactly one of `source_node_id` / `source_annotation_id` is set on each edge-created event, so the discriminator is always derivable. The same `if (sourceId === undefined || targetId === undefined) continue;` defensive guard at [`selectors.ts:386-391`](../../../apps/moderator/src/graph/selectors.ts#L386-L391) already filters wire-protocol violations before kind derivation.

3. **`other {?}` fallback in the ICU `select` blocks.** If a future enum widening lands an `EdgeEndpointKind` member without updating the catalog, the renderer surfaces `?` (a typographic neutral) rather than crashing or rendering an unlocalized identifier. Cheap forward-compatibility guard; deliberately not an i18n-key miss (an unrecognized value is data, not a translation gap).

4. **Stable data-attribute seams** on the endpoints row:
   - `data-hover-popover-source-kind="node"` / `data-hover-popover-source-kind="annotation"`
   - `data-hover-popover-target-kind="node"` / `data-hover-popover-target-kind="annotation"`

   Mirrors today's `data-hover-popover-source-id` / `-target-id` pattern. Tests pin via attribute, not via rendered text — locale-independence stays.

5. **Visible label format**: the kind appears in parens immediately after the id, separated by a single space — `<id> (<kind>)`. The arrow stays `->` (ASCII per the typography codepoint-range policy in [`mod_edge_popover_full_target_wording`](./mod_edge_popover_full_target_wording.md)). The full template renders on one line in `text-xs font-mono break-all` (existing styling at [`HoverPopover.tsx:358`](../../../apps/moderator/src/graph/HoverPopover.tsx#L358)); long ids that already break onto a second line continue to do so, and the parenthesized kind labels add ~12 characters per side at most (short enough to almost always fit on the same line as the id even on narrow popovers).

6. **No catalog-key proliferation.** One new key family `moderator.hoverPopover.endpointKind.*` is NOT introduced; the kind labels live inline inside the existing `edgeEndpointsReference` template's `select` blocks (Decision §3). Tests reference the rendered text via i18next resolution against the catalogs — no fragile string-table mirroring.

7. **i18n catalogs validator stays green** ([`packages/i18n-catalogs`](../../../packages/i18n-catalogs/) validator + `pnpm run check`). The validator's structural-equality check across locales (key paths must match) is preserved — the same `edgeEndpointsReference` key exists in all three locales, just with widened bodies. The validator's ICU-parameter check accepts the additional `sourceKind` / `targetKind` parameters uniformly across locales.

8. **No regression for the `'—'` em-dash wording fallback** ([`selectors.ts:406-407`](../../../apps/moderator/src/graph/selectors.ts#L406-L407)). The wording fields are independent from the kind discriminators; the em-dash fallback continues to govern wording resolution. The popover does NOT render wordings (per `mod_edge_popover_full_target_wording`), so this is selector-internal hygiene only.

9. **TypeScript strict compliance** ([ADR 0013](../../../docs/adr/0013-typescript-strict.md)). The new `EdgeEndpointKind` literal-union type is the canonical shape (matches the pattern of `EdgeRole`, `FacetName`, `FacetStatus`); the widened `StatementEdgeData` interface declares both kind fields as non-optional `EdgeEndpointKind`.

10. **No new ADR.** The added i18n key shape (ICU `select` with `other` fallback) and the new `data-hover-popover-*-kind` attribute family are direct applications of ADR 0024 + the established popover-seam vocabulary. No architectural seam opens.

11. **No projector / methodology / schema change.** Everything is moderator-UI selector + popover + catalog. The wire schema for `edge-created` is unchanged (already polymorphic per [`edge_target_annotation_schema_extension`](../data-and-methodology/edge_target_annotation_schema_extension.md)).

12. **Vitest discipline** ([ADR 0006](../../../docs/adr/0006-test-framework-vitest.md), [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md)). Every empirical check ships as a committed case.

13. **Playwright cover IS in scope.** The annotation-endpoint popover surface is reachable today via the predecessor's spec; per the UI-stream e2e policy + the `mod_pw_*` debt-watch, extending an existing scoped spec is cheaper than deferring to a future catch-all. See Decision §6.

## Acceptance criteria

Per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md), every check is a committed Vitest case, an updated Playwright spec, or a CI script — no throwaway probes.

**Source edits**

- [ ] `apps/moderator/src/graph/selectors.ts`:
  - Add `export type EdgeEndpointKind = 'node' | 'annotation';` near the `EdgeRole` / `FacetName` type declarations (top of the file's type cluster).
  - Add `sourceKind: EdgeEndpointKind;` and `targetKind: EdgeEndpointKind;` fields to the `StatementEdgeData` interface alongside `sourceId` / `targetId` (with mirrored docblocks explaining the discriminator + the popover consumer).
  - In `selectEdgesForSession` (after the `sourceId` / `targetId` resolution + defensive guard at L384-391), compute `const sourceKind: EdgeEndpointKind = event.payload.source_node_id !== undefined ? 'node' : 'annotation';` and the symmetric `targetKind`. Populate both fields in BOTH branches of the `diagnosticHighlight === undefined ? {...} : {...}` ternary at L416-...
- [ ] `apps/moderator/src/graph/HoverPopover.tsx`:
  - Destructure `sourceKind` / `targetKind` from `target.data` at [L291](../../../apps/moderator/src/graph/HoverPopover.tsx#L291).
  - Pass `sourceKind` / `targetKind` to the `t('moderator.hoverPopover.edgeEndpointsReference', { ... })` call at [L313-L316](../../../apps/moderator/src/graph/HoverPopover.tsx#L313-L316).
  - Stamp `data-hover-popover-source-kind={sourceKind}` and `data-hover-popover-target-kind={targetKind}` on the `<p data-hover-popover-section="endpoints">` row at [L354-L361](../../../apps/moderator/src/graph/HoverPopover.tsx#L354-L361).
- [ ] `packages/i18n-catalogs/src/catalogs/en-US.json` line 593:
  - `"edgeEndpointsReference": "{sourceId} ({sourceKind, select, annotation {annotation} node {node} other {?}}) -> {targetId} ({targetKind, select, annotation {annotation} node {node} other {?}})"`
- [ ] `packages/i18n-catalogs/src/catalogs/pt-BR.json` line 593:
  - `"edgeEndpointsReference": "{sourceId} ({sourceKind, select, annotation {anotação} node {nó} other {?}}) -> {targetId} ({targetKind, select, annotation {anotação} node {nó} other {?}})"`
- [ ] `packages/i18n-catalogs/src/catalogs/es-419.json` line 593:
  - `"edgeEndpointsReference": "{sourceId} ({sourceKind, select, annotation {anotación} node {nodo} other {?}}) -> {targetId} ({targetKind, select, annotation {anotación} node {nodo} other {?}})"`
- [ ] Any existing test fixture / factory that constructs a `StatementEdgeData` literal (e.g., the `edgeData()` helper used in [`HoverPopover.test.tsx`](../../../apps/moderator/src/graph/HoverPopover.test.tsx)) gains `sourceKind: 'node', targetKind: 'node'` defaults so the strict-typecheck stays green without per-call updates. Tests that exercise the annotation-endpoint case override the defaults explicitly.

**Vitest coverage** (committed cases, ADR 0022)

- [ ] `apps/moderator/src/graph/selectors.test.ts` — new cases in the existing `describe('selectEdgesForSession')` block:
  - `node→node`: edge whose payload has `source_node_id` + `target_node_id` → emitted `data.sourceKind === 'node'`, `data.targetKind === 'node'`.
  - `node→annotation`: edge whose payload has `source_node_id` + `target_annotation_id` → `data.sourceKind === 'node'`, `data.targetKind === 'annotation'`.
  - `annotation→node`: symmetric → `'annotation'` / `'node'`.
  - `annotation→annotation`: both polymorphic-annotation fields set → `'annotation'` / `'annotation'`.
  - Defensive guard regression: edge whose payload has neither `source_node_id` nor `source_annotation_id` (an invalid wire payload) is still dropped via the L386-391 guard before kind derivation; the kind discriminator code never sees `undefined`.
- [ ] `apps/moderator/src/graph/HoverPopover.test.tsx` — new cases in the existing `describe('HoverPopover — edge target rendering')` block:
  - **English label rendering**: edge with `sourceKind: 'node', targetKind: 'annotation'` → endpoint row text contains `(node)` and `(annotation)`. Symmetric case for `annotation→node`. Both-`'node'` baseline preserves prior assertions plus the new `(node)` suffixes.
  - **Locale parity**: same `node→annotation` case rendered under `pt-BR` contains `(nó)` and `(anotação)`; under `es-419` contains `(nodo)` and `(anotación)`. Mirrors the existing locale-rotation test at [`HoverPopover.test.tsx:323-345`](../../../apps/moderator/src/graph/HoverPopover.test.tsx#L323-L345).
  - **`other` fallback**: forcing an unknown kind via TypeScript-cast (or a runtime-unionwidening helper) — `?` renders in the parens. The fallback is a forward-compatibility guard; the test pins that the renderer does NOT crash on an unrecognized kind. (Optional but small; closes Constraint §3.)
  - **Data-attribute seams**: each kind combination stamps the matching `data-hover-popover-source-kind` / `data-hover-popover-target-kind` attribute values on the endpoints row. Mirrors the existing id-attribute pin at [L347-L363](../../../apps/moderator/src/graph/HoverPopover.test.tsx#L347-L363).
- [ ] Catalog-shape validator regression: `pnpm -F @a-conversa/i18n-catalogs test` (the package-local validator covering structural-equality + ICU-parameter parity) stays green.

**Playwright coverage** — extend the predecessor's spec; surface is reachable.

- [ ] `tests/e2e/annotation-endpoint-rendering.spec.ts` — add a new assertion block after the existing canvas-presence assertions: hover the annotation-endpoint statement edge label via `page.getByTestId('graph-edge-label-<edge-id>').hover()`; assert the popover appears (`data-hover-target-kind="edge"`); assert the endpoints row carries `data-hover-popover-source-kind="node"` and `data-hover-popover-target-kind="annotation"` (matching the seeded N1→A1 contradicts edge); assert the rendered text contains `(node)` and `(annotation)` (en-US locale — the spec already runs under the default `chromium-moderator-annotation-endpoint` project per [`playwright.config.ts`](../../../playwright.config.ts)). Mirror the pattern in [`tests/e2e/moderator-hover-details.spec.ts:197-207`](../../../tests/e2e/moderator-hover-details.spec.ts#L197-L207).

**Build + scheduler**

- [ ] `pnpm run check` clean (typecheck + lint + format + i18n-catalogs validator).
- [ ] `pnpm run test:smoke` green (Vitest test count rises by ~10 cases — 4 selector branches + 5 popover cases + the optional `other` fallback).
- [ ] `pnpm -F @a-conversa/moderator build` succeeds (bundle size delta is negligible — the new fields are strings on an existing record, the new render is two interpolated attributes).
- [ ] `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after `complete 100` lands on the task block at L736-L747.

**Refinement closure**

- [ ] `tasks/30-moderator-ui.tji` task block `mod_hover_popover_endpoint_kind_disambiguation` gains `complete 100` after the `allocate team` line, plus a `note "Refinement: tasks/refinements/moderator-ui/mod_hover_popover_endpoint_kind_disambiguation.md"` line.
- [ ] A `## Status` block is appended to this refinement on completion per [`tasks/refinements/README.md`](../README.md) ritual, listing the produced source / catalog / test deltas and the smoke / build / `tj3` results.
- [ ] The closer surfaces the three new Portuguese / Spanish kind labels (`anotação`, `nó`, `anotación`, `nodo`) on `tasks/parking-lot.md` for native-speaker sign-off (parking-lot entry, not a WBS task per the policy on human-only review work).

## Decisions

### §1. **Carriage on `StatementEdgeData` (non-optional `sourceKind` / `targetKind`)** rather than per-render re-derivation from the events log.

The alternative is to leave `StatementEdgeData` unchanged and have `<HoverPopover>` (or a derived selector) re-walk the events log to recover each edge's payload-field shape. **Rejected** because:

- **The selector is the right place to project wire shape into rendered shape.** `selectEdgesForSession` already reads `event.payload.source_node_id ?? event.payload.source_annotation_id` to populate `sourceId`; computing `sourceKind` in the same scope costs one extra `!== undefined` check per edge. Re-deriving downstream would re-walk the events log or thread the event reference through to the popover — both worse.
- **Per-render derivation breaks the popover's pure-data contract.** `<HoverPopover>` today consumes a `StatementEdgeData` snapshot; widening it to also need events access (or a side-channel `sourceKind` prop) would tangle the rendering tree's data flow.
- **Non-optional avoids a `'unknown'` third value** that would force a "guard against undefined" branch in the renderer. The wire schema's XOR guarantees the kind is always derivable; declaring the field non-optional propagates that guarantee through the type system.

### §2. **Two new fields, not a union-discriminator refactor of `sourceId` / `targetId`**.

The alternative is to discriminate via a richer shape, e.g., `source: { kind: 'node'; id: string } | { kind: 'annotation'; id: string }`. **Rejected** because:

- **The popover consumes `sourceId` / `targetId` as plain strings** across multiple existing call sites + tests + `data-hover-popover-source-id` / `-target-id` attribute seams. A discriminated union forces every read to destructure or switch — pure churn for the same observable behavior.
- **Other consumers of `StatementEdgeData` may want kind without the discriminator interlock** (e.g., a future per-kind edge styling hook on `<StatementEdge>`). A flat `sourceKind` field is easier to read independently.
- **The widening is additive** — existing tests that construct `StatementEdgeData` literals need a one-line default; the discriminator-union refactor would touch every fixture.

### §3. **Inline ICU `select` per kind in the existing template** rather than a new `moderator.hoverPopover.endpointKind.<kind>` catalog key family.

The alternative is to add four new keys (`endpointKind.node` + `endpointKind.annotation` × 3 locales) and have the renderer call `t('moderator.hoverPopover.endpointKind.<kind>')` twice + interpolate into a refactored template. **Rejected** because:

- **The localized kind label is meaningless outside the endpoint-references row.** Surfacing it as a top-level key invites accidental reuse in unrelated UI surfaces — a translation that fits `({label})` after a UUID won't necessarily fit a heading, a button, or a tooltip.
- **ICU `select` is exactly the right tool**: the template is the natural authoring unit; localization stays per-locale-coherent (a Portuguese reviewer sees the full template in context).
- **One key, one resolution per render** — fewer i18next misses to monitor, fewer keys for the catalogs validator to track.

The `other {?}` fallback per branch is a forward-compatibility guard (Constraint §3) at zero per-locale cost.

### §4. **Parenthesized suffix format `<id> (<kind>)`** vs. prefix `<kind>: <id>` or markup-based separation.

Parenthesized suffix is chosen because:

- **The id is the primary identifier**; the kind is a clarifier. Parens semantically signal "supplementary detail" — typographic convention matches the moderator's parsing model.
- **Suffix preserves the existing scannable shape** of the endpoints row (id-arrow-id). A prefix would push the ids to the right and break vertical alignment readers learned over the prior renderer.
- **One-line ICU template** without markup nesting; survives `text-xs font-mono break-all` styling cleanly.

The competing prefix form (`node: <id> -> annotation: <id>`) reads marginally heavier and shifts the id columns; the markup form (separate `<span data-kind=...>` adjacent to the id) duplicates the test seam already covered by the data attribute. Both rejected.

### §5. **One template across three locales** with locale-substituted kind labels — not three locale-specific punctuation conventions.

A locale-aware variant would use locale-specific parens / brackets / typography per Portuguese / Spanish editorial style. **Rejected** for v1: the typography codepoint-range policy ([`mod_edge_popover_full_target_wording`](./mod_edge_popover_full_target_wording.md)) already standardizes punctuation across locales; the parens are ASCII; the kind label inside is the localizable surface. Future polish: a native-speaker reviewer flagging a more idiomatic Portuguese / Spanish form opens a follow-up; for now uniform parens + localized noun.

### §6. **Playwright cover is in scope** — extend `tests/e2e/annotation-endpoint-rendering.spec.ts`, not deferred to `mod_pw_full_session_run` or a `mod_pw_*` catch-all.

The annotation-endpoint surface is reachable via the predecessor's spec. Per the UI-stream e2e policy:

- **The seam is the same hover-and-assert pattern** as [`moderator-hover-details.spec.ts:197-207`](../../../tests/e2e/moderator-hover-details.spec.ts#L197-L207). Adding a ~20-line block to an existing spec is cheaper than scoping a new spec or carrying the debt.
- **`mod_pw_full_session_run` is a 3d catch-all** that recreates the walkthrough end-to-end; coupling this task's verification to its eventual landing would delay coverage for years of calendar time at risk of regressions in between.
- **`mod_pw_diagnostic_flow` already inherits debt from 5+ refinements** per the predecessor's `mod_render_annotation_endpoint_edges` debt-watch notes; not piling more onto it.

The spec extension exercises the new `data-hover-popover-source-kind` / `-target-kind` attributes plus the rendered `(node)` / `(annotation)` text under en-US — which is the minimal pin that catches a regression in the selector OR the catalog OR the renderer.

### §7. **No back-link amendment to `mod_render_annotation_endpoint_edges`**.

`mod_render_annotation_endpoint_edges` Decision §10 names this task as the polish follow-up. The closer for THIS task does NOT retroactively amend that refinement's Decision §10 to point back — refinements are frozen per [`tasks/refinements/README.md`](../README.md) and the Status block of the predecessor is the authoritative landing record. The forward pointer from §10 + Tech-debt §11 to this task is already sufficient discoverability; the predecessor's Decision §10 stays as-is.

### §8. **Tech-debt registration**: name follow-ups crisply.

No new follow-ups surface from this task. The kind-label native-speaker sign-off is parking-lot work (human-only — not WBS-implementable per the deferral policy); the closer surfaces it on `tasks/parking-lot.md`.

A potential further polish — per-kind theming of the endpoints row (e.g., color-coding the annotation kind via the future `data-annotation-kind` palette from `packages/ui-tokens`) — is NOT registered. It's premature: the moderator already sees the annotation node on the canvas with its kind decoration; tinting the popover's plain-text label would add UI surface for a marginal gain. If user feedback flags it, a future task can register then.

## Open questions

(none — all decided in §1–§8.)

## Status

**Done** — 2026-05-30.

- Added `EdgeEndpointKind = 'node' | 'annotation'` type and `sourceKind` / `targetKind` non-optional fields to `StatementEdgeData` in `apps/moderator/src/graph/selectors.ts`; populated both fields in `selectEdgesForSession` via XOR discriminator on `source_node_id` / `source_annotation_id`.
- Widened `moderator.hoverPopover.edgeEndpointsReference` ICU template across all three locales (`packages/i18n-catalogs/src/catalogs/en-US.json`, `pt-BR.json`, `es-419.json`) with inline `select` blocks; kind labels: en-US `annotation`/`node`, pt-BR `anotação`/`nó`, es-419 `anotación`/`nodo`; `other {?}` forward-compat fallback per Constraint §3.
- Wired `sourceKind` / `targetKind` into the `t()` call and stamped `data-hover-popover-source-kind` / `data-hover-popover-target-kind` seams on the endpoints row in `apps/moderator/src/graph/HoverPopover.tsx`.
- Added 5 Vitest cases to `apps/moderator/src/graph/selectors.test.ts` (node→node, node→annotation, annotation→node, annotation→annotation kind combos + defensive-guard regression).
- Added 8 Vitest cases to `apps/moderator/src/graph/HoverPopover.test.tsx` (kind suffix per locale en/pt/es, baseline-pair, ordering, both data-attribute seams, `other {?}` fallback); updated `edgeData` factory with `sourceKind`/`targetKind` defaults.
- Updated `apps/moderator/src/graph/StatementEdge.test.tsx` — added `sourceKind`/`targetKind` defaults via replace_all on all `StatementEdgeData` literals and updated `edgeFor`/`edgeWithDiagnostic` factories.
- Added 4 Vitest cases to `packages/i18n-catalogs/src/methodology.test.ts` (per-locale kind-substitution round-trip + `other {?}` fallback); fixed baseline call to pass `sourceKind`/`targetKind: 'node'` so the widened ICU template renders correctly.
- Extended `tests/e2e/annotation-endpoint-rendering.spec.ts` with hover-and-assert block: `data-hover-popover-source-kind="node"` / `data-hover-popover-target-kind="annotation"` seams + en-US `(node)` / `(annotation)` text assertions.
- Verification (driver-run): `pnpm run check` PASS, `pnpm run test:smoke` PASS (151/151), `pnpm run test:behavior:smoke` PASS, `make test:e2e:compose` PASS.
