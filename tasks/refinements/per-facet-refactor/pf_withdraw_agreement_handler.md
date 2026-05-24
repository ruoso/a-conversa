# withdraw-agreement WS handler

**TaskJuggler entry**: [tasks/15-per-facet-refactor.tji](../../15-per-facet-refactor.tji) — task `per_facet_refactor.server_handlers.pf_withdraw_agreement_handler`
**Effort estimate**: 0.5d
**Inherited dependencies**: `pf_withdraw_agreement_event_kind`, `pf_projection_facet_status_refactor`, `pf_projection_replay_updates`, `pf_commit_handler_facet_keyed`.

## What this task is

Add a new WS handler at `apps/server/src/ws/handlers/withdraw-agreement.ts` for the new `withdraw-agreement` event kind. The handler resolves `(entity_kind, entity_id, facet)`, validates that the participant has a prior `'agree'` vote on a committed facet, and appends a `withdraw-agreement` event on accept. Reject with a typed `error` envelope otherwise.

The participant whose withdrawal it is must be a current participant. The actor on the envelope must match the participant in the payload (a participant can only withdraw their own agreement).

## Why it needs to be done

`withdraw-agreement` is a new event kind per [ADR 0030 §3](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md). Every event kind on the wire needs a handler; without this task, the kind is parsed by the schema but no append path exists.

## Inputs / context

- [ADR 0030 §3 + Consequences](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md).
- `pf_withdraw_agreement_event_kind` (settles the wire shape).
- [`apps/server/src/ws/handlers/`](../../../apps/server/src/ws/handlers/) — sibling handlers for shape reference.
- [ADR 0029](../../../docs/adr/0029-protocol-rejection-policies.md) — typed error envelope.

## Constraints / requirements

- Handler validates: entity exists; facet is applicable; `FacetState.committedAt !== null` (the facet must currently be committed for a withdrawal to be meaningful); participant has a prior `'agree'` vote in `FacetState.perParticipant`; the envelope actor matches the payload participant.
- On accept: append a `withdraw-agreement` event. The projection's `handleWithdrawAgreement` writes the participant into `FacetState.withdrawals`; `deriveFacetStatus` returns `'withdrawn'` on the next read.
- On reject: typed `error` envelope (codes: `'facet-not-committed'`, `'no-prior-agree'`, `'actor-mismatch'`, `'participant-not-current'`); connection stays open.
- Vitest cases at `apps/server/src/ws/handlers/withdraw-agreement.test.ts` cover each accept + reject path.
- At least one Cucumber + pglite scenario in `tests/behavior/server/` covers the round-trip (commit a facet, withdraw, status → `withdrawn`).

## Acceptance criteria

- Handler exists; routes to the projection's new walker arm.
- Validation rules are enforced; each rejection path returns a distinct typed error code.
- Vitest + Cucumber suites cover the new handler.
- `pnpm run test:smoke` green; `pnpm run test:behavior:smoke` green; `make test` green; `tj3 project.tjp` parses clean.

## Decisions

- **Withdraw only against committed.** Per [ADR 0030 §3](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md), withdraw is the gesture that returns the facet to `disputed`; the gesture only makes sense against a committed facet. A vote-change against an uncommitted-but-agreed facet uses the regular `vote` event with `choice: 'dispute'`.
- **Actor === participant.** A participant withdraws their own prior agreement only. The moderator does not withdraw on behalf of debaters.
- **Withdraw is idempotent at the projection level** — the `withdrawals` set's add is a set add; double-withdraws are no-ops in the projection. The handler accepts a second withdrawal (it appends the event for the historical record) but the projection state doesn't drift.

## Open questions

(none — all decided per ADR 0030)

## Status

**Done** — 2026-05-23.

- Dedicated WS handler at `apps/server/src/ws/handlers/withdraw-agreement.ts` — separate from `withdraw-proposal` (post-commit participant rescind vs. pre-commit proposer cancel). Validates payload via `withdrawAgreementPayloadSchema`; broadcasts an `agreement-withdrawn` ack on success.
- Predicates: actor-must-match-participant, facet-must-be-committed (`agreed`/`committed` status), prior-`agree`-required on the facet, target-entity-must-exist, participant-must-be-active. Typed wire-error codes: `forbidden`, `inapplicable-to-facet`, `no-prior-agree`, `target-entity-not-found`, `not-a-participant`, `sequence-mismatch`.
- Projection-side `handleWithdrawAgreement` already landed in `pf_projection_facet_status_refactor` — this task wired the inbound path so `deriveFacetStatus` flips the facet back to `disputed` on the next read.
- Shared-types envelope: added `withdraw-agreement` + `agreement-withdrawn` to `wsMessageTypes`, payload schemas, registry, and type-map (`packages/shared-types/src/ws-envelope.ts` + `.test.ts`); `docs/ws-protocol.md` updated with catalog entries for both wire messages.
- Un-skipped the two skips carried since `pf_facet_keyed_vote_payload` (commit `a2521f6`): vote handler's deprecated withdrawal-via-vote test rewritten against the new event kind; participant `ownVotes` test rewritten to pin that `withdraw-agreement` is silently dropped by the vote-only own-vote projector and the prior `agree` indicator persists.
- Tests: 9 new Vitest cases in `withdraw-agreement.test.ts` (each accept + reject path); +1 Cucumber lifecycle scenario in `tests/behavior/methodology/withdraw-agreement.feature` (commit → withdraw → `deriveFacetStatus === 'disputed'`); supporting steps in `tests/behavior/steps/withdraw-agreement.steps.ts`.
- Gates: `pnpm run check` green; Vitest 4314 / 0 skipped (+11, -2 skipped); Cucumber 256 scenarios / 1761 steps (+1 / +6); Playwright 107 green. `tj3 project.tjp` parses clean.
