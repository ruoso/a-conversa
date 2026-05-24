# Server-enforced sequence gate

**TaskJuggler entry**: [tasks/15-per-facet-refactor.tji](../../15-per-facet-refactor.tji) — task `per_facet_refactor.server_handlers.pf_sequence_gate_server_enforced`
**Effort estimate**: 1d
**Inherited dependencies**: `pf_projection_facet_status_refactor`, `pf_capture_emits_inline_wording_only`.

## What this task is

Add a precondition check inside the propose handler that refuses out-of-sequence facet-valued proposals:

- A `classify-node` proposal is refused while the target node's `wording` facet is not `agreed` or `committed`.
- A `set-node-substance` proposal is refused while the target node's `classification` facet is not `agreed` or `committed`.
- A `set-edge-substance` proposal is refused while the target edge's `shape` facet is not `agreed` or `committed`.

Refusal returns a typed `error` envelope (per the existing wire error pattern); the connection stays open per the [ADR 0029](../../../docs/adr/0029-protocol-rejection-policies.md) invariant.

## Why it needs to be done

Per [ADR 0030 §8](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md): "The server enforces the sequence at the wire. … UI hides are correct UX but cannot be the integrity boundary, because a misbehaving client (or a stale moderator session, or a future automation) must not be able to land out-of-sequence facet proposals." The UI surface (in `pf_mod_node_card_classification_affordance` and friends) mounts affordances only when the predecessor facet is agreed, but a hand-crafted wire message or a stale client could bypass that. The server is the integrity boundary.

## Inputs / context

- [ADR 0030 §8 + Consequences](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md).
- [ADR 0029 — protocol rejection policies](../../../docs/adr/0029-protocol-rejection-policies.md) — typed error envelope shape; connection stays open on rejection.
- [`apps/server/src/ws/handlers/propose.ts`](../../../apps/server/src/ws/handlers/propose.ts) — current propose handler dispatch; the new precondition lives here, alongside the existing methodology-engine `validateAction` call.
- [`apps/server/src/projection/facet-status.ts`](../../../apps/server/src/projection/facet-status.ts) — `deriveFacetStatus` is the predecessor-facet read the gate consults.
- [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md) — gate has unit tests + at least one Cucumber + pglite integration scenario.

## Constraints / requirements

- The gate runs BEFORE the methodology-engine validate call. The methodology engine assumes the wire-shape contract is honored; sequence enforcement is a wire-shape precondition.
- Refusal error code is typed (e.g. `'facet-sequence-out-of-order'`) with a message identifying the failing predecessor facet (`"classify-node refused: wording facet is 'proposed' (must be agreed or committed)"`). Per [ADR 0029](../../../docs/adr/0029-protocol-rejection-policies.md) — the `code` carries the structured fault, the `message` is the human-readable annotation.
- The gate is read-only against the projection — no state change on rejection.
- Vitest cases at `apps/server/src/ws/handlers/propose.test.ts` cover each of the three refused paths plus the symmetric "predecessor agreed → proposal accepted" path. A Cucumber + pglite scenario at `tests/behavior/server/` exercises the full reject-then-accept-after-predecessor-commit round.

## Acceptance criteria

- Propose handler refuses `classify-node` / `set-node-substance` / `set-edge-substance` proposals with a typed error envelope when the predecessor facet isn't `agreed` / `committed`.
- The refusal does not close the connection.
- Vitest + Cucumber suites cover the new gate.
- `pnpm run test:smoke` green; `pnpm run test:behavior:smoke` green; `make test` green; `tj3 project.tjp` parses clean.

## Decisions

- **Gate sits in the propose handler**, not in the methodology engine. The engine takes well-shaped input; sequence enforcement is the wire-layer's job.
- **`agreed` OR `committed`** is the accepting state for the predecessor. Both states mean "the candidate value is settled enough to anchor the next facet's work"; the methodology doesn't require `committed` specifically to advance.
- **Edit-wording is a special case** — it can be issued against a node whose wording is already `agreed` or `committed` (it proposes to change the agreed-upon value). It is not subject to the sequence gate; its presence here is acknowledged so reviewers don't read its absence as an oversight.

## Open questions

(none — all decided per ADR 0030)

## Status

**Done** — 2026-05-24.

- Propose handler now refuses out-of-sequence `classify-node` and `set-node-substance` proposals with the typed `'facet-sequence-out-of-order'` rejection per ADR 0030 §8; rejection maps to HTTP 422 in `apps/server/src/errors.ts` and propagates through the existing per-sub-kind dispatch ahead of the methodology-engine `validateAction` call. Connection stays open per ADR 0029.
- New `RejectionReason` value `'facet-sequence-out-of-order'` lands in `apps/server/src/methodology/types.ts` and exhaustive maps in `apps/server/src/errors.test.ts` + `apps/server/src/ws/protocol-docs.test.ts` were widened.
- `apps/server/src/projection/facet-status.ts` exports a new `deriveFacetStatusFromState` entry point (re-exported from `apps/server/src/projection/index.ts`) that the gate reads to resolve the predecessor facet from the projected state.
- The legacy `classify-node`-with-wording bundle is exempted with a `TODO(pf_mod_capture_pane_wording_only)` marker; structural and capture-node sub-kinds bypass the gate by design (see header docblock in `apps/server/src/methodology/handlers/propose.ts`).
- The `set-edge-substance` shape-facet arm of the gate is **deferred** — `facetNameSchema` in `packages/shared-types/src/events/enums.ts` is still 3-valued (no `'shape'`); the call site reads `ProjectedEdge.shapeFacet` for reference but does not reject. Follow-on task `pf_shape_facet_wire_vote` registered to close the gap.
- Vitest 4319 → 4332 (+13: 12 cases in new `apps/server/src/methodology/handlers/proposeSequenceGate.test.ts` + 1 legacy-bundle exemption smoke). Cucumber 259 → 260 scenarios / 1773 → 1787 steps (new `tests/behavior/backend/ws-propose.feature` scenario + `tests/behavior/steps/backend-ws-propose.steps.ts`). Playwright 107 → 107 (unchanged, green incl. methodology-full-flow Phases 1–12).
- TODOs added: 1 new `TODO(pf_shape_facet_wire_vote)`. TODOs paid down: 0.
