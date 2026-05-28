// `useAudienceLogPosition.ts` — React hook wrapping `parsePositionParam`
// over React Router's `useSearchParams()`. Returns the parsed
// nonnegative integer when the URL carries a syntactically-valid
// `?position=<sequence>` parameter; returns `null` otherwise.
//
// Refinement: tasks/refinements/audience/aud_url_position_param.md
//   (Decision §R3 — co-located with `useAudienceSessionId.ts` in
//   `state/`; §R4 — `null` is the absent/invalid sentinel; §R6 — the
//   route reads the value but does not branch on it in this leaf.)
// ADRs:
//   - 0022 (no throwaway verifications — pinned by
//           `useAudienceLogPosition.test.tsx`).
//
// React Router's `useSearchParams()` provides the reactive subscription
// to query-string changes; no additional `popstate` listener is needed
// (unlike `useAudienceSessionId`, which predates the real route table
// and reads `window.location.pathname` directly via
// `useSyncExternalStore`).

import { useSearchParams } from 'react-router-dom';

import { parsePositionParam } from './positionParam.js';

/**
 * Read the `?position=<sequence>` query parameter and return the parsed
 * nonnegative integer, or `null` when the parameter is missing or
 * carries any invalid encoding. Re-runs when the search string changes
 * (React Router triggers a re-render on every search-params update).
 */
export function useAudienceLogPosition(): number | null {
  const [searchParams] = useSearchParams();
  return parsePositionParam(searchParams);
}
