# Facet-keyed commit handler

**TaskJuggler entry**: [tasks/15-per-facet-refactor.tji](../../15-per-facet-refactor.tji) — task `per_facet_refactor.server_handlers.pf_commit_handler_facet_keyed`
**Effort estimate**: 0.5d
**Inherited dependencies**: `pf_facet_keyed_commit_payload`, `pf_projection_facet_status_refactor`, `pf_projection_replay_updates`, `pf_vote_handler_facet_keyed`.

## What this task is

Rewrite the WS `commit` handler at `apps/server/src/ws/handlers/commit.ts` to accept the new payload shape. Dispatch by `payload.target`:

- Facet target: resolve `(entity_kind, entity_id, facet)` to a `FacetState`. Check unanimous-agree: every current participant has a most-recent `'agree'` vote in `FacetState.perParticipant`. If yes, append a `commit` event.
- Proposal target: existing structural-commit path (resolved per `pf_structural_handlers_unchanged`).

The actor must be the session's moderator.

## Why it needs to be done

A commit's wire shape and unanimity check are the wire-layer surface for the methodology's "agreed and committed" gate. Per [ADR 0030 §2 + §9](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md) the facet branch is new; the structural branch is preserved. Without this task, facet-target commits can't land.

## Inputs / context

- [ADR 0030 §2, §9 + Consequences](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md).
- [`apps/server/src/ws/handlers/commit.ts`](../../../apps/server/src/ws/handlers/commit.ts) — current commit handler.
- `pf_facet_keyed_commit_payload`, `pf_vote_handler_facet_keyed` (siblings) — payload + sibling-handler shapes this handler reads against.
- [ADR 0029](../../../docs/adr/0029-protocol-rejection-policies.md) — typed error envelope for rejections.

## Constraints / requirements

- Dispatch by `payload.target`. Strict separation between branches.
- Facet-target unanimity check: enumerate current participants (`leftAt === null`); each must have a most-recent `'agree'` vote in `FacetState.perParticipant`. If any participant has no vote, has a `'dispute'` vote, or is in `FacetState.withdrawals`, the commit is refused.
- Facet-target additional checks: facet must currently be `'agreed'` per `deriveFacetStatus` (this is the same condition as the unanimity check but uses the derived status for the read). The redundancy is intentional — the unanimity check is the operational gate; `deriveFacetStatus === 'agreed'` is the cross-check.
- Moderator-only authorization stays.
- On accept: append a `commit` event with the facet-target payload; the projection's `handleCommit` writes `committedAt` + `committedCandidateValue` on the `FacetState`.
- On reject: typed `error` envelope; connection stays open.
- Vitest cases at `apps/server/src/ws/handlers/commit.test.ts` cover the unanimity-met / unanimity-not-met / facet-not-agreed / target-discriminator-malformed paths.
- At least one Cucumber + pglite scenario covers the facet-target accept path end-to-end.

## Acceptance criteria

- Commit handler accepts the new payload; dispatches by `target`.
- Facet-target unanimity gate is enforced; commits against not-yet-unanimous facets are refused.
- Vitest + Cucumber suites cover the new branch.
- `pnpm run test:smoke` green; `pnpm run test:behavior:smoke` green; `make test` green; `tj3 project.tjp` parses clean.

## Decisions

- **Unanimity check reads `perParticipant`** rather than `deriveFacetStatus` exclusively. The derived status is a useful cross-check (and reads cleaner in error messages) but the gate's primary read is the raw map so the rejection can say which participant blocked.
- **No vote-change-window logic in this handler.** The methodology engine owns "is the current vote state stable enough to commit"; this handler is wire-shape + authorization + unanimity.

## Open questions

(none — all decided per ADR 0030)
