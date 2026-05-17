// Vitest unit tests for `mapInviteAcceptanceError`.
//
// Refinement: tasks/refinements/participant-ui/part_invite_acceptance.md
//              (Decision §3 — the per-code mapping table is the
//              contract this file pins).
// ADR:         0022 (no throwaway verifications — one case per typed
//              code + a 5xx fallback + a 4xx-with-unknown-code fallback
//              keeps the mapping auditable).

import { describe, expect, it } from 'vitest';

import { mapInviteAcceptanceError } from './inviteAcceptanceError';

describe('mapInviteAcceptanceError — typed backend codes', () => {
  it('maps `not-found` (404) to the terminal not-found panel', () => {
    expect(mapInviteAcceptanceError('not-found', 404)).toEqual({
      i18nKey: 'participant.inviteAcceptance.errors.notFound',
      isRetryable: false,
      isTerminal: true,
    });
  });

  it('maps `session-already-ended` (409) to the terminal session-ended panel', () => {
    expect(mapInviteAcceptanceError('session-already-ended', 409)).toEqual({
      i18nKey: 'participant.inviteAcceptance.errors.sessionAlreadyEnded',
      isRetryable: false,
      isTerminal: true,
    });
  });

  it('maps `not-a-moderator` (403) to the terminal host-cannot-self-claim panel', () => {
    // The endpoint repurposes `not-a-moderator` to mean "you ARE the
    // moderator; you cannot also be a debater" per the predecessor
    // refinement's Decisions block. The user-facing copy must reflect
    // that semantic — pinned by the i18n key surface this returns.
    expect(mapInviteAcceptanceError('not-a-moderator', 403)).toEqual({
      i18nKey: 'participant.inviteAcceptance.errors.notAModerator',
      isRetryable: false,
      isTerminal: true,
    });
  });

  it('maps `role-already-filled` (409) to a retryable panel (button stays)', () => {
    // The user might want to retry in case of a transient slot-race;
    // the social channel (the moderator) is the real recovery, but
    // re-clicking is cheap and the moderator may have switched the
    // emit URL to the other role.
    expect(mapInviteAcceptanceError('role-already-filled', 409)).toEqual({
      i18nKey: 'participant.inviteAcceptance.errors.roleAlreadyFilled',
      isRetryable: true,
      isTerminal: false,
    });
  });

  it('maps `user-already-joined` (409) to the terminal already-joined panel', () => {
    // The route layer pairs this terminal mapping with a sibling "go
    // to lobby" button — the only terminal branch with a forward
    // affordance. The mapper itself only carries the discriminator;
    // the affordance lives in the component.
    expect(mapInviteAcceptanceError('user-already-joined', 409)).toEqual({
      i18nKey: 'participant.inviteAcceptance.errors.userAlreadyJoined',
      isRetryable: false,
      isTerminal: true,
    });
  });
});

describe('mapInviteAcceptanceError — fallbacks', () => {
  it('maps a network failure (`network`, status 0) to the retryable network panel', () => {
    expect(mapInviteAcceptanceError('network', 0)).toEqual({
      i18nKey: 'participant.inviteAcceptance.errors.network',
      isRetryable: true,
      isTerminal: false,
    });
  });

  it('maps a 5xx with no recognized code to the retryable generic panel', () => {
    // The shell's `mapGenericApiError` returns our fallback key for any
    // status other than 401 / 400; 500 hits the fallback branch and the
    // retryable flag means the user can re-click.
    expect(mapInviteAcceptanceError('unknown', 500)).toEqual({
      i18nKey: 'participant.inviteAcceptance.errors.generic',
      isRetryable: true,
      isTerminal: false,
    });
  });

  it('maps a 4xx with an unknown code to the shell-supplied generic key (still retryable)', () => {
    // A 400 with an unknown code is unusual but possible (e.g. an
    // unknown body shape from a future schema iteration). The shell's
    // generic helper returns `common.errors.validation` for status
    // 400; the route still presents the join button so the user can
    // retry.
    expect(mapInviteAcceptanceError('something-new', 400)).toEqual({
      i18nKey: 'common.errors.validation',
      isRetryable: true,
      isTerminal: false,
    });
  });
});
