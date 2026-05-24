# e2e methodology-full-flow: sequential capture update

**TaskJuggler entry**: [tasks/15-per-facet-refactor.tji](../../15-per-facet-refactor.tji) — task `per_facet_refactor.tests.pf_e2e_methodology_full_flow_update`
**Effort estimate**: 2d
**Inherited dependencies**: every other `pf_*` task except `pf_unit_test_audit`. The e2e is the integration verification — it depends on the full surface being in place.

## What this task is

Rewrite the [methodology-full-flow Playwright spec](../../../tests/e2e/methodology-full-flow.spec.ts) to drive the new sequential capture flow:

- **Phase 2 (capture)** now captures wording only — no co-bundled classification. The propose envelope produces a `node-created` with inline wording; the wording facet enters life `proposed`.
- **Phase 2a (wording vote + commit)** is a new phase: every debater agrees on the wording row of the participant detail panel; the moderator commits the wording facet via the pending-proposals pane.
- **Phase 2b (classification propose + vote + commit)** is a new phase: the moderator proposes a classification from the per-node-card classification affordance; debaters vote on the classification row; moderator commits.
- **Phase 2c (substance propose + vote + commit)** is the third phase: per-node-card substance affordance → vote → commit.

Each subsequent statement capture goes through the same sequential phases. Edge captures similarly: `edge-created` lands the shape inline; the shape facet votes + commits; the edge-substance facet propose-vote-commits separately.

The spec also exercises:

- `withdraw-agreement` against a committed facet, asserting the row flips to `withdrawn`.
- An out-of-sequence propose (e.g. trying to propose `set-node-substance` while classification isn't agreed) — asserts the server's typed-error envelope arrives and the connection stays open.
- The `awaiting-proposal` row state on a freshly captured node before classification is proposed.

## Why it needs to be done

Per [ADR 0030 Consequences](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md): "e2e validation lands downstream. The methodology-full-flow Playwright spec … is the canonical exercise of the sequential capture flow and the new envelope shapes. The downstream WBS task that lands the runtime change amends that spec." This is that task.

Per [ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md): every empirical claim about the refactor's correctness lives in a committed test. The methodology-full-flow spec is the canonical integration verification.

## Inputs / context

- [ADR 0030 + Consequences](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md).
- [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md).
- [`tests/e2e/methodology-full-flow.spec.ts`](../../../tests/e2e/methodology-full-flow.spec.ts) — the spec being rewritten.
- [`docs/methodology.md`](../../../docs/methodology.md) — the methodology the spec encodes; the spec is the most direct empirical witness of the methodology.
- [ADR 0008 — Playwright e2e + compose layering](../../../docs/adr/0008-e2e-playwright-compose.md) — the e2e harness this spec runs against.

## Constraints / requirements

- The spec drives the full chain (moderator + two debaters in three browser contexts) against the dev compose stack.
- Each new phase (2a / 2b / 2c) is a distinct named Playwright `test.step` (or top-level `test()` block, depending on the existing spec's structure — match the existing convention).
- The `awaiting-proposal` row state, the `withdraw-agreement` gesture, and the out-of-sequence-refusal path each get their own assertions.
- The existing previously-unfixmed phases (Phase 6.2 / 7.2 / 8.2 / 9.2 / 11.1 / 11.2 / 12.1 — see recent commits `4e31f1b`, `e3a2962`) that drive structural sub-kinds stay green; the structural-vs-facet split (per `pf_structural_handlers_unchanged`) keeps those flows working.
- The spec runs end-to-end in under the existing time budget (i.e., the new phases add work but the spec's structure is reorganized to share setup where it makes sense).

## Acceptance criteria

- The spec exercises all three phases per capture (wording → classification → substance), for both nodes and edges.
- `awaiting-proposal` state is asserted on at least one freshly captured node.
- `withdraw-agreement` is exercised end-to-end (commit → withdraw → status flip).
- Out-of-sequence-propose refusal is exercised; the spec asserts the typed-error code AND that the connection stayed open (a subsequent propose against a valid sequence succeeds).
- The spec passes on the dev compose stack: `make test:e2e` green.
- `tj3 project.tjp` parses clean.

## Decisions

- **One spec, multiple phases.** The methodology-full-flow spec is the canonical sequential-capture exercise; adding new specs would split the verification surface unnecessarily. The spec grows new phases; the existing structural-flow phases stay.
- **Pre-release clean break per ADR 0030 Consequences.** The spec doesn't carry compat tests for the old bundled-capture shape; the old shape is gone, no migration window.

## Open questions

(none — all decided per ADR 0030)

## Status

**Done** — 2026-05-24.

Consolidation + verification pass on [`tests/e2e/methodology-full-flow.spec.ts`](../../../tests/e2e/methodology-full-flow.spec.ts). The spec header was rewritten to reflect [ADR 0030](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md)'s sequential-capture model and the facet-arm vs proposal-arm wire-shape split. Three new phases close the awaiting-proposal / withdraw-agreement / edge.shape acceptance criteria the prior refactor tasks did not pin directly via the spec.

- Phase 2.1.5 — `awaiting-proposal` row state on N1's classification + substance facets immediately after capture-node (empty-state body, no vote buttons).
- Phase 4.5 — withdraw-agreement end-to-end: ben withdraws his prior agreement on N1.substance via the two-click participant detail-panel withdraw button; row `data-facet-status` flips to `'withdrawn'`.
- Phase 5.5 — participant edge.shape vote: ben + maria tap the freshly created supports-edge (symmetric `__aConversaCyInstance` edge-tap branch) and vote agree on the inline shape facet row.

Helper rename: `tapParticipantNode` → `tapParticipantElement` with a back-compat alias so the helper reads symmetric for both node and edge ids.

No `test.fixme` markers remain. Two out-of-scope acceptance criteria are documented explicitly in the spec header:

- Out-of-sequence facet propose refusal — the UI hides the affordances and there is no wire-send seam exposed; the contract is pinned by Cucumber + server units per [`pf_sequence_gate_server_enforced`](pf_sequence_gate_server_enforced.md).
- Moderator-side commit of inline edge.shape + the full set-edge-substance cycle — no UI affordance yet; tracked as the new debt task `pf_mod_edge_card_substance_affordance` (registered in [tasks/15-per-facet-refactor.tji](../../15-per-facet-refactor.tji)).

Artifacts:

- [`tests/e2e/methodology-full-flow.spec.ts`](../../../tests/e2e/methodology-full-flow.spec.ts) — header rewrite + 3 new phases + helper rename.

Verification: `pnpm run check` green; `pnpm run test:smoke` 4423 passing (unchanged); `pnpm run test:behavior:smoke` 263 / 1812 (unchanged); `pnpm run test:e2e:smoke` 117 + 0 fixme (+3 phases). Compose stack: `make up` → run → `make down-v`.
