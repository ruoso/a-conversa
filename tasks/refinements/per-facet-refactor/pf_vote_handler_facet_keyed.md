# Facet-keyed vote handler

**TaskJuggler entry**: [tasks/15-per-facet-refactor.tji](../../15-per-facet-refactor.tji) — task `per_facet_refactor.server_handlers.pf_vote_handler_facet_keyed`
**Effort estimate**: 0.5d
**Inherited dependencies**: `pf_facet_keyed_vote_payload`, `pf_projection_facet_status_refactor`, `pf_projection_replay_updates`.

## What this task is

Rewrite the WS `vote` handler at `apps/server/src/ws/handlers/vote.ts` to accept the new payload shape: facet-target votes resolve a `(entity_kind, entity_id, facet)` to a `FacetState`; proposal-target votes resolve a `proposal_id` to a pending or committed proposal record (existing path).

Validation:

- Facet target: the resolved facet must be in a votable status (`proposed` or `disputed`) — voting an already-`agreed` / `committed` / `awaiting-proposal` / `meta-disagreement` facet is refused with a typed error envelope. Voting `dispute` while not currently agreed is fine; voting `agree` while no candidate is set (`awaiting-proposal`) is refused.
- Proposal target: existing referential check (proposal exists and is pending or committed-and-currently-vulnerable-to-withdraw).

The participant whose vote it is must be a current participant of the session.

## Why it needs to be done

The wire shape changes per [ADR 0030 §2](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md); the handler is the wire-layer surface that consumes the new shape. Without this task, the new payload is parsed but never routed.

## Inputs / context

- [ADR 0030 §2 + Consequences](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md).
- [`apps/server/src/ws/handlers/vote.ts`](../../../apps/server/src/ws/handlers/vote.ts) — current vote handler.
- `pf_facet_keyed_vote_payload` (sibling) — the payload shape this handler consumes.
- [ADR 0029 — protocol rejection policies](../../../docs/adr/0029-protocol-rejection-policies.md) — typed error envelope shape for the rejection paths.
- [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md) — every code path here gets a Vitest case + at least one Cucumber + pglite integration scenario.

## Constraints / requirements

- Dispatch via the `payload.target` discriminator. Each branch validates separately.
- Facet-target validation rules: facet must exist (the entity exists and the facet is applicable to its kind); facet's derived status (via `deriveFacetStatus`) must permit votes. The set of votable statuses: `'proposed' | 'disputed'`. Voting `agree` against an `'awaiting-proposal'` facet is rejected ("no candidate to agree with"); voting against a `'committed'` facet uses the `withdraw-agreement` event kind instead.
- Proposal-target validation continues the existing flow (proposal exists, participant is current).
- On accept: append a `vote` event to the session log (the projection's `handleVote` writes the `perParticipant` map).
- On reject: typed `error` envelope; connection stays open.

## Acceptance criteria

- Vote handler accepts the new payload; dispatches by `target`.
- All four rejection paths (facet not votable, agree against awaiting-proposal, malformed target, participant not current) return typed error envelopes.
- Vitest cases at `apps/server/src/ws/handlers/vote.test.ts` cover each branch.
- At least one Cucumber + pglite scenario in `tests/behavior/server/` exercises the facet-target accept path round-trip.
- `pnpm run test:smoke` green; `pnpm run test:behavior:smoke` green; `make test` green; `tj3 project.tjp` parses clean.

## Decisions

- **`agree` against `awaiting-proposal` is refused**, not silently no-op'd. The methodology says "voting agrees with a candidate"; without a candidate, the gesture is ill-formed.
- **Vote against `meta-disagreement` is refused.** The facet is in an escape-hatch state; new votes don't change that state. The path out of meta-disagreement is structural (decompose, axiom-mark) per the methodology engine.
- **Vote handler does NOT enforce the sequence gate.** That gate is `pf_sequence_gate_server_enforced`'s territory and applies to `propose`. Votes naturally can only target facets that already have a candidate; the gate is irrelevant on this path.

## Open questions

(none — all decided per ADR 0030)
