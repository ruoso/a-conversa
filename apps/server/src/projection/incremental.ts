// Incremental projection update — steady-state per-event entry point.
//
// Refinement: tasks/refinements/data-and-methodology/project_incrementally.md
// TaskJuggler: data_and_methodology.projection.project_incrementally
//
// `applyEventIncremental(projection, event)` is the on-the-wire entry
// point: given a projection that has consumed events 1..N, apply the
// event at sequence N+1 and return the `ProjectionChange[]` change
// feed describing what the event touched. The eventual WS broadcaster
// reads the feed to emit per-client deltas; the methodology UI reads
// it to highlight what's new.
//
// **Boundary with `applyEvent`**: `applyEvent` (replay.ts) is the
// shared dispatcher — the per-kind logic, the sequence-gap check,
// the change feed accumulation all live there. This module is a
// thin named export that documents the steady-state contract
// separately from the on-load replay contract. The two paths share
// the same per-event logic by construction; the difference between
// "replay from zero" and "apply one event" is just whether the
// projection started fresh.
//
// **Sequence semantics**: see `OutOfOrderEventError` in replay.ts.
// Duplicate sequences, gaps, and out-of-order sequences all throw
// the same error (with `expectedSequence` and `actualSequence`
// fields the caller can read).
//
// **Atomicity**: a mid-event throw leaves `lastAppliedSequence`
// unchanged so a retry of the same event sequence is well-defined.
// The projection's storage state may be partially mutated; the
// caller's recovery story is "discard the projection and rebuild
// from the event log via `projectFromLog`," not "try this single
// event again." See the refinement's atomicity decision.

import type { Event } from '@a-conversa/shared-types';

import { Projection } from './projection.js';
import { applyEvent } from './replay.js';
import type { ProjectionChange } from './types.js';

export function applyEventIncremental(projection: Projection, event: Event): ProjectionChange[] {
  return applyEvent(projection, event);
}
