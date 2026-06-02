# mod_break_edge_resolution_action — wire the break-edge chip to a real break-edge proposal action

## TaskJuggler entry

- WBS leaf: `moderator_ui.mod_diagnostic_resolution_flow.mod_break_edge_resolution_action`
- Definition: [`tasks/30-moderator-ui.tji` L595–600](../../30-moderator-ui.tji#L595)
- Title: _"Wire break-edge chip to a real break-edge proposal action"_
- Source of debt (per the `.tji` `note`):
  [`mod_resolution_path_picker.md` §D5 + Named follow-up tasks](./mod_resolution_path_picker.md) —
  the break-edge chip shipped **focus-only** because `affectedEntities` for a
  cycle returns `edges: []`, and there was no `useBreakEdgeAction` hook and no
  edge-target affordance. This task pays that debt.

## Effort estimate

`1d` (per the `.tji` block). The engine and wire surface already exist
end-to-end; the budget is one small proposal-action hook, a pure
candidate-edge helper, flipping the router's break-edge branch from
`focus-only` to an edge-chooser disposition, the panel wiring, and the tests.

## Inherited dependencies

`depends !mod_resolution_path_picker` (and, transitively, the whole
`mod_diagnostic_resolution_flow` chain: `mod_diagnostic_flow`,
`root_app.root_moderator_cutover`,
`data_and_methodology.diagnostics.blocking_vs_advisory_classification`,
`frontend_i18n.i18n_diagnostic_descriptions`).

**Settled by the predecessor (`mod_resolution_path_picker`, shipped):**

- **The pure router** — `resolutionPlanForMove(move, payload)` at
  [`apps/moderator/src/graph/resolutionPlan.ts:180-230`](../../../apps/moderator/src/graph/resolutionPlan.ts).
  The `ResolutionPlan` union (`'mode-entry' | 'proposal-submenu' | 'focus-only'`)
  is at L62-78; `FocusTarget` (`{ nodeIds, edgeIds }`) at L43-46; the
  `ResolutionTarget` direct/chooser discriminant at L53-55. **break-edge is
  currently lumped into the focus-only arm** at L221-226:
  ```ts
  case 'break-edge':
  case 'mark-conceded':
  case 'review-configuration':
  case 'repair-configuration':
  case 'leave-as-intentional':
    return { disposition: 'focus-only', focus };
  ```
  This task splits `break-edge` out of that arm into its own disposition.
- **The chip panel + inline target-chooser** —
  [`apps/moderator/src/layout/DiagnosticSuggestionsPanel.tsx`](../../../apps/moderator/src/layout/DiagnosticSuggestionsPanel.tsx):
  `handleChipClick` (L176-210) routes `(move, diagnostic)` through the router and
  dispatches; `ChooserFollowUp` (L75-77) / `ChooserState` (L79-83) /
  `handleCandidatePick` (L212-222) drive the inline chooser; the chooser JSX
  (L293-332) lists candidate **node** ids labelled via
  `resolveProposalTargetWording(events, nodeId)` (L307-318); submenus render at
  L334-351. The panel already reads the session events at L132
  (`useWsStore(... sessionState[sessionId].events)`).
- **The affordance-hook pattern** — `useEditWordingAction`
  ([`useEditWordingAction.ts:63-234`](../../../apps/moderator/src/layout/useEditWordingAction.ts))
  and `useAxiomMarkAction`
  ([`useAxiomMarkAction.ts:62-220`](../../../apps/moderator/src/layout/useAxiomMarkAction.ts))
  establish the per-target Zustand-store + `client.send('propose', …)` shape a
  new `useBreakEdgeAction` follows.
- **The canvas-focus seam** — `requestCanvasFocus({ nodeIds, edgeIds })`
  ([`uiStore.ts:74-81`](../../../apps/moderator/src/stores/uiStore.ts)); the
  panel already fires it on every chip click.
- **i18n move label** — `moderator.diagnostic.suggestions.move.break-edge`
  (`"Break a supports edge"`) and `chooser.{header,cancel}` already exist in all
  three catalogs (`en-US` / `pt-BR` / `es-419`).

**Pending / out of this task's hands:** the multi-actor
propose→agree→commit→flag-clears walk (owned by `mod_pw_diagnostic_flow`); the
advisory-move-semantics question (parked, not this task).

## What this task is

Turn the break-edge chip from focus-only into a working resolution action:
clicking `break-edge` on a `cycle` diagnostic presents an **inline chooser of
the cycle's candidate `supports` edges**, and picking one dispatches a real
`propose { kind: 'break-edge', edge_id }` envelope (the same lifecycle every
other resolution move uses), with the canvas focused on the affected region.

Concretely this task:

1. Adds `useBreakEdgeAction(edgeId)` — a proposal-action hook mirroring
   `useEditWordingAction`: a per-edge Zustand store tracking `inFlight` / error,
   and a `propose()` that sends `propose { kind: 'break-edge', edge_id }`.
2. Adds a pure `candidateBreakEdges(edges, cycleNodeIds)` helper that derives the
   breakable `supports` edges (role `supports`, both endpoints inside the cycle
   node set) from the already-projected edge list. The cycle payload carries
   only node ids, so the edge set must be derived, not read from the payload.
3. Splits `break-edge` out of the router's focus-only arm into a new
   `break-edge-chooser` disposition carrying the cycle's node ids.
4. Wires the panel: a break-edge chip click computes the candidate edges, opens
   the inline chooser (reusing the existing chooser shell, now able to list edge
   candidates labelled via `selectEdgeLabelById`), and on pick dispatches
   `useBreakEdgeAction(edgeId).propose()`. Focus fires on the click as before.

## Why it needs to be done

A `cycle` is a **blocking** diagnostic, and `break-edge` is the most direct
methodology resolution for it (sever one `supports` edge and the cycle is gone —
[`docs/methodology.md` L217-237](../../../docs/methodology.md)). Cycle is still
resolvable in v1 via `decompose` and `axiom-mark` (both wired by the
predecessor), but the `break-edge` chip renders enabled-looking yet does nothing
beyond focusing — the predecessor deliberately deferred it because the cycle
payload does not enumerate its edges and no edge-dispatch path existed. This task
closes that gap so the moderator can resolve a cycle by breaking a specific
support directly from the diagnostic surface.

## Inputs / context

**The router branch to split (the primary diff site):**

- [`apps/moderator/src/graph/resolutionPlan.ts:221-226`](../../../apps/moderator/src/graph/resolutionPlan.ts) —
  the focus-only arm currently swallowing `break-edge`. `affectedEntities(payload)`
  feeds `focus`; for a cycle that is `{ nodes: <cycle nodes>, edges: [] }`.

**The cycle payload + affected-entities (why edges must be derived):**

- [`packages/shell/src/diagnostics/diagnostic-highlights.ts:81-84`](../../../packages/shell/src/diagnostics/diagnostic-highlights.ts) —
  `WireCycleDiagnostic { kind: 'cycle'; nodes: readonly string[] }`. **Node ids
  only — no edge ids.**
- [`packages/shell/src/diagnostics/diagnostic-highlights.ts:247-254`](../../../packages/shell/src/diagnostics/diagnostic-highlights.ts) —
  `affectedEntities` cycle arm: `return { nodes: diagnostic.nodes, edges: [] }`.

**The projected edge list to derive candidates from:**

- [`apps/moderator/src/graph/selectors.ts:619`](../../../apps/moderator/src/graph/selectors.ts) —
  `selectEdgesForSession(state, sessionId, highlights)` returns the committed,
  visible ReactFlow `Edge<StatementEdgeData>[]`; each edge carries `id`,
  `source` / `target` (node ids) and `data.role`. This is the source the
  candidate-edge helper filters (`role === 'supports'` AND both endpoints in the
  cycle node set).
- Edge-role vocabulary: `edgeRoleSchema` at
  [`packages/shared-types/src/events/enums.ts:21-31`](../../../packages/shared-types/src/events/enums.ts)
  — `supports` is the role that forms argument cycles.

**The edge-label helper for the chooser rows:**

- [`apps/moderator/src/graph/selectors.ts:401-432`](../../../apps/moderator/src/graph/selectors.ts) —
  `selectEdgeLabelById(events, edgeId)` returns `"<role>: <source-snippet> →
  <target-snippet>"` (e.g. `"supports: Education is a right → Students have …"`),
  falling back to `null`. This is the edge analogue of
  `resolveProposalTargetWording` the node chooser uses.

**The affordance-hook pattern to mirror:**

- [`apps/moderator/src/layout/useEditWordingAction.ts:63-234`](../../../apps/moderator/src/layout/useEditWordingAction.ts) —
  result interface `{ propose, inFlight, lastError }` (L63-75); per-target Zustand
  store (L83-107); `propose()` builds the proposal and calls
  `client.send('propose', { sessionId, expectedSequence, proposal })` (L207-234,
  send at L230).
- [`apps/moderator/src/layout/useAxiomMarkAction.ts:205-220`](../../../apps/moderator/src/layout/useAxiomMarkAction.ts) —
  the exact `client.send('propose', { sessionId, expectedSequence, proposal: {
  kind: 'axiom-mark', node_id, participant } })` call to copy in shape.

**The break-edge wire + engine (already end-to-end):**

- [`packages/shared-types/src/events/proposals.ts:429-434`](../../../packages/shared-types/src/events/proposals.ts):
  ```ts
  export const breakEdgeProposalSchema = z.object({
    kind: z.literal('break-edge'),
    edge_id: z.string().uuid(),
  });
  export type BreakEdgeProposal = z.infer<typeof breakEdgeProposalSchema>;
  ```
- [`apps/server/src/projection/replay.ts:1291-1303`](../../../apps/server/src/projection/replay.ts) —
  the commit arm: looks up the edge, throws `commit/break-edge: edge … not
  present` if absent, else `projection.setEdgeVisible(edge_id, false)` and pushes
  a `visibility-changed` change. The committed graph is re-diagnosed, so the
  cycle flag clears once the edge is hidden.

**The inline chooser to extend:**

- [`apps/moderator/src/layout/DiagnosticSuggestionsPanel.tsx:293-332`](../../../apps/moderator/src/layout/DiagnosticSuggestionsPanel.tsx) —
  the existing chooser lists candidate **node** ids; `ChooserState` (L79-83)
  carries `candidateNodeIds` + `followUp` (`ChooserFollowUp`, L75-77, today
  `mode-entry | submenu`). This task extends it to also carry edge candidates
  with a break-edge follow-up that dispatches directly.

**The meta-move edge-target gesture (precedent considered, not reused):**

- [`apps/moderator/src/graph/GraphCanvasPane.tsx:227-238`](../../../apps/moderator/src/graph/GraphCanvasPane.tsx) —
  `handleEdgeClick` is mode-gated to `meta-move`; it stages an arbitrary
  canvas-clicked edge as a capture target via `captureStore.setTargetEntity('edge',
  …)`. See [`mod_meta_move_edge_target_gesture.md`](./mod_meta_move_edge_target_gesture.md)
  §1: a canvas left-click was chosen there because the meta-move target may be
  **any** edge in the graph. (Decision §D2 below explains why that is the wrong
  shape for break-edge.)

## Constraints / requirements

1. **No new engine / wire surface.** The break-edge schema and the commit
   projector already exist; this task emits only the existing
   `propose { kind: 'break-edge', edge_id }` envelope. No new event kind, no
   schema change (preserves the predecessor's §D1 "resolution is emergent").
2. **Candidates are derived, never guessed.** The breakable edges come from
   `candidateBreakEdges(selectEdgesForSession(...), cycleNodeIds)` — `supports`
   edges with both endpoints in the cycle node set. Never an arbitrary "first
   edge"; never hard-coded.
3. **Reuse the inline-chooser shell and the affordance-hook pattern.** Extend the
   existing `ChooserState` to carry edge candidates rather than building a second
   chooser control; `useBreakEdgeAction` mirrors `useEditWordingAction`'s store +
   `client.send('propose', …)` shape.
4. **Router stays pure and exhaustively narrowed.** `break-edge` becomes its own
   disposition arm in `resolutionPlanForMove`; the `SuggestionMove` union remains
   exhaustively narrowed so an unrouted move is still a compile/test break. The
   candidate-edge derivation lives in a separate pure helper (the router cannot
   see the graph; it carries the cycle node ids forward in the plan descriptor).
5. **Focus on dispatch.** A break-edge chip click fires
   `requestCanvasFocus({ nodeIds: cycleNodeIds, edgeIds: candidateEdgeIds })`
   (consistent with every other chip), so the affected region is framed while the
   moderator chooses which edge to break.
6. **Graceful degenerate handling.** If `candidateBreakEdges` yields exactly one
   edge → dispatch directly (no chooser, mirroring the predecessor §D4
   single-target rule). If it yields **zero** (defensive — a real cycle always has
   ≥2 supports edges) → fall back to focus-only, do not open an empty chooser.
   Two or more → chooser. (See §D3.)
7. **i18n via `useTranslation` (ADR 0024).** Reuse the existing `move.break-edge`
   and `chooser.cancel` labels; if the chooser header needs edge-specific wording,
   add `moderator.diagnostic.suggestions.chooser.headerEdge` with `pt-BR` /
   `es-419` parity rather than overloading the node `chooser.header`.

## Acceptance criteria

Per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md), every check
below ships as a committed test — no throwaway verification.

**Vitest — pure `candidateBreakEdges(edges, cycleNodeIds)`:**

1. Returns exactly the `supports`-role edges whose `source` and `target` are both
   in the cycle node set; excludes non-`supports` roles, excludes edges with an
   endpoint outside the set, excludes hidden/absent edges.
2. Order is deterministic (stable for a given edge list) so the chooser rows and
   tests don't flake.

**Vitest — `resolutionPlanForMove` break-edge arm:**

3. `(cycle, 'break-edge')` returns the new `break-edge-chooser` disposition
   carrying the cycle node ids and the focus set (not `focus-only`).
4. The `SuggestionMove` union remains exhaustively narrowed — the existing
   exhaustiveness test still pins one representative per disposition class,
   including the new break-edge disposition.

**Vitest — `useBreakEdgeAction`:**

5. `propose()` calls `client.send('propose', …)` with
   `{ kind: 'break-edge', edge_id }`, the active `sessionId`, and the current
   `expectedSequence`; `inFlight` flips true→false around the await; a `WireError`
   surfaces via `lastError` (mirrors the `useEditWordingAction` store tests).

**Vitest — `<DiagnosticSuggestionsPanel>` wiring:**

6. Clicking `break-edge` on a seeded `cycle` (events containing ≥2 `supports`
   edges among the cycle nodes) opens the inline chooser listing those edges
   labelled via `selectEdgeLabelById`, and fires `requestCanvasFocus` with the
   cycle nodes + candidate edges.
7. Picking a candidate edge calls `useBreakEdgeAction(thatEdgeId).propose()` and
   closes the chooser.
8. Degenerate handling: exactly one candidate edge dispatches directly (no
   chooser rendered); zero candidate edges renders focus-only (no empty chooser,
   no proposal) — both asserted.

**Playwright — observable picker behavior (in scope; extends
[`tests/e2e/moderator-diagnostic-flag-pane.spec.ts`](../../../tests/e2e/moderator-diagnostic-flag-pane.spec.ts)
using the `applyDiagnostic(page, payload)` backdoor at
[`tests/e2e/fixtures/wsStoreSeed.ts:369`](../../../tests/e2e/fixtures/wsStoreSeed.ts)):**

9. Seed a `cycle` diagnostic **whose `supports` edges are present in the seeded
   events stream** → the `break-edge` chip renders enabled; clicking it opens the
   inline edge chooser populated with the cycle's `supports` edges and the canvas
   viewport transform changes (focus fired); picking an edge dismisses the chooser
   (proposal dispatched).

   The break-edge chip is **route-rendered in the operate console and the cycle is
   seedable**, so e2e is **in scope, not deferred** (strict reachability test
   met). The seed must include the cycle's `supports` edges in the events array so
   `candidateBreakEdges` is non-empty; if `wsStoreSeed.ts` cannot yet seed
   `edge-created` events for this fixture, extending it to do so is part of this
   task (test-fixture work, agent-implementable).

**Deferred to `mod_pw_diagnostic_flow`** (already registered at
[`tasks/30-moderator-ui.tji` L869-872](../../30-moderator-ui.tji#L869),
`depends moderator_ui.mod_diagnostic_resolution_flow`): the full multi-actor walk
— propose break-edge, all participants agree, moderator commits, the edge hides
**and the cycle flag/banner clears**. That requires multiple authenticated
connections and the agree/commit lifecycle, which is that task's remit. No new
WBS task is created for it here; the cheap single-actor observable behavior is
paid inline above (per the e2e policy's debt-watch — `mod_pw_diagnostic_flow`
already inherits the predecessor's multi-actor deferral, so nothing new is piled
on it).

## Decisions

**§D1 — Reuse the existing `propose`/commit lifecycle; no new engine surface.**
The break-edge schema ([`proposals.ts:429-434`](../../../packages/shared-types/src/events/proposals.ts))
and the commit projector ([`replay.ts:1291-1303`](../../../apps/server/src/projection/replay.ts))
already perform the structural change end-to-end, and the cycle flag is an
emergent projection that clears when the edge is hidden. So this task adds only a
client-side hook + UI; it introduces no event kind and no wire change. _Alternative
rejected:_ a bespoke "resolve-cycle" event — same reasoning as the predecessor's
§D1 (diagnostics are projections, not durable state; such an event would be a
write with no reader).

**§D2 — Pick the edge via the inline chooser, NOT a canvas edge-click gesture.**
Breaking a cycle means choosing among a **small, known, constrained** set: the
`supports` edges connecting the cycle's nodes. An inline chooser over exactly that
set is guided (the moderator can only pick a cycle-relevant edge), labelled in
plain language via `selectEdgeLabelById`, and reuses the chooser shell the
predecessor already shipped (§D4 there). _Alternative rejected:_ reusing the
meta-move canvas edge-click gesture
([`GraphCanvasPane.tsx:227-238`](../../../apps/moderator/src/graph/GraphCanvasPane.tsx)).
That gesture exists precisely because a meta-move target may be **any** edge in
the graph (its
[refinement §1](./mod_meta_move_edge_target_gesture.md)), so a free canvas click
is appropriate there. Here the candidate set is constrained and the moderator
could otherwise click an edge that is not part of the cycle (breaking it would not
resolve the diagnostic and could throw `commit/break-edge: edge not present` if
already hidden). A new break-edge canvas mode would also add interaction surface a
1d leaf does not warrant — the same trade the predecessor §D4 used to reject
"armed canvas selection." The chooser is the consistent, lower-surface, safer
shape.

**§D3 — Candidates derived by a pure helper; chooser shown for ≥2, direct for 1,
focus-only for 0.** `candidateBreakEdges(edges, cycleNodeIds)` filters the
projected edge list (`selectEdgesForSession`) for `role === 'supports'` with both
endpoints in the cycle node set. The router cannot compute this (it is pure over
the diagnostic payload and has no graph), so the router's break-edge arm returns a
`break-edge-chooser` descriptor carrying `cycleNodeIds`, and the panel runs the
helper against the live events. The 1-candidate → direct and 0-candidate →
focus-only fallbacks mirror the predecessor's §D4 single-vs-multi-target rule and
keep the action well-defined for degenerate graphs. _Alternative rejected:_
threading the graph into the pure router — would break the router's
payload-only purity (the predecessor's §D3) and couple it to a store selector.

**§D4 — `useBreakEdgeAction(edgeId)` mirrors `useEditWordingAction`.** Same
per-target Zustand store (keyed by `edgeId`), same `{ propose, inFlight,
lastError }` surface, same `client.send('propose', { sessionId, expectedSequence,
proposal })` call. Chosen for consistency with the two shipped resolution hooks
and to reuse their tested in-flight/error semantics. _Alternative rejected:_
inlining the `client.send` in the panel's pick handler — untestable in isolation
and divergent from the established hook pattern.

**§D5 — Extend the existing `ChooserState`, don't add a second chooser.** Add an
edge-candidate shape to the chooser (a `candidateKind: 'node' | 'edge'`
discriminant, or a parallel `candidateEdgeIds` field) and a break-edge
`ChooserFollowUp` variant that dispatches `useBreakEdgeAction(...).propose()` on
pick. Reuses the chooser's open/close/focus/cancel machinery the predecessor
shipped. _Alternative rejected:_ a separate break-edge modal — duplicates chooser
chrome and orphans the established pattern.

**§D6 — e2e is in scope (single-actor), not deferred.** The chip is route-rendered
and the cycle is seedable, so under the strict UI-stream reachability test the
cheap observable behavior (chip enabled → chooser populated → focus fires → pick
dispatches) is paid inline as Playwright. The multi-actor
propose→agree→commit→flag-clears walk stays with the already-registered
`mod_pw_diagnostic_flow`. _Alternative rejected:_ full deferral to
`mod_pw_diagnostic_flow` — the surface is reachable (wrong default per policy) and
that catch-all is already debt-heavy.

**§D7 — i18n reuse.** Reuse `moderator.diagnostic.suggestions.move.break-edge` and
`chooser.cancel`; add only an edge-specific `chooser.headerEdge` key if the node
`chooser.header` ("Choose a node") reads wrong for edges, with `pt-BR` / `es-419`
parity (ADR 0024).

**§D8 — No new ADR.** This task adds no dependency, no wire/engine surface, and no
new architectural seam — it reuses the router, the chooser shell, the
affordance-hook pattern, and the existing break-edge schema/projector. The one
non-obvious call (inline chooser vs canvas gesture, §D2) is a UI-shape choice
justified against the meta-move precedent, recorded here. No ADR warranted
(consistent with the predecessor's §D8).

## Open questions

(none — all decided.)

## Status

**Done** — 2026-06-02.

- Added pure helper `apps/moderator/src/graph/candidateBreakEdges.ts` deriving breakable `supports` edges from the projected edge list (both endpoints inside the cycle node set).
- Added `apps/moderator/src/graph/candidateBreakEdges.test.ts` — 5 cases covering role filter, endpoint membership, exclusion of non-`supports` edges, and deterministic ordering.
- Added `apps/moderator/src/layout/useBreakEdgeAction.ts` — per-edge Zustand store hook mirroring `useEditWordingAction`, with `propose()` dispatching `propose { kind: 'break-edge', edge_id }`, plus shared `dispatchBreakEdgeProposal`.
- Added `apps/moderator/src/layout/useBreakEdgeAction.test.tsx` — envelope/in-flight/error cases.
- Split `break-edge` out of the focus-only arm in `apps/moderator/src/graph/resolutionPlan.ts` into a new `break-edge-chooser` disposition carrying cycle node ids; exhaustiveness test updated in `apps/moderator/src/graph/resolutionPlan.test.ts`.
- Wired `apps/moderator/src/layout/DiagnosticSuggestionsPanel.tsx`: ≥2 candidates → inline edge chooser, 1 candidate → direct dispatch, 0 candidates → focus-only fallback; child components keep `useWsClient` out of bare-render path.
- Expanded `apps/moderator/src/layout/DiagnosticSuggestionsPanel.test.tsx` with break-edge chooser/pick/single/zero + i18n parity cases (35 DOM tests green).
- Added `chooser.headerEdge` key to `packages/i18n-catalogs/src/catalogs/{en-US,pt-BR,es-419}.json`.
- Extended `tests/e2e/moderator-diagnostic-flag-pane.spec.ts` with Playwright scenario: break-edge chip opens edge chooser, focuses region, pick dismisses chooser.
