# Participant FacetName: widen local mirror to include 'shape'

**TaskJuggler entry**: [tasks/15-per-facet-refactor.tji](../../15-per-facet-refactor.tji) — task `per_facet_refactor.participant_ui.pf_part_facet_name_widen_shape`
**Effort estimate**: 0.5d (mirrors the moderator counterpart `pf_mod_facet_name_widen_shape`).

## Inherited dependencies

Settled:

- [`pf_shape_facet_wire_vote`](pf_shape_facet_wire_vote.md) — wire-level `facetNameSchema` is 4-valued; all four facet-keyed envelope kinds (vote / commit / mark-meta-disagreement / withdraw-agreement) round-trip with `facet: 'shape'`. Its Status block (L69) explicitly defers the participant + moderator `FacetName` mirror widening.
- [`pf_mod_facet_name_widen_shape`](pf_mod_facet_name_widen_shape.md) — moderator counterpart already landed (2026-05-24); this task mirrors it on the participant workspace.
- [`pf_part_detail_panel_three_facet_rows`](pf_part_detail_panel_three_facet_rows.md) — `ParticipantVoteButtons` already renders shape as a per-facet row (two rows for an edge: `shape` + `substance`).
- [`pf_part_vote_action_facet_keyed`](pf_part_vote_action_facet_keyed.md) — `useVoteAction` already accepts the facet-arm target shape `{ entity_kind, entity_id, facet }`; the agree click on a shape row already produces a correctly-shaped wire payload.

Pending: none.

## What this task is

Widen the participant app's local `FacetName` mirror in [`apps/participant/src/graph/facetStatus.ts`](../../../apps/participant/src/graph/facetStatus.ts) (L98) from the current 3-valued `'classification' | 'substance' | 'wording'` to the 4-valued form including `'shape'`, then close the four defensive `if (event.payload.facet === 'shape') continue` guards that the predecessor introduced as scaffolding while the mirror was narrower than the wire enum. Seed the shape facet's `hasCandidate = true` from the `edge-created` arm (symmetric to the existing `node-created.wording` seed and to the moderator side at [`apps/moderator/src/graph/facetStatus.ts`](../../../apps/moderator/src/graph/facetStatus.ts) lines 344–364). Audit the two participant vote mirrors ([`ownVotes.ts`](../../../apps/participant/src/graph/ownVotes.ts), [`otherVotes.ts`](../../../apps/participant/src/graph/otherVotes.ts)) and drop their parallel shape-skip guards. Drop the shape short-circuit in [`apps/participant/src/detail/ParticipantVoteButtons.tsx`](../../../apps/participant/src/detail/ParticipantVoteButtons.tsx) `readFacetStatus` (lines 667–672) — the synthetic `'committed'`-when-inline-carriage path goes away; the shape row reads its status off the projection index like the other facets. Finally, tighten the two currently-tolerant Playwright phases from `if-visible` to hard `expect(agreeBtn).toBeVisible()`.

## Why it needs to be done

Source of debt: [`pf_shape_facet_wire_vote`](pf_shape_facet_wire_vote.md) Status block L69 explicitly deferred the client UI mirrors (participant + moderator) — they "defensively skip `'shape'` for now". The moderator side closed under `pf_mod_facet_name_widen_shape`; the participant side is the symmetric closure.

The user-visible bug today: on a freshly-drawn edge, every participant's detail panel mounts the shape row (the row catalog is always-on per `pf_part_detail_panel_three_facet_rows`), but the row's status comes from `readFacetStatus`'s shape short-circuit which returns the synthetic `'committed'` whenever an inline carriage exists. `'committed'` is a vote-refusing status (the catalog renders only the placeholder withdraw button), so a participant on a fresh edge sees only a withdraw button and never the agree button the methodology requires for shape consensus. The wire is already correct (shape-facet votes round-trip under `pf_shape_facet_wire_vote`); the participant projection mirror is the last stale link.

Downstream consumer: the methodology-full-flow Phase 5.5 + moderator-draw-edge Phase 5.1 e2e arcs that exercise shape-facet voting. Both currently wrap the agree click in `if (await agreeBtn.isVisible())` so they pass trivially when the button is missing — they pin nothing today. Closing this task lets both phases assert visibility hard, which is what pins the regression class going forward.

This is a UI-stream task (`participant_ui.*`) per ORCHESTRATOR.md "UI-stream e2e policy" — the e2e surface is the existing methodology-full-flow Phase 5.5 (already wired through the edge-draw flow); no new Playwright spec is needed.

## Inputs / context

- WBS note: [`tasks/15-per-facet-refactor.tji`](../../15-per-facet-refactor.tji) L210 (the authoritative source-of-debt description; cites the key paths inline).
- [`apps/participant/src/graph/facetStatus.ts`](../../../apps/participant/src/graph/facetStatus.ts):
  - L98 — the `FacetName` type alias to widen.
  - L317 — `withdraw-agreement` arm's `if (event.payload.facet === 'shape') continue` guard.
  - L393 — vote arm's shape-skip guard.
  - L430 — commit arm's shape-skip guard.
  - L466 — `mark-meta-disagreement` arm's shape-skip guard.
- [`apps/moderator/src/graph/facetStatus.ts`](../../../apps/moderator/src/graph/facetStatus.ts) lines 344–364 — the canonical `edge-created` shape-seed pattern this task mirrors. The seed flips `hasCandidate = true` on the freshly-allocated `(edge, 'shape')` state; the substance arm continues to allocate without flipping `hasCandidate` (substance enters life `'awaiting-proposal'` until a `set-edge-substance` proposal lands).
- [`apps/participant/src/graph/ownVotes.ts`](../../../apps/participant/src/graph/ownVotes.ts) L235 and L421 — parallel shape-skip guards keyed to the narrow `FacetName` mirror.
- [`apps/participant/src/graph/otherVotes.ts`](../../../apps/participant/src/graph/otherVotes.ts) L372 — same.
- [`apps/participant/src/detail/ParticipantVoteButtons.tsx`](../../../apps/participant/src/detail/ParticipantVoteButtons.tsx) lines 667–672 — `readFacetStatus`'s shape short-circuit (returns synthetic `'committed'` when `candidates.shape !== undefined`, else `'awaiting-proposal'`).
- [`tests/e2e/methodology-full-flow.spec.ts`](../../../tests/e2e/methodology-full-flow.spec.ts) lines 985–1019 — Phase 5.5 (`ben + maria vote agree on the edge shape facet`). The agree click is wrapped in `if (await agreeBtn.isVisible().catch(() => false))`.
- [`tests/e2e/moderator-draw-edge.spec.ts`](../../../tests/e2e/moderator-draw-edge.spec.ts) lines 360–386 (Phase 5.1 starts at L401 per the current source; the WBS note's line range is the surrounding block) — same tolerant `if-visible` pattern around the agree click.
- [ADR 0030 §5 + §10](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md) — §5 names shape as one of the four canonical facets (edge-keyed); §10 carries the always-on per-facet-row Consequence that motivates the always-readable shape status.
- [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md) — closes the rule that the tightened Playwright phases pin the new behavior (no scaffolding, no skip-on-missing).

## Constraints / requirements

- Widen `FacetName` in `apps/participant/src/graph/facetStatus.ts` to `'classification' | 'substance' | 'wording' | 'shape'`. Mirror naturally propagates through every downstream consumer that imports the type alias; any exhaustive `switch` over `FacetName` becomes a compile error until it handles `'shape'`. Close each in-task.
- Seed the shape facet in the `edge-created` arm of `computeFacetStatuses`: allocate the `(edge, 'shape')` state via the existing `getOrCreateFacetState` helper and flip `hasCandidate = true`. Mirrors the moderator side's lines 344–364 verbatim in shape (not in literal text — both files have their own comment idioms).
- Drop the four `if (event.payload.facet === 'shape') continue` guards (one per arm: withdraw-agreement L317, vote L393, commit L430, mark-meta-disagreement L466). The widened type means these arms now process shape-facet events correctly; the guards become dead code.
- Drop the parallel guards in `ownVotes.ts` (L235, L421) and `otherVotes.ts` (L372) — verify there is no other arm that defensively narrows; the natural data shape is already a 4-valued partial record once the type widens. The wire payload already carries `facet: 'shape'` per `pf_shape_facet_wire_vote`; the index just needs to stop dropping it.
- Drop the `if (facet === 'shape')` branch in `ParticipantVoteButtons.tsx` `readFacetStatus` (lines 667–672). The fall-through to the projection-index read (the `recorded = facetStatuses[facet]` path below the branch) is the correct behavior for shape just like the other three facets — it returns the derived status (`'proposed'` for a freshly-drawn edge, advancing through `'agreed'` / `'committed'` as votes + commits arrive).
- The `CandidateValues` type's `shape` slot continues to carry the inline-carriage value (the role string) for display purposes; only the status derivation moves to the projection. (The row's value-text rendering above `readFacetStatus` is unaffected.)
- Tighten the two Playwright phases:
  - `tests/e2e/methodology-full-flow.spec.ts` Phase 5.5 (lines 985–1019): replace the `if (await agreeBtn.isVisible().catch(() => false))` guard with `await expect(agreeBtn).toBeVisible({ timeout: 15_000 })` (or equivalent hard assertion). Keep the post-click `toHaveAttribute('data-vote-state', /^(enabled|in-flight)$/)` assertion as-is — that arm tolerates the in-flight race, which is a different (legitimate) tolerance.
  - `tests/e2e/moderator-draw-edge.spec.ts` Phase 5.1 (lines 401–427 in the current source; the WBS note's 360–386 range is the surrounding block): same tightening. Keep the in-flight `data-vote-state` assertion tolerant.
  - The outer `if (!(await shapeRow.isVisible(...)))` skip-on-missing-row branch in both phases is a different concern (the cross-context broadcast race surfaces the row, not the button-visibility-given-row) — leave that branch as-is unless the row itself proves consistent enough to also tighten. Conservative pass: tighten the button visibility only; the row-visibility skip can stay tolerant until a sibling test-stability task tightens it.
- Vitest cases in `apps/participant/src/graph/facetStatus.test.ts` gain coverage for the shape-facet derivation arms (mirroring the +5 cases on the moderator side per `pf_mod_facet_name_widen_shape`'s Status block): the `edge-created` seed populates the shape candidate; vote / commit / withdraw / meta-disagreement events with `facet: 'shape'` advance the derived status through the seven-status state machine.
- Vitest cases in `ownVotes.test.ts` / `otherVotes.test.ts` cover a shape-facet vote landing in the index (not being dropped).
- Vitest cases in `ParticipantVoteButtons.test.tsx` cover the shape row's status reading from the projection index (the agree button surfaces when the row is `'proposed'`; the withdraw button surfaces when the row is `'agreed'` / `'committed'`).
- No throwaway scaffolding — all assertions are first-class per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md).

## Acceptance criteria

- `FacetName` in `apps/participant/src/graph/facetStatus.ts` is 4-valued: `'classification' | 'substance' | 'wording' | 'shape'`.
- The four `if (event.payload.facet === 'shape') continue` guards in `computeFacetStatuses` (withdraw-agreement / vote / commit / mark-meta-disagreement arms) are gone.
- The `edge-created` arm seeds `(edge, 'shape')` with `hasCandidate = true`.
- The parallel shape-skip guards in `ownVotes.ts` (L235, L421) and `otherVotes.ts` (L372) are gone.
- The `if (facet === 'shape')` short-circuit in `ParticipantVoteButtons.tsx` `readFacetStatus` (lines 667–672) is gone; the shape row's status flows through the projection-index branch.
- `tests/e2e/methodology-full-flow.spec.ts` Phase 5.5: the agree button visibility check is a hard `expect(agreeBtn).toBeVisible(...)` (no `if-visible` no-op).
- `tests/e2e/moderator-draw-edge.spec.ts` Phase 5.1: same tightening on the agree button.
- Vitest coverage extends to the four new derivation arms per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md) (mirroring the +5 cases the moderator counterpart landed).
- `pnpm run check` green; `pnpm run test:smoke` green; `pnpm run test:behavior:smoke` green; `pnpm run test:e2e:smoke` green (the methodology-full-flow + moderator-draw-edge specs stay green with the tightened assertion); `make test` green; `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.

## Decisions

- **Mirror the moderator side verbatim in shape, not in literal text.** The moderator counterpart `pf_mod_facet_name_widen_shape` landed the canonical pattern (widen the type, seed shape in `edge-created`, drop the per-arm guards). The participant side adopts the same shape; the comment idioms each codebase uses can stay as they are. Rationale: parity of behavior matters; parity of source text doesn't.
- **Status derivation moves to the projection; inline carriage stays for display.** `readFacetStatus` for the shape row goes through the projection-index path (returns the derived seven-status value). The `CandidateValues.shape` slot continues to carry the inline role for the row's value-text rendering — those are separate concerns (status drives button visibility; carriage drives label text). Rationale: per ADR 0030 §5 the shape facet is a first-class facet that participants vote on; treating its status as a synthetic `'committed'` is the bug. The inline carriage is purely a display affordance.
- **Tighten button-visibility, leave row-visibility tolerant.** The two Playwright phases have two layers of `if-visible`: the outer one on the shape row itself (a cross-context broadcast race concern), and the inner one on the agree button (the bug this task fixes). The conservative pass tightens the inner one only; the outer row-visibility race is a separate test-stability concern that, if it materializes, gets its own task. Rationale: surgical tightening pins exactly the regression class this task closes without entangling unrelated flake sources.
- **No new ADR.** This task is a mirror-widening that follows the established ADR 0030 + `pf_shape_facet_wire_vote` shape; no new architectural choice is made. Rationale: matches the moderator counterpart, which also landed without a new ADR.
- **No new Playwright spec.** The surface is already reachable via the existing methodology-full-flow Phase 5.5 + moderator-draw-edge Phase 5.1; per ORCHESTRATOR.md's UI-stream e2e policy, the existing wired-but-tolerant phases get tightened in this task rather than augmented with a new spec. Rationale: the policy explicitly favors tightening existing scaffolding over adding parallel coverage.

## Open questions

(none — all decided per the moderator-counterpart precedent and ADR 0030 §5 + §10)

## Status

**Done** — 2026-05-25.

- Widened the participant's local `FacetName` mirror to the 4-valued form in [`apps/participant/src/graph/facetStatus.ts`](../../../apps/participant/src/graph/facetStatus.ts); seeded the shape facet's `hasCandidate = true` on `edge-created` (symmetric to the moderator side); dropped the four projection-arm shape-skip guards (withdraw-agreement / vote / commit / mark-meta-disagreement). +5 derivation cases in `facetStatus.test.ts`.
- Dropped the parallel shape-skip guards in [`apps/participant/src/graph/ownVotes.ts`](../../../apps/participant/src/graph/ownVotes.ts) and [`apps/participant/src/graph/otherVotes.ts`](../../../apps/participant/src/graph/otherVotes.ts); shape-facet votes now land in the index. +1 shape-vote case each in `ownVotes.test.ts` / `otherVotes.test.ts`.
- Dropped the synthetic `'committed'` short-circuit in [`apps/participant/src/detail/ParticipantVoteButtons.tsx`](../../../apps/participant/src/detail/ParticipantVoteButtons.tsx) `readFacetStatus`; the shape row now reads the projection like the other facets, so the agree/dispute buttons surface on a freshly drawn edge as the methodology requires. `lookupOwnVoteForRow` no longer excludes shape. +2 shape-row cases in `ParticipantVoteButtons.test.tsx`.
- Dropped the shape-skip in [`apps/participant/src/detail/EntityDetailPanel.tsx`](../../../apps/participant/src/detail/EntityDetailPanel.tsx) `deriveOwnFacetVotes`; narrowed NODE/EDGE_FACET_NAMES for FacetPill type-compat.
- Tightened the two Playwright shape-agree visibility checks ([`tests/e2e/methodology-full-flow.spec.ts`](../../../tests/e2e/methodology-full-flow.spec.ts) Phase 5.5 line 985, [`tests/e2e/moderator-draw-edge.spec.ts`](../../../tests/e2e/moderator-draw-edge.spec.ts) Phase 5.1 line 401) from `if-visible` no-op to hard `expect(agreeBtn).toBeVisible({ timeout: 15_000 })`.
- Verification: `pnpm run check` green; `pnpm run test:smoke` 4528 passing (+9); `pnpm run test:behavior:smoke` 263 scenarios passing (unchanged); `pnpm run test:e2e:smoke` 144 green (unchanged spec/scenario count; two tightened phases now strict).
