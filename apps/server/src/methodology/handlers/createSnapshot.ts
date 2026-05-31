// `createSnapshot` standalone helper — mints `snapshot-created` events
// for the moderator's labeled-snapshot flow (F10).
//
// Refinement: tasks/refinements/data-and-methodology/snapshot_create_logic.md
// TaskJuggler: data_and_methodology.methodology_engine.snapshot_create_logic
//
// **Not registered through `validateAction`.** The four agreement-engine
// action kinds (`propose` / `vote` / `commit` / `mark-meta-disagreement`)
// flow through the `validateAction` dispatcher with a `Projection`
// argument and a universal participant-gate pre-check. Snapshots are
// not facets, are not voted on, take no projection, and have no
// participant gate at this layer (the WS handler `ws_label_snapshot_message`
// owns the moderator-only gate). Registering a fifth `ActionKind` here
// would force snapshot dispatch through machinery whose preconditions
// don't apply (see refinement Decisions §1). The WS layer imports
// `createSnapshot` directly and calls it from its `label-snapshot`
// dispatch arm.
//
// **What this helper enforces** (per the refinement Constraints
// section):
//
//   1. **Trim.** The raw label is `.trim()`-ed before any further check;
//      the trimmed value is what flows into the payload and into the
//      length check.
//   2. **Non-empty.** Trimmed length must be `>= 1`. Empty or
//      whitespace-only labels reject as `'invalid-label'` with detail
//      `'snapshot label cannot be empty'`.
//   3. **Length cap.** Trimmed length must be `<= MAX_SNAPSHOT_LABEL_LENGTH`
//      (128). Over-cap labels reject as `'invalid-label'` with detail
//      naming the cap and the actual length.
//
// **Result shape.** Returns the standard `ValidationResult` discriminated
// union (`{ ok: true, events: [env] }` or `{ ok: false, reason, detail }`)
// so the WS layer's `label-snapshot` arm reuses the same error-handling
// skeleton it uses for the four registered agreement-engine action
// handlers. See refinement Decisions §2.
//
// **UUID minting.** This handler calls `randomUUID()` twice per
// invocation — once for the envelope `id`, once for the payload
// `snapshot_id`. The two are distinct identities by construction. This
// is a deliberate divergence from the four agreement-engine handlers'
// "API layer mints envelope fields" convention because (a) snapshot
// creation does NOT flow through `validateAction`, so the API/engine
// split doesn't apply, and (b) the `snapshot_id` is a payload-level
// identity the WS handler would otherwise mint and thread through the
// input shape, adding boilerplate without adding coverage. See
// refinement Decisions §3.
//
// **Boundary with the WS handler (`ws_label_snapshot_message`).** This
// helper owns label validation + envelope construction. The WS handler
// owns wire-layer gates (subscribe-before-act, moderator-only authority,
// `expectedSequence` optimistic-concurrency), sequence allocation
// (reads `MAX(sequence)` under a row lock and passes it in as
// `currentSequence`), and the persistence + broadcast side of the cycle.

import { randomUUID } from 'node:crypto';

import { MAX_SNAPSHOT_LABEL_LENGTH } from '@a-conversa/shared-types';

import type { EventToAppendEnvelope, ValidationResult } from '../types.js';

export interface CreateSnapshotInput {
  /** Owning session id; flows into the envelope's `sessionId`. */
  sessionId: string;
  /** Authenticated moderator id; flows into the envelope's `actor`. */
  moderatorId: string;
  /**
   * Raw client-provided label. The handler trims and validates; the
   * trimmed value is what reaches the payload and the schema.
   */
  label: string;
  /**
   * Last applied sequence in the session, as read by the WS handler
   * under its row lock. The snapshot event takes `currentSequence + 1`
   * for both its envelope `sequence` and its payload `log_position`.
   */
  currentSequence: number;
  /** ISO-8601 server-clock time; flows into the envelope's `createdAt`. */
  now: string;
}

export function createSnapshot(input: CreateSnapshotInput): ValidationResult {
  const trimmed = input.label.trim();

  if (trimmed.length < 1) {
    return {
      ok: false,
      reason: 'invalid-label',
      detail: 'snapshot label cannot be empty',
    };
  }

  if (trimmed.length > MAX_SNAPSHOT_LABEL_LENGTH) {
    return {
      ok: false,
      reason: 'invalid-label',
      detail: `snapshot label exceeds ${MAX_SNAPSHOT_LABEL_LENGTH} characters (got ${trimmed.length})`,
    };
  }

  const sequence = input.currentSequence + 1;
  const snapshotId = randomUUID();
  const envelopeId = randomUUID();

  const envelope: EventToAppendEnvelope<'snapshot-created'> = {
    id: envelopeId,
    sessionId: input.sessionId,
    sequence,
    kind: 'snapshot-created',
    actor: input.moderatorId,
    payload: {
      snapshot_id: snapshotId,
      label: trimmed,
      log_position: sequence,
    },
    createdAt: input.now,
  };

  return { ok: true, events: [envelope] };
}
