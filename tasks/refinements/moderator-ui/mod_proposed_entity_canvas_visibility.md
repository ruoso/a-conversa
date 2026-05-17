# Render proposed entities on the graph canvas from the moment of proposal

**TaskJuggler entry**: `moderator_ui.mod_graph_rendering.mod_proposed_entity_canvas_visibility` — [tasks/30-moderator-ui.tji](../../30-moderator-ui.tji)
**Effort estimate**: 3.5d (grew from 2d after the Q&A round resolved D2 edges-in-scope, D3 multi-entity-in-scope, D4 explicit-removal-events; D5 carved out the ADR into a separate landed-ahead-of-task artifact, taking ~0.5d off the implementation-task estimate)
**Inherited dependencies**:
- `moderator_ui.mod_graph_rendering.mod_proposed_state_styling` (done — defined the `data-facet-status="proposed"` + `border-dashed opacity-60` visual contract; this task makes that styling actually apply to freshly proposed entities by getting them onto the canvas in the first place).
- `backend.websocket_protocol.ws_propose_message` (done — defined the current propose-time wire shape that this task is amending).

## What this task is

Land an end-to-end fix for a design-vs-implementation gap surfaced 2026-05-16 by a manual-browser smoke: when a moderator proposes a free-floating new statement, the pending-proposals sidebar fills in but the graph canvas stays empty until commit. The design says the proposed node should appear on the canvas immediately in `proposed` state.

The task ships as **failing-test-first**:

1. A Playwright e2e under `tests/e2e/` that proposes a free-floating statement (zero votes, no commit) and asserts the canvas renders the corresponding `statement-node-<nodeId>` element with `data-facet-status="proposed"`. Committed and confirmed-failing first.
2. The chosen protocol/projector fix that makes it pass.
3. Re-run the e2e green and update sibling unit tests if the projector contract changes.

## Why it needs to be done

Two layered reasons:

**Design correctness.** `docs/methodology.md` L57 ("A proposed change appears on the graph in `proposed` state from the moment it is made") and `docs/moderator-ui.md` L46 ("The graph shows the new node and edge in `proposed` state. The pending-proposals pane fills in") both promise immediate canvas visibility for proposed entities. `docs/data-model.md`'s Node visibility section explicitly decouples graph visibility from facet status: only structural events (`decompose`, `interpretive-split`, `break-edge`, `edit-wording.restructure`) flip the visibility flag off. Lack-of-votes is *not* a visibility-suppressing condition.

The current live behavior — proposed statement sits invisibly until commit — violates that contract. A moderator running a session has no canvas signal that a proposal exists; their only feedback is the sidebar entry. The whole point of the canvas during a debate is to be the shared visual representation of the in-flight argument structure; if proposed nodes don't appear, the canvas can't play that role.

**Test-coverage gap.** The unit tests at `apps/moderator/src/graph/GraphCanvasPane.test.tsx` (L713, L887, L689) appear to assert exactly this — they seed `node-created` events into the WS store, propose a facet, cast zero votes, and assert the canvas renders the node with `data-facet-status="proposed"`. The tests pass. But they pass because the harness short-circuits the live event flow by hand-feeding `node-created`. In the live propose flow there *is* no `node-created` event until commit, so the projector never sees it. The unit test passes; the live system fails. An end-to-end test that drives the real propose path exposes the gap; no existing Playwright spec checks the canvas after a propose (`tests/e2e/moderator-capture.spec.ts` asserts only the sidebar).

This is exactly the kind of contract drift that the test layering in ADRs 0006/0007/0008 is supposed to prevent. The failing-first Playwright e2e is the structural fix to the test pyramid; the underlying protocol fix is the structural fix to the runtime.

## Inputs / context

### Design contract

- [`docs/methodology.md`](../../../docs/methodology.md) L57 — "A proposed change appears on the graph in `proposed` state from the moment it is made."
- [`docs/moderator-ui.md`](../../../docs/moderator-ui.md) L46 — "The graph shows the new node and edge in `proposed` state. The pending-proposals pane fills in."
- [`docs/data-model.md`](../../../docs/data-model.md) "Node visibility" section — visibility is binary; an entity is visible iff its `entity-included` (or equivalent) has committed AND no subsequent structural event has hidden it. Vote-quorum is explicitly NOT a visibility predicate.

### Current implementation (the gap)

- `apps/server/src/methodology/handlers/propose.ts` — the propose handler today emits **exactly one** `proposal` event. No `node-created`, no `entity-included`, no `edge-created`.
- [`tasks/refinements/backend/ws_propose_message.md`](../backend/ws_propose_message.md) — the canonical statement of the current propose-time wire shape: "propose stages a proposal; commit creates the entity."
- [`tasks/refinements/backend/commit_logic.md`](../backend/commit_logic.md) — the commit-time fan-out that emits the structural creation events.
- `apps/moderator/src/graph/GraphCanvasPane.tsx` (`projectNodes`, lines ~380–490) — walks `node-created` events to build the canvas node list. No `proposal`-derived synthesis.
- `apps/moderator/src/graph/selectors.ts` (`selectEdgesForSession`, lines ~571–650) — walks `edge-created` events. Same shape.

### Existing prose acknowledgement

- `tests/e2e/moderator-capture.spec.ts` L686–L717 — multi-paragraph comment on the existing `mod_pw_propose_action_envelope` test that explicitly documents the propose-time-vs-commit-time split. The comment was a Closer-time amendment for `mod_propose_action` after a prior refinement claim was wrong; the runtime is unchanged from that amendment.

### Test infrastructure to extend

- `tests/e2e/moderator-capture.spec.ts` — host for the new failing-first scenario. Has the propose plumbing already; the new test slots in next to the L724 "alice: propose a free-floating new statement" test that asserts only the sidebar/envelope.
- `tests/e2e/fixtures/` — reuses the existing auth + session-setup fixtures.

## Constraints / requirements

### Stage 1 — Failing-first Playwright e2e (the regression cover)

- **New scenario** in `tests/e2e/moderator-capture.spec.ts` (or a focused new spec if the file grows unwieldy), modeled on the existing free-floating-propose test at L724.
- **Acceptance assertion**: after the propose envelope round-trips and the sidebar entry appears, `expect(page.getByTestId('statement-node-<nodeId>')).toBeVisible()` AND `expect(page.getByTestId('statement-node-<nodeId>')).toHaveAttribute('data-facet-status', 'proposed')`. Zero votes recorded before the assertion.
- **Node-id derivation**: the propose envelope carries a deterministic `proposal_id`; the post-fix protocol must let the test compute the node-id it should look for. (If the chosen resolution is server-allocated-on-propose, the test reads the node-id from the proposal-broadcast envelope; if client-synthesized, the test reads the proposal-id-derived synthetic id from a documented helper.)
- **Confirm failure first**: run the scenario before any production change. Verify it fails for the right reason (canvas missing the testid, not flaky selector / timing). Capture the failure in the commit message of the test-only commit so future readers can see the test was committed red on purpose.
- **Commit the test red.** Per ADR 0022 (no throwaway verifications), the failing test is the durable artifact of the gap; it stays in CI until the fix lands as the next commit.

### Stage 2 — Land the fix

**Resolution (settled 2026-05-16, see Decisions D1)**: propose-time emits the structural events (`node-created`, `entity-included`, and `edge-created` for edges) for any new entities the proposal introduces. The structural events represent the entity entering the graph structure; the facet layer (already implemented per `apps/server/src/projection/facet-status.ts` and ported client-side in `apps/moderator/src/graph/facetStatus.ts`) carries the per-facet proposed / agreed / disputed / committed agreement state independently. The current implementation collapsed those two layers by gating structural events on commit; the fix removes that gate.

Mechanical changes:

- **Propose handler** (`apps/server/src/methodology/handlers/propose.ts`): for proposals that introduce new entities (`classify-node` when target is a fresh-node spec, `decompose`, `interpretive-split`, free-floating edge proposals via the upcoming draw-edge flow), emit the appropriate `node-created` / `entity-included` / `edge-created` events alongside the `proposal` envelope. For proposals that operate on an existing entity (`set-node-substance` on an extant node, `edit-wording.reword`, `amend-node`, `axiom-mark`, `meta-move`, `annotate`, etc.), no new structural events fire — the entity already exists in the structure.
- **Commit handler** (`apps/server/src/methodology/handlers/commit.ts` + the commit-time fan-out in `apps/server/src/projection/replay.ts`): stop re-emitting `node-created` / `entity-included` / `edge-created` for entities that were already created at propose-time. Commit becomes a pure facet-state transition (proposed → agreed → committed via the existing `vote` + `commit` event sequence). The `edit-wording.restructure` commit-time path that creates a *new* node id stays as-is (that one genuinely creates an entity at commit-time and is governed by the Node visibility rules in `docs/data-model.md`).
- **Withdraw / rejection flow**: if a proposal is withdrawn before commit, the proposed entities need to leave the structure. Either emit a complementary `entity-removed` / `node-withdrawn` event, or have the projector treat "proposal withdrawn AND entity has no committed facets" as visibility=false. Decision deferred to the implementer's Q&A round; the test must cover withdraw to pin whichever path is chosen.
- **Projection / replay** (`apps/server/src/projection/replay.ts`): audit every `node-created` / `entity-included` / `edge-created` consumer for assumptions that the entity is committed-real at the moment the event fires. Diagnostic engines, cycle detection, audience-broadcast filters, etc., must read the facet layer (or a derived `isCommitted(entity)` helper) instead of relying on the structural event's timing. This is the load-bearing audit pass of the fix.
- **Client projectors**: the moderator's `projectNodes` / `selectEdgesForSession` already render any node/edge they see in the event log; once propose-time emits them, the canvas renders them immediately. `mod_proposed_state_styling`'s existing `facetStatuses` → `data-facet-status="proposed"` styling applies automatically because the facet derivation already returns `'proposed'` for fresh proposals with no votes. The participant and audience surfaces share the same model and get the fix transitively.

The change is documented as an amendment to `tasks/refinements/backend/ws_propose_message.md` (current refinement claim "propose stages a proposal; commit creates the entity" is corrected to "propose creates the entity in the structure; commit transitions its facets from proposed → agreed → committed"). Whether this also warrants a new ADR (vs an amendment to ADR 0021's event envelope or a clarifying note on the existing facet ADRs) is decided in the implementer's Q&A round.

### Stage 3 — Re-run green + update unit tests

- The Playwright e2e passes.
- `apps/moderator/src/graph/GraphCanvasPane.test.tsx` L713 / L887 / L689 and the surrounding facet-status tests are updated to seed whichever representation the chosen path uses (if (A), they keep seeding `node-created` but with the new flag; if (B), they seed `proposal` events directly and rely on the synthesis; if (C), they seed the new event kind).
- `mod_proposed_state_styling`'s `border-dashed opacity-60` + `data-facet-status="proposed"` contract holds against the post-fix node representation. No styling-task regressions.

## Acceptance criteria

- One new Playwright e2e (or focused new spec) committed red, then committed green in the immediate-next commit (two commits, tight cluster; the red→green pair is the historical record of the regression-cover). The e2e covers four scenarios in one file: (1) free-floating single-node propose → canvas shows node with `data-facet-status="proposed"`; (2) propose with new edge to existing target → edge visible; (3) 2-component decomposition propose → both component nodes + their edges visible AND original target still visible; (4) propose then withdraw → entities gone from canvas.
- All existing Playwright specs still pass.
- All affected Vitest unit tests still pass (updated as needed for the new projector contract — `apps/moderator/src/graph/GraphCanvasPane.test.tsx` L713 / L887 / L689 stay green; any test that seeded `node-created` to simulate propose-time-rendering gets simplified now that real propose-time emission exists).
- [ADR 0027](../../../docs/adr/0027-entity-and-facet-layers-strict-separation.md) is in place (landed ahead of this task as the principle artifact); `tasks/refinements/backend/ws_propose_message.md` and `tasks/refinements/backend/commit_logic.md` get amended in this task to point at ADR 0027 and remove the "propose stages, commit creates" language. ADR 0021's amendment-pass note (also landed ahead of this task) points forward to ADR 0027.
- A manual-browser smoke confirms: propose a free-floating statement → canvas immediately shows a dashed-border faded node; sidebar fills in normally; committing flips the canvas node to solid border / full opacity per `mod_agreed_state_styling`'s sibling contract. Decompose smoke: propose a 2-component decomposition → both components + edges visible alongside original target; commit → original target hides, components/edges become solid.

## Decisions

- **D1 (2026-05-16)**: Protocol resolution path is **(A)** — propose-time emits the structural events for any new entities the proposal introduces; commit becomes a pure facet-state transition. Rationale: the facet layer exists precisely so the entity layer doesn't have to carry agreement state. `node-created` was always meant to be "entity entered the structure"; the facets (proposed / agreed / disputed / committed / withdrawn / meta-disagreement) were always the layer that knows the negotiation state. The current implementation collapsed those two layers by gating structural events on commit; the fix removes that gate and restores the architectural separation. Alternatives (B) client-side ghost synthesis and (C) new placeholder event kind were considered and rejected: (B) duplicates a branch across three projector implementations and introduces id-reconciliation at commit-time; (C) adds an event kind to maintain when the existing structural events already mean what we need them to mean.
- **D2 (2026-05-16)**: **Edges are in scope** for this task — `edge-created` follows the same commit-time-gated fan-out as `node-created` and has the same gap. The propose handler change in Stage 2 extends to `edge-created`, the audit pass extends to every `edge-created` consumer, and the Stage 1 failing-first Playwright e2e includes at least one edge-visibility assertion. Even though the moderator's draw-edge flow (`mod_draw_edge_flow`) is not yet implemented as a UI path, the e2e can drive an edge-creating proposal via the implicit edge in `classify-node` flows that connect a new statement to an existing target (or by seeding an edge proposal through the test harness). Splitting into a follow-up `mod_proposed_edge_canvas_visibility` leaf was rejected because it would force the same Q&A round again and risk drift if the follow-up is deprioritized.
- **D3 (2026-05-16)**: **Multi-entity proposals (`decompose`, `interpretive-split`) are in scope** for this task — under D1 (path A), the propose handler emits N `node-created` + N `entity-included` + M `edge-created` events for the proposal's child specs alongside the `proposal` envelope itself. The original target node stays visible throughout the proposed-but-uncommitted window (per `docs/data-model.md`'s Node visibility, target visibility flips off only on commit of `edit-wording.restructure` / `decompose` / `interpretive-split`); the canvas therefore shows the target AND the proposed components AND the proposed edges simultaneously during the proposed window. That simultaneous visibility is the intended UX — moderator and participants need to see "what this would become" alongside "what it is now" to evaluate the proposal. Commit then atomically flips the target's visibility off and transitions the components' facets from proposed → agreed → committed. Rationale for inclusion in this task: the multi-entity behavior was meant to be part of the original implementation but was missed by the same commit-time-gating bug that caused the single-node gap; landing the fix without exercising the multi-entity path leaves the bug half-fixed. The Stage 1 failing-first Playwright e2e includes a scenario that proposes a 2-component decomposition and asserts: (a) both component nodes are visible on the canvas with `data-facet-status="proposed"`, (b) the proposed edges from each component are visible, and (c) the original target node remains visible during the proposed window. Q3a (`interpretive-split` follows the same shape) is folded into D3 — the same mechanism covers both; the e2e can exercise either kind, with a follow-up assertion in `mod_pw_decompose_flow` / `mod_interpretive_split_mode` covering the other.
- **D4 (2026-05-16)**: **Withdraw / rejection lifecycle uses explicit removal events** — when a proposal is withdrawn (or rejected, or expires) before commit, the propose-time-created entities leave the structure via complementary `entity-removed` events (with appropriate sub-shapes for node vs edge; the existing `entity-included`/`entity-removed` pair in the projection layer is the seam to extend). Rationale: same as D1 — entities entering and leaving the structure are first-class structural facts, and the event log is the canonical record of structural facts. The alternative (b) "implicit derivation from proposal-withdrawn state" was rejected because it would push a derivation rule into every projector (moderator, participant, audience), make "why isn't this entity visible?" a multi-step query instead of a single-event lookup, and create a permanent projector-complexity tax for a derivable condition that's cheaper to represent explicitly. Stage 2 propose-handler changes pair the new propose-time `node-created`/`edge-created` emission with a withdraw-handler that emits the matching `entity-removed` events. If the withdraw flow does not exist yet as a UI path, this task adds the minimal handler + protocol surface needed for the e2e to exercise the round-trip (propose → withdraw → entity gone from canvas). The Stage 1 failing-first Playwright e2e includes a withdraw-after-propose assertion: after withdraw, `expect(page.getByTestId('statement-node-<nodeId>')).not.toBeVisible()`.
- **D5 (2026-05-16)**: **Principle captured in [ADR 0027](../../../docs/adr/0027-entity-and-facet-layers-strict-separation.md)** ("Entity and facet layers are strictly separate"). Landed ahead of this task (rather than as part of its deliverables) so the principle is visible to anyone reading the WBS or the design docs before the implementation lands. The ADR states: structural events fire on entity lifecycle (creation, inclusion, removal), independent of facet agreement state; facet events fire on agreement state changes, independent of entity lifecycle; the two compose at the projection. Consequences spelled out in the ADR include the propose-handler / commit-handler / withdraw-handler changes, the new `entity-removed` event kind addition to the SQL CHECK + `eventKinds` registry, and the audit-pass requirement on projectors / diagnostic engines / replay. ADR 0021 received an amendment-pass note (2026-05-16) pointing forward to ADR 0027 for the timing semantics. This task's implementation lands the runtime changes that the ADR mandates; alongside it, `tasks/refinements/backend/ws_propose_message.md` and `tasks/refinements/backend/commit_logic.md` are amended in place to remove the "propose stages, commit creates" language and point at ADR 0027 as the authoritative source.

## Open questions

(none — all decided in D1–D5)
