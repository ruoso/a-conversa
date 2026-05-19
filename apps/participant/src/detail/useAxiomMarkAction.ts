// `useAxiomMarkAction({ nodeId, participantId })` — the participant's
// per-node axiom-mark action React hook. Lives next to
// `<EntityDetailPanel>` because the panel's `actionSlot` is the (only)
// consumer today.
//
// Refinement: tasks/refinements/participant-ui/part_axiom_mark.md
//             (sibling to `part_voting`'s `useVoteAction` — the
//             participant's per-target wire-action pattern; per-`nodeId`
//             keyed slice mirrors `useVoteAction`'s per-`proposalId`
//             slice).
//
// **Methodology semantics** (`docs/methodology.md` §"Axioms / terminal
// values"). Axiom-marks are PER-PARTICIPANT — only the participant
// themselves can hold a node as their bedrock. The engine enforces this
// via `axiom-mark-not-self`: any axiom-mark proposal whose `participant`
// field does not match the authenticated requester is rejected
// (`apps/moderator/src/layout/useAxiomMarkAction.ts` lives with this
// rejection because the moderator's id never matches a debater's; the
// participant-side hook passes `connection.user.id` and threads
// naturally).
//
// **Per-node keying.** A debater can ONLY mark themselves — the
// `participantId` argument is bound to the authenticated user id at the
// call site (passed in via the button-component's prop). So the
// (nodeId, participantId) pair degenerates to nodeId for the
// participant surface; we key the in-flight + per-error slices by
// `nodeId` alone. (The moderator's hook keys by the composite pair
// because the moderator dispatches against N debaters from a submenu;
// no such dispatch exists here.)
//
// Wire payload (per `packages/shared-types/src/events/proposals.ts:275`
// + `packages/shared-types/src/ws-envelope.ts` `propose` arm):
//
//   { sessionId, expectedSequence, proposal: {
//       kind: 'axiom-mark', node_id, participant
//     } }
//
// where `participant` is the requester's user id (the engine reads
// `connection.user.id` and matches against `proposal.participant`).
//
// ADRs:
//   - 0003 (React);
//   - 0021 (envelope discriminated union — the typed `'propose'` arm of
//           `WsMessagePayloadMap` is the wire contract);
//   - 0022 (no throwaway verifications — `useAxiomMarkAction.test.tsx`
//           pins the per-call contract);
//   - 0024 (i18n via react-i18next — the localized timeout fallback
//           lands via `useTranslation()`).

import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { create } from 'zustand';

import { useWsClient } from '@a-conversa/shell';
import { WsRequestError, WsRequestTimeoutError } from '@a-conversa/shell';

import { useWsStore } from '../ws/wsStore';

/**
 * Wire-error shape surfaced on `lastError`. Redeclared locally (rather
 * than imported from `useVoteAction`) so the hook stays independently
 * consumable — same posture as the moderator's `useAxiomMarkAction`
 * (which redeclares off `useCommitAction`).
 */
export interface WireError {
  readonly code: string;
  readonly message: string;
}

export interface UseAxiomMarkActionArgs {
  readonly nodeId: string;
  /**
   * The authenticated participant's user id — used as the wire
   * `proposal.participant` field. The engine compares this against
   * `connection.user.id`; passing the authenticated user id makes the
   * `axiom-mark-not-self` rejection unreachable on the participant
   * surface (it's the correct gesture for the methodology rule).
   */
  readonly participantId: string;
}

export interface UseAxiomMarkActionResult {
  /**
   * Trigger the axiom-mark proposal for the bound `nodeId`. Idempotent
   * during the in-flight window (a concurrent call while the prior
   * round-trip is in flight is a no-op).
   */
  markAsAxiom: () => Promise<void>;
  /** True while a mark for this `nodeId` is in flight. */
  inFlight: boolean;
  /** Wire error from the last failed mark for this `nodeId`, or undefined. */
  lastError: WireError | undefined;
}

/**
 * Module-scoped Zustand slice tracking per-`nodeId` in-flight axiom-
 * mark state + the last wire error per `nodeId`. Lives outside React so
 * two `useAxiomMarkAction({ nodeId })` call sites for the same id share
 * state. Mirrors `useVoteActionStore` exactly — disjoint by
 * construction between different `nodeId`s; no React provider; no
 * devtools wiring.
 */
interface AxiomMarkActionState {
  readonly marking: ReadonlySet<string>;
  readonly errors: ReadonlyMap<string, WireError>;
  readonly setMarking: (nodeId: string, flag: boolean) => void;
  readonly setError: (nodeId: string, error: WireError | undefined) => void;
}

export const useAxiomMarkActionStore = create<AxiomMarkActionState>((set) => ({
  marking: new Set<string>(),
  errors: new Map<string, WireError>(),
  setMarking: (nodeId: string, flag: boolean) =>
    set((state) => {
      const next = new Set(state.marking);
      if (flag) next.add(nodeId);
      else next.delete(nodeId);
      return { marking: next };
    }),
  setError: (nodeId: string, error: WireError | undefined) =>
    set((state) => {
      const next = new Map(state.errors);
      if (error === undefined) next.delete(nodeId);
      else next.set(nodeId, error);
      return { errors: next };
    }),
}));

/**
 * Test seam — lets test suites reset the module-scoped axiom-mark
 * action slice between cases. Mirrors `resetVoteActionStore`.
 */
export function resetAxiomMarkActionStore(): void {
  useAxiomMarkActionStore.setState({
    marking: new Set<string>(),
    errors: new Map<string, WireError>(),
  });
}

/**
 * Map any thrown error to the `WireError` surface. `WsRequestError`
 * carries the server's typed payload verbatim; `WsRequestTimeoutError`
 * gets a localized fallback message; anything else lands as
 * `'unknown'`. The `timeoutText` is pre-resolved by the caller so the
 * function stays React-free and easy to test. Mirrors
 * `useVoteAction`'s `toWireError`.
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
 * selected node's id) + the authenticated `participantId` (which goes
 * onto the wire as `proposal.participant`).
 *
 * Per-`nodeId` selector subscriptions keep the consumer button's
 * re-render scope narrow — marking node A does not re-render the
 * (hypothetical) button for node B. The hook is callable from any
 * participant component; today the only consumer is the
 * `<ParticipantAxiomMarkButton>` row mounted into
 * `<EntityDetailPanel>`'s `actionSlot`.
 */
export function useAxiomMarkAction(args: UseAxiomMarkActionArgs): UseAxiomMarkActionResult {
  const { nodeId, participantId } = args;
  const { t } = useTranslation();

  // Session-id read off the route param (same as `useVoteAction`).
  const { id: sessionIdParam } = useParams<{ id: string }>();
  const sessionId = sessionIdParam ?? '';

  const client = useWsClient();

  // Per-`nodeId` slice subscriptions — each call returns a
  // primitive / referentially-stable value so Zustand's default
  // equality check re-renders the consumer only when THIS nodeId's
  // slice flips.
  const inFlight = useAxiomMarkActionStore((s) => s.marking.has(nodeId));
  const lastError = useAxiomMarkActionStore((s) => s.errors.get(nodeId));

  async function markAsAxiom(): Promise<void> {
    // In-flight guard — a concurrent click while the prior round-trip
    // is still in flight is a no-op. Mirrors `useVoteAction`'s gate.
    if (useAxiomMarkActionStore.getState().marking.has(nodeId)) {
      return;
    }

    // Flip in-flight + clear any prior error for this `nodeId`. The
    // order matters: a test that asserts the in-flight visual
    // immediately after the click observes the post-flip state.
    const store = useAxiomMarkActionStore.getState();
    store.setMarking(nodeId, true);
    store.setError(nodeId, undefined);

    try {
      // Build the canonical `propose` payload with the axiom-mark
      // sub-kind. Three fields per `axiomMarkProposalSchema` —
      // `kind` / `node_id` / `participant`. No client-minted event
      // id (the server mints at append time per
      // `proposal_events.md`).
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

      // Success — the `proposed` ack landed. The broadcast
      // `event-applied` for the `proposal` event will arrive (the
      // server broadcasts BEFORE replying the ack per the ws
      // protocol). The `axiomMarks` projector / panel attribution
      // section update naturally on the next render. Remove `nodeId`
      // from the in-flight set + clear any stale error.
      const store2 = useAxiomMarkActionStore.getState();
      store2.setMarking(nodeId, false);
      store2.setError(nodeId, undefined);
    } catch (err) {
      // Failure — the methodology engine rejected, or the request
      // timed out. Remove `nodeId` from in-flight; surface the wire
      // error inline. The user can retry by re-clicking (which also
      // clears the error before the next attempt — symmetric with
      // `useVoteAction`).
      const timeoutText = t('participant.axiomMarkButton.timeoutError');
      const store2 = useAxiomMarkActionStore.getState();
      store2.setMarking(nodeId, false);
      store2.setError(nodeId, toWireError(err, timeoutText));
    }
  }

  return {
    markAsAxiom,
    inFlight,
    lastError,
  };
}
