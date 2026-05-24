# Structural handlers unchanged (pin + test surfaces)

**TaskJuggler entry**: [tasks/15-per-facet-refactor.tji](../../15-per-facet-refactor.tji) — task `per_facet_refactor.server_handlers.pf_structural_handlers_unchanged`
**Effort estimate**: 0.5d
**Inherited dependencies**: `pf_facet_keyed_vote_payload`, `pf_facet_keyed_commit_payload`, `pf_facet_keyed_meta_disagreement_payload`, `pf_vote_handler_facet_keyed`, `pf_commit_handler_facet_keyed`, `pf_meta_disagreement_handler_facet_keyed`.

## What this task is

Explicit pin (with test coverage) that the structural proposal sub-kinds — `decompose`, `interpretive-split`, `axiom-mark`, `annotate`, `meta-move`, `break-edge` — retain their proposal-id-keyed vote / commit / meta-disagreement-marked semantics under the new payload shape's `target: 'proposal'` branch.

This is not a code-change task in the sense of new functionality; it is a verification task that pins the structural-vs-facet split per [ADR 0030 §9](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md) with test surfaces that prevent regression. The test surfaces are the contract.

## Why it needs to be done

[ADR 0030 §9](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md) explicitly notes: "The two patterns coexist: …" and pins the structural sub-kinds list. Without an explicit verification task, the test suite drifts toward asserting only the new facet-keyed path; a future refactor could break the structural path silently. The task ships a battery of structural-target round-trip tests that lock the contract.

## Inputs / context

- [ADR 0030 §9 + Consequences](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md) — the structural-vs-facet pin.
- The six structural proposal sub-kinds, each in `packages/shared-types/src/events/proposals.ts`.
- The sibling handler-refactor refinements (`pf_vote_handler_facet_keyed`, `pf_commit_handler_facet_keyed`, `pf_meta_disagreement_handler_facet_keyed`) — this task verifies their proposal-target branches against each structural sub-kind.

## Constraints / requirements

- For each of the six structural proposal sub-kinds, ship at least one round-trip test that:
  1. Proposes the sub-kind.
  2. Issues a vote with `target: 'proposal'` against the new proposal.
  3. Issues a commit with `target: 'proposal'`.
  4. Asserts the projection's structural-proposal record reflects the votes + commit.
- For at least one structural sub-kind, ship a meta-disagreement-marked round-trip test with `target: 'proposal'`.
- Tests can live in existing `apps/server/src/ws/handlers/*.test.ts` files (one new case per file per structural sub-kind) OR in a dedicated `apps/server/src/ws/handlers/structural-target.test.ts`. Judgment call at implementation time; either satisfies [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md).
- No source-code changes outside the test files (this is the verification task). If a code change does become necessary while writing the tests, it surfaces a regression in one of the sibling tasks, which gets fixed there — not here.

## Acceptance criteria

- Six (or more) structural-target round-trip Vitest cases land, one per structural proposal sub-kind.
- At least one meta-disagreement-marked structural-target case lands.
- The structural-handler code in `apps/server/src/ws/handlers/{vote,commit,meta-disagreement}.ts` is unchanged by this task (its structural-target branches were already there; they just route through the new discriminator).
- `pnpm run test:smoke` green; `make test` green; `tj3 project.tjp` parses clean.

## Decisions

- **Structural pattern is preserved by design**, per [ADR 0030 §9](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md). This task pins it; it does not litigate it.
- **Tests are the contract.** A future reader who edits the structural handlers and breaks the proposal-target path will see these tests fail, and the failure will direct them to [ADR 0030 §9](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md) for the rationale.

## Open questions

(none — all decided per ADR 0030)

## Status

**Done** — 2026-05-24.

- Test surfaces: `apps/server/src/methodology/handlers/structural-target.test.ts` — 13 Vitest cases covering one round-trip per structural sub-kind (`decompose`, `interpretive-split`, `axiom-mark`, `annotate`, `meta-move`, `break-edge`) + a 6-iteration dispatcher loop pinning `target: 'proposal'` emission across all sub-kinds + a meta-disagreement-marked projection-arm round-trip.
- Cucumber surface: `tests/behavior/methodology/structural-target.feature` + `tests/behavior/steps/methodology-structural-target.steps.ts` — 1 scenario (7 steps) exercising decompose propose + vote agree + commit through pglite via the proposal-keyed arm.
- Narrative pin comments added at the dispatch sites in `apps/server/src/methodology/handlers/{vote,commit,markMetaDisagreement}.ts` directing future readers to this refinement and ADR 0030 §9; no behavioral change.
- Handler structural-target arms verified intact: `vote.ts`, `commit.ts`, `markMetaDisagreement.ts` all still route structural sub-kinds through their proposal-keyed envelopes.
- Verification: `pnpm run check` clean; `pnpm run test:smoke` 4345 passing (+13); `pnpm run test:behavior:smoke` 261 scenarios / 1794 steps (+1 / +7); `pnpm run test:e2e:smoke` 107 green (unchanged).
- TODO markers: none added, none paid down.
