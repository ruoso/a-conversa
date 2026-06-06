// Vitest cases for `latestSnapshot.ts`.
//
// Refinement: tasks/refinements/audience/aud_chapter_marker_render.md
//   (Acceptance criteria §1 — empty → null; single → that snapshot;
//   multiple → the LAST by stream order; non-snapshot events ignored;
//   the no-snapshot result is referentially stable across calls.)
//
// Case shape mirrors `sessionRoster.test.ts` — pure projector over a
// synthetic `Event[]` built from inline factory helpers.

import { describe, expect, it } from 'vitest';
import type { Event } from '@a-conversa/shared-types';

import { latestSnapshotFrom } from './latestSnapshot.js';

const SESSION_ID = '00000000-0000-4000-8000-0000000000aa';
const ACTOR_ID = '00000000-0000-4000-8000-000000000001';

function snapshotEvent(opts: {
  sequence: number;
  snapshotId: string;
  label: string;
  logPosition: number;
}): Event {
  return {
    id: `00000000-0000-4000-8000-${(0x700 + opts.sequence).toString(16).padStart(12, '0')}`,
    sessionId: SESSION_ID,
    sequence: opts.sequence,
    kind: 'snapshot-created',
    actor: ACTOR_ID,
    payload: {
      snapshot_id: opts.snapshotId,
      label: opts.label,
      log_position: opts.logPosition,
    },
    createdAt: '2026-05-18T00:00:00.000Z',
  };
}

function nodeEvent(opts: { sequence: number; nodeId: string }): Event {
  return {
    id: `00000000-0000-4000-8000-${(0x800 + opts.sequence).toString(16).padStart(12, '0')}`,
    sessionId: SESSION_ID,
    sequence: opts.sequence,
    kind: 'node-created',
    actor: ACTOR_ID,
    payload: {
      node_id: opts.nodeId,
      wording: 'UBI lifts the welfare floor',
      created_by: ACTOR_ID,
      created_at: '2026-05-18T00:00:00.000Z',
    },
    createdAt: '2026-05-18T00:00:00.000Z',
  };
}

const SNAP_1 = '00000000-0000-4000-8000-0000000000c1';
const SNAP_2 = '00000000-0000-4000-8000-0000000000c2';
const NODE_1 = '00000000-0000-4000-8000-0000000000d1';

describe('latestSnapshotFrom', () => {
  it('(a) returns null for an empty event log', () => {
    expect(latestSnapshotFrom([])).toBeNull();
  });

  it('(b) projects a single snapshot-created event to its { snapshotId, label, logPosition }', () => {
    const result = latestSnapshotFrom([
      snapshotEvent({ sequence: 1, snapshotId: SNAP_1, label: 'Segment 1 close', logPosition: 1 }),
    ]);
    expect(result).toEqual({
      snapshotId: SNAP_1,
      label: 'Segment 1 close',
      logPosition: 1,
    });
  });

  it('(c) returns the LAST snapshot by stream order when several are present', () => {
    const result = latestSnapshotFrom([
      snapshotEvent({ sequence: 1, snapshotId: SNAP_1, label: 'Segment 1 close', logPosition: 1 }),
      snapshotEvent({ sequence: 2, snapshotId: SNAP_2, label: 'Commercial', logPosition: 2 }),
    ]);
    expect(result).toEqual({
      snapshotId: SNAP_2,
      label: 'Commercial',
      logPosition: 2,
    });
  });

  it('(d) ignores non-snapshot events, projecting the latest snapshot among them', () => {
    const result = latestSnapshotFrom([
      nodeEvent({ sequence: 1, nodeId: NODE_1 }),
      snapshotEvent({ sequence: 2, snapshotId: SNAP_1, label: 'Segment 1 close', logPosition: 2 }),
      nodeEvent({ sequence: 3, nodeId: NODE_1 }),
    ]);
    expect(result).toEqual({
      snapshotId: SNAP_1,
      label: 'Segment 1 close',
      logPosition: 2,
    });
  });

  it('(e) returns a referentially stable result (null) across calls for a no-snapshot log', () => {
    const a = latestSnapshotFrom([nodeEvent({ sequence: 1, nodeId: NODE_1 })]);
    const b = latestSnapshotFrom([]);
    expect(a).toBeNull();
    expect(b).toBeNull();
    expect(a).toBe(b);
  });
});
