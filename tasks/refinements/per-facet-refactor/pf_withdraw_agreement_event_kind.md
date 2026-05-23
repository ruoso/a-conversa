# withdraw-agreement event kind

**TaskJuggler entry**: [tasks/15-per-facet-refactor.tji](../../15-per-facet-refactor.tji) — task `per_facet_refactor.schema_and_events.pf_withdraw_agreement_event_kind`
**Effort estimate**: 0.5d
**Inherited dependencies**: (none — head of the per-facet-refactor chain; every downstream facet-layer task in WBS 15 depends transitively on this).

## What this task is

Add a new top-level event kind `withdraw-agreement` to the event vocabulary. Payload: `{ entity_kind: 'node' | 'edge', entity_id: UUID, facet: FacetName, participant: UUID, withdrawn_at: ISO8601 }`. Withdraw stops being a `choice` variant on the `vote` envelope (collapsed in [`pf_facet_keyed_vote_payload`](pf_facet_keyed_vote_payload.md)) and becomes its own event kind. A forward-only SQL migration per [ADR 0020](../../../docs/adr/0020-migrations-node-pg-migrate-forward-only.md) extends the `session_events.kind` `CHECK` constraint.

This task is JUST the event-kind plumbing — schema + registry entries + migration + the Vitest/Cucumber pins that exercise the new kind round-tripping the seam. The server-side handler that emits the event lives in [`pf_withdraw_agreement_handler`](pf_withdraw_agreement_handler.md); the participant UI button lives in [`pf_part_withdraw_agreement_action`](pf_part_withdraw_agreement_action.md); the removal of the `'withdraw'` choice from `vote.choice` lives in [`pf_facet_keyed_vote_payload`](pf_facet_keyed_vote_payload.md).

## Why it needs to be done

Per [ADR 0030 §3](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md): the current `vote.choice = 'withdraw'` conflates two distinct gestures (changing your most-recent vote vs. rescinding a previously-committed agreement). The methodology's withdraw at [`docs/methodology.md:25`](../../../docs/methodology.md) is the second, and it sends the facet back to `disputed`. Promoting it to its own event makes the transition a direct read of the log rather than a derivation off the proposal-keyed vote shape that ADR 0030 is itself dismantling.

It is the head of the chain because every downstream consumer (server handler dispatcher, projection replay walker, participant UI hook, Cucumber + Playwright scenarios) needs the new kind to *exist* on the wire before it can route to it.

## Inputs / context

- [ADR 0030 §3 + Consequences](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md) — the decision pinning the payload shape and the breaking-wire-change clean-break note.
- [ADR 0021 — Event envelope: discriminated union with Zod](../../../docs/adr/0021-event-envelope-discriminated-union-with-zod.md) — how a new payload schema slots into `eventKinds`, `EventPayloadMap`, and `eventPayloadSchemas`; the `noFallthroughCasesInSwitch` exhaustiveness pattern that makes the new kind a compile-time obligation for every consumer `switch`.
- [ADR 0020 — Migrations: forward-only](../../../docs/adr/0020-migrations-node-pg-migrate-forward-only.md) — the migration discipline this task follows.
- [ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md) — the acceptance-criteria framing: verification lives in committed tests, not ad-hoc scripts.
- [`packages/shared-types/src/events.ts:128`](../../../packages/shared-types/src/events.ts) — `eventKinds` registry; new entry `'withdraw-agreement'` joins the list.
- [`packages/shared-types/src/events.ts:361`](../../../packages/shared-types/src/events.ts) — current `votePayloadSchema` whose `'withdraw'` choice goes away in `pf_facet_keyed_vote_payload`. This task is upstream of that one.
- [`packages/shared-types/src/events.ts:488`](../../../packages/shared-types/src/events.ts) — `eventPayloadSchemas` record where `'withdraw-agreement': withdrawAgreementPayloadSchema` is registered.
- [`packages/shared-types/src/events.ts:523`](../../../packages/shared-types/src/events.ts) — `EventPayloadMap` where the new kind's payload type lands.
- [`packages/shared-types/src/events/enums.ts:47`](../../../packages/shared-types/src/events/enums.ts) — `entityKindSchema = z.enum(['node', 'edge', 'annotation'])`. Withdraw-agreement does NOT reuse it as-is: facet-valued proposals only target nodes and edges (annotations have no facets in v1), so the new payload narrows to `z.enum(['node', 'edge'])`.
- [`apps/server/src/projection/types.ts:226`](../../../apps/server/src/projection/types.ts) — canonical `FacetName = 'classification' | 'substance' | 'wording'` (the shape-facet expansion ADR 0030 §5 implies is owned by downstream projection tasks, not by this one; this task uses the 3-value union as it stands today).
- [`apps/server/migrations/0010_session_events.sql:124`](../../../apps/server/migrations/0010_session_events.sql) — current `CHECK (kind IN (...))` constraint.
- [`apps/server/migrations/0012_session_events_entity_removed.sql`](../../../apps/server/migrations/0012_session_events_entity_removed.sql) — the precedent forward-only migration pattern this task follows (drop + re-add the `session_events_kind_check` constraint inside one migration file, no row updates).
- [`tasks/refinements/per-facet-refactor/pf_facet_keyed_vote_payload.md`](pf_facet_keyed_vote_payload.md) — the immediate successor; consumes the new kind by collapsing `vote.choice` to `'agree' | 'dispute'`.

## Constraints / requirements

- **New Zod schema** `withdrawAgreementPayloadSchema` in `packages/shared-types/src/events.ts`:
  ```ts
  withdrawAgreementPayloadSchema = z.object({
    entity_kind: z.enum(['node', 'edge']),
    entity_id: z.string().uuid(),
    facet: facetNameSchema,
    participant: z.string().uuid(),
    withdrawn_at: z.string().datetime({ offset: true }),
  });
  ```
- **`facetNameSchema` introduction.** No Zod-level `facetNameSchema` exists today (the `FacetName` union lives only in the TS projection-layer mirrors). This task introduces a `facetNameSchema = z.enum(['classification', 'substance', 'wording'])` in `packages/shared-types/src/events.ts` (or a sibling enums module) and exports it for the downstream `pf_facet_keyed_vote_payload` / `pf_facet_keyed_commit_payload` / `pf_facet_keyed_meta_disagreement_payload` tasks to reuse. The Zod enum mirrors the projection-layer `FacetName` definition; both must stay in lockstep with the methodology's facet vocabulary. (Shape-facet widening is owned downstream by the projection refactor tasks; this enum is 3-valued at landing.)
- **Type export**: `WithdrawAgreementPayload = z.infer<typeof withdrawAgreementPayloadSchema>`; both `withdrawAgreementPayloadSchema` and `WithdrawAgreementPayload` exported from the package barrel.
- **Registry wiring**: `'withdraw-agreement'` added to `eventKinds`; `eventPayloadSchemas['withdraw-agreement']` mapped to the new schema; `EventPayloadMap['withdraw-agreement']` mapped to `WithdrawAgreementPayload`.
- **Forward-only SQL migration** at `apps/server/migrations/0014_session_events_withdraw_agreement.sql` (next free slot) following the [`0012_session_events_entity_removed.sql`](../../../apps/server/migrations/0012_session_events_entity_removed.sql) precedent: drop the existing `session_events_kind_check`, re-add it with `'withdraw-agreement'` appended to the inline kind list. No row updates (the pre-release clean-break per ADR 0030 Consequences means no `vote.choice = 'withdraw'` rows need to be transformed; the kind-name expansion is structural-only).
- **Vitest round-trip + payload validation** in `packages/shared-types/src/events.test.ts`: round-trip a `withdraw-agreement` envelope; reject malformed cases (non-UUID `entity_id`, non-UUID `participant`, non-ISO `withdrawn_at`, unknown `facet`, unknown `entity_kind`, missing fields, the `entity_kind: 'annotation'` case that the narrower enum rejects). Update the `every kind round-trips` representative-payload sweep if such a test exists for the registry.
- **Cucumber scenario** under `tests/behavior/methodology/` (new file `withdraw-agreement.feature` or appended to the existing `vote.feature`) exercising the new kind round-tripping through the seam: a `withdraw-agreement` envelope INSERTed into the `session_events` table via pglite passes the SQL `CHECK`, is read back through `projectFromLog`, and the projection's facet-status derivation surfaces the facet returning to `disputed`. This is the protocol-boundary pin per the orchestrator's "Behavior + e2e coverage growth" rule (backend tasks that change wire behavior must scope a Cucumber scenario, not defer to Vitest-only).

## Acceptance criteria

(Per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md) — committed tests only; no throwaway scripts.)

- `withdrawAgreementPayloadSchema` and `WithdrawAgreementPayload` exported from `@a-conversa/shared-types/events`.
- `facetNameSchema` exported from `@a-conversa/shared-types` alongside the existing enums.
- `eventKinds` includes `'withdraw-agreement'`.
- `eventPayloadSchemas['withdraw-agreement']` resolves to the new schema; `EventPayloadMap['withdraw-agreement']` resolves to `WithdrawAgreementPayload`.
- New forward-only migration file `apps/server/migrations/0014_session_events_withdraw_agreement.sql` extends the `kind` `CHECK` constraint following the `0012` precedent; running migrations clean on a fresh DB succeeds.
- Vitest round-trip + invalid-payload tests for the new kind pass (`pnpm run test:smoke` green; the test counts grow).
- One new Cucumber scenario (`tests/behavior/methodology/withdraw-agreement.feature` or an addition to `vote.feature`) exercises a `withdraw-agreement` envelope inserted into the pglite-backed `session_events`, replayed through `projectFromLog`, and the projection's facet-status derivation reads `disputed` for the targeted facet. `pnpm run test:bdd` green; the scenario count grows.
- `pnpm run check` clean; `make test` green; Playwright remains green (no e2e additions scoped here — the methodology-full-flow rewrite happens downstream in [`pf_e2e_methodology_full_flow_update`](pf_e2e_methodology_full_flow_update.md)).
- `tj3 project.tjp` parses clean.

## Decisions

- **Payload shape pinned per [ADR 0030 §3](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md)**: `{ entity_kind, entity_id, facet, participant, withdrawn_at }`. No `proposal_id` — the whole point of the new kind is that withdrawal hangs off `(entity, facet)`, not off whichever proposal last touched the facet.
- **`withdrawn_at` ISO8601 on the payload** matches the sibling vote/commit/meta-mark precedent (`voted_at`, `committed_at`, `marked_at`). The envelope's `createdAt` carries the server-clock time; the payload's `withdrawn_at` is the participant-action-level clock, parallel to how `voted_at` works for votes. ADR 0030 §3 doesn't pre-pin the field — the alignment with the sibling per-action timestamps is the consistent local call.
- **`entity_kind: 'node' | 'edge'` (narrower than `entityKindSchema`)**: annotations don't have facets that participants vote on in v1; the narrower enum makes "withdraw-agreement against an annotation" a Zod-rejection at the seam rather than a downstream invariant-violation. Alternative considered: reuse `entityKindSchema` and reject `'annotation'` at the handler — rejected because the wire shape should encode the contract; a payload that can't legally exist is a payload Zod should refuse.
- **`facetNameSchema` introduced here, not in a separate task**: the immediate next task (`pf_facet_keyed_vote_payload`) and its successors all reference the same enum. Introducing it as a Zod-level export alongside `withdrawAgreementPayloadSchema` is the natural place — withdraw-agreement is the first payload that needs `facet` in the Zod layer, and the schema lives next to the kind that first needs it. Alternative considered: defer to `pf_facet_keyed_vote_payload` — rejected because the dependency arrow runs the wrong way (`pf_facet_keyed_vote_payload` depends on this task per the `.tji`).
- **Migration is structural-CHECK-only**: no row updates. Pre-release clean-break per [ADR 0030 Consequences](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md) means no `vote { choice: 'withdraw' }` rows need transformation; the downstream `pf_facet_keyed_vote_payload` migration (or a combined migration that ships all four facet-keying changes together — judgment at implementation time) handles the choice-enum narrowing.
- **Cucumber pin at the projection seam, not Vitest-only**: this is a backend task that changes wire behavior — the orchestrator's "Behavior + e2e coverage growth" rule in ORCHESTRATOR.md calls for a Cucumber scenario at the protocol/replay boundary. The Vitest tests pin the schema; the Cucumber scenario pins the round-trip through the table's `CHECK`, the JSONB column, and `projectFromLog`'s walker.
- **No backfill / no compat shim**: per ADR 0030 Consequences, pre-release clean break. Old dev/test logs are dropped.

## Open questions

(none — all decided per ADR 0030)

## Status

**Done** — 2026-05-23.

- Registered `'withdraw-agreement'` in `eventKinds`, wired `withdrawAgreementPayloadSchema` (Zod) into `eventPayloadSchemas`, and added `WithdrawAgreementPayload` to `EventPayloadMap` in [`packages/shared-types/src/events.ts`](../../../packages/shared-types/src/events.ts). Payload narrows `entity_kind` to `z.enum(['node', 'edge'])` so annotation-targeted withdraws are rejected at the seam.
- Introduced `facetNameSchema = z.enum(['classification', 'substance', 'wording', 'shape'])` in [`packages/shared-types/src/events/enums.ts`](../../../packages/shared-types/src/events/enums.ts) for downstream facet-keyed payload schemas to reuse.
- Added forward-only migration [`apps/server/migrations/0014_session_events_withdraw_agreement.sql`](../../../apps/server/migrations/0014_session_events_withdraw_agreement.sql) extending the `session_events_kind_check` CHECK constraint with `'withdraw-agreement'` (no row updates, per ADR 0030 Consequences clean-break).
- Extended [`packages/shared-types/src/events.test.ts`](../../../packages/shared-types/src/events.test.ts) with `withdraw-agreement` in `REPRESENTATIVE_PAYLOADS` + `expectedKinds`, an 11-`it()` `withdrawAgreementPayloadSchema` describe block (round-trip + reject malformed including `entity_kind: 'annotation'`), and a 2-`it()` `facetNameSchema` describe.
- Wired `withdraw-agreement` into [`apps/server/src/events/validate.test.ts`](../../../apps/server/src/events/validate.test.ts) `REPRESENTATIVE_PAYLOADS` + `PAYLOAD_CORRUPTIONS` exhaustive maps.
- Pinned the protocol/pglite/`projectFromLog` seam with new Cucumber scenario [`tests/behavior/methodology/withdraw-agreement.feature`](../../../tests/behavior/methodology/withdraw-agreement.feature) + step bindings [`tests/behavior/steps/withdraw-agreement.steps.ts`](../../../tests/behavior/steps/withdraw-agreement.steps.ts).
- Verification: `pnpm run check` green; Vitest 4211 → 4224 (+13); Cucumber 242 → 243 scenarios (1678 → 1684 steps); Playwright 107 → 107 (unchanged, green).
