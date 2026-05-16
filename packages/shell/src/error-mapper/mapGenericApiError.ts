// Composition helper for the shared status-code fallback pattern.
//
// Refinement: tasks/refinements/shell-package/shell_substrate_extraction.md
//
// Encodes the shared status-code fallback pattern (401 → unauthenticated,
// 400 → validation, else → caller's fallback) so future domains compose
// without copy-pasting the table. The caller provides their domain's
// fallback key; the helper returns one of three well-known keys or the
// fallback.

export function mapGenericApiError(_code: string, status: number, fallbackKey: string): string {
  if (status === 401) {
    return 'common.errors.unauthenticated';
  }
  if (status === 400) {
    return 'common.errors.validation';
  }
  return fallbackKey;
}
