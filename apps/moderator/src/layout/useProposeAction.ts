// `useProposeAction()` — the moderator's propose-bundle React hook.
//
// Refinement: tasks/refinements/moderator-ui/mod_propose_action.md
//             tasks/refinements/per-facet-refactor/pf_mod_capture_pane_wording_only.md
// Design doc: docs/moderator-ui.md (F1 capture flow, step 4)
// ADR:        docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md (§1, §4, §5)
//
// Per ADR 0030 §1 (wording-only capture), the capture-pane gesture is a
// stand-alone `capture-node` proposal — the classification facet enters
// life as `awaiting-proposal` and is named by a later moderator
// gesture against the per-node card. The bundled `classify-node`-with-
// wording path is retired; this hook only mints `capture-node` (with
// an optional inline `edge` block for the connecting-capture case per
// ADR 0030 §4).
//
// Binds three `useCaptureStore` slices (`text`, `targetEntityId`,
// `edgeRole`) to the WS-write surface
// (`useWsClient().send('propose', payload)`). Exposes:
//
//   - `propose()` — the gesture handler, called from both the
//     `<CaptureTextInput>` Cmd/Ctrl+Enter callback and the
//     `<ProposeAction>` button click.
//   - `canPropose` — `true` iff the validation gates pass AND no
//     other propose round-trip is in flight.
//   - `validationError` — the failing-gate reason, or `null`.
//   - `inFlight` — `true` while the round-trip is in flight.
//   - `lastError` — the wire-error code + message from the last failed
//     propose, or `undefined`.
//
// The hook owns:
//
//   - The validation gates — fire in fixed order:
//     `session-missing` → `not-connected` → `text-empty` →
//     `target-without-role` → `role-without-target`. (Per
//     `pf_mod_capture_pane_wording_only`, classification is no longer
//     part of the capture gesture, so the `classification-missing`
//     reason is gone.)
//   - Client-side `node_id` / `edge_id` UUID generation via
//     `crypto.randomUUID()` (same primitive `WsClient` uses for
//     envelope ids).
//   - The optimistic-clear contract: capture a snapshot of the
//     capture-store slices before resetting; on error, restore the
//     snapshot so the moderator can fix and retry without re-typing.
//   - A SINGLE-envelope protocol for both the free-floating and the
//     connecting case: per ADR 0030 §4 the compound capture-with-edge
//     gesture is one `capture-node` proposal whose payload carries an
//     optional inline `edge` block, NOT two sequenced envelopes. The
//     server emits node-created + entity-included(node) + edge-created
//     + entity-included(edge) + proposal in a single propose
//     round-trip.
//   - The in-flight guard: a concurrent `propose()` call while a
//     prior round-trip is still in flight is a no-op.
//
// Errors raised by the WS client are mapped to `WireError`:
//
//   - `WsRequestError(payload)` → `{ code: payload.code, message:
//     payload.message }`. The server's localized-or-not message is
//     authoritative (some engine rejections carry per-case detail
//     that cannot be looked up from a fixed key catalog —
//     Decision §6).
//   - `WsRequestTimeoutError` → `{ code: 'timeout', message: <localized
//     timeout text> }`.
//   - Any other `Error` → `{ code: 'unknown', message: err.message }`.
//
// Dismissal of `lastError` is driven by the consumer: the hook
// auto-clears `lastError` on the next successful `propose()` AND on
// any change to `text` / `classification` / `targetEntityId` /
// `edgeRole` (the "user is fixing it" signal — Decision §6).

import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { create } from 'zustand';
import type { EdgeRole, ProposalPayload } from '@a-conversa/shared-types';

import {
  useCaptureStore,
  type CaptureTargetKind,
  type EdgeDirection,
} from '../stores/captureStore';
import { useWsClient } from '@a-conversa/shell';
import { useWsStore } from '../ws/wsStore';
import { WsRequestError, WsRequestTimeoutError } from '@a-conversa/shell';

/**
 * The discriminated set of validation-gate failure reasons. Each maps
 * to a localized inline-error message via the
 * `moderator.proposeAction.reason.<reason>` catalog key. The order in
 * `validate()` matches the priority pinned by Decision §2 (with the
 * `classification-missing` reason removed per
 * `pf_mod_capture_pane_wording_only` — the capture-pane gesture is
 * wording-only and classification moves to the per-node card).
 */
export type ValidationErrorReason =
  | 'text-empty'
  | 'role-without-target'
  | 'target-without-role'
  | 'session-missing'
  | 'not-connected';

/**
 * Shape surfaced from `lastError`. `code` is the engine's rejection
 * code (or a transport-layer code like `'timeout'` / `'unknown'`);
 * `message` is the wire-supplied message verbatim when present, or a
 * localized fallback for transport-layer errors.
 */
export interface WireError {
  readonly code: string;
  readonly message: string;
}

export interface UseProposeActionResult {
  /** Trigger the propose round-trip. Idempotent during the in-flight window. */
  propose: () => Promise<void>;
  /** True when all six gates pass and no propose is in flight. */
  canPropose: boolean;
  /** The failing-gate reason, or null. */
  validationError: ValidationErrorReason | null;
  /** True while a propose round-trip is in flight. */
  inFlight: boolean;
  /** The wire-error code + message from the last failed propose, or undefined. */
  lastError: WireError | undefined;
}

/**
 * Module-scoped Zustand slice holding the last wire error. Lives
 * outside React so the two `useProposeAction()` call sites — one in
 * `<OperateRoute>` (driving the textarea Cmd/Ctrl+Enter callback) and
 * one in `<ProposeAction>` (driving the button click) — observe the
 * SAME error after a failed propose. `useState` would give each hook
 * instance its own copy, which would mean a Cmd+Enter-triggered
 * failure would not render the error region inside the
 * `<ProposeAction>` button.
 *
 * The slice is intentionally tiny — no setters beyond the two the
 * hook uses internally; no React provider; no devtools wiring.
 * Reset on a fresh successful propose AND on any user-modification
 * of the four capture-store slices (Decision §6).
 */
interface ProposeErrorState {
  lastError: WireError | undefined;
  setLastError: (error: WireError | undefined) => void;
}

const useProposeErrorStore = create<ProposeErrorState>((set) => ({
  lastError: undefined,
  setLastError: (lastError) => set({ lastError }),
}));

/**
 * Test seam — let test suites reset the module-scoped error slice
 * between cases without poking at the store's internals.
 */
export function resetProposeError(): void {
  useProposeErrorStore.getState().setLastError(undefined);
}

/**
 * Generate a client-side UUID v4. Delegates to `crypto.randomUUID()`
 * when available (every modern browser; `WsClient` already relies on
 * it), with a deterministic-shape fallback for environments that
 * lack the API.
 */
function randomUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback — same shape as `client.ts`'s `nativeRandomId` fallback.
  const hex = (n: number): string => n.toString(16).padStart(2, '0');
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const b = Array.from(bytes, hex);
  return `${b[0]}${b[1]}${b[2]}${b[3]}-${b[4]}${b[5]}-${b[6]}${b[7]}-${b[8]}${b[9]}-${b[10]}${b[11]}${b[12]}${b[13]}${b[14]}${b[15]}`;
}

/**
 * Build a `capture-node` proposal payload for the new statement node
 * per ADR 0030 §1 (wording-only capture). The wording rides inline on
 * the entity-layer carriage so the server emits `node-created` +
 * `entity-included(node)` + `proposal` at propose-time and the canvas
 * projector renders the captured node in `proposed`-wording state
 * immediately. The classification + substance facets enter life as
 * `awaiting-proposal` (per ADR 0030 §10) and are named by later
 * per-node moderator gestures.
 *
 * For the connecting-capture case (ADR 0030 §4), the optional `edge`
 * block carries the edge id + role + endpoints inline; the server
 * emits `edge-created` + `entity-included(edge)` alongside the node
 * fan-out in a SINGLE round-trip (no second envelope). The endpoint
 * assignment is controlled by `direction`:
 *
 *   - `'targets'` (default): the just-captured node is the edge SOURCE
 *     and the pre-existing node is the edge TARGET — "new statement
 *     targets the existing one." This is the original capture shape.
 *   - `'targeted-by'`: the endpoints are inverted — the pre-existing
 *     node is the SOURCE and the just-captured node is the TARGET —
 *     "new statement is targeted by the existing one." The capture-
 *     node validator's rule 3 already accepts either endpoint as the
 *     just-captured `node_id`, so no engine change is needed.
 *
 * The substance facet of the connecting edge enters life as
 * `awaiting-proposal` (named by a later `set-edge-substance` against
 * the captured edge).
 */
function buildCaptureNodeProposal(args: {
  nodeId: string;
  wording: string;
  edge?: {
    edgeId: string;
    otherEntity: { kind: CaptureTargetKind; id: string };
    role: EdgeRole;
    direction: EdgeDirection;
  };
}): ProposalPayload {
  if (args.edge !== undefined) {
    const newNodeIsSource = args.edge.direction === 'targets';
    // The just-captured entity is always a node (capture mints a
    // statement node, never an annotation). The OTHER endpoint is
    // either a node OR a promoted annotation per the polymorphic-
    // endpoint widening landed by `set_edge_substance_annotation_endpoint`.
    // Route each id to its kind-appropriate slot — the schema's
    // per-endpoint `.refine()` (EXACTLY-ONE for capture-node) is the
    // first-line guard.
    const newNodeSlot = newNodeIsSource
      ? { source_node_id: args.nodeId }
      : { target_node_id: args.nodeId };
    const otherSlot = newNodeIsSource
      ? args.edge.otherEntity.kind === 'annotation'
        ? { target_annotation_id: args.edge.otherEntity.id }
        : { target_node_id: args.edge.otherEntity.id }
      : args.edge.otherEntity.kind === 'annotation'
        ? { source_annotation_id: args.edge.otherEntity.id }
        : { source_node_id: args.edge.otherEntity.id };
    return {
      kind: 'capture-node',
      node_id: args.nodeId,
      wording: args.wording,
      edge: {
        edge_id: args.edge.edgeId,
        role: args.edge.role,
        ...newNodeSlot,
        ...otherSlot,
      },
    };
  }
  return {
    kind: 'capture-node',
    node_id: args.nodeId,
    wording: args.wording,
  };
}

/**
 * Map any thrown error to the `WireError` surface. `WsRequestError`
 * carries the server's typed payload verbatim; `WsRequestTimeoutError`
 * gets a localized fallback message; anything else lands as
 * `'unknown'`. The `timeoutText` is pre-resolved by the caller (so the
 * function stays React-free and easy to test).
 *
 * Re-exported (`export function`) so sibling propose hooks
 * (`useProposeDecompositionAction` and any future flow with the same
 * round-trip shape) consume the single canonical mapping rather than
 * duplicating it. Decision §11 of
 * `tasks/refinements/moderator-ui/mod_propose_decomposition.md` records
 * the helper-reuse-via-re-export rationale.
 */
export function toWireError(err: unknown, timeoutText: string): WireError {
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

export function useProposeAction(): UseProposeActionResult {
  const { t } = useTranslation();

  // Capture-store reads (one selector each so React re-subscribes
  // only when the relevant slice changes). Per
  // `pf_mod_capture_pane_wording_only` the `classification` slice is
  // no longer read here — classification is named on the per-node card
  // by a downstream task.
  const text = useCaptureStore((s) => s.text);
  const targetEntityId = useCaptureStore((s) => s.targetEntityId);
  const edgeRole = useCaptureStore((s) => s.edgeRole);
  const proposing = useCaptureStore((s) => s.proposing);
  const setProposing = useCaptureStore((s) => s.setProposing);

  // Session + WS reads.
  const { id: sessionIdParam } = useParams<{ id: string }>();
  const sessionId = sessionIdParam ?? '';
  const connectionStatus = useWsStore((s) => s.connectionStatus);
  const lastAppliedSequenceForCall = (): number =>
    useWsStore.getState().sessionState[sessionId]?.lastAppliedSequence ?? 0;
  const client = useWsClient();

  const lastError = useProposeErrorStore((s) => s.lastError);
  const setLastError = useProposeErrorStore((s) => s.setLastError);

  // Validation — fixed order. Per `pf_mod_capture_pane_wording_only`
  // the `classification-missing` gate is dropped (the capture-pane
  // gesture is wording-only; classification moves to the per-node
  // card by a downstream task).
  let validationError: ValidationErrorReason | null = null;
  if (sessionId === '') {
    validationError = 'session-missing';
  } else if (connectionStatus !== 'open') {
    validationError = 'not-connected';
  } else if (text.trim().length === 0) {
    validationError = 'text-empty';
  } else if (targetEntityId !== null && edgeRole === null) {
    validationError = 'target-without-role';
  } else if (edgeRole !== null && targetEntityId === null) {
    validationError = 'role-without-target';
  }

  const canPropose = validationError === null && !proposing;

  // Auto-dismiss the wire-error region on any user-modification of the
  // capture inputs (Decision §6). The effect fires when any of the
  // three capture slices change. To avoid the snapshot-restore-after-
  // failure path immediately clearing the just-set `lastError`, we
  // capture the slice values at the moment `lastError` was set (the
  // snapshot restore's post-condition); the effect only dismisses when
  // the current slice values DIFFER from those captured values — i.e.,
  // the moderator typed / picked something after the failure.
  const lastErrorRef = useRef<WireError | undefined>(lastError);
  const errorSliceSnapshotRef = useRef<{
    text: string;
    targetEntityId: typeof targetEntityId;
    edgeRole: typeof edgeRole;
  } | null>(null);
  // Detect a fresh `setLastError(error)` transition (undefined → defined)
  // and capture the current slice values as the "baseline" — subsequent
  // slice changes that differ from this baseline dismiss the error.
  if (lastError !== undefined && lastErrorRef.current === undefined) {
    errorSliceSnapshotRef.current = { text, targetEntityId, edgeRole };
  }
  if (lastError === undefined) {
    errorSliceSnapshotRef.current = null;
  }
  lastErrorRef.current = lastError;
  useEffect(() => {
    if (lastErrorRef.current === undefined) return;
    const baseline = errorSliceSnapshotRef.current;
    if (baseline === null) return;
    if (
      baseline.text === text &&
      baseline.targetEntityId === targetEntityId &&
      baseline.edgeRole === edgeRole
    ) {
      // No real user change since the error landed — keep the region
      // visible.
      return;
    }
    setLastError(undefined);
    // Dep list is the three capture slices the moderator is editing.
  }, [text, targetEntityId, edgeRole, setLastError]);

  // The propose handler. Closes over the current render's slice values
  // via lexical scope; the in-flight guard short-circuits a re-entry.
  async function propose(): Promise<void> {
    // Re-check validation at call-time — keystrokes between the last
    // render and this call could have invalidated the form.
    const currentState = useCaptureStore.getState();
    const wsState = useWsStore.getState();
    const sessionIdNow = sessionId;
    const connectionStatusNow = wsState.connectionStatus;
    const textNow = currentState.text;
    const targetEntityIdNow = currentState.targetEntityId;
    const targetEntityKindNow = currentState.targetEntityKind;
    const edgeRoleNow = currentState.edgeRole;
    const edgeDirectionNow = currentState.edgeDirection;

    if (currentState.proposing) {
      // Concurrent re-entry — Decision §5 + AC 12.8. Drop silently.
      return;
    }

    // Re-run the gates against the call-time state.
    if (sessionIdNow === '') return;
    if (connectionStatusNow !== 'open') return;
    if (textNow.trim().length === 0) return;
    if (targetEntityIdNow !== null && edgeRoleNow === null) return;
    if (edgeRoleNow !== null && targetEntityIdNow === null) return;
    // Cross-flow defensive guard (Decision §4 of
    // `mod_meta_move_edge_target_gesture.md`): the F1 capture-with-edge
    // flow only routes endpoints by `'node' | 'annotation'`; an `'edge'`
    // kind would be misrouted by `buildCaptureNodeProposal`'s endpoint
    // ternary. The edge-click gesture is mode-gated to `'meta-move'`,
    // so this guard fires only on a programmatic stage outside the
    // normal user paths — drop silently rather than emit a wire-trap.
    if (targetEntityIdNow !== null && targetEntityKindNow === 'edge') return;

    // Snapshot the capture slices BEFORE the optimistic clear. On any
    // error path we restore from the snapshot so the moderator can
    // fix and retry without re-typing (Decision §4).
    const snapshot = {
      text: textNow,
      targetEntityId: targetEntityIdNow,
      targetEntityKind: targetEntityKindNow,
      edgeRole: edgeRoleNow,
      edgeDirection: edgeDirectionNow,
    };

    // Mint the client-side ids. Held in `propose`'s lexical scope so
    // the optional `edge` block (connecting-capture case) carries the
    // same fresh edge id the server emits `edge-created` for.
    const nodeId = randomUuid();
    const isConnecting = targetEntityIdNow !== null && edgeRoleNow !== null;
    const edgeId = isConnecting ? randomUuid() : undefined;

    // Optimistic clear + flip in-flight. The moderator's next keystroke
    // immediately begins a new draft; the prior propose is in flight.
    // **Order matters**: `reset()` spreads `initialCaptureState`, which
    // includes `proposing: false`; flipping `proposing` to `true` AFTER
    // the reset is what lets sibling components observe the in-flight
    // window AND what makes the in-flight guard at the top of `propose()`
    // reject a concurrent re-entry.
    currentState.reset();
    setProposing(true);

    try {
      // Single envelope — `capture-node` (ADR 0030 §1 wording-only
      // capture). For the connecting-capture case (ADR 0030 §4), the
      // payload's optional `edge` block carries the edge id + role +
      // endpoints inline; the server emits node-created +
      // entity-included(node) + edge-created + entity-included(edge) +
      // proposal in a single propose round-trip. The non-null
      // assertions on `edgeRoleNow` / `targetEntityIdNow` / `edgeId`
      // are pinned by the `isConnecting` predicate above.
      const proposal =
        isConnecting && edgeId !== undefined && targetEntityIdNow !== null && edgeRoleNow !== null
          ? buildCaptureNodeProposal({
              nodeId,
              wording: textNow,
              edge: {
                edgeId,
                otherEntity: { kind: targetEntityKindNow, id: targetEntityIdNow },
                role: edgeRoleNow,
                direction: edgeDirectionNow,
              },
            })
          : buildCaptureNodeProposal({ nodeId, wording: textNow });
      await client.send('propose', {
        sessionId: sessionIdNow,
        expectedSequence: lastAppliedSequenceForCall(),
        proposal,
      });

      // Success — clear in-flight, drop any stale wire-error.
      setProposing(false);
      setLastError(undefined);
    } catch (err) {
      // Failure — restore the snapshot and surface the error inline.
      // Use `setState` rather than the individual setters so the
      // slices land atomically (one re-render, one store transition).
      useCaptureStore.setState({
        text: snapshot.text,
        targetEntityId: snapshot.targetEntityId,
        targetEntityKind: snapshot.targetEntityKind,
        edgeRole: snapshot.edgeRole,
        edgeDirection: snapshot.edgeDirection,
        proposing: false,
      });
      const timeoutText = t('moderator.proposeAction.timeoutError');
      setLastError(toWireError(err, timeoutText));
    }
  }

  return {
    propose,
    canPropose,
    validationError,
    inFlight: proposing,
    lastError,
  };
}
