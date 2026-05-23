# Facet-keyed meta-disagreement-marked handler

**TaskJuggler entry**: [tasks/15-per-facet-refactor.tji](../../15-per-facet-refactor.tji) — task `per_facet_refactor.server_handlers.pf_meta_disagreement_handler_facet_keyed`
**Effort estimate**: 0.5d
**Inherited dependencies**: `pf_facet_keyed_meta_disagreement_payload`, `pf_projection_facet_status_refactor`, `pf_projection_replay_updates`.

## What this task is

Rewrite the WS `meta-disagreement-marked` handler at `apps/server/src/ws/handlers/meta-disagreement.ts` to accept the new payload shape. Dispatch by `payload.target`:

- Facet target: resolve `(entity_kind, entity_id, facet)`; mark the facet's `FacetState.metaDisagreement = true` (via the projection's walker arm); append the event.
- Proposal target: existing structural-meta-mark path (resolved per `pf_structural_handlers_unchanged`).

Actor authorization: moderator only.

## Why it needs to be done

Meta-disagreement is the methodology's escape hatch when participants can't resolve a facet through ordinary voting / diagnostics / decomposition. Per [ADR 0030 §2 + §9](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md) the facet-target branch is new; the structural-target branch is preserved.

## Inputs / context

- [ADR 0030 §2, §9](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md).
- [`apps/server/src/ws/handlers/`](../../../apps/server/src/ws/handlers/) — current handler.
- `pf_facet_keyed_meta_disagreement_payload` (sibling) — the payload shape this handler consumes.
- [ADR 0029](../../../docs/adr/0029-protocol-rejection-policies.md) — typed error envelope.

## Constraints / requirements

- Dispatch by `payload.target`.
- Facet branch: facet must exist; facet's current derived status must be `'disputed'` (you mark a meta-disagreement on a stuck dispute, not on an `agreed` / `committed` / `awaiting-proposal` facet). Other statuses are rejected with a typed error.
- Proposal branch: existing referential check.
- Moderator-only authorization.
- On accept: append the event; the projection sets `FacetState.metaDisagreement = true`.
- On reject: typed `error` envelope; connection stays open.
- Vitest cases at `apps/server/src/ws/handlers/meta-disagreement.test.ts` cover each branch + each rejection path.
- At least one Cucumber + pglite scenario covers the facet-target accept path end-to-end.

## Acceptance criteria

- Handler accepts new payload; dispatches by `target`.
- Facet-not-disputed rejection works.
- Vitest + Cucumber suites cover the new branch.
- `pnpm run test:smoke` green; `pnpm run test:behavior:smoke` green; `make test` green; `tj3 project.tjp` parses clean.

## Decisions

- **Disputed-only gate.** Marking meta-disagreement on a non-disputed facet doesn't match the methodology's contract; the rejection path makes the gate explicit.
- **`metaDisagreement` is a boolean on the facet**, not a separate event-log walk. The walker's `handleMetaDisagreementMarked` flips the boolean; the derivation reads it as the top-priority rule.

## Open questions

(none — all decided per ADR 0030)
