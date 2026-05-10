# Snapshot events

**TaskJuggler entry**: [tasks/10-data-and-methodology.tji](../../10-data-and-methodology.tji) — task `data_and_methodology.event_types.snapshot_events`
**Effort estimate**: 0.5d
**Inherited dependencies**: `data_and_methodology.event_types.event_base_envelope` (settled)

## What this task is

Implement the `snapshot-created` event kind. A snapshot names a position in the session's event log so it can be referenced later — for replay, chapter markers in the audience surface, segment-break navigation in test mode.

## Why it needs to be done

Snapshots are how the moderator marks a natural break in the show ("Segment 1 close", commercial break, end of show). Replay's chapter-marker UI navigates by snapshot; test-mode's scrubber jumps to snapshot positions.

## Inputs / context

From [docs/data-model.md — event types — snapshots](../../../docs/data-model.md#snapshots):

> `snapshot-created` — names a position in the event log for replay reference. Payload: label, log position, creator, timestamp.

From [docs/architecture.md — state model: event-sourced](../../../docs/architecture.md#state-model-event-sourced):

> Snapshots (segment breaks, end-of-show artifacts) are named immutable references to a position in the event log. Replay is "play the log up to position X."

From [docs/methodology.md — F10 (snapshot a segment)](../../../docs/moderator-ui.md#f10-snapshot-a-segment): the moderator triggers it from their UI.

## Constraints / requirements

- Lives in `packages/shared-types`.
- The "log position" is the session's `sequence` value at the moment the snapshot is created — typically the `sequence` of the snapshot event itself (the snapshot points at "the state immediately before/at this snapshot event").
- Labels are user-supplied strings (with reasonable length cap).
- The snapshot itself is a regular event in the session log — it's a marker, not a separate table. (See open question.)

## Acceptance criteria

- `SnapshotCreatedPayload` Zod schema exported from `packages/shared-types`:
  - `{ snapshot_id: UUID, label: string, log_position: int (the session's sequence number) }`.
- Added to the discriminated `EventPayload` union.
- Round-trip tests.

## Decisions

- **The snapshot is a regular event** in `session_events` — `kind: 'snapshot-created'`. No separate table.
- **`log_position`** is the session's `sequence` value at the time the snapshot is taken — typically the snapshot event's own sequence (so replay-up-to-this-snapshot includes the snapshot event itself).
- **Label length cap: VARCHAR(128)** — short labels expected ("Segment 1 close").

## Additional decisions

- **Discoverability is already covered** by the `session_events_table`'s `(session_id, kind)` index (specified in round 2 acceptance criteria). No additional index needed for snapshot lookups (R29).

## Open questions

(none — all decided)
