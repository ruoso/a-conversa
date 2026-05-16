// Session-domain error → i18n-key mapper.
//
// Refinement: tasks/refinements/shell-package/shell_substrate_extraction.md
// Extraction source: apps/moderator/src/routes/CreateSession.tsx lines 60–77.
//
// Maps a backend `ErrorEnvelope.code` (or fallback HTTP status) onto a
// localization key under the `moderator.createSession.errors` namespace.
// Unknown codes fall back to the generic message.

export function mapCreateSessionError(code: string, status: number): string {
  if (code === 'validation-failed') {
    return 'moderator.createSession.errors.validation';
  }
  if (code === 'auth-required') {
    return 'moderator.createSession.errors.unauthenticated';
  }
  // Status 401 without a recognized code still surfaces as unauthenticated;
  // this protects against an envelope shape regression where the code
  // disappears but the status is correct.
  if (status === 401) {
    return 'moderator.createSession.errors.unauthenticated';
  }
  if (status === 400) {
    return 'moderator.createSession.errors.validation';
  }
  return 'moderator.createSession.errors.generic';
}
