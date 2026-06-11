# Fix AC-3b's vacuous rebut-edge substance pre-commit in the full-session walkthrough e2e

**TaskJuggler entry**: `data_and_methodology.data_methodology_tests.dm_e2e_tests.e2e_ac3b_rebut_precommit_vacuous` — [tasks/10-data-and-methodology.tji](../../10-data-and-methodology.tji) (block at lines 667–681). Embedded note: *"AC-3b's tolerant substance pre-commit block targets `edge-card-substance-affordance-button-EDGE_ID-agreed` (the generic testid), which is never rendered for rebut edges (they render `rebut-edge-pre-commit-button-EDGE_ID-agreed`). The tolerant block silently no-ops so the 'edge substance is committed agreed' title assertion in AC-3b is vacuously passing. Fix: repoint the tolerant pre-commit at the rebut-edge-specific testid and make the assertion firm, same pattern as AC-5a."*

## Effort estimate

**0.5d** (per the `.tji` allocation). The fix is a single-spec change in `tests/e2e/full-session-walkthrough.spec.ts`: transplant the firm facet walk AC-5a already established (the predecessor wrote it for E11) onto AC-3b's edge E5, plus the comment updates that keep the spec's tolerant/firm narrative truthful. No production code changes are expected — the rebut-specific affordance, its testid, and the endpoint data attributes all exist.

## Inherited dependencies

**Settled:**

- `data_and_methodology.methodology_engine.interpretive_split_edge_inheritance` — Done 2026-06-11 ([refinement](interpretive_split_edge_inheritance.md), commit `42cf4fb4`). It is both the source of this debt (its fixer sub-agent found the same vacuous-testid bug in AC-5a, fixed it there, and registered AC-3b's copy as this task) and the source of the pattern to copy: AC-5a's firm E11 pre-commit walk (`tests/e2e/full-session-walkthrough.spec.ts` L831–900) is the worked example, and the `data-edge-source` / `data-edge-target` attributes it added to `apps/moderator/src/graph/StatementEdge.tsx` are what endpoint-discriminated pinning needs.

**Pending:** none.

## What this task is

Make AC-3b of the full-session walkthrough Playwright spec actually do what its title claims. The test (`tests/e2e/full-session-walkthrough.spec.ts` L692–732) is titled *"the edge substance is committed agreed while N8 substance stays proposed"*, but the substance pre-commit block (L711–720) locates `edge-card-substance-affordance-button-${rebutEdgeId}-agreed` — a testid that can never match, because `StatementEdge.tsx` L331–344 renders the F6-flavored `<RebutEdgePreCommitAffordance>` (`rebut-edge-pre-commit-button-*`) for `role === 'rebuts'` edges and the generic `<EdgeCardSubstanceAffordance>` only for every other role. The enclosing `if (await subAffordance.isVisible().catch(() => false))` guard therefore silently no-ops: the substance proposal is never fired, no votes are cast, nothing commits, and the test's load-bearing assertions (L726–731) only check that the node and edge *labels* render. The title's central claim is asserted nowhere — the test passes vacuously.

The fix transplants AC-5a's firm walk onto E5: pin the edge by endpoints, vote the shape facet firmly from both debater panels, commit shape via the inline affordance, click the rebut-specific pre-commit affordance (`agreed`), vote substance firmly, commit the pending proposal row, and end with the `data-facet-status="committed"` pin on the edge label — each beat a hard `expect`, no `.catch(() => …)` fallbacks, no `if`-guards.

## Why it needs to be done

The walkthrough spec is the cross-cutting regression net for the whole methodology loop (see [walkthrough_replay_e2e.md](walkthrough_replay_e2e.md)); a vacuous beat in it is worse than a missing one, because it *reports* coverage of the conditional-reading defeater pattern (F3/F6 — `docs/example-walkthrough.md` turns 9–11, `docs/methodology.md` L119–121) while exercising none of it. The rebut pre-commit path through the moderator UI — `<RebutEdgePreCommitAffordance>` → `set-edge-substance` propose → facet-keyed votes → commit — currently has component-test coverage (`RebutEdgePreCommitAffordance.test.tsx`) and engine-level Cucumber coverage (`tests/behavior/methodology/propose-set-edge-substance.feature`), but its only *full-stack* exercise is AC-5a, which exists to set up the split-inheritance source edge. AC-3b is the beat the walkthrough actually designates for the defeater pre-commitment pattern; fixing it restores a second, independent full-stack pin on the same seam.

The same fixer pass that repaired AC-5a (predecessor Status, [interpretive_split_edge_inheritance.md](interpretive_split_edge_inheritance.md) L98, L101) registered this as the remaining copy of the bug. The milestone `m_audits` (`tasks/99-milestones.tji` L101) already depends on this task.

## Inputs / context

Source file the implementer edits:

- `tests/e2e/full-session-walkthrough.spec.ts`
  - L692–732 — the AC-3b test body to rewrite.
  - L696 — `readEdgeIdByRole(mariaPage, 'rebuts')`, the bare-role pin to replace (helper defined at L172–177; AC-3b is its only call site — remove it if it goes dead).
  - L702–720 — the tolerant walk to make firm: `tolerantVoteAgreeOnFacet('shape')` (L702), guarded shape-commit (L704–710), the wrong-testid substance affordance (L713–715), guarded substance votes + `tolerantCommitPendingRowByPrefix` (L716–720).
  - L726–731 — the existing structural assertions (keep them; they are necessary but no longer sufficient).
  - L654–670, L698–701 — narrative comments ("All tolerant — the accumulating session is noisy") that must be updated to match the firm walk.
  - L67–79 — the spec-level tolerant/strict policy comment; extend its "stay firm" list with AC-3b's facet walk.

Pattern to copy (read, do not edit):

- `tests/e2e/full-session-walkthrough.spec.ts` L831–900 — AC-5a's firm E11 walk: endpoint-discriminated pin (L839–845), per-debater panel-focus check + shape facet-row votes (L851–865), firm shape commit (L866–870), firm rebut-specific substance affordance (L877–881), firm substance votes (L885–894), `commitPendingRowByPrefix` (L895), terminal `data-facet-status="committed"` pin (L898–900); the firmness rationale comment at L831–838; `test.setTimeout(90_000)` at L821.

Read for grounding (not edited):

- `apps/moderator/src/graph/StatementEdge.tsx` L170 (`showSubstanceAffordance = isShapeSettled && substanceStatus === 'awaiting-proposal'` — why the shape beat must land before the substance affordance can mount), L331–344 (the `role === 'rebuts'` branch selecting `<RebutEdgePreCommitAffordance>`).
- `apps/moderator/src/graph/RebutEdgePreCommitAffordance.tsx` — the affordance contract; testid shape `rebut-edge-pre-commit-button-${edgeId}-${value}` (its `.test.tsx` L149).
- `tests/behavior/methodology/propose-set-edge-substance.feature` — the existing engine-level pin for the `set-edge-substance` wire (why no new Cucumber scenario is needed, D1).
- [ADR 0030](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md) — facet-keyed vote/commit shapes the walk drives.
- [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md) — test discipline.
- `docs/dev-environment.md` — `make test:e2e` (against a running `make up` stack) / `make test:e2e:compose` (full cycle), per the Makefile L26–27, L72–87.

Downstream-impact survey (verified while writing this refinement — no changes needed there):

- AC-5a pins E11 by endpoints *because* E5 also matches a bare `rebuts` role query (L831–841) — unaffected.
- AC-5b's inheritance assertions endpoint-filter E5 out of the match (L991) — unaffected.
- AC-7 asserts `rowCount > 5` and strictly-descending `data-sequence` (L1219–1240) — count-insensitive; the extra committed events E5's now-real walk appends do not perturb it.

## Constraints / requirements

- **Test-only change.** No production source is expected to change; the affordance, testids, and `data-edge-source`/`data-edge-target` attributes already exist. If the implementer finds a runtime gap blocking the firm walk, that is a new finding to surface, not to patch silently inside this task.
- **The whole E5 walk goes firm, not just the repointed locator** (D2). A repointed-but-still-guarded block can no-op again; and per `showSubstanceAffordance`'s gate (`StatementEdge.tsx` L170) a silently-skipped shape beat would strand the firm substance assertion with worse signal — the same rationale AC-5a recorded at L835–838.
- **Keep the existing structural assertions** (L726–731): the defeater node renders, the rebut edge renders. They remain AC-3's structural pin; the facet walk adds the substance pin on top.
- **Do not drive N8's own substance facet.** The conditional-reading pattern (edge substance committed while the defeater's own substance stays `proposed`) is the point of the beat — the existing comment at L722–725 stays true and stays put.
- **Do not touch AC-5a/AC-5b/AC-7.** Their assertions were verified insensitive to this change (see Inputs); their scopes belong to the predecessor and to `mod_decompose_split_parent_visibility`.
- **Update the narrative comments** (L67–79 policy block, L654–670 AC-3 preamble, L698–701 walk comment) so the spec's documented tolerant/firm split matches the code again.
- **Timeout headroom per the AC-5a precedent** (D5): `test.setTimeout(90_000)` on AC-3b.
- Build + full test suite green before commit (global gate); the e2e suite runs per `docs/dev-environment.md` (`make test:e2e:compose`, or `make test:e2e` against a running stack).

## Acceptance criteria

Pinned per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md) — the fix *is* the committed test; no throwaway probes.

- [ ] AC-3b pins E5 by endpoints: `[data-testid^="graph-edge-label-"][data-edge-role="rebuts"][data-edge-source="${n8Id}"][data-edge-target="${n6Id}"]`, extracting the edge id from the matched testid (AC-5a L839–845 pattern). If `readEdgeIdByRole` (L172–177) loses its last call site, it is removed.
- [ ] The shape beat is firm: each debater panel is asserted focused on E5 (`data-entity-id`), shape facet-row votes are hard `expect`s, and the shape-commit affordance click + unmount (`toHaveCount(0)`) are unguarded (AC-5a L851–870 pattern).
- [ ] The substance pre-commit targets `rebut-edge-pre-commit-button-${e5Id}-agreed`, asserted visible, clicked, and asserted unmounted — no `if`-guard, no `.catch()` (AC-5a L877–881 pattern).
- [ ] Substance votes from both debaters and the moderator's pending-row commit are firm (`commitPendingRowByPrefix`, not the tolerant variant) (AC-5a L885–895 pattern).
- [ ] The walk terminates with the assertion that makes the test title true: E5's edge label carries `data-facet-status="committed"` (AC-5a L898–900 pattern). N8's own substance facet is deliberately not driven.
- [ ] No beat of the E5 walk retains a conditional guard or swallowed rejection — any silently-skipped beat now fails the test at the causing beat (the non-vacuousness property itself).
- [ ] Narrative comments at L67–79, L654–670, and L698–701 are updated to reflect that AC-3b's facet walk is firm and why (this registered debt).
- [ ] `make test:e2e:compose` green (full-suite, including the rewritten AC-3b); global build + test gate green.

No deferred follow-ups: this task registers no future WBS tasks.

## Decisions

- **D1 — Playwright-layer fix only; no new Cucumber scenario.** The orchestrating context suggested a Cucumber scenario, but the registered debt is a vacuous *test assertion*, not an engine behavior gap: the `set-edge-substance` wire is already pinned at the engine seam by `tests/behavior/methodology/propose-set-edge-substance.feature`, the carry/inheritance cluster by `commit-interpretive-split.feature` (predecessor), and the affordance contract by `RebutEdgePreCommitAffordance.test.tsx`. What is missing is the full-stack UI exercise — exactly the Playwright layer's job per ADR 0008's layering. Adding a Cucumber scenario would duplicate an existing pin while leaving the vacuous e2e beat in place. *Alternative rejected*: new `defeater-precommit.feature` — redundant coverage, doesn't pay the registered debt.
- **D2 — Firm the entire E5 walk, not just the repointed substance locator.** The `.tji` note's minimum is "repoint + make the assertion firm". But the substance affordance only mounts once shape is settled (`StatementEdge.tsx` L170), so a still-tolerant shape beat that silently fails would strand the now-firm substance assertion with the failure surfacing far from its cause — the precise failure mode AC-5a's comment (L835–838) documents choosing firmness to avoid. *Alternative rejected*: repoint only, keep guards — leaves the vacuousness mechanism (guarded no-op) in place; the test could regress to vacuous again without failing.
- **D3 — Terminal pin is `data-facet-status="committed"` on the edge label.** That attribute is the rendered projection of the committed substance facet and is exactly what AC-5a pins (L898–900) and AC-5b's inheritance assertions consume (L999). It asserts the round trip landed (commit applied, change-feed → client projection → canvas), not merely that buttons were clicked. *Alternative rejected*: asserting only affordance unmount — proves the proposal left `awaiting-proposal`, not that the commit landed.
- **D4 — Endpoint-discriminated pin for E5; retire `readEdgeIdByRole`.** The bare role query happens to be unique at AC-3b's point in the serial run, but the spec already grew a second `rebuts` edge (E11) and AC-5a had to defend against E5 with endpoint attributes; pinning E5 the same way is symmetric, costs two attribute filters (the attributes exist since the predecessor), and removes order-dependence on no-earlier-rebut-edge. With its only call site gone, `readEdgeIdByRole` is dead code and goes. *Alternative rejected*: keep the bare-role helper — works today, but its correctness is an unstated global invariant of test ordering.
- **D5 — `test.setTimeout(90_000)` on AC-3b.** The firm walk is the same shape as AC-5a's (six-plus real round-trips against the compose stack, several `LIVE_TIMEOUT`-bounded waits) and AC-5a needed headroom over the 30s default. Reusing the established 90s figure is consistency over micro-tuning; an under-budgeted firm walk converts the fixed vacuousness into flake. *Alternative rejected*: keep the 30s default — AC-3b skips AC-5a's 15s wording-walk burn, so 30s *might* pass, but the margin is thin against compose-stack latency variance.

## Open questions

(none — all decided in D1–D5)

## Status

**Done** — 2026-06-11.

- Rewrote AC-3b in `tests/e2e/full-session-walkthrough.spec.ts` from a vacuous guarded walk into a firm E5 facet walk, following the AC-5a E11 pattern (L831–900).
- Replaced bare-role `readEdgeIdByRole` pin with endpoint-discriminated `[data-edge-source="${n8Id}"][data-edge-target="${n6Id}"]` locator; removed now-dead `readEdgeIdByRole` helper (AC-3b was its only call site).
- Shape beat made firm: per-debater panel-focus asserts, hard-`expect` facet-row votes, unguarded shape-commit affordance click and unmount check.
- Substance pre-commit repointed to `rebut-edge-pre-commit-button-${e5Id}-agreed`, asserted visible, clicked, and asserted unmounted — no guard, no `.catch()`.
- Substance votes and pending-row commit made firm (`commitPendingRowByPrefix`, not the tolerant variant).
- Terminal pin added: E5 edge label carries `data-facet-status="committed"` — the assertion the test title claimed but never exercised.
- `test.setTimeout(90_000)` added to AC-3b for compose-stack headroom (AC-5a precedent).
- Narrative comments updated: spec-level tolerant/firm policy block (previously L67–79), AC-3 preamble, and two AC-5a clauses that described AC-3b as tolerant/wrong-testid.
- No production code changed; no new WBS tasks registered (refinement noted none).
