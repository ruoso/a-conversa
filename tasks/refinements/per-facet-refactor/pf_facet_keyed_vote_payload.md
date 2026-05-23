# Facet-keyed vote payload

**TaskJuggler entry**: [tasks/15-per-facet-refactor.tji](../../15-per-facet-refactor.tji) — task `per_facet_refactor.schema_and_events.pf_facet_keyed_vote_payload`
**Effort estimate**: 0.5d
**Inherited dependencies**: `pf_withdraw_agreement_event_kind` (the `'withdraw'` choice on `vote` is removed; the new event kind for withdrawal must exist first).

## What this task is

Rewrite `votePayloadSchema` in `packages/shared-types/src/events.ts` to key votes by `(entity_kind, entity_id, facet)` instead of by `proposal_id`. The payload becomes `{ entity_kind, entity_id, facet, participant, choice: 'agree' | 'dispute', voted_at }`. Structural-proposal votes (decompose / interpretive-split / axiom-mark / annotate / meta-move / break-edge) need to retain the proposal-id-keyed shape per ADR 0030 §9 — this refinement decides the cleanest separation (discriminated-union split on `vote` or a separate event kind).

## Why it needs to be done

Per [ADR 0030 §2](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md): "Votes, commits, and meta-disagreement marks against facet-valued proposals are keyed by `(entity_kind, entity_id, facet)`." The current shape attaches the agreement state to whichever proposal happened to last touch a facet; the methodology treats agreement as a property of the facet itself. This is the wire-level realization of that decision; every server handler and every UI consumer reads the new shape.

## Inputs / context

- [ADR 0030 §2, §9](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md) — the facet-keyed envelope decision and the structural-vs-facet split.
- [`packages/shared-types/src/events.ts:361-368`](../../../packages/shared-types/src/events.ts) — current `votePayloadSchema = z.object({ proposal_id, participant, vote, voted_at })`.
- [`packages/shared-types/src/events/proposals.ts`](../../../packages/shared-types/src/events/proposals.ts) — proposal sub-kind discriminated union; the structural sub-kinds list is the source of truth for which votes stay proposal-keyed.
- [ADR 0021 — Event envelope: discriminated union with Zod](../../../docs/adr/0021-event-envelope-discriminated-union-with-zod.md) — pattern for Zod discriminated unions.
- [`tasks/refinements/data-and-methodology/vote_events.md`](../data-and-methodology/vote_events.md) — historical record of the prior shape (do not edit).

## Constraints / requirements

- The schema must encode the two patterns (facet-keyed vs. proposal-keyed) cleanly. Two viable shapes:
  - **(A) Discriminated-union on `vote`** — a single `vote` envelope whose payload is `z.discriminatedUnion('target', [facetTargetSchema, proposalTargetSchema])`. One event kind on the wire; payload discriminates by `target: 'facet' | 'proposal'`.
  - **(B) Two distinct event kinds** — `vote` becomes facet-only; a new `vote-structural` (or similar) carries the proposal-keyed shape.
  - Pick (A): keeps one event kind (`vote`); matches the precedent already established for `proposal` (one kind, payload-discriminated by `kind`); a single discriminator field on the payload is the lightest carriage for two coexisting shapes.
- `voted_at` ISO8601 stays on both branches.
- The `choice` enum drops `'withdraw'` (handled by `pf_withdraw_agreement_event_kind`) and collapses to `'agree' | 'dispute'` on both branches.
- For the facet branch: `{ target: 'facet', entity_kind, entity_id, facet, participant, choice, voted_at }`.
- For the proposal branch: `{ target: 'proposal', proposal_id, participant, choice, voted_at }`.
- Vitest tests in `packages/shared-types/src/events.test.ts` round-trip both branches; reject the absent-discriminator case and the cross-shape (facet fields on proposal-target) cases.

## Acceptance criteria

- `votePayloadSchema` exports the discriminated union; both `FacetVotePayload` and `ProposalVotePayload` types are inferred and exported.
- `eventPayloadSchemas['vote']` and `EventPayloadMap['vote']` resolve to the union.
- The existing `vote.choice = 'withdraw'` shape no longer parses (cleanup is the point — `pf_withdraw_agreement_event_kind` handles the gesture).
- `pnpm run test:smoke` green; `make test` green; `tj3 project.tjp` parses clean.

## Decisions

- **Single event kind, discriminated payload** (shape A above). Matches the established precedent for `proposal`; cleaner consumer ergonomics (one switch over `payload.target` inside the `vote` arm of the handler dispatcher).
- **Discriminator field name `target`**. Two valid values: `'facet' | 'proposal'`. Future kinds keep the same field; cross-kind switch shape stays uniform.
- **`choice: 'agree' | 'dispute'`** per [ADR 0030 §3 + Consequences](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md). Withdraw is a separate event kind.
- **Facet branch payload field names** match the withdraw-agreement payload: `entity_kind`, `entity_id`, `facet`, `participant` — same names, same types, same Zod refinement helpers.
- **No backfill** — pre-release clean break per [ADR 0030 Consequences](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md).

## Open questions

(none — all decided per ADR 0030)
