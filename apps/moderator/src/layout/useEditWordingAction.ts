// `useEditWordingAction(nodeId)` — the moderator's edit-wording action hook.
//
// Mirror:    apps/moderator/src/layout/useAxiomMarkAction.ts (per-node
//            keyed Zustand-store shape; per-nodeId in-flight + per-nodeId
//            error slice).
//
// **Per-nodeId keying.** Each `<EditWordingSubmenu>` is bound to a single
// right-clicked nodeId. The in-flight set + per-key error map are both
// keyed by the bound nodeId — two concurrent edit-wording proposals
// against different nodes observe disjoint in-flight / error state. The
// keying matches `useAxiomMarkAction`'s per-(nodeId, participantId)
// shape, dropped to plain nodeId because the edit-wording payload has no
// per-participant axis.
//
// **Reword vs. restructure (methodology).** Per docs/methodology.md the
// moderator chooses between two edit kinds:
//   - **Reword** — same statement, clearer phrasing. The node id is
//     preserved; existing edges keep referring to it. Wire payload:
//     `{ kind: 'edit-wording', edit_kind: 'reword', node_id, new_wording }`.
//   - **Restructure** — meaningfully different statement. The original
//     node is superseded; a fresh node id is minted; edges incident to
//     the original become invisible. Wire payload:
//     `{ kind: 'edit-wording', edit_kind: 'restructure', node_id,
//        new_wording, new_node_id }`.
// The choice is methodologically significant; the hook does NOT default
// to one — the caller must pass the explicit `editKind` argument.
//
// **Client-minted `new_node_id`.** For the `restructure` branch the
// payload requires a fresh UUID. We mint it client-side via
// `crypto.randomUUID()` (mirrors `useProposeAction` / `useProposeProposalAction`)
// so the moderator's local state can immediately reference the new node
// id if needed. The server's `validateEditWordingProposal` rule 4
// rejects a colliding id with `'illegal-state-transition'`.

import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { create } from 'zustand';

import { useWsClient } from '@a-conversa/shell';
import { useWsStore } from '../ws/wsStore';
import { WsRequestError, WsRequestTimeoutError } from '@a-conversa/shell';

/**
 * Edit-kind discriminator. Mirrors `EditWordingProposal['edit_kind']`
 * from `packages/shared-types/src/events/proposals.ts` — re-declared
 * here as a plain string-literal union to keep the hook surface
 * dependency-light (the consumer doesn't need to import the wire schema
 * just to pick a kind).
 */
export type EditWordingKind = 'reword' | 'restructure';

/**
 * Wire-error shape surfaced on `lastError`. Re-declared here (rather
 * than imported from `useCommitAction` / `useAxiomMarkAction`) so the
 * three hooks stay independently consumable — same redeclaration the
 * sibling hooks did off `useProposeAction`.
 */
export interface WireError {
  readonly code: string;
  readonly message: string;
}

export interface UseEditWordingActionResult {
  /**
   * Trigger the edit-wording proposal for the bound nodeId. The
   * in-flight guard short-circuits a concurrent click on the SAME
   * nodeId while the prior round-trip is still in flight; clicks
   * against different nodes are allowed in parallel.
   */
  propose: (newWording: string, editKind: EditWordingKind) => Promise<void>;
  /** True while a propose for the bound nodeId is in flight. */
  inFlight: boolean;
  /** The wire-error from the last failed propose for the bound nodeId, or undefined. */
  lastError: WireError | undefined;
}

/**
 * Module-scoped Zustand slice tracking per-nodeId in-flight edit-wording
 * state + the last wire error per nodeId. Lives outside React so two
 * `useEditWordingAction(nodeId)` call sites for the same node share
 * state — mirrors `useAxiomMarkStore`'s shape.
 */
interface EditWordingState {
  readonly inFlight: ReadonlySet<string>;
  readonly errors: ReadonlyMap<string, WireError>;
  readonly setInFlight: (nodeId: string, flag: boolean) => void;
  readonly setError: (nodeId: string, error: WireError | undefined) => void;
}

export const useEditWordingStore = create<EditWordingState>((set) => ({
  inFlight: new Set<string>(),
  errors: new Map<string, WireError>(),
  setInFlight: (nodeId: string, flag: boolean) =>
    set((state) => {
      const next = new Set(state.inFlight);
      if (flag) next.add(nodeId);
      else next.delete(nodeId);
      return { inFlight: next };
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
 * Test seam — reset the module-scoped edit-wording slice between cases.
 * Mirrors `resetAxiomMarkStore()`.
 */
export function resetEditWordingStore(): void {
  useEditWordingStore.setState({
    inFlight: new Set<string>(),
    errors: new Map<string, WireError>(),
  });
}

/**
 * Map any thrown error to the `WireError` surface. Mirrors the same
 * helper in `useCommitAction` / `useAxiomMarkAction` / `useProposeAction`.
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
 * Generate a client-side UUID v4. Delegates to `crypto.randomUUID()`
 * when available (every modern browser), with a deterministic-shape
 * fallback for environments that lack the API. Mirrors the identical
 * helper in `useProposeAction` / `useProposeProposalAction`.
 */
function randomUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const hex = (n: number): string => n.toString(16).padStart(2, '0');
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const b = Array.from(bytes, hex);
  return `${b[0]}${b[1]}${b[2]}${b[3]}-${b[4]}${b[5]}-${b[6]}${b[7]}-${b[8]}${b[9]}-${b[10]}${b[11]}${b[12]}${b[13]}${b[14]}${b[15]}`;
}

/** Internal seam — overridable by tests so the minted `new_node_id` is deterministic. */
let uuidProvider: () => string = randomUuid;
/** Test seam — install a deterministic UUID provider for assertions. */
export function setUuidProviderForTesting(fn: (() => string) | undefined): void {
  uuidProvider = fn ?? randomUuid;
}

/**
 * The per-node edit-wording hook. Accepts the bound `nodeId` (the
 * right-clicked node's id) and returns the imperative `propose`
 * callback + observable `inFlight` / `lastError` slices.
 *
 * **Subscription model.** Subscribes to the full `inFlight` Set +
 * `errors` Map references so the submenu's render observes flips for
 * its bound nodeId; the per-key projections (`inFlight` boolean,
 * `lastError`) are derived in the hook body. Mirrors
 * `useAxiomMarkAction`'s posture.
 */
export function useEditWordingAction(nodeId: string): UseEditWordingActionResult {
  const { t } = useTranslation();

  // Session-id read off the route param (same as the sibling hooks).
  const { id: sessionIdParam } = useParams<{ id: string }>();
  const sessionId = sessionIdParam ?? '';

  const client = useWsClient();

  // Subscribe to the full slices — the per-key derivation below filters
  // down to the bound nodeId.
  const inFlightSet = useEditWordingStore((s) => s.inFlight);
  const errorsMap = useEditWordingStore((s) => s.errors);

  const inFlight = inFlightSet.has(nodeId);
  const lastError = errorsMap.get(nodeId);

  async function propose(newWording: string, editKind: EditWordingKind): Promise<void> {
    // In-flight guard — concurrent click on the SAME nodeId is a no-op
    // (the existing round-trip will resolve on its own; we don't fire a
    // duplicate envelope).
    if (useEditWordingStore.getState().inFlight.has(nodeId)) {
      return;
    }

    // Flip in-flight + clear any prior error for this key. The order
    // matters: the submenu's render transitions before the WS send
    // fires, so a test that asserts the in-flight visual immediately
    // after the click observes the post-flip state.
    const store = useEditWordingStore.getState();
    store.setInFlight(nodeId, true);
    store.setError(nodeId, undefined);

    try {
      // Build the edit-wording propose envelope. The shape matches the
      // nested discriminated union from
      // `packages/shared-types/src/events/proposals.ts` —
      // `reword` carries `{ kind, edit_kind, node_id, new_wording }`;
      // `restructure` additionally carries a client-minted `new_node_id`.
      const expectedSequence =
        useWsStore.getState().sessionState[sessionId]?.lastAppliedSequence ?? 0;
      const proposal =
        editKind === 'reword'
          ? {
              kind: 'edit-wording' as const,
              edit_kind: 'reword' as const,
              node_id: nodeId,
              new_wording: newWording,
            }
          : {
              kind: 'edit-wording' as const,
              edit_kind: 'restructure' as const,
              node_id: nodeId,
              new_wording: newWording,
              new_node_id: uuidProvider(),
            };
      await client.send('propose', {
        sessionId,
        expectedSequence,
        proposal,
      });

      // Success — clear in-flight, drop any stale error for this key.
      const store2 = useEditWordingStore.getState();
      store2.setInFlight(nodeId, false);
      store2.setError(nodeId, undefined);
    } catch (err) {
      // Failure — surface the wire error inline on this nodeId. The
      // submenu reads `lastError` and renders the matching localized
      // message in its inline error region.
      const timeoutText = t('moderator.editWordingAction.errorBanner.timeout');
      const store2 = useEditWordingStore.getState();
      store2.setInFlight(nodeId, false);
      store2.setError(nodeId, toWireError(err, timeoutText));
    }
  }

  return {
    propose,
    inFlight,
    lastError,
  };
}
