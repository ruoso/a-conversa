# Facet-keyed commit payload

**TaskJuggler entry**: [tasks/15-per-facet-refactor.tji](../../15-per-facet-refactor.tji) — task `per_facet_refactor.schema_and_events.pf_facet_keyed_commit_payload`
**Effort estimate**: 0.5d
**Inherited dependencies**: `pf_facet_keyed_vote_payload` (settles the discriminator pattern this refinement adopts).

## What this task is

Rewrite `commitPayloadSchema` to mirror the vote split: facet-valued commits carry `{ target: 'facet', entity_kind, entity_id, facet }`; structural commits keep `{ target: 'proposal', proposal_id }`. Per [ADR 0030 §9](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md) the structural proposals (decompose / interpretive-split / axiom-mark / annotate / meta-move / break-edge) keep their proposal-keyed commit shape.

## Why it needs to be done

A commit's identity has to match its votes' identity — votes accrue on `(entity, facet)` for facet-valued proposals, so the commit gesture targets the same pair. Without the symmetry, the commit handler can't look up the votes it's committing. The structural-vs-facet split mirrors the vote payload's split; this task lands the matching commit shape.

## Inputs / context

- [ADR 0030 §2, §9](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md) — facet-keyed envelope decision and structural exception.
- [`packages/shared-types/src/events.ts:387-393`](../../../packages/shared-types/src/events.ts) — current `commitPayloadSchema`.
- `pf_facet_keyed_vote_payload` (sibling) — the discriminator pattern this refinement reuses verbatim.

## Constraints / requirements

- Use the same `target: 'facet' | 'proposal'` discriminator the vote schema uses; future readers see one pattern across vote / commit / meta-disagreement-marked.
- Facet branch: `{ target: 'facet', entity_kind, entity_id, facet }`.
- Proposal branch: `{ target: 'proposal', proposal_id }`.
- The `committed_at` ISO8601 timestamp (if currently on the payload) stays on both branches; if it was previously only on the envelope, keep it there.
- Vitest round-trip + invalid-shape tests cover both branches.

## Acceptance criteria

- `commitPayloadSchema` exports the discriminated union; `FacetCommitPayload` + `ProposalCommitPayload` types are exported.
- `eventPayloadSchemas['commit']` / `EventPayloadMap['commit']` resolve to the union.
- The previous proposal-id-only shape no longer parses unmodified — callers must now include `target: 'proposal'` explicitly.
- `pnpm run test:smoke` green; `make test` green; `tj3 project.tjp` parses clean.

## Decisions

- **Discriminator + shape mirror** the vote schema's choices (per the sibling refinement). One pattern, two consistent envelopes.
- **No backfill** — pre-release clean break.

## Open questions

(none — all decided per ADR 0030)

## Status

**Done** — 2026-05-23.

- `commitPayloadSchema` rewritten as `z.discriminatedUnion('target', [facetCommitPayloadSchema, proposalCommitPayloadSchema])` in [`packages/shared-types/src/events.ts`](../../../packages/shared-types/src/events.ts), mirroring the predecessor `pf_facet_keyed_vote_payload` split. Facet arm carries `{ target: 'facet', entity_kind, entity_id, facet, committed_by, committed_at }`; proposal arm keeps `{ target: 'proposal', proposal_id, committed_by, committed_at }`. `FacetCommitPayload` + `ProposalCommitPayload` types are exported.
- Schema-level round-trip + invalid-shape coverage landed in [`packages/shared-types/src/events.test.ts`](../../../packages/shared-types/src/events.test.ts) (three new `describe` blocks). Envelope-level cross-arm + corruption coverage landed in [`apps/server/src/events/validate.test.ts`](../../../apps/server/src/events/validate.test.ts) (`REPRESENTATIVE_PAYLOADS` + `PAYLOAD_CORRUPTIONS` + cross-arm describe).
- Cucumber behavior coverage added: new [`tests/behavior/methodology/commit-facet-keyed.feature`](../../../tests/behavior/methodology/commit-facet-keyed.feature) + matching step file [`tests/behavior/steps/commit-facet-keyed.steps.ts`](../../../tests/behavior/steps/commit-facet-keyed.steps.ts) (+2 scenarios / +11 steps).
- Projection ([`apps/server/src/projection/replay.ts`](../../../apps/server/src/projection/replay.ts) `handleCommit` + `applyCommittedProposal`), commit handler ([`apps/server/src/methodology/handlers/commit.ts`](../../../apps/server/src/methodology/handlers/commit.ts) — emits proposal-keyed arm), and proposal-status broadcast ([`apps/server/src/ws/broadcast/proposal-status.ts`](../../../apps/server/src/ws/broadcast/proposal-status.ts)) all narrow on `target === 'proposal'` for now; facet-arm handler emission is deferred to the existing WBS leaf `pf_commit_handler_facet_keyed`.
- 8 participant + moderator selector/UI files updated to narrow on `target === 'proposal'`; ~30 vitest files, 2 step fixtures, and 1 e2e fixture received mechanical payload-shape updates. 11 source files carry `TODO(pf_commit_handler_facet_keyed)` markers pointing at the downstream task; no new WBS registration required.
- Verification (this commit): `pnpm run check` green; `pnpm run test:smoke` 4266 passing (+21) / 2 skipped (carryover); `pnpm run test:behavior:smoke` 247 scenarios / 1705 steps (+2 / +11); `pnpm run test:e2e:smoke` 107 green (unchanged) via `make up` → run → `make down-v`.
