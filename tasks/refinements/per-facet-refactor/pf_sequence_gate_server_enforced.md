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
