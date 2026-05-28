// `positionParam.ts` — pure parser for the `?position=<sequence>` query
// string the audience surface accepts on both reachable session URLs:
//   `/a/sessions/<uuid>?position=<sequence>`
//   `/a/<locale>/sessions/<uuid>?position=<sequence>`
//
// Refinement: tasks/refinements/audience/aud_url_position_param.md
//   (Decision §R1 — parameter name is `position`; §R2 — value-space is
//   nonnegative integer mirroring `sequence: z.number().int().nonnegative()`
//   at `packages/shared-types/src/events.ts:796`; §R4 — `null` is the
//   universal absent/invalid sentinel; §R5 — strict `Number.isInteger`
//   gating, not lenient `parseInt` coercion.)
// ADRs:
//   - 0022 (no throwaway verifications — pinned by
//           `positionParam.test.ts`).
//
// Mirrors the pure-helper shape of `sessionIdFromPathname()` at
// `sessionId.ts:53` — single typed input, single typed output, no side
// effects, `null` on any failure. The React hook wrapper that subscribes
// to URL changes lives in `useAudienceLogPosition.ts`.

/**
 * Parse the `?position=<sequence>` query-string parameter into a
 * nonnegative integer. Returns the canonical integer value on success;
 * returns `null` for any failure mode (missing param, empty value,
 * non-numeric, fractional, negative, exceeds `Number.MAX_SAFE_INTEGER`).
 *
 * The accepted value-space matches the event envelope's `sequence`
 * field (`packages/shared-types/src/events.ts:796`): nonnegative
 * integer, no fractional component. `"0"` is valid (the genesis of the
 * log); `"-1"`, `"3.5"`, and `"abc"` are not.
 *
 * The parser takes its input as a `URLSearchParams` rather than reading
 * `window.location.search` itself so it stays pure and trivially
 * Vitest-testable. The hook wrapper composes `useSearchParams()` over
 * this helper.
 */
export function parsePositionParam(searchParams: URLSearchParams): number | null {
  const raw = searchParams.get('position');
  if (raw === null || raw === '') return null;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) return null;
  if (parsed < 0) return null;
  if (parsed > Number.MAX_SAFE_INTEGER) return null;
  return parsed;
}
