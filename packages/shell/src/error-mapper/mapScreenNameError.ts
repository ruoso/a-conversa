// Auth-domain error → i18n-key mapper.
//
// Refinement: tasks/refinements/shell-package/shell_substrate_extraction.md
// Extraction source: apps/moderator/src/routes/ScreenName.tsx lines 46–59.
//
// Maps a backend `ErrorEnvelope.code` value (and the client-side
// `ClientValidationResult.reason` discriminant codes) onto a
// localization key under the `auth.screenName.errors` namespace.
// Unknown codes fall back to the generic message.

const SCREEN_NAME_ERROR_KEYS: Readonly<Record<string, string>> = Object.freeze({
  'screen-name-invalid': 'auth.screenName.errors.invalidCharacter',
  'screen-name-already-set': 'auth.screenName.errors.alreadySet',
  'auth-pending-cookie-invalid': 'auth.screenName.errors.pendingCookieInvalid',
  'validation-failed': 'auth.screenName.errors.empty',
});

const GENERIC_KEY = 'auth.screenName.errors.generic';

export function mapScreenNameError(code: string): string {
  return SCREEN_NAME_ERROR_KEYS[code] ?? GENERIC_KEY;
}
