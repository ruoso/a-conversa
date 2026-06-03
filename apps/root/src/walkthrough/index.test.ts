// Pins the shipped walkthrough seed against its canonical source.
//
// Refinement: tasks/refinements/landing_page/landing_walkthrough_seed.md
//
// Three durable guards (ADR 0022 — no throwaway verifications):
//
//   1. The seed module loads, is the full 266-event log, and its first
//      envelope is the "Should zoos exist?" `session-created` event.
//   2. **Drift guard.** The shipped asset (`./walkthrough-events.json`)
//      is structurally identical to the canonical fixture
//      (`packages/test-fixtures/src/fixtures/walkthrough/events.json`).
//      The canonical file is read at runtime via `readFile` rather than a
//      static relative-path `import` because `apps/root`'s `tsc -b` is a
//      composite project with `rootDir: src`, and a JSON import from
//      outside `src` would trip TS6059. This mirrors how the repo already
//      reads the canonical fixture in a test
//      (`packages/test-fixtures/src/loader.test.ts`) and keeps the
//      coupling-to-canonical-source confined to the test, with no
//      production dependency on `@a-conversa/test-fixtures`.
//   3. **Schema sweep.** Every event in the exported `readonly Event[]`
//      passes `validateEvent`, justifying the static cast at the seam
//      (the prod module does no runtime validation).

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { validateEvent } from '@a-conversa/shared-types';

import { walkthroughEvents } from './index';
import shippedEventsJson from './walkthrough-events.json' with { type: 'json' };

const THIS_DIR = dirname(fileURLToPath(import.meta.url));
// apps/root/src/walkthrough → repo root is four levels up.
const CANONICAL_FIXTURE = join(
  THIS_DIR,
  '../../../../packages/test-fixtures/src/fixtures/walkthrough/events.json',
);

async function readCanonicalFixture(): Promise<unknown> {
  return JSON.parse(await readFile(CANONICAL_FIXTURE, 'utf8'));
}

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

describe('walkthrough seed drift guard', () => {
  it('ships an asset structurally identical to the canonical fixture', async () => {
    const canonical = await readCanonicalFixture();
    // Deep structural equality between the shipped copy and the canonical
    // source. If the two ever diverge, this fails loudly — the entire
    // guard against silent drift between the curated log and its copy.
    expect(shippedEventsJson).toEqual(canonical);
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
