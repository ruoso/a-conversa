# withdraw-agreement event kind

**TaskJuggler entry**: [tasks/15-per-facet-refactor.tji](../../15-per-facet-refactor.tji) — task `per_facet_refactor.schema_and_events.pf_withdraw_agreement_event_kind`
**Effort estimate**: 0.5d
**Inherited dependencies**: (none — first in the chain; everything else depends on this)

## What this task is

Add a new top-level event kind `withdraw-agreement` to the event vocabulary. Payload: `{ entity_kind, entity_id, facet, participant }`. Withdraw stops being a `choice` variant on the `vote` envelope (handled by `pf_facet_keyed_vote_payload`) and becomes its own event kind. The SQL `CHECK` constraint on `session_events.kind` is updated via a forward-only migration per [ADR 0020](../../../docs/adr/0020-migrations-node-pg-migrate-forward-only.md).

## Why it needs to be done

Per [ADR 0030 §3](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md): the current `vote.choice = 'withdraw'` conflates two distinct gestures (changing your most-recent vote vs. rescinding a previously-committed agreement). The methodology's withdraw at [`docs/methodology.md:25`](../../../docs/methodology.md) is the second, and it sends the facet back to `disputed`. Promoting it to its own event makes the transition a direct read of the log rather than a derivation. Every downstream handler / projection / UI consumer needs the new event kind to exist before it can route to it.

## Inputs / context

- [ADR 0030 §3 + Consequences](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md) — the decision and the breaking-wire-change note.
- [`packages/shared-types/src/events.ts:128`](../../../packages/shared-types/src/events.ts) — `eventKinds` registry. New entry `'withdraw-agreement'` joins the list.
- [`packages/shared-types/src/events.ts:361`](../../../packages/shared-types/src/events.ts) — current `votePayloadSchema` carries `'withdraw'` in its `choice` enum; that goes away in `pf_facet_keyed_vote_payload`. This task is upstream of that one — it adds the new kind before the old shape collapses.
- [`apps/server/migrations/0010_session_events.sql:118-160`](../../../apps/server/migrations/0010_session_events.sql) — the SQL `CHECK` constraint enumerating every valid `kind`. A forward-only migration adds `'withdraw-agreement'`.
- [ADR 0020 — Migrations: forward-only](../../../docs/adr/0020-migrations-node-pg-migrate-forward-only.md) — the migration discipline this task follows.
- [ADR 0021 — Event envelope: discriminated union with Zod](../../../docs/adr/0021-event-envelope-discriminated-union-with-zod.md) — how the new payload schema slots into `EventPayloadMap` and `eventPayloadSchemas`.

## Constraints / requirements

- New Zod schema `withdrawAgreementPayloadSchema = z.object({ entity_kind: z.enum(['node', 'edge', 'annotation']), entity_id: UUID, facet: facetNameSchema, participant: UUID })`. `facetNameSchema` is the existing union of facet names (`'wording' | 'classification' | 'substance' | 'shape'`).
- New `'withdraw-agreement'` entry in `eventKinds`, `EventPayloadMap`, `eventPayloadSchemas`.
- Type export: `WithdrawAgreementPayload = z.infer<typeof withdrawAgreementPayloadSchema>`.
- Forward-only SQL migration (next number — `0014_session_events_withdraw_agreement.sql` or similar) adds `'withdraw-agreement'` to the `CHECK (kind IN (...))` constraint via `ALTER TABLE session_events DROP CONSTRAINT … ADD CONSTRAINT … CHECK …`. The migration is structural-only (no row updates) since the pre-release clean-break policy means no rows exist with the old shape.
- Vitest round-trip test in `packages/shared-types/src/events.test.ts` covering the new shape and rejecting malformed payloads.

## Acceptance criteria

- `withdrawAgreementPayloadSchema` exported from `@a-conversa/shared-types/events` and registered in `eventPayloadSchemas['withdraw-agreement']`.
- `eventKinds` includes `'withdraw-agreement'`.
- New migration file under `apps/server/migrations/` extending the `kind` CHECK.
- `pnpm run test:smoke` green; `make test` green.
- `tj3 project.tjp` parses clean.

## Decisions

- **Payload shape pinned** per [ADR 0030 §3](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md): `{ entity_kind, entity_id, facet, participant }`. No `proposal_id`. No timestamp on the payload — the envelope's `created_at` carries that.
- **Clean break** per ADR 0030 Consequences: no backfill / no compat shim. Pre-release dev/test logs are dropped.
- **Migration sequencing**: this is a structural-CHECK update only. The old `vote.choice = 'withdraw'` value goes away in `pf_facet_keyed_vote_payload`; that task ships its own migration or rolls into a single combined migration with `pf_facet_keyed_vote_payload` / `pf_facet_keyed_commit_payload` / `pf_facet_keyed_meta_disagreement_payload` — judgment call to be made at implementation time (a single combined migration is simpler since they all ship together; the task ordering allows either).

## Open questions

(none — all decided per ADR 0030)
