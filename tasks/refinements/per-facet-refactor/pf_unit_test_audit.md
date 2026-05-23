# Unit-test audit + revision sweep

**TaskJuggler entry**: [tasks/15-per-facet-refactor.tji](../../15-per-facet-refactor.tji) — task `per_facet_refactor.tests.pf_unit_test_audit`
**Effort estimate**: 1.5d
**Inherited dependencies**: every other `pf_*` task except `pf_e2e_methodology_full_flow_update`. The audit only makes sense after the surface is in place.

## What this task is

Sweep the unit test suites across `apps/server`, `apps/moderator`, `apps/participant`, and `packages/shared-types` for cases that assert the old vote / commit / meta-disagreement-marked envelope shapes (proposal-id-keyed for facet-valued proposals) or the old bundled `classify-node` propose path. For each affected file, decide the resolution:

- **Revise in place** — the assertion is still meaningful under the new shape but the payload changes; rewrite the assertion against the new shape.
- **Remove** — the assertion was specific to the old shape and has no analog under the new shape (e.g. asserting the bundled `classify-node` envelope landed alongside `node-created`).
- **Keep as-is** — the assertion is about a structural proposal sub-kind and continues to pass under `pf_structural_handlers_unchanged`'s pin.

Per [ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md): the audit produces a list of test files affected and the per-file resolution. The list lives in this refinement's `## Status` block on completion (per the task-completion ritual); the in-place revisions land in the same commits as the sibling `pf_*` tasks; the removals + the kept-as-is items are explicit in the audit output.

## Why it needs to be done

The refactor changes the wire shape across many event kinds. Each sibling `pf_*` task ships its own per-task tests, but the prior test suite has many indirect dependencies on the old shape (a server-side scenario that asserted the projection's `committedProposalEventId` after a `classify-node` round-trip, for example). Without an explicit audit, those tests rot silently — they either fail at PR time (catching the regression but at the wrong moment) or they pass against stale fixtures (hiding regressions). The audit is the load-bearing one-pass sweep that prevents both.

## Inputs / context

- [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md) — the discipline this task implements.
- Every sibling `pf_*` task's "tests revised" acceptance criterion.
- The four packages whose test suites are in scope: `apps/server/src/**/*.test.ts`, `apps/moderator/src/**/*.test.{ts,tsx}`, `apps/participant/src/**/*.test.{ts,tsx}`, `packages/shared-types/src/**/*.test.ts`.

## Constraints / requirements

- Run `grep -nrE "proposal_id|proposal_event_id|classify-node|set-node-substance|set-edge-substance|edit-wording|vote.*choice.*withdraw|metaDisagreementMarked|committedProposalEventId|committedProposals" apps/ packages/` (or similar) to enumerate candidate files.
- For each candidate, classify as revise / remove / keep, with a one-line rationale.
- The revise + remove cases land in the same commits as the sibling task that introduces the corresponding new shape (so each `pf_*` task ships with its tests in sync). The audit task's deliverable is the **list** + the **decisions per file**; the changes themselves are distributed across the sibling tasks' commits.
- The Cucumber + pglite scenarios under `tests/behavior/` are also in scope (same approach).
- The Playwright spec at `tests/e2e/methodology-full-flow.spec.ts` is owned by `pf_e2e_methodology_full_flow_update`, not this task.

## Acceptance criteria

- A complete list of affected test files lives in the `## Status` block of this refinement on task close (per the task-completion ritual).
- Every file in the list is either: revised in-place under the sibling task's commit, removed under the sibling task's commit, or explicitly kept-as-is with rationale.
- After every sibling `pf_*` task lands, `pnpm run test:smoke` green, `pnpm run test:behavior:smoke` green, `make test` green.
- `tj3 project.tjp` parses clean.

## Decisions

- **The audit is itself the deliverable**, not new code. Per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md), the audit's output (the list + per-file resolution) is captured in the Status block so future readers can see why specific test changes accompanied specific sibling commits.
- **Revisions land with the sibling task that introduces the new shape**, not in a separate audit commit. This keeps each sibling task self-contained: its tests + its source land together.

## Open questions

(none — all decided per ADR 0030)
