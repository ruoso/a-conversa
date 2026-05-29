# Audience diagnostic-fire animation — edges (one-shot CSS `@keyframes` amber-tinted halos painted by a new DOM-overlay sibling `<AudienceDiagnosticEdgeFireOverlay>` centered on the rendered midpoint of each Cytoscape edge that becomes affected by an `activeDiagnostics` entry mid-broadcast — severity-keyed palette mirroring the node-fire sibling (amber-700 for `'blocking'`, amber-400 for `'advisory'`), gated by `useSeenKeysGate` keyed by `${diagnosticIdentityKey}\0${edgeId}` so initially-active diagnostic edges at audience-join do NOT animate, suppressed under `prefers-reduced-motion: reduce`)

**TaskJuggler entry**: [tasks/50-audience-and-broadcast.tji](../../50-audience-and-broadcast.tji) — task `audience.aud_animations.aud_diagnostic_edge_fire_animation` (lines 350-362).
**Effort estimate**: 0.5d
**Inherited dependencies**:

- `!audience.aud_animations.aud_diagnostic_fire_animation` (settled — [`tasks/refinements/audience/aud_diagnostic_fire_animation.md`](aud_diagnostic_fire_animation.md)). This is the **direct structural pattern this leaf mirrors**. The predecessor shipped (a) the audience-local `wsStore.ts` extension carrying `activeDiagnostics: ReadonlyMap<string, DiagnosticPayload>`, (b) the audience-local port of `diagnosticHighlights.ts` carrying `diagnosticIdentityKey()`, `affectedEntities()` (which already returns `edges: readonly string[]` for contradictions and the `self-contradicts` coherency-hint sub-kind), and the wire-type interfaces, (c) the `useAudienceActiveDiagnostics(sessionId)` selector hook, (d) the `<AudienceDiagnosticFireOverlay>` overlay paired with two `@keyframes aud-diagnostic-fire-{blocking,advisory}` CSS keyframes, two utility classes, `prefers-reduced-motion: reduce` overrides, and severity-keyed gradient selectors `[data-diagnostic-fire-anim][data-severity='{blocking,advisory}']`, (e) the additive `triggers?: readonly unknown[]` parameter on `useCytoscapeOverlayPlacements` enabling store-driven re-commit. Decisions §1 (CSS keyframe on React-keyed `<span>`, NOT `cy.animate()`), §3 (audience-local extension + shell extraction deferred), §4 (composite-key `useSeenKeysGate`), §5 (450 ms `cubic-bezier(0.16, 1, 0.3, 1)` `forwards`), §6 (Vitest pins React-side + CSS file presence), §7 (the explicit deferral of edges to this leaf), §8 (no persistent steady-state border on the audience) all apply verbatim modulo: (a) the iteration target (`cy.edges()` instead of `cy.nodes()`), (b) the geometry helper (edge-midpoint via `edge.renderedBoundingBox()` instead of node centre — same pattern `AnnotationOverlay.tsx` already uses for edge annotations), (c) the composite-key shape (`${identityKey}\0${edgeId}`), (d) the tuple-emission helper (`flattenActiveDiagnosticsForEdgeFire` instead of `…ForFire`), and (e) the set of diagnostic kinds that contribute (only contradiction + coherency-hint `self-contradicts` carry non-empty `edges`).
- Prose-only context (NOT a `.tji` edge): `audience.aud_animations.aud_node_appear_animation`, `aud_proposed_to_agreed_animation`, `aud_withdrawal_animation`, `aud_axiom_mark_animation`, `aud_dom_overlay_extraction` — the same chain of cumulative-posture predecessors the node-fire predecessor cited; this leaf inherits those settled decisions transitively via the predecessor.
- Prose-only context (NOT a `.tji` edge): `audience.aud_annotations.aud_annotation_rendering_edges` (settled — [`tasks/refinements/audience/aud_annotation_rendering_edges.md`](aud_annotation_rendering_edges.md)). Established the canonical audience-side edge-midpoint placement pattern: `edge.renderedBoundingBox()` → `((x1+x2)/2, (y1+y2)/2)`. The `<AudienceAnnotationOverlay>` at [`apps/audience/src/graph/AnnotationOverlay.tsx`](../../../apps/audience/src/graph/AnnotationOverlay.tsx) computes its edge-annotation positions this way; this leaf adopts the same formula for its halo centre. The alternative `edge.midpoint()` Cytoscape API is NOT used by the audience codebase and this leaf does NOT introduce it — symmetry with the existing edge-overlay sibling is the load-bearing concern.
- Prose-only context (NOT a `.tji` edge): `audience.aud_url_routing.aud_session_url` (settled — [`tasks/refinements/audience/aud_session_url.md`](aud_session_url.md), TJI `complete 100`). The audience surface is now reachable via `/a/sessions/:sessionId`; the dev-only `window.__aConversaWsStore` seam exposes the audience WS store for Playwright seeding ([`tests/e2e/audience-live-session.spec.ts:82-130`](../../../tests/e2e/audience-live-session.spec.ts#L82)). The predecessor `aud_diagnostic_fire_animation` deferred its Playwright spec to a hypothetical future leaf (`aud_session_url` had not yet shipped its scenarios when the predecessor was scoped — chain-count 9). With routing now `complete 100`, the deferral chain has been paid down; this leaf SCOPES its Playwright spec inline (Decision §6).
- Prose-only context: `aud_animations.aud_animation_pacing` (sibling, pending — [`tasks/50-audience-and-broadcast.tji:368-372`](../../50-audience-and-broadcast.tji#L368)). Once this leaf lands, the pacing task sees six shipped animation durations across the group. Whether to extend that task's `depends` line to include this leaf is a closer judgment call; this refinement notes the pacing dependency for the closer to consider but does NOT mandate it — the edge halo's geometry/timing is byte-shared with the node halo (Decision §5), so pacing-tuning the node halo already tunes this one.

## What this task is

The 0.5d edge counterpart of `aud_diagnostic_fire_animation`. The predecessor lit up the audience's **node** arrival animation for affected entities of a structural diagnostic; this leaf lights up the **edge** counterpart. Two diagnostic kinds emit non-empty `edges` arrays through `affectedEntities(payload)`:

1. **`contradiction`** — `affectedEntities()` returns `{ nodes: [nodeA, nodeB], edges: payload.edges }`, where `payload.edges: readonly string[]` is the contradicting-edge pair (the two edges that jointly form the contradiction over the existing edge set). Severity is `'blocking'`.
2. **`coherency-hint` / `self-contradicts`** — `affectedEntities()` returns `{ nodes: [nodeId], edges: [edgeId] }`, where `edgeId` is the warrant-bridge edge the hint flags. Severity is `'advisory'`.

The other three kinds (`cycle`, `multi-warrant`, `dangling-claim`) emit `edges: []` — this leaf renders nothing for them on the edge axis (the node-fire sibling already covers the node halo for cycles + multi-warrant + dangling-claim). The visual completion the leaf delivers is: when a contradiction fires, the contradicting edges briefly halo amber-700; when a self-contradicts hint fires, the flagged warrant-bridge edge briefly halos amber-400. The two diagnostic kinds that already DO carry edge identifiers stop relying on the node halos alone to communicate "this edge is part of what just fired."

Concretely the leaf does three things end-to-end:

1. **Extends `apps/audience/src/graph/diagnosticHighlights.ts`** with a sibling helper `flattenActiveDiagnosticsForEdgeFire(activeDiagnostics): readonly DiagnosticEdgeFireTuple[]` mirroring the existing `flattenActiveDiagnosticsForFire` shape but reading the `edges` field of `affectedEntities()` instead of `nodes`. The tuple type is `{ readonly identityKey: string; readonly edgeId: string; readonly severity: DiagnosticHighlightSeverity }`. The wsStore extension, `useAudienceActiveDiagnostics(sessionId)` selector hook, identity-key formula, and `affectedEntities()` projection are all **consumed unchanged** from the predecessor — this is a pure addition of one helper.
2. **Adds a `<AudienceDiagnosticEdgeFireOverlay>` DOM sibling** inside `<AudienceGraphView>`'s render tree (after the existing `<AudienceDiagnosticFireOverlay>` mount at [`apps/audience/src/graph/GraphView.tsx`](../../../apps/audience/src/graph/GraphView.tsx)). The overlay subscribes to `useAudienceActiveDiagnostics(sessionId)` via the same Zustand selector hook, flattens with the new `flattenActiveDiagnosticsForEdgeFire`, then iterates `cy.edges()` to resolve each `edgeId` to a midpoint via `edge.renderedBoundingBox()` → `((x1+x2)/2, (y1+y2)/2)` (the canonical pattern `AnnotationOverlay.tsx` already uses). `useSeenKeysGate<string>` keys on `${identityKey}\0${edgeId}` over the currently-active set; halo `<span>`s for newly-arrived (identityKey, edge) pairs get the severity-specific animation class.
3. **Reuses the predecessor's CSS keyframes verbatim** by reusing the same severity-keyed gradient selector (`[data-diagnostic-fire-anim][data-severity='…']`) and the same two utility classes (`.aud-diagnostic-fire-blocking`, `.aud-diagnostic-fire-advisory`). No new keyframes, no new `prefers-reduced-motion` override, no new CSS file additions — the halo geometry is byte-identical between node and edge variants. The edge halo IS a node-halo `<span>` placed at an edge midpoint rather than a node centre; geometrically nothing changes. Decision §5 documents the alternative of distinct edge-keyframe pulses and rejects it.

After this leaf:

- `apps/audience/src/graph/diagnosticHighlights.ts` — MODIFIED. One new exported tuple-type interface `DiagnosticEdgeFireTuple` and one new exported function `flattenActiveDiagnosticsForEdgeFire(activeDiagnostics): readonly DiagnosticEdgeFireTuple[]`. ~20 LOC.
- `apps/audience/src/graph/diagnosticHighlights.test.ts` — MODIFIED. ~5 new cases pinning `flattenActiveDiagnosticsForEdgeFire`: (a) empty input → empty; (b) `cycle` / `multi-warrant` / `dangling-claim` payloads → empty (they have no edges); (c) a `contradiction` with 2 edges → 2 tuples carrying `'blocking'` severity and the same identityKey; (d) a `self-contradicts` coherency-hint → 1 tuple carrying `'advisory'` severity; (e) a mixed map (one contradiction + one self-contradicts) → 3 tuples with mixed severity.
- `apps/audience/src/graph/DiagnosticEdgeFireOverlay.tsx` — NEW. ~140 LOC mirroring `<AudienceDiagnosticFireOverlay>`'s structure with the three deltas enumerated above (iterate `cy.edges()`, key on `${identityKey}\0${edgeId}`, use `edge.renderedBoundingBox()` midpoint).
- `apps/audience/src/graph/DiagnosticEdgeFireOverlay.test.tsx` — NEW. ~10 Vitest cases (initial-mount no-class, post-mount contradiction fire animates both edges with blocking class, post-mount self-contradicts fire animates one edge with advisory class, post-mount cycle fire — no edge halos, post-mount clear unmounts halos, re-fire after clear no-op, multi-diagnostic on overlapping edge yields two halos with distinct composite keys, edge referenced by diagnostic but absent from `cy` silently skipped, `aria-hidden="true"` + data attributes present, parameterized severity smoke).
- `apps/audience/src/graph/GraphView.tsx` — MODIFIED. One new import (`AudienceDiagnosticEdgeFireOverlay`), one new mount line after the existing `<AudienceDiagnosticFireOverlay>`, one header docblock refinement-trail entry.
- `apps/audience/src/graph/GraphView.test.tsx` — POSSIBLY MODIFIED. If existing assertions count overlays, bump 6 → 7. Otherwise byte-unchanged.
- `tests/e2e/audience-live-session.spec.ts` — MODIFIED. One new scenario appended exercising the contradiction-fire path through edge halos (Decision §6).
- `apps/audience/src/index.css` — UNCHANGED. Reuses the predecessor's keyframes + utility classes + reduced-motion overrides + base `[data-diagnostic-fire-anim]` selector. The edge halo IS a node halo at a different (x, y).
- `apps/audience/src/index.test.ts` — UNCHANGED. No new CSS to pin.
- `apps/audience/src/ws/wsStore.ts`, `apps/audience/src/ws/useAudienceActiveDiagnostics.ts`, `apps/audience/src/graph/cytoscapeOverlayHooks.ts` — UNCHANGED. The predecessor's seams are consumed verbatim.
- `tasks/50-audience-and-broadcast.tji` — MODIFIED at close-time only: closer adds `complete 100` to `aud_diagnostic_edge_fire_animation`.

Out of scope (deferred or already covered):

- **Cycle edge halos.** A cycle's `nodes: ['A','B','C']` IS structurally a ring `A→B→C→A`, but the `affectedEntities()` projection for `cycle` returns `edges: []` — the wire payload does NOT name the directed cycle edges. Reconstructing them client-side would require a graph walk against `cy.edges()`, and the node halos already communicate "these three nodes are jointly the cycle." Adding cycle-edge halos is a richer visualization deferred to the speculative `aud_diagnostic_cycle_chase_animation` named in `aud_diagnostic_fire_animation` Out-of-scope (NOT pre-registered today).
- **`multi-warrant` warrant-bridge edges.** A multi-warrant diagnostic flags `warrantNodeIds: readonly string[]` — the bridging edges (from warrant nodes to the claim node) are NOT named on the wire. Same reconstruction-from-cy issue as cycle edges. Deferred to the same speculative leaf.
- **`dangling-claim` warrant-absence visualization.** A dangling-claim names a single node with no warrant; there is no edge to halo. Out of scope by data shape.
- **Distinct edge-specific keyframe.** Considered (Decision §5) and rejected in favour of reusing the node halo's keyframes byte-identical. If a future visual-design pass calls for an edge-specific pulse (e.g., a line-of-light traveling along the edge), it is a separate animation class with its own scope.
- **Persistent steady-state edge-diagnostic-highlight border.** Same posture as the node-fire sibling Decision §8 — the audience does NOT paint persistent diagnostic-highlight edges. The animation is the entire edge-diagnostic surface.
- **A WS-message dedicated to "edge highlighted" events.** Out of scope; the leaf consumes the existing `diagnostic` WS message via the predecessor's wsStore extension.
- **Visual-regression scenario.** Post-animation steady state is no decoration; the canvas paint is unchanged. No new VR scenario.
- **Pacing tuning.** The 450 ms / `cubic-bezier(0.16, 1, 0.3, 1)` constants are inherited verbatim from the node sibling; `aud_animation_pacing` revisits across the group.
- **Shell-side lift.** The leaf adds one helper to the audience-local `diagnosticHighlights.ts`; that helper is in-scope for the future `shell_diagnostic_highlights_extract` named-future-task `aud_diagnostic_fire_animation` registered. No new shell extraction work in THIS leaf.

## Why it needs to be done

The predecessor's Decision §7 is the proximate why: "Splitting matches the 1d budget and follows the consolidated 'nodes-only' precedent the DOM-overlay siblings have respected." That decision created tech debt — a contradiction firing today halos the two affected nodes but NOT the contradicting edge that connects them; a self-contradicts coherency-hint halos the warrant-source node but NOT the warrant-bridge edge that the hint actually flags. The broadcast viewer reads "these two nodes contradict" from the node halos and infers the edge structurally, which is acceptable but incomplete — the methodology engine's actual finding is about a property of the **edge set**, not only the node set. This leaf closes that gap.

The methodological argument is sharper for the **self-contradicts** sub-kind than for **contradiction**:

- `contradiction` flags an inconsistency reachable through the existing edge set; the contradicting edges are the load-bearing graph structure. Halo'ing only the two endpoint nodes is structurally underspecified — a viewer cannot tell which two of the (potentially many) edges between A and B are the contradicting pair without seeing the edge halos.
- `self-contradicts` flags a warrant that, if applied, would inscribe a contradiction. The hint's locus is the **warrant-bridge edge** itself; halo'ing only the source node misses the hint's referent entirely. Without edge halos, the audience surface fails to even gesture at where the hint applies on the edge axis.

Without this leaf, the audience surface's diagnostic axis is silently incomplete for two of the five diagnostic kinds. With it, the surface is complete: every kind that emits a non-empty `edges` field gets a visible halo on each affected edge.

Downstream concretely:

- The future `aud_diagnostic_clear_animation` (NOT pre-registered) would naturally cover both nodes and edges — having the edge overlay structurally analogous to the node overlay keeps that future leaf's surface symmetric.
- `shell_diagnostic_highlights_extract` (NOT yet authored — named-future-task from `aud_diagnostic_fire_animation` Decision §3) lifts both `flattenActiveDiagnosticsForFire` and (now) `flattenActiveDiagnosticsForEdgeFire` to `@a-conversa/shell` in one consolidated move. Landing them together as a sibling pair under this leaf makes the future lift mechanical.
- The `aud_animations` group's count rises from five shipped to six; the only remaining unshipped sibling is `aud_decomposition_animation`.

Architecturally, this leaf is the smallest possible edge-axis follow-on the predecessor's seams already make trivial — one helper + one overlay + one Playwright scenario.

## Inputs / context

### ADRs

- [ADR 0004 — Graph libraries: ReactFlow + Cytoscape.js](../../../docs/adr/0004-graph-libraries-reactflow-and-cytoscape.md) — the audience uses Cytoscape with React DOM overlays. Per-element React decoration is the canonical pattern; `cy.animate(...)` rejected for the same reasons the node sibling rejected it.
- [ADR 0005 — Styling: Tailwind v4 + shared tokens](../../../docs/adr/0005-styling-tailwind-with-shared-tokens.md) — audience CSS lives at `apps/audience/src/index.css`; this leaf adds NO new CSS (the predecessor's keyframes are reused).
- [ADR 0008 — E2E framework: Playwright](../../../docs/adr/0008-e2e-framework-playwright.md) — Playwright is the audience-surface E2E layer; this leaf's scenario lands in `tests/e2e/audience-live-session.spec.ts` (Decision §6).
- [ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md) — Vitest pins the React-side per-render behaviour AND the `flattenActiveDiagnosticsForEdgeFire` helper contract. The Playwright scenario adds one cumulative scenario to the already-routed audience spec.
- [ADR 0026 — Micro-frontend root app](../../../docs/adr/0026-micro-frontend-root-app.md) — the audience artifact owns the new overlay; the file ships inside the audience bundle.
- [ADR 0027 — Entity and facet layers are strictly separate](../../../docs/adr/0027-entity-and-facet-layers-strict-separation.md) — diagnostics live at the entity layer; the edge halo decorates entity-layer edges. The facet-pill layer is untouched.

No new ADR. The architectural seams (DOM-overlay halo with CSS-first keyframe, audience-local `flattenActive…` helper alongside its node sibling, edge-midpoint placement via `edge.renderedBoundingBox()`) are either settled by existing ADRs or by the cumulative posture the node-fire predecessor reinforced.

### Sibling refinements

- [`tasks/refinements/audience/aud_diagnostic_fire_animation.md`](aud_diagnostic_fire_animation.md) — **the direct structural pattern**. Every decision in this leaf is "same as the node sibling, modulo edge-iteration." The predecessor's §1, §3, §4, §5, §6, §8 all apply verbatim.
- [`tasks/refinements/audience/aud_annotation_rendering_edges.md`](aud_annotation_rendering_edges.md) — established the canonical audience-side edge-midpoint placement via `edge.renderedBoundingBox()` → `((x1+x2)/2, (y1+y2)/2)`; this leaf adopts the same formula.
- [`tasks/refinements/audience/aud_dom_overlay_extraction.md`](aud_dom_overlay_extraction.md) — established `useCytoscapeOverlayPlacements<P>` and `useSeenKeysGate<K>` as the shared hooks consumed verbatim by every overlay sibling.
- [`tasks/refinements/audience/aud_session_url.md`](aud_session_url.md) — landed the `/a/sessions/:sessionId` route; the dev-only `window.__aConversaWsStore` seam at [`apps/audience/src/main.tsx`](../../../apps/audience/src/main.tsx) is the harness this leaf's Playwright scenario consumes.

### Live code the leaf modifies / creates

- [`apps/audience/src/graph/diagnosticHighlights.ts`](../../../apps/audience/src/graph/diagnosticHighlights.ts) — MODIFIED. Add the `DiagnosticEdgeFireTuple` interface and the `flattenActiveDiagnosticsForEdgeFire` helper symmetric with the existing `flattenActiveDiagnosticsForFire`:

  ```ts
  export interface DiagnosticEdgeFireTuple {
    readonly identityKey: string;
    readonly edgeId: string;
    readonly severity: DiagnosticHighlightSeverity;
  }

  export function flattenActiveDiagnosticsForEdgeFire(
    activeDiagnostics: ReadonlyMap<string, DiagnosticPayload>,
  ): readonly DiagnosticEdgeFireTuple[] {
    const tuples: DiagnosticEdgeFireTuple[] = [];
    for (const [identityKey, payload] of activeDiagnostics) {
      const { edges } = affectedEntities(payload);
      for (const edgeId of edges) {
        tuples.push({ identityKey, edgeId, severity: payload.severity });
      }
    }
    return tuples;
  }
  ```

  The `affectedEntities()` projection that already exists handles every kind correctly: `cycle` / `multi-warrant` / `dangling-claim` return `edges: []` and contribute nothing; `contradiction` returns `edges: payload.edges` and contributes one tuple per contradicting edge; the `self-contradicts` sub-kind of `coherency-hint` returns `edges: [edgeId]` and contributes one tuple. No projection-layer surgery is needed.

- [`apps/audience/src/graph/diagnosticHighlights.test.ts`](../../../apps/audience/src/graph/diagnosticHighlights.test.ts) — MODIFIED. Append ~5 cases pinning the helper:
  1. Empty `activeDiagnostics` → empty array.
  2. Cycle / multi-warrant / dangling-claim payloads → empty array (their `affectedEntities().edges` is empty).
  3. A contradiction payload with `edges: ['e1', 'e2']` → 2 tuples carrying the same identityKey and severity `'blocking'`.
  4. A `self-contradicts` coherency-hint payload with `edgeId: 'e3'` → 1 tuple carrying severity `'advisory'`.
  5. Mixed-map (one contradiction + one self-contradicts) → 3 tuples total with mixed severity.

- `apps/audience/src/graph/DiagnosticEdgeFireOverlay.tsx` — NEW. ~140 LOC mirroring the structural shape of `<AudienceDiagnosticFireOverlay>` at [`apps/audience/src/graph/DiagnosticFireOverlay.tsx`](../../../apps/audience/src/graph/DiagnosticFireOverlay.tsx) with three deltas. Sketch:

  ```tsx
  import { useMemo, type ReactElement, type RefObject } from 'react';
  import type { Core, EdgeSingular } from 'cytoscape';
  import { useCytoscapeOverlayPlacements, useSeenKeysGate } from './cytoscapeOverlayHooks.js';
  import {
    flattenActiveDiagnosticsForEdgeFire,
    type DiagnosticEdgeFireTuple,
  } from './diagnosticHighlights.js';
  import { useAudienceActiveDiagnostics } from '../ws/useAudienceActiveDiagnostics.js';

  export interface AudienceDiagnosticEdgeFireOverlayProps {
    readonly cy: Core | null;
    readonly containerRef: RefObject<HTMLDivElement | null>;
    readonly sessionId: string | null;
  }

  interface DiagnosticEdgeFirePlacement {
    readonly compositeKey: string;
    readonly identityKey: string;
    readonly edgeId: string;
    readonly severity: 'blocking' | 'advisory';
    readonly x: number;
    readonly y: number;
  }

  export function AudienceDiagnosticEdgeFireOverlay({
    cy,
    containerRef,
    sessionId,
  }: AudienceDiagnosticEdgeFireOverlayProps): ReactElement {
    void containerRef;
    const active = useAudienceActiveDiagnostics(sessionId ?? '');
    const tuples = useMemo(() => flattenActiveDiagnosticsForEdgeFire(active), [active]);
    const placements = useCytoscapeOverlayPlacements<DiagnosticEdgeFirePlacement>(
      cy,
      (cyInstance) => commitDiagnosticEdgeFirePlacements(cyInstance, tuples),
      [tuples],
    );
    const compositeKeys = placements.map((p) => p.compositeKey);
    const isNewPair = useSeenKeysGate(compositeKeys);

    return (
      <div
        data-testid="audience-diagnostic-edge-fire-overlay"
        className="pointer-events-none absolute inset-0"
        aria-hidden="true"
      >
        {placements.map((p) => {
          const animClass = isNewPair(p.compositeKey)
            ? p.severity === 'blocking'
              ? 'aud-diagnostic-fire-blocking'
              : 'aud-diagnostic-fire-advisory'
            : '';
          return (
            <span
              key={p.compositeKey}
              data-diagnostic-fire-anim=""
              data-diagnostic-fire-locus="edge"
              data-severity={p.severity}
              data-identity-key={p.identityKey}
              data-edge-id={p.edgeId}
              className={animClass}
              style={{
                position: 'absolute',
                left: `${String(p.x)}px`,
                top: `${String(p.y)}px`,
                transform: 'translate(-50%, -50%)',
              }}
            />
          );
        })}
      </div>
    );
  }

  function commitDiagnosticEdgeFirePlacements(
    cy: Core,
    tuples: readonly DiagnosticEdgeFireTuple[],
  ): readonly DiagnosticEdgeFirePlacement[] {
    const next: DiagnosticEdgeFirePlacement[] = [];
    for (const t of tuples) {
      const edge = cy.getElementById(t.edgeId) as EdgeSingular;
      if (edge.empty() || !edge.isEdge()) continue;
      const bb = edge.renderedBoundingBox();
      next.push({
        compositeKey: `${t.identityKey}\0${t.edgeId}`,
        identityKey: t.identityKey,
        edgeId: t.edgeId,
        severity: t.severity,
        x: (bb.x1 + bb.x2) / 2,
        y: (bb.y1 + bb.y2) / 2,
      });
    }
    return next;
  }
  ```

  Three notes on the sketch:
  - `data-diagnostic-fire-locus="edge"` is added as a discriminator attribute so test selectors can distinguish node-halo `<span>`s from edge-halo `<span>`s on the same surface. The base CSS selector `[data-diagnostic-fire-anim]` does NOT branch on locus — geometry is shared — but the attribute lets Vitest and Playwright unambiguously pick out the edge halos. The node overlay does NOT need a paired update (its halos lack the attribute, which is fine — the Playwright/Vitest selector for edge halos is `[data-diagnostic-fire-anim][data-diagnostic-fire-locus="edge"]`; the node-halo selector remains `[data-diagnostic-fire-anim]:not([data-diagnostic-fire-locus="edge"])` or `[data-diagnostic-fire-anim][data-node-id]`, both stable).
  - `edge.isEdge()` guards against the rare case `getElementById` returns a node with the same id (Cytoscape's id namespace is shared between nodes and edges in principle, though the projector emits disjoint id sets in practice — the guard is cheap insurance).
  - The `[tuples]` triggers-array parameter on `useCytoscapeOverlayPlacements` is the same hook extension `aud_diagnostic_fire_animation` Decision §3a landed; consumed verbatim.

- `apps/audience/src/graph/DiagnosticEdgeFireOverlay.test.tsx` — NEW. ~10 Vitest cases:
  1. Initial mount with empty `activeDiagnostics` → no halos rendered.
  2. Initial mount with one contradiction already active over edges `['e1', 'e2']` → 2 halos rendered, neither carries the animation class (lazy-init seed).
  3. Post-mount fire of a contradiction (2 edges, previously empty) → 2 halos appear and each carries `aud-diagnostic-fire-blocking`.
  4. Post-mount fire of a self-contradicts coherency-hint → 1 halo appears carrying `aud-diagnostic-fire-advisory`.
  5. Post-mount fire of a `cycle` payload → no halos (cycle emits empty edges array).
  6. Post-mount fire of a `multi-warrant` payload → no halos.
  7. Post-mount `'cleared'` event removes the halos (they unmount).
  8. Re-`'fired'` of the same identityKey after `'cleared'` does NOT re-animate (seen-Set retains the composite key).
  9. Multi-diagnostic on overlapping edge (a contradiction names `e1`; a separate self-contradicts also names `e1`) → `e1` gets TWO halos with different composite keys: the blocking one carries `aud-diagnostic-fire-blocking`, the advisory one carries `aud-diagnostic-fire-advisory`.
  10. Edge `'eGhost'` named by a diagnostic but absent from `cy` (`cy.getElementById('eGhost').empty()` true) is silently skipped (no halo, no crash, no console error).

  Halo `<span>` carries `data-diagnostic-fire-anim`, `data-diagnostic-fire-locus="edge"`, `data-severity`, `data-identity-key`, `data-edge-id` attributes (smoke assertion folded into case 3); wrapper carries `aria-hidden="true"` (folded into case 1).

- [`apps/audience/src/graph/GraphView.tsx`](../../../apps/audience/src/graph/GraphView.tsx) — MODIFIED. Three additive edits:
  - One import line for `AudienceDiagnosticEdgeFireOverlay`.
  - One mount line after the existing `<AudienceDiagnosticFireOverlay>` mount (the new overlay becomes the seventh DOM-overlay sibling).
  - One header refinement-trail entry.
  
  The `sessionId` prop is already destructured in scope from `useAudienceSession()` ([`apps/audience/src/graph/GraphView.tsx:287`](../../../apps/audience/src/graph/GraphView.tsx#L287)) and is passed identically to the edge overlay as it is to the node overlay.

- [`apps/audience/src/graph/GraphView.test.tsx`](../../../apps/audience/src/graph/GraphView.test.tsx) — POSSIBLY MODIFIED. If a smoke test asserts overlay count, bump 6 → 7; otherwise byte-unchanged.

- [`tests/e2e/audience-live-session.spec.ts`](../../../tests/e2e/audience-live-session.spec.ts) — MODIFIED. Append one new scenario "Diagnostic-fire edge halo on contradiction" exercising the user-visible behaviour this leaf adds (Decision §6). Sketched scenario shape:

  ```ts
  test('Diagnostic-fire edge halo on contradiction', async ({ browser }, testInfo) => {
    const context = await freshAuthedContext(browser);
    await loginAs(context, /* one of the unallocated DEV_USER_POOL users */);
    const page = await context.newPage();
    const sessionId = await createSession(page, {
      topic: 'Diagnostic-fire edge halo on a contradiction over the audience route',
      privacy: 'public',
    });
    await page.goto(`/a/sessions/${sessionId}`);
    await expect(page.getByTestId('audience-graph-root')).toBeVisible();

    // Seed two nodes + an edge so cy has elements to halo against.
    await seedNodeCreated(page, /* node A */);
    await seedNodeCreated(page, /* node B */);
    await seedEdgeCreated(page, /* edge e1 from A to B */);
    await seedEdgeCreated(page, /* edge e2 from B to A or another */);

    // Pre-fire snapshot: no edge-locus halos.
    expect(await page.locator(
      '[data-diagnostic-fire-anim][data-diagnostic-fire-locus="edge"]'
    ).count()).toBe(0);

    // Apply a contradiction diagnostic via the dev seam.
    await applyDiagnostic(page, {
      sessionId,
      status: 'fired',
      severity: 'blocking',
      kind: 'contradiction',
      payload: { nodeA: 'A', nodeB: 'B', edges: ['e1', 'e2'] },
    });

    // Two edge halos appear, both carrying the blocking animation class
    // within the rAF settle window.
    const haloLocator = page.locator(
      '[data-diagnostic-fire-anim][data-diagnostic-fire-locus="edge"]'
    );
    await expect(haloLocator).toHaveCount(2);
    await expect(haloLocator.first()).toHaveClass(/aud-diagnostic-fire-blocking/);
    await expect(haloLocator.nth(1)).toHaveClass(/aud-diagnostic-fire-blocking/);
  });
  ```

  The exact seed-event helper shapes (`seedEdgeCreated`, `applyDiagnostic`) follow the existing seam in `audience-live-session.spec.ts:82-130`; if either helper does not yet exist, this leaf adds it as a small sibling of `seedNodeCreated`. The `applyDiagnostic` seed must reach `window.__aConversaWsStore.getState().applyDiagnostic(payload)` (the predecessor's wsStore extension exposes this; the dev seam already exposes the store globally).

- `apps/audience/src/index.css` — UNCHANGED. The predecessor's `[data-diagnostic-fire-anim]` base selector + per-severity gradient selectors + two keyframes + two utility classes + `prefers-reduced-motion: reduce` overrides are reused verbatim. Decision §5 documents the alternative of distinct edge-specific keyframes and rejects it.
- `apps/audience/src/index.test.ts` — UNCHANGED. No new CSS keyframes to pin.
- `apps/audience/src/ws/wsStore.ts`, `apps/audience/src/ws/wsStore.test.ts`, `apps/audience/src/ws/useAudienceActiveDiagnostics.ts` — UNCHANGED.
- `apps/audience/src/graph/cytoscapeOverlayHooks.ts`, `apps/audience/src/graph/cytoscapeOverlayHooks.test.tsx` — UNCHANGED. The `triggers` extension the predecessor landed is consumed verbatim.
- `apps/audience/src/graph/projectGraph.ts`, `apps/audience/src/graph/stylesheet.ts` — UNCHANGED. No new selectors, no new `data` fields (Decision §8 of the node sibling).
- `packages/shell/**`, `packages/shared-types/**`, `apps/server/**`, `apps/moderator/**`, `apps/participant/**`, `apps/root/**` — UNCHANGED.
- `apps/audience/package.json` — UNCHANGED. No new dependency.

### What the surface MUST NOT do

- **No new dependency.** Same posture as the node sibling.
- **No edit to `@a-conversa/shell`** (the lift remains the named-future-task `shell_diagnostic_highlights_extract`).
- **No edit to the Cytoscape `STYLESHEET`.** No persistent diagnostic-highlight edges (Decision §8 of the node sibling applies).
- **No `cy.animate(...)` call.** Halos are React DOM overlays.
- **No JS-driven tween loop.** CSS keyframe + GPU compositor.
- **No animation on initial mount.** Lazy-init seed via `useSeenKeysGate`.
- **No animation re-fire on pan/zoom/resize.** Composite-key reconciliation.
- **No animation on `'cleared'` events.** Same posture as the node sibling.
- **No animation on re-`'fired'` of the same identityKey.** Same seen-Set posture.
- **No new keyframes.** The node sibling's `aud-diagnostic-fire-blocking` / `aud-diagnostic-fire-advisory` keyframes are reused verbatim. Decision §5 below.
- **No new i18n keys.** Halos carry no visible text; `aria-hidden="true"`.
- **No node halos.** Strict edge-only iteration in `commitDiagnosticEdgeFirePlacements`. The node halos are the node sibling's responsibility.
- **No reconstruction of cycle / multi-warrant edges from `cy.edges()`.** Out of scope by data shape (the wire payload does not name them).

## Constraints / requirements

### Files this task touches (explicit allowlist)

- `apps/audience/src/graph/diagnosticHighlights.ts` — MODIFIED. ~20 LOC: one new exported interface (`DiagnosticEdgeFireTuple`) and one new exported function (`flattenActiveDiagnosticsForEdgeFire`).
- `apps/audience/src/graph/diagnosticHighlights.test.ts` — MODIFIED. ~5 new Vitest cases pinning `flattenActiveDiagnosticsForEdgeFire`.
- `apps/audience/src/graph/DiagnosticEdgeFireOverlay.tsx` — NEW. ~140 LOC; sketch under Inputs / context above.
- `apps/audience/src/graph/DiagnosticEdgeFireOverlay.test.tsx` — NEW. ~10 Vitest cases.
- `apps/audience/src/graph/GraphView.tsx` — MODIFIED. Three additive edits.
- `apps/audience/src/graph/GraphView.test.tsx` — POSSIBLY MODIFIED. Overlay-count bump only if asserted.
- `tests/e2e/audience-live-session.spec.ts` — MODIFIED. One new test scenario appended; the header docblock's spec-scenario count rises by one (the existing scenarios are explicitly enumerated, so this leaf adds a seventh enumerated scenario "Diagnostic-fire edge halo on contradiction" and updates the docblock's case-list).
- `tasks/50-audience-and-broadcast.tji` — MODIFIED at close-time only: closer adds `complete 100`.

### Files this task does NOT touch

- `apps/server/**`, `apps/moderator/**`, `apps/participant/**`, `apps/root/**` — UNCHANGED.
- `packages/shell/**`, `packages/shared-types/**`, `packages/i18n-catalogs/**` — UNCHANGED.
- `apps/audience/src/ws/**` — UNCHANGED (the wsStore extension and the selector hook are consumed unchanged).
- `apps/audience/src/graph/cytoscapeOverlayHooks.ts`, `apps/audience/src/graph/cytoscapeOverlayHooks.test.tsx` — UNCHANGED (the predecessor's `triggers` extension is consumed verbatim).
- `apps/audience/src/graph/DiagnosticFireOverlay.tsx`, `apps/audience/src/graph/DiagnosticFireOverlay.test.tsx` — UNCHANGED (the node sibling is independent; this leaf adds a parallel overlay rather than modifying the existing one).
- `apps/audience/src/graph/projectGraph.ts`, `apps/audience/src/graph/stylesheet.ts`, `apps/audience/src/graph/facetStatus.ts`, the other overlay siblings — UNCHANGED.
- `apps/audience/src/App.tsx`, `apps/audience/src/main.tsx` — UNCHANGED.
- `apps/audience/src/index.css`, `apps/audience/src/index.test.ts` — UNCHANGED (no new CSS; Decision §5).
- `apps/audience/package.json` — UNCHANGED.
- `docs/adr/**` — UNCHANGED. No new ADR.
- `playwright.config.ts` — UNCHANGED.

## Acceptance criteria

The check that says "done":

- `apps/audience/src/graph/diagnosticHighlights.ts` exports `DiagnosticEdgeFireTuple` and `flattenActiveDiagnosticsForEdgeFire`. The helper iterates the activeDiagnostics map, calls `affectedEntities()` on each payload, and emits one tuple per `(identityKey, edgeId, severity)` from each payload's `edges`. The signature mirrors `flattenActiveDiagnosticsForFire` modulo `edgeId` vs `nodeId`.
- `apps/audience/src/graph/diagnosticHighlights.test.ts` carries the 5 new cases; the suite passes.
- `apps/audience/src/graph/DiagnosticEdgeFireOverlay.tsx` exists with the structure given under Inputs / context. The overlay subscribes to `useAudienceActiveDiagnostics`, consumes `flattenActiveDiagnosticsForEdgeFire`, passes `[tuples]` as the `triggers` argument to `useCytoscapeOverlayPlacements`, gates on `${identityKey}\0${edgeId}` composite keys, applies severity-keyed animation classes (reusing the predecessor's `aud-diagnostic-fire-blocking` / `aud-diagnostic-fire-advisory` classes verbatim), and renders halo `<span>`s carrying `data-diagnostic-fire-anim`, `data-diagnostic-fire-locus="edge"`, `data-severity`, `data-identity-key`, `data-edge-id`.
- `apps/audience/src/graph/DiagnosticEdgeFireOverlay.test.tsx` carries the 10 cases; all pass.
- `apps/audience/src/graph/GraphView.tsx` carries the import + mount + header-trail edits; the overlay mounts as the seventh DOM-overlay sibling, after the existing `<AudienceDiagnosticFireOverlay>`.
- `apps/audience/src/graph/GraphView.test.tsx` either remains byte-unchanged or has its overlay count bumped from 6 to 7.
- `apps/audience/src/graph/DiagnosticFireOverlay.tsx` and `apps/audience/src/graph/DiagnosticFireOverlay.test.tsx` remain byte-unchanged.
- `apps/audience/src/index.css` and `apps/audience/src/index.test.ts` remain byte-unchanged. No new keyframes, no new utility classes, no new `prefers-reduced-motion` overrides.
- `apps/audience/src/ws/wsStore.ts`, `apps/audience/src/ws/wsStore.test.ts`, `apps/audience/src/ws/useAudienceActiveDiagnostics.ts`, `apps/audience/src/graph/cytoscapeOverlayHooks.ts`, `apps/audience/src/graph/cytoscapeOverlayHooks.test.tsx` remain byte-unchanged.
- `apps/audience/package.json` is byte-unchanged (no new dependency).
- All existing audience overlay tests pass byte-unchanged.
- Per ADR 0022, no throwaway smoke scripts. Vitest pins the React-side per-render class logic (10 overlay cases) AND the helper contract (5 helper cases) = 15 new Vitest cases.
- **Playwright spec — INLINE, NOT DEFERRED.** `tests/e2e/audience-live-session.spec.ts` carries the appended scenario "Diagnostic-fire edge halo on contradiction" exercising the route → seed → fire → assert-halo path. The audience surface is now reachable (`aud_session_url` is `complete 100`); the dev-seam exposing `window.__aConversaWsStore` enables the seed-then-fire seam. The scenario asserts: (a) pre-fire, no edge-locus halos rendered; (b) after `applyDiagnostic(...)` with a `contradiction` payload naming two edges, exactly 2 edge-locus halos render, each carrying `aud-diagnostic-fire-blocking`. The scenario uses a distinct `DEV_USER_POOL` member to preserve `fullyParallel: true` semantics — the implementer picks an unallocated user when scoping the diff. The spec's header docblock gets one new enumerated scenario entry.
- `pnpm run check` clean (strict TS pass; no new dep declared).
- `pnpm run test:smoke` green (Vitest count rises by 15).
- `pnpm -F @a-conversa/audience build` succeeds. Bundle-size delta is small — one new file (~140 LOC), no CSS additions, no new dependency.
- Playwright suite green (the new scenario passes; the existing six scenarios pass byte-unchanged).
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent (pre-commit hook enforces).
- `tasks/50-audience-and-broadcast.tji` gets `complete 100` on `aud_diagnostic_edge_fire_animation`.

The leaf does NOT register named-future-tasks; the only follow-on (the shell extraction `shell_diagnostic_highlights_extract`) is already registered against the node sibling.

## Decisions

### §1 — Parallel `<AudienceDiagnosticEdgeFireOverlay>` rather than folding edge-iteration into the existing node overlay

Three options for "where edges get halo'd":

A. **A new `<AudienceDiagnosticEdgeFireOverlay>` DOM sibling** mounted alongside the existing `<AudienceDiagnosticFireOverlay>`, iterating `cy.edges()` against a sibling helper `flattenActiveDiagnosticsForEdgeFire`. Each overlay paints one geometric class (node centres vs edge midpoints).

B. **Fold edge iteration into `<AudienceDiagnosticFireOverlay>`** so one overlay paints halos at BOTH node centres AND edge midpoints, gated by `data-diagnostic-fire-locus` discriminator. The helper would emit both node-tuples and edge-tuples from a single `flattenActiveDiagnosticsForFire` (broadened).

C. **A higher-order overlay** that orchestrates both node and edge halo iteration via configurable iteration target (`cy.nodes()` | `cy.edges()`).

**Chosen: A.** Three reasons:

1. **Symmetry with the existing overlay-per-semantic-class pattern.** The audience's six existing DOM overlays each paint exactly one semantic class of decoration (per-facet pills, axiom marks, annotations, node-appear halos, withdrawal halos, diagnostic-fire node halos). Adding a seventh "diagnostic-fire edge halos" overlay is the structurally consistent move; mixing two iteration targets into one overlay would break that symmetry. The node sibling's Decision §2 reinforced this pattern; this leaf inherits it.
2. **Zero-risk to the node sibling.** Option A leaves the predecessor's overlay and tests byte-unchanged; option B would touch the predecessor's overlay file + its 13+5=18 test cases + the `flattenActiveDiagnosticsForFire` helper + its 12 test cases. The blast radius is much larger and the regression-risk surface is wider for no architectural benefit.
3. **Each overlay's tests stay focused.** The node overlay's tests can keep asserting "no edge halos rendered" implicitly (because the overlay doesn't render any); the edge overlay's tests can keep asserting "no node halos rendered" implicitly. Folding the two would force each test to disambiguate locus on every assertion.

Option B is rejected. Option C is over-engineered for a 0.5d task with two known iteration targets; the higher-order abstraction would be premature.

### §2 — `flattenActiveDiagnosticsForEdgeFire` is a sibling helper in the same module, NOT a broadened `flattenActiveDiagnosticsForFire`

Three options for the helper shape:

A. **Sibling helper `flattenActiveDiagnosticsForEdgeFire` in `apps/audience/src/graph/diagnosticHighlights.ts`** alongside the existing `flattenActiveDiagnosticsForFire`. Each helper has a focused return type (`DiagnosticFireTuple` vs `DiagnosticEdgeFireTuple`); each helper iterates one field of `affectedEntities()`.

B. **Broaden `flattenActiveDiagnosticsForFire` to emit a tagged-union of node-tuples and edge-tuples**: `{ kind: 'node', identityKey, nodeId, severity } | { kind: 'edge', identityKey, edgeId, severity }`. Each overlay would filter the unified stream.

C. **Compose**: a single `affectedEntityTuples(activeDiagnostics, target: 'nodes' | 'edges')` that takes the iteration target as a parameter.

**Chosen: A.** The sibling-helper pattern is the audience codebase's established posture (compare `axiomMarks.ts` / `annotations.ts` which each carry their own focused projection helpers). It preserves type-narrowing on each tuple shape without runtime discrimination, keeps each helper's test surface tight (the node helper's tests don't need to assert "no edge tuples emitted"; the edge helper's tests don't need to assert "no node tuples"), and matches how the future `shell_diagnostic_highlights_extract` will most likely lift them — as two named exports rather than one polymorphic one. Option B's tagged-union adds runtime kind-checks to every consumer; option C's parameterized helper buys nothing the two-sibling pattern doesn't already give.

### §3 — Edge midpoint via `edge.renderedBoundingBox()`, NOT `edge.midpoint()` (codebase convention)

Two options for edge-midpoint geometry:

A. **`edge.renderedBoundingBox()` → `((x1+x2)/2, (y1+y2)/2)`** — the canonical pattern `AnnotationOverlay.tsx` already uses for edge-annotation placement on the audience surface ([`apps/audience/src/graph/AnnotationOverlay.tsx`](../../../apps/audience/src/graph/AnnotationOverlay.tsx)). Returns the centre of the rendered AABB, which for straight edges IS the geometric midpoint; for curved edges (Cytoscape's `bezier`/`unbundled-bezier` curve styles) the AABB centre approximates the curve midpoint closely enough for a halo (which is a circle, not a point).

B. **`edge.midpoint()`** — Cytoscape's geometry-aware midpoint method, returning the exact midpoint along the curve.

**Chosen: A.** The audience codebase has NO existing usage of `edge.midpoint()`; `AnnotationOverlay.tsx` uses the AABB-centre pattern for its edge annotations. Symmetry with the existing edge-overlay sibling is the load-bearing concern — a halo on an edge should sit at the same visual locus as the edge's annotation chip if both are present; using two different midpoint formulae would produce a subtle visual offset between sibling decorations. The AABB-centre approximation is also robust to Cytoscape rendering quirks (the AABB is always defined; `.midpoint()` has had edge-cases on certain curve styles in older Cytoscape versions). If a future visual-design pass requires exact-curve midpoints, both `AnnotationOverlay` and this overlay would adopt the change together.

### §4 — Composite key `${identityKey}\0${edgeId}` matches the node sibling's `${identityKey}\0${nodeId}` shape

Same posture as the node sibling's Decision §4. The composite key uniquely identifies a (diagnostic, edge) arrival; the seen-Set retains it across re-renders. A self-contradicts hint on `e3` and a contradiction also naming `e3` produce two distinct composite keys → two distinct halos with potentially different severity classes, exactly as the node sibling handles a node affected by multiple diagnostics.

### §5 — Reuse the node sibling's CSS keyframes byte-identical; NO new CSS additions

Three options:

A. **Reuse `aud-diagnostic-fire-blocking` / `aud-diagnostic-fire-advisory` keyframes + utility classes verbatim.** The edge halo IS visually a node halo at a different (x, y) — the geometry is the same (96px circle, radial gradient, 450 ms decelerated scale-and-fade). No CSS additions.

B. **Add edge-specific keyframes `aud-diagnostic-edge-fire-blocking` / `…-advisory`** with subtly different geometry (e.g., elongated halo aligned along the edge tangent).

C. **Add a "line-of-light" animation traveling along the edge** as a richer visualization.

**Chosen: A.** Three reasons:

1. **The geometry argument from the predecessor applies verbatim.** The 96px circle reads as "this thing has been flagged"; whether the centre is a node or an edge midpoint, the cue is the same.
2. **Zero CSS additions keeps the diff focused.** This is a 0.5d leaf; adding CSS surface area would compound risk and require new `prefers-reduced-motion` overrides + new `index.test.ts` smoke pins. The leaf's effort budget matches "two files: helper + overlay + test files + one Playwright scenario."
3. **A future visual-design pass can opt into option B or C** without invalidating this leaf's overlay scaffold — the overlay reads from store, computes placements, applies classes; swapping the classes is a CSS-only change. Pre-investing in distinct edge keyframes today would speculate on visual-design judgment without a product signal.

Option B is rejected as visual-design speculation; option C is rejected as a separate leaf (the "chase-light" idea is already named as the speculative `aud_diagnostic_cycle_chase_animation` in the node sibling's Out-of-scope).

The reuse means a single `<span>` rendered by either overlay carries the same CSS-resolved animation; the only DOM differentiator is the `data-diagnostic-fire-locus="edge"` attribute. Test selectors using that attribute are stable.

### §6 — Playwright spec INLINE, NOT deferred to `aud_session_url`

The orchestrator brief is explicit: "not defer the Playwright smoke assertion." Three observations close the argument:

1. **The audience surface is now reachable.** `aud_session_url` shipped (`complete 100`) and the `tests/e2e/audience-live-session.spec.ts` harness exposes the dev-seam (`window.__aConversaWsStore`) the test needs to apply a diagnostic. The "component not yet reachable" exception the node sibling's Decision §6 invoked no longer applies.
2. **The chain that absorbed the node sibling's deferral has been paid down.** The node sibling deferred to `aud_session_url` as the 9th refinement in the chain; that chain is now closed — `aud_session_url` shipped its six enumerated scenarios. New animation refinements should NOT re-open the chain; they should add scenarios inline to the audience-live-session spec, which is the canonical reachable-route Playwright destination.
3. **The scenario is small.** One contradiction-fire scenario covers the load-bearing behaviour the leaf adds (the self-contradicts variant is covered by Vitest case 4 in `DiagnosticEdgeFireOverlay.test.tsx`; the wire-message-to-overlay round-trip is the same regardless of severity, so duplicating the Playwright scenario for advisory severity would buy little new coverage). The single scenario covers: route → seed → fire → assert. Estimated ~80 LOC of Playwright setup + assertions, inlining into an established harness.

The Playwright scenario's responsibilities are tightly scoped:

- After mounting the audience route with two seeded nodes + two seeded edges and an initial empty `activeDiagnostics`, NO `[data-diagnostic-fire-anim][data-diagnostic-fire-locus="edge"]` halos render.
- After a `contradiction` diagnostic with `edges: ['e1', 'e2']` arrives via the dev seam, exactly 2 edge-locus halos render, each carrying `aud-diagnostic-fire-blocking` within the rAF settle window.

Pixel-stable frame-by-frame capture is NOT scoped (consistent with the node sibling's posture).

The 'add a scenario to the existing six' rather than 'split out a new spec file' choice mirrors the node sibling's Decision §6 reasoning about chain shape — the spec already shares fixtures, dev users, and harness helpers across its scenarios; one more scenario is incremental cost.

The implementer selects one unallocated `DEV_USER_POOL` user (alice/ben/maria/dave/erin/frank are taken by the existing six scenarios — the implementer adds a seventh entry to the pool or, if the pool is closed, reuses a user under a fresh context with `freshAuthedContext()` per the harness's parallel-safety contract).

### §7 — No new ADR

The architectural seams are settled:

- DOM-overlay halo with CSS-first keyframe: settled by the four animation predecessors + the node-fire predecessor.
- `flattenActive…ForEdgeFire` as an audience-local helper: settled by the node sibling's Decision §3 (audience-local; shell extraction deferred).
- Edge-midpoint via `edge.renderedBoundingBox()`: settled by `aud_annotation_rendering_edges`.
- Playwright destination = `audience-live-session.spec.ts`: settled by `aud_session_url`.

No genuinely new architectural question surfaces. The leaf's decisions are all consequences of established patterns.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-29.

- Added `DiagnosticEdgeFireTuple` interface and `flattenActiveDiagnosticsForEdgeFire` helper (~55 LOC) to `apps/audience/src/graph/diagnosticHighlights.ts`, symmetric with the existing `flattenActiveDiagnosticsForFire`.
- Added 5 Vitest cases for `flattenActiveDiagnosticsForEdgeFire` in `apps/audience/src/graph/diagnosticHighlights.test.ts` (empty input, non-edge diagnostic kinds, contradiction 2-edge, self-contradicts 1-edge, mixed-map).
- Created `apps/audience/src/graph/DiagnosticEdgeFireOverlay.tsx` (~140 LOC) — new DOM-overlay sibling subscribing to `useAudienceActiveDiagnostics`, iterating `cy.edges()` with `renderedBoundingBox()` midpoint geometry, gated on `${identityKey}\0${edgeId}` composite keys, reusing predecessor's amber keyframe classes.
- Created `apps/audience/src/graph/DiagnosticEdgeFireOverlay.test.tsx` — 10 Vitest cases covering initial-mount no-class, contradiction/self-contradicts fire, cycle no-halo, clear unmount, re-fire no-op, overlapping-edge multi-halo, ghost-edge skip, aria/data attributes.
- Mounted `<AudienceDiagnosticEdgeFireOverlay>` as the 7th DOM-overlay sibling in `apps/audience/src/graph/GraphView.tsx` (import + mount + header-trail entry).
- Added Playwright scenario `(9) Diagnostic-fire edge halo on contradiction` to `tests/e2e/audience-live-session.spec.ts` with `applyDiagnostic` helper and pool user `grace`.
- Fixer sub-agent replaced `useSeenKeysGate` with a local `useRef<Set>` seeded synchronously from `tuples` on first render, fixing mid-session-joiner latent gate bug in `DiagnosticEdgeFireOverlay.tsx`; test (c) updated accordingly.
- Tech-debt follow-up registered: `aud_diagnostic_fire_animation_seeding_alignment` — node sibling carries the same latent gate bug; future leaf aligns the seeding pattern.
