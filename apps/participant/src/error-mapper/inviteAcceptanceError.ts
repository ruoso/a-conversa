// Invite-acceptance error → user-affordance mapper.
//
// Refinement: tasks/refinements/participant-ui/part_invite_acceptance.md
//              (Decision §3 — per-code error mapping table and the
//              retryable-vs-terminal semantics that drive the route's
//              button-vs-panel decisions).
// Predecessor: tasks/refinements/backend/session_invite_self_claim_endpoint.md
//              (the canonical list of typed error envelopes the
//              `POST /api/sessions/:id/invite/claim` handler emits).
// ADR:         0022 (no throwaway verifications — the mapping table is
//              the contract; `inviteAcceptanceError.test.ts` is the pin).
//
// Maps a backend `ErrorEnvelope.code` (or fallback HTTP status) onto
// the triple `(i18nKey, isRetryable, isTerminal)` that the route's
// reducer consumes. Mirrors the shell's `mapCreateSessionError` shape
// with the additional `isRetryable` / `isTerminal` flags this domain
// needs (the create-session form always re-enables submit, so it does
// not carry a retryable flag — invite-acceptance has terminal branches
// that must hide the join button entirely).
//
// The 5xx / network failure / 4xx-unknown-code paths fall through to
// the shell's generic helper for the i18n key and treat the failure as
// retryable. The five typed codes the predecessor endpoint defines map
// to discriminating user-visible affordances per the Decision §3 table.

import { mapGenericApiError } from '@a-conversa/shell';

export interface MappedInviteAcceptanceError {
  /** i18next key for the localized panel body. */
  i18nKey: string;
  /**
   * If `true`, the join button stays visible so the user can re-click.
   * Always paired with `isTerminal === false`.
   */
  isRetryable: boolean;
  /**
   * If `true`, the failure is final for this caller+session+role triple.
   * The button is hidden; specific terminal branches may render a
   * sibling affordance (e.g. `user-already-joined` renders a "go to
   * lobby" button — see the route's Decision §3 row).
   */
  isTerminal: boolean;
}

export function mapInviteAcceptanceError(
  code: string,
  status: number,
): MappedInviteAcceptanceError {
  if (code === 'not-found') {
    return {
      i18nKey: 'participant.inviteAcceptance.errors.notFound',
      isRetryable: false,
      isTerminal: true,
    };
  }
  if (code === 'session-already-ended') {
    return {
      i18nKey: 'participant.inviteAcceptance.errors.sessionAlreadyEnded',
      isRetryable: false,
      isTerminal: true,
    };
  }
  if (code === 'not-a-moderator') {
    return {
      i18nKey: 'participant.inviteAcceptance.errors.notAModerator',
      isRetryable: false,
      isTerminal: true,
    };
  }
  if (code === 'role-already-filled') {
    return {
      i18nKey: 'participant.inviteAcceptance.errors.roleAlreadyFilled',
      isRetryable: true,
      isTerminal: false,
    };
  }
  if (code === 'user-already-joined') {
    return {
      i18nKey: 'participant.inviteAcceptance.errors.userAlreadyJoined',
      isRetryable: false,
      isTerminal: true,
    };
  }
  if (code === 'network') {
    return {
      i18nKey: 'participant.inviteAcceptance.errors.network',
      isRetryable: true,
      isTerminal: false,
    };
  }
  // 5xx / 4xx-with-unknown-code falls through to the shell's generic
  // status-code fallback. The helper returns one of three keys
  // (`common.errors.unauthenticated`, `common.errors.validation`, or
  // the caller's fallback) — we pass our `errors.generic` key so a
  // 5xx with no recognized code surfaces as "could not join — please
  // try again". The flow stays retryable so the user can re-click.
  return {
    i18nKey: mapGenericApiError(code, status, 'participant.inviteAcceptance.errors.generic'),
    isRetryable: true,
    isTerminal: false,
  };
}
