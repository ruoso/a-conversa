// `useAxiomMarkAction(nodeId)` — the moderator's axiom-mark action hook.
// One instance per `<AxiomMarkSubmenu>` mount; dispatches per-participant
// clicks to a single `propose` envelope.
//
// Refinement: tasks/refinements/moderator-ui/mod_axiom_mark_action.md
// Mirror:     apps/moderator/src/layout/useCommitAction.ts (per-target
//             keyed Zustand-store shape; composite-key indexing on the
//             `${nodeId}|${participantId}` pair — Decision §3 of the
//             refinement).
//
// **Per-target keying.** The submenu renders N buttons (one per joined
// debater). Each button's click maps to a unique (nodeId, participantId)
// pair; the in-flight slice and the per-row error slice are both keyed
// on the composite string `${nodeId}|${participantId}`. Two concurrent
// marks against different pairs observe disjoint in-flight / error
// state — same disjoint-by-construction posture `useCommitStore` takes
// for proposalId keying.
//
// **Per-node hook signature.** `useAxiomMarkAction(nodeId)` returns
// `{ markAxiom, inFlightFor, lastErrorFor }`; the submenu calls
// `useHook` once and dispatches into any of its per-participant
// buttons. A per-pair hook would force the submenu to call `useHook`
// inside a `.map()` loop, which violates Rules of Hooks
// (Decision §3 — per-node chosen).
//
// **Methodology caveat (Decision §1).** The server's
// `validateAxiomMarkProposal` enforces rule 3:
// `proposal.participant === action.requester`. The moderator's user id
// is the moderator's, not any debater's — so ANY moderator-driven
// axiom-mark on behalf of a debater hits the engine's
// `'axiom-mark-not-self'` rejection. This task ships the full surface
// end-to-end and surfaces the rejection via a localized `notSelf`
// catalog message. When the participant-tablet axiom-mark surface
// lands (`participant_ui` work-stream), it reuses this hook + envelope
// shape verbatim — the rule will pass naturally there because the
// authenticated requester IS the bedrock-holder. The infrastructure
// stays right; only the engine rejects the moderator-side gesture.

import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { create } from 'zustand';

import { useWsClient } from '@a-conversa/shell';
import { useWsStore } from '../ws/wsStore';
import { WsRequestError, WsRequestTimeoutError } from '@a-conversa/shell';

/**
 * Wire-error shape surfaced on `lastErrorFor(participantId)`. `code` is
 * the engine's rejection code (or a transport-layer code like
 * `'timeout'` / `'unknown'`); `message` is the wire-supplied message
 * verbatim when present, or a localized fallback for transport-layer
 * errors. Re-declared here (rather than imported from
 * `useCommitAction`) so the two hooks stay independently consumable —
 * mirrors the same redeclaration `useCommitAction` did off
 * `useProposeAction`.
 */
export interface WireError {
  readonly code: string;
  readonly message: string;
}

export interface UseAxiomMarkActionResult {
  /**
   * Trigger the axiom-mark proposal for `(nodeId, participantId)`. The
   * in-flight guard short-circuits a concurrent click on the SAME
   * `(nodeId, participantId)` pair while the prior round-trip is still
   * in flight; clicks on different pairs are allowed in parallel.
   */
  markAxiom: (participantId: string) => Promise<void>;
  /** True while a mark for the given participant on the bound node is in flight. */
  inFlightFor: (participantId: string) => boolean;
  /** The wire-error from the last failed mark for `(nodeId, participantId)`, or undefined. */
  lastErrorFor: (participantId: string) => WireError | undefined;
}

/**
 * Build the composite Zustand-slice key from a `(nodeId, participantId)`
 * pair. The `|` separator is safe because both ids are UUIDs (hyphens
 * but no `|`); see Decision §3 of the refinement. Exported for direct
 * test inspection — the test suite asserts the same key shape the
 * production code writes.
 */
export function axiomMarkStoreKey(nodeId: string, participantId: string): string {
  return `${nodeId}|${participantId}`;
}

/**
 * Module-scoped Zustand slice tracking per-(nodeId, participantId)
 * in-flight mark state + the last wire error per key. Lives outside
 * React so two `useAxiomMarkAction(nodeId)` call sites for the same
 * node share state — mirrors `useCommitStore`'s shape.
 */
interface AxiomMarkState {
  readonly inFlight: ReadonlySet<string>;
  readonly errors: ReadonlyMap<string, WireError>;
  readonly setInFlight: (key: string, flag: boolean) => void;
  readonly setError: (key: string, error: WireError | undefined) => void;
}

export const useAxiomMarkStore = create<AxiomMarkState>((set) => ({
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
 * Test seam — reset the module-scoped axiom-mark slice between cases.
 * Mirrors `resetCommitStore()` / `resetProposeError()`.
 */
export function resetAxiomMarkStore(): void {
  useAxiomMarkStore.setState({
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
 * `useCommitAction` / `useProposeAction`.
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
 * The per-node axiom-mark hook. Accepts the bound `nodeId` (the
 * right-clicked node's id) and returns the imperative `markAxiom`
 * callback + observable `inFlightFor` / `lastErrorFor` slices keyed
 * by participantId.
 *
 * **Subscription model.** The hook subscribes to the full `inFlight`
 * Set + `errors` Map references (NOT a single composite key) so the
 * submenu's per-button renders observe the slice transitions for
 * every participant the submenu lists. The cost is one extra render
 * per slice flip; the benefit is that the consumer doesn't need to
 * call `useHook` per row. Mirrors `useCommitAction`'s posture for
 * the analogous per-row consumer.
 */
export function useAxiomMarkAction(nodeId: string): UseAxiomMarkActionResult {
  const { t } = useTranslation();

  // Session-id read off the route param (same as `useCommitAction`
  // / `useProposeAction`).
  const { id: sessionIdParam } = useParams<{ id: string }>();
  const sessionId = sessionIdParam ?? '';

  const client = useWsClient();

  // Subscribe to the full slices — the consumer renders N buttons
  // and each one observes its own per-key portion via the
  // `inFlightFor` / `lastErrorFor` helpers below.
  const inFlight = useAxiomMarkStore((s) => s.inFlight);
  const errors = useAxiomMarkStore((s) => s.errors);

  const inFlightFor = (participantId: string): boolean =>
    inFlight.has(axiomMarkStoreKey(nodeId, participantId));
  const lastErrorFor = (participantId: string): WireError | undefined =>
    errors.get(axiomMarkStoreKey(nodeId, participantId));

  async function markAxiom(participantId: string): Promise<void> {
    const key = axiomMarkStoreKey(nodeId, participantId);

    // In-flight guard — concurrent click on the SAME (nodeId,
    // participantId) pair is a no-op (the existing round-trip will
    // resolve on its own; we don't fire a duplicate envelope).
    if (useAxiomMarkStore.getState().inFlight.has(key)) {
      return;
    }

    // Flip in-flight + clear any prior error for this key. The order
    // matters: the per-button `data-axiom-mark-state` (when set by
    // the submenu) transitions BEFORE the WS send fires, so a test
    // that asserts the in-flight visual immediately after the click
    // observes the post-flip state.
    const store = useAxiomMarkStore.getState();
    store.setInFlight(key, true);
    store.setError(key, undefined);

    try {
      // Build the axiom-mark propose envelope. The four fields match
      // `axiomMarkProposalSchema` + `proposePayloadSchema` exactly —
      // no client-minted proposal-event id (the server mints the
      // envelope id at append time per `proposal_events.md`).
      const expectedSequence =
        useWsStore.getState().sessionState[sessionId]?.lastAppliedSequence ?? 0;
      await client.send('propose', {
        sessionId,
        expectedSequence,
        proposal: {
          kind: 'axiom-mark',
          node_id: nodeId,
          participant: participantId,
        },
      });

      // Success — clear in-flight, drop any stale error for this key.
      // Per Decision §1 the moderator-side path will (in v1) always
      // fall through to the catch arm with `axiom-mark-not-self`; the
      // success arm is exercised by the participant-tablet surface
      // (the same hook + envelope shape passes rule 3 naturally
      // there).
      const store2 = useAxiomMarkStore.getState();
      store2.setInFlight(key, false);
      store2.setError(key, undefined);
    } catch (err) {
      // Failure — surface the wire error inline on this key. The
      // submenu reads `lastErrorFor(participantId)` and renders the
      // matching localized message (Decision §7 — inline region in
      // the submenu, not a page-level toast).
      const timeoutText = t('moderator.axiomMarkAction.errorBanner.timeout');
      const store2 = useAxiomMarkStore.getState();
      store2.setInFlight(key, false);
      store2.setError(key, toWireError(err, timeoutText));
    }
  }

  return {
    markAxiom,
    inFlightFor,
    lastErrorFor,
  };
}
