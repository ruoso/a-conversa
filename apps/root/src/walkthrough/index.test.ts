// Pins the shipped walkthrough seed (the canonical copy of the
// "Should zoos exist?" log — `packages/test-fixtures` symlinks its
// `walkthrough/events.json` to this app's asset, so there is no second
// copy to drift against).
//
// Refinement: tasks/refinements/landing_page/landing_walkthrough_seed.md
//
// Two durable guards (ADR 0022 — no throwaway verifications):
//
//   1. The seed module loads, is the full 266-event log, and its first
//      envelope is the "Should zoos exist?" `session-created` event.
//   2. **Schema sweep.** Every event in the exported `readonly Event[]`
//      passes `validateEvent`, justifying the static cast at the seam
//      (the prod module does no runtime validation).

import { describe, expect, it } from 'vitest';

import { validateEvent } from '@a-conversa/shared-types';

import { walkthroughEvents } from './index';

describe('walkthrough seed module', () => {
  it('exposes the full 266-event "Should zoos exist?" log as a readonly Event[]', () => {
    expect(walkthroughEvents).toHaveLength(266);

    const first = walkthroughEvents[0];
    expect(first).toBeDefined();
    expect(first!.kind).toBe('session-created');
    // Narrow on the discriminator so `payload.topic` is type-safe.
    if (first!.kind === 'session-created') {
      expect(first.payload.topic).toBe('Should zoos exist?');
    }
  });
});

describe('walkthrough seed schema sweep', () => {
  it('validates every shipped event against the per-kind Event schema', () => {
    expect(walkthroughEvents).toHaveLength(266);
    for (const event of walkthroughEvents) {
      // `validateEvent` throws on any envelope or payload mismatch. We
      // wrap each call so a failing event surfaces its sequence + kind
      // rather than a bare stack trace.
      try {
        validateEvent(event);
      } catch (cause) {
        const reason = cause instanceof Error ? cause.message : String(cause);
        throw new Error(
          `walkthrough event seq=${event.sequence} kind=${event.kind} failed validateEvent: ${reason}`,
          { cause },
        );
      }
    }
  });
});
