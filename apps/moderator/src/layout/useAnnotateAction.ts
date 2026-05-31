// `useAnnotateAction(targetId, targetKind)` — the moderator's annotate
// action hook. One instance per `<AnnotateSubmenu>` mount; the user
// types annotation `content` and a single Submit click dispatches a
// `propose` envelope with `proposal.kind === 'annotate'`.
//
// Mirror: apps/moderator/src/layout/useAxiomMarkAction.ts (per-target
//         keyed Zustand-store shape; composite-key indexing on the
//         `${targetKind}|${targetId}` pair so two concurrent annotate
//         flows against different targets observe disjoint in-flight /
//         error state).
//
// **Per-target keying.** The right-click context menu opens a per-
// target submenu (one node OR one edge). The in-flight + error slices
// are keyed on the composite string `${targetKind}|${targetId}`. The
// separator is safe because UUIDs don't contain `|`; the kind prefix
// disambiguates the (theoretical) case where a node id collides with
// an edge id from a separate session run.
//
// **`annotation_kind` is supplied by the call site.** The annotate
// proposal payload carries an `annotation_kind` enum (`note` /
// `reframe` / `scope-change` / `stance`) chosen by the moderator
// through the submenu's radio-group picker; the hook just threads the
// supplied kind into the propose envelope. `AnnotationKind` is a
// closed union so TypeScript enforces the call-site contract at the
// type layer. See `tasks/refinements/moderator-ui/mod_annotation_kind_tagging.md`.
//
// **Cap-aware content validation.** `MAX_METHODOLOGY_TEXT_LENGTH` from
// `@a-conversa/shared-types` is the same upper bound the server schema
// enforces (`annotateProposalSchema.content.max`). The hook short-
// circuits with a `content-too-long` wire-error BEFORE the WS send
// fires when the supplied content overflows the cap, so the moderator
// sees an immediate inline error instead of waiting for the round-
// trip rejection. Empty content (`length === 0`) is similarly short-
// circuited as `content-empty`.

import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { create } from 'zustand';

import { useWsClient } from '@a-conversa/shell';
import { useWsStore } from '../ws/wsStore';
import { WsRequestError, WsRequestTimeoutError } from '@a-conversa/shell';
import { MAX_METHODOLOGY_TEXT_LENGTH } from '@a-conversa/shared-types';
import type { AnnotationKind } from '@a-conversa/shared-types';

/**
 * Wire-error shape surfaced on `lastErrorFor()`. Mirrors the
 * `WireError` shape declared in `useAxiomMarkAction`; re-declared here
 * so the two hooks stay independently consumable.
 */
export interface WireError {
  readonly code: string;
  readonly message: string;
}

export type AnnotateTargetKind = 'node' | 'edge' | 'annotation';

export interface UseAnnotateActionResult {
  /**
   * Trigger the annotate proposal for the hook-bound target. The
   * in-flight guard short-circuits a concurrent Submit on the SAME
   * `(targetKind, targetId)` pair while the prior round-trip is still
   * in flight. The `content` is the moderator-typed annotation text;
   * `annotationKind` is the moderator-picked kind from the submenu
   * radio-group.
   */
  annotate: (content: string, annotationKind: AnnotationKind) => Promise<void>;
  /** True while an annotate for the bound target is in flight. */
  readonly inFlight: boolean;
  /** The wire-error from the last failed annotate, or undefined. */
  readonly lastError: WireError | undefined;
}

/**
 * Build the composite Zustand-slice key from a `(targetKind,
 * targetId)` pair. The `|` separator is safe because UUIDs contain
 * hyphens but no `|`. Exported for direct test inspection.
 */
export function annotateStoreKey(targetKind: AnnotateTargetKind, targetId: string): string {
  return `${targetKind}|${targetId}`;
}

/**
 * Module-scoped Zustand slice tracking per-(targetKind, targetId)
 * in-flight annotate state + the last wire error per key. Lives
 * outside React so two `useAnnotateAction` call sites for the same
 * target share state — mirrors `useAxiomMarkStore`'s shape.
 */
interface AnnotateState {
  readonly inFlight: ReadonlySet<string>;
  readonly errors: ReadonlyMap<string, WireError>;
  readonly setInFlight: (key: string, flag: boolean) => void;
  readonly setError: (key: string, error: WireError | undefined) => void;
}

export const useAnnotateStore = create<AnnotateState>((set) => ({
  inFlight: new Set<string>(),
  errors: new Map<string, WireError>(),
  setInFlight: (key: string, flag: boolean) =>
    set((state) => {
      const next = new Set(state.inFlight);
      if (flag) next.add(key);
      else next.delete(key);
      return { inFlight: next };
    }),
  setError: (key: string, error: WireError | undefined) =>
    set((state) => {
      const next = new Map(state.errors);
      if (error === undefined) next.delete(key);
      else next.set(key, error);
      return { errors: next };
    }),
}));

/**
 * Test seam — reset the module-scoped annotate slice between cases.
 * Mirrors `resetAxiomMarkStore()`.
 */
export function resetAnnotateStore(): void {
  useAnnotateStore.setState({
    inFlight: new Set<string>(),
    errors: new Map<string, WireError>(),
  });
}

/**
 * Map any thrown error to the `WireError` surface. `WsRequestError`
 * carries the server's typed payload verbatim; `WsRequestTimeoutError`
 * gets a localized fallback; anything else lands as `'unknown'`. The
 * `timeoutText` is pre-resolved by the caller (so the function stays
 * React-free and easy to test). Mirrors the same helper in
 * `useAxiomMarkAction` / `useCommitAction` / `useProposeAction`.
 */
function toWireError(err: unknown, timeoutText: string): WireError {
  if (err instanceof WsRequestError) {
    return { code: err.code, message: err.message };
  }
  if (err instanceof WsRequestTimeoutError) {
    return { code: 'timeout', message: timeoutText };
  }
  if (err instanceof Error) {
    return { code: 'unknown', message: err.message };
  }
  return { code: 'unknown', message: String(err) };
}

/**
 * The per-target annotate hook. Accepts the bound `targetId` +
 * `targetKind` (the right-clicked entity) and returns the imperative
 * `annotate(content)` callback + observable `inFlight` / `lastError`
 * slices.
 *
 * The hook subscribes to the full `inFlight` Set + `errors` Map
 * references so a sibling-rendered submenu's button reflects the
 * slice transitions immediately. The per-target narrowing happens in
 * the returned `inFlight` / `lastError` fields (already keyed for the
 * bound target).
 */
export function useAnnotateAction(
  targetId: string,
  targetKind: AnnotateTargetKind,
): UseAnnotateActionResult {
  const { t } = useTranslation();

  // Session-id read off the route param (same as `useAxiomMarkAction`
  // / `useCommitAction` / `useProposeAction`).
  const { id: sessionIdParam } = useParams<{ id: string }>();
  const sessionId = sessionIdParam ?? '';

  const client = useWsClient();

  // Subscribe to the full slices — narrow to the bound key in the
  // returned fields.
  const inFlightSet = useAnnotateStore((s) => s.inFlight);
  const errorsMap = useAnnotateStore((s) => s.errors);

  const key = annotateStoreKey(targetKind, targetId);
  const inFlight = inFlightSet.has(key);
  const lastError = errorsMap.get(key);

  async function annotate(content: string, annotationKind: AnnotationKind): Promise<void> {
    // In-flight guard — concurrent Submit on the SAME target is a
    // no-op (the existing round-trip will resolve on its own; we
    // don't fire a duplicate envelope).
    if (useAnnotateStore.getState().inFlight.has(key)) {
      return;
    }

    // Cap-aware content validation. The server's
    // `annotateProposalSchema` enforces `min(1).max(MAX_METHODOLOGY_TEXT_LENGTH)`
    // — short-circuit BEFORE the WS send fires so the moderator sees
    // the inline error instantly instead of waiting for the round-
    // trip rejection.
    if (content.length === 0) {
      useAnnotateStore.getState().setError(key, {
        code: 'content-empty',
        message: t('moderator.annotateAction.errorBanner.contentEmpty'),
      });
      return;
    }
    if (content.length > MAX_METHODOLOGY_TEXT_LENGTH) {
      useAnnotateStore.getState().setError(key, {
        code: 'content-too-long',
        message: t('moderator.annotateAction.errorBanner.contentTooLong', {
          max: MAX_METHODOLOGY_TEXT_LENGTH,
        }),
      });
      return;
    }

    // Flip in-flight + clear any prior error for this key. The order
    // matters: the per-target `data-annotate-state` (when set by the
    // submenu) transitions BEFORE the WS send fires.
    const store = useAnnotateStore.getState();
    store.setInFlight(key, true);
    store.setError(key, undefined);

    try {
      // Build the annotate propose envelope. The five fields match
      // `annotateProposalSchema` + `proposePayloadSchema` exactly —
      // no client-minted proposal-event id (the server mints the
      // envelope id at append time per `proposal_events.md`).
      const expectedSequence =
        useWsStore.getState().sessionState[sessionId]?.lastAppliedSequence ?? 0;
      await client.send('propose', {
        sessionId,
        expectedSequence,
        proposal: {
          kind: 'annotate',
          target_kind: targetKind,
          target_id: targetId,
          annotation_kind: annotationKind,
          content,
        },
      });

      // Success — clear in-flight, drop any stale error for this key.
      const store2 = useAnnotateStore.getState();
      store2.setInFlight(key, false);
      store2.setError(key, undefined);
    } catch (err) {
      // Failure — surface the wire error inline on this key. The
      // submenu reads `lastError` and renders the matching localized
      // message.
      const timeoutText = t('moderator.annotateAction.errorBanner.timeout');
      const store2 = useAnnotateStore.getState();
      store2.setInFlight(key, false);
      store2.setError(key, toWireError(err, timeoutText));
    }
  }

  return {
    annotate,
    inFlight,
    lastError,
  };
}
