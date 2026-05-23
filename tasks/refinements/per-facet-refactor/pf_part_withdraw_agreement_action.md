# Participant withdraw-agreement action

**TaskJuggler entry**: [tasks/15-per-facet-refactor.tji](../../15-per-facet-refactor.tji) — task `per_facet_refactor.participant_ui.pf_part_withdraw_agreement_action`
**Effort estimate**: 0.5d
**Inherited dependencies**: `pf_withdraw_agreement_event_kind`, `pf_withdraw_agreement_handler`, `pf_part_detail_panel_three_facet_rows`.

## What this task is

Add a `useWithdrawAgreementAction` hook + the corresponding withdraw button on the participant's `committed` / `agreed` facet rows. The hook reads the current `(entity_kind, entity_id, facet)` from the row context, calls `useWsClient().send('withdraw-agreement', { entity_kind, entity_id, facet, participant })`, and surfaces any wire error in the row's inline error area.

The withdraw button replaces (or is colocated with) the previous "withdraw" vote choice that used to live on the participant vote buttons. Per [ADR 0030 §3 + Consequences](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md) `vote.choice = 'withdraw'` is gone; this is the gesture that replaces it.

## Why it needs to be done

A new event kind needs a UI surface that emits it. Without this task, participants have no way to withdraw their agreement post-commit — and the methodology contract at [`docs/methodology.md:25`](../../../docs/methodology.md) requires that gesture to exist.

## Inputs / context

- [ADR 0030 §3 + Consequences](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md).
- `pf_withdraw_agreement_event_kind`, `pf_withdraw_agreement_handler` (settle the wire shape + the server-side accept path).
- [`apps/participant/src/detail/useVoteAction.ts`](../../../apps/participant/src/detail/useVoteAction.ts) — shape reference for the new hook.
- [`tasks/refinements/participant-ui/part_voting.md`](../participant-ui/part_voting.md) — historical record of the prior withdraw-via-vote shape; do not edit.
- [ADR 0024 — frontend i18n](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md) — new catalog keys for the button chrome.

## Constraints / requirements

- `useWithdrawAgreementAction(entityKind, entityId, facet) → { withdraw: () => Promise<void>, inFlight, lastError }`.
- The withdraw button renders on `committed` / `agreed` rows of the participant detail panel (per `pf_part_detail_panel_three_facet_rows`).
- A confirmation gesture is required (per the prior `part_withdraw_dialog` precedent — deliberate extra tap; the methodology treats withdrawal as a significant gesture). Implementation can be a confirm modal or a two-stage button; judgment at implementation time.
- On wire success, the row's status flips to `withdrawn` (the projection reads the new event).
- On wire error, surface the typed message in an inline error region.
- Vitest cases at `apps/participant/src/detail/useWithdrawAgreementAction.test.tsx` cover the send path, the in-flight state, the error path.
- e2e coverage rolls into `pf_e2e_methodology_full_flow_update`.

## Acceptance criteria

- Hook + button ship; the button is reachable from `committed` / `agreed` facet rows.
- The confirmation gesture is in place.
- Withdraw sends `withdraw-agreement` and surfaces success / error.
- Vitest covers the hook.
- `pnpm run test:smoke` green; `make test` green; `tj3 project.tjp` parses clean.

## Decisions

- **Confirmation gesture is required.** Mirrors the existing `part_withdraw_dialog` precedent; consistent UX between the structural withdraw and the new facet withdraw.
- **One hook per gesture.** The `useWithdrawAgreementAction` is parallel to `useVoteAction` / `useAxiomMarkAction`; the participant UI already has this pattern.

## Open questions

(none — all decided per ADR 0030)
