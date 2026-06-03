// Curated walkthrough seed — the "Should zoos exist?" demo event log,
// shipped as a production asset of the landing bundle.
//
// Refinement: tasks/refinements/landing_page/landing_walkthrough_seed.md
// TaskJuggler: landing_page.landing_walkthrough_seed
//
// `walkthrough_demo_stepper` loads this seed and, on each scrubber
// position, projects `events[0..pos]` and re-renders through
// `@a-conversa/graph-view` (`GraphViewProps.events: readonly Event[]`).
// That demo ships in `apps/root`, so it needs the event log as a
// **production** asset rather than reaching into the `private`,
// test-only `@a-conversa/test-fixtures` package and its DB-oriented
// loader (refinement Decision 2 / constraint 2).
//
// The on-disk asset (`./walkthrough-events.json`) is a *verbatim* copy
// of the canonical fixture
// (`packages/test-fixtures/src/fixtures/walkthrough/events.json`); the
// drift guard in `index.test.ts` asserts byte-for-byte structural
// equality so the two can never silently diverge.
//
// **Envelope normalization, not validation.** The canonical fixture is
// stored in the persistence/DB-row shape — `session_id` / `created_at`
// (snake_case) — whereas the canonical `Event` envelope the consumer
// (`@a-conversa/graph-view`) is typed against uses `sessionId` /
// `createdAt` (camelCase; see `EventEnvelope` in
// `@a-conversa/shared-types`). We remap the *outer* envelope keys so the
// exported array is an honest `readonly Event[]` — the exact prop shape
// `GraphView` consumes, with no cast required at the call site
// (refinement constraint 3). This is a cheap key-rename over 266 events,
// NOT runtime schema parsing: per refinement constraint 5, `validateEvent`
// runs in the test, not on page load. The payload is forwarded untouched
// (its internal keys are already the snake_case the per-kind payload
// schemas and the projector expect, e.g. `payload.node_id`).
//
// The module exposes the array as both a named and a default export so a
// later task (`walkthrough_demo_stepper` / `landing_demo_mobile_fallback`)
// can lazy-load it off the initial paint with `await import('./walkthrough')`
// without restructuring this module (refinement constraint 4 / Decision 3).

import type { Event } from '@a-conversa/shared-types';

import walkthroughEventsJson from './walkthrough-events.json' with { type: 'json' };

/**
 * The persistence/DB-row shape of a single record in
 * `walkthrough-events.json`. Snake_case outer envelope keys
 * (`session_id` / `created_at`) mirror the `session_events` table the
 * fixture was authored against; `payload` is forwarded verbatim into the
 * `Event` envelope. The shape is intentionally narrow — the cast to
 * `Event` happens once, at the seam, after the key remap below.
 */
interface RawWalkthroughEvent {
  readonly id: string;
  readonly session_id: string;
  readonly sequence: number;
  readonly kind: string;
  readonly actor: string | null;
  readonly payload: unknown;
  readonly created_at: string;
}

const rawEvents = walkthroughEventsJson as readonly RawWalkthroughEvent[];

/**
 * The curated "Should zoos exist?" walkthrough log — all 266 events, in
 * canonical order — as a `readonly Event[]`. The outer envelope is
 * normalized from the fixture's snake_case row keys to the camelCase
 * `EventEnvelope` shape; the cast is sound because the shipped copy is
 * pinned by the `validateEvent` sweep in `index.test.ts`.
 */
export const walkthroughEvents: readonly Event[] = rawEvents.map(
  (row): Event =>
    ({
      id: row.id,
      sessionId: row.session_id,
      sequence: row.sequence,
      kind: row.kind,
      actor: row.actor,
      payload: row.payload,
      createdAt: row.created_at,
    }) as Event,
);

export default walkthroughEvents;
