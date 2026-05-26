# Single-tap voting (no confirmation modal) across participant vote surfaces

**TaskJuggler entry**: [tasks/40-participant-ui.tji](../../40-participant-ui.tji) — task `participant_ui.part_voting.part_vote_single_tap`
**Effort estimate**: 0.5d
**Inherited dependencies**:

- `!participant_ui.part_voting.part_vote_button_per_facet` (settled — commit `5088234` shipped the pane chip's agree/dispute vote buttons. The pane surface and the detail-panel surface ([`apps/participant/src/detail/ParticipantVoteButtons.tsx`](../../../apps/participant/src/detail/ParticipantVoteButtons.tsx)) both already implement single-tap dispatch via `useVoteAction.castVote(choice)` with the pessimistic-wait posture (`disabled={inFlight}`, label flips to `inFlightLabel` during round-trip). The predecessor's Decision §5 documents the "render single-tap buttons by default" posture and explicitly defers the "polishes / formalizes the rule" work to this leaf).
- Prose-only context (NOT a `.tji` edge): `!per_facet_refactor.pf_part_detail_panel_three_facet_rows` (settled — the detail-panel surface that established the per-facet vote vocabulary: the `participant-vote-button-{agree,dispute,withdraw}` testid family, the click → `castVote(choice)` shim, the `data-vote-state="enabled" | "in-flight"` attribute on the facet row, and the agree/dispute posture WITHOUT an intermediate "armed" / "confirm" step. The withdraw button — the ONE confirmation-gated affordance — uses a two-stage armed-button gesture established by the sibling `pf_part_withdraw_agreement_action`).
- Prose-only context (NOT a `.tji` edge): `!participant_ui.part_ws_client` (settled — Decision §7 + the "UI-stream e2e policy" section of that refinement defer vote-send Playwright e2e debt to "the first leaf that surfaces a vote button" — naming THIS leaf as the inheritor. The predecessor `part_vote_button_per_facet` already paid down most of that debt by extending `tests/e2e/participant-pending-proposals.spec.ts` with step 9 (click → ack → buttons-disappear) AND the existing `tests/e2e/methodology-full-flow.spec.ts` already exercises the detail-panel surface end-to-end; this leaf adds the policy-pinning assertion that closes the inheritance loop).
- Prose-only context (NOT a `.tji` edge): ADR 0030 §3 (settled — defines `withdraw-agreement` as a SEPARATE event kind from `vote`; voting is the two-arm agree/dispute vocabulary, withdrawal is its own gesture with its own UI affordance + confirmation posture. The asymmetry — single-tap for agree/dispute, two-stage for withdraw — is methodology-motivated and lives in [`docs/participant-ui.md`](../../../docs/participant-ui.md#L84) lines 84 + 99 + 139).

## What this task is

Formalize and regression-pin the single-tap-no-confirmation voting policy across both participant vote surfaces (detail-panel facet rows + pane chip buttons), so the behavior the predecessor leaves already ship cannot regress when downstream polish leaves land. The behavior is **already implemented and end-to-end-tested**; this leaf adds explicit policy-pinning Vitest cases and one Playwright regression-assert that prove the policy holds at every surface.

Concretely:

- [`apps/participant/src/detail/ParticipantVoteButtons.test.tsx`](../../../apps/participant/src/detail/ParticipantVoteButtons.test.tsx) gains a new `describe('<ParticipantVoteButtons> — single-tap policy')` block with four pinning cases: (a) a single `click` on `participant-vote-button-agree` invokes `useWsClient().send('vote', ...)` exactly once with no intermediate render state; (b) the button has no "armed" / "confirm" label permutation — the label set across all render passes is `{agreeLabel, inFlightLabel}` only (NOT `{agreeLabel, confirmLabel, inFlightLabel}` the way the withdraw button has `{withdrawLabel, confirmWithdrawLabel, inFlightLabel}`); (c) no DOM node with `role="dialog"` or `aria-modal="true"` mounts at any point during the click → in-flight → resolved sequence; (d) two rapid clicks on the same button dispatch the `vote` payload exactly ONCE (the `disabled={inFlight}` guard is the single-fire mechanism — no debounce, no throttle, just the pessimistic-wait posture).
- [`apps/participant/src/proposals/ProposalFacetVoteButtons.test.tsx`](../../../apps/participant/src/proposals/ProposalFacetVoteButtons.test.tsx) gains a mirror `describe('<ProposalFacetVoteButtons> — single-tap policy')` block with four pinning cases against the pane testid family (`participant-pending-proposal-row-facet-vote-button-{agree,dispute}`): the same four assertions ported to the pane surface. The pane already pessimistic-waits via the same `useVoteAction` hook the detail panel uses; the single-fire guard and the no-intermediate-state property both transfer.
- [`tests/e2e/participant-pending-proposals.spec.ts`](../../../tests/e2e/participant-pending-proposals.spec.ts) step 9 (predecessor) is extended with TWO new Playwright assertions immediately surrounding the `click` invocation: (i) `expect(page.locator('[role="dialog"]')).toHaveCount(0)` after the click resolves (no modal mounted between click and ack); (ii) `expect(page.locator('[aria-modal="true"]')).toHaveCount(0)` over the same window. The existing `count → 0` (own-vote-hides) assertion stays unchanged. The two new assertions pin the policy at the cross-process boundary where future drift would manifest first.
- [`apps/participant/src/stores/voteStore.ts`](../../../apps/participant/src/stores/voteStore.ts) lines 10-19 — the docstring is updated to replace the "future leaf" prose (`part_voting.part_vote_single_tap (future leaf) which reads from this slice, sends via the shell's useWsClient(), and calls removeVote(proposalId, facetId) on the server's ack envelope`) with a present-tense pointer to the actual implementation at `useVoteAction.ts`. Decision §5 covers WHY the slice itself stays in the tree (it's exercised by `apps/participant/src/stores/stores.test.tsx`; removing it is outside this leaf's scope per `docs/dev-environment.md`'s "don't refactor beyond the task" guidance + the orchestrator brief).
- **No new component, no new selector, no new projector, no new wire shape, no new i18n keys, no new ADR.** Decision §6 enumerates why every architectural choice in this leaf applies an existing ADR or a sibling-refinement decision.

Out of scope (deferred to sibling or future leaves):

- **Not the pre-commit vote-change affordance.** Sibling `part_voting.part_change_vote_pre_commit` (1d, depends `!part_vote_single_tap`) is the next leaf — it re-opens the chip's vote buttons during the pre-commit window so the participant can flip agree↔dispute up to the moderator's commit moment. This leaf hides the buttons once the participant has voted (per the predecessor's `ownVote === undefined` gate); the sibling re-opens them under the pre-commit-window condition. The single-tap-no-confirmation policy this leaf pins APPLIES to the re-opened buttons too — the sibling MUST NOT introduce a "confirm vote change" modal.
- **Not the agree-all gesture.** Sibling `part_voting.part_agree_all_gesture` (0.5d, depends `!part_vote_button_per_facet`) mounts a per-proposal-bundle "agree all" affordance at the row level. The single-tap policy this leaf pins applies to that gesture too — a single tap on the row-level "agree all" button dispatches one `vote` envelope per chip, no per-chip confirmation step.
- **Not the proposal-notification visual flash + tab-badge increment.** Sibling `part_voting.part_proposal_notification` (1d, no `depends`) handles new-proposal arrival animation. Out of scope for this leaf's policy pin; the flash is an arrival signal not a confirmation gesture.
- **Not the withdraw affordance.** The withdraw button is the ONE confirmation-gated voting-adjacent affordance (per ADR 0030 §3 — withdrawal reverses an already-committed agreement and warrants the extra tap). The detail-panel surface's withdraw button already implements the two-stage armed-button gesture; the `part_withdraw.*` chain owns the rule. This leaf's policy pin DOES NOT touch the withdraw button — Decision §2 covers the asymmetry.
- **Not optimistic local-state updates.** The pessimistic-wait posture (`disabled={inFlight}`, label flips to `inFlightLabel`) IS the policy: the button reflects the in-flight state but the projection update waits for the `event-applied` broadcast. A future leaf MAY add a "queued local vote" indicator (e.g., a dashed-outline variant of the own-vote dot before the ack lands) if real usage shows the latency confuses debaters; named `part_queued_local_vote_indicator` (0.5d, no `depends` ordering needed beyond `!part_voting`) is the registration target if user testing surfaces the gap. This leaf does NOT register it.
- **Not the `useVoteStore` removal.** The orphan slice at `apps/participant/src/stores/voteStore.ts` is exercised only by its own tests (`apps/participant/src/stores/stores.test.tsx`); it was originally planned as the vote-button's local-state slice but the active implementation took the `useVoteAction.ts` route instead. Removing the orphan is a separate cleanup — named `part_orphan_vote_store_removal` (0.25d) under `part_voting.*` is the registration target if any future leaf needs to clean it up — but this leaf does NOT register it. The orphan is harmless dead code; touching it expands scope beyond the policy-pin task.
- **Not a new ADR.** The single-tap policy is already documented in [`docs/participant-ui.md`](../../../docs/participant-ui.md#L84) lines 84 + 139 (P2 design narrative) and the withdraw exception is settled by ADR 0030 §3. An ADR specifically titled "single-tap voting" would duplicate the design-doc text without surfacing a new architectural seam. Decision §6 explains.
- **Not a new Cucumber scenario.** The `vote` envelope's wire behavior is pinned at the protocol boundary by `ws_vote_message` + `pf_vote_handler_facet_keyed`. The single-tap policy is a UI-stream behavior (one click → one envelope; no intermediate UI state) — Vitest + Playwright is the right test layering.
- **Not the moderator surface.** The moderator does not vote on proposals (the moderator commits them after unanimity); the moderator's vote-button surface (the per-other-voter indicator dots in the sidebar) is read-only. The single-tap policy this leaf pins is participant-only.
- **Not the audience surface.** The audience is read-only by ADR 0029; no vote buttons mount there.

## Why it needs to be done

The single-tap-no-confirmation posture is the methodology's UX choice — `docs/participant-ui.md` line 84 settles it: *"The vote is recorded immediately (single-tap; no confirmation modal — the methodology already provides deliberation)."* Line 139 reinforces it: *"Tap a vote button — single tap, no modal confirmation, vote lands immediately."* The rationale is methodology-motivated: the debate phase preceding a proposal IS the deliberation; a confirmation modal at the vote moment would re-litigate the deliberation that already happened.

Both the detail-panel surface (`ParticipantVoteButtons.tsx`, shipped under `pf_part_detail_panel_three_facet_rows`) and the pane chip surface (`ProposalFacetVoteButtons.tsx`, shipped under `part_vote_button_per_facet`) already implement the policy correctly. What's missing is **regression pinning** — a committed test that fails if a future polish leaf accidentally introduces:

1. An intermediate "armed" / "confirm" state between click and dispatch (the way the withdraw button's two-stage gesture works).
2. A modal/dialog mounted between click and ack.
3. A multi-fire bug where two rapid clicks dispatch two votes.

Without the pin, the policy would survive only as docs prose — and `docs/participant-ui.md` is not consulted by the test gate. Three downstream leaves explicitly depend on the policy holding:

1. **`part_voting.part_change_vote_pre_commit`** (1d) — the pre-commit re-vote window. Its acceptance criteria need to assume single-tap holds; without the pin, the sibling could land a confirmation-modal "are you sure you want to change your vote?" interaction that's incompatible with the methodology.
2. **`part_voting.part_agree_all_gesture`** (0.5d) — the row-level "agree all" button. Without the pin, the sibling could land a per-chip confirmation step before each cascaded vote dispatch, which would defeat the gesture's purpose.
3. **Replay-test parity (`replay_test.*` chain)** — the test-mode replay surface walks the same vote-button seam; the single-tap policy must hold there too for replay scenarios to remain deterministic.

Architecturally this leaf **closes the deferred-e2e debt loop** from `part_ws_client` Decision §7: vote-send Playwright assertions defer to "the first leaf that surfaces a vote button" — that was `part_vote_button_per_facet`, which paid down the click → ack → render-update portion; this leaf adds the no-modal / no-armed-state policy-pin assertion that completes the inheritance.

## Inputs / context

### Design + ADRs

- [DESIGN.md](../../../DESIGN.md) — agreement-driven graph editing; the methodology's deliberation phase is the rationale for single-tap voting.
- [docs/participant-ui.md — P2 Vote on a pending proposal](../../../docs/participant-ui.md#L78-L89) lines 78-89. Line 84 is the canonical settlement of the single-tap policy: *"The vote is recorded immediately (single-tap; no confirmation modal — the methodology already provides deliberation)."*
- [docs/participant-ui.md — P3 Withdraw agreement](../../../docs/participant-ui.md#L91-L99) lines 91-99. Line 96-97 settles the withdraw exception: withdrawal is two-tap with a confirmation step *"since it reverses an agreement that was provisionally final"*. The single-tap-vs-withdrawal asymmetry is methodology-pinned here.
- [docs/participant-ui.md — Operative flow summary](../../../docs/participant-ui.md#L137-L141) lines 137-141. Line 139 reinforces: *"Tap a vote button — single tap, no modal confirmation, vote lands immediately."*
- [ADR 0022 — no throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md) — every check below is a committed Vitest / Playwright case.
- [ADR 0024 — frontend i18n](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md) — the policy-pin tests assert against the existing `participant.voteButton.*` keys; no new keys.
- [ADR 0026 — micro-frontend root app](../../../docs/adr/0026-micro-frontend-root-app.md) — participant surface owns its mounted tree.
- [ADR 0030 — Per-facet vote keying and sequential capture](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md) — §3 defines `withdraw-agreement` as a separate event kind; the vote / withdraw asymmetry is settled here.

### Sibling refinements

- [`tasks/refinements/participant-ui/part_vote_button_per_facet.md`](part_vote_button_per_facet.md) — the predecessor. Out-of-scope line 33 names THIS leaf as "pins the single-tap-no-confirmation posture for ALL vote affordances; this leaf renders single-tap buttons by default ... and the sibling polishes / formalizes the rule." The current refinement IS the formalization.
- [`tasks/refinements/per-facet-refactor/pf_part_detail_panel_three_facet_rows.md`](../per-facet-refactor/pf_part_detail_panel_three_facet_rows.md) — established the detail-panel vote-button surface. The `participant-vote-button-{agree,dispute,withdraw}` testid family, the `data-vote-state` attribute, and the single-tap click handler all originate here.
- [`tasks/refinements/participant-ui/part_ws_client.md`](part_ws_client.md) — Decision §7 + the "UI-stream e2e policy" section name `part_vote_single_tap` as the inheritor of vote-send Playwright debt. This leaf's Playwright extension closes the loop.

### Live code the surface plugs into

- [`apps/participant/src/detail/ParticipantVoteButtons.tsx`](../../../apps/participant/src/detail/ParticipantVoteButtons.tsx) — detail-panel vote buttons. Already implements single-tap (line 1131 dispatches via `castVote(choice)`; no intermediate state). `data-vote-state="enabled" | "in-flight"` is the only post-click DOM state change. The withdraw button (line ~1080) is the ONE armed-button two-stage gesture in the file; the policy-pin tests must distinguish.
- [`apps/participant/src/proposals/ProposalFacetVoteButtons.tsx`](../../../apps/participant/src/proposals/ProposalFacetVoteButtons.tsx) — pane chip vote buttons. Already implements single-tap (line 115-117 onClick → `castVote(choice)`; no intermediate state). `data-vote-state="enabled" | "in-flight"` on each button mirrors the detail-panel posture.
- [`apps/participant/src/detail/useVoteAction.ts`](../../../apps/participant/src/detail/useVoteAction.ts) — the shared hook both surfaces consume. Lines ~261-263 implement the in-flight guard that prevents double-fire; lines ~258-319 implement the `castVote(choice)` dispatch. Synchronous flip from `enabled` → `in-flight`, async resolution on ack.
- [`apps/participant/src/detail/ParticipantVoteButtons.test.tsx`](../../../apps/participant/src/detail/ParticipantVoteButtons.test.tsx) — extended with the new `describe` block. Existing 57+ cases stay unchanged.
- [`apps/participant/src/proposals/ProposalFacetVoteButtons.test.tsx`](../../../apps/participant/src/proposals/ProposalFacetVoteButtons.test.tsx) — extended with the new `describe` block.
- [`tests/e2e/participant-pending-proposals.spec.ts`](../../../tests/e2e/participant-pending-proposals.spec.ts) — step 9 gains the two no-modal assertions surrounding the click.
- [`apps/participant/src/stores/voteStore.ts`](../../../apps/participant/src/stores/voteStore.ts) — docstring update (lines 10-19). No behavioral change.

## Constraints / requirements

### Files this task touches (explicit allowlist)

- `apps/participant/src/detail/ParticipantVoteButtons.test.tsx` — extended with the new `describe('<ParticipantVoteButtons> — single-tap policy')` block (4 cases).
- `apps/participant/src/proposals/ProposalFacetVoteButtons.test.tsx` — extended with the mirror `describe('<ProposalFacetVoteButtons> — single-tap policy')` block (4 cases).
- `tests/e2e/participant-pending-proposals.spec.ts` — step 9 gains two new no-modal `expect(...)` assertions (i + ii above).
- `apps/participant/src/stores/voteStore.ts` — docstring update (lines 10-19 replace "future leaf" prose with present-tense pointer to `useVoteAction.ts`).

### Files this task does NOT touch

- `apps/participant/src/detail/ParticipantVoteButtons.tsx` — byte-stable. The component already implements the policy.
- `apps/participant/src/proposals/ProposalFacetVoteButtons.tsx` — byte-stable.
- `apps/participant/src/detail/useVoteAction.ts` — byte-stable. The in-flight guard and dispatch shape are the policy's load-bearing implementation.
- `apps/participant/src/proposals/perProposalFacets.ts` + tests — unchanged. The selector is unaffected.
- `apps/participant/src/graph/ownVotes.ts` + test — unchanged.
- `apps/participant/src/proposals/PerProposalFacetBreakdown.tsx` + test — unchanged.
- `apps/participant/src/proposals/PendingProposalsPane.tsx` + test — unchanged. The pane integration is exercised by the e2e extension, not by additional Vitest cases.
- `apps/participant/src/stores/stores.test.tsx` — unchanged. The `useVoteStore` slice's own cases are untouched (only the slice file's docstring changes).
- `apps/server/src/ws/handlers/vote.ts` — unchanged.
- `packages/shared-types/` — unchanged. No wire change.
- `packages/i18n-catalogs/` — unchanged. No new keys.
- `packages/shell/` — unchanged.
- `tests/e2e/methodology-full-flow.spec.ts` — unchanged. The detail-panel surface's policy pin lives in Vitest (Decision §3 — the unit-level pin is sufficient for the detail-panel surface because `methodology-full-flow.spec.ts` already exercises the click → ack → render-update flow end-to-end, and the Playwright `expect(dialog).toHaveCount(0)` extension on the pane spec covers the cross-surface invariant. Adding a parallel assertion to `methodology-full-flow.spec.ts` would duplicate the pin without adding signal — the detail-panel surface has no DOM-mounted dialog mechanism in the participant tree that the pane spec couldn't catch).
- `apps/moderator/` — unchanged. Moderator does not vote.
- `apps/audience/` — unchanged. Audience is read-only.
- `docs/adr/` — no new ADR. Decision §6.
- `docs/participant-ui.md` — unchanged. The design doc already settles the policy.
- `tasks/40-participant-ui.tji` — `complete 100` marker lands at task-completion ritual time per [`tasks/refinements/README.md`](../README.md#L32-L42).

### Test layers per ADR 0022

Three pins, each anchoring a different observable property:

1. **Vitest `ParticipantVoteButtons.test.tsx` (extended)** — new `describe('<ParticipantVoteButtons> — single-tap policy')` block, four cases:
   - **(a) Single click → exactly one envelope.** Render the panel at `status === 'proposed'`; render-snapshot the row's `data-vote-state="enabled"`; fire one `click` on `participant-vote-button-agree`; assert `useWsClient().send` was called exactly once with `('vote', { ...agree-payload... })`; assert the row's `data-vote-state` is now `"in-flight"`. No intermediate render pass shows `"armed"` or any other state.
   - **(b) No armed / confirm label permutation.** Across the lifecycle (enabled → in-flight → resolved → enabled-again), the button's text content takes values from `{ t('participant.voteButton.agreeLabel'), t('participant.voteButton.inFlightLabel') }` only. Specifically, the test asserts the rendered text is NEVER equal to any string containing `"Confirm"` or `"Are you sure"` or matching the withdraw button's confirm-label permutation (`t('participant.voteButton.confirmWithdrawLabel')`). Symmetric case for `participant-vote-button-dispute`.
   - **(c) No dialog / modal mounts.** Across the same lifecycle, `screen.queryByRole('dialog')` returns null at every observable render pass; `screen.queryByLabelText(/aria-modal=true/)` returns null; no DOM node with `role="dialog"` or `aria-modal="true"` is ever inserted. The check runs at three sample points: pre-click, post-click-pre-ack, post-ack.
   - **(d) Two rapid clicks dispatch once.** Render at `status === 'proposed'`; fire two `click` events on `participant-vote-button-agree` synchronously in the same act() (no await between them); assert `useWsClient().send` was called exactly ONCE (the second click hits the `disabled={inFlight}` no-op branch). Symmetric for dispute.

2. **Vitest `ProposalFacetVoteButtons.test.tsx` (extended)** — mirror `describe('<ProposalFacetVoteButtons> — single-tap policy')` block, four cases (e)-(h) — same four assertions ported to the pane testid family (`participant-pending-proposal-row-facet-vote-button-{agree,dispute}`). The pane surface uses the same `useVoteAction` hook the detail panel uses; the in-flight guard and the no-modal invariant transfer.

3. **Playwright extension to `tests/e2e/participant-pending-proposals.spec.ts`** — step 9 gains two assertions:
   - Immediately after `await chip.getByTestId('participant-pending-proposal-row-facet-vote-button-agree').click()`, BEFORE the existing `expect.poll(...)` runs: `await expect(page.locator('[role="dialog"]')).toHaveCount(0);` AND `await expect(page.locator('[aria-modal="true"]')).toHaveCount(0);`.
   - The existing `count → 0` (own-vote-hides) assertion stays unchanged.

### What the new code MUST NOT do

- **No new components.** This leaf adds tests + a docstring update only.
- **No production code changes to vote-button components.** Both surfaces already implement the policy correctly; changing the components would risk introducing the very drift the pin is meant to prevent.
- **No new i18n keys.** The negative test in (b) asserts the rendered text is NEVER from a `confirmLabel` set — but the detail panel's `t('participant.voteButton.confirmWithdrawLabel')` IS an existing key (the withdraw flow uses it). The test asserts the AGREE/DISPUTE buttons do not surface it.
- **No new test fixtures.** All Vitest cases reuse the existing wrapper / mocked-client / seeded-events idioms from the file's prior cases. The Playwright extension reuses the existing step 8 chip-expansion + chip-visible setup.
- **No new ADR.** Decision §6.
- **No deletion of `apps/participant/src/stores/voteStore.ts`.** Only the docstring (lines 10-19) is updated. The slice survives untouched; the docstring fix prevents the file from advertising itself as a future-leaf consumer that never materialized.

### Budget honesty (0.5d ≈ 4h)

- ~20 min: write the four Vitest cases in `ParticipantVoteButtons.test.tsx` (a)-(d). The wrapper + mocked-client idioms exist in the file's prior cases; the new cases compose them.
- ~20 min: write the four mirror Vitest cases in `ProposalFacetVoteButtons.test.tsx` (e)-(h).
- ~15 min: extend `participant-pending-proposals.spec.ts` step 9 with the two no-modal assertions; re-run the spec locally under `make up`.
- ~5 min: update the docstring at `apps/participant/src/stores/voteStore.ts` lines 10-19.
- ~30 min: full `pnpm run check` + `pnpm run test:smoke` + `pnpm run test:e2e --project=chromium-participant-skeleton` + `pnpm run test:e2e --project=chromium-methodology-full-flow` to confirm regression on neither the new pins nor the predecessors.
- ~30 min: task-completion ritual — `## Status` block, `complete 100` in [tasks/40-participant-ui.tji](../../40-participant-ui.tji) line 251, `tj3 project.tjp` clean-parse check.
- ~60 min: buffer for Vitest mock setup nuances (`useWsClient` mock per-call assertion shape; the mocked `useVoteAction` slot's in-flight flag toggling for the rapid-click test; ensuring the `role="dialog"` query covers the participant's rendered tree without false negatives from outside the participant subtree).

Risk surface is small. The main hazard is the rapid-click test (d) — synchronous double-`click` in `act()` may or may not honor the `disabled={inFlight}` guard depending on React's event-batching semantics in the test renderer. The mitigation: the test asserts the WS `send` mock was called once (the production behavior), not that React did or didn't schedule a second render. The second hazard is the no-modal assertion in Playwright running too quickly — if the assertion fires before any hypothetical modal would mount, the test passes vacuously. The mitigation: the assertion runs AFTER the click is awaited (which awaits Playwright's microtask scheduling) but BEFORE the `expect.poll(...)` for own-vote-hides — at that window, a confirmation modal (if introduced by a future bug) would already be mounted because confirmation modals mount synchronously on click in React's render cycle.

## Acceptance criteria

Per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md), every check below is a committed test or a script CI already runs.

1. **`pnpm install` clean** — no dep changes.
2. **`pnpm -F @a-conversa/participant typecheck` exits zero** — the new Vitest cases compile under TypeScript strict mode.
3. **`pnpm -F @a-conversa/participant build` exits zero** — bundle shape unchanged (only test files + a docstring change).
4. **`pnpm run check` stays green** (lint + format + typecheck + typecheck-tools + typecheck-tests).
5. **`pnpm run test:smoke` stays green; smoke count grows by +8** (4 from the detail-panel single-tap-policy block + 4 from the pane mirror block).
6. **`pnpm --filter @a-conversa/i18n-catalogs run check`** stays green — no new keys.
7. **`pnpm run test:e2e --project=chromium-participant-skeleton`** under `make up` runs the extended `participant-pending-proposals.spec.ts` green. Step 9's three assertions (two new no-modal + the existing own-vote-hides) all pass.
8. **`pnpm run test:e2e --project=chromium-methodology-full-flow`** stays green — the detail-panel surface's e2e is unaffected by Vitest-layer pins.
9. **`pnpm run test:e2e --project=chromium-moderator`** stays green — moderator surface unaffected.
10. **No file modifications outside the explicit allowlist** in Constraints → "Files this task touches".
11. **`<ParticipantVoteButtons>` and `<ProposalFacetVoteButtons>` source files byte-stable** — `git diff` for the two `.tsx` files (not `.test.tsx`) shows zero changes from `HEAD~1`.
12. **The new test cases assert the WITHDRAW button is exempt from the single-tap policy** — case (b) of `ParticipantVoteButtons.test.tsx` includes an explicit sub-assertion that `participant-vote-button-withdraw` DOES surface `t('participant.voteButton.confirmWithdrawLabel')` as its second-state label across the lifecycle (the withdraw two-stage gesture is the policy's named exception). Decision §2.
13. **`tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent** after `complete 100` lands on `part_vote_single_tap` per the task-completion ritual.
14. **Predecessor assertions unchanged** — every prior case in `ParticipantVoteButtons.test.tsx` (57+ cases) and `ProposalFacetVoteButtons.test.tsx` (12 cases) passes; the predecessor's Playwright steps 1-8 + the unchanged step 9 own-vote-hides assertion pass; the `participant-vote-button-{agree,dispute,withdraw}` + `participant-pending-proposal-row-facet-vote-button-{agree,dispute}` testid contracts are byte-stable.

## Decisions

### 1. Pin via Vitest + Playwright; no implementation code change

Three alternatives surveyed:

- **(A) Add Vitest pinning tests + one Playwright assertion + a docstring fix; no production code change** (chosen). The behavior is already correct in both surfaces. The risk this leaf addresses is FUTURE drift introduced by polish leaves; the right tool is a committed regression-pinning test, not a production code edit. The total scope is four detail-panel test cases + four pane-mirror test cases + two Playwright lines + a 10-line docstring replacement. Tight, well-bounded, no behavioral change.
- **(B) Refactor the click handler into a shared `useSingleTapDispatch` hook** so the policy is expressed as a code seam. Rejected. The current implementation IS the policy expressed as code (`onClick={() => castVote(choice)}` with no intermediate state); extracting it into a hook adds a layer that doesn't earn its keep at two call sites. The single-tap behavior is the absence of intermediate steps; a hook that "does nothing extra" between click and dispatch is the same code rearranged.
- **(C) Add an `enforceSingleTap()` invariant function** that runs as a runtime guard in dev mode. Rejected. The invariant is the click handler's shape (a synchronous one-liner that calls `castVote`); a runtime guard checking "no other state machine intercepted this click" is impossible to express without instrumenting React's render tree. Vitest's render-then-assert idiom is the practical pin.

The chosen approach mirrors how `pf_part_detail_panel_three_facet_rows` settled the facet-status enablement rule — tests pin the rule, no policy module abstracted.

### 2. The withdraw button is the named exception; case (b) asserts the asymmetry

ADR 0030 §3 settles withdrawal as its own gesture distinct from voting. The detail panel implements it as a two-stage armed-button: first click changes the button's label from `t('participant.voteButton.withdrawLabel')` to `t('participant.voteButton.confirmWithdrawLabel')` and arms the second click; the second click dispatches the `withdraw-agreement` envelope. This is intentional per `docs/participant-ui.md` line 99: *"Withdrawal is intentionally one extra tap compared to normal voting — it has larger consequences and merits a moment of confirmation."*

The policy-pin tests MUST distinguish: case (b) of `ParticipantVoteButtons.test.tsx` asserts:

- `participant-vote-button-agree` and `participant-vote-button-dispute` have label sets `{agreeLabel|disputeLabel, inFlightLabel}` (no third state).
- `participant-vote-button-withdraw` has the label set `{withdrawLabel, confirmWithdrawLabel, inFlightLabel}` (three states — the named exception).

The asymmetry is policy-load-bearing; the test makes it explicit so a future "unify the vote buttons" refactor cannot accidentally flatten the withdraw button into the single-tap shape.

The pane surface (`ProposalFacetVoteButtons.tsx`) does NOT render the withdraw button — the pane shows only agree+dispute affordances on votable statuses. Case (f) of the pane mirror block asserts the absence rather than the three-state asymmetry: the pane never surfaces `confirmWithdrawLabel` across the lifecycle.

### 3. Vitest-layer pin sufficient for the detail-panel surface; Playwright extension targets the pane

Three alternatives surveyed:

- **(A) Vitest pins both surfaces; Playwright extends only the pane spec** (chosen). The `methodology-full-flow.spec.ts` already exercises the detail-panel surface end-to-end (click → ack → render-update); the only new Playwright assertion that would add signal is the no-modal check, which is more naturally scoped to the pane spec because the pane spec already has step 9 clicking a vote button. Adding a parallel pair of assertions to `methodology-full-flow.spec.ts` would duplicate the no-modal pin at a second cross-process boundary without surfacing new failure modes — the no-modal invariant is a participant-tree property; if a modal regression landed, both specs would catch it.
- **(B) Playwright extends both specs** with the no-modal assertions. Rejected for the duplication reason above. The marginal coverage is zero; the maintenance cost (two specs to update if the assertion shape changes) is non-zero.
- **(C) Playwright extension drops; Vitest-only.** Rejected. The cross-process boundary IS where confirmation-modal drift would manifest first (a modal mounted at the route layer vs. the component layer would only show up in the e2e); the Playwright assertion costs two lines and pins the invariant where it matters.

The pane spec is the right home because it's the leaf that already mounts the click → ack flow and because its step 9 is the freshest predecessor work — the assertion lands in the same step that originally exercised the click.

### 4. Asymmetric scope: four cases per surface, not two

Three alternatives surveyed:

- **(A) Four cases per surface (eight total): single-click-one-envelope, no-armed-label, no-modal, two-rapid-clicks-once** (chosen). Each case anchors a distinct observable property. Combining them into fewer cases (e.g. one mega-test) would couple unrelated assertions; if any one of them regresses, splitting them later is the harder direction. Splitting them now is the cheaper pin.
- **(B) Two cases per surface (four total): "click dispatches" + "no-modal-and-no-armed-state combined".** Rejected. The combined case would mask which property failed if the test broke; the rapid-click property is a distinct race-condition concern that deserves its own case.
- **(C) Eight cases per surface (sixteen total) — exhaustive coverage including (e.g.) "click while ws disconnected", "click during reconnect", etc. Rejected as out-of-scope. Those failure modes are handled by `useVoteAction`'s error surface (already pinned in `useVoteAction.test.ts`); duplicating them at the component layer adds no signal.

The eight-cases-total scope matches the 0.5d budget; the rapid-click and no-modal cases are the load-bearing new pins.

### 5. The orphan `useVoteStore` slice: docstring fix only, no deletion

Three alternatives surveyed:

- **(A) Update the docstring; leave the slice in place** (chosen). The slice is exercised by its own `stores.test.tsx` cases (so deleting it would also require removing those cases); the slice does not consume runtime resources beyond the empty Zustand store; the slice's API surface (`setVote` / `removeVote` / `getVote`) is potentially reusable by the future `part_queued_local_vote_indicator` polish leaf (a "I tapped but it hasn't landed yet" indicator). Removing it now closes off the option; keeping it costs nothing.
- **(B) Delete the slice + its tests** (~0.25d cleanup). Rejected as out-of-scope per the orchestrator's "don't refactor beyond the task" guidance. If the slice never gets reused, register `part_orphan_vote_store_removal` (0.25d) as a future leaf — but this leaf does NOT register it.
- **(C) Update the docstring to deprecate the slice explicitly + add a `@deprecated` JSDoc tag.** Rejected. The slice isn't deprecated; it's idle. Marking it deprecated would commit to its eventual removal without a clear trigger; leaving the docstring informative (pointing at the active implementation in `useVoteAction.ts`) is the more honest posture.

The docstring update replaces the prose "`part_voting.part_vote_single_tap` (future leaf) which reads from this slice, sends via the shell's `useWsClient()`, and calls `removeVote(proposalId, facetId)` on the server's ack envelope" with "The active vote-dispatch path is `apps/participant/src/detail/useVoteAction.ts`; this slice was originally planned for the dispatch path but the active implementation took a different shape and the slice is currently unused outside its own tests. It remains as a potential home for a future queued-local-vote indicator."

### 6. No new ADR; the policy is already in `docs/participant-ui.md` + ADR 0030 §3

The single-tap-no-confirmation policy is documented in [`docs/participant-ui.md`](../../../docs/participant-ui.md#L84) lines 84 + 139 (the UX/methodology design doc); the asymmetric withdraw exception is settled by ADR 0030 §3. A new ADR titled "Single-tap voting (no confirmation modal)" would:

- Restate `docs/participant-ui.md` lines 84 / 139 verbatim.
- Restate ADR 0030 §3's withdrawal-is-separate ruling.
- Surface no new architectural seam, no new dependency, no new security trade-off.

The orchestrator's ADR criterion — "Genuinely new ADR-level decisions (new dependency, new architectural seam, security-relevant trade-off)" — is not met. The policy is a UX choice that lives in the design doc; the test pins this leaf adds are the implementation-side enforcement. Sibling refinements `pf_part_detail_panel_three_facet_rows` and `part_vote_button_per_facet` both decided NOT to spawn an ADR for the same reason (the vote-button vocabulary is shaped by ADR 0030 + the design doc, not by a fresh architectural choice).

If a future leaf surfaces a new dimension of the policy (e.g., "votes are batched server-side under condition X" or "an experimental confirmation flow ships behind a feature flag for usability testing"), that would be the ADR moment. Today's scope does not justify the overhead.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-26.

- Added `describe('<ParticipantVoteButtons> — single-tap policy')` block (4 cases: single-click/one-envelope, no-armed/confirm-label, no-dialog/aria-modal, two-rapid-clicks-once) to `apps/participant/src/detail/ParticipantVoteButtons.test.tsx`.
- Added mirror `describe('<ProposalFacetVoteButtons> — single-tap policy')` block (4 cases against pane testid family) to `apps/participant/src/proposals/ProposalFacetVoteButtons.test.tsx`.
- Extended `tests/e2e/participant-pending-proposals.spec.ts` step 9 with two no-modal assertions (`[role="dialog"]` count 0, `[aria-modal="true"]` count 0) immediately after the agree-click and before the own-vote-hides poll.
- Updated docstring at `apps/participant/src/stores/voteStore.ts` (lines 10-19) to replace stale "future leaf" prose with present-tense pointer to `useVoteAction.ts` as the active dispatch path.
- Vitest count grew by +8 (43 in ParticipantVoteButtons, 16 in ProposalFacetVoteButtons; 59/59 pass).
- All four driver-chain suites green: `pnpm run check`, `pnpm run test:smoke`, `pnpm run test:behavior:smoke`, `make test:e2e:compose`.
