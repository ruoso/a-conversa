# mod_withdraw_proposal_canvas_edge_annotation_removal — honor `entity-removed` in the edge (and annotation) canvas projectors

## TaskJuggler entry

- WBS leaf: `moderator_ui.mod_withdraw_proposal_canvas_edge_annotation_removal`
- Definition: [`tasks/30-moderator-ui.tji` L906–913](../../30-moderator-ui.tji#L906)
- Title: _"Fix edge and annotation canvas projectors to honor entity-removed on proposal withdraw"_
- Source of debt (per the `.tji` `note` and the predecessor's Status block):
  [`mod_withdraw_proposal_gesture.md` Status](./mod_withdraw_proposal_gesture.md) —
  the **node** canvas projector was fixed to honor `entity-removed`
  (`projectNodes` collects removed node ids and skips them), but the **edge**
  projector (`selectEdgesForSession`) and the annotation projections in the
  canvas hook still ignore `entity-removed`. Withdrawing a `set-edge-substance`
  or `capture-node`-with-edge proposal currently retracts the proposed **node**
  from the canvas but leaves the proposed **edge** stranded. Surfaced by Fixer 1
  in the `mod_withdraw_proposal_gesture` implementation run.

## Effort estimate

`0.5d` (per the `.tji` block). The fix mirrors the already-landed node-projector
change one-for-one: an up-front `entity-removed` id-collection pass plus a skip in
the `edge-created` loop, the symmetric (defensive) annotation guard, the unit
coverage, and one Playwright scenario extending the existing canvas-visibility
spec. No new wire surface, no engine change, no schema change.

## Inherited dependencies

`depends !mod_withdraw_proposal_gesture` — **shipped (`complete 100`,
[Status: Done 2026-06-02](./mod_withdraw_proposal_gesture.md)).**

**Settled by `mod_withdraw_proposal_gesture` (shipped):**

- The proposer-side withdraw gesture is route-rendered on the pending-proposals
  row in the operate console, dispatching `withdraw-proposal` over WS. The
  withdraw button appears whenever the current user is the proposal's `actor`.
- The **node** canvas projector honors `entity-removed`. The pattern to mirror
  lives at
  [`apps/moderator/src/graph/GraphCanvasPane.tsx:688-713`](../../../apps/moderator/src/graph/GraphCanvasPane.tsx):
  an up-front pass collects every `entity_id` retracted by an `entity-removed`
  event with `entity_kind: 'node'` into a `removedNodeIds` Set, and the
  `node-created` arm of the main loop `continue`s past any node whose id is in
  that set — so the withdrawn node never reaches the ReactFlow array.
- `derivePendingProposals` terminates a pending row when a later `entity-removed`
  names one of its minted entities, so the **pending-proposals row** already
  disappears on withdraw for edge-bearing proposals. Only the **canvas edge**
  rendering lags.

**Settled by `mod_proposed_entity_canvas_visibility` / `ws_withdraw_proposal_message`
(shipped — transitive):**

- **`entity-removed` is explicit and per-entity.** Payload at
  [`packages/shared-types/src/events.ts:618-637`](../../../packages/shared-types/src/events.ts):
  `{ entity_kind, entity_id, removed_by, removed_at }`, where `entity_kind` is the
  3-valued enum `['node', 'edge', 'annotation']`
  ([`packages/shared-types/src/events/enums.ts:47`](../../../packages/shared-types/src/events/enums.ts)).
  Withdraw emits **one `entity-removed` per propose-time-created entity**; the
  original `*-created` events stay in the immutable log (ADR 0021), so the removal
  can only be honored at projection time.
- The withdraw handler's retraction map
  ([`apps/server/src/ws/handlers/withdraw.ts:467-587`](../../../apps/server/src/ws/handlers/withdraw.ts))
  is the **inverse** of `buildStructuralEventsForPropose`. It emits
  `entity-removed(edge)` for exactly two live cases:
  - `set-edge-substance` with a fresh connecting edge minted at propose-time
    ([withdraw.ts:484-508](../../../apps/server/src/ws/handlers/withdraw.ts));
  - `capture-node` whose payload carries an inline `edge` block
    ([withdraw.ts:549-568](../../../apps/server/src/ws/handlers/withdraw.ts)).

**Pending / out of this task's hands:** the backend emits **no
`entity-removed(annotation)` today** — `annotate` proposals create no propose-time
structural event ([withdraw.ts:570-584](../../../apps/server/src/ws/handlers/withdraw.ts);
[`apps/server/src/methodology/handlers/propose.ts` ~L1808](../../../apps/server/src/methodology/handlers/propose.ts)),
so no annotation is ever retracted on withdraw. The annotation side of this task is
therefore a forward-looking guard, not a live bug (§D2).

## What this task is

Make the moderator **edge** canvas projector drop edges retracted by an
`entity-removed` event, mirroring the node fix, so that withdrawing a
`set-edge-substance` or `capture-node`-with-edge proposal removes the proposed edge
from the canvas — not just the proposed node and the pending-proposals row.

Concretely:

1. **Edge projector (the live fix).** In `selectEdgesForSession`
   ([`apps/moderator/src/graph/selectors.ts:619-762`](../../../apps/moderator/src/graph/selectors.ts)),
   add an up-front pass collecting every `entity_id` from `entity-removed` events
   with `entity_kind: 'edge'` into a `removedEdgeIds` Set, then `continue` past any
   `edge-created` event whose `edge_id` is in that set (the same shape as
   `removedNodeIds` at `GraphCanvasPane.tsx:699-704`). The removed edge never
   reaches the ReactFlow `Edge[]` array, so it leaves the canvas.
2. **Annotation guard (defensive, §D2).** Honor `entity-removed` with
   `entity_kind: 'annotation'` at the moderator annotation-projection seam so a
   retracted annotation would leave the canvas (badge, promoted node, host edge,
   and midpoint). Because no producer emits this event yet, it is a guard pinned by
   a unit test against a synthesized event — not an e2e.
3. **Tests.** Vitest for the edge filter (and the annotation guard); a Playwright
   scenario extending the existing canvas-visibility spec that proposes a
   connecting `capture-node` (Scenario 2 shape) and withdraws it, asserting the
   proposed edge leaves the canvas.

## Why it needs to be done

A proposal is a reversible move until it commits, and the withdraw gesture exists to
take it back. The node and the pending-proposals row already disappear on withdraw,
but the proposed **edge** lingers — a stranded edge whose source/target node may have
just been removed, leaving a dangling connector pointing at nothing. This is a
visible correctness gap for the two most common edge-bearing proposals
(`set-edge-substance`, connecting `capture-node`). The retraction events already
arrive over the wire; only the moderator canvas's edge projection fails to consume
them. This task closes the projector-side gap the node fix opened up by addressing
nodes alone.

## Inputs / context

**The pattern to mirror (node fix, shipped):**

- [`apps/moderator/src/graph/GraphCanvasPane.tsx:688-704`](../../../apps/moderator/src/graph/GraphCanvasPane.tsx) —
  the `removedNodeIds` up-front pass.
- [`GraphCanvasPane.tsx:706-713`](../../../apps/moderator/src/graph/GraphCanvasPane.tsx) —
  the `node-created` arm `continue`ing past a removed id.
- [`GraphCanvasPane.test.tsx`](../../../apps/moderator/src/graph/GraphCanvasPane.test.tsx) —
  carries a `makeEntityRemoved` helper + the node-removal unit test to extend.

**The edge projector to fix:**

- [`apps/moderator/src/graph/selectors.ts:619-762`](../../../apps/moderator/src/graph/selectors.ts) —
  `selectEdgesForSession`. The `edge-created` loop begins at
  [L651](../../../apps/moderator/src/graph/selectors.ts) (`if (event.kind !== 'edge-created') continue;`)
  and pushes one `Edge<StatementEdgeData>` per event with `id: event.payload.edge_id`
  at [L752-759](../../../apps/moderator/src/graph/selectors.ts). It currently has **no**
  `entity-removed` awareness. The new `removedEdgeIds` pass belongs alongside the
  existing up-front passes (`wordingByNodeId` at L644-649) and the skip belongs
  immediately after the `edge-created` guard at L652.
- The selector unit-test home:
  [`apps/moderator/src/graph/selectors.test.ts`](../../../apps/moderator/src/graph/selectors.test.ts).

**The annotation projection seam (defensive guard, §D2):**

- `projectAnnotations(events)` (from `@a-conversa/shell`) is the source of every
  annotation rendering on the moderator canvas. It is consumed at
  [`selectors.ts:626`](../../../apps/moderator/src/graph/selectors.ts) (per-edge badge bucket),
  [`GraphCanvasPane.tsx:648`](../../../apps/moderator/src/graph/GraphCanvasPane.tsx) (per-node badge bucket),
  [`GraphCanvasPane.tsx:1291`](../../../apps/moderator/src/graph/GraphCanvasPane.tsx) (host edges), and
  [`GraphCanvasPane.tsx:1400`](../../../apps/moderator/src/graph/GraphCanvasPane.tsx) (midpoint nodes).
  The guard filters the `projectAnnotations` output against the
  `entity-removed`/`entity_kind: 'annotation'` id set at the moderator layer (a small
  shared moderator-local helper), **not** by editing the shared shell projector — so
  other surfaces are untouched (§D2).

**The retraction source (server-side, why edge is live and annotation is not):**

- [`apps/server/src/ws/handlers/withdraw.ts:484-508`](../../../apps/server/src/ws/handlers/withdraw.ts) —
  `set-edge-substance` → `entity-removed(edge)` when a fresh edge was minted.
- [`withdraw.ts:549-568`](../../../apps/server/src/ws/handlers/withdraw.ts) —
  `capture-node` with inline `edge` → `entity-removed(node)` + `entity-removed(edge)`.
- [`withdraw.ts:570-584`](../../../apps/server/src/ws/handlers/withdraw.ts) —
  `annotate` (and `set-node-substance` / `edit-wording` / `axiom-mark` / `meta-move`
  / `break-edge` / `amend-node`) emit **nothing** at propose-time, so withdraw
  retracts nothing for them. The arm's own comment anticipates the future
  `annotation-created` propose/withdraw arms — which is precisely the case the
  annotation guard (§D2) is built to absorb without a second canvas regression.

**The e2e to extend:**

- [`tests/e2e/moderator-proposed-entity-canvas-visibility.spec.ts`](../../../tests/e2e/moderator-proposed-entity-canvas-visibility.spec.ts) —
  Scenario 2 ([L149-232](../../../tests/e2e/moderator-proposed-entity-canvas-visibility.spec.ts))
  already proposes a connecting `capture-node` and asserts the proposed edge renders
  (edge-label locator `[data-testid^="graph-edge-label-"]`, count 1). Scenario 4
  ([L419+](../../../tests/e2e/moderator-proposed-entity-canvas-visibility.spec.ts)) already
  performs a single-actor propose-then-withdraw for a node. The new scenario is the
  composition: propose-with-edge (Scenario 2 seed) → withdraw (Scenario 4 gesture) →
  the edge label count returns to 0.

## Constraints / requirements

1. **Mirror the node fix exactly.** Same up-front `entity-removed` collection pass,
   same `Set<string>`, same `continue`-on-membership skip in the create-event loop.
   No divergent shape between the node and edge projectors.
2. **No new wire / engine / schema surface.** Consume the existing `entity-removed`
   event only. No new event kind, no projector output shape change, no server change.
   The server already emits the events; this is purely a client-projection fix.
3. **Edge identity is `edge_id`.** Match `entity-removed.payload.entity_id`
   (with `entity_kind === 'edge'`) against `edge-created.payload.edge_id`
   ([selectors.ts:753](../../../apps/moderator/src/graph/selectors.ts)). Do not match
   on endpoint ids.
4. **Do not edit the shared shell `projectAnnotations`.** The annotation guard
   (§D2) lives at the moderator projection layer so the participant / audience
   surfaces are not perturbed by a moderator-only fix.
5. **Removed entities cascade visually but are not double-handled.** A withdrawn
   connecting `capture-node` emits `entity-removed(node)` **and**
   `entity-removed(edge)`; the node projector already drops the node and this task's
   edge filter drops the edge — each projector honors only its own `entity_kind`,
   so the two passes do not interfere.

## Acceptance criteria

Per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md), every check
below ships as a committed test — no throwaway verification.

**Vitest — `selectEdgesForSession` edge removal (extends
[`selectors.test.ts`](../../../apps/moderator/src/graph/selectors.test.ts)):**

1. Given an events log containing an `edge-created` event followed by an
   `entity-removed` event with `entity_kind: 'edge'` naming that `edge_id`,
   `selectEdgesForSession` returns **zero** edges for that id (the edge leaves the
   canvas).
2. An `entity-removed` with `entity_kind: 'node'` (or `'annotation'`) does **not**
   drop an edge — only the matching `entity_kind` retracts an edge. A second,
   unrelated `edge-created` whose id is not retracted still renders.
3. The withdrawn edge's annotation-badge / facet-status enrichment is not computed
   for the dropped edge (no stranded enrichment), and the remaining edges keep their
   `data` shape unchanged from the pre-fix projection.

**Vitest — annotation guard (defensive, §D2):**

4. The moderator annotation-projection helper drops an annotation whose id is named
   by an `entity-removed` event with `entity_kind: 'annotation'` (synthesized event,
   pinning the projector contract), and leaves all non-retracted annotations intact.
   Asserted at the helper level; the test documents that no producer emits this
   event yet (§D2).

**Playwright — propose-with-edge-then-withdraw (IN SCOPE; extends
[`tests/e2e/moderator-proposed-entity-canvas-visibility.spec.ts`](../../../tests/e2e/moderator-proposed-entity-canvas-visibility.spec.ts)):**

5. As the moderator: drive the Scenario 2 connecting-`capture-node` flow (propose a
   target statement, click it to stage as target, capture a second statement with a
   `supports` edge role) → assert **two** `statement-node` elements and **one**
   `[data-testid^="graph-edge-label-"]` render (the seed). Then click the withdraw
   button on the connecting capture-node's pending-proposal row → after the
   `proposal-withdrawn` ack and `entity-removed` broadcast apply, assert the edge
   label count returns to **0** (the proposed edge leaves the canvas) and the source
   node is removed (one `statement-node` remains — the original target).

   The connecting-capture gesture and the withdraw button are **both route-rendered
   in the operate console and seedable by the moderator's own gestures**, so this
   e2e is **in scope, not deferred** (strict reachability test met). This pins the
   edge-projector fix end-to-end — the observable behavior the task adds.

**Annotation e2e is NOT deferred — there is nothing to defer.** No proposal sub-kind
emits an `entity-removed(annotation)` event, so no user flow can exercise an
annotation withdrawal on the canvas. The annotation guard (#4) is a unit-tested
forward guard, not an unreachable-but-real surface; it does not create deferred-e2e
debt and is **not** registered against any `mod_pw_*` catch-all (§D2).

**No Cucumber scenario.** This task changes only moderator-client projection output;
it crosses no protocol or replay boundary (the server already emits the correct
`entity-removed` events, covered by `ws_withdraw_proposal_message`'s wire-path
tests). Vitest + Playwright is the right pinning layer.

## Decisions

**§D1 — Mirror the node fix in `selectEdgesForSession`; do not refactor the three
projectors into one shared removal pass.** The node fix lives inline in
`projectNodes` (`GraphCanvasPane.tsx`); the edge projection lives in a separate
exported selector (`selectors.ts`). The cheapest, lowest-risk change that matches the
0.5d budget is to add the same up-front `removedEdgeIds` pass + skip to
`selectEdgesForSession`, keeping the two projectors structurally identical. _Alternative
rejected:_ extracting a shared "drop entities named by `entity-removed`" pre-filter
over the events log feeding all projectors — a larger refactor touching the node path
that already shipped and works, for no behavioral gain; the inline-mirror keeps the
diff small and the two projectors legible side-by-side.

**§D2 — Edge removal is the live fix; annotation removal is a forward guard at the
moderator seam, unit-tested, no e2e.** The backend emits `entity-removed(edge)` for
two live cases but emits **no `entity-removed(annotation)`** today (`annotate`
proposals create no propose-time structural event —
[withdraw.ts:570-584](../../../apps/server/src/ws/handlers/withdraw.ts), propose.ts
~L1808). The task title scopes "edge **and** annotation," and the withdraw handler's
own comment anticipates a future `annotation-created` propose/withdraw arm. Rather than
leave a known hole that silently re-opens the moment that backend arm lands, the
annotation guard is added now at the **moderator** annotation-projection layer (a small
local helper over `projectAnnotations` output, not the shared shell function), pinned by
a unit test against a synthesized `entity-removed(annotation)` event. The cost is one
Set + one filter, identical in shape to the node/edge pattern. _Alternatives rejected:_
**(a)** deferring annotation handling to a future task that "extends the annotation
projector when the backend emits the event" — that task could not be implemented until
the (non-existent) backend annotation-emission arm lands, so it would be picked up,
block, and spawn a successor (the self-perpetuating-task anti-pattern the orchestrator
brief explicitly forbids); **(b)** editing the shared `@a-conversa/shell`
`projectAnnotations` — would change participant / audience annotation projection for a
moderator-only correctness fix, a needless cross-surface blast radius; **(c)** omitting
the annotation side entirely — leaves the task's own title unmet and a documented gap
that re-opens silently. The guard is deliberately **not** registered as deferred e2e
against any `mod_pw_*` leaf, because the surface is genuinely unreachable (no producer),
not merely not-yet-wired.

**§D3 — Match on `entity_kind` + `entity_id`, never on endpoint ids.** A withdrawn
connecting `capture-node` emits `entity-removed(node)` for the source node and
`entity-removed(edge)` for the connecting edge as two distinct events. Each projector
filters only on its own `entity_kind`, so the edge filter keys solely on
`entity_kind === 'edge'` matched against `edge_id`. _Alternative rejected:_ dropping an
edge when either of its endpoint nodes is removed — would over-retract committed edges
that happen to share an endpoint with a withdrawn node, and is unnecessary because the
server already emits an explicit `entity-removed(edge)` for every edge it intends to
retract.

**§D4 — No new ADR.** This task adds no dependency, no wire/engine/schema surface, and
no new architectural seam. It consumes the existing `entity-removed` lifecycle (ADR
0021 immutable log; `mod_proposed_entity_canvas_visibility` D4) and reuses the
node-projector pattern verbatim. No ADR warranted.

## Open questions

(none — all decided.)

## Status

**Done** — 2026-06-02.

- **`apps/moderator/src/graph/selectors.ts`** — added up-front `removedEdgeIds` Set pass collecting `entity-removed` events with `entity_kind: 'edge'`; added `continue` skip in `selectEdgesForSession`'s `edge-created` loop; added exported `projectModeratorAnnotations` helper filtering `projectAnnotations` output against a `removedAnnotationIds` Set (annotation guard §D2).
- **`apps/moderator/src/graph/GraphCanvasPane.tsx`** — routed all four annotation seams (per-node badge bucket, host edges, midpoint nodes, and per-edge badge in `selectEdgesForSession`) through `projectModeratorAnnotations`; dropped now-unused `projectAnnotations` import.
- **`apps/moderator/src/graph/selectors.test.ts`** — added `makeEntityRemoved` helper; added Vitest coverage for `selectEdgesForSession` (drops retracted edge, only `entity_kind: 'edge'` retracts, surviving edge `data` shape unchanged) and for `projectModeratorAnnotations` (drops `entity_kind: 'annotation'`, ignores other kinds, documents no producer emits the event yet per §D2).
- **`tests/e2e/moderator-proposed-entity-canvas-visibility.spec.ts`** — added Scenario 5: propose connecting capture-node (Scenario 2 seed) → withdraw → asserts proposed edge label count returns to 0 and source node is removed from canvas.
- No tech-debt follow-up registered (annotation guard is a forward guard pinned by unit test; no deferred e2e debt per §D2).
- Verification: Vitest 96/96 green; Playwright e2e green (Scenario 5 added and passing).
