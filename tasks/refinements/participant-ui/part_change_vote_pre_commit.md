# Allow vote change up to commit across participant vote surfaces

**TaskJuggler entry**: [tasks/40-participant-ui.tji](../../40-participant-ui.tji) — task `participant_ui.part_voting.part_change_vote_pre_commit`
**Effort estimate**: 1d
**Inherited dependencies**:

- `!participant_ui.part_voting.part_vote_single_tap` (settled — commit `1813e8e` pinned the single-tap-no-confirmation policy on both vote surfaces. The pin asserts: (a) one click → one envelope; (b) no armed/confirm label permutation for agree/dispute; (c) no modal mounted during the click → in-flight → ack window; (d) the `disabled={inFlight}` guard is the single-fire mechanism. **The pin explicitly names THIS leaf as an inheritor of the policy** ([`part_vote_single_tap.md` line 26](part_vote_single_tap.md#L26)): *"The single-tap-no-confirmation policy this leaf pins APPLIES to the re-opened buttons too — the sibling MUST NOT introduce a 'confirm vote change' modal."* That constraint binds this leaf's design.
- Prose-only context (NOT a `.tji` edge): `!participant_ui.part_voting.part_vote_button_per_facet` (settled — commit `5088234`. Established the `own-vote-hides-buttons` posture in [`ProposalFacetVoteButtons.tsx`](../../../apps/participant/src/proposals/ProposalFacetVoteButtons.tsx) lines 93–98 and mirrored the detail-panel posture from [`pf_part_detail_panel_three_facet_rows`](../per-facet-refactor/pf_part_detail_panel_three_facet_rows.md). The current gate hides ALL agree/dispute buttons once `ownVote !== undefined` — the gate this leaf re-opens during the pre-commit window. Out-of-scope line 33 of that refinement explicitly names THIS leaf as the re-opener.
- Prose-only context (NOT a `.tji` edge): `!backend.websocket_protocol.ws_vote_message` (settled — server already supports latest-vote-wins for pre-commit swaps. [`apps/server/src/methodology/handlers/vote.ts`](../../../apps/server/src/methodology/handlers/vote.ts) lines 209–224 accept an `agree → dispute` or `dispute → agree` flip while the facet is not yet committed; line 181–187 reject any vote on a `committed` facet with `reason: 'proposal-already-committed'`. **No server-side change is needed** — the wire already supports change-vote semantics; this leaf only re-opens the client-side UI gate that was suppressing the affordance.
- Prose-only context (NOT a `.tji` edge): `!per_facet_refactor.pf_part_vote_action_facet_keyed` (settled — [`useVoteAction.castVote`](../../../apps/participant/src/detail/useVoteAction.ts) lines 258–319 dispatches the `vote` envelope for both first-vote and change-vote calls; no client-side guard prevents a second envelope with a different choice. The hook is change-vote-ready; only the consumer's render gate was suppressing the affordance).
- Prose-only context (NOT a `.tji` edge): ADR 0030 §3 + §7 (settled — §3 keeps `withdraw-agreement` distinct from `vote`; this leaf does NOT touch the withdraw flow. §7 settles supersession-clearing: when a new candidate value lands on a facet, `ownVote` clears and both buttons re-appear automatically; this leaf's gate change interacts cleanly with that behavior).

## What this task is

Re-open the agree/dispute affordance during the **pre-commit window** so a participant can flip their vote (`agree → dispute` or `dispute → agree`) any time after their first vote and before the moderator commits the facet. Today both vote surfaces hide ALL agree/dispute buttons once `ownVote !== undefined`; this leaf changes the gate so that the **opposite-of-ownVote button stays visible** as a change-vote affordance until the facet's status becomes `'committed'` (or otherwise drops out of the pre-commit set).

Concretely:

- [`apps/participant/src/proposals/ProposalFacetVoteButtons.tsx`](../../../apps/participant/src/proposals/ProposalFacetVoteButtons.tsx) — the pane chip's vote-button block.
  - **`VOTABLE_STATUSES`** (line 41) is extended from `{proposed, disputed, withdrawn}` to `{proposed, disputed, withdrawn, agreed}`. `'agreed'` is added because it is in the pre-commit window: every current participant has voted agree but the moderator has not yet committed; a participant who changes their mind MUST be able to flip to dispute and break unanimity. The server-side rule already accepts the flip from `'agreed'` (vote.ts line 181 only rejects `'committed'`).
  - **The render gate** (lines 93–98) drops the `ownVote === undefined` clause. The component renders whenever `VOTABLE_STATUSES.has(status)` (plus the existing structural-arm guard) — both pre-vote and post-vote.
  - **The `VOTE_CHOICES.map` body** (lines 105–122) is wrapped in a filter: when `ownVote !== undefined`, the **chosen-side button is suppressed** and only the **opposite-of-ownVote button** renders. When `ownVote === undefined` (first-vote case) both buttons render as today. The single-button branch carries `data-vote-mode="change"`; the two-button branch carries `data-vote-mode="first"` on each button. The testid family (`participant-pending-proposal-row-facet-vote-button-{agree,dispute}`) is byte-stable — only the rendered subset narrows.
  - The opposite-button's `aria-label` uses a new i18n ICU pattern `participant.voteButton.changeAriaLabel` (`"{choice, select, agree {Change your vote to Agree} dispute {Change your vote to Dispute} other {Change your vote}}"`); the first-vote case keeps the existing `participant.voteButton.ariaLabel`. Decision §3.
- [`apps/participant/src/detail/ParticipantVoteButtons.tsx`](../../../apps/participant/src/detail/ParticipantVoteButtons.tsx) — the detail-panel facet-row vote buttons.
  - **The `choices` memo** (lines 914–941, `case 'proposed' | 'disputed' | 'withdrawn'`) is extended: when `ownVote !== undefined`, instead of returning `null`, it returns the **single-element opposite-of-ownVote subset** of `FACET_VOTE_CHOICES`. When `ownVote === undefined`, it returns `FACET_VOTE_CHOICES` as today.
  - **The `'agreed' | 'committed'` case** (lines 922–933) is split: `'agreed'` now mirrors the `'proposed' | 'disputed' | 'withdrawn'` branch (returns the opposite-of-ownVote subset when `ownVote !== undefined`, or `FACET_VOTE_CHOICES` otherwise). `'committed'` keeps the existing `['withdraw']` return — withdrawal is the only post-commit affordance per ADR 0030 §3. Decision §2.
  - **The `'proposal'` synthetic-facet branch** (line 915–917, the structural sub-kind path) keeps the `ownVote !== undefined ? null : STRUCTURAL_VOTE_CHOICES` gate as today. Decision §4 explains why structural votes are exempt.
  - **The "You voted X" indicator** (lines 1000–1017, `OWN_VOTE_INDICATOR_TESTID`) remains rendered alongside the now-visible change-vote button. The indicator preserves the at-a-glance "which way did I vote" cue; the button preserves the change-vote affordance. The two coexist when `ownVote !== undefined && choices !== null`. The render condition for the indicator changes from `choices === null && ownVote !== undefined` to simply `ownVote !== undefined` (plus the structural-facet exclusion that already lives in the surrounding code). Decision §5.
  - The opposite-button's `aria-label` uses the new `participant.voteButton.changeAriaLabel` key. The button's text label keeps `t(LABEL_KEY[choice])` (just "Agree" / "Dispute") — the change-vote semantics are surfaced via aria + the adjacent "You voted X" indicator + the visible reduction from two buttons to one.
- [`apps/participant/src/proposals/ProposalFacetVoteButtons.test.tsx`](../../../apps/participant/src/proposals/ProposalFacetVoteButtons.test.tsx) — extended with a `describe('<ProposalFacetVoteButtons> — pre-commit change vote')` block covering:
  - (a) `status === 'proposed', ownVote === undefined` → both buttons render (regression on the predecessor first-vote path).
  - (b) `status === 'proposed', ownVote === 'agree'` → only the dispute button renders (`participant-pending-proposal-row-facet-vote-button-agree` is NOT in the DOM; `…-dispute` IS); the dispute button carries `data-vote-mode="change"` and aria-label from `participant.voteButton.changeAriaLabel`.
  - (c) `status === 'proposed', ownVote === 'dispute'` → mirror of (b) with sides swapped.
  - (d) `status === 'agreed', ownVote === 'agree'` → the dispute button renders (the agreed-pre-commit flip path; previously the whole component returned null because `'agreed'` was not in `VOTABLE_STATUSES`).
  - (e) `status === 'committed', ownVote === 'agree'` → component returns null (post-commit: no vote affordance in the pane; withdrawal lives on the detail panel).
  - (f) **Single-tap policy still holds on the change-vote button**: with `ownVote === 'agree'`, two rapid clicks on the dispute button dispatch the vote envelope exactly once (the `disabled={inFlight}` guard fires). No `[role="dialog"]` mounts during click → ack. (This is the case that closes the inheritance loop from `part_vote_single_tap` line 26.)
  - (g) After the change-vote envelope's ack flips `ownVote` from `'agree'` to `'dispute'`, the component re-renders with the agree button visible (and the dispute button hidden). The render reflects the new own-vote state without manual remount.
- [`apps/participant/src/detail/ParticipantVoteButtons.test.tsx`](../../../apps/participant/src/detail/ParticipantVoteButtons.test.tsx) — extended with a mirror `describe('<ParticipantVoteButtons> — pre-commit change vote')` block covering the same seven cases against the detail-panel testid family (`participant-vote-button-{agree,dispute}`), plus two detail-panel-specific cases:
  - (h) The `OWN_VOTE_INDICATOR_TESTID` "You voted Agree" element renders ALONGSIDE the visible dispute button (not as a replacement). Both DOM nodes coexist in the row.
  - (i) `status === 'committed', ownVote === 'agree'` on a real facet row → the withdraw button renders (existing behavior; regression-pin) and NO agree/dispute change-vote button renders.
- [`tests/e2e/participant-pending-proposals.spec.ts`](../../../tests/e2e/participant-pending-proposals.spec.ts) — extended with a new step 10 immediately after the predecessor's step 9 (click agree → ack → agree-button-hides):
  - **Step 10 (change vote)**: assert the opposite-side button (`participant-pending-proposal-row-facet-vote-button-dispute`) IS visible after the step-9 agree-vote acks (where previously it was hidden too). Click it; assert the envelope is dispatched (`expect.poll` on the WS-bus mock if available, else assert the dispute button's `data-vote-state` flips to `"in-flight"`); after ack, assert the agree button comes back visible and the dispute button hides. The single-tap policy assertions from `part_vote_single_tap` (no `[role="dialog"]`, no `[aria-modal="true"]`) run again around the change-vote click for symmetric coverage.
- [`packages/i18n-catalogs/src/catalogs/en-US.json`](../../../packages/i18n-catalogs/src/catalogs/en-US.json) — adds one new key under `participant.voteButton`: `"changeAriaLabel": "{choice, select, agree {Change your vote to Agree} dispute {Change your vote to Dispute} other {Change your vote}}"`. Mirrored translations land in `pt-BR.json` and `es-419.json`; the two `.review.json` files capture the new key with `"_review_status": "needs-review"` per the i18n review workflow.
- [`docs/participant-ui.md`](../../../docs/participant-ui.md) — one prose update under the P2 section adding: *"A participant may change their vote (agree ↔ dispute) at any time before the moderator commits the facet. The opposite-of-current-vote button remains visible alongside the 'You voted X' indicator; tapping it dispatches a fresh `vote` envelope (the server applies latest-vote-wins per ADR 0030)."* Decision §6 covers why this prose addition is in-scope.

Out of scope (deferred to sibling or future leaves):

- **Not the agree-all gesture.** Sibling `part_voting.part_agree_all_gesture` (0.5d) lands a per-proposal-bundle "agree all" affordance. The change-vote semantics this leaf introduces APPLY there too — once a participant has used "agree all" and wants to flip a single facet to dispute, the per-chip change-vote affordance this leaf adds is the path. The sibling does NOT need to add a "change all" inverse; per-chip flips are sufficient.
- **Not the proposal-notification visual flash.** Sibling `part_voting.part_proposal_notification` (1d) handles new-proposal arrival animation. Unrelated.
- **Not the withdraw affordance.** ADR 0030 §3 keeps `withdraw-agreement` as a separate gesture with its own two-stage confirmation. The withdraw button is post-commit only; this leaf's change-vote affordance is pre-commit only. The two flows never overlap on the same row at the same time (status is `committed` xor pre-commit-set).
- **Not optimistic local-state updates.** The pessimistic-wait posture (`disabled={inFlight}` on the change-vote button) is preserved. A future polish leaf may add a "queued change-vote" indicator if user testing surfaces the ack-latency confusing debaters; named `part_queued_local_vote_indicator` (0.5d) is the registration target per `part_vote_single_tap.md` line 30 — this leaf does NOT register it.
- **Not a "change vote" confirmation modal.** Per the inherited constraint from `part_vote_single_tap` (line 26), the change-vote affordance MUST be single-tap. The methodology rationale that justified single-tap for first-vote (deliberation already happened) holds for change-vote too — a participant changing their mind has already deliberated. The single-tap-policy Vitest pins from the predecessor catch any drift here, and case (f) of this leaf's new test block adds a pre-commit-change-specific pin for redundancy.
- **Not the moderator surface.** The moderator does not vote on proposals; the moderator's "commit" action transitions the facet out of the pre-commit window. The change-vote affordance is participant-only.
- **Not the audience surface.** Audience is read-only per ADR 0029; no vote buttons.
- **Not the structural-proposal arm (`facet === 'proposal'`).** The structural sub-kind path keeps the existing `ownVote !== undefined ? null : STRUCTURAL_VOTE_CHOICES` gate. Decision §4 covers why.
- **Not a new ADR.** Decision §7.
- **Not a new Cucumber scenario.** The wire shape is unchanged — the `vote` envelope already supports change-vote semantics and is pinned by the existing `tests/behavior/methodology/vote.feature` scenarios. The change is UI-stream only.
- **Not the orphan `useVoteStore` removal.** `part_vote_single_tap.md` Decision §5 documents the slice; if this leaf's change-vote semantics push a future "queued local vote" indicator into existence, the slice may become the home for that state. Removing it now closes off the option.

## Why it needs to be done

[`docs/participant-ui.md`](../../../docs/participant-ui.md) lines 84–89 describe vote casting. The methodology's commit step ([`docs/methodology.md`](../../../docs/methodology.md) lines 15–25) makes the moderator the structural enactor of agreement — the participant retains agency over their vote until that commit happens. The current UI **silently revokes that agency** by hiding the affordance: a participant who voted agree, then heard a debate argument that changed their mind, has no path to flip to dispute through the UI (their only options are wait-for-someone-else-to-dispute or hope the moderator hasn't committed yet and the candidate value changes triggering supersession-clear).

The methodology contract is asymmetric and load-bearing:

1. **Pre-commit**: vote is provisional; a participant may flip agree ↔ dispute freely. The server already accepts this ([`vote.ts`](../../../apps/server/src/methodology/handlers/vote.ts) lines 209–224).
2. **Post-commit**: vote is locked; the only path back is `withdraw-agreement`, which goes through the two-stage confirmation per ADR 0030 §3.

The current UI only honors the post-commit half — the pre-commit half is silently suppressed. This leaf closes the gap.

Two downstream leaves depend on the change-vote affordance:

1. **`replay_test.*` chain** — replay scenarios that exercise the methodology's "flip vote before commit" path need a UI affordance to drive the flip. Without this leaf, the replay would have to seed the flip-vote event directly (bypassing the UI), which weakens the test's coverage of the participant-facing surface.
2. **Real participant feedback (post-MVP)** — early user testing of the participant surface is likely to surface "I can't change my mind" as a complaint within the first session; this leaf is on the critical path for the P2 milestone's usability.

Architecturally this leaf is **the smallest possible change** to honor the methodology: the server already does the right thing, the dispatch hook already supports it, the testid families are byte-stable; only the render gate in two components changes. The `VOTABLE_STATUSES` extension (adding `'agreed'`) is the one "new" decision, and it falls cleanly out of the "pre-commit means not-committed" definition.

## Inputs / context

### Design + ADRs

- [DESIGN.md](../../../DESIGN.md) — agreement-driven graph editing; participant agency over their vote until commit is core to the model.
- [docs/methodology.md — Commit step](../../../docs/methodology.md#L15-L25) lines 15–25. Settles: moderator commits when unanimity is observed; participants retain change-vote agency until that moment.
- [docs/participant-ui.md — P2 Vote on a pending proposal](../../../docs/participant-ui.md#L78-L89) lines 78–89. The page gets one new paragraph noting change-vote semantics per Decision §6.
- [docs/participant-ui.md — Operative flow summary](../../../docs/participant-ui.md#L137-L141) line 139. Already settles single-tap; this leaf preserves the policy on the change-vote button.
- [ADR 0022 — no throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md) — every check below is a committed test.
- [ADR 0024 — frontend i18n](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md) — the new `participant.voteButton.changeAriaLabel` key uses the existing ICU `select` shape; review workflow per `packages/i18n-catalogs/`.
- [ADR 0026 — micro-frontend root app](../../../docs/adr/0026-micro-frontend-root-app.md) — participant surface owns its mounted tree.
- [ADR 0030 — Per-facet vote keying and sequential capture](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md) — §3 (withdraw is separate); §7 (supersession-clear when new candidate lands). Both interact cleanly with the change-vote gate.

### Sibling refinements

- [`tasks/refinements/participant-ui/part_vote_single_tap.md`](part_vote_single_tap.md) — line 26 binds this leaf to the single-tap policy on the change-vote button.
- [`tasks/refinements/participant-ui/part_vote_button_per_facet.md`](part_vote_button_per_facet.md) — established the own-vote-hides gate; out-of-scope line 33 names this leaf as the re-opener.
- [`tasks/refinements/per-facet-refactor/pf_part_detail_panel_three_facet_rows.md`](../per-facet-refactor/pf_part_detail_panel_three_facet_rows.md) — established the detail-panel `choices` memo shape this leaf extends.
- [`tasks/refinements/per-facet-refactor/pf_part_vote_action_facet_keyed.md`](../per-facet-refactor/pf_part_vote_action_facet_keyed.md) — established `useVoteAction`'s facet-keyed dispatch; the change-vote envelope rides the same path.
- [`tasks/refinements/data-and-methodology/commit_logic.md`](../data-and-methodology/commit_logic.md) — moderator commit rules; the boundary between pre-commit and post-commit is defined here.

### Live code the surface plugs into

- [`apps/participant/src/proposals/ProposalFacetVoteButtons.tsx`](../../../apps/participant/src/proposals/ProposalFacetVoteButtons.tsx) — pane chip vote buttons. Lines 41–45 (`VOTABLE_STATUSES`), 66–74 (`ownVote` memo), 93–98 (render gate), 105–122 (button rendering loop).
- [`apps/participant/src/detail/ParticipantVoteButtons.tsx`](../../../apps/participant/src/detail/ParticipantVoteButtons.tsx) — detail-panel facet-row vote buttons. Lines 914–941 (`choices` memo), 1000–1017 (own-vote indicator).
- [`apps/participant/src/detail/useVoteAction.ts`](../../../apps/participant/src/detail/useVoteAction.ts) — `castVote` dispatch (lines 258–319). Byte-stable.
- [`apps/participant/src/graph/ownVotes.ts`](../../../apps/participant/src/graph/ownVotes.ts) — `OwnFacetVoteIndex` projector that flips `ownVote` on the change-vote ack. Byte-stable.
- [`apps/server/src/methodology/handlers/vote.ts`](../../../apps/server/src/methodology/handlers/vote.ts) — server-side latest-vote-wins for pre-commit; lines 181–187 (committed rejection), 209–224 (same-choice rejection / opposite-choice acceptance). Byte-stable.
- [`apps/server/src/projection/facet-status.ts`](../../../apps/server/src/projection/facet-status.ts) — facet status derivation; the `'agreed'` status (rule 7) is what justifies extending `VOTABLE_STATUSES`. Byte-stable.
- [`apps/participant/src/proposals/PendingProposalsPane.tsx`](../../../apps/participant/src/proposals/PendingProposalsPane.tsx) — pane mount point; renders the `<ProposalFacetVoteButtons>` per chip. Byte-stable.
- [`tests/e2e/participant-pending-proposals.spec.ts`](../../../tests/e2e/participant-pending-proposals.spec.ts) — step 9 is the predecessor's click-agree-and-vanish test; step 10 (this leaf) adds the change-vote loop.
- [`packages/i18n-catalogs/src/catalogs/en-US.json`](../../../packages/i18n-catalogs/src/catalogs/en-US.json), `pt-BR.json`, `es-419.json` lines ~683–693 — `participant.voteButton` block; one new key lands here.

## Constraints / requirements

### Files this task touches (explicit allowlist)

- `apps/participant/src/proposals/ProposalFacetVoteButtons.tsx` — `VOTABLE_STATUSES` extended; render gate drops the `ownVote === undefined` clause; button-loop filters to opposite-of-ownVote when `ownVote !== undefined`; opposite-button `aria-label` switches to the change-vote key; comment block at the top updated to reflect the new pre-commit-change-vote posture.
- `apps/participant/src/proposals/ProposalFacetVoteButtons.test.tsx` — new `describe('<ProposalFacetVoteButtons> — pre-commit change vote')` block (7 cases a–g per "What this task is").
- `apps/participant/src/detail/ParticipantVoteButtons.tsx` — `choices` memo: `'agreed'` case split from `'committed'`; `'proposed' | 'disputed' | 'withdrawn'` + `'agreed'` cases return opposite-of-ownVote subset when `ownVote !== undefined`; own-vote indicator render condition relaxed from `choices === null && ownVote !== undefined` to `ownVote !== undefined` (with structural-facet exclusion preserved); opposite-button `aria-label` switches to the change-vote key.
- `apps/participant/src/detail/ParticipantVoteButtons.test.tsx` — mirror `describe('<ParticipantVoteButtons> — pre-commit change vote')` block (9 cases a–i per "What this task is").
- `tests/e2e/participant-pending-proposals.spec.ts` — new step 10 (change-vote loop) after step 9.
- `packages/i18n-catalogs/src/catalogs/en-US.json`, `pt-BR.json`, `es-419.json` — add `participant.voteButton.changeAriaLabel` key.
- `packages/i18n-catalogs/src/catalogs/pt-BR.review.json`, `es-419.review.json` — register the new key under `_review_status: "needs-review"` per the i18n review workflow.
- `docs/participant-ui.md` — one prose paragraph under the P2 section.
- `tasks/40-participant-ui.tji` line 257 — `complete 100` added under `allocate team` at task-completion ritual time per [`tasks/refinements/README.md`](../README.md#L32-L42).

### Files this task does NOT touch

- `apps/participant/src/detail/useVoteAction.ts` — byte-stable. The hook already supports change-vote dispatch.
- `apps/participant/src/graph/ownVotes.ts` + `apps/participant/src/graph/ownVotes.test.ts` — byte-stable. The `OwnFacetVoteIndex` projector flips on the ack envelope per ADR 0030; no projector change is needed for change-vote.
- `apps/participant/src/proposals/perProposalFacets.ts` + test — byte-stable. The selector is unaffected (only the render gate consuming it changes).
- `apps/participant/src/proposals/PerProposalFacetBreakdown.tsx` + test — byte-stable. The breakdown passes `ownFacetVotes` and `status` to `<ProposalFacetVoteButtons>`; the props shape is unchanged.
- `apps/participant/src/proposals/PendingProposalsPane.tsx` + test — byte-stable. The pane integration is exercised by the e2e step-10 extension.
- `apps/participant/src/stores/voteStore.ts` — byte-stable. The orphan slice is unaffected.
- `apps/server/src/ws/handlers/vote.ts` + `apps/server/src/methodology/handlers/vote.ts` — byte-stable. The server already supports latest-vote-wins for pre-commit.
- `apps/server/src/projection/facet-status.ts` — byte-stable. The 8 facet-status rules are unchanged; the client UI is the only consumer that changes its interpretation of `'agreed'`.
- `packages/shared-types/` — byte-stable. No wire change.
- `packages/shell/` — byte-stable.
- `tests/e2e/methodology-full-flow.spec.ts` — byte-stable. The detail-panel surface's change-vote pin lives in the unit-test layer; methodology-full-flow already exercises the click → ack → render-update path for first-vote and the new pin would duplicate the no-modal assertion that the pane spec already covers. Decision §8.
- `apps/moderator/` — byte-stable. Moderator does not vote.
- `apps/audience/` — byte-stable. Audience is read-only.
- `docs/adr/` — no new ADR. Decision §7.
- `tests/behavior/` — no new Cucumber scenario; the wire is unchanged.

### Test layers per ADR 0022

Four pins, each anchoring a different observable property:

1. **Vitest `ProposalFacetVoteButtons.test.tsx` (extended)** — seven cases (a–g) per "What this task is": first-vote regression, change-vote button visibility, agreed-pre-commit flip, post-commit hide, single-tap policy on change-vote button, ack-driven re-render. The single-tap-policy case (f) closes the inheritance loop from `part_vote_single_tap.md` line 26.
2. **Vitest `ParticipantVoteButtons.test.tsx` (extended)** — nine cases (a–i): mirror seven for the detail-panel testid family + (h) coexistence of `OWN_VOTE_INDICATOR_TESTID` with the change-vote button + (i) committed-status regression (withdraw button only, no change-vote button).
3. **Playwright extension to `tests/e2e/participant-pending-proposals.spec.ts` (step 10)** — drives the full pane change-vote loop end-to-end: from the step-9 post-ack state (agree-vote landed), assert dispute button visibility, click, assert in-flight, await ack, assert agree button comes back. Two single-tap policy assertions (`[role="dialog"]` count 0, `[aria-modal="true"]` count 0) wrap the change-vote click.
4. **i18n catalog tests** — `pnpm --filter @a-conversa/i18n-catalogs run check` validates the new key's ICU shape against the three locales; the review-workflow tests catch the unmarked pt-BR / es-419 translations until they're reviewed.

### What the new code MUST NOT do

- **No "confirm change vote" modal.** Inherited constraint from `part_vote_single_tap.md` line 26. The change-vote button MUST dispatch immediately on tap, with the pessimistic-wait posture as the only post-click state change.
- **No new wire envelope.** The `vote` envelope is unchanged; the server's latest-vote-wins rule does the rest.
- **No re-cast of the same choice.** The chosen-side button is HIDDEN (not just disabled) when `ownVote === <choice>`. This prevents the participant from dispatching a no-op envelope that the server would reject with `reason: 'already-voted'`. The hide is the UI-side enforcement of the server-side rule.
- **No change to the `useVoteAction` hook.** All change-vote semantics ride the existing `castVote(choice)` call.
- **No change to the `OwnFacetVoteIndex` projector.** The ack-driven flip is already correct per ADR 0030.
- **No optimistic update.** The change-vote button's pressed-state flips on the server's `event-applied` broadcast, same as first-vote.
- **No new component.** The render gate change is in-place; no new file in `apps/participant/`.
- **No new testid.** The existing `participant-pending-proposal-row-facet-vote-button-{agree,dispute}` and `participant-vote-button-{agree,dispute}` families are byte-stable; only the rendered subset narrows when `ownVote !== undefined`. The `data-vote-mode` attribute on the button is new (`"first" | "change"`); it carries the diagnostic signal for tests without breaking the testid contract.

### Budget honesty (1d ≈ 8h)

- ~30 min: extend `VOTABLE_STATUSES` and the render gate in `ProposalFacetVoteButtons.tsx`; update the file's header comment.
- ~30 min: split the `choices` memo in `ParticipantVoteButtons.tsx` (`'agreed'` from `'committed'`; opposite-of-ownVote subset for the pre-commit branches); relax the own-vote indicator condition.
- ~45 min: write the seven Vitest cases in `ProposalFacetVoteButtons.test.tsx`. The wrapper + mocked-client idioms exist; the new cases compose them.
- ~60 min: write the nine Vitest cases in `ParticipantVoteButtons.test.tsx`.
- ~45 min: add the new `participant.voteButton.changeAriaLabel` ICU key to all three catalogs + the two review files; run the catalog check.
- ~45 min: extend `participant-pending-proposals.spec.ts` with step 10; re-run the spec locally under `make up`.
- ~15 min: prose update to `docs/participant-ui.md` P2 section.
- ~45 min: full `pnpm run check` + `pnpm run test:smoke` + `pnpm run test:behavior:smoke` + `make test:e2e:compose` for the participant project.
- ~60 min: task-completion ritual — `## Status` block, `complete 100` at [tasks/40-participant-ui.tji](../../40-participant-ui.tji) line 257 (under `allocate team`), `tj3 project.tjp` clean-parse check.
- ~120 min: buffer for: (i) Vitest mock setup for the ack-driven re-render case (g); (ii) Playwright `expect.poll` shape for the change-vote ack (the existing step 9 pattern is the template); (iii) i18n review-file shape verification (the pt-BR / es-419 review file conventions per [`packages/i18n-catalogs/README.md`](../../../packages/i18n-catalogs/README.md)); (iv) detail-panel test wrapper nuance — the test wrapper must seed both `events` and `currentParticipantId` so `ownVote` derives correctly for cases (b)–(d), (g), (h).

Risk surface is moderate. The main hazards:

- **(a) The `'agreed'` extension might surface a latent server-side rule** I haven't seen. Mitigation: ad-hoc test the flow under `make up` before landing — manually drive a session to unanimity, then click dispute on one chip; assert the server accepts (returns no error) and the projection re-derives status to `'disputed'` or `'proposed'` per rules 5/8. If the server rejects, the refinement is wrong and the leaf splits into a 2-step (server rule change + UI change). Investigating the server's vote handler (`vote.ts` lines 181–224) suggests this won't happen — only the `'committed'` status gates re-votes — but a smoke-test before commit is cheap insurance.
- **(b) The detail-panel `'agreed'`-case split** changes the existing behavior (the row previously showed the withdraw button at `'agreed'`). The new behavior shows agree+dispute (or just one, if `ownVote !== undefined`). The withdraw button reappears only on `'committed'`. This is a behavior regression for one observable property — a participant in the `'agreed'` state who wanted to "withdraw" pre-commit currently can. After this leaf, they instead flip their own vote (which un-unanimous-es the facet, achieving the same outcome via a methodology-coherent path). Decision §2 covers the rationale; the existing detail-panel test cases for `'agreed'`-status rows will need their assertions updated (the migration is mechanical — assert "dispute button present" instead of "withdraw button present" for `ownVote === 'agree'` rows at status `'agreed'`).
- **(c) The new aria-label key** must not collide with any existing key. Mitigation: `pnpm --filter @a-conversa/i18n-catalogs run check` validates uniqueness; the existing `participant.voteButton` block has no `changeAriaLabel` neighbor.
- **(d) The Playwright step-10 extension** depends on the step-9 state. If the predecessor's step 9 is restructured by a future leaf, step 10 must follow. Mitigation: the step is appended (not interleaved) and uses the existing test scaffolding from step 9; the only cross-step dependency is the `chip` locator from step 8.

## Acceptance criteria

Per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md), every check below is a committed test or a script CI already runs.

1. **`pnpm install` clean** — no dep changes.
2. **`pnpm -F @a-conversa/participant typecheck` exits zero** — the new Vitest cases compile under TypeScript strict mode.
3. **`pnpm -F @a-conversa/participant build` exits zero** — bundle shape grows minimally (the `'agreed'` case split + the opposite-of-ownVote subset filter).
4. **`pnpm run check` stays green** (lint + format + typecheck + typecheck-tools + typecheck-tests).
5. **`pnpm run test:smoke` stays green; smoke count grows by +16** (7 from the pane change-vote block + 9 from the detail-panel change-vote block).
6. **`pnpm --filter @a-conversa/i18n-catalogs run check`** stays green — the new `participant.voteButton.changeAriaLabel` key validates against the ICU schema; the pt-BR / es-419 review files carry it under `_review_status: "needs-review"`.
7. **`pnpm run test:e2e --project=chromium-participant-skeleton`** under `make up` runs the extended `participant-pending-proposals.spec.ts` green. Step 10 (change-vote loop) passes; step 9 (predecessor) passes unchanged.
8. **`pnpm run test:e2e --project=chromium-methodology-full-flow`** stays green — the detail-panel surface's e2e is unaffected by Vitest-layer pins.
9. **`pnpm run test:e2e --project=chromium-moderator`** stays green — moderator surface unaffected.
10. **`pnpm run test:behavior:smoke`** stays green — wire shape is unchanged, no new Cucumber scenario; predecessor wire scenarios (`tests/behavior/methodology/vote.feature`) pass.
11. **No file modifications outside the explicit allowlist** in Constraints → "Files this task touches".
12. **`<ProposalFacetVoteButtons>` opposite-button-only invariant**: when rendered with `status === 'proposed' | 'disputed' | 'withdrawn' | 'agreed'` AND `ownVote !== undefined`, exactly ONE of `participant-pending-proposal-row-facet-vote-button-{agree,dispute}` is in the DOM, and it is the OPPOSITE of `ownVote`. Cases (b), (c), (d).
13. **`<ParticipantVoteButtons>` coexistence invariant**: when rendered with `status` in the pre-commit set AND `ownVote !== undefined`, both `OWN_VOTE_INDICATOR_TESTID` and the opposite-of-ownVote `participant-vote-button-{agree,dispute}` are in the DOM. Case (h).
14. **Single-tap policy preserved on change-vote**: a Vitest case in each test file (pane case (f); detail-panel case (f) of the mirror block) asserts two rapid clicks on the change-vote button dispatch one envelope, no `[role="dialog"]` mounts, no `[aria-modal="true"]` mounts. This closes the inheritance loop from `part_vote_single_tap.md` line 26.
15. **Committed-status regression preserved**: a Vitest case in each file ((e) for pane, (i) for detail-panel) asserts the pane component returns null and the detail-panel component renders the withdraw button only when `status === 'committed'`. The change-vote affordance does NOT bleed into post-commit.
16. **Predecessor assertions unchanged** — every prior case in `ParticipantVoteButtons.test.tsx` (~43 cases) and `ProposalFacetVoteButtons.test.tsx` (~16 cases) passes after the migration described in Risk (b); the existing `'agreed'`-status withdraw-button cases ARE updated to reflect the new behavior (assert change-vote button instead of withdraw button for `ownVote === 'agree' && status === 'agreed'`).
17. **`tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent** after `complete 100` lands on `part_change_vote_pre_commit` per the task-completion ritual.

## Decisions

### 1. Opposite-button-only (not "both buttons, chosen pressed")

Three alternatives surveyed:

- **(A) Show the opposite-of-ownVote button only; keep `OWN_VOTE_INDICATOR_TESTID` indicator alongside** (chosen). The chosen-side button is HIDDEN; the opposite-side button is the change-vote affordance. The "You voted X" indicator preserves the at-a-glance "which way did I vote" cue. Single affordance per row = unambiguous tap target. No risk of re-casting the same choice (the server would reject with `'already-voted'`; the UI prevents the no-op envelope by hiding the button).
- **(B) Show both buttons; chosen has `aria-pressed="true"` + `data-vote-state="own-choice"` + `disabled={true}`.** Rejected. Two-button-with-one-disabled is a more cluttered visual at the pane chip size (the chip is small; pressing two `<button>` elements with a disabled style competes for attention). The "pressed but disabled" pattern is also less common than the "single affordance" pattern in tap-driven UIs; it risks confusion. The only advantage is that it's "more discoverable" — but the adjacent "You voted X" indicator already makes the change-vote inference obvious in approach (A).
- **(C) Show only the opposite-of-ownVote button; drop the indicator.** Rejected. The indicator carries information not in the button's visible state — without it, a participant who refreshed the page sees a single "Dispute" button and has no idea whether they voted agree or whether they're voting for the first time. The indicator's "You voted Agree" text disambiguates.

Approach (A) is the minimum-friction change to the visible surface that preserves all the information the participant needs.

### 2. The `'agreed'`-status case in `ParticipantVoteButtons.tsx` splits from `'committed'`

Three alternatives surveyed:

- **(A) Split `'agreed'` from `'committed'`; `'agreed'` joins the pre-commit branches** (chosen). The current code lumps `'agreed' | 'committed' → ['withdraw']`; this is wrong by the methodology — `'agreed'` is unanimous-but-not-committed, still in the pre-commit window. The server accepts change-vote at `'agreed'` (vote.ts line 181 only rejects `'committed'`). The detail-panel surface MUST honor that. The split is small (one switch-case bifurcation).
- **(B) Leave `'agreed'` lumped with `'committed'`; rely on the pane's change-vote affordance only.** Rejected. The detail-panel is reachable from selecting a node/edge in the graph; a participant who selects an entity in the `'agreed'` state to read the candidate value and then realizes they want to flip their vote has no path forward on the detail panel under approach (B). They'd have to navigate to the proposals tab to use the pane affordance — a workflow regression vs. the simpler "click here to flip" affordance on the detail panel.
- **(C) Add a new `'pre-commit'` status code that bundles `'proposed' | 'disputed' | 'withdrawn' | 'agreed'`.** Rejected. The status codes are derived from event projection per the 8 rules in `facet-status.ts`; adding a synthetic status would require a projector change and would conflict with the rollup priority ordering. A `VOTABLE_STATUSES.has(status)` set check at the consumer is the right place to encode the "pre-commit-and-votable" derivation; no projector change needed.

The split changes one observable behavior: a participant in the `'agreed'` state currently sees the withdraw button on the detail panel; after this leaf they see the agree/dispute change-vote affordance. The methodology-coherent path to "I want to undo my agreement" pre-commit is to flip the vote (which un-unanimous-es the facet); post-commit it's withdrawal. The current behavior conflated the two; this leaf separates them.

### 3. New `participant.voteButton.changeAriaLabel` i18n key

Three alternatives surveyed:

- **(A) New `changeAriaLabel` ICU key; opposite-side button uses it; first-vote buttons keep `ariaLabel`** (chosen). Screen-reader users get explicit "Change your vote to Dispute" semantics, which disambiguates from the first-vote "Dispute this proposal" aria-label. The ICU `select` pattern mirrors the existing `ariaLabel` shape for consistency.
- **(B) Reuse the existing `ariaLabel` key; the change-vote semantics are inferred from the surrounding indicator** (no new key). Rejected. The aria-label for the dispute button at the change-vote moment would be "Dispute this proposal" — which is misleading because the participant has already voted agree; the button doesn't dispute the proposal in a fresh sense, it changes the participant's vote on it. Screen readers don't see the adjacent indicator's context-providing text in the same announcement.
- **(C) Add a wholly new key namespace `participant.voteChangeButton.*`** for the change-vote variant. Rejected. The button is the SAME button (same testid, same component, same handler); only its rendered context differs. A separate namespace would falsely suggest a different control.

Approach (A) is the standard i18n shape for "same control, semantically different context" — one new key under the existing block; ICU `select` for the choice variants.

### 4. Structural-proposal arm (`facet === 'proposal'`) keeps the existing gate

Three alternatives surveyed:

- **(A) Structural arm keeps `ownVote !== undefined ? null : STRUCTURAL_VOTE_CHOICES`** (chosen). Structural proposals (new-node / new-edge / change-target sub-kinds) ride a different vote-shape that includes three choices (`agree | dispute | withdraw`) at the proposal level (not per-facet). The pre-commit change-vote semantics may apply here too, but the surface is structurally different (one vote per proposal, not per facet) and the affordance shape (three buttons vs two) is different. Extending the change-vote affordance to the structural arm in this leaf would double the scope without clear methodology grounding for what "change a structural vote" means.
- **(B) Extend change-vote to structural too** in this leaf. Rejected. The structural-vote semantics are owned by the `pf_*` chain (per-facet refactor), not by `part_voting.*`. A separate task `part_voting.part_change_vote_structural` (0.5d) is the right home if user testing surfaces the need — this leaf does NOT register it; the structural surface is largely a transitional artifact per the per-facet refactor's ADR.
- **(C) Block all structural votes from this leaf's gate change** — error if `facet === 'proposal'`. Rejected. The structural arm doesn't need a behavioral change; it just needs to NOT inherit the new pre-commit-change behavior. Leaving the existing gate in place achieves that.

The structural arm exemption is documented in the file's header comment so a future polish leaf doesn't accidentally remove the carve-out.

### 5. `OWN_VOTE_INDICATOR_TESTID` indicator coexists with the change-vote button (detail panel)

The current detail-panel render (lines 1000–1017) shows the indicator ONLY when `choices === null && ownVote !== undefined`. After this leaf, `choices` is no longer null when `ownVote !== undefined` (it's the single-element opposite-side subset); the indicator's render condition relaxes to `ownVote !== undefined` (with the structural-facet exclusion preserved per Decision §4).

Three alternatives surveyed:

- **(A) Indicator + change-vote button coexist** (chosen). Information-preserving: the indicator tells you what you voted, the button tells you how to change it. Both are useful pre-commit; no reason to suppress one for the other.
- **(B) Drop the indicator when the change-vote button is visible.** Rejected — see Decision §1 alternative (C).
- **(C) Move the indicator INSIDE the button** (e.g., the agree/dispute button becomes "You voted Agree | Tap to flip to Dispute"). Rejected. Couples the indicator to the button; loses the at-a-glance indicator when the button is in-flight (the button's text changes to "Sending…" during dispatch); breaks the existing `OWN_VOTE_INDICATOR_TESTID` testid contract that downstream tests rely on.

The pane chip surface does not have an equivalent indicator (the pane chip layout doesn't currently carry per-facet "You voted X" text; the per-other-voter dots from `part_vote_indicators_in_pane` are a different signal). The pane's change-vote button stands alone; this is fine because the pane chip's compact layout doesn't have room for a "You voted Agree" caption per facet, and the change-vote button's adjacent dots (own + other voter indicators) carry the analogous information.

### 6. Doc prose update to `docs/participant-ui.md`

The P2 section currently describes only the first-vote semantics. The change-vote semantics are a meaningful behavioral addition that downstream readers (other refinement authors, the test mode, the moderator-side narrative) need to understand. A one-paragraph addition under P2 lines 78–89 covers it; the addition is in-scope per the refinement-doc convention that meaningful behavioral additions update the design narrative alongside the implementation.

Three alternatives surveyed:

- **(A) One-paragraph addition under P2** (chosen). Smallest doc surface; lives in the right section; cross-references ADR 0030 for the latest-vote-wins rule.
- **(B) New top-level subsection "Changing your vote"** with multi-paragraph treatment. Rejected — over-scoped; the change-vote semantics are a refinement of the first-vote, not a separate gesture.
- **(C) No doc update; rely on the refinement Status block as the historical record.** Rejected. The design doc is the cross-team reference; refinement Status blocks are per-task. Future readers of `participant-ui.md` need the change-vote behavior in the narrative.

### 7. No new ADR

The change-vote affordance reuses:

- The `vote` event envelope (defined in `events.ts` per ADR 0021).
- The latest-vote-wins server rule (in `vote.ts` per ADR 0030).
- The supersession-clear behavior on new candidates (per ADR 0030 §7).
- The single-tap-no-confirmation policy (per `docs/participant-ui.md` + ADR 0030 §3 for the withdraw exception).

No new architectural seam, no new dependency, no new security trade-off. The orchestrator's ADR criterion — "Genuinely new ADR-level decisions" — is not met. The behavioral addition is a UI-stream choice over already-settled wire semantics.

### 8. Vitest pin per surface + Playwright extension on pane only

Three alternatives surveyed:

- **(A) Vitest pins both surfaces; Playwright extends only the pane spec** (chosen). The `methodology-full-flow.spec.ts` exercises the detail-panel surface's first-vote path end-to-end; adding the change-vote loop there would be a sizable spec edit at a high-traffic e2e (the spec drives a multi-step methodology session and is brittle to expand). The pane spec already has step 9 clicking a vote button and ack-ing it — step 10 lands cleanly at the same locator. The cross-surface invariant (no modal during change-vote) is a participant-tree property; if a modal regression landed on the detail panel, the existing `methodology-full-flow.spec.ts` would catch the modal mount at first-vote anyway (the policy from `part_vote_single_tap` is already pinned at both surfaces in Vitest).
- **(B) Playwright extends both specs** with full change-vote loops. Rejected. Doubles the e2e maintenance cost without doubling coverage — the cross-process boundary is the same WS round-trip.
- **(C) Playwright extension drops; Vitest-only.** Rejected. The change-vote ack-driven re-render is a cross-process property; the Vitest test mocks `useVoteAction` and asserts the render shape, but the actual WS round-trip + projector re-derivation only manifests in the Playwright loop. Step 10 closes the loop.

The 16 new Vitest cases + the step-10 Playwright extension match the 1d budget honestly.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-26.

- `apps/participant/src/proposals/ProposalFacetVoteButtons.tsx` — extended `VOTABLE_STATUSES` with `'agreed'`; dropped `ownVote === undefined` from render gate; added opposite-of-ownVote filter when `ownVote !== undefined`; added `data-vote-mode` attribute and `changeAriaLabel` on the change-vote button.
- `apps/participant/src/detail/ParticipantVoteButtons.tsx` — split `'agreed'` from `'committed'` in `choices` memo; pre-commit branches return opposite-of-ownVote subset when `ownVote` is set; relaxed own-vote indicator condition from `choices === null && ownVote !== undefined` to `ownVote !== undefined`; added `data-vote-mode` + `changeAriaLabel` aria-label.
- `apps/participant/src/proposals/ProposalFacetVoteButtons.test.tsx` — migrated existing tests and added new `describe('<ProposalFacetVoteButtons> — pre-commit change vote')` block (7 cases a–g).
- `apps/participant/src/detail/ParticipantVoteButtons.test.tsx` — migrated three "hides both buttons after vote" cases; added new `describe('<ParticipantVoteButtons> — pre-commit change vote')` block (9 cases a–i).
- `apps/participant/src/proposals/PendingProposalsPane.test.tsx` — migrated stale `agreed = not votable` assertion (case t) to reflect new pre-commit votable posture.
- `apps/participant/src/proposals/PerProposalFacetBreakdown.test.tsx` — migrated stale "own-vote hides both buttons" assertion (case j) to assert both buttons render at `status="agreed"` with no own vote.
- `tests/e2e/participant-pending-proposals.spec.ts` — flipped step-9 dispute-button assertion (now visible with `data-vote-mode="change"`); added step-10 change-vote click loop with single-tap policy assertions.
- `packages/i18n-catalogs/src/catalogs/en-US.json`, `pt-BR.json`, `es-419.json` — added `participant.voteButton.changeAriaLabel` ICU `select` pattern.
- `docs/participant-ui.md` — one new paragraph under P2 covering the change-vote affordance.
