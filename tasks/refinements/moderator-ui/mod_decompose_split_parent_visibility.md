# mod_decompose_split_parent_visibility — Hide decomposed / interpretive-split parents on commit (both canvases) per the supersession rule

**TaskJuggler entry**: `task mod_decompose_split_parent_visibility` under `moderator_ui.mod_graph_rendering` in [`tasks/30-moderator-ui.tji`](../../30-moderator-ui.tji) (L371). The `m_audits` milestone ([`tasks/99-milestones.tji`](../../99-milestones.tji) L99–103) depends on this task; it was registered at the 2026-06-10 parking-lot triage alongside its sibling conformance fix `interpretive_split_edge_inheritance` (shipped 2026-06-11).

**Effort estimate**: 2d.

**Inherited dependencies**:

- `data_and_methodology.methodology_engine.decomposition_logic` — **settled** (Done 2026-05-10). Propose-side validator; commit arm landed later and flips `parent.visible = false` server-side.
- `data_and_methodology.methodology_engine.interpretive_split_logic` — **settled** (Done 2026-05-10). Mirror validator with decompose/split mutual exclusion; same commit-time visibility flip.
- Adjacent (not a declared dependency): `interpretive_split_edge_inheritance` — **settled** (Done 2026-06-11, [ADR 0046](../../../docs/adr/0046-interpretive-split-edge-inheritance-commit-time-carry.md)). Its refinement explicitly left the parent-removal canvas assertion to this task to keep the two triage-registered scopes disjoint.

## What this task is

Bring the frontend canvases into conformance with the documented supersession rule: when a `decompose` or `interpretive-split` proposal **commits**, the parent node disappears from the visible graph, along with its incident edges (invisible by missing endpoint). Today the server projection flips `parent.visible = false` internally ([`apps/server/src/projection/replay.ts`](../../../apps/server/src/projection/replay.ts) L1291–1321) but emits nothing on the wire, and the moderator and participant projectors drop nodes only on `entity-removed` — so a superseded parent stays rendered on both live canvases forever. The shared audience/replay projector ([`packages/graph-view/src/projectGraph.ts`](../../../packages/graph-view/src/projectGraph.ts)) already derives supersession client-side and drops the parent.

The work: extract `graph-view`'s supersession walk into a pure `@a-conversa/shell` helper, consume it from all three canvas projectors (moderator, participant, graph-view-refactored), filter superseded nodes and their incident edges from the rendered graph, and rework the two e2e specs whose contracts assumed the parent persists. Seam decision recorded in [ADR 0047](../../../docs/adr/0047-parent-supersession-client-derived-from-commit.md): client-side derivation from the commit event, no wire emission.

## Why it needs to be done

- **Docs–implementation conformance.** [`docs/methodology.md`](../../../docs/methodology.md) L154–158 ("the raw utterance is removed from the current visible graph") and [`docs/data-model.md`](../../../docs/data-model.md) L276–289 (visible-graph derivation, supersession kinds) are explicit. The 2026-06-10 parking-lot triage chose Option A — make the implementation match the docs — over amending the docs.
- **The ADR 0046 inherited-edge story is visually incoherent without it.** After a split commits, the readings and their inherited edges render *alongside* the still-visible parent and its original edges — the graph shows both the superseded claim and its replacements, which is precisely the confusion the split exists to dissolve.
- **Named e2e debt points here.** `tests/e2e/full-session-walkthrough.spec.ts` AC-5b (L1001–1026) carries a deferral block for the "parent is removed from the visible graph" clause, tracked under this task's pre-registration name `frontend_decompose_split_parent_visibility`.

## Inputs / context

Design docs:

- [`docs/methodology.md`](../../../docs/methodology.md) L154–158 — raw utterance removed on agreed decomposition; L169 — restructure supersession (same mechanism family).
- [`docs/data-model.md`](../../../docs/data-model.md) L276–289 — visible-graph derivation: visibility is "purely a function of the event log"; the three superseding kinds (`decompose`, `interpretive-split`, `edit-wording` with `kind: restructure`); superseded nodes stay in `session_nodes` (monotonic), supersession is per-session. Edge visibility by present endpoints.

Server (already conformant — reference semantics, not modified by this task):

- [`apps/server/src/projection/replay.ts`](../../../apps/server/src/projection/replay.ts) L1261–1290 (restructure commit arm), L1291–1321 (decompose / interpretive-split commit arms) — `projection.setNodeVisible(..., false)` plus internal `visibility-changed` change objects that are never serialized.
- [`apps/server/src/methodology/handlers/commit.ts`](../../../apps/server/src/methodology/handlers/commit.ts) L542–662 (`commitHandler`); L448–534 — ADR 0046 inherited-edge fan-out sequenced before the proposal-keyed commit.
- [`packages/shared-types/src/events.ts`](../../../packages/shared-types/src/events.ts) — `entity-removed` exists but is scoped to withdrawals (comment at L642–651, per [ADR 0027](../../../docs/adr/0027-entity-and-facet-layers-strict-separation.md) §3); no visibility event kind on the wire.

Frontend projectors:

- Moderator: [`apps/moderator/src/graph/GraphCanvasPane.tsx`](../../../apps/moderator/src/graph/GraphCanvasPane.tsx) — `projectNodes` L612–872, drops nodes only via the `entity-removed` skip at L722–728; already imports `@a-conversa/shell` helpers (L120–152). Edges via `selectors.ts` (`selectEdgesForSession`); [`apps/moderator/src/graph/StatementEdge.tsx`](../../../apps/moderator/src/graph/StatementEdge.tsx) carries `data-edge-source` / `data-edge-target`.
- Participant: [`apps/participant/src/graph/projectGraph.ts`](../../../apps/participant/src/graph/projectGraph.ts) — `projectGraph` L476–770, `entity-removed`-only removal at L538–552; shell imports at L109–117. Per-entity e2e surface is the DOM status mirror (`[data-testid="participant-node-status"][data-node-id="…"]`); WS store test seam `window.__aConversaWsStore` at [`apps/participant/src/main.tsx`](../../../apps/participant/src/main.tsx) L50.
- Shared (audience/replay) — **the donor implementation**: [`packages/graph-view/src/projectGraph.ts`](../../../packages/graph-view/src/projectGraph.ts) records pending `decompose` / `interpretive-split` / `edit-wording.restructure` proposals (L608–611, map populated near L457) and on commit adds the parent / old node to a superseded set (L675–680), omitting it from the emitted elements. Covers **all three** documented kinds. `packages/graph-view/package.json` L28 already depends on `@a-conversa/shell`. Dead seam: the `decomposed?: boolean` element field (L271) and the `node[?decomposed]` stylesheet arm ([`packages/graph-view/src/stylesheet.ts`](../../../packages/graph-view/src/stylesheet.ts) L347–350) are declared but never stamped — the projector drops the parent outright.

E2e specs whose contracts change:

- [`tests/e2e/methodology-full-flow.spec.ts`](../../../tests/e2e/methodology-full-flow.spec.ts) — Phase 6.1 (L1224) proposes a decompose of N1; Phase 6.2 (L1260–1333) commits it; Phases 7.1/7.2 (L1339–1407, participant-mirror assertion on N1 at L1404–1406), 8.1 (L1414–1456, tolerant-acceptance comment at L1444–1451 acknowledging the server likely rejects), 8.2, 9.1 (L1486), 11.1/11.2 (L1597–1622) all keep interacting with N1 *after* its decompose commit — possible today only because the canvases ignore supersession.
- [`tests/e2e/full-session-walkthrough.spec.ts`](../../../tests/e2e/full-session-walkthrough.spec.ts) — AC-5b (L952–1027); the deferral block at L1001–1026 names this task (as `frontend_decompose_split_parent_visibility`) and documents exactly the contract being replaced.

ADRs:

- [ADR 0047](../../../docs/adr/0047-parent-supersession-client-derived-from-commit.md) — **written with this refinement**: supersession derived client-side via a shared shell helper; wire emission rejected. Amendment entry appended to ADR 0027.
- [ADR 0027](../../../docs/adr/0027-entity-and-facet-layers-strict-separation.md) — `entity-removed` scoped to withdrawals; Consequences anticipate the parent flipping off on commit "per the existing Node visibility rules".
- [ADR 0043](../../../docs/adr/0043-client-side-replay-position-navigation-in-shell.md) — `@a-conversa/shell` as the home for multi-surface client projection logic.
- [ADR 0046](../../../docs/adr/0046-interpretive-split-edge-inheritance-commit-time-carry.md) — inherited edges arrive as ordinary `edge-created` events; their endpoints are reading nodes, so they survive parent-edge filtering.
- [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md) — every empirical check ships as a committed test.

## Constraints / requirements

- **No wire/protocol change** (ADR 0047). No `entity-removed` or new event kind for supersession; the server is untouched. Consequently no new Cucumber scenario is owed — the protocol seam doesn't move, and the server-side flip is already pinned by projection tests.
- **One implementation of the rule.** A pure helper in `@a-conversa/shell` (events-prefix in → superseded-node-id set out), extracted from `graph-view`'s walk; `graph-view` refactors onto it with **no behavior change**; moderator and participant projectors adopt it.
- **All three superseding kinds** (`decompose`, `interpretive-split`, `edit-wording.restructure`) per `docs/data-model.md` L281–285 — the donor implementation already covers restructure; narrowing to the task title's two kinds would fork the rule across surfaces.
- **Committed resolutions only.** Pending, rejected, and withdrawn structural proposals must not hide the parent (`proposal-withdrawn` clears the pending record, as in the donor walk).
- **Incident edges drop with the parent** (missing-endpoint rule), evaluated per surface against the superseded set. ADR 0046 inherited edges must keep rendering.
- **Prefix-stable for replay.** The helper is a pure function of an event prefix: the audience/replay scrubber must render the parent at positions before the commit and not at/after it (the donor walk already has this property; the refactor must preserve it).
- **Canvas-level filtering, not store deletion.** Superseded nodes' data (wording, ids) stays available to non-canvas consumers — the change-history pane, pending-proposal sidebar rows whose target node was superseded (e.g. an annotate proposed before the split committed), provenance chains. Label lookups in those surfaces must tolerate a superseded target without crashing.
- **Selection state degrades gracefully.** A participant detail panel or moderator selection pointing at a node that supersedes out from under it must clear/empty, not crash — methodology-full-flow Phase 6.2 commits the decompose while N1 is auto-selected on ben's panel, so the reworked spec exercises this path live.
- **Don't rewrite history.** Prior refinements and the AC-5b deferral block's *reasoning* stay as the historical record; the spec code and stale comments that encode the parent-persists contract are updated because that contract was the conformance bug this task fixes.

## Acceptance criteria

Per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md), every check below ships as a committed test; new assertions must be demonstrated red against the pre-task runtime before the projector wiring lands.

1. **Shell helper Vitest** (new suite next to the helper in `packages/shell/src/`): committed `decompose` supersedes the parent; committed `interpretive-split` supersedes the parent; committed `edit-wording.restructure` supersedes the old node; a pending structural proposal supersedes nothing; a withdrawn-before-commit proposal supersedes nothing; prefix behavior — the node is absent from the set for prefixes ending before the commit event and present at/after it.
2. **Moderator projector Vitest** (`apps/moderator/src/graph/`): after a seeded decompose commit, `projectNodes` omits the parent and the edge selector omits its incident edges; both render for the pre-commit prefix; ADR 0046 inherited edges (reading-node endpoints) survive.
3. **Participant projector Vitest** (`apps/participant/src/graph/`): same pin on `projectGraph`, including the DOM status-mirror source data (no mirror row for a superseded node).
4. **graph-view refactor pinned by its existing Vitest** — suite stays green unmodified (no behavior change through the extraction).
5. **Playwright — `methodology-full-flow.spec.ts` reworked**: after Phase 6.2's decompose commit, assert `statement-node-wording-<n1>` has count 0 on alice's canvas and `[data-testid="participant-node-status"][data-node-id="<n1>"]` has count 0 on ben's mirror. Phases 7.x (axiom-mark), 8.x (interpretive-split), 9.x (annotate), and 11.x (edit-wording) retarget their N1 interactions to nodes still visible at that point in the sequence (the Phase 6.1 component nodes, then readings as needed — resolve ids by wording as Phase 2.1 does), threading targets so no phase interacts with a node a prior phase superseded. Where retargeting makes a previously server-rejected action valid (e.g. Phase 8.1's split), tighten the tolerant-acceptance arm toward the clean-success surface. Each phase keeps pinning the same seam it pins today.
6. **Playwright — `full-session-walkthrough.spec.ts` AC-5b**: replace the deferral block (L1001–1026) with the restored assertion — after maria's interpretive split of N14 commits, N14's moderator node testid has count 0 while the two reading nodes and their ADR 0046 inherited-edge assertions stay green. Update the stale `frontend_decompose_split_parent_visibility` comment reference to this task's WBS name.
7. **No new Cucumber scenario** — wire behavior is unchanged by design (ADR 0047); the server projection's visibility flip is already covered by existing projection tests.

No deferred e2e and no new WBS tasks: both surfaces are reachable today, the Playwright coverage lands in this task, and the rework *pays down* the AC-5b deferral debt rather than adding any.

## Decisions

- **Client-derived supersession, no wire emission — [ADR 0047](../../../docs/adr/0047-parent-supersession-client-derived-from-commit.md).** The commit event plus the proposal envelope (both already consumed by every projector) determine the superseded node in one lookup; `docs/data-model.md` defines visibility as derived state; and only derivation corrects already-recorded event logs on the replay surface. Emitting `entity-removed` (semantics conflation with withdrawal, back-compat hole, two mechanisms for one rule) and a new `visibility-changed` event kind (protocol widening for zero information) are rejected in the ADR, including why this doesn't contradict ADR 0027 §3's rejection of derivation for withdrawals.
- **The rule lives in `@a-conversa/shell`, extracted from `graph-view`.** `graph-view` is the donor (shipped, covers all three kinds); shell is the established home for multi-surface projection helpers (ADR 0043, `computeFacetStatuses` precedent) and is already a dependency of all three consumers. Leaving the walk inline and copying it twice was rejected as the exact multi-projector duplication ADR 0027 §3 warns about.
- **Full three-kind rule, not just decompose/split.** The helper implements the documented supersession list including `edit-wording.restructure`; scoping to the title's two kinds would make moderator/participant diverge from graph-view on restructure and force an immediate successor task. The restructure commit arm already exists server-side (`replay.ts` L1261–1290), so the client rule has real behavior to mirror today.
- **Helper returns node ids; each surface derives edge drops.** The minimal shared contract is the superseded-node set; edge filtering by missing endpoint is applied per surface because each has its own edge model (ReactFlow edges, Cytoscape elements, DOM mirror rows). A combined nodes+edges return was considered and left as implementer latitude only if it falls out naturally — the node set is the pinned contract.
- **methodology-full-flow is retargeted, not trimmed.** Each post-commit phase pins a distinct seam (axiom-mark, split, annotate, edit-wording); the rework keeps every seam pinned but against methodology-legal targets. The old "keep right-clicking N1 after its decompose committed" contract was itself the conformance bug — the spec's own Phase 8.1 comment concedes the server likely rejects the action. Deleting phases instead would shrink coverage; keeping them against N1 is impossible once the parent hides.
- **Remove the dead `decomposed` fade seam in `graph-view` during the refactor.** The `decomposed?: boolean` field (L271) and `node[?decomposed]` stylesheet arm (L347–350) were never stamped and encode a fade-out treatment the docs don't describe — the docs say *removed*, and the projector already removes. A commit-moment transition animation is presentational polish, out of scope here; resurrecting it later is a fresh decision against the then-current renderer.

## Open questions

(none — all decided)

## Status

**Done** — 2026-06-11.

- Extracted `computeSupersededNodeIds` pure helper to `packages/shell/src/supersession/` (new files: `supersession.ts`, `supersession.test.ts`, `index.ts`); exported via `packages/shell/src/index.ts`.
- Moderator canvas projector (`apps/moderator/src/graph/GraphCanvasPane.tsx`, `selectors.ts`) wired to drop superseded nodes and their incident edges.
- Participant projector (`apps/participant/src/graph/projectGraph.ts`) wired to drop superseded nodes and their incident edges.
- `packages/graph-view/src/projectGraph.ts` refactored onto the shared helper (no behavior change); dead `decomposed` fade seam removed from `GraphView.tsx`, `stylesheet.ts`, `overlays.css`, and deleted `DecompositionFadeOverlay.tsx` + `DecompositionFadeOverlay.test.tsx`.
- Vitest suites: shell helper (6 cases: three superseding kinds, pending, withdrawn, prefix stability); moderator projector (4 new cases: superseded-parent filtering + superseded-endpoint filtering incl. ADR 0046 inherited-edge survival); participant projector (3 new cases incl. mirror-source + inherited-edge pins); graph-view suite stayed green unmodified through the extraction.
- E2e: `tests/e2e/full-session-walkthrough.spec.ts` AC-5b deferral block replaced with live N14 parent-removal assertion; `tests/e2e/methodology-full-flow.spec.ts` Phases 6.2–11.x retargeted away from superseded N1 (N1 asserted absent after decompose commit on alice's canvas + ben's mirror + panel auto-clear).
- ADR 0047 written (`docs/adr/0047-parent-supersession-client-derived-from-commit.md`); amendment entry appended to ADR 0027.
