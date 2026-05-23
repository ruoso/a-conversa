# Facet-keyed meta-disagreement-marked payload

**TaskJuggler entry**: [tasks/15-per-facet-refactor.tji](../../15-per-facet-refactor.tji) — task `per_facet_refactor.schema_and_events.pf_facet_keyed_meta_disagreement_payload`
**Effort estimate**: 0.5d
**Inherited dependencies**: `pf_facet_keyed_vote_payload`, `pf_facet_keyed_commit_payload` (settle the discriminator pattern this refinement reuses).

## What this task is

Rewrite `metaDisagreementMarkedPayloadSchema` analogously to `vote` and `commit`: the facet-valued branch carries `{ target: 'facet', entity_kind, entity_id, facet, … }`; the structural branch keeps the proposal-keyed shape. Per [ADR 0030 §2 + §9](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md) meta-disagreement marks against facet-valued proposals are facet-keyed; structural ones stay proposal-keyed.

## Why it needs to be done

The meta-disagreement marker is the agreement-state machine's escape hatch when participants can't resolve a facet through ordinary voting / diagnostics / decomposition. Its identity has to match the votes whose impasse it acknowledges: facet-keyed for facet-valued proposals, proposal-keyed for structural ones. The mismatch otherwise leaves the projection unable to set `FacetState.status = 'meta-disagreement'` against the right `(entity, facet)`.

## Inputs / context

- [ADR 0030 §2, §9](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md) — the parallel decision for vote + commit + meta-disagreement.
- [`packages/shared-types/src/events.ts:395-401`](../../../packages/shared-types/src/events.ts) — current `metaDisagreementMarkedPayloadSchema`.
- `pf_facet_keyed_vote_payload`, `pf_facet_keyed_commit_payload` (siblings) — discriminator + branch shape conventions this refinement matches.

## Constraints / requirements

- Same `target: 'facet' | 'proposal'` discriminator as the vote / commit schemas.
- Facet branch: `{ target: 'facet', entity_kind, entity_id, facet }`. The "values side by side" carriage that the participant detail panel renders for `meta-disagreement` reads the projection's two candidate values for the facet; the event itself just marks the facet, no value carriage on the payload.
- Proposal branch: `{ target: 'proposal', proposal_id }`. Unchanged from today's structural-proposal meta-disagreement.
- Vitest round-trip + invalid-shape tests cover both branches.

## Acceptance criteria

- `metaDisagreementMarkedPayloadSchema` exports the discriminated union; both branch types are exported.
- `eventPayloadSchemas['meta-disagreement-marked']` / `EventPayloadMap['meta-disagreement-marked']` resolve to the union.
- The previous proposal-id-only shape no longer parses unmodified.
- `pnpm run test:smoke` green; `make test` green; `tj3 project.tjp` parses clean.

## Decisions

- **Discriminator + shape mirror** the vote / commit schemas.
- **No backfill** — pre-release clean break.

## Open questions

(none — all decided per ADR 0030)

## Status

**Done** — 2026-05-23.

- `metaDisagreementMarkedPayloadSchema` rewritten as `z.discriminatedUnion('target', [facetMetaDisagreementPayloadSchema, proposalMetaDisagreementPayloadSchema])` in [`packages/shared-types/src/events.ts`](../../../packages/shared-types/src/events.ts), completing the (vote | commit | meta-mark) triplet from ADR 0030 §2 + §9. Facet arm carries `{ target: 'facet', entity_kind, entity_id, facet, marked_by, marked_at }`; proposal arm carries `{ target: 'proposal', proposal_id, marked_by, marked_at }`. The two competing candidate values for a facet-arm meta-mark are derived by the projection from the two most-recent proposals targeting that facet (per ADR 0030 §2 sentence 4) — they are NOT carried inline on the payload.
- Schema-level round-trip + invalid-shape coverage landed in [`packages/shared-types/src/events.test.ts`](../../../packages/shared-types/src/events.test.ts) (three new `describe` blocks). Envelope-level `REPRESENTATIVE_PAYLOADS` + `PAYLOAD_CORRUPTIONS` + proposal-arm/cross-arm describe coverage landed in [`apps/server/src/events/validate.test.ts`](../../../apps/server/src/events/validate.test.ts).
- New Cucumber behavior coverage: [`tests/behavior/methodology/meta-disagreement-facet-keyed.feature`](../../../tests/behavior/methodology/meta-disagreement-facet-keyed.feature) + matching step file [`tests/behavior/steps/meta-disagreement-facet-keyed.steps.ts`](../../../tests/behavior/steps/meta-disagreement-facet-keyed.steps.ts) (+2 scenarios / +10 steps).
- Meta-mark handler ([`apps/server/src/methodology/handlers/markMetaDisagreement.ts`](../../../apps/server/src/methodology/handlers/markMetaDisagreement.ts)), projection ([`apps/server/src/projection/replay.ts`](../../../apps/server/src/projection/replay.ts) `handleMetaDisagreementMarked`), proposal-status broadcast ([`apps/server/src/ws/broadcast/proposal-status.ts`](../../../apps/server/src/ws/broadcast/proposal-status.ts)), and participant + moderator selectors ([`apps/{participant,moderator}/src/graph/facetStatus.ts`](../../../apps/participant/src/graph/facetStatus.ts), [`apps/participant/src/detail/ParticipantVoteButtons.tsx`](../../../apps/participant/src/detail/ParticipantVoteButtons.tsx), [`apps/moderator/src/graph/pendingProposals.ts`](../../../apps/moderator/src/graph/pendingProposals.ts), [`apps/moderator/src/graph/selectors.ts`](../../../apps/moderator/src/graph/selectors.ts)) all narrow on `target === 'proposal'` for now via `TODO(pf_meta_disagreement_handler_facet_keyed)` markers (7 source files + 3 test files); facet-arm emission lands in that downstream WBS leaf, no new WBS registration required.
- 14 test/fixture files updated mechanically to the new payload shape.
- Verification (this commit): `pnpm run check` green; `pnpm run test:smoke` 4287 passing (+21) / 2 skipped (carryover); `pnpm run test:behavior:smoke` 249 scenarios / 1715 steps (+2 / +10); `pnpm run test:e2e:smoke` 107 green (unchanged) via `make up` → run → `make down-v`.
