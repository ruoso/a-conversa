// Unit tests for `projectSnapshots` — the pure selector that projects a
// session's event log into the `Snapshot[]` shape consumed by
// `<SnapshotMarkerStrip>`.
//
// Refinement: tasks/refinements/moderator-ui/mod_snapshot_visual_marker.md
//
// Per ADR 0022 these are committed Vitest cases. They lock in:
//   (a) empty event stream → empty array
//   (b) single `snapshot-created` event → one record with payload-mapped fields
//   (c) multiple `snapshot-created` events → array in insertion (chronological) order
//   (d) events of other kinds are ignored
//   (e) mixed stream returns only snapshot records
//   (f) selector is pure (same input → structurally-equal output)

import { describe, expect, it } from 'vitest';
import type { Event } from '@a-conversa/shared-types';

import { projectSnapshots, type Snapshot } from './selectors';

const SESSION_ID = '00000000-0000-4000-8000-000000000001';
const ACTOR = '00000000-0000-4000-8000-0000000000aa';
const SNAPSHOT_A = '00000000-0000-4000-8000-000000000a01';
const SNAPSHOT_B = '00000000-0000-4000-8000-000000000a02';
const SNAPSHOT_C = '00000000-0000-4000-8000-000000000a03';
const NODE_X = '00000000-0000-4000-8000-00000000000a';

function makeSnapshotCreated(opts: {
  sequence: number;
  envelopeId: string;
  snapshotId: string;
  label: string;
  logPosition: number;
  createdAt?: string;
}): Event {
  return {
    id: opts.envelopeId,
    sessionId: SESSION_ID,
    sequence: opts.sequence,
    kind: 'snapshot-created',
    actor: ACTOR,
    payload: {
      snapshot_id: opts.snapshotId,
      label: opts.label,
      log_position: opts.logPosition,
    },
    createdAt: opts.createdAt ?? '2026-05-31T00:00:00.000Z',
  };
}

function makeNodeCreated(opts: { sequence: number; envelopeId: string; nodeId: string }): Event {
  return {
    id: opts.envelopeId,
    sessionId: SESSION_ID,
    sequence: opts.sequence,
    kind: 'node-created',
    actor: ACTOR,
    payload: {
      node_id: opts.nodeId,
      wording: 'a node',
      created_by: ACTOR,
      created_at: '2026-05-31T00:00:00.000Z',
    },
    createdAt: '2026-05-31T00:00:00.000Z',
  };
}

describe('projectSnapshots', () => {
  it('(a) returns an empty array for an empty event stream', () => {
    expect(projectSnapshots([])).toEqual([]);
  });

  it('(b) projects a single snapshot-created event to one record with payload-mapped fields', () => {
    const events: Event[] = [
      makeSnapshotCreated({
        sequence: 1,
        envelopeId: '00000000-0000-4000-8000-0000000000e1',
        snapshotId: SNAPSHOT_A,
        label: 'Segment 1 close',
        logPosition: 17,
        createdAt: '2026-05-31T12:00:00.000Z',
      }),
    ];
    const expected: Snapshot[] = [
      {
        snapshotId: SNAPSHOT_A,
        label: 'Segment 1 close',
        logPosition: 17,
        createdAt: '2026-05-31T12:00:00.000Z',
      },
    ];
    expect(projectSnapshots(events)).toEqual(expected);
  });

  it('(c) preserves insertion (chronological) order across multiple snapshots', () => {
    const events: Event[] = [
      makeSnapshotCreated({
        sequence: 1,
        envelopeId: '00000000-0000-4000-8000-0000000000e1',
        snapshotId: SNAPSHOT_A,
        label: 'first',
        logPosition: 10,
        createdAt: '2026-05-31T12:00:00.000Z',
      }),
      makeSnapshotCreated({
        sequence: 2,
        envelopeId: '00000000-0000-4000-8000-0000000000e2',
        snapshotId: SNAPSHOT_B,
        label: 'second',
        logPosition: 20,
        createdAt: '2026-05-31T12:01:00.000Z',
      }),
      makeSnapshotCreated({
        sequence: 3,
        envelopeId: '00000000-0000-4000-8000-0000000000e3',
        snapshotId: SNAPSHOT_C,
        label: 'third',
        logPosition: 30,
        createdAt: '2026-05-31T12:02:00.000Z',
      }),
    ];
    const projected = projectSnapshots(events);
    expect(projected.map((s) => s.snapshotId)).toEqual([SNAPSHOT_A, SNAPSHOT_B, SNAPSHOT_C]);
    expect(projected.map((s) => s.label)).toEqual(['first', 'second', 'third']);
    expect(projected.map((s) => s.logPosition)).toEqual([10, 20, 30]);
  });

  it('(d) ignores events of non-snapshot kinds', () => {
    const events: Event[] = [
      makeNodeCreated({
        sequence: 1,
        envelopeId: '00000000-0000-4000-8000-0000000000e1',
        nodeId: NODE_X,
      }),
      makeNodeCreated({
        sequence: 2,
        envelopeId: '00000000-0000-4000-8000-0000000000e2',
        nodeId: NODE_X,
      }),
    ];
    expect(projectSnapshots(events)).toEqual([]);
  });

  it('(e) in a mixed stream returns only the snapshot records', () => {
    const events: Event[] = [
      makeNodeCreated({
        sequence: 1,
        envelopeId: '00000000-0000-4000-8000-0000000000e1',
        nodeId: NODE_X,
      }),
      makeSnapshotCreated({
        sequence: 2,
        envelopeId: '00000000-0000-4000-8000-0000000000e2',
        snapshotId: SNAPSHOT_A,
        label: 'snap-a',
        logPosition: 5,
      }),
      makeNodeCreated({
        sequence: 3,
        envelopeId: '00000000-0000-4000-8000-0000000000e3',
        nodeId: NODE_X,
      }),
      makeSnapshotCreated({
        sequence: 4,
        envelopeId: '00000000-0000-4000-8000-0000000000e4',
        snapshotId: SNAPSHOT_B,
        label: 'snap-b',
        logPosition: 9,
      }),
    ];
    const projected = projectSnapshots(events);
    expect(projected).toHaveLength(2);
    expect(projected.map((s) => s.label)).toEqual(['snap-a', 'snap-b']);
  });

  it('(f) is pure — repeated calls on the same input yield structurally-equal output', () => {
    const events: Event[] = [
      makeSnapshotCreated({
        sequence: 1,
        envelopeId: '00000000-0000-4000-8000-0000000000e1',
        snapshotId: SNAPSHOT_A,
        label: 'first',
        logPosition: 10,
      }),
      makeSnapshotCreated({
        sequence: 2,
        envelopeId: '00000000-0000-4000-8000-0000000000e2',
        snapshotId: SNAPSHOT_B,
        label: 'second',
        logPosition: 20,
      }),
    ];
    const first = projectSnapshots(events);
    const second = projectSnapshots(events);
    expect(first).toEqual(second);
    // Defensive: the selector must not mutate its input.
    expect(events).toHaveLength(2);
  });
});
