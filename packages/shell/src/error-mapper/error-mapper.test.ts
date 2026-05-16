// Smoke tests for the shell's API-error → i18n-key mappers.
//
// Refinement: tasks/refinements/shell-package/shell_substrate_extraction.md
// ADR:        docs/adr/0022-no-throwaway-verifications.md

import { describe, expect, it } from 'vitest';

import { mapCreateSessionError } from './mapCreateSessionError.js';
import { mapGenericApiError } from './mapGenericApiError.js';
import { mapScreenNameError } from './mapScreenNameError.js';

describe('mapScreenNameError', () => {
  it('maps screen-name-invalid → auth.screenName.errors.invalidCharacter', () => {
    expect(mapScreenNameError('screen-name-invalid')).toBe(
      'auth.screenName.errors.invalidCharacter',
    );
  });

  it('maps screen-name-already-set → auth.screenName.errors.alreadySet', () => {
    expect(mapScreenNameError('screen-name-already-set')).toBe('auth.screenName.errors.alreadySet');
  });

  it('maps auth-pending-cookie-invalid → auth.screenName.errors.pendingCookieInvalid', () => {
    expect(mapScreenNameError('auth-pending-cookie-invalid')).toBe(
      'auth.screenName.errors.pendingCookieInvalid',
    );
  });

  it('maps validation-failed → auth.screenName.errors.empty', () => {
    expect(mapScreenNameError('validation-failed')).toBe('auth.screenName.errors.empty');
  });

  it('unknown code → auth.screenName.errors.generic', () => {
    expect(mapScreenNameError('whatever-else')).toBe('auth.screenName.errors.generic');
  });
});

describe('mapCreateSessionError', () => {
  it('maps validation-failed → moderator.createSession.errors.validation', () => {
    expect(mapCreateSessionError('validation-failed', 400)).toBe(
      'moderator.createSession.errors.validation',
    );
  });

  it('maps auth-required → moderator.createSession.errors.unauthenticated', () => {
    expect(mapCreateSessionError('auth-required', 401)).toBe(
      'moderator.createSession.errors.unauthenticated',
    );
  });

  it('unknown code + 401 → moderator.createSession.errors.unauthenticated', () => {
    expect(mapCreateSessionError('whatever', 401)).toBe(
      'moderator.createSession.errors.unauthenticated',
    );
  });

  it('unknown code + 400 → moderator.createSession.errors.validation', () => {
    expect(mapCreateSessionError('whatever', 400)).toBe(
      'moderator.createSession.errors.validation',
    );
  });

  it('unknown code + 500 → moderator.createSession.errors.generic', () => {
    expect(mapCreateSessionError('whatever', 500)).toBe('moderator.createSession.errors.generic');
  });
});

describe('mapGenericApiError', () => {
  it('401 → common.errors.unauthenticated', () => {
    expect(mapGenericApiError('any', 401, 'fallback.key')).toBe('common.errors.unauthenticated');
  });

  it('400 → common.errors.validation', () => {
    expect(mapGenericApiError('any', 400, 'fallback.key')).toBe('common.errors.validation');
  });

  it('500 → caller-supplied fallback', () => {
    expect(mapGenericApiError('any', 500, 'my.fallback.key')).toBe('my.fallback.key');
  });
});
