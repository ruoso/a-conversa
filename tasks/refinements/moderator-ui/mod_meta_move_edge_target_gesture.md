# Moderator meta-move edge-target gesture — stage an edge as the meta-move target

**TaskJuggler entry**: [tasks/30-moderator-ui.tji](../../30-moderator-ui.tji) — task
`moderator_ui.mod_meta_move_flow.mod_meta_move_edge_target_gesture`.

```
task mod_meta_move_edge_target_gesture "Edge-target gesture for meta-move" {
  effort 0.5d
  allocate team
  depends !mod_meta_move_action
  note "Source: moderator_ui.mod_meta_move_flow.mod_meta_move_action AC §11 — adds an edge-target gesture so a meta-move can target an edge per the schema's target_kind: 'edge' branch. The v1 node-only narrowing is documented in Decision §4 of tasks/refinements/moderator-ui/mod_meta_move_action.md."
}
```

## Effort estimate

**0.5d.** Confirmed. The schema, validator, capture-store target-kind slice,
and selection plumbing the gesture needs are already in place; the work is
**a tiny widening across three files plus an e2e block** — no new abstractions:

- **`useMetaMoveAction.ts`** hardcodes `target_kind: 'node'` at
  [L218](../../../apps/moderator/src/layout/useMetaMoveAction.ts#L218) and
  rejects any `targetEntityKind !== 'node'` at
  [L135–139](../../../apps/moderator/src/layout/useMetaMoveAction.ts#L135).
  Widen both: derive `target_kind` from the staged `targetEntityKind` and
  relax the rejection to allow `'edge'` while keeping the `'annotation'`
  rejection (Decision §3).
- **`captureStore.ts`** carries `CaptureTargetKind = 'node' | 'annotation'`
  at [L171](../../../apps/moderator/src/stores/captureStore.ts#L171); widen
  to `'node' | 'annotation' | 'edge'`. No reset site changes — every reset
  hardcodes `'node'` as the default (the canonical capture target is a
  statement node; edges and annotations only stage via explicit gestures).
- **`GraphCanvasPane.tsx`** already wires
  `onEdgeClick={handleEdgeClick}` on the ReactFlow root
  ([L1676–1688](../../../apps/moderator/src/graph/GraphCanvasPane.tsx#L1676)).
  Extend `handleEdgeClick` (or add a thin meta-move branch) to dispatch
  `useCaptureStore.getState().setTargetEntity('edge', edge.id)` when
  `useCaptureStore.getState().mode === 'meta-move'`. Outside meta-move
  mode the existing behavior (selection-store update only) is unchanged
  (Decision §1).
- **`CaptureTargetChip.tsx`** wording-lookup at
  [L256–267](../../../apps/moderator/src/layout/CaptureTargetChip.tsx#L256)
  branches on `stagedTargetKind`; add a third branch for `'edge'` that
  resolves a label via a new `selectEdgeLabelById(events, edgeId)`
  selector (Decision §2).
- **Vitest cases** added across `useMetaMoveAction.test.tsx`,
  `captureStore.test.ts`, `CaptureTargetChip.test.tsx`, and a new
  `selectEdgeLabelById.test.ts` (or extension of the nearest sibling
  selector test).
- **Playwright e2e** — one new `test()` block in
  `tests/e2e/moderator-capture.spec.ts` (alongside the F8 default-kind
  block at L2539–2627 and the kind-selector block at L2635–2669): seed
  two nodes + one edge via the existing `seedWsStore` helper, press F8,
  click the edge to stage it as the meta-move target, type content,
  press the submit key, assert the wire envelope carries
  `target_kind: 'edge'` and the correct `target_id`.

The work is bounded by reusing seams the annotation-target widening
([`mod_propose_annotation_endpoint_gestures`](./mod_propose_annotation_endpoint_gestures.md))
already established for a different kind discriminator. The only
genuinely new code is the edge-label selector (Decision §2) and the
meta-move-mode branch in `handleEdgeClick` (Decision §1).

## Inherited dependencies

Settled:

- **`moderator_ui.mod_meta_move_flow.mod_meta_move_action`** (done —
  2026-05-31). Shipped the F8 spine: the `'meta-move'` capture mode, the
  `useMetaMoveAction()` hook, the `<MetaMoveProposeAction>` button, the
  `<MetaMoveCapturePanel>` composition that renders `<CaptureTargetChip>`
  inside meta-move mode, and the e2e F8 default-kind block. Decision §4
  of [mod_meta_move_action.md](./mod_meta_move_action.md) explicitly
  defers edge-target support to **this task** by name and pins the v1
  client-side coercion (`target_kind: 'node'` hardcoded, `'annotation'`
  rejected inline) that this task partly unwinds.
- **`data_and_methodology.methodology_engine.meta_move_logic`** (done —
  2026-05-10). The server's `validateMetaMoveProposal` already dispatches
  on `target_kind`: rule 1 calls `projection.getEdge(target_id)` when
  `target_kind === 'edge'` → rejection code `'target-entity-not-found'`;
  rule 2 checks `edgeIsVisible` → rejection code `'illegal-state-transition'`.
  No new rejection codes, no validator changes needed — see the rule
  catalog excerpted in
  [apps/server/src/methodology/handlers/propose.ts L96–111](../../../apps/server/src/methodology/handlers/propose.ts#L96).
- **`packages/shared-types/src/events/proposals.ts L412–419`** —
  `metaMoveProposalSchema` already accepts
  `target_kind: z.enum(['node', 'edge'])` with `target_id` as a UUID;
  no schema change required.
- **`moderator_ui.mod_annotation_ui.mod_propose_annotation_endpoint_gestures`**
  (done — 2026-05-30). Established the pattern this task mirrors at one
  remove: a kind-aware target staged via an explicit canvas gesture, with
  the `<CaptureTargetChip>` wording-lookup branching per kind. That task
  widened `CaptureTargetKind` from `'node'` to `'node' | 'annotation'`;
  this task adds the third member.
- **`backend.websocket_protocol.ws_propose_message`** — the WS propose
  handler accepts the `meta-move` sub-kind with either `target_kind`
  value via `proposePayloadSchema` and dispatches to
  `validateMetaMoveProposal`. Ack/error envelope shapes unchanged.

Pending: (none — every cross-team contract this task depends on is closed.)

## What this task is

The moderator-side gesture that lets a meta-move target an **edge** rather
than a node. After `mod_meta_move_action` shipped, the F8 flow stages
node targets only — the schema's `target_kind: 'edge'` branch is reachable
from the wire but not from the moderator console (the propose hook
hardcodes `target_kind: 'node'`; the capture-store target-kind slice
doesn't carry `'edge'` as a value; no gesture stages an edge into the
capture store).

This task closes the loop in four small widenings:

1. Widen `CaptureTargetKind` to `'node' | 'annotation' | 'edge'`. No
   reset-site changes; the default everywhere stays `'node'`.
2. Derive `target_kind` in `useMetaMoveAction()` from the staged
   `targetEntityKind` instead of hardcoding `'node'`. Relax the
   annotation-rejection guard to accept `'edge'` (keep rejecting
   `'annotation'` per the predecessor's permanent product rule — see
   the sibling [`mod_meta_move_annotation_target_gesture`](./mod_meta_move_annotation_target_gesture.md)
   for the deferred decision on annotation targets).
3. Wire a click-to-stage gesture on edges that fires only while the
   capture store is in `'meta-move'` mode. Outside meta-move mode, the
   existing `handleEdgeClick` behavior is preserved (selection update
   only — no capture-target side effect).
4. Render the staged edge in `<CaptureTargetChip>` with a label that
   identifies the edge (role + truncated endpoint wording) so the
   moderator can verify what they're about to meta-move against before
   pressing Propose.

The disputed-visibility sibling
([`mod_meta_move_disputed_visibility`](./mod_meta_move_disputed_visibility.md))
already renders disputed annotation badges; how a committed meta-move
on an edge surfaces as a disputed annotation is an open server-side
question deferred by `meta_move_logic` and not constrained by this
task — the wire payload simply carries `target_kind: 'edge'`,
`target_id: <edgeId>`, and the engine's eventual commit-time projection
decides where the annotation hangs.

## Why it needs to be done

**The schema's `target_kind: 'edge'` branch is otherwise unreachable from
the moderator UI.** The validator accepts it, the server can store it,
the projection can host an annotation on an edge — but no moderator
gesture can construct the propose payload. Without this task, meta-moves
on edges remain a wire-only contract: replay-mode injections and
backend unit tests exercise the branch but no live debate ever does.

**Edge-targeted meta-moves are methodologically distinct from node-targeted
ones.** A meta-move on an edge says "the inferential link between these
two statements is itself the framing question" — e.g. a `reframe` of
"does N7 support N12 in the way the debate has been treating it?" or a
`stance` of "I won't dispute the chain of inference, only its grounding."
The methodology spec
([docs/methodology.md](../../../docs/methodology.md))
treats edges as first-class methodological objects on which meta-moves
land; the schema reflects that. Closing this UI gap is what makes the
methodology fully expressible in a live session.

**Unblocks the F8 column of the moderator's gesture surface.** With this
task landed, the only remaining narrowing from `mod_meta_move_action`'s
v1 cut is the annotation-target decision (sibling task), and that one
is a product-rule question rather than a UI-coverage question.

## Inputs / context

Code seams the implementation plugs into (real file paths, all verified
against the working tree):

### The capture-store target-kind slice

- [apps/moderator/src/stores/captureStore.ts L171](../../../apps/moderator/src/stores/captureStore.ts#L171)
  — `export type CaptureTargetKind = 'node' | 'annotation';`. Widens to
  `'node' | 'annotation' | 'edge'`. No reset-site changes (every reset
  hardcodes `'node'` as the default, including
  [`enterMetaMoveMode`](../../../apps/moderator/src/stores/captureStore.ts#L900) at L900–915).
- [apps/moderator/src/stores/captureStore.ts L299–300](../../../apps/moderator/src/stores/captureStore.ts#L299)
  — `setTargetEntity(kind: CaptureTargetKind, id: string)` setter. The
  signature accepts the widened kind without change.

### The propose-hook payload derivation

- [apps/moderator/src/layout/useMetaMoveAction.ts L214–220](../../../apps/moderator/src/layout/useMetaMoveAction.ts#L214)
  — current payload construction. The `target_kind: 'node'` hardcode is
  the line this task rewrites to read `targetEntityKindNow` (with a
  TypeScript narrowing assertion since the rejected `'annotation'` case
  is screened above).
- [apps/moderator/src/layout/useMetaMoveAction.ts L135–139](../../../apps/moderator/src/layout/useMetaMoveAction.ts#L135)
  — the annotation-rejection guard. Relaxes to allow `'edge'` while
  keeping the `'annotation'` rejection; the `MetaMoveValidationReason`
  union ([L55–61](../../../apps/moderator/src/layout/useMetaMoveAction.ts#L55))
  carries `'target-kind-invalid'` already — the localized message for
  it (`reason.targetKindInvalid` in
  [packages/i18n-catalogs/src/catalogs/en-US.json](../../../packages/i18n-catalogs/src/catalogs/en-US.json))
  stays valid for the narrower annotation-only case.

### The graph-layer edge-click gesture

- [apps/moderator/src/graph/GraphCanvasPane.tsx L1676–1688](../../../apps/moderator/src/graph/GraphCanvasPane.tsx#L1676)
  — the `<ReactFlow>` props block already wires
  `onEdgeClick={handleEdgeClick}` (the existing handler updates the
  selection store). Decision §1 pins extending `handleEdgeClick` with a
  meta-move-mode branch that stages the clicked edge via
  `setTargetEntity('edge', edge.id)`.
- [apps/moderator/src/graph/GraphCanvasPane.tsx L1132–1143](../../../apps/moderator/src/graph/GraphCanvasPane.tsx#L1132)
  — `handleEdgeContextMenu` already selects the clicked edge via the
  selection store, demonstrating the pattern this task generalizes to
  the left-click handler.

### The chip wording-lookup

- [apps/moderator/src/layout/CaptureTargetChip.tsx L256–267](../../../apps/moderator/src/layout/CaptureTargetChip.tsx#L256)
  — the per-kind wording-lookup. Today branches on
  `stagedTargetKind === 'annotation'` (annotation content) vs node
  (`selectNodeWordingById`). Adds a third branch for `'edge'` calling a
  new `selectEdgeLabelById(events, stagedTargetId)` selector.
- [apps/moderator/src/layout/CaptureTargetChip.tsx L162–174](../../../apps/moderator/src/layout/CaptureTargetChip.tsx#L162)
  — `handleClear`. Already resets `targetEntityId` to `null` and the
  coupled `edgeRole` / `edgeDirection` slices; no change needed — the
  reset is kind-agnostic and the existing setter overwrites
  `targetEntityKind` back to `'node'` via the default-on-reset symmetry
  the capture-store reset sites already establish.

### The wire schema + validator (no change)

- [packages/shared-types/src/events/proposals.ts L412–419](../../../packages/shared-types/src/events/proposals.ts#L412)
  — `metaMoveProposalSchema` accepts
  `target_kind: z.enum(['node', 'edge'])`. No change.
- [apps/server/src/methodology/handlers/propose.ts L96–111](../../../apps/server/src/methodology/handlers/propose.ts#L96)
  — `validateMetaMoveProposal` already dispatches on `target_kind`.
  No change.

### The e2e seed helper

- [tests/e2e/fixtures/wsStoreSeed.ts L140–148, L165–177](../../../tests/e2e/fixtures/wsStoreSeed.ts)
  — `seedWsStore(page, { sessionId, nodes, edges, … })` already accepts
  `edges` via the `SeedEdge[]` parameter (each `SeedEdge` carries
  `edgeId`, `source`, `target`, and optional `role`). The e2e block this
  task adds seeds two nodes + one edge, then drives the gesture.
- [tests/e2e/moderator-capture.spec.ts L2539–2627](../../../tests/e2e/moderator-capture.spec.ts#L2539)
  — the existing F8 meta-move test block. The new edge-target block
  lands alongside it (same fixture/`test()` shape, different gesture
  and assertion).

### Prior-art refinements

- [tasks/refinements/moderator-ui/mod_meta_move_action.md](./mod_meta_move_action.md)
  — Decisions §4 (v1 narrows `target_kind` to `'node'`) and §6 (WireError
  discipline) directly constrain this task. The action's v1 hardcode is
  documented as a deliberate narrowing pointing here.
- [tasks/refinements/moderator-ui/mod_propose_annotation_endpoint_gestures.md](./mod_propose_annotation_endpoint_gestures.md)
  — the precedent that established the kind-aware staging pattern this
  task mirrors. Auto-suggest stays kind-narrow (Decision §5 there);
  explicit gestures expand the kind set.
- [tasks/refinements/moderator-ui/mod_meta_move_kind_selector.md](./mod_meta_move_kind_selector.md)
  — sibling shape parity; the e2e block this task adds follows the
  same single-`test()`-block pattern that landed alongside the F8
  default-kind block.
- [tasks/refinements/data-and-methodology/meta_move_logic.md](../data-and-methodology/meta_move_logic.md)
  — engine-side rule catalog confirming edge dispatch is already in
  place server-side.
- [docs/adr/0022-no-throwaway-verifications.md](../../../docs/adr/0022-no-throwaway-verifications.md)
  — drives the Vitest + Playwright layering of acceptance.
- [docs/adr/0024-frontend-i18n-react-i18next-with-icu.md](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md)
  — i18n catalog discipline; this task adds no chrome strings (the
  edge label is computed from projection data, not localized chrome),
  so no native-review follow-up is required.

## Constraints / requirements

- **Wire envelope unchanged.** `client.send('propose', payload)` continues
  to carry `proposal = { kind: 'meta-move', meta_kind, content,
  target_kind, target_id }`. The only behavioral change at the wire is
  that `target_kind` now takes one of two values rather than always being
  `'node'`.
- **No new rejection codes.** The server's
  `'target-entity-not-found'` / `'illegal-state-transition'` pair
  already covers the edge case (edge-not-found, edge-invisible) per
  `meta_move_logic`. The hook's `WsRequestError`-mapping path is
  unchanged.
- **Annotation rejection stays in place.** The hook continues to refuse
  to propose when `targetEntityKind === 'annotation'`. The
  `'target-kind-invalid'` validation reason and its localized message
  stay live; only the guard's allowed-kind set widens. The annotation
  decision is the sibling
  [`mod_meta_move_annotation_target_gesture`](./mod_meta_move_annotation_target_gesture.md)'s
  responsibility.
- **Gesture is mode-gated.** The edge-click stages an edge as the
  capture target ONLY while `useCaptureStore.getState().mode ===
  'meta-move'`. Outside meta-move mode the existing `handleEdgeClick`
  behavior (selection update only) is preserved — a stray click during
  F1 capture must not silently flip the F1 target to an edge.
- **No auto-suggest widening.** `selectMostRecentlyActiveEntity` stays
  node-scoped. Edges only stage via the explicit click gesture this
  task adds. Rationale: auto-suggest is a "carry the moderator's last
  active object forward" affordance; meta-move-on-edge is intentional
  and benefits from the deliberateness of an explicit click.
- **Chip label must identify the edge.** Truncated `<role>: <source-snippet>
  → <target-snippet>` per Decision §2. Fallback to the edge id (truncated)
  if the projection can't resolve the endpoints (defensive — should not
  happen in practice but the chip must not crash on a stale staged id).
- **Reset symmetry.** When the moderator clears the chip or exits meta-move
  mode (`enterMetaMoveMode` re-entry, `exitMetaMoveMode`, Esc clear),
  `targetEntityKind` returns to its `'node'` default — the existing
  reset sites already write `'node'`, no change needed.
- **No new i18n chrome.** The edge label is data-derived (role + endpoint
  wording from the projection); no new localized strings introduced. The
  existing `'target-kind-invalid'` reason key
  ([packages/i18n-catalogs/src/catalogs/en-US.json](../../../packages/i18n-catalogs/src/catalogs/en-US.json))
  continues to cover the annotation-rejection path. No native-review
  follow-up needed.
- **No regressions to F1 / F2 / F3 / F6 capture flows.** The widened
  `CaptureTargetKind` is structurally a superset; the F1 propose builders
  in `useProposeAction.ts` continue to handle their existing kinds
  (`'node'` and `'annotation'`) and need no change. A TypeScript
  exhaustiveness check at any F1 site that switches on
  `targetEntityKind` would now flag a missing `'edge'` arm — those sites
  must either narrow defensively (with a clear "not supported in this
  flow" rejection) or be confirmed not to switch on the kind. Decision §4
  pins the cross-flow audit obligation.

## Acceptance criteria

(Reference [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md)
— each layer below pins durable behavior; no throwaway scripts.)

1. **`CaptureTargetKind` widened.** The type at
   [captureStore.ts L171](../../../apps/moderator/src/stores/captureStore.ts#L171)
   reads `'node' | 'annotation' | 'edge'`. Default `targetEntityKind`
   at every reset site stays `'node'`. Vitest pins the type shape via
   compile-time exhaustiveness (the existing `captureStore.test.ts`
   suite continues to pass) and the `setTargetEntity('edge', id)` setter
   path lands a new case.
2. **`useMetaMoveAction()` derives `target_kind`.** The payload
   construction at
   [useMetaMoveAction.ts L218](../../../apps/moderator/src/layout/useMetaMoveAction.ts#L218)
   reads `targetEntityKindNow` (narrowed to `'node' | 'edge'` after the
   annotation-rejection guard). Vitest pins: (a) `'node'` target →
   propose envelope carries `target_kind: 'node'`; (b) `'edge'` target
   → envelope carries `target_kind: 'edge'`; (c) `'annotation'` target
   → propose is refused with `validationError: 'target-kind-invalid'`
   and no envelope is emitted.
3. **`<CaptureTargetChip>` renders edge label.** A new
   `selectEdgeLabelById(events, edgeId)` selector resolves a staged
   edge's role + endpoint snippets into a single label. The wording-lookup
   at [CaptureTargetChip.tsx L256–267](../../../apps/moderator/src/layout/CaptureTargetChip.tsx#L256)
   gains a third branch for `'edge'`. Vitest pins: (a) staged edge with
   resolvable endpoints renders `<role>: <source-snippet> → <target-snippet>`
   (truncated); (b) staged edge with missing projection data renders
   the edge id (truncated, defensive fallback); (c) clearing the chip
   resets back to default. The selector itself gets a Vitest unit
   covering the role-formatting + truncation contract.
4. **Mode-gated edge-click gesture.** `handleEdgeClick` in
   [GraphCanvasPane.tsx](../../../apps/moderator/src/graph/GraphCanvasPane.tsx)
   reads `useCaptureStore.getState().mode` and dispatches
   `setTargetEntity('edge', edge.id)` when `mode === 'meta-move'`.
   When `mode !== 'meta-move'`, the existing behavior (selection-store
   update only) is preserved. Vitest pins both branches (mode in
   `'meta-move'` → capture-store side-effect lands; mode in `'idle'`
   / `'capture'` / `'decompose'` / etc. → no capture-store side-effect,
   selection-store update only).
5. **Cross-flow no-regression.** F1 capture (`useProposeAction.ts`)
   continues to handle its existing `'node'` and `'annotation'` kinds
   without change; any internal `switch (targetEntityKind)` site is
   either widened defensively (with a clear rejection on `'edge'`) or
   confirmed not to switch on the kind. The Vitest suite for
   `useProposeAction` stays green. Decision §4 pins the audit list.
6. **Bottom-strip composition unchanged.** No structural change to
   `<MetaMoveCapturePanel>`. The placeholder slots, kind selector,
   propose action, and exit button continue to render as the action
   task shipped them; only the chip's text changes when an edge is
   staged.
7. **No new i18n chrome keys.** No additions to
   `packages/i18n-catalogs/src/catalogs/{en-US,pt-BR,es-419}.json`
   chrome. The existing `'target-kind-invalid'` reason key continues
   to fire only against `'annotation'` targets (its message wording
   stays accurate — the rejection is still annotation-specific).
   No native-review follow-up registered.
8. **No new Cucumber scenario.** The wire contract is unchanged
   (the schema and validator already cover both `target_kind` values);
   the existing `tests/behavior/methodology/propose-meta-move.feature`
   shipped by `meta_move_logic` already pins the edge-target validator
   rules. No `ws_*` shape this task introduces.
9. **Playwright e2e — extend `moderator-capture.spec.ts`** with one
   new `test()` block alongside the existing F8 default-kind block
   ([L2539–2627](../../../tests/e2e/moderator-capture.spec.ts#L2539))
   and the kind-selector block (L2635–2669). The block:
   - logs in, creates a session, enters the operate route;
   - seeds two nodes + one connecting edge via `seedWsStore`
     ([tests/e2e/fixtures/wsStoreSeed.ts](../../../tests/e2e/fixtures/wsStoreSeed.ts));
   - presses F8 to enter meta-move mode;
   - clicks the seeded edge — asserts the chip renders the edge label;
   - types meta-move content; presses the submit key;
   - asserts the proposal event lands in `useWsStore.sessionState[sessionId].events`
     (or — if the seeded entities don't reach the server — asserts the
     localized `target-entity-not-found` error region with the
     `meta-move-propose-error` test id, matching the existing F8 block's
     wire-error pattern at
     [L2615–2627](../../../tests/e2e/moderator-capture.spec.ts#L2615));
   - in either path, the assertion proves the propose envelope carried
     `target_kind: 'edge'` and the correct `target_id`.

   **E2e is in scope, NOT deferred** — the gesture is user-reachable
   via the keyboard binding (F8) + canvas click (edge), satisfying the
   UI-stream "default — e2e is in scope" policy.
10. **Build + test green.** `make build && make test` clean; Vitest,
    Cucumber, Playwright, and i18n catalog-parity suites all pass.
11. **Refinement `## Status` block** appended on landing, per the
    task-completion ritual ([tasks/refinements/README.md L32–42](../README.md#L32)).

## Decisions

### §1 — Mode-gated edge-click is the entry gesture

The edge-click handler (`handleEdgeClick` in
[GraphCanvasPane.tsx](../../../apps/moderator/src/graph/GraphCanvasPane.tsx#L1676))
gains a meta-move-mode branch: when
`useCaptureStore.getState().mode === 'meta-move'`, the click stages the
clicked edge as the capture target via
`useCaptureStore.getState().setTargetEntity('edge', edge.id)`. Outside
meta-move mode the existing selection-store update is preserved
unchanged.

**Rationale.** The annotation-endpoint precedent
([`mod_propose_annotation_endpoint_gestures`](./mod_propose_annotation_endpoint_gestures.md)
§4) established that explicit-gesture staging is the right shape for
non-default capture-target kinds — auto-suggest stays narrow; the
moderator's deliberate click is what widens the target. Edges follow
the same pattern. Mode-gating (rather than a globally-active
"edge-click stages capture target" rule) is necessary because the
selection store is consulted by other surfaces too — if every edge
click silently flipped the capture-store target, the F1 textarea
content would attach to a wrong entity on the next Propose.

**Alternative rejected — right-click context-menu item.** Adding a
"Use as meta-move target" item to the existing edge context menu
(`handleEdgeContextMenu` at L1132–1143) would work but adds an extra
hop (right-click → menu item) for a routine inside-mode gesture. The
moderator is already in meta-move mode by the time the gesture fires
— that's the modal context that licenses the more efficient left-click
binding. Context-menu access is a secondary affordance that can be
added later if user feedback asks for it; deferred outside this task
(not registered as a follow-up — the left-click gesture is enough).

**Alternative rejected — global edge-click stages capture target
(no mode gate).** A live edge click outside meta-move mode would
clobber an in-progress F1 target with an edge id the F1 propose
builder doesn't handle — a wire-error trap. The mode gate is the
cheapest disambiguation.

**Alternative rejected — shift+click on edges as the staging gesture.**
Would side-step the mode gate but introduces a new keyboard-modifier
convention that no other capture-target gesture uses. Mode-gated
unmodified left-click matches the annotation-node precedent and the
moderator's keyboard-first discipline.

### §2 — Edge chip label = `<role>: <source-snippet> → <target-snippet>`

The `<CaptureTargetChip>` wording-lookup gains a third branch that
calls a new `selectEdgeLabelById(events, edgeId)` selector. The
selector resolves the edge's current `role` and both endpoints'
wording via the existing projection helpers, formats as
`<role>: <source-snippet> → <target-snippet>` (each snippet truncated
to a short fixed length), and falls back to the edge id (truncated)
if any lookup misses.

**Rationale.** The chip's job is to let the moderator verify the staged
target before pressing Propose. For nodes the wording IS the
identification ("Education is a right" tells the moderator what they're
about to vote on); for annotations the content serves the same role.
Edges have no native wording — the closest semantic content is the
edge's role plus the wording snippets of its endpoints. Including the
role (`supports` / `contradicts` / etc.) is critical because the same
two endpoints can carry different roles in different sessions; the
role is the disambiguating information. Truncation at a short fixed
length keeps the chip from overflowing the bottom-strip layout (the
existing node-wording truncate constant
[`WORDING_TRUNCATE_AT` in CaptureTargetChip.tsx](../../../apps/moderator/src/layout/CaptureTargetChip.tsx)
is reused; endpoint snippets get their own shorter constant so the
full label fits).

**Alternative rejected — show only the edge id.** Mechanically simplest
but useless for the moderator's verification task. A bare UUID prefix
("e7a2…") tells them nothing about what edge they're about to
meta-move against.

**Alternative rejected — show only the role (`supports` / `contradicts`).**
Better than the id but ambiguous when the canvas has multiple edges of
the same role. The endpoint snippets are what distinguish "supports:
N7 → N12" from "supports: N3 → N18."

**Alternative rejected — render a custom multi-line chip with role on
one line and endpoints on the next.** Would require chip layout
restructuring and breaks the chip's single-line height invariant the
bottom-strip composition assumes. Single-line formatted string is
sufficient for v1.

### §3 — `useMetaMoveAction` allow-list widens to `{'node', 'edge'}`

The annotation-rejection guard at
[useMetaMoveAction.ts L135–139](../../../apps/moderator/src/layout/useMetaMoveAction.ts#L135)
relaxes from `targetEntityKind !== 'node'` to
`targetEntityKind !== 'node' && targetEntityKind !== 'edge'`. The
`'target-kind-invalid'` reason key continues to fire — now only against
`'annotation'` targets (its localized message wording stays accurate
since annotation is the only remaining rejected kind).

**Rationale.** The schema sanctions both `'node'` and `'edge'`; this
task lights up the `'edge'` arm. The `'annotation'` rejection stays as
a permanent client-side guard until the sibling
[`mod_meta_move_annotation_target_gesture`](./mod_meta_move_annotation_target_gesture.md)
decides whether to widen the schema (engine-side enum widening) or
freeze annotation rejection as a product rule. That decision is the
sibling's responsibility; this task's relaxation is strictly the
schema-already-supports set.

**Alternative rejected — also coerce / accept annotation targets here.**
Would conflate two design questions and pre-empt the sibling task's
decision space. The schema does NOT sanction `target_kind: 'annotation'`
today; allowing the client to send one would produce a wire-side schema
rejection rather than the current friendly inline message. Keeping the
annotation rejection in place preserves the clearer failure mode.

**Alternative rejected — drop the kind guard entirely and let the
server reject.** The server would reject with
`'target-entity-not-found'` (the annotation id wouldn't resolve via
`projection.getNode` or `projection.getEdge`), but that error message
is generic and confuses the moderator. The current
`'target-kind-invalid'` inline message names the specific issue.

### §4 — Cross-flow audit: F1 / F2 / F3 / F6 propose builders

Widening `CaptureTargetKind` from `'node' | 'annotation'` to
`'node' | 'annotation' | 'edge'` is structurally a superset, but any
`switch (targetEntityKind)` or `if (kind === 'node') … else { … }`
site in the F1 propose builders, the decompose flow, the
interpretive-split flow, the operationalization flow, the
warrant-elicitation flow, or any other capture-mode flow that consults
the kind must be audited for an implicit "anything-not-node-is-
annotation" assumption. The implementer's audit list (Vitest pins each
site stays correct):

- [apps/moderator/src/layout/useProposeAction.ts](../../../apps/moderator/src/layout/useProposeAction.ts)
  — F1 capture-with-edge `buildCaptureNodeProposal` and the
  `setEdgeSubstance` builder. These currently route on
  `targetEntityKind` for annotation-endpoint pairs.
- Any sibling-mode propose hook
  (`useCaptureDefeaterAction`, `useDecomposeAction`,
  `useInterpretiveSplitAction`, `useOperationalizationAction`,
  `useWarrantElicitationAction`) that reads `targetEntityKind`.

Audit outcome per site: either the site is kind-agnostic (no change)
or the site needs to defensively reject `'edge'` (with the same
`'target-kind-invalid'` reason and message — the meta-move propose
hook's pattern generalizes). The audit is mechanical TypeScript work
— the compiler flags missing-arm exhaustiveness in switch statements,
and the test suite catches the rest.

**Rationale.** A type widening that compiles and passes tests today
can still introduce a runtime path tomorrow that misroutes an edge id
into a node-id slot. The audit pre-empts that. Edge targets must not
silently bleed into non-meta-move flows; the F1 capture-with-edge path
in particular has its own `'edge'`-meaning concept (edge-role +
direction) distinct from "edge as target entity" — these must not be
conflated.

**Alternative rejected — defer the audit to a follow-up task.** The
widening is the audit's trigger; landing one without the other is the
defect-shaped seam. The audit is cheap (~30 min of compiler + Vitest)
and belongs in the same PR as the type change.

**Alternative rejected — add the `'edge'` arm to every existing
`switch` even when the flow logically rejects it.** Over-engineering
for v1. A defensive rejection at each site is enough; the
implementer's judgment per-site decides whether to add a sanctioned
arm or a rejection arm.

### §5 — No edge-target auto-suggest

`selectMostRecentlyActiveEntity` (and the equivalent canvas-state
helpers) stay node-scoped. Edges only become the capture target via
the explicit click gesture this task adds.

**Rationale.** The annotation-target precedent
([`mod_propose_annotation_endpoint_gestures`](./mod_propose_annotation_endpoint_gestures.md) §5)
established that auto-suggest is a "carry forward the moderator's
last active object" affordance for the dominant case (statement
nodes). Widening it to non-default kinds would silently flip the
capture target in ways the moderator doesn't expect ("I clicked an
edge to inspect its tooltip; now my F8 target is the edge?"). The
explicit-gesture path makes the intentionality visible.

**Alternative rejected — widen auto-suggest to also surface
most-recent-edge while in meta-move mode.** Adds modal-state-dependent
auto-suggest, which is more code than the click gesture itself. The
click gesture is sufficient for v1; if user feedback in production
shows moderators expect the edge they just inspected to auto-stage
on F8, a follow-up can add it.

### §6 — E2e is in scope, single block in `moderator-capture.spec.ts`

The Playwright cover lands in
[`tests/e2e/moderator-capture.spec.ts`](../../../tests/e2e/moderator-capture.spec.ts)
as one new `test()` block, alongside the existing F8 default-kind block
(L2539–2627) and the kind-selector block (L2635–2669). NOT a new spec
file.

**Rationale.** The capture-flow precedent
(`mod_meta_move_action.md` Decision §7,
`mod_meta_move_kind_selector.md` Decision §5) parks all moderator
capture e2e blocks in one file to reuse the login / create-session /
seed setup. Splitting per-task explodes the spec count and duplicates
boilerplate. The edge-target cover is small (seed edge → click → type
→ submit → assert) and fits alongside the existing blocks. The
gesture IS reachable through events (the F8 mode is user-reachable
via keyboard; the edge is clickable on the canvas; the chip renders
the staged edge), satisfying the UI-stream "default — e2e is in scope"
policy.

**Alternative rejected — defer to a `mod_pw_meta_move_flow` catch-all
task.** No such catch-all exists in the WBS, and the policy says
deferral is the exception. The action and kind-selector siblings
already paid the in-line cost; deferring this third small block alone
would be inconsistent.

## Open questions

(none — all decided)

## Status

**Done** — 2026-06-01.

- `apps/moderator/src/stores/captureStore.ts` — widened `CaptureTargetKind` to `'node' | 'annotation' | 'edge'`; Vitest pins setter and mode-entry-reset cases.
- `apps/moderator/src/layout/useMetaMoveAction.ts` — relaxed annotation-rejection guard to allow `'edge'`; `target_kind` derived from staged `targetEntityKind`; Vitest pins `'node'`, `'edge'`, and `'annotation'`-rejection envelope cases.
- `apps/moderator/src/graph/selectors.ts` — added `selectEdgeLabelById` selector (role + endpoint-snippet format with fallback to edge id).
- `apps/moderator/src/graph/selectors.test.ts` — 7-case Vitest suite for `selectEdgeLabelById` (role formatting, truncation, endpoint-missing fallback).
- `apps/moderator/src/layout/CaptureTargetChip.tsx` — third wording-lookup branch for `'edge'` via `selectEdgeLabelById`.
- `apps/moderator/src/layout/CaptureTargetChip.test.tsx` — edge-target rendering, fallback, and clear-reset Vitest cases.
- `apps/moderator/src/graph/GraphCanvasPane.tsx` — mode-gated `setTargetEntity('edge', edge.id)` in `handleEdgeClick` when `mode === 'meta-move'`.
- `apps/moderator/src/graph/GraphCanvasPane.test.tsx` — two Vitest cases: meta-move mode triggers capture-store side-effect; non-meta-move mode preserves selection-only behavior.
- `apps/moderator/src/layout/useProposeAction.ts` — defensive `'edge'`-kind guard (Decision §4 cross-flow audit).
- `tests/e2e/moderator-capture.spec.ts` — one new `test()` block: F8 → click seeded edge → submit → assert `target_kind: 'edge'` via wire-error region (mirrors the F8 default-kind block's discipline).
